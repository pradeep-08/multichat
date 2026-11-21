// MultiChat front-end — 1 to 6 chat panes (add / remove any time), skills manager, cross-verify (manual + auto),
// streaming replies, API status with tokens/cost/quotas, chat export.
const MAX_PANES = 6;
const DEFAULT_PANES = 3;
const STORE_KEY = 'multichat.panes.v1';
const $ = (sel, el = document) => el.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { handleAuthError(res.status, body); throw new Error(body.error || res.statusText); }
  return body;
}

// The server answers 401 (sign in) or 503 + setup (no password configured on a public host).
function handleAuthError(status, body) {
  if (status === 401 && body.login) showGate('login');
  if (status === 503 && body.setup) showGate('setup', body.error);
}

// Full-screen sign-in / setup screen, in the app's theme.
function showGate(kind, message) {
  if (document.getElementById('gate')) return;
  const err = h('p', { class: 'form-error hidden' });
  let card;
  if (kind === 'setup') {
    card = h('div', { class: 'gate-card' },
      h('span', { class: 'logo' }, icon('spark')),
      h('h2', {}, 'Set a password first'),
      h('p', {}, message || 'This server is reachable from the internet but has no password, so the API is locked.'),
      h('ol', { class: 'gate-steps' },
        h('li', {}, 'In your hosting dashboard, add an environment variable named ', h('code', {}, 'APP_PASSWORD'), ' with a strong password.'),
        h('li', {}, 'Also add your API keys as environment variables (for example ', h('code', {}, 'GROQ_API_KEY'), ').'),
        h('li', {}, 'Redeploy or restart, then reload this page.')),
      h('button', { onclick: () => location.reload() }, 'Reload'));
  } else {
    const input = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
    const submit = async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      try {
        const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || res.statusText);
        location.reload();
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); input.select(); }
    };
    card = h('form', { class: 'gate-card', onsubmit: submit },
      h('span', { class: 'logo' }, icon('spark')),
      h('h2', {}, 'Sign in to MultiChat'),
      h('p', {}, 'This MultiChat is password protected.'),
      input, err,
      h('button', { type: 'submit' }, 'Sign in'));
    setTimeout(() => input.focus(), 0);
  }
  document.body.append(h('div', { id: 'gate', class: 'gate' }, card));
}

async function signOut() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}

// ---------- themed dialogs (instead of the browser's alert / confirm) ----------
// toast(message, kind): a small notice in the corner that fades out by itself. kind: 'error' | 'info' | 'success'.
function toast(message, kind = 'info', ms = 5000) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 180); };
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-icon' }, kind === 'error' ? '!' : kind === 'success' ? '✓' : 'i'),
    h('span', { class: 'toast-text' }, message),
    h('button', { class: 'toast-close', 'aria-label': 'Dismiss', onclick: close }, '×'));
  box.append(el);
  if (ms) setTimeout(close, ms);
}

// uiConfirm({ title, message, confirmText, danger }) → Promise<boolean>. Enter confirms, Escape cancels.
function uiConfirm({ title = 'Are you sure?', message = '', confirmText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const before = document.activeElement;
    const done = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.classList.add('leaving');
      setTimeout(() => overlay.remove(), 150);
      before?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      if (e.key === 'Tab') { // keep focus inside the dialog
        const f = [cancelBtn, okBtn];
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
      }
    };
    const cancelBtn = h('button', { class: 'ghost', onclick: () => done(false) }, cancelText);
    const okBtn = h('button', { class: danger ? 'danger-solid' : '', onclick: () => done(true) }, confirmText);
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) done(false); } },
      h('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'modalTitle', 'aria-describedby': 'modalText' },
        h('div', { class: `modal-icon${danger ? ' danger' : ''}` }, danger ? icon('trash') : icon('spark')),
        h('h3', { id: 'modalTitle' }, title),
        message ? h('p', { id: 'modalText' }, message) : null,
        h('div', { class: 'modal-actions' }, cancelBtn, okBtn)));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    okBtn.focus();
  });
}

const fmtCost = (c) => (!c ? '$0' : c < 0.01 ? '$' + c.toFixed(4) : '$' + c.toFixed(2));
const fmtNum = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : String(n));

// ---------- state ----------
// Each pane has a stable id, so removing one never mixes up auto-verify links or in-flight replies.
let skills = [];
const newId = () => Math.random().toString(36).slice(2, 10);
const withRuntime = (p) => Object.assign(p, { busy: false, abort: null, queue: [], pending: [], ui: null, removed: false });
// links: connections to other chats, drawn as wires on the Flow page.
//   { to: paneId, mode: 'verify' | 'forward', count, lastAt, lastText, lastReply }
// pos: node position on the Flow canvas.
// providerId: model chosen in the chat ('auto' = router picks). smart: Smart UI (formatted, interactive replies).
const newPane = (skillId = null) => withRuntime({ id: newId(), skillId, providerId: 'auto', smart: true, links: [], pos: null, messages: [] });
let panes = loadPanes();

function loadPanes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(saved) && saved.length) {
      const list = saved.slice(0, MAX_PANES).map((p) => ({
        id: p.id || newId(), skillId: p.skillId ?? null, autoVerify: p.autoVerify ?? null,
        providerId: typeof p.providerId === 'string' ? p.providerId : 'auto', smart: p.smart !== false,
        links: Array.isArray(p.links) ? p.links.map(({ flowing, ...l }) => l) : [],
        pos: p.pos && Number.isFinite(p.pos.x) ? p.pos : null,
        messages: (p.messages || []).filter((m) => !m.streaming),
      }));
      // Older saves: auto-verify (a pane index, later a pane id) becomes a "verify" link.
      list.forEach((p) => {
        const target = typeof p.autoVerify === 'number' ? list[p.autoVerify]?.id : p.autoVerify;
        if (target && !p.links.some((l) => l.to === target)) p.links.push({ to: target, mode: 'verify', count: 0 });
        delete p.autoVerify;
      });
      const ids = new Set(list.map((p) => p.id));
      list.forEach((p) => { p.links = p.links.filter((l) => ids.has(l.to) && l.to !== p.id); });
      return list.map(withRuntime);
    }
  } catch {}
  return Array.from({ length: DEFAULT_PANES }, () => newPane());
}
function savePanes() {
  try {
    // File contents stay in memory only (browser storage is small); names are kept so history still shows them.
    const slim = (m) => (m.attachments ? { ...m, attachments: m.attachments.map(({ data, text, ...a }) => a) } : m);
    localStorage.setItem(STORE_KEY, JSON.stringify(panes.map(({ busy, abort, queue, pending, ui, removed, ...p }) => ({
      ...p, links: p.links.map(({ flowing, ...l }) => l), messages: p.messages.filter((m) => !m.streaming).map(slim),
    }))));
  } catch {}
}
const skillById = (id) => skills.find((s) => s.id === id);
const paneById = (id) => panes.find((p) => p.id === id);
const label = (p) => `Chat ${panes.indexOf(p) + 1}`;

// ---------- icons ----------
const ICONS = {
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  spark: '<path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z"/>',
};
function icon(name) {
  const s = document.createElement('span');
  s.style.display = 'contents';
  s.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`; // static markup only
  return s;
}

// ---------- theme (light by default) ----------
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('multichat.theme', t); } catch {}
  const btn = $('#btnTheme');
  btn.innerHTML = '';
  btn.append(icon(t === 'dark' ? 'sun' : 'moon'), h('span', { class: 'lbl' }, t === 'dark' ? 'Light mode' : 'Dark mode'));
  btn.title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}

// ---------- sidebar ----------
function renderSidebar() {
  const list = $('#chatList');
  list.innerHTML = '';
  panes.forEach((p) => {
    const skill = skillById(p.skillId);
    list.append(h('button', { class: `chat-item${p.busy ? ' busy' : ''}`, title: `${label(p)} — ${skill?.name || 'no skill'}`,
      onclick: () => { showView('chats'); p.ui.el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); p.ui.textarea.focus(); } },
      h('span', { class: 'chat-no' }, String(panes.indexOf(p) + 1)),
      h('span', { class: 'lbl chat-text' }, h('span', { class: 'chat-name' }, label(p)), h('span', { class: 'chat-skill' }, skill?.name || 'No skill')),
      h('span', { class: 'dot', 'aria-label': p.busy ? 'Replying' : '' })));
  });
}

function toggleSidebar() {
  const collapsed = document.documentElement.classList.toggle('sb-collapsed');
  try { localStorage.setItem('multichat.sidebar', collapsed ? 'collapsed' : 'open'); } catch {}
  $('#btnCollapse').title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}

// ---------- file attachments ----------
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|cfg|conf|log|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|rb|php|java|kt|go|rs|c|h|cpp|hpp|cs|swift|sql|sh|bash|ps1|bat|r|lua|pl|vue|svelte|env|gitignore|dockerfile)$/i;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 300_000;
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error(`Could not read "${file.name}"`));
    r.readAsDataURL(file);
  });
}

async function readFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}" is ${fmtSize(file.size)}; the limit is ${fmtSize(MAX_FILE_BYTES)}.`);
  if (IMAGE_TYPES.includes(file.type)) return { name: file.name, kind: 'image', type: file.type, size: file.size, data: await readAsBase64(file) };
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { name: file.name, kind: 'pdf', type: 'application/pdf', size: file.size, data: await readAsBase64(file) };
  if (file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXT.test(file.name)) {
    const text = await file.text();
    if (text.length > MAX_TEXT_CHARS) throw new Error(`"${file.name}" has ${text.length.toLocaleString()} characters; the limit is ${MAX_TEXT_CHARS.toLocaleString()}.`);
    return { name: file.name, kind: 'text', size: file.size, text };
  }
  throw new Error(`"${file.name}" is not supported. Attach text or code files, images (PNG, JPG, GIF, WebP) or PDFs.`);
}

