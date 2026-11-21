// Anthropic Claude Messages API over raw HTTPS with streaming (no SDK: the app is dependency-free by design).
const { post } = require('../http');
const { textWithFiles, binaries } = require('../attachments');

const API_URL = 'https://api.anthropic.com/v1/messages';
// Server-side refusal fallback: re-runs a declined request on a fallback model inside the same call.
const SUPPORTS_FALLBACKS = /^claude-(fable-5|opus-5|sonnet-5-5)/;

module.exports = async function anthropic(p, { system, messages, onToken, signal }) {
  if (!p.apiKey) throw new Error('Missing API key');
  const model = p.model || 'claude-opus-5-5';
  const headers = { 'x-api-key': p.apiKey, 'anthropic-version': '2026-10-21' };
  const apiMessages = messages.map((m) => {
    const files = binaries(m);
    if (m.role !== 'user' || !files.length) return { role: m.role, content: textWithFiles(m) };
    return {
      role: 'user',
      content: [
        ...files.map((a) => a.kind === 'pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name }
          : { type: 'image', source: { type: 'base64', media_type: a.type, data: a.data } }),
        { type: 'text', text: textWithFiles(m) },
      ],
    };
  });
  const body = { model, max_tokens: p.maxTokens || 16000, stream: true, messages: apiMessages };
  if (system) body.system = system;
  if (p.effort) body.output_config = { effort: p.effort };
  if (p.fallbacks !== false && SUPPORTS_FALLBACKS.test(model)) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }

  let text = '';
  let inputTokens = null;
  let outputTokens = null;
  let stopReason = null;
  await post(API_URL, headers, body, {
    signal,
    onEvent: (ev) => {
      switch (ev.type) {
        case 'message_start': {
          const u = ev.message && ev.message.usage;
          if (u) inputTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          break;
        }
        case 'content_block_delta':
          if (ev.delta && ev.delta.type === 'text_delta') { text += ev.delta.text; onToken(ev.delta.text); }
          break;
        case 'message_delta':
          if (ev.usage && ev.usage.output_tokens != null) outputTokens = ev.usage.output_tokens;
          if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
          break;
        case 'error': {
          const e = ev.error || {};
          const status = e.type === 'rate_limit_error' ? 429 : e.type === 'overloaded_error' ? 529 : undefined;
          throw Object.assign(new Error(e.message || 'Stream error'), { status });
        }
      }
    },
  });

  if (stopReason === 'refusal') {
    if (!text) throw Object.assign(new Error('Request declined by the model safety system'), { noCooldown: true });
    text += '\n\n[Response stopped: declined by the model safety system]';
  } else if (stopReason === 'max_tokens') {
    text += '\n\n[Response cut off: max_tokens reached]';
  }
  if (!text) throw new Error('Empty reply');
  return { text, inputTokens, outputTokens };
};
module.exports.supports = () => ({ image: true, pdf: true });
