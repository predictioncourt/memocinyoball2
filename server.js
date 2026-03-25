const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// --- Physics Constants (Synced with Client) ---
const PHYSICS = {
  playerAccel: 1550,
  playerMaxSpeed: 290,
  playerDamp: 8.5,
  ballDamp: 2.6,
  ballAirDamp: 0.4,
  ballBounce: 0.82,
  gravity: 900,
  worldScale: 1,
};

const CHARGE_CONFIG = {
  ground: { max: 2.8, minSpeed: 520, maxSpeed: 2200 },
  air: { max: 1.6, minForward: 200, maxForward: 560, minUp: 260, maxUp: 520 },
};

const FIELD_BASE = { width: 1120, height: 600 };
const TICK_RATE = 60;
const DT = 1 / TICK_RATE;

// --- Helper Functions ---
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function normalize(x, y) {
  const len = Math.hypot(x, y);
  return len > 0.0001 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

// --- Room Class ---
class Room {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.clients = new Map(); // id -> ws
    this.state = this.createInitialState();
    this.playerInputs = new Map(); // id -> Set of keys
    this.timer = null;
    this.tickCount = 0;
  }

  createInitialState() {
    return {
      mode: 'playing',
      score: { blue: 0, red: 0 },
      freeze: 0,
      match: { time: 120, duration: 120, overtime: false },
      ball: { x: 560, y: 300, vx: 0, vy: 0, z: 0, vz: 0, r: 10, curveTime: 0, curveX: 0, curveY: 0, curveForce: 0 },
      players: {}, // id -> state
      field: { left: 50, right: 1070, top: 50, bottom: 550, centerX: 560, centerY: 300, width: 1020, height: 500, goalWidth: 180 },
    };
  }

  addPlayer(id, name, ws) {
    this.clients.set(id, ws);
    const isBlue = this.clients.size % 2 !== 0;
    this.state.players[id] = {
      id, name,
      color: isBlue ? '#3a78ff' : '#ff4d4d',
      team: isBlue ? 'blue' : 'red',
      character: 'mbappe',
      x: isBlue ? 200 : 920, y: 300, vx: 0, vy: 0, r: 18,
      facing: { x: isBlue ? 1 : -1, y: 0 },
      charge: { ground: { active: false, time: 0 }, air: { active: false, time: 0 } },
      ability: { mbappeBoostTime: 0, mbappeCooldown: 0, juninhoCooldown: 0 },
      kickFlash: 0,
      lastSkillKeyDown: false,
    };
    this.playerInputs.set(id, new Set());
    
    if (this.clients.size >= 1 && !this.timer) {
      this.startLoop();
    }
  }

  removePlayer(id) {
    this.clients.delete(id);
    delete this.state.players[id];
    this.playerInputs.delete(id);
    if (this.clients.size === 0) {
      this.stopLoop();
    }
  }

  startLoop() {
    this.timer = setInterval(() => this.update(), 1000 / TICK_RATE);
  }

  stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  update() {
    const s = this.state;
    if (s.freeze > 0) {
      s.freeze = Math.max(0, s.freeze - DT);
    } else {
      // Match Timer
      if (!s.match.overtime) {
        s.match.time = Math.max(0, s.match.time - DT);
        if (s.match.time === 0) {
          if (s.score.blue !== s.score.red) { /* end match? */ } else { s.match.overtime = true; }
        }
      }

      // Update Players
      for (const id in s.players) {
        this.updatePlayer(s.players[id], this.playerInputs.get(id), DT);
      }

      // Update Ball
      this.updateBall(DT);

      // Collisions
      const players = Object.values(s.players);
      for (let i = 0; i < players.length; i++) {
        this.resolvePlayerBallCollision(players[i]);
        for (let j = i + 1; j < players.length; j++) {
          this.resolvePlayerPlayerCollision(players[i], players[j]);
        }
      }
    }

    this.broadcastSnapshot();
    this.tickCount++;
  }

  updatePlayer(p, keys, dt) {
    // Skills
    if (p.ability.mbappeBoostTime > 0) p.ability.mbappeBoostTime = Math.max(0, p.ability.mbappeBoostTime - dt);
    if (p.ability.mbappeCooldown > 0) p.ability.mbappeCooldown = Math.max(0, p.ability.mbappeCooldown - dt);
    if (p.ability.juninhoCooldown > 0) p.ability.juninhoCooldown = Math.max(0, p.ability.juninhoCooldown - dt);

    const skillKey = keys.has('KeyC');
    if (skillKey && !p.lastSkillKeyDown) {
      if (p.character === 'mbappe' && p.ability.mbappeCooldown <= 0) {
        p.ability.mbappeBoostTime = 4;
        p.ability.mbappeCooldown = 15;
      }
    }
    p.lastSkillKeyDown = skillKey;

    // Movement
    let ax = 0, ay = 0;
    if (keys.has('KeyW')) ay -= 1;
    if (keys.has('KeyS')) ay += 1;
    if (keys.has('KeyA')) ax -= 1;
    if (keys.has('KeyD')) ax += 1;

    if (ax !== 0 || ay !== 0) {
      const dir = normalize(ax, ay);
      const boost = p.ability.mbappeBoostTime > 0 ? 1.15 : 1;
      p.vx += dir.x * PHYSICS.playerAccel * boost * dt;
      p.vy += dir.y * PHYSICS.playerAccel * boost * dt;
      p.facing = { x: dir.x, y: dir.y };
    }

    // Kicking
    const handleKick = (type, key) => {
      const charge = p.charge[type];
      if (keys.has(key)) {
        if (!charge.active) { charge.active = true; charge.time = 0; }
        charge.time = Math.min(CHARGE_CONFIG[type].max, charge.time + dt);
      } else if (charge.active) {
        this.attemptKick(p, type, charge.time);
        charge.active = false; charge.time = 0;
      }
    };
    handleKick('ground', 'Space');
    handleKick('air', 'KeyB');

    // Physics
    const damp = Math.exp(-PHYSICS.playerDamp * dt);
    p.vx *= damp; p.vy *= damp;
    const speed = Math.hypot(p.vx, p.vy);
    const maxSpeed = PHYSICS.playerMaxSpeed * (p.ability.mbappeBoostTime > 0 ? 1.15 : 1);
    if (speed > maxSpeed) { p.vx *= maxSpeed / speed; p.vy *= maxSpeed / speed; }
    p.x += p.vx * dt; p.y += p.vy * dt;

    const f = this.state.field;
    p.x = clamp(p.x, f.left + p.r, f.right - p.r);
    p.y = clamp(p.y, f.top + p.r, f.bottom - p.r);
  }

  attemptKick(p, type, chargeTime) {
    const b = this.state.ball;
    const dx = b.x - p.x, dy = b.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > p.r + b.r + 8) return;

    const facing = normalize(dist > 0.0001 ? dx : p.facing.x, dist > 0.0001 ? dy : p.facing.y);
    if (type === 'ground' && b.z <= 1) {
      const speed = lerp(CHARGE_CONFIG.ground.minSpeed, CHARGE_CONFIG.ground.maxSpeed, chargeTime / CHARGE_CONFIG.ground.max);
      b.vx += facing.x * speed; b.vy += facing.y * speed;
      p.kickFlash = 0.15;
    } else if (type === 'air') {
      const forward = lerp(CHARGE_CONFIG.air.minForward, CHARGE_CONFIG.air.maxForward, chargeTime / CHARGE_CONFIG.air.max);
      const up = lerp(CHARGE_CONFIG.air.minUp, CHARGE_CONFIG.air.maxUp, chargeTime / CHARGE_CONFIG.air.max);
      b.vx += facing.x * forward; b.vy += facing.y * forward;
      b.vz = Math.max(b.vz, up); b.z = Math.max(b.z, 1);
      p.kickFlash = 0.15;
    }
  }

  updateBall(dt) {
    const b = this.state.ball;
    const f = this.state.field;

    b.vx *= Math.exp(-PHYSICS.ballAirDamp * dt);
    b.vy *= Math.exp(-PHYSICS.ballAirDamp * dt);
    b.x += b.vx * dt; b.y += b.vy * dt;

    if (b.z > 0 || b.vz > 0) {
      b.vz -= PHYSICS.gravity * dt;
      b.z += b.vz * dt;
      if (b.z <= 0) { b.z = 0; b.vz = Math.abs(b.vz) > 60 ? -b.vz * 0.22 : 0; }
    }
    if (b.z === 0) {
      b.vx *= Math.exp(-PHYSICS.ballDamp * dt);
      b.vy *= Math.exp(-PHYSICS.ballDamp * dt);
    }

    // Goals
    const goalTop = f.centerY - f.goalWidth / 2, goalBottom = f.centerY + f.goalWidth / 2;
    if (b.z < b.r * 2 && b.y > goalTop && b.y < goalBottom) {
      if (b.x - b.r <= f.left) { this.score('red'); return; }
      if (b.x + b.r >= f.right) { this.score('blue'); return; }
    }

    // Bounds
    if (b.y - b.r < f.top) { b.y = f.top + b.r; b.vy = Math.abs(b.vy) * PHYSICS.ballBounce; }
    if (b.y + b.r > f.bottom) { b.y = f.bottom - b.r; b.vy = -Math.abs(b.vy) * PHYSICS.ballBounce; }
    if (b.x - b.r < f.left) { b.x = f.left + b.r; b.vx = Math.abs(b.vx) * PHYSICS.ballBounce; }
    if (b.x + b.r > f.right) { b.x = f.right - b.r; b.vx = -Math.abs(b.vx) * PHYSICS.ballBounce; }
  }

  score(team) {
    this.state.score[team]++;
    this.state.freeze = 1.5;
    this.resetPositions();
  }

  resetPositions() {
    const f = this.state.field;
    this.state.ball = { ...this.state.ball, x: f.centerX, y: f.centerY, vx: 0, vy: 0, z: 0, vz: 0 };
    for (const id in this.state.players) {
      const p = this.state.players[id];
      const isBlue = p.team === 'blue';
      p.x = isBlue ? f.centerX - 200 : f.centerX + 200;
      p.y = f.centerY;
      p.vx = 0; p.vy = 0;
      p.facing = { x: isBlue ? 1 : -1, y: 0 };
    }
  }

  resolvePlayerBallCollision(p) {
    const b = this.state.ball;
    if (b.z > 15) return;
    const dx = b.x - p.x, dy = b.y - p.y, dist = Math.hypot(dx, dy);
    if (dist < p.r + b.r) {
      const nx = dx / dist, ny = dy / dist;
      const overlap = p.r + b.r - dist;
      b.x += nx * overlap; b.y += ny * overlap;
      b.vx += nx * 50 + p.vx * 0.4; b.vy += ny * 50 + p.vy * 0.4;
    }
  }

  resolvePlayerPlayerCollision(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
    if (dist < a.r + b.r) {
      const nx = dx / dist, ny = dy / dist, overlap = a.r + b.r - dist;
      a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
      b.x += nx * overlap / 2; b.y += ny * overlap / 2;
      const impulse = ((b.vx - a.vx) * nx + (b.vy - a.vy) * ny) * 0.8;
      a.vx += impulse * nx; a.vy += impulse * ny;
      b.vx -= impulse * nx; b.vy -= impulse * ny;
    }
  }

  broadcastSnapshot() {
    const snapshot = { type: 'snapshot', tick: this.tickCount, state: this.state };
    const data = JSON.stringify(snapshot);
    this.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
  }
}

