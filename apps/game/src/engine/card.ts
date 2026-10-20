import { cardDef, displayName } from '@firm/sim';
import type { CardInstance } from '@firm/sim';
import { stippleCanvas } from '../stipple.ts';
import { C, H } from './theme.ts';
import { Spring, roundRect, strokeRect, text } from './ui.ts';

const SHORT: Record<string, string> = { 'Chargeback Artist': 'Chargeback', 'Copy-Trade Detector': 'Detector', 'Payout Proof Wall': 'Proof Wall', 'Compliance Officer': 'Compliance', 'Support Agent': 'Support', 'Bulk Customer': 'Bulk Buyer' };
export const shortName = (n: string): string => SHORT[n] ?? n;

export const SAMPLE_FEE: Record<string, number> = { gambler: 30, grinder: 12, retail: 26, scalper: 8, trendbro: 38, copyring: 18, hedger: 25, ghost: 28, chargeback: 40, whale: 110, influencer: 0, bot: 12, vet: 0, botfarm: 0 };

export function artId(card: CardInstance): string {
  const def = cardDef(card.def);
  if (!card.revealed && def.disguise) return card.def === 'bot' ? 'bot' : 'retail';
  return card.def;
}

/** Card art as a Phaser texture, generated once per id. */
export function artTexture(scene: Phaser.Scene, id: string): string {
  const key = `art:${id}`;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, stippleCanvas(id, '#080809', 4));
  return key;
}

/** A small rounded label ("pill") added to a container; returns its width. */
export function pill(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, str: string, fill: number, ink: string, size: number, anchor: 'left' | 'right' | 'center' = 'left', h?: number): number {
  const t = text(scene, 0, 0, str, { size, weight: 800, color: ink, spacing: size < 10 ? 1 : 0 }).setOrigin(0.5);
  const w = t.width + size * 1.1, hh = h ?? size * 1.9;
  const x0 = anchor === 'left' ? x : anchor === 'right' ? x - w : x - w / 2;
  const g = scene.add.graphics();
  roundRect(g, x0, y, w, hh, hh / 2, fill);
  t.setPosition(x0 + w / 2, y + hh / 2 + 0.5);
  parent.add([g, t]);
  return w;
}

export class CardView extends Phaser.GameObjects.Container {
  private shadow: Phaser.GameObjects.Graphics;
  private face: Phaser.GameObjects.Graphics;
  private deco: Phaser.GameObjects.Container;
  private glow: Phaser.GameObjects.Graphics;
  readonly sc = new Spring(1, 1, 300, 16);
  readonly rot = new Spring(0, 0, 220, 14);
  readonly lift = new Spring(0, 0, 300, 20);
  private phase = Math.random() * 6.28;
  private t = 0;
  hovered = false;
  card: CardInstance | null = null;
  homeX = 0;
  homeY = 0;
  due = false;
  dim = false;
  sway = true;

