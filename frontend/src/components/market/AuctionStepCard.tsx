import React, { useEffect, useState } from 'react';
import { Icon } from '../Icon';
import { Player } from '../../shared/types';
import { PixelMascot } from '../PixelMascot';
import { MarketView } from './marketView';
import { pickFriends } from '../../shared/friends';

interface AuctionStepCardProps {
  view: MarketView;
  activePlayer: Player;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
  /** False behind the gateway: real friends bet, and the market stays open for them. */
  standInFriends: boolean;
}

/** The two agent-guided steps a window market goes through before it is live. */
export const AuctionStepCard: React.FC<AuctionStepCardProps> = ({
  view,
  activePlayer,
  onDispatch,
  standInFriends,
}) => {
  const { market, isSpread, unitLabel } = view;
  const [widthBidInput, setWidthBidInput] = useState<string>('2');
  const [quoteLInput, setQuoteLInput] = useState<string>('3');

  useEffect(() => {
    if (market.unit === 'pit stops' || market.unit === 'laps') {
      setWidthBidInput('2');
      setQuoteLInput('3');
    } else if (market.unit === 'min') {
      setWidthBidInput('8');
      setQuoteLInput('35');
    } else {
      setWidthBidInput('4');
      setQuoteLInput('22');
    }
  }, [market.id, market.unit]);

  // Step 1 Agent-Guided Handler: Bids your width, simulates friend counter-bid if needed, and advances to Step 2
  const handleStep1BidAndAdvance = async () => {
    const w = Math.max(1, Number(widthBidInput) || 2);
    await onDispatch(`/api/markets/${market.id}/auction/bid`, {
      playerId: activePlayer.id,
      width: w,
    });
    await onDispatch(`/api/markets/${market.id}/auction/finalize`, {});
  };

  // Step 2 Agent-Guided Handler: Locks window [L, H], seeds one friend bet per side and goes live
  const handleStep2LockWindowAndGoLive = async () => {
    const lVal = Number(quoteLInput) || 3;
    const [friendAbove, friendBelow] = pickFriends(2, [activePlayer.id, market.mm_player_id]);
    await onDispatch(`/api/markets/${market.id}/auction/quote`, {
      playerId: market.mm_player_id || activePlayer.id,
      L: lVal,
    });
    if (!standInFriends) return;
    // Seed a friend on each side, since a market with no takers voids when it locks
    await onDispatch(`/api/markets/${market.id}/take`, {
      playerId: friendAbove,
      side: 'OVER',
      amount: 1,
    });
    await onDispatch(`/api/markets/${market.id}/take`, {
      playerId: friendBelow,
      side: 'UNDER',
      amount: 1,
    });
    await onDispatch(`/api/markets/${market.id}/lock-takes`, {});
  };

  if (isSpread && market.state === 'width_auction') {
    return (
      <div className="poker-felt-arena" style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PixelMascot size={42} showExclamation={true} />
          <div>
            <div className="pixel-font" style={{ fontSize: 11, color: 'var(--pastel-gold-text)' }}>
              STEP 1/2 · WIDTH
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {market.question.replace(/TOKS/gi, 'CHIP')}
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>
          Tightest window wins the market maker seat.
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
          <span className="pixel-font">W</span>
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
            <Icon name="check" size={14} /> {widthBidInput} {unitLabel.toUpperCase()}
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
              STEP 2/2 · [L, H]
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              Width {w} {unitLabel}: pick the start
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>
          Friends bet above {hVal} or below {lVal}.
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
            <Icon name="play" size={14} /> [{lVal}..{hVal}]
          </button>
        </div>
      </div>
    );
  }

  return null;
};
