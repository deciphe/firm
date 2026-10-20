import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BALANCE, CRISES, CRISIS_EVERY, FOUNDERS, IllegalAction, legalActions, newRun, offerPrice, planCost, step,
} from '../src/index.ts';
import type { GameState } from '../src/index.ts';

/** Fast-forward to the end of the current cycle with plenty of cash, and pay payroll. */
function payPayroll(s0: GameState, cash = 100000): GameState {
  let s: GameState = { ...structuredClone(s0), cash, grid: new Array(20).fill(null), queue: [] };
  s.day = s.payroll.dueDay;
  s.forecast = { chop: 1, up: 0, down: 0, news: 0 };
  s = step(s, { type: 'tap' });
  return step(s, { type: 'draft', pick: null });
}

// ---------------------------------------------------------------- founders + stakes

test('the default founder is the standard run', () => {
  const s = newRun(5);
  assert.equal(s.founder, 'founder');
  assert.equal(s.stake, 1);
  assert.equal(s.cash, BALANCE.startCash);
  assert.equal(s.payroll.amount, BALANCE.payrollStart);
  assert.deepEqual(s.excuses, ['terms', 'glitch']);
});

test('every founder starts a legal run with their own twist', () => {
  for (const id of Object.keys(FOUNDERS)) {
    const s = newRun(9, { founder: id });
    assert.equal(s.founder, id);
    assert.equal(s.phase, 'morning');
    assert.ok(legalActions(s).length > 0);
  }
  assert.equal(newRun(1, { founder: 'hustler' }).cash, BALANCE.startCash + 80);
  assert.equal(newRun(1, { founder: 'saint' }).trust, BALANCE.startTrust + 1);
  assert.deepEqual(newRun(1, { founder: 'saint' }).excuses, []);
  assert.equal(newRun(1, { founder: 'quant' }).grid[9]?.def, 'riskanalyst');
  assert.equal(newRun(1, { founder: 'closer' }).grid[2]?.def, 'affiliate');
  assert.equal(newRun(1, { founder: 'fixer' }).heat, 15);
  assert.equal(newRun(1, { founder: 'fixer' }).grid[0]?.def, 'lawyer');
});

test('the closer hires for 10% less', () => {
  const s = newRun(1, { founder: 'closer' });
  assert.equal(offerPrice({ kind: 'card', id: 'detector' }, s), Math.round((BALANCE.prices.rare as number) * 0.9 / 5) * 5);
});

test('the hustler gets more from a flash sale', () => {
  const a = step(newRun(1), { type: 'flashSale' });
  const b = step(newRun(1, { founder: 'hustler' }), { type: 'flashSale' });
  assert.equal(a.cash - BALANCE.startCash, 200);
  assert.equal(b.cash - BALANCE.startCash - 80, 300);
});

test('stakes stack: higher payroll, half the cash at IPO', () => {
  assert.equal(newRun(1, { stake: 2 }).payroll.amount, Math.round((BALANCE.payrollStart * 1.15) / 10) * 10);
  assert.equal(newRun(1, { stake: 5 }).cash, BALANCE.startCash / 2);
  assert.equal(newRun(1, { stake: 5 }).payroll.amount, Math.round((BALANCE.payrollStart * 1.15) / 10) * 10);
  assert.equal(newRun(1, { stake: 9 }).stake, 5);
});

test('series C payroll grows faster', () => {
  const a = payPayroll(newRun(1));
  const c = payPayroll(newRun(1, { stake: 4 }));
  assert.ok(c.payroll.base > a.payroll.base);
});

// ---------------------------------------------------------------- quarter plans

test('paying payroll opens the quarter with steady plus two other plans', () => {
  const s = payPayroll(newRun(3));
  assert.equal(s.phase, 'quarter');
  assert.equal(s.plans.length, 3);
  assert.equal(s.plans[0], 'steady');
  assert.equal(new Set(s.plans).size, 3);
  assert.throws(() => step(s, { type: 'tap' }), IllegalAction);
});

function withPlans(plans: string[]): GameState {
  const s = payPayroll(newRun(3));
  return { ...s, plans };
}

test('steady keeps the scheduled payroll', () => {
  const s = step(withPlans(['steady', 'lean', 'growth']), { type: 'plan', id: 'steady' });
  assert.equal(s.phase, 'morning');
  assert.equal(s.payroll.amount, s.payroll.base);
});

test('growth push: payroll +20% and the next hire is free', () => {
  let s = step(withPlans(['steady', 'growth', 'lean']), { type: 'plan', id: 'growth' });
  assert.equal(s.payroll.amount, Math.round((s.payroll.base * 1.2) / 10) * 10);
  assert.equal(s.freeHires, 1);
  s = { ...s, phase: 'draft', offers: [{ kind: 'card', id: 'detector' }] };
  assert.equal(offerPrice({ kind: 'card', id: 'detector' }, s), 0);
  const cash = s.cash;
  s = step(s, { type: 'draft', pick: 0, slot: 0 });
  assert.equal(s.cash, cash);
  assert.equal(s.freeHires, 0);
});

