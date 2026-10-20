import { BALANCE, CARDS, EXCUSES, emptySlots, findCard, legalActions, neighborsOf } from '@firm/sim';
import type { Action, GameState, Offer } from '@firm/sim';
import { makeRng } from '@firm/sim';
import type { Rng } from '@firm/sim';

export type Bot = (s: GameState, rng: Rng) => Action;

const pick = <T>(rng: Rng, xs: readonly T[]): T => rng.pick(xs);

/** What a player can see: hidden fraud looks like an ordinary New Trader. */
function seenId(defId: string, revealed = false): string {
  const def = CARDS[defId];
  return !revealed && def?.disguise ? 'retail' : defId;
}

const FEE: Record<string, number> = {
  gambler: 28, retail: 24, scalper: 16, trendbro: 22, whale: 95, grinder: 12,
  copyring: 18, hedger: 22, ghost: 28, chargeback: 25, bot: 12, vet: 0, influencer: 0, botfarm: 30,
};

function avgIncome(s: GameState): number {
  const h = s.stats.incomeHistory.slice(-3);
  return h.length ? h.reduce((a, b) => a + b, 0) / h.length : 120;
}

function payoutDecision(s: GameState, prefer: 'pay' | 'deny' | 'smart' | 'greedy'): Action {
  const legal = legalActions(s);
  const canPay = legal.some((a) => a.type === 'payout' && a.decision === 'pay');
  const canStall = legal.some((a) => a.type === 'payout' && a.decision === 'stall');
  const req = s.queue[0];
  const found = req ? findCard(s, req.uid) : null;
  const card = found?.card;
  const def = card ? CARDS[card.def] : undefined;
  const excuses = s.excuses;
  const denyWith = (ex?: string): Action => {
    const e = ex ?? excuses[0];
    return e === undefined ? { type: 'payout', decision: 'deny' } : { type: 'payout', decision: 'deny', excuse: e };
  };

  if (prefer === 'pay') {
    if (canPay) return { type: 'payout', decision: 'pay' };
    if (canStall) return { type: 'payout', decision: 'stall' };
    return denyWith();
  }
  if (prefer === 'deny') {
    if (excuses.length) return denyWith();
    if (canStall) return { type: 'payout', decision: 'stall' };
    return canPay ? { type: 'payout', decision: 'pay' } : denyWith();
  }
  if (prefer === 'greedy') {
    const cheap = req && req.amount < 200;
    if (cheap && canPay) return { type: 'payout', decision: 'pay' };
    if (excuses.length) return denyWith();
    if (canStall) return { type: 'payout', decision: 'stall' };
    return canPay ? { type: 'payout', decision: 'pay' } : denyWith();
  }
  // smart: punish proven fraud, protect influencers, keep enough cash for payroll
  if (card?.revealed && def?.fraud && excuses.length) return denyWith(excuses.find((e) => e !== 'glitch' && e !== 'refund'));
  const proof = excuses.find((e) => def?.fraud && EXCUSES[e]?.proves.includes(def.fraud));
  if (proof && card && seenId(card.def, card.revealed) === 'retail' && card.age <= 5) return denyWith(proof);
  const daysToPayroll = s.payroll.dueDay - s.day;
  const reserve = Math.max(0, s.payroll.amount - avgIncome(s) * daysToPayroll);
  if (canPay && (card?.def === 'influencer' || s.cash - (req?.amount ?? 0) >= reserve)) return { type: 'payout', decision: 'pay' };
  if (canStall) return { type: 'payout', decision: 'stall' };
  if (excuses.includes('glitch')) return denyWith('glitch');
  if (excuses.includes('refund')) return denyWith('refund');
  if (canPay) return { type: 'payout', decision: 'pay' };
  return denyWith();
}

// ------------------------------------------------------------------ placement

