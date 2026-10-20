/**
 * Seeded random numbers (mulberry32). The generator state lives inside GameState
 * so a run is fully reproducible from its seed and the player's actions.
 */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
  state(): number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    chance: (p) => next() < p,
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick from empty list');
      return item;
    },
    weighted: (entries) => {
      const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
      let roll = next() * total;
      for (const [value, w] of entries) {
        roll -= Math.max(0, w);
        if (roll < 0) return value;
      }
      const last = entries[entries.length - 1];
      if (!last) throw new Error('weighted pick from empty list');
      return last[0];
    },
    state: () => a,
  };
}

/** Turn any string (e.g. a date for the Daily Tape) into a 32-bit seed. */
export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
