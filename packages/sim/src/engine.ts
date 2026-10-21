import { CARDS, EXCUSES, STARTING_EXCUSES, STARTING_GRID, cardDef, excuseDef } from './cards.ts';
import type { AuraCtx, NeighborSlot, TraderOutcome } from './cards.ts';
import { makeRng } from './rng.ts';
import { CRISES, CRISIS_EVERY, FOUNDERS, PLANS } from './run.ts';
import type { RunOptions } from './run.ts';
import type { Rng } from './rng.ts';
import type {
  Action, Candle, CardInstance, CardResult, FeedPost, GameState, Offer, ScoreEvent, Tone,
} from './types.ts';
import { CANDLES } from './types.ts';

/** Every tunable number in one place, so the balance runner can sweep them. */
export const BALANCE = {
  cols: 5,
  rows: 4,
  startCash: 120,
  startTrust: 3,
  cycleDays: 5,
  payrollStart: 760,
  payrollGrowth: 1.6,
  maxTrust: 5,
  maxHeat: 100,
  heatDecay: 2,
  handSize: 4,
  offers: 3,
  rerollsPerCycle: 0,
  /** What hiring costs. Every hire competes with payroll. */
  prices: { common: 40, uncommon: 85, rare: 160, excuse: 45 } as Record<string, number>,
  rerollBase: 20,
  rerollStep: 10,
  /** Cost to let anyone go, or to hire over someone. */
  severance: 30,
  baseForecast: { chop: 0.5, up: 0.175, down: 0.175, news: 0.15 } as Record<Candle, number>,
  forecastBump: 0.15,
  /** Trust for honouring a payout (Grinders build more). */
  payTrust: 0.15,
  payTrustGrinder: 0.25,
  /** Flash sale: cash = base + step x cycle, and the Trust it burns. */
  flashBase: 100,
  flashStep: 80,
  flashTrust: 0.3,
  /** Denying a clean trader with an excuse. */
  denyTrust: 0.9,
  denyHeat: 12,
  /** Mult gained or lost per point of Trust away from 3. */
  trustSlope: 0.3,
};

const SIZE = BALANCE.cols * BALANCE.rows;

// ------------------------------------------------------------------ helpers

export function neighborsOf(index: number): number[] {
  const { cols, rows } = BALANCE;
  const r = Math.floor(index / cols);
  const c = index % cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
    }
  }
  return out;
}

function rowOf(grid: (CardInstance | null)[], index: number): (CardInstance | null)[] {
  const r = Math.floor(index / BALANCE.cols);
  return grid.slice(r * BALANCE.cols, r * BALANCE.cols + BALANCE.cols);
}

function newCard(s: GameState, defId: string): CardInstance {
  return { uid: s.nextUid++, def: defId, progress: 0, age: 0, revealed: false, payouts: 0, stalls: 0, stalledUntil: 0, bonus: 0 };
}

export function findCard(s: GameState, uid: number): { card: CardInstance; index: number } | null {
  for (let i = 0; i < s.grid.length; i++) {
    const c = s.grid[i];
    if (c && c.uid === uid) return { card: c, index: i };
  }
  return null;
}

