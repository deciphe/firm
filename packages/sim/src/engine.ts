import { CARDS, EXCUSES, STARTING_EXCUSES, STARTING_GRID, cardDef, excuseDef } from './cards.ts';
import type { AuraCtx, NeighborSlot, TraderOutcome } from './cards.ts';
import { makeRng } from './rng.ts';
import type { Rng } from './rng.ts';
import type {
  Action, Candle, CardInstance, CardResult, FeedPost, GameState, Offer, Tone,
} from './types.ts';
import { CANDLES } from './types.ts';

/** Every tunable number in one place, so the balance runner can sweep them. */
export const BALANCE = {
  cols: 5,
  rows: 4,
  startCash: 120,
  startTrust: 3,
  cycleDays: 5,
  payrollStart: 700,
  payrollGrowth: 1.55,
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
  severance: 100,
  baseForecast: { chop: 0.5, up: 0.175, down: 0.175, news: 0.15 } as Record<Candle, number>,
  forecastBump: 0.15,
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

function post(s: GameState, handle: string, text: string, tone: Tone): void {
  const p: FeedPost = { day: s.day, handle, text, tone };
  s.feed.unshift(p);
  if (s.feed.length > 40) s.feed.length = 40;
}

function rollForecast(rng: Rng): Record<Candle, number> {
  const f = { ...BALANCE.baseForecast };
  const bumped = rng.pick(CANDLES);
  f[bumped] += BALANCE.forecastBump;
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

export function valuation(s: GameState): number {
  const recent = s.stats.incomeHistory.slice(-5);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  return Math.max(0, Math.round(s.cash + 15 * avg * (s.trust / 3) - liability(s)));
}

/** Trust 3 = x1.0 fees, 5 = x1.4, 1 = x0.6, 0 = x0.4. */
export function trustMultiplier(trust: number): number {
  return Math.round((0.4 + 0.2 * trust) * 100) / 100;
}

/** Price of an offer. Hidden fraud is priced like the ordinary customer it pretends to be. */
export function offerPrice(o: Offer): number {
  if (o.kind === 'excuse') return BALANCE.prices.excuse ?? 45;
  const def = cardDef(o.id);
  const rarity = def.disguise ? 'common' : def.rarity;
  return BALANCE.prices[rarity] ?? 40;
}

/** Rerolls get pricier each time today (resets every shop). */
export function rerollPrice(s: GameState): number {
  return BALANCE.rerollBase + BALANCE.rerollStep * s.rerolls;
}

// ------------------------------------------------------------------ new run

export function newRun(seed: number): GameState {
  const rng = makeRng(seed);
  const s: GameState = {
    seed,
    rng: 0,
    day: 1,
    phase: 'morning',
    cash: BALANCE.startCash,
    trust: BALANCE.startTrust,
    heat: 0,
    payroll: { amount: BALANCE.payrollStart, dueDay: BALANCE.cycleDays, cycle: 1, loanOwed: 0, loanDueCycle: 0 },
    grid: new Array<CardInstance | null>(SIZE).fill(null),
    nextUid: 1,
    excuses: [...STARTING_EXCUSES],
    queue: [],
    offers: [],
    rerolls: BALANCE.rerollsPerCycle,
    flashSaleCycle: 0,
    forecast: rollForecast(rng),
    lastReport: null,
    feed: [],
    stats: { paid: 0, denied: 0, payoutsPaid: 0, payoutsDenied: 0, stalls: 0, fraudCaught: 0, peakValuation: 0, incomeHistory: [], excuseUses: {} },
    cause: null,
    shortBy: 0,
  };
  STARTING_GRID.forEach((id, i) => { if (id) s.grid[i] = newCard(s, id); });
  s.rng = rng.state();
  s.stats.peakValuation = valuation(s);
  post(s, '@propdrama_wire', 'New firm just opened its doors. Six customers. Bold.', 'neutral');
  return s;
}

// ------------------------------------------------------------------ legality

export function legalActions(s: GameState): Action[] {
  const out: Action[] = [];
  switch (s.phase) {
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
      s.offers.forEach((o, i) => { if (s.cash >= offerPrice(o)) out.push({ type: 'draft', pick: i }); });
      if (s.cash >= rerollPrice(s)) out.push({ type: 'reroll' });
      break;
    case 'dead':
      break;
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
    case 'reroll':
      need(s.phase === 'draft' && s.cash >= rerollPrice(s), 'cannot afford a reroll');
      s.cash -= rerollPrice(s);
      s.rerolls += 1;
      s.offers = rollOffers(s, rng);
      break;
  }
  s.rng = rng.state();
  return s;
}

function need(ok: boolean, why: string): void {
  if (!ok) throw new IllegalAction(why);
}

// ------------------------------------------------------------------ the day

function resolveDay(s: GameState, rng: Rng): void {
  const candle = rng.weighted(CANDLES.map((c) => [c, s.forecast[c]] as const));
  const spawns: { index: number; defId: string }[] = [];
  const reveal = (c: CardInstance): void => { c.revealed = true; };
  const countOnGrid = (id: string): number => s.grid.filter((c) => c?.def === id).length;

  for (const c of s.grid) if (c) c.age += 1;

  const auraCtx = (index: number, card: CardInstance, outcomes: (TraderOutcome | null)[]): AuraCtx => ({
    candle, rng, self: card, selfIndex: index,
    neighbors: neighborsOf(index).map((n): NeighborSlot => ({ index: n, card: s.grid[n] ?? null, outcome: outcomes[n] ?? null })),
    row: rowOf(s.grid, index),
    grid: s.grid,
    spawn: (i, defId) => { if (!s.grid[i] && !spawns.some((sp) => sp.index === i)) spawns.push({ index: i, defId }); },
    reveal,
  });

  const noOutcomes: (TraderOutcome | null)[] = new Array(SIZE).fill(null);
  s.grid.forEach((c, i) => { if (c) cardDef(c.def).preDay?.(auraCtx(i, c, noOutcomes)); });

  const outcomes: (TraderOutcome | null)[] = s.grid.map((c, i) => {
    if (!c) return null;
    const def = cardDef(c.def);
    if (def.kind !== 'trader' || !def.onDay) return null;
    return def.onDay({ candle, rng, card: c, neighbors: neighborsOf(i).map((n) => s.grid[n] ?? null), countOnGrid });
  });
  const baseCash = outcomes.map((o) => o?.cash ?? 0);

  s.grid.forEach((c, i) => { if (c) cardDef(c.def).aura?.(auraCtx(i, c, outcomes)); });

  // Global fee multiplier: customers spend more with a firm they trust; Proof Walls reward honoured payouts.
  const proofWalls = countOnGrid('proofwall');
  const feeMul = trustMultiplier(s.trust) * (1 + 0.04 * s.stats.payoutsPaid * proofWalls);
  s.grid.forEach((c, i) => {
    const o = outcomes[i];
    if (c && o && o.cash > 0) o.cash = Math.round((o.cash + c.bonus) * feeMul);
    if (c && o?.upsell) c.bonus += o.upsell;
  });

  let income = 0;
  let heat = 0;
  const results: CardResult[] = [];
  const requests: number[] = [];
  s.grid.forEach((c, i) => {
    const o = outcomes[i];
    if (!c || !o) return;
    const def = cardDef(c.def);
    income += o.cash;
    heat += o.heat ?? 0;
    c.progress = o.reset ? 0 : Math.max(0, c.progress + o.progress);
    if (def.threshold) {
      c.progress = Math.min(c.progress, def.threshold);
      if (c.progress >= def.threshold && c.stalledUntil <= s.day) requests.push(c.uid);
    }
    results.push({ uid: c.uid, base: baseCash[i] ?? 0, cash: o.cash, progress: o.progress });
  });

  const spawned: number[] = [];
  for (const sp of spawns) {
    const card = newCard(s, sp.defId);
    s.grid[sp.index] = card;
    spawned.push(card.uid);
  }

  const supportCount = countOnGrid('support');
  s.cash += income;
  s.heat = clamp(s.heat + heat - BALANCE.heatDecay - supportCount, 0, BALANCE.maxHeat);
  s.stats.incomeHistory.push(income);

  for (const uid of requests) {
    const found = findCard(s, uid);
    if (!found) continue;
    const def = cardDef(found.card.def);
    const amount = Math.round(((def.payout ?? 0) * (0.85 + rng.next() * 0.3)) / 10) * 10;
    s.queue.push({ uid, amount });
  }

  s.lastReport = { day: s.day, candle, income, results, requests: requests.length, spawned, movedLive: [] };

  if (candle !== 'chop' && requests.length >= 3) {
    post(s, '@thetapewatch', `${candle === 'news' ? 'News spike' : 'Big trend day'}. ${requests.length} payout requests just hit one firm's desk.`, 'neutral');
  }

  if (s.queue.length > 0) s.phase = 'payout';
  else enterDraft(s, rng);
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
    s.trust = clamp(s.trust + (card.def === 'grinder' ? 0.15 : 0.08), 0, BALANCE.maxTrust);
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
    s.trust = clamp(s.trust - 0.05 * card.stalls, 0, BALANCE.maxTrust);
    s.heat = clamp(s.heat + 2, 0, BALANCE.maxHeat);
    if (card.stalls === 2) post(s, '@chartcrime', 'Day 6 of "your payout is processing." Starting to wonder.', 'bad');
  } else if (excuse === undefined) {
    // Ghost them: no excuse, no reply. The worst look a firm can have.
    const heatMul = hasStaff(s, 'lawyer') ? 0.5 : 1;
    s.grid[index] = null;
    s.stats.denied += req.amount;
    s.stats.payoutsDenied += 1;
    s.trust = clamp(s.trust - (def.fraud && card.revealed ? 0.1 : 0.7), 0, BALANCE.maxTrust);
    s.heat = clamp(s.heat + 14 * heatMul, 0, BALANCE.maxHeat);
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
      s.heat = clamp(s.heat + 4 * reuse * heatMul, 0, BALANCE.maxHeat);
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
        s.trust = clamp(s.trust - 0.15 * reuse, 0, BALANCE.maxTrust);
        s.heat = clamp(s.heat + 4 * heatMul, 0, BALANCE.maxHeat);
        post(s, '@chartcrime', `Payout denied for "${ex.name}". No proof posted.`, 'bad');
      } else if (card.def === 'influencer') {
        s.trust = clamp(s.trust - 1.0 * reuse, 0, BALANCE.maxTrust);
        s.heat = clamp(s.heat + 18 * heatMul, 0, BALANCE.maxHeat);
        post(s, '@influencer_ty', 'GOING LIVE IN 10. This firm just denied me. Bring popcorn.', 'bad');
      } else {
        s.trust = clamp(s.trust - 0.6 * reuse, 0, BALANCE.maxTrust);
        s.heat = clamp(s.heat + 10 * heatMul, 0, BALANCE.maxHeat);
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
    let w = def.draftWeight;
    if (def.kind === 'staff') w *= lowTrust ? 0.4 : highTrust ? 1.3 : 1;
    if (def.rarity === 'rare') w *= lowTrust ? 0.3 : highTrust ? 2 : 1;
    if (lowTrust && (def.id === 'botfarm' || def.id === 'chargeback' || def.id === 'hedger')) w *= 2;
    entries.push([{ kind: 'card', id: def.id }, w]);
  }
  for (const ex of Object.values(EXCUSES)) entries.push([{ kind: 'excuse', id: ex.id }, ex.draftWeight]);

  const offers: Offer[] = [];
  let guard = 0;
  while (offers.length < BALANCE.offers && guard++ < 50) {
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
    need(s.cash >= offerPrice(o), 'cannot afford that hire');
    s.cash -= offerPrice(o);
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
          if (existing.def === 'vet') s.trust = clamp(s.trust - 0.2, 0, BALANCE.maxTrust);
        }
        s.grid[target] = newCard(s, o.id);
      }
    }
  }
  s.offers = [];
  endDay(s, rng);
}

// ------------------------------------------------------------------ morning moves

function flashSale(s: GameState, rng: Rng): void {
  s.flashSaleCycle = s.payroll.cycle;
  s.cash += 100 + 100 * s.payroll.cycle;
  const free = emptySlots(s);
  for (let k = 0; k < 3 && free.length > 0; k++) {
    const i = free.splice(rng.int(free.length), 1)[0] as number;
    s.grid[i] = newCard(s, rng.weighted([['hedger', 3], ['ghost', 2], ['chargeback', 2], ['retail', 2]] as const));
  }
  s.trust = clamp(s.trust - 0.25, 0, BALANCE.maxTrust);
  s.heat = clamp(s.heat + 6, 0, BALANCE.maxHeat);
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
    s.payroll.cycle += 1;
    s.payroll.amount = Math.round((s.payroll.amount * BALANCE.payrollGrowth) / 10) * 10;
    s.payroll.dueDay += BALANCE.cycleDays;
    s.rerolls = BALANCE.rerollsPerCycle;
  }
  if (checkDeath(s)) return;
  s.stats.peakValuation = Math.max(s.stats.peakValuation, valuation(s));
  s.day += 1;
  s.forecast = rollForecast(rng);
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
