// ============================================================================
// Synthesized App Sound Effects (Web Audio API — Zero External Asset Failures)
// Includes WhatsApp-style voice toggle chimes, chat bubble pops, tactile clicks,
// and casino chip / bet confirmation chords.
// ============================================================================

type SfxListener = () => void;

class SoundEffectsManager {
  private ctx: AudioContext | null = null;
  private master: AudioNode | null = null;
  private listeners = new Set<SfxListener>();
  public enabled: boolean = true;

  /** Called whenever a sound plays, so background music can duck under it. */
  onPlay(listener: SfxListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** All effects go through a boosted, compressed bus so they cut through the music. */
  private out(ctx: AudioContext): AudioNode {
    if (!this.master) {
      const gain = ctx.createGain();
      gain.gain.value = 2.2;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 6;
      gain.connect(comp);
      comp.connect(ctx.destination);
      this.master = gain;
    }
    this.listeners.forEach((l) => l());
    return this.master;
  }

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * WhatsApp-style Voice Recording START chime:
   * Crisp ascending two-note warm pop (E5 -> B5) when clicking SPEAK to start recording.
   */
  playVoiceStart(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Note 1: Warm lower tone (659.25 Hz - E5)
    this.playTone(ctx, 659.25, now, 0.075, 0.16, 'sine');
    // Note 2: Crisp higher indicator tone (987.77 Hz - B5)
    this.playTone(ctx, 987.77, now + 0.06, 0.13, 0.2, 'sine');
  }

  /**
   * WhatsApp-style Voice Recording STOP / SEND chime:
   * Crisp descending two-note confirmation pop (A5 -> E5) when clicking again to finish recording.
   */
  playVoiceStop(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Note 1: Upper tone (880 Hz - A5)
    this.playTone(ctx, 880, now, 0.065, 0.16, 'sine');
    // Note 2: Settling lower confirmation tone (587.33 Hz - D5)
    this.playTone(ctx, 587.33, now + 0.055, 0.14, 0.18, 'sine');
  }

  /**
   * WhatsApp-style Chat Message Send / Bubble Pop:
   * Quick upward pitch sweep (520 Hz -> 940 Hz over 45ms).
   */
  playChatPop(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(960, now + 0.048);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain);
    gain.connect(this.out(ctx));
    osc.start(now);
    osc.stop(now + 0.06);
  }

  /**
   * Subtle Tactile UI Button / Tab Click:
   * Soft, short percussive tap for general buttons & tabs across the app.
   */
  playUiClick(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.025);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);

    osc.connect(gain);
    gain.connect(this.out(ctx));
    osc.start(now);
    osc.stop(now + 0.03);
  }

  /**
   * Casino Chip / Bet Placed / Action Confirmed Chord:
   * Pleasant 8-bit + warm triad arpeggio (C5 -> E5 -> G5 -> C6).
   */
  playBetConfirm(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      this.playTone(ctx, freq, now + idx * 0.045, 0.11, 0.13, 'triangle');
    });
  }

  /**
   * Tuxedo Cat Widget Alert / Notification Chime:
   * Playful two-note 8-bit perk-up sound.
   */
  playCatAlert(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    this.playTone(ctx, 740, now, 0.06, 0.12, 'square');
    this.playTone(ctx, 1108.73, now + 0.065, 0.11, 0.12, 'square');
  }

  /** Soft clock tick for match / forecast updates. */
  playTick(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 1320, now, 0.04, 0.1, 'square');
    this.playTone(ctx, 990, now + 0.07, 0.04, 0.07, 'square');
  }

  /** Quick auction-paddle chirp for width bids. */
  playBid(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 587.33, now, 0.06, 0.13, 'square');
    this.playTone(ctx, 880, now + 0.07, 0.09, 0.13, 'square');
  }

  /** Chips clacking onto the table when someone takes a side. */
  playChips(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.05, 0.11].forEach((t, i) => {
      this.playNoise(ctx, now + t, 0.035, 0.22, 2600 + i * 500);
      this.playTone(ctx, 2093 - i * 180, now + t, 0.05, 0.06, 'triangle');
    });
  }

  /** Goal! Rising fanfare plus a burst of crowd noise. */
  playGoal(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      this.playTone(ctx, f, now + i * 0.07, 0.18, 0.13, 'square')
    );
    this.playNoise(ctx, now, 0.9, 0.12, 900);
  }

  /** Low descending buzzer (VAR, goal ruled out). */
  playBuzz(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.45);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(this.out(ctx));
    osc.start(now);
    osc.stop(now + 0.52);
  }

  /** Alternating alarm beeps when a stop-loss fires. */
  playAlarm(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.12, 0.24, 0.36].forEach((t, i) =>
      this.playTone(ctx, i % 2 ? 660 : 990, now + t, 0.1, 0.12, 'square')
    );
  }

  /** Cash-register ding for a take-profit. */
  playCash(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playNoise(ctx, now, 0.06, 0.18, 3500);
    this.playTone(ctx, 1567.98, now + 0.04, 0.35, 0.14, 'sine');
    this.playTone(ctx, 2093, now + 0.1, 0.4, 0.12, 'sine');
  }

  /** Victory fanfare when a market settles. */
  playWin(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const seq: [number, number, number][] = [
      [523.25, 0, 0.12],
      [659.25, 0.12, 0.12],
      [783.99, 0.24, 0.12],
      [1046.5, 0.36, 0.45],
    ];
    seq.forEach(([f, t, d]) => {
      this.playTone(ctx, f, now + t, d, 0.13, 'square');
      this.playTone(ctx, f / 2, now + t, d, 0.08, 'triangle');
    });
  }

  private playNoise(ctx: AudioContext, startTime: number, duration: number, peakGain: number, filterHz: number): void {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterHz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.out(ctx));
    src.start(startTime);
  }

  private playTone(
    ctx: AudioContext,
    freq: number,
    startTime: number,
    duration: number,
    peakGain: number,
    type: OscillatorType
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.out(ctx));

    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }
}

export const sfx = new SoundEffectsManager();
