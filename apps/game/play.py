"""Drive the real game in Chrome through canvas clicks and screenshot as you go.

Usage: python apps/game/play.py OUT_DIR SIZE STEP [STEP ...]
Steps:
  seed:N            start a fresh random-mode run on seed N (tutorial marked done)
  title             go to the title screen
  click:NAME        click a hit rect (cta, offer0, slot7, pay, stall, deny0, ghost, skip, reroll, plan0, continue, ...)
  day               play one day with a simple policy (tap, pay if affordable else stall/deny, buy the cheapest
                    affordable offer into the first empty slot, pick the first plan, continue past cash-out)
  days:N            play N days that way
  wait:MS           wait
  shot:NAME         screenshot
  film:NAME:MS:N    take N screenshots MS apart (to look at animations)
  js:CODE           evaluate JavaScript in the page
  log               print the view and key state
Set FIRM_HEADED=1 to watch it play in a visible Chrome window.
"""
import json, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1].parent
URL = (ROOT / 'apps' / 'game' / 'dist' / 'dev.html').as_uri()
ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']


def main():
    out, size, steps = sys.argv[1], sys.argv[2], sys.argv[3:]
    w, h = map(int, size.split('x'))
    mobile = w < 900
    os.makedirs(out, exist_ok=True)
    with sync_playwright() as p:
        headed = os.environ.get('FIRM_HEADED') == '1'
        b = p.chromium.launch(args=ARGS, channel=os.environ.get('FIRM_BROWSER', 'chrome'), headless=not headed, slow_mo=60 if headed else 0)
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2 if mobile else 1, has_touch=mobile, is_mobile=mobile)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.add_init_script("try { localStorage.setItem('firm:tutorialDone', 'true'); localStorage.setItem('firm:tips', JSON.stringify(['moves','fraud','heat40'])); } catch (e) {}")
        pg.goto(URL)
        view = lambda: pg.evaluate('__firm.view ? __firm.view() : {screen: __firm.screen}')

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

        until(lambda: pg.evaluate('!!window.__firm && !!__firm.screen'))
        pg.wait_for_timeout(600)

        def click(name):
            until(lambda: pg.evaluate(f'!!__firm.rect({name!r})'), 8)
            r = pg.evaluate(f'__firm.rect({name!r})')
            if not r:
                raise RuntimeError(f'no rect {name}; view={view()}')
            x, y = r['x'] + r['w'] / 2, r['y'] + r['h'] / 2
            if mobile:
                pg.touchscreen.tap(x, y)
            else:
                pg.mouse.move(x, y)
                pg.mouse.down(); pg.wait_for_timeout(40); pg.mouse.up()
            pg.wait_for_timeout(150)

        def settle():
            until(lambda: not view().get('busy'), 30)
            pg.wait_for_timeout(200)

        def day():
            settle()
            v = view()
            if v.get('overlay') == 'cashout':
                click('continue'); settle(); v = view()
            if v.get('overlay') == 'quarter':
                click('plan0'); settle(); v = view()
            if v.get('phase') == 'dead':
                return False
            click('cta'); settle()
            for _ in range(8):
                v = view()
                if v.get('overlay') != 'payout':
                    break
                s = pg.evaluate('__firm.state')
                amt = s['queue'][0]['amount']
                if s['cash'] - amt >= s['payroll']['amount'] * 0.5:
                    click('pay')
                elif pg.evaluate('!!__firm.rect("deny0")'):
                    click('deny0')
                else:
                    click('stall')
                settle()
            v = view()
            if v.get('phase') == 'draft' and v.get('shop'):
                s = pg.evaluate('__firm.state')
                prices = pg.evaluate('__firm.prices()')
                best = None
                for i, pr in enumerate(prices):
                    if pr <= s['cash'] - 60 and (best is None or pr < prices[best]):
                        best = i
                if best is not None:
                    click(f'offer{best}'); pg.wait_for_timeout(300)
                    if view().get('placing'):
                        click(f"slot{pg.evaluate('__firm.firstEmpty()')}")
                if view().get('shop') and not view().get('placing'):
                    click('skip')
                settle()
            return True

        for st in steps:
            kind, _, arg = st.partition(':')
            if kind == 'seed':
                pg.evaluate(f"__firm.go('firm', {{ mode: 'random' }})")
                until(lambda: pg.evaluate("__firm.screen === 'firm'"))
                pg.wait_for_timeout(400)
                pg.evaluate(f'__firm.load({int(arg)})')
                pg.wait_for_timeout(500)
            elif kind == 'title':
                pg.evaluate("__firm.go('title')"); pg.wait_for_timeout(800)
            elif kind == 'click':
                click(arg)
            elif kind == 'day':
                day()
            elif kind == 'days':
                for _ in range(int(arg)):
                    if not day():
                        break
            elif kind == 'wait':
                pg.wait_for_timeout(int(arg))
            elif kind == 'shot':
                pg.screenshot(path=f'{out}/{size}-{arg}.png')
            elif kind == 'film':
                name, ms, n = arg.split(':')
                for k in range(int(n)):
                    pg.screenshot(path=f'{out}/{size}-{name}-{k:02d}.png')
                    pg.wait_for_timeout(int(ms))
            elif kind == 'js':
                print(json.dumps(pg.evaluate(arg)), flush=True)
            elif kind == 'log':
                s = pg.evaluate('__firm.state')
                print(json.dumps({'view': view(), 'day': s['day'], 'cash': s['cash'], 'payroll': s['payroll'], 'trust': s['trust'], 'heat': s['heat']}), flush=True)
        if errs:
            print('ERRORS:', *errs[:20], sep='\n  ')
        b.close()


if __name__ == '__main__':
    main()
