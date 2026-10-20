import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BALANCE, CARDS, IllegalAction, findCard, legalActions, newRun, step, valuation,
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

test('a new run starts with six traders, $300 and two excuses', () => {
  const s = newRun(1);
  assert.equal(s.grid.filter(Boolean).length, 6);
  assert.equal(s.cash, 300);
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
  assert.equal(s.payroll.amount, BALANCE.payrollStart * BALANCE.payrollGrowth);
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
  assert.equal(s.cash, cash + 200);
  assert.equal(s.grid.filter(Boolean).length, 4);
  assert.ok(s.trust < BALANCE.startTrust);
  assert.throws(() => step(s, { type: 'flashSale' }), IllegalAction);
});

test('valuation rewards cash and trust and subtracts what the book could claim', () => {
  const s = setup({ 0: card(1, 'grinder', { progress: 5 }) });
  s.cash = 1000;
  s.stats.incomeHistory = [100, 100, 100, 100, 100];
  assert.equal(valuation(s), 1000 + 1500 - 150);
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

test('Affiliate adds 50% to adjacent gamblers', () => {
  const s = tap(setup({ 0: 'gambler', 1: 'affiliate' }, 'chop'));
  assert.equal(incomeOf(s, 100), 45);
  assert.equal(s.lastReport?.results.find((r) => r.uid === 100)?.base, 30);
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

test('Trust multiplies fees', () => {
  const low = setup({ 0: 'gambler' }, 'chop');
  low.trust = 1;
  const high = setup({ 0: 'gambler' }, 'chop');
  high.trust = 5;
  assert.equal(incomeOf(tap(low), 100), 18);
  assert.equal(incomeOf(tap(high), 100), 42);
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

test('Payout Proof Wall grows fees with every honoured payout', () => {
  const s = setup({ 0: 'gambler', 19: 'proofwall' }, 'chop');
  s.stats.payoutsPaid = 10;
  assert.equal(incomeOf(tap(s), 100), 42);
});

test('Lawyer halves Heat from denials', () => {
  const base = setup({ 0: card(100, 'grinder', { progress: 10 }) }, 'chop');
  const withLawyer = setup({ 0: card(100, 'grinder', { progress: 10 }), 19: 'lawyer' }, 'chop');
  const deny = (s: GameState): number => step(tap(s), { type: 'payout', decision: 'deny', excuse: 'terms' }).heat;
  assert.equal(deny(base), 10);
  assert.equal(deny(withLawyer), 5);
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
  assert.ok(Math.abs(s.trust - (BALANCE.startTrust - 0.6)) < 1e-9);
  assert.equal(s.heat, 10);
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

test('every draftable card and excuse can actually be offered', () => {
  const seen = new Set<string>();
  let s = newRun(9);
  s = tap(s);
  while (s.phase === 'payout') s = step(s, { type: 'payout', decision: 'stall' });
  for (let k = 0; k < 400; k++) {
    s.rerolls = 1;
    s = step(s, { type: 'reroll' });
    for (const o of s.offers) seen.add(`${o.kind}:${o.id}`);
  }
  for (const def of Object.values(CARDS)) if (def.draftWeight > 0) assert.ok(seen.has(`card:${def.id}`), def.id);
});
