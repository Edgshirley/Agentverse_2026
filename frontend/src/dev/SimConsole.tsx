import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { PixelMascot } from '../components/PixelMascot';
import { sfx } from '../utils/soundEffects';
import { setFakeFriendsPaused } from '../hooks/useFakeFriends';
import { buildSimSteps, SIM_SUGGESTION, SimMe, SimPost, SimSound, SimStep } from './simSession';

/** The whole scripted session plays in about this long. */
const TOTAL_MS = 29000;

interface SimConsoleProps {
  displayName: string;
  refresh: () => Promise<void> | void;
  onSelectMarket: (marketId: string) => void;
  onOpenBet: () => void;
  onCloseBet: () => void;
  onChoosePlayer: (playerId: string) => void;
  onClose: () => void;
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

const SOUNDS: Record<SimSound, () => void> = {
  chat: () => sfx.playChatPop(),
  open: () => sfx.playCatAlert(),
  bid: () => sfx.playBid(),
  confirm: () => sfx.playBetConfirm(),
  chips: () => sfx.playChips(),
  lock: () => sfx.playBetConfirm(),
  tick: () => sfx.playTick(),
  goal: () => sfx.playGoal(),
  buzz: () => sfx.playBuzz(),
  alarm: () => sfx.playAlarm(),
  cash: () => sfx.playCash(),
  win: () => sfx.playWin(),
};

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

type Suggestion = 'hidden' | 'shown' | 'pressed';

/** Dev-only: plays the scripted betting session start to finish in under 30 seconds. */
const SimConsole: React.FC<SimConsoleProps> = ({
  displayName,
  refresh,
  onSelectMarket,
  onOpenBet,
  onCloseBet,
  onChoosePlayer,
  onClose,
}) => {
  const [cursor, setCursor] = useState(0);
  const [total, setTotal] = useState(1);
  const [label, setLabel] = useState('Setting the table…');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion>('hidden');
  const runId = useRef(0);
  const latest = useRef({ refresh, onSelectMarket, onOpenBet, onCloseBet, onChoosePlayer, displayName });
  latest.current = { refresh, onSelectMarket, onOpenBet, onCloseBet, onChoosePlayer, displayName };

  const play = useCallback(async () => {
    const id = ++runId.current;
    const p = latest.current;
    const alive = () => runId.current === id;
    setRunning(true);
    setError(null);
    setCursor(0);
    setSuggestion('hidden');
    setLabel('Setting the table…');
    setFakeFriendsPaused(true);
    try {
      p.onCloseBet();
      await post('/api/demo/reset');
      await post('/api/dev/personas');
      const joined = (await post('/api/groups/join', { nickname: p.displayName || 'You' })) as {
        player: { id: string };
      };
      const me: SimMe = { id: joined.player.id, name: p.displayName || 'You' };
      p.onChoosePlayer(me.id);
      await p.refresh();
      if (!alive()) return;

      const steps: SimStep[] = buildSimSteps(me);
      setTotal(steps.length);
      const unit = TOTAL_MS / steps.reduce((sum, s) => sum + (s.weight ?? 1), 0);
      const start = performance.now();
      let elapsed = 0;
      let shownMarket = '';

      for (let i = 0; i < steps.length; i++) {
        if (!alive()) return;
        const step = steps[i];
        await step.run(post);
        if (!alive()) return;
        if (step.sound) SOUNDS[step.sound]();
        if (step.ui === 'suggest') setSuggestion('shown');
        if (step.ui === 'create') setSuggestion('pressed');
        if (step.marketId && step.marketId !== shownMarket) {
          shownMarket = step.marketId;
          setSuggestion('hidden');
          latest.current.onSelectMarket(step.marketId);
        } else {
          await latest.current.refresh();
        }
        if (step.openBet) latest.current.onOpenBet();
        setCursor(i + 1);
        setLabel(step.label);

        elapsed += (step.weight ?? 1) * unit;
        const wait = start + elapsed - performance.now();
        if (wait > 0) await sleep(wait);
      }
      setLabel('Session complete');
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : 'Sim failed');
      await latest.current.refresh();
    } finally {
      if (alive()) {
        setRunning(false);
        setFakeFriendsPaused(false);
      }
    }
  }, []);

  // Start on mount, cancel on unmount. StrictMode's dev double-mount cancels the
  // first run and the second mount starts a fresh one.
  useEffect(() => {
    void play();
    return () => {
      runId.current++;
      setFakeFriendsPaused(false);
    };
  }, [play]);

  return (
    <>
      {suggestion !== 'hidden' && (
        <div className="sim-suggest pastel-card" role="status">
          <div className="sim-suggest-head">
            <PixelMascot size={22} />
            <span className="pixel-font">MARKETMATE</span>
          </div>
          <p>That sounds like a bet! Want me to make it a market?</p>
          <div className="sim-suggest-market">
            <strong>{SIM_SUGGESTION.question}</strong>
            <span>{SIM_SUGGESTION.detail}</span>
          </div>
          <button
            className={`btn-brand pixel-font ${suggestion === 'pressed' ? 'sim-pressed' : ''}`}
            tabIndex={-1}
          >
            <Icon name="zap" size={14} />
            CREATE MARKET
          </button>
        </div>
      )}

      <section className="sim-pill pastel-card" aria-label="Simulation">
        <span className="pixel-font icon-label sim-pill-tag">
          <Icon name="play" size={12} />
          SIM
        </span>
        <div className="sim-pill-body">
          <span className="sim-pill-label" aria-live="polite">
            {error ?? label}
          </span>
          <div className="sim-progress-bar" aria-hidden="true">
            <div style={{ width: `${(cursor / total) * 100}%` }} />
          </div>
        </div>
        {!running && (
          <button onClick={() => void play()} title="Replay" aria-label="Replay sim">
            <Icon name="reload" size={14} />
          </button>
        )}
        <button
          onClick={() => {
            runId.current++;
            setFakeFriendsPaused(false);
            onClose();
          }}
          title={running ? 'Stop sim' : 'Close sim'}
          aria-label={running ? 'Stop sim' : 'Close sim'}
        >
          <Icon name="close" size={14} />
        </button>
      </section>
    </>
  );
};

export default SimConsole;
