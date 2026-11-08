import { useCallback, useState } from 'react';

const STORAGE_KEY = 'marketmate.dev.player';
const DEFAULT_PLAYER_ID = 'you';

function readStoredPlayerId(): string {
  if (!import.meta.env.DEV) return DEFAULT_PLAYER_ID;
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? DEFAULT_PLAYER_ID;
  } catch {
    return DEFAULT_PLAYER_ID;
  }
}

/**
 * Answers "who is using the app?". A signed-in user always wins. Without the
 * gateway, the dev choice applies, per browser tab, so two tabs can play two personas.
 */
export function useActivePlayerId(signedInPlayerId?: string): [string, (id: string) => void] {
  const [playerId, setPlayerId] = useState<string>(readStoredPlayerId);

  const choosePlayer = useCallback((id: string) => {
    setPlayerId(id);
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage can be unavailable; the choice still applies until reload.
    }
  }, []);

  return [signedInPlayerId ?? playerId, choosePlayer];
}
