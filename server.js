const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const rootDir = __dirname;
const rootPrefix = `${rootDir}${path.sep}`;
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }
  const requestUrl = (req.url || '/').split('?')[0];
  let relativePath = 'index.html';
  if (requestUrl !== '/') {
    try {
      relativePath = decodeURIComponent(requestUrl.slice(1));
    } catch (err) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
  }
  const filePath = path.resolve(rootDir, relativePath);
  if (!(filePath === rootDir || filePath.startsWith(rootPrefix))) {
    res.writeHead(403);
    res.end('');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.json': 'application/json',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    if (req.method === 'HEAD') {
      res.end('');
      return;
    }
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const clients = new Map();
let hostId = null;
let nextId = 1;

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on('connection', (ws) => {
  const id = `c${nextId++}`;
  clients.set(id, ws);
  if (!hostId) {
    hostId = id;
  }
  send(ws, { type: 'role', role: id === hostId ? 'host' : 'client', id, hostId });

  ws.on('message', (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      return;
    }
    if (msg.type === 'ping') {
      send(ws, { type: 'pong' });
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
      clients.forEach((clientWs, clientId) => {
        send(clientWs, { type: 'chat', from: id, text });
      });
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    if (id === hostId) {
      hostId = clients.keys().next().value || null;
      clients.forEach((clientWs, clientId) => {
        send(clientWs, { type: 'host_changed', id: hostId });
        send(clientWs, { type: 'role', role: clientId === hostId ? 'host' : 'client', id: clientId, hostId });
      });
    }
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${port}`);
});
