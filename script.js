(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const FIELD_PRESETS = {
    wide: { w: 0.9, h: 0.6 },
    medium: { w: 0.82, h: 0.54 },
    short: { w: 0.74, h: 0.48 },
  };

  const COLORS = {
    pitchLight: '#7fcf83',
    pitchDark: '#5faf66',
    pitchLine: '#e9f7e3',
    pitchBorder: '#2e6b3f',
    blue: '#3a78ff',
    red: '#ff4d4d',
    ball: '#f6f0d4',
    shadow: 'rgba(0,0,0,0.25)',
    uiText: '#163021',
    uiSub: '#2a4b38',
    goalFrame: '#f2f6f0',
    goalNet: 'rgba(255,255,255,0.35)',
  };

  const KEYS = {
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    groundKick: 'Space',
    airKick: 'KeyB',
    skill: 'KeyC',
    start: 'Enter',
    wide: 'Digit6',
    medium: 'Digit5',
    short: 'Digit4',
    fullscreen: 'KeyF',
    reset: 'KeyR',
    mode2: 'Digit1',
    mode3: 'Digit2',
    mode4: 'Digit3',
  };

  const state = {
    mode: 'menu',
    menuStep: 'field',
    fieldType: 'medium',
    selectedCharacter: 'mbappe',
    view: { w: 0, h: 0 },
    field: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      centerX: 0,
      centerY: 0,
      width: 0,
      height: 0,
      goalWidth: 0,
      goalDepth: 0,
    },
    score: { blue: 0, red: 0 },
    freeze: 0,
    match: {
      duration: 120,
      time: 120,
      overtime: false,
    },
    players: {},
    playerOrder: [],
    localPlayerId: null,
    remotePlayerId: null,
    ball: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      z: 0,
      vz: 0,
      curveTime: 0,
      curveX: 0,
      curveY: 0,
      curveForce: 0,
      r: 10,
    },
  };

  const input = {
    keys: new Set(),
  };

  const chat = {
    list: null,
    form: null,
    input: null,
  };

  const controlsUi = {
    panel: null,
    groundButton: null,
    airButton: null,
    skillButton: null,
    hint: null,
  };

  const network = {
    ws: null,
    connected: false,
    role: 'offline',
    id: null,
    remoteKeys: new Set(),
    snapshotTimer: null,
    lastRemoteKeys: new Set(),
    snapshotTargets: { players: {}, ball: null },
    snapshotBuffer: [],
    snapshotDelay: 100,
    snapshotMax: 30,
    clientSmoothingReady: false,
    webrtc: {
      pc: null,
      dc: null,
      candidates: [],
      ready: false,
    },
    lockstep: {
      currentTick: 0,
      inputBuffer: {}, // { tick: { local: Set, remote: Set } }
      inputDelay: 4,   // ticks to look ahead
    },
  };

  const lobby = {
    mode: 2,
    started: false,
    teams: { red: [], blue: [] },
    spectators: [],
    players: {},
    joinCounter: 0,
    playerCounter: 0,
    lastLoserTeam: null,
    pick: { active: false, turn: 'red' },
    tabOpen: false,
    pickBuffer: '',
    localPlayerId: null,
  };

  const CONTROL_STORAGE_KEYS = {
    groundKick: 'okanball_ground_key',
    airKick: 'okanball_air_key',
    skill: 'okanball_skill_key',
  };

  function readStoredControl(action, fallback) {
    try {
      const key = localStorage.getItem(CONTROL_STORAGE_KEYS[action]);
      return key || fallback;
    } catch (err) {
      return fallback;
    }
  }

  const controls = {
    groundKick: readStoredControl('groundKick', KEYS.groundKick),
    airKick: readStoredControl('airKick', KEYS.airKick),
    skill: readStoredControl('skill', KEYS.skill),
  };

  let controlBindingTarget = null;

  function formatKeyLabel(code) {
    if (!code) return '-';
    if (code === 'Space') return 'SPACE';
    if (code.startsWith('Key')) return code.slice(3).toUpperCase();
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return `NP${code.slice(6)}`;
    return code.toUpperCase();
  }

  function saveControl(action, code) {
    controls[action] = code;
    try {
      localStorage.setItem(CONTROL_STORAGE_KEYS[action], code);
    } catch (err) {}
  }

  function updateControlsUi() {
    if (!controlsUi.groundButton || !controlsUi.airButton || !controlsUi.skillButton || !controlsUi.hint) return;
    controlsUi.groundButton.textContent = formatKeyLabel(controls.groundKick);
    controlsUi.airButton.textContent = formatKeyLabel(controls.airKick);
    controlsUi.skillButton.textContent = formatKeyLabel(controls.skill);
    controlsUi.groundButton.classList.toggle('is-listening', controlBindingTarget === 'groundKick');
    controlsUi.airButton.classList.toggle('is-listening', controlBindingTarget === 'airKick');
    controlsUi.skillButton.classList.toggle('is-listening', controlBindingTarget === 'skill');
    controlsUi.hint.textContent = controlBindingTarget
      ? 'Yeni tusa bas (vazgecmek icin ESC)'
      : 'Degistirmek icin butona bas';
  }

  function startControlBinding(action) {
    controlBindingTarget = action;
    updateControlsUi();
  }

  function resolveInputCode(code) {
    if (code === controls.groundKick) return KEYS.groundKick;
    if (code === controls.airKick) return KEYS.airKick;
    if (code === controls.skill) return KEYS.skill;
    return code;
  }

  function buildNetworkInputKeys() {
    const mapped = new Set();
    input.keys.forEach((code) => {
      mapped.add(resolveInputCode(code));
    });
    return [...mapped];
  }

  function createPlayerState(id, name, color) {
    return {
      id,
      name,
      color,
      character: 'mbappe',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 18,
      facing: { x: 1, y: 0 },
      charge: {
        ground: { active: false, time: 0 },
        air: { active: false, time: 0 },
      },
      ability: {
        mbappeBoostTime: 0,
        mbappeCooldown: 0,
        juninhoCooldown: 0,
      },
      kickFlash: 0,
      lastSkillKeyDown: false,
    };
  }

  function getLocalPlayer() {
    return state.players[state.localPlayerId];
  }

  function getRemotePlayer() {
    return state.players[state.remotePlayerId];
  }

  function resetClientSmoothing() {
    network.snapshotTargets = { players: {}, ball: null };
    network.snapshotBuffer = [];
    network.clientSmoothingReady = false;
  }

  function setupPlayers(localName, remoteName) {
    state.players = {};
    state.playerOrder = [];
    
    // Use absolute IDs for deterministic simulation
    const hostPlayer = createPlayerState('host', network.role === 'host' ? localName : remoteName, COLORS.blue);
    const guestPlayer = createPlayerState('guest', network.role === 'client' ? localName : remoteName, COLORS.red);
    
    hostPlayer.character = network.role === 'host' ? state.selectedCharacter : 'mbappe';
    guestPlayer.character = network.role === 'client' ? state.selectedCharacter : 'mbappe';

    state.players['host'] = hostPlayer;
    state.players['guest'] = guestPlayer;
    state.playerOrder.push(hostPlayer, guestPlayer);
    
    state.localPlayerId = network.role === 'host' ? 'host' : 'guest';
    state.remotePlayerId = network.role === 'host' ? 'guest' : 'host';
  }

  function setLocalCharacter(character) {
    state.selectedCharacter = character;
    const local = getLocalPlayer();
    if (local) {
      local.character = character;
      local.ability.mbappeBoostTime = 0;
      local.ability.mbappeCooldown = 0;
      local.ability.juninhoCooldown = 0;
    }
  }

  function resetLobbyForPlayers(localName, remoteName) {
    lobby.mode = 1;
    lobby.started = false;
    lobby.teams = { red: [], blue: [] };
    lobby.spectators = [];
    lobby.players = {};
    lobby.joinCounter = 0;
    lobby.playerCounter = 0;
    lobby.pick = { active: false, turn: 'red' };
    lobby.tabOpen = false;
    lobby.pickBuffer = '';
    const localId = joinPlayer(localName);
    const remoteId = joinPlayer(remoteName);
    lobby.localPlayerId = localId;
    lobby.remotePlayerId = remoteId;
  }

  function createPlayer(name) {
    lobby.playerCounter += 1;
    const id = `p${lobby.playerCounter}`;
    lobby.joinCounter += 1;
    lobby.players[id] = {
      id,
      name,
      joinIndex: lobby.joinCounter,
      team: 'spectator',
      lastTeam: null,
      disconnectedAt: null,
      connected: true,
    };
    return id;
  }

  function removeFromArray(arr, id) {
    const index = arr.indexOf(id);
    if (index >= 0) arr.splice(index, 1);
  }

  function getTeamCapacity() {
    return lobby.mode;
  }

  function isTeamFull(team) {
    return lobby.teams[team].length >= getTeamCapacity();
  }

  function getCaptainId(team) {
    return lobby.teams[team][0] || null;
  }

  function addSpectator(id, toFront = false) {
    removeFromArray(lobby.teams.red, id);
    removeFromArray(lobby.teams.blue, id);
    removeFromArray(lobby.spectators, id);
    if (toFront) {
      lobby.spectators.unshift(id);
    } else {
      lobby.spectators.push(id);
    }
    if (lobby.players[id]) {
      lobby.players[id].team = 'spectator';
    }
  }

  function addToTeam(id, team) {
    if (isTeamFull(team)) return false;
    removeFromArray(lobby.teams.red, id);
    removeFromArray(lobby.teams.blue, id);
    removeFromArray(lobby.spectators, id);
    lobby.teams[team].push(id);
    if (lobby.players[id]) {
      lobby.players[id].team = team;
      lobby.players[id].lastTeam = team;
    }
    return true;
  }

  function pickStartTeam(needsRed, needsBlue) {
    if (needsRed && needsBlue) {
      return lobby.lastLoserTeam || 'red';
    }
    if (needsRed) return 'red';
    return 'blue';
  }

  function updatePickState() {
    const needsRed = !isTeamFull('red');
    const needsBlue = !isTeamFull('blue');
    if ((!needsRed && !needsBlue) || lobby.spectators.length === 0) {
      lobby.pick.active = false;
      return;
    }
    if (!lobby.pick.active) {
      lobby.pick.turn = pickStartTeam(needsRed, needsBlue);
      lobby.pick.active = true;
    } else if (lobby.pick.turn === 'red' && !needsRed) {
      lobby.pick.turn = needsBlue ? 'blue' : lobby.pick.turn;
    } else if (lobby.pick.turn === 'blue' && !needsBlue) {
      lobby.pick.turn = needsRed ? 'red' : lobby.pick.turn;
    }
  }

  function autoAssign() {
    let needsRed = !isTeamFull('red');
    let needsBlue = !isTeamFull('blue');
    while (lobby.spectators.length > 0 && (needsRed || needsBlue)) {
      const team = needsRed ? 'red' : 'blue';
      const id = lobby.spectators.shift();
      addToTeam(id, team);
      needsRed = !isTeamFull('red');
      needsBlue = !isTeamFull('blue');
    }
    updatePickState();
  }

  function joinPlayer(name) {
    const id = createPlayer(name);
    const needsRed = !isTeamFull('red');
    const needsBlue = !isTeamFull('blue');
    if (!lobby.started && (needsRed || needsBlue)) {
      const team = lobby.teams.red.length <= lobby.teams.blue.length ? 'red' : 'blue';
      addToTeam(id, team);
    } else {
      addSpectator(id);
    }
    updatePickState();
    return id;
  }

  function exitPlayer(id) {
    const player = lobby.players[id];
    if (!player) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    removeFromArray(lobby.teams.red, id);
    removeFromArray(lobby.teams.blue, id);
    removeFromArray(lobby.spectators, id);
    updatePickState();
  }

  function disconnectPlayer(id) {
    const player = lobby.players[id];
    if (!player) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    if (player.team !== 'spectator') {
      removeFromArray(lobby.teams[player.team], id);
      addSpectator(id);
    }
    updatePickState();
  }

  function reconnectPlayer(id) {
    const player = lobby.players[id];
    if (!player) return;
    player.connected = true;
    const now = Date.now();
    const withinWindow = player.disconnectedAt && now - player.disconnectedAt <= 60000;
    if (withinWindow && player.lastTeam && !isTeamFull(player.lastTeam)) {
      addToTeam(id, player.lastTeam);
    } else {
      addSpectator(id);
    }
    player.disconnectedAt = null;
    updatePickState();
  }

  function endMatch(winnerTeam) {
    const loserTeam = winnerTeam === 'red' ? 'blue' : 'red';
    lobby.started = false;
    lobby.lastLoserTeam = loserTeam;
    const losers = [...lobby.teams[loserTeam]];
    lobby.teams[loserTeam] = [];
    losers.forEach((id) => {
      if (lobby.players[id]) {
        lobby.players[id].team = 'spectator';
        lobby.players[id].lastTeam = loserTeam;
      }
    });
    lobby.spectators = [...losers, ...lobby.spectators.filter((id) => !losers.includes(id))];
    updatePickState();
  }

  function pickSpectator(number, team) {
    const index = number - 1;
    if (index < 0 || index >= lobby.spectators.length) return false;
    if (isTeamFull(team)) return false;
    const id = lobby.spectators[index];
    addToTeam(id, team);
    updatePickState();
    if (!lobby.pick.active) {
      autoAssign();
      return true;
    }
    const needsRed = !isTeamFull('red');
    const needsBlue = !isTeamFull('blue');
    if (needsRed && needsBlue) {
      lobby.pick.turn = lobby.pick.turn === 'red' ? 'blue' : 'red';
    } else if (needsRed) {
      lobby.pick.turn = 'red';
    } else if (needsBlue) {
      lobby.pick.turn = 'blue';
    }
    updatePickState();
    return true;
  }

  function setMode(mode) {
    lobby.mode = mode;
    while (lobby.teams.red.length > lobby.mode) {
      const id = lobby.teams.red.pop();
      addSpectator(id, true);
    }
    while (lobby.teams.blue.length > lobby.mode) {
      const id = lobby.teams.blue.pop();
      addSpectator(id, true);
    }
    updatePickState();
    autoAssign();
  }

  function sendNetworkMessage(payload) {
    if (!network.ws || network.ws.readyState !== WebSocket.OPEN) return;
    network.ws.send(JSON.stringify(payload));
  }

  function sendP2PMessage(payload) {
    if (network.webrtc.dc && network.webrtc.dc.readyState === 'open') {
      network.webrtc.dc.send(JSON.stringify(payload));
    } else {
      // Fallback to WS if DC not ready (or for signaling)
      // Actually, inputs should only go through DC in lockstep
    }
  }

  function setupWebRTC(remoteId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    network.webrtc.pc = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendNetworkMessage({ type: 'signal', to: remoteId, data: { candidate: e.candidate } });
      }
    };

    if (network.role === 'host') {
      const dc = pc.createDataChannel('game', { ordered: true });
      setupDataChannel(dc);
    } else {
      pc.ondatachannel = (e) => {
        setupDataChannel(e.channel);
      };
    }

    return pc;
  }

  function setupDataChannel(dc) {
     network.webrtc.dc = dc;
     dc.onopen = () => {
       console.log('P2P DataChannel open');
       if (network.role === 'host') {
         network.webrtc.ready = true;
         // Send initial state to sync
         sendP2PMessage({ 
           type: 'lockstep_sync', 
           tick: 0,
           state: {
             score: state.score,
             ball: { x: state.ball.x, y: state.ball.y, z: state.ball.z, vx: state.ball.vx, vy: state.ball.vy, vz: state.ball.vz },
             hostChar: state.players['host']?.character || 'mbappe',
             guestChar: state.players['guest']?.character || 'mbappe',
           }
         });
       }
     };
     dc.onmessage = (e) => {
       const msg = JSON.parse(e.data);
       if (msg.type === 'lockstep_input') {
         const { tick, keys } = msg;
         if (!network.lockstep.inputBuffer[tick]) {
           network.lockstep.inputBuffer[tick] = { local: null, remote: null };
         }
         network.lockstep.inputBuffer[tick].remote = new Set(keys);
       } else if (msg.type === 'lockstep_sync') {
         // Sync initial state
         state.score = msg.state.score;
         Object.assign(state.ball, msg.state.ball);
         if (state.players['host']) state.players['host'].character = msg.state.hostChar;
         if (state.players['guest']) state.players['guest'].character = msg.state.guestChar;
         network.lockstep.currentTick = msg.tick;
         network.webrtc.ready = true;
         console.log('P2P Synced and Ready');
       }
     };
   }

  async function handleSignal(from, data) {
    if (!network.webrtc.pc) {
      setupWebRTC(from);
    }
    const pc = network.webrtc.pc;

    if (data.offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendNetworkMessage({ type: 'signal', to: from, data: { answer } });
    } else if (data.answer) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  }

  function addChatMessage(author, text) {
    if (!chat.list) return;
    const item = document.createElement('div');
    item.textContent = `${author}: ${text}`;
    chat.list.appendChild(item);
    while (chat.list.children.length > 60) {
      chat.list.removeChild(chat.list.firstChild);
    }
    chat.list.scrollTop = chat.list.scrollHeight;
  }

  function initChat() {
    chat.list = document.getElementById('chat-messages');
    chat.form = document.getElementById('chat-form');
    chat.input = document.getElementById('chat-input');
    if (!chat.form || !chat.input) return;
    
    chat.input.addEventListener('focus', () => {
      input.keys.clear(); // Clear all keys when chat focused to prevent stuck movement
    });

    chat.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = chat.input.value.trim();
      if (!text) return;
      addChatMessage('Sen', text);
      sendNetworkMessage({ type: 'chat', text, from: network.id });
      chat.input.value = '';
      chat.input.focus();
    });
  }

  function initControlsPanel() {
    controlsUi.panel = document.getElementById('controls');
    controlsUi.groundButton = document.getElementById('bind-ground');
    controlsUi.airButton = document.getElementById('bind-air');
    controlsUi.skillButton = document.getElementById('bind-skill');
    controlsUi.hint = document.getElementById('controls-hint');
    if (!controlsUi.groundButton || !controlsUi.airButton || !controlsUi.skillButton || !controlsUi.hint) return;
    controlsUi.groundButton.addEventListener('click', () => {
      startControlBinding('groundKick');
    });
    controlsUi.airButton.addEventListener('click', () => {
      startControlBinding('airKick');
    });
    controlsUi.skillButton.addEventListener('click', () => {
      startControlBinding('skill');
    });
    updateControlsUi();
  }

  function startSnapshotLoop() {
    if (network.snapshotTimer) {
      clearInterval(network.snapshotTimer);
    }
    network.snapshotTimer = setInterval(() => {
      if (network.role === 'host' && !network.webrtc.ready) {
        sendNetworkMessage({ type: 'snapshot', state: buildSnapshot() });
      }
    }, 16);
  }

  function handleRemoteKeyChange(nextKeys) {
    if (network.role !== 'host') return;
    const player = getRemotePlayer();
    if (!player) return;
    const prev = network.lastRemoteKeys;
    const groundCode = KEYS.groundKick;
    const prevAir = prev.has(KEYS.airKick);
    const nextAir = nextKeys.has(KEYS.airKick);
    if (nextKeys.has(groundCode) && !prev.has(groundCode)) {
      startCharge(player, 'ground');
    }
    if (nextAir && !prevAir) {
      startCharge(player, 'air');
    }
    if (nextKeys.has(KEYS.skill) && !prev.has(KEYS.skill)) {
      tryActivateMbappeSkill(player);
    }
    if (!nextKeys.has(groundCode) && prev.has(groundCode)) {
      releaseCharge(player, 'ground');
    }
    if (!nextAir && prevAir) {
      releaseCharge(player, 'air');
    }
    network.lastRemoteKeys = new Set(nextKeys);
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.fieldType && snapshot.fieldType !== state.fieldType) {
      state.fieldType = snapshot.fieldType;
      computeField(false);
    }
    state.mode = snapshot.mode || state.mode;
    state.score = snapshot.score || state.score;
    state.freeze = snapshot.freeze ?? 0;
    if (snapshot.match) {
      state.match.duration = snapshot.match.duration ?? state.match.duration;
      state.match.time = snapshot.match.time ?? state.match.time;
      state.match.overtime = snapshot.match.overtime ?? state.match.overtime;
    }
    if (snapshot.menuStep) {
      state.menuStep = snapshot.menuStep;
    }
    if (snapshot.selectedCharacter) {
      state.selectedCharacter = snapshot.selectedCharacter;
    }
    const snapshotField = snapshot.field;
    const localField = state.field;
    const hasFieldMapping = snapshotField
      && Number.isFinite(snapshotField.left)
      && Number.isFinite(snapshotField.top)
      && Number.isFinite(snapshotField.width)
      && Number.isFinite(snapshotField.height)
      && snapshotField.width > 0
      && snapshotField.height > 0
      && localField.width > 0
      && localField.height > 0;
    const hasLocalFieldBounds = Number.isFinite(localField.left)
      && Number.isFinite(localField.right)
      && Number.isFinite(localField.top)
      && Number.isFinite(localField.bottom)
      && localField.right > localField.left
      && localField.bottom > localField.top;
    const safeNumber = (value, fallback) => (Number.isFinite(value) ? value : fallback);
    const mapX = (x) => {
      const sourceX = safeNumber(x, localField.centerX);
      if (!hasFieldMapping) return sourceX;
      const ratio = clamp((sourceX - snapshotField.left) / snapshotField.width, 0, 1);
      return localField.left + ratio * localField.width;
    };
    const mapY = (y) => {
      const sourceY = safeNumber(y, localField.centerY);
      if (!hasFieldMapping) return sourceY;
      const ratio = clamp((sourceY - snapshotField.top) / snapshotField.height, 0, 1);
      return localField.top + ratio * localField.height;
    };
    const mapVX = (vx) => {
      const sourceVX = safeNumber(vx, 0);
      if (!hasFieldMapping) return sourceVX;
      return sourceVX * (localField.width / snapshotField.width);
    };
    const mapVY = (vy) => {
      const sourceVY = safeNumber(vy, 0);
      if (!hasFieldMapping) return sourceVY;
      return sourceVY * (localField.height / snapshotField.height);
    };
    const mapLength = (value) => {
      const sourceValue = safeNumber(value, 0);
      if (!hasFieldMapping) return sourceValue;
      const scaleX = localField.width / snapshotField.width;
      const scaleY = localField.height / snapshotField.height;
      return sourceValue * ((scaleX + scaleY) / 2);
    };
    const mapSnapshotPlayerId = (id) => {
      if (network.role !== 'client') return id;
      if (id === 'local') return 'remote';
      if (id === 'remote') return 'local';
      return id;
    };
    const isClient = network.role === 'client';
    const snapshotPlayers = {};
    let snapshotBall = null;
    let hasSnapshotData = false;
    if (snapshot.ball) {
      hasSnapshotData = true;
      snapshotBall = {
        r: Number.isFinite(snapshot.ball.r) ? clamp(mapLength(snapshot.ball.r), 8, 12) : state.ball.r,
        x: mapX(snapshot.ball.x ?? state.ball.x),
        y: mapY(snapshot.ball.y ?? state.ball.y),
        vx: mapVX(snapshot.ball.vx ?? state.ball.vx),
        vy: mapVY(snapshot.ball.vy ?? state.ball.vy),
        z: mapLength(snapshot.ball.z ?? state.ball.z),
        vz: mapLength(snapshot.ball.vz ?? state.ball.vz),
        curveTime: snapshot.ball.curveTime ?? state.ball.curveTime,
        curveX: snapshot.ball.curveX ?? state.ball.curveX,
        curveY: snapshot.ball.curveY ?? state.ball.curveY,
        curveForce: mapLength(snapshot.ball.curveForce ?? state.ball.curveForce),
      };
      if (hasLocalFieldBounds) {
        snapshotBall.x = clamp(snapshotBall.x, localField.left + snapshotBall.r, localField.right - snapshotBall.r);
        snapshotBall.y = clamp(snapshotBall.y, localField.top + snapshotBall.r, localField.bottom - snapshotBall.r);
      }
    }
    if (snapshot.players) {
      snapshot.players.forEach((p) => {
        const mappedPlayerId = mapSnapshotPlayerId(p.id);
        const player = state.players[mappedPlayerId];
        if (!player) return;
        hasSnapshotData = true;
        const nextPlayer = {
          r: player.r,
          x: mapX(p.x),
          y: mapY(p.y),
          vx: mapVX(p.vx),
          vy: mapVY(p.vy),
          facing: player.facing,
        };
        if (Number.isFinite(p.r)) {
          const maxRadius = Math.max(11, localField.height * 0.06);
          nextPlayer.r = clamp(mapLength(p.r), 11, maxRadius);
        }
        if (hasLocalFieldBounds) {
          nextPlayer.x = clamp(nextPlayer.x, localField.left + nextPlayer.r, localField.right - nextPlayer.r);
          nextPlayer.y = clamp(nextPlayer.y, localField.top + nextPlayer.r, localField.bottom - nextPlayer.r);
        }
        const facingX = safeNumber(p.facing?.x, player.facing.x);
        const facingY = safeNumber(p.facing?.y, player.facing.y);
        nextPlayer.facing = normalize(facingX, facingY);
        snapshotPlayers[mappedPlayerId] = nextPlayer;
        player.kickFlash = p.kickFlash;
        if (p.character) {
          player.character = p.character;
        }
        if (p.ability) {
          player.ability.mbappeBoostTime = p.ability.mbappeBoostTime ?? player.ability.mbappeBoostTime;
          player.ability.mbappeCooldown = p.ability.mbappeCooldown ?? player.ability.mbappeCooldown;
          player.ability.juninhoCooldown = p.ability.juninhoCooldown ?? player.ability.juninhoCooldown;
        }
        if (p.charge) {
          player.charge.ground.active = p.charge.ground.active;
          player.charge.ground.time = p.charge.ground.time;
          player.charge.air.active = p.charge.air.active;
          player.charge.air.time = p.charge.air.time;
        }
      });
    }
    if (isClient && hasSnapshotData) {
      const payload = { players: snapshotPlayers, ball: snapshotBall };
      network.snapshotTargets = payload;
      network.snapshotBuffer.push({ time: performance.now(), state: payload });
      while (network.snapshotBuffer.length > network.snapshotMax) {
        network.snapshotBuffer.shift();
      }
      if (!network.clientSmoothingReady) {
        if (snapshotBall) {
          Object.assign(state.ball, snapshotBall);
        }
        Object.entries(snapshotPlayers).forEach(([id, data]) => {
          const player = state.players[id];
          if (!player) return;
          player.r = data.r;
          player.x = data.x;
          player.y = data.y;
          player.vx = data.vx;
          player.vy = data.vy;
          player.facing = data.facing;
        });
        network.clientSmoothingReady = true;
      }
    } else if (hasSnapshotData) {
      if (snapshotBall) {
        Object.assign(state.ball, snapshotBall);
      }
      Object.entries(snapshotPlayers).forEach(([id, data]) => {
        const player = state.players[id];
        if (!player) return;
        player.r = data.r;
        player.x = data.x;
        player.y = data.y;
        player.vx = data.vx;
        player.vy = data.vy;
        player.facing = data.facing;
      });
    }
    lobby.started = snapshot.lobby?.started ?? lobby.started;
    lobby.mode = snapshot.lobby?.mode ?? lobby.mode;
  }

  function buildSnapshot() {
    return {
      mode: state.mode,
      fieldType: state.fieldType,
      score: { ...state.score },
      freeze: state.freeze,
      match: {
        duration: state.match.duration,
        time: state.match.time,
        overtime: state.match.overtime,
      },
      menuStep: state.menuStep,
      selectedCharacter: state.selectedCharacter,
      ball: { ...state.ball },
      field: {
        left: state.field.left,
        top: state.field.top,
        width: state.field.width,
        height: state.field.height,
      },
      players: state.playerOrder.map((player) => ({
        id: player.id,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        r: player.r,
        facing: { ...player.facing },
        kickFlash: player.kickFlash,
        character: player.character,
        ability: { ...player.ability },
        charge: {
          ground: { ...player.charge.ground },
          air: { ...player.charge.air },
        },
      })),
      lobby: {
        started: lobby.started,
        mode: lobby.mode,
      },
    };
  }

  function connectNetwork() {
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    const ws = new WebSocket(wsUrl);
    network.ws = ws;
    ws.addEventListener('open', () => {
      network.connected = true;
      sendNetworkMessage({ type: 'hello' });
    });
    ws.addEventListener('message', (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (msg.type === 'role') {
        network.role = msg.role;
        network.id = msg.id;
        network.hostId = msg.hostId;
        resetClientSmoothing();
        const remoteName = network.role === 'host' ? 'Rakip' : 'Ev Sahibi';
        setupPlayers('Sen', remoteName);
        resetLobbyForPlayers('Sen', remoteName);
        computeField(false);
        startSnapshotLoop();

        // Start WebRTC connection if we are the client
        if (network.role === 'client') {
          (async () => {
            const pc = setupWebRTC(network.hostId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendNetworkMessage({ type: 'signal', to: network.hostId, data: { offer } });
          })();
        }
      } else if (msg.type === 'signal') {
        handleSignal(msg.from, msg.data);
      } else if (msg.type === 'snapshot') {
        if (network.role !== 'host' && !network.webrtc.ready) {
          applySnapshot(msg.state);
        }
      } else if (msg.type === 'input') {
        if (network.role === 'host') {
          const next = new Set(msg.keys || []);
          handleRemoteKeyChange(next);
          network.remoteKeys = next;
        }
      } else if (msg.type === 'menu_action') {
        if (network.role === 'host') {
          applyMenuAction(msg.action);
        }
      } else if (msg.type === 'chat') {
        if (msg.from === network.id) return;
        addChatMessage('Rakip', msg.text || '');
      } else if (msg.type === 'host_changed') {
        network.role = msg.id === network.id ? 'host' : 'client';
      }
    });
    ws.addEventListener('close', () => {
      network.connected = false;
      network.role = 'offline';
    });
  }

  const basePhysics = {
    playerAccel: 1600,
    playerMaxSpeed: 300,
    playerDamp: 8.5,
    ballDamp: 2.6,
    ballAirDamp: 0.4,
    ballBounce: 0.82,
    gravity: 900,
    goalDropGravity: 2600,
    goalDropZoneRatio: 0.18,
  };
  const physics = {
    ...basePhysics,
    worldScale: 1,
  };

  const baseChargeConfig = {
    ground: { max: 2.8, minSpeed: 520, maxSpeed: 2200 },
    air: { max: 1.6, minForward: 200, maxForward: 560, minUp: 260, maxUp: 520 },
  };
  const chargeConfig = {
    ground: { ...baseChargeConfig.ground },
    air: { ...baseChargeConfig.air },
  };

  const BASE_FIELD_WIDTH = 1120;
  const FIXED_SIM_STEP = 1 / 120;
  const MAX_SIM_STEPS_PER_FRAME = 8;

  let lastTime = performance.now();
  let fixedStepAccumulator = 0;
  let manualTime = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function vecLength(x, y) {
    return Math.hypot(x, y);
  }

  function normalize(x, y) {
    const len = Math.hypot(x, y);
    if (len < 0.0001) return { x: 1, y: 0 };
    return { x: x / len, y: y / len };
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.view.w = w;
    state.view.h = h;

    const shouldReset = state.mode === 'menu';
    computeField(shouldReset);
  }

  function computeWorldScale(fieldWidth) {
    const rawScale = fieldWidth > 0 ? fieldWidth / BASE_FIELD_WIDTH : 1;
    return clamp(rawScale, 0.8, 1.35);
  }

  function computeField(reset = true) {
    const preset = FIELD_PRESETS[state.fieldType];
    const margin = 32;
    const maxW = state.view.w - margin * 2;
    const maxH = state.view.h - margin * 2;
    const width = Math.min(maxW, state.view.w * preset.w);
    const height = Math.min(maxH, state.view.h * preset.h);
    const left = (state.view.w - width) / 2;
    const top = (state.view.h - height) / 2;

    const goalWidth = height * 0.28;
    const goalDepth = Math.max(14, height * 0.065);

    state.field = {
      left,
      right: left + width,
      top,
      bottom: top + height,
      centerX: left + width / 2,
      centerY: top + height / 2,
      width,
      height,
      goalWidth,
      goalDepth,
    };

    const basePlayerR = clamp(height * 0.03, 11, 18);
    state.playerOrder.forEach((player) => {
      player.r = basePlayerR;
    });
    state.ball.r = clamp(height * 0.023, 8, 12);

    const worldScale = computeWorldScale(width);
    updatePhysicsConfig(worldScale);
    updateChargeConfig(width);
    if (reset) {
      resetPositions();
    }
  }

  function updatePhysicsConfig(worldScale) {
    physics.worldScale = worldScale;
    physics.playerAccel = basePhysics.playerAccel * worldScale;
    physics.playerMaxSpeed = basePhysics.playerMaxSpeed * worldScale;
    physics.playerDamp = basePhysics.playerDamp;
    physics.ballDamp = basePhysics.ballDamp;
    physics.ballAirDamp = basePhysics.ballAirDamp;
    physics.ballBounce = basePhysics.ballBounce;
    physics.gravity = basePhysics.gravity;
    physics.goalDropGravity = basePhysics.goalDropGravity;
    physics.goalDropZoneRatio = basePhysics.goalDropZoneRatio;
  }

  function updateChargeConfig(fieldWidth) {
    const baseWidth = Math.min(state.view.w - 64, state.view.w * FIELD_PRESETS.medium.w);
    const rawScale = baseWidth > 0 ? fieldWidth / baseWidth : 1;
    const powerScale = clamp(rawScale, 1, 3.8);
    chargeConfig.ground.max = baseChargeConfig.ground.max;
    chargeConfig.ground.minSpeed = baseChargeConfig.ground.minSpeed * powerScale;
    chargeConfig.ground.maxSpeed = baseChargeConfig.ground.maxSpeed * powerScale;
    chargeConfig.air.max = baseChargeConfig.air.max;
    chargeConfig.air.minForward = baseChargeConfig.air.minForward * powerScale;
    chargeConfig.air.maxForward = baseChargeConfig.air.maxForward * powerScale;
    chargeConfig.air.minUp = baseChargeConfig.air.minUp * powerScale;
    chargeConfig.air.maxUp = baseChargeConfig.air.maxUp * powerScale;
  }

  function resetPositions() {
    const f = state.field;
    const offset = f.width * 0.22;
    const localPlayer = getLocalPlayer();
    const remotePlayer = getRemotePlayer();

    if (localPlayer) {
      localPlayer.x = f.centerX - offset;
      localPlayer.y = f.centerY;
      localPlayer.vx = 0;
      localPlayer.vy = 0;
      localPlayer.facing = { x: 1, y: 0 };
      localPlayer.kickFlash = 0;
      localPlayer.charge.ground.active = false;
      localPlayer.charge.ground.time = 0;
      localPlayer.charge.air.active = false;
      localPlayer.charge.air.time = 0;
      localPlayer.ability.mbappeBoostTime = 0;
    }

    if (remotePlayer) {
      remotePlayer.x = f.centerX + offset;
      remotePlayer.y = f.centerY;
      remotePlayer.vx = 0;
      remotePlayer.vy = 0;
      remotePlayer.facing = { x: -1, y: 0 };
      remotePlayer.kickFlash = 0;
      remotePlayer.charge.ground.active = false;
      remotePlayer.charge.ground.time = 0;
      remotePlayer.charge.air.active = false;
      remotePlayer.charge.air.time = 0;
      remotePlayer.ability.mbappeBoostTime = 0;
    }

    state.ball.x = f.centerX;
    state.ball.y = f.centerY;
    state.ball.vx = 0;
    state.ball.vy = 0;
    state.ball.z = 0;
    state.ball.vz = 0;
    state.ball.curveTime = 0;
    state.ball.curveX = 0;
    state.ball.curveY = 0;
    state.ball.curveForce = 0;

  }

  function isBallNearPlayer(player, margin = 10) {
    const ball = state.ball;
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const dist = Math.hypot(dx, dy);
    const threshold = player.r + ball.r + margin;
    return dist <= threshold;
  }

  function tryActivateMbappeSkill(player) {
    if (!player || player.character !== 'mbappe') return false;
    if (player.ability.mbappeCooldown > 0) return false;
    if (isBallNearPlayer(player, 12)) return false;
    player.ability.mbappeBoostTime = 4;
    player.ability.mbappeCooldown = 15;
    return true;
  }

  function getPlayerInputSet(player) {
    if (!player) return input.keys;
    return player.id === state.localPlayerId ? input.keys : network.remoteKeys;
  }

  function getMovementInfluenceDirection(player) {
    const keySet = getPlayerInputSet(player);
    let ax = 0;
    let ay = 0;
    if (keySet.has(KEYS.up) || keySet.has('ArrowUp')) ay -= 1;
    if (keySet.has(KEYS.down) || keySet.has('ArrowDown')) ay += 1;
    if (keySet.has(KEYS.left) || keySet.has('ArrowLeft')) ax -= 1;
    if (keySet.has(KEYS.right) || keySet.has('ArrowRight')) ax += 1;
    if (ax !== 0 || ay !== 0) {
      return normalize(ax, ay);
    }
    return normalize(player.facing.x, player.facing.y);
  }

  function triggerJuninhoCurve(player) {
    if (!player || player.character !== 'juninho') return;
    if (player.ability.juninhoCooldown > 0) return;
    const influence = getMovementInfluenceDirection(player);
    state.ball.curveTime = 1.4; // 1.25 -> 1.4
    state.ball.curveX = influence.x;
    state.ball.curveY = influence.y;
    state.ball.curveForce = 450 * physics.worldScale; // 260 -> 450
    player.ability.juninhoCooldown = 10;
  }

  function startMatch() {
    state.mode = 'playing';
    resetMatch();
  }

  function resetMatch() {
    state.score.blue = 0;
    state.score.red = 0;
    state.freeze = 0;
    state.match.time = state.match.duration;
    state.match.overtime = false;
    resetPositions();
    lobby.started = true;
    updatePickState();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function applyMenuAction(action) {
    if (!action || state.mode !== 'menu') return;

    if (action.type === 'field' && state.menuStep === 'field') {
      if (action.value === 'wide' || action.value === 'medium' || action.value === 'short') {
        state.fieldType = action.value;
        computeField();
        state.menuStep = 'character';
      }
      return;
    }

    if (action.type === 'character' && state.menuStep === 'character') {
      if (action.value === 'mbappe' || action.value === 'juninho') {
        setLocalCharacter(action.value);
        state.menuStep = 'mode';
      }
      return;
    }

    if (action.type === 'mode' && state.menuStep === 'mode') {
      if (network.connected) {
        if (action.value === 1) {
          setMode(1);
        }
      } else if (action.value === 2 || action.value === 3 || action.value === 4) {
        setMode(action.value);
      }
      return;
    }

    if (action.type === 'start' && state.menuStep === 'mode') {
      startMatch();
    }
  }

  function handleKeyDown(event) {
    if (controlBindingTarget) {
      event.preventDefault();
      if (event.code === 'Escape') {
        controlBindingTarget = null;
        updateControlsUi();
        return;
      }
      if (event.code) {
        saveControl(controlBindingTarget, event.code);
        controlBindingTarget = null;
        updateControlsUi();
      }
      return;
    }
    if (event.repeat) return;
    if (chat.input && document.activeElement === chat.input) return;

    if (event.code === 'Tab') {
      event.preventDefault();
      lobby.tabOpen = true;
      return;
    }

    if (event.code === KEYS.fullscreen) {
      toggleFullscreen();
      return;
    }

    if (lobby.tabOpen) {
      if (event.code === 'KeyX' && lobby.localPlayerId) {
        event.preventDefault();
        exitPlayer(lobby.localPlayerId);
        return;
      }
      const digitMatch = event.code.match(/Digit(\d)/) || event.code.match(/Numpad(\d)/);
      if (digitMatch) {
        event.preventDefault();
        lobby.pickBuffer = `${lobby.pickBuffer}${digitMatch[1]}`.slice(-2);
        const pickNumber = Number(lobby.pickBuffer);
        const team = lobby.pick.turn;
        if (lobby.pick.active && lobby.localPlayerId === getCaptainId(team)) {
          if (pickSpectator(pickNumber, team)) {
            lobby.pickBuffer = '';
          }
        }
        return;
      }
    }

    if (state.mode === 'menu') {
      if (network.role === 'client') {
        if (event.code === KEYS.wide) {
          sendNetworkMessage({ type: 'menu_action', action: { type: 'field', value: 'wide' } });
        } else if (event.code === KEYS.medium) {
          sendNetworkMessage({ type: 'menu_action', action: { type: 'field', value: 'medium' } });
        } else if (event.code === KEYS.short) {
          sendNetworkMessage({ type: 'menu_action', action: { type: 'field', value: 'short' } });
        } else if (event.code === KEYS.mode2 || event.code === 'Numpad1') {
          if (state.menuStep === 'character') {
            sendNetworkMessage({ type: 'menu_action', action: { type: 'character', value: 'mbappe' } });
          } else {
            sendNetworkMessage({ type: 'menu_action', action: { type: 'mode', value: 1 } });
          }
        } else if (event.code === KEYS.mode3 || event.code === 'Numpad2') {
          if (state.menuStep === 'character') {
            sendNetworkMessage({ type: 'menu_action', action: { type: 'character', value: 'juninho' } });
          } else if (!network.connected) {
            sendNetworkMessage({ type: 'menu_action', action: { type: 'mode', value: 3 } });
          }
        } else if (event.code === KEYS.mode4 && !network.connected) {
          sendNetworkMessage({ type: 'menu_action', action: { type: 'mode', value: 4 } });
        } else if (event.code === KEYS.start) {
          sendNetworkMessage({ type: 'menu_action', action: { type: 'start' } });
        }
        return;
      }
      if (state.menuStep === 'field') {
        if (event.code === KEYS.wide) {
          applyMenuAction({ type: 'field', value: 'wide' });
        } else if (event.code === KEYS.medium) {
          applyMenuAction({ type: 'field', value: 'medium' });
        } else if (event.code === KEYS.short) {
          applyMenuAction({ type: 'field', value: 'short' });
        }
      } else if (state.menuStep === 'character') {
        if (event.code === KEYS.mode2 || event.code === 'Numpad1') {
          applyMenuAction({ type: 'character', value: 'mbappe' });
        } else if (event.code === KEYS.mode3 || event.code === 'Numpad2') {
          applyMenuAction({ type: 'character', value: 'juninho' });
        }
      } else if (state.menuStep === 'mode') {
        if (network.connected) {
          if (event.code === KEYS.mode2) {
            applyMenuAction({ type: 'mode', value: 1 });
          } else if (event.code === KEYS.start) {
            applyMenuAction({ type: 'start' });
          }
        } else if (event.code === KEYS.mode2) {
          applyMenuAction({ type: 'mode', value: 2 });
        } else if (event.code === KEYS.mode3) {
          applyMenuAction({ type: 'mode', value: 3 });
        } else if (event.code === KEYS.mode4) {
          applyMenuAction({ type: 'mode', value: 4 });
        } else if (event.code === KEYS.start) {
          applyMenuAction({ type: 'start' });
        }
      }
      return;
    }

    if (state.mode === 'playing') {
      if (event.code === KEYS.reset) {
        if (!network.webrtc.ready) {
          resetPositions();
        }
      }
    }
  }

  function handleKeyUp(event) {
    if (chat.input && document.activeElement === chat.input) return;
    if (event.code === 'Tab') {
      lobby.tabOpen = false;
      lobby.pickBuffer = '';
      return;
    }
  }

  function startCharge(player, type) {
    if (!player) return;
    const charge = player.charge[type];
    if (!charge || charge.active) return;
    charge.active = true;
    charge.time = 0;
  }

  function releaseCharge(player, type) {
    if (!player) return;
    const charge = player.charge[type];
    if (!charge || !charge.active) return;
    const time = charge.time;
    charge.active = false;
    charge.time = 0;
    attemptKick(player, type, time);
  }

  function attemptKick(player, type, chargeTime) {
    if (!player) return;
    const ball = state.ball;

    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const dist = Math.hypot(dx, dy);
    const reach = player.r + ball.r + 6;
    if (dist > reach) return;

    const angleSource = dist > 0.0001 ? { x: dx, y: dy } : player.facing;
    const facing = normalize(angleSource.x, angleSource.y);
    const desired = player.r + ball.r + 2;
    if (dist > 0.0001 && dist < desired) {
      const push = desired - dist;
      ball.x += facing.x * push;
      ball.y += facing.y * push;
    }

    if (type === 'ground') {
      if (ball.z > 1) return;
      const t = clamp(chargeTime / chargeConfig.ground.max, 0, 1);
      const speed = lerp(chargeConfig.ground.minSpeed, chargeConfig.ground.maxSpeed, t);
      ball.vx += facing.x * speed;
      ball.vy += facing.y * speed;
      ball.vz = 0;
      ball.z = 0;
      player.kickFlash = 0.15;
      triggerJuninhoCurve(player);
    } else if (type === 'air') {
      const t = clamp(chargeTime / chargeConfig.air.max, 0, 1);
      const forward = lerp(chargeConfig.air.minForward, chargeConfig.air.maxForward, t);
      const upward = lerp(chargeConfig.air.minUp, chargeConfig.air.maxUp, t);
      ball.vx += facing.x * forward;
      ball.vy += facing.y * forward;
      ball.vz = Math.max(ball.vz, upward);
      ball.z = Math.max(ball.z, 1);
      player.kickFlash = 0.15;
      triggerJuninhoCurve(player);
    }
  }

  function updateCharge(player, dt) {
    Object.keys(player.charge).forEach((key) => {
      const charge = player.charge[key];
      if (!charge.active) return;
      const maxTime = chargeConfig[key].max;
      charge.time = Math.min(maxTime, charge.time + dt);
    });
  }

  function updatePlayer(player, keySet, dt) {
    if (!player) return;

    // 1. Skill update
    if (player.ability.mbappeBoostTime > 0) {
      player.ability.mbappeBoostTime = Math.max(0, player.ability.mbappeBoostTime - dt);
    }
    if (player.ability.mbappeCooldown > 0) {
      player.ability.mbappeCooldown = Math.max(0, player.ability.mbappeCooldown - dt);
    }
    if (player.ability.juninhoCooldown > 0) {
      player.ability.juninhoCooldown = Math.max(0, player.ability.juninhoCooldown - dt);
    }

    // 2. Input-based Skill activation
    const skillKey = keySet.has(KEYS.skill);
    if (skillKey && !player.lastSkillKeyDown) {
      tryActivateMbappeSkill(player);
    }
    player.lastSkillKeyDown = skillKey;

    // 3. Movement input
    let ax = 0;
    let ay = 0;
    if (keySet.has(KEYS.up) || keySet.has('ArrowUp')) ay -= 1;
    if (keySet.has(KEYS.down) || keySet.has('ArrowDown')) ay += 1;
    if (keySet.has(KEYS.left) || keySet.has('ArrowLeft')) ax -= 1;
    if (keySet.has(KEYS.right) || keySet.has('ArrowRight')) ax += 1;

    if (ax !== 0 || ay !== 0) {
      const dir = normalize(ax, ay);
      const accelBoost = player.ability.mbappeBoostTime > 0 ? 1.15 : 1;
      player.vx += dir.x * physics.playerAccel * accelBoost * dt;
      player.vy += dir.y * physics.playerAccel * accelBoost * dt;
      player.facing = { x: dir.x, y: dir.y };
    }

    // 4. Input-based Charging and Kicking
    const groundKey = keySet.has(KEYS.groundKick);
    if (groundKey) {
      if (!player.charge.ground.active) {
        player.charge.ground.active = true;
        player.charge.ground.time = 0;
      }
      player.charge.ground.time = Math.min(chargeConfig.ground.max, player.charge.ground.time + dt);
    } else if (player.charge.ground.active) {
      attemptKick(player, 'ground', player.charge.ground.time);
      player.charge.ground.active = false;
      player.charge.ground.time = 0;
    }

    const airKey = keySet.has(KEYS.airKick);
    if (airKey) {
      if (!player.charge.air.active) {
        player.charge.air.active = true;
        player.charge.air.time = 0;
      }
      player.charge.air.time = Math.min(chargeConfig.air.max, player.charge.air.time + dt);
    } else if (player.charge.air.active) {
      attemptKick(player, 'air', player.charge.air.time);
      player.charge.air.active = false;
      player.charge.air.time = 0;
    }

    // 5. Physics integration
    const damp = Math.exp(-physics.playerDamp * dt);
    player.vx *= damp;
    player.vy *= damp;

    const speed = vecLength(player.vx, player.vy);
    const maxSpeed = physics.playerMaxSpeed * (player.ability.mbappeBoostTime > 0 ? 1.15 : 1);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      player.vx *= scale;
      player.vy *= scale;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    keepPlayerInBounds(player);
  }

  function keepPlayerInBounds(player) {
    const f = state.field;
    player.x = clamp(player.x, f.left + player.r, f.right - player.r);
    player.y = clamp(player.y, f.top + player.r, f.bottom - player.r);
  }

  function resolvePlayerBallCollision(player) {
    const ball = state.ball;
    if (ball.z > 1) return;

    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const dist = Math.hypot(dx, dy);
    const minDist = player.r + ball.r;
    if (dist >= minDist || dist < 0.0001) return;

    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;

    ball.x += nx * overlap;
    ball.y += ny * overlap;

    ball.vx += nx * 60 + player.vx * 0.35;
    ball.vy += ny * 60 + player.vy * 0.35;
  }

  function resolvePlayerPlayerCollision(a, b) {
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const minDist = a.r + b.r;
    if (dist >= minDist || dist < 0.0001) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;
    const push = overlap / 2;
    a.x -= nx * push;
    a.y -= ny * push;
    b.x += nx * push;
    b.y += ny * push;
    const avx = a.vx;
    const avy = a.vy;
    const bvx = b.vx;
    const bvy = b.vy;
    const avn = avx * nx + avy * ny;
    const bvn = bvx * nx + bvy * ny;
    const impulse = (bvn - avn) * 0.9;
    a.vx += impulse * nx;
    a.vy += impulse * ny;
    b.vx -= impulse * nx;
    b.vy -= impulse * ny;
    keepPlayerInBounds(a);
    keepPlayerInBounds(b);
  }

  function updateBall(dt) {
    const ball = state.ball;
    const f = state.field;

    if (ball.curveTime > 0) {
      const curveRatio = ball.curveTime / 1.4; // Corrected to match new curveTime
      ball.vx += ball.curveX * ball.curveForce * curveRatio * dt;
      ball.vy += ball.curveY * ball.curveForce * curveRatio * dt;
      ball.curveTime = Math.max(0, ball.curveTime - dt);
      if (ball.curveTime === 0) {
        ball.curveX = 0;
        ball.curveY = 0;
        ball.curveForce = 0;
      }
    }

    const airDamp = Math.exp(-physics.ballAirDamp * dt);
    ball.vx *= airDamp;
    ball.vy *= airDamp;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.z > 0 || ball.vz > 0) {
      ball.vz -= physics.gravity * dt;
      ball.z += ball.vz * dt;
      if (ball.z <= 0) {
        ball.z = 0;
        if (Math.abs(ball.vz) > 60) {
          ball.vz = -ball.vz * 0.22;
        } else {
          ball.vz = 0;
        }
      }
    }

    if (ball.z === 0) {
      const groundDamp = Math.exp(-physics.ballDamp * dt);
      ball.vx *= groundDamp;
      ball.vy *= groundDamp;
    }

    const goalTop = f.centerY - f.goalWidth / 2;
    const goalBottom = f.centerY + f.goalWidth / 2;
    
    // Genişletilmiş kale ağzı kontrolü (top kaleye girmeden önce de düşmeye başlasın diye)
    const extendedGoalTop = goalTop - ball.r * 2;
    const extendedGoalBottom = goalBottom + ball.r * 2;
    const inExtendedGoalMouth = ball.y > extendedGoalTop && ball.y < extendedGoalBottom;
    
    // Düşüş bölgesini (goalDropZone) çok daha geniş tutuyoruz
    const goalDropZone = Math.max(ball.r * 15, f.width * 0.3); // Sahanın %30'una kadar etkili
    
    const leftDistance = ball.x - f.left;
    const rightDistance = f.right - ball.x;
    
    const leftApproach = inExtendedGoalMouth && ball.vx < 0 && leftDistance <= goalDropZone;
    const rightApproach = inExtendedGoalMouth && ball.vx > 0 && rightDistance <= goalDropZone;
    
    if (ball.z > 0 && (leftApproach || rightApproach)) {
      const targetDistance = leftApproach ? leftDistance : rightDistance;
      // Top kaleye yaklaştıkça çarpan artar (1'e yaklaşır)
      const approachFactor = 1 - clamp(targetDistance / goalDropZone, 0, 1);
      
      // Çok daha agresif bir düşüş kuvveti uyguluyoruz
      // Normal yerçekiminin (900) çok üstünde bir kuvvet (örn: 5000-10000 arası)
      const dropForce = 8000 * approachFactor;
      ball.vz -= dropForce * dt;
      
      // Eğer top çok yüksekteyse ve kaleye çok yakınsa, direkt aşağı doğru hızlandır
      if (targetDistance < ball.r * 4 && ball.z > ball.r) {
         ball.vz -= 15000 * dt;
      }
    }

    const inGoalMouth = ball.y > goalTop && ball.y < goalBottom;
    const canScore = ball.z <= ball.r * 0.9;
    if (canScore && inGoalMouth && ball.x - ball.r <= f.left) {
      state.score.red += 1;
      state.freeze = 1.1;
      resetPositions();
      return 'red';
    }
    if (canScore && inGoalMouth && ball.x + ball.r >= f.right) {
      state.score.blue += 1;
      state.freeze = 1.1;
      resetPositions();
      return 'blue';
    }

    if (ball.y - ball.r < f.top) {
      ball.y = f.top + ball.r;
      ball.vy = Math.abs(ball.vy) * physics.ballBounce;
    }
    if (ball.y + ball.r > f.bottom) {
      ball.y = f.bottom - ball.r;
      ball.vy = -Math.abs(ball.vy) * physics.ballBounce;
    }

    if (ball.x - ball.r < f.left) {
      ball.x = f.left + ball.r;
      ball.vx = Math.abs(ball.vx) * physics.ballBounce;
    }

    if (ball.x + ball.r > f.right) {
      ball.x = f.right - ball.r;
      ball.vx = -Math.abs(ball.vx) * physics.ballBounce;
    }
    return null;
  }

  function checkGoal() {
    const ball = state.ball;
    const f = state.field;
    if (ball.z > ball.r * 0.9) return false;

    const goalTop = f.centerY - f.goalWidth / 2;
    const goalBottom = f.centerY + f.goalWidth / 2;
    const inGoalMouth = ball.y > goalTop && ball.y < goalBottom;

    if (ball.x - ball.r <= f.left && inGoalMouth) {
      state.score.red += 1;
      state.freeze = 1.1;
      resetPositions();
      return true;
    }

    if (ball.x + ball.r >= f.right && inGoalMouth) {
      state.score.blue += 1;
      state.freeze = 1.1;
      resetPositions();
      return true;
    }

    return false;
  }

  function update(dt, localKeys, remoteKeys) {
    if (state.mode !== 'playing') return;

    if (state.freeze > 0) {
      state.freeze = Math.max(0, state.freeze - dt);
      return;
    }

    // In lockstep or host mode, both sides run match timer
    if (!state.match.overtime) {
      state.match.time = Math.max(0, state.match.time - dt);
      if (state.match.time === 0) {
        if (state.score.blue !== state.score.red) {
          // Match end logic would go here
        } else {
          state.match.overtime = true;
        }
      }
    }

    const hostPlayer = state.players['host'];
    const guestPlayer = state.players['guest'];

    let lKeys = localKeys || input.keys;
    let rKeys = remoteKeys || network.remoteKeys;

    // Ensure we have Set objects for .has()
    if (Array.isArray(lKeys)) lKeys = new Set(lKeys);
    if (Array.isArray(rKeys)) rKeys = new Set(rKeys);

    const hostKeys = network.role === 'host' ? lKeys : rKeys;
    const guestKeys = network.role === 'client' ? lKeys : rKeys;

    if (hostPlayer) {
      updatePlayer(hostPlayer, hostKeys, dt);
    }
    if (guestPlayer) {
      updatePlayer(guestPlayer, guestKeys, dt);
    }

    const goalResult = updateBall(dt);

    state.playerOrder.forEach((player) => {
      resolvePlayerBallCollision(player);
    });
    if (hostPlayer && guestPlayer) {
      resolvePlayerPlayerCollision(hostPlayer, guestPlayer);
    }

    if (goalResult) {
      if (state.match.overtime) {
        resetMatch();
        return;
      }
    }

    state.playerOrder.forEach((player) => {
      if (player.kickFlash > 0) {
        player.kickFlash = Math.max(0, player.kickFlash - dt);
      }
    });
  }

  function applyClientSmoothing(dt) {
    if (network.role !== 'client' || !network.clientSmoothingReady) return;
    const buffer = network.snapshotBuffer;
    if (!buffer.length) return;

    const now = performance.now();
    const renderTime = now - network.snapshotDelay;
    while (buffer.length >= 2 && buffer[1].time <= renderTime) {
      buffer.shift();
    }

    const older = buffer[0];
    const newer = buffer[1];
    if (!older) return;

    const t = newer
      ? clamp((renderTime - older.time) / Math.max(1, newer.time - older.time), 0, 1)
      : 0;

    const f = state.field;
    const hasBounds = Number.isFinite(f.left)
      && Number.isFinite(f.right)
      && Number.isFinite(f.top)
      && Number.isFinite(f.bottom)
      && f.right > f.left
      && f.bottom > f.top;

    const interpBall = (() => {
      const a = older.state.ball;
      if (!a) return null;
      if (!newer || !newer.state.ball) return a;
      const b = newer.state.ball;
      return {
        r: lerp(a.r, b.r, t),
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        vx: lerp(a.vx, b.vx, t),
        vy: lerp(a.vy, b.vy, t),
        z: lerp(a.z, b.z, t),
        vz: lerp(a.vz, b.vz, t),
        curveTime: b.curveTime ?? a.curveTime,
        curveX: b.curveX ?? a.curveX,
        curveY: b.curveY ?? a.curveY,
        curveForce: lerp(a.curveForce, b.curveForce, t),
      };
    })();

    if (interpBall) {
      state.ball.r = interpBall.r;
      state.ball.x = interpBall.x;
      state.ball.y = interpBall.y;
      state.ball.vx = interpBall.vx;
      state.ball.vy = interpBall.vy;
      state.ball.z = interpBall.z;
      state.ball.vz = interpBall.vz;
      state.ball.curveTime = interpBall.curveTime;
      state.ball.curveX = interpBall.curveX;
      state.ball.curveY = interpBall.curveY;
      state.ball.curveForce = interpBall.curveForce;
      if (hasBounds) {
        state.ball.x = clamp(state.ball.x, f.left + state.ball.r, f.right - state.ball.r);
        state.ball.y = clamp(state.ball.y, f.top + state.ball.r, f.bottom - state.ball.r);
      }
    }

    const authLocal = network.snapshotTargets.players[state.localPlayerId];
    if (authLocal) {
      const local = getLocalPlayer();
      if (local) {
        const dx = authLocal.x - local.x;
        const dy = authLocal.y - local.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 50) {
          local.x = authLocal.x;
          local.y = authLocal.y;
        } else if (dist > 2) {
          local.x += dx * 0.1;
          local.y += dy * 0.1;
        }
        local.r = authLocal.r;
      }
    }

    state.playerOrder.forEach((player) => {
      if (player.id === state.localPlayerId) return;
      const a = older.state.players[player.id];
      if (!a) return;
      const b = newer?.state.players[player.id] || a;
      player.r = lerp(a.r, b.r, t);
      player.x = lerp(a.x, b.x, t);
      player.y = lerp(a.y, b.y, t);
      player.vx = lerp(a.vx, b.vx, t);
      player.vy = lerp(a.vy, b.vy, t);
      player.facing = normalize(
        lerp(a.facing.x, b.facing.x, t),
        lerp(a.facing.y, b.facing.y, t),
      );
      if (hasBounds) {
        player.x = clamp(player.x, f.left + player.r, f.right - player.r);
        player.y = clamp(player.y, f.top + player.r, f.bottom - player.r);
      }
    });
  }

  function drawField() {
    const f = state.field;
    const gradient = ctx.createLinearGradient(0, f.top, 0, f.bottom);
    gradient.addColorStop(0, COLORS.pitchLight);
    gradient.addColorStop(1, COLORS.pitchDark);

    ctx.fillStyle = gradient;
    ctx.fillRect(f.left, f.top, f.width, f.height);

    ctx.strokeStyle = COLORS.pitchBorder;
    ctx.lineWidth = 6;
    ctx.strokeRect(f.left, f.top, f.width, f.height);

    ctx.strokeStyle = COLORS.pitchLine;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(f.centerX, f.top);
    ctx.lineTo(f.centerX, f.bottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(f.centerX, f.centerY, f.height * 0.16, 0, Math.PI * 2);
    ctx.stroke();

    const goalTop = f.centerY - f.goalWidth / 2;
    const goalBottom = f.centerY + f.goalWidth / 2;

    ctx.fillStyle = COLORS.goalNet;
    ctx.fillRect(f.left - f.goalDepth, goalTop, f.goalDepth, f.goalWidth);
    ctx.fillRect(f.right, goalTop, f.goalDepth, f.goalWidth);

    ctx.strokeStyle = COLORS.goalFrame;
    ctx.lineWidth = 3;
    ctx.strokeRect(f.left - f.goalDepth, goalTop, f.goalDepth, f.goalWidth);
    ctx.strokeRect(f.right, goalTop, f.goalDepth, f.goalWidth);
  }

  function drawPlayer(player, color, showFacing) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (showFacing) {
      const facing = normalize(player.facing.x, player.facing.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(player.x, player.y);
      ctx.lineTo(player.x + facing.x * player.r * 1.5, player.y + facing.y * player.r * 1.5);
      ctx.stroke();
    }
  }

  function drawBall() {
    const ball = state.ball;
    const shadowScale = clamp(1 - ball.z / 260, 0.55, 1);
    const shadowAlpha = clamp(0.35 - ball.z / 600, 0.08, 0.35);

    ctx.fillStyle = `rgba(0,0,0,${shadowAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y, ball.r * shadowScale, ball.r * shadowScale * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawY = ball.y - ball.z * 0.18;
    const drawR = ball.r * clamp(1 - ball.z / 400, 0.65, 1);

    ctx.fillStyle = COLORS.ball;
    ctx.beginPath();
    ctx.arc(ball.x, drawY, drawR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(60,60,60,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawChargeRing(player) {
    const ground = player.charge.ground;
    const air = player.charge.air;

    if (!ground.active && !air.active) return;

    let progress = 0;
    let color = 'rgba(255,255,255,0.6)';

    if (ground.active) {
      progress = ground.time / chargeConfig.ground.max;
      color = 'rgba(255,255,255,0.75)';
    }

    if (air.active) {
      progress = air.time / chargeConfig.air.max;
      color = 'rgba(255,240,200,0.8)';
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }

  function drawScore() {
    ctx.fillStyle = COLORS.uiText;
    ctx.font = '700 24px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`Blue ${state.score.blue} - ${state.score.red} Red`, state.view.w / 2, 18);
    ctx.font = '600 18px "Trebuchet MS", sans-serif';
    const timeSeconds = Math.max(0, Math.ceil(state.match.time));
    const minutes = Math.floor(timeSeconds / 60);
    const seconds = timeSeconds % 60;
    const timeLabel = state.match.overtime ? 'Uzatma' : `${minutes}:${String(seconds).padStart(2, '0')}`;
    ctx.fillText(timeLabel, state.view.w / 2, 46);
    const local = getLocalPlayer();
    if (local) {
      ctx.font = '600 14px "Trebuchet MS", sans-serif';
      const skillLabel = formatKeyLabel(controls.skill);
      let abilityText = `Karakter: ${local.character}`;
      if (local.character === 'mbappe') {
        const remaining = Math.ceil(local.ability.mbappeCooldown);
        abilityText = `${abilityText} | ${skillLabel} hiz skill: ${remaining > 0 ? `${remaining}s` : 'hazir'}`;
      } else {
        const remaining = Math.ceil(local.ability.juninhoCooldown);
        abilityText = `${abilityText} | Falso ozellik: ${remaining > 0 ? `${remaining}s` : 'hazir'}`;
      }
      ctx.fillText(abilityText, state.view.w / 2, 68);
    }
  }

  function drawMenu() {
    ctx.clearRect(0, 0, state.view.w, state.view.h);
    drawField();

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(state.view.w * 0.18, state.view.h * 0.18, state.view.w * 0.64, state.view.h * 0.64);

    ctx.strokeStyle = 'rgba(22,48,33,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(state.view.w * 0.18, state.view.h * 0.18, state.view.w * 0.64, state.view.h * 0.64);

    ctx.fillStyle = COLORS.uiText;
    ctx.font = '700 42px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Osimhen Ball', state.view.w / 2, state.view.h * 0.22);

    ctx.fillStyle = COLORS.uiSub;
    ctx.font = '600 20px "Trebuchet MS", sans-serif';
    const groundKeyLabel = formatKeyLabel(controls.groundKick);
    const airKeyLabel = formatKeyLabel(controls.airKick);
    const skillKeyLabel = formatKeyLabel(controls.skill);
    ctx.fillText(`WASD hareket | ${groundKeyLabel} yerden sut/pas | ${airKeyLabel} havadan pas`, state.view.w / 2, state.view.h * 0.30);
    ctx.fillText(`${groundKeyLabel}/${airKeyLabel} ne kadar uzun basarsan o kadar guclu.`, state.view.w / 2, state.view.h * 0.34);
    ctx.fillText(`${skillKeyLabel} karakter ozelinde kullanilir | F fullscreen | R reset`, state.view.w / 2, state.view.h * 0.38);

    ctx.font = '700 22px "Trebuchet MS", sans-serif';
    if (state.menuStep === 'field') {
      ctx.fillText('Saha Secimi (4-6)', state.view.w / 2, state.view.h * 0.46);
    } else if (state.menuStep === 'character') {
      ctx.fillText('Karakter Secimi (1-2)', state.view.w / 2, state.view.h * 0.46);
    } else {
      const selectedLabel = state.selectedCharacter === 'mbappe' ? 'Mbappe' : 'Juninho';
      ctx.fillText(`Karakter Secildi: ${selectedLabel}`, state.view.w / 2, state.view.h * 0.46);
    }

    let options = [];
    if (state.menuStep === 'field') {
      options = [
        { id: 'short', label: '4 - Kucuk' },
        { id: 'medium', label: '5 - Orta' },
        { id: 'wide', label: '6 - Buyuk' },
      ];
    } else if (state.menuStep === 'character') {
      options = [
        { id: 'mbappe', label: '1 - Mbappe' },
        { id: 'juninho', label: '2 - Juninho' },
      ];
    } else {
      options = network.connected
        ? [{ id: 'mode1', label: '1 - 1v1' }]
        : [
            { id: 'mode2', label: '1 - 2v2' },
            { id: 'mode3', label: '2 - 3v3' },
            { id: 'mode4', label: '3 - 4v4' },
          ];
    }

    const startY = state.view.h * 0.52;
    const boxW = state.view.w * 0.18;
    const boxH = 44;
    const gap = 20;
    const totalW = boxW * options.length + gap * (options.length - 1);
    let x = state.view.w / 2 - totalW / 2;

    options.forEach((opt) => {
      const isActive = state.menuStep === 'field'
        ? state.fieldType === opt.id
        : (state.menuStep === 'character'
          ? state.selectedCharacter === opt.id
          : (opt.id === 'mode1' ? lobby.mode === 1 : lobby.mode === Number(opt.id.replace('mode', ''))));
      ctx.fillStyle = isActive ? 'rgba(58,120,255,0.2)' : 'rgba(22,48,33,0.06)';
      ctx.fillRect(x, startY, boxW, boxH);
      ctx.strokeStyle = isActive ? COLORS.blue : 'rgba(22,48,33,0.18)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, startY, boxW, boxH);

      ctx.fillStyle = COLORS.uiText;
      ctx.font = '600 18px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opt.label, x + boxW / 2, startY + boxH / 2);

      x += boxW + gap;
    });

    ctx.fillStyle = COLORS.uiText;
    ctx.font = '700 22px "Trebuchet MS", sans-serif';
    ctx.textBaseline = 'top';
    if (state.menuStep === 'mode') {
      ctx.fillText(network.connected ? 'Mod: 1v1 (1)' : 'Mod Secimi (1-3)', state.view.w / 2, state.view.h * 0.62);
      ctx.fillText('Enter ile basla', state.view.w / 2, state.view.h * 0.68);
    } else if (state.menuStep === 'character') {
      ctx.fillText('Mbappe: C ile 4sn hiz +%15 (15sn bekleme)', state.view.w / 2, state.view.h * 0.62);
      ctx.fillText('Juninho: sut/pasta WASD yonlu falso (10sn bekleme)', state.view.w / 2, state.view.h * 0.68);
    } else {
      ctx.fillText('Secim sonrasi mod ekrani acilir', state.view.w / 2, state.view.h * 0.62);
    }

    ctx.font = '500 16px "Trebuchet MS", sans-serif';
    ctx.fillStyle = 'rgba(22,48,33,0.7)';
    const netText = network.connected
      ? (network.role === 'host' ? 'Online: Ev sahibi' : 'Online: Misafir')
      : 'Sunucuya baglaniliyor...';
    ctx.fillText(netText, state.view.w / 2, state.view.h * 0.74);
  }

  function drawTabMenu() {
    const panelW = state.view.w * 0.78;
    const panelH = state.view.h * 0.72;
    const x = (state.view.w - panelW) / 2;
    const y = (state.view.h - panelH) / 2;
    const columnGap = 24;
    const columnW = (panelW - columnGap * 2) / 3;

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = 'rgba(22,48,33,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, panelW, panelH);

    ctx.fillStyle = COLORS.uiText;
    ctx.font = '700 24px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('TAB Menusu', state.view.w / 2, y + 12);

    const redX = x + columnW / 2;
    const blueX = x + columnW + columnGap + columnW / 2;
    const specX = x + columnW * 2 + columnGap * 2 + columnW / 2;
    const listTop = y + 56;

    ctx.font = '700 18px "Trebuchet MS", sans-serif';
    ctx.fillStyle = COLORS.red;
    ctx.fillText(`Kirmizi (${lobby.teams.red.length}/${lobby.mode})`, redX, listTop);
    ctx.fillStyle = COLORS.blue;
    ctx.fillText(`Mavi (${lobby.teams.blue.length}/${lobby.mode})`, blueX, listTop);
    ctx.fillStyle = COLORS.uiText;
    ctx.fillText(`Spectator (${lobby.spectators.length})`, specX, listTop);

    ctx.font = '600 16px "Trebuchet MS", sans-serif';
    ctx.fillStyle = COLORS.uiText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const lineHeight = 22;
    const redCaptain = getCaptainId('red');
    const blueCaptain = getCaptainId('blue');

    lobby.teams.red.forEach((id, index) => {
      const name = lobby.players[id]?.name || id;
      const label = id === redCaptain ? `${name} (K)` : name;
      ctx.fillText(label, redX, listTop + 30 + index * lineHeight);
    });

    lobby.teams.blue.forEach((id, index) => {
      const name = lobby.players[id]?.name || id;
      const label = id === blueCaptain ? `${name} (K)` : name;
      ctx.fillText(label, blueX, listTop + 30 + index * lineHeight);
    });

    lobby.spectators.forEach((id, index) => {
      const name = lobby.players[id]?.name || id;
      ctx.fillText(`${index + 1}. ${name}`, specX, listTop + 30 + index * lineHeight);
    });

    ctx.fillStyle = COLORS.uiSub;
    ctx.font = '600 16px "Trebuchet MS", sans-serif';
    const infoY = y + panelH - 60;
    let infoText = 'TAB: liste | X: exit';
    if (lobby.pick.active) {
      const teamName = lobby.pick.turn === 'red' ? 'Kirmizi' : 'Mavi';
      infoText = `${infoText} | Pick sirasi: ${teamName} kaptan`;
    }
    if (lobby.pickBuffer) {
      infoText = `${infoText} | Secim: ${lobby.pickBuffer}`;
    }
    ctx.fillText(infoText, state.view.w / 2, infoY);
  }

  function render() {
    ctx.clearRect(0, 0, state.view.w, state.view.h);

    if (state.mode === 'menu') {
      drawMenu();
      if (lobby.tabOpen) {
        drawTabMenu();
      }
      return;
    }

    drawField();
    drawScore();

    drawBall();
    state.playerOrder.forEach((player) => {
      if (!player) return;
      drawPlayer(player, player.color, false);
      drawChargeRing(player);
      if (player.kickFlash > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.r + 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    if (state.freeze > 0) {
      ctx.fillStyle = 'rgba(22,48,33,0.65)';
      ctx.font = '700 36px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GOAL!', state.view.w / 2, state.view.h * 0.14);
    }

    if (lobby.tabOpen) {
      drawTabMenu();
    }
  }

  function tryLockstepTick() {
    const tick = network.lockstep.currentTick;
    
    // 1. Buffering local input for this tick if not already there
    if (!network.lockstep.inputBuffer[tick]) {
      network.lockstep.inputBuffer[tick] = { local: null, remote: null };
    }
    if (network.lockstep.inputBuffer[tick].local === null) {
      network.lockstep.inputBuffer[tick].local = buildNetworkInputKeys();
    }

    // 2. Check if we have both inputs
    const buf = network.lockstep.inputBuffer[tick];
    if (buf.local !== null && buf.remote !== null) {
      // Run the simulation step
      updateLockstep(FIXED_SIM_STEP, buf.local, buf.remote);
      
      // Cleanup and advance
      delete network.lockstep.inputBuffer[tick];
      network.lockstep.currentTick++;
      return true;
    }
    return false;
  }

  function updateLockstep(dt, localKeys, remoteKeys) {
    // This replaces the old update logic but ensures it uses the provided keys
    // instead of global input state or network.remoteKeys
    
    // Temporary swap of keys to reuse existing logic
    const oldLocalKeys = input.keys;
    const oldRemoteKeys = network.remoteKeys;
    
    // In lockstep, we need to know which player is which.
    // Let's assume player1 is always host and player2 is client for simulation purposes.
    // The keys need to be applied to the correct player state.
    
    // TODO: Implement deterministic update
    update(dt, localKeys, remoteKeys);
  }

  function sendLocalInput() {
    if (!network.webrtc.ready) return;
    
    // We send input for currentTick + delay to account for RTT
    const targetTick = network.lockstep.currentTick + network.lockstep.inputDelay;
    const keys = buildNetworkInputKeys();
    
    // Buffer it locally too
    if (!network.lockstep.inputBuffer[targetTick]) {
      network.lockstep.inputBuffer[targetTick] = { local: null, remote: null };
    }
    network.lockstep.inputBuffer[targetTick].local = keys;
    
    sendP2PMessage({ type: 'lockstep_input', tick: targetTick, keys: [...keys] });
  }

  function tick(now) {
    if (!manualTime) {
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      fixedStepAccumulator += dt;
      
      // Send input ahead of time
      sendLocalInput();

      let steps = 0;
      if (network.webrtc.ready) {
        // Lockstep mode: Simulation advances only when both inputs are ready
        while (fixedStepAccumulator >= FIXED_SIM_STEP && steps < MAX_SIM_STEPS_PER_FRAME) {
          if (tryLockstepTick()) {
            fixedStepAccumulator -= FIXED_SIM_STEP;
            steps += 1;
          } else {
            // Wait for remote input - effectively "pausing" if lag is too high
            break; 
          }
        }
      } else {
        // Fallback to old snapshot mode while waiting for P2P
        while (fixedStepAccumulator >= FIXED_SIM_STEP && steps < MAX_SIM_STEPS_PER_FRAME) {
          update(FIXED_SIM_STEP, null, null);
          fixedStepAccumulator -= FIXED_SIM_STEP;
          steps += 1;
        }
        applyClientSmoothing(dt);
      }
      
      if (steps === MAX_SIM_STEPS_PER_FRAME) {
        fixedStepAccumulator = 0;
      }
      render();
    }
    requestAnimationFrame(tick);
  }

  window.advanceTime = (ms) => {
    manualTime = true;
    const step = FIXED_SIM_STEP;
    const steps = Math.max(1, Math.round(ms / (step * 1000)));
    for (let i = 0; i < steps; i += 1) {
      update(step);
    }
    render();
    lastTime = performance.now();
    fixedStepAccumulator = 0;
  };

  window.render_game_to_text = () => {
    const payload = {
      mode: state.mode,
      fieldType: state.fieldType,
      coords: 'origin top-left, +x right, +y down, z is height',
      score: state.score,
      freeze: Number(state.freeze.toFixed(2)),
      match: {
        duration: state.match.duration,
        time: Number(state.match.time.toFixed(2)),
        overtime: state.match.overtime,
      },
      players: state.playerOrder.map((player) => ({
        id: player.id,
        name: player.name,
        x: Number(player.x.toFixed(2)),
        y: Number(player.y.toFixed(2)),
        vx: Number(player.vx.toFixed(2)),
        vy: Number(player.vy.toFixed(2)),
        r: player.r,
        facing: {
          x: Number(player.facing.x.toFixed(2)),
          y: Number(player.facing.y.toFixed(2)),
        },
        charge: {
          ground: {
            active: player.charge.ground.active,
            time: Number(player.charge.ground.time.toFixed(2)),
          },
          air: {
            active: player.charge.air.active,
            time: Number(player.charge.air.time.toFixed(2)),
          },
        },
      })),
      lobby: {
        mode: lobby.mode,
        started: lobby.started,
        teams: {
          red: lobby.teams.red.map((id) => lobby.players[id]?.name || id),
          blue: lobby.teams.blue.map((id) => lobby.players[id]?.name || id),
        },
        spectators: lobby.spectators.map((id) => lobby.players[id]?.name || id),
        pick: lobby.pick.active ? lobby.pick.turn : null,
      },
      ball: {
        x: Number(state.ball.x.toFixed(2)),
        y: Number(state.ball.y.toFixed(2)),
        z: Number(state.ball.z.toFixed(2)),
        vx: Number(state.ball.vx.toFixed(2)),
        vy: Number(state.ball.vy.toFixed(2)),
        vz: Number(state.ball.vz.toFixed(2)),
        r: state.ball.r,
      },
      field: {
        left: Number(state.field.left.toFixed(2)),
        right: Number(state.field.right.toFixed(2)),
        top: Number(state.field.top.toFixed(2)),
        bottom: Number(state.field.bottom.toFixed(2)),
        goalWidth: Number(state.field.goalWidth.toFixed(2)),
        goalDepth: Number(state.field.goalDepth.toFixed(2)),
      },
    };
    return JSON.stringify(payload);
  };

  document.addEventListener('keydown', (event) => {
    if (chat.input && document.activeElement === chat.input) return;
    input.keys.add(event.code);
    handleKeyDown(event);
  });

  document.addEventListener('keyup', (event) => {
    input.keys.delete(event.code);
    handleKeyUp(event);
  });

  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('fullscreenchange', resizeCanvas);

  setupPlayers('Sen', 'Rakip');
  resetLobbyForPlayers('Sen', 'Rakip');
  initChat();
  initControlsPanel();
  resizeCanvas();
  requestAnimationFrame(tick);
  connectNetwork();
  window.haxServer = {
    join: (name) => joinPlayer(name || `Oyuncu ${lobby.playerCounter + 1}`),
    exit: (id) => exitPlayer(id),
    disconnect: (id) => disconnectPlayer(id),
    reconnect: (id) => reconnectPlayer(id),
    endMatch: (winnerTeam) => endMatch(winnerTeam),
    pick: (number, team) => pickSpectator(number, team || lobby.pick.turn),
    setMode: (mode) => setMode(mode),
    state: () => ({
      mode: lobby.mode,
      teams: lobby.teams,
      spectators: lobby.spectators,
      players: lobby.players,
      pick: lobby.pick,
    }),
  };
})();
