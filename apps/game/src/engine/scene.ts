import {
  BALANCE, CARDS, CRISES, EXCUSES, FOUNDERS, PLANS, STAKES, valuationParts, cardDef, displayName, excuseDef, expectedTake, findCard, legalActions, newRun, offerPrice, payrollGrowth, planCost, previewPlacement, rerollPrice, seedFromString, step, trustMultiplier, valuation,
} from '@firm/sim';
import type { Action, Candle, CardInstance, GameState, Offer } from '@firm/sim';
import * as J from '../juice.ts';
import { CardView, artTexture, cardLook } from './card.ts';
import type { CardLook } from './card.ts';
import { BG_FRAG, CrtPipeline } from './shaders.ts';
import { C, DEPTH, H } from './theme.ts';
import { Button, Num, STYLE, Spring, bakeShape, dashedRect, freeze, roundRect, setTextRes, strokeRect, text, u } from './ui.ts';
import { PaperCard } from './card.ts';
import { markSeen, recordRun } from './meta.ts';
import type { RunRecord } from './meta.ts';
import { cssRect, fadeIn, goTo } from './stage.ts';

// ================================================================== run state (survives rebuilds and hot reloads)

export type Mode = 'random' | 'daily' | 'tutorial';
interface Score { base: number; mult: number; today: number }
/** Cash movements this payroll cycle, for the cash-out receipt. */
interface Ledger { start: number; fees: number; payouts: number; hires: number; moves: number }
export interface UiState {
  s: GameState; mode: Mode; firm: string; tape: Candle[]; bestIncome: number; selected: number | null; revealed: string[]; score: Score;
  founder: string; stake: number; ledger: Ledger; record: RunRecord | null; cashout: { ledger: Ledger; paid: number; cycle: number; crisis: string | null } | null;
}
const ALL_REVEALS = ['payroll', 'odds', 'trust', 'hand'];
/** HUD labels that hold ticking numbers. */
const NUMERIC = new Set(['payAmt', 'cash', 'trust', 'heat', 'val', 'peak', 'rr', 'book']);

const money = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n: number): string => `${n >= 0 ? '+' : '-'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

function store<T>(key: string, value?: T): T | null {
  try {
    if (value !== undefined) { localStorage.setItem(`firm:${key}`, JSON.stringify(value)); return value; }
    const raw = localStorage.getItem(`firm:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

const FIRST = ['Halcyon', 'Ironbark', 'Bluefin', 'Northgate', 'Kestrel', 'Obsidian', 'Copperline', 'Tidewater', 'Silverpine', 'Redwick', 'Granite', 'Lantern', 'Saltmarsh', 'Hollowbrook', 'Quarry', 'Westlight'];
const SECOND = ['Capital', 'Funding', 'Prop', 'Markets', 'Trading Co.', 'Partners'];
const firmName = (seed: number): string => `${FIRST[seed % FIRST.length]} ${SECOND[Math.floor(seed / 7) % SECOND.length]}`;
function todaySeed(): { seed: number; label: string } {
  const d = new Date();
  const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { seed: seedFromString(`daily:${label}`), label };
}

export function freshUi(mode: Mode, founder = 'founder', stake = 1): UiState {
  const seed = mode === 'daily' ? todaySeed().seed : mode === 'tutorial' ? 20261020 : (Math.floor(Math.random() * 2 ** 31) >>> 0);
  if (mode !== 'random') { founder = 'founder'; stake = 1; }
  let s = newRun(seed, { founder, stake });
  if (mode === 'tutorial') {
    const grid = s.grid.map((c) => (c ? { ...c } : null));
    const g = grid[7];
    if (g) g.progress = 6;
    s = { ...s, grid, cash: 500 };
  }
  return {
    s, mode, firm: mode === 'tutorial' ? 'Your first firm' : mode === 'daily' ? `Daily Tape ${todaySeed().label}` : firmName(seed), tape: [], bestIncome: 0, selected: null,
    revealed: mode === 'tutorial' ? [] : [...ALL_REVEALS], score: { base: 0, mult: 1, today: 0 },
    founder, stake, ledger: { start: s.cash, fees: 0, payouts: 0, hires: 0, moves: 0 }, record: null, cashout: null,
  };
}

const CANDLE: Record<Candle, string> = { chop: 'CHOP', up: 'TREND UP', down: 'TREND DOWN', news: 'NEWS' };
const CANDLE_SUB: Record<Candle, string> = { chop: 'traders blow up and rebuy', up: 'traders run at their payouts', down: 'traders run at their payouts', news: 'anything can happen' };
const CANDLE_COLOR: Record<Candle, number> = { chop: C.muted, up: C.paper, down: C.clay, news: C.gold };
const CAUSE: Record<string, string> = { payroll: 'Missed payroll', trust: 'Nobody trusts you', heat: 'Shut down by regulators' };

const offerArt = (o: Offer): string => (o.kind === 'excuse' ? 'excuse' : cardDef(o.id).disguise ? 'retail' : o.id);
const offerName = (o: Offer): string => (o.kind === 'excuse' ? excuseDef(o.id).name : cardDef(o.id).disguise ?? cardDef(o.id).name);
const offerBlurb = (o: Offer): string => (o.kind === 'excuse' ? excuseDef(o.id).blurb : cardDef(o.id).disguise ? (CARDS.retail?.blurb ?? '') : cardDef(o.id).blurb);
function offerTag(o: Offer): string {
  if (o.kind === 'excuse') return 'EXCUSE';
  const def = cardDef(o.id);
  if (def.disguise) return 'CUSTOMER';
  return `${def.rarity === 'rare' ? 'RARE ' : ''}${def.kind === 'staff' ? 'STAFF' : 'CUSTOMER'}`;
}
/** The band on a shop card, matching the card it becomes on the book. */
function offerLook(o: Offer): CardLook {
  if (o.kind === 'excuse') return { band: C.clayDeep, ink: H.paper, label: 'EXCUSE', stat: '', fraud: false };
  const def = cardDef(o.id);
  if (o.id === 'botfarm') return { band: C.chip, ink: H.chipInk, label: 'BULK ORDER', stat: '×3', fraud: false };
  return cardLook({ uid: -1, def: def.disguise ? 'retail' : o.id, progress: 0, age: 0, revealed: true, payouts: 0, stalls: 0, stalledUntil: 0, bonus: 0 });
}
const offerRarity = (o: Offer): string => (o.kind === 'excuse' ? 'excuse' : cardDef(o.id).disguise ? 'common' : cardDef(o.id).rarity);
function infoBody(card: CardInstance): string {
  const def = cardDef(card.def);
  return !card.revealed && def.disguise ? (CARDS.retail?.blurb ?? '') : def.blurb;
}
function heatWord(h: number): { word: string; color: string } {
  if (h >= 85) return { word: 'SHUTDOWN AT 100', color: H.clay };
  if (h >= 60) return { word: 'REGULATORS CIRCLING', color: H.clay };
  if (h >= 30) return { word: 'GETTING NOTICED', color: H.bronze };
  return { word: 'QUIET', color: H.muted };
}

type Gate = 'tap' | 'select' | 'place' | 'skip' | 'reroll' | 'pay' | 'stall' | 'deny' | 'info' | 'sale' | 'loan';
interface Rect { x: number; y: number; w: number; h: number }
interface Say { text: string; target?: string | null; hint?: string; wait?: string; allow?: Gate[]; top?: boolean }

/**
 * Everything is laid out in fixed design units: a 1600x900 table on computers, a 430-wide portrait table on
 * phones (height follows the phone). The camera zooms the design to fit the window; the paint swirl fills
 * whatever is left over, so the game looks the same in any browser window.
 */
interface Layout {
  W: number; H: number; wide: boolean; k: number; fit: number; view: Rect;
  panel: Rect; side: Rect | null; center: Rect; strip: Rect; hand: Rect;
  grid: Rect; cw: number; ch: number; gap: number; cta: Rect; moves: Rect | null;
  /** Where the hiring floor goes (desktop: the right column; phone: below the raised book). */
  shopPanel: Rect;
  /** Phone only: the book while hiring, raised under a compact bar. */
  gridDraft: Rect | null;
}
interface Gauge { x: number; y: number; w: number; h: number; arc: boolean }

// ================================================================== the scene

export class FirmScene extends Phaser.Scene {
  ui!: UiState;
  private L!: Layout;
  private busy = false;
  private shownCash = 0;
  private hits: Record<string, Rect> = {};
  private bg!: Phaser.GameObjects.Shader;
  private crt: CrtPipeline | null = null;
  private pulse = { r: 0, g: 0, b: 0, a: 0 };
  private spin = 0;
  private clock = 0;
  private cards: CardView[] = [];
  private hud: Record<string, Phaser.GameObjects.Text | Num> = {};
  private hudG!: Phaser.GameObjects.Graphics;
  private hudDyn!: Phaser.GameObjects.Graphics;
  private alarmG!: Phaser.GameObjects.Graphics;
  private alarmImg: Phaser.GameObjects.Image | null = null;
  private hudDynImg: Phaser.GameObjects.Image | null = null;
  private chipBox!: Phaser.GameObjects.Container;
  private multBox!: Phaser.GameObjects.Container;
  private todayBox!: Phaser.GameObjects.Container;
  private boxSprings: Record<string, Spring> = {};
  private veiled: Record<string, Phaser.GameObjects.GameObject[]> = {};
  private rowLayer!: Phaser.GameObjects.Container;
  private cta!: Button;
  private moveBtns: Button[] = [];
  private shop: Phaser.GameObjects.Container | null = null;
  private overlay: Phaser.GameObjects.Container | null = null;
  private overlayKind = '';
  private tip: Phaser.GameObjects.Container | null = null;
  private toastObj: Phaser.GameObjects.Container | null = null;
  private fire: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private burst: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private replaceArmed = -1;
  private geo = {
    payBox: { x: 0, y: 0, w: 0, h: 0 } as Rect,
    track: { x: 0, y: 0, w: 0, h: 0 } as Rect,
    bar: { x: 0, y: 0, w: 0, h: 0 } as Rect,
    trust: { x: 0, y: 0, w: 0, h: 0, arc: true } as Gauge,
    heat: { x: 0, y: 0, w: 0, h: 0, arc: true } as Gauge,
  };
  private urgent = false;
  private hot = false;
  // guide
  private allowed: Set<Gate> | null = null;
  private waiters = new Map<string, () => void>();
  private guideToken = 0;
  private guideNow: { o: Say; resolve: (() => void) | null } | null = null;
  private guideLayer: Phaser.GameObjects.Container | null = null;
  private rebuildPending = false;

  constructor() { super('firm'); }

  // ---------------------------------------------------------------- boot + layout

