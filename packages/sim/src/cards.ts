import type { Rng } from './rng.ts';
import type { Candle, CardInstance, Rarity } from './types.ts';

export type FraudKind = 'hedge' | 'kyc' | 'copy' | 'bot' | 'chargeback';

/** What one trader did today, before staff modifiers. */
export interface TraderOutcome {
  cash: number;
  progress: number;
  /** Blew up and rebought: progress goes back to zero. */
  reset?: boolean;
  heat?: number;
  /** Permanent fee bonus to add after today's fees are counted. */
  upsell?: number;
}

export interface TraderCtx {
  candle: Candle;
  rng: Rng;
  card: CardInstance;
  neighbors: readonly (CardInstance | null)[];
  countOnGrid: (defId: string) => number;
}

export interface NeighborSlot {
  index: number;
  card: CardInstance | null;
  /** Today's outcome for a trader neighbour; staff modify it in place. */
  outcome: TraderOutcome | null;
}

export interface AuraCtx {
  candle: Candle;
  rng: Rng;
  self: CardInstance;
  selfIndex: number;
  neighbors: NeighborSlot[];
  row: (CardInstance | null)[];
  grid: readonly (CardInstance | null)[];
  spawn: (index: number, defId: string) => void;
  reveal: (card: CardInstance) => void;
}

/** What a card adds to today's mult, after every fee is counted. */
export interface MultFx {
  /** +Mult (added). */
  add?: number;
  /** ×Mult (multiplied, after this card's add). */
  times?: number;
}

export interface MultCtx {
  candle: Candle;
  self: CardInstance;
  selfIndex: number;
  neighbors: NeighborSlot[];
  grid: readonly (CardInstance | null)[];
  outcomes: readonly (TraderOutcome | null)[];
  /** Payout requests raised today. */
  requests: number;
  /** Payouts honoured so far this run. */
  payoutsPaid: number;
}

export interface CardDef {
  id: string;
  name: string;
  kind: 'trader' | 'staff';
  rarity: Rarity;
  blurb: string;
  /** 0 means it never appears in the draft. */
  draftWeight: number;
  fraud?: FraudKind;
  /** Name shown while the card's true nature is hidden. */
  disguise?: string;
  threshold?: number;
  payout?: number;
  onDay?: (ctx: TraderCtx) => TraderOutcome;
  /** Runs before traders resolve (reveals). */
  preDay?: (ctx: AuraCtx) => void;
  /** Runs after traders resolve; may change neighbours' fees and progress. */
  aura?: (ctx: AuraCtx) => void;
  /** Fires after all fees are in: adds to or multiplies today's mult. */
  mult?: (ctx: MultCtx) => MultFx | null;
}

const isTrend = (c: Candle): boolean => c === 'up' || c === 'down';
const byCandle = (c: Candle, v: Record<Candle, number>): number => v[c];

const T = 10; // default progress needed for a payout request

/** Customers an Affiliate works on (hidden fraud counts while it still looks like a New Trader). */
const AFFILIATE_TARGETS = ['gambler', 'trendbro', 'retail', 'hedger', 'ghost', 'chargeback'];
const paid = (o: TraderOutcome | null | undefined): boolean => !!o && o.cash > 0;
const round2 = (v: number): number => Math.round(v * 100) / 100;

