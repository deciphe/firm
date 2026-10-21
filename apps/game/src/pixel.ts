/**
 * Card art: chunky pixel sprites on a coloured, patterned tile (Balatro-style). Every silhouette comes from the
 * shape library in stipple.ts, rasterised to a 24x24 grid, then given a dark outline, a lit top-left edge
 * and a shaded bottom-right edge. Each card has its own tile colour so the board reads at a glance.
 */
import { SHAPE_SIZE, drawShape } from './stipple.ts';

const GRID = 24;
const TILE = 32;

interface Tone { bg: string; stripe: string }
const T = {
  clay: { bg: '#d97757', stripe: '#c9694b' },
  ember: { bg: '#b85a3e', stripe: '#a84f35' },
  gold: { bg: '#d8c38f', stripe: '#cbb47c' },
  mustard: { bg: '#c9a447', stripe: '#b9953c' },
  steel: { bg: '#86a9d4', stripe: '#789bc6' },
  navy: { bg: '#4c6f9c', stripe: '#43638d' },
  felt: { bg: '#3f7a63', stripe: '#376d58' },
  teal: { bg: '#5fa3a0', stripe: '#53938f' },
  plum: { bg: '#8d6a9f', stripe: '#7f5d90' },
  rose: { bg: '#d48a8f', stripe: '#c57b80' },
  plat: { bg: '#b9bcc2', stripe: '#acafb6' },
  bronze: { bg: '#b0805a', stripe: '#a0724e' },
  ink: { bg: '#2a2a30', stripe: '#323239' },
} satisfies Record<string, Tone>;

/** Tile colour per art id. Anything unlisted gets felt. */
const TONE: Record<string, Tone> = {
  gambler: T.clay, grinder: T.steel, retail: T.felt, scalper: T.mustard, trendbro: T.teal, copyring: T.plum,
  hedger: T.rose, ghost: T.plat, chargeback: T.bronze, whale: T.navy, influencer: T.gold, bot: T.ink, botfarm: T.ink, vet: T.gold,
  affiliate: T.clay, riskanalyst: T.plum, discordmod: T.teal, support: T.felt, compliance: T.plat, closer: T.bronze,
  detector: T.navy, upsell: T.mustard, proofwall: T.gold, lawyer: T.ink, quantdesk: T.felt, hypeteam: T.ember, cro: T.gold,
  excuse: T.rose, logo: T.clay, cfo: T.gold,
  f_founder: T.steel, f_hustler: T.clay, f_quant: T.felt, f_closer: T.bronze, f_fixer: T.ink, f_saint: T.gold,
  audit: T.ember, bankrun: T.ember, pricewar: T.ember, expose: T.ember, volatility: T.ember, outage: T.ember,
  steady: T.steel, growth: T.felt, lean: T.plat, raise: T.gold, pr: T.clay, fair: T.teal,
};

const SPRITE = { fill: '#eeeae2', light: '#ffffff', shade: '#bdb6a6', line: '#0c0c0e' };

const cache = new Map<string, HTMLCanvasElement>();

/** Hand-placed sprites where a rasterised silhouette loses the idea (the Gambler's dice). */
const HAND: Record<string, (fill: (x0: number, y0: number, w: number, h: number) => void, hole: (x: number, y: number) => void) => void> = {
  gambler: (fill, hole) => {
    fill(1, 2, 11, 11);
    for (const [x, y] of [[3, 4], [9, 4], [6, 7], [3, 10], [9, 10]]) hole(x ?? 0, y ?? 0);
    fill(12, 11, 11, 11);
    for (const [x, y] of [[14, 13], [17, 16], [20, 19]]) hole(x ?? 0, y ?? 0);
  },
};

/** The 24x24 silhouette: which grid cells are filled. */
function silhouette(id: string): boolean[] {
  const hand = HAND[id];
  if (hand) {
    const cells = new Array<boolean>(GRID * GRID).fill(false);
    hand((x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells[y * GRID + x] = true; }, (x, y) => { cells[y * GRID + x] = false; });
    return cells;
  }
  const S = SHAPE_SIZE;
  const m = document.createElement('canvas');
  m.width = S; m.height = S;
  const c = m.getContext('2d');
  const cells = new Array<boolean>(GRID * GRID).fill(false);
  if (!c) return cells;
  drawShape(id, c);
  const px = c.getImageData(0, 0, S, S).data;
  const step = S / GRID;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      let on = 0, n = 0;
      for (let y = Math.floor(gy * step); y < Math.floor((gy + 1) * step); y++) {
        for (let x = Math.floor(gx * step); x < Math.floor((gx + 1) * step); x++) { n++; if ((px[(y * S + x) * 4 + 3] ?? 0) > 128) on++; }
      }
      cells[gy * GRID + gx] = on / Math.max(1, n) >= 0.38;
    }
  }
  return cells;
}

/** A card's art tile as a canvas, `scale` device pixels per art pixel. Cached. */
export function pixelArt(id: string, scale = 8): HTMLCanvasElement {
  const key = `${id}:${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tone = TONE[id] ?? T.felt;
  const out = document.createElement('canvas');
  out.width = TILE * scale; out.height = TILE * scale;
  const o = out.getContext('2d');
  if (!o) return out;
  const dot = (x: number, y: number, col: string): void => { o.fillStyle = col; o.fillRect(x * scale, y * scale, scale, scale); };
  // the tile: notched corners, diagonal stripes, a lit top edge and a darker bottom edge
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const corner = (x < 2 && y < 2 && x + y < 2) || (x > TILE - 3 && y < 2 && (TILE - 1 - x) + y < 2) || (x < 2 && y > TILE - 3 && x + (TILE - 1 - y) < 2) || (x > TILE - 3 && y > TILE - 3 && (TILE - 1 - x) + (TILE - 1 - y) < 2);
      if (corner) continue;
      dot(x, y, (x + y) % 6 < 2 ? tone.stripe : tone.bg);
    }
  }
  o.globalAlpha = 0.22; for (let x = 2; x < TILE - 2; x++) dot(x, 0, '#ffffff'); o.globalAlpha = 0.2; for (let x = 2; x < TILE - 2; x++) dot(x, TILE - 1, '#000000'); o.globalAlpha = 1;
  // the sprite, centred with a soft drop shadow
  const cells = silhouette(id);
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < GRID && y < GRID && !!cells[y * GRID + x];
  const off = (TILE - GRID) / 2;
  o.globalAlpha = 0.28;
  for (let y = -1; y <= GRID; y++) for (let x = -1; x <= GRID; x++) if (at(x - 1, y - 1) || at(x, y - 1) || at(x - 1, y)) if (!at(x, y)) dot(off + x + 1, off + y + 1, '#000000');
  o.globalAlpha = 1;
  for (let y = -1; y <= GRID; y++) {
    for (let x = -1; x <= GRID; x++) {
      if (at(x, y)) {
        const edgeR = !at(x + 1, y), edgeB = !at(x, y + 1), edgeL = !at(x - 1, y), edgeT = !at(x, y - 1);
        dot(off + x, off + y, edgeR || edgeB ? SPRITE.shade : edgeL || edgeT ? SPRITE.light : SPRITE.fill);
      } else if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) {
        dot(off + x, off + y, SPRITE.line);
      }
    }
  }
  cache.set(key, out);
  return out;
}
