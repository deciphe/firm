/**
 * FIRM's cast, 16x16 pixel portraits built from layers (skin, hair, eyes, clothes, props) so every
 * character shares one family look. A dark outline is generated automatically. Objects (whale, bots,
 * paperwork) are drawn by hand. Final art from a human artist replaces these by id.
 */

const PAL: Record<string, string> = {
  E: '#0b1411', // eyes
  M: '#7a2a30', // mouth
  K: '#1a2421', // dark accessory
  G: '#2c3b36', // glasses frame
  Y: '#ffc145', // gold
  W: '#f4fbf8', // white
  P: '#e9efe6', // paper
  g: '#93a59d', // paper lines
  R: '#ff4b5c', // red
  m: '#45e6a8', // mint
  b: '#6aa9ff', // blue
  B: '#3f7fe0', // whale blue
  L: '#bcd7ff', // light belly
  A: '#c9d6d1', // bot metal
  O: '#020605', // outline
};

const SKIN = ['#f1c9a5', '#d9a07a', '#a8683f', '#6b4128'];

// 14x14 layers; '.' = transparent. Later layers draw over earlier ones.
const FACE = [
  '..............',
  '..............',
  '....SSSSSS....',
  '...SSSSSSSS...',
  '...SSSSSSSS...',
  '...SSESSESS...',
  '...SSSSSSSS...',
  '...SSSMMSSS...',
  '....SSSSSS....',
  '.....SSSS.....',
  '...CCCCCCCC...',
  '..CCCCCCCCCC..',
  '.CCCCCCCCCCCC.',
  '.CCCCCCCCCCCC.',
];

const HAIR: Record<string, string[]> = {
  short: ['..............', '....HHHHHH....', '...HHHHHHHH...', '...H......H...'],
  slick: ['..............', '..............', '...HHHHHHHH...', '...HHH.....H..'],
  bun: ['.....HHHH.....', '....HHHHHH....', '...HHHHHHHH...', '...HH....HH...'],
  spiky: ['...H.H.H.H....', '...HHHHHHHH...', '...HHHHHHHH...', '...H......H...'],
  curly: ['....HHHHHH....', '...HHHHHHHH...', '..HHHHHHHHHH..', '..HH......HH..', '..H........H..', '..H........H..', '..HH......HH..'],
  cap: ['..............', '....KKKKKK....', '...KKKKKKKK...', '...VVVVVVVVVV.'],
  backcap: ['..............', '....KKKKKK....', '...KKKKKKKK...', '.VVK.......K..'],
  hood: ['....KKKKKK....', '...KKKKKKKK...', '..KKKKKKKKKK..', '..KK......KK..', '..K........K..', '..K........K..', '..K........K..', '..KK......KK..', '...KK....KK...'],
  bald: ['..............', '..............', '....SSSSSS....', '...S......S...'],
};

const EYES: Record<string, string[]> = {
  plain: [],
  glasses: ['', '', '', '', '', '...SGEGGEGS...'],
  shades: ['', '', '', '', '', '...SKKKKKKS...'],
  wink: ['', '', '', '', '', '...SSESSKSS...'],
};

const PROPS: Record<string, string[]> = {
  none: [],
  tie: ['', '', '', '', '', '', '', '', '', '', '......TT......', '......TT......', '.....TTTT.....', '......TT......'],
  chain: ['', '', '', '', '', '', '', '', '', '', '...CYCCCCYC...', '....YYYYYY....', '.....YYYY.....'],
  medal: ['', '', '', '', '', '', '', '', '', '', '....b....b....', '.....b..b.....', '......YY......', '......YY......'],
  headset: ['', '...KKKKKKKK...', '', '', '..K.......K...', '..K...........', '..K...........', '..KKK.........'],
  bolt: ['', '', '', '', '', '', '', '', '', '', '', '......YY......', '.....YYYY.....', '......YY......'],
  headband: ['', '', '', '...RRRRRRRR...'],
  phone: ['', '', '', '', '', '', '', '', '', '', '', '..........WW..', '..........WW..', '..........KK..'],
  card: ['', '', '', '', '', '', '', '', '', '', '', '.........WWW..', '.........RRR..', '.........WWW..'],
  split: ['', '', '', '', '', '', '', '', '', '', '...RRRRmmmm...', '..RRRRRRmmmm..', '.RRRRRRmmmmmm.', '.RRRRRRmmmmmm.'],
  clip: ['', '', '', '', '', '', '', '', '', '', '', '..........WW..', '..........Wg..', '..........WW..'],
};

