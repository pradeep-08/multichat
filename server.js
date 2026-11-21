// MultiChat server — no dependencies. Serves the UI and the JSON API.
const http = require('http');
const fs = require('fs');
const path = require('path');
const router = require('./src/router');

const PORT = Number(process.env.PORT) || 3000;
// Local only by default: the UI can read and change API settings, so it must not be open to the network.
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SKILLS_FILE = path.join(__dirname, 'data', 'skills.json');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

// First run (fresh clone): start from the sample skills. data/skills.json is git-ignored so your own skills stay local.
const SKILLS_EXAMPLE = path.join(__dirname, 'data', 'skills.example.json');
if (!fs.existsSync(SKILLS_FILE) && fs.existsSync(SKILLS_EXAMPLE)) fs.copyFileSync(SKILLS_EXAMPLE, SKILLS_FILE);
const readSkills = () => JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'));
const writeSkills = (skills) => fs.writeFileSync(SKILLS_FILE, JSON.stringify(skills, null, 2));

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_CHAT_BODY = 40 * 1024 * 1024; // room for a few base64 images / PDFs

function cleanAttachments(list) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  for (const a of list.slice(0, 10)) {
    if (!a || typeof a.name !== 'string') continue;
    const name = a.name.slice(0, 200);
    if (a.kind === 'text') out.push({ name, kind: 'text', text: typeof a.text === 'string' ? a.text : undefined });
    else if (a.kind === 'image' && IMAGE_TYPES.has(a.type)) out.push({ name, kind: 'image', type: a.type, data: typeof a.data === 'string' ? a.data : undefined });
    else if (a.kind === 'pdf') out.push({ name, kind: 'pdf', type: 'application/pdf', data: typeof a.data === 'string' ? a.data : undefined });
  }
  return out.length ? out : undefined;
}

function validSkill(s) {
  return s && typeof s.id === 'string' && s.id && typeof s.name === 'string' && s.name.trim();
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/skills' && req.method === 'GET') return sendJson(res, 200, readSkills());

  if (url.pathname === '/api/skills' && req.method === 'POST') {
    const skills = await readBody(req);
    if (!Array.isArray(skills) || !skills.every(validSkill)) return sendJson(res, 400, { error: 'Each skill needs an id and a name' });
    writeSkills(skills);
    return sendJson(res, 200, skills);
  }

  if (url.pathname === '/api/providers' && req.method === 'GET') return sendJson(res, 200, router.status());

  if (url.pathname === '/api/providers/reset' && req.method === 'POST') {
    router.resetStats();
    return sendJson(res, 200, router.status());
  }

  if (url.pathname === '/api/providers' && req.method === 'POST') {
    const id = router.addProvider(await readBody(req));
    return sendJson(res, 201, { id, providers: router.status() });
  }

  const pm = url.pathname.match(/^\/api\/providers\/([a-z0-9-]+)(\/test)?$/);
  if (pm) {
    const [, id, test] = pm;
    if (test && req.method === 'POST') return sendJson(res, 200, await router.testProvider(id));
    if (!test && req.method === 'PUT') {
      router.updateProvider(id, await readBody(req));
      return sendJson(res, 200, router.status());
    }
    if (!test && req.method === 'DELETE') {
      router.deleteProvider(id);
      // Skills pinned to the deleted API fall back to automatic selection.
      const skills = readSkills();
      if (skills.some((s) => s.provider === id)) writeSkills(skills.map((s) => (s.provider === id ? { ...s, provider: 'auto' } : s)));
      return sendJson(res, 200, router.status());
    }
  }

  if ((url.pathname === '/api/chat' || url.pathname === '/api/chat/stream') && req.method === 'POST') {
    const { skillId, messages } = await readBody(req, MAX_CHAT_BODY);
    const skill = readSkills().find((s) => s.id === skillId);
    if (!skill) return sendJson(res, 400, { error: 'Unknown skill' });
    if (!Array.isArray(messages) || !messages.length) return sendJson(res, 400, { error: 'No messages' });
    const clean = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => {
        const attachments = m.role === 'user' ? cleanAttachments(m.attachments) : undefined;
        return attachments ? { role: m.role, content: m.content, attachments } : { role: m.role, content: m.content };
      })
      .filter((m) => m.content || m.attachments);
    if (!clean.length || clean[clean.length - 1].role !== 'user') return sendJson(res, 400, { error: 'Last message must be from the user' });

    if (url.pathname === '/api/chat') return sendJson(res, 200, await router.chat({ skill, messages: clean }));

    // Streaming: newline-delimited JSON events {type: token|reset|done|error}.
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    const emit = (ev) => { if (!res.writableEnded) res.write(JSON.stringify(ev) + '\n'); };
    try {
      const result = await router.chat({
        skill, messages: clean, signal: ac.signal,
        onToken: (text) => emit({ type: 'token', text }),
        onReset: (failed) => emit({ type: 'reset', failed }),
      });
      emit({ type: 'done', ...result });
    } catch (err) {
      if (!err.aborted) emit({ type: 'error', error: err.message });
    }
    return res.end();
  }

  sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(res, url);
  } catch (err) {
    if (res.headersSent) res.end();
    else sendJson(res, err.status && err.status < 500 ? err.status : 500, { error: err.message });
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Start on another port, e.g.  PORT=3001 npm start  (PowerShell: $env:PORT=3001; npm start)`);
  else console.error(err);
  process.exit(1);
}).listen(PORT, HOST, () => {
  console.log(`MultiChat running at http://localhost:${PORT}${HOST === '127.0.0.1' ? ' (this computer only)' : ` (listening on ${HOST})`}`);
  console.log(`Providers from ${path.relative(__dirname, router.configFile)}`);
});