Object.assign(ICONS, {
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevUp: '<path d="m18 15-6-6-6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
});

const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toUpperCase();
const guessKind = (f) => (IMAGE_TYPES.includes(f.type) ? 'image' : f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? 'pdf' : 'text');

async function addFiles(p, files) {
  const errors = [];
  const jobs = [];
  for (const f of files) {
    if (p.pending.length >= MAX_FILES) { errors.push(`Up to ${MAX_FILES} files per message.`); break; }
    // Show an "Uploading…" card right away, then swap in the real file when it has been read.
    const slot = { name: f.name, kind: guessKind(f), size: f.size, loading: true };
    p.pending.push(slot);
    jobs.push(readFile(f).then((a) => { Object.assign(slot, a, { loading: false }); })
      .catch((err) => { errors.push(err.message); p.pending = p.pending.filter((x) => x !== slot); }));
  }
  p.trayOpen = true;
  renderPending(p);
  await Promise.all(jobs);
  renderPending(p);
  errors.forEach((e) => toast(e, 'error', 7000));
}

// Small chip / thumbnail used inside sent messages.
function fileView(a) {
  if (a.kind === 'image' && a.data) return h('img', { src: `data:${a.type};base64,${a.data}`, alt: a.name, title: a.name });
  return h('span', { class: 'file-chip', title: a.name },
    icon(a.kind === 'image' ? 'image' : 'file'),
    h('span', { class: 'name' }, a.name),
    a.size ? h('span', { class: 'size' }, fmtSize(a.size)) : null);
}

function previewOf(a) {
  if (a.loading) return h('div', { class: 'pv' }, h('span', { class: 'spinner', 'aria-label': 'Uploading' }));
  if (a.kind === 'image') return h('div', { class: 'pv' }, h('img', { src: `data:${a.type};base64,${a.data}`, alt: '' }));
  if (a.kind === 'pdf') {
    return h('div', { class: 'pv doc' },
      h('div', { class: 'doc-head' }, h('span', { class: 'doc-icon' }, icon('file')), h('span', {}, 'Document')),
      h('i', {}), h('i', {}), h('i', { class: 'short' }));
  }
  const lines = (a.text || '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 4);
  if (/^(CSV|TSV)$/.test(extOf(a.name)) && lines.length) {
    const sep = extOf(a.name) === 'TSV' ? '\t' : ',';
    return h('div', { class: 'pv table' }, h('table', {}, lines.map((l, r) =>
      h('tr', {}, l.split(sep).slice(0, 3).map((c) => h(r ? 'td' : 'th', {}, c.replace(/^"|"$/g, '').slice(0, 14)))))));
  }
  return h('div', { class: 'pv text' }, lines.join('\n').slice(0, 220) || '(empty file)');
}

// File cards inside the composer: preview, name, type badge, round remove button.
function renderPending(p) {
  const ui = p.ui;
  const n = p.pending.length;
  ui.tray.innerHTML = '';
  p.pending.forEach((a) => ui.tray.append(h('div', { class: 'fcard', title: a.name },
    a.loading ? null : h('button', { type: 'button', class: 'rm', 'aria-label': `Remove ${a.name}`, onclick: () => { p.pending = p.pending.filter((x) => x !== a); renderPending(p); } }, icon('x')),
    previewOf(a),
    h('div', { class: 'fname' }, a.loading ? 'Uploading…' : a.name),
    a.loading ? null : h('span', { class: 'ftype' }, extOf(a.name) || a.kind.toUpperCase()))));
  ui.tray.classList.toggle('hidden', !n || !p.trayOpen);
  ui.sources.classList.toggle('hidden', !n);
  ui.sources.innerHTML = '';
  ui.sources.append(icon('file'), h('span', {}, `${n} ${n === 1 ? 'source' : 'sources'}`), icon(p.trayOpen ? 'chevUp' : 'chevDown'));
  updateSendState(p);
}

function updateSendState(p) {
  const ui = p.ui;
  const hasInput = !!ui.textarea.value.trim() || p.pending.length > 0;
  const loading = p.pending.some((a) => a.loading);
  ui.sendBtn.classList.toggle('ready', p.busy || (hasInput && !loading));
}

// ---------- models: list of APIs with today's usage (for the model menu) ----------
let providerList = [];
let providersTimer = null;
async function loadProviders() {
  try {
    providerList = await api('/api/providers');
    panes.forEach((p) => { if (p.ui) renderModelPill(p); });
  } catch {}
}
const queueProviderRefresh = (() => { let t = null; return () => { clearTimeout(t); t = setTimeout(loadProviders, 600); }; })();

// "12 / 250 today" or "12 today · Unlimited".
function usageText(p) {
  const l = p.dailyLimit;
  if (!l) return `${p.today.requests} today · Unlimited`;
  const parts = [];
  if (l.requests) parts.push(`${p.today.requests} / ${l.requests} today`);
  if (l.tokens) parts.push(`${fmtNum(p.today.tokens)} / ${fmtNum(l.tokens)} tokens`);
  return parts.join(' · ');
}
function usageShort(p) {
  const l = p.dailyLimit;
  if (!l) return '∞';
  if (l.requests) return `${p.today.requests}/${l.requests}`;
  return `${fmtNum(p.today.tokens)}/${fmtNum(l.tokens)}`;
}
const usageRatio = (p) => {
  const l = p.dailyLimit;
  if (!l) return 0;
  return Math.max(l.requests ? p.today.requests / l.requests : 0, l.tokens ? p.today.tokens / l.tokens : 0);
};

function renderModelPill(p) {
  const btn = p.ui.modelBtn;
  btn.innerHTML = '';
  if (!p.providerId || p.providerId === 'auto') {
    const ready = providerList.filter((x) => x.state === 'ready').length;
    btn.append(icon('bolt'), h('span', { class: 'mp-name' }, 'Auto'), h('span', { class: 'mp-usage' }, providerList.length ? `${ready} ready` : ''));
    btn.title = 'Auto: the router picks the best available model for each message';
    btn.classList.remove('warn');
  } else {
    const pr = providerList.find((x) => x.id === p.providerId);
    btn.append(icon('cpu'), h('span', { class: 'mp-name' }, pr ? pr.name : 'Missing model'), pr ? h('span', { class: `mp-usage${usageRatio(pr) >= 0.9 ? ' high' : ''}` }, usageShort(pr)) : null);
    btn.title = pr ? `${pr.name} · ${pr.model || ''} · ${usageText(pr)}${pr.state !== 'ready' ? ` · ${pr.state}` : ''}` : 'This model was removed. Pick another one.';
    btn.classList.toggle('warn', !pr || pr.state !== 'ready');
  }
  btn.append(icon('chevDown'));
}

// Themed dropdown for choosing the model of one chat.
function openModelMenu(p, refreshed = false) {
  closeModelMenu();
  const choose = (id) => { p.providerId = id; savePanes(); renderModelPill(p); closeModelMenu(); p.ui.textarea.focus(); };
  const row = (opts) => h('button', { type: 'button', class: `mm-row${opts.active ? ' active' : ''}`, disabled: opts.disabled, onclick: () => choose(opts.id), role: 'menuitemradio', 'aria-checked': String(!!opts.active) },
    h('span', { class: `mm-dot ${opts.dot}` }),
    h('span', { class: 'mm-main' }, h('span', { class: 'mm-name' }, opts.name), h('span', { class: 'mm-sub' }, opts.sub)),
    opts.usage ? h('span', { class: `mm-usage${opts.high ? ' high' : ''}` }, opts.usage) : null,
    opts.active ? h('span', { class: 'mm-check' }, icon('check')) : null);
  const ready = providerList.filter((x) => x.state === 'ready');
  const menu = h('div', { class: 'model-menu', role: 'menu', id: 'modelMenu' },
    h('div', { class: 'mm-title' }, 'Model'),
    row({ id: 'auto', name: 'Auto', sub: `Best available for each message · ${ready.length} ready`, dot: ready.length ? 'ok' : 'off', active: !p.providerId || p.providerId === 'auto' }),
    h('div', { class: 'mm-sep' }),
    providerList.length ? providerList.map((x) => row({
      id: x.id, name: x.name, sub: [x.model, x.state === 'ready' ? (x.free ? 'Free' : 'Paid') : x.state].filter(Boolean).join(' · '),
      usage: usageText(x), high: usageRatio(x) >= 0.9, dot: x.state === 'ready' ? 'ok' : x.state === 'disabled' ? 'off' : 'warn',
      active: p.providerId === x.id, disabled: x.state !== 'ready' && p.providerId !== x.id,
    })) : h('div', { class: 'mm-empty' }, 'No APIs yet.'),
    h('div', { class: 'mm-sep' }),
    h('button', { type: 'button', class: 'mm-manage', onclick: () => { closeModelMenu(); showView('apis'); } }, icon('plus'), 'Add or manage APIs'));
  document.body.append(menu);
  const r = p.ui.modelBtn.getBoundingClientRect();
  const w = Math.min(340, window.innerWidth - 16);
  menu.style.width = w + 'px';
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  menu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  setTimeout(() => {
    document.addEventListener('pointerdown', onMenuOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
  });
  menu.querySelector('.mm-row.active, .mm-row:not([disabled])')?.focus();
  // Refresh usage numbers once, then redraw the open menu with them.
  if (!refreshed) loadProviders().then(() => { if (document.getElementById('modelMenu') === menu) { closeModelMenu(); openModelMenu(p, true); } });
}
function onMenuOutside(e) { if (!e.target.closest('#modelMenu, .model-pill')) closeModelMenu(); }
function onMenuKey(e) { if (e.key === 'Escape') { e.preventDefault(); closeModelMenu(); } }
function closeModelMenu() {
  document.getElementById('modelMenu')?.remove();
  document.removeEventListener('pointerdown', onMenuOutside, true);
  document.removeEventListener('keydown', onMenuKey, true);
}

const SUGGESTIONS = [
  { icon: 'file', color: '#d9480f', label: 'Summarize a file', prompt: 'Summarize the attached file in 5 bullet points.' },
  { icon: 'code', color: '#1c7ed6', label: 'Explain code', prompt: 'Explain this code step by step:\n' },
  { icon: 'check', color: '#2b8a3e', label: 'Fact-check', prompt: 'Fact-check this and list anything incorrect:\n' },
  { icon: 'mail', color: '#7048e8', label: 'Draft an email', prompt: 'Draft a short, polite email about ' },
];

function buildPane(p) {
  const select = h('select', { class: 'skill-pill', 'aria-label': 'Skill for this chat', title: 'Skill for this chat', onchange: (e) => { p.skillId = e.target.value; savePanes(); renderAll(); } });
  const linksBtn = h('button', { class: 'links-btn', title: 'Connections to other chats — open the Flow page to connect', onclick: () => showView('flow') });
  const textarea = h('textarea', { rows: 1, placeholder: 'Ask anything, or attach files with +', 'aria-label': 'Message' });
  const autoGrow = () => { textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px'; };
  textarea.addEventListener('input', () => { autoGrow(); updateSendState(p); });
  textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  textarea.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(p, files); }
  });
  const fileInput = h('input', { type: 'file', multiple: true, class: 'hidden',
    accept: '.txt,.md,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.toml,.ini,.log,.html,.css,.js,.mjs,.jsx,.ts,.tsx,.py,.rb,.php,.java,.kt,.go,.rs,.c,.h,.cpp,.cs,.swift,.sql,.sh,.ps1,text/*,image/png,image/jpeg,image/gif,image/webp,application/pdf',
    onchange: (e) => { addFiles(p, [...e.target.files]); e.target.value = ''; } });
  const attachBtn = h('button', { type: 'button', class: 'plain', title: 'Add files (text, code, CSV, images, PDF)', 'aria-label': 'Add files', onclick: () => fileInput.click() }, icon('plus'));
  const sources = h('button', { type: 'button', class: 'pill hidden', title: 'Show or hide attached files', onclick: () => { p.trayOpen = !p.trayOpen; renderPending(p); } });
  // One round button: send when idle, stop while a reply is streaming.
  const sendBtn = h('button', { type: 'button', class: 'send-btn', onclick: () => (p.busy && !textarea.value.trim() && !p.pending.length ? p.abort && p.abort.abort() : submit()) });
  const tray = h('div', { class: 'tray hidden' });
  const modelBtn = h('button', { type: 'button', class: 'pill model-pill', 'aria-haspopup': 'menu', onclick: () => (document.getElementById('modelMenu') ? closeModelMenu() : openModelMenu(p)) });
  // Smart UI: formatted, interactive replies (headings, lists, tables, code with Copy, follow-up chips).
  const smartBtn = h('button', { type: 'button', class: 'smart-toggle', role: 'switch',
    onclick: () => { p.smart = !p.smart; savePanes(); renderPane(p); toast(p.smart ? 'Smart UI on: formatted, interactive replies' : 'Smart UI off: plain text replies', 'info', 2200); } },
    h('span', { class: 'st-track' }, h('span', { class: 'st-knob' })), icon('spark'), h('span', { class: 'st-label' }, 'Smart UI'));
  function submit() {
    const text = textarea.value.trim();
    if (!text && !p.pending.length) return;
    if (p.pending.some((a) => a.loading)) return;
    const files = p.pending.map(({ loading, ...a }) => a);
    p.pending = [];
    textarea.value = '';
    autoGrow();
    renderPending(p);
    send(p, text, null, false, files);
  }
  const composer = h('div', { class: 'composer' },
    h('div', { class: 'composer-box' },
      textarea,
      h('div', { class: 'toolbar' },
        h('label', { class: 'skill-wrap', title: 'Skill' }, icon('spark'), select),
        modelBtn,
        smartBtn,
        sources,
        h('span', { class: 'grow' }),
        attachBtn, sendBtn),
      tray),
    fileInput);

  const clearBtn = h('button', { class: 'plain', title: 'Clear this conversation', 'aria-label': 'Clear this conversation', onclick: () => { p.messages = []; p.queue.length = 0; savePanes(); renderPane(p); } }, icon('trash'));
  const removeBtn = h('button', { class: 'plain', title: 'Close this chat', 'aria-label': 'Close this chat', onclick: () => removePane(p) }, icon('x'));
  const no = h('span', { class: 'pane-no' });
  const el = h('section', { class: 'pane' },
    h('div', { class: 'pane-head' }, no, h('span', { class: 'grow' }), linksBtn, clearBtn, removeBtn),
    h('div', { class: 'msgs' }),
    composer);

  // Drag & drop files anywhere on the chat.
  let dragDepth = 0;
  el.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); dragDepth++; el.classList.add('dragover'); } });
  el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  el.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el.classList.remove('dragover'); } });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) addFiles(p, [...e.dataTransfer.files]);
  });

  p.ui = { el, no, select, linksBtn, sendBtn, clearBtn, removeBtn, textarea, tray, sources, modelBtn, smartBtn, msgs: $('.msgs', el), streamEl: null };
  renderPending(p);
  renderModelPill(p);
}

