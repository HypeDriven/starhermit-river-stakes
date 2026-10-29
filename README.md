# River Stakes

A riverside card salon: fixed-limit Texas Hold'em played for pride, not money.
A StarHermit engine script game (engine 1.24.0): a starhermit:scene salon under a
starhermit:ui interface, over a deterministic rules engine. Played natively by the
StarHermit client and in browsers by the engine's web runtime.

## Run

```bash
starhermit .            # the StarHermit runtime (STARHERMIT=~/sh/runtime/1.24.0/…/starhermit)
npm run package         # after every change: the web loader index.html + starhermit-files.json
```

## Test

```bash
npm test                # node unit tests + tests/native.mjs (tsc, starhermit check, play scripts)
npm run test:browser    # the packaged game in GPU Chrome at desktop, phone and landscape
npm run css             # tools/ui-style.css → assets/ui-style.json
```

## Modes

- **Learn** — six interactive lessons; each teaches one rule and makes you perform it.
- **Journey** — 40 authored stages up the river (every 5th is a mastery test), star ratings.
- **Daily** — one shared seed per UTC day, identical deals for everyone.
- **Practice** — selectable difficulty/seats, undo and hints allowed, unranked.
- **Challenge** — constrained variants: move limits, speed targets, short stacks, no preflop folding.

## Controls

Pointer/touch on the action tray, or keys: `F` fold · `C`/`X` check/call · `B`/`R` bet/raise ·
`A` all-in · `Esc` pause · `U` undo · `H` hint · `S` skip ahead · `←`/`→` move between actions.
Gamepads are mapped too; keys and pads rebind in the runtime's Options.

## Architecture

```
js/rules/      pure deterministic engine: rng, cards, evaluator, engine, ai
js/session.js  AI seats, undo, replay envelopes (injectable clock)
js/content.js  themes, tutorial, 40-stage journey, challenges, daily generator, achievements
js/progress.js the save document, merge (js/merge.js), old-save and settings migration
native/        the engine client: main.ts (flow), screens.ts + hud.ts (UI), table3d.ts (salon),
               audio.ts, platform.ts, style.ts, quality.ts, i18n.ts
score-script.js  platform script: range-checks posted high scores
server.js      dev-only node server (static files, WebSocket relay; not packaged)
```

See `spec.md` for the full specification.
