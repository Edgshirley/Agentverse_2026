import React, { useState } from 'react';
import { Icon } from './Icon';
import {
  CAT_AVATAR_OPTIONS,
  CatAvatarId,
  PixelCatAvatar,
} from './PixelMascot';

// Gamer-tag style default names (prefix + cat/casino noun + number), themed on
// MarketMate: cats, cards, chips, odds and trading slang. e.g. "LuckyWhisker_42".
const NAME_PREFIXES: string[] = [
  'Lucky', 'AllIn', 'HighRoller', 'Sly', 'Velvet', 'Midnight', 'Golden', 'Neon',
  'Pixel', 'Bluff', 'Sharp', 'Wild', 'Purrfect', 'Quant', 'Stealth', 'Turbo',
  'Jackpot', 'Silent', 'Copper', 'Diamond',
];
const NAME_NOUNS: string[] = [
  'Whisker', 'Paws', 'Kitty', 'Tabby', 'Moggy', 'AlleyCat', 'Tomcat', 'Purr',
  'Ace', 'Joker', 'Dealer', 'Chip', 'Spread', 'Hedge', 'Bookie', 'PitBoss',
  'Wildcard', 'Longshot', 'Underdog', 'NineLives',
];

function pickFrom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export function generateThemedGamerName(exclude?: string): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = Math.floor(Math.random() * 99) + 1;
    const name = `${pickFrom(NAME_PREFIXES)}${pickFrom(NAME_NOUNS)}_${number}`;
    if (name !== exclude && name.length <= 24) return name;
  }
  return `Player${Math.floor(Math.random() * 9000) + 1000}`;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAvatar: CatAvatarId;
  onSelectAvatar: (avatar: CatAvatarId) => void;
  customName: string;
  defaultGeneratedName: string;
  onChangeCustomName: (name: string) => void;
  onRollNewDefaultName: () => void;
  showRulesExclamation: boolean;
  /** Dev only; the reset endpoint does not exist in production. */
  onResetDemo?: () => Promise<void>;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  selectedAvatar,
  onSelectAvatar,
  customName,
  defaultGeneratedName,
  onChangeCustomName,
  onRollNewDefaultName,
  showRulesExclamation,
  onResetDemo,
}) => {
  const [showRulesPanel, setShowRulesPanel] = useState<boolean>(false);
  const [resetting, setResetting] = useState<boolean>(false);

  if (!isOpen) return null;

  const effectiveDisplayName = customName.trim() || defaultGeneratedName;
  const currentCatMeta =
    CAT_AVATAR_OPTIONS.find((c) => c.id === selectedAvatar) ?? CAT_AVATAR_OPTIONS[2];

  return (
    <div
      className="profile-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Player Profile & Game Rules"
    >
      <div
        className="pastel-card profile-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 14,
            borderBottom: '2px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 10,
                border: '2px solid var(--pastel-coral-border)',
                backgroundColor: 'var(--bg-canvas)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PixelCatAvatar variant={selectedAvatar} size={42} />
            </div>
            <div>
              <div className="pixel-font" style={{ fontSize: 14 }}>
                PLAYER PROFILE
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                Active Handle:{' '}
                <strong style={{ color: 'var(--pastel-mint-border)' }}>
                  {effectiveDisplayName}
                </strong>{' '}
                · {currentCatMeta.label}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="pixel-font"
            style={{ padding: '6px 12px', fontSize: 11 }}
            title="Close profile"
          >
            <Icon name="close" size={14} /> CLOSE
          </button>
        </div>

        {/* 1. Custom Name or Auto-Generated Video-Game Handle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            <label className="pixel-font" style={{ fontSize: 11 }}>
              1. DISPLAY NAME / HANDLE
            </label>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              Leave blank for default:{' '}
              <strong className="pixel-font" style={{ fontSize: 10.5 }}>
                {defaultGeneratedName}
              </strong>
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              maxLength={24}
              value={customName}
              onChange={(e) => onChangeCustomName(e.target.value)}
              placeholder={`Default: ${defaultGeneratedName} (or type your own...)`}
              style={{
                flex: 1,
                padding: '9px 12px',
                fontSize: 13,
                fontWeight: 600,
              }}
            />
            <button
              type="button"
              className="btn-gold pixel-font"
              style={{ fontSize: 10.5, padding: '8px 12px', whiteSpace: 'nowrap' }}
              onClick={() => {
                onChangeCustomName('');
                onRollNewDefaultName();
              }}
              title="Roll a random casino-cat gamer handle"
            >
              <Icon name="reload" size={14} /> ROLL NAME
            </button>
          </div>
        </div>

        {/* 2. Pick Your 8-Bit Cat Avatar (6 Variants: No Hat, Tie, Bow Tie, 3 Hats) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span className="pixel-font" style={{ fontSize: 11 }}>
              2. CHOOSE YOUR CAT DEALER AVATAR (6 STYLES)
            </span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              1 No Hat · 1 Tie · 1 Bow Tie · 3 Hat Styles
            </span>
          </div>

          <div className="cat-avatar-grid">
            {CAT_AVATAR_OPTIONS.map((cat) => {
              const isSelected = selectedAvatar === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onSelectAvatar(cat.id)}
                  className={`cat-avatar-option-btn ${isSelected ? 'selected' : ''}`}
                >
                  <PixelCatAvatar variant={cat.id} size={42} />
                  <div style={{ textAlign: 'left', minWidth: 0 }}>
                    <div
                      className="pixel-font"
                      style={{
                        fontSize: 10.5,
                        color: isSelected ? 'var(--pastel-mint-text)' : 'var(--fg-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {cat.label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: isSelected ? 'var(--pastel-mint-border)' : 'var(--fg-muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {cat.subtitle}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Separate Button to Open Brief Rules on How to Get Started */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            onClick={() => setShowRulesPanel((prev) => !prev)}
            className="btn-sky pixel-font"
            style={{
              position: 'relative',
              width: '100%',
              padding: '11px 16px',
              fontSize: 11.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="icon-label"><Icon name="star" size={13} /> HOW THE GAME WORKS</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {showRulesExclamation && (
                <span
                  className="pixel-exclamation-inline pixel-font"
                  title="First time here? Check how the game works!"
                >
                  !
                </span>
              )}
              <span>{showRulesPanel ? '▲ HIDE RULES' : '▼ VIEW RULES'}</span>
            </span>
          </button>

          {showRulesPanel && (
            <div
              className="pastel-card"
              style={{
                backgroundColor: 'var(--bg-canvas)',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontSize: 12.5,
              }}
            >
              <div
                className="pixel-font"
                style={{ fontSize: 11, color: 'var(--pastel-gold-border)' }}
              >
                GETTING STARTED WITH MARKETMATE
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div>
                  <strong style={{ color: 'var(--pastel-gold-border)' }}>
                    1. 1,000 CHIP STARTING STACK:
                  </strong>{' '}
                  Everyone starts with <strong>1,000 CHIP</strong> play-tokens. All markets are
                  zero-sum across your friend group.
                </div>
                <div>
                  <strong style={{ color: 'var(--pastel-coral-border)' }}>
                    2. PITCH A BET IN &ldquo;ASK BOT&rdquo; OR &ldquo;CHAT&rdquo;:
                  </strong>{' '}
                  Hold the mic or type any bet idea (e.g.,{' '}
                  <em>&ldquo;Max Verstappen top 3 this weekend&rdquo;</em> or{' '}
                  <em>&ldquo;London temp tomorrow&rdquo;</em>). The Tuxedo Cat AI structures the
                  market bounds and unit automatically.
                </div>
                <div>
                  <strong style={{ color: 'var(--pastel-mint-border)' }}>
                    3. TRADE RANGES &amp; SET STOP-LOSSES IN &ldquo;LIVE BETS&rdquo;:
                  </strong>{' '}
                  Back <strong>YES / IN WINDOW</strong> or <strong>NO / OUTSIDE</strong>, pick a
                  custom range on the depth ladder, and optionally set an auto-cashout Stop-Loss in
                  the market&rsquo;s native unit.
                </div>
                <div>
                  <strong style={{ color: 'var(--pastel-sky-border)' }}>
                    4. EARLY CASHOUT OR FINAL SETTLEMENT:
                  </strong>{' '}
                  Slice out part of your position anytime at live mark-to-market value, or hold
                  until the Oracle / Arbiter settles the final outcome!
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer: Save & Close + Secondary Demo Reset */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            paddingTop: 10,
            borderTop: '1.5px solid var(--border-color)',
          }}
        >
          {onResetDemo && (
            <button
            type="button"
            disabled={resetting}
            onClick={async () => {
              setResetting(true);
              try {
                await onResetDemo();
                onClose();
              } finally {
                setResetting(false);
              }
            }}
            style={{
              fontSize: 11,
              padding: '6px 10px',
              color: 'var(--fg-muted)',
            }}
            title="Clear all markets and reset demo state"
          >
            {resetting ? 'RESETTING...' : '↺ RESET DEMO MARKETS'}
          </button>
          )}

          <button
            type="button"
            className="btn-mint pixel-font"
            style={{ padding: '8px 18px', fontSize: 11.5 }}
            onClick={onClose}
          >
            <Icon name="check" size={14} /> SAVE
          </button>
        </div>
      </div>
    </div>
  );
};
