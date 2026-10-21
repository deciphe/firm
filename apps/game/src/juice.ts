/**
 * Sound (synthesised, no files), haptics and motion preferences. All optional and failure-tolerant.
 *
 * Everything runs through one master chain: voices -> sfx bus -> compressor -> out, with a send into a
 * generated plate reverb. Scoring sounds climb a pentatonic scale so a long count sounds like it is
 * building; mult hits are heavier than chips; the total is a chord sized by the day.
 */

let ctx: AudioContext | null = null;
let muted = false;
let musicOn = true;
let sfx: GainNode | null = null;
let musicBus: GainNode | null = null;
let verb: ConvolverNode | null = null;
let verbSend: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

export function setMuted(m: boolean): void {
  muted = m;
  if (ctx && sfx && musicBus) {
    const t = ctx.currentTime;
    sfx.gain.setTargetAtTime(m ? 0 : 0.9, t, 0.02);
    musicBus.gain.setTargetAtTime(m || !musicOn ? 0 : 0.22, t, 0.3);
  }
}
export function isMuted(): boolean { return muted; }
export function setMusic(on: boolean): void { musicOn = on; setMuted(muted); if (on) startMusic(); }
export function isMusicOn(): boolean { return musicOn; }

/** Must be called from a user gesture; browsers only allow audio after one. */
export function unlockAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    comp.connect(out).connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = muted ? 0 : 0.9; sfx.connect(comp);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(comp);
    // generated plate: decaying stereo noise
    verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    verb.buffer = ir;
    verbSend = ctx.createGain(); verbSend.gain.value = 0.22;
    verbSend.connect(verb).connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    setMuted(muted);
    startMusic();
  } catch { ctx = null; }
}

interface Voice { type?: OscillatorType; f: number; f2?: number; dur: number; gain: number; when?: number; attack?: number; lp?: number; wet?: number; detune?: number }

