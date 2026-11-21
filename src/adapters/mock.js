// Mock provider — no API key needed. Simulates latency, streaming, token usage and random failures.
const { textWithFiles } = require('../attachments');
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Aborted'), { aborted: true })); }, { once: true });
});

module.exports = async function mock(provider, { skill, messages, onToken, signal }) {
  await sleep(300 + Math.random() * 700, signal);
  if (Math.random() < (provider.failRate || 0)) {
    throw Object.assign(new Error('Simulated rate limit'), { status: 429 });
  }
  const lastMsg = messages[messages.length - 1];
  const last = lastMsg.content || '';
  const preview = last.length > 160 ? last.slice(0, 160) + '…' : last;
  const files = (lastMsg.attachments || []).map((a) => `${a.name} (${a.kind}${a.kind === 'text' && a.text ? `, ${a.text.length} chars` : ''})`);
  const filesNote = files.length ? `\nReceived ${files.length} file(s): ${files.join(', ')}.` : '';
  const text = /^Please verify/i.test(last)
    ? `[${skill.name} · mock] Verification result: PARTLY CORRECT (mock).\nReal verification will happen once an API is connected.\n\nChecked text:\n"${preview}"`
    : `[${skill.name} · mock] You said: "${preview}"${filesNote}\n(Turn ${Math.ceil(messages.length / 2)} of this chat. Add an API key — see the APIs panel — for real answers.)`;

  for (const piece of text.match(/\S+\s*/g) || [text]) {
    await sleep(15 + Math.random() * 25, signal);
    onToken(piece);
  }
  const inputChars = messages.reduce((n, m) => n + textWithFiles(m).length, 0) + (skill.instructions || '').length;
  return { text, inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(text.length / 4) };
};
module.exports.supports = () => ({ image: true, pdf: true });
