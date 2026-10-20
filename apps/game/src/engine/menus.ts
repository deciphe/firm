import { CARDS, EXCUSES, FOUNDERS, FOUNDER_ORDER, STAKES, cardDef } from '@firm/sim';
import type { CardInstance } from '@firm/sim';
import * as J from '../juice.ts';
import { CardView, PaperCard, artTexture, shortName } from './card.ts';
import { STAKE_GOAL_DAY, founderUnlocked, loadMeta, saveMeta } from './meta.ts';
import type { Meta } from './meta.ts';
import { Backdrop, backdrop, crt, cssRect, fadeIn, fitStage, goTo, onResize } from './stage.ts';
import type { Rect, Stage } from './stage.ts';
import type { CrtPipeline } from './shaders.ts';
import { C, DEPTH, H } from './theme.ts';
import { Button, STYLE, roundRect, strokeRect, text } from './ui.ts';

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const fakeCard = (def: string, extra: Partial<CardInstance> = {}): CardInstance => ({ uid: -1, def, progress: 0, age: 0, revealed: true, payouts: 0, stalls: 0, stalledUntil: 0, bonus: 0, ...extra });

/** Shared plumbing for the menu screens: fitted stage, swirl, CRT, hit rects for tests, resize. */
abstract class Screen extends Phaser.Scene {
  protected st!: Stage;
  protected back!: Backdrop;
  protected crtFx: CrtPipeline | null = null;
  protected hits: Record<string, Rect> = {};

  create(data: object): void {
    this.crtFx = crt(this);
    onResize(this, () => this.rebuild());
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.key(e));
    this.init2(data);
    this.rebuild();
    fadeIn(this);
  }

  protected init2(_data: object): void {}
  protected key(_e: KeyboardEvent): void {}
  protected abstract draw(): void;

  protected rebuild(): void {
    this.tweens.killAll();
    this.children.removeAll(true);
    this.hits = {};
    this.st = fitStage(this);
    this.back = new Backdrop(backdrop(this, this.st));
    this.draw();
  }

  update(_t: number, dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);
    this.back?.tick(dt);
    if (this.crtFx) { this.crtFx.dpr = Math.max(1, this.st?.k ?? 1); this.crtFx.shake *= Math.pow(0.02, dt); }
  }

  protected button(name: string, x: number, y: number, w: number, h: number, label: string, style: typeof STYLE.clay, onClick: () => void, size = 14, sub?: string): Button {
    const b = new Button(this, x, y, w, h, label, { ...style, size, spacing: 2.4, ...(sub ? { sub } : {}) }).setDepth(DEPTH.hud + 2);
    b.onClick = () => { J.unlockAudio(); J.tick(); onClick(); };
    this.hits[name] = { x, y, w, h };
    return b;
  }

  protected soundToggle(x: number, y: number): void {
    const b = new Button(this, x, y, 84, 40, J.isMuted() ? 'MUTED' : 'SOUND', { ...STYLE.dark, size: 10.5, spacing: 1 }).setDepth(DEPTH.hud + 2);
    b.onClick = () => {
      J.unlockAudio(); J.setMuted(!J.isMuted());
      try { localStorage.setItem('firm:muted', JSON.stringify(J.isMuted())); } catch { /* ignore */ }
      b.setLabel(J.isMuted() ? 'MUTED' : 'SOUND');
    };
  }

  debug(): Record<string, unknown> {
    return {
      view: () => ({ screen: this.scene.key, phase: null, busy: false, shop: false, placing: false, overlay: '', guide: false, wait: null, hint: null }),
      rect: (name: string) => { const r = this.hits[name]; return r ? cssRect(this.st, r) : null; },
    };
  }
}

// ================================================================== title

export class TitleScene extends Screen {
  constructor() { super('title'); }

  protected key(e: KeyboardEvent): void { if (e.code === 'Space' || e.code === 'Enter') goTo(this, 'setup'); }

