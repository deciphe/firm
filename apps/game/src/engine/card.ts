import { cardDef, displayName } from '@firm/sim';
import type { CardInstance } from '@firm/sim';
import { stippleCanvas } from '../stipple.ts';
import { C, H } from './theme.ts';
import { Spring, dashedRect, roundRect, strokeRect, text, u } from './ui.ts';

const SHORT: Record<string, string> = { 'Chargeback Artist': 'Chargeback', 'Copy-Trade Detector': 'Detector', 'Payout Proof Wall': 'Proof Wall', 'Compliance Officer': 'Compliance', 'Support Agent': 'Support', 'Bulk Customer': 'Bulk Buyer' };
export const shortName = (n: string): string => SHORT[n] ?? n;

const SAMPLE_FEE: Record<string, number> = { gambler: 30, grinder: 12, retail: 26, scalper: 8, trendbro: 38, copyring: 18, hedger: 25, ghost: 28, chargeback: 40, whale: 110, influencer: 0, bot: 12, vet: 0, botfarm: 0 };

export function artId(card: CardInstance): string {
  const def = cardDef(card.def);
  if (!card.revealed && def.disguise) return card.def === 'bot' ? 'bot' : 'retail';
  return card.def;
}

/** Card art as a Phaser texture, generated once per id. */
export function artTexture(scene: Phaser.Scene, id: string): string {
  const key = `art:${id}`;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, stippleCanvas(id, '#080809', 3));
  return key;
}