  create(data: { ui?: UiState; mode?: Mode; founder?: string; stake?: number }): void {
    const restored = !!data.ui?.s;
    this.busy = false; this.overlay = null; this.overlayKind = ''; this.guideNow = null; this.allowed = null; this.waiters.clear(); this.guideToken++;
    this.ui = data.ui?.s ? data.ui : freshUi(data.mode ?? (store<boolean>('tutorialDone') ? 'random' : 'tutorial'), data.founder, data.stake);
    this.ui.ledger ??= { start: this.ui.s.cash, fees: 0, payouts: 0, hires: 0, moves: 0 };
    this.ui.founder ??= this.ui.s.founder ?? 'founder';
    this.ui.stake ??= this.ui.s.stake ?? 1;
    if (restored && this.ui.mode === 'tutorial') { this.ui.mode = 'random'; this.ui.revealed = [...ALL_REVEALS]; }
    this.shownCash = this.ui.s.cash;
    const dot = this.add.graphics();
    dot.fillStyle(0xffffff, 1); dot.fillCircle(8, 8, 8); dot.generateTexture('dot', 16, 16); dot.destroy();
    const renderer = this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (renderer.pipelines) {
      this.cameras.main.setPostPipeline(CrtPipeline);
      this.crt = this.cameras.main.getPostPipeline(CrtPipeline) as CrtPipeline;
    }
    const onResize = (): void => this.requestRebuild();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => { this.scale.off('resize', onResize); this.guideStop(); });
    fadeIn(this);
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => { e.preventDefault(); this.onSpace(); });
    this.input.keyboard?.on('keydown-ENTER', () => this.onSpace());
    this.input.on('pointerdown', () => { if (this.busy && !this.overlay) this.fast = true; });
    this.build();
    if (this.ui.mode === 'tutorial' && !restored) void this.tutorial();
    else if (this.ui.s.phase === 'payout') this.openPayout();
    else if (this.ui.s.phase === 'quarter') this.showQuarter();
    else if (this.ui.s.phase === 'dead') this.showDeath();
  }

  private requestRebuild(): void {
    if (this.rebuildPending) return;
    this.rebuildPending = true;
    const go = (): void => {
      if (this.busy) { this.time.delayedCall(200, go); return; }
      this.rebuildPending = false;
      this.build();
      if (this.overlayKind === 'payout') this.openPayout();
      else if (this.overlayKind === 'death') this.showDeath();
      else if (this.overlayKind === 'cashout') this.showCashout();
      else if (this.overlayKind === 'quarter') this.showQuarter();
      else if (this.overlayKind) this.closeOverlay();
      if (this.guideNow) this.drawGuide(true);
    };
    this.time.delayedCall(120, go);
  }

  private desperate(): boolean {
    const s = this.ui.s;
    return this.ui.mode !== 'tutorial' && s.phase === 'morning' && s.cash < this.payrollDue() && s.payroll.dueDay - s.day <= 1;
  }
  private payrollDue(): number {
    const p = this.ui.s.payroll;
    return p.amount + (p.loanOwed > 0 && p.cycle >= p.loanDueCycle ? p.loanOwed : 0);
  }

  private computeLayout(): Layout {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw0 = this.scale.width, ch0 = this.scale.height;
    const winW = cw0 / dpr, winH = ch0 / dpr;
    const wide = winW / winH >= 1.1 && winW >= 700;
    const W = wide ? 1600 : 430;
    const Hh = wide ? 900 : Math.round(Math.max(760, Math.min(1000, (430 * winH) / winW)));
    const fit = Math.min(winW / W, winH / Hh);
    const k = fit * dpr;
    const vw = cw0 / k, vh = ch0 / k;
    const view = { x: W / 2 - vw / 2, y: Hh / 2 - vh / 2, w: vw, h: vh };
    const desperate = this.desperate();
    const fitGrid = (area: Rect, gap: number, ratio: number): { grid: Rect; cw: number; ch: number } => {
      let ch = (area.h - 3 * gap) / 4, cw = ch / ratio;
      if (cw * 5 + 4 * gap > area.w) { cw = (area.w - 4 * gap) / 5; ch = cw * ratio; }
      const gw = cw * 5 + gap * 4, gH = ch * 4 + gap * 3;
      return { grid: { x: area.x + (area.w - gw) / 2, y: area.y + (area.h - gH) / 2, w: gw, h: gH }, cw, ch };
    };
    if (wide) {
      const panel = { x: 24, y: 24, w: 372, h: 852 };
      const side = { x: 1204, y: 24, w: 372, h: 852 };
      const center = { x: 420, y: 24, w: 760, h: 852 };
      const strip = { x: 420, y: 24, w: 760, h: 64 };
      const ctaH = 84;
      const cta = { x: 800 - 220, y: 876 - ctaH, w: 440, h: ctaH };
      const moves = desperate ? { x: 420, y: cta.y, w: 760, h: ctaH } : null;
      const gap = 14;
      const gy = strip.y + strip.h + 18;
      const { grid, cw, ch } = fitGrid({ x: 420, y: gy, w: 760, h: cta.y - 20 - gy }, gap, 1.28);
      const hand = { x: side.x + 20, y: side.y + 20, w: side.w - 40, h: 300 };
      return { W, H: Hh, wide, k, fit, view, panel, side, center, strip, hand, grid, cw, ch, gap, cta, moves, shopPanel: { ...side }, gridDraft: null };
    }
    const mx = 14, w = W - 2 * mx;
    const panel = { x: mx, y: 12, w, h: 246 };
    const strip = { x: mx, y: 266, w, h: 40 };
    const hand = { x: mx, y: 314, w, h: 28 };
    const ctaH = 64;
    const cta = { x: mx, y: Hh - 14 - ctaH, w, h: ctaH };
    const moves = desperate ? { x: mx, y: cta.y - 62, w, h: 54 } : null;
    const gap = 6;
    const gy = 352, gb = (moves ? moves.y : cta.y) - 12;
    const { grid, cw, ch } = fitGrid({ x: mx, y: gy, w, h: gb - gy }, gap, 1.34);
    const gridDraft = { ...grid, y: 112 };
    const sy = gridDraft.y + gridDraft.h + 10;
    const shopPanel = { x: 0, y: sy, w: W, h: Hh - sy };
    return { W, H: Hh, wide, k, fit, view, panel, side: null, center: { x: 0, y: 0, w: W, h: Hh }, strip, hand, grid, cw, ch, gap, cta, moves, shopPanel, gridDraft };
  }

  private build(): void {
    this.tweens.killAll();
    this.children.removeAll(true);
    this.cards = []; this.moveBtns = []; this.hud = {}; this.veiled = {}; this.hits = {}; this.boxSprings = {};
    this.shop = null; this.overlay = null; this.tip = null; this.toastObj = null; this.guideLayer = null;
    this.L = this.computeLayout();
    const { view: V, wide } = this.L;
    setTextRes(this.L.k);
    this.cameras.main.setZoom(this.L.k).centerOn(this.L.W / 2, this.L.H / 2);
    // backdrop fills the whole window, not just the design area
    const shader = new Phaser.Display.BaseShader('bg', BG_FRAG, undefined, {
      uPix: { type: '1f', value: wide ? 5 : 3.5 }, uSpin: { type: '1f', value: 0 },
      uPulse: { type: '4f', value: { x: 0, y: 0, z: 0, w: 0 } }, uHeat: { type: '1f', value: 0 },
    });
    this.bg = this.add.shader(shader, V.x - 4, V.y - 4, V.w + 8, V.h + 8).setOrigin(0).setDepth(DEPTH.bg);
    // particles
    this.fire = this.add.particles(0, 0, 'dot', { speed: { min: 30, max: 90 }, angle: { min: 240, max: 300 }, lifespan: { min: 500, max: 900 }, scale: { start: 0.45, end: 0 }, tint: [C.gold, C.clay, 0xffe0a0], blendMode: 'ADD', emitting: false, frequency: 18, quantity: 2 }).setDepth(DEPTH.fly);
    this.burst = this.add.particles(0, 0, 'dot', { speed: { min: 80, max: 260 }, lifespan: { min: 350, max: 700 }, scale: { start: 0.38, end: 0 }, tint: [C.gold, C.paper], blendMode: 'ADD', emitting: false, gravityY: 380 }).setDepth(DEPTH.fly);
    this.buildHud();
    this.buildRow();
    this.buildGrid();
    this.buildBar();
    freeze(this.hudG, { x: 0, y: 0, w: this.L.W, h: this.L.H });
    this.renderAll();
  }

  // ---------------------------------------------------------------- HUD

  private box(x: number, y: number, w: number, h: number, fill: number, stroke: number = C.line, a = 1, reveal?: string, r = 12): void {
    if (reveal) {
      const g = this.add.graphics().setDepth(DEPTH.hud);
      roundRect(g, x, y, w, h, r, fill, a);
      strokeRect(g, x, y, w, h, r, stroke, 1);
      (this.veiled[reveal] ??= []).push(freeze(g, { x: x - 2, y: y - 2, w: w + 4, h: h + 4 }));
      return;
    }
    roundRect(this.hudG, x, y, w, h, r, fill, a);
    strokeRect(this.hudG, x, y, w, h, r, stroke, 1);
  }

  private label(name: string, x: number, y: number, str: string, o: Parameters<typeof text>[4], reveal?: string): Phaser.GameObjects.Text | Num {
    // money and meters tick, so they get fixed-width digits
    const t = NUMERIC.has(name) ? new Num(this, x, y, str, o).setDepth(DEPTH.hud + 1) : text(this, x, y, str, o).setDepth(DEPTH.hud + 1);
    this.hud[name] = t;
    if (reveal) (this.veiled[reveal] ??= []).push(t);
    return t;
  }

  /** An invisible tappable area on the HUD (opens an explainer). */
  private tapZone(x: number, y: number, w: number, h: number, fn: () => void): void {
    const z = this.add.zone(x, y, w, h).setOrigin(0).setDepth(DEPTH.hud + 1).setInteractive({ useHandCursor: true });
    z.on('pointerup', () => { if (!this.busy && !this.overlay && !this.guideNow) { J.tick(); fn(); } });
  }

  /** Small score pill (fees / mult): a container so it can bump. */
  private scorePill(x: number, y: number, w: number, h: number, fill: number, deep: number, ink: string, key: string, size: number): Phaser.GameObjects.Container {
    const c = this.add.container(x + w / 2, y + h / 2).setDepth(DEPTH.hud + 1);
    const g = this.add.graphics();
    roundRect(g, -w / 2, -h / 2 + 2, w, h, 8, deep);
    roundRect(g, -w / 2, -h / 2, w, h - 1, 8, fill);
    const v = new Num(this, 0, -1, '0', { size, weight: 800, color: ink }).setOrigin(0.5);
    c.add([g, v]);
    freeze(g, { x: -w / 2 - 1, y: -h / 2 - 1, w: w + 2, h: h + 4 });
    this.hud[key] = v;
    this.boxSprings[key] = new Spring(1, 1, 380, 16);
    return c;
  }

  private brandRow(x0: number, y: number, w: number, big: boolean): void {
    const fs = big ? 24 : 18;
    this.label('mark', x0 + 1, y + (big ? 2 : 6), 'FIRM', { size: fs, weight: 800, spacing: fs * 0.3 });
    if (big) this.label('firm', x0 + 2, y + 34, '', { size: 12.5, weight: 600, color: H.muted });
    else this.label('firm', x0 + 82, y + 11, '', { size: 11.5, weight: 600, color: H.muted });
    const bh = big ? 40 : 36;
    const how = new Button(this, x0 + w - (big ? 124 : 112), y, big ? 44 : 38, bh, '?', { ...STYLE.dark, size: 14, spacing: 0 }).setDepth(DEPTH.hud + 2);
    how.onClick = () => this.showHow();
    this.hits.how = { x: x0 + w - (big ? 124 : 112), y, w: big ? 44 : 38, h: bh };
    const snd = new Button(this, x0 + w - (big ? 72 : 68), y, big ? 72 : 68, bh, J.isMuted() ? 'MUTED' : 'SOUND', { ...STYLE.dark, size: 10.5, spacing: 1 }).setDepth(DEPTH.hud + 2);
    snd.onClick = () => { J.unlockAudio(); J.setMuted(!J.isMuted()); store('muted', J.isMuted()); snd.setLabel(J.isMuted() ? 'MUTED' : 'SOUND'); };
  }

  private buildHud(): void {
    const { panel: P, wide } = this.L;
    this.hudG = this.add.graphics().setDepth(DEPTH.hud);
    this.alarmG = this.add.graphics().setDepth(DEPTH.hud + 1);
    if (wide) this.buildHudWide(P); else this.buildHudPhone(P);
    this.hudDyn = this.add.graphics().setDepth(DEPTH.hud + 1);
  }

  private buildHudWide(P: Rect): void {
    roundRect(this.hudG, P.x, P.y, P.w, P.h, 20, C.panel, 0.94);
    strokeRect(this.hudG, P.x, P.y, P.w, P.h, 20, C.line, 1);
    const x0 = P.x + 20, w = P.w - 40;
    this.brandRow(x0, P.y + 18, w, true);
    // PAYROLL: the hero. What you owe, when, and whether you can cover it.
    let y = 106;
    const ph = 226;
    this.box(x0, y, w, ph, 0x18120f, 0x3d2a21, 1, 'payroll', 14);
    this.geo.payBox = { x: x0, y, w, h: ph };
    this.label('payLbl', x0 + 18, y + 18, 'PAYROLL DUE', { size: 11, weight: 800, color: H.muted, spacing: 1.8 }, 'payroll');
    this.label('payCycle', x0 + w - 18, y + 18, '', { size: 11, weight: 800, color: H.muted, spacing: 1.4 }, 'payroll').setOrigin(1, 0);
    this.label('payAmt', x0 + 15, y + 34, '$0', { size: 54, weight: 800 }, 'payroll');
    this.label('payWhen', x0 + 18, y + 104, '', { size: 13, weight: 800, spacing: 1.4 }, 'payroll');
    this.label('payDay', x0 + w - 18, y + 104, '', { size: 13, weight: 800, color: H.muted, spacing: 1.2 }, 'payroll').setOrigin(1, 0);
    this.geo.track = { x: x0 + 18, y: y + 126, w: w - 36, h: 8 };
    this.label('cashLbl', x0 + 18, y + 152, 'CASH', { size: 11, weight: 800, color: H.muted, spacing: 1.8 });
    this.label('payGap', x0 + w - 18, y + 152, '', { size: 12, weight: 800, spacing: 1 }, 'payroll').setOrigin(1, 0);
    this.label('cash', x0 + 16, y + 168, '$0', { size: 30, weight: 800, color: H.gold });
    this.geo.bar = { x: x0 + 18, y: y + 206, w: w - 36, h: 6 };
    this.hits.payroll = { x: x0, y, w, h: ph };
    this.hits.cash = { x: x0, y: y + 144, w, h: ph - 144 };
    y += ph + 14;
    // TRUST + HEAT: live gauges, they decide how you die
    const gh = 150, bw = (w - 12) / 2;
    (['trust', 'heat'] as const).forEach((key, i) => {
      const bx = x0 + i * (bw + 12);
      this.box(bx, y, bw, gh, C.panel2, C.line, 1, 'trust', 14);
      this.label(`${key}Lbl`, bx + bw / 2, y + 14, key.toUpperCase(), { size: 11, weight: 800, color: H.muted, spacing: 1.8 }, 'trust').setOrigin(0.5, 0);
      this.label(key, bx + bw / 2, y + 86, '0', { size: 34, weight: 800 }, 'trust').setOrigin(0.5);
      this.label(`${key}Max`, bx + bw / 2, y + 110, key === 'trust' ? `OF ${BALANCE.maxTrust}` : `OF ${BALANCE.maxHeat}`, { size: 9.5, weight: 800, color: H.muted, spacing: 1.2 }, 'trust').setOrigin(0.5).setAlpha(0.7);
      this.label(`${key}Fx`, bx + bw / 2, y + 134, '', { size: 11, weight: 800, spacing: 0.8 }, 'trust').setOrigin(0.5);
      this.geo[key] = { x: bx, y, w: bw, h: gh, arc: true };
      this.hits[key] = { x: bx, y, w: bw, h: gh };
    });
    this.hits.meters = { x: x0, y, w, h: gh };
    y += gh + 14;
    // TODAY: a compact receipt, fees x mult = take. Only animates while the day scores.
    const th = 84;
    this.box(x0, y, w, th, C.panel2, C.line, 1, undefined, 14);
    this.label('todayLbl', x0 + 16, y + 14, 'TODAY', { size: 11, weight: 800, color: H.muted, spacing: 1.8 });
    this.chipBox = this.scorePill(x0 + 16, y + 38, 70, 30, C.chip, C.chipDeep, H.chipInk, 'base', 15);
    this.label('times', x0 + 16 + 70 + 12, y + 53, '×', { size: 16, weight: 800, color: H.muted }).setOrigin(0.5);
    this.multBox = this.scorePill(x0 + 16 + 70 + 24, y + 38, 70, 30, C.clay, C.clayDeep, H.clayInk, 'mult', 15);
    this.todayBox = this.add.container(x0 + w - 16, y + 50).setDepth(DEPTH.hud + 1);
    const tv = new Num(this, 0, 0, '+$0', { size: 32, weight: 800 }).setOrigin(1, 0.5);
    this.todayBox.add(tv); this.hud.today = tv; this.boxSprings.today = new Spring(1, 1, 380, 16);
    this.hits.score = { x: x0, y, w, h: th };
    y += th + 14;
    // VALUATION: the score you're chasing
    const vh = 88;
    this.box(x0, y, w, vh, C.panel2, C.line, 1, undefined, 14);
    this.label('valLbl', x0 + 16, y + 14, 'VALUATION', { size: 11, weight: 800, color: H.muted, spacing: 1.8 });
    this.label('best', x0 + w - 16, y + 14, '', { size: 11, weight: 800, color: H.goldDeep, spacing: 1.2 }).setOrigin(1, 0);
    this.label('val', x0 + 15, y + 34, '$0', { size: 34, weight: 800 });
    this.hits.val = { x: x0, y, w, h: vh };
    this.tapZone(x0, y, w, vh, () => this.showValuation());
    this.label('valHint', x0 + w - 16, y + 62, 'HOW? ›', { size: 10, weight: 800, color: H.muted, spacing: 1.2 }).setOrigin(1, 0);
    y += vh + 14;
    // small stats
    const sw = (w - 16) / 3;
    [['BOOK', 'book'], ['PEAK', 'peak'], ['REROLL', 'rr']].forEach(([lbl, key], i) => {
      const bx = x0 + i * (sw + 8);
      this.box(bx, y, sw, 60, C.panel2, C.line, 1, undefined, 12);
      this.label(`${key}L`, bx + 12, y + 11, lbl ?? '', { size: 9.5, weight: 800, color: H.muted, spacing: 1.4 });
      this.label(key ?? '', bx + 12, y + 28, '', { size: 18, weight: 800 });
    });
    const by = P.y + P.h - 20 - 46;
    const b1 = new Button(this, x0, by, (w - 10) / 2, 46, 'HOW IT WORKS', { ...STYLE.dark, size: 11 }).setDepth(DEPTH.hud + 2);
    b1.onClick = () => this.showHow();
    const b2 = new Button(this, x0 + (w + 10) / 2, by, (w - 10) / 2, 46, 'MENU', { ...STYLE.dark, size: 11 }).setDepth(DEPTH.hud + 2);
    b2.onClick = () => { if (!this.busy) goTo(this, 'title'); };
    this.hits.menu = { x: x0 + (w + 10) / 2, y: by, w: (w - 10) / 2, h: 46 };
    // right panel frame
    const S = this.L.side;
    if (S) {
      roundRect(this.hudG, S.x, S.y, S.w, S.h, 20, C.panel, 0.94);
      strokeRect(this.hudG, S.x, S.y, S.w, S.h, 20, C.line, 1);
    }
  }

  private buildHudPhone(P: Rect): void {
    const x0 = P.x, w = P.w;
    this.brandRow(x0, P.y, w, false);
    // payroll hero
    let y = 56;
    const ph = 124;
    this.box(x0, y, w, ph, 0x18120f, 0x3d2a21, 0.96, 'payroll', 14);
    this.geo.payBox = { x: x0, y, w, h: ph };
    this.label('payLbl', x0 + 14, y + 12, 'PAYROLL DUE', { size: 10, weight: 800, color: H.muted, spacing: 1.4 }, 'payroll');
    this.label('payAmt', x0 + 12, y + 26, '$0', { size: 38, weight: 800 }, 'payroll');
    this.label('payWhen', x0 + 14, y + 76, '', { size: 11.5, weight: 800, spacing: 1.1 }, 'payroll');
    this.geo.track = { x: x0 + 14, y: y + 96, w: 180, h: 6 };
    this.label('cashLbl', x0 + w - 14, y + 12, 'CASH', { size: 10, weight: 800, color: H.muted, spacing: 1.4 }).setOrigin(1, 0);
    this.label('cash', x0 + w - 14, y + 28, '$0', { size: 28, weight: 800, color: H.gold }).setOrigin(1, 0);
    this.label('payGap', x0 + w - 14, y + 66, '', { size: 11.5, weight: 800, spacing: 0.8 }, 'payroll').setOrigin(1, 0);
    this.label('payCycle', x0 + w - 14, y + 86, '', { size: 10, weight: 800, color: H.muted, spacing: 1.1 }, 'payroll').setOrigin(1, 0);
    this.geo.bar = { x: x0 + 14, y: y + 110, w: w - 28, h: 5 };
    this.hits.payroll = { x: x0, y, w, h: ph };
    this.hits.cash = { x: x0 + w / 2, y, w: w / 2, h: ph };
    y += ph + 8;
    // trust + heat
    const gh = 70, bw = (w - 8) / 2;
    (['trust', 'heat'] as const).forEach((key, i) => {
      const bx = x0 + i * (bw + 8);
      this.box(bx, y, bw, gh, C.panel2, C.line, 0.96, 'trust', 12);
      this.label(`${key}Lbl`, bx + 12, y + 11, key.toUpperCase(), { size: 10, weight: 800, color: H.muted, spacing: 1.4 }, 'trust');
      this.label(key, bx + bw - 12, y + 6, '0', { size: 24, weight: 800 }, 'trust').setOrigin(1, 0);
      this.label(`${key}Fx`, bx + 12, y + 52, '', { size: 10, weight: 800, spacing: 0.6 }, 'trust');
      this.geo[key] = { x: bx + 12, y: y + 40, w: bw - 24, h: 7, arc: false };
      this.hits[key] = { x: bx, y, w: bw, h: gh };
    });
    this.hits.meters = { x: x0, y, w, h: gh };
    // today + odds strip
    const S = this.L.strip;
    this.box(S.x, S.y, S.w, S.h, C.panel2, C.line, 0.96, undefined, 12);
    this.chipBox = this.scorePill(S.x + 8, S.y + 8, 56, 24, C.chip, C.chipDeep, H.chipInk, 'base', 13);
    this.label('times', S.x + 8 + 56 + 8, S.y + 20, '×', { size: 13, weight: 800, color: H.muted }).setOrigin(0.5);
    this.multBox = this.scorePill(S.x + 8 + 56 + 16, S.y + 8, 56, 24, C.clay, C.clayDeep, H.clayInk, 'mult', 13);
    this.todayBox = this.add.container(S.x + 146, S.y + 20).setDepth(DEPTH.hud + 1);
    const tv = new Num(this, 0, 0, '+$0', { size: 20, weight: 800 }).setOrigin(0, 0.5);
    this.todayBox.add(tv); this.hud.today = tv; this.boxSprings.today = new Spring(1, 1, 380, 16);
    this.hits.score = { x: S.x, y: S.y, w: 230, h: S.h };
    this.tapZone(S.x, S.y, 230, S.h, () => this.showValuation());
  }

  private renderHud(): void {
    const s = this.ui.s;
    const L = this.L;
    const g = this.hudDyn;
    g.clear();
    const firmT = this.hud.firm;
    if (firmT) {
      const full = this.ui.firm;
      firmT.setText(full);
      const max = L.wide ? 200 : L.W - 28 - 82 - 120;
      let cut = full;
      while (firmT.width > max && cut.length > 4) { cut = cut.slice(0, -1); firmT.setText(`${cut.trimEnd()}…`); }
    }
    this.setCash(this.shownCash);
    this.setScore(this.ui.score);
    const due = this.payrollDue();
    const loanDue = due - s.payroll.amount;
    const days = s.payroll.dueDay - s.day;
    const short = this.shownCash < due;
    this.urgent = days <= 1 && short && this.ui.revealed.includes('payroll');
    this.hud.payAmt?.setText(money(due));
    this.hud.payWhen?.setText(days <= 0 ? 'DUE TONIGHT' : `DUE IN ${days} DAY${days === 1 ? '' : 'S'}`).setColor(days <= 1 ? H.clay : H.paper);
    const crisisName = s.crisis ? (CRISES[s.crisis]?.name ?? '').toUpperCase() : '';
    this.hud.payCycle?.setText(crisisName ? `CYCLE ${s.payroll.cycle} · ${crisisName}` : L.wide ? `CYCLE ${s.payroll.cycle}${loanDue ? ' · +LOAN' : ''}` : `DAY ${s.day} · CYCLE ${s.payroll.cycle}`).setColor(crisisName ? H.clay : H.muted);
    this.hud.payDay?.setText(`DAY ${s.day}`);
    this.hud.payGap?.setText(short ? `NEED ${money(due - this.shownCash)} MORE` : 'COVERED').setColor(short ? H.clay : H.gold);
    if (this.ui.revealed.includes('payroll')) {
      // day track: one segment per day of the cycle; the last one is payday
      const T = this.geo.track, n = BALANCE.cycleDays, sg = 4;
      const segW = (T.w - sg * (n - 1)) / n;
      const at = Math.max(1, Math.min(n, n - Math.max(0, days)));
      for (let k = 0; k < n; k++) {
        const x = T.x + k * (segW + sg);
        const isNow = k === at - 1, past = k < at - 1, payday = k === n - 1;
        if (past) roundRect(g, x, T.y, segW, T.h, T.h / 2, C.paper, 0.45);
        else if (isNow) roundRect(g, x, T.y, segW, T.h, T.h / 2, days <= 1 ? C.clay : C.paper, 1);
        else roundRect(g, x, T.y, segW, T.h, T.h / 2, C.paper, 0.1);
        if (payday && !isNow) strokeRect(g, x, T.y, segW, T.h, T.h / 2, C.clay, 1, 0.8);
      }
      const B = this.geo.bar;
      const f = Math.min(1, this.shownCash / Math.max(1, due));
      roundRect(g, B.x, B.y, B.w, B.h, B.h / 2, C.paper, 0.1);
      if (f > 0) roundRect(g, B.x, B.y, Math.max(B.h, B.w * f), B.h, B.h / 2, short ? C.clay : C.gold);
    }
    // gauges
    const trustOn = this.ui.revealed.includes('trust');
    const tf = s.trust / BALANCE.maxTrust, hf = s.heat / BALANCE.maxHeat;
    const trustCol = s.trust < 1.5 ? C.clay : C.plat;
    const heatCol = s.heat >= 60 ? C.clay : C.bronze;
    this.hot = trustOn && s.heat >= 60;
    if (trustOn) {
      this.drawGauge(g, this.geo.trust, tf, trustCol);
      this.drawGauge(g, this.geo.heat, hf, heatCol);
    }
    this.hud.trust?.setText(s.trust.toFixed(1)).setColor(s.trust < 1.5 ? H.clay : H.paper);
    this.hud.heat?.setText(String(Math.round(s.heat))).setColor(s.heat >= 60 ? H.clay : H.paper);
    this.hud.trustFx?.setText(`MULT ×${trustMultiplier(s.trust).toFixed(2)}`).setColor(s.trust < 1.5 ? H.clay : H.plat);
    const hw = heatWord(s.heat);
    this.hud.heatFx?.setText(hw.word).setColor(hw.color);
    // alarm ring around payroll when it can't be covered
    this.alarmG.clear();
    const PB = this.geo.payBox;
    if (this.urgent) strokeRect(this.alarmG, PB.x - 1, PB.y - 1, PB.w + 2, PB.h + 2, 15, C.clay, 2.5);
    this.alarmImg = freeze(this.alarmG, { x: PB.x - 4, y: PB.y - 4, w: PB.w + 8, h: PB.h + 8 });
    this.hudDynImg = freeze(this.hudDyn, this.L.wide ? this.L.panel : { x: this.L.panel.x - 2, y: 0, w: this.L.panel.w + 4, h: this.L.strip.y });
    // score + stats
    const best = store<{ days: number; val: number }>('best');
    this.hud.val?.setText(money(valuation(s)));
    this.hud.best?.setText(best?.val ? `BEST ${money(best.val)}` : '');
    this.hud.peak?.setText(money(s.stats.peakValuation));
    this.hud.rr?.setText(money(rerollPrice(s)));
    this.hud.book?.setText(`${s.grid.filter(Boolean).length}/20`);
    this.bg?.setUniform('uHeat.value', s.heat / 100);
    for (const [key, objs] of Object.entries(this.veiled)) objs.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(this.ui.revealed.includes(key)));
    this.applyCompact();
  }

  /** Phone hiring mode: everything above the book folds into one bar (cash, payroll, days). */
  private applyCompact(): void {
    if (this.L.wide) return;
    const on = this.compact();
    const keep = new Set(['mark', 'firm']);
    const frozen = (g: Phaser.GameObjects.Graphics): Phaser.GameObjects.Image | undefined => (g as unknown as { __frozen?: Phaser.GameObjects.Image }).__frozen;
    const fullHud: ({ setVisible: (v: boolean) => unknown } | undefined)[] = [frozen(this.hudG), this.hudDynImg ?? undefined, this.alarmImg ?? undefined, this.rowLayer, this.chipBox, this.multBox, this.todayBox];
    for (const o of fullHud) o?.setVisible(!on);
    if (on) for (const objs of Object.values(this.veiled)) objs.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false));
    for (const [k, t] of Object.entries(this.hud)) if (!keep.has(k) && !t.parentContainer) t.setVisible(on ? false : t.visible);
    if (!on) for (const [key, objs] of Object.entries(this.veiled)) objs.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(this.ui.revealed.includes(key)));
    if (!on) { for (const [k, t] of Object.entries(this.hud)) if (!keep.has(k) && !t.parentContainer && !Object.values(this.veiled).some((l) => l.includes(t))) t.setVisible(true); }
    this.compactBar?.destroy(); this.compactBar = null;
    if (!on) return;
    const s = this.ui.s;
    const x0 = this.L.panel.x, w = this.L.panel.w, y = 54, h = 48;
    const c = this.add.container(0, 0).setDepth(DEPTH.hud + 1);
    const g = this.add.graphics();
    roundRect(g, x0, y, w, h, 12, 0x18120f, 0.96);
    strokeRect(g, x0, y, w, h, 12, 0x3d2a21, 1);
    const due = this.payrollDue(), days = s.payroll.dueDay - s.day;
    c.add([g,
      text(this, x0 + 14, y + h / 2, 'CASH', { size: 9.5, weight: 800, color: H.muted, spacing: 1.4 }).setOrigin(0, 0.5),
      text(this, x0 + 56, y + h / 2, money(s.cash), { size: 20, weight: 800, color: H.gold }).setOrigin(0, 0.5),
      text(this, x0 + w - 14, y + h / 2, `PAYROLL ${money(due)} · ${days <= 0 ? 'TONIGHT' : `${days}D`}`, { size: 11, weight: 800, color: s.cash < due ? H.clay : H.paper, spacing: 0.8 }).setOrigin(1, 0.5),
    ]);
    this.compactBar = c;
  }

  /** Arc gauge (desktop) or bar gauge (phone). */
  private drawGauge(g: Phaser.GameObjects.Graphics, G: Gauge, f: number, color: number): void {
    f = Math.max(0, Math.min(1, f));
    if (!G.arc) {
      roundRect(g, G.x, G.y, G.w, G.h, G.h / 2, C.paper, 0.1);
      if (f > 0) roundRect(g, G.x, G.y, Math.max(G.h, G.w * f), G.h, G.h / 2, color);
      return;
    }
    const cx = G.x + G.w / 2, cy = G.y + 88, r = 52, th = 10;
    const a0 = Phaser.Math.DegToRad(135), sweep = Phaser.Math.DegToRad(270);
    g.lineStyle(th, C.paper, 0.08);
    g.beginPath(); g.arc(cx, cy, r, a0, a0 + sweep, false); g.strokePath();
    // ticks
    for (let k = 0; k <= 10; k++) {
      const a = a0 + (sweep * k) / 10;
      g.lineStyle(1.5, C.paper, 0.18);
      g.lineBetween(cx + Math.cos(a) * (r + 9), cy + Math.sin(a) * (r + 9), cx + Math.cos(a) * (r + 13), cy + Math.sin(a) * (r + 13));
    }
    if (f > 0.005) {
      g.lineStyle(th, color, 1);
      g.beginPath(); g.arc(cx, cy, r, a0, a0 + sweep * f, false); g.strokePath();
      const a = a0 + sweep * f;
      g.fillStyle(color, 1); g.fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, th * 0.62);
    }
  }

  private setCash(v: number): void { this.shownCash = v; this.hud.cash?.setText(money(v)); }
  private setScore(sc: Score): void {
    this.hud.base?.setText(Math.round(sc.base).toLocaleString('en-US'));
    this.hud.mult?.setText(`×${sc.mult.toFixed(sc.mult >= 10 ? 0 : 2)}`);
    this.hud.today?.setText(signed(sc.today)).setColor(sc.today < 0 ? H.clay : H.paper);
  }

  // ---------------------------------------------------------------- market strip, excuses, the wire

  private buildRow(): void {
    this.rowLayer = this.add.container(0, 0).setDepth(DEPTH.hud);
    if (this.L.wide) {
      const S = this.L.strip;
      roundRect(this.hudG, S.x, S.y, S.w, S.h, 16, C.panel, 0.9);
      strokeRect(this.hudG, S.x, S.y, S.w, S.h, 16, C.line, 1);
    }
  }

  private renderRow(): void {
    this.rowG = null;
    this.renderRowInner();
    const L = this.L;
    if (this.rowG) freeze(this.rowG, L.wide ? { x: L.strip.x - 2, y: 0, w: (L.side?.x ?? 0) + (L.side?.w ?? 0) - L.strip.x + 4, h: L.H } : { x: 0, y: L.strip.y - 2, w: L.W, h: L.hand.y + L.hand.h - L.strip.y + 6 });
  }
  private rowG: Phaser.GameObjects.Graphics | null = null;

  private renderRowInner(): void {
    const L = this.L;
    this.rowLayer.removeAll(true);
    const s = this.ui.s;
    const g = this.add.graphics();
    this.rowG = g;
    this.rowLayer.add(g);
    const add = (t: Phaser.GameObjects.Text): Phaser.GameObjects.Text => { this.rowLayer.add(t); return t; };
    const f = s.forecast;
    const odds: [Candle, number][] = [['chop', f.chop], ['up', f.up], ['down', f.down], ['news', f.news]];
    const oddsBar = (x: number, y: number, w: number, h: number): void => {
      let ox = x;
      odds.forEach(([c, p], k) => {
        const sw = w * p;
        if (sw <= 0) return;
        g.fillStyle(CANDLE_COLOR[c], c === 'chop' ? 0.75 : 1);
        g.fillRect(ox, y, Math.max(0, sw - (k < 3 ? 2 : 0)), h);
        ox += sw;
      });
    };
    if (L.wide) {
      const S = L.strip;
      if (this.ui.revealed.includes('odds')) {
        add(text(this, S.x + 18, S.y + 12, 'LAST CANDLES', { size: 10, weight: 800, color: H.muted, spacing: 1.6 }));
        const tape = this.ui.tape.slice(-14);
        const mid = S.y + 42;
        if (!tape.length) add(text(this, S.x + 18, mid - 8, 'none yet', { size: 12, weight: 600, color: H.muted }));
        tape.forEach((c, k) => {
          const x = S.x + 22 + k * 14;
          const col = CANDLE_COLOR[c];
          const body = c === 'chop' ? 5 : c === 'news' ? 22 : 16;
          const off = c === 'up' ? -4 : c === 'down' ? 4 : 0;
          g.fillStyle(col, 0.8); g.fillRect(x - 0.75, mid - 14 + off, 1.5, 28);
          g.fillStyle(col, 1); g.fillRoundedRect(x - 4, mid - body / 2 + off, 8, body, 1.5);
        });
        // crisis: the one now, or the one coming
        {
          const cx0 = S.x + 252, now = s.crisis, cid = now ?? s.nextCrisis;
          const away = s.crisisCycle - s.payroll.cycle;
          g.fillStyle(C.line2, 1); g.fillRect(cx0 - 14, S.y + 12, 1, S.h - 24);
          add(text(this, cx0, S.y + 12, now ? 'CRISIS NOW' : `CRISIS IN ${away} CYCLE${away === 1 ? '' : 'S'}`, { size: 10, weight: 800, color: now ? H.clay : H.muted, spacing: 1.6 }));
          add(text(this, cx0, S.y + 30, CRISES[cid]?.name ?? '', { size: 15, weight: 800, color: now ? H.blush : H.paper }));
          this.hits.crisis = { x: cx0 - 14, y: S.y, w: 230, h: S.h };
        }
        const bw = 250, bx = S.x + S.w - 18 - bw;
        add(text(this, bx, S.y + 12, 'NEXT CANDLE ODDS', { size: 10, weight: 800, color: H.muted, spacing: 1.6 }));
        g.fillStyle(C.paper, 0.06); g.fillRoundedRect(bx, S.y + 30, bw, 8, 3);
        oddsBar(bx, S.y + 30, bw, 8);
        let lx = bx;
        odds.forEach(([c, p]) => {
          if (p < 0.005 || lx > bx + bw - 30) return;
          const t = add(text(this, lx, S.y + 44, `${CANDLE[c] === 'TREND UP' ? 'UP' : CANDLE[c] === 'TREND DOWN' ? 'DN' : CANDLE[c]} ${Math.round(p * 100)}`, { size: 10.5, weight: 800, color: c === 'down' ? H.clay : c === 'news' ? H.gold : c === 'chop' ? H.muted : H.paper, spacing: 0.6 }));
          lx += Math.max(bw * p, t.width + 10);
        });
        this.hits.odds = { ...S };
      }
      // right panel: excuses in hand, then the wire
      const R = L.side as Rect;
      const x0 = R.x + 20, w = R.w - 40;
      let y = R.y + 22;
      if (this.ui.revealed.includes('hand')) {
        add(text(this, x0, y, 'EXCUSES IN HAND', { size: 11, weight: 800, color: H.muted, spacing: 1.8 }));
        add(text(this, x0 + w, y, String(s.excuses.length), { size: 11, weight: 800, color: H.blush }).setOrigin(1, 0));
        y += 26;
        if (!s.excuses.length) {
          const t = add(text(this, x0, y, 'None. Any denial right now is a ghost, the worst kind.', { size: 12, weight: 600, color: H.muted, wrap: w }));
          y += t.height + 16;
        }
        for (const e of s.excuses.slice(0, 5)) {
          const d = excuseDef(e);
          const used = s.stats.excuseUses[e] ?? 0;
          const nm = text(this, x0 + 14, y + 10, d.name, { size: 13, weight: 800, color: H.blush });
          const bl = text(this, x0 + 14, y + 30, `${d.blurb}${used ? ` Used ${used}×.` : ''}`, { size: 11, weight: 600, color: H.muted, wrap: w - 28, lineSpacing: 1 });
          const hh = 40 + bl.height;
          roundRect(g, x0, y, w, hh, 12, C.clay, 0.08);
          strokeRect(g, x0, y, w, hh, 12, C.clay, 1, 0.3);
          add(nm); add(bl);
          y += hh + 8;
        }
        this.hits.excuses = { x: x0, y: R.y + 20, w, h: y - R.y - 20 };
        y += 14;
      }
      g.fillStyle(C.line2, 1); g.fillRect(x0, y, w, 1);
      y += 16;
      add(text(this, x0, y, 'THE WIRE', { size: 11, weight: 800, color: H.muted, spacing: 1.8 }));
      y += 26;
      const bottom = R.y + R.h - 20;
      for (const p of s.feed.slice(0, 8)) {
        const h = text(this, x0, y, p.handle, { size: 12, weight: 800, color: p.tone === 'bad' ? H.clay : p.tone === 'good' ? H.gold : H.paper });
        const b = text(this, x0, y + 18, p.text, { size: 12, weight: 600, color: H.muted, wrap: w, lineSpacing: 2 });
        if (y + 18 + b.height > bottom) { h.destroy(); b.destroy(); break; }
        add(h); add(b);
        y += 18 + b.height + 14;
      }
      if (!s.feed.length) add(text(this, x0, y, 'Quiet, for now.', { size: 12, weight: 600, color: H.muted }));
      this.hits.wire = { x: x0, y: R.y, w, h: R.h };
      return;
    }
    // phone: odds on the right of the strip, excuses as chips below
    const S = L.strip;
    if (this.ui.revealed.includes('odds')) {
      const bw = 150, bx = S.x + S.w - 12 - bw;
      add(text(this, bx, S.y + 7, 'NEXT', { size: 9, weight: 800, color: H.muted, spacing: 1.2 }));
      g.fillStyle(C.paper, 0.06); g.fillRect(bx, S.y + 20, bw, 6);
      oddsBar(bx, S.y + 20, bw, 6);
      add(text(this, bx + bw, S.y + 7, `C${Math.round(f.chop * 100)} U${Math.round(f.up * 100)} D${Math.round(f.down * 100)} N${Math.round(f.news * 100)}`, { size: 9.5, weight: 800, color: H.muted }).setOrigin(1, 0));
      this.hits.odds = { x: bx - 8, y: S.y, w: bw + 20, h: S.h };
    }
    if (this.ui.revealed.includes('hand')) {
      const R = L.hand;
      let x = R.x;
      const list = s.excuses.length ? s.excuses.map((e) => excuseDef(e).name) : ['No excuses in hand'];
      add(text(this, x, R.y + R.h / 2, 'EXCUSES', { size: 9.5, weight: 800, color: H.muted, spacing: 1.2 }).setOrigin(0, 0.5));
      x += 62;
      for (const name of list) {
        const t = text(this, 0, 0, name, { size: 10.5, weight: 800, color: s.excuses.length ? H.blush : H.muted });
        const tw = t.width + 18;
        if (x + tw > R.x + R.w) { t.destroy(); break; }
        roundRect(g, x, R.y, tw, R.h, 8, C.clay, s.excuses.length ? 0.12 : 0);
        strokeRect(g, x, R.y, tw, R.h, 8, s.excuses.length ? C.clay : C.line2, 1, s.excuses.length ? 0.45 : 1);
        t.setPosition(x + 9, R.y + R.h / 2).setOrigin(0, 0.5);
        add(t);
        x += tw + 6;
      }
      this.hits.excuses = { ...R };
    }
  }

  // ---------------------------------------------------------------- grid

  private gridRect(): Rect { return this.compact() && this.L.gridDraft ? this.L.gridDraft : this.L.grid; }

  private slotPos(i: number): { x: number; y: number } {
    const { cw, ch, gap } = this.L;
    const G = this.gridRect();
    const c = i % 5, r = Math.floor(i / 5);
    return { x: G.x + c * (cw + gap) + cw / 2, y: G.y + r * (ch + gap) + ch / 2 };
  }

  private buildGrid(): void {
    for (let i = 0; i < 20; i++) {
      const cv = new CardView(this, this.L.cw, this.L.ch).setDepth(DEPTH.cards);
      const p = this.slotPos(i);
      cv.place(p.x, p.y);
      cv.on('pointerup', () => this.onGridClick(i));
      cv.on('pointerover', () => { if (this.L.wide && cv.card && !this.busy && !this.overlay) this.showTip(i); });
      cv.on('pointerout', () => this.hideTip());
      this.cards.push(cv);
      this.hits[`slot${i}`] = { x: p.x - this.L.cw / 2, y: p.y - this.L.ch / 2, w: this.L.cw, h: this.L.ch };
    }
    this.hits.grid = { ...this.L.grid };
    this.placingG = this.add.graphics().setDepth(DEPTH.cards - 1);
  }
  private placingG!: Phaser.GameObjects.Graphics;
  private previewG: Phaser.GameObjects.Container | null = null;
  private compactBar: Phaser.GameObjects.Container | null = null;

  private renderGrid(): void {
    const s = this.ui.s;
    const placing = this.ui.selected !== null && s.phase === 'draft';
    this.placingG.clear();
    s.grid.forEach((c, i) => {
      const cv = this.cards[i];
      if (!cv) return;
      const p = this.slotPos(i);
      cv.glideTo(p.x, p.y);
      this.hits[`slot${i}`] = { x: p.x - this.L.cw / 2, y: p.y - this.L.ch / 2, w: this.L.cw, h: this.L.ch };
      cv.setCard(c);
      cv.dim = placing && !!c;
      if (placing && !c) {
        const p = this.slotPos(i);
        roundRect(this.placingG, p.x - this.L.cw / 2, p.y - this.L.ch / 2, this.L.cw, this.L.ch, 10, C.gold, 0.08);
        dashedRect(this.placingG, p.x - this.L.cw / 2, p.y - this.L.ch / 2, this.L.cw, this.L.ch, 10, C.gold, 0.9);
      }
    });
    this.hits.grid = { ...this.gridRect() };
    const GR = this.gridRect();
    const img = freeze(this.placingG, { x: GR.x - 4, y: GR.y - 4, w: GR.w + 8, h: GR.h + 8 });
    this.tweens.killTweensOf(img);
    img.setAlpha(1);
    if (placing) this.tweens.add({ targets: img, alpha: 0.45, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  // ---------------------------------------------------------------- action bar

  private buildBar(): void {
    const A = this.L.cta;
    const wide = this.L.wide;
    this.cta = new Button(this, A.x, A.y, A.w, A.h, 'OPEN MARKET', { ...STYLE.clay, size: wide ? 24 : 19, spacing: wide ? 4 : 2.6, sub: `Day ${this.ui.s.day}` }).setDepth(DEPTH.hud + 2);
    this.cta.onClick = () => void this.onTap();
    this.hits.cta = { ...A };
    const M = this.L.moves;
    if (M) {
      const s = this.ui.s;
      const legal = legalActions(s);
      const r1 = wide ? { x: M.x, y: M.y, w: 150, h: M.h } : { x: M.x, y: M.y, w: (M.w - 8) / 2, h: M.h };
      const r2 = wide ? { x: M.x + M.w - 150, y: M.y, w: 150, h: M.h } : { x: M.x + (M.w + 8) / 2, y: M.y, w: (M.w - 8) / 2, h: M.h };
      const mv = { fill: C.panel, deep: 0x050506, ink: H.gold, stroke: C.goldDeep, size: 12 };
      const sale = new Button(this, r1.x, r1.y, r1.w, r1.h, 'FLASH SALE', { ...mv, sub: `+${money(Math.round((BALANCE.flashBase + BALANCE.flashStep * s.payroll.cycle) * (s.founder === 'hustler' ? 1.5 : 1)))} · −Trust` }).setDepth(DEPTH.hud + 2);
      sale.setEnabled(legal.some((a) => a.type === 'flashSale'));
      sale.onClick = () => { if (this.gate('sale')) this.act({ type: 'flashSale' }, 'Flash sale. Cash in, strangers in.'); };
      const loan = new Button(this, r2.x, r2.y, r2.w, r2.h, 'FOUNDER LOAN', { ...mv, sub: `+${money(s.payroll.amount)} · owe ${money(Math.round(s.payroll.amount * 1.6))}` }).setDepth(DEPTH.hud + 2);
      loan.setEnabled(legal.some((a) => a.type === 'loan'));
      loan.onClick = () => { if (this.gate('loan')) this.act({ type: 'loan' }, 'Loan taken. It comes back with interest.'); };
      this.moveBtns = [sale, loan];
      this.hits.moves = { ...M };
      if (!this.seenTip('moves')) this.time.delayedCall(400, () => void this.tipOnce('moves', 'Short on payroll. Desperate moves keep you alive tonight, and they always cost you later.', 'moves'));
    }
  }

  private renderBar(): void {
    const s = this.ui.s;
    const show = s.phase === 'morning';
    this.cta.setVisible(show);
    this.cta.setLabel('OPEN MARKET', `Day ${s.day}${this.ui.mode !== 'tutorial' && this.L.wide ? ' · space' : ''}`);
    this.moveBtns.forEach((b) => b.setVisible(show));
    if (this.desperate() !== !!this.L.moves) this.requestRebuild();
  }

  private renderAll(): void {
    const s = this.ui.s;
    const ids: string[] = [];
    for (const c of s.grid) if (c && (c.revealed || !cardDef(c.def).disguise)) ids.push(c.def);
    for (const o of s.offers) { if (o.kind === 'excuse') ids.push(`x:${o.id}`); else if (!cardDef(o.id).disguise) ids.push(o.id); }
    for (const e of s.excuses) ids.push(`x:${e}`);
    if (this.ui.mode !== 'tutorial' || ids.length) markSeen(ids);
    this.renderHud();
    this.renderRow();
    this.renderGrid();
    this.renderBar();
    this.renderShop();
  }

  // ---------------------------------------------------------------- frame loop: springs, shader uniforms

  update(_t: number, dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);
    this.clock += dt;
    for (const [key, sp] of Object.entries(this.boxSprings)) {
      const v = sp.step(dt);
      const target = key === 'base' ? this.chipBox : key === 'mult' ? this.multBox : this.todayBox;
      target?.setScale(v).setRotation((1 - v) * 0.4);
    }
    this.alarmImg?.setAlpha(this.urgent ? 0.45 + 0.55 * Math.abs(Math.sin(this.clock * 3.2)) : 0);
    if (this.hot) this.hud.heat?.setScale(1 + 0.05 * Math.sin(this.clock * 6));
    this.pulse.a *= Math.pow(0.12, dt);
    this.spin += dt * (0.02 + this.pulse.a * 0.5);
    this.bg?.setUniform('uSpin.value', this.spin);
    this.bg?.setUniform('uPulse.value', { x: this.pulse.r, y: this.pulse.g, z: this.pulse.b, w: this.pulse.a });
    if (this.crt) { this.crt.dpr = Math.max(1, this.L.k); this.crt.shake *= Math.pow(0.02, dt); }
    if (this.fire && this.fire.emitting) {
      const b = this.todayBox.getBounds();
      this.fire.setPosition(b.centerX, b.top + b.height * 0.3);
    }
  }

  private bump(key: string, amt = 1): void { this.boxSprings[key]?.kick(4 * amt); const sp = this.boxSprings[key]; if (sp) sp.x = 1 + 0.18 * amt; }
  private pulseBg(color: number, amt: number): void {
    this.pulse = { r: ((color >> 16) & 255) / 255, g: ((color >> 8) & 255) / 255, b: (color & 255) / 255, a: Math.min(1.2, this.pulse.a + amt) };
  }
  private shake(strength: number): void {
    if (!J.motionOk() || strength <= 0) return;
    this.cameras.main.shake(160 + 260 * strength, 0.002 + 0.008 * strength);
    if (this.crt) this.crt.shake = Math.max(this.crt.shake, strength);
  }

  // ---------------------------------------------------------------- actions

  newGame(mode: Mode): void {
    this.guideStop();
    this.ui = freshUi(mode, this.ui.founder, this.ui.stake);
    this.shownCash = this.ui.s.cash;
    this.closeOverlay();
    this.build();
    if (mode === 'tutorial') void this.tutorial();
  }

  private act(a: Action, toast?: string): void {
    if (this.busy) return;
    J.unlockAudio();
    const prev = this.ui.s;
    this.ui.s = step(this.ui.s, a);
    this.book(a, prev, this.ui.s);
    if (a.type === 'flashSale' || a.type === 'loan') { J.cashOut(); this.pulseBg(C.gold, 0.8); this.animateCash(prev.cash, this.ui.s.cash, 420); }
    if (toast) this.toast(toast);
    this.afterStep(prev);
  }

  /** File a cash movement under the right line of this cycle's receipt. */
  private book(a: Action, prev: GameState, next: GameState): void {
    const L = this.ui.ledger;
    let d = next.cash - prev.cash;
    const paid = next.payroll.cycle > prev.payroll.cycle ? this.dueOf(prev) : 0;
    d += paid;
    if (a.type === 'tap') L.fees += d;
    else if (a.type === 'payout') L.payouts += d;
    else if (a.type === 'draft' || a.type === 'reroll') L.hires += d;
    else L.moves += d;
    if (paid) {
      this.ui.cashout = { ledger: { ...L }, paid, cycle: prev.payroll.cycle, crisis: prev.crisis };
      this.ui.ledger = { start: next.cash, fees: 0, payouts: 0, hires: 0, moves: 0 };
    }
  }
  private dueOf(s: GameState): number {
    return s.payroll.amount + (s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0);
  }

  private afterStep(prev: GameState): void {
    const s = this.ui.s;
    const paid = s.payroll.cycle > prev.payroll.cycle;
    if (paid) {
      J.thud(); J.buzz([30, 40, 30]); this.shake(0.45); this.pulseBg(C.clay, 0.6);
    }
    if (s.phase !== 'dead') this.shownCash = s.cash;
    this.renderAll();
    if (s.phase === 'dead') this.showDeath();
    else if (paid && this.ui.cashout) this.showCashout();
    else if (s.phase === 'quarter') this.showQuarter();
    this.maybeTips();
  }

  private chooseOffer(i: number): void {
    const o = this.ui.s.offers[i];
    if (!o || this.busy) return;
    if (this.ui.s.cash < offerPrice(o, this.ui.s)) { J.loss(); this.toast(`Can't afford ${offerName(o)} · ${money(offerPrice(o, this.ui.s))}`); return; }
    if (!this.gate('select')) return;
    J.unlockAudio(); J.tick();
    if (o.kind === 'excuse' || o.id === 'botfarm') {
      this.act({ type: 'draft', pick: i }, o.kind === 'excuse' ? `${offerName(o)} added to your excuses` : 'Bulk order placed');
      this.emit('drafted');
      return;
    }
    this.ui.selected = i;
    this.renderGrid(); this.renderShop();
    this.emit('select');
  }

  private onGridClick(i: number): void {
    if (this.busy || (this.overlay && this.overlayKind !== '')) return;
    const s = this.ui.s;
    if (s.phase === 'draft' && this.ui.selected !== null) {
      if (!this.gate('place')) return;
      const existing = s.grid[i];
      if (existing && this.ui.mode === 'tutorial') return;
      if (existing && this.replaceArmed !== i) {
        this.replaceArmed = i;
        this.toast(`Tap again to replace it · ${money(BALANCE.severance)} severance`);
        this.time.delayedCall(2500, () => { if (this.replaceArmed === i) this.replaceArmed = -1; });
        return;
      }
      this.replaceArmed = -1;
      const pick = this.ui.selected;
      this.ui.selected = null;
      J.tick(); J.buzz(8);
      this.act({ type: 'draft', pick, slot: i }, existing ? 'Replaced' : undefined);
      this.cards[i]?.drop();
      J.thud();
      const p = this.slotPos(i);
      this.burst?.explode(18, u(p.x), u(p.y));
      this.emit('placed'); this.emit('drafted');
      return;
    }
    const card = s.grid[i];
    if (card && this.gate('info')) { this.hideTip(); this.showInfo(card); }
  }

  private onSpace(): void {
    if (this.busy) { this.fast = true; return; }
    if (this.overlayKind === 'death') { this.newGame('random'); return; }
    if (this.ui.s.phase === 'morning' && !this.overlay && !this.guideNow) void this.onTap();
  }

  // ---------------------------------------------------------------- the day (Balatro-style scoring)

  async onTap(): Promise<void> {
    if (this.busy || this.ui.s.phase !== 'morning' || !this.gate('tap')) return;
    J.unlockAudio();
    this.busy = true;
    this.fast = false;
    this.hideGuide();
    this.hideTip();
    this.cta.setEnabled(false);
    const prev = this.ui.s;
    const next = step(prev, { type: 'tap' });
    const report = next.lastReport;
    if (!report) { this.busy = false; return; }

    const banner = await this.printCandle(report.candle);

    // The Balatro count: every fee lands, then every mult fires. Both boxes really build.
    const sc: Score = { base: 0, mult: report.baseMult, today: 0 };
    this.ui.score = sc;
    this.setScore(sc);
    const slotOf = (uid: number): number => prev.grid.findIndex((c) => c?.uid === uid);
    const feeEvents = report.events.filter((e) => e.fees !== undefined);
    const multEvents = report.events.filter((e) => e.fees === undefined);
    let k = 0;
    for (const e of feeEvents) {
      const i = slotOf(e.uid);
      sc.base = e.totalFees;
      sc.today = Math.round(sc.base * sc.mult);
      this.setScore(sc);
      const fee = e.fees ?? 0;
      if (fee > 0) {
        this.bump('base', 0.7);
        this.cards[i]?.pop(0.8);
        this.chip(i, `+${fee}`, C.chip, H.chipInk);
        J.chip(k, feeEvents.length);
      } else {
        this.cards[i]?.pop(1.2);
        this.chip(i, `−$${Math.abs(fee)}`, C.ink, H.clay);
        J.loss(); J.buzz([20, 30, 20]); this.shake(0.15);
      }
      k++;
      await this.beat(Math.max(55, 150 - k * 9));
    }
    if (multEvents.length) await this.beat(140);
    let m = 0;
    for (const e of multEvents) {
      const i = slotOf(e.uid);
      sc.mult = e.mult;
      sc.today = Math.round(sc.base * sc.mult);
      this.setScore(sc);
      const times = e.times !== undefined;
      this.bump('mult', times ? 1.5 : 1);
      this.cards[i]?.pop(times ? 1.5 : 1.1);
      this.chip(i, times ? `×${e.times}` : `+${e.add} Mult`, C.clay, H.clayInk, times);
      J.mult(m, times);
      if (times) { this.shake(0.25); this.pulseBg(C.clay, 0.5); }
      m++;
      await this.beat(times ? 300 : Math.max(110, 230 - m * 15));
    }
    // fees x mult: slam the total
    await this.beat(120);
    sc.today = report.income;
    this.setScore(sc);
    this.bump('today', 1.6);
    const record = report.income > this.ui.bestIncome && prev.day > 3;
    if (report.income > this.ui.bestIncome) this.ui.bestIncome = report.income;
    this.ui.tape.push(report.candle);
    const scale = Math.min(1, Math.abs(report.income) / Math.max(200, prev.payroll.amount * 0.5));
    J.total(scale, report.income < 0);
    this.shake(0.15 + scale * 0.6);
    this.pulseBg(report.income >= 0 ? C.gold : C.clay, 0.3 + scale);
    if (record) {
      this.fire?.start();
      J.fanfare();
      this.time.delayedCall(2400, () => this.fire?.stop());
      this.toast('Record day');
    }
    this.animateCash(prev.cash, next.cash, this.fast ? 200 : 520);
    await this.beat(560);
    this.tweens.add({ targets: banner, alpha: 0, duration: 160, onComplete: () => banner.destroy() });

    this.book({ type: 'tap' }, prev, next);
    this.ui.s = next;
    this.shownCash = next.cash;
    this.busy = false;
    this.cta.setEnabled(true);
    this.renderAll();
    for (const uid of report.spawned) {
      const i = next.grid.findIndex((c) => c?.uid === uid);
      if (i >= 0) this.cards[i]?.drop();
    }
    this.emit('tap-done');
    if (next.phase === 'payout') {
      J.alarm(); J.buzz([40, 60, 40]); this.pulseBg(C.gold, 0.6);
      await J.wait(250);
      this.openPayout();
    } else if (next.phase === 'dead') {
      this.showDeath();
    }
    this.maybeTips();
  }

  /** Wait one beat of the scoring; a tap or space during the count speeds it up. */
  private beat(ms: number): Promise<void> { return J.wait(this.fast ? Math.min(ms, 28) : ms); }
  private fast = false;

  /** Print today's candle in the market strip: it grows with ticks, then lands. The book stays in view. */
  private async printCandle(c: Candle): Promise<Phaser.GameObjects.Container> {
    const { wide } = this.L;
    const S = this.L.strip;
    const layer = this.add.container(0, 0).setDepth(DEPTH.fly - 1);
    // desktop: over the middle of the market strip; phone: over the excuses row, so the score stays in view
    const bw = wide ? 360 : S.w, bh = wide ? 64 : 40;
    const bx = wide ? this.L.grid.x + this.L.grid.w / 2 - bw / 2 : S.x, by = wide ? S.y : this.L.hand.y - 6;
    const g = this.add.graphics();
    roundRect(g, bx, by, bw, bh, wide ? 16 : 12, C.ink, 0.96);
    strokeRect(g, bx, by, bw, bh, wide ? 16 : 12, C.line2, 1);
    const candle = this.add.graphics();
    const cx = bx + (wide ? 40 : 26), cy = by + bh / 2;
    const label = text(this, cx + (wide ? 32 : 22), cy - (wide ? 9 : 0), '', { size: wide ? 24 : 17, weight: 800, spacing: wide ? 3 : 2 }).setOrigin(0, 0.5);
    const sub = text(this, cx + 32, cy + 16, '', { size: 11, weight: 800, color: H.muted, spacing: 1.4 }).setOrigin(0, 0.5);
    if (!wide) sub.setVisible(false);
    layer.add([g, candle, label, sub]);
    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 90 });
    const hMax = bh - 18;
    const draw = (h: number, color: number): void => {
      candle.clear();
      candle.fillStyle(color, 1);
      candle.fillRoundedRect(cx - 1.5, cy - hMax / 2, 3, hMax, 1.5);
      candle.fillRoundedRect(cx - (wide ? 9 : 7), cy - h / 2, wide ? 18 : 14, h, 3);
    };
    const ticks = this.fast ? 1 : 4;
    for (let t = 0; t < ticks; t++) {
      draw(6 + (t % 2 ? hMax * 0.55 : hMax * 0.2), C.muted);
      J.tick(t);
      await J.wait(70);
    }
    const color = CANDLE_COLOR[c];
    draw(c === 'chop' ? hMax * 0.25 : c === 'news' ? hMax * 0.95 : hMax * 0.7, color);
    label.setText(CANDLE[c]).setColor(c === 'down' ? H.clay : c === 'news' ? H.gold : H.paper);
    sub.setText(CANDLE_SUB[c].toUpperCase());
    J.candle(c);
    J.buzz(c === 'chop' ? 10 : 30);
    this.pulseBg(color, c === 'chop' ? 0.25 : 0.5);
    if (c !== 'chop') this.shake(c === 'news' ? 0.3 : 0.18);
    label.setScale(1.35);
    this.tweens.add({ targets: label, scale: 1, duration: 220, ease: 'Back.easeOut' });
    await this.beat(260);
    return layer;
  }

  /** A chip that pops off a card: blue fees, clay mult. */
  private chip(i: number, str: string, fill: number, ink: string, big = false): void {
    const p = this.slotPos(i);
    if (i < 0) return;
    const wide = this.L.wide;
    const t = text(this, 0, 0, str, { size: (wide ? 15 : 12) * (big ? 1.3 : 1), weight: 800, color: ink }).setOrigin(0.5);
    const w = Math.ceil(t.width + 16), h = Math.round((wide ? 28 : 22) * (big ? 1.25 : 1));
    const key = bakeShape(this, `chip:${w}x${h}:${fill}`, w, h + 3, (g) => { roundRect(g, 0, 3, w, h, 9, 0x000000, 0.35); roundRect(g, 0, 0, w, h, 9, fill); });
    const bg = this.add.image(0, 1.5, key).setDisplaySize(w, h + 3);
    const c = this.add.container(p.x, p.y - this.L.ch * 0.38, [bg, t]).setDepth(DEPTH.fly);
    c.setScale(0.3).setAlpha(0).setAngle((Math.random() - 0.5) * 16);
    this.tweens.add({ targets: c, scale: 1, alpha: 1, angle: 0, y: c.y - (wide ? 26 : 18), duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, y: c.y - (wide ? 50 : 34), alpha: 0, delay: this.fast ? 200 : 560, duration: 260, ease: 'Quad.easeIn', onComplete: () => c.destroy() });
  }

  private animateCash(from: number, to: number, ms: number): void {
    const o = { v: from };
    this.tweens.add({ targets: o, v: to, duration: ms, ease: 'Cubic.easeOut', onUpdate: () => this.setCash(o.v), onComplete: () => { this.setCash(to); this.renderHud(); } });
  }

  // ---------------------------------------------------------------- shop

  /** On phones the shop needs the lower half: the HUD folds into one bar and the book slides up. */
  private compact(): boolean { return !this.L.wide && this.ui.s.phase === 'draft'; }

  private renderShop(): void {
    const s = this.ui.s;
    const wasOpen = !!this.shop;
    this.shop?.destroy();
    this.shop = null;
    this.previewG?.destroy(); this.previewG = null;
    for (const k of Object.keys(this.hits)) if (k === 'shop' || k === 'offers' || k === 'reroll' || k === 'skip' || k === 'back' || k.startsWith('offer')) delete this.hits[k];
    if (s.phase !== 'draft') return;
    const { wide } = this.L;
    const P = this.L.shopPanel;
    const root = this.add.container(0, 0).setDepth(DEPTH.shop);
    this.shop = root;
    const g = this.add.graphics();
    const extra = wide ? 0 : Math.max(0, this.L.view.y + this.L.view.h - this.L.H) + 24;
    roundRect(g, P.x, P.y, P.w, P.h + extra, 20, C.panel, 0.98);
    strokeRect(g, P.x, P.y, P.w, P.h + extra, 20, this.ui.selected !== null ? C.goldDeep : C.line2, 1);
    root.add(g);
    const pad = wide ? 20 : 12;
    if (this.ui.selected !== null) this.renderPlacing(root, P, pad);
    else this.renderOffers(root, P, pad);
    this.hits.shop = { ...P };
    if (!wasOpen) {
      if (wide) { root.x = P.w + 40; this.tweens.add({ targets: root, x: 0, duration: 320, ease: 'Back.easeOut', easeParams: [0.8] }); }
      else { root.y = P.h; this.tweens.add({ targets: root, y: 0, duration: 320, ease: 'Back.easeOut', easeParams: [0.8] }); }
      J.whoosh(true);
    }
  }

  private renderOffers(root: Phaser.GameObjects.Container, P: Rect, pad: number): void {
    const s = this.ui.s;
    const { wide } = this.L;
    root.add(text(this, P.x + pad, P.y + pad, 'HIRING FLOOR', { size: wide ? 13 : 12, weight: 800, spacing: 3 }));
    const left = Math.max(0, s.payroll.dueDay - s.day);
    root.add(text(this, P.x + P.w - pad, P.y + pad + 1, `payroll ${money(s.payroll.amount)} in ${left}d`, { size: wide ? 12 : 11, weight: 700, color: H.muted }).setOrigin(1, 0));
    const top = P.y + pad + (wide ? 34 : 28);
    const btnH = wide ? 52 : 48;
    const n = Math.max(1, s.offers.length);
    if (wide) {
      // stacked, landscape cards
      const gap = 14, oh = Math.min(216, (P.h - (top - P.y) - btnH - pad - 16 - gap * (n - 1)) / n);
      s.offers.forEach((o, i) => {
        const oy = top + i * (oh + gap);
        root.add(this.offerCard(o, i, P.x + pad, oy, P.w - 2 * pad, oh, true));
        this.hits[`offer${i}`] = { x: P.x + pad, y: oy, w: P.w - 2 * pad, h: oh };
      });
    } else {
      const gap = 8, ow = (P.w - 2 * pad - gap * 2) / 3;
      const oh = Math.min(240, P.h - (top - P.y) - btnH - pad - 14);
      s.offers.forEach((o, i) => {
        const ox = P.x + pad + i * (ow + gap);
        root.add(this.offerCard(o, i, ox, top, ow, oh, false));
        this.hits[`offer${i}`] = { x: ox, y: top, w: ow, h: oh };
      });
    }
    this.hits.offers = { x: P.x + pad, y: top, w: P.w - 2 * pad, h: P.y + P.h - btnH - pad - top };
    const by = P.y + P.h - pad - btnH, bw = (P.w - 2 * pad - 10) / 2;
    const rr = new Button(this, P.x + pad, by, bw, btnH, `REROLL ${money(rerollPrice(s))}`, { ...STYLE.dark, size: 12 });
    rr.setEnabled(s.cash >= rerollPrice(s));
    rr.onClick = () => { if (!this.gate('reroll')) return; J.flip(); this.act({ type: 'reroll' }); };
    const sk = new Button(this, P.x + pad + bw + 10, by, bw, btnH, 'NEXT DAY', { ...STYLE.gold, size: 12, sub: 'skip hiring' });
    sk.onClick = () => { if (!this.gate('skip')) return; this.act({ type: 'draft', pick: null }); this.emit('drafted'); };
    root.add([rr, sk]);
    this.hits.reroll = { x: P.x + pad, y: by, w: bw, h: btnH };
    this.hits.skip = { x: P.x + pad + bw + 10, y: by, w: bw, h: btnH };
  }

  /** Placing a hire: the card on the left, and every empty slot on the book shows what it would earn there. */
  private renderPlacing(root: Phaser.GameObjects.Container, P: Rect, pad: number): void {
    const s = this.ui.s;
    const { wide } = this.L;
    const o = s.offers[this.ui.selected ?? -1];
    if (!o) return;
    root.add(text(this, P.x + pad, P.y + pad, `PLACE ${offerName(o).toUpperCase()}`, { size: wide ? 14 : 12.5, weight: 800, spacing: 2, color: H.gold, wrap: P.w - 2 * pad }));
    const btnH = wide ? 52 : 48;
    const by = P.y + P.h - pad - btnH, bw = (P.w - 2 * pad - 10) / 2;
    const top = P.y + pad + (wide ? 34 : 28);
    if (wide) {
      const oh = Math.min(260, by - top - 80);
      root.add(this.offerCard(o, this.ui.selected ?? 0, P.x + pad, top, P.w - 2 * pad, oh, true, true));
      root.add(text(this, P.x + pad, top + oh + 18, 'Tap a slot on the book. The number on each slot is what this hire adds to an average day there.', { size: 12.5, weight: 600, color: H.muted, wrap: P.w - 2 * pad, lineSpacing: 3 }));
    } else {
      const oh = Math.min(170, by - top - 46);
      root.add(this.offerCard(o, this.ui.selected ?? 0, P.x + pad, top, P.w - 2 * pad, oh, true, true));
      root.add(text(this, P.x + pad, top + oh + 12, 'Tap a slot. Each shows what this hire adds to an average day there.', { size: 11.5, weight: 600, color: H.muted, wrap: P.w - 2 * pad }));
    }
    const back = new Button(this, P.x + pad, by, bw, btnH, 'BACK', { ...STYLE.dark, size: 12 });
    back.onClick = () => { this.ui.selected = null; this.renderGrid(); this.renderShop(); };
    const skip = new Button(this, P.x + pad + bw + 10, by, bw, btnH, 'NEXT DAY', { ...STYLE.dark, size: 12, sub: 'skip hiring' });
    skip.onClick = () => { if (!this.gate('skip')) return; this.ui.selected = null; this.act({ type: 'draft', pick: null }); this.emit('drafted'); };
    root.add([back, skip]);
    this.hits.back = { x: P.x + pad, y: by, w: bw, h: btnH };
    this.hits.skip = { x: P.x + pad + bw + 10, y: by, w: bw, h: btnH };
    // the preview: +$/day on every empty slot, best one in gold
    if (o.kind !== 'card') return;
    const id = cardDef(o.id).disguise ? 'retail' : o.id;
    const now = expectedTake(s);
    const deltas = s.grid.map((c, i) => (c ? null : previewPlacement(s, id, i) - now));
    const vals = deltas.filter((d): d is number => d !== null);
    const best = Math.max(...vals);
    // only crown a slot that actually beats the others
    const crown = best > 0 && vals.filter((d) => d === best).length < vals.length ? best : Infinity;
    const pg = this.add.graphics().setDepth(DEPTH.cards + 5);
    this.previewG = this.add.container(0, 0).setDepth(DEPTH.cards + 6);
    this.previewG.add(pg);
    deltas.forEach((d, i) => {
      if (d === null) return;
      const p = this.slotPos(i);
      const top1 = d === crown;
      const str = `${d >= 0 ? '+' : '−'}$${Math.abs(d)}`;
      const t = text(this, p.x, p.y - 6, str, { size: (wide ? 20 : 14) * (top1 ? 1.15 : 1), weight: 800, color: top1 ? H.ink : d > 0 ? H.gold : H.muted }).setOrigin(0.5);
      const sub = text(this, p.x, p.y + (wide ? 14 : 10), 'A DAY', { size: wide ? 9.5 : 7.5, weight: 800, color: top1 ? H.ink : H.muted, spacing: 1.2 }).setOrigin(0.5);
      if (top1) roundRect(pg, p.x - this.L.cw / 2 + 6, p.y - (wide ? 24 : 18), this.L.cw - 12, wide ? 50 : 38, 10, C.gold, 0.95);
      this.previewG?.add([t, sub]);
    });
  }

  private offerCard(o: Offer, i: number, x: number, y: number, w: number, h: number, landscape: boolean, still = false): Phaser.GameObjects.Container {
    const s = this.ui.s;
    const price = offerPrice(o, s);
    const broke = s.cash < price;
    const rarity = offerRarity(o);
    const look = offerLook(o);
    const c = this.add.container(x + w / 2, y + h / 2);
    const g = this.add.graphics();
    const r = 14;
    roundRect(g, -w / 2 + 1, -h / 2 + 7, w, h, r, 0x000000, 0.5);
    roundRect(g, -w / 2, -h / 2 + 3, w, h, r, C.paper3);
    roundRect(g, -w / 2, -h / 2, w, h, r, C.paper);
    const bandH = landscape ? 30 : 24;
    g.fillStyle(look.band, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, bandH, { tl: r, tr: r, bl: 0, br: 0 });
    if (rarity === 'rare') strokeRect(g, -w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, r - 1, C.gold, 3);
    c.add(g);
    const pad = landscape ? 14 : 8;
    c.add(text(this, -w / 2 + pad, -h / 2 + bandH / 2, `${rarity === 'rare' ? 'RARE ' : ''}${look.label}`, { size: landscape ? 10 : 8, weight: 800, color: look.ink, spacing: 1.4 }).setOrigin(0, 0.5));
    if (look.stat) c.add(text(this, w / 2 - pad - (landscape ? 0 : 0), -h / 2 + bandH / 2, look.stat, { size: landscape ? 13 : 10, weight: 800, color: look.ink }).setOrigin(1, 0.5));
    const body = offerBlurb(o);
    if (landscape) {
      const artS = Math.min(h - bandH - 24, w * 0.32);
      c.add(this.add.image(-w / 2 + pad + artS / 2, -h / 2 + bandH + 10 + artS / 2, artTexture(this, offerArt(o))).setDisplaySize(artS, artS));
      const tx = -w / 2 + pad + artS + 14, tw = w / 2 - pad - tx;
      const nm = text(this, tx, -h / 2 + bandH + 10, offerName(o), { size: 17, weight: 800, color: H.ink, wrap: tw });
      c.add(nm);
      const bt = text(this, tx, nm.y + nm.height + 4, body, { size: 12.5, weight: 600, color: H.inkSoft, wrap: tw, lineSpacing: 1.5 });
      if (bt.y + bt.height > h / 2 - 34) bt.setFontSize(11.5);
      c.add(bt);
    } else {
      const artS = Math.min(w * 0.62, h * 0.32);
      c.add(this.add.image(0, -h / 2 + bandH + 6 + artS / 2, artTexture(this, offerArt(o))).setDisplaySize(artS, artS));
      const ny = -h / 2 + bandH + 10 + artS;
      const nm = text(this, -w / 2 + pad, ny, offerName(o), { size: 12, weight: 800, color: H.ink, wrap: w - 2 * pad });
      c.add(nm);
      const bt = text(this, -w / 2 + pad, ny + nm.height + 2, body, { size: 9.5, weight: 600, color: H.inkSoft, wrap: w - 2 * pad, lineSpacing: 1 });
      // trim the blurb to the card
      const maxH = h / 2 - 30 - bt.y;
      let words = body.split(' ');
      while (bt.height > maxH && words.length > 3) { words = words.slice(0, -1); bt.setText(`${words.join(' ')}…`); }
      c.add(bt);
    }
    // price
    const pt = text(this, 0, 0, price === 0 ? 'FREE' : money(price), { size: landscape ? 16 : 12.5, weight: 800, color: broke ? H.clay : H.ink }).setOrigin(0.5);
    const bw = pt.width + 18, bh = landscape ? 30 : 24;
    const px = w / 2 - bw / 2 - pad + 4, py = h / 2 - bh / 2 - (landscape ? 10 : 6);
    const pg = this.add.graphics();
    roundRect(pg, px - bw / 2, py - bh / 2 + 3, bw, bh, 9, broke ? C.panel2 : C.goldDeep);
    roundRect(pg, px - bw / 2, py - bh / 2, bw, bh, 9, broke ? C.panel2 : C.gold);
    if (broke) strokeRect(pg, px - bw / 2, py - bh / 2, bw, bh, 9, C.clay, 1);
    pt.setPosition(px, py);
    c.add([pg, pt]);
    if (broke && !still) {
      c.add(text(this, -w / 2 + pad, h / 2 - (landscape ? 18 : 12), "CAN'T AFFORD", { size: landscape ? 10 : 8, weight: 800, color: H.clayDeep, spacing: 1.2 }).setOrigin(0, 0.5));
      c.setAlpha(0.6);
    }
    if (still) return c;
    // springy hover, sway, deal-in
    const sc = new Spring(1, 1, 300, 16), lift = new Spring(0, 0, 300, 20), ph = Math.random() * 6;
    let t = 0;
    const tick = (_time: number, dtMs: number): void => {
      const dt = Math.min(0.05, dtMs / 1000); t += dt;
      c.setScale(sc.step(dt));
      c.y = y + h / 2 + lift.step(dt) + Math.sin(t * 1.4 + ph) * 1.5;
      c.rotation = Math.sin(t * 1.1 + ph) * (landscape ? 0.004 : 0.01);
    };
    this.events.on('update', tick);
    c.once('destroy', () => this.events.off('update', tick));
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerover', () => { sc.target = 1.04; lift.target = -6; if (!broke) J.tick(i); });
    c.on('pointerout', () => { sc.target = 1; lift.target = 0; });
    c.on('pointerup', () => { sc.x = 0.94; sc.kick(3); this.chooseOffer(i); });
    c.setScale(0.6);
    this.time.delayedCall(i * 70, () => { sc.kick(4); J.flip(); });
    return c;
  }

  // ---------------------------------------------------------------- overlays

  private closeOverlay(): void {
    this.overlay?.destroy();
    this.overlay = null;
    this.overlayKind = '';
    for (const k of Object.keys(this.hits)) if (k.startsWith('ov:')) delete this.hits[k];
  }

  /** A modal: dims the game and builds content into a panel. Returns the content container. */
  private modal(kind: string, width: number, build: (c: Phaser.GameObjects.Container, w: number) => number, opts: { paper?: boolean; center?: boolean } = {}): { root: Phaser.GameObjects.Container; content: Phaser.GameObjects.Container; x: number; y: number } {
    this.closeOverlay();
    const { W, H: Hh, wide, view: V } = this.L;
    const root = this.add.container(0, 0).setDepth(DEPTH.overlay);
    const dim = this.add.rectangle(V.x, V.y, V.w, V.h, C.ink, 0.74).setOrigin(0).setInteractive();
    root.add(dim);
    const pw = Math.min(width, W - (wide || opts.center ? 28 : 0));
    const content = this.add.container(0, 0);
    const h = build(content, pw);
    const center = wide || opts.center;
    const px = (W - pw) / 2, py = center ? Math.max(14, (Hh - h) / 2) : Hh - h;
    const g = this.add.graphics();
    if (opts.paper) { roundRect(g, 0, 8, pw, h, 18, 0x000000, 0.5); roundRect(g, 0, 0, pw, h, 18, C.paper); }
    else { const ext = center ? 0 : Math.max(0, V.y + V.h - Hh) + 20; roundRect(g, 0, 0, pw, h + ext, 20, C.panel); strokeRect(g, 0, 0, pw, h + ext, 20, C.line2, 1); }
    content.addAt(g, 0);
    content.setPosition(u(px), u(py));
    root.add(content);
    this.overlay = root;
    this.overlayKind = kind;
    content.setAlpha(0);
    content.y += u(50);
    this.tweens.add({ targets: content, alpha: 1, y: u(py), duration: 280, ease: 'Back.easeOut', easeParams: [1.1] });
    return { root, content, x: px, y: py };
  }

  private hit(name: string, ox: number, oy: number, r: Rect): void { this.hits[`ov:${name}`] = { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h }; }

  openPayout(): void {
    const s = this.ui.s;
    const req = s.queue[0];
    if (!req) return;
    const found = findCard(s, req.uid);
    if (!found) return;
    const { card } = found;
    const def = cardDef(card.def);
    const legal = legalActions(s);
    const canPay = legal.some((a) => a.type === 'payout' && a.decision === 'pay');
    const canStall = legal.some((a) => a.type === 'payout' && a.decision === 'stall');
    const days = s.payroll.dueDay - s.day;
    const after = s.cash - req.amount;
    const exposed = card.revealed && !!def.fraud;
    const pad = 18;
    const rects: Record<string, Rect> = {};
    let amountText: Phaser.GameObjects.Text | null = null;
    let cardView: CardView | null = null;
    const m = this.modal('payout', 540, (c, w) => {
      let y = pad;
      c.add(text(this, pad, y, `PAYOUT REQUEST${s.queue.length > 1 ? ` · ${s.queue.length} WAITING` : ''}`, { size: 10.5, weight: 800, color: H.muted, spacing: 1.8 }));
      y += 40;
      const cw = 100, ch = 138;
      cardView = new CardView(this, cw, ch).setCard(card);
      cardView.sway = false;
      cardView.place(pad + cw / 2, y + ch / 2);
      cardView.disableInteractive();
      c.add(cardView);
      rects.pcard = { x: pad, y, w: w - 2 * pad, h: ch };
      const tx = pad + cw + 16, tw = w - tx - pad;
      c.add(text(this, tx, y + 2, displayName(card), { size: 19, weight: 800 }));
      c.add(text(this, tx, y + 30, `${card.age} day${card.age === 1 ? '' : 's'} on the book${card.payouts ? ` · paid ${card.payouts}× before` : ''}${card.stalls ? ` · stalled ${card.stalls}/2` : ''}`, { size: 12, weight: 600, color: H.muted, wrap: tw }));
      c.add(text(this, tx, y + 50, exposed ? `Exposed ${def.name.toLowerCase()}. You have evidence, so denying costs no Trust.` : 'Passed your challenge and wants paying.', { size: 12, weight: 600, color: exposed ? H.clay : H.muted, wrap: tw }));
      amountText = text(this, tx, y + ch - 44, '$0', { size: 40, weight: 800, color: H.gold });
      c.add(amountText);
      y += ch + 14;
      const cons = text(this, pad, y, `Cash ${money(s.cash)} → ${money(after)} if you pay. Payroll ${money(s.payroll.amount)} ${days <= 0 ? 'tonight' : `in ${days} day${days === 1 ? '' : 's'}`}.`, { size: 12.5, weight: 700, color: after < s.payroll.amount ? H.blush : H.muted, wrap: w - 2 * pad });
      c.add(cons);
      y += cons.height / u(1) + 14;
      const bw = (w - 2 * pad - 10);
      const pay = new Button(this, pad, y, bw * 0.58, 56, canPay ? 'PAY' : 'NO CASH', { ...STYLE.gold, size: 17, spacing: 3 });
      pay.setEnabled(canPay);
      pay.onClick = () => { if (this.gate('pay')) void this.decide({ type: 'payout', decision: 'pay' }, 'PAID'); };
      const stall = new Button(this, pad + bw * 0.58 + 10, y, bw * 0.42, 56, 'STALL 3 DAYS', { ...STYLE.dark, size: 11.5 });
      stall.setEnabled(canStall);
      stall.onClick = () => { if (this.gate('stall')) void this.decide({ type: 'payout', decision: 'stall' }, 'STALLED'); };
      c.add([pay, stall]);
      rects.pact = { x: pad, y, w: w - 2 * pad, h: 56 };
      rects.pay = { x: pad, y, w: bw * 0.58, h: 56 };
      rects.stall = { x: pad + bw * 0.58 + 10, y, w: bw * 0.42, h: 56 };
      y += 70;
      c.add(text(this, pad, y, 'OR DENY WITH', { size: 10.5, weight: 800, color: H.muted, spacing: 1.8 }));
      y += 22;
      const ex = [...new Set(s.excuses)];
      const ew = (w - 2 * pad - 10) / 2;
      ex.forEach((e, k) => {
        const exDef = EXCUSES[e];
        const used = s.stats.excuseUses[e] ?? 0;
        const bx = pad + (k % 2) * (ew + 10), by = y + Math.floor(k / 2) * 72;
        const b = this.add.container(u(bx), u(by));
        const g = this.add.graphics();
        roundRect(g, 0, 0, ew, 64, 12, C.clay, 0.08);
        strokeRect(g, 0, 0, ew, 64, 12, C.clay, 1, 0.35);
        b.add([g, text(this, 12, 10, exDef?.name ?? e, { size: 12.5, weight: 800, color: H.blush }), text(this, 12, 30, `${exDef?.blurb ?? ''}${used ? ` Used ${used}×.` : ''}`, { size: 10.5, weight: 600, color: H.muted, wrap: ew - 24 })]);
        b.setSize(u(ew), u(64));
        b.setInteractive(new Phaser.Geom.Rectangle(0, 0, u(ew), u(64)), Phaser.Geom.Rectangle.Contains);
        b.input && (b.input.cursor = 'pointer');
        b.on('pointerup', () => { if (this.gate('deny')) void this.decide({ type: 'payout', decision: 'deny', excuse: e }, excuseDef(e).stallDays ? 'IN REVIEW' : 'DENIED'); });
        c.add(b);
        rects[`deny${k}`] = { x: bx, y: by, w: ew, h: 64 };
      });
      if (!ex.length) c.add(text(this, pad, y, 'No excuses in hand.', { size: 12, weight: 600, color: H.muted }));
      y += Math.max(1, Math.ceil(ex.length / 2)) * 72 + 4;
      const ghost = new Button(this, pad, y, w - 2 * pad, 42, 'GHOST THEM', { ...STYLE.ghost, size: 11.5, sub: 'no excuse · big Trust and Heat hit' });
      ghost.onClick = () => { if (this.gate('deny')) void this.decide({ type: 'payout', decision: 'deny' }, 'GHOSTED'); };
      c.add(ghost);
      rects.ghost = { x: pad, y, w: w - 2 * pad, h: 42 };
      return y + 42 + pad + 8;
    });
    for (const [k, r] of Object.entries(rects)) this.hit(k, m.x, m.y, r);
    const counter = { v: 0 };
    let last = 0;
    this.tweens.add({ targets: counter, v: req.amount, duration: J.motionOk() ? 700 : 1, ease: 'Cubic.easeOut', onUpdate: (tw) => { (amountText as Phaser.GameObjects.Text | null)?.setText(money(counter.v)); if (tw.elapsed - last > 60) { J.tick(); last = tw.elapsed; } } });
    const cv = cardView as CardView | null;
    if (cv) { cv.setScale(0.5); cv.sc.x = 0.5; cv.sc.target = 1; cv.rot.kick(6); }
    this.emit('payout-open');
  }

  private async decide(a: Action, stampText: string): Promise<void> {
    if (this.busy || !this.overlay) return;
    this.busy = true;
    const prev = this.ui.s;
    this.ui.s = step(this.ui.s, a);
    this.book(a, prev, this.ui.s);
    const r = this.hits['ov:pcard'];
    if (r) {
      const st = text(this, r.x + r.w * 0.42, r.y + r.h / 2, stampText, { size: 32, weight: 800, color: stampText === 'PAID' ? H.gold : H.clay, spacing: 4 }).setOrigin(0.5).setAngle(-12).setDepth(DEPTH.overlay + 5);
      const g = this.add.graphics().setDepth(DEPTH.overlay + 4);
      const bw = st.width / u(1) + 28, bh = st.height / u(1) + 14;
      g.setPosition(st.x, st.y).setAngle(-12);
      g.fillStyle(C.ink, 0.85); g.fillRoundedRect(u(-bw / 2), u(-bh / 2), u(bw), u(bh), u(8));
      g.lineStyle(u(4), stampText === 'PAID' ? C.gold : C.clay, 1); g.strokeRoundedRect(u(-bw / 2), u(-bh / 2), u(bw), u(bh), u(8));
      [st, g].forEach((o) => { o.setScale(3); o.setAlpha(0); this.tweens.add({ targets: o, scale: 1, alpha: 1, duration: 150, ease: 'Quad.easeIn' }); });
      this.overlay.add([g, st]);
    }
    if (stampText === 'PAID') { J.cashOut(); J.buzz([20, 30, 20]); this.pulseBg(C.gold, 0.8); this.animateCash(prev.cash, this.ui.s.cash, 500); const p = this.hits['ov:pcard']; if (p) this.burst?.explode(30, u(p.x + 50), u(p.y + 60)); }
    else { J.stamp(); J.buzz(45); this.pulseBg(C.clay, 0.9); this.shake(0.4); }
    await J.wait(740);
    this.busy = false;
    this.emit('payout-done');
    if (this.ui.s.phase === 'payout') { this.openPayout(); this.renderHud(); return; }
    this.closeOverlay();
    this.shownCash = this.ui.s.cash;
    this.renderAll();
    if (this.ui.s.phase === 'dead') this.showDeath();
    this.maybeTips();
  }

  private showInfo(card: CardInstance): void {
    const def = cardDef(card.def);
    const t = def.threshold;
    const pad = 18;
    this.modal('info', 460, (c, w) => {
      const cv = new CardView(this, 96, 132).setCard(card);
      cv.sway = false; cv.disableInteractive();
      cv.place(pad + 48, pad + 66);
      c.add(cv);
      const tx = pad + 112, tw = w - tx - pad;
      c.add(text(this, tx, pad + 4, displayName(card), { size: 18, weight: 800 }));
      c.add(text(this, tx, pad + 30, `${def.kind === 'staff' ? 'STAFF' : card.revealed && def.fraud ? 'EXPOSED FRAUD' : 'CUSTOMER'}`, { size: 10, weight: 800, color: H.muted, spacing: 1.6 }));
      const b = text(this, tx, pad + 50, infoBody(card), { size: 13, weight: 600, wrap: tw, lineSpacing: 2 });
      c.add(b);
      let y = Math.max(pad + 140, pad + 54 + b.height / u(1)) + 8;
      const rows: [string, string][] = [];
      if (t) rows.push(['Payout progress', `${card.progress} / ${t}`]);
      if (card.bonus) rows.push(['Upsold', `+${card.bonus} a day`]);
      rows.push(['On the book', `${card.age} day${card.age === 1 ? '' : 's'}`]);
      if (card.payouts) rows.push(['Payouts so far', String(card.payouts)]);
      const did = this.ui.s.lastReport?.events.filter((e) => e.uid === card.uid) ?? [];
      if (this.ui.s.lastReport) {
        const parts = did.map((e) => (e.fees !== undefined ? `${e.fees >= 0 ? '+' : '−'}$${Math.abs(e.fees)} fees` : e.times !== undefined ? `×${e.times} Mult` : `+${e.add} Mult`));
        rows.unshift(['Yesterday', parts.length ? parts.join(', ') : 'nothing']);
      }
      for (const [k, v] of rows) {
        c.add(text(this, pad, y, k, { size: 12.5, weight: 600, color: H.muted }));
        c.add(text(this, w - pad, y, v, { size: 12.5, weight: 800 }).setOrigin(1, 0));
        y += 24;
      }
      y += 6;
      // letting someone go frees the slot (closing a funded account is noticed)
      const slot = this.ui.s.grid.findIndex((x) => x?.uid === card.uid);
      const canGo = legalActions(this.ui.s).some((a) => a.type === 'release' && a.slot === slot);
      const half = (w - 2 * pad - 10) / 2;
      const go = new Button(this, pad, y, half, 46, `LET GO · ${money(BALANCE.severance)}`, { ...STYLE.ghost, stroke: C.clayDeep, size: 11, ...(card.def === 'vet' ? { sub: '−Trust' } : {}) });
      go.setEnabled(canGo && this.ui.mode !== 'tutorial');
      go.onClick = () => {
        this.closeOverlay();
        J.denied();
        this.act({ type: 'release', slot }, `${displayName(card)} let go`);
        this.burst?.explode(14, this.slotPos(slot).x, this.slotPos(slot).y);
      };
      const close = new Button(this, pad + half + 10, y, half, 46, 'CLOSE', { ...STYLE.dark, size: 12 });
      close.onClick = () => this.closeOverlay();
      c.add([go, close]);
      return y + 46 + pad + 6;
    });
    (this.overlay?.list[0] as Phaser.GameObjects.Rectangle | undefined)?.on('pointerup', () => this.closeOverlay());
  }

  /** How valuation (the score) is worked out, line by line. */
  showValuation(): void {
    const s = this.ui.s;
    const v = valuationParts(s);
    const pad = 20;
    this.modal('val', 470, (c, w) => {
      let y = pad;
      c.add(text(this, pad, y, 'VALUATION · YOUR SCORE', { size: 11, weight: 800, color: H.muted, spacing: 2 }));
      y += 28;
      c.add(text(this, pad, y, 'What a buyer would pay for the firm today. Your score is the peak.', { size: 13, weight: 600, color: H.paper, wrap: w - 2 * pad }));
      y += 44;
      const rows: [string, string, string][] = [
        ['Earnings', `20 days × ${money(v.avgTake)} a day × reputation ${v.reputation.toFixed(2)}`, money(v.earnings)],
        ['Payouts honoured', `half of ${money(s.stats.paid)} paid to traders`, `+${money(v.payouts)}`],
        ['Cash', `a quarter of ${money(s.cash)}`, `+${money(v.cash)}`],
        ['Funded book', 'what traders near payout could claim', `−${money(v.liability)}`],
      ];
      for (const [k, sub, val] of rows) {
        c.add(text(this, pad, y, k, { size: 14, weight: 800 }));
        c.add(text(this, pad, y + 20, sub, { size: 11.5, weight: 600, color: H.muted, wrap: w - 2 * pad - 110 }));
        c.add(new Num(this, w - pad, y, val, { size: 16, weight: 800, color: val.startsWith('−') ? H.clay : H.paper }).setOrigin(1, 0));
        y += 52;
      }
      const g = this.add.graphics(); g.fillStyle(C.line2, 1); g.fillRect(pad, y, w - 2 * pad, 1); c.add(g);
      y += 12;
      c.add(text(this, pad, y + 4, 'VALUATION', { size: 12, weight: 800, color: H.muted, spacing: 1.6 }));
      c.add(new Num(this, w - pad, y, money(valuation(s)), { size: 24, weight: 800, color: H.gold }).setOrigin(1, 0));
      y += 40;
      c.add(text(this, pad, y, 'Reputation is (Trust ÷ 3)². A firm that stiffs its traders is worth less than a smaller honest one.', { size: 11.5, weight: 600, color: H.muted, wrap: w - 2 * pad }));
      y += 44;
      const close = new Button(this, pad, y, w - 2 * pad, 46, 'GOT IT', { ...STYLE.dark, size: 12 });
      close.onClick = () => this.closeOverlay();
      c.add(close);
      return y + 46 + pad + 4;
    }, { center: true });
    (this.overlay?.list[0] as Phaser.GameObjects.Rectangle | undefined)?.on('pointerup', () => this.closeOverlay());
  }

  showHow(): void {
    const pad = 20;
    const steps: [string, string][] = [
      ['Open the market.', 'Each day prints one candle. Every customer on the book reacts and pays you fees.'],
      ['Hire carefully.', 'One card a day, paid in cash. Staff boost the 8 cards around them and build your mult. Fees × mult = today\'s take.'],
      ['Trends pay them.', 'Chop days mostly pay you. Trend days fill traders\' dots. A full card wants a payout.'],
      ['Pay, stall, or deny.', 'Paying builds Trust, which multiplies every fee. Denying keeps cash but burns Trust and adds Heat. Exposed fraud can be denied for free.'],
      ['Make payroll.', 'Every 5 days, and it grows each time. Miss it and the firm closes. Heat at 100 closes it too.'],
    ];
    const rects: Record<string, Rect> = {};
    const m = this.modal('how', 560, (c, w) => {
      let y = pad;
      c.add(text(this, pad, y, 'HOW FIRM WORKS', { size: 11, weight: 800, color: H.muted, spacing: 2 }));
      y += 30;
      steps.forEach(([title, body], k) => {
        const g = this.add.graphics();
        g.fillStyle(C.panel2, 1); g.fillCircle(u(pad + 13), u(y + 12), u(13));
        g.lineStyle(u(1), C.line2, 1); g.strokeCircle(u(pad + 13), u(y + 12), u(13));
        c.add(g);
        c.add(text(this, pad + 13, y + 12, String(k + 1), { size: 12, weight: 800, color: H.gold }).setOrigin(0.5));
        const t = text(this, pad + 38, y + 2, title, { size: 14, weight: 800 });
        const b = text(this, pad + 38, y + 22, body, { size: 12.5, weight: 600, color: H.muted, wrap: w - pad * 2 - 38, lineSpacing: 2 });
        c.add([t, b]);
        y += 26 + b.height / u(1) + 12;
      });
      y += 4;
      const bw = (w - 2 * pad - 10) / 2;
      const tour = new Button(this, pad, y, bw, 46, 'REPLAY TOUR', { ...STYLE.dark, size: 11 });
      tour.onClick = () => { this.closeOverlay(); this.newGame('tutorial'); };
      const ok = new Button(this, pad + bw + 10, y, bw, 46, 'GOT IT', { ...STYLE.gold, size: 12 });
      ok.onClick = () => this.closeOverlay();
      c.add([tour, ok]);
      rects.ok = { x: pad + bw + 10, y, w: bw, h: 46 };
      return y + 46 + pad + 6;
    }, { center: true });
    for (const [k, r] of Object.entries(rects)) this.hit(k, m.x, m.y, r);
  }

  /** A full-window screen over the table (cash-out, quarter, death). Content is built in design units. */
  private fullscreen(kind: string, build: (c: Phaser.GameObjects.Container) => void, dimA = 0.9): Phaser.GameObjects.Container {
    this.closeOverlay();
    this.hideTip();
    const V = this.L.view;
    const root = this.add.container(0, 0).setDepth(DEPTH.overlay);
    const dim = this.add.rectangle(V.x, V.y, V.w, V.h, C.ink, dimA).setOrigin(0).setInteractive();
    root.add(dim);
    const content = this.add.container(0, 0);
    root.add(content);
    build(content);
    this.overlay = root;
    this.overlayKind = kind;
    dim.setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 220 });
    content.setAlpha(0).setY(36);
    this.tweens.add({ targets: content, alpha: 1, y: 0, duration: 340, ease: 'Back.easeOut', easeParams: [1.1] });
    return content;
  }
  private ovHit(name: string, r: Rect): void { this.hits[`ov:${name}`] = r; }

  // ---------------------------------------------------------------- payroll cash-out (the receipt)

  showCashout(): void {
    const co = this.ui.cashout;
    if (!co) { this.showQuarter(); return; }
    const s = this.ui.s;
    const { W, H: Hh, wide } = this.L;
    const cx = W / 2;
    let stampAt = { x: 0, y: 0 };
    const lines: { k: string; v: number; strong?: boolean; color?: string }[] = [
      { k: 'Cash at start of cycle', v: co.ledger.start },
      { k: 'Fees collected', v: co.ledger.fees },
      { k: 'Payouts paid', v: co.ledger.payouts },
      { k: 'Hiring and rerolls', v: co.ledger.hires },
    ];
    if (co.ledger.moves) lines.push({ k: 'Plans, sales and loans', v: co.ledger.moves });
    lines.push({ k: `Payroll · cycle ${co.cycle}`, v: -co.paid, strong: true, color: H.clayDeep });
    const texts: Phaser.GameObjects.Text[] = [];
    this.fullscreen('cashout', (c) => {
      let y = wide ? 54 : 24;
      c.add(text(this, cx, y, `CYCLE ${co.cycle} CLOSED`, { size: wide ? 13 : 11, weight: 800, color: H.muted, spacing: 4 }).setOrigin(0.5, 0));
      y += wide ? 24 : 18;
      const head = text(this, cx, y, 'PAYROLL MET', { size: wide ? 64 : 40, weight: 800, color: H.gold, spacing: wide ? 6 : 3 }).setOrigin(0.5, 0);
      c.add(head);
      y += head.height + (wide ? 22 : 14);
      // the receipt: cream paper, zig-zag bottom, printed lines
      const pw = wide ? 520 : W - 40, x0 = cx - pw / 2, lh = wide ? 34 : 30;
      const ph = 34 + lines.length * lh + 20 + (wide ? 56 : 50) + (co.crisis ? lh : 0) + 26;
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.5); g.fillRect(x0 + 4, y + 8, pw, ph);
      g.fillStyle(C.paper, 1);
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + pw, y); g.lineTo(x0 + pw, y + ph);
      const teeth = Math.round(pw / 14);
      for (let k = 0; k < teeth; k++) { const tx = x0 + pw - (k + 0.5) * (pw / teeth); g.lineTo(tx, y + ph + 7); g.lineTo(tx - pw / teeth / 2, y + ph); }
      g.lineTo(x0, y + ph); g.closePath(); g.fillPath();
      c.add(g);
      c.add(text(this, x0 + 24, y + 18, this.ui.firm.toUpperCase(), { size: 10, weight: 800, color: H.inkSoft, spacing: 2 }));
      c.add(text(this, x0 + pw - 24, y + 18, `DAY ${s.day - 1}`, { size: 10, weight: 800, color: H.inkSoft, spacing: 2 }).setOrigin(1, 0));
      let ly = y + 46;
      lines.forEach((l) => {
        const kt = text(this, x0 + 24, ly, l.k, { size: wide ? 15 : 13, weight: l.strong ? 800 : 600, color: l.color ?? H.ink });
        const vt = text(this, x0 + pw - 24, ly, '', { size: wide ? 16 : 14, weight: 800, color: l.color ?? (l.v < 0 ? H.clayDeep : H.ink) }).setOrigin(1, 0);
        kt.setAlpha(0); vt.setAlpha(0);
        c.add([kt, vt]); texts.push(kt, vt);
        ly += lh;
      });
      if (co.crisis) {
        const ct = text(this, x0 + 24, ly, `Survived ${CRISES[co.crisis]?.name ?? 'the crisis'} · Trust +0.3`, { size: wide ? 14 : 12, weight: 800, color: H.goldDeep }).setAlpha(0);
        c.add(ct); texts.push(ct);
        ly += lh;
      }
      const dg = this.add.graphics();
      dg.lineStyle(1.5, C.ink, 0.35);
      for (let dx = x0 + 24; dx < x0 + pw - 24; dx += 9) dg.lineBetween(dx, ly + 6, dx + 4, ly + 6);
      c.add(dg);
      ly += 18;
      c.add(text(this, x0 + 24, ly + 6, 'CASH LEFT', { size: 12, weight: 800, color: H.inkSoft, spacing: 2 }));
      const left = text(this, x0 + pw - 24, ly - 2, money(0), { size: wide ? 38 : 30, weight: 800, color: H.ink }).setOrigin(1, 0);
      c.add(left);
      stampAt = { x: x0 + pw * 0.62, y: y + ph * 0.42 };
      y += ph + (wide ? 34 : 24);
      c.add(text(this, cx, y, `NEXT PAYROLL ${money(s.payroll.base)}  ·  GROWS ×${payrollGrowth(s).toFixed(2)} EVERY CYCLE`, { size: wide ? 13 : 10.5, weight: 800, color: H.blush, spacing: 1.4, align: 'center', wrap: W - 40 }).setOrigin(0.5, 0));
      const bw = wide ? 360 : W - 28, bh = wide ? 76 : 66, by = Hh - (wide ? 44 : 14) - bh;
      const go = new Button(this, cx - bw / 2, by, bw, bh, 'CONTINUE', { ...STYLE.clay, size: wide ? 20 : 18, spacing: 3, sub: 'plan the next quarter' });
      go.onClick = () => { J.tick(); this.ui.cashout = null; this.closeOverlay(); if (this.ui.s.phase === 'quarter') this.showQuarter(); else this.renderAll(); };
      c.add(go);
      this.ovHit('continue', { x: cx - bw / 2, y: by, w: bw, h: bh });
      // print the lines one by one, then the total, then the stamp
      let k = 0;
      const nextLine = (): void => {
        if (!go.active) return;
        if (k < lines.length) {
          const l = lines[k] as (typeof lines)[number];
          const kt = texts[k * 2], vt = texts[k * 2 + 1];
          kt?.setAlpha(1); vt?.setAlpha(1);
          vt?.setText(k === 0 || l.v === 0 ? money(l.v) : signed(l.v));
          if (vt) { vt.setScale(1.3); this.tweens.add({ targets: vt, scale: 1, duration: 200, ease: 'Back.easeOut' }); }
          if (l.v > 0) J.coin(k); else J.tick();
          k++;
          this.time.delayedCall(230, nextLine);
          return;
        }
        texts.slice(lines.length * 2).forEach((t) => t.setAlpha(1));
        const o = { v: 0 };
        this.tweens.add({ targets: o, v: s.cash, duration: 520, ease: 'Cubic.easeOut', onUpdate: () => left.setText(money(o.v)), onComplete: () => {
          left.setText(money(s.cash));
          const st = text(this, stampAt.x, stampAt.y, 'PAID', { size: wide ? 54 : 42, weight: 800, color: H.clayDeep, spacing: 8 }).setOrigin(0.5).setAngle(-14).setAlpha(0).setScale(2.6);
          const ring = this.add.graphics().setPosition(stampAt.x, stampAt.y).setAngle(-14).setAlpha(0).setScale(2.6);
          const rw = st.width + 34, rh = st.height + 12;
          ring.lineStyle(5, C.clayDeep, 1); ring.strokeRoundedRect(-rw / 2, -rh / 2, rw, rh, 10);
          c.add([ring, st]);
          this.tweens.add({ targets: [st, ring], alpha: 0.85, scale: 1, duration: 140, ease: 'Quad.easeIn', onComplete: () => { J.stamp(); J.buzz(40); this.shake(0.35); this.pulseBg(C.gold, 0.7); } });
        } });
      };
      this.time.delayedCall(380, nextLine);
    }, 0.92);
  }

  // ---------------------------------------------------------------- the quarter: crisis briefing + plan

  showQuarter(): void {
    const s = this.ui.s;
    if (s.phase !== 'quarter') return;
    const { W, H: Hh, wide } = this.L;
    const cx = W / 2;
    const legal = legalActions(s);
    const mul: Record<string, number> = { growth: 1.2, lean: 0.85, fair: 1.1 };
    this.fullscreen('quarter', (c) => {
      let y = wide ? 46 : 20;
      c.add(text(this, cx, y, `CYCLE ${s.payroll.cycle}  ·  DAY ${s.day}`, { size: wide ? 13 : 11, weight: 800, color: H.muted, spacing: 4 }).setOrigin(0.5, 0));
      y += wide ? 24 : 18;
      const t = text(this, cx, y, 'Plan the quarter', { size: wide ? 44 : 28, weight: 800 }).setOrigin(0.5, 0);
      c.add(t);
      y += t.height + (wide ? 20 : 12);
      // crisis banner
      const bw = wide ? 820 : W - 28, bh = wide ? 96 : 84, bx = cx - bw / 2;
      const now = s.crisis, id = now ?? s.nextCrisis, cr = CRISES[id];
      const g = this.add.graphics();
      roundRect(g, bx, y, bw, bh, 16, now ? 0x2a120b : C.panel2, 0.98);
      strokeRect(g, bx, y, bw, bh, 16, now ? C.clay : C.line2, now ? 2 : 1);
      const ic = bh - 24;
      roundRect(g, bx + 12, y + 12, ic, ic, 12, now ? C.clay : C.paper, now ? 1 : 0.9);
      c.add(g);
      c.add(this.add.image(bx + 12 + ic / 2, y + 12 + ic / 2, artTexture(this, id)).setDisplaySize(ic * 0.82, ic * 0.82));
      const tx = bx + 12 + ic + 16;
      const away = s.crisisCycle - s.payroll.cycle;
      c.add(text(this, tx, y + (wide ? 14 : 10), now ? 'CRISIS THIS CYCLE' : `NEXT CRISIS · ${away === 1 ? 'NEXT CYCLE' : `IN ${away} CYCLES`}`, { size: wide ? 11 : 9.5, weight: 800, color: now ? H.clay : H.muted, spacing: 2 }));
      c.add(text(this, tx, y + (wide ? 30 : 24), cr?.name ?? id, { size: wide ? 24 : 17, weight: 800, color: now ? H.blush : H.paper }));
      c.add(text(this, tx, y + (wide ? 62 : 48), cr?.blurb ?? '', { size: wide ? 13.5 : 11, weight: 600, color: H.muted, wrap: bw - (tx - bx) - 16 }));
      if (now) { this.pulseBg(C.clay, 0.8); J.alarm(); }
      y += bh + (wide ? 26 : 14);
      // the three plans
      const n = s.plans.length, gap = wide ? 28 : 7;
      const pw = wide ? 250 : (W - 28 - gap * (n - 1)) / n;
      const btnH = wide ? 0 : 0;
      const ph = Math.min(wide ? 340 : 250, Hh - y - (wide ? 90 : 46) - btnH);
      s.plans.forEach((pid, i) => {
        const p = PLANS[pid];
        if (!p) return;
        const ok = legal.some((a) => a.type === 'plan' && a.id === pid);
        const pay = Math.round((s.payroll.base * (mul[pid] ?? 1)) / 10) * 10;
        const foot = pid === 'pr' ? `COSTS ${money(planCost(s, pid))}` : pid === 'raise' ? `+${money(Math.round(s.payroll.base * 0.05) * 10)} NOW` : `PAYROLL ${money(pay)}`;
        const px = cx - ((n * pw + (n - 1) * gap) / 2) + i * (pw + gap) + pw / 2;
        const card = new PaperCard(this, px, y + ph / 2, pw, ph, {
          art: pid, title: p.name, tag: pid === 'steady' ? 'SAFE' : 'PLAN', tagColor: pid === 'steady' ? H.inkSoft : H.goldDeep, body: p.blurb,
          foot: ok ? foot : 'CAN\'T AFFORD', footColor: ok ? (pay > s.payroll.base ? H.clayDeep : pay < s.payroll.base ? H.goldDeep : H.ink) : H.clayDeep,
          accent: pid === 'steady' ? undefined : C.gold, locked: !ok,
        }).deal(120 + i * 110);
        card.onTap = () => this.choosePlan(pid);
        c.add(card);
        this.ovHit(`plan${i}`, { x: px - pw / 2, y, w: pw, h: ph });
      });
      y += ph + (wide ? 22 : 12);
      c.add(text(this, cx, y, 'Tap a plan to open the next five days.', { size: wide ? 13 : 11, weight: 700, color: H.muted }).setOrigin(0.5, 0));
    });
  }

  private choosePlan(id: string): void {
    const s = this.ui.s;
    if (this.busy || s.phase !== 'quarter') return;
    if (!legalActions(s).some((a) => a.type === 'plan' && a.id === id)) { J.loss(); this.shake(0.2); return; }
    const prev = s;
    this.ui.s = step(s, { type: 'plan', id });
    this.book({ type: 'plan', id }, prev, this.ui.s);
    J.cashOut(); J.buzz(20); this.pulseBg(C.gold, 0.5);
    this.closeOverlay();
    this.shownCash = this.ui.s.cash;
    this.renderAll();
    this.toast(`${PLANS[id]?.name ?? id}${this.ui.s.crisis ? ` · ${CRISES[this.ui.s.crisis]?.name} is live` : ''}`);
  }

  // ---------------------------------------------------------------- death card

  showDeath(): void {
    const s = this.ui.s;
    this.guideStop();
    this.shop?.destroy(); this.shop = null;
    const first = !this.ui.record;
    if (!this.ui.record) this.ui.record = recordRun(s, this.ui.mode === 'tutorial');
    const rec = this.ui.record;
    if (first) { J.thud(); J.buzz([80, 60, 120]); this.pulseBg(C.clay, 1.2); this.shake(0.9); }
    const near = s.cause === 'payroll' ? `${money(s.shortBy)} short` : s.cause === 'trust' ? 'Trust hit zero' : 'Heat hit 100';
    const share = `${this.ui.firm} lasted ${s.day} days on FIRM. Peak valuation ${money(s.stats.peakValuation)}. ${CAUSE[s.cause ?? 'payroll']}, ${near.toLowerCase()}.`;
    const { W, H: Hh, wide } = this.L;
    const cx = W / 2;
    this.fullscreen('death', (c) => {
      const cw = wide ? 520 : W - 28, pad = wide ? 28 : 20;
      const x0 = cx - cw / 2;
      let y = wide ? 40 : 18;
      const card = this.add.container(0, 0);
      c.add(card);
      const items: Phaser.GameObjects.GameObject[] = [];
      const top = y;
      y += pad;
      items.push(text(this, x0 + pad, y, `FIRM CLOSED · DAY ${s.day}`, { size: 11, weight: 800, color: H.inkSoft, spacing: 2 }));
      items.push(text(this, x0 + cw - pad, y, `${(FOUNDERS[s.founder]?.name ?? '').toUpperCase()} · ${(STAKES[s.stake - 1]?.name ?? '').toUpperCase()}`, { size: 11, weight: 800, color: H.inkSoft, spacing: 1.4 }).setOrigin(1, 0));
      y += 24;
      const name = text(this, x0 + pad, y, this.ui.firm, { size: wide ? 34 : 26, weight: 800, color: H.ink, wrap: cw - 2 * pad });
      items.push(name);
      y += name.height + 10;
      items.push(text(this, x0 + pad, y, CAUSE[s.cause ?? 'payroll'] ?? '', { size: wide ? 20 : 17, weight: 800, color: H.clayDeep }));
      items.push(text(this, x0 + pad, y + (wide ? 28 : 24), near, { size: 14, weight: 700, color: H.inkSoft }));
      y += wide ? 64 : 56;
      const cells: [string, string][] = [['DAYS', String(s.day)], ['PEAK VALUE', money(s.stats.peakValuation)], ['CRISES', String(s.stats.crisesSurvived)], ['PAID', String(s.stats.payoutsPaid)], ['DENIED', String(s.stats.payoutsDenied)], ['FRAUD CAUGHT', String(s.stats.fraudCaught)]];
      const cellW = (cw - 2 * pad) / 3, cellH = wide ? 62 : 54;
      const cg = this.add.graphics();
      cells.forEach(([k, v], idx) => {
        const ccx = x0 + pad + (idx % 3) * cellW, ccy = y + Math.floor(idx / 3) * (cellH + 6);
        roundRect(cg, ccx + 2, ccy, cellW - 4, cellH, 8, C.paper2);
        items.push(text(this, ccx + 12, ccy + 10, k, { size: 9, weight: 800, color: H.inkSoft, spacing: 1.2 }));
        items.push(text(this, ccx + 12, ccy + (wide ? 28 : 25), v, { size: wide ? 20 : 17, weight: 800, color: H.ink }));
      });
      y += 2 * (cellH + 6) + 10;
      const lines: string[] = [];
      if (rec.newBest) lines.push('NEW PERSONAL BEST');
      for (const u0 of rec.unlocked) lines.push(`UNLOCKED · ${u0.toUpperCase()}`);
      for (const l of lines) { items.push(text(this, x0 + pad, y, l, { size: 12, weight: 800, color: H.goldDeep, spacing: 1.6 })); y += 22; }
      y += pad - 6;
      const bgG = this.add.graphics();
      roundRect(bgG, x0 + 3, top + 10, cw, y - top, 18, 0x000000, 0.5);
      roundRect(bgG, x0, top, cw, y - top, 18, C.paper);
      card.add(bgG); card.add(cg); card.add(items);
      // CLOSED stamp across the card
      const st = text(this, x0 + cw * 0.76, top + (wide ? 130 : 112), 'CLOSED', { size: wide ? 40 : 30, weight: 800, color: H.clay, spacing: 6 }).setOrigin(0.5).setAngle(-12);
      const sr = this.add.graphics().setPosition(st.x, st.y).setAngle(-12);
      sr.lineStyle(5, C.clay, 1); sr.strokeRoundedRect(-(st.width + 34) / 2, -(st.height + 12) / 2, st.width + 34, st.height + 12, 10);
      card.add([sr, st]);
      if (first) { [st, sr].forEach((o) => { o.setScale(3).setAlpha(0); this.tweens.add({ targets: o, scale: 1, alpha: 0.85, delay: 420, duration: 150, ease: 'Quad.easeIn', onComplete: () => { if (o === st) { J.stamp(); this.shake(0.4); } } }); }); }
      else { st.setAlpha(0.85); sr.setAlpha(0.85); }
      card.setAngle(-2);
      this.tweens.add({ targets: card, angle: 0, duration: 520, ease: 'Back.easeOut' });
      // actions
      y += wide ? 24 : 14;
      const bh = wide ? 72 : 62;
      const again = new Button(this, x0, y, cw, bh, 'NEW RUN', { ...STYLE.clay, size: wide ? 20 : 18, spacing: 3, sub: `${FOUNDERS[this.ui.founder]?.name ?? ''} · ${STAKES[this.ui.stake - 1]?.name ?? ''}${wide ? ' · space' : ''}` });
      again.onClick = () => { J.tick(); this.newGame(this.ui.mode === 'tutorial' ? 'random' : this.ui.mode === 'daily' ? 'random' : 'random'); };
      c.add(again);
      this.ovHit('new', { x: x0, y, w: cw, h: bh });
      y += bh + 10;
      const sw = (cw - 20) / 3, sh = wide ? 50 : 48;
      const b1 = new Button(this, x0, y, sw, sh, 'CHANGE FIRM', { ...STYLE.dark, size: 11 });
      b1.onClick = () => goTo(this, 'setup');
      const b2 = new Button(this, x0 + sw + 10, y, sw, sh, 'COPY RESULT', { ...STYLE.dark, size: 11 });
      b2.onClick = () => { navigator.clipboard?.writeText(share).then(() => this.toast('Copied'), () => this.toast(share)); };
      const b3 = new Button(this, x0 + 2 * (sw + 10), y, sw, sh, 'MENU', { ...STYLE.dark, size: 11 });
      b3.onClick = () => goTo(this, 'title');
      c.add([b1, b2, b3]);
      this.ovHit('change', { x: x0, y, w: sw, h: sh });
      this.ovHit('menu', { x: x0 + 2 * (sw + 10), y, w: sw, h: sh });
      void Hh;
    }, 0.86);
  }

  // ---------------------------------------------------------------- tooltips + toast

  private showTip(i: number): void {
    this.hideTip();
    const card = this.ui.s.grid[i];
    if (!card) return;
    const def = cardDef(card.def);
    const p = this.slotPos(i);
    const w = 230;
    const c = this.add.container(0, 0).setDepth(DEPTH.overlay - 1);
    const tag = text(this, 12, 12, def.kind === 'staff' ? 'STAFF' : card.revealed && def.fraud ? 'FRAUD' : 'CUSTOMER', { size: 9, weight: 800, color: H.gold, spacing: 1.8 });
    const nm = text(this, 12, 28, displayName(card), { size: 14, weight: 800 });
    const body = text(this, 12, 50, `${infoBody(card)}${def.threshold ? `\nPayout at ${def.threshold}/${def.threshold} · now ${card.progress}` : ''}`, { size: 12, weight: 600, color: H.muted, wrap: w - 24, lineSpacing: 2 });
    const h = 62 + body.height / u(1);
    const g = this.add.graphics();
    roundRect(g, 0, 4, w, h, 12, 0x000000, 0.5);
    roundRect(g, 0, 0, w, h, 12, C.panel);
    strokeRect(g, 0, 0, w, h, 12, C.line2, 1);
    c.add([g, tag, nm, body]);
    let x = p.x + this.L.cw / 2 + 14;
    if (x + w > this.L.W - 10) x = p.x - this.L.cw / 2 - 14 - w;
    const y = Math.max(10, Math.min(this.L.H - h - 10, p.y - this.L.ch / 2));
    c.setPosition(u(x), u(y)).setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 120 });
    this.tip = c;
  }
  private hideTip(): void { this.tip?.destroy(); this.tip = null; }

  toast(msg: string): void {
    this.toastObj?.destroy();
    const t = text(this, 0, 0, msg, { size: 12.5, weight: 800, color: H.ink, wrap: this.L.W - 60, align: 'center' }).setOrigin(0.5);
    const w = t.width / u(1) + 28, h = t.height / u(1) + 18;
    const g = this.add.graphics();
    roundRect(g, -w / 2, -h / 2 + 4, w, h, 12, 0x000000, 0.4);
    roundRect(g, -w / 2, -h / 2, w, h, 12, C.paper);
    const ty = this.L.wide ? this.L.cta.y - 30 : this.L.grid.y + this.L.grid.h - h / 2 - 4;
    const c = this.add.container(this.L.wide ? this.L.center.x + this.L.center.w / 2 : this.L.W / 2, ty, [g, t]).setDepth(DEPTH.toast);
    c.setAlpha(0).setScale(0.8);
    this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, alpha: 0, delay: 2200, duration: 220, onComplete: () => c.destroy() });
    this.toastObj = c;
  }

  // ---------------------------------------------------------------- Marv

  gate(g: Gate): boolean {
    if (!this.allowed || this.allowed.has(g)) return true;
    J.loss();
    if (this.guideLayer) this.tweens.add({ targets: this.guideLayer, x: { from: u(-8), to: 0 }, duration: 260, ease: 'Elastic.easeOut' });
    return false;
  }
  private emit(ev: string): void { const w = this.waiters.get(ev); if (w) { this.waiters.delete(ev); w(); } }
  private waitFor(ev: string): Promise<void> { return new Promise((r) => this.waiters.set(ev, r)); }
  private hideGuide(): void { this.guideLayer?.destroy(); this.guideLayer = null; }

  private targetRect(name: string | null | undefined): Rect | null {
    if (!name) return null;
    const r = this.hits[name] ?? this.hits[`ov:${name}`];
    return r ?? null;
  }

  private typed = 0;
  private drawGuide(full = false): void {
    this.hideGuide();
    const g = this.guideNow;
    if (!g) return;
    const { o } = g;
    const { W, H: Hh, wide, view: V } = this.L;
    const layer = this.add.container(0, 0).setDepth(DEPTH.guide);
    this.guideLayer = layer;
    const r = this.targetRect(o.target);
    const pad = 6;
    const dimA = 0.66;
    const block = (x: number, y: number, w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      layer.add(this.add.rectangle(u(x), u(y), u(w), u(h), C.ink, dimA).setOrigin(0).setInteractive());
    };
    if (r) {
      const hx = r.x - pad, hy = r.y - pad, hw = r.w + 2 * pad, hh = r.h + 2 * pad;
      const vr = V.x + V.w, vb = V.y + V.h;
      block(V.x, V.y, V.w, hy - V.y); block(V.x, hy + hh, V.w, vb - hy - hh); block(V.x, hy, hx - V.x, hh); block(hx + hw, hy, vr - hx - hw, hh);
      const ring = this.add.graphics();
      strokeRect(ring, hx, hy, hw, hh, 12, C.gold, 2);
      layer.add(ring);
      this.tweens.add({ targets: ring, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
      if (!o.wait) block(hx, hy, hw, hh); // explanation steps: nothing behind is clickable
    } else block(V.x, V.y, V.w, V.h);
    // Marv
    const bw = Math.min(wide ? 620 : W - 24, W - 24);
    const faceW = wide ? 78 : 60, faceH = wide ? 100 : 80;
    const textW = bw - faceW - 10 - 28;
    const body = text(this, 0, 0, o.text, { size: wide ? 17 : 15, weight: 600, wrap: textW, lineSpacing: 3 });
    const bh = Math.max(faceH, 44 + body.height / u(1) + 46);
    const lowHalf = r ? r.y + r.h / 2 > Hh * 0.55 : false;
    const top = o.top ?? lowHalf;
    const bx = (W - bw) / 2, by = top ? 12 : Hh - bh - 12;
    const face = this.add.graphics();
    roundRect(face, bx, by + bh - faceH + 6, faceW, faceH, 12, 0x000000, 0.5);
    roundRect(face, bx, by + bh - faceH, faceW, faceH, 12, C.paper);
    const marv = this.add.image(u(bx + faceW / 2), u(by + bh - faceH / 2), artTexture(this, 'cfo')).setDisplaySize(u(faceW * 0.86), u(faceW * 0.86));
    this.tweens.add({ targets: marv, y: marv.y - u(2), duration: 220, yoyo: true, repeat: 6 });
    const bubble = this.add.graphics();
    const kx = bx + faceW + 10, kw = bw - faceW - 10;
    roundRect(bubble, kx, by + 6, kw, bh, 16, 0x000000, 0.5);
    roundRect(bubble, kx, by, kw, bh, 16, C.panel);
    strokeRect(bubble, kx, by, kw, bh, 16, C.line2, 1);
    const who = text(this, kx + 14, by + 14, 'MARV · YOUR CFO', { size: 10.5, weight: 800, color: H.gold, spacing: 2 });
    body.setPosition(u(kx + 14), u(by + 36));
    layer.add([face, marv, bubble, who, body]);
    if (o.hint) layer.add(text(this, kx + 14, by + bh - 30, o.hint, { size: 12.5, weight: 800, color: H.clay }));
    if (!o.wait) {
      const next = new Button(this, kx + kw - 100, by + bh - 46, 86, 36, 'NEXT', { ...STYLE.paper, size: 11 });
      next.onClick = () => {
        if (this.typed < o.text.length) { this.typed = o.text.length; body.setText(o.text); return; }
        J.tick();
        const res = this.guideNow?.resolve;
        if (res) res();
      };
      layer.add(next);
      this.hits.next = { x: kx + kw - 100, y: by + bh - 46, w: 86, h: 36 };
    } else delete this.hits.next;
    this.hits.guide = { x: bx, y: by, w: bw, h: bh };
    // typewriter
    if (full) { this.typed = o.text.length; body.setText(o.text); return; }
    this.typed = 0;
    body.setText('');
    const token = this.guideToken;
    const type = (): void => {
      if (token !== this.guideToken || !body.active) return;
      if (this.typed >= o.text.length) { body.setText(o.text); return; }
      this.typed++;
      body.setText(o.text.slice(0, this.typed));
      const ch = o.text[this.typed - 1];
      if (ch !== ' ' && this.typed % 3 === 0) J.tick();
      this.time.delayedCall(ch === '.' ? 150 : 16, type);
    };
    type();
  }

  private async say(o: Say): Promise<void> {
    const token = this.guideToken;
    this.allowed = o.wait ? new Set(o.allow ?? []) : new Set();
    let resolveNext: (() => void) | null = null;
    const nextP = new Promise<void>((r) => { resolveNext = r; });
    this.guideNow = { o, resolve: o.wait ? null : resolveNext };
    this.drawGuide();
    if (o.wait) await this.waitFor(o.wait); else await nextP;
    if (token !== this.guideToken) return;
    this.allowed = null;
    this.guideNow = null;
    this.hideGuide();
    delete this.hits.next; delete this.hits.guide;
  }

  private guideStop(): void {
    this.guideToken++;
    this.allowed = null;
    this.waiters.clear();
    this.guideNow = null;
    this.hideGuide();
  }
  private seenTip(id: string): boolean { return (store<string[]>('tips') ?? []).includes(id); }
  private async tipOnce(id: string, msg: string, target: string | null): Promise<void> {
    if (this.seenTip(id) || this.ui.mode === 'tutorial' || this.guideNow) return;
    store('tips', [...(store<string[]>('tips') ?? []), id]);
    await this.say({ text: msg, target });
  }
  private maybeTips(): void {
    if (this.ui.mode === 'tutorial' || this.ui.s.phase !== 'morning' || this.overlay) return;
    const i = this.ui.s.grid.findIndex((c) => c?.revealed && cardDef(c.def).fraud);
    if (i >= 0) void this.tipOnce('fraud', 'Your analyst caught fraud. Deny them when they ask for a payout, and the evidence protects your Trust.', `slot${i}`);
    else if (this.ui.s.heat >= 40) void this.tipOnce('heat40', 'Heat is climbing. Denials and bot accounts draw regulators. At 100 they shut you down.', 'meters');
  }

  private reveal(key: string): void {
    if (this.ui.revealed.includes(key)) return;
    this.ui.revealed.push(key);
    this.renderAll();
    for (const o of this.veiled[key] ?? []) {
      const t = o as unknown as Phaser.GameObjects.Components.Alpha;
      t.setAlpha?.(0);
      this.tweens.add({ targets: o, alpha: 1, duration: 300 });
    }
    J.tick();
  }

  /** The guided first three days. Forced candles and offers so every lesson lands. */
  private async tutorial(): Promise<void> {
    const token = this.guideToken;
    const live = (): boolean => token === this.guideToken && this.ui.mode === 'tutorial';
    const force = (c: Candle): void => { this.ui.s = { ...this.ui.s, forecast: { chop: 0, up: 0, down: 0, news: 0, [c]: 1 } }; };
    const offers = (o: Offer[]): void => { this.ui.s = { ...this.ui.s, offers: o }; this.renderShop(); };
    await J.wait(500);
    await this.say({ text: "Welcome to FIRM. I'm Marv, your CFO. You just opened a prop firm.", target: null }); if (!live()) return;
    await this.say({ text: 'This is the book. Each card is a customer paying you to take your trading challenge.', target: 'grid' }); if (!live()) return;
    await this.say({ text: "Most of them blow up and pay again. That's how firms make money.", target: 'grid' }); if (!live()) return;
    force('chop');
    await this.say({ text: 'Open the market. Every day prints one candle, and every card reacts.', target: 'cta', hint: 'Tap OPEN MARKET', wait: 'tap-done', allow: ['tap'] }); if (!live()) return;
    offers([{ kind: 'card', id: 'affiliate' }, { kind: 'card', id: 'gambler' }, { kind: 'excuse', id: 'kyc' }]);
    await this.say({ text: 'Blue is fees, clay is your multiplier. Fees times mult is what you made today.', target: 'score' }); if (!live()) return;
    await this.say({ text: 'After every day you can hire one card, if you can afford it. Every dollar you spend is a dollar short at payroll. Take the Affiliate: staff boost the 8 cards around them.', target: 'offers', hint: 'Tap the Affiliate', wait: 'select', allow: ['select'], top: true }); if (!live()) return;
    await this.say({ text: 'Put them next to as many Gamblers as you can. Placement is the whole game.', target: 'grid', hint: 'Tap an empty slot', wait: 'placed', allow: ['place'], top: !this.L.wide ? false : true }); if (!live()) return;
    this.reveal('payroll');
    await this.say({ text: 'This is payroll. Every 5 days, and it grows every time. Miss it once and the firm is dead.', target: 'payroll' }); if (!live()) return;
    this.reveal('odds');
    await this.say({ text: "Up here are the last candles and tomorrow's odds. Chop pays you. Trends push traders toward a payout.", target: 'odds' }); if (!live()) return;
    force('up');
    await this.say({ text: 'Open the market. Watch the clay mult jump when the Affiliate fires.', target: 'cta', hint: 'Tap OPEN MARKET', wait: 'tap-done', allow: ['tap'] }); if (!live()) return;
    await this.say({ text: 'Trend day. See the dots on your Grinder filling up? A full card wants paying.', target: 'slot7', top: true }); if (!live()) return;
    offers([{ kind: 'card', id: 'grinder' }, { kind: 'card', id: 'discordmod' }, { kind: 'card', id: 'retail' }]);
    await this.say({ text: 'Hire whoever you like, or skip.', target: 'shop', hint: 'Hire or skip', wait: 'drafted', allow: ['select', 'place', 'skip', 'reroll'], top: true }); if (!live()) return;
    force('chop');
    await this.say({ text: 'Day 3. Open the market.', target: 'cta', hint: 'Tap OPEN MARKET', wait: 'payout-open', allow: ['tap'] }); if (!live()) return;
    await this.say({ text: 'A trader passed your challenge. Now you owe them real money.', target: 'pcard', top: true }); if (!live()) return;
    this.reveal('hand');
    await this.say({ text: 'Pay and Trust grows. Stall to buy time. Deny with an excuse to keep the cash, but everyone is watching.', target: 'pact', hint: 'Make the call', wait: 'payout-done', allow: ['pay', 'stall', 'deny'], top: true }); if (!live()) return;
    await J.wait(300);
    this.reveal('trust');
    await this.say({ text: 'Trust multiplies every fee. Heat is the regulators. Keep one high and the other low.', target: 'meters' }); if (!live()) return;
    store('tutorialDone', true);
    this.ui.mode = 'random';
    this.renderHud();
    await this.say({ text: "That's the job. From here it only gets harder. Payroll grows every cycle and every hire competes with it. Tap ? for the rules. Good luck, boss.", target: null });
  }

  // ---------------------------------------------------------------- test + debug hooks

  debug(): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get state() { return self.ui.s; },
      get ui() { return self.ui; },
      view: () => ({ screen: 'firm', phase: self.ui.s.phase, busy: self.busy, shop: !!self.shop, placing: self.ui.selected !== null, overlay: self.overlayKind, guide: !!self.guideNow, wait: self.guideNow?.o.wait ?? null, hint: self.guideNow?.o.hint ?? null }),
      rect: (name: string) => {
        const r = self.hits[name] ?? self.hits[`ov:${name}`];
        return r ? cssRect(self.L, r) : null;
      },
      quarter: () => self.showQuarter(),
      cashout: () => self.showCashout(),
      layout: () => ({ W: self.L.W, H: self.L.H, k: self.L.k, fit: self.L.fit, wide: self.L.wide }),
      firstEmpty: () => self.ui.s.grid.findIndex((c) => c === null),
      prices: () => self.ui.s.offers.map((o) => offerPrice(o, self.ui.s)),
      load: (seed: number) => { self.guideStop(); const u0 = freshUi('random'); u0.s = newRun(seed); u0.firm = firmName(seed); self.ui = u0; self.shownCash = u0.s.cash; self.closeOverlay(); self.build(); },
      set: (patch: Partial<GameState>) => { self.ui.s = { ...self.ui.s, ...patch }; self.shownCash = self.ui.s.cash; self.build(); },
      tutorial: () => self.newGame('tutorial'),
      openPayout: () => self.openPayout(),
      showDeath: () => self.showDeath(),
      showHow: () => self.showHow(),
      guideStop: () => self.guideStop(),
      valuation: () => valuation(self.ui.s),
      trustMultiplier,
    };
  }
}