function renderAll() {
  const root = $('#panes');
  root.innerHTML = '';
  panes.forEach((p) => { if (!p.ui) buildPane(p); root.append(p.ui.el); renderPane(p); });
  root.dataset.count = panes.length;
  const add = $('#btnAddChat');
  add.disabled = panes.length >= MAX_PANES;
  add.title = add.disabled ? `Maximum ${MAX_PANES} chats` : 'Add another chat';
  renderSidebar();
  scheduleFlow();
}

function addPane() {
  if (panes.length >= MAX_PANES) return;
  const used = new Set(panes.map((p) => p.skillId));
  const p = newPane((skills.find((s) => !used.has(s.id)) || skills[0])?.id ?? null);
  panes.push(p);
  savePanes();
  renderAll();
  p.ui.el.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
  p.ui.textarea.focus();
}

async function removePane(p) {
  if (panes.length <= 1) return;
  if ((p.messages.length || p.busy) && !(await uiConfirm({
    title: `Remove ${label(p)}?`,
    message: 'Its conversation and its connections in Flow will be deleted. This can’t be undone.',
    confirmText: 'Remove chat', danger: true,
  }))) return;
  if (p.removed || panes.length <= 1) return;
  p.removed = true;
  p.queue.length = 0;
  if (p.abort) p.abort.abort();
  panes = panes.filter((o) => o !== p);
  panes.forEach((o) => { o.links = o.links.filter((l) => l.to !== p.id); });
  savePanes();
  renderAll();
}

function renderPane(p) {
  const ui = p.ui;
  if (!ui || p.removed) return;
  if (ui.wasBusy !== p.busy) { ui.wasBusy = p.busy; renderSidebar(); } // keep the "replying" dot in sync
  scheduleFlow();
  ui.no.textContent = label(p);
  ui.select.innerHTML = '';
  skills.forEach((s) => ui.select.append(h('option', { value: s.id, selected: s.id === p.skillId }, s.name)));
  ui.select.title = skillById(p.skillId)?.description || 'Skill for this chat';
  const targets = p.links.map((l) => paneById(l.to)).filter(Boolean);
  ui.linksBtn.innerHTML = '';
  ui.linksBtn.append(icon('link'), h('span', {}, targets.length ? `→ ${targets.map(label).join(', ')}` : 'Connect'));
  ui.linksBtn.classList.toggle('hidden', panes.length < 2);
  ui.removeBtn.classList.toggle('hidden', panes.length < 2);
  ui.sendBtn.innerHTML = '';
  ui.sendBtn.append(icon(p.busy ? 'stop' : 'send'));
  ui.sendBtn.title = p.busy ? 'Stop (type a message to queue it instead)' : 'Send';
  ui.sendBtn.setAttribute('aria-label', p.busy ? 'Stop' : 'Send');
  ui.clearBtn.disabled = p.busy;
  ui.smartBtn.classList.toggle('on', p.smart);
  ui.smartBtn.setAttribute('aria-checked', String(p.smart));
  ui.smartBtn.title = p.smart ? 'Smart UI is on: formatted, interactive replies. Click for plain text.' : 'Smart UI is off: plain text replies. Click for formatted, interactive replies.';
  renderModelPill(p);
  updateSendState(p);

  ui.msgs.innerHTML = '';
  ui.streamEl = null;
  if (!p.messages.length) {
    const skill = skillById(p.skillId);
    ui.msgs.append(h('div', { class: 'empty' },
      h('div', { class: 'welcome' }, h('span', {}, 'Welcome to'), h('span', { class: 'logo' }, icon('spark')), h('span', {}, label(p))),
      h('span', { class: 'empty-sub' }, skill ? `${skill.name} — ${skill.description || 'ready'}` : 'Pick a skill to start.'),
      h('div', { class: 'suggest' }, SUGGESTIONS.map((s) => h('button', { type: 'button', class: 'chip',
        onclick: () => { ui.textarea.value = s.prompt; ui.textarea.dispatchEvent(new Event('input')); ui.textarea.focus(); if (s.icon === 'file' && !p.pending.length) $('input[type=file]', ui.el).click(); } },
        h('span', { class: 'chip-icon', style: `color:${s.color}` }, icon(s.icon)), s.label)))));
  }
  p.messages.forEach((m, idx) => ui.msgs.append(renderMessage(p, m, idx)));
  if (p.queue.length) ui.msgs.append(h('div', { class: 'typing' }, `${p.queue.length} message(s) queued`));
  ui.msgs.scrollTop = ui.msgs.scrollHeight;
}

