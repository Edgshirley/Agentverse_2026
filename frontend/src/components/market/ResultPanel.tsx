import React, { useState } from 'react';
import { Icon } from '../Icon';
import { Market, Player } from '../../shared/types';
import { PixelMascot } from '../PixelMascot';
import {
  describeOutcome,
  formatTimeLeft,
  isAwaitingResult,
  useNow,
} from '../../utils/marketTime';

interface ResultPanelProps {
  market: Market;
  players: Player[];
  activePlayer: Player;
  /** Creator (or arbiter) enters the result; local dev lets anyone. */
  canResolve: boolean;
  unitLabel: string;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
}

/**
 * The end of a bet: countdown → enter the result (YES / NO, or a number for window
 * bets) → results card showing who won and lost what.
 */
export const ResultPanel: React.FC<ResultPanelProps> = ({
  market,
  players,
  activePlayer,
  canResolve,
  unitLabel,
  onDispatch,
}) => {
  const now = useNow(15_000);
  const [value, setValue] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const isWindow = market.archetype === 'spread';
  const nameOf = (id: string) =>
    id === activePlayer.id ? 'You' : players.find((p) => p.id === id)?.nickname ?? id;

  const act = async (path: string, body: Record<string, any> = {}) => {
    setBusy(true);
    try {
      await onDispatch(path, body);
    } finally {
      setBusy(false);
    }
  };
  const settle = (outcomeX: number) =>
    act(`/api/markets/${market.id}/resolve/settle`, { outcomeX, playerId: activePlayer.id });

  // ---- Finished: results card -------------------------------------------------
  if (market.state === 'settled' || market.state === 'void') {
    const rows = Object.entries(market.settlement_pnl ?? {})
      .filter(([id, pnl]) => pnl !== 0 || id === activePlayer.id)
      .sort((a, b) => b[1] - a[1]);
    return (
      <div className="result-panel result-panel--done">
        <div className="result-panel__head">
          <PixelMascot size={34} />
          <div>
            <div className="pixel-font result-panel__kicker">
              {market.state === 'void' ? 'BET CANCELLED' : 'FINAL RESULT'}
            </div>
            <div className="pixel-font result-panel__outcome">
              {market.state === 'void' ? 'Everyone refunded' : `RESULT: ${describeOutcome(market)}`}
            </div>
          </div>
        </div>
        {rows.length > 0 && (
          <ul className="result-panel__rows">
            {rows.map(([id, pnl]) => (
              <li key={id} className={pnl > 0 ? 'won' : pnl < 0 ? 'lost' : ''}>
                <span>{nameOf(id)}</span>
                <span className="pixel-font">
                  {pnl > 0 ? `WON ${pnl}` : pnl < 0 ? `LOST ${-pnl}` : 'EVEN'} CHIP
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ---- Still running ------------------------------------------------------------
  const timeUp = isAwaitingResult(market, now);
  const closes = market.closes_at_wall_ms;

  return (
    <div className={`result-panel ${timeUp ? 'result-panel--due' : ''}`}>
      <div className="result-panel__status">
        <Icon name="flag" size={14} />
        <span className="pixel-font">
          {timeUp
            ? "TIME'S UP · BETTING CLOSED"
            : closes != null
              ? `BETTING CLOSES IN ${formatTimeLeft(closes - now).toUpperCase()}`
              : 'NO CLOSE TIME'}
        </span>
      </div>

      {canResolve ? (
        <>
          <div className="result-panel__hint">
            {timeUp ? 'What happened? Enter the result to pay everyone out.' : 'Know the result already? You can settle early.'}
          </div>
          {isWindow ? (
            <form
              className="result-panel__actions"
              onSubmit={(e) => {
                e.preventDefault();
                if (value.trim() !== '' && Number.isFinite(Number(value))) settle(Number(value));
              }}
            >
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={`Result (${unitLabel})`}
                aria-label={`Result in ${unitLabel}`}
              />
              <button className="btn-brand pixel-font" disabled={busy || value.trim() === ''}>
                SETTLE
              </button>
            </form>
          ) : (
            <div className="result-panel__actions">
              <button className="btn-mint pixel-font" disabled={busy} onClick={() => settle(100)}>
                <Icon name="check" size={14} /> YES
              </button>
              <button className="btn-brand pixel-font" disabled={busy} onClick={() => settle(0)}>
                <Icon name="close" size={14} /> NO
              </button>
            </div>
          )}
          <div className="result-panel__cancel">
            {confirmCancel ? (
              <>
                <span>Cancel the bet and refund everyone?</span>
                <button disabled={busy} onClick={() => act(`/api/markets/${market.id}/void`, { playerId: activePlayer.id })}>
                  YES, CANCEL
                </button>
                <button onClick={() => setConfirmCancel(false)}>KEEP IT</button>
              </>
            ) : (
              <button className="result-panel__link" onClick={() => setConfirmCancel(true)}>
                Cancel bet &amp; refund
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="result-panel__hint">
          {timeUp
            ? `Waiting for ${nameOf(market.arbiter_id ?? market.proposer_id)} to enter the result.`
            : `${nameOf(market.arbiter_id ?? market.proposer_id)} enters the result when it closes.`}
        </div>
      )}
    </div>
  );
};
