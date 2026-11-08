import React from 'react';
import { Icon } from '../Icon';
import { AskBot } from '../../hooks/useAskBot';
import { PAYOUT_MODES } from '../market/payouts';
import { PixelMascot } from '../PixelMascot';

/** Agent 1 + Agent 2 result, ready for the creator to confirm. */
export const DraftCard: React.FC<{ bot: AskBot }> = ({ bot }) => {
  const {
    draft,
    setDraft,
    classification,
    setClassification,
    draftSource,
    draftSources,
    openingWidth,
    setOpeningWidth,
    showCustomizeRules,
    setShowCustomizeRules,
    inHouseUnit,
    setInHouseUnit,
    inHouseLotStake,
    setInHouseLotStake,
    inHousePayoffMode,
    setInHousePayoffMode,
    inHouseCapC,
    setInHouseCapC,
    creatorShowPositionsToAll,
    setCreatorShowPositionsToAll,
    arbiterName,
    setArbiterName,
    countdownMins,
    setCountdownMins,
    allMarkets,
    parentMarketId,
    setParentMarketId,
    activePlayer,
    handleConfirmLaunchMarket,
  } = bot;

  if (!draft || !classification) return null;

  return (
    <div className="pastel-card" style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PixelMascot size={32} />
          <span className="pixel-font" style={{ fontSize: 11, color: 'var(--pastel-mint-text)' }}>
            {classification.archetype === 'spread' ? 'SPREAD BET' : 'YES / NO BET'}
          </span>
          <span className={`source-badge ${draftSource}`}>
            {draftSource === 'preset' ? 'PRESET · NO AI' : 'GEMINI'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowCustomizeRules((v) => !v)}
          style={{ padding: '4px 8px' }}
          title="Rules"
          aria-label="Customize rules"
          aria-expanded={showCustomizeRules}
        >
          <Icon name="sliders" size={14} />
          <Icon name={showCustomizeRules ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
      </div>

      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
        &ldquo;{draft.question.replace(/TOKS/gi, 'CHIP')}&rdquo;
      </div>

      <dl className="draft-facts">
        {classification.archetype === 'spread' && (
          <>
            <dt>Range</dt>
            <dd>
              {draft.bounds[0]} to {draft.bounds[1]} {inHouseUnit}
            </dd>
          </>
        )}
        <dt>Settles</dt>
        <dd>
          {classification.route === 'auto' ? `Bot, from ${draft.resolution_source}` : 'The group decides'}
          {draft.resolves_at_ms != null &&
            `, ${new Date(draft.resolves_at_ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
        </dd>
        <dt>Rule</dt>
        <dd>{draft.criteria}</dd>
      </dl>

      {draftSources.length > 0 && (
        <p className="odds-sources">
          {draftSources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title}
            </a>
          ))}
        </p>
      )}

      {classification.archetype === 'spread' && (
        <label className="opening-spread">
          <span>Opening spread</span>
          <input
            type="number"
            min={0}
            value={openingWidth}
            onChange={(e) => setOpeningWidth(e.target.value)}
            placeholder="optional"
          />
          <span className="pixel-font auction-unit">{inHouseUnit}</span>
        </label>
      )}

      {classification.archetype === 'spread' && (
        <div className="payout-picker">
          <div className="payout-modes" role="radiogroup" aria-label="Payout mode">
            {PAYOUT_MODES.map((option) => (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={inHousePayoffMode === option.mode}
                className={inHousePayoffMode === option.mode ? 'btn-brand' : ''}
                onClick={() => setInHousePayoffMode(option.mode)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="auction-hint">
            {PAYOUT_MODES.find((option) => option.mode === inHousePayoffMode)?.blurb}
          </p>
        </div>
      )}

      {/* Compact Agent Summary Pill Row */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--fg-muted)',
          marginBottom: 14,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span className="badge-outline">
          {classification.archetype === 'spread'
            ? `Window Unit: ${inHouseUnit}`
            : classification.archetype.toUpperCase()}
        </span>
        <span className="badge-outline">{inHouseLotStake} CHIP / lot</span>
        {classification.archetype === 'spread' && (
          <span className="badge-outline">
            {inHousePayoffMode.toUpperCase()} · {inHouseCapC}x Cap
          </span>
        )}
        <span className="badge-outline">
          {creatorShowPositionsToAll ? 'Positions & Stops: Visible' : 'Positions & Stops: Hidden'}
        </span>
      </div>

      {/* Expandable Rules Drawer — only opens when the user wants to tweak defaults */}
      {showCustomizeRules && (
        <div
          style={{
            borderTop: '1px solid var(--border-soft)',
            paddingTop: 12,
            marginBottom: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {classification.archetype === 'spread' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                gap: 10,
              }}
            >
              <div>
                <label style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>
                  Max Payout Cap:
                </label>
                <select
                  value={inHouseCapC}
                  onChange={(e) => setInHouseCapC(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px' }}
                >
                  <option value="2">2x Window Widths</option>
                  <option value="3">3x Window Widths</option>
                  <option value="5">5x Window Widths</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>
                    Stake (CHIP):
                  </label>
                  <input
                    type="number"
                    value={inHouseLotStake}
                    onChange={(e) => setInHouseLotStake(e.target.value)}
                    style={{ width: '100%', padding: '5px 8px' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>
                    Unit:
                  </label>
                  <input
                    type="text"
                    value={inHouseUnit}
                    onChange={(e) => setInHouseUnit(e.target.value)}
                    style={{ width: '100%', padding: '5px 8px' }}
                  />
                </div>
              </div>
            </div>
          )}

          {classification.route === 'arbiter' && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ fontSize: 12 }}>
                Arbiter:{' '}
                <input
                  type="text"
                  value={arbiterName}
                  onChange={(e) => setArbiterName(e.target.value)}
                  style={{ width: 110, padding: '4px 8px' }}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Countdown (mins):{' '}
                <input
                  type="number"
                  value={countdownMins}
                  onChange={(e) => setCountdownMins(e.target.value)}
                  style={{ width: 70, padding: '4px 8px' }}
                />
              </label>
            </div>
          )}

          {classification.archetype === 'stacked' && allMarkets.length > 0 && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>
                Parent Market:
              </label>
              <select
                value={parentMarketId}
                onChange={(e) => setParentMarketId(e.target.value)}
                style={{ padding: '6px 10px', width: '100%' }}
              >
                {allMarkets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.question}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              Creator Option ({activePlayer.nickname} only): Show all players&apos; positions &amp; stops on graph
            </span>
            <button
              type="button"
              onClick={() => setCreatorShowPositionsToAll((v) => !v)}
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              {creatorShowPositionsToAll ? 'VISIBLE TO ALL (ON)' : 'HIDDEN (OFF)'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          onClick={() => {
            setDraft(null);
            setClassification(null);
          }}
          title="Cancel"
          aria-label="Cancel"
        >
          <Icon name="close" size={14} />
        </button>
        <button className="btn-mint pixel-font" onClick={handleConfirmLaunchMarket}>
          START
          <Icon name="arrow-right" size={14} />
        </button>
      </div>
    </div>
  );
};
