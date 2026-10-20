export type Candle = 'chop' | 'up' | 'down' | 'news';
export const CANDLES: readonly Candle[] = ['chop', 'up', 'down', 'news'];

export type Phase = 'quarter' | 'morning' | 'payout' | 'draft' | 'dead';
export type DeathCause = 'payroll' | 'trust' | 'heat';
export type Rarity = 'common' | 'uncommon' | 'rare';

export interface CardInstance {
  uid: number;
  def: string;
  progress: number;
  age: number;
  revealed: boolean;
  payouts: number;
  stalls: number;
  stalledUntil: number;
  /** Permanent fee bonus earned over the run (Upsell Desk). */
  bonus: number;
}

export interface PayoutRequest {
  uid: number;
  amount: number;
}

export type OfferKind = 'card' | 'excuse';
export interface Offer {
  kind: OfferKind;
  id: string;
}

export type Tone = 'good' | 'bad' | 'neutral';
export interface FeedPost {
  day: number;
  handle: string;
  text: string;
  tone: Tone;
}

export interface CardResult {
  uid: number;
  /** Fee before staff, influencers and Trust. */
  base: number;
  cash: number;
  progress: number;
}

export interface DayReport {
  day: number;
  candle: Candle;
  income: number;
  results: CardResult[];
  requests: number;
  spawned: number[];
  movedLive: number[];
}

export interface Stats {
  paid: number;
  denied: number;
  payoutsPaid: number;
  payoutsDenied: number;
  stalls: number;
  fraudCaught: number;
  peakValuation: number;
  incomeHistory: number[];
  excuseUses: Record<string, number>;
  crisesSurvived: number;
}

export interface Payroll {
  /** This cycle's bill, after the quarter plan. */
  amount: number;
  /** The scheduled bill before the plan; grows every cycle. */
  base: number;
  dueDay: number;
  cycle: number;
  loanOwed: number;
  loanDueCycle: number;
}

export interface GameState {
  seed: number;
  rng: number;
  day: number;
  phase: Phase;
  cash: number;
  trust: number;
  heat: number;
  payroll: Payroll;
  grid: (CardInstance | null)[];
  nextUid: number;
  excuses: string[];
  queue: PayoutRequest[];
  offers: Offer[];
  rerolls: number;
  flashSaleCycle: number;
  forecast: Record<Candle, number>;
  lastReport: DayReport | null;
  feed: FeedPost[];
  stats: Stats;
  cause: DeathCause | null;
  shortBy: number;
  founder: string;
  stake: number;
  /** Crisis running this cycle, if any. */
  crisis: string | null;
  /** The crisis waiting at `crisisCycle`. */
  nextCrisis: string;
  crisisCycle: number;
  /** The quarter plan for this cycle, and the choices on offer in the 'quarter' phase. */
  plan: string;
  plans: string[];
  freeHires: number;
  /** Extra payroll growth from raising rounds. */
  dilution: number;
}

export type PayoutDecision = 'pay' | 'stall' | 'deny';

export type Action =
  | { type: 'tap' }
  | { type: 'flashSale' }
  | { type: 'loan' }
  | { type: 'payout'; decision: PayoutDecision; excuse?: string }
  | { type: 'draft'; pick: number | null; slot?: number }
  | { type: 'reroll' }
  | { type: 'plan'; id: string };