  constructor(scene: Phaser.Scene, public cw: number, public ch: number) {
    super(scene, 0, 0);
    this.glow = scene.add.graphics();
    this.shadow = scene.add.graphics();
    this.face = scene.add.graphics();
    this.deco = scene.add.container(0, 0);
    this.add([this.glow, this.shadow, this.face, this.deco]);
    this.setSize(cw, ch);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => { this.hovered = true; if (this.card) { this.sc.target = 1.07; this.lift.target = -8; } });
    this.on('pointerout', () => { this.hovered = false; this.sc.target = 1; this.lift.target = 0; this.rot.target = 0; });
    this.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.hovered || !this.card) return;
      this.rot.target = ((p.worldX - this.x) / this.cw) * 0.14;
    });
    scene.events.on('update', this.tick, this);
    this.once('destroy', () => scene.events.off('update', this.tick, this));
    scene.add.existing(this);
  }

  place(x: number, y: number): this { this.homeX = x; this.homeY = y; this.x = x; this.y = y; return this; }

  setCard(card: CardInstance | null): this {
    this.card = card;
    const { cw, ch } = this;
    const big = cw > 100;
    const r = Math.max(8, cw * 0.1);
    this.face.clear(); this.shadow.clear(); this.glow.clear();
    this.deco.removeAll(true);
    if (!card) {
      roundRect(this.face, -cw / 2, -ch / 2, cw, ch, r, C.paper, 0.025);
      strokeRect(this.face, -cw / 2, -ch / 2, cw, ch, r, C.paper, 1, 0.07);
      this.deco.add(text(this.scene, 0, 0, '+', { size: big ? 22 : 16, weight: 600, color: H.muted }).setOrigin(0.5).setAlpha(0.22));
      this.due = false;
      return this;
    }
    const def = cardDef(card.def);
    const hidden = !card.revealed && !!def.disguise;
    const staff = def.kind === 'staff';
    const rare = def.rarity === 'rare' && !hidden;
    const exposed = card.revealed && !!def.fraud;
    const t = def.threshold ?? 0;
    this.due = !!t && card.progress >= t;
    const paper = staff ? 0xe6e6e3 : C.paper;
    const edge = staff ? 0xbfc2c6 : C.paper3;
    // shadow, card thickness, face
    roundRect(this.shadow, -cw / 2 + 2, -ch / 2 + (big ? 9 : 6), cw, ch, r, 0x000000, 0.45);
    roundRect(this.face, -cw / 2, -ch / 2 + 3, cw, ch, r, edge);
    roundRect(this.face, -cw / 2, -ch / 2, cw, ch, r, paper);
    strokeRect(this.face, -cw / 2 + 4, -ch / 2 + 4, cw - 8, ch - 8, r - 3, C.ink, 1, 0.1);
    if (rare) strokeRect(this.face, -cw / 2 + 1.5, -ch / 2 + 1.5, cw - 3, ch - 3, r - 1, C.gold, 3);
    else if (staff) strokeRect(this.face, -cw / 2 + 1, -ch / 2 + 1, cw - 2, ch - 2, r - 1, C.plat, 2);
    if (exposed) strokeRect(this.face, -cw / 2 + 1.5, -ch / 2 + 1.5, cw - 3, ch - 3, r - 1, C.clay, 3);
    if (this.due) {
      this.glow.fillStyle(C.gold, 0.32);
      this.glow.fillRoundedRect(-cw / 2 - 7, -ch / 2 - 7, cw + 14, ch + 14, r + 6);
      strokeRect(this.face, -cw / 2 - 1, -ch / 2 - 1, cw + 2, ch + 2, r + 1, C.gold, 3);
    }
    // art, big and central
    const size = Math.min(cw * 0.78, ch * 0.5);
    const art = this.scene.add.image(0, -ch * 0.05, artTexture(this.scene, artId(card))).setDisplaySize(size, size);
    if (exposed) art.setTint(0xb8452a);
    this.deco.add(art);
    // top-left chip: daily fee, or the card's role
    const pad = big ? 8 : 5, ps = big ? 12 : 9;
    const base = (hidden ? SAMPLE_FEE.retail : SAMPLE_FEE[card.def]) ?? 0;
    if (exposed) pill(this.scene, this.deco, -cw / 2 + pad, -ch / 2 + pad, 'FRAUD', C.clay, H.clayInk, ps * 0.85);
    else if (staff) pill(this.scene, this.deco, -cw / 2 + pad, -ch / 2 + pad, 'STAFF', C.plat, H.ink, ps * 0.85);
    else if (base > 0 || card.bonus) pill(this.scene, this.deco, -cw / 2 + pad, -ch / 2 + pad, `$${base + card.bonus}`, C.chip, H.chipInk, ps);
    if (card.bonus) pill(this.scene, this.deco, cw / 2 - pad, -ch / 2 + pad, `+${card.bonus}`, C.gold, H.ink, ps * 0.85, 'right');
    // name
    const name = text(this.scene, 0, ch / 2 - (t ? (big ? 26 : 18) : (big ? 18 : 13)), shortName(displayName(card)), { size: big ? 13.5 : 9.5, weight: 800, color: H.ink, align: 'center' }).setOrigin(0.5);
    const max = cw - 10;
    let s = name.text;
    while (name.width > max && s.length > 3) { s = s.slice(0, -1); name.setText(`${s.trimEnd()}…`); }
    this.deco.add(name);
    // payout meter
    if (t) {
      const mx = -cw / 2 + (big ? 10 : 6), mw = cw - (big ? 20 : 12), my = ch / 2 - (big ? 12 : 8), mh = big ? 5 : 4;
      const g = this.scene.add.graphics();
      roundRect(g, mx, my, mw, mh, mh / 2, C.ink, 0.12);
      const f = Math.min(1, card.progress / t);
      if (f > 0) roundRect(g, mx, my, Math.max(mh, mw * f), mh, mh / 2, this.due ? C.goldDeep : f >= 0.7 ? C.clay : C.ink, 1);
      this.deco.add(g);
    }
    if (this.due) pill(this.scene, this.deco, 0, -ch / 2 - (big ? 11 : 8), 'PAYOUT', C.gold, H.ink, big ? 10 : 8, 'center');
    return this;
  }

  /** The Balatro jolt: jump, twist, settle. */
  pop(strength = 1): void {
    this.sc.x = 1 + 0.18 * strength;
    this.sc.kick(-1.5);
    this.rot.kick((Math.random() < 0.5 ? -1 : 1) * 3.4 * strength);
    this.lift.kick(-170 * strength);
  }

  drop(): void { this.sc.x = 1.35; this.lift.x = -40; this.rot.x = (Math.random() - 0.5) * 0.4; }

  private tick(_time: number, dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);
    this.t += dt;
    const live = !!this.card && this.sway;
    const sway = live ? Math.sin(this.t * 1.25 + this.phase) * 0.012 : 0;
    const bob = live ? Math.sin(this.t * 1.6 + this.phase) * 1.6 : 0;
    this.setScale(this.sc.step(dt));
    this.rotation = this.rot.step(dt) + sway;
    this.y = this.homeY + this.lift.step(dt) + bob;
    this.x = this.homeX;
    if (this.due) this.glow.setAlpha(0.55 + 0.45 * Math.sin(this.t * 4));
    this.setAlpha(this.dim ? 0.45 : 1);
    this.shadow.setPosition(-this.lift.x * 0.12, -this.lift.x * 0.25);
  }
}