test('lean quarter: cheaper payroll, only two cards per shop', () => {
  let s = step(withPlans(['steady', 'lean', 'pr']), { type: 'plan', id: 'lean' });
  assert.equal(s.payroll.amount, Math.round((s.payroll.base * 0.85) / 10) * 10);
  s.forecast = { chop: 1, up: 0, down: 0, news: 0 };
  s = step(s, { type: 'tap' });
  assert.equal(s.phase, 'draft');
  assert.equal(s.offers.length, 2);
});

test('raising a round pays now and makes payroll grow faster forever', () => {
  const before = withPlans(['steady', 'raise', 'pr']);
  const s = step(before, { type: 'plan', id: 'raise' });
  assert.equal(s.cash, before.cash + Math.round((before.payroll.base * 0.5) / 10) * 10);
  assert.ok(s.dilution > 0);
  const next = payPayroll(s);
  assert.equal(next.payroll.base, Math.round((s.payroll.base * (BALANCE.payrollGrowth + s.dilution)) / 10) * 10);
});

test('PR blitz costs cash and cools Heat', () => {
  const before = { ...withPlans(['steady', 'pr', 'fair']), heat: 50, trust: 2 };
  const s = step(before, { type: 'plan', id: 'pr' });
  assert.equal(s.cash, before.cash - planCost(before, 'pr'));
  assert.equal(s.heat, 30);
  assert.ok(Math.abs(s.trust - 2.3) < 1e-9);
  const broke = { ...before, cash: 0 };
  assert.ok(!legalActions(broke).some((a) => a.type === 'plan' && a.id === 'pr'));
});

test('hiring fair: hires 40% cheaper, payroll +10%', () => {
  const s = step(withPlans(['steady', 'fair', 'lean']), { type: 'plan', id: 'fair' });
  assert.equal(s.payroll.amount, Math.round((s.payroll.base * 1.1) / 10) * 10);
  assert.equal(offerPrice({ kind: 'card', id: 'detector' }, s), Math.round(((BALANCE.prices.rare as number) * 0.6) / 5) * 5);
});

// ---------------------------------------------------------------- crises

test('every third cycle is the announced crisis, and surviving it builds Trust', () => {
  let s = newRun(11);
  const announced = s.nextCrisis;
  assert.equal(s.crisisCycle, CRISIS_EVERY);
  assert.ok(CRISES[announced]);
  for (let c = 1; c < CRISIS_EVERY; c++) { s = payPayroll(s); s = step(s, { type: 'plan', id: 'steady' }); }
  assert.equal(s.payroll.cycle, CRISIS_EVERY);
  assert.equal(s.crisis, announced);
  assert.notEqual(s.nextCrisis, announced);
  assert.equal(s.crisisCycle, CRISIS_EVERY * 2);
  const trust = s.trust;
  s = payPayroll(s);
  assert.equal(s.crisis, null);
  assert.equal(s.stats.crisesSurvived, 1);
  assert.ok(s.trust > trust);
});

function inCrisis(id: string): GameState {
  const s = newRun(2);
  return { ...s, crisis: id };
}

test('audit doubles Heat gains', () => {
  const a = step({ ...newRun(2), heat: 10 }, { type: 'flashSale' });
  const b = step({ ...inCrisis('audit'), heat: 10 }, { type: 'flashSale' });
  assert.equal(a.heat, 16);
  assert.equal(b.heat, 22);
});

test('the exposé doubles Trust losses', () => {
  const a = step(newRun(2), { type: 'flashSale' });
  const b = step(inCrisis('expose'), { type: 'flashSale' });
  assert.ok(Math.abs((BALANCE.startTrust - b.trust) - 2 * (BALANCE.startTrust - a.trust)) < 1e-9);
});

test('price war cuts every fee by a quarter', () => {
  const base = newRun(2);
  base.forecast = { chop: 1, up: 0, down: 0, news: 0 };
  const a = step(base, { type: 'tap' });
  const b = step({ ...structuredClone(base), crisis: 'pricewar' }, { type: 'tap' });
  assert.ok((b.lastReport?.income ?? 0) < (a.lastReport?.income ?? 0));
});

test('outage makes hiring 50% dearer', () => {
  assert.equal(offerPrice({ kind: 'card', id: 'hedger' }, inCrisis('outage')), Math.round(((BALANCE.prices.common as number) * 1.5) / 5) * 5);
});

test('bank run pushes traders faster on trend days', () => {
  const base = newRun(2);
  base.forecast = { chop: 0, up: 1, down: 0, news: 0 };
  const a = step(base, { type: 'tap' });
  const b = step({ ...structuredClone(base), crisis: 'bankrun' }, { type: 'tap' });
  const prog = (s: GameState): number => s.grid.reduce((t, c) => t + (c?.progress ?? 0), 0);
  assert.ok(prog(b) > prog(a));
});
