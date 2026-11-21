// Minimal JSON / Server-Sent-Events POST client on Node's built-in http(s). Works on Node 16 (no fetch needed).
const http = require('http');
const https = require('https');

function httpError(status, text) {
  let msg = text;
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0] && j[0].error : j.error;
    msg = (e && (e.message || (typeof e === 'string' ? e : JSON.stringify(e)))) || j.message || text;
  } catch {}
  const err = new Error(`HTTP ${status}: ${String(msg).slice(0, 300)}`);
  err.status = status;
  return err;
}

/**
 * POST JSON. Without onEvent: resolves with the parsed JSON body.
 * With onEvent: parses an SSE stream and calls onEvent(parsedData) per `data:` line; resolves when the stream ends.
 * If onEvent throws, the request is aborted and the promise rejects with that error.
 */
function post(url, headers, body, { onEvent, signal, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const data = JSON.stringify(body);
    const req = lib.request(u, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      res.setEncoding('utf8');
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('Provider closed the connection')));
      let text = '';
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.on('data', (c) => { text += c; });
        res.on('end', () => fail(httpError(res.statusCode, text)));
        return;
      }
      if (!onEvent) {
        res.on('data', (c) => { text += c; });
        res.on('end', () => { try { done(JSON.parse(text)); } catch { fail(new Error('Invalid JSON from provider')); } });
        return;
      }
      let buf = '';
      res.on('data', (chunk) => {
        if (settled) return;
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try { onEvent(JSON.parse(payload)); } catch (err) { fail(err); req.destroy(); return; }
        }
      });
      res.on('end', () => done());
    });
    req.setTimeout(timeoutMs, () => { fail(new Error('Provider timed out')); req.destroy(); });
    req.on('error', (err) => fail(err.name === 'AbortError' ? Object.assign(new Error('Aborted'), { aborted: true }) : err));
    req.end(data);
  });
}

module.exports = { post };
