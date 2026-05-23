// src/lib/audio.ts
// Tiny Web Audio engine matching the v4 prototype's sound design exactly.
// Reference: proposals/v4/proposal-live-v4.html → "SOUND DESIGN" block.
//
// All sounds are synthesized via OscillatorNode + GainNode — no external
// samples. A single shared AudioContext is lazy-initialized on first call
// because browsers require a user gesture before audio can play; the first
// invocation must originate from a user action (Begin / Audio toggle).
//
// Use setEnabled() to gate playback at the module level. When disabled,
// every play* call returns immediately — no AudioContext is created.

interface ToneOptions {
  /** Starting frequency in Hz. */
  readonly freq: number;
  /** Total duration in seconds (envelope decays exponentially over this). */
  readonly dur: number;
  /** Peak gain at the end of attack (0–1, but typical values are 0.02–0.05). */
  readonly peak: number;
  /** Attack time in seconds (default 0.005). */
  readonly attack?: number;
  /** Oscillator waveform (default 'sine'). */
  readonly type?: OscillatorType;
  /** Optional end frequency — when set, the oscillator glides freq → freqEnd over `dur`. */
  readonly freqEnd?: number;
  /** Harmonic richness 0–1 — adds a second osc at 2× freq, weighted by this value (default 0). */
  readonly harmonics?: number;
}

// ── Module state ─────────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
let isEnabled = false;

interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/**
 * Toggle the audio engine on/off. When false, all play functions are no-ops.
 * Persisted via settingsStore.audioEnabled — call from App.svelte bootstrap
 * (with the loaded preference) and from any UI toggle that flips audio state.
 */
export function setEnabled(on: boolean): void {
  isEnabled = on;
}

/** Read the current enabled flag (useful for UI gating + tests). */
export function getEnabled(): boolean {
  return isEnabled;
}

function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  if (typeof window === 'undefined') return null;
  try {
    const Ctor =
      window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Core tone synthesis. Mirrors the v4 prototype's `playTone(opts)` pattern
 * one-to-one: linear-ramp attack, exponential-ramp decay, optional frequency
 * glide via exponentialRampToValueAtTime, optional second-harmonic oscillator
 * at half the peak weighted by `harmonics`.
 */
function playTone(opts: ToneOptions): void {
  if (!isEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const {
    freq,
    dur,
    peak,
    attack = 0.005,
    type = 'sine',
    freqEnd,
    harmonics = 0,
  } = opts;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + dur);
  }
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);

  // Subtle harmonic for richness — second osc at 2× freq, peak scaled by
  // `harmonics` weight. Matches v4 prototype exactly (peak * 0.3 * harmonics).
  if (harmonics > 0) {
    const h = ctx.createOscillator();
    const hg = ctx.createGain();
    h.type = 'sine';
    h.frequency.setValueAtTime(freq * 2, now);
    hg.gain.setValueAtTime(0, now);
    hg.gain.linearRampToValueAtTime(peak * 0.3 * harmonics, now + attack);
    hg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    h.connect(hg).connect(ctx.destination);
    h.start(now);
    h.stop(now + dur + 0.02);
  }
}

/**
 * Soft 880 Hz sine tick. Fires on each round arrival to give the user an
 * audible pulse of the measurement cadence. Matches v4 exactly:
 * freq 880, dur 80 ms, peak 0.025, harmonics 0.5.
 */
export function playTick(): void {
  playTone({ freq: 880, dur: 0.08, peak: 0.025, harmonics: 0.5 });
}

/**
 * Threshold-cross chime — fires when an endpoint's latest sample crosses
 * upward past the user's healthThreshold (was below, now above). Rising
 * triangle glissando 1180 → 1480 Hz over 180 ms; peak 0.04. Matches v4.
 */
export function playThresholdCross(): void {
  playTone({
    freq: 1180,
    freqEnd: 1480,
    dur: 0.18,
    peak: 0.04,
    type: 'triangle',
  });
}

/**
 * Carrier-lost descending tone — fires when an endpoint transitions from
 * `ok` into `timeout` or `error`. Sawtooth glide 440 → 160 Hz over 700 ms;
 * peak 0.05, harmonics 0.3. Matches v4 exactly.
 */
export function playCarrierLost(): void {
  playTone({
    freq: 440,
    freqEnd: 160,
    dur: 0.7,
    peak: 0.05,
    type: 'sawtooth',
    harmonics: 0.3,
  });
}

/**
 * Session-start swell — fires when lifecycle transitions idle → starting,
 * or when the user enables audio for the first time in a session. Three
 * ascending notes (C5, E5, A5 → 523/659/880 Hz), 600 ms each, staggered
 * 120 ms apart for a chord-swell effect. Matches v4 exactly.
 */
export function playSessionStart(): void {
  if (!isEnabled) return;
  const notes = [523, 659, 880] as const;
  notes.forEach((f, i) => {
    setTimeout(
      () =>
        playTone({
          freq: f,
          dur: 0.6,
          peak: 0.025,
          type: 'sine',
          harmonics: 0.4,
        }),
      i * 120,
    );
  });
}
