// ============================================================================
// Synthesized App Sound Effects (Web Audio API — Zero External Asset Failures)
// Includes WhatsApp-style voice toggle chimes, chat bubble pops, tactile clicks,
// and casino chip / bet confirmation chords.
// ============================================================================

class SoundEffectsManager {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

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
    gain.connect(ctx.destination);
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
    gain.connect(ctx.destination);
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
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }
}

export const sfx = new SoundEffectsManager();