export function emptySlots(s: GameState): number[] {
  const out: number[] = [];
  s.grid.forEach((c, i) => { if (!c) out.push(i); });
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------ run rules (founder, stake, crisis, plan)

const crisisIs = (s: GameState, id: string): boolean => s.crisis === id;

/** Every Heat gain goes through here (the Audit crisis doubles it). */
function addHeat(s: GameState, amount: number): void {
  const mul = amount > 0 && crisisIs(s, 'audit') ? 2 : 1;
  s.heat = clamp(s.heat + amount * mul, 0, BALANCE.maxHeat);
}
/** Every Trust loss goes through here (the Exposé doubles it). */
function loseTrust(s: GameState, amount: number): void {
  s.trust = clamp(s.trust - amount * (crisisIs(s, 'expose') ? 2 : 1), 0, BALANCE.maxTrust);
}
function heatDecay(s: GameState): number {
  return s.stake >= 3 ? BALANCE.heatDecay / 2 : BALANCE.heatDecay;
}
export function payrollGrowth(s: GameState): number {
  return BALANCE.payrollGrowth + (s.stake >= 4 ? 0.1 : 0) + s.dilution;
}
function planPayrollMul(plan: string): number {
  return plan === 'growth' ? 1.2 : plan === 'lean' ? 0.85 : plan === 'fair' ? 1.1 : 1;
}
const round10 = (v: number): number => Math.round(v / 10) * 10;

function post(s: GameState, handle: string, text: string, tone: Tone): void {
  const p: FeedPost = { day: s.day, handle, text, tone };
  s.feed.unshift(p);
  if (s.feed.length > 40) s.feed.length = 40;
}

function rollForecast(rng: Rng, s?: GameState): Record<Candle, number> {
  const f = { ...BALANCE.baseForecast };
  const bumped = rng.pick(CANDLES);
  f[bumped] += BALANCE.forecastBump;
  if (s?.founder === 'quant') f.chop += 0.1;
  if (s && crisisIs(s, 'volatility')) f.chop /= 2;
  const total = CANDLES.reduce((t, c) => t + f[c], 0);
  for (const c of CANDLES) f[c] = Math.round((f[c] / total) * 1000) / 1000;
  return f;
}

function hasStaff(s: GameState, id: string): boolean {
  return s.grid.some((c) => c?.def === id);
}

/** What the funded book could claim right now, weighted by how close each trader is to a payout. */
export function liability(s: GameState): number {
  let total = 0;
  for (const c of s.grid) {
    if (!c) continue;
    const def = cardDef(c.def);
    if (!def.threshold || !def.payout) continue;
    total += (Math.min(c.progress, def.threshold) / def.threshold) * def.payout;
  }
  return Math.round(total);
}

/**
 * What a buyer would pay for the firm (the score): 20 days of recent take scaled by reputation squared, half
 * of everything ever paid to traders (the payout counter sells the firm), a quarter of the cash on hand, less
 * what the funded book could claim. A firm that stiffs everyone is worth less than a smaller honest one.
 */
export function valuation(s: GameState): number {
  const recent = s.stats.incomeHistory.slice(-5);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const rep = (s.trust / 3) ** 2;
  return Math.max(0, Math.round(20 * Math.max(0, avg) * rep + 0.5 * s.stats.paid + 0.25 * s.cash - liability(s)));
}

/** The day's starting mult. Trust 3 = x1.0, 5 = x1.6, 1 = x0.4, 0 = x0.1. */
export function trustMultiplier(trust: number): number {
  return Math.round((1 + BALANCE.trustSlope * (trust - 3)) * 100) / 100;
}

/** Price of an offer. Hidden fraud is priced like the ordinary customer it pretends to be. */
export function offerPrice(o: Offer, s?: GameState): number {
  let base: number;
  if (o.kind === 'excuse') base = BALANCE.prices.excuse ?? 45;
  else {
    const def = cardDef(o.id);
    base = BALANCE.prices[def.disguise ? 'common' : def.rarity] ?? 40;
  }
  if (!s) return base;
  if (s.freeHires > 0) return 0;
  let mul = 1;
  if (crisisIs(s, 'outage')) mul *= 1.5;
  if (s.plan === 'fair') mul *= 0.6;
  if (s.founder === 'closer') mul *= 0.9;
  return Math.round((base * mul) / 5) * 5;
}

/** Rerolls get pricier each time today (resets every shop). */
export function rerollPrice(s: GameState): number {
  return BALANCE.rerollBase + BALANCE.rerollStep * s.rerolls;
}

// ------------------------------------------------------------------ new run

export function newRun(seed: number, opts: RunOptions = {}): GameState {
  const rng = makeRng(seed);
  const founder = FOUNDERS[opts.founder ?? 'founder'] ?? (FOUNDERS.founder as NonNullable<typeof FOUNDERS.founder>);
  const stake = clamp(Math.round(opts.stake ?? 1), 1, 5);
  const payrollStart = round10(BALANCE.payrollStart * (stake >= 2 ? 1.15 : 1));
  const s: GameState = {
    seed,
    rng: 0,
    day: 1,
    phase: 'morning',
    cash: Math.round((BALANCE.startCash + founder.cash) * (stake >= 5 ? 0.5 : 1)),
    trust: clamp(BALANCE.startTrust + founder.trust, 0, BALANCE.maxTrust),
    heat: founder.heat,
    payroll: { amount: payrollStart, base: payrollStart, dueDay: BALANCE.cycleDays, cycle: 1, loanOwed: 0, loanDueCycle: 0 },
    grid: new Array<CardInstance | null>(SIZE).fill(null),
    nextUid: 1,
    excuses: [...(founder.excuses ?? STARTING_EXCUSES)],
    queue: [],
    offers: [],
    rerolls: BALANCE.rerollsPerCycle,
    flashSaleCycle: 0,
    forecast: BALANCE.baseForecast,
    lastReport: null,
    feed: [],
    stats: { paid: 0, denied: 0, payoutsPaid: 0, payoutsDenied: 0, stalls: 0, fraudCaught: 0, peakValuation: 0, incomeHistory: [], excuseUses: {}, crisesSurvived: 0 },
    cause: null,
    shortBy: 0,
    founder: founder.id,
    stake,
    crisis: null,
    nextCrisis: rng.pick(Object.keys(CRISES)),
    crisisCycle: CRISIS_EVERY,
    plan: 'steady',
    plans: [],
    freeHires: 0,
    dilution: 0,
  };
  s.forecast = rollForecast(rng, s);
  STARTING_GRID.forEach((id, i) => { if (id) s.grid[i] = newCard(s, id); });
  for (const [i, id] of founder.place) s.grid[i] = newCard(s, id);
  s.rng = rng.state();
  s.stats.peakValuation = valuation(s);
  post(s, '@propdrama_wire', 'New firm just opened its doors. Six customers. Bold.', 'neutral');
  return s;
}

// ------------------------------------------------------------------ legality

export function legalActions(s: GameState): Action[] {
  const out: Action[] = [];
  switch (s.phase) {
    case 'quarter':
      for (const id of s.plans) if (id !== 'pr' || s.cash >= planCost(s, id)) out.push({ type: 'plan', id });
      break;
    case 'morning':
      out.push({ type: 'tap' });
      if (s.flashSaleCycle !== s.payroll.cycle) out.push({ type: 'flashSale' });
      if (s.payroll.loanOwed === 0) out.push({ type: 'loan' });
      break;
    case 'payout': {
      const req = s.queue[0];
      if (!req) break;
      if (s.cash >= req.amount) out.push({ type: 'payout', decision: 'pay' });
      const found = findCard(s, req.uid);
      if (found && found.card.stalls < 2) out.push({ type: 'payout', decision: 'stall' });
      for (const ex of new Set(s.excuses)) out.push({ type: 'payout', decision: 'deny', excuse: ex });
      out.push({ type: 'payout', decision: 'deny' }); // ghost them: always possible, always painful
      break;
    }
    case 'draft':
      out.push({ type: 'draft', pick: null });
      s.offers.forEach((o, i) => { if (s.cash >= offerPrice(o, s)) out.push({ type: 'draft', pick: i }); });
      if (s.cash >= rerollPrice(s)) out.push({ type: 'reroll' });
      break;
    case 'dead':
      break;
  }
  if ((s.phase === 'morning' || s.phase === 'draft') && s.cash >= BALANCE.severance) {
    s.grid.forEach((c, i) => { if (c) out.push({ type: 'release', slot: i }); });
  }
  return out;
}

export class IllegalAction extends Error {}

// ------------------------------------------------------------------ step

export function step(prev: GameState, action: Action): GameState {
  const s: GameState = structuredClone(prev);
  const rng = makeRng(s.rng);
  switch (action.type) {
    case 'tap':
      need(s.phase === 'morning', 'tap only in the morning');
      resolveDay(s, rng);
      break;
    case 'flashSale':
      need(s.phase === 'morning' && s.flashSaleCycle !== s.payroll.cycle, 'one flash sale per payroll cycle');
      flashSale(s, rng);
      break;
    case 'loan':
      need(s.phase === 'morning' && s.payroll.loanOwed === 0, 'one loan at a time');
      takeLoan(s);
      break;
    case 'payout':
      need(s.phase === 'payout' && s.queue.length > 0, 'no payout pending');
      decidePayout(s, rng, action.decision, action.excuse);
      break;
    case 'draft':
      need(s.phase === 'draft', 'not drafting');
      draft(s, rng, action.pick, action.slot);
      break;
    case 'plan':
      need(s.phase === 'quarter' && s.plans.includes(action.id), 'no such plan');
      choosePlan(s, action.id);
      break;
    case 'reroll':
      need(s.phase === 'draft' && s.cash >= rerollPrice(s), 'cannot afford a reroll');
      s.cash -= rerollPrice(s);
      s.rerolls += 1;
      s.offers = rollOffers(s, rng);
      break;
    case 'release':
      need(s.phase === 'morning' || s.phase === 'draft', 'let people go in the morning or while hiring');
      release(s, action.slot);
      break;
  }
  s.rng = rng.state();
  return s;
}

function need(ok: boolean, why: string): void {
  if (!ok) throw new IllegalAction(why);
}

// ------------------------------------------------------------------ the day

/** Everything one day of scoring produces, before it is applied to the run. */
export interface DayScore {
  outcomes: (TraderOutcome | null)[];
  results: CardResult[];
  events: ScoreEvent[];
  fees: number;
  clawback: number;
  baseMult: number;
  mult: number;
  take: number;
  heat: number;
  /** uids that reached their payout threshold today (and are not stalled). */
  requests: number[];
  spawns: { index: number; defId: string }[];
}

/**
 * Score one day on a grid: traders pay fees in reading order, then every card with a mult effect fires in
 * reading order. Take = fees x mult - clawbacks. Mutates the grid's cards (progress, reveals, upsell
 * bonuses), so previews pass a copy.
 */
export function scoreDay(s: GameState, grid: (CardInstance | null)[], candle: Candle, rng: Rng): DayScore {
  const spawns: { index: number; defId: string }[] = [];
  const reveal = (c: CardInstance): void => { c.revealed = true; };
  const countOnGrid = (id: string): number => grid.filter((c) => c?.def === id).length;
  const slots = (index: number, outcomes: (TraderOutcome | null)[]): NeighborSlot[] =>
    neighborsOf(index).map((n): NeighborSlot => ({ index: n, card: grid[n] ?? null, outcome: outcomes[n] ?? null }));
  const auraCtx = (index: number, card: CardInstance, outcomes: (TraderOutcome | null)[]): AuraCtx => ({
    candle, rng, self: card, selfIndex: index,
    neighbors: slots(index, outcomes),
    row: rowOf(grid, index),
    grid,
    spawn: (i, defId) => { if (!grid[i] && !spawns.some((sp) => sp.index === i)) spawns.push({ index: i, defId }); },
    reveal,
  });

  const noOutcomes: (TraderOutcome | null)[] = new Array(SIZE).fill(null);
  grid.forEach((c, i) => { if (c) cardDef(c.def).preDay?.(auraCtx(i, c, noOutcomes)); });

  const outcomes: (TraderOutcome | null)[] = grid.map((c, i) => {
    if (!c) return null;
    const def = cardDef(c.def);
    if (def.kind !== 'trader' || !def.onDay) return null;
    return def.onDay({ candle, rng, card: c, neighbors: neighborsOf(i).map((n) => grid[n] ?? null), countOnGrid });
  });
  const baseCash = outcomes.map((o) => o?.cash ?? 0);
  grid.forEach((c, i) => { if (c) cardDef(c.def).aura?.(auraCtx(i, c, outcomes)); });

  const feeMul = crisisIs(s, 'pricewar') ? 0.75 : 1;
  let heat = 0;
  const requests: number[] = [];
  const results: CardResult[] = [];
  grid.forEach((c, i) => {
    const o = outcomes[i];
    if (!c || !o) return;
    const def = cardDef(c.def);
    if (o.cash > 0) o.cash = Math.round((o.cash + c.bonus) * feeMul);
    if (o.upsell) c.bonus += o.upsell;
    heat += o.heat ?? 0;
    if (crisisIs(s, 'bankrun') && candle !== 'chop' && o.progress > 0) o.progress += 1;
    c.progress = o.reset ? 0 : Math.max(0, c.progress + o.progress);
    if (def.threshold) {
      c.progress = Math.min(c.progress, def.threshold);
      if (c.progress >= def.threshold && c.stalledUntil <= s.day) requests.push(c.uid);
    }
    results.push({ uid: c.uid, base: baseCash[i] ?? 0, cash: o.cash, progress: o.progress });
  });

  // The scoring sequence: every fee first, then every mult.
  const baseMult = trustMultiplier(s.trust);
  const events: ScoreEvent[] = [];
  let fees = 0, clawback = 0, mult = baseMult;
  grid.forEach((c, i) => {
    const o = outcomes[i];
    if (!c || !o || o.cash === 0) return;
    if (o.cash > 0) fees += o.cash; else clawback += o.cash;
    events.push({ uid: c.uid, fees: o.cash, totalFees: fees, mult });
  });
  grid.forEach((c, i) => {
    if (!c) return;
    const fx = cardDef(c.def).mult?.({
      candle, self: c, selfIndex: i, neighbors: slots(i, outcomes), grid, outcomes, requests: requests.length, payoutsPaid: s.stats.payoutsPaid,
    });
    if (!fx || (!fx.add && (fx.times ?? 1) === 1)) return;
    if (fx.add) mult += fx.add;
    if (fx.times) mult *= fx.times;
    mult = Math.round(mult * 100) / 100;
    events.push({ uid: c.uid, ...(fx.add ? { add: fx.add } : {}), ...(fx.times ? { times: fx.times } : {}), totalFees: fees, mult });
  });
  const take = Math.round(fees * mult) + clawback;
  return { outcomes, results, events, fees, clawback, baseMult, mult, take, heat, requests, spawns };
}

function resolveDay(s: GameState, rng: Rng): void {
  const candle = rng.weighted(CANDLES.map((c) => [c, s.forecast[c]] as const));
  for (const c of s.grid) if (c) c.age += 1;
  const day = scoreDay(s, s.grid, candle, rng);

  const spawned: number[] = [];
  for (const sp of day.spawns) {
    const card = newCard(s, sp.defId);
    s.grid[sp.index] = card;
    spawned.push(card.uid);
  }

  const supportCount = s.grid.filter((c) => c?.def === 'support').length;
  s.cash += day.take;
  addHeat(s, day.heat);
  s.heat = clamp(s.heat - heatDecay(s) - supportCount, 0, BALANCE.maxHeat);
  s.stats.incomeHistory.push(day.take);

  for (const uid of day.requests) {
    const found = findCard(s, uid);
    if (!found) continue;
    const def = cardDef(found.card.def);
    const amount = Math.round(((def.payout ?? 0) * (0.85 + rng.next() * 0.3)) / 10) * 10;
    s.queue.push({ uid, amount });
  }

  s.lastReport = {
    day: s.day, candle, income: day.take, fees: day.fees, clawback: day.clawback, baseMult: day.baseMult, mult: day.mult,
    events: day.events, results: day.results, requests: day.requests.length, spawned, movedLive: [],
  };

  if (candle !== 'chop' && day.requests.length >= 3) {
    post(s, '@thetapewatch', `${candle === 'news' ? 'News spike' : 'Big trend day'}. ${day.requests.length} payout requests just hit one firm's desk.`, 'neutral');
  }

  if (s.queue.length > 0) s.phase = 'payout';
  else enterDraft(s, rng);
}

/**
 * What a grid is expected to take in a day, averaged over the standard candle odds. Pure: works on copies
 * with a fixed RNG, so previews and bots see the same number every time.
 */
export function expectedTake(s: GameState, grid: (CardInstance | null)[] = s.grid): number {
  let total = 0;
  for (const candle of CANDLES) {
    const copy = grid.map((c) => (c ? { ...c } : null));
    total += BALANCE.baseForecast[candle] * scoreDay(s, copy, candle, makeRng(0x5eed)).take;
  }
  return Math.round(total);
}

/** Expected daily take if `defId` were placed at `slot` (replacing whatever is there). */
export function previewPlacement(s: GameState, defId: string, slot: number): number {
  const grid = s.grid.map((c) => (c ? { ...c } : null));
  grid[slot] = { uid: -1, def: defId, progress: 0, age: 0, revealed: false, payouts: 0, stalls: 0, stalledUntil: 0, bonus: 0 };
  return expectedTake(s, grid);
}

// ------------------------------------------------------------------ payouts

function decidePayout(s: GameState, rng: Rng, decision: 'pay' | 'stall' | 'deny', excuse?: string): void {
  const req = s.queue[0];
  if (!req) throw new IllegalAction('no payout pending');
  const found = findCard(s, req.uid);
  if (!found) {
    s.queue.shift();
    afterPayout(s, rng);
    return;
  }
  const { card, index } = found;
  const def = cardDef(card.def);

  if (decision === 'pay') {
    need(s.cash >= req.amount, 'not enough cash to pay');
    s.cash -= req.amount;
    s.stats.paid += req.amount;
    s.stats.payoutsPaid += 1;
    s.trust = clamp(s.trust + (card.def === 'grinder' ? BALANCE.payTrustGrinder : BALANCE.payTrust), 0, BALANCE.maxTrust);
    post(s, rng.pick(['@fundedfrank', '@grind_guy', '@nq_nate']), `Got paid $${req.amount.toLocaleString('en-US')} today. Firm actually pays.`, 'good');
    if (card.def === 'vet') {
      card.payouts += 1;
      card.progress = 0;
      card.stalls = 0;
      if (card.payouts >= 3) {
        s.grid[index] = null;
        s.lastReport?.movedLive.push(card.uid);
        post(s, '@propdrama_wire', 'A funded trader just graduated to a live account. Respect.', 'good');
      }
    } else {
      s.grid[index] = { ...card, def: 'vet', payouts: 1, progress: 0, stalls: 0, revealed: true };
    }
  } else if (decision === 'stall') {
    need(card.stalls < 2, 'cannot stall the same trader again');
    card.stalls += 1;
    card.stalledUntil = s.day + 3;
    s.stats.stalls += 1;
    loseTrust(s, 0.05 * card.stalls);
    addHeat(s, 2);
    if (card.stalls === 2) post(s, '@chartcrime', 'Day 6 of "your payout is processing." Starting to wonder.', 'bad');
  } else if (excuse === undefined) {
    // Ghost them: no excuse, no reply. The worst look a firm can have.
    const heatMul = hasStaff(s, 'lawyer') ? 0.5 : 1;
    s.grid[index] = null;
    s.stats.denied += req.amount;
    s.stats.payoutsDenied += 1;
    loseTrust(s, (def.fraud && card.revealed ? 0.1 : 0.7) * (s.founder === 'saint' ? 2 : 1));
    addHeat(s, 14 * heatMul);
    post(s, rng.pick(['@fundedfrank', '@nq_nate', '@chartcrime']), `Payout request ignored. Account closed. No email, nothing.`, 'bad');
  } else {
    need(s.excuses.includes(excuse), 'no such excuse in hand');
    const ex = excuseDef(excuse);
    s.excuses.splice(s.excuses.indexOf(ex.id), 1);
    const uses = s.stats.excuseUses[ex.id] ?? 0;
    s.stats.excuseUses[ex.id] = uses + 1;
    const reuse = 1 + 0.5 * uses;
    const heatMul = hasStaff(s, 'lawyer') ? 0.5 : 1;

    if (ex.stallDays) {
      card.stalledUntil = s.day + ex.stallDays;
      addHeat(s, 4 * reuse * heatMul);
      post(s, '@propdrama_wire', '"Technical review" again. Everyone knows what that means.', 'bad');
    } else if (ex.refund) {
      s.cash -= ex.refund;
      s.grid[index] = null;
      s.stats.denied += req.amount;
      s.stats.payoutsDenied += 1;
      post(s, '@grind_guy', 'They refunded my fee and said sorry. Weird but fair, I guess.', 'neutral');
    } else {
      const evidence = card.revealed || (def.fraud !== undefined && ex.proves.includes(def.fraud));
      s.grid[index] = null;
      s.stats.denied += req.amount;
      s.stats.payoutsDenied += 1;
      if (def.fraud && evidence) {
        s.stats.fraudCaught += 1;
        s.trust = clamp(s.trust + 0.05, 0, BALANCE.maxTrust);
        s.heat = clamp(s.heat - 3, 0, BALANCE.maxHeat);
        post(s, '@thetapewatch', `Firm caught a ${def.name.toLowerCase()} and showed receipts. Clean.`, 'good');
      } else if (def.fraud) {
        loseTrust(s, 0.15 * reuse);
        addHeat(s, 4 * heatMul);
        post(s, '@chartcrime', `Payout denied for "${ex.name}". No proof posted.`, 'bad');
      } else if (card.def === 'influencer') {
        loseTrust(s, 1.0 * reuse);
        addHeat(s, 18 * heatMul);
        post(s, '@influencer_ty', 'GOING LIVE IN 10. This firm just denied me. Bring popcorn.', 'bad');
      } else {
        loseTrust(s, BALANCE.denyTrust * reuse);
        addHeat(s, BALANCE.denyHeat * heatMul);
        post(s, rng.pick(['@fundedfrank', '@nq_nate', '@grind_guy']), `Denied $${req.amount.toLocaleString('en-US')} for "${ex.name}". I followed every rule.`, 'bad');
      }
    }
  }

  s.queue.shift();
  afterPayout(s, rng);
}

function afterPayout(s: GameState, rng: Rng): void {
  if (checkDeath(s)) return;
  if (s.queue.length === 0) enterDraft(s, rng);
}

// ------------------------------------------------------------------ draft

function enterDraft(s: GameState, rng: Rng): void {
  s.phase = 'draft';
  s.rerolls = 0;
  s.offers = rollOffers(s, rng);
}

export function rollOffers(s: GameState, rng: Rng): Offer[] {
  const lowTrust = s.trust < 1.5;
  const highTrust = s.trust >= 4;
  const entries: (readonly [Offer, number])[] = [];
  for (const def of Object.values(CARDS)) {
    if (def.draftWeight <= 0) continue;
    // Rares are one of a kind: never offered while one is already on the book.
    if (def.rarity === 'rare' && s.grid.some((c) => c?.def === def.id)) continue;
    let w = def.draftWeight;
    if (def.kind === 'staff') w *= lowTrust ? 0.4 : highTrust ? 1.3 : 1;
    if (def.rarity === 'rare') w *= lowTrust ? 0.3 : highTrust ? 2 : 1;
    if (lowTrust && (def.id === 'botfarm' || def.id === 'chargeback' || def.id === 'hedger')) w *= 2;
    entries.push([{ kind: 'card', id: def.id }, w]);
  }
  for (const ex of Object.values(EXCUSES)) entries.push([{ kind: 'excuse', id: ex.id }, ex.draftWeight]);

  const offers: Offer[] = [];
  let guard = 0;
  const count = s.plan === 'lean' ? 2 : BALANCE.offers;
  while (offers.length < count && guard++ < 50) {
    const o = rng.weighted(entries);
    if (!offers.some((x) => x.kind === o.kind && x.id === o.id)) offers.push(o);
  }
  return offers;
}

function draft(s: GameState, rng: Rng, pick: number | null, slot?: number): void {
  if (pick !== null) {
    const offer = s.offers[pick];
    need(offer !== undefined, 'no such offer');
    const o = offer as Offer;
    const price = offerPrice(o, s);
    need(s.cash >= price, 'cannot afford that hire');
    s.cash -= price;
    if (s.freeHires > 0) s.freeHires -= 1;
    if (o.kind === 'excuse') {
      s.excuses.push(o.id);
      if (s.excuses.length > BALANCE.handSize) s.excuses.shift();
    } else if (o.id === 'botfarm') {
      const free = emptySlots(s);
      for (let k = 0; k < 3 && free.length > 0; k++) {
        const i = free.splice(rng.int(free.length), 1)[0] as number;
        s.grid[i] = newCard(s, 'bot');
      }
    } else {
      let target = slot;
      if (target === undefined) target = emptySlots(s)[0];
      if (target !== undefined) {
        need(target >= 0 && target < SIZE, 'slot out of range');
        const existing = s.grid[target];
        if (existing) {
          s.cash -= BALANCE.severance;
          if (existing.def === 'vet') loseTrust(s, 0.2);
        }
        s.grid[target] = newCard(s, o.id);
      }
    }
  }
  s.offers = [];
  endDay(s, rng);
}

/** Let someone go: severance, and closing a funded account is noticed. */
function release(s: GameState, slot: number): void {
  const c = s.grid[slot];
  need(!!c, 'nobody in that slot');
  need(s.cash >= BALANCE.severance, 'cannot afford severance');
  s.cash -= BALANCE.severance;
  s.grid[slot] = null;
  s.queue = s.queue.filter((q) => q.uid !== c?.uid);
  if (c?.def === 'vet') {
    loseTrust(s, 0.2);
    post(s, '@chartcrime', 'Funded account closed out of nowhere. Seen this before.', 'bad');
  }
}

// ------------------------------------------------------------------ morning moves

function flashSale(s: GameState, rng: Rng): void {
  s.flashSaleCycle = s.payroll.cycle;
  s.cash += Math.round((BALANCE.flashBase + BALANCE.flashStep * s.payroll.cycle) * (s.founder === 'hustler' ? 1.5 : 1));
  const free = emptySlots(s);
  for (let k = 0; k < 3 && free.length > 0; k++) {
    const i = free.splice(rng.int(free.length), 1)[0] as number;
    s.grid[i] = newCard(s, rng.weighted([['bot', 4], ['hedger', 3], ['chargeback', 2], ['ghost', 1]] as const));
  }
  loseTrust(s, BALANCE.flashTrust);
  addHeat(s, 6);
  post(s, '@propdrama_wire', '90% OFF everything. Somebody needs cash fast.', 'neutral');
}

function takeLoan(s: GameState): void {
  s.cash += s.payroll.amount;
  s.payroll.loanOwed = Math.round(s.payroll.amount * 1.6);
  s.payroll.loanDueCycle = s.payroll.cycle + 1;
}

// ------------------------------------------------------------------ end of day

function endDay(s: GameState, rng: Rng): void {
  if (s.day >= s.payroll.dueDay) {
    const loanDue = s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0;
    const due = s.payroll.amount + loanDue;
    if (s.cash < due) {
      s.shortBy = due - s.cash;
      die(s, 'payroll');
      return;
    }
    s.cash -= due;
    if (loanDue > 0) s.payroll.loanOwed = 0;
    if (s.crisis) {
      s.stats.crisesSurvived += 1;
      s.trust = clamp(s.trust + 0.3, 0, BALANCE.maxTrust);
      post(s, '@thetapewatch', `${CRISES[s.crisis]?.name ?? 'Crisis'} over and this firm is still standing. Respect.`, 'good');
    }
    s.payroll.cycle += 1;
    s.payroll.base = round10(s.payroll.base * payrollGrowth(s));
    s.payroll.amount = s.payroll.base;
    s.payroll.dueDay += BALANCE.cycleDays;
    s.rerolls = BALANCE.rerollsPerCycle;
    s.plan = 'steady';
    s.freeHires = 0;
    s.crisis = null;
    if (s.payroll.cycle === s.crisisCycle) {
      s.crisis = s.nextCrisis;
      s.crisisCycle += CRISIS_EVERY;
      const others = Object.keys(CRISES).filter((id) => id !== s.crisis);
      s.nextCrisis = rng.pick(others);
      post(s, '@propdrama_wire', `Crisis: ${CRISES[s.crisis]?.name ?? s.crisis}. Every firm is sweating.`, 'bad');
    }
    if (checkDeath(s)) return;
    s.stats.peakValuation = Math.max(s.stats.peakValuation, valuation(s));
    s.day += 1;
    s.forecast = rollForecast(rng, s);
    const pool = Object.keys(PLANS).filter((id) => id !== 'steady');
    const a = pool.splice(rng.int(pool.length), 1)[0] as string;
    const b = pool.splice(rng.int(pool.length), 1)[0] as string;
    s.plans = ['steady', a, b];
    s.phase = 'quarter';
    return;
  }
  if (checkDeath(s)) return;
  s.stats.peakValuation = Math.max(s.stats.peakValuation, valuation(s));
  s.day += 1;
  s.forecast = rollForecast(rng, s);
  s.phase = 'morning';
}

/** What a plan costs up front (only the PR Blitz costs cash). */
export function planCost(s: GameState, id: string): number {
  return id === 'pr' ? round10(s.payroll.base * 0.25) : 0;
}

function choosePlan(s: GameState, id: string): void {
  need(id !== 'pr' || s.cash >= planCost(s, id), 'cannot afford the PR blitz');
  s.plan = id;
  s.payroll.amount = round10(s.payroll.base * planPayrollMul(id));
  if (id === 'growth') s.freeHires = 1;
  if (id === 'raise') { s.cash += round10(s.payroll.base * 0.5); s.dilution += 0.08; }
  if (id === 'pr') {
    s.cash -= planCost(s, id);
    s.heat = clamp(s.heat - 20, 0, BALANCE.maxHeat);
    s.trust = clamp(s.trust + 0.3, 0, BALANCE.maxTrust);
  }
  s.plans = [];
  s.phase = 'morning';
}

function checkDeath(s: GameState): boolean {
  if (s.trust <= 0) { die(s, 'trust'); return true; }
  if (s.heat >= BALANCE.maxHeat) { die(s, 'heat'); return true; }
  return false;
}

function die(s: GameState, cause: 'payroll' | 'trust' | 'heat'): void {
  s.phase = 'dead';
  s.cause = cause;
  s.stats.peakValuation = Math.max(s.stats.peakValuation, valuation(s));
  const line = cause === 'payroll'
    ? `Firm missed payroll by $${s.shortBy.toLocaleString('en-US')}. Doors closed.`
    : cause === 'trust' ? 'Nobody trusts them anymore. Sales just stopped.' : 'Regulators walked in this morning.';
  post(s, '@propdrama_wire', line, 'bad');
}