function metaLine(m) {
  const parts = [m.skillName, m.provider];
  if (m.model) parts.push(m.model);
  parts.push(`${m.ms} ms`);
  if (m.usage) parts.push(`${fmtNum(m.usage.input)}→${fmtNum(m.usage.output)} tok${m.usage.estimated ? ' (est.)' : ''}`);
  if (m.cost) parts.push(fmtCost(m.cost));
  if (m.tried > 1) parts.push(`failover ×${m.tried - 1}`);
  return parts.filter(Boolean).join(' · ');
}

const sourceName = (m) => m.fromName || (m.fromPane != null ? `Chat ${m.fromPane + 1}` : null);

function renderMessage(p, m, idx) {
  const box = h('div', { class: `msg ${m.role}` });
  const src = sourceName(m);
  if (src) box.append(h('div', { class: 'badge' }, `🔗 ${m.mode === 'forward' ? 'Forwarded' : m.auto ? 'Auto-verify' : 'Verify request'} from ${src}`), h('br'));
  if (m.attachments?.length) box.append(h('div', { class: 'files' }, m.attachments.map((a) => fileView(a))));

  if (m.role === 'error') {
    box.append(h('span', { class: 'text' }, m.content));
    if (/APIs page|Pick another model|switch to Auto/i.test(m.content)) {
      box.append(h('div', { class: 'msg-actions' },
        /APIs page/i.test(m.content) ? h('button', { class: 'ghost small', onclick: () => showView('apis') }, 'Open APIs') : null,
        /Auto/i.test(m.content) ? h('button', { class: 'ghost small', onclick: () => { p.providerId = 'auto'; savePanes(); renderPane(p); } }, 'Switch to Auto') : null));
    }
    return box;
  }
  if (m.role !== 'assistant') { box.append(h('span', { class: 'text' }, m.content)); return box; }

  box.classList.toggle('rich', p.smart);
  const text = h('div', { class: 'text' });
  box.append(text);

  if (m.streaming) {
    p.ui.streamEl = text;
    box.classList.add('streaming');
    if (m.content) fillAssistant(text, m.content, p.smart, true);
    else text.append(thinkingDots(m.failed?.length ? `Retrying after ${m.failed.join(', ')} failed` : 'Thinking'));
    return box;
  }
  fillAssistant(text, m.content, p.smart, false);

  if (p.smart && m.followups?.length && idx === p.messages.length - 1) {
    box.append(h('div', { class: 'followups' }, m.followups.map((q) => h('button', { type: 'button', class: 'fu-chip', onclick: () => send(p, q) }, icon('arrowRight'), q))));
  }
  box.append(h('div', { class: 'meta' }, metaLine(m)));
  const targets = panes.filter((t) => t !== p);
  const isLast = idx === p.messages.length - 1;
  box.append(h('div', { class: 'msg-actions' },
    h('button', { class: 'ghost small icon-text', title: 'Copy answer', onclick: (e) => copyText(m.content, e.currentTarget) }, icon('copy'), h('span', {}, 'Copy')),
    isLast && !p.busy ? h('button', { class: 'ghost small icon-text', title: 'Ask again for a new answer', onclick: () => regenerate(p) }, icon('refresh'), h('span', {}, 'Regenerate')) : null,
    targets.length ? h('span', { class: 'ma-label' }, 'Verify in:') : null,
    targets.map((t) => h('button', { class: 'ghost small', title: `Send this answer to ${label(t)} for checking`, onclick: () => forwardForVerify(p, idx, t) }, `${label(t)} (${skillById(t.skillId)?.name || '—'})`))));
  return box;
}

// Animated "thinking" dots shown until the first words arrive.
function thinkingDots(labelText) {
  return h('span', { class: 'thinking', role: 'status' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), h('span', { class: 'thinking-label' }, labelText));
}

// Fills an assistant bubble: formatted Markdown (Smart UI) or plain text, with a blinking caret while streaming.
function fillAssistant(target, content, smart, streaming) {
  target.replaceChildren();
  let shown = streaming && smart ? MD.hideFollowupTail(content) : content;
  // While streaming, close a half-written **bold** or `code` so raw markers don't flash.
  if (streaming && smart) {
    const outsideFences = shown.split(/```/).filter((_, i) => i % 2 === 0).join('');
    if ((outsideFences.match(/\*\*/g) || []).length % 2) shown += '**';
    else if ((outsideFences.replace(/\*\*/g, '').match(/`/g) || []).length % 2) shown += '`';
  }
  if (smart) {
    const md = MD.renderMarkdown(shown);
    target.append(md);
    if (streaming) {
      let last = md;
      while (last.lastElementChild && !/^(PRE|TABLE|HR|BR)$/.test(last.lastElementChild.tagName) && !last.lastElementChild.classList.contains('md-pre')) last = last.lastElementChild;
      (last.classList?.contains('md-pre') ? last.querySelector('code') : last).append(h('span', { class: 'caret' }));
    }
  } else {
    target.append(h('span', { class: 'plain' }, shown));
    if (streaming) target.append(h('span', { class: 'caret' }));
  }
}

// Ask the last question again (drops the last answer).
function regenerate(p) {
  if (p.busy) return;
  const lastUser = [...p.messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return;
  const at = p.messages.lastIndexOf(lastUser);
  p.messages = p.messages.slice(0, at);
  send(p, lastUser.content, null, false, lastUser.attachments || []);
}

function copyText(text, btn) {
  navigator.clipboard?.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); }).catch(() => {});
}

const paintQueued = new Set();
function paintStream(p, msg) {
  if (paintQueued.has(p)) return;
  paintQueued.add(p);
  requestAnimationFrame(() => {
    paintQueued.delete(p);
    const ui = p.ui;
    if (!ui || p.removed || !ui.streamEl) return;
    const nearBottom = ui.msgs.scrollHeight - ui.msgs.scrollTop - ui.msgs.clientHeight < 120;
    fillAssistant(ui.streamEl, msg.content, p.smart, true);
    if (nearBottom) ui.msgs.scrollTo({ top: ui.msgs.scrollHeight, behavior: 'smooth' });
  });
}

async function streamChat(skillId, history, signal, msg, p) {
  const res = await fetch('/api/chat/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ skillId, messages: history, providerId: p.providerId || 'auto', rich: !!p.smart }),
  });
  if (!res.ok) { const b = await res.json().catch(() => ({})); handleAuthError(res.status, b); throw new Error(b.error || res.statusText); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let final = null;
  const handle = (ev) => {
    if (ev.type === 'token') { msg.content += ev.text; paintStream(p, msg); }
    else if (ev.type === 'reset') { msg.content = ''; (msg.failed = msg.failed || []).push(ev.failed); renderPane(p); }
    else if (ev.type === 'done') final = ev;
    else if (ev.type === 'error') throw new Error(ev.error);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) handle(JSON.parse(line));
    }
  }
  if (buf.trim()) handle(JSON.parse(buf));
  if (!final) throw new Error('Connection closed before the answer finished');
  return final;
}

// trail = ids of the chats this message has already passed through (stops loops when chats are wired in a circle).
const MAX_HOPS = 6;
async function send(p, text, from = null, auto = false, attachments = [], trail = [], mode = null) {
  if (p.removed) return;
  if (p.busy) { p.queue.push([text, from, auto, attachments, trail, mode]); renderPane(p); return; }
  const skill = skillById(p.skillId);
  if (!skill) { markDelivered(from, p, false); return toast(`Pick a skill for ${label(p)} first.`, 'error'); }

  const userMsg = { role: 'user', content: text, fromName: from ? label(from) : undefined, auto, mode: mode || undefined, at: Date.now() };
  if (attachments.length) userMsg.attachments = attachments;
  p.messages.push(userMsg);
  const history = p.messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content || m.attachments?.length))
    .map(({ role, content, attachments: files }) => (files?.length
      ? { role, content, attachments: files.map(({ name, kind, type, data, text: t }) => ({ name, kind, type, data, text: t })) }
      : { role, content }));
  const msg = { role: 'assistant', content: '', streaming: true, skillName: skill.name, at: Date.now() };
  p.messages.push(msg);
  p.busy = true;
  p.abort = new AbortController();
  renderPane(p);

  let ok = false;
  try {
    const r = await streamChat(skill.id, history, p.abort.signal, msg, p);
    const { body, followups } = p.smart ? MD.splitFollowups(r.reply) : { body: r.reply, followups: [] };
    Object.assign(msg, { content: body || r.reply, followups, provider: r.provider, model: r.model, ms: r.ms, tried: r.tried, usage: r.usage, cost: r.cost });
    delete msg.streaming;
    queueProviderRefresh(); // usage numbers in the model menu
    delete msg.failed;
    ok = true;
  } catch (err) {
    const at = p.messages.indexOf(msg);
    const cancelled = err.name === 'AbortError';
    if (cancelled && msg.content) { delete msg.streaming; msg.content += '\n\n[stopped]'; Object.assign(msg, { provider: 'stopped', ms: Date.now() - msg.at }); }
    else {
      if (at >= 0) p.messages.splice(at, 1);
      p.messages.push({ role: 'error', content: cancelled ? 'Stopped.' : 'Error: ' + err.message });
    }
  } finally {
    p.busy = false;
    p.abort = null;
    if (!p.removed) { savePanes(); renderPane(p); }
  }
  if (auto) markDelivered(from, p, ok, msg.content);
  if (p.removed) return;

  // Pass the answer along every wire from this chat, skipping chats it has already been through.
  const idx = p.messages.indexOf(msg);
  const nextTrail = [...trail, p.id];
  if (ok && idx >= 0 && nextTrail.length <= MAX_HOPS) {
    for (const link of p.links) {
      const target = paneById(link.to);
      if (target && !nextTrail.includes(target.id)) sendAlong(p, idx, target, link, nextTrail);
    }
  }
  if (p.queue.length) send(p, ...p.queue.shift());
}

const snippet = (t, n = 160) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