interface Look { hair: string; hairColor: string; eyes?: string; clothes: string; prop?: string; propColor?: string; visor?: string; dark?: string }

const LOOKS: Record<string, Look> = {
  gambler: { hair: 'cap', hairColor: '#000', clothes: '#d9434f', visor: '#ffc145', dark: '#2a8f5f' },
  grinder: { hair: 'short', hairColor: '#3a2a20', clothes: '#5d6e68', prop: 'headband' },
  retail: { hair: 'short', hairColor: '#4a3a2c', clothes: '#4b7fcf' },
  scalper: { hair: 'slick', hairColor: '#1b1b1b', clothes: '#2e3f3a', prop: 'bolt' },
  trendbro: { hair: 'backcap', hairColor: '#000', eyes: 'shades', clothes: '#45e6a8', visor: '#1c6e4d', dark: '#1c6e4d' },
  copyring: { hair: 'hood', hairColor: '#000', clothes: '#4a3fa8', dark: '#352c7a' },
  hedger: { hair: 'slick', hairColor: '#2b2b2b', eyes: 'wink', clothes: '#000', prop: 'split' },
  ghost: { hair: 'curly', hairColor: '#d7dcd9', eyes: 'glasses', clothes: '#b07ac9' },
  chargeback: { hair: 'short', hairColor: '#6a3b20', eyes: 'wink', clothes: '#7a2a30', prop: 'card' },
  influencer: { hair: 'spiky', hairColor: '#ff7ac8', clothes: '#ffc145', prop: 'phone' },
  vet: { hair: 'short', hairColor: '#8d8d8d', clothes: '#2b5a48', prop: 'medal' },
  affiliate: { hair: 'slick', hairColor: '#111', eyes: 'shades', clothes: '#2e2e3a', prop: 'chain' },
  riskanalyst: { hair: 'short', hairColor: '#2e2a26', eyes: 'glasses', clothes: '#e9efe6', prop: 'tie', propColor: '#3f7fe0' },
  discordmod: { hair: 'spiky', hairColor: '#6aa9ff', clothes: '#5865c8', prop: 'headset' },
  support: { hair: 'bun', hairColor: '#4a2e1e', clothes: '#3f7fe0', prop: 'headset' },
  compliance: { hair: 'bun', hairColor: '#1d1d1d', eyes: 'glasses', clothes: '#5d6e68', prop: 'clip' },
  closer: { hair: 'slick', hairColor: '#c99a4b', clothes: '#1f2b45', prop: 'tie', propColor: '#d9434f' },
  lawyer: { hair: 'bald', hairColor: '#000', eyes: 'glasses', clothes: '#3a3a3a', prop: 'tie', propColor: '#ffc145' },
  cfo: { hair: 'slick', hairColor: '#cfd6d3', eyes: 'glasses', clothes: '#1f2b45', prop: 'tie', propColor: '#45e6a8' },
};

