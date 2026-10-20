"""Screenshot audit for the Phaser build: plays the tutorial and a real run by clicking real canvas
coordinates (from __firm.rect), and screenshots each key state at the given sizes.
Usage: python3 apps/game/shoot.py [out_dir] [sizes like 390x844,1440x900]"""
import sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/firm/design/audits'
SIZES = [tuple(map(int, s.split('x'))) for s in (sys.argv[2] if len(sys.argv) > 2 else '390x844,1440x900').split(',')]
URL = 'file:///home/claude/firm/apps/game/dist/dev.html'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']


def run(p, w, h):
    mobile = w < 900
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1 if not mobile else 2, has_touch=mobile, is_mobile=mobile)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    tag = f'{w}x{h}'
    shot = lambda n: pg.screenshot(path=f'{OUT}/{tag}-{n}.png')
    view = lambda: pg.evaluate('__firm.view()')

    def until(fn, timeout=20):
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                if fn():
                    return True
            except Exception:
                pass
            pg.wait_for_timeout(150)
        return False

    def click(name):
        r = pg.evaluate(f'__firm.rect({name!r})')
        if not r:
            raise RuntimeError(f'no rect {name}')
        x, y = r['x'] + r['w'] / 2, r['y'] + r['h'] / 2
        if mobile:
            pg.touchscreen.tap(x, y)
        else:
            pg.mouse.click(x, y)
        pg.wait_for_timeout(120)

    def advance(hint):
        for _ in range(20):
            v = view()
            if v['hint'] == hint:
                return True
            if v['guide'] and not v['wait']:
                pg.wait_for_timeout(250)
                click('next'); click('next')
            pg.wait_for_timeout(350)
        return False

    def settle():
        until(lambda: not view()['busy'], 25)
        pg.wait_for_timeout(250)

    pg.goto(URL)
    until(lambda: pg.evaluate('!!window.__firm && !!__firm.view'), 20)
    pg.wait_for_timeout(1800)
    shot('01-tutorial-intro')
    advance('Tap OPEN MARKET')
    pg.wait_for_timeout(1500)
    shot('02-tutorial-open-market')
    click('cta')
    pg.wait_for_timeout(2300)
    shot('03-pops')
    settle()
    advance('Tap the Affiliate')
    pg.wait_for_timeout(1500)
    shot('04-tutorial-hire')
    click('offer0')
    pg.wait_for_timeout(1200)
    shot('05-tutorial-place')
    print(tag, 'tutorial ok', flush=True)

    # a real run
    pg.evaluate('__firm.load(1234)')
    pg.wait_for_timeout(500)
    for day in range(4):
        click('cta'); settle()
        for _ in range(4):
            v = view()
            if v['overlay'] == 'payout':
                r = pg.evaluate("__firm.rect('pay')")
                click('pay' if pg.evaluate('__firm.state.cash') >= pg.evaluate('__firm.state.queue[0]?.amount ?? 1e9') else 'stall'); settle()
        v = view()
        if v['shop'] and not v['placing']:
            s = pg.evaluate('__firm.state')
            if s['cash'] > 200:
                click('offer0'); pg.wait_for_timeout(400)
            if view()['placing']:
                click(f"slot{pg.evaluate('__firm.firstEmpty()')}"); settle()
            elif view()['shop']:
                click('skip'); settle()
    pg.wait_for_timeout(600)
    shot('06-midrun')
    click('cta'); pg.wait_for_timeout(600); shot('06b-candle'); settle()
    if view()['overlay'] == 'payout':
        click('stall'); settle()
    shot('07-draft')
    pg.evaluate('''() => { __firm.load(77); const s = __firm.state; s.grid[7].progress = 10; s.grid[6].revealed = true; s.grid[6].def = 'hedger'; __firm.set({grid: s.grid, cash: 900, excuses: ['terms','kyc','glitch']}); __firm.guideStop(); }''')
    pg.wait_for_timeout(400)
    click('cta'); settle()
    until(lambda: view()['overlay'] == 'payout', 10)
    pg.evaluate('__firm.guideStop()')
    pg.wait_for_timeout(1800)
    shot('08-payout')
    pg.evaluate('''() => { __firm.set({phase:'dead', cause:'payroll', shortBy:212, day:34, stats: {...__firm.state.stats, peakValuation: 14220, payoutsPaid: 17, payoutsDenied: 2, fraudCaught: 1}}); __firm.showDeath(); }''')
    pg.wait_for_timeout(900)
    shot('09-death')
    pg.evaluate('__firm.showHow()'); pg.wait_for_timeout(700); shot('10-how')
    b.close()
    return errs


with sync_playwright() as p:
    for w, h in SIZES:
        try:
            errs = run(p, w, h)
            print(f'{w}x{h}', 'errors:', errs[:5], flush=True)
        except Exception as e:
            print(f'{w}x{h}', 'FAILED:', str(e).split('\n')[0], flush=True)
