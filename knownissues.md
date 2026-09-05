# Known Issues — River Stakes

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on spark105 (OBLITERATED Q5_K_M),
alongside the game's own unit tests, a headless-Chrome crawl, and live WebSocket/HTTP probes
against a running `server.js`.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 80/80 pass (`node --test`, includes the two-client WebSocket suite) |
| `node --check` on all modules | clean (8 modules + 5 rules modules + `server.js`) |
| `tests/e2e.mjs` (headless Chrome) | PASS (exit 0) — desktop full 24-hand practice match to results + Hint/Undo/Pause, and mobile Learn lesson; `E2E PASS — river-stakes, desktop + mobile, no page errors` |

Ad-hoc headless-Chrome coverage: boot with 0 console errors, Daily-challenge and Journey mode
entry, a table played through hint/undo/pause/resume/"Next hand", and a 70-click random UI crawl
(0 errors).

## Resolved

Fixed 2026-09-04 (re-verified against the current source; defects re-confirmed, then patched).

### 1. Every snapshot leaks `state.seed`, so any seated player can read all hole cards

- **Status:** FIXED — `js/rules/engine.js:580` — `getSnapshot` now sets `s.seed = null`
  alongside the existing `deck = []` / `rngState = null` redaction. The deck is
  deterministic from the seed, so keeping the seed in the snapshot let a client
  recompute every hole card. The client's hint assist still functions: it seeds
  its suggestion RNG from `snap.seed` (`js/main.js:529`), which now degrades to
  `snap.tick`; the hint is heuristic and does not affect the authoritative AI
  play (driven independently by the session's `config.seed`).
- **Verified:** `getSnapshot` returns `seed === null`, `deck: []`, `rngState: null`,
  opponent cards `null`, own cards intact (targeted node probe + `npm test`).

### 2. The room creator can choose the shuffle seed

- **Status:** FIXED — `server.js:274` — `createRoom` now always uses
  `seed: randomInt(0x100000000)` and no longer honours a client-supplied
  `config.seed`, so the creator cannot pre-compute a favourable deck.
- **Verified:** no `config.seed` reference remains in `server.js`; `npm test`
  (two-client WebSocket suite) passes.

### 3. Score and achievement submissions target routes the server does not implement

- **Status:** ALREADY RESOLVED in current source (the QA doc was stale). Commit
  `a02311d1 "platform: probe /api/v1/time only; make optional host routes local
  no-ops"` replaced the old behaviour: `Platform` now probes `/api/v1/time`
  (not `/api/health`) and `_post()` (`js/platform.js:77-79`) is a no-op returning
  `null`, so nothing is ever sent to `/api/v1/boards`, `/api/v1/achievements`,
  `/api/v1/presence`, `/api/v1/activity` or `/api/v1/telemetry`. `getBoard` is
  local-only. Only the `/api/v1/time` probe is issued as a real fetch.
- **Verified:** grep shows every non-`/api/v1/time` `/api/` call funnels through
  the no-op `_post`; no stray direct `fetch(\`/api/...\`)` remains.

### 4. A `null` value in localStorage bricks the app on load

- **Status:** FIXED — `js/platform.js:113` — `loadJSON` now validates the parsed
  value: `return (v && typeof v === 'object' && !Array.isArray(v)) ? v : fallback;`,
  so `JSON.parse('null')` returns the fallback instead of `null`, and
  `achievements()` / `boards` no longer dereference `null`.
- **Verified:** targeted probe loads `'null'`, `'[]'`, and malformed strings and
  returns the fallback without throwing; `achievements()` returns `{}`; `npm test`.

## Confirmed defects still open

The following remain unaddressed. Each was re-examined against the current source;
see the notes on why they were not patched (feature/`cosmetic` scope, not run-time defects).

### 5. Chat panel has no block/report hooks

- **Status:** NOT FIXED (feature gap, not a reproducible run-time defect). The
  panel (`js/ui.js:1562-1647`) still implements only toggle/list/form/counter
  plus a 10/min rate limit — all the other spec sub-requirements are met — but
  there is no per-message **block** or **report** affordance. A correct report
  hook needs a host moderation route to deliver to, and this repo's `server.js`
  exposes no such endpoint; adding a client-side block/report UI that cannot
  route a report would be a cosmetic stub. Treating this as out-of-scope for a
  minimal defect fix.

### 6. Table size allows 2-6 seats; the spec says 2-4

- **Status:** NOT FIXED (spec/implementation divergence; ambiguous expected). The
  code is internally consistent — the engine (`js/rules/engine.js:98`) and the
  content validator (`js/content.js:595`) both accept 2-6, and the Daily mode
  legitimately seats 1 human + 1-4 AI (2-5; `js/content.js:485`). Lowering the
  engine bound to 4 would break the Daily table layout and the server's seat
  filler (`server.js:376`, up to 6). The spec's `spec.md:6` "2–4 players
  depending on ruleset" is the imprecise part; "depending on ruleset" already
  carves out this case. Not patched because either fix would contradict another
  part of the codebase / the "Expected" itself offers an either/or.

## Suspected — not confirmed

### 1. Server relays chat as plain text and relies on every client escaping it

- **File:** `server.js:637`
- **Concern:** `// NOTE: text is relayed as plain text; clients MUST HTML-escape before rendering.`
  The bundled client is safe — `_chatRender` (`js/ui.js:1634-1646`) builds nodes with the `text`
  attribute, which sets `textContent`, and `el()` only uses `innerHTML` for an explicit `html`
  key. But the contract is enforced by convention, not by the server.
- **Why unconfirmed:** No injection is possible through the shipped client, so this is a
  hardening concern rather than a demonstrated defect.

### 2. Uncontested (everyone-folded) hands still reveal every hole card

- **File:** `js/rules/engine.js:571` (`reveal` flag) with the uncontested-award path at
  `js/rules/engine.js:218-234`
- **Concern:** When all but one player folds, `awardUncontested` sets `s.phase = 'handEnd'`
  (`js/rules/engine.js:226`) without a showdown. `getSnapshot` then treats `handEnd` as a reveal
  phase, so every seat's hole cards — the winner's, which real poker lets them muck, and the
  folders' — are broadcast to everyone. That is live strategic information about opponents'
  ranges for the rest of the session.
- **Why unconfirmed:** The behaviour is documented as intentional in the function's own comment
  (`js/rules/engine.js:563`: "unless the hand is at showdown/handEnd/terminal"), and spec.md does
  not state a mucking rule, so this may be a deliberate simplification rather than a bug.

## Investigated and rejected

### "Missing Score-chase mode"

An earlier draft of this pass flagged `js/ui.js:340`
(`MODE_ORDER = ['learn','journey','daily','practice','challenge','hosted']`) for lacking a
Score-chase mode. **That is wrong for this game.** River Stakes' own `spec.md` §Modes lists
"**Hosted play:** private invitations and appropriate public matching, with reconnect and
authoritative results" as the sixth mode, not Score chase (the Score-chase wording belongs to
other games' specs in this repo). The implemented mode set matches the spec exactly.

### Model claim: `DAILY_OPPONENTS` breaks the 2-6 player validation

The model review claimed the 8-entry `DAILY_OPPONENTS` pool (`js/content.js:468-471`)
violates the `players.length < 2 || players.length > 6` check at `js/content.js:595`.
**This is false.** `dailyForDate` never seats the whole pool — `js/content.js:485` is
`const opponents = rng.shuffle([...DAILY_OPPONENTS]).slice(0, rng.range(1, 4));`, so a daily
table has one human plus one to four opponents, i.e. 2-5 seats. `content.test.js` validates
every generated daily and passes.

## Checked, no defects found

- Mode entry: Daily challenge and all 40 Journey stages list correctly, stage 1 enters a live
  table with the full action bar (Fold / Call / Raise / All in / Undo), and hands play out
  through fold, call, check and "Next hand" with zero console errors.
- `js/rules/engine.js`, `evaluator.js`, `cards.js`, `ai.js`, `rng.js`: hand evaluation, betting
  rounds, blinds and heads-up ordering, all-in runouts, side pots, serialization/migration and
  state hashing — 80 tests pass, including deterministic replay and an AI property suite.
- `server.js` message handling: seat binding (`command.playerId` is overwritten from the bound
  seat, `server.js:608`), turn and tick checks, idempotent duplicate command ids, chat rate limit,
  64 KiB message cap, rejoin tokens, abandon timers, and a manual-advance/auto-advance race — all
  covered by passing tests and confirmed by reading.
- Static file serving: traversal outside `ROOT` is rejected (`server.js:694-696`).
- UI: 70 random clicks across title, mode cards, table HUD, chat, results and settings produced
  zero console errors.
- Persistence: four of the five corrupt-storage payloads are handled cleanly (see defect 4 for
  the fifth).
- No `Math.random` in the rules modules; `js/rules/ai.js:52` explicitly documents "seeded rng (any
  stream; never Math.random)".

## Not tested

- `js/render.js` (63 KB) visual output beyond the no-WebGL smoke test; headless SwiftShader cannot
  judge the acceptance criteria in spec.md §4.
- Hosted play with 3-6 seats and reconnect-under-load; only the 2-seat path was driven manually
  (the bundled test suite does exercise a 3-seat room with an AI).
- Touch and gamepad input.
