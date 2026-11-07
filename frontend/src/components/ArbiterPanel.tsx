import React, { useState } from 'react';
import { Market, Player } from '../shared/types';

interface ArbiterPanelProps {
  market: Market;
  allMarkets: Market[];
  activePlayerId: string;
  players: Player[];
  serverClockMs: number;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  onSelectMarket: (marketId: string) => void;
}

export const ArbiterPanel: React.FC<ArbiterPanelProps> = ({
  market,
  allMarkets,
  activePlayerId,
  players,
  serverClockMs,
  onDispatch,
  onSelectMarket,
}) => {
  const [arbiterOutcomeInput, setArbiterOutcomeInput] = useState<string>('100');

  if (market.route !== 'arbiter' && market.archetype !== 'stacked') {
    return null;
  }

  const arbiterNick =
    players.find((p) => p.id === market.arbiter_id)?.nickname ||
    market.arbiter_id?.toUpperCase() ||
    'ELI';

  const remainingMs = market.countdown_ends_at
    ? Math.max(0, market.countdown_ends_at - serverClockMs)
    : 0;
  const mins = String(Math.floor(remainingMs / 60000)).padStart(2, '0');
  const secs = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');
  const isLocked = market.state === 'countdown_locked' || remainingMs === 0;

  const parentMarket = market.parent_market_id
    ? allMarkets.find((m) => m.id === market.parent_market_id)
    : null;

  return (
    <section className="exhibit-box strong-border">
      {market.route === 'arbiter' && (
        <div>
          <div className="exhibit-title">
            <span>
              41 │ === 3RD-PARTY ARBITER & MANDATORY COUNTDOWN LOCK (FR-08) ====
            </span>
            <span className="badge-inverted">
              COUNTDOWN: [{isLocked ? '00:00:00 // LOCKED' : `00:${mins}:${secs}`}]
            </span>
          </div>

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
              <div>
                DESIGNATED NON-TRADING ARBITER: <strong>{arbiterNick}</strong> (BARRED FROM TRADING)
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                {isLocked
                  ? 'COUNTDOWN HIT 00:00:00 — ALL BETS & WITHDRAWALS FROZEN. AWAITING ARBITER OUTCOME X.'
                  : 'COUNTDOWN RUNNING — TRADING FREEZES AUTOMATICALLY AT 00:00:00.'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {!isLocked && (
                <button
                  onClick={() =>
                    onDispatch(`/api/markets/${market.id}/resolve/lock-countdown`, {})
                  }
                >
                  ⏩ FAST-FORWARD TO 00:00:00 LOCK
                </button>
              )}

              <input
                type="number"
                value={arbiterOutcomeInput}
                onChange={(e) => setArbiterOutcomeInput(e.target.value)}
                style={{ width: 65, padding: '3px 6px' }}
              />
              <button
                className="btn-inverted"
                onClick={() =>
                  onDispatch(`/api/markets/${market.id}/resolve/propose`, {
                    proposerId: activePlayerId,
                    outcomeX: Number(arbiterOutcomeInput),
                    sourceUrl: `arbiter://${activePlayerId}`,
                    settleImmediately: true,
                  })
                }
                title="Only the designated 3rd-party arbiter can submit outcome X"
              >
                ARBITER SUBMIT X={arbiterOutcomeInput} (AS {activePlayerId.toUpperCase()})
              </button>
            </div>
          </div>
        </div>
      )}

      {market.archetype === 'stacked' && (
        <div style={{ marginTop: market.route === 'arbiter' ? 10 : 0 }}>
          <div className="exhibit-title">
            <span>45 │ === STACKED (META / DERIVATIVE) MARKET LINK (SPEC §2.1 & §6.2) ====</span>
            <span className="badge-inverted">
              PARENT: {market.parent_market_id?.toUpperCase()}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <span>
                METRIC: <strong>{market.parent_metric?.toUpperCase() || 'OUTCOME'}</strong> | TARGET:{' '}
                <strong>{market.parent_trigger_target ?? 0}</strong> | CROSSED:{' '}
                <strong>{market.parent_trigger_crossed ? 'YES' : 'NO'}</strong>
              </span>
              {parentMarket && (
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  PARENT QUESTION: &quot;{parentMarket.question}&quot; (STATE:{' '}
                  {parentMarket.state.toUpperCase()}, IMPLIED: {parentMarket.live_implied_value})
                </div>
              )}
            </div>
            {parentMarket && (
              <button onClick={() => onSelectMarket(parentMarket.id)}>
                ↗ INSPECT PARENT MARKET ({parentMarket.id.toUpperCase()})
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
