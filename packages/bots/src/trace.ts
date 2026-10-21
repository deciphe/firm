/** Day-by-day log of one bot run: pnpm --filter @firm/bots trace SEED BOT */
import { newRun, step, valuation, cardDef } from '@firm/sim';
import { BOTS, botRng } from './strategies.ts';
const seed = Number(process.argv[2] ?? 7), botName = process.argv[3] ?? 'smart';
const bot = BOTS[botName]!; const rng = botRng(seed);
let s = newRun(seed);
for (let k = 0; k < 3000 && s.phase !== 'dead'; k++) {
  const a = bot(s, rng);
  const prev = s; s = step(s, a);
  if (a.type === 'tap') {
    const r = s.lastReport!;
    const grid = s.grid.filter(Boolean).map((c) => cardDef(c!.def).name.slice(0, 6)).join(',');
    console.log(`d${String(prev.day).padStart(2)} ${r.candle.padEnd(4)} +${String(r.income).padStart(5)} cash ${String(s.cash).padStart(6)} pay ${s.payroll.amount}@${s.payroll.dueDay} T${s.trust.toFixed(1)} H${Math.round(s.heat)} V${valuation(s)} req${r.requests} [${grid}]`);
  } else if (a.type !== 'draft' || a.pick !== null) console.log('     ', JSON.stringify(a), a.type === 'draft' ? JSON.stringify(prev.offers[a.pick!]) : '', 'cash', s.cash);
}
console.log('DEAD', s.cause, 'day', s.day, 'short', s.shortBy, 'peak', s.stats.peakValuation);
