# MarketMate — Engineering & UX Tasks for the Team (`TEAM_TASKS.md`)

Updated: Nov 8, 2026

This document tracks the UX, AI Agent pipeline, and backend rules-engine tasks to complete alongside the new **8-Bit Casino Pastel UI (`CHIP`)**.

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

## 3. Continuous Withdrawals & `CHIP` Currency Ledger

- [ ] **ENG-03: Direct `CHIP` Amount or `%` Partial Withdrawal**
  - **Task:** Extend `POST /api/markets/:id/withdraw` in `backend/src/worker/index.ts` to accept either `{ fractionP: number }` (e.g. `25%`) or `{ amountChip: number }` (e.g. `25 CHIP`), automatically computing the exact slice while keeping `live_equity > 0` and integer `CHIP` zero-sum rounding intact.
- [x] **ENG-04: Standardise Currency Symbol to `CHIP`**
  - **Done:** UI, backend log strings, AI prompts and `SPEC.md` all use `CHIP`. Internal `*_toks` fields and database columns keep their names.

---

## 4. Custom Unverifiable Bets & 3rd-Party Arbiter Flow

- [ ] **ENG-05: 3rd-Party Arbiter Role Invite & Countdown Auto-Lock**
  - **Task:** When Agent 2 classifies a market as `custom_unverifiable` (e.g., internal company earnings or team performance rankings), notify the designated 3rd-party arbiter (e.g., Boss), enforce that the arbiter cannot place bets in that market, and automatically lock all bets and withdrawals when `countdown_ends_at` reaches `00:00:00`.
