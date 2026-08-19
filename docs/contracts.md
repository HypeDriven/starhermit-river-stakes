# River Stakes — Module Contracts (binding)

All modules are **ES modules, zero npm dependencies**. Client code must not import Node APIs.
`server.js` is Node ESM (`package.json` has `"type":"module"`) and imports the rules engine directly.
Three.js is vendored at `vendor/three.module.js` (r160) and imported ONLY by `js/render.js`
via dynamic `import()` with a try/catch fallback.

Read `spec.md` (root) for product context. This file defines the exact cross-module APIs.
Do not deviate from the signatures below; if something is impossible, implement the closest
thing and flag the deviation in your final report.

---

## js/version.js (already written by lead)

```js
export const BUILD_VERSION = '1.0.0';
export const ENGINE_VERSION = 1;
export const SAVE_VERSION = 1;
export const STORAGE = {
  settings: 'riverstakes.settings.v1',
  profile:  'riverstakes.profile.v1',
  progress: 'riverstakes.progress.v1',
  boards:   'riverstakes.boards.v1',
  snapshot: 'riverstakes.snapshot.v1',
};
```

---

## js/rules/rng.js

Seeded deterministic randomness (mulberry32 core). No `Math.random` anywhere in rules/session/content.

```js
export function seedFromString(str)          // string -> uint32 (FNV-1a)
export function stableStringify(value)       // deterministic JSON (object keys sorted recursively)
export function stateHash(value)             // -> 16-char hex string (cyrb53 of stableStringify)
export class Rng {
  constructor(seed /*uint32*/, stream = 'rules')   // stream name mixed into seed
  next()       // float in [0,1)
  int(n)       // integer 0..n-1
  range(lo, hi)// integer lo..hi inclusive
  shuffle(arr) // in-place Fisher–Yates, returns arr
  pick(arr)    // random element
  fork(stream) // new Rng derived from current state + stream name
  getState()   // -> {seed, stream, calls}  (JSON-safe)
  setState(s)  // restore
}
```

## js/rules/cards.js

A card is an **int 0..51**: `rank = 2 + (c % 13)` (2..14, 14=Ace), `suit = (c / 13) | 0`
(0=spades ♠, 1=hearts ♥, 2=diamonds ♦, 3=clubs ♣).

```js
export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = ['s', 'h', 'd', 'c'];
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
export function rankOf(c), suitOf(c)
export function cardToString(c)      // e.g. 'Ah', 'Td'
export function cardFromString(s)    // inverse; throws on bad input
export function newDeck()            // [0..51]
```

## js/rules/evaluator.js

7-card (works for 5–7 cards) Texas Hold'em evaluation. Pure.

```js
export const HAND_NAMES = ['High Card','One Pair','Two Pair','Three of a Kind',
  'Straight','Flush','Full House','Four of a Kind','Straight Flush'];
export function evaluate(cards /*int[5..7]*/)
// -> { category /*0..8*/, tiebreak /*number[] desc ranks, lexicographic*/,
//      name /*string*/, chosen /*int[5] the actual cards*/ }
export function compareEval(a, b)    // -1 | 0 | 1  (category then tiebreak)
// Wheel straight A-2-3-4-5 must be handled.
```

## js/rules/engine.js  — fixed-limit Texas Hold'em, 2–6 players

Betting structure: preflop/flop bet = bigBlind, turn/river = 2×bigBlind; max 4 bets per
round (1 bet + 3 raises). All-in for less than a full bet is allowed and does NOT count
toward the 4-bet cap. Side pots computed at settlement. Heads-up: dealer posts SB and
acts first preflop.

