// Google Gemini native API (generativelanguage.googleapis.com) with SSE streaming.
const { post } = require('../http');
const { textWithFiles, binaries } = require('../attachments');

module.exports = async function gemini(p, { system, messages, onToken, signal }) {
  if (!p.apiKey) throw new Error('Missing API key');
  if (!p.model) throw new Error('Provider needs a model');
  const base = (p.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const url = `${base}/models/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse`;
  const body = {
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(m.role === 'user' ? binaries(m).map((a) => ({ inlineData: { mimeType: a.kind === 'pdf' ? 'application/pdf' : a.type, data: a.data } })) : []),
        { text: textWithFiles(m) },
      ],
    })),
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (p.maxTokens) body.generationConfig = { maxOutputTokens: p.maxTokens };

  let text = '';
  let usage = null;
  await post(url, { 'x-goog-api-key': p.apiKey }, body, {
    signal,
    onEvent: (ev) => {
      if (ev.error) throw Object.assign(new Error(ev.error.message || 'Stream error'), { status: ev.error.code });
      if (ev.promptFeedback && ev.promptFeedback.blockReason) {
        throw Object.assign(new Error('Blocked by Gemini: ' + ev.promptFeedback.blockReason), { noCooldown: true });
      }
      const parts = (ev.candidates && ev.candidates[0] && ev.candidates[0].content && ev.candidates[0].content.parts) || [];
      for (const part of parts) if (part.text && !part.thought) { text += part.text; onToken(part.text); }
      if (ev.usageMetadata) usage = ev.usageMetadata;
    },
  });
  if (!text) throw new Error('Empty reply');
  return {
    text,
    inputTokens: usage ? usage.promptTokenCount : null,
    outputTokens: usage ? (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0) : null,
  };
};
module.exports.supports = () => ({ image: true, pdf: true });
