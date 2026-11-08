import React from 'react';
import { Icon } from '../Icon';
import { AskBot } from '../../hooks/useAskBot';

/** Mandatory strategy, exit and stop confirmation before a bet goes live. */
export const RiskGateCard: React.FC<{ bot: AskBot }> = ({ bot }) => {
  const {
    activeMarket,
    betUnitLabel,
    sideField,
    setSideField,
    stakeField,
    setStakeField,
    tpField,
    setTpField,
    floorField,
    setFloorField,
    setShowRiskGateCard,
    handleConfirmStrategyAndRisk,
    isWindowMarket,
    windowWorthFor,
    levelNote,
  } = bot;
  const startWorth = isWindowMarket ? windowWorthFor(Number(stakeField) || 0) : 0;

  if (!activeMarket) return null;

  return (
    <div className="pastel-card" style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span className="pixel-font" style={{ fontSize: 11, color: 'var(--pastel-mint-text)' }}>
          <Icon name="shield" size={13} /> RISK GATE · {betUnitLabel.toUpperCase()}
        </span>
      </div>

      {isWindowMarket && (
        <p className="auction-hint" style={{ marginTop: 0 }}>
          {levelNote ??
            `Your bet starts worth ${startWorth} CHIP and moves with the money on each side. Set a target above that and a stop below it.`}
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <label style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>
            1. Position &amp; Stake (CHIP)
          </label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              value={sideField}
              onChange={(e) => setSideField(e.target.value)}
              style={{ padding: '6px 8px', fontWeight: 700 }}
            >
              {activeMarket.archetype === 'spread' ? (
                <>
                  <option value="OVER">ABOVE</option>
                  <option value="UNDER">BELOW</option>
                </>
              ) : (
                <>
                  <option value="YES">YES</option>
                  <option value="NO">NO</option>
                </>
              )}
            </select>
            <input
              type="number"
              value={stakeField}
              onChange={(e) => setStakeField(e.target.value)}
              style={{ width: 85, padding: '6px 8px', fontWeight: 700 }}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>
            {isWindowMarket
              ? '2. Cash out when it’s worth (CHIP) *'
              : `2. Take-Profit (${betUnitLabel}) *`}
          </label>
          <input
            type="number"
            value={tpField}
            onChange={(e) => setTpField(e.target.value)}
            placeholder={`Level (${betUnitLabel})`}
            style={{ width: '100%', padding: '6px 8px', fontWeight: 700 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>
            {isWindowMarket
              ? '3. Stop: cash out if it drops to (CHIP) *'
              : `3. Stop-Loss (${betUnitLabel}) *`}
          </label>
          <input
            type="number"
            value={floorField}
            onChange={(e) => setFloorField(e.target.value)}
            placeholder={`Stop (${betUnitLabel})`}
            style={{ width: '100%', padding: '6px 8px', fontWeight: 700 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={() => setShowRiskGateCard(false)} title="Cancel" aria-label="Cancel">
          <Icon name="close" size={14} />
        </button>
        <button className="btn-mint pixel-font" onClick={handleConfirmStrategyAndRisk}>
          <Icon name="check" size={14} />
          CONFIRM
        </button>
      </div>
    </div>
  );
};