// --- Server Setup ---
const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();
const playersToRoom = new Map(); // playerWs -> room

wss.on('connection', (ws) => {
  const playerId = 'p' + Math.random().toString(36).substr(2, 9);
  
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    
    if (msg.type === 'create_room') {
      const roomId = 'r' + Math.random().toString(36).substr(2, 5);
      const room = new Room(roomId, msg.name || 'Oda');
      rooms.set(roomId, room);
      room.addPlayer(playerId, msg.playerName, ws);
      playersToRoom.set(ws, room);
      ws.send(JSON.stringify({ type: 'room_joined', roomId, role: 'host', playerId }));
    } 
    else if (msg.type === 'join_room') {
      const room = rooms.get(msg.roomId);
      if (room) {
        room.addPlayer(playerId, msg.playerName, ws);
        playersToRoom.set(ws, room);
        ws.send(JSON.stringify({ type: 'room_joined', roomId: room.id, role: 'client', playerId }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Oda bulunamadı' }));
      }
    }
    else if (msg.type === 'list_rooms') {
      const list = Array.from(rooms.values()).map(r => ({ id: r.id, name: r.name, players: r.clients.size }));
      ws.send(JSON.stringify({ type: 'room_list', rooms: list }));
    }
    else if (msg.type === 'input') {
      const room = playersToRoom.get(ws);
      if (room) room.playerInputs.set(playerId, new Set(msg.keys));
    }
    else if (msg.type === 'chat') {
      const room = playersToRoom.get(ws);
      if (room) {
        const chatData = JSON.stringify({ type: 'chat', from: playerId, text: msg.text });
        room.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(chatData); });
      }
    }
    else if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); }
  });

  ws.on('close', () => {
    const room = playersToRoom.get(ws);
    if (room) {
      room.removePlayer(playerId);
      if (room.clients.size === 0) rooms.delete(room.id);
    }
    playersToRoom.delete(ws);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Server running at http://localhost:${port}`));
