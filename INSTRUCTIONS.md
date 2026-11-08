# ⚠️ TEAM INSTRUCTIONS — READ BEFORE YOU COMMIT

## Rule #1: API keys and secrets NEVER go on GitHub

This repo is on GitHub. Anything committed — even for one minute, even on a
branch, even if you delete it in the next commit — is **public and permanent**
in git history. Bots scrape GitHub for keys within seconds. A leaked key means:

- Google / OpenAI **auto-revoke the key** and can **suspend the account**
  (that's how we get banned).
- Someone else runs up charges on our billing.
- We lose the key in the middle of the hackathon / demo.

**Strictly forbidden in any committed file** (code, `.env`, `dev.env`, README,
pitch-deck notes, screenshots, Slack pastes into code comments):

- `GEMINI_API_KEY`, `OPENAI_API_KEY`, or any other LLM key
- Keycloak client secrets for real deployments, prod DB/Redis passwords
- Anything in `prod.env`, `secrets.env`, `*.pem`, `*.key`, service-account JSON

> `dev.env` **is committed**. It only holds throwaway local-dev passwords
> (`password`, `admin`, `spread123`). **Never put a real key in `dev.env`.**

## Where keys go: `secrets.env` (git-ignored)

```bash
cp secrets.env.example secrets.env     # once, at repo root
# open secrets.env and paste your key after GEMINI_API_KEY=
node backend/scripts/check_llm_key.mjs # confirms the key works (never prints it)
```

`secrets.env` is in `.gitignore`. It is loaded automatically by:

- `make dev` with Docker → `env_file: secrets.env` on the `engine` service
- `make dev` without Docker → `backend/scripts/run_server.mjs` loads it
- `make prod` → put `GEMINI_API_KEY` in `prod.env` instead (also git-ignored, read via `--env-file`)

The key is only read by the backend rules engine (`backend/src/worker/agents.ts`).
It must **never** be sent to or bundled into the frontend — anything under
`frontend/` (including `VITE_*` variables) ends up in the browser, readable by anyone.

Share keys with teammates **privately** (DM / password manager), never in the repo,
issues, PR descriptions, or commit messages.

## Before every commit / push

```bash
git status                        # secrets.env must NOT appear
git diff --cached | grep -nE "AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|API_KEY=.+" \
  && echo "🚨 STOP — key in staged changes" || echo "ok"
```

Don't use `git add -A` / `git add .` blindly — check what you're adding.

## If a key leaks (it happens — act fast)

1. **Revoke/rotate the key immediately** in Google AI Studio / OpenAI dashboard.
   Deleting the commit is NOT enough — the key is already scraped.
2. Tell the team in the group chat.
3. Put the new key in `secrets.env` only.

## Repo owner: turn on GitHub protection

Settings → Code security → enable **Secret scanning** and **Push protection**.
GitHub will then block pushes that contain known key formats.

---

## Setup for Andreas (or your Claude/AI assistant) — LLM key through the FastAPI gateway

Hand this section to your assistant as-is. Goal: the Keycloak-authenticated
FastAPI gateway (`api/`) proxies `/api/*` to the engine, and the engine's agents
(`backend/src/worker/agents.ts`) call Gemini using a key from `secrets.env`.

1. Get the key from Ed **by private DM**. Never paste it into a chat with an AI,
   a commit, an issue, or a file other than `secrets.env`.
2. At repo root: `cp secrets.env.example secrets.env`, then put the key after
   `GEMINI_API_KEY=` (edit the file yourself in an editor).
3. Verify the key: `node backend/scripts/check_llm_key.mjs` → expect `✅ Key works`.
4. Start the stack: `make dev` (Docker; needs Compose ≥ v2.24 for
   `env_file: { path, required: false }`).
5. Confirm the engine container received it, **without printing it**:
   `docker compose --env-file dev.env -f docker-compose.dev.yml exec engine sh -c 'test -n "$GEMINI_API_KEY" && echo present || echo MISSING'`
6. End-to-end: log in at http://localhost:5173 (seed user `alice` / `spread123`),
   use the voice bot GO button. The request goes UI → FastAPI `/api/agents/intake`
   (proxied by `api/src/routers/engine.py`) → engine → Gemini. Replies should be
   real LLM output, not the regex fallback.
7. Rules for the assistant:
   - Only the **engine** service gets the key. Do **not** add it to the `api`
     service, `dev.env`, `prod.env.example`, or anything under `frontend/`.
   - Never `cat`, `echo`, log, or print `secrets.env` / key values.
   - Before committing run the check in "Before every commit / push" above;
     `secrets.env` must never show up in `git status`.
