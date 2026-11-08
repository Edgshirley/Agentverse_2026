import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { SIM_CHAPTERS, SIM_STEPS, SimPost } from './simSession';

interface SimConsoleProps {
  refresh: () => Promise<void> | void;
  onSelectMarket: (marketId: string) => void;
  onOpenBet: () => void;
  onCloseBet: () => void;
  onChoosePlayer: (playerId: string) => void;
}

const post: SimPost = async (path, body = {}) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
};

/** Dev-only controls for stepping and skipping through the scripted session. */
const SimConsole: React.FC<SimConsoleProps> = ({
  refresh,
  onSelectMarket,
  onOpenBet,
  onCloseBet,
  onChoosePlayer,
}) => {
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef(0);
  const busyRef = useRef(false);
  const startedRef = useRef(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const moveCursor = (value: number) => {
    cursorRef.current = value;
    setCursor(value);
  };

  /** Serialises actions, so a double click can never run two steps at once. */
  const exclusive = useCallback(
    async (action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Step failed');
        await refreshRef.current();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    []
  );

  const resetSession = useCallback(async () => {
    await post('/api/demo/reset');
    await post('/api/dev/personas');
    moveCursor(0);
    onCloseBet();
  }, [onCloseBet]);

  const runTo = useCallback(
    async (target: number) => {
      for (let i = cursorRef.current; i < target; i++) {
        await SIM_STEPS[i].run(post);
        moveCursor(i + 1);
      }
      const shown = SIM_STEPS.slice(0, target).reverse();
      const marketId = shown.find((s) => s.marketId)?.marketId;
      // Selecting also fetches, with the new market; a plain refresh here could still
      // carry the previous selection and flip the view back.
      if (marketId) onSelectMarket(marketId);
      else await refreshRef.current();
      const last = SIM_STEPS[target - 1];
      if (last?.openBet) onOpenBet();
    },
    [onOpenBet, onSelectMarket]
  );

  /** Moves to any step; going backwards resets and replays, since the engine is deterministic. */
  const goTo = useCallback(
    (target: number) =>
      exclusive(async () => {
        if (target < cursorRef.current) await resetSession();
        await runTo(target);
      }),
    [exclusive, resetSession, runTo]
  );

  // StrictMode mounts effects twice in dev; the session must only start once.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    onChoosePlayer('jules');
    void exclusive(async () => {
      await resetSession();
      await runTo(0);
    });
  }, [exclusive, onChoosePlayer, resetSession, runTo]);

  const total = SIM_STEPS.length;
  const atEnd = cursor >= total;
  const currentChapter = [...SIM_CHAPTERS].reverse().find((c) => c.firstStep <= Math.max(cursor - 1, 0));
  const nextChapter = SIM_CHAPTERS.find((c) => c.firstStep > cursor);
  const lastLabel = cursor > 0 ? SIM_STEPS[cursor - 1].label : 'Ready';

  return (
    <section className="sim-console pastel-card" aria-label="Simulation controls">
      <div className="sim-console-head">
        <span className="pixel-font icon-label">
          <Icon name="play" size={14} />
          SIM
        </span>
        <span className="pixel-font sim-progress" aria-live="polite">
          {cursor}/{total}
        </span>
        <div className="sim-buttons">
          <button onClick={() => goTo(0)} disabled={busy} title="Restart" aria-label="Restart">
            <Icon name="undo" />
          </button>
          <button
            className="btn-brand"
            onClick={() => goTo(cursor + 1)}
            disabled={busy || atEnd}
            title="Next step"
            aria-label="Next step"
          >
            <Icon name="play" />
          </button>
          <button
            onClick={() => goTo(nextChapter?.firstStep ?? total)}
            disabled={busy || atEnd}
            title="Next chapter"
            aria-label="Next chapter"
          >
            <Icon name="forward" />
          </button>
          <button onClick={() => goTo(total)} disabled={busy || atEnd} title="Skip to end" aria-label="Skip to end">
            <Icon name="flag" />
          </button>
        </div>
      </div>

      <div className="sim-progress-bar" aria-hidden="true">
        <div style={{ width: `${(cursor / total) * 100}%` }} />
      </div>

      <p className="sim-label">{error ?? lastLabel}</p>

      <div className="sim-chapters">
        {SIM_CHAPTERS.map((chapter) => (
          <button
            key={chapter.name}
            className={chapter.name === currentChapter?.name && cursor > 0 ? 'btn-sky' : ''}
            onClick={() => goTo(chapter.firstStep)}
            disabled={busy}
          >
            {chapter.name}
          </button>
        ))}
      </div>
    </section>
  );
};

export default SimConsole;
