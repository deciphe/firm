import * as J from './juice.ts';
import { CrtPipeline } from './engine/shaders.ts';
import { FirmScene } from './engine/scene.ts';
import { RolodexScene, SetupScene, TitleScene } from './engine/menus.ts';
import type { UiState } from './engine/scene.ts';

interface Hot { snapshot?: (fn: () => unknown) => void; ready?: (fn: (data: { ui?: UiState }) => void) => void; data?: { ui?: UiState } }

function readStore<T>(key: string): T | null {
  try { const raw = localStorage.getItem(`firm:${key}`); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}

interface TauriWindow { isFullscreen(): Promise<boolean>; setFullscreen(on: boolean): Promise<void> }
async function toggleFullscreen(): Promise<void> {
  const tauri = (window as unknown as { __TAURI__?: { window?: { getCurrentWindow(): TauriWindow } } }).__TAURI__;
  try {
    const w = tauri?.window?.getCurrentWindow();
    if (w) { await w.setFullscreen(!(await w.isFullscreen())); return; }
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* fullscreen is a nicety */ }
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
  game.scene.add('firm', FirmScene, false);
  game.scene.add('title', TitleScene, false);
  game.scene.add('setup', SetupScene, false);
  game.scene.add('rolodex', RolodexScene, false);
  // First visit goes straight into the guided tutorial; after that, the title screen.
  if (data.ui?.s || !readStore<boolean>('tutorialDone')) game.scene.start('firm', data);
  else game.scene.start('title');
  document.getElementById('boot')?.remove();
  window.addEventListener('resize', () => {
    const s = size();
    game.scale.resize(s.w * dpr, s.h * dpr);
  });
  const scene = (): FirmScene => game.scene.getScene('firm') as FirmScene;
  const active = (): { debug: () => Record<string | symbol, unknown> } | null => {
    for (const key of ['firm', 'title', 'setup', 'rolodex']) {
      if (game.scene.isActive(key)) return game.scene.getScene(key) as unknown as { debug: () => Record<string | symbol, unknown> };
    }
    return null;
  };
  const go = (key: string, d: object = {}): void => { for (const k of ['firm', 'title', 'setup', 'rolodex']) if (game.scene.isActive(k)) game.scene.stop(k); game.scene.start(key, d); };
  (window as unknown as { __firm: unknown }).__firm = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'go') return go;
      if (k === 'game') return game;
      if (k === 'screen') return active() ? (active() as unknown as Phaser.Scene).scene.key : null;
      const sc = active();
      const dbg = sc?.debug() ?? {};
      return dbg[k] ?? (scene()?.debug() as Record<string | symbol, unknown>)[k];
    },
  });
  const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
  hot?.snapshot?.(() => ({ ui: scene()?.ui }));
  window.addEventListener('pointerdown', () => J.unlockAudio(), { once: true });
  // F11 / Alt+Enter: fullscreen (the Windows app through Tauri's window API, browsers through the page)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F11' && !(e.key === 'Enter' && e.altKey)) return;
    e.preventDefault();
    void toggleFullscreen();
  });
}

const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
if (hot?.ready) hot.ready((d) => void boot(d)); else void boot(hot?.data ?? {});
