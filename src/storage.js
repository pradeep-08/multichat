// Where MultiChat keeps its data (API settings, skills, usage stats).
//
// Local (default): config/providers.json, data/skills.json, data/usage.json inside the project.
// DATA_DIR=/some/folder: all three files live in that folder (use a persistent disk on Render, Railway, Fly.io ...).
// Vercel: the disk is read-only except /tmp, which is wiped often, so data goes to /tmp/multichat and is marked
// as temporary. Settings that must survive belong in the repo files and environment variables there.
//
// If a write fails (read-only disk), the value is kept in memory so the app keeps working, and storage is
// reported as temporary instead of crashing.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const onVercel = !!process.env.VERCEL;
const DATA_DIR = process.env.DATA_DIR || (onVercel ? '/tmp/multichat' : null);

const FILES = {
  providers: {
    file: DATA_DIR ? path.join(DATA_DIR, 'providers.json') : path.join(ROOT, 'config', 'providers.json'),
    seeds: [path.join(ROOT, 'config', 'providers.json'), path.join(ROOT, 'config', 'providers.example.json')],
  },
  skills: {
    file: DATA_DIR ? path.join(DATA_DIR, 'skills.json') : path.join(ROOT, 'data', 'skills.json'),
    seeds: [path.join(ROOT, 'data', 'skills.json'), path.join(ROOT, 'data', 'skills.example.json')],
  },
  usage: {
    file: DATA_DIR ? path.join(DATA_DIR, 'usage.json') : path.join(ROOT, 'data', 'usage.json'),
    seeds: [],
  },
};

const memory = {};      // values whose write failed
const loadedFrom = {};  // which file each value came from (for the startup log)
let writeError = null;

const clone = (v) => JSON.parse(JSON.stringify(v));

// Optional environment variables with JSON content, used when no saved file exists yet.
// SKILLS_JSON lets you deploy your own (private) skills to Vercel without putting them in the repo.
const ENV_SEEDS = { skills: 'SKILLS_JSON', providers: 'PROVIDERS_JSON' };

function read(name, fallback) {
  if (name in memory) return clone(memory[name]);
  const envName = ENV_SEEDS[name];
  const sources = [FILES[name].file, ...(envName && process.env[envName] ? [`env:${envName}`] : []), ...FILES[name].seeds];
  for (const f of sources) {
    if (f.startsWith('env:')) {
      try { const value = JSON.parse(process.env[f.slice(4)]); loadedFrom[name] = f; return value; } catch { throw new Error(`The ${f.slice(4)} environment variable is not valid JSON`); }
    }
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    try {
      const value = JSON.parse(text);
      loadedFrom[name] = f;
      return value;
    } catch {
      throw new Error(`${path.relative(ROOT, f) || f} is not valid JSON`);
    }
  }
  loadedFrom[name] = null;
  return fallback;
}

function write(name, value) {
  const f = FILES[name].file;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(value, null, 2));
    delete memory[name];
    loadedFrom[name] = f;
  } catch (err) {
    memory[name] = clone(value);
    if (!writeError) console.warn(`Could not save ${name} to ${f} (${err.code || err.message}); keeping changes in memory only.`);
    writeError = err.code || err.message;
  }
}

function describe(name) {
  if (name in memory) return 'memory (not saved)';
  const f = loadedFrom[name];
  if (f && f.startsWith('env:')) return `${f.slice(4)} environment variable`;
  return f ? path.relative(ROOT, f) || f : 'built-in defaults';
}

// persistent = changes made in the UI survive a restart.
function status() {
  return { persistent: !onVercel && !writeError, onVercel, dataDir: DATA_DIR, writeError };
}

module.exports = { read, write, describe, status };
