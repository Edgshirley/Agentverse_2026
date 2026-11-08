import React, { useEffect, useState } from 'react';
import { Icon } from '../Icon';
import { Player } from '../../shared/types';
import { MarketView } from './marketView';
import { describePayout } from './payouts';

interface MarketActionsProps {
  view: MarketView;
  activePlayer: Player;
  players: Player[];
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
}

export const MarketActions: React.FC<MarketActionsProps> = ({
  view,
  activePlayer,
  players,
  onDispatch,
}) => {
  const { market, positions, isSpread, unitLabel, myActivePos, myLiveBalance, betValueOrders } = view;
  const myAutoExits = betValueOrders.filter((o) => o.player_id === activePlayer.id);
  const myTarget = myAutoExits.find((o) => o.type !== 'stop_loss')?.trigger_level;
  const myStop = myAutoExits.find((o) => o.type === 'stop_loss')?.trigger_level;
  const isMarketMaker = isSpread && market.mm_player_id === activePlayer.id;
  const hasBets = positions.some((p) => p.lots > 0);
  const marketMakerName =
    players.find((p) => p.id === market.mm_player_id)?.nickname ?? 'The market maker';

  const [showCustomWithdraw, setShowCustomWithdraw] = useState<boolean>(false);
  // What you put in vs what cashing out pays right now (moves with the money on each side)
  const myPaid = positions
    .filter((p) => p.player_id === activePlayer.id && (p.lots > 0 || p.live_equity_toks > 0))
    .reduce((a, p) => a + p.entry_cost_toks, 0);
  const myChange = myLiveBalance - myPaid;
  const [withdrawValue, setWithdrawValue] = useState<string>('25');
  const [withdrawMode, setWithdrawMode] = useState<'CHIP' | '%'>('CHIP');

  useEffect(() => {
    setShowCustomWithdraw(false);
  }, [market.id]);

  const handleCustomWithdraw = async () => {
    if (myLiveBalance <= 0) return;
    const rawVal = Number(withdrawValue);
    if (Number.isNaN(rawVal) || rawVal <= 0) return;
    const fractionP =
      withdrawMode === '%'
        ? Math.min(1, Math.max(0.01, rawVal / 100))
        : Math.min(1, Math.max(0.01, rawVal / myLiveBalance));

    await onDispatch(`/api/markets/${market.id}/withdraw`, {
      playerId: activePlayer.id,
      side: myActivePos?.side || (isSpread ? 'OVER' : 'YES'),
      fractionP,
    });
    setShowCustomWithdraw(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {isSpread && (
        <p className="auction-hint">
          {describePayout(market, unitLabel)} Inside the window, the market maker wins.
          {market.state === 'open' && !isMarketMaker && ` ${marketMakerName} goes live when ready.`}
        </p>
      )}

      {isMarketMaker && market.state === 'open' && (
        <button
          className="btn-brand pixel-font"
          disabled={!hasBets}
          title={hasBets ? 'Close the opening round and go live' : 'Waiting for the first bet'}
          onClick={() =>
            onDispatch(`/api/markets/${market.id}/lock-takes`, { playerId: activePlayer.id })
          }
        >
          <Icon name="play" size={15} /> {hasBets ? 'GO LIVE' : 'WAITING FOR BETS'}
        </button>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {isMarketMaker ? null : isSpread ? (
          <>
            <button
              className="btn-mint pixel-font"
              style={{ flex: 1, minWidth: 180, padding: '10px 16px' }}
              onClick={() =>
                onDispatch(`/api/markets/${market.id}/take`, {
                  playerId: activePlayer.id,
                  side: 'OVER',
                  amount: 1,
                })
              }
            >
              <Icon name="arrow-up" size={15} /> &gt; {market.H ?? 5} {unitLabel} · {market.lot_stake_k} CHIP
            </button>
            <button
              className="btn-coral pixel-font"
              style={{ flex: 1, minWidth: 180, padding: '10px 16px' }}
              onClick={() =>
                onDispatch(`/api/markets/${market.id}/take`, {
                  playerId: activePlayer.id,
                  side: 'UNDER',
                  amount: 1,
                })
              }
            >
              <Icon name="arrow-down" size={15} /> &lt; {market.L ?? 3} {unitLabel} · {market.lot_stake_k} CHIP
            </button>
          </>
        ) : (
          <>
            <button
              className="btn-mint pixel-font"
              style={{ flex: 1, minWidth: 160, padding: '10px 16px' }}
              onClick={() =>
                onDispatch(`/api/markets/${market.id}/take`, {
                  playerId: activePlayer.id,
                  side: 'YES',
                  amount: market.lot_stake_k,
                })
              }
            >
              <Icon name="check" size={15} /> YES · {market.lot_stake_k} CHIP
            </button>
            <button
              className="btn-coral pixel-font"
              style={{ flex: 1, minWidth: 160, padding: '10px 16px' }}
              onClick={() =>
                onDispatch(`/api/markets/${market.id}/take`, {
                  playerId: activePlayer.id,
                  side: 'NO',
                  amount: market.lot_stake_k,
                })
              }
            >
              <Icon name="close" size={15} /> NO · {market.lot_stake_k} CHIP
            </button>
          </>
        )}

        {/* Withdraw buttons only appear once you have an active balance in the bet */}
        {myLiveBalance > 0 && (
          <>
            <button
              onClick={() => setShowCustomWithdraw((v) => !v)}
              title="Withdraw part"
              aria-label="Withdraw part"
            >
              <Icon name="minus" size={14} />
              <Icon name="wallet" size={14} />
            </button>
            <button
              onClick={() =>
                onDispatch(`/api/markets/${market.id}/withdraw`, {
                  playerId: activePlayer.id,
                  side: myActivePos?.side || (isSpread ? 'OVER' : 'YES'),
                  fractionP: 1.0,
                })
              }
              title="Cash out now at the live price"
            >
              <Icon name="wallet" size={14} /> CASH OUT {myLiveBalance} CHIP
            </button>
          </>
        )}
      </div>

      {myLiveBalance > 0 && myPaid > 0 && (
        <p className={`cash-out-line ${myChange > 0 ? 'up' : myChange < 0 ? 'down' : ''}`}>
          You paid {myPaid} CHIP · worth {myLiveBalance} now
          {myChange !== 0 && ` (${myChange > 0 ? '+' : ''}${myChange})`}.{' '}
          {isSpread
            ? 'It goes up as more money backs your side and down as it backs the other side; cashing out sells it back to the market maker.'
            : 'It moves with the chance of YES as people bet.'}
          {isSpread && (myTarget != null || myStop != null) &&
            ` Auto cash-out: ${[myTarget != null ? `at ${myTarget}+` : '', myStop != null ? `stop at ${myStop}` : '']
              .filter(Boolean)
              .join(' · ')} CHIP.`}
        </p>
      )}

      {showCustomWithdraw && myLiveBalance > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '8px 14px',
            borderRadius: 8,
            backgroundColor: 'var(--bg-canvas)',
            border: '1.5px solid var(--border-color)',
          }}
        >
          <Icon name="wallet" size={14} />
          <input
            type="number"
            value={withdrawValue}
            onChange={(e) => setWithdrawValue(e.target.value)}
            style={{ width: 70, padding: '4px 8px', fontWeight: 700 }}
          />
          <select
            value={withdrawMode}
            onChange={(e) => setWithdrawMode(e.target.value as 'CHIP' | '%')}
            style={{ padding: '4px 8px', fontWeight: 700 }}
          >
            <option value="CHIP">CHIP</option>
            <option value="%">%</option>
          </select>
          <button className="btn-mint" onClick={handleCustomWithdraw} title="Confirm" aria-label="Confirm">
            <Icon name="check" size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
