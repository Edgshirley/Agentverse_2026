import React, { useEffect, useState } from 'react';
import { BetActivity, BetStage } from '../hooks/betActivity';
import { Icon, IconName } from './Icon';

interface BetActivityFeedProps {
  bets: BetActivity[];
  activePlayerId?: string;
  onOpenMarket?: (marketId: string) => void;
}

/** How long a finished bet stays on screen. */
const LINGER_MS = 15000;

const STEPS: { stage: BetStage; label: string; icon: IconName }[] = [
  { stage: 'received', label: 'BET PLACED', icon: 'send' },
  { stage: 'reviewing', label: 'AI REVIEW', icon: 'zap' },
  { stage: 'reviewed', label: 'REVIEWED', icon: 'check' },
  { stage: 'created', label: 'OPEN TO ALL', icon: 'coins' },
];

const STAGE_INDEX: Record<BetStage, number> = {
  received: 0,
  reviewing: 1,
  reviewed: 2,
  created: 3,
  failed: 3,
};

const TONE: Record<BetStage, string> = {
  received: 'sky',
  reviewing: 'gold',
  reviewed: 'gold',
  created: 'mint',
  failed: 'coral',
};

function modeLabel(bet: BetActivity): string {
  if (bet.mode === 'simulated') return 'SIMULATED AI';
  if (bet.mode === 'fallback') return 'AI OFFLINE · SIMULATED';
  return (bet.model || 'GEMINI').toUpperCase();
}

function headline(bet: BetActivity, isMine: boolean): string {
  const who = isMine ? 'YOU' : bet.username.toUpperCase();
  switch (bet.stage) {
    case 'received':
      return `${who} PLACED A BET`;
    case 'reviewing':
      return `${modeLabel(bet)} IS REVIEWING ${isMine ? 'YOUR' : `${who}'S`} BET…`;
    case 'reviewed':
      return 'REVIEW DONE, OPENING THE MARKET…';
    case 'created':
      return isMine ? 'YOUR BET IS LIVE: EVERYONE CAN TRADE' : `${who}'S BET IS LIVE: JUMP IN`;
    case 'failed':
      return `${who}'S BET WAS REJECTED`;
  }
}

/** Live, group-wide view of every bet going through placement → AI review → open market. */
export const BetActivityFeed: React.FC<BetActivityFeedProps> = ({ bets, activePlayerId, onOpenMarket }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (bets.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [bets.length]);

  const visible = bets.filter(
    (b) => !(b.stage === 'created' || b.stage === 'failed') || now - b.updatedAt < LINGER_MS
  );
  if (visible.length === 0) return null;

  return (
    <div className="bet-activity-feed" aria-live="polite">
      {visible.map((bet) => {
        const isMine = Boolean(activePlayerId) && bet.playerId === activePlayerId;
        const reached = STAGE_INDEX[bet.stage];
        return (
          <div key={bet.betId} className={`pastel-card ${TONE[bet.stage]} bet-activity-card`}>
            <div className="pixel-font bet-activity-headline">{headline(bet, isMine)}</div>
            <div className="bet-activity-question">“{bet.question}”</div>

            <ol className="bet-activity-steps">
              {STEPS.map((step, i) => {
                const failedHere = bet.stage === 'failed' && i === STEPS.length - 1;
                const state = failedHere ? 'failed' : i < reached || bet.stage === 'created' ? 'done' : i === reached ? 'active' : 'todo';
                return (
                  <li key={step.stage} className={`bet-step ${state}`}>
                    <Icon name={failedHere ? 'close' : step.icon} size={12} />
                    <span>{failedHere ? 'REJECTED' : step.label}</span>
                  </li>
                );
              })}
            </ol>

            {bet.review && (
              <div className="bet-activity-review">
                <div>{bet.review.summary}</div>
                {bet.review.fair_value !== null && (
                  <div className="bet-activity-meta">
                    AI FAIR VALUE: <strong>{bet.review.fair_value}</strong> · {modeLabel(bet)}
                  </div>
                )}
                {bet.review.flags.length > 0 && (
                  <ul className="bet-activity-flags">
                    {bet.review.flags.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {bet.stage === 'failed' && bet.error && <div className="bet-activity-meta">{bet.error}</div>}

            {bet.stage === 'created' && bet.marketId && onOpenMarket && (
              <button className="bet-activity-open" onClick={() => onOpenMarket(bet.marketId!)}>
                <Icon name="forward" size={12} /> {isMine ? 'VIEW MARKET' : 'TRADE IT'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