function slotValue(s: GameState, slot: number, offerId: string): number {
  const ns = neighborsOf(slot).map((i) => s.grid[i] ?? null);
  const fees = (c: (typeof ns)[number]): number => (c ? FEE[seenId(c.def, c.revealed)] ?? 0 : 0);
  switch (offerId) {
    case 'affiliate': return ns.reduce((t, c) => t + (c && ['gambler', 'retail', 'trendbro'].includes(seenId(c.def, c.revealed)) ? fees(c) * 0.5 : 0), 0);
    case 'influencer': return ns.reduce((t, c) => t + fees(c), 0) - 20;
    case 'discordmod': return 10 * ns.filter((c) => c?.def === 'grinder' || c?.def === 'vet').length;
    case 'riskanalyst': {
      const r = Math.floor(slot / BALANCE.cols);
      return 12 * s.grid.slice(r * BALANCE.cols, r * BALANCE.cols + BALANCE.cols).filter((c) => c && !c.revealed && CARDS[c.def]?.disguise).length;
    }
    case 'support': return 8 + 10 * ns.filter((c) => c && seenId(c.def, c.revealed) === 'retail').length;
    case 'compliance': return 6 * ns.filter((c) => c && CARDS[c.def]?.payout).length;
    case 'closer': return ns.some((c) => c === null) ? 22 : 0;
    case 'detector': return 10 * s.grid.filter((c) => c?.def === 'copyring' || c?.def === 'bot').length;
    case 'lawyer': return 6;
    default: {
      // a trader: base fee, plus bonuses from staff/influencers already next to it
      let v = FEE[seenId(offerId)] ?? 10;
      for (const c of ns) {
        if (c?.def === 'influencer') v += FEE[seenId(offerId)] ?? 0;
        if (c?.def === 'affiliate' && ['gambler', 'retail', 'trendbro'].includes(seenId(offerId))) v += (FEE[seenId(offerId)] ?? 0) * 0.5;
      }
      if (offerId === 'grinder') v += 6; // trust value
      if (offerId === 'whale') v -= 40; // payout risk
      return v;
    }
  }
}

function bestPlacement(s: GameState, offer: Offer): { value: number; slot?: number } {
  if (offer.kind === 'excuse') return { value: s.excuses.length < 2 ? 25 : 4 };
  if (offer.id === 'botfarm') return { value: emptySlots(s).length >= 3 && s.heat < 40 ? 20 : -5 };
  const free = emptySlots(s);
  if (free.length === 0) return { value: -1 };
  let best = { value: -Infinity, slot: free[0] as number };
  for (const slot of free) {
    const v = slotValue(s, slot, offer.id);
    if (v > best.value) best = { value: v, slot };
  }
  return best;
}

function smartDraft(s: GameState): Action {
  let best: { i: number; value: number; slot?: number } = { i: -1, value: 0 };
  s.offers.forEach((o, i) => {
    const p = bestPlacement(s, o);
    if (p.value > best.value) best = { i, value: p.value, ...(p.slot !== undefined ? { slot: p.slot } : {}) };
  });
  if (best.i < 0 && s.rerolls > 0) return { type: 'reroll' };
  return best.i < 0 ? { type: 'draft', pick: null } : { type: 'draft', pick: best.i, ...(best.slot !== undefined ? { slot: best.slot } : {}) };
}

function naiveDraft(s: GameState): Action {
  const i = s.offers.findIndex((o) => o.kind === 'excuse' || emptySlots(s).length > 0);
  return { type: 'draft', pick: i < 0 ? null : i };
}

function morning(s: GameState, desperate: boolean): Action {
  const legal = legalActions(s);
  if (desperate && s.day === s.payroll.dueDay) {
    const projected = s.cash + avgIncome(s);
    const due = s.payroll.amount + (s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0);
    if (projected < due) {
      if (legal.some((a) => a.type === 'flashSale')) return { type: 'flashSale' };
      if (legal.some((a) => a.type === 'loan')) return { type: 'loan' };
    }
  }
  return { type: 'tap' };
}

// ------------------------------------------------------------------ bots

export const BOTS: Record<string, Bot> = {
  random: (s, rng) => pick(rng, legalActions(s)),
  naive: (s) => (s.phase === 'morning' ? { type: 'tap' } : s.phase === 'payout' ? payoutDecision(s, 'pay') : naiveDraft(s)),
  alwaysPay: (s) => (s.phase === 'morning' ? morning(s, false) : s.phase === 'payout' ? payoutDecision(s, 'pay') : smartDraft(s)),
  alwaysDeny: (s) => (s.phase === 'morning' ? morning(s, false) : s.phase === 'payout' ? payoutDecision(s, 'deny') : smartDraft(s)),
  greedy: (s, rng) => {
    if (s.phase === 'morning') {
      const legal = legalActions(s);
      if (legal.some((a) => a.type === 'flashSale')) return { type: 'flashSale' };
      return morning(s, true);
    }
    if (s.phase === 'payout') return payoutDecision(s, 'greedy');
    void rng;
    return smartDraft(s);
  },
  smart: (s) => (s.phase === 'morning' ? morning(s, true) : s.phase === 'payout' ? payoutDecision(s, 'smart') : smartDraft(s)),
};

export function botRng(seed: number): Rng {
  return makeRng(seed ^ 0x9e3779b9);
}
