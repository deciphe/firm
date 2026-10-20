import { BG_FRAG, CrtPipeline } from './shaders.ts';
import { C, DEPTH } from './theme.ts';
import { setTextRes } from './ui.ts';

export interface Rect { x: number; y: number; w: number; h: number }
/** Fixed design space fitted to the window: 1600x900 on computers, 430-wide portrait on phones. */
export interface Stage { W: number; H: number; wide: boolean; k: number; fit: number; view: Rect }

export function fitStage(scene: Phaser.Scene): Stage {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cw0 = scene.scale.width, ch0 = scene.scale.height;
  const winW = cw0 / dpr, winH = ch0 / dpr;
  const wide = winW / winH >= 1.1 && winW >= 700;
  const W = wide ? 1600 : 430;
  const H = wide ? 900 : Math.round(Math.max(760, Math.min(1000, (430 * winH) / winW)));
  const fit = Math.min(winW / W, winH / H);
  const k = fit * dpr;
  const vw = cw0 / k, vh = ch0 / k;
  setTextRes(k);
  scene.cameras.main.setZoom(k).centerOn(W / 2, H / 2);
  return { W, H, wide, k, fit, view: { x: W / 2 - vw / 2, y: H / 2 - vh / 2, w: vw, h: vh } };
}

/** CSS-pixel rect of a design-space rect (for clicking from tests). */
export function cssRect(st: Stage, r: Rect): Rect {
  return { x: (r.x - st.view.x) * st.fit, y: (r.y - st.view.y) * st.fit, w: r.w * st.fit, h: r.h * st.fit };
}

/** The paint swirl, covering the whole window. Returns the shader so the scene can drive its uniforms. */
export function backdrop(scene: Phaser.Scene, st: Stage, opts: { heat?: number } = {}): Phaser.GameObjects.Shader {
  const V = st.view;
  const shader = new Phaser.Display.BaseShader('bg', BG_FRAG, undefined, {
    uPix: { type: '1f', value: st.wide ? 5 : 3.5 }, uSpin: { type: '1f', value: 0 },
    uPulse: { type: '4f', value: { x: 0, y: 0, z: 0, w: 0 } }, uHeat: { type: '1f', value: opts.heat ?? 0 },
  });
  return scene.add.shader(shader, V.x - 4, V.y - 4, V.w + 8, V.h + 8).setOrigin(0).setDepth(DEPTH.bg);
}

/** Attach the CRT finish to the scene camera (WebGL only). */
export function crt(scene: Phaser.Scene): CrtPipeline | null {
  const renderer = scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer.pipelines) return null;
  scene.cameras.main.setPostPipeline(CrtPipeline);
  return scene.cameras.main.getPostPipeline(CrtPipeline) as CrtPipeline;
}

let switching = false;
/** Fade to ink, then start another screen. */
export function goTo(scene: Phaser.Scene, key: string, data: object = {}): void {
  if (switching) return;
  switching = true;
  const cam = scene.cameras.main;
  cam.fadeOut(220, 8, 8, 9);
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    switching = false;
    scene.scene.start(key, data);
  });
}
export function fadeIn(scene: Phaser.Scene): void { scene.cameras.main.fadeIn(280, 8, 8, 9); }

/** Rebuild a screen when the window changes size; cleaned up when the screen closes. */
export function onResize(scene: Phaser.Scene, fn: () => void): void {
  let pending = false;
  const h = (): void => {
    if (pending) return;
    pending = true;
    scene.time.delayedCall(120, () => { pending = false; fn(); });
  };
  scene.scale.on('resize', h);
  scene.events.once('shutdown', () => scene.scale.off('resize', h));
}

/** Drive the backdrop: slow spin plus a decaying colour pulse. */
export class Backdrop {
  pulse = { r: 0, g: 0, b: 0, a: 0 };
  spin = 0;
  constructor(public bg: Phaser.GameObjects.Shader | null) {}
  hit(color: number, amt: number): void {
    this.pulse = { r: ((color >> 16) & 255) / 255, g: ((color >> 8) & 255) / 255, b: (color & 255) / 255, a: Math.min(1.2, this.pulse.a + amt) };
  }
  tick(dt: number): void {
    this.pulse.a *= Math.pow(0.12, dt);
    this.spin += dt * (0.02 + this.pulse.a * 0.5);
    this.bg?.setUniform('uSpin.value', this.spin);
    this.bg?.setUniform('uPulse.value', { x: this.pulse.r, y: this.pulse.g, z: this.pulse.b, w: this.pulse.a });
  }
}

export const INK = C.ink;
