import { BALANCE, newRun, step } from '@firm/sim';

if (process.env.BAL) Object.assign(BALANCE, JSON.parse(process.env.BAL));
import type { GameState } from '@firm/sim';
import { BOTS, botRng } from './strategies.ts';

const RUNS = Number(process.env.RUNS ?? 10000);
const MAX_STEPS = 5000;

interface Summary {
  bot: string;
  p10: number; median: number; p90: number; max: number; mean: number;
  causes: Record<string, number>;
  medianValuation: number;
  payoutsPaid: number; payoutsDenied: number;
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

export function playOne(botName: string, seed: number): GameState {
  const bot = BOTS[botName];
  if (!bot) throw new Error(`no bot ${botName}`);
  const rng = botRng(seed);
  let s = newRun(seed);
  for (let k = 0; k < MAX_STEPS && s.phase !== 'dead'; k++) s = step(s, bot(s, rng));
  return s;
}

function summarize(botName: string): Summary {
  const days: number[] = [];
  const vals: number[] = [];
  const causes: Record<string, number> = {};
  let paid = 0;
  let denied = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const s = playOne(botName, seed);
    days.push(s.day);
    vals.push(s.stats.peakValuation);
    const c = s.cause ?? 'alive';
    causes[c] = (causes[c] ?? 0) + 1;
    paid += s.stats.payoutsPaid;
    denied += s.stats.payoutsDenied;
  }
  days.sort((a, b) => a - b);
  vals.sort((a, b) => a - b);
  return {
    bot: botName,
    p10: quantile(days, 0.1), median: quantile(days, 0.5), p90: quantile(days, 0.9), max: days[days.length - 1] ?? 0,
    mean: Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10,
    causes, medianValuation: quantile(vals, 0.5),
    payoutsPaid: Math.round((paid / RUNS) * 10) / 10, payoutsDenied: Math.round((denied / RUNS) * 10) / 10,
  };
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BOTS);
const rows = names.map(summarize);
console.log(`\nFIRM balance run: ${RUNS} games per bot\n`);
console.log('bot          p10  median  p90   max  | deaths (payroll/trust/heat)       | med. valuation | paid/denied per run');
for (const r of rows) {
  const pct = (k: string): string => `${Math.round(((r.causes[k] ?? 0) / RUNS) * 100)}%`.padStart(4);
  console.log(
    `${r.bot.padEnd(12)} ${String(r.p10).padStart(3)}  ${String(r.median).padStart(6)}  ${String(r.p90).padStart(3)}  ${String(r.max).padStart(4)}  | ${pct('payroll')} / ${pct('trust')} / ${pct('heat')}            | ${String(r.medianValuation).padStart(14)} | ${r.payoutsPaid} / ${r.payoutsDenied}`,
  );
}
