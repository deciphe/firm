import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BALANCE, CARDS, IllegalAction, expectedTake, makeRng, rollOffers, findCard, legalActions, newRun, offerPrice, previewPlacement, step, valuation,
} from '../src/index.ts';
import type { Candle, CardInstance, GameState } from '../src/index.ts';

// ---------------------------------------------------------------- helpers

function card(uid: number, def: string, extra: Partial<CardInstance> = {}): CardInstance {
  return { uid, def, progress: 0, age: 0, revealed: false, payouts: 0, stalls: 0, stalledUntil: 0, bonus: 0, ...extra };
}

/** A run with a hand-built grid and a forced candle for the next tap. */
function setup(cells: Record<number, string | CardInstance>, candle: Candle = 'chop', seed = 7): GameState {
  const s = newRun(seed);
  s.grid = new Array(BALANCE.cols * BALANCE.rows).fill(null);
  let uid = 100;
  for (const [i, v] of Object.entries(cells)) s.grid[Number(i)] = typeof v === 'string' ? card(uid++, v) : v;
  s.nextUid = 1000;
  s.forecast = { chop: 0, up: 0, down: 0, news: 0, [candle]: 1 };
  return s;
}

const tap = (s: GameState): GameState => step(s, { type: 'tap' });
const incomeOf = (s: GameState, uid: number): number => s.lastReport?.results.find((r) => r.uid === uid)?.cash ?? NaN;

// ---------------------------------------------------------------- core rules

test('a new run starts with six traders, a little cash and two excuses', () => {
  const s = newRun(1);
  assert.equal(s.grid.filter(Boolean).length, 6);
  assert.equal(s.cash, BALANCE.startCash);
  assert.equal(s.excuses.length, 2);
  assert.equal(s.phase, 'morning');
});

test('same seed and same actions produce the same run', () => {
  const play = (): GameState => {
    let s = newRun(42);
    for (let k = 0; k < 60 && s.phase !== 'dead'; k++) {
      const a = legalActions(s).find((x) => x.type !== 'flashSale' && x.type !== 'loan' && x.type !== 'reroll');
      if (!a) break;
      s = step(s, a);
    }
    return s;
  };
  assert.deepEqual(play(), play());
});

test('step never mutates the previous state', () => {
  const s = newRun(3);
  const before = JSON.stringify(s);
  tap(s);
  assert.equal(JSON.stringify(s), before);
});

test('hiring costs money by rarity and you cannot overspend', () => {
  let s = tap(setup({}, 'chop'));
  s.cash = 100;
  s.offers = [{ kind: 'card', id: 'gambler' }, { kind: 'card', id: 'whale' }, { kind: 'excuse', id: 'kyc' }];
  const picks = legalActions(s).filter((a) => a.type === 'draft' && a.pick !== null).map((a) => (a as { pick: number }).pick);
  assert.deepEqual(picks, [0, 2]);
  assert.throws(() => step(s, { type: 'draft', pick: 1 }), IllegalAction);
  s = step(s, { type: 'draft', pick: 0, slot: 0 });
  assert.equal(s.cash, 100 - BALANCE.prices.common!);
});

test('rerolls get more expensive each time in the same shop', () => {
  let s = tap(setup({}, 'chop'));
  s.cash = 1000;
  s = step(s, { type: 'reroll' });
  s = step(s, { type: 'reroll' });
  assert.equal(s.cash, 1000 - BALANCE.rerollBase - (BALANCE.rerollBase + BALANCE.rerollStep));
});

test('hidden fraud is priced like an ordinary customer', () => {
  assert.equal(offerPrice({ kind: 'card', id: 'hedger' }), BALANCE.prices.common);
  assert.equal(offerPrice({ kind: 'card', id: 'cro' }), BALANCE.prices.rare);
});

test('the Payout Desk always has a way out, even broke with no excuses', () => {
  const s = tap(setup({ 0: card(100, 'whale', { progress: 10, stalls: 2 }) }, 'chop'));
  s.cash = 0;
  s.excuses = [];
  const moves = legalActions(s);
  assert.deepEqual(moves, [{ type: 'payout', decision: 'deny' }]);
  const after = step(s, moves[0]!);
  assert.ok(after.trust < BALANCE.startTrust - 0.5);
});

