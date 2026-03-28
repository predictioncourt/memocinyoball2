const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const WebSocket = require('ws');

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  let pathname = parsedUrl.pathname;
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css'
  }[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const rooms = new Map(); // roomId -> { hostId: string, clients: Set<string>, name: string }
const clients = new Map(); // clientId -> { ws: WebSocket, roomId: string }

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).substr(2, 9);
  clients.set(id, { ws, roomId: null });

  send(ws, {
    type: 'role',
    role: 'offline', // Başlangıçta odada değil
    id,
    hostId: null,
  });

  ws.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      return;
    }

    const client = clients.get(id);
    const roomId = client ? client.roomId : null;
    const room = roomId ? rooms.get(roomId) : null;

    if (msg.type === 'list_rooms') {
      const roomList = [];
      rooms.forEach((roomData, rId) => {
        roomList.push({
          id: rId,
          name: roomData.name,
          players: roomData.clients.size
        });
      });
      send(ws, { type: 'room_list', rooms: roomList });
      return;
    }

    if (msg.type === 'create_room') {
      const newRoomId = Math.random().toString(36).substr(2, 9);
      rooms.set(newRoomId, {
        hostId: id,
        clients: new Set([id]),
        name: msg.name || 'Oda ' + newRoomId
      });
      client.roomId = newRoomId;
      
      send(ws, {
        type: 'role',
        role: 'host',
        id,
        hostId: id,
      });
      return;
    }

    if (msg.type === 'join_room') {
      const targetRoom = rooms.get(msg.roomId);
      if (targetRoom) {
        targetRoom.clients.add(id);
        client.roomId = msg.roomId;
        
        send(ws, {
          type: 'role',
          role: 'client',
          id,
          hostId: targetRoom.hostId,
        });

        // Host'a yeni oyuncuyu bildir ki WebRTC bağlasın
        const hostClient = clients.get(targetRoom.hostId);
        if (hostClient) {
          send(hostClient.ws, { type: 'player_joined', id });
        }
      }
      return;
    }

    // Odası olmayan oyuncular aşağıdaki işlemleri yapamaz
    if (!room) return;

    if (msg.type === 'signal') {
      const targetClient = clients.get(msg.to);
      if (targetClient && targetClient.roomId === roomId) {
        send(targetClient.ws, { type: 'signal', from: id, data: msg.data });
      }
      return;
    }
    
    if (msg.type === 'snapshot') {
      if (id !== room.hostId) return;
      room.clients.forEach((clientId) => {
        if (clientId !== room.hostId) {
          const clientWs = clients.get(clientId).ws;
          send(clientWs, msg);
        }
      });
      return;
    }
    
    if (msg.type === 'input') {
      if (id === room.hostId) return;
      const hostWs = clients.get(room.hostId).ws;
      if (hostWs) {
        send(hostWs, { type: 'input', from: id, keys: msg.keys || [], seq: msg.seq });
      }
      return;
    }
    
    if (msg.type === 'menu_action') {
      if (id === room.hostId) {
        room.clients.forEach((clientId) => {
          if (clientId === room.hostId) return;
          const clientWs = clients.get(clientId)?.ws;
          if (clientWs) {
            send(clientWs, { type: 'menu_action', from: id, action: msg.action || null });
          }
        });
        return;
      }
      const hostWs = clients.get(room.hostId)?.ws;
      if (hostWs) {
        send(hostWs, { type: 'menu_action', from: id, action: msg.action || null });
      }
      return;
    }
    
    if (msg.type === 'chat') {
      const text = typeof msg.text === 'string' ? msg.text : '';
      if (!text.trim()) return;
      room.clients.forEach((clientId) => {
        const clientWs = clients.get(clientId).ws;
        send(clientWs, { type: 'chat', from: id, text });
      });
      return;
    }
  });

  ws.on('close', () => {
    const client = clients.get(id);
    if (client && client.roomId) {
      const room = rooms.get(client.roomId);
      if (room) {
        room.clients.delete(id);
        
        // Eğer çıkan kişi host ise, odadaki başka birini host yap
        if (id === room.hostId) {
          if (room.clients.size > 0) {
            const newHostId = Array.from(room.clients)[0];
            room.hostId = newHostId;
            const newHostWs = clients.get(newHostId).ws;
            send(newHostWs, { type: 'role', role: 'host', id: newHostId, hostId: newHostId });
            
            // Diğerlerine yeni hostu bildir
            room.clients.forEach((clientId) => {
              if (clientId !== newHostId) {
                const clientWs = clients.get(clientId).ws;
                send(clientWs, { type: 'host_changed', id: newHostId, hostId: newHostId });
              }
            });
          } else {
            // Oda boşaldıysa odayı sil
            rooms.delete(client.roomId);
          }
        }
      }
    }
    clients.delete(id);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Sinyal sunucusu http://0.0.0.0:${port} adresinde çalışıyor`);
});
