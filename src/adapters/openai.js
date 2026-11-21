// OpenAI-compatible Chat Completions (Groq, OpenRouter, Together, Mistral, DeepSeek, Gemini-compat, local Ollama/LM Studio ...).
const { post } = require('../http');
const { textWithFiles, binaries } = require('../attachments');

module.exports = async function openai(p, { system, messages, onToken, signal }) {
  if (!p.baseUrl || !p.model) throw new Error('Provider needs baseUrl and model');
  const headers = { ...(p.headers || {}) };
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
  const body = {
    model: p.model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map((m) => {
        const images = binaries(m).filter((a) => a.kind === 'image');
        if (m.role !== 'user' || !images.length) return { role: m.role, content: textWithFiles(m) };
        return {
          role: 'user',
          content: [
            { type: 'text', text: textWithFiles(m) },
            ...images.map((a) => ({ type: 'image_url', image_url: { url: `data:${a.type};base64,${a.data}` } })),
          ],
        };
      }),
    ],
    stream: true,
    stream_options: { include_usage: true },
  };
  if (p.maxTokens) body.max_tokens = p.maxTokens;

  let text = '';
  let usage = null;
  await post(p.baseUrl.replace(/\/+$/, '') + '/chat/completions', headers, body, {
    signal,
    onEvent: (ev) => {
      if (ev.error) throw Object.assign(new Error(ev.error.message || 'Provider stream error'), { status: ev.error.code === 429 ? 429 : undefined });
      const delta = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content;
      if (delta) { text += delta; onToken(delta); }
      if (ev.usage) usage = ev.usage;
    },
  });
  if (!text) throw new Error('Empty reply');
  return { text, inputTokens: usage ? usage.prompt_tokens : null, outputTokens: usage ? usage.completion_tokens : null };
};
// Images only for vision models (set "vision": true on the provider). PDFs are not part of this API format.
module.exports.supports = (p) => ({ image: !!p.vision, pdf: false });
