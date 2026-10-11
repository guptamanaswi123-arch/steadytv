// SteadyTV relay server: serves the TV + camera pages, relays WebSocket messages between them,
// and stores each household's progress as a small JSON file on this computer.
// No video ever reaches this server: the camera page sends only skeleton landmarks (numbers).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.STEADY_DATA || path.join(ROOT, 'data');

const MOUNTS = {
  '/phone/': path.join(ROOT, 'phone'),
  '/tv/': path.join(ROOT, 'tv'),
  '/shared/': path.join(ROOT, 'shared'),
  '/models/': path.join(ROOT, 'models'),
  '/vendor/mediapipe/': path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision'),
};
const PAGES = { '/phone': 'phone/index.html', '/tv': 'tv/index.html' };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.task': 'application/octet-stream', '.ico': 'image/x-icon',
};
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const rooms = new Map(); // room -> Set<ws>

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

// ---------- profiles (one JSON file per household) ----------
const profilePath = (id) => path.join(DATA_DIR, `${id}.json`);
function loadProfile(id) {
  try { return JSON.parse(fs.readFileSync(profilePath(id), 'utf8')); } catch { return null; }
}
function saveProfile(id, p) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = profilePath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(p, null, 1));
  fs.renameSync(tmp, profilePath(id));
}
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function familyPage(id, p) {
  const head = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>SteadyTV family report</title>
<body style="font-family:system-ui;max-width:680px;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1b2333">`;
  if (!p || !(p.assessments || []).length) return `${head}<h1>No results yet</h1><p>Nothing has been recorded for <b>${esc(id)}</b>.</p>`;
  const DAY = 86400000, now = Date.now();
  const d = (ts) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const checks = p.assessments;
  const last = checks[checks.length - 1];
  const sessions = (p.sessions || []).filter((s) => s.completed);
  const week = sessions.filter((s) => s.at > now - 7 * DAY).length;
  const statusText = { good: 'No flags on the last check', watch: '1 flag on the last check', talk: '2 flags on the last check', info: 'Reference numbers (benchmarks start at age 60)' }[last.status] || '';
  const color = { good: '#047857', watch: '#b45309', talk: '#b91c1c' }[last.status] || '#334';
  const rows = checks.slice(-8).reverse().map((a) => `<tr><td>${d(a.at)}</td><td>${typeof a.chairCount === 'number' ? a.chairCount : '—'}</td><td>${a.stagesPassed}/4</td></tr>`).join('');
  const nums = checks.filter((a) => typeof a.chairCount === 'number');
  const change = nums.length >= 2 ? nums[nums.length - 1].chairCount - nums[0].chairCount : null;
  return `${head}
<h1>SteadyTV weekly summary</h1>
${p.demo ? '<p style="background:#fef3c7;padding:.5rem 1rem;border-radius:8px">Demo data</p>' : ''}
<p style="font-size:1.25rem;font-weight:700;color:${color}">${esc(statusText)}</p>
<ul>
<li>Routine sessions in the last 7 days: <b>${week}</b> (goal: 3 a week)</li>
<li>Total sessions: <b>${sessions.length}</b></li>
<li>Last check (${d(last.at)}): chair stand <b>${esc(last.chairCount ?? '—')}</b>, balance <b>${esc(last.stagesPassed)}/4</b></li>
${change !== null ? `<li>Chair stand since the first check: <b>${change >= 0 ? '+' : ''}${change}</b></li>` : ''}
${now - last.at > 7 * DAY ? '<li><b>A weekly check is due.</b></li>' : ''}
</ul>
<h3>Recent checks</h3>
<table cellpadding=6 style="border-collapse:collapse"><tr style="text-align:left"><th>Date</th><th>Chair stands (30 s)</th><th>Balance stages</th></tr>${rows}</table>
${last.status === 'watch' || last.status === 'talk' ? '<p>Consider talking with a doctor or physical therapist about strength and balance programs.</p>' : ''}
<p style="color:#666;font-size:.9rem">SteadyTV is a screening and exercise aid based on CDC STEADI tests and Otago-style home exercises. It is not a medical diagnosis. Results are computed on the household's own devices from skeleton points; no video is recorded or sent.</p>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);

  if (p === '/') { res.writeHead(302, { Location: '/tv' }); return res.end(); }
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (PAGES[p]) return sendFile(res, path.join(ROOT, PAGES[p]));
  if (p === '/api/health') return json(res, 200, { ok: true });
  if (p === '/api/info') return json(res, 200, { port: PORT, lan: lanAddresses() });

  let m = p.match(/^\/api\/profile\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (!ID_RE.test(id)) return json(res, 400, { error: 'bad id' });
    if (req.method === 'GET') return json(res, 200, loadProfile(id));
    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'bad body' });
        body.id = id;
        saveProfile(id, body);
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 400, { error: String(e.message || e) }); }
    }
    return json(res, 405, { error: 'method' });
  }
  m = p.match(/^\/family\/([^/]+)$/);
  if (m && ID_RE.test(m[1])) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(familyPage(m[1], loadProfile(m[1])));
  }

  for (const [prefix, dir] of Object.entries(MOUNTS)) {
    if (p.startsWith(prefix)) {
      const full = path.join(dir, p.slice(prefix.length));
      if (!full.startsWith(dir + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
      return sendFile(res, full);
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') return socket.destroy();
  const room = url.searchParams.get('room');
  const role = url.searchParams.get('role');
  if (!ID_RE.test(room || '') || !['tv', 'phone'].includes(role)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.room = room; ws.role = role;
    wss.emit('connection', ws);
  });
});

function presence(room) {
  const set = rooms.get(room) || new Set();
  const msg = JSON.stringify({
    type: 'peers',
    tv: [...set].some((c) => c.role === 'tv'),
    phone: [...set].some((c) => c.role === 'phone'),
  });
  for (const c of set) if (c.readyState === 1) c.send(msg);
}

wss.on('connection', (ws) => {
  if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
  rooms.get(ws.room).add(ws);
  presence(ws.room);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const text = data.toString();
    try { JSON.parse(text); } catch { return; }
    for (const c of rooms.get(ws.room) || []) if (c !== ws && c.readyState === 1) c.send(text);
  });
  ws.on('close', () => {
    const set = rooms.get(ws.room);
    if (set) { set.delete(ws); if (!set.size) rooms.delete(ws.room); else presence(ws.room); }
  });
  ws.on('error', () => {});
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\nSteadyTV is running.\n');
    console.log(`  TV screen (browser test):  http://localhost:${PORT}/tv`);
    console.log(`  Camera page (laptop):      http://localhost:${PORT}/phone`);
    console.log(`  TV emulator address:       http://10.0.2.2:${PORT}/tv`);
    for (const ip of lanAddresses()) console.log(`  Family report on Wi-Fi:    http://${ip}:${PORT}/family/home`);
    console.log('\nPress Ctrl+C to stop.\n');
  });
}

module.exports = { server, wss };
