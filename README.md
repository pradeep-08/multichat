# MultiChat

Several AI chats side by side. Each chat has its own **skill** (role and instructions), answers can be
**verified or forwarded** between chats (drawn as wires on the **Flow** page), and a router picks a free,
healthy and fast **API** for every message, failing over when one breaks.

- 1 to 6 chats, streaming replies, file attachments (text, code, CSV, images, PDF)
- APIs: OpenAI-compatible (Groq, OpenRouter, Together, Mistral, DeepSeek, OpenAI, Ollama), Anthropic Claude, Google Gemini, plus a mock API for testing
- APIs page: add, edit, test and delete APIs; tokens, cost and daily limits per API
- Light and dark theme
- No npm dependencies

## Run on your computer

Requires Node.js 16 or newer.

```bash
npm start
```

Open http://localhost:3000. The server only accepts connections from this computer, so no password is needed.

Add API keys on the **APIs** page (they are saved in `config/providers.json`, which git ignores), or as
environment variables that the provider config refers to, for example `env:GROQ_API_KEY`:

```powershell
$env:GROQ_API_KEY="..."; $env:ANTHROPIC_API_KEY="..."; npm start
```

## Deploy

> **Set `APP_PASSWORD` on every hosted copy.** The app uses your API keys, so anyone who can open it can spend
> them. A copy that is reachable from the internet without `APP_PASSWORD` keeps its API locked and shows setup
> instructions instead.

### Environment variables

| Variable | Needed | What it does |
|---|---|---|
| `APP_PASSWORD` | Yes, when hosted | Password for the sign-in screen |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | At least one | API keys used by `config/providers.example.json` |
| `DATA_DIR` | Recommended on servers | Folder for settings, skills and usage stats. Point it at a persistent disk |
| `SESSION_SECRET` | Optional | Extra secret for sign-in cookies. Changing it signs everyone out |
| `HOST` / `PORT` | Optional | Address and port to listen on. Render, Railway and Fly.io are detected automatically |

### Render or Railway (recommended)

These run the app as a normal Node server, so everything works, including saving APIs and skills added in the UI.

1. Create a new **Web Service** from this GitHub repository.
2. Start command: `npm start` (no build step).
3. Add a **persistent disk** (for example mounted at `/data`) and set `DATA_DIR=/data`.
4. Add the environment variables above, then deploy.

### Vercel

`vercel.json` routes every request to `api/index.js`, which runs the same server code.

1. Import the repository in Vercel (no framework preset, no build command).
2. Under **Settings → Environment Variables**, add `APP_PASSWORD` and your API keys, then redeploy.

Limits on Vercel:

- **Changes made in the UI are temporary.** Vercel's disk is read-only, so APIs and skills added on the site,
  and usage stats, reset whenever the function restarts. Keep API keys in environment variables and the API list
  in `config/providers.example.json`.
- **Uploads are limited to about 4.5 MB per message** (Vercel's request size limit).
- Long replies are cut off at your plan's function time limit.

## Project layout

```
server.js            HTTP server: static files + JSON API (exports `handler` for serverless)
api/index.js         Vercel entry point
src/router.js        Picks an API, fails over, tracks stats, manages the API list
src/adapters/        One file per API type (openai, anthropic, gemini, mock)
src/storage.js       Where settings, skills and stats are saved (DATA_DIR, read-only disks)
src/auth.js          APP_PASSWORD sign-in with signed cookies
public/              The web app (no build step)
config/providers.example.json   Starter API list (keys come from environment variables)
data/skills.example.json        Starter skills
```

Your own `config/providers.json`, `data/skills.json` and `data/usage.json` stay on your computer (git-ignored).
