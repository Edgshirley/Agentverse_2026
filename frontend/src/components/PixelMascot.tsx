import React from 'react';

interface PixelMascotProps {
  size?: number;
  isListening?: boolean;
  isProcessing?: boolean;
  showExclamation?: boolean;
}

/**
 * 8-Bit Betting & Finance Mascot: "DEALER BULL"
 * Crisp 16x16 pixel-art SVG of a Wall Street Bull / Casino Dealer with golden horns,
 * dealer visor, and pixel shades + optional bouncing 8-bit [!] alert badge.
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
        <div className="pixel-exclamation-badge pixel-font" title="Bot suggestion!">
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
        {/* Golden Bull Horns */}
        <rect x="1" y="2" width="2" height="1" fill="#F0CA62" />
        <rect x="1" y="3" width="1" height="2" fill="#F0CA62" />
        <rect x="2" y="4" width="2" height="1" fill="#E5B842" />

        <rect x="13" y="2" width="2" height="1" fill="#F0CA62" />
        <rect x="14" y="3" width="1" height="2" fill="#F0CA62" />
        <rect x="12" y="4" width="2" height="1" fill="#E5B842" />

        {/* Casino Dealer Green Visor Hat */}
        <rect x="4" y="2" width="8" height="2" fill="#63C7A3" />
        <rect x="3" y="4" width="10" height="1" fill="#3A9B78" />

        {/* Bull Head Base (Warm Casino Red/Bronze) */}
        <rect x="3" y="5" width="10" height="6" fill="#E87A7A" />
        <rect x="2" y="6" width="1" height="2" fill="#D46565" />
        <rect x="13" y="6" width="1" height="2" fill="#D46565" />

        {/* Pixel Cool Shades / Visor Eyes */}
        <rect x="3" y="6" width="10" height="2" fill="#191A23" />
        <rect x="4" y="6" width="2" height="1" fill="#7EC4F2" />
        <rect x="10" y="6" width="2" height="1" fill="#7EC4F2" />

        {/* Snout & Golden Nose Ring */}
        <rect x="4" y="9" width="8" height="3" fill="#F4A6A6" />
        <rect x="5" y="10" width="1" height="1" fill="#3B2328" />
        <rect x="10" y="10" width="1" height="1" fill="#3B2328" />
        <rect x="6" y="12" width="4" height="2" fill="#F0CA62" />
        <rect x="7" y="12" width="2" height="1" fill="#222430" />

        {/* Tuxedo / Dealer Bowtie */}
        <rect x="4" y="14" width="8" height="2" fill="#222430" />
        <rect x="6" y="14" width="4" height="1" fill="#E87A7A" />
        <rect x="7" y="14" width="2" height="1" fill="#F0CA62" />
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
