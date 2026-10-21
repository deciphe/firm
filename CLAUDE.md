# FIRM — project instructions for Claude Code

FIRM is a mobile-first roguelike in the style of Luck be a Landlord and Balatro. It ships as a web game
first (playable from a link), then as iOS and Android apps via Capacitor, all from one codebase.

The player runs a prop firm. A 5x4 grid holds trader and staff cards. Each day one tap prints a market
candle (chop, trend up, trend down, news); every card reacts, fees come in, some traders move toward a
payout. The player may buy 1 of 3 cards per day with cash. Payroll is due every 5 days and grows x1.55 per cycle;
missing it ends the run. Big payouts trigger the Payout Desk (pay / stall / deny with an excuse card) and
the Payout Interview (a 20-second inspection). Two meters: Trust and Heat. Score = peak valuation.

Full design doc: https://claude.ai/code/artifact/9f2260ca-7868-483c-9cac-4bc6dfb5cff3
When the doc and this file disagree, ask the user.

## Stack

- TypeScript (strict) everywhere. pnpm workspaces. Node 20+.
- Engine: Phaser 3.90.0 (WebGL). The published page loads it from cdnjs
  (`https://cdnjs.cloudflare.com/ajax/libs/phaser/3.90.0/phaser.min.js`); local builds use the vendored copy in
  `apps/game/vendor/` with types in `apps/game/vendor/types/`. Phaser is a global; do not import it.
- Everything renders in-engine: background paint-swirl shader (`src/engine/shaders.ts`), a light screen
  finish (faint scanlines, vignette; no curvature or colour fringe at rest: the user found them blurry),
  springy cards (`src/engine/card.ts`), UI kit (`src/engine/ui.ts`), the whole game scene (`src/engine/scene.ts`).
  The canvas runs at device pixel ratio. Layout is in fixed design units (1600x900 table on computers,
  430-wide portrait on phones, height follows the phone); the camera zooms the design to fit any window
  and the paint swirl fills the rest. `__firm.rect()` returns CSS px for clicking.
- Sound is synthesised with Web Audio (`src/juice.ts`). Card art is generated pixel sprites (`src/pixel.ts`).
- esbuild bundles the game (`apps/game/build.mjs`) into `dist/firm.html` (published) and `dist/dev.html` (local).
- Tests: `node:test` via `tsx --test`. `apps/game/shoot.py` plays the game through real canvas clicks
  (`__firm.rect(name)`, `__firm.view()`) and screenshots every key state.
- Capacitor to wrap the web build as iOS and Android apps (later phase).

## Architecture

```
firm/
  packages/sim/    pure TypeScript game rules engine. NO Phaser, NO DOM, NO browser APIs.
  packages/bots/   headless bot players + balance runner (CLI, runs in Node)
  apps/game/       Phaser client. Renders sim state, sends player actions. No game rules here.
  design/          design tokens, sprite sources, screenshot audits
```

- The sim is deterministic: every run comes from a seed. Same seed + same actions = same run, everywhere.
- All randomness goes through one seeded RNG passed in. Never `Math.random()`, never time, in the sim.
- Game state is immutable data; each day is `state = resolveDay(state, action)`. This makes replays,
  the Daily Tape, bug reports and tests trivial.
- Cards are data-driven (one definition per card: id, rarity, tags, effect). Adding a card should not
  require touching the engine.
- The game exposes a debug hook in dev builds (`window.__firm`) to load a seed, jump to a day or force a
  state, so Playwright can screenshot any situation directly.

## Build order (do not skip ahead)

1. `sim`: grid, candle, 12 traders, 8 staff, payroll, Payout Desk, seeded RNG, full test coverage.
2. `bots`: 4 bots (always-pay, always-deny, max-greed, random). Runner plays 10,000 seeded runs and
   prints days-survived distribution per bot. Balance targets: no-synergy starter dies ~day 15-20; a strong
   build reaches day 40+; no single bot dominates.
3. Ugly playable: plain rectangles and text in a phone-sized portrait canvas. Must be fun as squares.
4. Design system + real UI.
5. Juice: candle print, coin rattle, counter on fire, payout card flip, screen shake, sound.
6. Content and hooks: ~40 traders, 25 staff, 15 items, the Stack, rivals, crises, founders, Daily Tape,
   death card.
7. Capacitor wrap for iOS and Android; store builds.

## Quality bar (every change)

- `tsc --noEmit` clean in strict mode. ESLint clean. Prettier applied.
- `pnpm test` all green (node:test). Every card effect has a unit test.
- Balance runner re-run after any change to numbers or card effects; report the before/after.
- Small commits with clear messages. Never commit secrets.

