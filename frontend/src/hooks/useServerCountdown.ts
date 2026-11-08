import { useEffect, useRef, useState } from 'react';

/** Seconds until a server-time deadline, ticking locally between state updates. */
export function useServerCountdown(deadlineMs: number | null, serverNowMs: number): number | null {
  const offsetRef = useRef(0);
  useEffect(() => {
    offsetRef.current = serverNowMs - Date.now();
  }, [serverNowMs]);

  const [, setTick] = useState(0);
  useEffect(() => {
    if (deadlineMs == null) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(timer);
  }, [deadlineMs]);

  if (deadlineMs == null) return null;
  return Math.max(0, Math.ceil((deadlineMs - (Date.now() + offsetRef.current)) / 1000));
}
