"""Screenshot audit for the run structure: title, Open a Firm, Rolodex, payroll cash-out, quarter
briefing (with and without a live crisis), the table mid-crisis, and the death card.
Usage: python3 apps/game/shoot_screens.py [out_dir] [sizes like 1440x900,390x844]"""
import json, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

OUT = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / 'design' / 'audits')
SIZES = [tuple(map(int, s.split('x'))) for s in (sys.argv[2] if len(sys.argv) > 2 else '1440x900,390x844').split(',')]
URL = (ROOT / 'apps' / 'game' / 'dist' / 'dev.html').as_uri()
ARGS = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'] if os.environ.get('FIRM_SWIFTSHADER') else ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
META = {'runs': 7, 'bestDays': 17, 'bestVal': 6120, 'totalPaid': 12, 'totalDenied': 4, 'crises': 1, 'maxStake': 2,
        'seen': ['gambler', 'grinder', 'retail', 'whale', 'affiliate', 'influencer', 'hedger', 'trendbro', 'x:terms', 'x:glitch', 'support'],
        'founder': 'founder', 'stake': 1, 'records': {'founder:1': 6120}}


def run(p, w, h):
    mobile = w < 900
    b = p.chromium.launch(args=ARGS, channel=os.environ.get('FIRM_BROWSER', 'chrome'))
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2 if mobile else 1, has_touch=mobile, is_mobile=mobile)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    tag = f'{w}x{h}'
    shot = lambda n: pg.screenshot(path=f'{OUT}/{tag}-s{n}.png')

    def click(name):
        r = pg.evaluate(f'__firm.rect({name!r})')
        if not r:
            raise RuntimeError(f'no rect {name} on {pg.evaluate("__firm.screen")}')
        x, y = r['x'] + r['w'] / 2, r['y'] + r['h'] / 2
        if mobile:
            pg.touchscreen.tap(x, y)
        else:
            pg.mouse.click(x, y)
        pg.wait_for_timeout(150)

    def wait_screen(name, t=10):
        t0 = time.time()
        while time.time() - t0 < t:
            try:
                if pg.evaluate('__firm.screen') == name:
                    pg.wait_for_timeout(700)
                    return
            except Exception:
                pass
            pg.wait_for_timeout(150)
        raise RuntimeError(f'screen {name} never came')

    pg.goto(URL)
    pg.evaluate(f"() => {{ localStorage.setItem('firm:tutorialDone', 'true'); localStorage.setItem('firm:meta', {json.dumps(json.dumps(META))}); localStorage.setItem('firm:tips', JSON.stringify(['moves','fraud','heat40'])); }}")
    pg.reload()
    wait_screen('title', 20)
    pg.wait_for_timeout(1200)
    shot('01-title')
    click('play'); wait_screen('setup')
    shot('02-setup')
    click('next'); pg.wait_for_timeout(700); shot('03-setup-hustler')
    click('next'); click('next'); click('next'); pg.wait_for_timeout(700); shot('04-setup-locked')
    click('back'); wait_screen('title')
    click('rolodex'); wait_screen('rolodex')
    click('card0'); pg.wait_for_timeout(500)
    shot('05-rolodex')
    click('back'); wait_screen('title')
    click('play'); wait_screen('setup')
    click('prev'); click('prev'); click('prev'); click('prev')  # back to The Founder
    pg.wait_for_timeout(300)
    click('start'); wait_screen('firm')
    pg.wait_for_timeout(600)
    shot('06-table')
    # jump to payday with cash, then pay payroll through the real flow
    pg.evaluate("() => { const s = __firm.state; __firm.set({ day: s.payroll.dueDay, cash: 2400, forecast: {chop: 1, up: 0, down: 0, news: 0} }); __firm.guideStop(); }")
    pg.wait_for_timeout(300)
    click('cta')
    for _ in range(80):
        v = pg.evaluate('__firm.view()')
        if not v['busy'] and v['phase'] != 'morning':
            break
        pg.wait_for_timeout(150)
    for _ in range(5):
        v = pg.evaluate('__firm.view()')
        if v['overlay'] == 'payout':
            click('pay'); pg.wait_for_timeout(1200)
    for _ in range(40):
        v = pg.evaluate('__firm.view()')
        if v['shop'] and not v['busy']:
            break
        pg.wait_for_timeout(150)
    click('skip')
    pg.wait_for_timeout(900)
    print(tag, 'after skip', pg.evaluate('__firm.view()'), pg.evaluate('__firm.state.phase'), flush=True)
    shot('07-cashout-printing')
    pg.wait_for_timeout(2600)
    shot('08-cashout')
    click('continue'); pg.wait_for_timeout(1300)
    shot('09-quarter')
    # a live crisis
    pg.evaluate("() => { __firm.set({ crisis: 'bankrun', nextCrisis: 'audit', crisisCycle: 6, plans: ['steady','pr','raise'], heat: 52 }); __firm.quarter(); }")
    pg.wait_for_timeout(1300)
    shot('10-quarter-crisis')
    click('plan1'); pg.wait_for_timeout(1200)
    shot('11-table-crisis')
    pg.evaluate("() => { __firm.set({phase:'dead', cause:'payroll', shortBy:212, day:34, stats: {...__firm.state.stats, peakValuation: 14220, payoutsPaid: 17, payoutsDenied: 2, fraudCaught: 1, crisesSurvived: 2}}); __firm.showDeath(); }")
    pg.wait_for_timeout(1600)
    shot('12-death')
    b.close()
    return errs


with sync_playwright() as p:
    for w, h in SIZES:
        try:
            errs = run(p, w, h)
            print(f'{w}x{h}', 'errors:', errs[:5], flush=True)
        except Exception as e:
            print(f'{w}x{h}', 'FAILED:', str(e).split('\n')[0], flush=True)
