# Friend Spreader (Spread) — Citadel Poker Terminal

**Friend Spreader (`Spread`)** is a real-time social market-making and continuous trading terminal where friend groups run **Spread (`[L, H]`)**, **Simple (`Yes/No` & scalar)**, **Ranking**, and **Stacked (derivative)** markets in integer play-money Stokens (`TOKS`).

Built on a **100% Free Cloudflare Edge Stack** (`Cloudflare Workers + Static Assets`, `Cloudflare D1` serverless SQLite, and `Cloudflare Workers AI` free tier) with a single shared TypeScript deterministic rules engine.

---

## Key Capabilities (Master Specification v2026.11)

1. **Simple, Spread (`[L, H]`), & Stacked Derivative Markets**:
   - **Width Auction (`[L, H]`)**: 30s quiet-period width auction $\rightarrow$ narrowest bidder becomes `MM` $\rightarrow$ 3-minute quote timer with $k$ `TOKS` ante forfeiture fallback $\rightarrow$ `Pot`, `Binary`, `Linear`, and `Log` payoff modes with strict boundary rules ($X > H$ Over wins, $X < L$ Under wins, $L \le X \le H$ inside range) and integer division remainders routed to the `MM`.
   - **Stacked Meta-Markets**: Settle on a parent market's `outcome`, live `odds` trajectory, `volume`, or a specific participant's `player_pnl` (including parent-void rules from [SPEC.md §6.2](file:///Users/andreas/Documents/Agentverse_2026/SPEC.md#L251)).
2. **Dual Early Exit & Public Order Book ("Swing Map")**:
   - **P2P Position Transfer (`Spread` markets)**: Balance-backed standing bids, ask listings, conditional auto-sell rules, and 1-tap **Cash Out**.
   - **Continuous Pool Withdrawal (`Simple` & `Stacked` markets)**: Anytime partial or full withdrawal ($p \in (0, 1]$) while `live_equity_toks > 0`, plus public `LIMIT_BUY`, `LIMIT_SELL`, `STOP_LOSS`, and `TAKE_PROFIT` orders resolved atomically in price-time priority cascades.
3. **Two-Stage AI Classification & Mandatory 3-Part Hard Risk Gate (`FR-04` / `FR-91`)**:
   - **Agent 1 (Intake)** structures voice/text prompts and runs `lint_criteria` + `suggest_width`.
   - **Agent 2 (Classifier)** assigns archetype and oracle route (`Auto`, `Arbiter` with `00:00:00` countdown lock, or `Group` challenge/vote).
   - **Hard Risk Gate**: Conversational/voice strategies require explicit confirmation of `(1) Strategy Summary`, `(2) Take-Profit Target`, and `(3) Drawdown Floor (min_balance_floor)` before activating orders.
4. **Full Dual-Theme Citadel Poker Terminal UI**:
   - **`#000000` Live Market & Replay Terminal** + **`#FAFAFA` Strategy & Allocation Sheet** across all five core exhibits:
     - **Exhibit A**: Market Table & Radial Player Ring
     - **Exhibit B (Middle)**: Participant Action Swimlanes (`OPEN ─── MID ─── LIVE ─── SETTLE` with `B`, `L`, `F`, `W`, `S`, `X` nodes)
     - **Exhibit B (Bottom)**: Branching Swing Tree & Counterfactual Trajectory
     - **Exhibit C**: Heads-Up Position Telemetry Card (`51..55` line-gutter inspection box)
     - **Exhibit D**: Millisecond Live Order & Agent Wire Trace

---

## Local Quickstart (Zero Docker Required)

```bash
# 1. Install dependencies
npm install

# 2. Run the Golden Test, Cascade/Arbiter Suite, Risk Gate Suite, E2E Replay, and fast-check Property Tests
npm test

# 3. Start the interactive Citadel Poker Terminal + Worker API locally
npm run dev
```

---

## Free-Tier Cloudflare Deployment (\$0/month)

Everything deploys as a single Cloudflare Worker with free Static Assets, free D1 SQLite storage (5 GB free), and free Workers AI (`env.AI` — 10,000 neurons/day free):

```bash
# 1. Create your free Cloudflare D1 database (once) and paste the database_id into wrangler.jsonc
npx wrangler d1 create spread-db

# 2. Apply the SQLite schema migration (local or remote)
npm run db:migrate:local
npm run db:migrate:remote

# 3. Build static assets and deploy to Cloudflare Workers Free Tier
npm run deploy
```
