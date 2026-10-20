/** Sound (synthesised, no files), haptics and screen shake. All optional and failure-tolerant. */

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean): void { muted = m; }
export function isMuted(): boolean { return muted; }

/** Must be called from a user gesture; browsers only allow audio after one. */
export function unlockAudio(): void {
  if (ctx) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  } catch { ctx = null; }
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0): void {
  if (muted || !ctx) return;
  try {
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch { /* audio is optional */ }
}

/** A coin blip; `step` climbs a major-ish scale so a sequence of fees sounds like it's counting up. */
export function coin(step: number): void {
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
  const semis = scale[Math.min(step, scale.length - 1)] ?? 0;
  const f = 660 * Math.pow(2, semis / 12);
  tone(f, 0.09, 'square', 0.05);
  tone(f * 2, 0.05, 'sine', 0.03, 0.01);
}

export function loss(): void { tone(140, 0.22, 'sawtooth', 0.07); }
export function thud(): void { tone(70, 0.28, 'sine', 0.2); tone(110, 0.12, 'square', 0.04); }
export function tick(): void { tone(1200, 0.025, 'square', 0.025); }
export function stamp(): void { tone(90, 0.18, 'square', 0.12); tone(60, 0.25, 'sine', 0.18, 0.02); }
export function cashOut(): void { [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.12, 'square', 0.05, i * 0.06)); }
export function alarm(): void { tone(880, 0.12, 'square', 0.05); tone(660, 0.16, 'square', 0.05, 0.13); }
export function fanfare(): void { [0, 7, 12, 16, 19, 24].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 0.16, 'square', 0.05, i * 0.07)); }

export function buzz(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* not available in every frame */ }
}

const reduce = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Shake an element; strength 0..1 scales distance and duration. */
export function shake(el: HTMLElement, strength: number): void {
  if (reduce() || strength <= 0) return;
  const px = Math.round(2 + 10 * Math.min(1, strength));
  const ms = Math.round(160 + 260 * Math.min(1, strength));
  el.animate(
    [
      { transform: 'translate(0,0)' },
      { transform: `translate(${-px}px, ${px / 2}px)` },
      { transform: `translate(${px}px, ${-px / 2}px)` },
      { transform: `translate(${-px / 2}px, ${px}px)` },
      { transform: `translate(${px / 2}px, ${-px}px)` },
      { transform: 'translate(0,0)' },
    ],
    { duration: ms, easing: 'cubic-bezier(.2,.8,.3,1)' },
  );
}

export function motionOk(): boolean { return !reduce(); }

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, reduce() ? Math.min(ms, 30) : ms));