  protected draw(): void {
    const { W, H: Hh, wide } = this.st;
    const m = loadMeta();
    // fanned cards behind the wordmark
    const fan: [string, number, number, number][] = wide
      ? [['whale', 330, 290, -0.18], ['gambler', 1270, 290, 0.18], ['influencer', 200, 500, -0.3], ['trendbro', 1400, 500, 0.3]]
      : [['gambler', W / 2 - 112, Hh * 0.44, -0.2], ['whale', W / 2, Hh * 0.42, 0], ['influencer', W / 2 + 112, Hh * 0.44, 0.2]];
    const cw = wide ? 150 : 100, ch = cw * 1.32;
    fan.forEach(([id, x, y, r], i) => {
      const cv = new CardView(this, cw, ch).setCard(fakeCard(id, id === 'whale' ? { progress: 10 } : {})).setDepth(DEPTH.cards);
      cv.place(x, y);
      cv.rot.x = r * 3; cv.rot.target = r;
      cv.sc.x = 0.3;
      this.time.delayedCall(120 + i * 110, () => { cv.drop(); J.tick(); });
      cv.on('pointerup', () => { cv.pop(1); J.coin(i); this.back.hit(C.gold, 0.3); });
    });
    // wordmark
    const ty = wide ? 300 : Hh * 0.2;
    const mark = text(this, W / 2, ty, 'FIRM', { size: wide ? 200 : 108, weight: 800, spacing: wide ? 46 : 22 }).setOrigin(0.5).setDepth(DEPTH.hud);
    mark.setX(W / 2 + (wide ? 23 : 11));
    const shadow = text(this, mark.x + 6, ty + 8, 'FIRM', { size: wide ? 200 : 108, weight: 800, spacing: wide ? 46 : 22, color: H.clayDeep }).setOrigin(0.5).setDepth(DEPTH.hud - 1);
    this.tweens.add({ targets: [mark, shadow], y: '-=6', duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    text(this, W / 2, ty + (wide ? 128 : 74), 'RUN A PROP FIRM. MAKE PAYROLL. DON\'T GET CAUGHT.', { size: wide ? 16 : 11, weight: 800, color: H.muted, spacing: wide ? 4 : 1.6, align: 'center', wrap: W - 40 }).setOrigin(0.5).setDepth(DEPTH.hud);
    // buttons
    if (wide) {
      const y = 680, bh = 96;
      const xs = [316, 632, 868, 1084];
      this.button('play', xs[0] as number, y, 300, bh, 'PLAY', STYLE.clay, () => goTo(this, 'setup'), 30);
      this.button('daily', xs[1] as number, y, 220, bh, 'DAILY TAPE', STYLE.gold, () => goTo(this, 'firm', { mode: 'daily' }), 15, 'same seed for everyone');
      this.button('rolodex', xs[2] as number, y, 200, bh, 'ROLODEX', STYLE.dark, () => goTo(this, 'rolodex'), 15);
      this.button('how', xs[3] as number, y, 200, bh, 'TUTORIAL', STYLE.dark, () => goTo(this, 'firm', { mode: 'tutorial' }), 15);
      this.soundToggle(W - 24 - 84, 24);
    } else {
      const x = 14, w = W - 28;
      let y = Hh - 14 - 52;
      this.button('how', x, y, w, 52, 'TUTORIAL', STYLE.dark, () => goTo(this, 'firm', { mode: 'tutorial' }), 12);
      y -= 64;
      this.button('daily', x, y, (w - 10) / 2, 56, 'DAILY TAPE', STYLE.gold, () => goTo(this, 'firm', { mode: 'daily' }), 12);
      this.button('rolodex', x + (w + 10) / 2, y, (w - 10) / 2, 56, 'ROLODEX', STYLE.dark, () => goTo(this, 'rolodex'), 12);
      y -= 92;
      this.button('play', x, y, w, 80, 'PLAY', STYLE.clay, () => goTo(this, 'setup'), 26);
      this.soundToggle(W - 14 - 84, 14);
    }
    const best = m.runs ? `BEST ${money(m.bestVal)}  ·  ${m.bestDays} DAYS  ·  ${m.runs} RUN${m.runs === 1 ? '' : 'S'}` : 'NO RUNS YET';
    text(this, W / 2, wide ? 830 : Hh - 14 - 52 - 64 - 92 - 30, best, { size: wide ? 13 : 11, weight: 800, color: H.goldDeep, spacing: 2 }).setOrigin(0.5).setDepth(DEPTH.hud);
  }
}

// ================================================================== open a firm (founder + stake)

export class SetupScene extends Screen {
  private meta!: Meta;
  private fi = 0;
  private stake = 1;
  constructor() { super('setup'); }

  protected init2(): void {
    this.meta = loadMeta();
    this.fi = Math.max(0, FOUNDER_ORDER.indexOf(this.meta.founder));
    this.stake = Math.min(this.meta.stake, this.meta.maxStake);
  }

  protected key(e: KeyboardEvent): void {
    if (e.code === 'ArrowLeft') this.turn(-1);
    else if (e.code === 'ArrowRight') this.turn(1);
    else if (e.code === 'Space' || e.code === 'Enter') this.start();
    else if (e.code === 'Escape') goTo(this, 'title');
  }

  private turn(d: number): void {
    this.fi = (this.fi + d + FOUNDER_ORDER.length) % FOUNDER_ORDER.length;
    J.tick();
    this.rebuild();
  }

  private start(): void {
    const id = FOUNDER_ORDER[this.fi] ?? 'founder';
    if (!founderUnlocked(this.meta, id)) { J.loss(); this.cameras.main.shake(140, 0.004); return; }
    this.meta.founder = id; this.meta.stake = this.stake;
    saveMeta(this.meta);
    J.cashOut();
    goTo(this, 'firm', { mode: 'random', founder: id, stake: this.stake });
  }

  protected draw(): void {
    const { W, H: Hh, wide } = this.st;
    const id = FOUNDER_ORDER[this.fi] ?? 'founder';
    const f = FOUNDERS[id];
    if (!f) return;
    const open = founderUnlocked(this.meta, id);
    const cx = W / 2;
    // header
    text(this, cx, wide ? 52 : 26, 'OPEN A FIRM', { size: wide ? 13 : 11, weight: 800, color: H.muted, spacing: 4 }).setOrigin(0.5, 0);
    text(this, cx, wide ? 76 : 44, 'Who founded it?', { size: wide ? 34 : 24, weight: 800 }).setOrigin(0.5, 0);
    this.button('back', wide ? 24 : 14, wide ? 24 : 14, wide ? 110 : 64, wide ? 48 : 40, wide ? 'BACK' : '‹', STYLE.dark, () => goTo(this, 'title'), wide ? 12 : 18);
    // founder card
    const cw = wide ? 250 : Math.min(230, W * 0.54), ch = cw * 1.3;
    const cy = wide ? 316 : 116 + ch / 2;
    const rec = this.meta.records[`${id}:${this.stake}`];
    const card = new PaperCard(this, cx, cy, cw, ch, {
      art: `f_${id}`, title: f.name, tag: open ? 'FOUNDER' : 'LOCKED', tagColor: open ? H.goldDeep : H.clayDeep,
      foot: open ? (rec ? `BEST ${money(rec)}` : 'NO RUNS YET') : f.unlock, footColor: open ? H.goldDeep : H.clayDeep,
      accent: open ? C.gold : undefined, locked: !open,
    }).setDepth(DEPTH.cards).deal(0);
    card.onTap = () => this.start();
    this.hits.founder = { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
    const aw = wide ? 64 : 48;
    this.button('prev', cx - cw / 2 - (wide ? 110 : 64), cy - aw / 2, aw, aw, '‹', STYLE.dark, () => this.turn(-1), 24);
    this.button('next', cx + cw / 2 + (wide ? 110 : 64) - aw, cy - aw / 2, aw, aw, '›', STYLE.dark, () => this.turn(1), 24);
    // ghost cards either side so it reads as a deck to flip through
    for (const side of [-1, 1]) {
      const nid = FOUNDER_ORDER[(this.fi + side + FOUNDER_ORDER.length) % FOUNDER_ORDER.length] ?? 'founder';
      const g = this.add.graphics().setDepth(DEPTH.cards - 1);
      const gx = cx + side * (cw * 0.62), gw = cw * 0.8, gh = ch * 0.8;
      roundRect(g, gx - gw / 2, cy - gh / 2, gw, gh, 14, C.paper, founderUnlocked(this.meta, nid) ? 0.12 : 0.05);
      g.setRotation(side * 0.08);
      if (!wide) g.setVisible(false);
    }
    let y = cy + ch / 2 + (wide ? 26 : 18);
    const blurb = text(this, cx, y, open ? f.blurb : `${f.blurb}\nUnlock: ${f.unlock}.`, { size: wide ? 16 : 13, weight: 600, color: open ? H.paper : H.muted, align: 'center', wrap: wide ? 620 : W - 40, lineSpacing: 3 }).setOrigin(0.5, 0);
    y += blurb.height + (wide ? 16 : 12);
    // dots
    const g = this.add.graphics();
    FOUNDER_ORDER.forEach((fid, k) => {
      const dx = cx + (k - (FOUNDER_ORDER.length - 1) / 2) * 18;
      g.fillStyle(k === this.fi ? C.gold : C.paper, k === this.fi ? 1 : founderUnlocked(this.meta, fid) ? 0.35 : 0.12);
      g.fillCircle(dx, y + 4, k === this.fi ? 5 : 4);
    });
    y += wide ? 30 : 24;
    // stakes
    text(this, cx, y, 'STAKE', { size: wide ? 11 : 10, weight: 800, color: H.muted, spacing: 3 }).setOrigin(0.5, 0);
    y += wide ? 22 : 18;
    const sw = wide ? 170 : (W - 28 - 4 * 6) / 5, sh = wide ? 56 : 46, gap = wide ? 12 : 6;
    const sx0 = cx - (5 * sw + 4 * gap) / 2;
    STAKES.forEach((stk, k) => {
      const lvl = k + 1, x = sx0 + k * (sw + gap);
      const locked = lvl > this.meta.maxStake, sel = lvl === this.stake;
      const c = this.add.container(x, y).setDepth(DEPTH.hud);
      const bg = this.add.graphics();
      roundRect(bg, 0, 3, sw, sh, 12, sel ? C.clayDeep : 0x050506);
      roundRect(bg, 0, 0, sw, sh, 12, sel ? C.clay : C.panel2);
      if (!sel) strokeRect(bg, 0, 0, sw, sh, 12, C.line2, 1);
      c.add(bg);
      c.add(text(this, sw / 2, sh / 2 - (wide ? 8 : 7), locked ? 'LOCKED' : stk.name.toUpperCase(), { size: wide ? 13 : 9.5, weight: 800, color: sel ? H.clayInk : locked ? H.muted : H.paper, spacing: 1 }).setOrigin(0.5));
      c.add(text(this, sw / 2, sh / 2 + (wide ? 11 : 9), `${lvl}`, { size: wide ? 11 : 9.5, weight: 800, color: sel ? H.clayInk : H.muted }).setOrigin(0.5).setAlpha(0.8));
      c.setSize(sw, sh).setInteractive(new Phaser.Geom.Rectangle(0, 0, sw, sh), Phaser.Geom.Rectangle.Contains);
      c.on('pointerup', () => {
        if (locked) { J.loss(); return; }
        this.stake = lvl; J.tick(); this.rebuild();
      });
      this.hits[`stake${lvl}`] = { x, y, w: sw, h: sh };
    });
    y += sh + (wide ? 16 : 12);
    const rules = STAKES.slice(1, this.stake).map((s) => s.blurb);
    const nextLocked = this.meta.maxStake < STAKES.length ? `Reach day ${STAKE_GOAL_DAY} on ${STAKES[this.meta.maxStake - 1]?.name} to unlock ${STAKES[this.meta.maxStake]?.name}.` : '';
    text(this, cx, y, rules.length ? rules.join('  ·  ') : `${STAKES[0]?.blurb} ${nextLocked}`, { size: wide ? 13 : 11, weight: 700, color: rules.length ? H.blush : H.muted, align: 'center', wrap: wide ? 900 : W - 40 }).setOrigin(0.5, 0);
    // start
    const bw = wide ? 380 : W - 28, bh = wide ? 84 : 72;
    const by = Hh - (wide ? 40 : 14) - bh;
    this.button('start', cx - bw / 2, by, bw, bh, open ? 'OPEN THE DOORS' : 'LOCKED', open ? STYLE.clay : STYLE.dark, () => this.start(), wide ? 22 : 18, open ? `${f.name} · ${STAKES[this.stake - 1]?.name}` : f.unlock);
  }
}

// ================================================================== the rolodex (collection)

interface Entry { id: string; art: string; name: string; blurb: string; tag: string; seen: boolean }

export class RolodexScene extends Screen {
  private sel = -1;
  constructor() { super('rolodex'); }

  protected key(e: KeyboardEvent): void { if (e.code === 'Escape' || e.code === 'Backspace') goTo(this, 'title'); }

  private entries(): Entry[] {
    const seen = new Set(loadMeta().seen);
    const out: Entry[] = [];
    for (const def of Object.values(CARDS)) {
      const tag = def.kind === 'staff' ? 'STAFF' : def.fraud ? 'FRAUD' : 'CUSTOMER';
      out.push({ id: def.id, art: def.id, name: shortName(def.name), blurb: def.blurb, tag: `${def.rarity.toUpperCase()} ${tag}`, seen: seen.has(def.id) });
    }
    for (const ex of Object.values(EXCUSES)) out.push({ id: `x:${ex.id}`, art: 'excuse', name: ex.name, blurb: ex.blurb, tag: 'EXCUSE', seen: seen.has(`x:${ex.id}`) });
    return out;
  }

  protected draw(): void {
    const { W, H: Hh, wide } = this.st;
    const list = this.entries();
    const seenN = list.filter((e) => e.seen).length;
    this.button('back', wide ? 24 : 14, wide ? 24 : 14, wide ? 110 : 64, wide ? 48 : 40, wide ? 'BACK' : '‹', STYLE.dark, () => goTo(this, 'title'), wide ? 12 : 18);
    text(this, W / 2, wide ? 40 : 22, 'THE ROLODEX', { size: wide ? 28 : 20, weight: 800, spacing: 4 }).setOrigin(0.5, 0);
    text(this, W / 2, wide ? 78 : 50, `${seenN} OF ${list.length} SEEN`, { size: wide ? 12 : 10, weight: 800, color: H.goldDeep, spacing: 2 }).setOrigin(0.5, 0);
    const cols = wide ? 10 : 5;
    const gap = wide ? 14 : 6;
    const infoH = wide ? 110 : 96;
    const top = wide ? 120 : 78, bottom = Hh - (wide ? 30 : 14) - infoH - 12;
    const rows = Math.ceil(list.length / cols);
    const maxW = ((wide ? 1400 : W - 28) - (cols - 1) * gap) / cols;
    const cw = Math.min(maxW, ((bottom - top - (rows - 1) * gap) / rows) / 1.32), ch = cw * 1.32;
    const gx = W / 2 - (cols * cw + (cols - 1) * gap) / 2;
    list.forEach((e, i) => {
      const x = gx + (i % cols) * (cw + gap) + cw / 2, y = top + Math.floor(i / cols) * (ch + gap) + ch / 2;
      const c = this.add.container(x, y).setDepth(DEPTH.cards);
      const g = this.add.graphics();
      const r = Math.max(6, cw * 0.09);
      if (e.seen) {
        roundRect(g, -cw / 2 + 1, -ch / 2 + 4, cw, ch, r, 0x000000, 0.45);
        roundRect(g, -cw / 2, -ch / 2, cw, ch, r, C.paper);
        if (i === this.sel) strokeRect(g, -cw / 2 - 2, -ch / 2 - 2, cw + 4, ch + 4, r + 2, C.gold, 3);
        c.add(g);
        const s = Math.min(cw * 0.72, ch * 0.5);
        c.add(this.add.image(0, -ch * 0.08, artTexture(this, e.art)).setDisplaySize(s, s));
        c.add(text(this, 0, ch / 2 - (wide ? 12 : 9), e.name, { size: wide ? 11.5 : 8.5, weight: 800, color: H.ink, align: 'center' }).setOrigin(0.5, 1));
      } else {
        roundRect(g, -cw / 2, -ch / 2, cw, ch, r, C.panel2, 0.9);
        strokeRect(g, -cw / 2, -ch / 2, cw, ch, r, i === this.sel ? C.gold : C.line2, i === this.sel ? 2 : 1);
        c.add(g);
        c.add(text(this, 0, 0, '?', { size: wide ? 34 : 22, weight: 800, color: H.muted }).setOrigin(0.5).setAlpha(0.5));
      }
      c.setSize(cw, ch).setInteractive({ useHandCursor: true });
      c.on('pointerover', () => this.tweens.add({ targets: c, scale: 1.06, duration: 120 }));
      c.on('pointerout', () => this.tweens.add({ targets: c, scale: 1, duration: 120 }));
      c.on('pointerup', () => { this.sel = i; J.tick(); this.rebuild(); });
      this.hits[`card${i}`] = { x: x - cw / 2, y: y - ch / 2, w: cw, h: ch };
    });
    // info bar
    const iw = wide ? 900 : W - 28, ix = W / 2 - iw / 2, iy = Hh - (wide ? 30 : 14) - infoH;
    const g = this.add.graphics().setDepth(DEPTH.hud);
    roundRect(g, ix, iy, iw, infoH, 16, C.panel, 0.95);
    strokeRect(g, ix, iy, iw, infoH, 16, C.line2, 1);
    const e = list[this.sel];
    if (!e) text(this, W / 2, iy + infoH / 2, 'Tap a card. Every card you meet in a run gets filed here.', { size: wide ? 14 : 12, weight: 600, color: H.muted, align: 'center', wrap: iw - 40 }).setOrigin(0.5).setDepth(DEPTH.hud + 1);
    else if (!e.seen) text(this, W / 2, iy + infoH / 2, 'Not met yet. Keep running firms.', { size: wide ? 14 : 12, weight: 600, color: H.muted, align: 'center' }).setOrigin(0.5).setDepth(DEPTH.hud + 1);
    else {
      text(this, ix + 20, iy + 16, e.tag, { size: 10, weight: 800, color: H.goldDeep, spacing: 2 }).setDepth(DEPTH.hud + 1);
      text(this, ix + 20, iy + 32, e.name, { size: wide ? 20 : 16, weight: 800 }).setDepth(DEPTH.hud + 1);
      text(this, ix + 20, iy + (wide ? 60 : 54), e.blurb, { size: wide ? 13 : 11.5, weight: 600, color: H.muted, wrap: iw - 40, lineSpacing: 2 }).setDepth(DEPTH.hud + 1);
    }
    void cardDef;
  }
}
