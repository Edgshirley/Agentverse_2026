import React, { useState } from 'react';
import { Market, Order, OrderType, Position, PositionBid, WidthBid } from '../shared/types';

interface TradingControlsProps {
  market: Market;
  activePlayerId: string;
  positions: Position[];
  p2pBids: PositionBid[];
  orders: Order[];
  widthBids: WidthBid[];
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
}

export const TradingControls: React.FC<TradingControlsProps> = ({
  market,
  activePlayerId,
  positions,
  p2pBids,
  widthBids,
  onDispatch,
}) => {
  const [bidWidthInput, setBidWidthInput] = useState<string>('6');
  const [quoteLInput, setQuoteLInput] = useState<string>('35');
  const [p2pPriceInput, setP2pPriceInput] = useState<string>('20');
  const [p2pSideInput, setP2pSideInput] = useState<'OVER' | 'UNDER'>('OVER');
  const [orderType, setOrderType] = useState<OrderType>('stop_loss');
  const [orderTrigger, setOrderTrigger] = useState<string>('45');
  const [orderSize, setOrderSize] = useState<string>('50');
  const [settleXInput, setSettleXInput] = useState<string>(
    market.archetype === 'spread' ? '50' : '100'
  );

  const isSpread = market.archetype === 'spread';
  const openStandingBids = p2pBids.filter((b) => b.status === 'open' && b.kind === 'BID');
  const myPositions = positions.filter(
    (p) => p.player_id === activePlayerId && (p.lots > 0 || p.live_equity_toks > 0)
  );

  return (
    <section className="exhibit-box">
      <div className="exhibit-title">
        <span>11 │ === 1-TAP EXECUTION & EARLY-EXIT DESK :: [{activePlayerId.toUpperCase()}] ====</span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          1-TAP MANUAL BYPASS (SPEC §1.4 & FR-03)
        </span>
      </div>

      {/* Phase 1: Width Auction & MM Quote Controls (Spread Markets) */}
      {isSpread && (market.state === 'width_auction' || market.state === 'quoting') && (
        <div
          style={{
            border: '1px solid var(--border-strong)',
            padding: 8,
            marginBottom: 10,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
          }}
        >
          {market.state === 'width_auction' && (
            <>
              <span className="badge-inverted">WIDTH AUCTION (30s QUIET)</span>
              <span>
                BEST WIDTH: <strong>{market.active_width_w ?? 'NONE'}</strong> (MM:{' '}
                {market.mm_player_id?.toUpperCase() ?? 'NONE'})
              </span>
              <input
                type="number"
                value={bidWidthInput}
                onChange={(e) => setBidWidthInput(e.target.value)}
                style={{ width: 65, padding: '3px 6px' }}
              />
              <button
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/auction/bid`, {
                    playerId: activePlayerId,
                    width: Number(bidWidthInput),
                  })
                }
              >
                BID WIDTH (w)
              </button>
              <button
                className="btn-inverted"
                onClick={() => onDispatch(`/api/markets/${market.id}/auction/finalize`, {})}
              >
                END 30s QUIET & LOCK MM
              </button>
            </>
          )}

          {market.state === 'quoting' && (
            <>
              <span className="badge-inverted">
                MM QUOTE WINDOW (w = {market.active_width_w})
              </span>
              <span>
                WINNING MM: <strong>{market.mm_player_id?.toUpperCase()}</strong>
              </span>
              <label>
                LOWER BOUND L:{' '}
                <input
                  type="number"
                  value={quoteLInput}
                  onChange={(e) => setQuoteLInput(e.target.value)}
                  style={{ width: 65, padding: '3px 6px' }}
                />
              </label>
              <button
                className="btn-inverted"
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/auction/quote`, {
                    playerId: market.mm_player_id,
                    L: Number(quoteLInput),
                  })
                }
              >
                QUOTE [{quoteLInput}, {Number(quoteLInput) + (market.active_width_w ?? 0)}]
              </button>
              <button
                onClick={() => onDispatch(`/api/markets/${market.id}/auction/timeout`, {})}
                title="Simulate 3m MM quote timeout -> forfeits k TOKS ante to next bidder"
              >
                SIMULATE 3m TIMEOUT (-{market.lot_stake_k} TOKS ANTE)
              </button>
            </>
          )}
        </div>
      )}

      {/* Phase 2: 1-Tap Manual Takes (Over/Under or YES/NO) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ border: '1px solid var(--border-color)', padding: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 6 }}>
            1-TAP MANUAL TAKE (STAKE k = {market.lot_stake_k} TOKS / LOT)
          </div>
          {isSpread ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                className="btn-inverted"
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/take`, {
                    playerId: activePlayerId,
                    side: 'OVER',
                    amount: 1,
                  })
                }
              >
                [1-TAP OVER &gt; {market.H ?? 'H'}] (1 LOT)
              </button>
              <button
                className="btn-inverted"
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/take`, {
                    playerId: activePlayerId,
                    side: 'UNDER',
                    amount: 1,
                  })
                }
              >
                [1-TAP UNDER &lt; {market.L ?? 'L'}] (1 LOT)
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                className="btn-inverted"
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/take`, {
                    playerId: activePlayerId,
                    side: 'YES',
                    amount: market.lot_stake_k,
                  })
                }
              >
                [1-TAP YES] (+{market.lot_stake_k} TOKS)
              </button>
              <button
                className="btn-inverted"
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/take`, {
                    playerId: activePlayerId,
                    side: 'NO',
                    amount: market.lot_stake_k,
                  })
                }
              >
                [1-TAP NO] (+{market.lot_stake_k} TOKS)
              </button>
            </div>
          )}
        </div>

        {/* Dual Early Exit: P2P Position Transfer (Spread) OR Partial Pool Withdrawal (Simple/Stacked) */}
        <div style={{ border: '1px solid var(--border-color)', padding: 8 }}>
          {isSpread ? (
            <>
              <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 6 }}>
                P2P LOT TRANSFER & INSTANT CASH-OUT (SPEC §2.4.A)
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={p2pSideInput}
                  onChange={(e) => setP2pSideInput(e.target.value as 'OVER' | 'UNDER')}
                  style={{ padding: '3px 4px' }}
                >
                  <option value="OVER">OVER LOT</option>
                  <option value="UNDER">UNDER LOT</option>
                </select>
                <input
                  type="number"
                  value={p2pPriceInput}
                  onChange={(e) => setP2pPriceInput(e.target.value)}
                  style={{ width: 60, padding: '3px 6px' }}
                />
                <button
                  onClick={() =>
                    onDispatch(`/api/markets/${market.id}/p2p/bid`, {
                      buyerId: activePlayerId,
                      side: p2pSideInput,
                      priceToks: Number(p2pPriceInput),
                    })
                  }
                >
                  POST BID ({p2pPriceInput} TOKS)
                </button>
                {openStandingBids.map((b) => (
                  <button
                    key={b.id}
                    className="btn-inverted"
                    onClick={() =>
                      onDispatch(`/api/markets/${market.id}/p2p/cashout`, {
                        sellerId: activePlayerId,
                        side: b.side,
                        bidId: b.id,
                      })
                    }
                    title={`Sell 1 ${b.side} lot immediately to ${b.buyer_id.toUpperCase()} for ${b.price_toks} TOKS`}
                  >
                    CASH OUT 1x {b.side} @ {b.price_toks} TOKS (TO {b.buyer_id.toUpperCase()})
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 6 }}>
                ANYTIME PARTIAL / FULL POOL WITHDRAWAL (live_equity &gt; 0)
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[0.25, 0.5, 1.0].map((frac) => {
                  const side = myPositions[0]?.side || 'YES';
                  return (
                    <button
                      key={frac}
                      onClick={() =>
                        onDispatch(`/api/markets/${market.id}/withdraw`, {
                          playerId: activePlayerId,
                          side,
                          fractionP: frac,
                        })
                      }
                    >
                      WITHDRAW {Math.round(frac * 100)}% ({side})
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Phase 3: Public Swing Map Order Book Placement & Deterministic Settlement */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 10,
        }}
      >
        <div style={{ border: '1px solid var(--border-color)', padding: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 6 }}>
            PUBLIC LIMIT / STOP ORDER BOOK ("SWING MAP" — VISIBLE TO GROUP)
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as OrderType)}
              style={{ padding: '3px 4px' }}
            >
              <option value="stop_loss">STOP_LOSS</option>
              <option value="take_profit">TAKE_PROFIT</option>
              <option value="limit_buy">LIMIT_BUY</option>
              <option value="limit_sell">LIMIT_SELL</option>
            </select>
            <span>@</span>
            <input
              type="number"
              value={orderTrigger}
              onChange={(e) => setOrderTrigger(e.target.value)}
              style={{ width: 55, padding: '3px 5px' }}
              title="Trigger odds % or TOKS level"
            />
            <span>SIZE:</span>
            <input
              type="number"
              value={orderSize}
              onChange={(e) => setOrderSize(e.target.value)}
              style={{ width: 60, padding: '3px 5px' }}
            />
            <button
              onClick={() =>
                onDispatch(`/api/markets/${market.id}/orders`, {
                  playerId: activePlayerId,
                  side: myPositions[0]?.side || (isSpread ? 'OVER' : 'YES'),
                  type: orderType,
                  triggerLevel: Number(orderTrigger),
                  sizeToks: Number(orderSize),
                })
              }
            >
              + POST PUBLIC ORDER
            </button>
          </div>
        </div>

        <div style={{ border: '1px solid var(--border-color)', padding: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 6 }}>
            ORACLE / GOLDEN TEST SETTLEMENT DESK
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {isSpread && (
              <>
                <button
                  onClick={() =>
                    onDispatch(`/api/markets/${market.id}/resolve/settle`, { outcomeX: 50 })
                  }
                  title="Golden Test Row 1: X=50 (Over wins)"
                >
                  SETTLE X=50 (OVER)
                </button>
                <button
                  onClick={() =>
                    onDispatch(`/api/markets/${market.id}/resolve/settle`, { outcomeX: 39 })
                  }
                  title="Golden Test Row 2: X=39 (Inside [35, 43] -> MM wins)"
                >
                  SETTLE X=39 (INSIDE)
                </button>
              </>
            )}
            <input
              type="number"
              value={settleXInput}
              onChange={(e) => setSettleXInput(e.target.value)}
              style={{ width: 60, padding: '3px 6px' }}
            />
            <button
              className="btn-inverted"
              onClick={() =>
                onDispatch(`/api/markets/${market.id}/resolve/settle`, {
                  outcomeX: Number(settleXInput),
                })
              }
            >
              SETTLE @ X={settleXInput}
            </button>
          </div>
        </div>
      </div>

      {widthBids.length > 0 && isSpread && (
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--fg-muted)' }}>
          WIDTH AUCTION TRAIL:{' '}
          {widthBids.map((b) => `${b.player_id.toUpperCase()}(w=${b.width})`).join(' -> ')}
        </div>
      )}
    </section>
  );
};