export class CardView extends Phaser.GameObjects.Container {
  private shadow: Phaser.GameObjects.Graphics;
  private face: Phaser.GameObjects.Graphics;
  private art: Phaser.GameObjects.Image | null = null;
  private fee: Phaser.GameObjects.Text;
  private nameT: Phaser.GameObjects.Text;
  private dots: Phaser.GameObjects.Graphics;
  private stamp: Phaser.GameObjects.Text;
  private badge: Phaser.GameObjects.Container;
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
    this.dots = scene.add.graphics();
    const big = cw > 100;
    this.fee = text(scene, -cw / 2 + (big ? 10 : 6), -ch / 2 + (big ? 9 : 6), '', { size: big ? 15 : 11, weight: 800, color: H.ink });
    this.nameT = text(scene, 0, ch / 2 - (big ? 28 : 19), '', { size: big ? 13 : 9.5, weight: 800, color: H.ink, align: 'center' }).setOrigin(0.5, 0.5);
    this.stamp = text(scene, 0, -ch * 0.04, 'FRAUD', { size: big ? 13 : 9, weight: 800, color: H.clay, spacing: 1.6 }).setOrigin(0.5).setAngle(-14).setVisible(false);
    this.badge = scene.add.container(u(cw / 2 - 4), u(-ch / 2 + 2)).setVisible(false);
    this.add([this.glow, this.shadow, this.face, this.dots, this.fee, this.nameT, this.stamp, this.badge]);
    this.setSize(u(cw), u(ch));
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => { this.hovered = true; this.sc.target = 1.07; this.lift.target = -8; });
    this.on('pointerout', () => { this.hovered = false; this.sc.target = 1; this.lift.target = 0; this.rot.target = 0; });
    this.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.hovered) return;
      const lx = (p.x - this.x) / u(this.cw);
      this.rot.target = lx * 0.12;
    });
    scene.events.on('update', this.tick, this);
    this.once('destroy', () => scene.events.off('update', this.tick, this));
    scene.add.existing(this);
  }

  place(x: number, y: number): this { this.homeX = u(x); this.homeY = u(y); this.x = this.homeX; this.y = this.homeY; return this; }

  setCard(card: CardInstance | null): this {
    this.card = card;
    const { cw, ch } = this;
    const big = cw > 100;
    this.face.clear(); this.shadow.clear(); this.dots.clear(); this.glow.clear();
    this.art?.destroy(); this.art = null;
    this.badge.removeAll(true).setVisible(false);
    if (!card) {
      dashedRect(this.face, -cw / 2, -ch / 2, cw, ch, big ? 12 : 9, C.muted, 0.22);
      this.fee.setText(''); this.nameT.setText(''); this.stamp.setVisible(false);
      this.disableInteractive().setInteractive({ useHandCursor: true });
      return this;
    }
    const def = cardDef(card.def);
    const hidden = !card.revealed && !!def.disguise;
    const staff = def.kind === 'staff';
    const rare = def.rarity === 'rare' && !hidden;
    const exposed = card.revealed && !!def.fraud;
    const t = def.threshold ?? 0;
    this.due = !!t && card.progress >= t;
    const r = big ? 12 : 9;
    // shadow + body
    roundRect(this.shadow, -cw / 2 + 1, -ch / 2 + (big ? 7 : 5), cw, ch, r, 0x000000, 0.5);
    roundRect(this.face, -cw / 2, -ch / 2, cw, ch, r, staff ? 0xe9e7e4 : C.paper);
    roundRect(this.face, -cw / 2, ch / 2 - ch * 0.22, cw, ch * 0.22, r, staff ? 0xdfdcd7 : C.paper2, 0.7);
    strokeRect(this.face, -cw / 2 + 3, -ch / 2 + 3, cw - 6, ch - 6, r - 2, C.ink, 1, 0.12);
    if (staff) strokeRect(this.face, -cw / 2 + 0.75, -ch / 2 + 0.75, cw - 1.5, ch - 1.5, r, C.plat, 1.5, 1);
    if (rare) strokeRect(this.face, -cw / 2 + 1, -ch / 2 + 1, cw - 2, ch - 2, r, C.gold, 2, 1);
    if (this.due) { this.glow.fillStyle(C.gold, 0.28); this.glow.fillRoundedRect(u(-cw / 2 - 6), u(-ch / 2 - 6), u(cw + 12), u(ch + 12), u(r + 5)); strokeRect(this.face, -cw / 2 - 1, -ch / 2 - 1, cw + 2, ch + 2, r + 1, C.gold, 2.5, 1); }
    // art
    const key = artTexture(this.scene, artId(card));
    const size = Math.min(cw * (big ? 0.72 : 0.78), ch * 0.5);
    this.art = this.scene.add.image(0, u(-ch * 0.06), key).setDisplaySize(u(size), u(size));
    if (exposed) this.art.setTint(0xb8452a);
    this.addAt(this.art, 3);
    // labels
    const base = (hidden ? SAMPLE_FEE.retail : SAMPLE_FEE[card.def]) ?? 0;
    this.fee.setText(staff ? 'STAFF' : `$${base + card.bonus}`).setFontSize(staff ? u(big ? 10 : 8) : u(big ? 15 : 11)).setLetterSpacing(staff ? u(1.2) : 0).setColor(staff ? H.blue : H.ink);
    this.nameT.setText(shortName(displayName(card)));
    this.fitName();
    this.stamp.setVisible(exposed);
    // payout progress dots
    if (t) {
      const n = 10, dr = big ? 2.6 : 1.7, gap = big ? 8.4 : (cw - 12) / n;
      const x0 = -((n - 1) * gap) / 2, y = ch / 2 - (big ? 11 : 8);
      for (let k = 0; k < n; k++) {
        const on = k < Math.round((card.progress / t) * 10);
        if (on) { this.dots.fillStyle(this.due ? C.goldDeep : C.ink, 1); this.dots.fillCircle(u(x0 + k * gap), u(y), u(dr)); }
        else { this.dots.lineStyle(u(0.9), C.ink, 0.35); this.dots.strokeCircle(u(x0 + k * gap), u(y), u(dr)); }
      }
    }
    if (card.bonus) {
      const g = this.scene.add.graphics();
      roundRect(g, -30, -2, 30, 18, 6, C.gold);
      const bt = text(this.scene, -15, 7, `+${card.bonus}`, { size: 10, weight: 800, color: H.ink }).setOrigin(0.5);
      this.badge.add([g, bt]).setVisible(true);
    }
    return this;
  }

  private fitName(): void {
    const max = u(this.cw - 8);
    let s = this.nameT.text;
    while (this.nameT.width > max && s.length > 3) { s = s.slice(0, -1); this.nameT.setText(`${s.trimEnd()}…`); }
  }

  /** The Balatro jolt: jump, twist, settle. */
  pop(strength = 1): void {
    this.sc.x = 1.16 * strength + (1 - strength);
    this.sc.kick(-1.5);
    this.rot.kick((Math.random() < 0.5 ? -1 : 1) * 3.2 * strength);
    this.lift.kick(-160 * strength);
  }

  drop(): void { this.sc.x = 1.35; this.lift.x = -40; this.rot.x = (Math.random() - 0.5) * 0.4; }

  private tick(_time: number, dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);
    this.t += dt;
    const sway = this.card && this.sway ? Math.sin(this.t * 1.25 + this.phase) * 0.012 : 0;
    const bob = this.card && this.sway ? Math.sin(this.t * 1.6 + this.phase) * u(1.6) : 0;
    this.setScale(this.sc.step(dt));
    this.rotation = this.rot.step(dt) + sway;
    this.y = this.homeY + u(this.lift.step(dt)) + bob;
    this.x = this.homeX;
    if (this.due) this.glow.setAlpha(0.6 + 0.4 * Math.sin(this.t * 4));
    this.setAlpha(this.dim ? 0.5 : 1);
    this.shadow.setPosition(u(-this.lift.x * 0.12), u(-this.lift.x * 0.25));
  }
}