const OBJECTS: Record<string, string[]> = {
  whale: ['..............', '..........B...', '.........BB...', '..BBBBBB.B....', '.BBBBBBBBB....', 'BBWBBBBBBBB...', 'BBEBBBBBBBBB..', 'BBBBBBBBBBBBB.', 'BLLLLLLLBBBBBB', '.LLLLLLLLBBBB.', '..LLLLLLL.....', '..............', '..............', '..............'],
  bot: ['......KK......', '......YY......', '...AAAAAAAA...', '..AAAAAAAAAA..', '..AAmmAAmmAA..', '..AAmmAAmmAA..', '..AAAAAAAAAA..', '..AAKKKKKKAA..', '...AAAAAAAA...', '.....AAAA.....', '...AAAAAAAA...', '..AAAAAAAAAA..', '..AA.AAAA.AA..', '..AA.AAAA.AA..'],
  botfarm: ['..AAAA........', '..AmmA........', '..AAAA..AAAA..', '...AA...AmmA..', '..AAAA..AAAA..', '.........AA...', '........AAAA..', '...AAAA.......', '...AmmA.......', '...AAAA.......', '....AA........', '...AAAA.......', '..............', '..............'],
  excuse: ['..PPPPPPPPPP..', '..PggggggPPP..', '..PPPPPPPPPP..', '..PgggggggPP..', '..PPRRRRRRPP..', '..PRPPPPPPRP..', '..PRPRRRRPRP..', '..PRPPPPPPRP..', '..PPRRRRRRPP..', '..PgggggPPPP..', '..PPPPPPPPPP..', '..PggggggggP..', '..PPPPPPPPPP..', '..............'],
  detector: ['..............', '....mmmmmm....', '...m......m...', '..m..mmmm..m..', '..m.m....m.m..', '..m.m.mm.m.m..', '..m.m.mm.m.m..', '..m.m....m.m..', '..m..mmmm..m..', '...m......m...', '....mmmmmm....', '......KK......', '.....KKKK.....', '....KKKKKK....'],
  upsell: ['..............', '...........m..', '..........mmm.', '.........m.m.m', '...........m..', '.........AAA..', '.........AAA..', '.....AAA.AAA..', '.....AAA.AAA..', '.AAA.AAA.AAA..', '.AAA.AAA.AAA..', '.AAA.AAA.AAA..', '..............', '..............'],
  proofwall: ['...PPPPPPPP...', '...PggggggP...', '...PPPPPPPP...', '...PggggPPP...', '...PPPPPPPP...', '...PPPPPmPP...', '...PPPPmmPP...', '...PmPmmPPP...', '...PmmmPPPP...', '...PPmPPPPP...', '...PPPPPPPP...', '...PggggggP...', '...P.P.P.P....', '..............'],
};

function layer(base: string[][], rows: string[], colors: Record<string, string>): void {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.' || ch === '') return;
      const c = colors[ch] ?? PAL[ch];
      if (c && base[y]) base[y][x] = c;
    });
  });
}

function portrait(look: Look, skin: string): string[][] {
  const px: string[][] = Array.from({ length: 14 }, () => new Array<string>(14).fill(''));
  const colors: Record<string, string> = {
    S: skin, C: look.clothes, H: look.hairColor, K: look.dark ?? '#14201c', V: look.visor ?? '#ffc145', T: look.propColor ?? '#d9434f',
  };
  layer(px, FACE, colors);
  layer(px, HAIR[look.hair] ?? [], colors);
  layer(px, EYES[look.eyes ?? 'plain'] ?? [], colors);
  layer(px, PROPS[look.prop ?? 'none'] ?? [], colors);
  return px;
}

function object(id: string): string[][] {
  const px: string[][] = Array.from({ length: 14 }, () => new Array<string>(14).fill(''));
  layer(px, OBJECTS[id] ?? [], {});
  return px;
}

/** Adds a 1px dark outline and pads 14x14 art to 16x16. */
function outline(px: string[][]): string[][] {
  const out: string[][] = Array.from({ length: 16 }, () => new Array<string>(16).fill(''));
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) { const c = px[y]?.[x]; const row = out[y + 1]; if (c && row) row[x + 1] = c; }
  const filled = (x: number, y: number): boolean => !!out[y]?.[x] && out[y]?.[x] !== PAL.O;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (out[y]?.[x]) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) (out[y] as string[])[x] = PAL.O as string;
    }
  }
  return out;
}

const cache = new Map<string, string>();

/** Sprite id + an optional variant (picks the skin tone) -> data URL at 1px per pixel. */
export function spriteUrl(id: string, variant = 0): string {
  const key = `${id}:${LOOKS[id] ? variant % SKIN.length : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const look = LOOKS[id];
  const art = outline(look ? portrait(look, SKIN[variant % SKIN.length] as string) : OBJECTS[id] ? object(id) : portrait(LOOKS.retail as Look, SKIN[0] as string));
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  art.forEach((row, y) => row.forEach((c, x) => { if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); } }));
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}

export const SPRITE_IDS = [...Object.keys(LOOKS), ...Object.keys(OBJECTS)];
