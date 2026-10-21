import { cardDef, displayName } from '@firm/sim';
import type { CardInstance } from '@firm/sim';
import { pixelArt } from '../pixel.ts';
import { C, H } from './theme.ts';
import { STILL, Spring, bakeShape, roundRect, strokeRect, text } from './ui.ts';

const SHORT: Record<string, string> = { 'Chargeback Artist': 'Chargeback', 'Copy-Trade Detector': 'Detector', 'Payout Proof Wall': 'Proof Wall', 'Compliance Officer': 'Compliance', 'Support Agent': 'Support', 'Bulk Customer': 'Bulk Buyer' };
export const shortName = (n: string): string => SHORT[n] ?? n;

export const SAMPLE_FEE: Record<string, number> = { gambler: 30, grinder: 12, retail: 26, scalper: 8, trendbro: 38, copyring: 18, hedger: 25, ghost: 28, chargeback: 40, whale: 110, influencer: 0, bot: 12, vet: 0, botfarm: 0 };

export function artId(card: CardInstance): string {
  const def = cardDef(card.def);
  if (!card.revealed && def.disguise) return card.def === 'bot' ? 'bot' : 'retail';
  return card.def;
}

/** What a card's face says at a glance: band colour, label, headline number. */
export interface CardLook { band: number; ink: string; label: string; stat: string; ring?: number; fraud: boolean }

/** The headline number for cards that add mult (shown in their band). */
const MULT_STAT: Record<string, string> = {
  affiliate: '+.15 ea', riskanalyst: '+.2 ea', quantdesk: '+1 chop', hypeteam: '+.05 ea', cro: '×2', proofwall: '×Mult', vet: '+0.1',
};

export function cardLook(card: CardInstance): CardLook {
  const def = cardDef(card.def);
  const hidden = !card.revealed && !!def.disguise;
  if (card.revealed && def.fraud) return { band: C.clay, ink: H.clayInk, label: 'FRAUD', stat: '', ring: C.clay, fraud: true };
  if (card.def === 'vet') return { band: C.gold, ink: H.ink, label: 'FUNDED', stat: '+0.1', fraud: false };
  if (def.kind === 'staff') {
    const m = MULT_STAT[card.def];
    const rare = def.rarity === 'rare';
    return m
      ? { band: C.clay, ink: H.clayInk, label: 'MULT', stat: m, ...(rare ? { ring: C.gold } : {}), fraud: false }
      : { band: C.plat, ink: H.ink, label: 'STAFF', stat: '', ...(rare ? { ring: C.gold } : {}), fraud: false };
  }
  const fee = ((hidden ? SAMPLE_FEE.retail : SAMPLE_FEE[card.def]) ?? 0) + card.bonus;
  const rare = def.rarity === 'rare' && !hidden;
  return { band: C.chip, ink: H.chipInk, label: fee ? 'FEES' : 'CUSTOMER', stat: fee ? `$${fee}` : '', ...(rare ? { ring: C.gold } : {}), fraud: false };
}

