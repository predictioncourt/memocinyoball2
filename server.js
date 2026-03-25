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
const clients = new Map();
let hostId = null;

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).substr(2, 9);
  clients.set(id, ws);

  if (!hostId) {
    hostId = id;
  }

  send(ws, {
    type: 'role',
    role: id === hostId ? 'host' : 'client',
    id,
    hostId,
  });

  ws.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      return;
    }

    if (msg.type === 'signal') {
      const targetWs = clients.get(msg.to);
      if (targetWs) {
        send(targetWs, { type: 'signal', from: id, data: msg.data });
      }
      return;
    }
    if (msg.type === 'snapshot') {
      if (id !== hostId) return;
      clients.forEach((clientWs, clientId) => {
        if (clientId !== hostId) {
          send(clientWs, msg);
        }
      });
      return;
    }
    if (msg.type === 'input') {
      if (id === hostId) return;
      const hostWs = clients.get(hostId);
      if (hostWs) {
        send(hostWs, { type: 'input', from: id, keys: msg.keys || [], seq: msg.seq });
      }
      return;
    }
    if (msg.type === 'menu_action') {
      if (id === hostId) return;
      const hostWs = clients.get(hostId);
      if (hostWs) {
        send(hostWs, { type: 'menu_action', from: id, action: msg.action || null });
      }
      return;
    }
    if (msg.type === 'chat') {
      const text = typeof msg.text === 'string' ? msg.text : '';
      if (!text.trim()) return;
      clients.forEach((clientWs) => {
        send(clientWs, { type: 'chat', from: id, text });
      });
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    if (id === hostId) {
      hostId = clients.size > 0 ? Array.from(clients.keys())[0] : null;
      if (hostId) {
        const newHostWs = clients.get(hostId);
        send(newHostWs, { type: 'role', role: 'host', id: hostId, hostId });
        clients.forEach((clientWs, clientId) => {
          if (clientId !== hostId) {
            send(clientWs, { type: 'host_changed', hostId });
          }
        });
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Sinyal sunucusu http://0.0.0.0:${port} adresinde çalışıyor`);
});
