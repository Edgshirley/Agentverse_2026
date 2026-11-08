import React from 'react';

interface PixelMascotProps {
  size?: number;
  isListening?: boolean;
  isProcessing?: boolean;
  showExclamation?: boolean;
}

/**
 * 8-Bit Betting & Finance Mascot: "TUXEDO CAT DEALER"
 * Crisp 16x16 pixel-art SVG of a dapper black-and-white Tuxedo Cat with pink inner ears,
 * emerald cat eyes, white whiskers & tuxedo bib, and a casino pastel red bowtie.
 */
export const PixelMascot: React.FC<PixelMascotProps> = ({
  size = 48,
  isListening = false,
  isProcessing = false,
  showExclamation = false,
}) => {
  return (
    <div
      className={`pixel-mascot-wrap ${isListening ? 'mascot-listening' : ''} ${
        isProcessing ? 'mascot-thinking' : ''
      }`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
      }}
    >
      {showExclamation && (
        <div className="pixel-exclamation-badge pixel-font" title="Tuxedo Cat Bot Alert!">
          !
        </div>
      )}

      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ imageRendering: 'pixelated' }}
      >
        {/* Pointy Black Cat Ears + Pastel Pink Inner Ears */}
        <rect x="2" y="1" width="2" height="1" fill="#1E202B" />
        <rect x="2" y="2" width="3" height="2" fill="#1E202B" />
        <rect x="3" y="2" width="1" height="2" fill="#F4A6A6" />

        <rect x="12" y="1" width="2" height="1" fill="#1E202B" />
        <rect x="11" y="2" width="3" height="2" fill="#1E202B" />
        <rect x="12" y="2" width="1" height="2" fill="#F4A6A6" />

        {/* Tuxedo Cat Head (Charcoal Black Fur) */}
        <rect x="2" y="4" width="12" height="6" fill="#232634" />
        <rect x="1" y="6" width="1" height="3" fill="#232634" />
        <rect x="14" y="6" width="1" height="3" fill="#232634" />

        {/* White Forehead Blaze & Muzzle */}
        <rect x="7" y="5" width="2" height="2" fill="#F5F2EB" />
        <rect x="5" y="7" width="6" height="3" fill="#F5F2EB" />

        {/* Emerald Mint Cat Eyes + Pupils */}
        <rect x="3" y="6" width="2" height="2" fill="#6BC4A2" />
        <rect x="4" y="6" width="1" height="2" fill="#14161D" />

        <rect x="11" y="6" width="2" height="2" fill="#6BC4A2" />
        <rect x="11" y="6" width="1" height="2" fill="#14161D" />

        {/* Cute Pink Cat Nose */}
        <rect x="7" y="8" width="2" height="1" fill="#E58585" />

        {/* White Cat Whiskers */}
        <rect x="0" y="7" width="2" height="1" fill="#F5F2EB" />
        <rect x="0" y="9" width="2" height="1" fill="#D5CFC2" />
        <rect x="14" y="7" width="2" height="1" fill="#F5F2EB" />
        <rect x="14" y="9" width="2" height="1" fill="#D5CFC2" />

        {/* Tuxedo Shoulders & Crisp White Chest Bib */}
        <rect x="3" y="10" width="10" height="5" fill="#1E202B" />
        <rect x="5" y="10" width="6" height="4" fill="#F5F2EB" />

        {/* Casino Pastel Red Bowtie + Gold Center */}
        <rect x="5" y="10" width="2" height="2" fill="#E58585" />
        <rect x="9" y="10" width="2" height="2" fill="#E58585" />
        <rect x="7" y="10" width="2" height="2" fill="#DFC06C" />

        {/* White Tuxedo Paws */}
        <rect x="3" y="14" width="2" height="1" fill="#F5F2EB" />
        <rect x="11" y="14" width="2" height="1" fill="#F5F2EB" />

        {/* Curled Tuxedo Tail with White Tip */}
        <rect x="13" y="11" width="2" height="3" fill="#232634" />
        <rect x="14" y="10" width="1" height="1" fill="#F5F2EB" />
      </svg>
    </div>
  );
};

/**
 * 8-Bit Pixel Joker Playing Card Component
 */
export const PixelJokerCard: React.FC<{ className?: string; style?: React.CSSProperties }> = ({
  className = '',
  style,
}) => {
  return (
    <div className={`floating-card-bg joker-card ${className}`} style={style}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
        <span>JKR</span>
        <span>★</span>
      </div>
      <div style={{ alignSelf: 'center', textAlign: 'center', lineHeight: 1 }}>
        <svg
          width="26"
          height="26"
          viewBox="0 0 12 12"
          style={{ imageRendering: 'pixelated' }}
        >
          {/* 8-bit Jester Hat */}
          <rect x="1" y="2" width="2" height="2" fill="#E87A7A" />
          <rect x="5" y="1" width="2" height="2" fill="#F0CA62" />
          <rect x="9" y="2" width="2" height="2" fill="#63C7A3" />
          <rect x="2" y="4" width="8" height="2" fill="#E87A7A" />
          <rect x="4" y="4" width="4" height="2" fill="#63C7A3" />
          {/* Jester Face */}
          <rect x="3" y="6" width="6" height="4" fill="#F5F2EB" />
          <rect x="4" y="7" width="1" height="1" fill="#191A23" />
          <rect x="7" y="7" width="1" height="1" fill="#191A23" />
          <rect x="4" y="9" width="4" height="1" fill="#E87A7A" />
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
        <span>★</span>
        <span>JKR</span>
      </div>
    </div>
  );
};

/**
 * Perfectly Centered 8-Bit CHIP Casino Chip Component
 */
export const PixelPokerChip: React.FC<{
  amount: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ amount, className = '', style }) => {
  return (
    <div className={`floating-chip-bg ${className}`} style={style}>
      <span style={{ display: 'block', fontSize: 10, lineHeight: 1.05 }}>{amount}</span>
      <span style={{ display: 'block', fontSize: 7.5, lineHeight: 1.05, opacity: 0.9 }}>
        CHIP
      </span>
    </div>
  );
};

/**
 * 8-Bit Pixel Racer / Knight Sprite for the Segmented Live Progress Race Bar (Screenshot 4)
 */
export const PixelRacerAvatar: React.FC<{ accent?: string; size?: number }> = ({
  accent = '#e57368',
  size = 24,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ imageRendering: 'pixelated', display: 'block' }}
    >
      {/* Plume / Crest */}
      <rect x="5" y="0" width="2" height="2" fill={accent} />
      {/* Helmet Dome */}
      <rect x="3" y="2" width="6" height="5" fill="#7D8294" />
      <rect x="2" y="3" width="8" height="3" fill="#9DA2B4" />
      {/* Helmet Visor Slits */}
      <rect x="3" y="4" width="6" height="2" fill="#181A20" />
      <rect x="4" y="4" width="1" height="1" fill="#F2EFE9" />
      <rect x="7" y="4" width="1" height="1" fill="#F2EFE9" />
      {/* Shoulders / Armor */}
      <rect x="2" y="7" width="8" height="4" fill={accent} />
      <rect x="5" y="7" width="2" height="4" fill="#F2EFE9" />
      <rect x="1" y="8" width="1" height="3" fill="#181A20" />
      <rect x="10" y="8" width="1" height="3" fill="#181A20" />
    </svg>
  );
};
