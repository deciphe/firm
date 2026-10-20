import { C, FONT } from './theme.ts';

/** Every layout number is in CSS pixels; `u()` turns it into device pixels. */
export let DPR = 1;
export function setDpr(d: number): void { DPR = d; }
export const u = (v: number): number => Math.round(v * DPR * 100) / 100;

export interface TextOpts { size: number; weight?: number; color?: string; spacing?: number; align?: 'left' | 'center' | 'right'; wrap?: number; lineSpacing?: number }

export function text(scene: Phaser.Scene, x: number, y: number, str: string, o: TextOpts): Phaser.GameObjects.Text {
  const t = scene.add.text(u(x), u(y), str, {
    fontFamily: FONT,
    fontSize: `${u(o.size)}px`,
    fontStyle: String(o.weight ?? 700),
    color: o.color ?? '#eeeae2',
    align: o.align ?? 'left',
    ...(o.wrap ? { wordWrap: { width: u(o.wrap), useAdvancedWrap: true } } : {}),
    ...(o.lineSpacing ? { lineSpacing: u(o.lineSpacing) } : {}),
  });
  if (o.spacing) t.setLetterSpacing(u(o.spacing));
  return t;
}

export function roundRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillRoundedRect(u(x), u(y), u(w), u(h), Math.min(u(r), u(h) / 2, u(w) / 2));
}

export function strokeRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, color: number, width = 1, alpha = 1): void {
  g.lineStyle(u(width), color, alpha);
  g.strokeRoundedRect(u(x), u(y), u(w), u(h), Math.min(u(r), u(h) / 2, u(w) / 2));
}

/** Dashed rounded rectangle (Graphics has no dash support). */
export function dashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, r: number, color: number, alpha: number, width = 1.5, dash = 6, gap = 5): void {
  g.lineStyle(u(width), color, alpha);
  const pts: [number, number][] = [];
  const seg = 6;
  const corner = (cx: number, cy: number, a0: number): void => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  pts.push(pts[0] as [number, number]);
  let on = true, left = dash;
  for (let i = 1; i < pts.length; i++) {
    let [ax, ay] = pts[i - 1] as [number, number];
    const [bx, by] = pts[i] as [number, number];
    let len = Math.hypot(bx - ax, by - ay);
    while (len > 0) {
      const step = Math.min(len, left);
      const nx = ax + ((bx - ax) * step) / len, ny = ay + ((by - ay) * step) / len;
      if (on) g.lineBetween(u(ax), u(ay), u(nx), u(ny));
      ax = nx; ay = ny; len -= step; left -= step;
      if (left <= 0) { on = !on; left = on ? dash : gap; }
    }
  }
}

/** A tiny spring: value chases target with overshoot (Balatro-style wobble). */
export class Spring {
  v = 0;
  constructor(public x: number, public target: number, public k = 260, public d = 18) {}
  step(dt: number): number {
    const a = this.k * (this.target - this.x) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  kick(vel: number): void { this.v += vel; }
}

export interface ButtonStyle { fill: number; deep: number; ink: string; size?: number; weight?: number; spacing?: number; stroke?: number; sub?: string }

/** A chunky Balatro-style button: flat colour, darker lip underneath, lifts on hover, sinks on press. */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private subLabel: Phaser.GameObjects.Text | null = null;
  private sc = new Spring(1, 1, 420, 22);
  private lift = new Spring(0, 0, 420, 24);
  private hovered = false;
  private pressed = false;
  enabled = true;
  baseY = 0;
  onClick: () => void = () => {};

  constructor(scene: Phaser.Scene, x: number, y: number, public bw: number, public bh: number, str: string, public style: ButtonStyle) {
    super(scene, u(x + bw / 2), u(y + bh / 2));
    this.baseY = u(y + bh / 2);
    this.bg = scene.add.graphics();
    this.label = text(scene, 0, 0, str, { size: style.size ?? 14, weight: style.weight ?? 800, color: style.ink, spacing: style.spacing ?? 1.6, align: 'center' }).setOrigin(0.5);
    this.add([this.bg, this.label]);
    if (style.sub) {
      this.subLabel = text(scene, 0, 0, style.sub, { size: 11, weight: 700, color: style.ink, spacing: 0.5, align: 'center' }).setOrigin(0.5).setAlpha(0.65);
      this.add(this.subLabel);
    }
    this.draw();
    this.setSize(u(bw), u(bh));
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => { this.hovered = true; this.lift.target = this.enabled ? -2 : 0; });
    this.on('pointerout', () => { this.hovered = false; this.pressed = false; this.lift.target = 0; this.sc.target = 1; });
    this.on('pointerdown', () => { if (!this.enabled) return; this.pressed = true; this.sc.target = 0.96; this.draw(); });
    this.on('pointerup', () => {
      if (!this.pressed) return;
      this.pressed = false; this.sc.target = 1; this.sc.kick(2.2); this.draw();
      if (this.enabled) this.onClick();
    });
    scene.events.on('update', this.tick, this);
    this.once('destroy', () => scene.events.off('update', this.tick, this));
    scene.add.existing(this);
  }

  setLabel(str: string, sub?: string): this {
    this.label.setText(str);
    if (this.subLabel && sub !== undefined) this.subLabel.setText(sub);
    return this;
  }
  setEnabled(on: boolean): this { this.enabled = on; this.setAlpha(on ? 1 : 0.38); return this; }
  setStyle(style: ButtonStyle): this { this.style = style; this.label.setColor(style.ink); this.draw(); return this; }

  private draw(): void {
    const { bw, bh, style } = this;
    const lip = this.pressed ? 1 : 4;
    this.bg.clear();
    roundRect(this.bg, -bw / 2, -bh / 2 + 4, bw, bh - 4, 12, style.deep);
    roundRect(this.bg, -bw / 2, -bh / 2 + (4 - lip), bw, bh - 4, 12, style.fill);
    if (style.stroke !== undefined) strokeRect(this.bg, -bw / 2, -bh / 2 + (4 - lip), bw, bh - 4, 12, style.stroke, 1);
    const cy = u((4 - lip) / 2 - 2);
    if (this.subLabel) { this.label.setY(cy - u(7)); this.subLabel.setY(cy + u(12)); } else this.label.setY(cy);
  }

  private tick(_t: number, dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);
    const s = this.sc.step(dt);
    const l = this.lift.step(dt);
    this.setScale(s);
    this.y = this.baseY + u(l);
    void this.hovered;
  }

  /** Move the button (top-left, CSS px). */
  place(x: number, y: number): this { this.x = u(x + this.bw / 2); this.baseY = u(y + this.bh / 2); this.y = this.baseY; return this; }
}

export const STYLE = {
  clay: { fill: C.clay, deep: C.clayDeep, ink: '#2a0e05' } as ButtonStyle,
  gold: { fill: C.gold, deep: C.goldDeep, ink: '#080809' } as ButtonStyle,
  dark: { fill: C.panel2, deep: 0x050506, ink: '#eeeae2', stroke: C.line2 } as ButtonStyle,
  paper: { fill: C.paper, deep: C.paper3, ink: '#080809' } as ButtonStyle,
  ghost: { fill: C.ink, deep: C.ink, ink: '#d97757', stroke: C.ink } as ButtonStyle,
};