export interface PaperOpts {
  art: string;
  title: string;
  tag?: string;
  tagColor?: string;
  body?: string;
  foot?: string;
  footColor?: string;
  /** Border accent (rare gold, staff platinum, crisis clay). */
  accent?: number;
  locked?: boolean;
  dark?: boolean;
}

/**
 * A big paper card (founders, plans, crises, shop offers): art on top, title, body, footer line.
 * Sways, lifts on hover, squashes on tap. Built centred on (0,0).
 */
export class PaperCard extends Phaser.GameObjects.Container {
  readonly sc = new Spring(1, 1, 300, 16);
  readonly lift = new Spring(0, 0, 300, 20);
  readonly rot = new Spring(0, 0, 220, 14);
  private t = Math.random() * 6;
  baseX = 0;
  baseY = 0;
  onTap: () => void = () => {};
  sway = true;

  constructor(scene: Phaser.Scene, x: number, y: number, public cw: number, public ch: number, o: PaperOpts) {
    super(scene, x, y);
    this.baseX = x; this.baseY = y;
    const w = cw, h = ch, r = Math.max(10, w * 0.07);
    const g = scene.add.graphics();
    roundRect(g, -w / 2 + 2, -h / 2 + 9, w, h, r, 0x000000, 0.5);
    if (o.dark) {
      roundRect(g, -w / 2, -h / 2, w, h, r, C.panel2);
      strokeRect(g, -w / 2, -h / 2, w, h, r, C.line2, 1.5);
    } else {
      roundRect(g, -w / 2, -h / 2 + 4, w, h, r, C.paper3);
      roundRect(g, -w / 2, -h / 2, w, h, r, C.paper);
      strokeRect(g, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, r - 3, C.ink, 1, 0.1);
    }
    if (o.accent !== undefined) strokeRect(g, -w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, r - 1, o.accent, 3);
    this.add(g);
    const ink = o.dark ? H.paper : H.ink, soft = o.dark ? H.muted : H.inkSoft;
    const pad = Math.max(12, w * 0.07);
    let ty = -h / 2 + pad;
    if (o.tag) { this.add(text(scene, -w / 2 + pad, ty, o.tag, { size: Math.max(9, w * 0.042), weight: 800, color: o.tagColor ?? soft, spacing: 1.8 })); ty += Math.max(16, w * 0.07); }
    const artS = Math.min(w * 0.6, h * 0.36);
    const art = scene.add.image(0, ty + artS / 2, artTexture(scene, o.art)).setDisplaySize(artS, artS);
    if (o.dark) art.setTint(0xeeeae2);
    this.add(art);
    ty += artS + Math.max(8, h * 0.03);
    const tt = text(scene, -w / 2 + pad, ty, o.title, { size: Math.max(13, w * 0.075), weight: 800, color: ink, wrap: w - 2 * pad });
    this.add(tt);
    ty += tt.height + 4;
    if (o.body) {
      const footH = o.foot ? Math.max(18, w * 0.08) + 8 : 0;
      const b = text(scene, -w / 2 + pad, ty, o.body, { size: Math.max(10.5, w * 0.052), weight: 600, color: soft, wrap: w - 2 * pad, lineSpacing: 2 });
      if (ty + b.height > h / 2 - pad - footH) b.setFontSize(Math.max(9.5, w * 0.046));
      this.add(b);
    }
    if (o.foot) this.add(text(scene, -w / 2 + pad, h / 2 - pad, o.foot, { size: Math.max(11, w * 0.052), weight: 800, color: o.footColor ?? ink, wrap: w - 2 * pad }).setOrigin(0, 1));
    if (o.locked) {
      const veil = scene.add.graphics();
      roundRect(veil, -w / 2, -h / 2, w, h, r, C.ink, 0.5);
      this.add(veil);
    }
    this.setSize(w, h);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => { this.sc.target = 1.05; this.lift.target = -10; });
    this.on('pointerout', () => { this.sc.target = 1; this.lift.target = 0; this.rot.target = 0; });
    this.on('pointermove', (p: Phaser.Input.Pointer) => { this.rot.target = ((p.worldX - this.x) / this.cw) * 0.12; });
    this.on('pointerup', () => { this.sc.x = 0.94; this.sc.kick(3); this.onTap(); });
    scene.events.on('update', this.tick, this);
    this.once('destroy', () => scene.events.off('update', this.tick, this));
    scene.add.existing(this);
  }

  deal(delay = 0): this {
    this.setScale(0.5).setAlpha(0);
    this.sc.x = 0.5;
    this.scene.time.delayedCall(delay, () => { this.setAlpha(1); this.sc.kick(5); this.rot.kick(4 * (Math.random() < 0.5 ? -1 : 1)); });
    return this;
  }

  private tick(_time: number, dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);
    this.t += dt;
    this.setScale(this.sc.step(dt));
    this.rotation = this.rot.step(dt) + (this.sway ? Math.sin(this.t * 1.1) * 0.012 : 0);
    this.y = this.baseY + this.lift.step(dt) + (this.sway ? Math.sin(this.t * 1.4) * 2 : 0);
    this.x = this.baseX;
  }
}