test('illegal actions throw', () => {
  const s = newRun(3);
  assert.throws(() => step(s, { type: 'draft', pick: 0 }), IllegalAction);
  assert.throws(() => step(s, { type: 'payout', decision: 'pay' }), IllegalAction);
});

test('missing payroll ends the run and records how short you were', () => {
  let s = setup({}, 'chop');
  s.cash = 100;
  s.day = BALANCE.cycleDays;
  s.payroll.dueDay = BALANCE.cycleDays;
  s = tap(s);
  s = step(s, { type: 'draft', pick: null });
  assert.equal(s.phase, 'dead');
  assert.equal(s.cause, 'payroll');
  assert.equal(s.shortBy, BALANCE.payrollStart - 100);
});

test('paying payroll grows the next bill and moves the due day', () => {
  let s = setup({}, 'chop');
  s.cash = 5000;
  s.day = BALANCE.cycleDays;
  s.payroll.dueDay = BALANCE.cycleDays;
  s = tap(s);
  s = step(s, { type: 'draft', pick: null });
  assert.equal(s.cash, 5000 - BALANCE.payrollStart);
  assert.equal(s.payroll.amount, Math.round((BALANCE.payrollStart * BALANCE.payrollGrowth) / 10) * 10);
  assert.equal(s.payroll.dueDay, BALANCE.cycleDays * 2);
  assert.equal(s.day, BALANCE.cycleDays + 1);
});

test('a loan is repaid with interest at the following payroll', () => {
  let s = setup({}, 'chop');
  s.cash = 10000;
  s = step(s, { type: 'loan' });
  assert.equal(s.cash, 10000 + BALANCE.payrollStart);
  assert.equal(s.payroll.loanOwed, BALANCE.payrollStart * 1.6);
});

test('a flash sale brings cash and three disguised customers, once per cycle', () => {
  let s = setup({ 0: 'gambler' }, 'chop');
  const cash = s.cash;
  s = step(s, { type: 'flashSale' });
  assert.equal(s.cash, cash + BALANCE.flashBase + BALANCE.flashStep);
  assert.equal(s.grid.filter(Boolean).length, 4);
  assert.ok(s.trust < BALANCE.startTrust);
  assert.throws(() => step(s, { type: 'flashSale' }), IllegalAction);
});

test('valuation is recent take scaled by reputation, plus payouts honoured, plus some cash, less liability', () => {
  const s = setup({ 0: card(1, 'grinder', { progress: 5 }) });
  s.cash = 1000;
  s.stats.paid = 600;
  s.stats.incomeHistory = [100, 100, 100, 100, 100];
  assert.equal(valuation(s), 2000 + 300 + 250 - 150);
  s.trust = 1.5;
  assert.equal(valuation(s), 500 + 300 + 250 - 150);
});

test('an honest firm is worth more than a richer one that stiffs its traders', () => {
  const honest = setup({});
  honest.cash = 500; honest.trust = 4; honest.stats.paid = 3000; honest.stats.incomeHistory = [300, 300, 300, 300, 300];
  const stiff = setup({});
  stiff.cash = 3500; stiff.trust = 1.5; stiff.stats.paid = 0; stiff.stats.incomeHistory = [300, 300, 300, 300, 300];
  assert.ok(valuation(honest) > valuation(stiff));
});

// ---------------------------------------------------------------- traders

test('Gambler pays most on news and chop', () => {
  assert.equal(incomeOf(tap(setup({ 0: 'gambler' }, 'chop')), 100), 30);
  assert.equal(incomeOf(tap(setup({ 0: 'gambler' }, 'news')), 100), 40);
});

