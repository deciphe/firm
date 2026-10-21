/**
 * Stipple: the lunar identity. A dotted moon that slowly turns through its phases behind the game,
 * and stippled ink illustrations for every card face. All dots, no gradients.
 */

// ------------------------------------------------------------------ seeded noise

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ------------------------------------------------------------------ the moon

export interface Sky {
  pulse(tone: 'gold' | 'clay' | 'paper', amount?: number): void;
  setHeat(h: number): void;
}

export function startSky(canvas: HTMLCanvasElement, reduced: boolean): Sky {
  const ctx = canvas.getContext('2d');
  const noop: Sky = { pulse: () => {}, setHeat: () => {} };
  if (!ctx) return noop;
  interface Dot { x: number; y: number; nx: number; ny: number; nz: number; crater: number; seed: number; r: number }
  let dots: Dot[] = [];
  let stars: { x: number; y: number; s: number; p: number }[] = [];
  let W = 0, H = 0, cx = 0, cy = 0, R = 0;
  let pulseAmt = 0;
  let pulseTone: [number, number, number] = [238, 234, 226];
  let heat = 0;

  const layout = (): void => {
    W = window.innerWidth; H = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const wide = W > H;
    R = Math.min(W, H) * (wide ? 0.62 : 0.6);
    cx = wide ? W * 0.98 : W * 0.95;
    cy = wide ? H * 0.42 : H * 0.12;
    dots = [];
    const step = Math.max(4, R / 62);
    for (let y = -R; y <= R; y += step) {
      for (let x = -R; x <= R; x += step) {
        const jx = x + (hash(x, y) - 0.5) * step * 0.9;
        const jy = y + (hash(y, x) - 0.5) * step * 0.9;
        const d2 = (jx * jx + jy * jy) / (R * R);
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const crater = vnoise(jx / R * 4 + 10, jy / R * 4) * 0.6 + vnoise(jx / R * 11, jy / R * 11 + 5) * 0.4;
        dots.push({ x: cx + jx, y: cy + jy, nx: jx / R, ny: jy / R, nz, crater, seed: hash(jx * 3.1, jy * 1.7), r: step * 0.26 });
      }
    }
    stars = Array.from({ length: Math.round((W * H) / 9000) }, (_, i) => ({ x: hash(i, 1) * W, y: hash(i, 2) * H, s: 0.5 + hash(i, 3) * 0.8, p: hash(i, 4) * 6.28 }));
  };
  layout();
  window.addEventListener('resize', layout);

  let t0 = performance.now();
  let lastDraw = 0;
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = (now - t0) / 1000;
    if (now - lastDraw < (pulseAmt > 0.02 ? 33 : 90)) return;
    lastDraw = now;
    pulseAmt *= 0.86;
    ctx.clearRect(0, 0, W, H);
    // stars
    for (const s of stars) {
      const a = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(dt * 0.8 + s.p));
      ctx.fillStyle = `rgba(238,234,226,${reduced ? 0.18 : a})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    // the moon: light direction orbits slowly, so the terminator sweeps through phases
    // lit from the upper left, slowly breathing between a fat crescent and a gibbous moon
    const wob = reduced ? 0 : Math.sin(dt * 0.035);
    const lx = -0.82 + 0.22 * wob, ly = -0.3, lz = 0.42 + 0.3 * wob;
    const ll = Math.hypot(lx, ly, lz);
    const [pr, pg, pb] = pulseTone;
    const base: [number, number, number] = [238 + (217 - 238) * heat, 234 + (119 - 234) * heat, 226 + (87 - 226) * heat];
    const mix = Math.min(1, pulseAmt);
    const col = `rgb(${Math.round(base[0] + (pr - base[0]) * mix)},${Math.round(base[1] + (pg - base[1]) * mix)},${Math.round(base[2] + (pb - base[2]) * mix)})`;
    ctx.fillStyle = col;
    for (const d of dots) {
      const lit = Math.max(0, (d.nx * lx + d.ny * ly + d.nz * lz) / ll);
      const b = Math.pow(lit, 1.25) * (0.55 + 0.45 * d.crater) + 0.035 + pulseAmt * 0.12;
      if (d.seed > b * 0.95) continue;
      ctx.globalAlpha = 0.12 + 0.3 * Math.min(1, b);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * (0.7 + 0.6 * Math.min(1, b)), 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  requestAnimationFrame(frame);
  void t0;
  t0 = performance.now();

  return {
    pulse(tone, amount = 1) {
      pulseTone = tone === 'gold' ? [216, 195, 143] : tone === 'clay' ? [217, 119, 87] : [238, 234, 226];
      pulseAmt = Math.min(1.2, pulseAmt + amount);
    },
    setHeat(h) { heat = Math.max(0, Math.min(1, h)) * 0.6; },
  };
}

// ------------------------------------------------------------------ card illustrations

type Draw = (c: CanvasRenderingContext2D) => void;
const S = 120;

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}
function circ(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
}
function poly(c: CanvasRenderingContext2D, pts: number[]): void {
  c.beginPath(); c.moveTo(pts[0] ?? 0, pts[1] ?? 0);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);
  c.closePath(); c.fill();
}
function cut(c: CanvasRenderingContext2D, f: () => void): void {
  c.save(); c.globalCompositeOperation = 'destination-out'; f(); c.restore();
}
function ring(c: CanvasRenderingContext2D, x: number, y: number, r: number, w: number): void {
  circ(c, x, y, r); cut(c, () => circ(c, x, y, r - w));
}
function stroke(c: CanvasRenderingContext2D, w: number, f: () => void): void {
  c.save(); c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); f(); c.stroke(); c.restore();
}
function bust(c: CanvasRenderingContext2D): void {
  circ(c, 60, 44, 20);
  c.beginPath(); c.ellipse(60, 104, 38, 34, 0, Math.PI, 0); c.fill();
}

const ART: Record<string, Draw> = {
  gambler: (c) => {
    c.save(); c.translate(46, 64); c.rotate(-0.28); rr(c, -24, -24, 48, 48, 9);
    cut(c, () => { for (const [x, y] of [[-12, -12], [12, 12], [0, 0], [12, -12], [-12, 12]]) circ(c, x ?? 0, y ?? 0, 5); }); c.restore();
    c.save(); c.translate(80, 50); c.rotate(0.35); rr(c, -19, -19, 38, 38, 8);
    cut(c, () => { for (const [x, y] of [[-8, -8], [8, 8]]) circ(c, x ?? 0, y ?? 0, 4.2); }); c.restore();
  },
  grinder: (c) => {
    rr(c, 30, 16, 60, 8, 3); rr(c, 30, 96, 60, 8, 3);
    poly(c, [36, 24, 84, 24, 64, 58, 84, 96, 36, 96, 56, 58]);
    cut(c, () => poly(c, [44, 28, 76, 28, 60, 52]));
  },
  retail: (c) => bust(c),
  scalper: (c) => poly(c, [68, 10, 30, 66, 56, 66, 46, 110, 90, 50, 64, 50, 78, 10]),
  trendbro: (c) => {
    c.beginPath(); c.ellipse(60, 54, 18, 40, 0, 0, Math.PI * 2); c.fill();
    poly(c, [42, 70, 26, 100, 46, 88]); poly(c, [78, 70, 94, 100, 74, 88]); poly(c, [54, 92, 60, 114, 66, 92]);
    cut(c, () => circ(c, 60, 46, 8));
  },
  copyring: (c) => { ring(c, 42, 50, 22, 7); ring(c, 78, 50, 22, 7); ring(c, 60, 80, 22, 7); },
  hedger: (c) => {
    rr(c, 57, 22, 6, 78, 3); rr(c, 22, 30, 76, 6, 3); rr(c, 40, 98, 40, 8, 3);
    stroke(c, 2, () => { c.moveTo(28, 36); c.lineTo(20, 66); c.moveTo(28, 36); c.lineTo(38, 66); c.moveTo(92, 36); c.lineTo(82, 66); c.moveTo(92, 36); c.lineTo(102, 66); });
    c.beginPath(); c.arc(29, 66, 13, 0, Math.PI); c.fill(); c.beginPath(); c.arc(92, 66, 13, 0, Math.PI); c.fill();
  },
  ghost: (c) => {
    rr(c, 12, 28, 96, 64, 9);
    cut(c, () => { rr(c, 20, 38, 34, 44, 5); rr(c, 62, 44, 36, 5, 2); rr(c, 62, 56, 28, 5, 2); rr(c, 62, 68, 32, 5, 2); });
    c.save(); c.beginPath(); c.rect(20, 38, 34, 44); c.clip(); circ(c, 37, 54, 8); c.beginPath(); c.ellipse(37, 82, 14, 12, 0, Math.PI, 0); c.fill(); c.restore();
  },
  chargeback: (c) => {
    rr(c, 14, 30, 82, 54, 8); cut(c, () => rr(c, 14, 42, 82, 9, 0));
    stroke(c, 7, () => { c.arc(80, 82, 20, -0.3, Math.PI * 0.9); });
    poly(c, [54, 76, 62, 96, 70, 80]);
  },
  whale: (c) => {
    c.beginPath(); c.ellipse(54, 66, 40, 24, 0, 0, Math.PI * 2); c.fill();
    poly(c, [88, 60, 112, 38, 106, 64, 114, 86, 88, 72]);
    cut(c, () => circ(c, 36, 60, 3.5));
    stroke(c, 3, () => { c.moveTo(50, 40); c.quadraticCurveTo(48, 26, 40, 22); c.moveTo(50, 40); c.quadraticCurveTo(54, 26, 62, 22); });
  },
  influencer: (c) => {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? 18 : 42; pts.push(60 + Math.cos(a) * r, 62 + Math.sin(a) * r); }
    poly(c, pts);
  },
  bot: (c) => {
    rr(c, 26, 36, 68, 56, 12); rr(c, 57, 18, 6, 18, 3); circ(c, 60, 16, 6);
    cut(c, () => { circ(c, 46, 60, 8); circ(c, 74, 60, 8); rr(c, 44, 76, 32, 5, 2); });
    rr(c, 16, 54, 8, 20, 3); rr(c, 96, 54, 8, 20, 3);
  },
  botfarm: (c) => {
    for (const [x, y] of [[18, 22], [62, 22], [40, 64]]) { rr(c, x ?? 0, y ?? 0, 40, 34, 8); cut(c, () => { circ(c, (x ?? 0) + 12, (y ?? 0) + 15, 4.5); circ(c, (x ?? 0) + 28, (y ?? 0) + 15, 4.5); }); }
  },
  vet: (c) => { poly(c, [40, 12, 56, 12, 66, 50, 50, 50]); poly(c, [64, 12, 80, 12, 70, 50, 54, 50]); ring(c, 60, 74, 28, 9); circ(c, 60, 74, 12); },
  affiliate: (c) => { poly(c, [24, 50, 50, 50, 92, 26, 92, 94, 50, 70, 24, 70]); rr(c, 34, 70, 14, 26, 4); stroke(c, 4, () => { c.arc(96, 60, 18, -0.7, 0.7); }); },
  riskanalyst: (c) => { ring(c, 50, 50, 30, 10); c.save(); c.translate(76, 76); c.rotate(Math.PI / 4); rr(c, -6, 0, 12, 40, 5); c.restore(); },
  discordmod: (c) => { c.beginPath(); c.moveTo(60, 14); c.lineTo(96, 28); c.quadraticCurveTo(96, 86, 60, 108); c.quadraticCurveTo(24, 86, 24, 28); c.closePath(); c.fill(); cut(c, () => poly(c, [44, 58, 56, 72, 80, 44, 84, 50, 56, 82, 40, 64])); },
  support: (c) => { stroke(c, 9, () => { c.arc(60, 62, 34, Math.PI * 1.05, Math.PI * 1.95); }); rr(c, 18, 58, 18, 32, 7); rr(c, 84, 58, 18, 32, 7); stroke(c, 4, () => { c.moveTo(92, 90); c.quadraticCurveTo(90, 106, 66, 104); }); circ(c, 64, 104, 5); },
  compliance: (c) => { rr(c, 26, 22, 68, 90, 8); cut(c, () => { rr(c, 34, 36, 52, 70, 4); }); rr(c, 44, 14, 32, 16, 5); for (let i = 0; i < 4; i++) rr(c, 40, 46 + i * 14, i % 2 ? 26 : 38, 5, 2); },
  closer: (c) => { poly(c, [50, 14, 70, 14, 64, 28, 56, 28]); poly(c, [56, 28, 64, 28, 78, 92, 60, 110, 42, 92]); },
  detector: (c) => { circ(c, 60, 86, 7); stroke(c, 6, () => { c.arc(60, 86, 24, Math.PI * 1.15, Math.PI * 1.85); }); stroke(c, 6, () => { c.arc(60, 86, 44, Math.PI * 1.15, Math.PI * 1.85); }); stroke(c, 6, () => { c.arc(60, 86, 64, Math.PI * 1.2, Math.PI * 1.8); }); },
  lawyer: (c) => { c.save(); c.translate(56, 46); c.rotate(-0.6); rr(c, -26, -12, 52, 24, 6); rr(c, -5, 10, 10, 54, 4); c.restore(); rr(c, 52, 94, 50, 12, 4); },
  upsell: (c) => { rr(c, 20, 74, 18, 30, 3); rr(c, 46, 58, 18, 46, 3); rr(c, 72, 40, 18, 64, 3); stroke(c, 5, () => { c.moveTo(22, 56); c.lineTo(48, 38); c.lineTo(62, 46); c.lineTo(94, 18); }); poly(c, [96, 12, 98, 30, 82, 18]); },
  proofwall: (c) => { c.beginPath(); c.moveTo(30, 12); c.lineTo(90, 12); c.lineTo(90, 106); for (let i = 0; i < 6; i++) { c.lineTo(85 - i * 10, 100); c.lineTo(80 - i * 10, 106); } c.closePath(); c.fill(); cut(c, () => { rr(c, 40, 26, 40, 5, 2); rr(c, 40, 38, 28, 5, 2); poly(c, [42, 64, 52, 74, 76, 50, 80, 56, 52, 84, 38, 70]); }); },
  quantdesk: (c) => { rr(c, 12, 18, 96, 66, 8); cut(c, () => rr(c, 20, 26, 80, 50, 4)); for (const [x, y, h] of [[30, 50, 18], [44, 40, 24], [58, 54, 14], [72, 34, 30], [86, 44, 20]]) { rr(c, (x ?? 0) - 1, (y ?? 0) - 6, 2, (h ?? 0) + 12, 1); rr(c, (x ?? 0) - 4, y ?? 0, 8, h ?? 0, 2); } rr(c, 50, 84, 20, 14, 2); rr(c, 34, 96, 52, 8, 4); },
  hypeteam: (c) => { c.beginPath(); c.moveTo(60, 8); c.bezierCurveTo(78, 34, 98, 52, 92, 80); c.bezierCurveTo(88, 102, 72, 112, 60, 112); c.bezierCurveTo(44, 112, 26, 102, 26, 78); c.bezierCurveTo(26, 58, 40, 50, 44, 32); c.bezierCurveTo(52, 46, 54, 52, 56, 60); c.bezierCurveTo(62, 44, 64, 28, 60, 8); c.closePath(); c.fill(); cut(c, () => { c.beginPath(); c.moveTo(60, 62); c.bezierCurveTo(72, 76, 76, 88, 70, 98); c.bezierCurveTo(64, 106, 54, 106, 50, 98); c.bezierCurveTo(46, 88, 54, 80, 60, 62); c.closePath(); c.fill(); }); },
  cro: (c) => { poly(c, [16, 40, 38, 64, 60, 22, 82, 64, 104, 40, 94, 92, 26, 92]); rr(c, 26, 96, 68, 12, 3); circ(c, 16, 36, 7); circ(c, 60, 18, 7); circ(c, 104, 36, 7); cut(c, () => { circ(c, 42, 80, 5); circ(c, 60, 80, 5); circ(c, 78, 80, 5); }); },
  excuse: (c) => { rr(c, 24, 14, 64, 88, 6); cut(c, () => { for (let i = 0; i < 4; i++) rr(c, 34, 28 + i * 12, i === 3 ? 26 : 44, 5, 2); }); circ(c, 80, 88, 18); cut(c, () => ring(c, 80, 88, 12, 2.5)); },
  // founders
  f_founder: (c) => { bust(c); cut(c, () => poly(c, [56, 76, 64, 76, 66, 104, 60, 112, 54, 104])); poly(c, [57, 78, 63, 78, 64, 100, 60, 106, 56, 100]); },
  f_hustler: (c) => { bust(c); rr(c, 36, 20, 48, 12, 5); rr(c, 60, 26, 34, 7, 3); cut(c, () => rr(c, 40, 82, 40, 5, 2)); },
  f_quant: (c) => { bust(c); cut(c, () => { ring(c, 51, 44, 9, 3); ring(c, 69, 44, 9, 3); rr(c, 58, 43, 4, 2, 1); }); cut(c, () => { for (let i = 0; i < 4; i++) rr(c, 42 + i * 10, 96 - i * 6, 6, 14 + i * 6, 2); }); },
  f_closer: (c) => { bust(c); cut(c, () => { poly(c, [52, 74, 60, 84, 68, 74, 66, 70, 60, 76, 54, 70]); }); cut(c, () => rr(c, 72, 92, 22, 6, 3)); },
  f_fixer: (c) => { bust(c); cut(c, () => rr(c, 34, 84, 52, 26, 4)); rr(c, 38, 88, 44, 20, 3); cut(c, () => rr(c, 52, 84, 16, 6, 2)); },
  f_saint: (c) => { bust(c); cut(c, () => circ(c, 60, 44, 23)); circ(c, 60, 46, 18); stroke(c, 4, () => { c.ellipse(60, 18, 22, 6, 0, 0, Math.PI * 2); }); },
  // crises
  audit: (c) => { ring(c, 50, 50, 30, 10); c.save(); c.translate(76, 76); c.rotate(-Math.PI / 4); rr(c, -7, 0, 14, 42, 5); c.restore(); cut(c, () => { rr(c, 38, 40, 24, 4, 2); rr(c, 38, 50, 18, 4, 2); rr(c, 38, 60, 22, 4, 2); }); },
  bankrun: (c) => { for (let i = 0; i < 3; i++) { circ(c, 30 + i * 30, 40, 10); rr(c, 20 + i * 30, 54, 20, 34, 8); } poly(c, [14, 98, 100, 98, 100, 90, 112, 102, 100, 114, 100, 106, 14, 106]); },
  pricewar: (c) => { poly(c, [20, 50, 50, 20, 100, 20, 100, 70, 70, 100]); cut(c, () => circ(c, 84, 36, 7)); cut(c, () => { c.save(); c.translate(58, 62); c.rotate(-0.8); rr(c, -34, -4, 68, 8, 3); c.restore(); }); },
  expose: (c) => { rr(c, 14, 28, 92, 64, 14); cut(c, () => poly(c, [50, 44, 50, 76, 78, 60])); circ(c, 98, 22, 9); },
  volatility: (c) => { stroke(c, 7, () => { c.moveTo(10, 70); c.lineTo(28, 30); c.lineTo(44, 92); c.lineTo(62, 18); c.lineTo(80, 100); c.lineTo(96, 40); c.lineTo(110, 60); }); },
  outage: (c) => { rr(c, 18, 46, 34, 28, 6); rr(c, 8, 52, 12, 5, 2); rr(c, 8, 63, 12, 5, 2); rr(c, 68, 46, 34, 28, 6); rr(c, 100, 56, 14, 8, 3); poly(c, [58, 30, 66, 30, 60, 56, 70, 56, 54, 92, 58, 64, 50, 64]); },
  // quarter plans
  steady: (c) => { for (let i = 0; i < 5; i++) rr(c, 16 + i * 19, 70 - i * 2, 13, 36 + i * 2, 3); stroke(c, 5, () => { c.moveTo(14, 54); c.lineTo(106, 46); }); },
  growth: (c) => { rr(c, 20, 80, 18, 26, 3); rr(c, 46, 60, 18, 46, 3); rr(c, 72, 36, 18, 70, 3); poly(c, [66, 26, 100, 10, 98, 46]); },
  lean: (c) => { rr(c, 44, 14, 32, 92, 8); cut(c, () => { for (let i = 0; i < 6; i++) rr(c, 50, 22 + i * 14, i % 2 ? 10 : 18, 4, 2); }); },
  raise: (c) => { circ(c, 60, 66, 40); cut(c, () => ring(c, 60, 66, 30, 4)); cut(c, () => { rr(c, 56, 42, 8, 48, 3); rr(c, 46, 50, 26, 8, 4); rr(c, 48, 74, 26, 8, 4); }); poly(c, [60, 4, 76, 22, 66, 22, 66, 30, 54, 30, 54, 22, 44, 22]); },
  pr: (c) => { poly(c, [24, 50, 50, 50, 92, 26, 92, 94, 50, 70, 24, 70]); rr(c, 34, 70, 14, 26, 4); circ(c, 104, 40, 5); circ(c, 108, 60, 5); circ(c, 104, 80, 5); },
  fair: (c) => { for (let i = 0; i < 3; i++) { circ(c, 30 + i * 30, 46, 11); c.beginPath(); c.ellipse(30 + i * 30, 86, 15, 18, 0, Math.PI, 0); c.fill(); } rr(c, 10, 88, 100, 8, 3); },
  logo: (c) => { rr(c, 14, 14, 92, 92, 18); cut(c, () => { rr(c, 32, 30, 14, 60, 3); rr(c, 32, 30, 50, 13, 3); rr(c, 32, 54, 38, 12, 3); }); },
  cfo: (c) => { bust(c); cut(c, () => { ring(c, 52, 44, 8, 2.5); ring(c, 70, 44, 8, 2.5); rr(c, 58, 43, 4, 2, 1); }); },
};

const artCache = new Map<string, string>();

/** A stippled illustration as a transparent PNG data URL, inked in `ink`. */
export function stippleArt(id: string, ink = '#080809'): string {
  const key = `${id}:${ink}`;
  const hit = artCache.get(key);
  if (hit) return hit;
  const url = stippleCanvas(id, ink).toDataURL();
  artCache.set(key, url);
  return url;
}

/** The same illustration as a canvas (for game textures). */
export function stippleCanvas(id: string, ink = '#080809', SCALE = 3): HTMLCanvasElement {
  const draw = ART[id] ?? ART.retail;
  const mask = document.createElement('canvas');
  mask.width = S; mask.height = S;
  const m = mask.getContext('2d');
  const out = document.createElement('canvas');
  out.width = S * SCALE; out.height = S * SCALE;
  const o = out.getContext('2d');
  if (!m || !o || !draw) return out;
  m.fillStyle = '#000'; m.strokeStyle = '#000';
  draw(m);
  const px = m.getImageData(0, 0, S, S).data;
  const inside = (x: number, y: number): boolean => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= S || iy >= S) return false;
    return (px[(iy * S + ix) * 4 + 3] ?? 0) > 128;
  };
  o.fillStyle = ink;
  const step = 1.55;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const jx = x + (hash(x, y) - 0.5) * step;
      const jy = y + (hash(y, x + 3) - 0.5) * step;
      if (!inside(jx, jy)) continue;
      const edge = !inside(jx - 2.2, jy) || !inside(jx + 2.2, jy) || !inside(jx, jy - 2.2) || !inside(jx, jy + 2.2);
      // light from the top-left: denser shadow toward the bottom-right, plus a soft core highlight
      const shade = 0.58 + 0.38 * ((jx + jy) / (2 * S)) + 0.1 * vnoise(jx / 9, jy / 9);
      if (!edge && hash(jx * 1.3, jy * 2.1) > shade) continue;
      o.beginPath();
      o.arc(jx * SCALE, jy * SCALE, (edge ? 0.62 : 0.5) * SCALE, 0, 6.283);
      o.fill();
    }
  }
  return out;
}

export const ART_IDS = Object.keys(ART);