```js
import { ENGINE_VERSION } from '../version.js';

export function createGame(config) -> state
// config: {
//   seed /*uint32*/, smallBlind /*int*/, bigBlind /*int*/,
//   players: [{ id, name, chips /*int starting stack*/, ai: null|'easy'|'normal'|'hard' }],
//   maxHands: int|null            // terminal after this many hands (standings by chips)
// }

export function legalActions(state, playerId) -> Action[]
// Action = { type:'fold'|'check'|'call'|'bet'|'raise'|'allin'|'advance', amount? /*call:chips to add; bet/raise: total round bet*/ }
// Returns [] when terminal or not this player's turn / phase not actionable.
// In phases 'init' and 'handEnd', every still-in player gets [{type:'advance'}].

export function applyCommand(state, command) -> result
// command: { id /*string, unique*/, tick /*int, must === state.tick*/, playerId, type, amount? }
// result: { ok:true, state /*NEW object (input not mutated)*, events:Event[] }
//       | { ok:false, error:{ code, message } }
// error codes: 'BAD_TICK','BAD_PHASE','NOT_YOUR_TURN','UNKNOWN_PLAYER','ILLEGAL_ACTION',
//              'BAD_AMOUNT','GAME_OVER','MALFORMED'
// On success state.tick increments by 1. Amounts are ALWAYS integers of chips.

export function getSnapshot(state, viewerId) -> stateCopy
// Deep clone; other players' `cards` replaced with null unless phase is 'showdown'|'handEnd'|'terminal'.

export function serialize(state) -> string        // JSON
export function deserialize(str) -> state         // validates + migrates older v (v1: no-op path exists)
export function hashState(state) -> string        // stateHash(state)
export function potTotal(state) -> int
export function summarize(state) -> { terminal, standings, statsByPlayer, handsPlayed }

export const PHASES = ['init','preflop','flop','turn','river','showdown','handEnd','terminal'];
```

### State shape (plain JSON, no class instances, no undefined)

```js
{
  v: ENGINE_VERSION,
  seed, tick, handNumber /*0 until first advance*/, phase,
  config: { smallBlind, bigBlind, maxHands },
  players: [ { id, name, seat, chips, cards /*[int,int]|null*/, bet /*committed this round*/,
               totalBet /*this hand*/, status:'active'|'folded'|'allin'|'out',
               isAI, lastAction /*string|null*/ } ],
  dealer /*seat idx*/, currentActor /*seat idx|null*/,
  toCall /*chips current actor must add*/, currentBet /*highest bet this round*/,
  betsThisRound /*for the 4-bet cap*/, lastAggressor /*seat idx|null*/,
  community /*int[]*/, deck /*int[]*/, deckPos,
  rngState /*Rng getState() of the rules stream*/,
  pots: [] /*populated at settlement: [{amount, winners:[ids], handName}]*/,
  showdown: null /*| [{playerId, evalResult}]*/,
  winners: null /*| [playerIds of last settled hand]*/,
  terminal: null /*| { reason:'lastPlayerStanding'|'maxHands',
                      standings:[{id,name,chips,place}], championId }*/,
  stats: { [playerId]: { handsWon, showdownsWon, potsWon /*chips*/, folds, betsRaises, bestHand /*name*/ } },
  log: [] /*strings, newest last, cap 40*/
}
```

### Events (for render/audio/UI; plain objects)

`{type:'handStart', handNumber, dealer}` · `{type:'post', playerId, amount, kind:'sb'|'bb'}` ·
`{type:'deal'}` · `{type:'action', playerId, action, amount}` ·
`{type:'street', phase, cards}` · `{type:'showdown', hands:[{playerId, name, evalResult}]}` ·
`{type:'award', pots:[{amount, winners:[ids], handName}]}` · `{type:'eliminated', playerId}` ·
`{type:'handEnd', handNumber}` · `{type:'terminal', terminal}`

### Flow
- Phase 'init' after createGame; `advance` (any player) shuffles (rules Rng stream), rotates
  dealer, eliminates broke players, posts blinds, deals → 'preflop' (or straight to showdown
  runout if ≤1 player can act — must still be deterministic).
- Betting round ends when all non-folded/non-allin players have matched currentBet and acted.
- If all but one fold → pot awarded immediately (no showdown event), phase 'handEnd'.
- Showdown: evaluate all live hands, split side pots (odd chips to earliest seat from dealer).
- After 'handEnd': maxHands reached or ≤1 player with chips → 'terminal' + event.
- Engine must never hang: any sequence of legal commands terminates.

## js/rules/ai.js

```js
import { Rng } from './rng.js';
export function chooseAction(state, playerId, difficulty /*'easy'|'normal'|'hard'*/, rng) -> command
// command: { id:'ai-'+state.tick+'-'+playerId, tick: state.tick, playerId, type, amount? }
// Must ONLY pick from legalActions(state, playerId). Deterministic given (state, rng).
// 'advance' phases: return advance command.
// easy: random-leaning calling station. normal: hand-strength heuristic (preflop table +
// evaluator postflop). hard: adds pot-odds-ish thresholds, position, seeded bluffs.
```

---

## js/session.js — local game orchestration

