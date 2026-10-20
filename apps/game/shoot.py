"""Screenshot audit: drives the tutorial and a real run through key states at phone and desktop sizes.
Usage: python3 apps/game/shoot.py [out_dir] [sizes like 390x844,1440x900]"""
import sys
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/firm/design/audits'
SIZES = [tuple(map(int, s.split('x'))) for s in (sys.argv[2] if len(sys.argv) > 2 else '390x844,360x640,1440x900').split(',')]
URL = 'file:///home/claude/firm/apps/game/dist/dev.html'


def shot(pg, name):
    pg.screenshot(path=f'{OUT}/{name}.png')


def run(p, w, h):
    mobile = w < 900
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2, has_touch=mobile, is_mobile=mobile)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    tag = f'{w}x{h}'
    pg.goto(URL); pg.wait_for_timeout(3200)
    shot(pg, f'{tag}-01-tutorial-intro')
    def advance(until):
        for _ in range(12):
            if pg.is_visible(until):
                return
            if pg.is_visible('#g-next'):
                pg.click('#g-next')
            pg.wait_for_timeout(700)
    advance('#guide:not([hidden]) .hint:text("Tap OPEN MARKET")')
    pg.wait_for_timeout(1800)
    shot(pg, f'{tag}-02-tutorial-open-market')
    pg.click('#btn-tap'); pg.wait_for_timeout(2000)
    shot(pg, f'{tag}-03-pops')
    pg.wait_for_timeout(3500)
    advance('#guide:not([hidden]) .hint:text("Tap the Affiliate")')
    pg.wait_for_timeout(2200)
    shot(pg, f'{tag}-04-tutorial-hire')
    pg.click('.offer >> nth=0', force=True); pg.wait_for_timeout(2400)
    shot(pg, f'{tag}-05-tutorial-place')
    # a real run
    print(tag, 'tutorial ok', flush=True)
    pg.evaluate('__firm.load(1234)'); pg.wait_for_timeout(200)
    pg.set_default_timeout(6000)
    for _ in range(4):
        pg.click('#btn-tap'); pg.wait_for_timeout(5200)
        while pg.is_visible('#payout:not([hidden])'):
            pg.click('#po-pay') if pg.is_enabled('#po-pay') else pg.click('#po-stall'); pg.wait_for_timeout(1000)
        if pg.is_visible('.offer'):
            pg.click('.offer >> nth=0', force=True); pg.wait_for_timeout(150)
            if pg.is_visible('#grid.placing'):
                pg.click('.slot >> nth=0', force=True); pg.wait_for_timeout(500)
    pg.wait_for_timeout(400)
    shot(pg, f'{tag}-06-midrun')
    pg.click('#btn-tap'); pg.wait_for_timeout(5200)
    while pg.is_visible('#payout:not([hidden])'):
        pg.click('#po-pay') if pg.is_enabled('#po-pay') else pg.click('#po-stall'); pg.wait_for_timeout(1000)
    shot(pg, f'{tag}-07-draft')
    pg.evaluate('''() => { __firm.load(77); const s = __firm.state; s.grid[7].progress = 10; s.grid[6].revealed = true; s.grid[6].def = 'hedger'; s.cash = 900; s.excuses = ['terms','kyc','glitch']; __firm.set({grid: s.grid, cash: s.cash, excuses: s.excuses}); }''')
    pg.click('#btn-tap'); pg.wait_for_timeout(6200)
    shot(pg, f'{tag}-08-payout')
    pg.evaluate('''() => { __firm.set({phase:'dead', cause:'payroll', shortBy:212, day:34, stats: {...__firm.state.stats, peakValuation: 14220, payoutsPaid: 17, payoutsDenied: 2, fraudCaught: 1}}); __firm.showDeath(); }''')
    pg.wait_for_timeout(700)
    shot(pg, f'{tag}-09-death')
    overflow = pg.evaluate('document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight + 2')
    b.close()
    return errs, overflow


with sync_playwright() as p:
    for w, h in SIZES:
        errs, overflow = run(p, w, h)
        print(f'{w}x{h}', 'errors:', errs[:5], 'overflow:', overflow)
