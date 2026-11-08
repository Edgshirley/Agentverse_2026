import React, { useEffect } from 'react';

interface BetDrawerProps {
  onClose: () => void;
  children: React.ReactNode;
}

/** Slide-over that shows one bet's full trading view on top of the chat. */
export const BetDrawer: React.FC<BetDrawerProps> = ({ onClose, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="bet-drawer-scrim" onClick={onClose}>
      <aside
        className="bet-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Bet details"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="bet-drawer-close" onClick={onClose} aria-label="Close bet">
          ×
        </button>
        {children}
      </aside>
    </div>
  );
};
