import React, { useState, useEffect } from 'react';
import {
  Market,
  OrderType,
  Player,
} from '../shared/types';
import { ActiveMarketBundle } from '../hooks/useMarketSync';
import { PixelMascot } from '../components/PixelMascot';
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

  // Window Auction (Stage 1) & Window Selection [L, H] (Stage 2) State
  const [widthBidInput, setWidthBidInput] = useState<string>('3');
  const [quoteLInput, setQuoteLInput] = useState<string>('3');

  // Unit-based Stop / Limit Order Input
  const [orderType, setOrderType] = useState<OrderType>('stop_loss');
  const [orderTriggerUnit, setOrderTriggerUnit] = useState<string>('2');
  const [orderSizeSprd, setOrderSizeSprd] = useState<string>('25');
  const [outcomeInput, setOutcomeInput] = useState<string>('4');

  const market = activeBundle?.market;

  useEffect(() => {
    if (!market) return;
    if (market.unit === 'pit stops' || market.unit === 'laps') {
      setWidthBidInput('2');
      setQuoteLInput('3');
      setOrderTriggerUnit('2');
      setOutcomeInput('6');
    } else if (market.unit === 'min') {
      setWidthBidInput('8');
      setQuoteLInput('35');
      setOrderTriggerUnit('30');
      setOutcomeInput('50');
    } else {
      setWidthBidInput('4');
      setQuoteLInput('22');
      setOrderTriggerUnit('21');
      setOutcomeInput('24');
    }
  }, [market?.id, market?.unit]);

  if (!activeBundle || !market) {
    return (
      <div
        className="poker-felt-arena"
        style={{ textAlign: 'center', padding: '56px 24px', alignItems: 'center' }}
      >
        <PixelMascot size={54} />
        <div className="pixel-font" style={{ fontSize: 16 }}>
          NO LIVE BETS YET
        </div>
        <p style={{ maxWidth: 460, color: 'var(--fg-muted)' }}>
          You are the first person in your group. Ask the Tuxedo Cat Bot to create your first bet
          (like an F1 pit stops linear window market, tomorrow&apos;s temperature in °C, or a custom
          company ranking bet).
        </p>
        <button className="btn-coral pixel-font" onClick={() => onNavigateScreen('voice')}>
          CREATE FIRST BET WITH BOT -&gt;
        </button>
      </div>
    );
  }

  const { positions, orders, widthBids, mmEscrowToks } = activeBundle;
  const isSpread = market.archetype === 'spread';
  const openOrders = orders.filter((o) => o.status === 'open');
  const unitLabel =
    market.unit && market.unit !== 'binary' && market.unit !== '%' ? market.unit : '°C';

  // Only the person who created the market can toggle whether everyone sees the positions & stops graph
  const isMarketCreator = market.proposer_id === activePlayer.id;
  const isGraphVisibleToGroup =
    market.toggles?.public_positions_and_stops !== undefined
      ? Boolean(market.toggles.public_positions_and_stops)
      : showUnitLadder;

  const handleCreatorTogglePositionsVisibility = async () => {
    if (!isMarketCreator) return;
    const nextVal = !isGraphVisibleToGroup;
    onToggleUnitLadder(nextVal);
    await onDispatch(`/api/markets/${market.id}/toggles`, {
      playerId: activePlayer.id,
      public_positions_and_stops: nextVal,
    });
  };

  // Only show players who are actually participating in this market
  const participantIds = new Set<string>([activePlayer.id, market.proposer_id]);
  if (market.mm_player_id) participantIds.add(market.mm_player_id);
  if (market.arbiter_id) participantIds.add(market.arbiter_id);
  widthBids?.forEach((b) => participantIds.add(b.player_id));
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
      side: myActivePos?.side || (isSpread ? 'OVER' : 'YES'),
      fractionP,
    });
    setShowCustomWithdraw(false);
  };

  // Stage 1: Simulate a friend bidding a narrower window width
  const handleSimulateFriendWidthBid = async () => {
    const friendNames = ['ALEX', 'SAM', 'JORDAN'];
    const friendNick = friendNames[(widthBids?.length ?? 0) % friendNames.length];
    const friendId = friendNick.toLowerCase();
    const currentBest = market.active_width_w;
    const defaultStartW = market.unit === 'pit stops' ? 4 : market.unit === 'min' ? 12 : 6;
    const nextW = currentBest ? Math.max(1, currentBest - 1) : defaultStartW;

    await onDispatch(`/api/markets/${market.id}/auction/bid`, {
      playerId: friendId,
      width: nextW,
    });
    setWidthBidInput(String(Math.max(1, nextW - 1)));
  };

  // Stage 3: Simulate a friend betting ABOVE or BELOW the window (or YES/NO) + placing a stop order
  const handleSimulateFriendBet = async () => {
    const friendNames = ['ALEX', 'SAM', 'JORDAN'];
    const friendNick = friendNames[Math.floor(Math.random() * friendNames.length)];
    const friendId = friendNick.toLowerCase();

    if (isSpread && market.state === 'width_auction') {
      await handleSimulateFriendWidthBid();
      return;
    }

    if (isSpread && market.state === 'quoting') {
      const lVal = Number(quoteLInput) || (market.unit === 'pit stops' ? 3 : 35);
      await onDispatch(`/api/markets/${market.id}/auction/quote`, {
        playerId: market.mm_player_id || friendId,
        L: lVal,
      });
      return;
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

    const centerUnit = isSpread
      ? market.L ?? 3
      : Math.min(35, Math.max(18, Math.round(market.live_implied_value / 2)));
    const delta = market.unit === 'pit stops' ? 1 : 3;
    const stopLevel =
      side === 'YES' || side === 'OVER' ? Math.max(0, centerUnit - delta) : centerUnit + delta;

    await onDispatch(`/api/markets/${market.id}/orders`, {
      playerId: friendId,
      side,
      type: 'stop_loss',
      triggerLevel: stopLevel,
      sizeToks: Math.round(market.lot_stake_k * 0.8),
    });
  };

  // Build the Vertical Unit Ladder Rungs (in terms of the unit being bet, e.g. pit stops, °C, or min)
  const currentUnitCenter = isSpread
    ? Math.round(((market.L ?? 3) + (market.H ?? 5)) / 2)
    : market.live_implied_value <= 35
      ? market.live_implied_value
      : 24;

  const ladderStep =
    market.unit === 'pit stops' || market.unit === 'laps' ? 1 : isSpread ? 4 : 2;
  const baseLevels = [
    currentUnitCenter + ladderStep * 3,
    currentUnitCenter + ladderStep * 2,
    currentUnitCenter + ladderStep * 1,
    currentUnitCenter,
    Math.max(0, currentUnitCenter - ladderStep * 1),
    Math.max(0, currentUnitCenter - ladderStep * 2),
    Math.max(0, currentUnitCenter - ladderStep * 3),
  ];
  const allUnitLevels = Array.from(
    new Set([
      ...baseLevels,
      ...(market.L != null ? [market.L] : []),
      ...(market.H != null ? [market.H] : []),
      ...openOrders.map((o) => o.trigger_level),
    ])
  ).sort((a, b) => b - a);

  // Countdown for Custom 3rd-Party Arbiter markets
  const remainingMs = market.countdown_ends_at
    ? Math.max(0, market.countdown_ends_at - serverClockMs)
    : 0;
  const mins = String(Math.floor(remainingMs / 60000)).padStart(2, '0');
  const secs = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');
  const isCountdownLocked = market.state === 'countdown_locked' || remainingMs === 0;

  const previewW = market.active_width_w ?? (Number(widthBidInput) || 2);
  const previewL = Number(quoteLInput) || 0;
  const previewH = previewL + previewW;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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

          {/* ONLY the person who created the market can toggle whether everyone sees positions & stops */}
          {isMarketCreator ? (
            <button
              className={isGraphVisibleToGroup ? 'btn-mint' : ''}
              onClick={handleCreatorTogglePositionsVisibility}
              style={{ fontSize: 11.5 }}
              title="Only you (the market creator) can toggle whether everyone in the market sees all positions and stop-losses"
            >
              {isGraphVisibleToGroup
                ? '👑 CREATOR OPTION: POSITIONS & STOPS VISIBLE TO ALL (ON)'
                : '👑 CREATOR OPTION: POSITIONS & STOPS HIDDEN FOR ALL (OFF)'}
            </button>
          ) : (
            <span className="badge-outline" style={{ fontSize: 11 }}>
              POSITIONS &amp; STOPS GRAPH:{' '}
              {isGraphVisibleToGroup ? 'VISIBLE TO ALL (SET BY CREATOR)' : 'HIDDEN BY CREATOR'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-sky" onClick={handleSimulateFriendBet}>
            {isSpread && market.state === 'width_auction'
              ? '+ SIMULATE FRIEND WIDTH BID'
              : '+ SIMULATE FRIEND BETTING'}
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
                        ? market.L != null && market.H != null
                          ? `WINDOW MM [${market.L}..${market.H}]`
                          : `WINDOW LEADER (W=${market.active_width_w})`
                        : activePos
                          ? activePos.side === 'OVER'
                            ? `ABOVE (> ${market.H})`
                            : activePos.side === 'UNDER'
                              ? `BELOW (< ${market.L})`
                              : activePos.side
                          : 'IN MARKET'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>
                    IN BET: <strong>{isMm && liveEq === 0 ? mmEscrowToks : liveEq} SPRD</strong>
                  </span>
                  <span className={pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                    {pnl >= 0 ? `+${pnl}` : pnl} SPRD
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Center Bet Card — Handles All 3 Window Market Stages + Live Betting */}
        <div
          className="pastel-card"
          style={{
            maxWidth: 720,
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
              marginBottom: 10,
            }}
          >
            <div className="mini-playing-card">
              <span>A</span>
              <span style={{ alignSelf: 'center', fontSize: 14 }}>♠</span>
              <span style={{ alignSelf: 'flex-end' }}>A</span>
            </div>
            <div>
              <div className="pixel-font" style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                {isSpread ? 'LINEAR WINDOW BET [L, H]' : `${market.archetype.toUpperCase()} BET`} ·{' '}
                {market.state.toUpperCase().replace('_', ' ')}
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

          {/* Show In-House Rules summary for Linear Window Markets */}
          {isSpread && (
            <div style={{ marginBottom: 12 }}>
              <span className="badge-outline" style={{ fontSize: 10.5 }}>
                IN-HOUSE RULES: {market.payoff_mode.toUpperCase()} PAYOFF · {market.cap_widths_c}x
                CAP · MM WINS IF INSIDE [L, H] · STAKE {market.lot_stake_k} SPRD
              </span>
            </div>
          )}

          {/* ================================================================
           * STAGE 1 (SPREAD): WINDOW WIDTH AUCTION BETWEEN FRIENDS
           * ================================================================ */}
          {isSpread && market.state === 'width_auction' && (
            <div
              className="pastel-card gold"
              style={{ textAlign: 'left', marginTop: 10, padding: '16px 18px' }}
            >
              <div className="pixel-font" style={{ fontSize: 11.5, marginBottom: 6 }}>
                STEP 1 OF 3 · FRIENDS WINDOW BIDDING — WHO CAN MAKE THE TIGHTEST WINDOW?
              </div>
              <p style={{ fontSize: 12, marginBottom: 12 }}>
                Friends bid how narrow of a window width <strong>W ({unitLabel})</strong> they are
                willing to make. The narrowest width wins the window and gets to pick the exact{' '}
                <strong>[L, H] {unitLabel}</strong> range!
              </p>

              <div style={{ marginBottom: 12, fontSize: 12 }}>
                <strong>Current Best Window Bid: </strong>
                {market.active_width_w != null ? (
                  <span className="badge-inverted">
                    {market.mm_player_id?.toUpperCase()} · WIDTH W = {market.active_width_w}{' '}
                    {unitLabel}
                  </span>
                ) : (
                  <span>No width bids yet — place the first bid or simulate a friend!</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12 }}>Your Window Width ({unitLabel}):</span>
                <input
                  type="number"
                  min={1}
                  value={widthBidInput}
                  onChange={(e) => setWidthBidInput(e.target.value)}
                  style={{ width: 70, padding: '5px 8px', fontWeight: 700 }}
                />
                <button
                  className="btn-mint pixel-font"
                  onClick={() =>
                    onDispatch(`/api/markets/${market.id}/auction/bid`, {
                      playerId: activePlayer.id,
                      width: Number(widthBidInput),
                    })
                  }
                >
                  BID WIDTH ({widthBidInput} {unitLabel})
                </button>
                <button className="btn-sky pixel-font" onClick={handleSimulateFriendWidthBid}>
                  + FRIEND BIDS NARROWER
                </button>
                <button
                  className="btn-inverted pixel-font"
                  onClick={() => onDispatch(`/api/markets/${market.id}/auction/finalize`, {})}
                >
                  LOCK WINNER &amp; PICK WINDOW [L, H] -&gt;
                </button>
              </div>
            </div>
          )}

          {/* ================================================================
           * STAGE 2 (SPREAD): WINDOW WINNER SELECTS THE EXACT WINDOW [L, H]
           * ================================================================ */}
          {isSpread && market.state === 'quoting' && (
            <div
              className="pastel-card sky"
              style={{ textAlign: 'left', marginTop: 10, padding: '16px 18px' }}
            >
              <div className="pixel-font" style={{ fontSize: 11.5, marginBottom: 6 }}>
                STEP 2 OF 3 · WINDOW WINNER ({market.mm_player_id?.toUpperCase()}) SELECTS THE
                WINDOW [L, H]
              </div>
              <p style={{ fontSize: 12, marginBottom: 12 }}>
                <strong>{market.mm_player_id?.toUpperCase()}</strong> won the window auction with a
                width of <strong>{market.active_width_w} {unitLabel}</strong>! Select where the
                window starts (<strong>L</strong>) to lock in{' '}
                <strong>
                  [{previewL} .. {previewH}] {unitLabel}
                </strong>{' '}
                so everyone can bet <strong>ABOVE (&gt; {previewH})</strong> and{' '}
                <strong>BELOW (&lt; {previewL})</strong>!
              </p>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12 }}>Window Start (L):</span>
                <input
                  type="number"
                  value={quoteLInput}
                  onChange={(e) => setQuoteLInput(e.target.value)}
                  style={{ width: 75, padding: '5px 8px', fontWeight: 700 }}
                />
                <span className="badge-inverted">
                  WINDOW PREVIEW: [{previewL} .. {previewH}] {unitLabel}
                </span>
                <button
                  className="btn-coral pixel-font"
                  onClick={() =>
                    onDispatch(`/api/markets/${market.id}/auction/quote`, {
                      playerId: market.mm_player_id || activePlayer.id,
                      L: previewL,
                    })
                  }
                >
                  LOCK WINDOW [{previewL}..{previewH}] &amp; START ABOVE/BELOW BETS -&gt;
                </button>
              </div>
            </div>
          )}

          {/* Harmonious 3-Stat Row */}
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
                {isSpread ? `ACTIVE WINDOW (${unitLabel})` : 'LIVE ODDS / LINE'}
              </div>
              <div className="pixel-font" style={{ fontSize: 16, marginTop: 4 }}>
                {isSpread
                  ? market.L != null && market.H != null
                    ? `[${market.L} .. ${market.H}] ${unitLabel}`
                    : `WIDTH W = ${market.active_width_w ?? '?'} ${unitLabel}`
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
              <div className="pixel-font" style={{ fontSize: 16, marginTop: 4 }}>
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
              <div className="pixel-font" style={{ fontSize: 16, marginTop: 4 }}>
                {myLiveBalance} SPRD
              </div>
            </div>
          </div>

          {/* ================================================================
           * STAGE 3: LIVE BETTING ABOVE & BELOW WINDOW (OR YES / NO) + WITHDRAW
           * ================================================================ */}
          {(market.state === 'live' || market.state === 'open') && (
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
                      ▲ BET ABOVE (&gt; {market.H} {unitLabel}) · +{market.lot_stake_k} SPRD
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
                      ▼ BET BELOW (&lt; {market.L} {unitLabel}) · +{market.lot_stake_k} SPRD
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
                      side: myActivePos?.side || (isSpread ? 'OVER' : 'YES'),
                      fractionP: 1.0,
                    })
                  }
                >
                  WITHDRAW ALL
                </button>
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

      {/* VERTICAL UNIT POSITION & STOP-LOSS GRAPH (Controlled by Market Creator) */}
      {isGraphVisibleToGroup && (
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
                VERTICAL UNIT LADDER ({unitLabel.toUpperCase()}) — EVERYONE&apos;S POSITIONS,
                WINDOW &amp; STOPS
              </span>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
                Enabled by Market Creator: shows at what {unitLabel} level each player&apos;s
                position, window boundary, or stop-loss is hit
              </div>
            </div>
            {isMarketCreator && (
              <button style={{ fontSize: 11 }} onClick={handleCreatorTogglePositionsVisibility}>
                HIDE GRAPH FOR EVERYONE
              </button>
            )}
          </div>

          <div className="vertical-ladder-wrap">
            {allUnitLevels.map((lvl) => {
              const isCurrentLine = lvl === currentUnitCenter;
              const ordersAtLevel = openOrders.filter((o) => o.trigger_level === lvl);
              const isSpreadBoundary = isSpread && (lvl === market.L || lvl === market.H);

              return (
                <div
                  key={lvl}
                  className={`ladder-rung ${isCurrentLine ? 'current-unit-rung' : ''}`}
                >
                  {/* Left Column: Unit Value (e.g. 5 pit stops, 24 °C, 35 min) */}
                  <div className="pixel-font" style={{ fontSize: 12 }}>
                    {lvl} {unitLabel}
                    {isCurrentLine && (
                      <div style={{ fontSize: 9, marginTop: 2 }}>◄ CURRENT CENTER</div>
                    )}
                    {isSpreadBoundary && (
                      <div style={{ fontSize: 9, marginTop: 2, color: 'var(--pastel-coral-border)' }}>
                        ◄ {lvl === market.H ? 'UPPER WINDOW (H)' : 'LOWER WINDOW (L)'}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Active Positions + Stop-Losses / Bids / Asks */}
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
                              {pNick}: HOLDING{' '}
                              {pos.side === 'OVER'
                                ? `ABOVE (> ${market.H})`
                                : pos.side === 'UNDER'
                                  ? `BELOW (< ${market.L})`
                                  : pos.side}{' '}
                              ({pos.live_equity_toks} SPRD)
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