## Visual self-audit loop (required for any UI change)

You must look at what you build before calling it done.

1. `node apps/game/build.mjs && python3 apps/game/shoot.py` opens the game at phone sizes 390x844 and
   360x640 and uses the debug hook to reach each key state: start, placing, fee pops, draft, payout, death.
2. Take a screenshot of each state and look at it. For animations, take a sequence of frames.
3. Keep the visual regression suite green: `python apps/game/regress.py` (still mode: no swirl motion,
   sway or grain; baselines in `design/baseline/`, diffs in `design/baseline/diff/`). After an intended
   visual change, look at the diffs, then `--update`. `apps/game/play.py` plays the game step by step.
4. Audit every screenshot against this list, then fix and re-shoot until it passes:
   - Matches the colour tokens at the top of `apps/game/index.template.html`.
   - Every number is tabular monospace and right-aligned; nothing jitters as it ticks.
   - Readable at arm's length on the small phone size; tap targets at least 44x44 px.
   - Primary action reachable by one thumb in the bottom third of the screen.
   - One focal point per screen. Juice only on money moments.
   - Text contrast meets WCAG AA on the dark background.
5. Save before/after screenshots in `design/audits/` with a one-line note on what changed and why.

## Balance results

Hard mode is the design: every decision counts from day 1. Hires cost cash (common $40, uncommon $85,
rare $160, excuse $45), rerolls cost $20 and rise $10 each time in the same shop. Start cash $120, first
payroll $760, payroll grows x1.6 per cycle. Latest 10,000-game run per bot is in `design/balance-v5.txt`
(`pnpm bots`, runs on every core in ~2.5 min; `pnpm --filter @firm/bots trace SEED BOT` logs one run).

Scoring is Balatro's: traders pay fees (blue chips) in reading order, then every card with a mult effect
fires in reading order (+Mult adds, xMult multiplies). Trust sets the starting mult. Take = fees x mult,
minus chargebacks. Rare cards are one of a kind on the book. `expectedTake`/`previewPlacement` score a grid
with the real rules (bots and the placement preview both use them). Every tunable number is in `BALANCE`.
Targets: careless play dies at the first payroll (~day 5), always-pay ~10, always-deny ~15, smart ~20
with best runs past 40. No cheap strategy may match smart play on days survived.

## Run structure

Title → Open a Firm (founder + stake) → the table. Every payroll ends in a full-screen cash-out receipt,
then the quarter briefing: the crisis now or coming (every 3rd cycle) and a choice of 3 quarter plans
(Steady always on offer). Death card → New Run / Change Firm / Menu. The Rolodex files every card met.
Founders, stakes, crises and plans live in `packages/sim/src/run.ts`; unlocks and records in
`apps/game/src/engine/meta.ts`. `apps/game/shoot_screens.py` screenshots every screen.

## Look and feel

Balatro's table, in the Flat MASSIVE language with Claude's warmth.
- Hierarchy (most important first): Payroll hero (amount, days left, cash vs need), Trust and Heat gauges,
  a small Today receipt (fees x mult), Valuation. Left run panel, the Book in the centre under a market
  strip (last candles + next odds), excuses and The Wire on the right, one big action at the bottom, a
  shop that slides up after every day. Phone stacks the same pieces in that order.
- Palette: ink #080809 background, cream paper #eeeae2 cards, muted #aaa499, restrained gold #d8c38f
  (money, payouts), platinum #c9ccd1 (staff, trust), bronze #b0805a (heat), Claude clay #d97757 for the
  main action and the mult box, soft steel blue #86a9d4 for the fees box.
- Type: Manrope everywhere (loaded from Google Fonts; Inter is the local fallback), tabular numbers.
- Background: Balatro-style flowing paint swirl in ink, deep felt green and clay, chunky pixels, CRT finish.
  Every card's art is a chunky 24x24 pixel sprite (outlined, lit top-left) on its own coloured, striped
  tile (`src/pixel.ts`; silhouettes come from the shape library in `src/stipple.ts`). No cartoon faces.
  (The user rejected the old stippled-dot art on 2026-10-21: it read as weird dots.)
- Juice: cards sway, jump and pop blue fee chips and clay mult chips in order; the boxes bump; Today
  catches fire on record days; payout cards flip and get stamped. Juice only on money moments.

## Content rules

- All firms, people, platforms and directories in game are fictional. Never use a real firm's name or logo.
- Fraud is flagged by behaviour (shared devices, IPs, cards, wallets, timing), never by nationality or ethnicity.
- No real money, no loot boxes, no paid boosts, no ads during runs. Free beta; later a one-time
  "Series A" unlock when the player first hits a valuation milestone.
