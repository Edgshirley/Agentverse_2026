import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { sfx } from '../utils/soundEffects';

const TRACK_URL = '/audio/marketmate_lounge.m4a';
const STORAGE_KEY = 'spread.music.v1';

function loadSettings(): { volume: number; muted: boolean } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 0.4,
        muted: parsed.muted === true,
      };
    }
  } catch {
    // Storage blocked: fall back to defaults
  }
  return { volume: 0.4, muted: false };
}

/** Looping lounge music with a mute button and volume slider. */
export const MusicControl: React.FC = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [{ volume, muted }, setSettings] = useState(loadSettings);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const duckTimer = useRef<number | null>(null);

  // Duck the music under every sound effect so effects stay audible.
  useEffect(
    () =>
      sfx.onPlay(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.volume = volumeRef.current * 0.3;
        if (duckTimer.current) window.clearTimeout(duckTimer.current);
        duckTimer.current = window.setTimeout(() => {
          if (audioRef.current) audioRef.current.volume = volumeRef.current;
        }, 700);
      }),
    []
  );

  // Create the looping track once; browsers block autoplay until the first click/key, so retry then.
  useEffect(() => {
    const audio = new Audio(TRACK_URL);
    audio.loop = true;
    audioRef.current = audio;
    const tryPlay = () => {
      if (audio.paused) audio.play().catch(() => {});
    };
    tryPlay();
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach((e) => window.addEventListener(e, tryPlay));
    return () => {
      events.forEach((e) => window.removeEventListener(e, tryPlay));
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume, muted }));
    } catch {
      // Storage blocked: the setting just won't persist
    }
  }, [volume, muted]);

  const silent = muted || volume === 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        onClick={() =>
          setSettings((s) =>
            s.volume === 0 ? { volume: 0.4, muted: false } : { ...s, muted: !s.muted }
          )
        }
        style={{ padding: '6px 8px' }}
        title={silent ? 'Unmute music' : 'Mute music'}
        aria-label={silent ? 'Unmute music' : 'Mute music'}
      >
        <Icon name={silent ? 'volume-x' : 'volume'} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round((muted ? 0 : volume) * 100)}
        onChange={(e) => setSettings({ volume: Number(e.target.value) / 100, muted: false })}
        aria-label="Music volume"
        title={`Music volume ${Math.round(volume * 100)}%`}
        style={{ width: 80, accentColor: 'var(--accent-pos, currentColor)', cursor: 'pointer' }}
      />
    </div>
  );
};
