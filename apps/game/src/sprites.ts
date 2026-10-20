/**
 * Placeholder pixel sprites, 8x8, drawn from strings so they stay crisp at any integer scale.
 * Final art from a human artist replaces these by id (see design/sprites/).
 */
const PAL: Record<string, string> = {
  a: '#cfe6dc', // ink
  w: '#f4fbf8', // white
  m: '#45e6a8', // mint
  r: '#ff4b5c', // red
  y: '#ffc145', // amber
  b: '#6aa9ff', // blue
  g: '#5d776d', // dim
};

const S: Record<string, string[]> = {
  gambler: ['........', '.wwwwww.', '.wrwwrw.', '.wwwwww.', '.wwrrww.', '.wwwwww.', '.wrwwrw.', '........'],
  grinder: ['........', '.yyyyy..', 'y..a..y.', '...a....', '...a....', '...a....', '...a....', '........'],
  retail: ['...aa...', '..aaaa..', '..aaaa..', '...aa...', '.bbbbbb.', 'bbbbbbbb', 'bbbbbbbb', '........'],
  scalper: ['....yy..', '...yy...', '..yy....', '.yyyyy..', '...yy...', '..yy....', '.yy.....', '........'],
  trendbro: ['...mm...', '..mmmm..', '.mmmmmm.', '...mm...', '...mm...', '...mm...', '...mm...', '........'],
  copyring: ['bbbb....', 'b..b....', 'b.bbbb..', 'bbbb.b..', '..b..b..', '..bbbb..', '........', '........'],
  hedger: ['..m.....', '.mmm....', 'm.m.....', '..m..r..', '.....r..', '...r.r.r', '....rrr.', '.....r..'],
  ghost: ['aaaaaaaa', 'a.yy...a', 'ayyyy.wa', 'a.yy..ga', 'ayyyy.wa', 'a......a', 'aaaaaaaa', '........'],
  chargeback: ['........', 'rrrrrrrr', 'rwwwwwwr', 'rrrrrrrr', 'r..r...r', 'r.rr...r', 'rrrrrrrr', '........'],
  whale: ['........', '......b.', '..bbbbb.', '.bbbbbbb', 'bbwbbbbb', 'bbbbbbb.', '.bbbbb..', '........'],
  influencer: ['...yy...', '...yy...', 'yyyyyyyy', '.yyyyyy.', '..yyyy..', '.yy..yy.', 'yy....yy', '........'],
  bot: ['...aa...', '.aaaaaa.', '.amaama.', '.aaaaaa.', '.a.aa.a.', '..aaaa..', '..a..a..', '........'],
  vet: ['..b..b..', '..b..b..', '...bb...', '..yyyy..', '.yyyyyy.', '.yymmyy.', '..yyyy..', '........'],
  affiliate: ['......m.', '.....mm.', 'aa.mmmm.', 'aammmmm.', 'aa.mmmm.', '.....mm.', '......m.', '........'],
  riskanalyst: ['..aaaa..', '.a....a.', '.a.mm.a.', '.a....a.', '..aaaa..', '.....aa.', '......aa', '........'],
  discordmod: ['.bbbbbb.', '.bwwwwb.', '.bwbbwb.', '.bwwwwb.', '..bwwb..', '...bb...', '........', '........'],
  support: ['..aaaa..', '.a....a.', 'a......a', 'mm....mm', 'mm....mm', '......a.', '....aa..', '........'],
  compliance: ['...yy...', '.aaaaaa.', '.awwwwa.', '.aw..wa.', '.awwwwa.', '.aw..wa.', '.aaaaaa.', '........'],
  closer: ['...m....', '..mmmm..', '.mm.....', '..mmm...', '....mm..', '.mmmm...', '...m....', '........'],
  detector: ['........', '..mmmm..', '.m....m.', 'm..mm..m', 'm..mm..m', '.m....m.', '..mmmm..', '........'],
  lawyer: ['........', '...aa...', '..a..a..', 'yyyyyyyy', 'yyyaayyy', 'yyyyyyyy', 'yyyyyyyy', '........'],
  upsell: ['...m....', '..mmm...', '.m.m.m..', '...m..m.', '...m.mmm', '...m..m.', '........', '........'],
  proofwall: ['.wwwwww.', '.w....w.', '.wmmmmw.', '.w....w.', '.wmmm.w.', '.w....w.', '.w.w.w..', '........'],
  botfarm: ['aa..aa..', 'amaama..', 'aa..aa..', '..aa..aa', '..amaama', '..aa..aa', '........', '........'],
  excuse: ['........', '.rrrrrr.', '.r....r.', '.r.rr.r.', '.r....r.', '.rrrrrr.', '........', '........'],
};

const cache = new Map<string, string>();

/** A data URL for the sprite, drawn at 1px per pixel; CSS scales it with `image-rendering: pixelated`. */
export function spriteUrl(id: string): string {
  const key = S[id] ? id : 'retail';
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = S[key] as string[];
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = PAL[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}
