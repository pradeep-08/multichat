# MultiChat — Plan

Minimal app: **3 chat bots running side by side**, each with its own conversation and its own **skill**.
Any bot answer can be **forwarded to another bot to verify**. Bots call LLM APIs through a **router**
that picks a free/healthy provider first and ranks by measured performance.

## 1. Goals / success criteria
| # | Requirement | Done when |
|---|---|---|
| R1 | 3 simultaneous chats, separate history | Messages sent in all 3 panes run in parallel, no cross-talk |
| R2 | Skills list (name, what it does, instructions) | Add / edit / delete skills in the UI, saved to `data/skills.json` |
| R3 | Assign a skill per chat | Dropdown per pane; switch any time |
| R4 | Cross-verify | "Verify in Chat N" on any answer sends question+answer to that pane |
| R5 | Multiple APIs, auto-select | Router prefers free → healthy → fastest; fails over on error/429 |
| R6 | Performance-based ranking | Per-provider calls, success %, avg latency shown in the APIs panel |
| R7 | Minimal | No framework, no npm dependencies, one `npm start` |

## 2. Architecture
```
Browser (public/)                     Node server (server.js)
┌──────────┬──────────┬──────────┐    /api/skills   GET/POST -> data/skills.json
│ Chat 1   │ Chat 2   │ Chat 3   │    /api/chat     POST {skillId, messages}
│ skill A  │ skill B  │ skill C  │ ─►      └─► src/router.js ─► adapter (openai | anthropic | gemini)
└──────────┴──────────┴──────────┘    /api/providers GET -> live stats
   "Verify in Chat N" = forward Q+A as a new message to another pane
```
- API keys live **only on the server** (`config/providers.json`, git-ignored), never in the browser.
- Chat history is kept per pane in the browser (localStorage); the server is stateless per request.

## 3. Router logic (`src/router.js`)
1. Candidates = enabled providers not in cooldown (skill can pin one provider; default `auto`).
2. Sort: **free first**, then score = `avgLatency × (1 + 5 × failRate)` (untried providers get tried early).
3. Try in order; on error → record failure, **cooldown** (60 s, or 5 min on 429/quota), try next.
4. Return reply + which provider answered + latency (shown under each message).

## 4. Phases
| Phase | Scope | Status |
|---|---|---|
| 1 | UI: 3 panes, skills manager, verify-forwarding, APIs panel, router | ✅ done |
| 2 | Real adapters: OpenAI-compatible (Groq, OpenRouter, Together, Gemini-compat, local Ollama), Anthropic Claude, Gemini native. Built on Node's `https` module, so Node 16 works | ✅ done |
| 3 | Streaming replies, token/cost tracking per provider, daily quota limits for free tiers (stats persisted in `data/usage.json`) | ✅ done |
| 4 | Auto-verify toggle per pane (original questions only, so no ping-pong loops), queue when a pane is busy, Stop button, Markdown export | ✅ done |
| 5 | Production: mocks removed, Smart UI replies, per-chat model picker with usage, password sign-in, security headers, health check | ✅ done |

## 5. Provider config format (phase 2) — `config/providers.json`
```json
[
  { "id": "groq-free", "type": "openai", "free": true,  "enabled": true,
    "baseUrl": "https://api.groq.com/openai/v1", "model": "<model>", "apiKey": "env:GROQ_API_KEY" },
  { "id": "claude",    "type": "anthropic", "free": false, "enabled": true,
    "model": "claude-opus-5-5", "apiKey": "env:ANTHROPIC_API_KEY" }
]
```
`env:NAME` reads the key from an environment variable, which keeps keys out of the file.
Providers whose key is missing are skipped and shown as "no key" in the APIs panel.

Optional fields: `pricing` ($ per 1M tokens, e.g. `{ "input": 4, "output": 20 }`), `dailyLimit` (`{ "requests": N, "tokens": N }`, resets at local midnight),
`maxTokens`, `effort` (Anthropic), `headers` (extra HTTP headers). Anthropic models that support it get server-side refusal fallback
(`fallbacks: "default"`); set `"fallbacks": false` on the provider to turn it off.

Quick start with real APIs (PowerShell): `$env:GROQ_API_KEY="..."; $env:ANTHROPIC_API_KEY="..."; npm start`

## 6. Risks / decisions
- **Free tiers rate-limit hard.** Cooldowns and failover handle this. Expect slower or variable answers.
- **Different models give different quality.** If the verifier runs on another provider, it acts as an independent check.
- **Node 16 has no built-in fetch.** Adapters use the built-in `https` module instead, so Node 16 works. Node 16 is end-of-life, so still plan an upgrade to Node 20/22 LTS.
- **Free-tier limits and model names in `providers.example.json` are placeholders.** Check each provider's current limits and model list and adjust.
- **No login.** This is a single-user local app. Add auth before deploying it anywhere.
