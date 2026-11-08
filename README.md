# MarketMate

Turn any argument in your group chat into a market. Friends bet play-money `CHIP` on a real order book, with a tuxedo cat dealer turning chat messages into bets.

![MarketMate: group chat in the centre, live bets and the bot in the right rail](docs/screenshot.png)

## How a bet works

```mermaid
flowchart TD
    A["A friend proposes a market"] --> B["Friends bid the window width down"]
    B --> C["Tightest bidder becomes market maker<br/>and picks the window L to H"]
    C --> D["Everyone else bets above H or below L"]
    D --> E["The real-world outcome X comes in"]
    E --> F{"Where did X land?"}
    F -->|"Above H"| G["Above side wins"]
    F -->|"Below L"| H["Below side wins"]
    F -->|"Inside the window"| I["Market maker wins"]
    G --> J["Paid by the market's payout mode"]
    H --> J
    I --> J
```

The market's creator picks the payout mode. `k` is the stake per lot, `w = H - L` is the window width, and `c` caps how many widths a bet can pay or lose.

| Mode | A winning bet pays |
| --- | --- |
| **Binary** | A flat `k` per lot |
| **Linear** | `k` per window width past the edge, up to `c` widths |
| **Log** | Like linear, on a log scale, for values that grow by ratio (needs `L > 0`) |
| **Pot** | The whole pot, split across the winning side by lots |

An outcome exactly on `L` or `H` counts as inside the window. Yes/no and stacked markets skip the auction and go straight to betting.

## Run it

Needs Docker.

```bash
make dev
```

Open http://localhost:5173 and log in as `alice`, `bob`, `carol` or `dave` (password in `dev.env`). Stop it with `make dev-down`.

| Service | Port | Role |
| --- | --- | --- |
| `frontend` | 5173 | Vite UI, proxies `/api` to the gateway |
| `api` | 8000 | FastAPI gateway: login, sessions, WebSocket |
| `keycloak` | 8080 | Identity provider (dev only) |
| `engine` | internal | TypeScript rules engine, reachable only from `api` |
| `postgres`, `redis` | 5432, 6379 | Users and snapshots; sessions and the message bus |

Every `/api/*` call needs a session, and the gateway binds each action to the signed-in player. Browsers get live updates on `/api/v1/ws`.

For production, copy `prod.env.example` to `prod.env` and run `make prod`. Create the `spread-api` (confidential) and `spread-ui` (public) Keycloak clients once, give `spread-ui` an Audience mapper that adds `spread-api` to access tokens (otherwise logins fail with "inactive token"), and set `KEYCLOAK_CLIENT_SECRET`.

Run the tests:

```bash
cd backend && npm test
```

```bash
make api-test
```

Every new bet is reviewed by Gemini before its market opens: a one-line take, a fair value in the bet's unit, settlement criteria and any problems. All players watch it happen live over the WebSocket (`BET_RECEIVED` → `BET_AI_REVIEWING` → `BET_AI_REVIEWED` → `BET_CREATED`), then anyone can trade on it. The review is advisory and never blocks a bet; if Gemini fails, a simulated review is used instead.

Put your Gemini key in `prod.env` as `GEMINI_API` (required in prod). It also powers the bot's LLM parsing and the outside-odds panel, which uses Google Search to show what other sites say about a market. `dev.env` leaves it empty, so dev uses simulated reviews and the bot's built-in rules. `GEMINI_BET_MODEL` picks the review model (default `gemini-3.8-flash`).

## Dev tools

Personas and the simulator need a run without the gateway, because the gateway binds every action to you:

```bash
cd backend && npm install && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

`npm run dev` sets `DEV_TOOLS=1`, which enables `/api/dev/*` and `/api/demo/*`. Both return 404 in production.

- **Personas:** play as Édouard, Jules, André, Michel or Nathalie from the header. The choice is per browser tab.
- **Simulator:** http://localhost:5173/sim steps or skips through a scripted betting session. Opening it resets local data.

## Repo

| Path | What's there |
| --- | --- |
| `frontend/` | React app: chat, right rail, bet drawer |
| `api/`, `kc/` | FastAPI gateway and Keycloak setup |
| `backend/src/engine/` | Deterministic rules: auction, payouts, order book, ledger |
| `backend/src/worker/` | Hono API, bot agents, persistence |
| `SPEC.md` | Full product and engine spec |
| `TEAM_TASKS.md` | Open tasks |
