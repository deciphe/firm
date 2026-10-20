import {
  BALANCE, CARDS, EXCUSES, cardDef, displayName, excuseDef, findCard, legalActions, newRun, offerPrice, rerollPrice, seedFromString, step, trustMultiplier, valuation,
} from '@firm/sim';
import type { Action, Candle, CardInstance, GameState, Offer } from '@firm/sim';
import * as J from '../juice.ts';
import { CardView, artTexture, shortName } from './card.ts';
import { BG_FRAG, CrtPipeline } from './shaders.ts';
import { C, DEPTH, H } from './theme.ts';
import { Button, STYLE, Spring, dashedRect, roundRect, setTextRes, strokeRect, text, u } from './ui.ts';

// ================================================================== run state (survives rebuilds and hot reloads)

export type Mode = 'random' | 'daily' | 'tutorial';
interface Score { base: number; mult: number; today: number }
export interface UiState { s: GameState; mode: Mode; firm: string; tape: Candle[]; bestIncome: number; selected: number | null; revealed: string[]; score: Score }
const ALL_REVEALS = ['payroll', 'odds', 'trust', 'hand'];

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

export function freshUi(mode: Mode): UiState {
  const seed = mode === 'daily' ? todaySeed().seed : mode === 'tutorial' ? 20261020 : (Math.floor(Math.random() * 2 ** 31) >>> 0);
  let s = newRun(seed);
  if (mode === 'tutorial') {
    const grid = s.grid.map((c) => (c ? { ...c } : null));
    const g = grid[7];
    if (g) g.progress = 6;
    s = { ...s, grid, cash: 500 };
  }
  return { s, mode, firm: mode === 'tutorial' ? 'Your first firm' : firmName(seed), tape: [], bestIncome: 0, selected: null, revealed: mode === 'tutorial' ? [] : [...ALL_REVEALS], score: { base: 0, mult: 1, today: 0 } };
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
  private hud: Record<string, Phaser.GameObjects.Text> = {};
  private hudG!: Phaser.GameObjects.Graphics;
  private hudDyn!: Phaser.GameObjects.Graphics;
  private alarmG!: Phaser.GameObjects.Graphics;
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

  create(data: { ui?: UiState }): void {
    const restored = !!data.ui?.s;
    this.ui = data.ui?.s ? data.ui : freshUi(store<boolean>('tutorialDone') ? 'random' : 'tutorial');
    if (restored && this.ui.mode === 'tutorial') { this.ui.mode = 'random'; this.ui.revealed = [...ALL_REVEALS]; }
    this.shownCash = this.ui.s.cash;
    const dot = this.add.graphics();
    dot.fillStyle(0xffffff, 1); dot.fillCircle(8, 8, 8); dot.generateTexture('dot', 16, 16); dot.destroy();
    const renderer = this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (renderer.pipelines) {
      this.cameras.main.setPostPipeline(CrtPipeline);
      this.crt = this.cameras.main.getPostPipeline(CrtPipeline) as CrtPipeline;
    }
    this.scale.on('resize', () => this.requestRebuild());
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => { e.preventDefault(); this.onSpace(); });
    this.input.keyboard?.on('keydown-ENTER', () => this.onSpace());
    this.build();
    if (this.ui.mode === 'tutorial' && !restored) void this.tutorial();
    else if (this.ui.s.phase === 'payout') this.openPayout();
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
      return { W, H: Hh, wide, k, fit, view, panel, side, center, strip, hand, grid, cw, ch, gap, cta, moves };
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
    return { W, H: Hh, wide, k, fit, view, panel, side: null, center: { x: 0, y: 0, w: W, h: Hh }, strip, hand, grid, cw, ch, gap, cta, moves };
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
    this.renderAll();
  }

  // ---------------------------------------------------------------- HUD

  private box(x: number, y: number, w: number, h: number, fill: number, stroke: number = C.line, a = 1, reveal?: string, r = 12): void {
    let g = this.hudG;
    if (reveal) { g = this.add.graphics().setDepth(DEPTH.hud); (this.veiled[reveal] ??= []).push(g); }
    roundRect(g, x, y, w, h, r, fill, a);
    strokeRect(g, x, y, w, h, r, stroke, 1);
  }

  private label(name: string, x: number, y: number, str: string, o: Parameters<typeof text>[4], reveal?: string): Phaser.GameObjects.Text {
    const t = text(this, x, y, str, o).setDepth(DEPTH.hud + 1);
    this.hud[name] = t;
    if (reveal) (this.veiled[reveal] ??= []).push(t);
    return t;
  }

  /** Small score pill (fees / mult): a container so it can bump. */
  private scorePill(x: number, y: number, w: number, h: number, fill: number, deep: number, ink: string, key: string, size: number): Phaser.GameObjects.Container {
    const c = this.add.container(x + w / 2, y + h / 2).setDepth(DEPTH.hud + 1);
    const g = this.add.graphics();
    roundRect(g, -w / 2, -h / 2 + 2, w, h, 8, deep);
    roundRect(g, -w / 2, -h / 2, w, h - 1, 8, fill);
    const v = text(this, 0, -1, '0', { size, weight: 800, color: ink }).setOrigin(0.5);
    c.add([g, v]);
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
    const tv = text(this, 0, 0, '+$0', { size: 32, weight: 800 }).setOrigin(1, 0.5);
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
    const b2 = new Button(this, x0 + (w + 10) / 2, by, (w - 10) / 2, 46, 'NEW FIRM', { ...STYLE.dark, size: 11 }).setDepth(DEPTH.hud + 2);
    b2.onClick = () => { if (!this.busy) this.newGame('random'); };
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
    const tv = text(this, 0, 0, '+$0', { size: 20, weight: 800 }).setOrigin(0, 0.5);
    this.todayBox.add(tv); this.hud.today = tv; this.boxSprings.today = new Spring(1, 1, 380, 16);
    this.hits.score = { x: S.x, y: S.y, w: 230, h: S.h };
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
    this.hud.payCycle?.setText(L.wide ? `CYCLE ${s.payroll.cycle}${loanDue ? ' · +LOAN' : ''}` : `DAY ${s.day} · CYCLE ${s.payroll.cycle}`);
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
    this.hud.trustFx?.setText(`FEES ×${trustMultiplier(s.trust).toFixed(2)}`).setColor(s.trust < 1.5 ? H.clay : H.plat);
    const hw = heatWord(s.heat);
    this.hud.heatFx?.setText(hw.word).setColor(hw.color);
    // alarm ring around payroll when it can't be covered
    this.alarmG.clear();
    if (this.urgent) { const P = this.geo.payBox; strokeRect(this.alarmG, P.x - 1, P.y - 1, P.w + 2, P.h + 2, 15, C.clay, 2.5); }
    // score + stats
    const best = store<{ days: number; val: number }>('best');
    this.hud.val?.setText(money(valuation(s)));
    this.hud.best?.setText(best?.val ? `BEST ${money(best.val)}` : '');
    this.hud.peak?.setText(money(s.stats.peakValuation));
    this.hud.rr?.setText(money(rerollPrice(s)));
    this.hud.book?.setText(`${s.grid.filter(Boolean).length}/20`);
    this.bg?.setUniform('uHeat.value', s.heat / 100);
    for (const [key, objs] of Object.entries(this.veiled)) objs.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(this.ui.revealed.includes(key)));
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
    const L = this.L;
    this.rowLayer.removeAll(true);
    const s = this.ui.s;
    const g = this.add.graphics();
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
        const tape = this.ui.tape.slice(-22);
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
        const bw = 300, bx = S.x + S.w - 18 - bw;
        add(text(this, bx, S.y + 12, 'NEXT CANDLE ODDS', { size: 10, weight: 800, color: H.muted, spacing: 1.6 }));
        g.fillStyle(C.paper, 0.06); g.fillRoundedRect(bx, S.y + 30, bw, 8, 3);
        oddsBar(bx, S.y + 30, bw, 8);
        let lx = bx;
        odds.forEach(([c, p]) => {
          const t = add(text(this, lx, S.y + 44, `${CANDLE[c] === 'TREND UP' ? 'UP' : CANDLE[c] === 'TREND DOWN' ? 'DOWN' : CANDLE[c]} ${Math.round(p * 100)}%`, { size: 10.5, weight: 800, color: c === 'down' ? H.clay : c === 'news' ? H.gold : c === 'chop' ? H.muted : H.paper, spacing: 0.6 }));
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

  private slotPos(i: number): { x: number; y: number } {
    const { grid: G, cw, ch, gap } = this.L;
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

  private renderGrid(): void {
    const s = this.ui.s;
    const placing = this.ui.selected !== null && s.phase === 'draft';
    this.placingG.clear();
    s.grid.forEach((c, i) => {
      const cv = this.cards[i];
      if (!cv) return;
      cv.setCard(c);
      cv.dim = placing && !!c;
      if (placing && !c) {
        const p = this.slotPos(i);
        roundRect(this.placingG, p.x - this.L.cw / 2, p.y - this.L.ch / 2, this.L.cw, this.L.ch, 10, C.gold, 0.08);
        dashedRect(this.placingG, p.x - this.L.cw / 2, p.y - this.L.ch / 2, this.L.cw, this.L.ch, 10, C.gold, 0.9);
      }
    });
    this.tweens.killTweensOf(this.placingG);
    this.placingG.setAlpha(1);
    if (placing) this.tweens.add({ targets: this.placingG, alpha: 0.45, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
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
      const sale = new Button(this, r1.x, r1.y, r1.w, r1.h, 'FLASH SALE', { ...mv, sub: `+${money(100 + 100 * s.payroll.cycle)} · −Trust` }).setDepth(DEPTH.hud + 2);
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
    this.alarmG?.setAlpha(this.urgent ? 0.45 + 0.55 * Math.abs(Math.sin(this.clock * 3.2)) : 0);
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
    this.ui = freshUi(mode);
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
    if (a.type === 'flashSale' || a.type === 'loan') { J.cashOut(); this.pulseBg(C.gold, 0.8); this.animateCash(prev.cash, this.ui.s.cash, 420); }
    if (toast) this.toast(toast);
    this.afterStep(prev);
  }

  private afterStep(prev: GameState): void {
    const s = this.ui.s;
    if (s.payroll.cycle > prev.payroll.cycle) {
      J.thud(); J.buzz([30, 40, 30]); this.shake(0.45); this.pulseBg(C.clay, 0.6);
      this.toast(`Payroll paid · ${money(prev.payroll.amount)}`);
      this.animateCash(prev.cash, s.cash, 700);
    } else if (s.phase !== 'dead') {
      this.shownCash = s.cash;
    }
    this.renderAll();
    if (s.phase === 'dead') this.showDeath();
    this.maybeTips();
  }

  private chooseOffer(i: number): void {
    const o = this.ui.s.offers[i];
    if (!o || this.busy) return;
    if (this.ui.s.cash < offerPrice(o)) { J.loss(); this.toast(`Can't afford ${offerName(o)} · ${money(offerPrice(o))}`); return; }
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
    if (this.overlayKind === 'death') { this.newGame('random'); return; }
    if (this.ui.s.phase === 'morning' && !this.overlay && !this.guideNow) void this.onTap();
  }

  // ---------------------------------------------------------------- the day (Balatro-style scoring)

  async onTap(): Promise<void> {
    if (this.busy || this.ui.s.phase !== 'morning' || !this.gate('tap')) return;
    J.unlockAudio();
    this.busy = true;
    this.hideGuide();
    this.hideTip();
    this.cta.setEnabled(false);
    const prev = this.ui.s;
    const next = step(prev, { type: 'tap' });
    const report = next.lastReport;
    if (!report) { this.busy = false; return; }

    await this.revealCandle(report.candle);

    const sc: Score = { base: 0, mult: 1, today: 0 };
    this.ui.score = sc;
    this.setScore(sc);
    let pos = 0, neg = 0, k = 0;
    const order = prev.grid.map((c, i) => ({ c, i })).filter((x): x is { c: CardInstance; i: number } => x.c !== null);
    for (const { c, i } of order) {
      const r = report.results.find((x) => x.uid === c.uid);
      if (!r || r.cash === 0) continue;
      if (r.cash > 0) { sc.base += r.base > 0 ? r.base : r.cash; pos += r.cash; sc.mult = sc.base ? pos / sc.base : 1; }
      else neg += r.cash;
      sc.today = pos + neg;
      this.setScore(sc);
      this.bump('base');
      const boosted = r.cash > 0 && r.base > 0 && r.cash !== r.base;
      if (boosted) this.bump('mult', 1.3);
      this.cards[i]?.pop(boosted ? 1.2 : 1);
      this.flyChips(i, r.cash, r.base);
      if (r.cash > 0) { J.coin(k); J.buzz(6); } else { J.loss(); J.buzz([20, 30, 20]); }
      k++;
      await J.wait(Math.max(80, 210 - k * 11));
    }
    sc.today = report.income;
    this.setScore(sc);
    this.bump('today', 1.6);
    const record = report.income > this.ui.bestIncome && prev.day > 2;
    if (report.income > this.ui.bestIncome) this.ui.bestIncome = report.income;
    this.ui.tape.push(report.candle);
    const scale = Math.min(1, Math.abs(report.income) / Math.max(200, prev.payroll.amount * 0.6));
    this.shake(scale * 0.7);
    this.pulseBg(report.income >= 0 ? C.gold : C.clay, 0.3 + scale);
    if (record) {
      this.fire?.start();
      J.fanfare();
      this.time.delayedCall(2600, () => this.fire?.stop());
      this.toast('New record day');
    }
    this.animateCash(prev.cash, next.cash, 560);
    await J.wait(680);

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
      await J.wait(300);
      this.openPayout();
    } else if (next.phase === 'dead') {
      this.showDeath();
    }
    this.maybeTips();
  }

  private async revealCandle(c: Candle): Promise<void> {
    const G = this.L.grid;
    const layer = this.add.container(0, 0).setDepth(DEPTH.fly - 1);
    const dim = this.add.graphics();
    dim.fillStyle(C.ink, 0.78);
    dim.fillRoundedRect(u(G.x - 10), u(G.y - 10), u(G.w + 20), u(G.h + 20), u(18));
    const cx = G.x + G.w / 2, cy = G.y + G.h / 2 - 16;
    const candle = this.add.graphics();
    const label = text(this, cx, cy + 82, '', { size: this.L.wide ? 34 : 26, weight: 800, spacing: 4, align: 'center' }).setOrigin(0.5);
    const sub = text(this, cx, cy + 116, '', { size: 11.5, weight: 800, color: H.muted, spacing: 1.8, align: 'center' }).setOrigin(0.5);
    layer.add([dim, candle, label, sub]);
    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 120 });
    const draw = (h: number, color: number): void => {
      candle.clear();
      candle.fillStyle(color, 1);
      candle.fillRoundedRect(u(cx - 2), u(cy - h / 2 - 26), u(4), u(h + 52), u(2));
      candle.fillRoundedRect(u(cx - 16), u(cy - h / 2), u(32), u(h), u(4));
    };
    const st = { h: 8 };
    this.tweens.add({ targets: st, h: { from: 8, to: 92 }, duration: 640, ease: (v: number) => Math.sin(v * Math.PI * 2.2) * 0.35 + v * 0.65, onUpdate: () => draw(st.h, C.muted) });
    for (let t = 0; t < 5; t++) { J.tick(); await J.wait(120); }
    const color = c === 'up' ? C.paper : c === 'down' ? C.clay : c === 'news' ? C.gold : C.muted;
    this.tweens.killTweensOf(st);
    draw(c === 'chop' ? 28 : 74, color);
    label.setText(CANDLE[c]).setColor(c === 'down' ? H.clay : c === 'news' ? H.gold : H.paper);
    sub.setText(CANDLE_SUB[c].toUpperCase());
    if (c === 'chop') J.coin(0); else if (c === 'news') J.alarm(); else J.thud();
    J.buzz(c === 'chop' ? 10 : 30);
    this.pulseBg(color, 0.5);
    this.burst?.explode(c === 'chop' ? 10 : 26, u(cx), u(cy));
    label.setScale(1.3);
    this.tweens.add({ targets: label, scale: 1, duration: 260, ease: 'Back.easeOut' });
    await J.wait(600);
    this.tweens.add({ targets: layer, alpha: 0, duration: 140, onComplete: () => layer.destroy() });
  }

  private flyChips(i: number, cash: number, base: number): void {
    const p = this.slotPos(i);
    const c = this.add.container(u(p.x), u(p.y - this.L.ch / 2 + 6)).setDepth(DEPTH.fly);
    const pill = (str: string, fill: number, ink: string, x: number): number => {
      const t = text(this, 0, 0, str, { size: this.L.wide ? 14 : 12, weight: 800, color: ink }).setOrigin(0.5);
      const w = t.width / u(1) + 14, h = this.L.wide ? 26 : 22;
      const g = this.add.graphics();
      roundRect(g, x, -h / 2 + 3, w, h, 8, 0x000000, 0.35);
      roundRect(g, x, -h / 2, w, h, 8, fill);
      t.setPosition(u(x + w / 2), 0);
      c.add([g, t]);
      return w;
    };
    const boosted = cash > 0 && base > 0 && cash !== base;
    if (cash < 0) pill(signed(cash), C.ink, H.clay, 0);
    else {
      const w1 = pill(`+${base > 0 ? base : cash}`, C.chip, H.chipInk, 0);
      if (boosted) pill(`×${(cash / base).toFixed(1)}`, C.clay, H.clayInk, w1 + 4);
    }
    const b = c.getBounds();
    c.x -= b.width / 2;
    c.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: c, scale: 1.12, alpha: 1, y: c.y - u(20), duration: 200, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, y: c.y - u(36), alpha: 0, delay: 640, duration: 320, ease: 'Quad.easeIn', onComplete: () => c.destroy() });
  }

  private animateCash(from: number, to: number, ms: number): void {
    const o = { v: from };
    this.tweens.add({ targets: o, v: to, duration: ms, ease: 'Cubic.easeOut', onUpdate: () => this.setCash(o.v), onComplete: () => { this.setCash(to); this.renderHud(); } });
  }

  // ---------------------------------------------------------------- shop

  private renderShop(): void {
    const s = this.ui.s;
    const wasOpen = !!this.shop;
    this.shop?.destroy();
    this.shop = null;
    delete this.hits.shop; delete this.hits.offers;
    if (s.phase !== 'draft') return;
    const { W, H: Hh, wide, center: CT, view: V } = this.L;
    const root = this.add.container(0, 0).setDepth(DEPTH.shop);
    this.shop = root;
    const below = Math.max(0, V.y + V.h - Hh) + 24;
    if (this.ui.selected !== null) {
      const o = s.offers[this.ui.selected];
      const bw = wide ? CT.w : W - 20, bh = wide ? 84 : 76;
      const bx = wide ? CT.x : 10, by = Hh - bh - (wide ? 16 : 6);
      const g = this.add.graphics();
      roundRect(g, bx, by, bw, bh, 16, C.panel, 0.97);
      strokeRect(g, bx, by, bw, bh, 16, C.gold, 1, 0.5);
      const t = text(this, bx + 18, by + (wide ? 20 : 16), `PLACE ${o ? offerName(o).toUpperCase() : ''}`, { size: wide ? 15 : 13, weight: 800, spacing: 2.4, color: H.gold });
      const sub = text(this, bx + 18, by + (wide ? 46 : 40), 'Tap a glowing slot on the book', { size: 12, weight: 600, color: H.muted });
      root.add([g, t, sub]);
      const back = new Button(this, bx + bw - 236, by + (bh - 48) / 2, 108, 48, 'BACK', { ...STYLE.dark, size: 11 });
      back.onClick = () => { this.ui.selected = null; this.renderGrid(); this.renderShop(); };
      const skip = new Button(this, bx + bw - 120, by + (bh - 48) / 2, 104, 48, 'SKIP', { ...STYLE.dark, size: 11 });
      skip.onClick = () => { if (!this.gate('skip')) return; this.ui.selected = null; this.act({ type: 'draft', pick: null }); this.emit('drafted'); };
      root.add([back, skip]);
      this.hits.shop = { x: bx, y: by, w: bw, h: bh };
      root.y = 40; root.setAlpha(0);
      this.tweens.add({ targets: root, y: 0, alpha: 1, duration: 220, ease: 'Cubic.easeOut' });
      return;
    }
    const pw = wide ? CT.w : W;
    const pad = wide ? 20 : 12;
    const cardH = wide ? 280 : Math.min(230, Hh * 0.27);
    const ph = pad + 22 + 14 + cardH + 14 + 50 + pad + 8;
    const px = wide ? CT.x : 0, py = Hh - ph + 8;
    const g = this.add.graphics();
    roundRect(g, px, py, pw, ph + below, 20, C.panel, 0.97);
    strokeRect(g, px, py, pw, ph + below, 20, C.line2, 1);
    root.add(g);
    root.add(text(this, px + pad + 2, py + pad, 'HIRE', { size: 14, weight: 800, spacing: 3.4 }));
    root.add(text(this, px + pw - pad - 2, py + pad + 2, `cash ${money(s.cash)} · payroll ${money(s.payroll.amount)} in ${Math.max(0, s.payroll.dueDay - s.day)}d`, { size: 12, weight: 700, color: H.muted }).setOrigin(1, 0));
    const ow = (pw - 2 * pad - 2 * (wide ? 16 : 8)) / 3;
    const oy = py + pad + 36;
    s.offers.forEach((o, i) => {
      const ox = px + pad + i * (ow + (wide ? 16 : 8));
      root.add(this.offerCard(o, i, ox, oy, ow, cardH));
      this.hits[`offer${i}`] = { x: ox, y: oy, w: ow, h: cardH };
    });
    this.hits.offers = { x: px + pad, y: oy, w: pw - 2 * pad, h: cardH };
    const by = oy + cardH + 14, bw = (pw - 2 * pad - 10) / 2;
    const rr = new Button(this, px + pad, by, bw, 50, `REROLL · ${money(rerollPrice(s))}`, { ...STYLE.dark, size: 12 });
    rr.setEnabled(s.cash >= rerollPrice(s));
    rr.onClick = () => { if (!this.gate('reroll')) return; J.tick(); this.act({ type: 'reroll' }); };
    const sk = new Button(this, px + pad + bw + 10, by, bw, 50, 'SKIP', { ...STYLE.gold, size: 12 });
    sk.onClick = () => { if (!this.gate('skip')) return; this.act({ type: 'draft', pick: null }); this.emit('drafted'); };
    root.add([rr, sk]);
    this.hits.reroll = { x: px + pad, y: by, w: bw, h: 50 };
    this.hits.skip = { x: px + pad + bw + 10, y: by, w: bw, h: 50 };
    this.hits.shop = { x: px, y: py, w: pw, h: ph };
    if (!wasOpen) { root.y = ph; this.tweens.add({ targets: root, y: 0, duration: 340, ease: 'Back.easeOut', easeParams: [0.9] }); }
  }

  private offerCard(o: Offer, i: number, x: number, y: number, w: number, h: number): Phaser.GameObjects.Container {
    const s = this.ui.s;
    const price = offerPrice(o);
    const broke = s.cash < price;
    const rarity = offerRarity(o);
    const c = this.add.container(u(x + w / 2), u(y + h / 2));
    const g = this.add.graphics();
    roundRect(g, -w / 2 + 1, -h / 2 + 7, w, h, 14, 0x000000, 0.5);
    roundRect(g, -w / 2, -h / 2, w, h, 14, C.paper);
    strokeRect(g, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 11, C.ink, 1, 0.12);
    if (rarity === 'rare') strokeRect(g, -w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 14, C.gold, 2.5);
    if (rarity === 'uncommon') strokeRect(g, -w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 14, C.plat, 1.5);
    c.add(g);
    const tagColor = rarity === 'rare' ? H.goldDeep : rarity === 'uncommon' ? H.blue : rarity === 'excuse' ? H.clayDeep : H.inkSoft;
    c.add(text(this, -w / 2 + 12, -h / 2 + 12, offerTag(o), { size: 9, weight: 800, color: tagColor, spacing: 1.8 }));
    const artSize = Math.min(w * 0.46, h * 0.3);
    const art = this.add.image(0, u(-h / 2 + 30 + artSize / 2), artTexture(this, offerArt(o))).setDisplaySize(u(artSize), u(artSize));
    c.add(art);
    const ny = -h / 2 + 40 + artSize;
    const name = text(this, -w / 2 + 12, ny, offerName(o), { size: this.L.wide ? 16 : 12.5, weight: 800, color: H.ink, wrap: w - 24 });
    c.add(name);
    const by = ny + name.height / u(1) + 4;
    if (h - (by + h / 2) > 30) c.add(text(this, -w / 2 + 12, by, offerBlurb(o), { size: this.L.wide ? 12 : 10.5, weight: 600, color: H.inkSoft, wrap: w - 24, lineSpacing: 1 }));
    // price badge
    const pg = this.add.graphics();
    const pt = text(this, 0, 0, money(price), { size: this.L.wide ? 13 : 11.5, weight: 800, color: broke ? H.clay : H.ink }).setOrigin(0.5);
    const bw = pt.width / u(1) + 16;
    roundRect(pg, w / 2 - bw - 8, -h / 2 - 10, bw, 24, 8, broke ? C.panel2 : C.goldDeep);
    roundRect(pg, w / 2 - bw - 8, -h / 2 - 10, bw, 22, 8, broke ? C.panel2 : C.gold);
    if (broke) strokeRect(pg, w / 2 - bw - 8, -h / 2 - 10, bw, 22, 8, C.clay, 1);
    pt.setPosition(u(w / 2 - bw / 2 - 8), u(-h / 2 + 1));
    c.add([pg, pt]);
    if (broke) c.setAlpha(0.55);
    // springy hover + sway
    const sc = new Spring(1, 1, 300, 16), lift = new Spring(0, 0, 300, 20), ph = Math.random() * 6;
    let t = 0;
    const tick = (_time: number, dtMs: number): void => {
      const dt = Math.min(0.05, dtMs / 1000); t += dt;
      c.setScale(sc.step(dt));
      c.y = u(y + h / 2) + u(lift.step(dt)) + Math.sin(t * 1.4 + ph) * u(2);
      c.rotation = Math.sin(t * 1.1 + ph) * 0.01;
    };
    this.events.on('update', tick);
    c.once('destroy', () => this.events.off('update', tick));
    c.setSize(u(w), u(h)).setInteractive({ useHandCursor: true });
    c.on('pointerover', () => { sc.target = 1.05; lift.target = -8; if (!broke) J.tick(); });
    c.on('pointerout', () => { sc.target = 1; lift.target = 0; });
    c.on('pointerup', () => { sc.x = 0.94; sc.kick(3); this.chooseOffer(i); });
    c.setScale(0.6);
    sc.kick(4 + i * 0.6);
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
      for (const [k, v] of rows) {
        c.add(text(this, pad, y, k, { size: 12.5, weight: 600, color: H.muted }));
        c.add(text(this, w - pad, y, v, { size: 12.5, weight: 800 }).setOrigin(1, 0));
        y += 24;
      }
      y += 6;
      const close = new Button(this, pad, y, w - 2 * pad, 46, 'CLOSE', { ...STYLE.dark, size: 12 });
      close.onClick = () => this.closeOverlay();
      c.add(close);
      return y + 46 + pad + 6;
    });
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

  showDeath(): void {
    const s = this.ui.s;
    this.guideStop();
    this.shop?.destroy(); this.shop = null;
    J.thud(); J.buzz([80, 60, 120]); this.pulseBg(C.clay, 1.2); this.shake(0.9);
    const best = store<{ days: number; val: number }>('best') ?? { days: 0, val: 0 };
    const newBest = s.stats.peakValuation > best.val && this.ui.mode !== 'tutorial';
    if (newBest) store('best', { days: s.day, val: s.stats.peakValuation });
    const near = s.cause === 'payroll' ? `${money(s.shortBy)} short` : s.cause === 'trust' ? 'Trust hit zero' : 'Heat hit 100';
    const share = `${this.ui.firm} lasted ${s.day} days on FIRM. Peak valuation ${money(s.stats.peakValuation)}. ${CAUSE[s.cause ?? 'payroll']}, ${near.toLowerCase()}.`;
    const pad = 20;
    const rects: Record<string, Rect> = {};
    const m = this.modal('death', 440, (c, w) => {
      let y = pad;
      c.add(text(this, pad, y, `FIRM CLOSED · DAY ${s.day}`, { size: 10.5, weight: 800, color: H.inkSoft, spacing: 1.8 }));
      y += 22;
      const name = text(this, pad, y, this.ui.firm, { size: 28, weight: 800, color: H.ink, wrap: w - 2 * pad });
      c.add(name);
      y += name.height / u(1) + 8;
      c.add(text(this, pad, y, CAUSE[s.cause ?? 'payroll'] ?? '', { size: 16, weight: 800, color: H.clayDeep }));
      c.add(text(this, pad, y + 22, near, { size: 14, weight: 700, color: H.inkSoft }));
      y += 52;
      const cells: [string, string][] = [['DAYS', String(s.day)], ['PEAK VALUE', money(s.stats.peakValuation)], ['TRUST', s.trust.toFixed(1)], ['PAID', String(s.stats.payoutsPaid)], ['DENIED', String(s.stats.payoutsDenied)], ['FRAUD CAUGHT', String(s.stats.fraudCaught)]];
      const cw = (w - 2 * pad) / 3;
      const g = this.add.graphics();
      cells.forEach(([k, v], idx) => {
        const cx = pad + (idx % 3) * cw, cy = y + Math.floor(idx / 3) * 56;
        roundRect(g, cx + 1, cy + 1, cw - 2, 54, 6, C.paper2);
        c.add(text(this, cx + 10, cy + 10, k, { size: 9, weight: 800, color: H.inkSoft, spacing: 1.2 }));
        c.add(text(this, cx + 10, cy + 26, v, { size: 17, weight: 800, color: H.ink }));
      });
      c.addAt(g, 1);
      y += 120;
      c.add(text(this, pad, y, newBest ? 'NEW PERSONAL BEST' : best.val ? `BEST ${money(best.val)} · ${best.days} DAYS` : '', { size: 11, weight: 800, color: H.goldDeep, spacing: 1.6 }));
      y += 26;
      const nb = new Button(this, pad, y, w - 2 * pad, 58, 'NEW FIRM', { ...STYLE.clay, size: 17, spacing: 3, sub: this.L.wide ? 'space' : undefined });
      nb.onClick = () => { J.tick(); this.newGame('random'); };
      c.add(nb);
      rects.new = { x: pad, y, w: w - 2 * pad, h: 58 };
      y += 68;
      const bw = (w - 2 * pad - 10) / 2;
      const daily = new Button(this, pad, y, bw, 44, 'DAILY TAPE', { fill: C.paper, deep: C.paper3, ink: H.ink, stroke: C.paper3, size: 11 });
      daily.onClick = () => { J.tick(); this.newGame('daily'); };
      const copy = new Button(this, pad + bw + 10, y, bw, 44, 'COPY RESULT', { fill: C.paper, deep: C.paper3, ink: H.ink, stroke: C.paper3, size: 11 });
      copy.onClick = () => { navigator.clipboard?.writeText(share).then(() => this.toast('Copied'), () => this.toast(share)); };
      c.add([daily, copy]);
      return y + 44 + pad;
    }, { paper: true, center: true });
    for (const [k, r] of Object.entries(rects)) this.hit(k, m.x, m.y, r);
    m.content.setAngle(-3);
    this.tweens.add({ targets: m.content, angle: 0, duration: 520, ease: 'Back.easeOut' });
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
    const c = this.add.container(this.L.wide ? this.L.center.x + this.L.center.w / 2 : this.L.W / 2, this.L.wide ? 56 : 20 + h / 2, [g, t]).setDepth(DEPTH.toast);
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
      view: () => ({ phase: self.ui.s.phase, busy: self.busy, shop: !!self.shop, placing: self.ui.selected !== null, overlay: self.overlayKind, guide: !!self.guideNow, wait: self.guideNow?.o.wait ?? null, hint: self.guideNow?.o.hint ?? null }),
      rect: (name: string) => {
        const r = self.hits[name] ?? self.hits[`ov:${name}`];
        if (!r) return null;
        const { view: V, fit } = self.L;
        return { x: (r.x - V.x) * fit, y: (r.y - V.y) * fit, w: r.w * fit, h: r.h * fit };
      },
      layout: () => ({ W: self.L.W, H: self.L.H, k: self.L.k, fit: self.L.fit, wide: self.L.wide }),
      firstEmpty: () => self.ui.s.grid.findIndex((c) => c === null),
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
