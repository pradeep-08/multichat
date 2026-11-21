// Provider router: picks free + healthy + fastest provider, fails over on error.
// Tracks per-provider calls, success rate, latency, tokens, cost and daily quotas (persisted to data/usage.json).
const fs = require('fs');
const path = require('path');
const { textWithFiles, neededKinds } = require('./attachments');

const adapters = {
  mock: require('./adapters/mock'),
  openai: require('./adapters/openai'),
  anthropic: require('./adapters/anthropic'),
  gemini: require('./adapters/gemini'),
};

const CONFIG = path.join(__dirname, '..', 'config', 'providers.json');
const EXAMPLE = path.join(__dirname, '..', 'config', 'providers.example.json');
const USAGE_FILE = path.join(__dirname, '..', 'data', 'usage.json');
const COOLDOWN_MS = 60_000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const AUTH_COOLDOWN_MS = 30 * 60_000;

let configFile = fs.existsSync(CONFIG) ? CONFIG : EXAMPLE;
// Raw provider configs as stored on disk (apiKey may be "env:NAME", a saved key, or absent for keyless providers).
let rawConfigs = JSON.parse(fs.readFileSync(configFile, 'utf8'));

function normalize(p) {
  const fromEnv = typeof p.apiKey === 'string' && p.apiKey.startsWith('env:');
  const apiKey = fromEnv ? process.env[p.apiKey.slice(4)] : p.apiKey;
  return {
    ...p,
    name: p.name || p.id,
    apiKey,
    // A provider without an apiKey field (mock, local Ollama) needs no key.
    hasKey: p.apiKey === undefined || !!apiKey,
    keyHint: fromEnv ? p.apiKey.slice(4) : null,
    keySource: p.apiKey === undefined ? 'none' : fromEnv ? p.apiKey : 'saved',
  };
}

let providers = rawConfigs.map(normalize);
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

function loadUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch { return {}; }
}
const saved = loadUsage();
const stats = {};
function ensureStats(id) {
  if (stats[id]) return;
  const s = saved[id] || {};
  stats[id] = {
    calls: s.calls || 0, fails: s.fails || 0, totalMs: s.totalMs || 0,
    inputTokens: s.inputTokens || 0, outputTokens: s.outputTokens || 0, cost: s.cost || 0,
    day: s.day || today(), dayRequests: s.dayRequests || 0, dayTokens: s.dayTokens || 0,
    cooldownUntil: 0, lastError: null,
  };
}
providers.forEach((p) => ensureStats(p.id));

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const out = {};
    for (const [id, s] of Object.entries(stats)) {
      const { cooldownUntil, lastError, ...persist } = s;
      out[id] = persist;
    }
    try { fs.writeFileSync(USAGE_FILE, JSON.stringify(out, null, 2)); } catch (err) { console.error('Could not save usage:', err.message); }
  }, 1000);
}

function rollDay(s) {
  const d = today();
  if (s.day !== d) { s.day = d; s.dayRequests = 0; s.dayTokens = 0; }
}

function quotaReached(p) {
  const s = stats[p.id];
  rollDay(s);
  const lim = p.dailyLimit || {};
  return (lim.requests && s.dayRequests >= lim.requests) || (lim.tokens && s.dayTokens >= lim.tokens);
}

function costOf(p, inTok, outTok) {
  const pr = p.pricing;
  if (!pr) return 0;
  return ((inTok || 0) * (pr.input || 0) + (outTok || 0) * (pr.output || 0)) / 1e6;
}

function score(p) {
  const s = stats[p.id];
  if (s.calls === 0) return 0; // untried: try early to learn its speed
  const ok = s.calls - s.fails;
  const avg = ok ? s.totalMs / ok : 10_000;
  return avg * (1 + 5 * (s.fails / s.calls));
}

function available(p) {
  return p.enabled && adapters[p.type] && p.hasKey && stats[p.id].cooldownUntil <= Date.now() && !quotaReached(p);
}

function canRead(p, kinds) {
  const supports = adapters[p.type].supports ? adapters[p.type].supports(p) : {};
  return kinds.every((k) => supports[k]);
}

function ranked(pinned, kinds = []) {
  return providers
    .filter((p) => !pinned || pinned === 'auto' || p.id === pinned)
    .filter(available)
    .filter((p) => canRead(p, kinds))
    .sort((a, b) => (b.free === true) - (a.free === true) || score(a) - score(b));
}

function cooldownFor(err) {
  if (err.noCooldown) return 0;
  if (err.status === 429 || /quota|rate.?limit/i.test(err.message)) return RATE_LIMIT_COOLDOWN_MS;
  if (err.status === 401 || err.status === 403) return AUTH_COOLDOWN_MS;
  return COOLDOWN_MS;
}