/** One enveloped oscillator, optionally swept and low-passed, into the sfx bus (and a little reverb). */
function voice(v: Voice, bus: GainNode | null = sfx): void {
  if (!ctx || !bus) return;
  try {
    const t = ctx.currentTime + (v.when ?? 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = v.type ?? 'triangle';
    o.frequency.setValueAtTime(v.f, t);
    if (v.f2) o.frequency.exponentialRampToValueAtTime(v.f2, t + v.dur);
    if (v.detune) o.detune.value = v.detune;
    const a = v.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
    let node: AudioNode = o.connect(g);
    if (v.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = v.lp; f.Q.value = 0.8;
      node = node.connect(f);
    }
    node.connect(bus);
    if (verbSend && (v.wet ?? 0.15) > 0) {
      const w = ctx.createGain(); w.gain.value = v.wet ?? 0.15;
      node.connect(w).connect(verbSend);
    }
    o.start(t);
    o.stop(t + v.dur + 0.05);
  } catch { /* audio is optional */ }
}

/** A burst of filtered noise (clicks, whooshes, crackle). */
function noise(dur: number, gain: number, freq: number, q = 1, when = 0, sweepTo?: number, type: BiquadFilterType = 'bandpass'): void {
  if (!ctx || !sfx || !noiseBuf) return;
  try {
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  } catch { /* optional */ }
}

const PENTA = [0, 2, 4, 7, 9];
/** Semitones for step k of a rising major pentatonic run. */
const penta = (k: number): number => 12 * Math.floor(k / 5) + (PENTA[k % 5] ?? 0);
const hz = (base: number, semis: number): number => base * Math.pow(2, semis / 12);
const jitter = (cents: number): number => (Math.random() - 0.5) * cents;

/** A fee chip landing. Climbs a pentatonic run across the count. */
export function chip(k: number, total = 8): void {
  const step = Math.min(k, 14) + (total > 14 ? 0 : 0);
  const f = hz(523, penta(step));
  noise(0.025, 0.12, 4200, 2);
  voice({ type: 'triangle', f, dur: 0.12, gain: 0.16, detune: jitter(12) });
  voice({ type: 'sine', f: f * 2, dur: 0.07, gain: 0.05, when: 0.005 });
}

/** A mult hit: heavier, filtered, climbing. ×Mult adds a sub and rings longer. */
export function mult(k: number, times = false): void {
  const f = hz(196, penta(Math.min(k, 10)));
  voice({ type: 'sawtooth', f: f * 0.75, f2: f, dur: times ? 0.38 : 0.2, gain: times ? 0.16 : 0.12, lp: times ? 2400 : 1600, wet: 0.25 });
  voice({ type: 'square', f: f * 2, dur: 0.1, gain: 0.04, lp: 3000 });
  if (times) { voice({ type: 'sine', f: f / 2, dur: 0.45, gain: 0.25, wet: 0 }); noise(0.25, 0.06, 900, 0.7, 0, 3000); }
}

/** Fees × mult lands. A chord sized by the day (0..1); a dull thud for a loss. */
export function total(scale: number, loss = false): void {
  if (loss) { voice({ type: 'sawtooth', f: 110, f2: 70, dur: 0.4, gain: 0.14, lp: 700 }); voice({ type: 'sine', f: 55, dur: 0.4, gain: 0.25, wet: 0 }); return; }
  const g = 0.06 + 0.07 * scale;
  [0, 4, 7, 12].forEach((s, i) => voice({ type: 'triangle', f: hz(392, s), dur: 0.5 + scale * 0.5, gain: g, when: i * 0.018, wet: 0.35 }));
  voice({ type: 'sine', f: 98, dur: 0.5, gain: 0.18 + 0.12 * scale, wet: 0 });
  noise(0.3 + scale * 0.3, 0.05 + 0.06 * scale, 6000, 0.6, 0, 1500, 'lowpass');
  if (scale > 0.6) [12, 16, 19, 24].forEach((s, i) => voice({ type: 'triangle', f: hz(392, s), dur: 0.18, gain: 0.05, when: 0.12 + i * 0.06 }));
}

/** The candle lands: a knock for chop, sweeps for trends, a bell for news. */
export function candle(c: 'chop' | 'up' | 'down' | 'news'): void {
  if (c === 'chop') { voice({ type: 'sine', f: 220, f2: 180, dur: 0.12, gain: 0.2 }); noise(0.04, 0.1, 1800, 3); return; }
  if (c === 'up') { voice({ type: 'sawtooth', f: 220, f2: 660, dur: 0.28, gain: 0.08, lp: 2200 }); voice({ type: 'sine', f: 110, dur: 0.3, gain: 0.2 }); return; }
  if (c === 'down') { voice({ type: 'sawtooth', f: 520, f2: 150, dur: 0.32, gain: 0.08, lp: 1800 }); voice({ type: 'sine', f: 82, dur: 0.35, gain: 0.22 }); return; }
  voice({ type: 'triangle', f: 1320, dur: 0.5, gain: 0.08, wet: 0.4 }); voice({ type: 'triangle', f: 1760, dur: 0.4, gain: 0.05, when: 0.06, wet: 0.4 }); voice({ type: 'sine', f: 98, dur: 0.4, gain: 0.22 });
}

/** A coin blip (kept for menus and receipts). */
export function coin(step: number): void { chip(step); }

export function loss(): void { voice({ type: 'sawtooth', f: 160, f2: 90, dur: 0.22, gain: 0.1, lp: 900 }); }
export function thud(): void { voice({ type: 'sine', f: 90, f2: 50, dur: 0.3, gain: 0.3, wet: 0.05 }); noise(0.06, 0.08, 400, 1); }
/** A tiny UI click; `k` nudges the pitch so repeated ticks don't drone. */
export function tick(k = 0): void { noise(0.018, 0.08, 3200 + (k % 4) * 300, 4); voice({ type: 'square', f: 1400 + (k % 4) * 90, dur: 0.02, gain: 0.015, wet: 0 }); }
export function stamp(): void { voice({ type: 'sine', f: 120, f2: 55, dur: 0.25, gain: 0.32, wet: 0.1 }); noise(0.09, 0.2, 1200, 0.8); noise(0.03, 0.12, 5000, 1, 0.005); }
export function whoosh(up = true): void { noise(0.22, 0.07, up ? 500 : 2600, 1.2, 0, up ? 2600 : 500); }
export function flip(): void { noise(0.05, 0.1, 2400, 2); voice({ type: 'triangle', f: 880, f2: 1320, dur: 0.06, gain: 0.04 }); }
export function cashOut(): void { [0, 4, 7, 12, 16].forEach((s, i) => { voice({ type: 'triangle', f: hz(659, s), dur: 0.14, gain: 0.07, when: i * 0.05 }); noise(0.02, 0.05, 5000, 3, i * 0.05); }); }
export function alarm(): void { voice({ type: 'square', f: 880, dur: 0.12, gain: 0.05, lp: 3000 }); voice({ type: 'square', f: 660, dur: 0.16, gain: 0.05, when: 0.13, lp: 3000 }); }
export function fanfare(): void { [0, 7, 12, 16, 19, 24].forEach((s, i) => voice({ type: 'triangle', f: hz(392, s), dur: 0.22, gain: 0.07, when: i * 0.07, wet: 0.35 })); }
export function denied(): void { voice({ type: 'square', f: 196, dur: 0.14, gain: 0.07, lp: 1200 }); voice({ type: 'square', f: 147, dur: 0.22, gain: 0.07, when: 0.12, lp: 1200 }); }

// ------------------------------------------------------------------ music: a quiet generated lo-fi loop

let musicTimer: number | null = null;
/** Am9 - Fmaj7 - Cmaj7 - G6, two bars each, at a lazy 78 bpm. */
const CHORDS = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 69], [48, 55, 59, 64, 67], [55, 59, 62, 64, 69]];
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

