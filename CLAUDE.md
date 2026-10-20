# FIRM — project instructions for Claude Code

FIRM is a mobile-first roguelike in the style of Luck be a Landlord and Balatro. It ships as a web game
first (playable from a link), then as iOS and Android apps via Capacitor, all from one codebase.

The player runs a prop firm. A 5x4 grid holds trader and staff cards. Each day one tap prints a market
candle (chop, trend up, trend down, news); every card reacts, fees come in, some traders move toward a
payout. The player drafts 1 of 3 cards per day. Payroll is due every 5 days and grows x1.5 per cycle;
missing it ends the run. Big payouts trigger the Payout Desk (pay / stall / deny with an excuse card) and
the Payout Interview (a 20-second inspection). Two meters: Trust and Heat. Score = peak valuation.

Full design doc: https://claude.ai/code/artifact/9f2260ca-7868-483c-9cac-4bc6dfb5cff3
When the doc and this file disagree, ask the user.

## Stack

- TypeScript (strict) everywhere. pnpm workspaces. Node 20+.
- Rendering: plain DOM + CSS for the board and cards, canvas for pixel sprites, Web Audio for synthesised
  sound, Web Animations for juice. Decided over Phaser: a 20-tile card game gains nothing from an engine and
  loses crisp text, small downloads and easy phone layouts. Add an engine later only for an effect DOM can't do.
- esbuild bundles the game into one self-contained HTML page (`apps/game/build.mjs`).
- Tests: `node:test` via `tsx --test`. Playwright (Python) drives `apps/game/shoot.py` for screenshot audits.
- Capacitor to wrap the web build as iOS and Android apps (later phase).
- Web build deploys to Cloudflare Pages.

## Architecture

```
firm/
  packages/sim/    pure TypeScript game rules engine. NO Phaser, NO DOM, NO browser APIs.
  packages/bots/   headless bot players + balance runner (CLI, runs in Node)
  apps/game/       web client. Renders sim state, sends player actions. No game rules here.
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
3. Keep a Playwright visual regression suite (`toHaveScreenshot`) for every key state so later changes
   can't silently break a screen.
4. Audit every screenshot against this list, then fix and re-shoot until it passes:
   - Matches design tokens in `design/tokens.ts` (no stray colours, sizes or spacing).
   - Every number is tabular monospace and right-aligned; nothing jitters as it ticks.
   - Readable at arm's length on the small phone size; tap targets at least 44x44 px.
   - Primary action reachable by one thumb in the bottom third of the screen.
   - One focal point per screen. Juice only on money moments.
   - Text contrast meets WCAG AA on the dark background.
   - Pixel art stays pixel-perfect (`image-rendering: pixelated`, integer scaling, no blur).
5. Save before/after screenshots in `design/audits/` with a one-line note on what changed and why.

## Balance results

Latest 10,000-game run per bot is in `design/balance-v1.txt`. Targets: careless play dies ~day 15,
always-pay ~20 (goes broke), always-deny ~25 (Trust collapse), smart ~35 with a tail past 60.

## Look and feel

Pixels for things, crisp type for numbers. Traders, staff, candles and the death card are chunky
pixel art (32x32 sprites, 16-colour palette, readable by silhouette). Prices, P&L, payroll and the feed are
sharp monospace like a perp-DEX order book. Near-black background with a green-blue tint; one mint
accent for money in, one hot red for money out and danger. Bold pixel font for headings, used sparingly.
Motion is fast (120-200 ms). Jane Street restraint everywhere except money moments.

Placeholder sprites may be generated in code. Final sprite art and sound will come from a human artist;
keep sprites in `design/sprites/` with a consistent naming scheme so they can be swapped without code changes.

## Content rules

- All firms, people, platforms and directories in game are fictional. Never use a real firm's name or logo.
- Fraud is flagged by behaviour (shared devices, IPs, cards, wallets, timing), never by nationality or ethnicity.
- No real money, no loot boxes, no paid boosts, no ads during runs. Free beta; later a one-time
  "Series A" unlock when the player first hits a valuation milestone.
