import { FOUNDERS, FOUNDER_ORDER, STAKES } from '@firm/sim';
import type { GameState } from '@firm/sim';

/** Progress that survives between runs (kept in this browser). */
export interface Meta {
  runs: number;
  bestDays: number;
  bestVal: number;
  totalPaid: number;
  totalDenied: number;
  crises: number;
  /** Highest stake unlocked. */
  maxStake: number;
  seen: string[];
  founder: string;
  stake: number;
  /** Best valuation per founder:stake. */
  records: Record<string, number>;
}

const KEY = 'firm:meta';
const fresh = (): Meta => ({ runs: 0, bestDays: 0, bestVal: 0, totalPaid: 0, totalDenied: 0, crises: 0, maxStake: 1, seen: [], founder: 'founder', stake: 1, records: {} });

export function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...(JSON.parse(raw) as Partial<Meta>) };
    // carry over the old single best record
    const old = localStorage.getItem('firm:best');
    if (old) { const b = JSON.parse(old) as { days: number; val: number }; return { ...fresh(), bestDays: b.days, bestVal: b.val }; }
  } catch { /* private window: play without saving */ }
  return fresh();
}

export function saveMeta(m: Meta): void {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

/** Day reached on a stake that unlocks the next one. */
export const STAKE_GOAL_DAY = 20;

export function founderUnlocked(m: Meta, id: string): boolean {
  switch (id) {
    case 'founder': return true;
    case 'hustler': return m.bestDays >= 10;
    case 'quant': return m.crises >= 1;
    case 'closer': return m.bestVal >= 5000;
    case 'fixer': return m.totalDenied >= 10;
    case 'saint': return m.totalPaid >= 25;
    default: return false;
  }
}

export interface RunRecord { newBest: boolean; unlocked: string[] }

/** Fold a finished run into the meta and report what it unlocked. */
export function recordRun(s: GameState, tutorial: boolean): RunRecord {
  const m = loadMeta();
  if (tutorial) return { newBest: false, unlocked: [] };
  const before = FOUNDER_ORDER.filter((id) => founderUnlocked(m, id));
  const stakeBefore = m.maxStake;
  const newBest = s.stats.peakValuation > m.bestVal;
  m.runs += 1;
  m.bestDays = Math.max(m.bestDays, s.day);
  m.bestVal = Math.max(m.bestVal, s.stats.peakValuation);
  m.totalPaid += s.stats.payoutsPaid;
  m.totalDenied += s.stats.payoutsDenied;
  m.crises += s.stats.crisesSurvived;
  const rk = `${s.founder}:${s.stake}`;
  m.records[rk] = Math.max(m.records[rk] ?? 0, s.stats.peakValuation);
  if (s.day >= STAKE_GOAL_DAY && s.stake >= m.maxStake && m.maxStake < STAKES.length) m.maxStake = s.stake + 1;
  saveMeta(m);
  const unlocked = FOUNDER_ORDER.filter((id) => founderUnlocked(m, id) && !before.includes(id)).map((id) => FOUNDERS[id]?.name ?? id);
  if (m.maxStake > stakeBefore) unlocked.push(`${STAKES[m.maxStake - 1]?.name ?? 'New'} stake`);
  return { newBest, unlocked };
}

export function markSeen(ids: string[]): void {
  const m = loadMeta();
  let changed = false;
  for (const id of ids) if (!m.seen.includes(id)) { m.seen.push(id); changed = true; }
  if (changed) saveMeta(m);
}
