/** Find the longest runs for a bot: pnpm --filter @firm/bots exec tsx src/longest.ts BOT N */
import { BOTS, botRng } from './strategies.ts';
import { newRun, step, cardDef } from '@firm/sim';
const name = process.argv[2] ?? 'smart', n = Number(process.argv[3] ?? 300);
const out: [number, number, string][] = [];
for (let seed = 1; seed <= n; seed++) {
  const bot = BOTS[name]!; const rng = botRng(seed);
  let s = newRun(seed);
  for (let k = 0; k < 5000 && s.phase !== 'dead'; k++) s = step(s, bot(s, rng));
  const grid = s.grid.filter(Boolean).map((c) => cardDef(c!.def).name.slice(0, 7)).join(',');
  out.push([s.day, seed, `pay ${s.payroll.amount} paid ${s.stats.payoutsPaid} [${grid}]`]);
}
out.sort((a, b) => b[0] - a[0]);
for (const r of out.slice(0, 5)) console.log(r.join(' | '));