```js
import { createGame, applyCommand, legalActions, getSnapshot, hashState } from './rules/engine.js';
import { chooseAction } from './rules/ai.js';

export class Session {
  constructor(opts)
  // opts: { config /*engine config*/, mode /*string*/, allowUndo /*bool*/,
  //         aiDelay /*ms, default 600*/, autoAdvance /*bool: auto-send advance after handEnd delay*/,
  //         humanId /*default players[0].id*/, onSnapshot(snap, view), onEvents(events), onTurn(isHuman) }
  start()                       // createGame + emit snapshot
  dispatch(type, amount?)       // human command; builds {id,tick,...}; counts invalid attempts
  legal()                       // legalActions(currentState, humanId)
  snapshot()                    // getSnapshot(state, humanId)
  undo()                        // only if allowUndo and a prior human decision point exists -> bool
  canUndo() -> bool
  skip()                        // flush all pending AI timers, settle to current deterministic state NOW
  pause() / resume()            // pauses AI timers (solo backgrounding rule)
  summary()                     // { stats, handsPlayed, invalidActions, elapsedMs, terminal, goalsContext }
  exportReplay() -> envelope    // below
  static verifyReplay(envelope) -> { ok, finalHash, error? }   // replays all commands vs hashes
  dispose()
}
// Replay envelope: { schema:1, build:BUILD_VERSION, seed, config, createdAt,
//   commands:[{id,tick,playerId,type,amount}] /*incl. AI commands*/,
//   hashes:[hashState after each command], result /*terminal|null*/ }
// AI commands are recorded in the envelope, so replay verification does not re-run AI.
// Internally keeps full state history (states are immutable) for undo + autosave of last safe snapshot.
```

## js/content.js — versioned content data

No imports from render/ui. May import engine only for validation helpers (keep light).

```js
export const CONTENT_VERSION = 1;
export const THEMES = [ {id, name, desc, palette:{...css + felt/table/river colors}, unlock:'default'|{journey:n}|{achievement:key}} ];  // exactly 5
export const TUTORIAL = [ {id, title, body /*html-safe text*/, config /*engine config vs passive AI*/,
                           goal /*what the player must do*/, steps:[{text, requireAction? /*'call'|'raise'|...*/, requireEvent? /*event type*/, hint(fn(state,legal)->string)}]} ];
export const JOURNEY = [ ... ];   // >= 40 stages, ordered; every 5th is mastery:true
// stage: { id:'j01', index, title, desc, seed /*uint32*/, theme /*theme id*/,
//          config /*engine config*/, par /*hands*/, mastery /*bool*/,
//          goals:[{type, ...}] , teaches /*string|null*/, unlocksTheme? }
// goal types: 'winMatch' (finish 1st), 'chipsAtLeast'{amount}, 'winHands'{count},
//             'winShowdowns'{count}, 'surviveHands'{count}, 'finishTop'{place}
export const CHALLENGES = [ ... ]; // >= 6 constrained variants
// { id, title, desc, seed, theme, config, constraint /*{type:'moveLimit'|'speedTarget'|'shortStack'|'noFoldPreflop', ...}*/,
//   goals:[...], par }
export function dailyForDate(utcDate /*'YYYY-MM-DD'*/) -> { id, date, seed, theme, config, goals, par }
// seed derived deterministically from the date string. Same date => identical object.
export function evaluateGoals(goals, summary /*Session.summary()*/, humanId) -> { passed:bool, results:[{goal, ok, detail}] }
export function validateAll() -> { errors: string[] }   // structural validation of all content
```

## js/platform.js — host integration with offline fallback

