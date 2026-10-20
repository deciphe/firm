/** Flat MASSIVE tokens, as numbers for Phaser and strings for text. */
export const C = {
  ink: 0x080809, panel: 0x111113, panel2: 0x18181b, line: 0x26262b, line2: 0x34343a,
  paper: 0xeeeae2, paper2: 0xe2ddd2, paper3: 0xd2ccbf, muted: 0xaaa499, inkSoft: 0x4a463f,
  gold: 0xd8c38f, goldDeep: 0x9e8a58, plat: 0xc9ccd1, bronze: 0xb0805a,
  clay: 0xd97757, clayDeep: 0x9f4f35, chip: 0x86a9d4, chipDeep: 0x4c6f9c,
} as const;

export const H = {
  ink: '#080809', panel: '#111113', paper: '#eeeae2', muted: '#aaa499', inkSoft: '#4a463f',
  gold: '#d8c38f', goldDeep: '#9e8a58', plat: '#c9ccd1', bronze: '#b0805a', clay: '#d97757', clayDeep: '#9f4f35',
  chip: '#86a9d4', chipInk: '#0d1a2b', clayInk: '#2a0e05', blush: '#f2b39d', blue: '#5d6d86',
} as const;

export const FONT = 'Manrope, Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

export const DEPTH = { bg: 0, table: 10, cards: 20, hud: 30, fly: 40, shop: 50, overlay: 60, guide: 80, toast: 90 } as const;
