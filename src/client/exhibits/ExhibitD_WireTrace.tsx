import React from 'react';
import { WireTraceEntry } from '../../shared/types';

interface ExhibitDWireTraceProps {
  wireTrace: WireTraceEntry[];
  onToggleFeedDelay?: () => void;
}

export const ExhibitD_WireTrace: React.FC<ExhibitDWireTraceProps> = ({
  wireTrace,
  onToggleFeedDelay,
}) => {
  const reversed = [...wireTrace].reverse();

  return (
    <section className="exhibit-box">
      <div className="exhibit-title">
        <span>71 │ === EXHIBIT D :: LIVE ORDER & AGENT WIRE TRACE ====</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
            PLAYER &lt;-&gt; RISK AGENT &lt;-&gt; MARKET ENGINE
          </span>
          {onToggleFeedDelay && (
            <button
              onClick={onToggleFeedDelay}
              style={{ padding: '1px 6px', fontSize: 10 }}
              title="Simulate live feed outage -> switches fair value to labelled AI_ADVISORY"
            >
              TOGGLE FEED DELAY
            </button>
          )}
        </div>
      </div>

      <div className="wire-trace-scroll">
        {reversed.map((entry, idx) => {
          const lineNum = 72 + (idx % 27);
          const msSuffix = String(entry.timestamp_ms % 100000).padStart(5, '0');
          return (
            <div key={entry.id} className="gutter-row" style={{ padding: '3px 0' }}>
              <span className="gutter-num">{String(lineNum).padStart(2, '0')}</span>
              <div>
                <span style={{ color: 'var(--fg-dim)' }}>[{msSuffix}ms]</span>{' '}
                <span className="badge-outline" style={{ fontSize: 10 }}>
                  {entry.source} -&gt; {entry.target}
                </span>{' '}
                <strong style={{ marginLeft: 4 }}>{entry.action}:</strong>{' '}
                <span style={{ color: 'var(--fg-muted)' }}>{entry.detail}</span>
                {entry.toks_delta != null && (
                  <span style={{ marginLeft: 6, fontWeight: 700 }}>
                    [{entry.toks_delta >= 0 ? `+${entry.toks_delta}` : entry.toks_delta} TOKS]
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
