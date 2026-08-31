# Known Issues — River Stakes

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on spark105 (OBLITERATED Q5_K_M),
alongside the game's own unit tests, a headless-Chrome crawl, and live WebSocket/HTTP probes
against a running `server.js`.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 80/80 pass (`node --test`, includes the two-client WebSocket suite) |
| `node --check` on all modules | clean (8 modules + 5 rules modules + `server.js`) |
| `tests/e2e.mjs` (headless Chrome) | not present — `tests/render-smoke.test.js` covers the no-WebGL path; an ad-hoc CDP crawl was run instead (see below) |

Ad-hoc headless-Chrome coverage: boot with 0 console errors, Daily-challenge and Journey mode
entry, a table played through hint/undo/pause/resume/"Next hand", and a 70-click random UI crawl
(0 errors).

## Confirmed defects

Defects below were each verified by reading the source, not just reported by the model.

### 1. Every snapshot leaks `state.seed`, so any seated player can read all hole cards

- **File:** `js/rules/engine.js:569-580` (`getSnapshot`), dealing at `js/rules/engine.js:446-448`
- **Trigger:** Join any hosted table and read the `snapshot` message.
- **Behaviour:** `getSnapshot` deliberately redacts the sensitive fields — other players' `cards`,
  the `deck`, and `rngState`:

  ```js
  const s = structuredClone(state);
  if (!reveal) { for (const p of s.players) if (p.id !== viewerId) p.cards = null; }
  s.deck = [];
  s.rngState = null;
  ```

  but it leaves `s.seed` in place, and the shuffle is derived from nothing else:

  ```js
  const rng = new Rng(s.seed, 'rules');
  rng.setState(s.rngState);      // hand 1: the state produced by new Rng(seed,'rules')
  s.deck = rng.shuffle(newDeck());
  ```

  Any client can therefore recompute the exact deck and read every opponent's hole cards and the
  whole board before it is dealt.
- **Expected:** spec.md §Determinism, replay, and security — hidden information must not reach
  clients; the redaction of `cards`/`deck`/`rngState` shows this is the intent.
- **Evidence:** Two clients driven against the live server (port 39507). Bob's snapshot hides
  Alice's cards, yet the deck reconstructed from the leaked seed contains them:

  ```
  seed present in B's snapshot: 123456789
  deck redacted: []   rngState redacted: null
  Alice cards as seen by Bob: null
  reconstructed deck head: 6c Qs 7d Jc 6s 7s
  Alice REAL hole cards: Qs Jc
  Bob   REAL hole cards: 6c 7d
  positions of those 4 cards inside the reconstructed deck: 1,3,0,2
  ```

### 2. The room creator can choose the shuffle seed

- **File:** `server.js:273`
- **Trigger:** Send `{"op":"create","config":{"seed":123456789, …}}`.
- **Behaviour:**

  ```js
  seed: Number.isInteger(config.seed) ? (config.seed >>> 0) : randomInt(0x100000000),
  ```

  A client-supplied seed is accepted verbatim. Combined with defect 1 this lets the creator
  pre-compute a deck offline and pick a seed that deals them a favourable hand — a stronger
  attack than merely observing the leak.
- **Expected:** The seed must be server-generated for hosted play (as `royal-circuit` does with
  `crypto.randomInt`), or accepted only for explicitly-labelled practice tables.
- **Evidence:** The run above created the room with `config.seed = 123456789` and the snapshot
  echoed exactly that value.

### 3. Score and achievement submissions target routes the server does not implement

- **File:** `js/platform.js:157`, `js/platform.js:186`, `js/platform.js:200`;
  route table at `server.js:684-686`
- **Trigger:** Finish a ranked round, or unlock an achievement, in hosted mode.
- **Behaviour:** The client posts to `/api/v1/achievements` and `/api/v1/boards`, and fetches
  `/api/v1/boards/<id>`. `handleHttp` serves only `/api/health` and `/api/v1/time` and 404s every
  other `/api/` path. `_post` swallows the failure (`catch { return null; }`), so global boards
  and durable achievements silently never work; only the localStorage copies survive.
  This is not a "no host present" situation: `Platform.create` (`js/platform.js:45-50`) decides it
  is in **hosted** mode when `/api/health` answers `{ok:true}`, which the bundled `server.js` does
  (`server.js:684`). Every hosted-only call therefore fires and every one of them 404s.
