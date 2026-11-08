import React from 'react';

interface HintBubbleProps {
  text: string;
  /** Where the bubble sits relative to the thing it points at. */
  placement: 'below-right' | 'above' | 'stacked';
  onClick?: () => void;
}

/**
 * 8-bit onboarding speech bubble with a jumping [!] — used for first-run hints
 * ('SET UP PROFILE', 'CLICK TO TALK'). Positioned absolutely: the parent must be
 * `position: relative`.
 */
export const HintBubble: React.FC<HintBubbleProps> = ({ text, placement, onClick }) => (
  <div
    className={`hint-bubble hint-bubble--${placement} pixel-font`}
    role='status'
    onClick={onClick}
  >
    <span className='hint-bubble__bang' aria-hidden='true'>
      !
    </span>
    <span>{text}</span>
  </div>
);
