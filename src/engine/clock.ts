// ============================================================================
// Injectable Clock for Replay Determinism (SPEC §5.1 & §7.1)
// ============================================================================

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class DeterministicClock implements Clock {
  private currentMs: number;
  private seqCounter: number = 0;

  constructor(initialEpochMs: number = 1762542000000) {
    this.currentMs = initialEpochMs;
  }

  now(): number {
    return this.currentMs;
  }

  advance(deltaMs: number): number {
    if (deltaMs < 0) {
      throw new Error('DeterministicClock cannot advance backwards');
    }
    this.currentMs += Math.trunc(deltaMs);
    return this.currentMs;
  }

  set(epochMs: number): void {
    this.currentMs = Math.trunc(epochMs);
  }

  nextId(prefix: string): string {
    this.seqCounter += 1;
    return `${prefix}_${this.currentMs}_${this.seqCounter}`;
  }
}
