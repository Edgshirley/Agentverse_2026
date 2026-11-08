# SPREAD — Engineering & UX Tasks for the Team (`TEAM_TASKS.md`)

Updated: Nov 8, 2026

This document tracks the UX, AI Agent pipeline, and backend rules-engine tasks to complete alongside the new **8-Bit Casino Pastel UI (`SPRD`)**.

---

## 1. Chat UX & AI Intent Filtering (High Priority)

- [ ] **UX-01: Casual Chat vs. Bet-Intent Pre-Filter (Prevent False Positives on `"hi!"`)**
  - **Problem:** Sending casual chat messages like `"hi!"` in the group chat should never trigger `runAgent1Intake` or cause the bot to suggest turning `"hi!?"` into a market.
  - **Task:** Add a lightweight intent classifier / pre-filter before calling Agent 1 (`POST /api/agents/intake`). Only trigger the **bottom-right 8-Bit Dealer Bull `[!]` widget** when the message contains a genuine betting proposition, numeric prediction, or explicit `/bet` command (`bet_intent_confidence >= 0.75`).
- [ ] **UX-02: Bottom-Right Mascot Pop-Up Widget Handoff**
  - **Task:** Clicking `OPEN IN ASK BOT ->` on the bottom-right Dealer Bull widget in `CHAT` should pre-populate the `ASK BOT` screen with the already-parsed Agent 1 + Agent 2 draft card so the user doesn't have to re-type or re-run the prompt.

---

## 2. Unit-Native Stop-Loss & Vertical Position Ladder

- [ ] **ENG-01: Unit-Based Trigger Levels (Not Currency)**
  - **Problem:** Stop-losses, take-profits, and buy/sell limits should be expressed in **the unit being bet** (e.g., `°C` for a temperature bet, `min` for a first-goal bet, `rank` for a company team ranking bet), showing at what point moving in or out of a range triggers a stop-loss or buy order.
  - **Task:** Update `Order.trigger_level` and `StrategyMandate` validation in `backend/src/engine/pool_orderbook.ts` so triggers are stored and evaluated against the market's native unit axis (`[bounds[0] .. bounds[1]]`).
- [ ] **ENG-02: Voice / Gemini Prompt Opt-In for Vertical Position Ladder**
  - **Task:** When a user tells the bot (via voice or text) *"show everyone's current positions including where their stop losses are"*, `parseStrategyRuleWithRiskGate` in `backend/src/worker/agents.ts` should return `show_unit_ladder: true` in the structured JSON response to automatically reveal the Vertical Unit Ladder on `LIVE BETS`.

---

## 3. Continuous Withdrawals & `SPRD` Currency Ledger

- [ ] **ENG-03: Direct `SPRD` Amount or `%` Partial Withdrawal**
  - **Task:** Extend `POST /api/markets/:id/withdraw` in `backend/src/worker/index.ts` to accept either `{ fractionP: number }` (e.g. `25%`) or `{ amountSprd: number }` (e.g. `25 SPRD`), automatically computing the exact slice while keeping `live_equity > 0` and integer `SPRD` zero-sum rounding intact.
- [ ] **ENG-04: Standardise Currency Symbol to `SPRD`**
  - **Task:** Update remaining backend log strings, AI system prompts in `backend/src/worker/agents.ts`, and `SPEC.md` references from `TOKS` to `SPRD`.

---

## 4. Custom Unverifiable Bets & 3rd-Party Arbiter Flow

- [ ] **ENG-05: 3rd-Party Arbiter Role Invite & Countdown Auto-Lock**
  - **Task:** When Agent 2 classifies a market as `custom_unverifiable` (e.g., internal company earnings or team performance rankings), notify the designated 3rd-party arbiter (e.g., Boss), enforce that the arbiter cannot place bets in that market, and automatically lock all bets and withdrawals when `countdown_ends_at` reaches `00:00:00`.


---

## 5. First-Time Profile Setup & Onboarding Exclamation Badges (Team Integration Notes)

- [ ] **UX-03: First-Startup Unauthenticated Profile & Rules `[!]` Exclamation Badges**
  - **Context / Behavior:** Replacing the old `START FRESH` header button is the new **Cat Profile Button** (with 6 selectable 8-bit cat avatars: 1 with no hat, 1 with a power tie, 1 with a bow tie, and 3 with different hat styles/colors, plus a custom display name input that falls back to a themed video-game handle generator (prefix + cat/casino noun + number, e.g. `LuckyWhisker_42`, `HighRollerJoker_7`; 🎲 ROLL NAME re-rolls it), and a separate **"How the Game Works"** button).
  - **Team Integration Note (Auth / First Launch):** The very first time a user starts the app up and is **not logged in** (or has not completed initial profile setup):
    1. A little 8-bit exclamation mark (`[!]`) appears on the **Profile button** in the top header bar prompting them to set up their profile.
    2. Inside the Profile modal itself, a second exclamation mark (`[!]`) sits right beside the **"How the Game Works"** button.
    3. Once the user clicks out of / closes the Profile modal, **both exclamation marks disappear**.
  - **Current implementation (frontend only):** avatar, custom name, generated default name and the "onboarded" flag are saved in the browser's `localStorage` under `spread.profile.v1` (`frontend/src/App.tsx`), so the badges only show on a browser's first launch and stay gone after the profile is closed once. Clear that key to see the first-launch badges again.
  - **Still to do when we integrate versions:**
    - [ ] Store avatar + display name on the server player record (keyed by the Keycloak user) so it follows the user across devices, and send the display name to the backend so other players see it (right now it is only swapped in on the client).
    - [ ] Decide whether the `[!]` badges should key off "no server profile yet" instead of the per-browser `localStorage` flag.
    - [ ] `↺ RESET DEMO MARKETS` (old START FRESH action) now lives in the Profile modal footer — keep or move to an admin-only spot.
