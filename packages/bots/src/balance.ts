import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { BALANCE, newRun, step } from '@firm/sim';
import type { GameState } from '@firm/sim';
import { BOTS, botRng } from './strategies.ts';

if (process.env.BAL) Object.assign(BALANCE, JSON.parse(process.env.BAL));

const RUNS = Number(process.env.RUNS ?? 10000);
const MAX_STEPS = 5000;

/** One finished game, reduced to what the report needs. */
type Row = [day: number, peak: number, cause: string, paid: number, denied: number];

export function playOne(botName: string, seed: number): GameState {
  const bot = BOTS[botName];
  if (!bot) throw new Error(`no bot ${botName}`);
  const rng = botRng(seed);
  let s = newRun(seed);
  for (let k = 0; k < MAX_STEPS && s.phase !== 'dead'; k++) s = step(s, bot(s, rng));
  return s;
}

function playRange(names: string[], from: number, to: number): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const name of names) {
    const rows: Row[] = [];
    for (let seed = from; seed < to; seed++) {
      const s = playOne(name, seed);
      rows.push([s.day, s.stats.peakValuation, s.cause ?? 'alive', s.stats.payoutsPaid, s.stats.payoutsDenied]);
    }
    out[name] = rows;
  }
  return out;
}

const quantile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

function report(names: string[], all: Record<string, Row[]>): void {
  console.log(`\nFIRM balance run: ${RUNS} games per bot\n`);
  console.log('bot          p10  median  p90   max  | deaths (payroll/trust/heat)       | med. valuation | paid/denied per run');
  for (const name of names) {
    const rows = all[name] ?? [];
    const days = rows.map((r) => r[0]).sort((a, b) => a - b);
    const vals = rows.map((r) => r[1]).sort((a, b) => a - b);
    const pct = (k: string): string => `${Math.round((rows.filter((r) => r[2] === k).length / rows.length) * 100)}%`.padStart(4);
    const per = (i: 3 | 4): number => Math.round((rows.reduce((t, r) => t + r[i], 0) / rows.length) * 10) / 10;
    console.log(
      `${name.padEnd(12)} ${String(quantile(days, 0.1)).padStart(3)}  ${String(quantile(days, 0.5)).padStart(6)}  ${String(quantile(days, 0.9)).padStart(3)}  ${String(days[days.length - 1] ?? 0).padStart(4)}  | ${pct('payroll')} / ${pct('trust')} / ${pct('heat')}            | ${String(quantile(vals, 0.5)).padStart(14)} | ${per(3)} / ${per(4)}`,
    );
  }
}

if (isMainThread) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BOTS);
  const n = Math.max(1, Math.min(availableParallelism(), 16));
  const chunk = Math.ceil(RUNS / n);
  const parts = await Promise.all(
    Array.from({ length: n }, (_, k) => new Promise<Record<string, Row[]>>((resolve, reject) => {
      const from = 1 + k * chunk, to = Math.min(RUNS + 1, from + chunk);
      const w = new Worker(new URL(import.meta.url), { workerData: { names, from, to }, execArgv: ['--import', 'tsx'], env: process.env });
      w.once('message', resolve);
      w.once('error', reject);
    })),
  );
  const all: Record<string, Row[]> = {};
  for (const name of names) all[name] = parts.flatMap((p) => p[name] ?? []);
  report(names, all);
} else {
  const { names, from, to } = workerData as { names: string[]; from: number; to: number };
  parentPort?.postMessage(playRange(names, from, to));
}