test('Grinder pays steadily and progresses faster on trends', () => {
  const chop = tap(setup({ 0: 'grinder' }, 'chop'));
  const up = tap(setup({ 0: 'grinder' }, 'up'));
  assert.equal(incomeOf(chop, 100), 12);
  assert.equal(findCard(chop, 100)?.card.progress, 1);
  assert.equal(findCard(up, 100)?.card.progress, 2);
});

test('Scalper progresses on chop and blows up on a trend', () => {
  const s = setup({ 0: card(100, 'scalper', { progress: 6 }) }, 'up');
  const after = tap(s);
  assert.equal(findCard(after, 100)?.card.progress, 0);
  assert.equal(incomeOf(after, 100), 28);
});

test('Trend Bro rebuys on chop and rips on trends', () => {
  assert.equal(incomeOf(tap(setup({ 0: 'trendbro' }, 'chop')), 100), 38);
  assert.equal(findCard(tap(setup({ 0: 'trendbro' }, 'down')), 100)?.card.progress, 3);
});

test('Copy Rings progress faster the more of them there are', () => {
  const one = tap(setup({ 0: 'copyring' }, 'up'));
  const three = tap(setup({ 0: 'copyring', 2: 'copyring', 4: 'copyring' }, 'up'));
  assert.equal(findCard(one, 100)?.card.progress, 2);
  assert.equal(findCard(three, 100)?.card.progress, 4);
});

test('Hedgers next to each other progress every day', () => {
  const paired = tap(setup({ 0: 'hedger', 1: 'hedger' }, 'chop'));
  assert.equal(findCard(paired, 100)?.card.progress, 2);
  assert.equal(incomeOf(paired, 100), 13);
});

test('Borrowed ID races toward payout', () => {
  assert.equal(findCard(tap(setup({ 0: 'ghost' }, 'up')), 100)?.card.progress, 3);
});

test('Chargeback Artist claws money back on news days and adds Heat', () => {
  const s = tap(setup({ 0: 'chargeback' }, 'news'));
  assert.equal(incomeOf(s, 100), -70);
  assert.equal(s.heat, 1); // +3 chargeback, -2 daily decay
});

test('Whale pays big fees', () => {
  assert.equal(incomeOf(tap(setup({ 0: 'whale' }, 'news')), 100), 140);
});

test('Influencer doubles adjacent fees', () => {
  const s = tap(setup({ 0: 'gambler', 1: 'influencer' }, 'chop'));
  assert.equal(incomeOf(s, 100), 60);
});

test('Bot accounts pay a little and add Heat', () => {
  const s = setup({ 0: 'bot' }, 'chop');
  s.heat = 10;
  const after = tap(s);
  assert.equal(incomeOf(after, 100), 12);
  assert.equal(after.heat, 9);
});

test('Bulk Order fills up to three empty slots with bots', () => {
  let s = setup({}, 'chop');
  s = tap(s);
  s.offers = [{ kind: 'card', id: 'botfarm' }];
  s = step(s, { type: 'draft', pick: 0 });
  assert.equal(s.grid.filter((c) => c?.def === 'bot').length, 3);
});

// ---------------------------------------------------------------- staff

test('Affiliate adds +0.15 Mult for each adjacent paying gambler', () => {
  const s = tap(setup({ 0: 'gambler', 5: 'retail', 1: 'affiliate', 3: 'grinder' }, 'chop'));
  assert.equal(s.lastReport?.mult, 1.3);
  assert.equal(s.lastReport?.fees, 30 + 26 + 12);
  assert.equal(s.lastReport?.income, Math.round(68 * 1.3));
});

test('Affiliate ignores gamblers that paid nothing', () => {
  const s = tap(setup({ 0: 'trendbro', 1: 'affiliate' }, 'up'));
  assert.equal(s.lastReport?.mult, 1);
});

test('Discord Mod adds 10 to adjacent grinders', () => {
  assert.equal(incomeOf(tap(setup({ 0: 'grinder', 6: 'discordmod' }, 'chop')), 100), 22);
});

test('Support Agent stops adjacent chargebacks', () => {
  assert.equal(incomeOf(tap(setup({ 0: 'chargeback', 5: 'support' }, 'news')), 100), 0);
});

