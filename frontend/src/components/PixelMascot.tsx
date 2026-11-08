import React from 'react';

export type CatAvatarId = 'no_hat' | 'tie' | 'bowtie' | 'tophat' | 'visor' | 'fedora';

export interface CatAvatarOption {
  id: CatAvatarId;
  label: string;
  subtitle: string;
  badgeColor: string;
}

export const CAT_AVATAR_OPTIONS: CatAvatarOption[] = [
  {
    id: 'no_hat',
    label: 'GINGER STRAY',
    subtitle: 'No Hat · Pure Claws',
    badgeColor: '#e59866',
  },
  {
    id: 'tie',
    label: 'QUANT TABBY',
    subtitle: 'Wall St. Power Tie',
    badgeColor: '#e57368',
  },
  {
    id: 'bowtie',
    label: 'TUXEDO DEALER',
    subtitle: 'Black & White Bow Tie',
    badgeColor: '#e58585',
  },
  {
    id: 'tophat',
    label: 'HIGH ROLLER',
    subtitle: 'Obsidian Silk Top Hat',
    badgeColor: '#dfc06c',
  },
  {
    id: 'visor',
    label: 'PIT BOSS',
    subtitle: 'Emerald Dealer Visor',
    badgeColor: '#6bc4a2',
  },
  {
    id: 'fedora',
    label: 'SKY DETECTIVE',
    subtitle: 'Pastel Blue Fedora Hat',
    badgeColor: '#78b7e6',
  },
];

interface PixelCatAvatarProps {
  variant: CatAvatarId;
  size?: number;
  showExclamation?: boolean;
}

/**
 * 6 Collectible 8-Bit Cat Profile Avatars:
 * 1. `no_hat`  — Ginger cat with no hat or neckwear
 * 2. `tie`     — Slate tabby cat with a red/gold Wall St. necktie
 * 3. `bowtie`  — Black & white Tuxedo cat with a monochrome bow tie (same look as the bot mascot)
 * 4. `tophat`  — Charcoal high-roller cat with a black & gold silk top hat
 * 5. `visor`   — Cream calico cat with a mint-green casino dealer visor hat
 * 6. `fedora`  — Silver-blue cat with a sky-blue detective fedora hat
 */
