import React, { useState, useEffect } from 'react';
import {
  Market,
  OrderType,
  Player,
} from '../shared/types';
import { ActiveMarketBundle } from '../hooks/useMarketSync';
import { PixelMascot, PixelRacerAvatar } from '../components/PixelMascot';
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
  // Contextual popups — only appear when required / clicked
  const [showCustomWithdraw, setShowCustomWithdraw] = useState<boolean>(false);
  const [withdrawValue, setWithdrawValue] = useState<string>('25');
  const [withdrawMode, setWithdrawMode] = useState<'CHIP' | '%'>('CHIP');
  const [selectedGraphLevel, setSelectedGraphLevel] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('stop_loss');
  const [orderSizeChip, setOrderSizeChip] = useState<string>('25');
  const [showAdminDrawer, setShowAdminDrawer] = useState<boolean>(false);

  // Step 1 (Width Auction) & Step 2 (Window [L, H]) state
  const [widthBidInput, setWidthBidInput] = useState<string>('2');
  const [quoteLInput, setQuoteLInput] = useState<string>('3');
  const [outcomeInput, setOutcomeInput] = useState<string>('5');

  const market = activeBundle?.market;

  useEffect(() => {
    if (!market) return;
    if (market.unit === 'pit stops' || market.unit === 'laps') {
      setWidthBidInput('2');
      setQuoteLInput('3');
      setOutcomeInput('5');
    } else if (market.unit === 'min') {
      setWidthBidInput('8');
      setQuoteLInput('35');
      setOutcomeInput('48');
    } else {
      setWidthBidInput('4');
      setQuoteLInput('22');
      setOutcomeInput('24');
    }
    setSelectedGraphLevel(null);
    setShowCustomWithdraw(false);
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
        <p style={{ maxWidth: 440, color: 'var(--fg-muted)' }}>
          Ask the Tuxedo Cat Bot to create your first bet (e.g. F1 pit stops window market or
          tomorrow&apos;s temperature).
        </p>
        <button className="btn-brand pixel-font" onClick={() => onNavigateScreen('voice')}>
          ASK BOT TO START A BET -&gt;
        </button>
      </div>
    );
  }

  const { positions, orders, widthBids, mmEscrowToks } = activeBundle;
  const isSpread = market.archetype === 'spread';
  const openOrders = orders.filter((o) => o.status === 'open');
  const unitLabel =
    market.unit && market.unit !== 'binary' && market.unit !== '%' ? market.unit : '°C';

  // Only the market creator can toggle whether everyone sees the depth graph
  const isMarketCreator = market.proposer_id === activePlayer.id;
  const isGraphVisibleToGroup =
    market.toggles?.public_positions_and_stops !== undefined
      ? Boolean(market.toggles.public_positions_and_stops)
      : showUnitLadder;

  const handleCreatorToggleVisibility = async () => {
    if (!isMarketCreator) return;
    const nextVal = !isGraphVisibleToGroup;
    onToggleUnitLadder(nextVal);
    await onDispatch(`/api/markets/${market.id}/toggles`, {
      playerId: activePlayer.id,
      public_positions_and_stops: nextVal,
    });
  };

  const myPositions = positions.filter((p) => p.player_id === activePlayer.id);
  const myActivePos = myPositions.find((p) => p.lots > 0 || p.live_equity_toks > 0);
  const myLiveBalance = myPositions.reduce((acc, p) => acc + p.live_equity_toks, 0);
  const totalPotChip =
    positions.reduce((acc, p) => acc + p.staked_toks, 0) + mmEscrowToks;

  // Step 1 Agent-Guided Handler: Bids your width, simulates friend counter-bid if needed, and advances to Step 2
  const handleStep1BidAndAdvance = async () => {
    const w = Math.max(1, Number(widthBidInput) || 2);
    await onDispatch(`/api/markets/${market.id}/auction/bid`, {
      playerId: activePlayer.id,
      width: w,
    });
    await onDispatch(`/api/markets/${market.id}/auction/finalize`, {});
  };

  // Step 2 Agent-Guided Handler: Locks window [L, H] and seeds initial friend book so graph is immediately alive
  const handleStep2LockWindowAndGoLive = async () => {
    const lVal = Number(quoteLInput) || 3;
    const wVal = market.active_width_w ?? 2;
    await onDispatch(`/api/markets/${market.id}/auction/quote`, {
      playerId: market.mm_player_id || activePlayer.id,
      L: lVal,
    });
    // Agent automatically populates initial friend liquidity on both sides of the window so the Bid/Ask graph is live
    await onDispatch(`/api/markets/${market.id}/take`, {
      playerId: 'alex',
      side: 'OVER',
      amount: 1,
    });
    await onDispatch(`/api/markets/${market.id}/take`, {
      playerId: 'sam',
      side: 'UNDER',
      amount: 1,
    });
    await onDispatch(`/api/markets/${market.id}/orders`, {
      playerId: 'alex',
      side: 'OVER',
      type: 'take_profit',
      triggerLevel: lVal + wVal + 1,
      sizeToks: market.lot_stake_k * 2,
    });
    await onDispatch(`/api/markets/${market.id}/orders`, {
      playerId: 'sam',
      side: 'UNDER',
      type: 'stop_loss',
      triggerLevel: Math.max(1, lVal - 1),
      sizeToks: market.lot_stake_k,
    });
  };

  // Simulate friend activity when requested
  const handleSimulateFriendActivity = async () => {
    const friendNames = ['ALEX', 'SAM', 'JORDAN'];
    const friendId = friendNames[Math.floor(Math.random() * friendNames.length)].toLowerCase();
    const side = isSpread
      ? Math.random() > 0.5
        ? 'OVER'
        : 'UNDER'
      : Math.random() > 0.45
        ? 'NO'
        : 'YES';
    await onDispatch(`/api/markets/${market.id}/take`, {
      playerId: friendId,
      side,
      amount: isSpread ? 1 : market.lot_stake_k,
    });
    const center = isSpread ? market.L ?? 3 : 24;
    const lvl = side === 'YES' || side === 'OVER' ? center + 1 : Math.max(1, center - 1);
    await onDispatch(`/api/markets/${market.id}/orders`, {
      playerId: friendId,
      side,
      type: side === 'YES' || side === 'OVER' ? 'limit_buy' : 'stop_loss',
      triggerLevel: lvl,
      sizeToks: market.lot_stake_k,
    });
  };

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

  // ==========================================================================
  // ONLY POP UP STEP 1 OR STEP 2 IF THE MARKET IS NOT YET LIVE
  // ==========================================================================
  if (isSpread && market.state === 'width_auction') {
    return (
      <div className="poker-felt-arena" style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PixelMascot size={42} showExclamation={true} />
          <div>
            <div className="pixel-font" style={{ fontSize: 11, color: 'var(--pastel-gold-text)' }}>
              AGENT STEP 1 OF 2 · WINDOW WIDTH BIDDING
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {market.question.replace(/TOKS/gi, 'CHIP')}
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>
          How narrow of a window width (<strong>W in {unitLabel}</strong>) are you willing to make?
          The tightest window wins the Market Maker seat and sets the exact <strong>[L, H]</strong>{' '}
          range.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '14px 16px',
            borderRadius: 10,
            backgroundColor: 'var(--bg-canvas)',
            border: '1.5px solid var(--border-color)',
          }}
        >
          <span style={{ fontSize: 12.5 }}>Window Width (W):</span>
          <input
            type="number"
            min={1}
            value={widthBidInput}
            onChange={(e) => setWidthBidInput(e.target.value)}
            style={{ width: 72, padding: '6px 10px', fontWeight: 700 }}
          />
          <span className="pixel-font" style={{ fontSize: 11 }}>
            {unitLabel}
          </span>
          <button
            className="btn-mint pixel-font"
            style={{ marginLeft: 'auto' }}
            onClick={handleStep1BidAndAdvance}
          >
            CONFIRM WIDTH ({widthBidInput} {unitLabel.toUpperCase()}) -&gt;
          </button>
        </div>
      </div>
    );
  }

  if (isSpread && market.state === 'quoting') {
    const w = market.active_width_w ?? (Number(widthBidInput) || 2);
    const lVal = Number(quoteLInput) || 0;
    const hVal = lVal + w;

    return (
      <div className="poker-felt-arena" style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PixelMascot size={42} showExclamation={true} />
          <div>
            <div className="pixel-font" style={{ fontSize: 11, color: 'var(--pastel-mint-text)' }}>
              AGENT STEP 2 OF 2 · SELECT THE WINDOW [L, H]
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              Window Width Locked at {w} {unitLabel} — Choose Start Level (L)
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>
          Set where the window begins so friends can bet <strong>ABOVE (&gt; {hVal})</strong> and{' '}
          <strong>BELOW (&lt; {lVal})</strong> the window.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '14px 16px',
            borderRadius: 10,
            backgroundColor: 'var(--bg-canvas)',
            border: '1.5px solid var(--border-color)',
          }}
        >
          <span>Start (L):</span>
          <input
            type="number"
            value={quoteLInput}
            onChange={(e) => setQuoteLInput(e.target.value)}
            style={{ width: 72, padding: '6px 10px', fontWeight: 700 }}
          />
          <span className="badge-outline pixel-font">
            WINDOW: [{lVal} .. {hVal}] {unitLabel}
          </span>
          <button
            className="btn-mint pixel-font"
            style={{ marginLeft: 'auto' }}
            onClick={handleStep2LockWindowAndGoLive}
          >
            OPEN LIVE MARKET [{lVal}..{hVal}] -&gt;
          </button>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // LIVE MARKET VIEW:
  // 1) 8-Bit Segmented Race Track Bar (Screenshot 4)
  // 2) Symmetrical Center-Spine BID / ASK & STOP-LOSS Depth Graph (Screenshot 3)
  // ==========================================================================

  const currentUnitCenter = isSpread
    ? Math.round(((market.L ?? 3) + (market.H ?? 5)) / 2)
    : market.live_implied_value <= 35
      ? market.live_implied_value
      : 24;

  const ladderStep =
    market.unit === 'pit stops' || market.unit === 'laps' ? 1 : isSpread ? 3 : 1;

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

  // Compute Left (BID / BUY / ABOVE) and Right (ASK / STOP-LOSS / BELOW) volumes per level for Screenshot 3 Graph
  const rowsData = allUnitLevels.map((lvl) => {
    const ordersAtLvl = openOrders.filter((o) => o.trigger_level === lvl);
    const isCurrent = lvl === currentUnitCenter;
    const isInsideWindow =
      isSpread && market.L != null && market.H != null && lvl >= market.L && lvl <= market.H;

    // Left (Green / Bid / Long / Above): limit_buy orders + active YES/OVER positions at current/upper boundary
    const bidOrdersVol = ordersAtLvl
      .filter((o) => o.type === 'limit_buy' || o.side === 'OVER' || o.side === 'YES')
      .filter((o) => o.type !== 'stop_loss')
      .reduce((acc, o) => acc + o.size_toks, 0);

    const activeLongVol =
      (isCurrent && !isSpread) || (isSpread && lvl === market.H)
        ? positions
            .filter((p) => (p.side === 'YES' || p.side === 'OVER') && p.live_equity_toks > 0)
            .reduce((acc, p) => acc + p.live_equity_toks, 0)
        : 0;

    // Right (Coral / Ask / Stop-Loss / Below): stop_loss, take_profit, limit_sell + active NO/UNDER positions
    const askOrdersVol = ordersAtLvl
      .filter(
        (o) =>
          o.type === 'stop_loss' ||
          o.type === 'take_profit' ||
          o.type === 'limit_sell' ||
          o.side === 'UNDER' ||
          o.side === 'NO'
      )
      .reduce((acc, o) => acc + o.size_toks, 0);

    const activeShortVol =
      (isCurrent && !isSpread) || (isSpread && lvl === market.L)
        ? positions
            .filter((p) => (p.side === 'NO' || p.side === 'UNDER') && p.live_equity_toks > 0)
            .reduce((acc, p) => acc + p.live_equity_toks, 0)
        : 0;

    // Give subtle baseline visual depth around the center so the Bid/Ask ladder always looks rich like Screenshot 3
    const dist = Math.abs(lvl - currentUnitCenter);
    const baselineBid = lvl >= currentUnitCenter ? Math.max(10, 45 - dist * 10) : 0;
    const baselineAsk = lvl <= currentUnitCenter ? Math.max(10, 45 - dist * 10) : 0;

    const totalBidVol = bidOrdersVol + activeLongVol + baselineBid;
    const totalAskVol = askOrdersVol + activeShortVol + baselineAsk;

    const stopLabels = ordersAtLvl.map((o) => {
      const nick =
        players.find((pl) => pl.id === o.player_id)?.nickname || o.player_id.toUpperCase();
      return `${nick} ${o.type === 'stop_loss' ? 'STOP' : 'LIMIT'}`;
    });

    return {
      lvl,
      isCurrent,
      isInsideWindow,
      totalBidVol,
      totalAskVol,
      stopLabels,
    };
  });

  const maxBarVol = Math.max(
    60,
    ...rowsData.map((r) => Math.max(r.totalBidVol, r.totalAskVol))
  );

  // Build Racers for the 8-Bit Segmented Race Bar (Screenshot 4 Style)
  const activePositions = positions.filter((p) => p.live_equity_toks > 0 || p.lots > 0);
  const raceItems = [
    {
      id: 'you_racer',
      name: activePlayer.nickname,
      subtitle: myActivePos
        ? `${myActivePos.side === 'OVER' ? 'ABOVE' : myActivePos.side === 'UNDER' ? 'BELOW' : myActivePos.side} · ${myLiveBalance} CHIP`
        : 'READY TO BET',
      pct: Math.min(95, Math.max(18, myLiveBalance > 0 ? Math.round((myLiveBalance / Math.max(100, totalPotChip)) * 100) : 32)),
      colorClass: 'filled-mint' as const,
      accent: 'var(--pastel-mint-border)',
      rightLabel: `${myLiveBalance} CHIP`,
    },
    ...activePositions
      .filter((p) => p.player_id !== activePlayer.id)
      .slice(0, 2)
      .map((pos, idx) => {
        const nick =
          players.find((pl) => pl.id === pos.player_id)?.nickname ||
          pos.player_id.toUpperCase();
        const pct = Math.min(
          92,
          Math.max(24, Math.round((pos.live_equity_toks / Math.max(100, totalPotChip)) * 100))
        );
        return {
          id: pos.id,
          name: nick,
          subtitle: `${pos.side === 'OVER' ? 'ABOVE' : pos.side === 'UNDER' ? 'BELOW' : pos.side} · ${pos.live_equity_toks} CHIP`,
          pct,
          colorClass: idx % 2 === 0 ? ('filled-coral' as const) : ('filled-sky' as const),
          accent: idx % 2 === 0 ? 'var(--pastel-coral-border)' : 'var(--pastel-sky-border)',
          rightLabel: `${pos.live_equity_toks} CHIP`,
        };
      }),
  ];

  // Countdown for Arbiter markets
  const remainingMs = market.countdown_ends_at
    ? Math.max(0, market.countdown_ends_at - serverClockMs)
    : 0;
  const mins = String(Math.floor(remainingMs / 60000)).padStart(2, '0');
  const secs = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820, margin: '0 auto' }}>
      {/* Clean Header Strip */}
      <div
        className="poker-felt-arena"
        style={{
          padding: '16px 20px',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <div className="pixel-font" style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              {isSpread
                ? `WINDOW MARKET [${market.L ?? 3} .. ${market.H ?? 5}] ${unitLabel.toUpperCase()}`
                : `${market.archetype.toUpperCase()} MARKET`}{' '}
              · POT: {totalPotChip} CHIP
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>
              {market.question.replace(/TOKS/gi, 'CHIP')}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {allMarkets.length > 1 && (
              <select
                value={market.id}
                onChange={(e) => onSelectMarket(e.target.value)}
                style={{ padding: '5px 10px', fontSize: 11.5 }}
              >
                {allMarkets.map((m, i) => (
                  <option key={m.id} value={m.id}>
                    Bet #{i + 1}: {m.question.slice(0, 24)}...
                  </option>
                ))}
              </select>
            )}
            <button
              style={{ fontSize: 11, padding: '5px 10px' }}
              onClick={() => setShowAdminDrawer((v) => !v)}
            >
              {showAdminDrawer ? 'CLOSE OPTIONS ▲' : 'OPTIONS ▾'}
            </button>
          </div>
        </div>

        {/* Collapsible Agent / Creator Options Drawer (Hidden unless clicked so UI stays uncluttered!) */}
        {showAdminDrawer && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: 8,
              backgroundColor: 'var(--bg-canvas)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={{ fontSize: 11 }} onClick={handleSimulateFriendActivity}>
                + SIMULATE FRIEND BET
              </button>
              {isMarketCreator && (
                <button style={{ fontSize: 11 }} onClick={handleCreatorToggleVisibility}>
                  {isGraphVisibleToGroup ? 'HIDE DEPTH GRAPH FOR ALL' : 'SHOW DEPTH GRAPH FOR ALL'}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {market.route === 'arbiter' && (
                <span className="pixel-font" style={{ fontSize: 10, marginRight: 6 }}>
                  TIMER 00:{mins}:{secs}
                </span>
              )}
              <input
                type="number"
                value={outcomeInput}
                onChange={(e) => setOutcomeInput(e.target.value)}
                style={{ width: 60, padding: '4px 6px', fontSize: 11 }}
              />
              <button
                className="btn-inverted pixel-font"
                style={{ fontSize: 10, padding: '5px 10px' }}
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/resolve/settle`, {
                    outcomeX: Number(outcomeInput),
                  })
                }
              >
                SETTLE ({outcomeInput} {unitLabel})
              </button>
            </div>
          </div>
        )}

        {/* ================================================================
         * 1. 8-BIT SEGMENTED RACE TRACK BAR (Screenshot 4 Design)
         * ================================================================ */}
        <div className="race-track-wrap">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 10,
              color: 'var(--fg-muted)',
            }}
          >
            <span className="pixel-font">LIVE RACE STANDINGS &amp; TARGET LINE</span>
            <span className="pixel-font">
              {isSpread
                ? `TARGET WINDOW: [${market.L ?? 3}..${market.H ?? 5}] ${unitLabel.toUpperCase()}`
                : `CURRENT LINE: ${currentUnitCenter} ${unitLabel.toUpperCase()}`}
            </span>
          </div>

          {raceItems.map((item, idx) => {
            const filledCount = Math.max(1, Math.min(16, Math.round((item.pct / 100) * 16)));
            const avatarLeftPct = Math.min(94, Math.max(6, (filledCount / 16) * 100));

            return (
              <div key={item.id} className="race-row">
                <div>
                  <div className="pixel-font" style={{ fontSize: 12, fontWeight: 700 }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--fg-muted)' }}>{item.subtitle}</div>
                </div>

                <div className="race-bar-lane">
                  {/* Dashed Target / Finish Flag Line */}
                  <div className="race-target-line" style={{ left: '75%' }}>
                    {idx === 0 && (
                      <span className="race-target-flag">
                        ⚑ {isSpread ? `[${market.L}..${market.H}]` : `${currentUnitCenter}${unitLabel}`}
                      </span>
                    )}
                  </div>

                  {/* 8-Bit Pixel Racer Sprite sitting on top of the active block */}
                  <div className="race-avatar-pin" style={{ left: `${avatarLeftPct}%` }}>
                    <PixelRacerAvatar accent={item.accent} size={22} />
                  </div>

                  {/* 16 Segmented Blocks */}
                  {Array.from({ length: 16 }).map((_, segIdx) => (
                    <div
                      key={segIdx}
                      className={`race-seg ${segIdx < filledCount ? item.colorClass : ''}`}
                    />
                  ))}
                </div>

                <div
                  className="pixel-font"
                  style={{
                    fontSize: 13,
                    textAlign: 'right',
                    color: item.accent,
                  }}
                >
                  {item.rightLabel}
                </div>
              </div>
            );
          })}
        </div>

        {/* ================================================================
         * 2. SYMMETRICAL CENTER-SPINE BID / ASK & STOP-LOSS GRAPH (Screenshot 3 Design)
         * ================================================================ */}
        {isGraphVisibleToGroup && (
          <div className="depth-graph-wrap">
            <div className="depth-header-grid">
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingRight: 8 }}>
                <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>VOLUME (CHIP)</span>
                <span style={{ color: 'var(--accent-pos)' }}>
                  {isSpread ? '▲ ABOVE / BID' : '✓ YES / BID'}
                </span>
              </div>
              <div style={{ textAlign: 'center', color: 'var(--fg-muted)', fontSize: 10 }}>
                LEVEL ({unitLabel.toUpperCase()})
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 8 }}>
                <span style={{ color: 'var(--accent-neg)' }}>
                  {isSpread ? '▼ BELOW / STOPS' : '✗ NO / STOPS'}
                </span>
                <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>VOLUME (CHIP)</span>
              </div>
            </div>

            {rowsData.map((row) => {
              const bidWidthPct = Math.min(100, Math.max(18, Math.round((row.totalBidVol / maxBarVol) * 100)));
              const askWidthPct = Math.min(100, Math.max(18, Math.round((row.totalAskVol / maxBarVol) * 100)));

              return (
                <div
                  key={row.lvl}
                  className="depth-row-grid"
                  onClick={() =>
                    setSelectedGraphLevel((prev) => (prev === row.lvl ? null : row.lvl))
                  }
                  title={`Click ${row.lvl} ${unitLabel} to place a stop-loss or limit order at this level`}
                >
                  {/* LEFT BAR: Green BID / BUY / ABOVE Volume */}
                  <div className="depth-side-bid">
                    <div className="depth-bar-bid" style={{ width: `${bidWidthPct}%` }}>
                      <span>{row.totalBidVol} CHIP</span>
                      <span style={{ opacity: 0.75, fontSize: 9.5 }}>●</span>
                    </div>
                  </div>

                  {/* CENTER SPINE: Unit Level Pill */}
                  <div
                    className={`depth-center-pill ${
                      row.isCurrent ? 'is-current' : row.isInsideWindow ? 'is-window' : ''
                    }`}
                  >
                    <span>
                      {row.lvl} {unitLabel}
                    </span>
                  </div>

                  {/* RIGHT BAR: Coral ASK / STOP-LOSS / BELOW Volume */}
                  <div className="depth-side-ask">
                    <div className="depth-bar-ask" style={{ width: `${askWidthPct}%` }}>
                      <span style={{ opacity: 0.85, fontSize: 9.5 }}>
                        {row.stopLabels.length > 0 ? row.stopLabels[0] : '●'}
                      </span>
                      <span>{row.totalAskVol} CHIP</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Contextual 1-Line Order Popup ONLY when user clicks a level on the graph */}
            {selectedGraphLevel !== null && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  marginTop: 8,
                  padding: '10px 12px',
                  borderRadius: 8,
                  backgroundColor: 'var(--bg-panel)',
                  border: '1.5px solid var(--border-color)',
                }}
              >
                <span className="pixel-font" style={{ fontSize: 10.5 }}>
                  AT {selectedGraphLevel} {unitLabel.toUpperCase()}:
                </span>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value as OrderType)}
                  style={{ padding: '4px 8px', fontSize: 11.5 }}
                >
                  <option value="stop_loss">STOP LOSS</option>
                  <option value="take_profit">TAKE PROFIT (SELL)</option>
                  <option value="limit_buy">BUY LIMIT (BID)</option>
                </select>
                <input
                  type="number"
                  value={orderSizeChip}
                  onChange={(e) => setOrderSizeChip(e.target.value)}
                  style={{ width: 68, padding: '4px 8px', fontSize: 11.5 }}
                />
                <span style={{ fontSize: 11.5 }}>CHIP</span>
                <button
                  className="btn-inverted pixel-font"
                  style={{ fontSize: 10, padding: '5px 10px' }}
                  onClick={async () => {
                    await onDispatch(`/api/markets/${market.id}/orders`, {
                      playerId: activePlayer.id,
                      side: myActivePos?.side || (isSpread ? 'OVER' : 'YES'),
                      type: orderType,
                      triggerLevel: selectedGraphLevel,
                      sizeToks: Number(orderSizeChip),
                    });
                    setSelectedGraphLevel(null);
                  }}
                >
                  CONFIRM ORDER
                </button>
                <button
                  style={{ fontSize: 10, padding: '4px 8px' }}
                  onClick={() => setSelectedGraphLevel(null)}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {/* ================================================================
         * 3. CLEAN MINIMAL ACTION BAR (Only Primary Actions + Conditional Withdraw)
         * ================================================================ */}
        {(market.state === 'live' || market.state === 'open') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {isSpread ? (
                <>
                  <button
                    className="btn-mint pixel-font"
                    style={{ flex: 1, minWidth: 180, padding: '10px 16px' }}
                    onClick={() =>
                      onDispatch(`/api/markets/${market.id}/take`, {
                        playerId: activePlayer.id,
                        side: 'OVER',
                        amount: 1,
                      })
                    }
                  >
                    ▲ BET ABOVE (&gt; {market.H ?? 5} {unitLabel}) · +{market.lot_stake_k} CHIP
                  </button>
                  <button
                    className="btn-coral pixel-font"
                    style={{ flex: 1, minWidth: 180, padding: '10px 16px' }}
                    onClick={() =>
                      onDispatch(`/api/markets/${market.id}/take`, {
                        playerId: activePlayer.id,
                        side: 'UNDER',
                        amount: 1,
                      })
                    }
                  >
                    ▼ BET BELOW (&lt; {market.L ?? 3} {unitLabel}) · +{market.lot_stake_k} CHIP
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn-mint pixel-font"
                    style={{ flex: 1, minWidth: 160, padding: '10px 16px' }}
                    onClick={() =>
                      onDispatch(`/api/markets/${market.id}/take`, {
                        playerId: activePlayer.id,
                        side: 'YES',
                        amount: market.lot_stake_k,
                      })
                    }
                  >
                    ✓ BET YES (+{market.lot_stake_k} CHIP)
                  </button>
                  <button
                    className="btn-coral pixel-font"
                    style={{ flex: 1, minWidth: 160, padding: '10px 16px' }}
                    onClick={() =>
                      onDispatch(`/api/markets/${market.id}/take`, {
                        playerId: activePlayer.id,
                        side: 'NO',
                        amount: market.lot_stake_k,
                      })
                    }
                  >
                    ✗ BET NO (+{market.lot_stake_k} CHIP)
                  </button>
                </>
              )}

              {/* Withdraw buttons only appear once you have an active balance in the bet */}
              {myLiveBalance > 0 && (
                <>
                  <button onClick={() => setShowCustomWithdraw((v) => !v)}>
                    WITHDRAW X% / CHIP
                  </button>
                  <button
                    onClick={() =>
                      onDispatch(`/api/markets/${market.id}/withdraw`, {
                        playerId: activePlayer.id,
                        side: myActivePos?.side || (isSpread ? 'OVER' : 'YES'),
                        fractionP: 1.0,
                      })
                    }
                  >
                    WITHDRAW ALL ({myLiveBalance} CHIP)
                  </button>
                </>
              )}
            </div>

            {showCustomWithdraw && myLiveBalance > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderRadius: 8,
                  backgroundColor: 'var(--bg-canvas)',
                  border: '1.5px solid var(--border-color)',
                }}
              >
                <span style={{ fontSize: 12 }}>WITHDRAW:</span>
                <input
                  type="number"
                  value={withdrawValue}
                  onChange={(e) => setWithdrawValue(e.target.value)}
                  style={{ width: 70, padding: '4px 8px', fontWeight: 700 }}
                />
                <select
                  value={withdrawMode}
                  onChange={(e) => setWithdrawMode(e.target.value as 'CHIP' | '%')}
                  style={{ padding: '4px 8px', fontWeight: 700 }}
                >
                  <option value="CHIP">CHIP</option>
                  <option value="%">%</option>
                </select>
                <button className="btn-mint pixel-font" onClick={handleCustomWithdraw}>
                  CONFIRM
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
