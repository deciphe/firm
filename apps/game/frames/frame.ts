/** Style frame: one fully designed screen with mock data, to settle the look before rebuilding. */
import { spriteUrl } from '../src/sprites.ts';

type Kind = 'trader' | 'staff' | 'empty';
interface Pos { kind: Kind; id?: string; name?: string; sub?: string; fee?: number; prog?: number; payout?: number; tag?: string; tone?: 'due' | 'fraud' | 'boost'; effect?: string; uid?: number }

const BOOK: Pos[] = [
  { kind: 'trader', id: 'grinder', name: 'Grinder', sub: 'Customer · 5d', fee: 12, prog: 4, payout: 300, uid: 3 },
  { kind: 'trader', id: 'trendbro', name: 'Trend Bro', sub: 'Customer · 3d', fee: 38, prog: 3, payout: 600, uid: 8 },
  { kind: 'trader', id: 'retail', name: 'New Trader', sub: 'Customer · 2d', fee: 26, prog: 0, payout: 280, uid: 11 },
  { kind: 'trader', id: 'hedger', name: 'Hedger', sub: 'Exposed · 2d', fee: 13, prog: 8, payout: 350, tag: 'FRAUD', tone: 'fraud', uid: 14 },
  { kind: 'empty' },
  { kind: 'staff', id: 'affiliate', name: 'Affiliate', sub: 'Staff', effect: '+50% fees to adjacent gamblers', uid: 5 },
  { kind: 'trader', id: 'gambler', name: 'Gambler', sub: 'Customer · 5d', fee: 45, prog: 0, payout: 250, tone: 'boost', uid: 1 },
  { kind: 'trader', id: 'grinder', name: 'Grinder', sub: 'Customer · 5d', fee: 12, prog: 10, payout: 320, tag: 'PAYOUT', tone: 'due', uid: 2 },
  { kind: 'trader', id: 'gambler', name: 'Gambler', sub: 'Customer · 5d', fee: 30, prog: 2, payout: 250, uid: 7 },
  { kind: 'empty' },
  { kind: 'empty' },
  { kind: 'trader', id: 'gambler', name: 'Gambler', sub: 'Customer · 5d', fee: 45, prog: 1, payout: 250, tone: 'boost', uid: 4 },
  { kind: 'trader', id: 'grinder', name: 'Grinder', sub: 'Customer · 5d', fee: 12, prog: 6, payout: 300, uid: 6 },
  { kind: 'trader', id: 'gambler', name: 'Gambler', sub: 'Customer · 5d', fee: 30, prog: 0, payout: 250, uid: 9 },
  { kind: 'empty' },
  { kind: 'empty' }, { kind: 'staff', id: 'riskanalyst', name: 'Risk Analyst', sub: 'Staff', effect: 'Exposes fraud in its row', uid: 12 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' },
];

function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** An equity path for a trader: wobbling, trending toward their progress level. */
function sparkPath(p: Pos, w: number, h: number): { line: string; area: string; endY: number } {
  const r = rnd((p.uid ?? 1) * 97);
  const n = 18;
  const target = Math.min(1, (p.prog ?? 0) / 10);
  const pts: [number, number][] = [];
  let v = 0.08;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    v += (target * t - v) * 0.35 + (r() - 0.5) * 0.12;
    v = Math.max(0.02, Math.min(1, v));
    pts.push([t * w, h - v * h]);
  }
  const last = pts[pts.length - 1] as [number, number];
  last[1] = h - Math.max(0.03, target) * h;
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${w} ${h} L0 ${h} Z`, endY: last[1] };
}

function card(p: Pos, i: number): string {
  if (p.kind === 'empty') return `<div class="pos empty" style="--i:${i}"><span>+ Hire</span></div>`;
  const av = `<span class="av"><img src="${spriteUrl(p.id ?? 'retail', p.uid ?? 0)}" alt=""></span>`;
  if (p.kind === 'staff') {
    return `<div class="pos staff" style="--i:${i}">
      <div class="ph">${av}<div class="pn"><b>${p.name}</b><small>${p.sub}</small></div></div>
      <div class="adj">${Array.from({ length: 9 }, (_, k) => `<i class="${k === 4 ? 'me' : 'on'}"></i>`).join('')}</div>
      <p class="eff">${p.effect}</p>
    </div>`;
  }
  const W = 140, H = 44;
  const { line, area, endY } = sparkPath(p, W, H);
  const hot = (p.prog ?? 0) >= 7;
  const tone = p.tone ?? (hot ? 'hot' : '');
  const tag = p.tag ? `<span class="tag t-${p.tone}">${p.tag}</span>` : '';
  return `<div class="pos ${tone}" style="--i:${i}">
    <div class="ph">${av}<div class="pn"><b>${p.name}</b><small>${p.sub}</small></div><span class="fee">+$${p.fee}${p.tone === 'boost' ? '<em>×1.5</em>' : ''}</span></div>
    <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" x2="${W}" y1="1" y2="1" class="target"/>
      <path d="${area}" fill="url(#g${i})"/>
      <path d="${line}" class="ln"/>
      <circle cx="${W}" cy="${endY}" r="2.6" class="dot"/>
    </svg>
    <div class="pf"><span>Payout <b>$${p.payout}</b></span><span class="pr"><b>${p.prog}</b>/10</span>${tag}</div>
  </div>`;
}

function marketChart(): string {
  const days: ('chop' | 'up' | 'down' | 'news')[] = ['chop', 'up', 'chop', 'chop', 'news', 'down', 'chop', 'up', 'up', 'chop', 'chop', 'news', 'chop', 'up', 'chop', 'down', 'chop', 'chop'];
  const r = rnd(42);
  let price = 100;
  const W = 300, H = 120, n = days.length, cw = W / n;
  const bars = days.map((d) => {
    const o = price;
    const move = d === 'up' ? 3 + r() * 4 : d === 'down' ? -(3 + r() * 4) : d === 'news' ? (r() - 0.5) * 12 : (r() - 0.5) * 1.6;
    const c = o + move;
    const hi = Math.max(o, c) + r() * (d === 'news' ? 5 : 1.6);
    const lo = Math.min(o, c) - r() * (d === 'news' ? 5 : 1.6);
    price = c;
    return { o, c, hi, lo, d };
  });
  const max = Math.max(...bars.map((b) => b.hi)) + 1, min = Math.min(...bars.map((b) => b.lo)) - 1;
  const Y = (v: number): number => H - ((v - min) / (max - min)) * H;
  return `<svg viewBox="0 0 ${W} ${H}" class="mkt" aria-label="Market candles">
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="grid"/>`).join('')}
    ${bars.map((b, i) => { const x = i * cw + cw / 2; const up = b.c >= b.o; const cls = b.d === 'news' ? 'news' : up ? 'up' : 'dn'; return `<line x1="${x}" x2="${x}" y1="${Y(b.hi)}" y2="${Y(b.lo)}" class="wick ${cls}"/><rect x="${x - cw * 0.32}" y="${Math.min(Y(b.o), Y(b.c))}" width="${cw * 0.64}" height="${Math.max(1.5, Math.abs(Y(b.o) - Y(b.c)))}" class="body ${cls}"/>`; }).join('')}
    <rect x="${n * cw - cw * 0.9}" y="${Y(price) - 12}" width="${cw * 0.64}" height="24" class="ghost"/>
  </svg>`;
}