- **Expected:** spec.md §Achievements and leaderboards — "Provide global and friends-filtered
  boards… validate score claims through a lightweight authoritative script".
- **Evidence:** Live probes against the running server:

  ```
  GET  /api/health          -> {"ok":true}     (so the client goes hosted)
  GET  /api/v1/time         -> 200
  POST /api/v1/boards       -> 404
  GET  /api/v1/boards/…     -> 404
  POST /api/v1/achievements -> 404
  POST /api/v1/presence     -> 404
  POST /api/v1/telemetry    -> 404
  POST /api/v1/activity/start -> 404
  ```

  The same 404s appear unprompted in the browser during a normal Daily-challenge session:
  `404 http://127.0.0.1:39507/api/v1/presence` and `404 http://127.0.0.1:39507/api/v1/activity`.

### 4. A `null` value in localStorage bricks the app on load

- **File:** `js/platform.js:104-110` (`loadJSON`), consumed at `js/platform.js:163`
- **Trigger:** `localStorage['riverstakes.progress.v1'] = 'null'` (e.g. a truncated write, another
  tab, or manual corruption), then reload.
- **Behaviour:** `loadJSON` guards a missing key and a *throwing* parse, but `JSON.parse('null')`
  succeeds and returns `null`, so `loadProgress()` returns `null` and
  `return this.loadProgress().achievements || {};` throws. Boot aborts — the page renders no
  buttons at all until storage is cleared by hand.
- **Expected:** spec.md §Loading and resilience — "Cache immutable hashed assets and the last safe
  local snapshot"; a corrupt snapshot must degrade to defaults. The fix is
  `const v = JSON.parse(raw); return (v && typeof v === 'object') ? v : fallback;`
- **Evidence:** Headless run over five corruption payloads; only `null` fails:

  ```
  corrupt="{\"broken\":"   booted=true  errors=0
  corrupt="null"           booted=false errors=1
      EXC: TypeError: Cannot read properties of null (reading 'achievements')
           at Platform.achievements (…/js/platform.js:163:31) at App._refreshCaches …
  corrupt="[]"             booted=true  errors=0
  corrupt="{}"             booted=true  errors=0
  corrupt="not json at all" booted=true errors=0
  ```

### 5. Chat panel has no block/report hooks

- **File:** `js/ui.js:1560-1650` (chat panel construction and rendering)
- **Trigger:** Open the chat panel in a hosted room.
- **Behaviour:** The panel is collapsible, tracks unread state and rate-limits the composer at
  10/min — but `grep -rn -i "block\|report" js/ index.html css/` finds no moderation affordance of
  any kind, on either the panel or an individual message.
- **Expected:** spec.md:199 — "Text chat belongs in a collapsible, moderated panel with
  **block/report hooks**, unread state, a 10-message-per-minute-aware composer, and no chat over
  critical controls."
- **Evidence:** The empty grep; the chat panel source contains only toggle, list, form and
  counter elements.

### 6. Table size allows 2-6 seats; the spec says 2-4

- **File:** `js/rules/engine.js:98`, `js/content.js:595`, mode copy at `js/ui.js:54`, `56`, `57`, `58`
- **Trigger:** Open any mode card, or create a practice/hosted table with 5 or 6 seats.
- **Behaviour:** The engine and the content validator both accept up to six players:

  ```js
  if (!Array.isArray(config.players) || config.players.length < 2 || config.players.length > 6) {
    throw new Error('need 2..6 players');          // js/rules/engine.js:98-100
  }
  ```

  and the UI advertises the same range — Journey, Practice and Challenge all read
  `players: '2–6 seats vs AI'`, hosted reads `'2–6 players'`.
- **Expected:** `spec.md:6` — "**Players:** 2–4 players depending on ruleset, plus practice AI."
  Either the bound should be 4 or the spec header is out of date; as shipped, the product does not
  match its own stated player range.
- **Evidence:** The quoted engine bound, the identical bound at `js/content.js:595`, and the four
  UI strings. Flagged by the model review and confirmed by reading both sides.

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