function startMusic(): void {
  if (!ctx || !musicBus || musicTimer !== null) return;
  const beat = 60 / 78;
  let next = ctx.currentTime + 0.2;
  let bar = 0;
  const schedule = (): void => {
    if (!ctx || !musicBus) return;
    while (next < ctx.currentTime + 1.2) {
      const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length] ?? CHORDS[0] ?? [];
      const t0 = next - ctx.currentTime;
      if (bar % 2 === 0) {
        // pad: soft detuned triangles, low-passed
        for (const n of chord) for (const d of [-7, 7]) voice({ type: 'triangle', f: midi(n), dur: beat * 8, gain: 0.025, when: t0, attack: 0.6, lp: 1400, wet: 0.5, detune: d }, musicBus);
        voice({ type: 'sine', f: midi((chord[0] ?? 48) - 12), dur: beat * 3.5, gain: 0.12, when: t0, attack: 0.05, wet: 0 }, musicBus);
      } else {
        voice({ type: 'sine', f: midi((chord[0] ?? 48) - 12), dur: beat * 1.5, gain: 0.09, when: t0 + beat * 2.5, attack: 0.05, wet: 0 }, musicBus);
      }
      // a sparse plucked melody from the chord tones
      for (let b = 0; b < 4; b++) {
        if (((bar * 7 + b * 3) % 5) > 1) continue;
        const n = chord[(bar + b * 2) % chord.length] ?? 60;
        voice({ type: 'triangle', f: midi(n + 12), dur: 0.5, gain: 0.03, when: t0 + b * beat + beat * 0.5, lp: 2600, wet: 0.6 }, musicBus);
      }
      // brushed hats
      for (let b = 0; b < 8; b++) {
        if (!ctx) break;
        const tt = t0 + b * beat * 0.5;
        if (tt >= 0) noiseOn(musicBus, 0.04, b % 2 ? 0.012 : 0.02, 7000, tt);
      }
      next += beat * 4;
      bar++;
    }
  };
  schedule();
  musicTimer = window.setInterval(schedule, 400);
}

function noiseOn(bus: GainNode, dur: number, gain: number, freq: number, when: number): void {
  if (!ctx || !noiseBuf) return;
  try {
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  } catch { /* optional */ }
}

// ------------------------------------------------------------------ haptics + motion

export function buzz(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* not available in every frame */ }
}

const reduce = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export function motionOk(): boolean { return !reduce(); }

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, reduce() ? Math.min(ms, 30) : ms));