```js
export class Platform {
  static async init() -> Platform
  // Detects host: same-origin /api reachable => 'hosted', else 'local'. Reads launch token
  // from window.__LAUNCH_TOKEN__ if present; NEVER persists tokens to storage.
  get mode()              // 'hosted' | 'local'
  async serverNow()       // round-trip-adjusted server time via GET /api/v1/time; Date.now() fallback
  async utcToday()        // 'YYYY-MM-DD' using serverNow
  loadJSON(key, fallback) / saveJSON(key, value)     // localStorage-backed, version-checked
  // settings/profile/progress convenience wrappers using STORAGE keys
  async unlockAchievement(key)  // idempotent; local store in local mode
  achievements() -> {key: unlockedAtTs}
  async submitScore(boardId, entry) // entry:{value, ruleset, contentVersion, seed, assists, durationMs}; local boards in local mode
  async getBoard(boardId, {friendsOnly}={}) -> [entries]
  presenceStart(details) / presenceStop()   // throttled heartbeats in hosted mode; no-op locally
  activityStart(mode) / activityEnd()       // playtime pairing; no-op locally
  telemetry(event, data) // only: 'start','tutorial_step','round_end','retry','settings_change','error'; no-op without consent
}
export class HostedClient {
  // WebSocket to same-origin /ws. JSON messages.
  constructor({ name })
  async connect() -> { playerId, serverTime }
  createRoom(config) / joinRoom(code) / rejoin(sessionId, token)
  setReady(ready) / sendCommand(command) / sendChat(text) / leave()
  on(op, fn) // ops: 'lobby','started','snapshot','chat','result','whileAway','error','closed'
}
// Protocol messages: client->server {op:'hello'|'create'|'join'|'rejoin'|'ready'|'cmd'|'chat'|'leave', ...}
// server->client {op:'welcome'|'lobby'|'started'|'snapshot'|'chat'|'result'|'whileAway'|'error', ...}
// 'snapshot': {op, snapshot /*viewer-scrubbed*/, events, tick}
```

---

## js/audio.js — fully procedural WebAudio (no asset files)

```js
export class AudioSystem {
  constructor(settings /*{volumes:{master,music,sfx,ambience,voice}, muted}*/)
  unlock()                       // call on first user gesture; creates/resumes AudioContext
  setVolume(bus, v0to1) / setMuted(bool)
  play(name, {seed}={})          // 'click','card','chips','check','fold','raise','win','lose',
                                 // 'turn','error','notify','eliminated' — short synthesized transients,
                                 // seeded pitch/variant selection
  mapEvents(events)              // engine Event[] -> sounds
  startAmbience(themeId) / stopAmbience()   // quiet river/salon noise bed (filtered noise)
  startMusic(mode /*'menu'|'game'|'results'*/) / stopMusic()  // simple adaptive procedural loop
  suspend() / resume()           // page visibility
}
```

## js/render.js — Three.js presentation (dynamic import, graceful fallback)

```js
export class Renderer {
  static async create(canvas, opts) -> Renderer | null
  // opts: { theme, quality:'low'|'medium'|'high', reducedMotion:bool }
  // Returns null if WebGL/three unavailable (UI must remain fully usable without it).
  setTheme(themeObj)            // re-skins materials; themes are data (palette) from content.js
  setQuality(q)                 // shadows/particles/renderScale/dpr caps; never alters readability
  setReducedMotion(b)
  showSnapshot(snap, viewerSeat)// rebuild/update: seats, stacks, cards, community, pot, dealer button,
                                // acting-player highlight. Pure function of snapshot (idempotent).
  playEvents(events, {fast}={}) // cosmetic animation per event hierarchy; fast=true settles instantly
  resize()                      // reads canvas client size + dpr cap
  setPaused(bool)               // hidden tab: stop rAF loop
  dispose()
  debugInfo() -> { drawCalls, triangles, quality }
}
// Scene: riverside card salon — oval table w/ felt, 2–6 seat positions (camera behind viewer's seat),
// card meshes w/ procedural canvas faces, cylinder chip stacks sized by count, pot mound, dealer
// button, river + far bank + railing backdrop, key light + soft fill + contact grounding,
// bounded pooled particles only for showdown/award tier. Deterministic decorative seed per theme.
// Separate layers: environment(0), gameplay(1), selection(2), fx(3). FX never raycastable.
// Cards clickable is NOT required (DOM action buttons are the control layer).
```

## js/ui.js — semantic HTML UI over/beside canvas

```js
export class UI {
  constructor(root /*#ui*/, controller /*see below*/, opts /*{strings?}*/)
  showScreen(name, data?)
  // 'title'|'modes'|'setup'|'game'|'results'|'journey'|'challenges'|'achievements'|
  // 'settings'|'help'|'profile'|'lobby'|'daily'
  updateGame(view)
  // view: { snapshot, legal:[Action], isYourTurn:bool, objective /*string*/, progress /*string*/,
  //         mode, canUndo, hint /*string|null*/, seatedYou /*player obj*/ }
  showEvents(events)            // toasts + action feed entries
  announce(msg, assertive=false)// aria-live
  showResults(data)             // { headline, breakdown:[{label,value}], progress, achievements:[keys], comparison, canRetry, canNext }
  lobbyUpdate(lobby)            // hosted roster/readiness/chat
  applySettings(settings)       // text size, contrast, palette, handedness, reduced motion
  setTheme(themeObj)            // CSS custom properties
}
// Controller methods the UI may call (implemented by main.js):
// play(mode, options) · action(type, amount?) · advance() · undo() · hint() ·
// pauseToggle() · leaveToTitle() · retry() · nextStage() · selectJourney(id) · selectChallenge(id) ·
// selectDaily() · saveSettings(patch) · setTheme(id) · profileSave({name}) ·
// hostedCreate(config) · hostedJoin(code) · hostedReady(b) · hostedChat(text) · hostedLeave() ·
// dismissResults() · tutorialAck()
```

