import React, { useEffect, useState } from 'react';
import { Player } from '../../shared/types';
import { PixelMascot } from '../PixelMascot';
import { MarketView } from './marketView';

interface AuctionStepCardProps {
  view: MarketView;
  activePlayer: Player;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
}

/** The two agent-guided steps a window market goes through before it is live. */
export const AuctionStepCard: React.FC<AuctionStepCardProps> = ({ view, activePlayer, onDispatch }) => {
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
    await onDispatch(`/api/markets/${market.id}/auction/quote`, {
      playerId: market.mm_player_id || activePlayer.id,
      L: lVal,
    });
    // Seed a friend on each side, since a market with no takers voids when it locks
    await onDispatch(`/api/markets/${market.id}/take`, {
      playerId: 'alex',
      side: 'OVER',
      amount: 1,
    });
    await onDispatch(`/api/markets/${market.id}/take`, {
      playerId: 'sam',
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
              AGENT STEP 1 OF 2 · WINDOW WIDTH BIDDING
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {market.question.replace(/TOKS/gi, 'CHIP')}
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>
          How narrow of a window width (<strong>W in {unitLabel}</strong>) are you willing to make?
          The tightest window wins the Market Maker seat and sets the exact <strong>[L, H]</strong>{' '}
          range.
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
          <span style={{ fontSize: 12.5 }}>Window Width (W):</span>
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
            CONFIRM WIDTH ({widthBidInput} {unitLabel.toUpperCase()}) -&gt;
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
              AGENT STEP 2 OF 2 · SELECT THE WINDOW [L, H]
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              Window Width Locked at {w} {unitLabel} — Choose Start Level (L)
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>
          Set where the window begins so friends can bet <strong>ABOVE (&gt; {hVal})</strong> and{' '}
          <strong>BELOW (&lt; {lVal})</strong> the window.
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
            OPEN LIVE MARKET [{lVal}..{hVal}] -&gt;
          </button>
        </div>
      </div>
    );
  }

  return null;
};
