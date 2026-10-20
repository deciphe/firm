import * as J from './juice.ts';
import { CrtPipeline } from './engine/shaders.ts';
import { FirmScene } from './engine/scene.ts';
import type { UiState } from './engine/scene.ts';
import { setDpr } from './engine/ui.ts';

interface Hot { snapshot?: (fn: () => unknown) => void; ready?: (fn: (data: { ui?: UiState }) => void) => void; data?: { ui?: UiState } }

function readStore<T>(key: string): T | null {
  try { const raw = localStorage.getItem(`firm:${key}`); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}

async function boot(data: { ui?: UiState }): Promise<void> {
  J.setMuted(readStore<boolean>('muted') ?? false);
  try {
    await Promise.race([
      Promise.all(['800 16px Manrope', '700 16px Manrope', '600 16px Manrope'].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 1800)),
    ]);
  } catch { /* fallback fonts are fine */ }
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  setDpr(dpr);
  const parent = document.getElementById('game') as HTMLElement;
  const size = (): { w: number; h: number } => ({ w: Math.max(320, parent.clientWidth), h: Math.max(480, parent.clientHeight) });
  const { w, h } = size();
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    width: w * dpr,
    height: h * dpr,
    backgroundColor: '#080809',
    antialias: true,
    pipeline: { CrtPipeline } as unknown as Phaser.Types.Core.PipelineConfig,
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
    input: { activePointers: 2 },
    fps: { target: 60 },
    banner: false,
    scene: [],
  });
  game.scene.add('firm', FirmScene, true, data);
  document.getElementById('boot')?.remove();
  window.addEventListener('resize', () => {
    const s = size();
    game.scale.resize(s.w * dpr, s.h * dpr);
  });
  const scene = (): FirmScene => game.scene.getScene('firm') as FirmScene;
  (window as unknown as { __firm: unknown }).__firm = new Proxy({}, { get: (_t, k) => (scene()?.debug() as Record<string | symbol, unknown>)[k] });
  const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
  hot?.snapshot?.(() => ({ ui: scene()?.ui }));
  window.addEventListener('pointerdown', () => J.unlockAudio(), { once: true });
}

const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
if (hot?.ready) hot.ready((d) => void boot(d)); else void boot(hot?.data ?? {});
