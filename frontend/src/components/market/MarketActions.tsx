import React, { useEffect, useState } from 'react';
import { Player } from '../../shared/types';
import { MarketView } from './marketView';

interface MarketActionsProps {
  view: MarketView;
  activePlayer: Player;
  onDispatch: (path: string, body?: Record<string, any>) => Promise<any>;
}

export const MarketActions: React.FC<MarketActionsProps> = ({ view, activePlayer, onDispatch }) => {
  const { market, isSpread, unitLabel, myActivePos, myLiveBalance } = view;

  const [showCustomWithdraw, setShowCustomWithdraw] = useState<boolean>(false);
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
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {isSpread ? (
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
              ▲ BET ABOVE (&gt; {market.H ?? 5} {unitLabel}) · +{market.lot_stake_k} CHIP
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
              ▼ BET BELOW (&lt; {market.L ?? 3} {unitLabel}) · +{market.lot_stake_k} CHIP
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
              ✓ BET YES (+{market.lot_stake_k} CHIP)
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
              ✗ BET NO (+{market.lot_stake_k} CHIP)
            </button>
          </>
        )}

        {/* Withdraw buttons only appear once you have an active balance in the bet */}
        {myLiveBalance > 0 && (
          <>
            <button onClick={() => setShowCustomWithdraw((v) => !v)}>
              WITHDRAW X% / CHIP
            </button>
            <button
              onClick={() =>
                onDispatch(`/api/markets/${market.id}/withdraw`, {
                  playerId: activePlayer.id,
                  side: myActivePos?.side || (isSpread ? 'OVER' : 'YES'),
                  fractionP: 1.0,
                })
              }
            >
              WITHDRAW ALL ({myLiveBalance} CHIP)
            </button>
          </>
        )}
      </div>

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
          <span style={{ fontSize: 12 }}>WITHDRAW:</span>
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
          <button className="btn-mint pixel-font" onClick={handleCustomWithdraw}>
            CONFIRM
          </button>
        </div>
      )}
    </div>
  );
};
