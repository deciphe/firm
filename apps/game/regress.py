"""Visual regression suite: drives the game (still mode: no swirl motion, sway or grain) to each key state at
desktop and phone sizes and compares against the baselines in design/baseline/.

Usage: python apps/game/regress.py            compare (exit 1 on any visual change; diffs in design/baseline/diff/)
       python apps/game/regress.py --update   accept the current look as the new baseline
"""
import os, sys, time
from pathlib import Path
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
URL = (ROOT / 'apps' / 'game' / 'dist' / 'dev.html').as_uri()
BASE = ROOT / 'design' / 'baseline'
SIZES = [(1920, 1080), (390, 844)]
ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
UPDATE = '--update' in sys.argv

# Every state starts from a fresh page. Each is a list of (kind, arg) steps run by drive().
CARD = "(uid, def, extra) => Object.assign({ uid, def, progress: 0, age: 3, revealed: true, payouts: 0, stalls: 0, stalledUntil: 0, bonus: 0 }, extra || {})"
STATES = {
    'title': [('go', "__firm.go('title')")],
    'table': [('seed', 42)],
    'shop': [('seed', 42), ('click', 'cta'), ('settle', 3500)],
    'placing': [('seed', 42), ('js', "__firm.set({ phase: 'draft', offers: [{ kind: 'card', id: 'affiliate' }, { kind: 'card', id: 'gambler' }, { kind: 'excuse', id: 'kyc' }], cash: 400 })"), ('click', 'offer0'), ('settle', 900)],
    'scored': [('seed', 5), ('js', f"(() => {{ const mk = {CARD}; const ids = ['gambler','gambler','retail','gambler','whale','gambler','affiliate','gambler','affiliate','gambler','grinder','gambler','quantdesk','gambler','grinder',null,'vet','cro','vet',null]; __firm.set({{ grid: ids.map((d, i) => d ? mk(500 + i, d) : null), forecast: {{ chop: 1, up: 0, down: 0, news: 0 }}, cash: 900 }}); }})()"), ('click', 'cta'), ('settle', 4500)],
    'payout': [('seed', 77), ('js', f"(() => {{ const mk = {CARD}; const s = __firm.state; const g = s.grid.slice(); g[7] = mk(900, 'grinder', {{ progress: 10 }}); __firm.set({{ grid: g, cash: 900, excuses: ['terms', 'kyc', 'glitch'], forecast: {{ chop: 1, up: 0, down: 0, news: 0 }} }}); }})()"), ('click', 'cta'), ('settle', 3500)],
    'valuation': [('seed', 42), ('js', "__firm.showValuation()"), ('settle', 900)],
    'death': [('seed', 42), ('js', "(() => { __firm.set({ phase: 'dead', cause: 'payroll', shortBy: 212, day: 34, stats: { ...__firm.state.stats, peakValuation: 14220, payoutsPaid: 17, payoutsDenied: 2, fraudCaught: 1 } }); __firm.showDeath(); })()"), ('settle', 1800)],
}


def drive(pg, mobile, steps):
    view = lambda: pg.evaluate('__firm.view ? __firm.view() : {}')

    def until(fn, timeout=20.0):
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                if fn():
                    return True
            except Exception:
                pass
            pg.wait_for_timeout(100)
        return False

    for kind, arg in steps:
        if kind == 'go':
            pg.evaluate(arg); pg.wait_for_timeout(1500)
        elif kind == 'seed':
            pg.evaluate("__firm.go('firm', { mode: 'random' })")
            until(lambda: pg.evaluate("__firm.screen === 'firm'"))
            pg.wait_for_timeout(500)
            pg.evaluate(f'__firm.load({arg})')
            pg.wait_for_timeout(1200)
        elif kind == 'js':
            pg.evaluate(arg); pg.wait_for_timeout(500)
        elif kind == 'click':
            until(lambda: pg.evaluate(f'!!__firm.rect({arg!r})'), 8)
            r = pg.evaluate(f'__firm.rect({arg!r})')
            x, y = r['x'] + r['w'] / 2, r['y'] + r['h'] / 2
            if mobile:
                pg.touchscreen.tap(x, y)
            else:
                pg.mouse.move(x, y); pg.mouse.down(); pg.wait_for_timeout(40); pg.mouse.up()
                pg.mouse.move(2, 2)  # no hover state in the shot
            pg.wait_for_timeout(200)
        elif kind == 'settle':
            until(lambda: not view().get('busy'), 30)
            pg.wait_for_timeout(arg)


def compare(name, img):
    base = BASE / f'{name}.png'
    if UPDATE or not base.exists():
        BASE.mkdir(parents=True, exist_ok=True)
        img.save(base)
        return 'saved'
    ref = Image.open(base).convert('RGB')
    if ref.size != img.size:
        return f'FAIL size {img.size} vs {ref.size}'
    diff = ImageChops.difference(ref, img)
    hist = diff.convert('L').point(lambda v: 255 if v > 40 else 0).histogram()
    changed = hist[255] / (img.size[0] * img.size[1])
    if changed > 0.004:
        (BASE / 'diff').mkdir(parents=True, exist_ok=True)
        img.save(BASE / 'diff' / f'{name}-now.png')
        diff.point(lambda v: min(255, v * 4)).save(BASE / 'diff' / f'{name}-diff.png')
        return f'FAIL {changed * 100:.2f}% of pixels changed'
    return f'ok ({changed * 100:.3f}%)'


def main():
    failed = 0
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS, channel=os.environ.get('FIRM_BROWSER', 'chrome'))
        for w, h in SIZES:
            mobile = w < 900
            for name, steps in STATES.items():
                pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2 if mobile else 1, has_touch=mobile, is_mobile=mobile)
                errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)))
                pg.add_init_script("localStorage.setItem('firm:still','1'); localStorage.setItem('firm:tutorialDone','true'); localStorage.setItem('firm:tips', JSON.stringify(['moves','fraud','heat40'])); localStorage.setItem('firm:muted','true');")
                pg.goto(URL)
                pg.wait_for_function('!!window.__firm && !!__firm.screen', timeout=20000)
                pg.wait_for_timeout(800)
                try:
                    drive(pg, mobile, steps)
                    shot = ROOT / 'design' / 'baseline' / '_last.png'
                    shot.parent.mkdir(parents=True, exist_ok=True)
                    pg.screenshot(path=str(shot))
                    res = compare(f'{w}x{h}-{name}', Image.open(shot).convert('RGB'))
                except Exception as e:
                    res = f'FAIL {e}'
                if errs:
                    res += f'  page errors: {errs[:3]}'
                if res.startswith('FAIL') or errs:
                    failed += 1
                print(f'{w}x{h} {name:10} {res}', flush=True)
                pg.close()
        b.close()
    (ROOT / 'design' / 'baseline' / '_last.png').unlink(missing_ok=True)
    print('PASS' if not failed else f'{failed} FAILED')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
