import {
  BALANCE, CARDS, EXCUSES, cardDef, displayName, excuseDef, findCard, legalActions, newRun, offerPrice, rerollPrice, seedFromString, step, trustMultiplier, valuation,
} from '@firm/sim';
import type { Action, Candle, CardInstance, GameState, Offer } from '@firm/sim';
import * as J from '../juice.ts';
import { CardView, artTexture, shortName } from './card.ts';
import { BG_FRAG, CrtPipeline } from './shaders.ts';
import { C, DEPTH, H } from './theme.ts';
import { Button, STYLE, Spring, dashedRect, roundRect, strokeRect, text, u } from './ui.ts';

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

type Gate = 'tap' | 'select' | 'place' | 'skip' | 'reroll' | 'pay' | 'stall' | 'deny' | 'info' | 'sale' | 'loan';
interface Rect { x: number; y: number; w: number; h: number }
interface Say { text: string; target?: string | null; hint?: string; wait?: string; allow?: Gate[]; top?: boolean }

interface Layout {
  W: number; H: number; wide: boolean;
  panel: Rect; row: Rect; grid: Rect; cw: number; ch: number; gap: number; cta: Rect; moves: Rect | null;
}

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
  private cards: CardView[] = [];
  private hud: Record<string, Phaser.GameObjects.Text> = {};
  private hudG!: Phaser.GameObjects.Graphics;
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

  private computeLayout(): Layout {
    const W = this.scale.width / window.devicePixelRatio, Hh = this.scale.height / window.devicePixelRatio;
    const wide = W >= 900 && W / Hh >= 1.25;
    const s = this.ui.s;
    const due = s.payroll.amount + (s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0);
    const desperate = this.ui.mode !== 'tutorial' && s.phase === 'morning' && s.cash < due && s.payroll.dueDay - s.day <= 1;
    const ratio = 1.38;
    if (wide) {
      const m = 18;
      const panel = { x: m, y: m, w: 320, h: Hh - 2 * m };
      const tx = panel.x + panel.w + 26, tw = W - tx - 28;
      const ctaH = 74;
      const cta = { x: tx + tw / 2 - 190, y: Hh - m - ctaH, w: 380, h: ctaH };
      const row = { x: tx, y: m, w: tw, h: 34 };
      const gy = row.y + row.h + 12, gh = cta.y - 18 - gy;
      const gap = 12;
      let ch = (gh - 3 * gap) / 4, cw = ch / ratio;
      if (cw * 5 + 4 * gap > tw) { cw = (tw - 4 * gap) / 5; ch = cw * ratio; }
      const gw = cw * 5 + gap * 4, gH = ch * 4 + gap * 3;
      const grid = { x: tx + (tw - gw) / 2, y: gy + (gh - gH) / 2, w: gw, h: gH };
      const moves = desperate ? { x: tx, y: cta.y, w: Math.min(360, cta.x - tx - 20), h: ctaH } : null;
      return { W, H: Hh, wide, panel, row, grid, cw, ch, gap, cta, moves };
    }
    const mx = 12;
    const panel = { x: mx, y: 10, w: W - 2 * mx, h: 214 };
    const row = { x: mx, y: panel.y + panel.h + 8, w: W - 2 * mx, h: 32 };
    const ctaH = 60;
    const cta = { x: mx, y: Hh - 12 - ctaH, w: W - 2 * mx, h: ctaH };
    const moves = desperate ? { x: mx, y: cta.y - 62, w: W - 2 * mx, h: 54 } : null;
    const gy = row.y + row.h + 10, gBottom = (moves ? moves.y : cta.y) - 12, gh = gBottom - gy;
    const gap = 6, tw = W - 2 * mx;
    let ch = (gh - 3 * gap) / 4, cw = ch / ratio;
    if (cw * 5 + 4 * gap > tw) { cw = (tw - 4 * gap) / 5; ch = cw * ratio; }
    const gw = cw * 5 + gap * 4, gH = ch * 4 + gap * 3;
    const grid = { x: mx + (tw - gw) / 2, y: gy + (gh - gH) / 2, w: gw, h: gH };
    return { W, H: Hh, wide, panel, row, grid, cw, ch, gap, cta, moves };
  }

  private build(): void {
    this.tweens.killAll();
    this.children.removeAll(true);
    this.cards = []; this.moveBtns = []; this.hud = {}; this.veiled = {}; this.hits = {};
    this.shop = null; this.overlay = null; this.tip = null; this.toastObj = null; this.guideLayer = null;
    this.L = this.computeLayout();
    const { W, H: Hh } = this.L;
    // backdrop
    const shader = new Phaser.Display.BaseShader('bg', BG_FRAG, undefined, {
      uPix: { type: '1f', value: u(4) }, uSpin: { type: '1f', value: 0 },
      uPulse: { type: '4f', value: { x: 0, y: 0, z: 0, w: 0 } }, uHeat: { type: '1f', value: 0 },
    });
    this.bg = this.add.shader(shader, 0, 0, u(W), u(Hh)).setOrigin(0).setDepth(DEPTH.bg);
    // particles
    this.fire = this.add.particles(0, 0, 'dot', { speed: { min: u(30), max: u(90) }, angle: { min: 240, max: 300 }, lifespan: { min: 500, max: 900 }, scale: { start: u(0.45), end: 0 }, tint: [C.gold, C.clay, 0xffe0a0], blendMode: 'ADD', emitting: false, frequency: 18, quantity: 2 }).setDepth(DEPTH.fly);
    this.burst = this.add.particles(0, 0, 'dot', { speed: { min: u(80), max: u(260) }, lifespan: { min: 350, max: 700 }, scale: { start: u(0.38), end: 0 }, tint: [C.gold, C.paper], blendMode: 'ADD', emitting: false, gravityY: u(380) }).setDepth(DEPTH.fly);
    this.buildHud();
    this.buildRow();
    this.buildGrid();
    this.buildBar();
    this.renderAll();
  }

  // ---------------------------------------------------------------- HUD

  private box(x: number, y: number, w: number, h: number, fill: number, stroke: number = C.line, a = 1, reveal?: string): void {
    let g = this.hudG;
    if (reveal) { g = this.add.graphics().setDepth(DEPTH.hud); (this.veiled[reveal] ??= []).push(g); }
    roundRect(g, x, y, w, h, 10, fill, a);
    strokeRect(g, x, y, w, h, 10, stroke, 1);
  }

  private label(name: string, x: number, y: number, str: string, o: Parameters<typeof text>[4], reveal?: string): Phaser.GameObjects.Text {
    const t = text(this, x, y, str, o).setDepth(DEPTH.hud + 1);
    this.hud[name] = t;
    if (reveal) (this.veiled[reveal] ??= []).push(t);
    return t;
  }

  private scoreBox(x: number, y: number, w: number, h: number, fill: number, deep: number, lbl: string, ink: string, key: string, alignRight: boolean): Phaser.GameObjects.Container {
    const c = this.add.container(u(x + w / 2), u(y + h / 2)).setDepth(DEPTH.hud + 1);
    const g = this.add.graphics();
    roundRect(g, -w / 2, -h / 2 + 3, w, h - 3, 10, deep);
    roundRect(g, -w / 2, -h / 2, w, h - 3, 10, fill);
    const l = text(this, alignRight ? w / 2 - 10 : -w / 2 + 10, -h / 2 + 8, lbl, { size: 10, weight: 800, color: ink, spacing: 1.6 }).setOrigin(alignRight ? 1 : 0, 0).setAlpha(0.7);
    const v = text(this, alignRight ? w / 2 - 10 : -w / 2 + 10, h / 2 - 6, '0', { size: h > 56 ? 28 : 19, weight: 800, color: ink }).setOrigin(alignRight ? 1 : 0, 1);
    c.add([g, l, v]);
    this.hud[key] = v;
    this.boxSprings[key] = new Spring(1, 1, 380, 16);
    return c;
  }

  private buildHud(): void {
    const { panel: P, wide } = this.L;
    this.hudG = this.add.graphics().setDepth(DEPTH.hud);
    roundRect(this.hudG, P.x, P.y, P.w, P.h, wide ? 18 : 14, C.panel, 0.94);
    strokeRect(this.hudG, P.x, P.y, P.w, P.h, wide ? 18 : 14, C.line, 1);
    const x0 = P.x + (wide ? 14 : 8), w = P.w - (wide ? 28 : 16);
    let y = P.y + (wide ? 16 : 8);
    // brand row
    const fs = wide ? 20 : 15;
    this.label('mark', x0 + 4, y + (wide ? 4 : 6), 'FIRM', { size: fs, weight: 800, spacing: fs * 0.32 });
    this.label('firm', x0 + (wide ? 96 : 70), y + (wide ? 9 : 9), '', { size: 12, weight: 600, color: H.muted });
    const how = new Button(this, x0 + w - 104, y, 34, 32, '?', { ...STYLE.dark, size: 13, spacing: 0 }).setDepth(DEPTH.hud + 2);
    how.onClick = () => this.showHow();
    this.hits.how = { x: x0 + w - 104, y, w: 34, h: 32 };
    const snd = new Button(this, x0 + w - 64, y, 64, 32, J.isMuted() ? 'MUTED' : 'SOUND', { ...STYLE.dark, size: 10.5, spacing: 1 }).setDepth(DEPTH.hud + 2);
    snd.onClick = () => { J.unlockAudio(); J.setMuted(!J.isMuted()); store('muted', J.isMuted()); snd.setLabel(J.isMuted() ? 'MUTED' : 'SOUND'); };
    y += wide ? 46 : 40;

    if (wide) {
      // payroll
      this.box(x0, y, w, 118, 0x1d1210, 0x5a3426, 1, 'payroll');
      this.label('payLbl', x0 + 14, y + 14, 'PAYROLL · PAY AT LEAST', { size: 10.5, weight: 800, color: H.muted, spacing: 1.4 }, 'payroll');
      this.label('payAmt', x0 + 14, y + 32, '$0', { size: 34, weight: 800 }, 'payroll');
      this.label('payWhen', x0 + w - 14, y + 14, '', { size: 12, weight: 700, color: H.muted }, 'payroll').setOrigin(1, 0);
      this.hits.payroll = { x: x0, y, w, h: 118 };
      this.payrollGeom = { x: x0 + 14, y: y + 82, w: w - 28, dotsX: x0 + w - 14, dotsY: y + 40 };
      this.label('payGap', x0 + 14, y + 94, '', { size: 12, weight: 700, color: H.muted }, 'payroll');
      y += 130;
      // fees x mult
      const bw = (w - 26) / 2;
      this.chipBox = this.scoreBox(x0, y, bw, 66, C.chip, C.chipDeep, 'FEES', H.chipInk, 'base', true);
      this.label('times', x0 + bw + 13, y + 33, '×', { size: 20, weight: 800, color: H.muted }).setOrigin(0.5);
      this.multBox = this.scoreBox(x0 + bw + 26, y, bw, 66, C.clay, C.clayDeep, 'MULT', H.clayInk, 'mult', false);
      this.hits.score = { x: x0, y, w, h: 66 };
      y += 78;
      this.todayBox = this.add.container(u(x0 + w / 2), u(y + 22)).setDepth(DEPTH.hud + 1);
      this.todayBox.add(text(this, -w / 2 + 6, 0, 'TODAY', { size: 10.5, weight: 800, color: H.muted, spacing: 1.6 }).setOrigin(0, 0.5));
      const tv = text(this, w / 2 - 6, 0, '+$0', { size: 34, weight: 800 }).setOrigin(1, 0.5);
      this.todayBox.add(tv); this.hud.today = tv; this.boxSprings.today = new Spring(1, 1, 380, 16);
      y += 54;
      // cash + meters
      const hw = (w - 10) / 2;
      this.box(x0, y, hw, 70, C.panel2);
      this.label('cashLbl', x0 + 12, y + 12, 'CASH', { size: 10.5, weight: 800, color: H.muted, spacing: 1.6 });
      this.label('cash', x0 + 12, y + 30, '$0', { size: 28, weight: 800, color: H.gold });
      this.hits.cash = { x: x0, y, w: hw, h: 70 };
      this.box(x0 + hw + 10, y, hw, 70, C.panel2, C.line, 1, 'trust');
      this.meterGeom = { x: x0 + hw + 22, y: y + 22, w: hw - 24, gap: 26 };
      this.label('trustLbl', x0 + hw + 22, y + 14, 'Trust', { size: 11, weight: 700, color: H.muted }, 'trust');
      this.label('trust', x0 + 2 * hw + 0, y + 14, '3.0', { size: 11, weight: 800 }, 'trust').setOrigin(1, 0);
      this.label('heatLbl', x0 + hw + 22, y + 40, 'Heat', { size: 11, weight: 700, color: H.muted }, 'trust');
      this.label('heat', x0 + 2 * hw + 0, y + 40, '0', { size: 11, weight: 800 }, 'trust').setOrigin(1, 0);
      this.hits.meters = { x: x0 + hw + 10, y, w: hw, h: 70 };
      y += 82;
      // stats
      const sw = (w - 18) / 4;
      [['DAY', 'day'], ['CYCLE', 'cycle'], ['REROLL', 'rr'], ['BOOK', 'book']].forEach(([lbl, key], i) => {
        const bx = x0 + i * (sw + 6);
        this.box(bx, y, sw, 56, C.panel2);
        this.label(`${key}L`, bx + sw / 2, y + 10, lbl ?? '', { size: 9.5, weight: 800, color: H.muted, spacing: 1.2 }).setOrigin(0.5, 0);
        this.label(key ?? '', bx + sw / 2, y + 26, '', { size: 18, weight: 800 }).setOrigin(0.5, 0);
      });
      y += 68;
      const bh = 44;
      const b1 = new Button(this, x0, y, (w - 8) / 2, bh, 'HOW IT WORKS', { ...STYLE.dark, size: 10.5 }).setDepth(DEPTH.hud + 2);
      b1.onClick = () => this.showHow();
      const b2 = new Button(this, x0 + (w + 8) / 2, y, (w - 8) / 2, bh, 'NEW FIRM', { ...STYLE.dark, size: 10.5 }).setDepth(DEPTH.hud + 2);
      b2.onClick = () => { if (!this.busy) this.newGame('random'); };
      y += bh + 18;
      // the feed
      this.feedGeom = { x: x0 + 4, y, w: w - 8, bottom: P.y + P.h - 14 };
    } else {
      const pw = w * 0.72, cwid = w - pw - 6;
      this.box(x0, y, pw, 76, 0x1d1210, 0x5a3426, 1, 'payroll');
      this.label('payLbl', x0 + 10, y + 9, 'PAYROLL · PAY AT LEAST', { size: 9.5, weight: 800, color: H.muted, spacing: 1 }, 'payroll');
      this.label('payAmt', x0 + 10, y + 24, '$0', { size: 21, weight: 800 }, 'payroll');
      this.label('payWhen', x0 + pw - 10, y + 9, '', { size: 11, weight: 700, color: H.muted }, 'payroll').setOrigin(1, 0);
      this.payrollGeom = { x: x0 + 10, y: y + 54, w: pw - 20, dotsX: x0 + pw - 10, dotsY: y + 32 };
      this.label('payGap', x0 + 10, y + 61, '', { size: 10.5, weight: 700, color: H.muted }, 'payroll');
      this.hits.payroll = { x: x0, y, w: pw, h: 76 };
      this.box(x0 + pw + 6, y, cwid, 76, C.panel2);
      this.label('cashLbl', x0 + pw + 6 + cwid / 2, y + 16, 'CASH', { size: 9.5, weight: 800, color: H.muted, spacing: 1.4 }).setOrigin(0.5, 0);
      this.label('cash', x0 + pw + 6 + cwid / 2, y + 34, '$0', { size: 18, weight: 800, color: H.gold }).setOrigin(0.5, 0);
      this.hits.cash = { x: x0 + pw + 6, y, w: cwid, h: 76 };
      y += 84;
      const bw = (pw - 20) / 2;
      this.chipBox = this.scoreBox(x0, y, bw, 52, C.chip, C.chipDeep, 'FEES', H.chipInk, 'base', true);
      this.label('times', x0 + bw + 10, y + 26, '×', { size: 16, weight: 800, color: H.muted }).setOrigin(0.5);
      this.multBox = this.scoreBox(x0 + bw + 20, y, bw, 52, C.clay, C.clayDeep, 'MULT', H.clayInk, 'mult', false);
      this.hits.score = { x: x0, y, w: pw, h: 52 };
      this.todayBox = this.add.container(u(x0 + pw + 6 + cwid / 2), u(y + 26)).setDepth(DEPTH.hud + 1);
      this.todayBox.add(text(this, 0, -12, 'TODAY', { size: 9.5, weight: 800, color: H.muted, spacing: 1.4 }).setOrigin(0.5));
      const tv = text(this, 0, 8, '+$0', { size: 18, weight: 800 }).setOrigin(0.5);
      this.todayBox.add(tv); this.hud.today = tv; this.boxSprings.today = new Spring(1, 1, 380, 16);
      y += 60;
      this.box(x0, y, w, 34, C.panel2, C.line, 1, 'trust');
      this.meterGeom = { x: x0 + 12, y: y + 17, w, gap: 0, inline: true };
      this.label('trustLbl', x0 + 12, y + 10, 'Trust', { size: 11, weight: 700, color: H.muted }, 'trust');
      this.label('trust', x0 + w / 2 - 12, y + 10, '3.0', { size: 11, weight: 800 }, 'trust').setOrigin(1, 0);
      this.label('heatLbl', x0 + w / 2 + 12, y + 10, 'Heat', { size: 11, weight: 700, color: H.muted }, 'trust');
      this.label('heat', x0 + w - 12, y + 10, '0', { size: 11, weight: 800 }, 'trust').setOrigin(1, 0);
      this.hits.meters = { x: x0, y, w, h: 34 };
      this.feedGeom = null;
    }
    this.hudDyn = this.add.graphics().setDepth(DEPTH.hud + 1);
  }

  private payrollGeom = { x: 0, y: 0, w: 0, dotsX: 0, dotsY: 0 };
  private meterGeom: { x: number; y: number; w: number; gap: number; inline?: boolean } = { x: 0, y: 0, w: 0, gap: 0 };
  private feedGeom: { x: number; y: number; w: number; bottom: number } | null = null;
  private hudDyn!: Phaser.GameObjects.Graphics;
  private feedTexts: Phaser.GameObjects.Text[] = [];

  private renderHud(): void {
    const s = this.ui.s;
    const g = this.hudDyn;
    g.clear();
    const firmT = this.hud.firm;
    if (firmT) {
      const full = this.L.wide ? this.ui.firm : `${this.ui.firm} · Day ${s.day}`;
      firmT.setText(full);
      const max = u(this.L.wide ? 130 : this.L.panel.w - 70 - 120);
      let cut = full;
      while (firmT.width > max && cut.length > 4) { cut = cut.slice(0, -1); firmT.setText(`${cut.trimEnd()}…`); }
    }
    this.setCash(this.shownCash);
    this.setScore(this.ui.score);
    const loanDue = s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0;
    const due = s.payroll.amount + loanDue;
    const days = s.payroll.dueDay - s.day;
    this.hud.payAmt?.setText(money(due));
    this.hud.payWhen?.setText(days <= 0 ? 'due tonight' : `in ${days} day${days === 1 ? '' : 's'}`);
    const short = this.shownCash < due;
    this.hud.payGap?.setText(!short ? `Covered · next ${money(Math.round((s.payroll.amount * BALANCE.payrollGrowth) / 10) * 10)}` : `Need ${money(due - this.shownCash)} more${loanDue ? ' (incl. loan)' : ''}`).setColor(short ? H.clay : H.muted);
    const showPay = this.ui.revealed.includes('payroll');
    if (showPay) {
      const P = this.payrollGeom;
      roundRect(g, P.x, P.y, P.w, 5, 3, C.paper, 0.1);
      roundRect(g, P.x, P.y, Math.max(5, P.w * Math.min(1, this.shownCash / due)), 5, 3, short ? C.clay : C.paper);
      const elapsed = Math.max(0, BALANCE.cycleDays - Math.max(0, days) - 1);
      for (let k = 0; k < BALANCE.cycleDays; k++) {
        const cx = P.dotsX - (BALANCE.cycleDays - 1 - k) * 13 - 4;
        if (k < elapsed) { g.fillStyle(C.clay, 1); g.fillCircle(u(cx), u(P.dotsY + 6), u(4)); }
        else { g.lineStyle(u(1.5), C.clay, 1); g.strokeCircle(u(cx), u(P.dotsY + 6), u(3.6)); }
      }
    }
    // meters
    const M = this.meterGeom;
    if (this.ui.revealed.includes('trust')) {
      const drawDots = (x: number, y: number, w: number, n: number, color: number): void => {
        const step = w / 10;
        for (let k = 0; k < 10; k++) { g.fillStyle(k < n ? color : C.paper, k < n ? 1 : 0.1); g.fillRoundedRect(u(x + k * step), u(y - 3), u(step - 3), u(6), u(3)); }
      };
      if (M.inline) {
        const half = M.w / 2;
        drawDots(M.x + 40, M.y, half - 88, Math.round(s.trust * 2), C.plat);
        drawDots(M.x + half + 36, M.y, half - 82, Math.round(s.heat / 10), s.heat >= 60 ? C.clay : C.bronze);
      } else {
        drawDots(M.x + 40, M.y, M.w - 70, Math.round(s.trust * 2), C.plat);
        drawDots(M.x + 40, M.y + M.gap, M.w - 70, Math.round(s.heat / 10), s.heat >= 60 ? C.clay : C.bronze);
      }
    }
    this.hud.trust?.setText(s.trust.toFixed(1));
    this.hud.heat?.setText(String(Math.round(s.heat))).setColor(s.heat >= 60 ? H.clay : H.paper);
    this.hud.day?.setText(String(s.day));
    this.hud.cycle?.setText(String(s.payroll.cycle));
    this.hud.rr?.setText(money(rerollPrice(s)));
    this.hud.book?.setText(String(s.grid.filter(Boolean).length));
    this.bg?.setUniform('uHeat.value', s.heat / 100);
    // feed
    this.feedTexts.forEach((t) => t.destroy());
    this.feedTexts = [];
    if (this.feedGeom) {
      let fy = this.feedGeom.y;
      for (const p of s.feed.slice(0, 5)) {
        const h = text(this, this.feedGeom.x, fy, p.handle, { size: 11.5, weight: 800, color: p.tone === 'bad' ? H.clay : p.tone === 'good' ? H.gold : H.paper }).setDepth(DEPTH.hud + 1);
        const b = text(this, this.feedGeom.x, fy + 16, p.text, { size: 11.5, weight: 600, color: H.muted, wrap: this.feedGeom.w, lineSpacing: 2 }).setDepth(DEPTH.hud + 1);
        const bottom = fy + 16 + b.height / u(1);
        if (bottom > this.feedGeom.bottom) { h.destroy(); b.destroy(); break; }
        this.feedTexts.push(h, b);
        fy = bottom + 10;
      }
    }
    for (const [key, objs] of Object.entries(this.veiled)) objs.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(this.ui.revealed.includes(key)));
  }

  private setCash(v: number): void { this.shownCash = v; this.hud.cash?.setText(money(v)); }
  private setScore(sc: Score): void {
    this.hud.base?.setText(Math.round(sc.base).toLocaleString('en-US'));
    this.hud.mult?.setText(sc.mult.toFixed(sc.mult >= 10 ? 0 : 2));
    this.hud.today?.setText(signed(sc.today));
  }

  // ---------------------------------------------------------------- top row: excuses + tape

  private buildRow(): void {
    this.rowLayer = this.add.container(0, 0).setDepth(DEPTH.hud);
  }

  private renderRow(): void {
    const R = this.L.row;
    this.rowLayer.removeAll(true);
    const s = this.ui.s;
    // excuses as clay pills
    let x = R.x;
    if (this.ui.revealed.includes('hand')) {
      const list = s.excuses.length ? s.excuses.map((e) => excuseDef(e).name) : ['No excuses'];
      for (const name of list) {
        const t = text(this, 0, 0, name, { size: this.L.wide ? 11.5 : 10.5, weight: 800, color: s.excuses.length ? H.blush : H.muted });
        const tw = t.width / u(1) + 18;
        if (x + tw > R.x + R.w * (this.L.wide ? 0.6 : 0.52)) { t.destroy(); break; }
        const g = this.add.graphics();
        roundRect(g, x, R.y + 4, tw, R.h - 8, 8, C.clay, s.excuses.length ? 0.12 : 0);
        strokeRect(g, x, R.y + 4, tw, R.h - 8, 8, s.excuses.length ? C.clay : C.line2, 1, s.excuses.length ? 0.45 : 1);
        t.setPosition(u(x + 9), u(R.y + R.h / 2)).setOrigin(0, 0.5);
        this.rowLayer.add([g, t]);
        x += tw + 6;
      }
      this.hits.excuses = { x: R.x, y: R.y, w: Math.max(40, x - R.x), h: R.h };
    }
    if (this.ui.revealed.includes('odds')) {
      const f = s.forecast;
      const odds = this.L.wide
        ? `Next  Chop ${Math.round(f.chop * 100)}% · Up ${Math.round(f.up * 100)}% · Dn ${Math.round(f.down * 100)}% · News ${Math.round(f.news * 100)}%`
        : `C${Math.round(f.chop * 100)} U${Math.round(f.up * 100)} D${Math.round(f.down * 100)} N${Math.round(f.news * 100)}`;
      const ot = text(this, R.x + R.w, R.y + R.h / 2, odds, { size: this.L.wide ? 12 : 11, weight: 700, color: H.muted }).setOrigin(1, 0.5);
      this.rowLayer.add(ot);
      const g = this.add.graphics();
      const tape = this.ui.tape.slice(-14);
      let tx = R.x + R.w - ot.width / u(1) - 12 - tape.length * 7;
      const base = R.y + R.h / 2 + 10;
      for (const c of tape) {
        const h = c === 'chop' ? 6 : c === 'news' ? 22 : 17;
        g.fillStyle(c === 'chop' ? C.muted : c === 'up' ? C.paper : c === 'down' ? C.clay : C.gold, 1);
        g.fillRoundedRect(u(tx), u(base - h), u(4), u(h), u(1));
        tx += 7;
      }
      this.rowLayer.add(g);
      this.hits.odds = { x: R.x + R.w * 0.5, y: R.y, w: R.w * 0.5, h: R.h };
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
      if (cv.card !== c || !c) cv.setCard(c);
      else cv.setCard(c);
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
    this.cta = new Button(this, A.x, A.y, A.w, A.h, 'OPEN MARKET', { ...STYLE.clay, size: this.L.wide ? 22 : 18, spacing: this.L.wide ? 3 : 2.4, sub: `Day ${this.ui.s.day}` }).setDepth(DEPTH.hud + 2);
    this.cta.onClick = () => void this.onTap();
    this.hits.cta = { ...A };
    const M = this.L.moves;
    if (M) {
      const s = this.ui.s;
      const legal = legalActions(s);
      const bw = (M.w - 8) / 2;
      const sale = new Button(this, M.x, M.y, bw, M.h, 'FLASH SALE', { fill: C.panel, deep: 0x050506, ink: H.gold, stroke: C.goldDeep, size: 12, sub: `+${money(100 + 100 * s.payroll.cycle)} · 3 strangers · −Trust` }).setDepth(DEPTH.hud + 2);
      sale.setEnabled(legal.some((a) => a.type === 'flashSale'));
      sale.onClick = () => { if (this.gate('sale')) this.act({ type: 'flashSale' }, 'Flash sale. Cash in, strangers in.'); };
      const loan = new Button(this, M.x + bw + 8, M.y, bw, M.h, 'FOUNDER LOAN', { fill: C.panel, deep: 0x050506, ink: H.gold, stroke: C.goldDeep, size: 12, sub: `+${money(s.payroll.amount)} · repay ${money(Math.round(s.payroll.amount * 1.6))}` }).setDepth(DEPTH.hud + 2);
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
    const needMoves = (() => {
      const due = s.payroll.amount + (s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0);
      return this.ui.mode !== 'tutorial' && s.phase === 'morning' && s.cash < due && s.payroll.dueDay - s.day <= 1;
    })();
    if (needMoves !== !!this.L.moves) this.requestRebuild();
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
    for (const [key, sp] of Object.entries(this.boxSprings)) {
      const v = sp.step(dt);
      const target = key === 'base' ? this.chipBox : key === 'mult' ? this.multBox : this.todayBox;
      target?.setScale(v).setRotation((1 - v) * 0.4);
    }
    this.pulse.a *= Math.pow(0.12, dt);
    this.spin += dt * (0.02 + this.pulse.a * 0.5);
    this.bg?.setUniform('uSpin.value', this.spin);
    this.bg?.setUniform('uPulse.value', { x: this.pulse.r, y: this.pulse.g, z: this.pulse.b, w: this.pulse.a });
    if (this.crt) { this.crt.dpr = window.devicePixelRatio; this.crt.shake *= Math.pow(0.02, dt); }
    if (this.fire && this.fire.emitting) {
      const b = this.todayBox.getBounds();
      this.fire.setPosition(b.centerX, b.top + b.height * 0.3);
    }
  }

  private bump(key: string, amt = 1): void { this.boxSprings[key]?.kick(4 * amt); const sp = this.boxSprings[key]; if (sp) sp.x = 1 + 0.12 * amt; }
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
    const { W, H: Hh, wide } = this.L;
    const root = this.add.container(0, 0).setDepth(DEPTH.shop);
    this.shop = root;
    if (this.ui.selected !== null) {
      const o = s.offers[this.ui.selected];
      const bw = Math.min(wide ? 700 : W - 20, W - 20), bh = wide ? 76 : 70;
      const bx = (W - bw) / 2, by = wide ? Hh - bh : 0;
      const g = this.add.graphics();
      roundRect(g, bx, by, bw, bh + 18, 16, C.panel, 0.97);
      strokeRect(g, bx, by, bw, bh + 18, 16, C.line2, 1);
      const t = text(this, bx + 18, by + (wide ? 18 : 12), `PLACE ${o ? offerName(o).toUpperCase() : ''}`, { size: 13, weight: 800, spacing: 2.4 });
      const sub = text(this, bx + 18, by + (wide ? 42 : 34), 'Tap a slot on the book', { size: 12, weight: 600, color: H.muted });
      root.add([g, t, sub]);
      const back = new Button(this, bx + bw - 236, by + (wide ? 16 : 14), 108, 44, 'BACK', { ...STYLE.dark, size: 11 });
      back.onClick = () => { this.ui.selected = null; this.renderGrid(); this.renderShop(); };
      const skip = new Button(this, bx + bw - 120, by + (wide ? 16 : 14), 104, 44, 'SKIP', { ...STYLE.dark, size: 11 });
      skip.onClick = () => { if (!this.gate('skip')) return; this.ui.selected = null; this.act({ type: 'draft', pick: null }); this.emit('drafted'); };
      root.add([back, skip]);
      this.hits.shop = { x: bx, y: by, w: bw, h: bh };
      root.y = u(wide ? 40 : -40); root.setAlpha(0);
      this.tweens.add({ targets: root, y: 0, alpha: 1, duration: 220, ease: 'Cubic.easeOut' });
      return;
    }
    const pw = Math.min(wide ? 860 : W, W - (wide ? 40 : 0));
    const pad = wide ? 20 : 12;
    const cardH = wide ? 250 : Math.min(214, Hh * 0.27);
    const ph = pad + 22 + 14 + cardH + 14 + 46 + pad + 8;
    const px = (W - pw) / 2, py = Hh - ph + 8;
    const g = this.add.graphics();
    roundRect(g, px, py, pw, ph + 20, 20, C.panel, 0.97);
    strokeRect(g, px, py, pw, ph + 20, 20, C.line2, 1);
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
    const rr = new Button(this, px + pad, by, bw, 46, `REROLL · ${money(rerollPrice(s))}`, { ...STYLE.dark, size: 12 });
    rr.setEnabled(s.cash >= rerollPrice(s));
    rr.onClick = () => { if (!this.gate('reroll')) return; J.tick(); this.act({ type: 'reroll' }); };
    const sk = new Button(this, px + pad + bw + 10, by, bw, 46, 'SKIP', { ...STYLE.gold, size: 12 });
    sk.onClick = () => { if (!this.gate('skip')) return; this.act({ type: 'draft', pick: null }); this.emit('drafted'); };
    root.add([rr, sk]);
    this.hits.reroll = { x: px + pad, y: by, w: bw, h: 46 };
    this.hits.skip = { x: px + pad + bw + 10, y: by, w: bw, h: 46 };
    this.hits.shop = { x: px, y: py, w: pw, h: ph };
    if (!wasOpen) { root.y = u(ph); this.tweens.add({ targets: root, y: 0, duration: 340, ease: 'Back.easeOut', easeParams: [0.9] }); }
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
    const { W, H: Hh, wide } = this.L;
    const root = this.add.container(0, 0).setDepth(DEPTH.overlay);
    const dim = this.add.rectangle(0, 0, u(W), u(Hh), C.ink, 0.74).setOrigin(0).setInteractive();
    root.add(dim);
    const pw = Math.min(width, W - (wide || opts.center ? 28 : 0));
    const content = this.add.container(0, 0);
    const h = build(content, pw);
    const center = wide || opts.center;
    const px = (W - pw) / 2, py = center ? Math.max(14, (Hh - h) / 2) : Hh - h;
    const g = this.add.graphics();
    if (opts.paper) { roundRect(g, 0, 8, pw, h, 18, 0x000000, 0.5); roundRect(g, 0, 0, pw, h, 18, C.paper); }
    else { roundRect(g, 0, 0, pw, h + (center ? 0 : 20), 20, C.panel); strokeRect(g, 0, 0, pw, h + (center ? 0 : 20), 20, C.line2, 1); }
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
      y += 26;
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
    const c = this.add.container(u(this.L.W / 2), u(this.L.wide ? 30 : 20 + h / 2), [g, t]).setDepth(DEPTH.toast);
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
    const { W, H: Hh, wide } = this.L;
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
      block(0, 0, W, hy); block(0, hy + hh, W, Hh - hy - hh); block(0, hy, hx, hh); block(hx + hw, hy, W - hx - hw, hh);
      const ring = this.add.graphics();
      strokeRect(ring, hx, hy, hw, hh, 12, C.gold, 2);
      layer.add(ring);
      this.tweens.add({ targets: ring, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
      if (!o.wait) block(hx, hy, hw, hh); // explanation steps: nothing behind is clickable
    } else block(0, 0, W, Hh);
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
      rect: (name: string) => self.hits[name] ?? self.hits[`ov:${name}`] ?? null,
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
