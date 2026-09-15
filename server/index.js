// ============================================================================
// AGRAV games server: static files + JSON API + WebSocket lobby on one port.
//
//   node server/index.js            (PORT, HOST, STATIC_ROOT, ... from env)
//
// In production nginx terminates TLS in front of this and can serve the
// static files itself; the process still serves them so a bare install works.
// ============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { Lobby } from './lobby.js';
import { Session } from './session.js';
import { log } from './log.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.woff2': 'font/woff2'
};
const HIDDEN = new Set(['node_modules', 'server', 'deploy', 'package.json', 'package-lock.json']);

export function createServer(lobby = new Lobby()) {
  const root = path.resolve(config.staticRoot);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, uptime: process.uptime(), ...lobby.stats() });
    if (url.pathname === '/api/rooms') return json(res, 200, { rooms: lobby.listPublic() });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(root, url.pathname, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {});
      wss.emit('connection', ws, req);   // noServer mode does not emit this itself
      Session.fromSocket(ws, lobby);
    });
  });

  // keepalive: drop sockets that stopped answering pings (NAT timeouts, dead phones)
  const alive = new WeakMap();
  wss.on('connection', (ws) => { alive.set(ws, true); ws.on('pong', () => alive.set(ws, true)); });
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 15000);
  hb.unref();

  server.on('close', () => { clearInterval(hb); wss.close(); });
  return { server, wss, lobby };
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
}

function serveStatic(root, pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(p => p === '..' || p.startsWith('.')) || HIDDEN.has(parts[0])) { res.writeHead(404); return res.end('not found'); }
  let file = path.join(root, ...parts);
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!pathname.endsWith('/')) { res.writeHead(301, { location: pathname + '/' }); return res.end(); }
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (err2, data) => {
      if (err2) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
      const ext = path.extname(file).toLowerCase();
      const isVendor = parts[0] === 'shared' && parts[1] === 'vendor';
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': isVendor ? 'public, max-age=86400' : 'no-cache',
        'content-length': data.length
      });
      res.end(data);
    });
  });
}

// run directly (not imported by a test)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const { server, lobby } = createServer();
  server.listen(config.port, config.host, () => {
    log.info('server', `listening on http://${config.host}:${config.port}  (static root ${config.staticRoot})`);
  });
  const shutdown = (sig) => {
    log.info('server', `${sig}: shutting down`);
    lobby.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