/**
 * Runs one chat turn. onToken(text) streams text; onReset(nextProvider) fires when a provider
 * failed mid-stream and the client must discard the partial text before the next provider answers.
 */
async function chat({ skill, messages, onToken = () => {}, onReset = () => {}, signal }) {
  const kinds = neededKinds(messages);
  const candidates = ranked(skill.provider, kinds);
  if (!candidates.length) {
    const pinned = skill.provider && skill.provider !== 'auto' ? ` (skill is pinned to "${skill.provider}")` : '';
    if (kinds.length && ranked(skill.provider).length) {
      const what = kinds.map((k) => (k === 'pdf' ? 'PDFs' : 'images')).join(' and ');
      throw new Error(`None of the available APIs${pinned} can read ${what}. Add a Claude or Gemini API key, or set "vision": true on an OpenAI-compatible vision model.`);
    }
    throw new Error(`No provider available${pinned} — all are disabled, missing keys, cooling down or over their daily limit`);
  }
  const system = skill.instructions || '';
  const errors = [];
  for (const p of candidates) {
    const s = stats[p.id];
    rollDay(s);
    s.calls++;
    s.dayRequests++;
    let emitted = false;
    const t0 = Date.now();
    try {
      const r = await adapters[p.type](p, {
        system, skill, messages, signal,
        onToken: (t) => { emitted = true; onToken(t); },
      });
      const ms = Date.now() - t0;
      const estimated = r.inputTokens == null || r.outputTokens == null;
      const inTok = r.inputTokens != null ? r.inputTokens : Math.ceil((system.length + messages.reduce((n, m) => n + textWithFiles(m).length, 0)) / 4);
      const outTok = r.outputTokens != null ? r.outputTokens : Math.ceil(r.text.length / 4);
      const cost = costOf(p, inTok, outTok);
      s.totalMs += ms;
      s.inputTokens += inTok;
      s.outputTokens += outTok;
      s.dayTokens += inTok + outTok;
      s.cost += cost;
      s.lastError = null;
      scheduleSave();
      return {
        reply: r.text, provider: p.name, providerId: p.id, model: p.model || null, ms, tried: errors.length + 1,
        usage: { input: inTok, output: outTok, estimated }, cost,
      };
    } catch (err) {
      if (err.aborted || (signal && signal.aborted)) { s.calls--; s.dayRequests--; throw Object.assign(new Error('Cancelled'), { aborted: true }); }
      s.fails++;
      s.lastError = err.message;
      const cd = cooldownFor(err);
      if (cd) s.cooldownUntil = Date.now() + cd;
      errors.push(`${p.name}: ${err.message}`);
      scheduleSave();
      if (emitted) onReset(p.name);
    }
  }
  throw new Error('All providers failed — ' + errors.join(' | '));
}

function status() {
  const now = Date.now();
  return providers.map((p) => {
    const s = stats[p.id];
    rollDay(s);
    const ok = s.calls - s.fails;
    let state = 'ready';
    if (!p.enabled) state = 'disabled';
    else if (!adapters[p.type]) state = 'no adapter';
    else if (!p.hasKey) state = 'no key';
    else if (quotaReached(p)) state = 'daily limit reached';
    else if (s.cooldownUntil > now) state = `cooldown ${Math.ceil((s.cooldownUntil - now) / 1000)}s`;
    return {
      id: p.id, name: p.name, type: p.type, model: p.model || null, free: !!p.free, enabled: !!p.enabled,
      state, keyHint: p.hasKey ? null : p.keyHint,
      calls: s.calls,
      successRate: s.calls ? Math.round((ok / s.calls) * 100) : null,
      avgMs: ok ? Math.round(s.totalMs / ok) : null,
      inputTokens: s.inputTokens, outputTokens: s.outputTokens, cost: s.cost,
      today: { requests: s.dayRequests, tokens: s.dayTokens },
      dailyLimit: p.dailyLimit || null,
      lastError: s.lastError,
      // Editable settings (the key itself is never sent to the browser).
      baseUrl: p.baseUrl || null, vision: !!p.vision, pricing: p.pricing || null, maxTokens: p.maxTokens || null,
      keySource: p.keySource,
    };
  });
}

function resetStats() {
  for (const s of Object.values(stats)) {
    Object.assign(s, { calls: 0, fails: 0, totalMs: 0, inputTokens: 0, outputTokens: 0, cost: 0, cooldownUntil: 0, lastError: null });
  }
  scheduleSave();
}

// ---------- provider management (add / edit / delete from the UI) ----------
const TYPES = ['openai', 'anthropic', 'gemini', 'mock'];
const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

