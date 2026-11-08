import React, { useEffect, useState } from 'react';
import { Icon } from '../Icon';
import { Market, OutcomeProposal, Player } from '../../shared/types';
import { useServerCountdown } from '../../hooks/useServerCountdown';

interface OutcomePanelProps {
  market: Market;
  proposal: OutcomeProposal | null;
  activePlayer: Player;
  serverClockMs: number;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
}

function formatResult(market: Market, value: number): string {
  if (market.archetype === 'simple') return value >= 50 ? 'YES' : 'NO';
  return `${value} ${market.unit}`;
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** How a bet ends: the bot's result and evidence, or the group's report, plus the challenge. */
export const OutcomePanel: React.FC<OutcomePanelProps> = ({
  market,
  proposal,
  activePlayer,
  serverClockMs,
  onDispatch,
}) => {
  const [value, setValue] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setValue('');
    setNote(null);
  }, [market.id]);

  const inChallenge = market.state === 'outcome_proposed' && proposal != null;
  const secondsLeft = useServerCountdown(
    inChallenge ? proposal.challenge_deadline : null,
    serverClockMs
  );

  const hint = market.archetype === 'simple' ? '100 = yes, 0 = no' : market.unit;
  const entered = value.trim() !== '' && Number.isFinite(Number(value));

  const askBot = async () => {
    setChecking(true);
    setNote(null);
    try {
      const verdict = await onDispatch(`/api/markets/${market.id}/resolve/bot`, {
        playerId: activePlayer.id,
      });
      if (verdict.status !== 'resolved') setNote(verdict.explanation);
    } catch {
      // The error banner already says what went wrong
    } finally {
      setChecking(false);
    }
  };

  const submit = async (action: 'propose' | 'challenge') => {
    await onDispatch(
      `/api/markets/${market.id}/resolve/${action}`,
      action === 'propose'
        ? { playerId: activePlayer.id, outcomeX: Number(value) }
        : { playerId: activePlayer.id, votedX: Number(value) }
    );
    setValue('');
  };

  if (market.state === 'void') {
    return <p className="auction-hint">This bet was voided and stakes were returned.</p>;
  }

  const evidence = proposal && (
    <>
      {proposal.explanation && <p className="odds-summary">{proposal.explanation}</p>}
      {proposal.sources && proposal.sources.length > 0 && (
        <p className="odds-sources">
          {proposal.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title}
            </a>
          ))}
        </p>
      )}
    </>
  );

  if (market.state === 'settled') {
    return (
      <section className="pastel-card outcome-panel" aria-label="Result">
        <span className="pixel-font icon-label">
          <Icon name="flag" size={13} /> SETTLED
        </span>
        <strong className="outcome-value">{formatResult(market, market.outcome_x ?? 0)}</strong>
        {evidence}
      </section>
    );
  }

  if (inChallenge) {
    const challenged = proposal.status === 'challenged';
    return (
      <section className="pastel-card outcome-panel" aria-label="Proposed result">
        <div className="odds-panel-head">
          <span className="pixel-font icon-label">
            <Icon name="flag" size={13} />
            {proposal.proposer_id === 'AGENT_FEED' ? 'BOT RESULT' : 'REPORTED RESULT'}
          </span>
          {secondsLeft != null && (
            <span className="pixel-font" title="Settles when this runs out">
              {formatCountdown(secondsLeft)}
            </span>
          )}
        </div>
        <strong className="outcome-value">{formatResult(market, proposal.proposed_x)}</strong>
        {evidence}
        {challenged && (
          <p className="auction-hint">
            Challenged. Most votes wins when the clock runs out, and a tie voids the bet.
          </p>
        )}
        <div className="outcome-form">
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={hint}
            aria-label="Your result"
          />
          <button disabled={!entered} onClick={() => submit('challenge')}>
            <Icon name="close" size={13} /> CHALLENGE
          </button>
        </div>
      </section>
    );
  }

  if (market.origin === 'preset') {
    return <p className="auction-hint">Preset bet: settle it from Options. The bot won&apos;t check it.</p>;
  }

  if (market.route !== 'auto') {
    return (
      <section className="pastel-card outcome-panel" aria-label="Report the result">
        <span className="pixel-font icon-label">
          <Icon name="users" size={13} /> GROUP DECIDES
        </span>
        <div className="outcome-form">
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={hint}
            aria-label="Result"
          />
          <button disabled={!entered} onClick={() => submit('propose')}>
            <Icon name="check" size={13} /> REPORT RESULT
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="pastel-card outcome-panel" aria-label="Resolution">
      <div className="odds-panel-head">
        <span className="pixel-font icon-label">
          <Icon name="flag" size={13} /> RESOLUTION
        </span>
        <button onClick={askBot} disabled={checking}>
          <Icon name="zap" size={13} /> {checking ? 'CHECKING...' : 'CHECK RESULT'}
        </button>
      </div>
      <p className="auction-hint">
        The bot settles this from {market.resolution_source}
        {market.resolves_at_ms != null &&
          `, and starts checking ${new Date(market.resolves_at_ms).toLocaleString([], {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}`}
        .
      </p>
      {note && <p className="odds-summary">{note}</p>}
    </section>
  );
};
