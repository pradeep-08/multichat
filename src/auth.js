// Password protection for deployed copies.
//
// Set APP_PASSWORD on the host to require a login. Sessions are signed cookies (no server-side state), so they
// also work on serverless hosts like Vercel. Changing APP_PASSWORD (or SESSION_SECRET) signs everyone out.
//
// Access modes:
//   open     – running on this computer only (127.0.0.1) without a password: no login needed.
//   password – APP_PASSWORD is set: every API call needs a valid session.
//   locked   – reachable from the internet/network but no APP_PASSWORD: the API refuses to run,
//              so nobody can spend your API keys or change settings.
const crypto = require('crypto');

const PASSWORD = process.env.APP_PASSWORD || '';
const COOKIE = 'mc_session';
const MAX_AGE = 7 * 24 * 3600; // 7 days
const KEY = crypto.createHash('sha256').update(`multichat:${PASSWORD}:${process.env.SESSION_SECRET || ''}`).digest();

const DEPLOYED = !!(process.env.VERCEL || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME
  || process.env.K_SERVICE || process.env.REQUIRE_LOGIN);
const isLocalHost = (host) => !host || host === '127.0.0.1' || host === 'localhost' || host === '::1';

function accessMode(host) {
  if (PASSWORD) return 'password';
  if (DEPLOYED || !isLocalHost(host)) return 'locked';
  return 'open';
}

const mac = (exp) => crypto.createHmac('sha256', KEY).update(String(exp)).digest('base64url');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function hasSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now() / 1000)) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function checkPassword(input) {
  if (!PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.socket?.encrypted;

function sessionCookie(req) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return `${COOKIE}=${exp}.${mac(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${isHttps(req) ? '; Secure' : ''}`;
}

function clearCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
}

module.exports = { accessMode, hasSession, checkPassword, sessionCookie, clearCookie };
