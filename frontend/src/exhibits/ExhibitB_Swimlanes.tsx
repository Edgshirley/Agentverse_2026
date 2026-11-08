import React from 'react';
import { LifecyclePhase, Player, SwimlaneEvent } from '../shared/types';

interface ExhibitBSwimlanesProps {
  players: Player[];
  swimlanes: SwimlaneEvent[];
}

const PHASES: LifecyclePhase[] = ['OPEN', 'MID', 'LIVE', 'SETTLE'];

export const ExhibitB_Swimlanes: React.FC<ExhibitBSwimlanesProps> = ({
  players,
  swimlanes,
}) => {
  return (
    <section className="exhibit-box">
      <div className="exhibit-title">
        <span>21 │ === EXHIBIT B (MIDDLE) :: PARTICIPANT ACTION SWIMLANES ====</span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          [B] BET/TAKE · [L] LIMIT/STOP · [F] FILLED · [W] WITHDRAW/P2P · [S] STOP HIT · [X] EXIT ALL
        </span>
      </div>

      <div
        className="swimlane-row"
        style={{
          borderBottom: '1px solid var(--border-strong)',
          fontWeight: 700,
          color: 'var(--fg-muted)',
          fontSize: 11,
        }}
      >
        <div>PARTICIPANT</div>
        <div className="swimlane-track">
          <div>OPEN ─────────</div>
          <div>MID ──────────</div>
          <div>LIVE ─────────</div>
          <div>SETTLE</div>
        </div>
        <div style={{ textAlign: 'right' }}>ACTIONS</div>
      </div>

      {players.map((p, idx) => {
        const pEvents = swimlanes.filter((e) => e.player_id === p.id);
        return (
          <div key={p.id} className="swimlane-row">
            <div style={{ fontWeight: 700 }}>
              <span style={{ color: 'var(--fg-dim)', marginRight: 6 }}>
                {String(22 + idx).padStart(2, '0')}│
              </span>
              {p.nickname}
            </div>

            <div className="swimlane-track">
              {PHASES.map((phase) => {
                const phaseEvents = pEvents.filter((e) => e.phase === phase);
                return (
                  <div key={phase} className="swimlane-phase-cell">
                    {phaseEvents.length === 0 ? (
                      <span style={{ color: 'var(--fg-dim)' }}>───</span>
                    ) : (
                      phaseEvents.map((ev) => (
                        <span
                          key={ev.id}
                          className="swim-node"
                          title={`${ev.label}${ev.delta_toks != null ? ` (${ev.delta_toks >= 0 ? '+' : ''}${ev.delta_toks} CHIP)` : ''}`}
                        >
                          {ev.code}
                        </span>
                      ))
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--fg-muted)' }}>
              {pEvents.length} NODE{pEvents.length === 1 ? '' : 'S'}
            </div>
          </div>
        );
      })}
    </section>
  );
};