test('Compliance Officer slows adjacent traders', () => {
  assert.equal(findCard(tap(setup({ 0: 'grinder', 1: 'compliance' }, 'up')), 100)?.card.progress, 1);
});

test('Risk Analyst exposes fraud in its row only', () => {
  const s = tap(setup({ 0: 'hedger', 4: 'riskanalyst', 5: 'ghost' }, 'chop'));
  assert.equal(findCard(s, 100)?.card.revealed, true);
  assert.equal(findCard(s, 102)?.card.revealed, false);
});

test('Copy-Trade Detector exposes every copy ring and bot', () => {
  const s = tap(setup({ 0: 'copyring', 19: 'bot', 10: 'detector' }, 'chop'));
  assert.equal(findCard(s, 100)?.card.revealed, true);
  assert.equal(findCard(s, 102)?.card.revealed, true); // slot 19 bot (uids follow slot order)
});

test('Sales Closer fills an empty neighbour every day', () => {
  const s = tap(setup({ 6: 'closer' }, 'chop'));
  assert.equal(s.grid.filter(Boolean).length, 2);
});

test('Trust sets the starting mult', () => {
  const low = setup({ 0: 'gambler' }, 'chop');
  low.trust = 1;
  const high = setup({ 0: 'gambler' }, 'chop');
  high.trust = 5;
  assert.equal(tap(low).lastReport?.income, 12);
  assert.equal(tap(high).lastReport?.income, 48);
  assert.equal(tap(high).lastReport?.baseMult, 1.6);
});

test('Upsell Desk permanently raises adjacent fees', () => {
  let s = setup({ 0: 'gambler', 1: 'upsell' }, 'chop');
  s = tap(s);
  assert.equal(findCard(s, 100)?.card.bonus, 1);
  s = step(s, { type: 'draft', pick: null });
  s.forecast = { chop: 1, up: 0, down: 0, news: 0 };
  s = tap(s);
  assert.equal(incomeOf(s, 100), 31);
});

test('Payout Proof Wall multiplies the mult by 0.05 per honoured payout', () => {
  const s = setup({ 0: 'gambler', 19: 'proofwall' }, 'chop');
  s.stats.payoutsPaid = 20;
  const r = tap(s).lastReport;
  assert.equal(r?.mult, 2);
  assert.equal(r?.income, 60);
  const none = tap(setup({ 0: 'gambler', 19: 'proofwall' }, 'chop')).lastReport;
  assert.equal(none?.mult, 1);
});

test('Quant Desk adds +1 Mult on chop days only', () => {
  assert.equal(tap(setup({ 0: 'gambler', 19: 'quantdesk' }, 'chop')).lastReport?.mult, 2);
  assert.equal(tap(setup({ 0: 'gambler', 19: 'quantdesk' }, 'up')).lastReport?.mult, 1);
});

test('Hype Team adds +0.05 Mult per paying customer anywhere', () => {
  const s = tap(setup({ 0: 'gambler', 4: 'gambler', 15: 'grinder', 19: 'hypeteam', 10: 'influencer' }, 'chop'));
  assert.equal(s.lastReport?.mult, 1.15);
});

test('Chief Risk Officer doubles the mult when nobody asks for a payout', () => {
  assert.equal(tap(setup({ 0: 'gambler', 19: 'cro' }, 'chop')).lastReport?.mult, 2);
  const due = tap(setup({ 0: card(100, 'grinder', { progress: 9 }), 19: 'cro' }, 'chop'));
  assert.equal(due.lastReport?.requests, 1);
  assert.equal(due.lastReport?.mult, 1);
});

test('Risk Analyst adds +0.2 Mult per exposed fraud in its own row', () => {
  const s = tap(setup({ 0: 'hedger', 1: 'riskanalyst', 2: 'ghost', 10: card(103, 'chargeback', { revealed: true }) }, 'chop'));
  assert.equal(s.lastReport?.mult, 1.4);
});