export const PixelCatAvatar: React.FC<PixelCatAvatarProps> = ({
  variant,
  size = 40,
  showExclamation = false,
}) => {
  // Per-variant fur, eye, and muzzle palette
  const palettes: Record<
    CatAvatarId,
    {
      furMain: string;
      furDark: string;
      muzzle: string;
      earInner: string;
      eyeIris: string;
      nose: string;
    }
  > = {
    no_hat: {
      furMain: '#D9824B',
      furDark: '#B86532',
      muzzle: '#F7E7D4',
      earInner: '#F4A6A6',
      eyeIris: '#6BC4A2',
      nose: '#E57368',
    },
    tie: {
      furMain: '#5C667A',
      furDark: '#444C5C',
      muzzle: '#ECE9E2',
      earInner: '#F4A6A6',
      eyeIris: '#DFC06C',
      nose: '#E58585',
    },
    bowtie: {
      furMain: '#14161E',
      furDark: '#0F1117',
      muzzle: '#F8FAFC',
      earInner: '#F8FAFC',
      eyeIris: '#F8FAFC',
      nose: '#0B0C10',
    },
    tophat: {
      furMain: '#262433',
      furDark: '#191822',
      muzzle: '#F2EFE9',
      earInner: '#E58585',
      eyeIris: '#DFC06C',
      nose: '#E58585',
    },
    visor: {
      furMain: '#E6DEC8',
      furDark: '#C9BFA6',
      muzzle: '#FFFDF9',
      earInner: '#F4A6A6',
      eyeIris: '#78B7E6',
      nose: '#E58585',
    },
    fedora: {
      furMain: '#3B4D63',
      furDark: '#2A384A',
      muzzle: '#EBF2F7',
      earInner: '#F4A6A6',
      eyeIris: '#6BC4A2',
      nose: '#E58585',
    },
  };

  const p = palettes[variant] || palettes.bowtie;

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {showExclamation && (
        <div className="pixel-exclamation-badge pixel-font" title="New notification!">
          !
        </div>
      )}

      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ imageRendering: 'pixelated', display: 'block' }}
      >
        {/* Pointy Cat Ears */}
        <rect x="2" y="2" width="2" height="1" fill={p.furDark} />
        <rect x="2" y="3" width="3" height="2" fill={p.furDark} />
        <rect x="3" y="3" width="1" height="2" fill={p.earInner} />

        <rect x="12" y="2" width="2" height="1" fill={p.furDark} />
        <rect x="11" y="3" width="3" height="2" fill={p.furDark} />
        <rect x="12" y="3" width="1" height="2" fill={p.earInner} />

        {/* Hats (Rendered on Top of Head for Hat Variants) */}
        {variant === 'tophat' && (
          <>
            {/* Tall Obsidian Silk Top Hat + Gold Band */}
            <rect x="4" y="0" width="8" height="3" fill="#14151C" />
            <rect x="4" y="2" width="8" height="1" fill="#DFC06C" />
            <rect x="2" y="3" width="12" height="1" fill="#14151C" />
          </>
        )}

        {variant === 'visor' && (
          <>
            {/* White Dealer Headband + Emerald Mint Translucent Visor Brim */}
            <rect x="3" y="3" width="10" height="1" fill="#F5F2EB" />
            <rect x="2" y="4" width="12" height="1" fill="#6BC4A2" />
            <rect x="3" y="5" width="10" height="1" fill="#4D9E7E" />
          </>
        )}

        {variant === 'fedora' && (
          <>
            {/* Sky-Blue Detective Fedora + Gold Feather Accent */}
            <rect x="4" y="1" width="8" height="2" fill="#5CA0D3" />
            <rect x="11" y="1" width="1" height="1" fill="#DFC06C" />
            <rect x="4" y="2" width="8" height="1" fill="#2A4359" />
            <rect x="2" y="3" width="12" height="1" fill="#78B7E6" />
          </>
        )}

        {/* Cat Head */}
        <rect x="2" y="4" width="12" height="6" fill={p.furMain} />
        <rect x="1" y="6" width="1" height="3" fill={p.furMain} />
        <rect x="14" y="6" width="1" height="3" fill={p.furMain} />

        {/* Re-draw visor bill on forehead if visor */}
        {variant === 'visor' && (
          <rect x="2" y="4" width="12" height="1" fill="#6BC4A2" />
        )}

        {/* Forehead Blaze & Muzzle */}
        <rect x="7" y="5" width="2" height="2" fill={p.muzzle} />
        <rect x="5" y="7" width="6" height="3" fill={p.muzzle} />

        {/* Cat Eyes + Pupils */}
        <rect x="3" y="6" width="2" height="2" fill={p.eyeIris} />
        <rect x="4" y="6" width="1" height="2" fill="#14161D" />

        <rect x="11" y="6" width="2" height="2" fill={p.eyeIris} />
        <rect x="11" y="6" width="1" height="2" fill="#14161D" />

        {/* Cute Cat Nose */}
        <rect x="7" y="8" width="2" height="1" fill={p.nose} />

        {/* Cat Whiskers */}
        <rect x="0" y="7" width="2" height="1" fill={p.muzzle} />
        <rect x="0" y="9" width="2" height="1" fill="#C9C3B5" />
        <rect x="14" y="7" width="2" height="1" fill={p.muzzle} />
        <rect x="14" y="9" width="2" height="1" fill="#C9C3B5" />

        {/* Shoulders & Chest Bib */}
        <rect x="3" y="10" width="10" height="5" fill={p.furDark} />
        <rect x="5" y="10" width="6" height="4" fill={p.muzzle} />

        {/* Neckwear Variants */}
        {variant === 'bowtie' && (
          <>
            {/* Monochrome Black-and-Silver Tuxedo Bowtie (matches the bot mascot) */}
            <rect x="5" y="10" width="2" height="2" fill="#14161E" />
            <rect x="9" y="10" width="2" height="2" fill="#14161E" />
            <rect x="7" y="10" width="2" height="2" fill="#94A3B8" />
          </>
        )}

        {variant === 'tie' && (
          <>
            {/* Wall Street Power Necktie + Gold Tie Clip */}
            <rect x="7" y="10" width="2" height="1" fill="#B84A42" />
            <rect x="7" y="11" width="2" height="3" fill="#E57368" />
            <rect x="7" y="12" width="2" height="1" fill="#DFC06C" />
          </>
        )}

        {variant === 'tophat' && (
          <>
            {/* Gold Monocle Chain / Lapel Pin */}
            <rect x="7" y="10" width="2" height="1" fill="#DFC06C" />
          </>
        )}

        {/* Paws */}
        <rect x="3" y="14" width="2" height="1" fill={p.muzzle} />
        <rect x="11" y="14" width="2" height="1" fill={p.muzzle} />

        {/* Curled Tail with Tip */}
        <rect x="13" y="11" width="2" height="3" fill={p.furMain} />
        <rect x="14" y="10" width="1" height="1" fill={p.muzzle} />
      </svg>
    </div>
  );
};