export const CARDS: Record<string, CardDef> = {
  // ---------------------------------------------------------------- traders
  gambler: {
    id: 'gambler', name: 'Gambler', kind: 'trader', rarity: 'common', draftWeight: 10,
    blurb: 'Blows up and rebuys. Your bread and butter.',
    threshold: T, payout: 250,
    onDay: ({ candle, rng }) => ({
      cash: byCandle(candle, { chop: 30, up: 22, down: 22, news: 40 }),
      progress: candle === 'news' ? (rng.chance(0.2) ? 5 : 0) : isTrend(candle) && rng.chance(0.1) ? 3 : 0,
    }),
  },
  grinder: {
    id: 'grinder', name: 'Grinder', kind: 'trader', rarity: 'common', draftWeight: 9,
    blurb: 'Never blows up. Small, steady payouts. Paying them builds Trust.',
    threshold: T, payout: 300,
    onDay: ({ candle }) => ({ cash: 12, progress: isTrend(candle) ? 2 : 1 }),
  },
  retail: {
    id: 'retail', name: 'New Trader', kind: 'trader', rarity: 'common', draftWeight: 8,
    blurb: 'An ordinary new customer. Probably.',
    threshold: T, payout: 280,
    onDay: ({ candle, rng }) => ({
      cash: byCandle(candle, { chop: 26, up: 20, down: 20, news: 34 }),
      progress: isTrend(candle) && rng.chance(0.15) ? 3 : 0,
    }),
  },
  scalper: {
    id: 'scalper', name: 'Scalper', kind: 'trader', rarity: 'common', draftWeight: 6,
    blurb: 'Feasts on chop days. Blows up when the market moves.',
    threshold: T, payout: 220,
    onDay: ({ candle }) =>
      candle === 'chop' ? { cash: 8, progress: 2 } : { cash: 28, progress: 0, reset: true },
  },
  trendbro: {
    id: 'trendbro', name: 'Trend Bro', kind: 'trader', rarity: 'uncommon', draftWeight: 5,
    blurb: 'Rebuys every chop day. Rips toward payout on trends.',
    threshold: T, payout: 600,
    onDay: ({ candle, rng }) => {
      if (candle === 'chop') return { cash: 38, progress: 0, reset: true };
      if (isTrend(candle)) return { cash: 0, progress: 3 };
      return rng.chance(0.5) ? { cash: 0, progress: 5 } : { cash: 38, progress: 0, reset: true };
    },
  },
  copyring: {
    id: 'copyring', name: 'Copy Ring', kind: 'trader', rarity: 'uncommon', draftWeight: 4, fraud: 'copy',
    blurb: 'Trades in sync with every other Copy Ring. They all pass together.',
    threshold: T, payout: 280,
    onDay: ({ candle, countOnGrid }) => ({
      cash: 18,
      progress: isTrend(candle) ? 1 + Math.min(5, countOnGrid('copyring')) : candle === 'news' ? 1 : 0,
    }),
  },
  hedger: {
    id: 'hedger', name: 'Hedger', kind: 'trader', rarity: 'uncommon', draftWeight: 5, fraud: 'hedge',
    disguise: 'New Trader',
    blurb: 'Next to another Hedger, one side of the pair always wins.',
    threshold: T, payout: 350,
    onDay: ({ neighbors, rng }) => {
      const paired = neighbors.some((n) => n?.def === 'hedger');
      return paired ? { cash: 13, progress: 2 } : { cash: 25, progress: rng.chance(0.1) ? 3 : 0 };
    },
  },
  ghost: {
    id: 'ghost', name: 'Borrowed ID', kind: 'trader', rarity: 'uncommon', draftWeight: 4, fraud: 'kyc',
    disguise: 'New Trader',
    blurb: 'Passed KYC with somebody else\'s identity. Fast to payout.',
    threshold: T, payout: 400,
    onDay: ({ candle }) => ({ cash: 28, progress: isTrend(candle) ? 3 : 2 }),
  },
  chargeback: {
    id: 'chargeback', name: 'Chargeback Artist', kind: 'trader', rarity: 'common', draftWeight: 4, fraud: 'chargeback',
    disguise: 'New Trader',
    blurb: 'Pays well, then claws fees back on news days.',
    onDay: ({ candle }) =>
      candle === 'news' ? { cash: -70, progress: 0, heat: 3 } : { cash: candle === 'chop' ? 40 : 30, progress: 0 },
  },
  whale: {
    id: 'whale', name: 'Whale', kind: 'trader', rarity: 'rare', draftWeight: 2,
    blurb: 'Buys accounts by the dozen. One hit and the payout eats your month.',
    threshold: T, payout: 2500,
    onDay: ({ candle, rng }) => ({
      cash: byCandle(candle, { chop: 110, up: 70, down: 70, news: 140 }),
      progress: isTrend(candle) && rng.chance(0.08) ? 10 : 0,
    }),
  },
  influencer: {
    id: 'influencer', name: 'Influencer', kind: 'trader', rarity: 'uncommon', draftWeight: 3,
    blurb: 'Pays nothing. Doubles the fees of every trader next to them. Never deny them.',
    threshold: T, payout: 300,
    onDay: () => ({ cash: 0, progress: 1 }),
    aura: ({ neighbors }) => {
      for (const n of neighbors) if (n.outcome && n.outcome.cash > 0) n.outcome.cash *= 2;
    },
  },
  bot: {
    id: 'bot', name: 'Bot Account', kind: 'trader', rarity: 'common', draftWeight: 0, fraud: 'bot',
    disguise: 'Bulk Customer',
    blurb: 'One of a farm of fake accounts. Cheap fees, rising Heat.',
    threshold: T, payout: 150,
    onDay: () => ({ cash: 12, progress: 1, heat: 1 }),
  },
  botfarm: {
    id: 'botfarm', name: 'Bulk Order', kind: 'trader', rarity: 'common', draftWeight: 4,
    blurb: 'Someone wants three accounts at once. Fills up to 3 empty slots.',
    onDay: () => ({ cash: 0, progress: 0 }),
  },
  vet: {
    id: 'vet', name: 'Funded Vet', kind: 'trader', rarity: 'common', draftWeight: 0,
    blurb: 'Already paid once. Pays no fees, but their payout certs sell your firm: +0.1 Mult. Keeps requesting; goes live after 3 payouts.',
    threshold: T, payout: 450,
    onDay: ({ candle }) => ({ cash: 0, progress: isTrend(candle) ? 3 : 1 }),
    mult: () => ({ add: 0.1 }),
  },

  // ---------------------------------------------------------------- staff
  affiliate: {
    id: 'affiliate', name: 'Affiliate', kind: 'staff', rarity: 'uncommon', draftWeight: 4,
    blurb: '+0.15 Mult for each adjacent Gambler, Trend Bro or New Trader who paid today.',
    mult: ({ neighbors }) => {
      const n = neighbors.filter((x) => x.card && AFFILIATE_TARGETS.includes(x.card.def) && paid(x.outcome)).length;
      return n ? { add: round2(0.15 * n) } : null;
    },
  },
  riskanalyst: {
    id: 'riskanalyst', name: 'Risk Analyst', kind: 'staff', rarity: 'uncommon', draftWeight: 3,
    blurb: 'Exposes Hedgers, Borrowed IDs, bots and chargebacks in its row. +0.2 Mult for each fraud it has exposed.',
    preDay: ({ row, reveal }) => {
      for (const c of row) if (c && CARDS[c.def]?.fraud) reveal(c);
    },
    mult: ({ grid, selfIndex }) => {
      const r = Math.floor(selfIndex / 5);
      const n = grid.slice(r * 5, r * 5 + 5).filter((c) => c && c.revealed && CARDS[c.def]?.fraud).length;
      return n ? { add: round2(0.2 * n) } : null;
    },
  },
  discordmod: {
    id: 'discordmod', name: 'Discord Mod', kind: 'staff', rarity: 'uncommon', draftWeight: 3,
    blurb: '+10 fees from each adjacent Grinder or Funded Vet.',
    aura: ({ neighbors }) => {
      for (const n of neighbors) {
        if (n.outcome && (n.card?.def === 'grinder' || n.card?.def === 'vet')) n.outcome.cash += 10;
      }
    },
  },
  support: {
    id: 'support', name: 'Support Agent', kind: 'staff', rarity: 'common', draftWeight: 3,
    blurb: 'Stops chargebacks from adjacent traders. -1 Heat a day.',
    aura: ({ neighbors }) => {
      for (const n of neighbors) {
        if (n.outcome && n.outcome.cash < 0) {
          n.outcome.cash = 0;
          n.outcome.heat = 0;
        }
      }
    },
  },
  compliance: {
    id: 'compliance', name: 'Compliance Officer', kind: 'staff', rarity: 'uncommon', draftWeight: 3,
    blurb: 'Adjacent traders progress 1 slower toward payout each day.',
    aura: ({ neighbors }) => {
      for (const n of neighbors) if (n.outcome && n.outcome.progress > 0) n.outcome.progress -= 1;
    },
  },
  closer: {
    id: 'closer', name: 'Sales Closer', kind: 'staff', rarity: 'uncommon', draftWeight: 3,
    blurb: 'Fills one empty adjacent slot with a New Trader every day.',
    aura: ({ neighbors, spawn, rng }) => {
      const empty = neighbors.filter((n) => n.card === null);
      if (empty.length > 0) spawn(rng.pick(empty).index, rng.weighted([['retail', 6], ['gambler', 3], ['hedger', 1]]));
    },
  },
  detector: {
    id: 'detector', name: 'Copy-Trade Detector', kind: 'staff', rarity: 'uncommon', draftWeight: 2,
    blurb: 'Exposes every Copy Ring and bot on the book.',
    preDay: ({ grid, reveal }) => {
      for (const c of grid) if (c && (c.def === 'copyring' || c.def === 'bot')) reveal(c);
    },
  },
  upsell: {
    id: 'upsell', name: 'Upsell Desk', kind: 'staff', rarity: 'uncommon', draftWeight: 3,
    blurb: 'Every adjacent trader who pays today pays +1 more, forever.',
    aura: ({ neighbors }) => {
      for (const n of neighbors) if (n.card && n.outcome && n.outcome.cash > 0) n.outcome.upsell = (n.outcome.upsell ?? 0) + 1;
    },
  },
  proofwall: {
    id: 'proofwall', name: 'Payout Proof Wall', kind: 'staff', rarity: 'rare', draftWeight: 2,
    blurb: '×Mult: +0.05 for every payout you have honoured this run.',
    mult: ({ payoutsPaid }) => (payoutsPaid > 0 ? { times: round2(1 + 0.05 * payoutsPaid) } : null),
  },
  lawyer: {
    id: 'lawyer', name: 'Lawyer', kind: 'staff', rarity: 'uncommon', draftWeight: 2,
    blurb: 'Every denial creates half the Heat.',
  },
  quantdesk: {
    id: 'quantdesk', name: 'Quant Desk', kind: 'staff', rarity: 'uncommon', draftWeight: 3,
    blurb: '+1 Mult on chop days.',
    mult: ({ candle }) => (candle === 'chop' ? { add: 1 } : null),
  },
  hypeteam: {
    id: 'hypeteam', name: 'Hype Team', kind: 'staff', rarity: 'uncommon', draftWeight: 3,
    blurb: '+0.05 Mult for every customer on the book who paid today.',
    mult: ({ outcomes }) => {
      const n = outcomes.filter(paid).length;
      return n ? { add: round2(0.05 * n) } : null;
    },
  },
  cro: {
    id: 'cro', name: 'Chief Risk Officer', kind: 'staff', rarity: 'rare', draftWeight: 2,
    blurb: '×2 Mult on any day nobody asks for a payout.',
    mult: ({ requests }) => (requests === 0 ? { times: 2 } : null),
  },
};