function sendAlong(fromP, idx, toP, link, trail) {
  const answer = fromP.messages[idx].content;
  Object.assign(link, { count: (link.count || 0) + 1, lastAt: Date.now(), lastText: snippet(answer), lastReply: null, flowing: (link.flowing || 0) + 1 });
  savePanes();
  scheduleFlow();
  if (link.mode === 'forward') {
    const fromSkill = skillById(fromP.skillId)?.name || label(fromP);
    send(toP, `Input from "${fromSkill}" (${label(fromP)}):\n\n${answer}`, fromP, true, [], trail, 'forward');
  } else {
    forwardForVerify(fromP, idx, toP, true, trail);
  }
}

// Called when a chat finishes a message that arrived over a wire: stops the wire animation and remembers the reply.
function markDelivered(fromP, toP, ok, reply) {
  const link = fromP?.links?.find((l) => l.to === toP.id);
  if (!link) return;
  link.flowing = Math.max(0, (link.flowing || 1) - 1);
  if (ok && reply) link.lastReply = snippet(reply);
  savePanes();
  scheduleFlow();
}

function forwardForVerify(fromP, idx, toP, auto = false, trail = [fromP.id]) {
  const msgs = fromP.messages;
  const answer = msgs[idx].content;
  const qMsg = [...msgs.slice(0, idx)].reverse().find((m) => m.role === 'user');
  let question = qMsg?.content || '(no question)';
  if (qMsg?.attachments?.length) question += `\n(The question came with these files, not forwarded: ${qMsg.attachments.map((a) => a.name).join(', ')})`;
  const fromSkill = skillById(fromP.skillId)?.name || label(fromP);
  const text = `Please verify this answer from "${fromSkill}" (${label(fromP)}). ` +
    `List any errors, give a verdict, and a corrected answer if needed.\n\nQuestion:\n${question}\n\nAnswer:\n${answer}`;
  send(toP, text, fromP, auto, [], trail, auto ? 'verify' : null);
}