function uniqueId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'api';
  let id = base;
  for (let n = 2; id === 'reset' || rawConfigs.some((r) => r.id === id); n++) id = `${base}-${n}`;
  return id;
}

function optNumber(v, label, integer = false) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} must be a number of 0 or more`);
  return integer ? Math.round(n) : n;
}

function sanitize(input, existing) {
  const m = { ...(existing || {}), ...input };
  const name = String(m.name || '').trim().slice(0, 60);
  if (!name) throw badRequest('Name is required');
  if (!TYPES.includes(m.type)) throw badRequest('Choose an API type');
  const out = { id: existing ? existing.id : uniqueId(name), name, type: m.type, free: !!m.free, enabled: m.enabled !== false };

  if (m.type !== 'mock') {
    const model = String(m.model || '').trim();
    if (!model) throw badRequest('Model is required');
    out.model = model;
  }
  if (m.type === 'openai') {
    const url = String(m.baseUrl || '').trim().replace(/\/+$/, '');
    let ok = false;
    try { ok = /^https?:$/.test(new URL(url).protocol); } catch {}
    if (!ok) throw badRequest('Base URL must start with http:// or https://');
    out.baseUrl = url;
    out.vision = !!m.vision;
  }

  // Key: blank keeps the saved one, a value replaces it, clearKey removes it. "env:NAME" reads an environment variable.
  let key = existing ? existing.apiKey : undefined;
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) key = input.apiKey.trim();
  if (input.clearKey) key = undefined;
  if (m.type === 'mock') key = undefined;
  if ((m.type === 'anthropic' || m.type === 'gemini') && !key) throw badRequest('This API type needs an API key (or env:VARIABLE_NAME)');
  if (key !== undefined) out.apiKey = key;

  const pr = m.pricing || {};
  const pricing = { input: optNumber(pr.input, 'Input price'), output: optNumber(pr.output, 'Output price') };
  if (pricing.input !== undefined || pricing.output !== undefined) out.pricing = { input: pricing.input || 0, output: pricing.output || 0 };
  const dl = m.dailyLimit || {};
  const limit = { requests: optNumber(dl.requests, 'Daily request limit', true), tokens: optNumber(dl.tokens, 'Daily token limit', true) };
  if (limit.requests || limit.tokens) out.dailyLimit = Object.fromEntries(Object.entries(limit).filter(([, v]) => v));
  const maxTokens = optNumber(m.maxTokens, 'Max tokens', true);
  if (maxTokens) out.maxTokens = maxTokens;
  // Advanced fields that are only set in the JSON file are kept as they are.
  for (const k of ['headers', 'failRate', 'effort', 'fallbacks']) if (existing && existing[k] !== undefined) out[k] = existing[k];
  if (!existing && m.type === 'mock' && input.failRate !== undefined) out.failRate = optNumber(input.failRate, 'Fail rate');
  return out;
}

function persist() {
  fs.writeFileSync(CONFIG, JSON.stringify(rawConfigs, null, 2));
  configFile = CONFIG;
  providers = rawConfigs.map(normalize);
  providers.forEach((p) => ensureStats(p.id));
}

function addProvider(input) {
  const cfg = sanitize(input, null);
  rawConfigs.push(cfg);
  persist();
  return cfg.id;
}

function updateProvider(id, input) {
  const idx = rawConfigs.findIndex((r) => r.id === id);
  if (idx < 0) throw Object.assign(new Error('API not found'), { status: 404 });
  rawConfigs[idx] = sanitize(input, rawConfigs[idx]);
  persist();
  Object.assign(stats[id], { cooldownUntil: 0, lastError: null }); // settings changed: give it a fresh chance
}

function deleteProvider(id) {
  if (!rawConfigs.some((r) => r.id === id)) throw Object.assign(new Error('API not found'), { status: 404 });
  rawConfigs = rawConfigs.filter((r) => r.id !== id);
  persist();
  delete stats[id];
  scheduleSave();
}

// Sends one tiny request to a single API so the user can check its settings.
async function testProvider(id) {
  const p = providers.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error('API not found'), { status: 404 });
  if (!p.hasKey) return { ok: false, error: p.keyHint ? `No key: set the ${p.keyHint} environment variable` : 'No API key saved' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  const t0 = Date.now();
  try {
    const r = await adapters[p.type]({ ...p, maxTokens: 1024 }, {
      system: '', skill: { name: 'Test' }, signal: ac.signal, onToken() {},
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
    });
    return { ok: true, ms: Date.now() - t0, reply: r.text.slice(0, 200) };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: err.aborted || ac.signal.aborted ? 'Timed out after 30 s' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  chat, status, resetStats, addProvider, updateProvider, deleteProvider, testProvider,
  get configFile() { return configFile; },
};
