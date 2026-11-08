import React, { useState } from 'react';
import {
  Market,
  OrderType,
  Player,
} from '../shared/types';
import { ActiveMarketBundle } from '../hooks/useMarketSync';
import { AppScreen } from '../App';

interface MarketTableScreenProps {
  activeBundle: ActiveMarketBundle | null;
  allMarkets: Market[];
  players: Player[];
  activePlayer: Player;
  serverClockMs: number;
  showUnitLadder: boolean;
  onToggleUnitLadder: (show: boolean) => void;
  onSelectMarket: (marketId: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onNavigateScreen: (screen: AppScreen) => void;
}

export const MarketTableScreen: React.FC<MarketTableScreenProps> = ({
  activeBundle,
  allMarkets,
  players,
  activePlayer,
  serverClockMs,
  showUnitLadder,
  onToggleUnitLadder,
  onSelectMarket,
  onDispatch,
  onNavigateScreen,
}) => {
  // Custom Withdraw Drawer State (Withdraw X% or X SPRD)
  const [showCustomWithdraw, setShowCustomWithdraw] = useState<boolean>(false);
  const [withdrawValue, setWithdrawValue] = useState<string>('25');
  const [withdrawMode, setWithdrawMode] = useState<'SPRD' | '%'>('SPRD');

  // Unit-based Stop / Limit Order Input
  const [orderType, setOrderType] = useState<OrderType>('stop_loss');
  const [orderTriggerUnit, setOrderTriggerUnit] = useState<string>('21');
  const [orderSizeSprd, setOrderSizeSprd] = useState<string>('50');
  const [outcomeInput, setOutcomeInput] = useState<string>('24');

  if (!activeBundle) {
    return (
      <div
        className="poker-felt-arena"
        style={{ textAlign: 'center', padding: '56px 24px', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <div className="mini-playing-card">
            <span>A</span>
            <span style={{ alignSelf: 'center', fontSize: 16 }}>♠</span>
            <span style={{ alignSelf: 'flex-end' }}>A</span>
          </div>
          <div className="mini-playing-card red">
            <span>JKR</span>
            <span style={{ alignSelf: 'center', fontSize: 15 }}>★</span>
            <span style={{ alignSelf: 'flex-end' }}>JKR</span>
          </div>
        </div>
        <div className="pixel-font" style={{ fontSize: 16 }}>
          NO LIVE BETS YET
        </div>
        <p style={{ maxWidth: 460, color: 'var(--fg-muted)' }}>
          You are the first person in your group. Ask the Bot to create your first bet (like
          tomorrow&apos;s temperature in °C, a spread bet, or a custom company ranking bet).
        </p>
        <button className="btn-coral pixel-font" onClick={() => onNavigateScreen('voice')}>
          CREATE FIRST BET WITH BOT -&gt;
        </button>
      </div>
    );
  }

  const { market, positions, orders, mmEscrowToks } = activeBundle;
  const isSpread = market.archetype === 'spread';
  const openOrders = orders.filter((o) => o.status === 'open');
  const unitLabel =
    market.unit && market.unit !== 'binary' && market.unit !== '%' ? market.unit : '°C';

  // Only show players who are actually participating in this market
  const participantIds = new Set<string>([activePlayer.id, market.proposer_id]);
  if (market.mm_player_id) participantIds.add(market.mm_player_id);
  if (market.arbiter_id) participantIds.add(market.arbiter_id);
  positions.forEach((p) => {
    if (p.lots > 0 || p.live_equity_toks > 0 || p.realized_pnl_toks !== 0) {
      participantIds.add(p.player_id);
    }
  });
  openOrders.forEach((o) => participantIds.add(o.player_id));
  const marketParticipants = players.filter((p) => participantIds.has(p.id));

  const myPositions = positions.filter((p) => p.player_id === activePlayer.id);
  const myActivePos = myPositions.find((p) => p.lots > 0 || p.live_equity_toks > 0);
  const myLiveBalance = myPositions.reduce((acc, p) => acc + p.live_equity_toks, 0);
  const myEntryCost = myPositions.reduce((acc, p) => acc + p.entry_cost_toks, 0);
  const myRealized = myPositions.reduce((acc, p) => acc + p.realized_pnl_toks, 0);
  const myNetPnl = myLiveBalance - myEntryCost + myRealized;

  const totalPotSprd =
    positions.reduce((acc, p) => acc + p.staked_toks, 0) + mmEscrowToks;

  // Handle Custom Withdraw (either X% or X SPRD)
  const handleCustomWithdraw = async () => {
    if (myLiveBalance <= 0) return;
    const rawVal = Number(withdrawValue);
    if (Number.isNaN(rawVal) || rawVal <= 0) return;

    const fractionP =
      withdrawMode === '%'
        ? Math.min(1, Math.max(0.01, rawVal / 100))
        : Math.min(1, Math.max(0.01, rawVal / myLiveBalance));

    await onDispatch(`/api/markets/${market.id}/withdraw`, {
      playerId: activePlayer.id,
      side: myActivePos?.side || 'YES',
      fractionP,
    });
    setShowCustomWithdraw(false);
  };

  // Simulate a friend joining this bet + placing a unit-level stop/limit order
  const handleSimulateFriendBet = async () => {
    const friendNames = ['ALEX', 'SAM', 'JORDAN'];
    const friendNick = friendNames[Math.floor(Math.random() * friendNames.length)];
    const friendId = friendNick.toLowerCase();

    if (isSpread && market.state === 'width_auction') {
      await onDispatch(`/api/markets/${market.id}/auction/bid`, {
        playerId: friendId,
        width: 8,
      });
      await onDispatch(`/api/markets/${market.id}/auction/finalize`, {});
      await onDispatch(`/api/markets/${market.id}/auction/quote`, {
        playerId: friendId,
        L: 35,
      });
    }

    const side = isSpread
      ? Math.random() > 0.5
        ? 'OVER'
        : 'UNDER'
      : Math.random() > 0.45
        ? 'NO'
        : 'YES';
    const amount = isSpread ? 1 : market.lot_stake_k;

    await onDispatch(`/api/markets/${market.id}/take`, {
      playerId: friendId,
      side,
      amount,
    });

    const centerUnit = isSpread ? market.L ?? 35 : Math.min(35, Math.max(18, Math.round(market.live_implied_value / 2)));
    const stopLevel = side === 'YES' || side === 'OVER' ? centerUnit - 3 : centerUnit + 3;
    await onDispatch(`/api/markets/${market.id}/orders`, {
      playerId: friendId,
      side,
      type: 'stop_loss',
      triggerLevel: stopLevel,
      sizeToks: Math.round(market.lot_stake_k * 0.8),
    });
  };

  // Build the Vertical Unit Ladder Rungs (in terms of the unit being bet, e.g. °C or min)
  const currentUnitCenter = isSpread
    ? Math.round(((market.L ?? 35) + (market.H ?? 43)) / 2)
    : market.live_implied_value <= 35
      ? market.live_implied_value
      : 24;

  const ladderStep = isSpread ? 4 : 2;
  const baseLevels = [
    currentUnitCenter + ladderStep * 3,
    currentUnitCenter + ladderStep * 2,
    currentUnitCenter + ladderStep * 1,
    currentUnitCenter,
    currentUnitCenter - ladderStep * 1,
    currentUnitCenter - ladderStep * 2,
    currentUnitCenter - ladderStep * 3,
  ];
  // Include any exact unit levels where players have placed orders
  const allUnitLevels = Array.from(
    new Set([...baseLevels, ...openOrders.map((o) => o.trigger_level)])
  ).sort((a, b) => b - a);

  // Countdown for Custom 3rd-Party Arbiter markets
  const remainingMs = market.countdown_ends_at
    ? Math.max(0, market.countdown_ends_at - serverClockMs)
    : 0;
  const mins = String(Math.floor(remainingMs / 60000)).padStart(2, '0');
  const secs = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');
  const isCountdownLocked = market.state === 'countdown_locked' || remainingMs === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Clean Top Action Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {allMarkets.length > 1 && (
            <select
              value={market.id}
              onChange={(e) => onSelectMarket(e.target.value)}
              style={{ padding: '7px 12px', fontWeight: 700 }}
            >
              {allMarkets.map((m, i) => (
                <option key={m.id} value={m.id}>
                  BET #{i + 1}: {m.question.replace(/TOKS/gi, 'SPRD')}
                </option>
              ))}
            </select>
          )}
          <button
            className={showUnitLadder ? 'btn-mint' : ''}
            onClick={() => onToggleUnitLadder(!showUnitLadder)}
            style={{ fontSize: 11.5 }}
          >
            {showUnitLadder
              ? '✓ SHOWING POSITIONS & STOPS LADDER'
              : 'SHOW POSITIONS & STOPS LADDER'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-sky" onClick={handleSimulateFriendBet}>
            + SIMULATE FRIEND BETTING
          </button>
          <button className="btn-coral" onClick={() => onNavigateScreen('voice')}>
            + NEW / STACKED BET
          </button>
        </div>
      </div>

      {/* MAIN FELT ARENA: Players in this Bet (Green = You, Pastel Blue = Friends) */}
      <div className="poker-felt-arena">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))',
            gap: 12,
          }}
        >
          {marketParticipants.map((p) => {
            const isMe = p.id === activePlayer.id;
            const pPos = positions.filter((pos) => pos.player_id === p.id);
            const activePos = pPos.find((pos) => pos.lots > 0 || pos.live_equity_toks > 0);
            const liveEq = pPos.reduce((acc, pos) => acc + pos.live_equity_toks, 0);
            const entry = pPos.reduce((acc, pos) => acc + pos.entry_cost_toks, 0);
            const realized = pPos.reduce((acc, pos) => acc + pos.realized_pnl_toks, 0);
            const pnl = liveEq - entry + realized;
            const isArbiter = market.arbiter_id === p.id;
            const isMm = market.mm_player_id === p.id;

            return (
              <div
                key={p.id}
                className={`player-seat-card ${isMe ? 'me-seat' : 'friend-seat'}`}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <span className="pixel-font" style={{ fontSize: 12 }}>
                    {p.nickname}
                  </span>
                  <span
                    className="badge-outline"
                    style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4 }}
                  >
                    {isArbiter
                      ? 'ARBITER'
                      : isMm
                        ? `MM [${market.L}..${market.H}]`
                        : activePos
                          ? `${activePos.side}`
                          : 'IN GROUP'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>
                    IN BET: <strong>{liveEq} SPRD</strong>
                  </span>
                  <span className={pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                    {pnl >= 0 ? `+${pnl}` : pnl} SPRD
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Center Bet Card — Calm Unified Dark Surface (No Clashing Boxes) */}
        <div
          className="pastel-card"
          style={{
            maxWidth: 680,
            width: '100%',
            margin: '0 auto',
            textAlign: 'center',
            padding: '20px 24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div className="mini-playing-card">
              <span>A</span>
              <span style={{ alignSelf: 'center', fontSize: 14 }}>♠</span>
              <span style={{ alignSelf: 'flex-end' }}>A</span>
            </div>
            <div>
              <div className="pixel-font" style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                {market.archetype.toUpperCase()} BET · {market.state.toUpperCase()}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>
                {market.question.replace(/TOKS/gi, 'SPRD')}
              </div>
            </div>
            <div className="mini-playing-card red">
              <span>JKR</span>
              <span style={{ alignSelf: 'center', fontSize: 13 }}>★</span>
              <span style={{ alignSelf: 'flex-end' }}>JKR</span>
            </div>
          </div>

          {/* Harmonious 3-Stat Row (Same Calm Surface, Subtle Borders) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
              margin: '14px 0',
            }}
          >
            <div
              style={{
                border: '2px solid var(--border-color)',
                borderRadius: 8,
                backgroundColor: 'var(--bg-canvas)',
                padding: '10px 12px',
              }}
            >
              <div className="pixel-font" style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
                {isSpread ? `RANGE (${unitLabel})` : 'LIVE ODDS / LINE'}
              </div>
              <div className="pixel-font" style={{ fontSize: 17, marginTop: 4 }}>
                {isSpread
                  ? `[${market.L ?? 35}..${market.H ?? 43}] ${unitLabel}`
                  : `${market.live_implied_value}% (${currentUnitCenter} ${unitLabel})`}
              </div>
            </div>

            <div
              style={{
                border: '2px solid var(--border-color)',
                borderRadius: 8,
                backgroundColor: 'var(--bg-canvas)',
                padding: '10px 12px',
              }}
            >
              <div className="pixel-font" style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
                TOTAL POT
              </div>
              <div className="pixel-font" style={{ fontSize: 17, marginTop: 4 }}>
                {totalPotSprd} SPRD
              </div>
            </div>

            <div
              style={{
                border: '2px solid var(--pastel-mint-border)',
                borderRadius: 8,
                backgroundColor: 'var(--pastel-mint-bg)',
                color: 'var(--pastel-mint-text)',
                padding: '10px 12px',
              }}
            >
              <div className="pixel-font" style={{ fontSize: 9 }}>
                YOUR BET BALANCE
              </div>
              <div className="pixel-font" style={{ fontSize: 17, marginTop: 4 }}>
                {myLiveBalance} SPRD
              </div>
            </div>
          </div>

          {/* 1-Tap Bet + Custom Withdraw (X% or X SPRD) + Quick Withdraw All */}
          {market.state === 'live' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: 10,
                }}
              >
                {isSpread ? (
                  <>
                    <button
                      className="btn-mint pixel-font"
                      onClick={() =>
                        onDispatch(`/api/markets/${market.id}/take`, {
                          playerId: activePlayer.id,
                          side: 'OVER',
                          amount: 1,
                        })
                      }
                    >
                      ▲ BET OVER (+{market.lot_stake_k} SPRD)
                    </button>
                    <button
                      className="btn-coral pixel-font"
                      onClick={() =>
                        onDispatch(`/api/markets/${market.id}/take`, {
                          playerId: activePlayer.id,
                          side: 'UNDER',
                          amount: 1,
                        })
                      }
                    >
                      ▼ BET UNDER (+{market.lot_stake_k} SPRD)
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn-mint pixel-font"
                      onClick={() =>
                        onDispatch(`/api/markets/${market.id}/take`, {
                          playerId: activePlayer.id,
                          side: 'YES',
                          amount: market.lot_stake_k,
                        })
                      }
                    >
                      ✓ BET YES (+{market.lot_stake_k} SPRD)
                    </button>
                    <button
                      className="btn-coral pixel-font"
                      onClick={() =>
                        onDispatch(`/api/markets/${market.id}/take`, {
                          playerId: activePlayer.id,
                          side: 'NO',
                          amount: market.lot_stake_k,
                        })
                      }
                    >
                      ✗ BET NO (+{market.lot_stake_k} SPRD)
                    </button>
                  </>
                )}

                {!isSpread && (
                  <>
                    <button
                      disabled={myLiveBalance <= 0}
                      onClick={() => setShowCustomWithdraw((v) => !v)}
                    >
                      WITHDRAW X% / SPRD...
                    </button>
                    <button
                      disabled={myLiveBalance <= 0}
                      onClick={() =>
                        onDispatch(`/api/markets/${market.id}/withdraw`, {
                          playerId: activePlayer.id,
                          side: myActivePos?.side || 'YES',
                          fractionP: 1.0,
                        })
                      }
                    >
                      WITHDRAW ALL
                    </button>
                  </>
                )}
              </div>

              {/* Expandable Custom Withdraw Bar (Withdraw X SPRD or X%) */}
              {showCustomWithdraw && myLiveBalance > 0 && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    margin: '4px auto 0',
                    padding: '8px 14px',
                    border: '2px solid var(--border-color)',
                    borderRadius: 8,
                    backgroundColor: 'var(--bg-canvas)',
                  }}
                >
                  <span style={{ fontSize: 12 }}>WITHDRAW:</span>
                  <input
                    type="number"
                    value={withdrawValue}
                    onChange={(e) => setWithdrawValue(e.target.value)}
                    style={{ width: 75, padding: '4px 8px', fontWeight: 700 }}
                  />
                  <select
                    value={withdrawMode}
                    onChange={(e) => setWithdrawMode(e.target.value as 'SPRD' | '%')}
                    style={{ padding: '4px 8px', fontWeight: 700 }}
                  >
                    <option value="SPRD">SPRD</option>
                    <option value="%">% OF BALANCE</option>
                  </select>
                  <button className="btn-mint pixel-font" onClick={handleCustomWithdraw}>
                    CONFIRM WITHDRAW
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* VERTICAL UNIT POSITION & STOP-LOSS GRAPH (Shown When Selected / Asked via Bot) */}
      {showUnitLadder && (
        <div className="pastel-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <span className="pixel-font" style={{ fontSize: 12 }}>
                VERTICAL UNIT LADDER ({unitLabel.toUpperCase()}) — POSITIONS, BIDS/ASKS &amp; STOPS
              </span>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
                Shows at what {unitLabel} level a player&apos;s stop-loss or buy/sell order is hit
                if the outcome moves in or out of range
              </div>
            </div>
            <button style={{ fontSize: 11 }} onClick={() => onToggleUnitLadder(false)}>
              HIDE GRAPH
            </button>
          </div>

          <div className="vertical-ladder-wrap">
            {allUnitLevels.map((lvl) => {
              const isCurrentLine = lvl === currentUnitCenter;
              const ordersAtLevel = openOrders.filter((o) => o.trigger_level === lvl);
              const isSpreadBoundary =
                isSpread && (lvl === market.L || lvl === market.H);

              return (
                <div
                  key={lvl}
                  className={`ladder-rung ${isCurrentLine ? 'current-unit-rung' : ''}`}
                >
                  {/* Left Column: Unit Value (e.g. 27 °C, 24 °C, 21 °C) */}
                  <div className="pixel-font" style={{ fontSize: 12 }}>
                    {lvl} {unitLabel}
                    {isCurrentLine && (
                      <div style={{ fontSize: 9, marginTop: 2 }}>◄ CURRENT LINE</div>
                    )}
                    {isSpreadBoundary && (
                      <div style={{ fontSize: 9, marginTop: 2 }}>◄ SPREAD BOUND</div>
                    )}
                  </div>

                  {/* Right Column: Active Positions (at current line) + Stop-Losses / Bids / Asks */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    {isCurrentLine &&
                      positions
                        .filter((p) => p.live_equity_toks > 0 || p.lots > 0)
                        .map((pos) => {
                          const pNick =
                            players.find((pl) => pl.id === pos.player_id)?.nickname ||
                            pos.player_id.toUpperCase();
                          const isMe = pos.player_id === activePlayer.id;
                          return (
                            <span
                              key={pos.id}
                              className={isMe ? 'btn-mint' : 'btn-sky'}
                              style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6 }}
                            >
                              {pNick}: HOLDING {pos.side} ({pos.live_equity_toks} SPRD)
                            </span>
                          );
                        })}

                    {ordersAtLevel.map((o) => {
                      const ownerNick =
                        players.find((p) => p.id === o.player_id)?.nickname ||
                        o.player_id.toUpperCase();
                      const isStop = o.type === 'stop_loss';
                      return (
                        <span
                          key={o.id}
                          className={isStop ? 'btn-coral' : 'btn-sky'}
                          style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6 }}
                        >
                          {ownerNick} · {o.type.replace('_', ' ').toUpperCase()} ({o.side}) ·{' '}
                          {o.size_toks} SPRD HIT AT {lvl} {unitLabel}
                        </span>
                      );
                    })}

                    {!isCurrentLine && ordersAtLevel.length === 0 && (
                      <span style={{ color: 'var(--fg-dim)', fontSize: 11 }}>
                        ── No stops or limits at {lvl} {unitLabel}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add a Unit-Level Stop or Limit Order directly onto the vertical graph */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginTop: 14,
            }}
          >
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as OrderType)}
              style={{ padding: '5px 8px' }}
            >
              <option value="stop_loss">STOP LOSS</option>
              <option value="take_profit">TAKE PROFIT (ASK)</option>
              <option value="limit_buy">BUY LIMIT (BID)</option>
            </select>
            <span>TRIGGER AT ({unitLabel}):</span>
            <input
              type="number"
              value={orderTriggerUnit}
              onChange={(e) => setOrderTriggerUnit(e.target.value)}
              style={{ width: 70, padding: '5px 8px' }}
            />
            <span>{unitLabel} · SIZE:</span>
            <input
              type="number"
              value={orderSizeSprd}
              onChange={(e) => setOrderSizeSprd(e.target.value)}
              style={{ width: 75, padding: '5px 8px' }}
            />
            <span>SPRD</span>
            <button
              className="btn-inverted"
              onClick={() =>
                onDispatch(`/api/markets/${market.id}/orders`, {
                  playerId: activePlayer.id,
                  side: myActivePos?.side || (isSpread ? 'OVER' : 'YES'),
                  type: orderType,
                  triggerLevel: Number(orderTriggerUnit),
                  sizeToks: Number(orderSizeSprd),
                })
              }
            >
              + PLACE ON GRAPH
            </button>
          </div>
        </div>
      )}

      {/* EVENT COMPLETION OR 3RD-PARTY ARBITER COUNTDOWN */}
      <div className="pastel-card">
        {market.route === 'arbiter' ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <div className="pixel-font" style={{ fontSize: 12 }}>
                CUSTOM BET COUNTDOWN &amp; 3RD-PARTY ARBITER ({market.arbiter_id?.toUpperCase()})
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
                {isCountdownLocked
                  ? 'Countdown ended (00:00:00) — all bets locked! Waiting for 3rd-party arbiter outcome.'
                  : `Time remaining until all bets lock: 00:${mins}:${secs}`}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {!isCountdownLocked && (
                <button
                  onClick={() =>
                    onDispatch(`/api/markets/${market.id}/resolve/lock-countdown`, {})
                  }
                >
                  END COUNTDOWN NOW
                </button>
              )}
              <input
                type="number"
                value={outcomeInput}
                onChange={(e) => setOutcomeInput(e.target.value)}
                style={{ width: 70, padding: '5px 8px' }}
              />
              <button
                className="btn-coral pixel-font"
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/resolve/propose`, {
                    proposerId: market.arbiter_id || 'boss',
                    outcomeX: Number(outcomeInput),
                    sourceUrl: `arbiter://${market.arbiter_id || 'boss'}`,
                    settleImmediately: true,
                  })
                }
              >
                ARBITER SUBMIT ({outcomeInput} {unitLabel})
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <div className="pixel-font" style={{ fontSize: 12 }}>
                COMPLETE EVENT &amp; SETTLE MARKET
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                Market stays open for continuous betting &amp; withdrawals until the event completes.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                value={outcomeInput}
                onChange={(e) => setOutcomeInput(e.target.value)}
                style={{ width: 70, padding: '5px 8px' }}
              />
              <button
                className="btn-inverted pixel-font"
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/resolve/settle`, {
                    outcomeX: Number(outcomeInput),
                  })
                }
              >
                COMPLETE EVENT ({outcomeInput} {unitLabel})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