// ---------- export ----------
function exportChats() {
  const lines = [`# MultiChat export`, ``, `Exported ${new Date().toLocaleString()}`, ``];
  panes.forEach((p) => {
    lines.push(`## ${label(p)} — ${skillById(p.skillId)?.name || 'no skill'}`, ``);
    if (!p.messages.length) lines.push('_(empty)_', '');
    p.messages.filter((m) => !m.streaming).forEach((m) => {
      const src = sourceName(m);
      const who = m.role === 'user' ? (src ? `User (verify request from ${src})` : 'User') : m.role === 'assistant' ? 'Assistant' : 'Error';
      const when = m.at ? ` · ${new Date(m.at).toLocaleString()}` : '';
      lines.push(`**${who}**${when}`, '', m.content, '');
      if (m.role === 'assistant' && m.provider) lines.push(`> ${metaLine(m)}`, '');
    });
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `multichat-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- views (Chats / Skills / APIs are full pages, switched from the sidebar) ----------
let currentView = 'chats';
function showView(name) {
  if (!['chats', 'flow', 'skills', 'apis'].includes(name)) name = 'chats';
  currentView = name;
  $('#panes').classList.toggle('hidden', name !== 'chats');
  $('#view-skills').classList.toggle('hidden', name !== 'skills');
  $('#view-apis').classList.toggle('hidden', name !== 'apis');
  $('#view-flow').classList.toggle('hidden', name !== 'flow');
  hideTip();
  document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  const hash = name === 'chats' ? '' : `#/${name}`;
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname);
  clearInterval(apisTimer);
  if (name === 'flow') renderFlow();
  if (name === 'skills') renderSkillsPage();
  if (name === 'apis') { renderApisPage(); apisTimer = setInterval(refreshApis, 3000); }
}
const viewFromHash = () => (location.hash.replace(/^#\/?/, '') || 'chats');

function pageHeader(title, text, ...actions) {
  return h('header', { class: 'page-head' },
    h('div', {}, h('h2', {}, title), h('p', {}, text)),
    h('div', { class: 'row' }, actions));
}

function field(labelText, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, labelText), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

// ---------- skills page ----------
let skillEditing = null; // null = no form, {} = new skill, skill object = editing

function renderSkillsPage() {
  const root = $('#view-skills');
  root.innerHTML = '';
  const inner = h('div', { class: 'page-inner' });
  inner.append(pageHeader('Skills', 'A skill is what a bot is: its name, what it does, and the instructions it follows. Pick one per chat from the skill picker in the message box.',
    h('button', { onclick: () => { skillEditing = {}; renderSkillsPage(); } }, icon('plus'), 'Add skill')));
  if (skillEditing) inner.append(skillForm(skillEditing));
  inner.append(h('div', { class: 'card-grid' }, skills.map((s) => h('article', { class: 'item-card' },
    h('div', { class: 'item-head' }, h('span', { class: 'logo sm' }, icon('spark')), h('h3', {}, s.name)),
    h('p', { class: 'item-desc' }, s.description || 'No description'),
    s.instructions ? h('p', { class: 'item-instr' }, s.instructions) : null,
    h('div', { class: 'item-foot' },
      h('span', { class: 'tag' }, s.provider && s.provider !== 'auto' ? `API: ${s.provider}` : 'API: auto'),
      h('span', { class: 'grow' }),
      h('button', { class: 'ghost small', onclick: () => { skillEditing = s; renderSkillsPage(); window.scrollTo(0, 0); } }, 'Edit'),
      h('button', { class: 'ghost small danger', onclick: () => deleteSkill(s.id) }, 'Delete'))))));
  root.append(inner);
}

function skillForm(v) {
  const editing = !!v.id;
  const name = h('input', { value: v.name || '', placeholder: 'e.g. SQL Expert' });
  const desc = h('input', { value: v.description || '', placeholder: 'What this bot does' });
  const instr = h('textarea', { rows: 5, placeholder: 'Instructions / system prompt for the bot' });
  instr.value = v.instructions || '';
  const provider = h('select', {}, h('option', { value: 'auto' }, 'Auto (free & fastest first)'));
  api('/api/providers').then((list) => list.forEach((p) => provider.append(h('option', { value: p.id, selected: p.id === v.provider }, `${p.name}${p.state === 'ready' ? '' : ` (${p.state})`}`)))).catch(() => {});
  const close = () => { skillEditing = null; renderSkillsPage(); };
  return h('section', { class: 'form-panel' },
    h('div', { class: 'form-title' }, h('h3', {}, editing ? `Edit “${v.name}”` : 'New skill'), h('button', { class: 'plain', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'form-grid' },
      field('Name', name),
      field('API', provider, 'Auto lets the router pick; choose one to always use that API.'),
      h('div', { class: 'span-2' }, field('What it does', desc)),
      h('div', { class: 'span-2' }, field('Instructions', instr))),
    h('div', { class: 'form-actions' },
      h('button', { class: 'ghost', onclick: close }, 'Cancel'),
      h('button', { onclick: () => saveSkill(editing ? v : null, { name: name.value.trim(), description: desc.value.trim(), instructions: instr.value.trim(), provider: provider.value }) }, editing ? 'Save changes' : 'Add skill')));
}

async function persistSkills(next) {
  try {
    skills = await api('/api/skills', { method: 'POST', body: JSON.stringify(next) });
    panes.forEach((p) => { if (!skillById(p.skillId)) p.skillId = skills[0]?.id ?? null; });
    savePanes();
    renderAll();
    skillEditing = null;
    renderSkillsPage();
    toast('Skills saved', 'success', 2500);
  } catch (err) { toast('Could not save: ' + err.message, 'error'); }
}

function saveSkill(editing, data) {
  if (!data.name) return toast('Give the skill a name.', 'error');
  const next = editing
    ? skills.map((s) => (s.id === editing.id ? { ...s, ...data } : s))
    : [...skills, { id: data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36), ...data }];
  persistSkills(next);
}

async function deleteSkill(id) {
  if (skills.length <= 1) return toast('Keep at least one skill.', 'error');
  const s = skillById(id);
  if (!(await uiConfirm({ title: `Delete “${s?.name || 'this skill'}”?`, message: 'Chats using it switch to another skill.', confirmText: 'Delete skill', danger: true }))) return;
  persistSkills(skills.filter((x) => x.id !== id));
}

// ---------- APIs page ----------
let apisTimer = null;
let apiEditing = null; // null = no form, {} = new API, provider status object = editing
const testResults = {};
const TYPE_LABELS = { openai: 'OpenAI-compatible', anthropic: 'Anthropic Claude', gemini: 'Google Gemini' };
// Model names are examples; check each provider's current model list.
const PRESETS = [
  { label: 'Groq', name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', free: true },
  { label: 'OpenRouter', name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', free: true },
  { label: 'Together AI', name: 'Together AI', type: 'openai', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { label: 'Mistral', name: 'Mistral', type: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { label: 'DeepSeek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenAI', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', vision: true },
  { label: 'Ollama (local, no key)', name: 'Ollama', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', free: true },
  { label: 'Google Gemini', name: 'Gemini', type: 'gemini', model: 'gemini-3.8-flash', free: true },
  { label: 'Claude Opus 5.5', name: 'Claude Opus 5.5', type: 'anthropic', model: 'claude-opus-5-5', pricing: { input: 4, output: 20 } },
  { label: 'Claude Sonnet 5.5', name: 'Claude Sonnet 5.5', type: 'anthropic', model: 'claude-sonnet-5-5', pricing: { input: 2, output: 10 } },
  { label: 'Claude Haiku 5.5', name: 'Claude Haiku 5.5', type: 'anthropic', model: 'claude-haiku-5-5', pricing: { input: 0.1, output: 0.5 } },
];

function limitText(p) {
  const l = p.dailyLimit;
  if (!l) return `${p.today.requests} req · Unlimited`;
  const parts = [];
  if (l.requests) parts.push(`${p.today.requests}/${l.requests} req`);
  if (l.tokens) parts.push(`${fmtNum(p.today.tokens)}/${fmtNum(l.tokens)} tok`);
  return parts.join(' · ');
}

function renderApisPage() {
  const root = $('#view-apis');
  root.innerHTML = '';
  const inner = h('div', { class: 'page-inner' });
  inner.append(pageHeader('APIs', 'The router tries free APIs first, then ranks by speed and success rate. Failing APIs cool down and the next one takes over; APIs over their daily limit are skipped until tomorrow.',
    h('button', { class: 'ghost', title: 'Reset calls, latency, tokens and cost (daily quota counters are kept)', onclick: async () => {
      if (!(await uiConfirm({ title: 'Reset API stats?', message: 'Calls, success rate, latency, tokens and cost go back to zero for every API. Daily limit counters are kept.', confirmText: 'Reset stats', danger: true }))) return;
      await api('/api/providers/reset', { method: 'POST' }).then(() => toast('Stats reset', 'success', 2500)).catch((e) => toast(e.message, 'error'));
      refreshApis();
    } }, 'Reset stats'),
    h('button', { onclick: () => { apiEditing = {}; renderApiForm(); } }, icon('plus'), 'Add API')));
  inner.append(h('div', { id: 'apiSummary', class: 'summary' }), h('div', { id: 'apiForm' }), h('div', { id: 'apiGrid', class: 'card-grid' }));
  root.append(inner);
  renderApiForm();
  refreshApis();
}

async function refreshApis() {
  if (currentView !== 'apis') return;
  let list;
  try { list = await api('/api/providers'); providerList = list; panes.forEach((x) => { if (x.ui) renderModelPill(x); }); } catch (err) { $('#apiGrid').innerHTML = ''; $('#apiGrid').append(h('p', { class: 'note' }, 'Could not load: ' + err.message)); return; }
  const ready = list.filter((p) => p.state === 'ready').length;
  const summary = $('#apiSummary');
  summary.innerHTML = '';
  [['APIs ready', `${ready} of ${list.length}`], ['Total calls', fmtNum(list.reduce((n, p) => n + p.calls, 0))],
    ['Tokens used', fmtNum(list.reduce((n, p) => n + p.inputTokens + p.outputTokens, 0))], ['Total spend', fmtCost(list.reduce((n, p) => n + p.cost, 0))]]
    .forEach(([k, v]) => summary.append(h('div', { class: 'stat-tile' }, h('span', { class: 'stat-label' }, k), h('span', { class: 'stat-value' }, v))));

  const grid = $('#apiGrid');
  grid.innerHTML = '';
  list.forEach((p) => grid.append(apiCard(p)));
}

function apiCard(p) {
  const stateCls = p.state === 'ready' ? 'ok' : p.state === 'disabled' ? 'off' : 'warn';
  const stateText = p.state === 'no key' && p.keyHint ? `No key (set ${p.keyHint})` : p.state.charAt(0).toUpperCase() + p.state.slice(1);
  let host = '';
  try { host = p.baseUrl ? new URL(p.baseUrl).host : ''; } catch {}
  const test = testResults[p.id];
  const stat = (k, v) => h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, k), h('span', { class: 'stat-num' }, v));
  return h('article', { class: `item-card api-card${p.enabled ? '' : ' disabled'}` },
    h('div', { class: 'item-head' },
      h('div', { class: 'api-title' }, h('h3', {}, p.name), h('span', { class: 'api-sub' }, [TYPE_LABELS[p.type] || p.type, p.model, host].filter(Boolean).join(' · '))),
      h('span', { class: `status ${stateCls}` }, h('i', {}), stateText)),
    h('div', { class: 'row wrap' }, h('span', { class: 'tag' }, p.free ? 'Free' : 'Paid'), p.vision || p.type === 'anthropic' || p.type === 'gemini' ? h('span', { class: 'tag' }, 'Images') : null,
      p.type === 'anthropic' || p.type === 'gemini' ? h('span', { class: 'tag' }, 'PDF') : null),
    h('div', { class: 'stats' },
      stat('Calls', String(p.calls)), stat('Success', p.successRate === null ? '—' : p.successRate + '%'), stat('Avg latency', p.avgMs === null ? '—' : `${p.avgMs} ms`),
      stat('Tokens in / out', `${fmtNum(p.inputTokens)} / ${fmtNum(p.outputTokens)}`), stat('Cost', fmtCost(p.cost)), stat('Today', limitText(p))),
    p.lastError ? h('p', { class: 'api-error', title: p.lastError }, 'Last error: ' + p.lastError) : null,
    test ? h('p', { class: `api-test ${test.ok ? 'ok' : 'bad'}` }, test.pending ? 'Testing…' : test.ok ? `✓ Connected in ${test.ms} ms — replied “${test.reply}”` : `✗ ${test.error}`) : null,
    h('div', { class: 'item-foot' },
      h('label', { class: 'switch', title: p.enabled ? 'Turn off' : 'Turn on' },
        h('input', { type: 'checkbox', checked: p.enabled, onchange: (e) => updateApi(p.id, { enabled: e.target.checked }) }), h('span', { class: 'track' }), h('span', {}, p.enabled ? 'On' : 'Off')),
      h('span', { class: 'grow' }),
      h('button', { class: 'ghost small', onclick: () => testApi(p.id) }, 'Test'),
      h('button', { class: 'ghost small', onclick: () => { apiEditing = p; renderApiForm(); } }, 'Edit'),
      h('button', { class: 'ghost small danger', onclick: () => deleteApi(p) }, 'Delete')));
}

async function updateApi(id, patch) {
  try { await api(`/api/providers/${id}`, { method: 'PUT', body: JSON.stringify(patch) }); } catch (err) { toast(err.message, 'error'); }
  refreshApis();
}

async function testApi(id) {
  testResults[id] = { pending: true, ok: true };
  refreshApis();
  try { testResults[id] = await api(`/api/providers/${id}/test`, { method: 'POST' }); } catch (err) { testResults[id] = { ok: false, error: err.message }; }
  refreshApis();
}

async function deleteApi(p) {
  if (!(await uiConfirm({ title: `Delete “${p.name}”?`, message: 'Its settings and saved key are removed. Skills that use it switch to automatic selection.', confirmText: 'Delete API', danger: true }))) return;
  try {
    await api(`/api/providers/${p.id}`, { method: 'DELETE' });
    if (apiEditing && apiEditing.id === p.id) { apiEditing = null; renderApiForm(); }
    skills = await api('/api/skills');
    toast(`Deleted “${p.name}”`, 'success', 2500);
  } catch (err) { toast(err.message, 'error'); }
  refreshApis();
}

function renderApiForm() {
  const box = $('#apiForm');
  if (!box) return;
  box.innerHTML = '';
  if (!apiEditing) return;
  const v = apiEditing;
  const editing = !!v.id;
  const num = (val, ph) => h('input', { type: 'number', min: 0, step: 'any', value: val ?? '', placeholder: ph || '' });
  const f = {
    name: h('input', { value: v.name || '', placeholder: 'e.g. Groq', maxlength: 60 }),
    type: h('select', {}, Object.entries(TYPE_LABELS).map(([k, l]) => h('option', { value: k, selected: (v.type || 'openai') === k }, l))),
    baseUrl: h('input', { value: v.baseUrl || '', placeholder: 'https://api.example.com/v1' }),
    model: h('input', { value: v.model || '', placeholder: 'Model name' }),
    apiKey: h('input', { type: 'password', autocomplete: 'off', value: '',
      placeholder: editing && v.keySource === 'saved' ? '•••••••• saved — leave blank to keep' : editing && v.keySource?.startsWith('env:') ? `Using ${v.keySource} — leave blank to keep` : 'Paste the key, or env:VARIABLE_NAME' }),
    free: h('input', { type: 'checkbox', checked: !!v.free }),
    vision: h('input', { type: 'checkbox', checked: !!v.vision }),
    enabled: h('input', { type: 'checkbox', checked: v.enabled !== false }),
    priceIn: num(v.pricing?.input, 'e.g. 4'),
    priceOut: num(v.pricing?.output, 'e.g. 20'),
    limReq: num(v.dailyLimit?.requests, 'No limit'),
    limTok: num(v.dailyLimit?.tokens, 'No limit'),
    maxTokens: num(v.maxTokens, 'Default'),
  };
  const err = h('p', { class: 'form-error hidden' });
  const rows = {
    baseUrl: h('div', { class: 'span-2' }, field('Base URL', f.baseUrl, 'The address ending in /v1, from the provider\'s docs.')),
    model: field('Model', f.model),
    key: field('API key', f.apiKey, 'Stored on this computer in config/providers.json. Use env:NAME to read it from an environment variable instead.'),
    vision: h('label', { class: 'check' }, f.vision, 'Model can read images'),
  };
  const sync = () => {
    const t = f.type.value;
    rows.baseUrl.classList.toggle('hidden', t !== 'openai');
    rows.vision.classList.toggle('hidden', t !== 'openai');
  };
  f.type.addEventListener('change', sync);

  const preset = h('select', { onchange: (e) => {
    const pr = PRESETS[Number(e.target.value)];
    if (!pr) return;
    f.name.value = pr.name; f.type.value = pr.type; f.baseUrl.value = pr.baseUrl || ''; f.model.value = pr.model || '';
    f.free.checked = !!pr.free; f.vision.checked = !!pr.vision;
    f.priceIn.value = pr.pricing?.input ?? ''; f.priceOut.value = pr.pricing?.output ?? '';
    sync();
    f.apiKey.focus();
  } }, h('option', { value: '' }, 'Start from a preset…'), PRESETS.map((pr, i) => h('option', { value: i }, pr.label)));

  const close = () => { apiEditing = null; renderApiForm(); };
  const save = async () => {
    const body = {
      name: f.name.value.trim(), type: f.type.value, baseUrl: f.baseUrl.value.trim(), model: f.model.value.trim(),
      free: f.free.checked, vision: f.vision.checked, enabled: f.enabled.checked,
      pricing: { input: f.priceIn.value, output: f.priceOut.value },
      dailyLimit: { requests: f.limReq.value, tokens: f.limTok.value },
      maxTokens: f.maxTokens.value,
    };
    if (f.apiKey.value.trim()) body.apiKey = f.apiKey.value.trim();
    try {
      await api(editing ? `/api/providers/${v.id}` : '/api/providers', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) });
      close();
      refreshApis();
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  };

  box.append(h('section', { class: 'form-panel' },
    h('div', { class: 'form-title' }, h('h3', {}, editing ? `Edit “${v.name}”` : 'Add an API'), h('button', { class: 'plain', 'aria-label': 'Close', onclick: close }, icon('x'))),
    editing ? null : h('div', { class: 'preset-row' }, preset, h('span', { class: 'field-hint' }, 'Fills in the address and an example model. Check model names in the provider\'s docs.')),
    h('div', { class: 'form-grid' },
      field('Name', f.name), field('Type', f.type),
      rows.baseUrl, rows.model, rows.key,
      field('Price per 1M input tokens ($)', f.priceIn, 'Leave blank for free APIs.'), field('Price per 1M output tokens ($)', f.priceOut),
      field('Daily request limit', f.limReq), field('Daily token limit', f.limTok),
      field('Max reply tokens', f.maxTokens),
      h('div', { class: 'checks' }, h('label', { class: 'check' }, f.free, 'Free tier (tried first)'), rows.vision, h('label', { class: 'check' }, f.enabled, 'Turned on'))),
    err,
    h('div', { class: 'form-actions' }, h('button', { class: 'ghost', onclick: close }, 'Cancel'), h('button', { onclick: save }, editing ? 'Save changes' : 'Add API'))));
  sync();
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  f.name.focus();
}

// ---------- Flow page: chats as nodes, connections as wires (n8n style) ----------
const NODE_W = 230;
const NODE_H = 112;
const flow = { panX: 40, panY: 40, zoom: 1, built: false, selected: null, drag: null };
const MODE_TEXT = {
  verify: 'Verify — every new answer is sent here to be checked.',
  forward: 'Forward — every new answer becomes the next chat\'s input.',
};
let flowQueued = false;
function scheduleFlow() {
  if (flowQueued || currentView !== 'flow') return;
  flowQueued = true;
  requestAnimationFrame(() => { flowQueued = false; if (currentView === 'flow') renderFlow(); });
}

const ago = (t) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

function defaultPositions() {
  panes.forEach((p, i) => { if (!p.pos) p.pos = { x: 40 + (i % 3) * 380, y: 40 + Math.floor(i / 3) * 200 + (i % 2) * 50 }; });
}

// Left-to-right layout by connection depth.
function tidyFlow() {
  const level = new Map(panes.map((p) => [p.id, 0]));
  for (let pass = 0; pass < panes.length; pass++) {
    panes.forEach((p) => p.links.forEach((l) => {
      if (level.has(l.to) && level.get(l.to) <= level.get(p.id) && level.get(p.id) < panes.length) level.set(l.to, level.get(p.id) + 1);
    }));
  }
  const rows = {};
  panes.forEach((p) => {
    const lv = Math.min(level.get(p.id), panes.length - 1);
    rows[lv] = (rows[lv] || 0) + 1;
    p.pos = { x: 40 + lv * 380, y: 40 + (rows[lv] - 1) * 170 };
  });
  flow.panX = 40; flow.panY = 40; flow.zoom = 1;
  savePanes();
  renderFlow();
}

function buildFlowPage() {
  const root = $('#view-flow');
  root.innerHTML = '';
  const canvas = h('div', { class: 'flow-canvas', id: 'flowCanvas' });
  const layer = h('div', { class: 'flow-layer', id: 'flowLayer' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'flow-wires');
  svg.id = 'flowWires';
  svg.innerHTML = '<defs><marker id="arrow-verify" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" fill="#f59f00" stroke="none"/></marker><marker id="arrow-forward" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" fill="#4c6ef5" stroke="none"/></marker></defs>';
  layer.append(svg, h('div', { id: 'flowNodes' }), h('div', { id: 'flowEdgeBar', class: 'edge-bar hidden' }));
  canvas.append(layer);
  root.append(
    h('header', { class: 'flow-head' },
      h('div', {}, h('h2', {}, 'Flow'), h('p', {}, 'Drag from a chat\'s right dot to another chat to connect them. Hover a wire to see who is talking; click it to change or remove it.')),
      h('div', { class: 'row' },
        h('button', { class: 'ghost', onclick: tidyFlow, title: 'Arrange the chats left to right' }, 'Tidy up'),
        h('button', { class: 'ghost', onclick: () => { flow.zoom = 1; flow.panX = 40; flow.panY = 40; applyTransform(); }, title: 'Reset zoom and position' }, '100%'),
        h('button', { onclick: () => { addPane(); showView('flow'); } }, icon('plus'), 'Add chat'))),
    canvas,
    h('div', { class: 'flow-legend' },
      h('span', {}, h('i', { class: 'lg verify' }), 'Verify'), h('span', {}, h('i', { class: 'lg forward' }), 'Forward'),
      h('span', { class: 'muted' }, 'Scroll to zoom · drag the background to move · double-click a chat to open it')),
    h('div', { id: 'flowTip', class: 'flow-tip hidden', role: 'tooltip' }));
  wireCanvasEvents(canvas);
  flow.built = true;
}

function applyTransform() {
  const layer = $('#flowLayer');
  if (layer) layer.style.transform = `translate(${flow.panX}px, ${flow.panY}px) scale(${flow.zoom})`;
}

function renderFlow() {
  if (!flow.built || !$('#flowLayer')) buildFlowPage();
  defaultPositions();
  applyTransform();
  const nodesBox = $('#flowNodes');
  const existing = new Map([...nodesBox.children].map((el) => [el.dataset.id, el]));
  panes.forEach((p) => {
    let el = existing.get(p.id);
    if (!el) { el = createNode(p); nodesBox.append(el); }
    existing.delete(p.id);
    updateNode(el, p);
  });
  existing.forEach((el) => el.remove());
  drawWires();
}

function createNode(p) {
  const el = h('div', { class: 'flow-node', 'data-id': p.id, tabindex: 0 },
    h('span', { class: 'port in', title: 'Input: drop a wire here' }),
    h('div', { class: 'node-head' }, h('span', { class: 'node-no' }), h('span', { class: 'node-title' }), h('span', { class: 'node-dot' })),
    h('div', { class: 'node-skill' }),
    h('div', { class: 'node-last' }),
    h('span', { class: 'port out', title: 'Output: drag to another chat to connect' }));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openChat(p); });
  el.addEventListener('pointerenter', (e) => { if (!flow.drag) showTip(e, nodeTip(p)); });
  el.addEventListener('pointermove', (e) => { if (!flow.drag) moveTip(e); });
  el.addEventListener('pointerleave', hideTip);
  return el;
}

function openChat(p) {
  showView('chats');
  p.ui.el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  p.ui.textarea.focus();
}

function updateNode(el, p) {
  const skill = skillById(p.skillId);
  const last = [...p.messages].reverse().find((m) => (m.role === 'assistant' || m.role === 'user') && m.content && !m.streaming);
  el.style.left = p.pos.x + 'px';
  el.style.top = p.pos.y + 'px';
  el.classList.toggle('busy', p.busy);
  $('.node-no', el).textContent = String(panes.indexOf(p) + 1);
  $('.node-title', el).textContent = label(p);
  $('.node-skill', el).textContent = skill?.name || 'No skill';
  $('.node-last', el).textContent = p.busy ? 'Replying…' : last ? snippet(last.content, 70) : 'No messages yet';
}

function portPoint(p, side) {
  return { x: p.pos.x + (side === 'out' ? NODE_W : 0), y: p.pos.y + NODE_H / 2 };
}
function wirePath(a, b) {
  const dx = Math.max(60, Math.abs(b.x - a.x) / 2);
  return `M${a.x} ${a.y} C${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}
const svgEl = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

function drawWires() {
  const svg = $('#flowWires');
  if (!svg) return;
  [...svg.querySelectorAll('g.wire, path.temp')].forEach((n) => n.remove());
  panes.forEach((p) => p.links.forEach((link) => {
    const t = paneById(link.to);
    if (!t) return;
    const a = portPoint(p, 'out');
    const b = portPoint(t, 'in');
    const d = wirePath(a, b);
    const key = `${p.id}>${t.id}`;
    const g = svgEl('g', { class: `wire ${link.mode}${link.flowing ? ' flowing' : ''}${flow.selected === key ? ' selected' : ''}` });
    g.append(svgEl('path', { d, class: 'wire-line', 'marker-end': `url(#arrow-${link.mode === 'forward' ? 'forward' : 'verify'})` }), svgEl('path', { d, class: 'wire-hit' }));
    // Mode label at the middle of the wire.
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const text = `${link.mode === 'forward' ? 'Forward' : 'Verify'}${link.count ? ` · ${link.count}` : ''}`;
    const w = text.length * 6.2 + 16;
    g.append(svgEl('rect', { x: mx - w / 2, y: my - 10, width: w, height: 20, rx: 10, class: 'wire-label-bg' }));
    const lbl = svgEl('text', { x: mx, y: my + 4, class: 'wire-label', 'text-anchor': 'middle' });
    lbl.textContent = text;
    g.append(lbl);
    g.addEventListener('pointerenter', (e) => { if (!flow.drag) showTip(e, edgeTip(p, t, link)); });
    g.addEventListener('pointermove', (e) => { if (!flow.drag) moveTip(e); });
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('pointerdown', (e) => e.stopPropagation());
    g.addEventListener('click', (e) => { e.stopPropagation(); selectEdge(key, p, t, link, mx, my); });
    svg.append(g);
  }));
  if (flow.selected && !$('#flowEdgeBar').classList.contains('hidden')) {
    const [fromId, toId] = flow.selected.split('>');
    const p = paneById(fromId);
    const t = paneById(toId);
    const link = p?.links.find((l) => l.to === toId);
    if (!link || !t) closeEdgeBar();
    else { const a = portPoint(p, 'out'); const b = portPoint(t, 'in'); positionEdgeBar((a.x + b.x) / 2, (a.y + b.y) / 2); }
  }
}

// ---------- wire toolbar (click a wire) ----------
function selectEdge(key, p, t, link, mx, my) {
  flow.selected = key;
  const bar = $('#flowEdgeBar');
  bar.innerHTML = '';
  const modeBtn = (mode, text) => h('button', { class: `seg${link.mode === mode ? ' on' : ''}`, onclick: () => { link.mode = mode; savePanes(); selectEdge(key, p, t, link, mx, my); renderAll(); } }, text);
  bar.append(
    h('span', { class: 'edge-title' }, `${label(p)} → ${label(t)}`),
    h('div', { class: 'segs' }, modeBtn('verify', 'Verify'), modeBtn('forward', 'Forward')),
    h('button', { class: 'plain danger', title: 'Remove this connection', 'aria-label': 'Remove this connection', onclick: () => {
      p.links = p.links.filter((l) => l !== link);
      closeEdgeBar();
      savePanes();
      renderAll();
    } }, icon('trash')),
    h('button', { class: 'plain', 'aria-label': 'Close', onclick: closeEdgeBar }, icon('x')));
  bar.classList.remove('hidden');
  positionEdgeBar(mx, my);
  drawWires();
}
function positionEdgeBar(x, y) {
  const bar = $('#flowEdgeBar');
  bar.style.left = x + 'px';
  bar.style.top = (y + 18) + 'px';
}
function closeEdgeBar() {
  flow.selected = null;
  $('#flowEdgeBar')?.classList.add('hidden');
  drawWires();
}

// ---------- hover cards ----------
function edgeTip(p, t, link) {
  const ps = skillById(p.skillId)?.name || 'No skill';
  const ts = skillById(t.skillId)?.name || 'No skill';
  return h('div', {},
    h('div', { class: 'tip-route' }, h('b', {}, label(p)), ` · ${ps}`, h('span', { class: 'tip-arrow' }, ' → '), h('b', {}, label(t)), ` · ${ts}`),
    h('div', { class: 'tip-mode' }, MODE_TEXT[link.mode]),
    h('div', { class: 'tip-meta' }, link.flowing ? `Sending now… · passed ${link.count || 0} time(s)` : link.count ? `Passed ${link.count} time(s) · last ${ago(link.lastAt)}` : 'Nothing passed yet. Ask Chat ' + (panes.indexOf(p) + 1) + ' something to start.'),
    link.lastText ? h('div', { class: 'tip-msg' }, h('span', {}, `${label(p)} said`), `“${link.lastText}”`) : null,
    link.lastReply ? h('div', { class: 'tip-msg' }, h('span', {}, `${label(t)} replied`), `“${link.lastReply}”`) : null);
}

function nodeTip(p) {
  const skill = skillById(p.skillId);
  const incoming = panes.filter((o) => o.links.some((l) => l.to === p.id)).map((o) => `${label(o)} (${o.links.find((l) => l.to === p.id).mode})`);
  const outgoing = p.links.map((l) => paneById(l.to) && `${label(paneById(l.to))} (${l.mode})`).filter(Boolean);
  const last = [...p.messages].reverse().find((m) => m.role === 'assistant' && m.content && !m.streaming);
  return h('div', {},
    h('div', { class: 'tip-route' }, h('b', {}, label(p)), ` · ${skill?.name || 'No skill'}`),
    skill?.description ? h('div', { class: 'tip-mode' }, skill.description) : null,
    h('div', { class: 'tip-meta' }, `Receives from: ${incoming.join(', ') || 'nobody'}`),
    h('div', { class: 'tip-meta' }, `Sends to: ${outgoing.join(', ') || 'nobody'}`),
    h('div', { class: 'tip-meta' }, `${p.messages.filter((m) => m.role !== 'error').length} message(s)${p.busy ? ' · replying now' : ''}`),
    last ? h('div', { class: 'tip-msg' }, h('span', {}, 'Last answer'), `“${snippet(last.content)}”`) : null,
    h('div', { class: 'tip-hint' }, 'Double-click to open this chat'));
}

function showTip(e, content) {
  const tip = $('#flowTip');
  tip.innerHTML = '';
  tip.append(content);
  tip.classList.remove('hidden');
  moveTip(e);
}
function moveTip(e) {
  const tip = $('#flowTip');
  const pad = 14;
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
  if (y + hgt > window.innerHeight - 8) y = e.clientY - hgt - pad;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
function hideTip() { $('#flowTip')?.classList.add('hidden'); }

// ---------- pointer handling: drag nodes, draw wires, pan, zoom ----------
function toLayer(e) {
  const r = $('#flowCanvas').getBoundingClientRect();
  return { x: (e.clientX - r.left - flow.panX) / flow.zoom, y: (e.clientY - r.top - flow.panY) / flow.zoom };
}

function wireCanvasEvents(canvas) {
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const nodeEl = e.target.closest('.flow-node');
    const out = e.target.closest('.port.out');
    hideTip();
    if (out && nodeEl) {
      flow.drag = { type: 'wire', from: paneById(nodeEl.dataset.id) };
    } else if (nodeEl) {
      const p = paneById(nodeEl.dataset.id);
      const pt = toLayer(e);
      flow.drag = { type: 'node', p, el: nodeEl, dx: pt.x - p.pos.x, dy: pt.y - p.pos.y, moved: false };
    } else if (!e.target.closest('.edge-bar')) {
      flow.drag = { type: 'pan', x: e.clientX - flow.panX, y: e.clientY - flow.panY };
      closeEdgeBar();
    } else return;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const d = flow.drag;
    if (!d) return;
    if (d.type === 'pan') { flow.panX = e.clientX - d.x; flow.panY = e.clientY - d.y; applyTransform(); return; }
    const pt = toLayer(e);
    if (d.type === 'node') {
      d.p.pos = { x: Math.round(pt.x - d.dx), y: Math.round(pt.y - d.dy) };
      d.el.style.left = d.p.pos.x + 'px';
      d.el.style.top = d.p.pos.y + 'px';
      d.moved = true;
      drawWires();
    } else if (d.type === 'wire') {
      drawWires();
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.flow-node');
      document.querySelectorAll('.flow-node.drop').forEach((n) => n.classList.remove('drop'));
      if (target && target.dataset.id !== d.from.id) target.classList.add('drop');
      $('#flowWires').append(svgEl('path', { d: wirePath(portPoint(d.from, 'out'), pt), class: 'temp' }));
    }
  });

  const end = (e) => {
    const d = flow.drag;
    if (!d) return;
    flow.drag = null;
    canvas.classList.remove('dragging');
    document.querySelectorAll('.flow-node.drop').forEach((n) => n.classList.remove('drop'));
    if (d.type === 'node' && d.moved) savePanes();
    if (d.type === 'wire') {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.flow-node');
      const to = target && paneById(target.dataset.id);
      if (to && to !== d.from && !d.from.links.some((l) => l.to === to.id)) {
        d.from.links.push({ to: to.id, mode: 'verify', count: 0 });
        savePanes();
        renderAll();
      }
      drawWires();
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // Pointer capture sends the double-click to the canvas, so find the node under the pointer here.
  canvas.addEventListener('dblclick', (e) => {
    const n = document.elementFromPoint(e.clientX, e.clientY)?.closest('.flow-node');
    if (n) openChat(paneById(n.dataset.id));
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const z = Math.min(1.6, Math.max(0.4, flow.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    flow.panX = mx - ((mx - flow.panX) / flow.zoom) * z;
    flow.panY = my - ((my - flow.panY) / flow.zoom) * z;
    flow.zoom = z;
    applyTransform();
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (currentView !== 'flow' || !flow.selected || e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') closeEdgeBar();
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const [fromId, toId] = flow.selected.split('>');
      const p = paneById(fromId);
      if (p) p.links = p.links.filter((l) => l.to !== toId);
      closeEdgeBar();
      savePanes();
      renderAll();
    }
  });
}

// ---------- init ----------
document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
window.addEventListener('hashchange', () => showView(viewFromHash()));
$('#btnExport').addEventListener('click', exportChats);
$('#btnAddChat').addEventListener('click', () => { showView('chats'); addPane(); });
$('#btnTheme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#btnCollapse').addEventListener('click', toggleSidebar);
$('#btnSignOut').addEventListener('click', signOut);
setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

(async function init() {
  renderAll();
  let session;
  try { session = await api('/api/session'); } catch (err) { toast('Server not reachable: ' + err.message + '. Is it running?', 'error', 0); return; }
  if (session.mode === 'locked') return showGate('setup');
  if (!session.authed) return showGate('login');
  if (session.mode === 'password') $('#btnSignOut').classList.remove('hidden');
  if (session.storage && !session.storage.persistent) {
    toast(session.storage.onVercel
      ? 'On Vercel, APIs and skills you add here are temporary and reset when the server restarts. Keep API keys in Vercel environment variables.'
      : 'Changes can’t be saved on this server’s disk; they last until it restarts.', 'info', 15000);
  }
  try { skills = await api('/api/skills'); } catch (err) { toast('Could not load skills: ' + err.message, 'error', 0); return; }
  await loadProviders();
  providersTimer = setInterval(() => { if (currentView === 'chats' && !document.hidden) loadProviders(); }, 30000);
  if (!providerList.some((x) => x.state === 'ready')) toast('No API is ready yet. Open APIs to add one (Groq and Gemini have free tiers).', 'info', 12000);
  panes.forEach((p, i) => { if (!skillById(p.skillId)) p.skillId = skills[i % skills.length]?.id ?? null; });
  savePanes();
  renderAll();
  showView(viewFromHash());
})();
