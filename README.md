# River Stakes

A riverside card salon: fixed-limit Texas Hold'em played for pride, not money.
Three.js presentation with a fully usable semantic HTML layer on top, a
deterministic rules engine, and an authoritative zero-dependency Node server
for hosted tables.

## Run

```bash
npm start          # serves the game + hosted-play server on :8080 (PORT env to change)
# then open http://localhost:8080/
```

Any static file server works for solo play (hosted tables need `server.js`).

## Test

```bash
npm test           # node --test: evaluator, engine, replay determinism, content, server, render smoke
```

## Modes

- **Learn** — six interactive lessons; each teaches one rule and makes you perform it.
- **Journey** — 40 authored stages up the river (every 5th is a mastery test), star ratings.
- **Daily** — one shared seed per UTC day (server-time synchronized), identical deals for everyone.
- **Practice** — selectable difficulty/seats, undo and hints allowed, unranked.
- **Challenge** — constrained variants: move limits, speed targets, short stacks, no preflop folding.
- **Hosted table** — private rooms by 5-letter code; the server is the authority; reconnect + chat.

## Controls

Mouse/touch, or keyboard: `F` fold · `C`/`X` check/call · `B`/`R` bet/raise · `A` all-in ·
`Enter` confirm · `Esc` pause · `U` undo (practice) · `H` hint · `S` skip/fast-forward AI.
Full keyboard operation, visible focus, aria-live announcements, reduced-motion and
high-contrast options, color-vision palettes, text sizes, left-handed tray.

## Architecture

```
js/rules/    pure deterministic engine: rng (seeded streams), cards, evaluator,
             engine (immutable commands, tick, legal-action API, snapshots), ai
js/session.js  local orchestration: AI seats, undo, replay envelopes + verification
js/content.js  versioned content: 5 themes, tutorial, 40-stage journey, challenges,
             daily generator, achievements, offline validator
js/render.js   Three.js riverside salon (dynamic import; game fully playable without it)
js/ui.js       semantic HTML screens/HUD, responsive layouts, accessibility mirror
js/audio.js    procedural WebAudio (buses, seeded variants, ambience, adaptive music)
js/platform.js host integration with offline fallback (time sync, saves, boards)
js/main.js     bootstrap + application controller
server.js      zero-dep Node: static files, /api/v1/time, hand-rolled WebSocket rooms
docs/contracts.md  binding cross-module API contracts
```

Chips are always integers; scores are formatted only in presentation. Rules state is
serializable and hash-chained; replays (`Session.verifyReplay`) reproduce identical
state hashes from seed + command list. Hosted play never trusts the client: the server
runs the engine, scrubs hidden cards per viewer, and rejects duplicates idempotently.

## Packaging

`starhermit.txt` declares `name=River Stakes`, `launch=index.html`, `server=server.js`.
Three.js r160 is vendored in `vendor/` — no network needed at runtime.
