# Friend Spreader (Spread) — Citadel Poker Terminal

**Friend Spreader (`Spread`)** is a real-time social market-making and continuous trading terminal where friend groups run **Spread (`[L, H]`)**, **Simple (`Yes/No` & scalar)**, **Ranking**, and **Stacked (derivative)** markets in integer play-money Stokens (`TOKS`).

---

## Repository Structure (`frontend/` + `backend/`)

```text
Agentverse_2026/
├── README.md
├── SPEC.md
├── Makefile                           # Stack lifecycle: `make dev`, `make dev-down`, `make prod`, `make prod-down`
├── docker-compose.dev.yml             # Dev stack: mounts ./backend, ./frontend, and runs Python `seed` container
├── docker-compose.prod.yml            # Prod stack: builds production `backend` (:4000) and `frontend` (:3000)
│
├── backend/                           # Mounted to `backend` container in docker-compose.dev.yml
│   ├── Dockerfile                     # Multi-stage `dev` and `prod` targets (:4000)
│   ├── Dockerfile.seed                # Python 3.12 container for dev seeding (`dev` compose only)
│   ├── package.json
│   ├── tsconfig.json
│   ├── migrations/
│   │   └── 0001_initial_schema.sql
│   ├── scripts/
│   │   ├── run_server.mjs             # Node HTTP entrypoint serving Hono `/api/*` on :4000
│   │   └── seed_dev.py                # Python dev seeder script executed by the `seed` container
│   ├── src/
│   │   ├── shared/                    # Shared TypeScript domain models & match fixtures
│   │   ├── engine/                    # Pure Deterministic Rules Engine (clock, ledger, auction, payoffs,
│   │   │                              #   mm_transfer, pool_orderbook, swing_tree, resolution, stacked, poisson)
│   │   └── worker/                    # Hono API routes, AI pipeline (Agent 1 & 2, 3-Part Risk Gate), Replay Mode
│   └── tests/                         # Vitest + fast-check suite (Golden Test, Cascades, Risk Gate, E2E Replay)
│
└── frontend/                          # Mounted to `frontend` container in docker-compose.dev.yml
    ├── Dockerfile                     # Multi-stage `dev` (:5173) and `prod` (:3000) targets
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts                 # Proxies `/api/*` to `BACKEND_URL` (`http://backend:4000`)
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── styles/
        │   └── citadel-terminal.css   # Dual-theme (#000000 Live Terminal / #FAFAFA Strategy Sheet)
        ├── hooks/                     # `useMarketSync.ts`, `usePushToTalk.ts`
        ├── components/                # `HeaderBar.tsx`, `TradingControls.tsx`, `StrategySheetModal.tsx`, `ArbiterPanel.tsx`
        └── exhibits/                  # All 5 Citadel Poker Exhibits (A: Player Ring, B: Swimlanes & Swing Tree,
                                       #   C: Telemetry Card, D: Wire Trace)
```

---

## Dev Stack (`make dev`) — FastAPI + Keycloak

Modelled on `../freevo-api`. `make dev` runs `docker compose --env-file dev.env -f docker-compose.dev.yml up --build`:

| Service      | Port  | Role |
|--------------|-------|------|
| `frontend`   | 5173  | Vite UI; proxies `/api` (HTTP + WebSocket) to `api` |
| `api`        | 8000  | **FastAPI** (`api/`): Keycloak login, Redis cookie sessions, Postgres users, `/api/v1/ws` WebSocket, authenticated gateway to the engine |
| `keycloak`   | 8080  | Identity provider (console: `admin` / `admin`) — dev compose only |
| `kc-config`  | —     | One-shot: creates the `spread-api` / `spread-ui` clients, users, writes the client secret to `spread-storage/shared` |
| `db-migrate` | —     | One-shot: `python -m src.migrate` (advisory-locked, additive schema sync) |
| `engine`     | (4000, internal) | TypeScript rules engine (`backend/`), reachable only from `api`; publishes every state change on the Redis bus |
| `postgres`, `redis` | 5432, 6379 | Users + engine snapshots; sessions (db 2) + message bus |
| `seed`       | —     | Resets the engine to a clean ring |

Open http://localhost:5173 and log in as `alice` / `bob` / `carol` / `dave` (password `spread123`).

**Auth flow:** `GET /api/v1/system/login` → Keycloak (authorization code + PKCE, `spread-ui`) → `GET /api/v1/system/callback` stores the tokens in Redis and sets an httpOnly `session_id` cookie. Every other `/api/*` call requires that cookie; the gateway introspects the token (`spread-api`), refreshes it when expired, and overwrites `playerId` / `player_id` / `proposer_id` in JSON bodies with the caller's own player id before forwarding to the engine.

**Realtime:** engine mutation → Redis `BUS_CHANNEL` → `ws_worker` in each API replica → browsers on `/api/v1/ws` (cookie-authenticated). The UI refetches `/api/state` on each frame and falls back to polling without a socket.

```bash
make dev        # start everything
make dev-down   # stop
make api-test   # FastAPI unit tests (no stack needed)
python api/tests/live_login_check.py   # end-to-end check against the running stack
```

**Production** (`make prod`, env from `prod.env`, template in `prod.env.example`) runs the same services without `kc-config`/`seed`, published on loopback only for the host's reverse proxy: UI `127.0.0.1:3900`, FastAPI `127.0.0.1:8900`, Keycloak `127.0.0.1:8980` (`start`, `KC_HOSTNAME` = public URL). Engine, Postgres and Redis (password-protected) stay on the compose network. Create the `spread-api` / `spread-ui` clients once in the Keycloak console and set `KEYCLOAK_CLIENT_SECRET`.

---

## Running Tests & Local Dev Without Docker

```bash
# Run the backend verification suite (Golden Test, Cascades, Risk Gate, E2E Replay, fast-check Properties)
cd backend && npm test

# Start backend on :4000
cd backend && npm run dev

# Start frontend on :5173 (proxies /api to localhost:4000)
cd frontend && npm run dev
```
