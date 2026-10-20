/**
 * Run structure: who founded the firm, how hard the run is, the crisis cycles and the quarter plan the
 * player picks before each payroll cycle. Pure data; the engine reads these through small helpers.
 */

export interface FounderDef {
  id: string;
  name: string;
  blurb: string;
  /** Changes to the standard start. */
  cash: number;
  trust: number;
  heat: number;
  place: (readonly [number, string])[];
  excuses: string[] | null;
  /** What unlocks this founder (shown on the locked card). */
  unlock: string;
}

export const FOUNDERS: Record<string, FounderDef> = {
  founder: { id: 'founder', name: 'The Founder', blurb: 'No edge, no baggage. The standard firm.', cash: 0, trust: 0, heat: 0, place: [], excuses: null, unlock: 'Always open' },
  hustler: { id: 'hustler', name: 'The Hustler', blurb: '+$80 cash. Flash sales pay 50% more. Starts at Trust 2.5.', cash: 80, trust: -0.5, heat: 0, place: [], excuses: null, unlock: 'Survive to day 10' },
  quant: { id: 'quant', name: 'The Quant', blurb: 'Starts with a Risk Analyst. Chop days are likelier.', cash: 0, trust: 0, heat: 0, place: [[9, 'riskanalyst']], excuses: null, unlock: 'Survive a crisis' },
  closer: { id: 'closer', name: 'The Closer', blurb: 'Starts with an Affiliate. Hires cost 10% less. One excuse fewer.', cash: 0, trust: 0, heat: 0, place: [[2, 'affiliate']], excuses: ['terms'], unlock: 'Reach a $5,000 valuation' },
  fixer: { id: 'fixer', name: 'The Fixer', blurb: 'Starts with a Lawyer and an extra Technical Review. Heat starts at 15.', cash: 0, trust: 0, heat: 15, place: [[0, 'lawyer']], excuses: ['terms', 'glitch', 'glitch'], unlock: 'Deny 10 payouts in total' },
  saint: { id: 'saint', name: 'The Saint', blurb: 'Trust starts at 4. No excuses at all. Ghosting hurts twice as much.', cash: 0, trust: 1, heat: 0, place: [], excuses: [], unlock: 'Pay 25 payouts in total' },
};
export const FOUNDER_ORDER = ['founder', 'hustler', 'quant', 'closer', 'fixer', 'saint'];

export interface StakeDef { level: number; name: string; blurb: string }
/** Difficulty, cumulative like Balatro's stakes: each level keeps every rule below it. */
export const STAKES: StakeDef[] = [
  { level: 1, name: 'Seed', blurb: 'The standard run.' },
  { level: 2, name: 'Series A', blurb: 'Payroll starts 15% higher.' },
  { level: 3, name: 'Series B', blurb: 'Heat cools half as fast.' },
  { level: 4, name: 'Series C', blurb: 'Payroll grows faster every cycle.' },
  { level: 5, name: 'IPO', blurb: 'Start with half the cash.' },
];

export interface CrisisDef { id: string; name: string; blurb: string }
/** Every third payroll cycle is a crisis. You see the next one coming. */
export const CRISES: Record<string, CrisisDef> = {
  audit: { id: 'audit', name: 'Regulator Audit', blurb: 'Every Heat gain is doubled this cycle.' },
  bankrun: { id: 'bankrun', name: 'Bank Run', blurb: 'Traders rush their payouts: +1 progress on every trend and news day.' },
  pricewar: { id: 'pricewar', name: 'Price War', blurb: 'A rival slashed prices. Every fee is 25% lower.' },
  expose: { id: 'expose', name: 'The Exposé', blurb: 'A YouTuber is digging. Every Trust loss is doubled.' },
  volatility: { id: 'volatility', name: 'Vol Spike', blurb: 'Chop is half as likely. Trends and news everywhere.' },
  outage: { id: 'outage', name: 'Platform Outage', blurb: 'Your vendor is down. Hiring costs 50% more.' },
};
export const CRISIS_EVERY = 3;

export interface PlanDef { id: string; name: string; blurb: string }
/** Chosen before each payroll cycle (after the first). Steady is always on offer. */
export const PLANS: Record<string, PlanDef> = {
  steady: { id: 'steady', name: 'Steady Quarter', blurb: 'No changes. Payroll as scheduled.' },
  growth: { id: 'growth', name: 'Growth Push', blurb: 'Payroll +20% this cycle. Your next hire is free.' },
  lean: { id: 'lean', name: 'Lean Quarter', blurb: 'Payroll −15% this cycle. Shops show only 2 cards.' },
  raise: { id: 'raise', name: 'Raise a Round', blurb: 'Cash now worth half a payroll. Payroll grows faster forever after.' },
  pr: { id: 'pr', name: 'PR Blitz', blurb: 'Spend a quarter of payroll now. Heat −20, Trust +0.3.' },
  fair: { id: 'fair', name: 'Hiring Fair', blurb: 'Hires cost 40% less this cycle. Payroll +10%.' },
};

export interface RunOptions { founder?: string; stake?: number }
