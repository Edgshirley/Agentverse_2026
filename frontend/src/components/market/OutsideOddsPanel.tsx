import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { OutsideOdds } from '../../shared/types';

const MESSAGES: Record<Exclude<OutsideOdds['status'], 'ok'>, string> = {
  no_data: 'No odds found elsewhere for this one.',
  unconfigured: 'Add a Gemini key on the engine to see odds from other sites.',
  error: "Couldn't search for odds. Try again in a minute.",
};

/** What the rest of the web thinks, so friends can price a bet with some context. */
export const OutsideOddsPanel: React.FC<{ marketId: string }> = ({ marketId }) => {
  const [odds, setOdds] = useState<OutsideOdds | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const latestRequest = useRef(0);

  const load = useCallback(
    async (refresh: boolean) => {
      const request = ++latestRequest.current;
      setLoading(true);
      if (!refresh) setOdds(null);
      let result: OutsideOdds = { status: 'error', quotes: [], sources: [], fetched_at: Date.now() };
      try {
        const res = await fetch('/api/agents/outside-odds', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketId, refresh }),
        });
        if (res.ok) result = (await res.json()) as OutsideOdds;
      } catch {
        // Falls through to the error state above
      }
      // A slower answer for the previous market must not overwrite this one
      if (request !== latestRequest.current) return;
      setOdds(result);
      setLoading(false);
    },
    [marketId]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <section className="pastel-card odds-panel" aria-label="Odds from other sites">
      <div className="odds-panel-head">
        <span className="pixel-font icon-label">
          <Icon name="zap" size={13} />
          OUTSIDE ODDS
        </span>
        <button
          onClick={() => load(true)}
          disabled={loading}
          title="Search again"
          aria-label="Search again"
        >
          <Icon name="reload" size={13} />
        </button>
      </div>

      {loading && !odds && <p className="auction-hint">Checking other sites...</p>}

      {odds && odds.status !== 'ok' && <p className="auction-hint">{MESSAGES[odds.status]}</p>}

      {odds?.status === 'ok' && (
        <>
          {odds.summary && <p className="odds-summary">{odds.summary}</p>}
          {odds.quotes.length > 0 && (
            <ul className="odds-quotes">
              {odds.quotes.map((quote) => (
                <li key={`${quote.source}-${quote.value}`} title={quote.detail}>
                  <span>{quote.source}</span>
                  <strong>{quote.value}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="odds-sources">
            {odds.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
            ))}
          </p>
          <p className="odds-note">AI summary of web sources. Check before you bet.</p>
        </>
      )}
    </section>
  );
};