interface PixelMascotProps {
  size?: number;
  isListening?: boolean;
  isProcessing?: boolean;
  showExclamation?: boolean;
}

/**
 * 8-Bit Betting & Finance Mascot: "TUXEDO CAT DEALER" (Pure Black & White Edition)
 * Crisp 16x16 pixel-art SVG of a monochrome black-and-white Tuxedo Cat with
 * black coat, white inner ears, white whiskers & tuxedo bib, and a monochrome bowtie.
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
        {/* Outer Crisp White Pixel Halo / Rim so Black Fur Pops on Dark Backgrounds */}
        <rect x="2" y="0" width="2" height="1" fill="#E2E8F0" />
        <rect x="12" y="0" width="2" height="1" fill="#E2E8F0" />

        {/* Pointy Black Cat Ears + White Inner Ears */}
        <rect x="2" y="1" width="2" height="1" fill="#0F1117" />
        <rect x="2" y="2" width="3" height="2" fill="#0F1117" />
        <rect x="3" y="2" width="1" height="2" fill="#F8FAFC" />

        <rect x="12" y="1" width="2" height="1" fill="#0F1117" />
        <rect x="11" y="2" width="3" height="2" fill="#0F1117" />
        <rect x="12" y="2" width="1" height="2" fill="#F8FAFC" />

        {/* Tuxedo Cat Head (Jet Black Fur) */}
        <rect x="2" y="4" width="12" height="6" fill="#14161E" />
        <rect x="1" y="6" width="1" height="3" fill="#14161E" />
        <rect x="14" y="6" width="1" height="3" fill="#14161E" />

        {/* White Forehead Blaze & Muzzle */}
        <rect x="7" y="5" width="2" height="2" fill="#F8FAFC" />
        <rect x="5" y="7" width="6" height="3" fill="#F8FAFC" />

        {/* Monochrome High-Contrast Cat Eyes (White Sclera + Black Pupils) */}
        <rect x="3" y="6" width="2" height="2" fill="#F8FAFC" />
        <rect x="4" y="6" width="1" height="2" fill="#0B0C10" />

        <rect x="11" y="6" width="2" height="2" fill="#F8FAFC" />
        <rect x="11" y="6" width="1" height="2" fill="#0B0C10" />

        {/* Cute Black Button Cat Nose */}
        <rect x="7" y="8" width="2" height="1" fill="#0B0C10" />

        {/* Crisp White Cat Whiskers */}
        <rect x="0" y="7" width="2" height="1" fill="#F8FAFC" />
        <rect x="0" y="9" width="2" height="1" fill="#CBD5E1" />
        <rect x="14" y="7" width="2" height="1" fill="#F8FAFC" />
        <rect x="14" y="9" width="2" height="1" fill="#CBD5E1" />

        {/* Tuxedo Shoulders & Crisp White Chest Bib */}
        <rect x="3" y="10" width="10" height="5" fill="#0F1117" />
        <rect x="5" y="10" width="6" height="4" fill="#F8FAFC" />

        {/* Classic Black-and-Silver Tuxedo Bowtie */}
        <rect x="5" y="10" width="2" height="2" fill="#14161E" />
        <rect x="9" y="10" width="2" height="2" fill="#14161E" />
        <rect x="7" y="10" width="2" height="2" fill="#94A3B8" />

        {/* White Tuxedo Paws */}
        <rect x="3" y="14" width="2" height="1" fill="#F8FAFC" />
        <rect x="11" y="14" width="2" height="1" fill="#F8FAFC" />

        {/* Curled Black Tuxedo Tail with White Tip */}
        <rect x="13" y="11" width="2" height="3" fill="#14161E" />
        <rect x="14" y="10" width="1" height="1" fill="#F8FAFC" />
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
 * Perfectly Centered 8-Bit SPRD Casino Chip Component
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
        SPRD
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
