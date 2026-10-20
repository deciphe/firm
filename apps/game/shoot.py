"""Screenshot audit: drives the game through its key states at two phone sizes."""
import sys, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/firm/design/audits'
URL = 'file:///home/claude/firm/apps/game/dist/dev.html'
SIZES = [(390, 844), (360, 640)]

def run(p, w, h):
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2, has_touch=True, is_mobile=True)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(URL); pg.wait_for_timeout(600)
    pg.evaluate('__firm.load(1234)')
    pg.wait_for_timeout(200)
    pg.screenshot(path=f'{OUT}/{w}-1-start.png')
    # play two days through the real UI
    for _ in range(2):
        pg.click('#btn-tap'); pg.wait_for_timeout(3200)
        if pg.is_visible('#payout:not([hidden])'):
            pg.click('#po-pay') if pg.is_enabled('#po-pay') else pg.click('#po-stall'); pg.wait_for_timeout(900)
        if pg.is_visible('.offer'):
            pg.click('.offer >> nth=0'); pg.wait_for_timeout(150)
            if pg.is_visible('#grid.placing'):
                pg.screenshot(path=f'{OUT}/{w}-2-placing.png')
                pg.click('.tile.empty >> nth=0'); pg.wait_for_timeout(400)
    # mid-tap: catch the fee pops
    pg.click('#btn-tap'); pg.wait_for_timeout(1250)
    pg.screenshot(path=f'{OUT}/{w}-3-pops.png')
    pg.wait_for_timeout(2600)
    if pg.is_visible('#payout:not([hidden])'):
        pg.click('#po-pay') if pg.is_enabled('#po-pay') else pg.click('#po-stall'); pg.wait_for_timeout(900)
    pg.screenshot(path=f'{OUT}/{w}-4-draft.png')
    # force a payout request
    pg.evaluate('''() => { __firm.load(77); const s = __firm.state; s.grid[7].progress = 10; s.cash = 900; s.excuses = ['terms','kyc','glitch']; __firm.set({grid: s.grid, cash: s.cash, excuses: s.excuses}); }''')
    pg.click('#btn-tap'); pg.wait_for_timeout(4200)
    pg.screenshot(path=f'{OUT}/{w}-5-payout.png')
    # death card
    pg.evaluate('''() => { __firm.set({phase:'dead', cause:'payroll', shortBy:212, day:34, stats: {...__firm.state.stats, peakValuation: 14220, payoutsPaid: 17, payoutsDenied: 2, fraudCaught: 1}}); __firm.showDeath(); }''')
    pg.wait_for_timeout(500)
    pg.screenshot(path=f'{OUT}/{w}-6-death.png')
    overflow = pg.evaluate('document.documentElement.scrollWidth > window.innerWidth')
    b.close()
    return errs, overflow

with sync_playwright() as p:
    for w, h in SIZES:
        errs, overflow = run(p, w, h)
        print(w, 'errors:', errs[:5], 'h-overflow:', overflow)
