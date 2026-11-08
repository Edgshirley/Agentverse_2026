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

## Makefile & Docker Compose (`dev` & `prod`)

```bash
# Start development stack (backend :4000, frontend :5173, Python seed)
make dev

# Stop development stack
make dev-down

# Start production stack (backend :4000, frontend :3000)
make prod

# Stop production stack
make prod-down
```

### 1. Development (`docker-compose.dev.yml`)
Mounts `./backend` into the `backend` container (`:4000`), mounts `./frontend` into the `frontend` container (`:5173`), and runs the Python `seed` container ([`backend/scripts/seed_dev.py`](file:///Users/andreas/Documents/Agentverse_2026/backend/scripts/seed_dev.py)) once the backend healthcheck passes:

```bash
docker compose -f docker-compose.dev.yml up --build
```

### 2. Production (`docker-compose.prod.yml`)
Builds production images for `backend` (`:4000`) and `frontend` (`:3000`) without the dev `seed` container:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

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
