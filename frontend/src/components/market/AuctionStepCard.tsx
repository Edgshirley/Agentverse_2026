import React, { useEffect, useState } from 'react';
import { useServerCountdown } from '../../hooks/useServerCountdown';
import { Icon } from '../Icon';
import { Player } from '../../shared/types';
import { PixelMascot } from '../PixelMascot';
import { MarketView } from './marketView';
import { OutsideOddsPanel } from './OutsideOddsPanel';

interface AuctionStepCardProps {
  view: MarketView;
  activePlayer: Player;
  players: Player[];
  wallClockMs: number;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
}

/** The two steps a window market goes through before friends can bet. */
export const AuctionStepCard: React.FC<AuctionStepCardProps> = ({
  view,
  activePlayer,
  players,
  wallClockMs,
  onDispatch,
}) => {
  const { market, unitLabel, widthBids } = view;

  const bids = [...widthBids].sort(
    (a, b) => a.width - b.width || a.created_at - b.created_at
  );
  const best = bids[0] ?? null;
  const isMarketMaker = market.mm_player_id === activePlayer.id;
  const nameOf = (id: string | null | undefined) =>
    players.find((p) => p.id === id)?.nickname ?? (id ?? '').toUpperCase();

  const [widthInput, setWidthInput] = useState<string>('');
  const [startInput, setStartInput] = useState<string>('');

  // Offer the next undercut as soon as someone narrows the window
  useEffect(() => {
    setWidthInput(best ? String(Math.max(1, best.width - 1)) : '');
  }, [best?.width, market.id]);

  useEffect(() => {
    setStartInput('');
  }, [market.id]);

  // The deadline is server time, so everyone at the table sees the same countdown
  const secondsLeft = useServerCountdown(market.auction_closes_at_wall_ms ?? null, wallClockMs);

  const parsedWidth = Math.floor(Number(widthInput));
  const canBid =
    parsedWidth >= 1 && Number.isFinite(parsedWidth) && (!best || parsedWidth < best.width);

  const placeBid = () =>
    onDispatch(`/api/markets/${market.id}/auction/bid`, {
      playerId: activePlayer.id,
      width: parsedWidth,
    });

  const setWindow = () =>
    onDispatch(`/api/markets/${market.id}/auction/quote`, {
      playerId: activePlayer.id,
      L: Number(startInput),
    });

  if (market.state === 'width_auction') {
    return (
      <div className="poker-felt-arena auction-card">
        <div className="auction-card-head">
          <PixelMascot size={42} showExclamation={true} />
          <div>
            <div className="pixel-font auction-step-label">STEP 1/2 · BID THE WINDOW DOWN</div>
            <div className="auction-question">{market.question.replace(/TOKS/gi, 'CHIP')}</div>
          </div>
          {secondsLeft != null && (
            <div
              className={`pixel-font auction-countdown ${secondsLeft <= 10 ? 'urgent' : ''}`}
              aria-live="off"
              title="Closes when nobody undercuts in time. Every bid resets it."
            >
              0:{String(secondsLeft).padStart(2, '0')}
            </div>
          )}
        </div>

        <p className="auction-hint">
          {best
            ? 'Tightest window becomes market maker. Each bid restarts the clock.'
            : 'Tightest window becomes market maker. The clock starts with the first bid.'}
        </p>

        {bids.length > 0 && (
          <ol className="auction-bids" aria-label="Bids so far">
            {bids.slice(0, 4).map((bid, index) => (
              <li key={bid.id} className={index === 0 ? 'best' : ''}>
                <span className="pixel-font">{nameOf(bid.player_id)}</span>
                <span>
                  {bid.width} {unitLabel}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="auction-form">
          <label className="pixel-font" htmlFor="auction-width">
            W
          </label>
          <input
            id="auction-width"
            type="number"
            min={1}
            max={best ? best.width - 1 : undefined}
            value={widthInput}
            onChange={(e) => setWidthInput(e.target.value)}
          />
          <span className="pixel-font auction-unit">{unitLabel}</span>
          <button className="btn-mint pixel-font" disabled={!canBid} onClick={placeBid}>
            <Icon name="arrow-down" size={14} /> {best ? 'UNDERCUT' : 'BID'}
          </button>
        </div>

        <OutsideOddsPanel market={market} />
      </div>
    );
  }

  if (market.state === 'quoting') {
    const width = market.active_width_w ?? 0;
    const hasStart = startInput.trim() !== '' && Number.isFinite(Number(startInput));
    const lower = Number(startInput);
    const upper = lower + width;

    if (!isMarketMaker) {
      return (
        <div className="poker-felt-arena auction-card">
          <div className="auction-card-head">
            <PixelMascot size={42} />
            <div>
              <div className="pixel-font auction-step-label">STEP 2/2 · WINDOW</div>
              <div className="auction-question">
                {nameOf(market.mm_player_id)} won at {width} {unitLabel} and is choosing the window
              </div>
            </div>
          </div>
          <p className="auction-hint">You can bet above or below as soon as it&apos;s set.</p>
        </div>
      );
    }

    return (
      <div className="poker-felt-arena auction-card">
        <div className="auction-card-head">
          <PixelMascot size={42} showExclamation={true} />
          <div>
            <div className="pixel-font auction-step-label">STEP 2/2 · YOU WON, SET THE WINDOW</div>
            <div className="auction-question">
              Width {width} {unitLabel}: pick the start
            </div>
          </div>
        </div>

        <p className="auction-hint">
          {hasStart
            ? `Friends bet above ${upper} or below ${lower}. Anything inside pays you.`
            : `Allowed range: ${market.bounds[0]} to ${market.bounds[1]} ${unitLabel}.`}
        </p>

        <div className="auction-form">
          <label className="pixel-font" htmlFor="auction-start">
            L
          </label>
          <input
            id="auction-start"
            type="number"
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
          />
          <span className="badge-outline pixel-font">
            {hasStart ? `[${lower} .. ${upper}]` : '[L .. H]'} {unitLabel}
          </span>
          <button className="btn-mint pixel-font" disabled={!hasStart} onClick={setWindow}>
            <Icon name="play" size={14} /> OPEN BETS
          </button>
        </div>

        <OutsideOddsPanel market={market} />
      </div>
    );
  }

  return null;
};