test('Funded Vets pay no fees but add +0.1 Mult each', () => {
  const s = tap(setup({ 0: 'gambler', 5: card(101, 'vet', { revealed: true }), 10: card(102, 'vet', { revealed: true }) }, 'chop'));
  assert.equal(s.lastReport?.fees, 30);
  assert.equal(s.lastReport?.mult, 1.2);
});

test('scoring fires every fee in reading order, then every mult', () => {
  const r = tap(setup({ 7: 'affiliate', 2: 'gambler', 12: 'gambler', 19: 'quantdesk' }, 'chop')).lastReport;
  const kinds = r?.events.map((e) => (e.fees !== undefined ? 'fees' : 'mult'));
  assert.deepEqual(kinds, ['fees', 'fees', 'mult', 'mult']);
  assert.deepEqual(r?.events.map((e) => e.mult), [1, 1, 1.3, 2.3]);
  assert.equal(r?.income, Math.round(60 * 2.3));
});

test('chargebacks are clawed back after the mult', () => {
  const r = tap(setup({ 0: 'gambler', 4: 'chargeback', 19: 'quantdesk' }, 'news')).lastReport;
  assert.equal(r?.fees, 40);
  assert.equal(r?.clawback, -70);
  assert.equal(r?.income, 40 - 70);
});

test('expected take is pure and matches the forecast mix', () => {
  const s = setup({ 0: 'gambler', 1: 'affiliate' }, 'chop');
  const before = JSON.stringify(s);
  const e = expectedTake(s);
  assert.equal(JSON.stringify(s), before);
  assert.equal(e, expectedTake(s));
  assert.ok(e > 30 && e < 50);
});

test('placement preview prices a slot by the expected take', () => {
  const s = setup({ 0: 'gambler', 5: 'gambler', 6: 'gambler' }, 'chop');
  assert.ok(previewPlacement(s, 'affiliate', 1) > previewPlacement(s, 'affiliate', 19));
  assert.equal(s.grid[1], null);
});

test('letting someone go costs severance, and closing a Funded Vet costs Trust', () => {
  let s = setup({ 0: 'gambler', 1: card(101, 'vet', { revealed: true }) }, 'chop');
  s.cash = 200;
  s = step(s, { type: 'release', slot: 0 });
  assert.equal(s.grid[0], null);
  assert.equal(s.cash, 200 - BALANCE.severance);
  const t = s.trust;
  s = step(s, { type: 'release', slot: 1 });
  assert.ok(s.trust < t);
  assert.throws(() => step(s, { type: 'release', slot: 1 }), IllegalAction);
});

test('Lawyer halves Heat from denials', () => {
  const base = setup({ 0: card(100, 'grinder', { progress: 10 }) }, 'chop');
  const withLawyer = setup({ 0: card(100, 'grinder', { progress: 10 }), 19: 'lawyer' }, 'chop');
  const deny = (s: GameState): number => step(tap(s), { type: 'payout', decision: 'deny', excuse: 'terms' }).heat;
  assert.equal(deny(base), BALANCE.denyHeat);
  assert.equal(deny(withLawyer), BALANCE.denyHeat / 2);
});

// ---------------------------------------------------------------- payout desk

test('a full progress bar creates a payout request', () => {
  const s = tap(setup({ 0: card(100, 'grinder', { progress: 9 }) }, 'chop'));
  assert.equal(s.phase, 'payout');
  assert.equal(s.queue.length, 1);
  assert.ok((s.queue[0]?.amount ?? 0) >= 250);
});

test('paying turns a trader into a Funded Vet and builds Trust', () => {
  let s = tap(setup({ 0: card(100, 'grinder', { progress: 9 }) }, 'chop'));
  s.cash = 5000;
  const owed = s.queue[0]?.amount ?? 0;
  s = step(s, { type: 'payout', decision: 'pay' });
  assert.equal(s.cash, 5000 - owed);
  assert.equal(findCard(s, 100)?.card.def, 'vet');
  assert.ok(s.trust > BALANCE.startTrust);
  assert.equal(s.phase, 'draft');
});