/** Card art as a Phaser texture, generated once per id. */
export function artTexture(scene: Phaser.Scene, id: string): string {
  const key = `art:${id}`;
  if (!scene.textures.exists(key)) {
    scene.textures.addCanvas(key, pixelArt(id, 8));
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
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
  // Shapes are baked into shared textures (see bakeShape): a card is a handful of images, not live Graphics.
  private shadow: Phaser.GameObjects.Image;
  private face: Phaser.GameObjects.Image;
  private deco: Phaser.GameObjects.Container;
  private glow: Phaser.GameObjects.Image;
  readonly sc = new Spring(1, 1, 300, 16);
  readonly rot = new Spring(0, 0, 220, 14);
  readonly lift = new Spring(0, 0, 300, 20);
  private phase = Math.random() * 6.28;
  private t = 0;
  hovered = false;
  card: CardInstance | null = null;
  homeX = 0;
  homeY = 0;
  private baseY = 0;
  due = false;
  dim = false;
  sway = true;

  constructor(scene: Phaser.Scene, public cw: number, public ch: number) {
    super(scene, 0, 0);
    this.glow = scene.make.image({ key: '__WHITE' }, false).setVisible(false);
    this.shadow = scene.make.image({ key: '__WHITE' }, false).setVisible(false);
    this.face = scene.make.image({ key: '__WHITE' }, false).setVisible(false);
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

  place(x: number, y: number): this { this.homeX = x; this.homeY = y; this.x = x; this.y = y; this.baseY = y; return this; }
  /** Glide to a new home (the book sliding up on phones while hiring). */
  glideTo(x: number, y: number): this { this.homeX = x; this.homeY = y; return this; }

  /** Show a baked shape centred on the card, covering w x h around it. */
  private show(img: Phaser.GameObjects.Image, key: string, w: number, h: number, dx = 0, dy = 0): void {
    img.setTexture(key).setDisplaySize(w, h).setPosition(dx, dy).setVisible(true);
  }

  setCard(card: CardInstance | null): this {
    this.card = card;
    const { cw, ch } = this;
    const scene = this.scene;
    const big = cw > 100;
    const r = Math.max(8, cw * 0.09);
    const size = `${Math.round(cw)}x${Math.round(ch)}`;
    this.deco.removeAll(true);
    this.glow.setVisible(false);
    this.shadow.setVisible(false);
    if (!card) {
      const key = bakeShape(scene, `slot:${size}`, cw + 2, ch + 2, (g) => {
        roundRect(g, 0, 0, cw, ch, r, C.paper, 0.03);
        strokeRect(g, 0, 0, cw, ch, r, C.paper, 1, 0.08);
      }, 1, 1);
      this.show(this.face, key, cw + 2, ch + 2);
      this.deco.add(text(scene, 0, 0, '+', { size: big ? 22 : 16, weight: 600, color: H.muted }).setOrigin(0.5).setAlpha(0.22));
      this.due = false;
      return this;
    }
    const def = cardDef(card.def);
    const look = cardLook(card);
    const t = def.threshold ?? 0;
    this.due = !!t && card.progress >= t;
    const bandH = Math.round(ch * (big ? 0.17 : 0.2));
    const pad = big ? 9 : 5;
    const shadowKey = bakeShape(scene, `cshadow:${size}`, cw, ch, (g) => roundRect(g, 0, 0, cw, ch, r, 0x000000, 0.45));
    this.show(this.shadow, shadowKey, cw, ch, 2, big ? 9 : 6);
    if (this.due) {
      const glowKey = bakeShape(scene, `cglow:${size}`, cw + 14, ch + 14, (g) => roundRect(g, 0, 0, cw + 14, ch + 14, r + 6, C.gold, 0.34));
      this.show(this.glow, glowKey, cw + 14, ch + 14);
    }
    // the face: paper, band, ring, payout pips (one texture per distinct look)
    const pipsOn = t ? Math.min(t, card.progress) : 0;
    const hot = t ? card.progress / t >= 0.7 : false;
    const faceKey = bakeShape(scene, `cface:${size}:${look.band}:${look.ring ?? '-'}:${this.due ? 1 : 0}:${t}:${pipsOn}:${hot ? 1 : 0}`, cw + 6, ch + 8, (g) => {
      roundRect(g, 0, 3, cw, ch, r, C.paper3);
      roundRect(g, 0, 0, cw, ch, r, C.paper);
      g.fillStyle(look.band, 1);
      g.fillRoundedRect(0, 0, cw, bandH, { tl: r, tr: r, bl: 0, br: 0 });
      g.fillStyle(0x000000, 0.12);
      g.fillRect(0, bandH - 2, cw, 2);
      if (look.ring !== undefined) strokeRect(g, 1.5, 1.5, cw - 3, ch - 3, r - 1, look.ring, big ? 3 : 2.5);
      if (this.due) strokeRect(g, -1, -1, cw + 2, ch + 2, r + 1, C.gold, 3);
      if (t) {
        const py = ch - (big ? 12 : 8), gap = big ? 3 : 2;
        const pw = (cw - 2 * pad - gap * (t - 1)) / t, ph = big ? 6 : 4;
        for (let k = 0; k < t; k++) {
          const on = k < pipsOn;
          g.fillStyle(on ? (this.due ? C.goldDeep : hot ? C.clay : C.ink) : C.ink, on ? 1 : 0.12);
          g.fillRoundedRect(pad + k * (pw + gap), py - ph / 2, pw, ph, Math.min(2, ph / 2));
        }
      }
    }, 3, 3);
    this.show(this.face, faceKey, cw + 6, ch + 8, 0, 1);
    const bs = big ? 12.5 : 9.5;
    this.deco.add(text(scene, -cw / 2 + pad, -ch / 2 + bandH / 2, look.label, { size: bs * 0.78, weight: 800, color: look.ink, spacing: big ? 1.2 : 0.6 }).setOrigin(0, 0.5));
    if (look.stat) this.deco.add(text(scene, cw / 2 - pad, -ch / 2 + bandH / 2, look.stat, { size: bs, weight: 800, color: look.ink }).setOrigin(1, 0.5));
    // art, big and central
    const top = -ch / 2 + bandH, bottom = ch / 2 - (t ? (big ? 40 : 28) : (big ? 30 : 22));
    const artS = Math.min(cw * 0.7, (bottom - top) * 0.92);
    const art = scene.add.image(0, (top + bottom) / 2, artTexture(scene, artId(card))).setDisplaySize(artS, artS);
    if (look.fraud) art.setTint(0x9f3a22);
    this.deco.add(art);
    // name
    const ny = ch / 2 - (t ? (big ? 30 : 21) : (big ? 17 : 12));
    const name = text(scene, 0, ny, shortName(displayName(card)), { size: big ? 13.5 : 9.5, weight: 800, color: H.ink, align: 'center' }).setOrigin(0.5);
    const max = cw - 8;
    let n = name.text;
    while (name.width > max && n.length > 3) { n = n.slice(0, -1); name.setText(`${n.trimEnd()}…`); }
    this.deco.add(name);
    if (this.due) pill(scene, this.deco, 0, -ch / 2 - (big ? 11 : 8), 'PAYOUT', C.gold, H.ink, big ? 10 : 8, 'center');
    if (card.stalledUntil > 0 && !this.due && t && card.progress >= t) pill(scene, this.deco, 0, -ch / 2 - (big ? 11 : 8), 'STALLED', C.panel2, H.muted, big ? 9 : 7.5, 'center');
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
    const live = !!this.card && this.sway && !STILL;
    const sway = live ? Math.sin(this.t * 1.25 + this.phase) * 0.012 : 0;
    const bob = live ? Math.sin(this.t * 1.6 + this.phase) * 1.6 : 0;
    this.setScale(this.sc.step(dt));
    this.rotation = this.rot.step(dt) + sway;
    const glide = Math.min(1, dt * 14);
    this.baseY += (this.homeY - this.baseY) * glide;
    this.x += (this.homeX - this.x) * glide;
    this.y = this.baseY + this.lift.step(dt) + bob;
    if (this.due) this.glow.setAlpha(0.55 + 0.45 * Math.sin(this.t * 4));
    this.setAlpha(this.dim ? 0.45 : 1);
    this.shadow.setPosition(2 - this.lift.x * 0.12, (this.cw > 100 ? 9 : 6) - this.lift.x * 0.25);
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
    const sway = this.sway && !STILL;
    this.rotation = this.rot.step(dt) + (sway ? Math.sin(this.t * 1.1) * 0.012 : 0);
    this.y = this.baseY + this.lift.step(dt) + (sway ? Math.sin(this.t * 1.4) * 2 : 0);
    this.x = this.baseX;
  }
}