// ------------------------------------------------------------------ excuses

export interface ExcuseDef {
  id: string;
  name: string;
  blurb: string;
  draftWeight: number;
  /** Fraud kinds this excuse proves on its own (counts as evidence). */
  proves: FraudKind[];
  /** Stalls instead of denying. */
  stallDays?: number;
  /** Refund the trader instead of a flat denial. */
  refund?: number;
}

export const EXCUSES: Record<string, ExcuseDef> = {
  terms: { id: 'terms', name: 'Breach of Terms', blurb: 'Generic. Works on anyone, convinces no one.', draftWeight: 4, proves: [] },
  kyc: { id: 'kyc', name: 'KYC Mismatch', blurb: 'Proof against Borrowed IDs and bots.', draftWeight: 2, proves: ['kyc', 'bot'] },
  strategy: { id: 'strategy', name: 'Prohibited Strategy', blurb: 'Proof against Hedgers and Copy Rings.', draftWeight: 2, proves: ['hedge', 'copy'] },
  glitch: { id: 'glitch', name: 'Technical Review', blurb: 'Stalls 5 days without a Trust hit. Raises Heat.', draftWeight: 2, proves: [], stallDays: 5 },
  refund: { id: 'refund', name: 'Refund + Apology', blurb: 'Pay back their fee instead. No Trust lost.', draftWeight: 2, proves: [], refund: 120 },
};

export const STARTING_GRID: (string | null)[] = [
  null, null, null, null, null,
  null, 'gambler', 'grinder', 'gambler', null,
  null, 'gambler', 'grinder', 'gambler', null,
  null, null, null, null, null,
];

export const STARTING_EXCUSES = ['terms', 'glitch'];

export function cardDef(id: string): CardDef {
  const def = CARDS[id];
  if (!def) throw new Error(`Unknown card: ${id}`);
  return def;
}

export function excuseDef(id: string): ExcuseDef {
  const def = EXCUSES[id];
  if (!def) throw new Error(`Unknown excuse: ${id}`);
  return def;
}

/** The name a player sees: hidden fraud shows its disguise until revealed. */
export function displayName(card: CardInstance): string {
  const def = cardDef(card.def);
  return !card.revealed && def.disguise ? def.disguise : def.name;
}