UI requirements: real `<button>`s; headings hierarchy; two aria-live regions (polite status +
assertive errors); focus trap + restore for every modal; keyboard shortcuts during play
(F fold · C/X check/call · R/B bet/raise · A all-in · Enter confirm · Esc pause · U undo · H hint);
raise amount chosen via slider/stepper within legal min/max; responsive: ≥1024px three-column
(center table, left objective rail, right action/status rail), 640–1023 collapsible drawers,
<640 portrait bottom thumb-zone action tray + sheet panels; safe-area-inset padding everywhere;
min 44×44px targets; no hover-only info; labels must survive 30% text expansion (flex-wrap, no
fixed widths on buttons). All colors paired with icons/text (never color-only). CSS implements the
5 themes via `data-theme` attribute custom properties. All user-facing strings through one
`STRINGS` object at top of ui.js (English only, but structured for later i18n).

## js/main.js — lead writes this; do not create

App state machine `boot → title → mode-select → setup → game(active↔paused) → results → progression`,
wiring Session/HostedClient ↔ UI ↔ Renderer ↔ AudioSystem ↔ Platform, journey progress
persistence (stars per stage), daily flow, tutorial flow, challenge flow, achievements.

---

## server.js — zero-dependency Node (>=20) ESM

- Static file server for the distribution (correct MIME for .html/.js/.css/.txt/.md).
- `GET /api/v1/time` → `{ "now": <ms epoch> }`.
- `GET /api/health` → `{ "ok": true }`.
- WebSocket endpoint `/ws` (hand-rolled RFC 6455: handshake, text frames, ping/pong, close;
  masked client frames; no extensions). Must handle fragmentation at least for small messages
  (or reject fragmented frames cleanly) and cap message size (64 KiB).
- Room manager: 5-char codes; room = { code, config, state /*engine*/, socketsByPlayer, tokens,
  chatLog, createdAt }. Server runs the authoritative engine from `js/rules/engine.js`.
  - On 'cmd': validate membership + apply via engine; broadcast viewer-scrubbed snapshots +
    events. Reject duplicates idempotently by command id (track per-player last command ids).
  - AI seats in hosted rooms run server-side via `js/rules/ai.js` (setTimeout loop).
  - Disconnect: mark player away, keep seat 10 min; 'rejoin' with token gets fresh snapshot +
    'whileAway' summary (missed log lines).
  - Chat relay: 10 msgs/min/player cap, 240-char cap, broadcast.
  - Room ends → broadcast 'result' with terminal; idle rooms GC'd after 30 min.
- `export function createServer(port)` for tests; `if (import.meta.url === ...)` main guard
  listening on `process.env.PORT || 8080`.

## Tests (node:test, run with `npm test` → `node --test tests/`)

Required minimum:
- `tests/evaluator.test.js` — every category, wheel straight, tie-breaks, kicker cases.
- `tests/engine.test.js` — legal actions per phase, invalid-action codes, blinds, side pots
  (3-way all-in), fold-to-win, showdown split, maxHands terminal, serialization round-trip,
  tick/BAD_TICK, heads-up blind order.
- `tests/replay.test.js` — same seed+commands ⇒ identical hash chain (property-ish: 20 random
  seeds × random legal playouts via AI); fuzz malformed commands (no throw, no hang, 2000 cmds).
- `tests/content.test.js` — validateAll() passes; daily determinism; ≥40 journey stages.
- `tests/server.test.js` — start server on ephemeral port, two WebSocket clients create/join/
  play a few commands/chat, duplicate command id rejected idempotently. (Node 22 has global WebSocket.)

## Coding standards
- No TypeScript, no build step, no external packages. JSDoc on exported functions.
- Immutable engine: `applyCommand` deep-clones state (structuredClone) then mutates the clone.
- All chips are integers. Never use floats for chips.
- Files should carry a one-line header comment: `// River Stakes — <module purpose>`.
