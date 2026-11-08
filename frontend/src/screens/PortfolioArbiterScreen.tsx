import React from 'react';
import {
  Market,
  Order,
  Player,
  Position,
  StrategyMandate,
} from '../shared/types';
import { ArbiterPanel } from '../components/ArbiterPanel';

interface PortfolioArbiterScreenProps {
  activeMarket: Market;
  allMarkets: Market[];
  activePlayer: Player;
  players: Player[];
  positions: Position[];
  orders: Order[];
  mandates: StrategyMandate[];
  serverClockMs: number;
  onSelectMarket: (marketId: string) => void;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onNavigateScreen: (screen: 'voice' | 'chat' | 'table' | 'portfolio') => void;
}

export const PortfolioArbiterScreen: React.FC<PortfolioArbiterScreenProps> = ({
  activeMarket,
  allMarkets,
  activePlayer,
  players,
  positions,
  orders,
  mandates,
  serverClockMs,
  onSelectMarket,
  onDispatch,
  onNavigateScreen,
}) => {
  const myPositions = positions.filter((p) => p.player_id === activePlayer.id);
  const myOrders = orders.filter((o) => o.player_id === activePlayer.id && o.status === 'open');
  const myMandates = mandates.filter((m) => m.player_id === activePlayer.id);

  const stackedMarkets = allMarkets.filter((m) => m.archetype === 'stacked');
  const arbiterMarkets = allMarkets.filter((m) => m.route === 'arbiter');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Top Row: Trader Wallet, Escrow, Active Strategy Risk Guardrails */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 14,
        }}
      >
        <div className="exhibit-box strong-border">
          <div className="exhibit-title">
            <span>TRADER ACCOUNT :: {activePlayer.nickname}</span>
            <span className="badge-inverted">LIVE LEDGER</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: 'var(--fg-muted)' }}>AVAILABLE WALLET:</span>
            <strong style={{ fontSize: 16 }}>
              {activePlayer.wallet_balance_toks.toLocaleString()} TOKS
            </strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--fg-muted)' }}>LOCKED IN ESCROW:</span>
            <strong style={{ fontSize: 16 }}>
              {activePlayer.escrow_balance_toks.toLocaleString()} TOKS
            </strong>
          </div>
        </div>

        <div className="exhibit-box">
          <div className="exhibit-title">
            <span>CONFIRMED AI STRATEGIES & HARD RISK FLOORS</span>
            <button
              style={{ fontSize: 10, padding: '2px 8px' }}
              onClick={() => onNavigateScreen('voice')}
            >
              + ADD VIA VOICE BOT
            </button>
          </div>
          {myMandates.length === 0 && myOrders.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
              No active strategy mandates on selected market ({activeMarket.id.toUpperCase()}). Use
              the Voice Bot screen to set your strategy, sell target, and balance floor.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {myMandates.map((m) => (
                <div
                  key={m.id}
                  style={{
                    border: '1px solid var(--border-color)',
                    padding: '6px 10px',
                    fontSize: 11.5,
                  }}
                >
                  <strong>{m.parsed_strategy_summary}</strong> · SELL @{' '}
                  <strong>{m.take_profit_level}</strong> · FLOOR @{' '}
                  <strong>{m.min_balance_floor}</strong>
                </div>
              ))}
              {myOrders.map((o) => (
                <div key={o.id} style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  OPEN ORDER: {o.type.toUpperCase()} {o.side} @ {o.trigger_level} ({o.size_toks}{' '}
                  TOKS)
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Middle Row: 3rd-Party Arbiter & Countdown Desk (Custom Unverifiable Bets) */}
      <div className="exhibit-box strong-border">
        <div className="exhibit-title">
          <span>CUSTOM UNVERIFIABLE BETS // 3RD-PARTY ARBITER & COUNTDOWN DESK</span>
          <span className="badge-outline">{arbiterMarkets.length} CUSTOM ARBITER MARKETS</span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {arbiterMarkets.map((m) => (
            <button
              key={m.id}
              className={m.id === activeMarket.id ? 'btn-inverted' : ''}
              onClick={() => onSelectMarket(m.id)}
            >
              {m.id.toUpperCase()} :: {m.question.slice(0, 46)} (ARBITER:{' '}
              {m.arbiter_id?.toUpperCase()})
            </button>
          ))}
        </div>

        {activeMarket.route === 'arbiter' ? (
          <ArbiterPanel
            market={activeMarket}
            allMarkets={allMarkets}
            activePlayerId={activePlayer.id}
            players={players}
            serverClockMs={serverClockMs}
            onDispatch={onDispatch}
            onSelectMarket={onSelectMarket}
          />
        ) : (
          <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
            Select a custom arbiter market above (e.g., <strong>MKT_ARBITER_KPI</strong>) to inspect
            its live countdown timer or input the 3rd-party arbiter outcome.
          </div>
        )}
      </div>

      {/* Bottom Row: Stacked Markets ("Markets on Markets") */}
      <div className="exhibit-box">
        <div className="exhibit-title">
          <span>STACKED DERIVATIVE MARKETS ("MARKETS ON MARKETS")</span>
          <button
            style={{ fontSize: 10, padding: '2px 8px' }}
            onClick={() => onNavigateScreen('voice')}
          >
            + STACK NEW MARKET
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 12,
          }}
        >
          {stackedMarkets.map((sm) => {
            const parent = allMarkets.find((m) => m.id === sm.parent_market_id);
            return (
              <div
                key={sm.id}
                style={{
                  border: '1px solid var(--border-strong)',
                  padding: 12,
                  backgroundColor: 'var(--bg-elevated)',
                }}
              >
                <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 4 }}>
                  STACKED ON PARENT: <strong>{parent?.id.toUpperCase() || sm.parent_market_id}</strong>
                </div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{sm.question}</div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 11,
                  }}
                >
                  <span>
                    IMPLIED ODDS: <strong>{sm.live_implied_value}%</strong>
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {parent && (
                      <button
                        style={{ fontSize: 10, padding: '3px 8px' }}
                        onClick={() => {
                          onSelectMarket(parent.id);
                          onNavigateScreen('table');
                        }}
                      >
                        PARENT ({parent.id.toUpperCase()})
                      </button>
                    )}
                    <button
                      className="btn-inverted"
                      style={{ fontSize: 10, padding: '3px 8px' }}
                      onClick={() => {
                        onSelectMarket(sm.id);
                        onNavigateScreen('chat');
                      }}
                    >
                      TRADE STACKED -&gt;
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {myPositions.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 6 }}>
              YOUR POSITION IN SELECTED MARKET ({activeMarket.id.toUpperCase()}):
            </div>
            {myPositions.map((pos) => (
              <div
                key={pos.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 0',
                }}
              >
                <span>
                  SIDE: <strong>{pos.side}</strong> · LIVE BALANCE:{' '}
                  <strong>{pos.live_equity_toks} TOKS</strong> (ENTRY: {pos.entry_cost_toks} TOKS)
                </span>
                {pos.live_equity_toks > 0 && activeMarket.archetype !== 'spread' && (
                  <button
                    onClick={() =>
                      onDispatch(`/api/markets/${activeMarket.id}/withdraw`, {
                        playerId: activePlayer.id,
                        side: pos.side,
                        fractionP: 1.0,
                      })
                    }
                  >
                    WITHDRAW 100% NOW
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