document.getElementById('book')!.innerHTML = BOOK.map(card).join('');
document.getElementById('market')!.innerHTML = marketChart();
const avatarMarv = document.getElementById('marv-av') as HTMLImageElement | null;
if (avatarMarv) avatarMarv.src = spriteUrl('cfo');

// Backdrop: a faint, slowly drifting candle chart behind everything, like a terminal at night.
const cv = document.getElementById('bg') as HTMLCanvasElement;
const ctx = cv.getContext('2d');
const r = rnd(7);
const series: { o: number; c: number; h: number; l: number }[] = [];
let px = 0;
for (let i = 0; i < 160; i++) { const o = px; const c = o + (r() - 0.48) * 6; series.push({ o, c, h: Math.max(o, c) + r() * 3, l: Math.min(o, c) - r() * 3 }); px = c; }
function draw(t: number): void {
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(120,170,160,0.045)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 48) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 48) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
  const cw = 14, off = (t / 220) % cw;
  const vals = series.flatMap((s) => [s.h, s.l]);
  const mx = Math.max(...vals), mn = Math.min(...vals);
  const Y = (v: number): number => h * 0.18 + (1 - (v - mn) / (mx - mn)) * h * 0.64;
  series.forEach((s, i) => {
    const x = i * cw - off - 40;
    if (x < -cw || x > w + cw) return;
    const up = s.c >= s.o;
    ctx.fillStyle = up ? 'rgba(92,242,197,0.07)' : 'rgba(240,80,95,0.06)';
    ctx.fillRect(x + cw / 2 - 0.5, Y(s.h), 1, Y(s.l) - Y(s.h));
    ctx.fillRect(x + 3, Math.min(Y(s.o), Y(s.c)), cw - 6, Math.max(2, Math.abs(Y(s.o) - Y(s.c))));
  });
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
