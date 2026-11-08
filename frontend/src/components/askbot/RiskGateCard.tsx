import React from 'react';
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
  } = bot;

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
          AGENT RISK GATE · CONFIRM EXIT &amp; STOP LEVELS ({betUnitLabel.toUpperCase()})
        </span>
      </div>

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
            2. Take-Profit ({betUnitLabel}) *
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
            3. Stop-Loss ({betUnitLabel}) *
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
        <button onClick={() => setShowRiskGateCard(false)}>CANCEL</button>
        <button className="btn-mint pixel-font" onClick={handleConfirmStrategyAndRisk}>
          ✓ CONFIRM &amp; OPEN LIVE BET -&gt;
        </button>
      </div>
    </div>
  );
};