test('a Funded Vet moves to live after three payouts', () => {
  let s = tap(setup({ 0: card(100, 'vet', { progress: 9, payouts: 2 }) }, 'chop'));
  s.cash = 5000;
  s = step(s, { type: 'payout', decision: 'pay' });
  assert.equal(findCard(s, 100), null);
});

test('you cannot pay without the cash', () => {
  const s = tap(setup({ 0: card(100, 'whale', { progress: 10 }) }, 'chop'));
  assert.ok(!legalActions(s).some((a) => a.type === 'payout' && a.decision === 'pay'));
});

test('stalling delays the request and costs a little Trust', () => {
  let s = tap(setup({ 0: card(100, 'grinder', { progress: 9 }) }, 'chop'));
  s = step(s, { type: 'payout', decision: 'stall' });
  assert.equal(findCard(s, 100)?.card.stalledUntil, s.day + 3);
  assert.ok(s.trust < BALANCE.startTrust);
});

test('denying a clean trader costs Trust and Heat', () => {
  let s = tap(setup({ 0: card(100, 'grinder', { progress: 9 }) }, 'chop'));
  s = step(s, { type: 'payout', decision: 'deny', excuse: 'terms' });
  assert.equal(findCard(s, 100), null);
  assert.ok(Math.abs(s.trust - (BALANCE.startTrust - BALANCE.denyTrust)) < 1e-9);
  assert.equal(s.heat, BALANCE.denyHeat);
});

test('denying exposed fraud with evidence builds Trust', () => {
  let s = tap(setup({ 0: card(100, 'hedger', { progress: 10, revealed: true }) }, 'chop'));
  s = step(s, { type: 'payout', decision: 'deny', excuse: 'terms' });
  assert.ok(s.trust > BALANCE.startTrust);
  assert.equal(s.stats.fraudCaught, 1);
});

test('the right excuse counts as evidence', () => {
  let s = tap(setup({ 0: card(100, 'ghost', { progress: 10 }) }, 'chop'));
  s.excuses = ['kyc'];
  s = step(s, { type: 'payout', decision: 'deny', excuse: 'kyc' });
  assert.equal(s.stats.fraudCaught, 1);
});

test('reusing the same excuse hurts more each time', () => {
  let s = tap(setup({ 0: card(100, 'grinder', { progress: 10 }), 2: card(101, 'grinder', { progress: 10 }) }, 'chop'));
  s.excuses = ['terms', 'terms'];
  const t0 = s.trust;
  s = step(s, { type: 'payout', decision: 'deny', excuse: 'terms' });
  const first = t0 - s.trust;
  const t1 = s.trust;
  s = step(s, { type: 'payout', decision: 'deny', excuse: 'terms' });
  assert.ok(t1 - s.trust > first);
});

test('denying an Influencer is a disaster', () => {
  let s = tap(setup({ 0: card(100, 'influencer', { progress: 10 }) }, 'chop'));
  s = step(s, { type: 'payout', decision: 'deny', excuse: 'terms' });
  assert.ok(s.trust <= BALANCE.startTrust - 1);
  assert.equal(s.heat, 18);
});

test('rare staff are one of a kind: never offered while one is on the book', () => {
  const s = setup({ 0: 'cro', 1: 'proofwall' }, 'chop');
  for (let k = 0; k < 200; k++) {
    for (const o of rollOffers(s, makeRng(k))) assert.ok(o.id !== 'cro' && o.id !== 'proofwall');
  }
});

test('every draftable card and excuse can actually be offered', () => {
  const seen = new Set<string>();
  let s = newRun(9);
  s = tap(s);
  while (s.phase === 'payout') s = step(s, { type: 'payout', decision: 'stall' });
  for (let k = 0; k < 400; k++) {
    s.rerolls = 0;
    s.cash = 1e6;
    s = step(s, { type: 'reroll' });
    for (const o of s.offers) seen.add(`${o.kind}:${o.id}`);
  }
  for (const def of Object.values(CARDS)) if (def.draftWeight > 0) assert.ok(seen.has(`card:${def.id}`), def.id);
});
