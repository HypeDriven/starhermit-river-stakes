# River Stakes — Product and Game Specification

**Document status:** running specification of the game as built: a StarHermit engine script game (TypeScript on the host API, engine 1.28.0, host API 1.30, engine.minor 30).  
**Game index:** 86  
**Genre:** Turn-based card strategy  
**Players:** 1 player against 1–5 AI seats (2–6 seats)  
**Targets:** the StarHermit client (native) and browsers (the engine's web runtime): desktop, phones and tablets, portrait and landscape  
**Rendering:** a starhermit:scene riverside salon under a starhermit:ui interface (seats, cards, rails, tray and every screen are UI widgets; the 3D table, cards and chips are the visual hero behind them)

## 0. On the StarHermit engine

### Implementation
- `starhermit.txt`: `launch=index.html` (the engine's web loader, written by `npm run package` with `starhermit-files.json`), `engine.entry=native/main.ts`, `engine.version=1.28.0`, `engine.minor=30`, `engine.capabilities=platform,storage,clipboard`, the `control.*` keys and `engine.gamepad.*` defaults below, `server=score-script.js`.
- Pure game modules (shared with the node tests, unchanged from the browser build but where noted): `js/rules/` (fixed-limit Hold'em engine: immutable commands, legal actions, snapshots, hash chain; the AI; the evaluator; seeded streams; state clones are JSON copies), `js/session.js` (AI seats, undo, replay envelope; its timers and clock are injectable), `js/content.js` (five themes, six lessons, the 40-stage Journey, six Challenges, the Daily generator, goals, achievements), `js/merge.js`, `js/progress.js` (the save document and its merge, the old cloud slot, the game's options), `js/strings.js` + `js/lang.js` + `js/sh-i18n.js` (localization).
- Engine client: `native/main.ts` (the screen flow, modes, actions, constraints, lessons, results, the fixed-step clock, lifecycle), `native/screens.ts` (title, modes, setup, Daily, Journey, Challenges, achievements, profile, How to play, Settings, results, the pause menu and its panels), `native/hud.ts` (the table's HUD, seats and cards, tray), `native/table3d.ts` (the salon), `native/audio.ts`, `native/platform.ts`, `native/style.ts` (tokens per theme, palette and contrast), `native/quality.ts`, `native/i18n.ts`, `native/game.ts` (types over the js modules).
- Time is the runtime's fixed steps (60 Hz): the AI's 650 ms delays, the 1.8 s automatic deals, speed-challenge clocks, elapsed time and toasts run on a clock advanced 1/60 s per step, so slow frames never change a table and play scripts replay exactly. Practice tables are seeded from the platform clock and a counter.

### Controls
- Keys (rebindable in the runtime's Options): F fold · C / X check or call (whichever is legal) · B / R bet or raise · A all in · U undo (when allowed) · H hint · Esc pause / close the top panel · ← / → move between the action buttons · S skip ahead to your next decision (the AI's turns settle at once). Enter or Space presses the focused button; Tab moves the focus.
- Gamepad defaults: the D-pad or left stick moves the UI focus and South presses; LeftTrigger folds, West checks or calls, North bets or raises, RightTrigger goes all in, the shoulders step through the action buttons, Start pauses, Select undoes, LeftStickPress asks for a hint, RightStickPress skips ahead.
- Pointer and touch: every action is a button in the tray; the rails' drawers open from the top bar on narrower windows (a tap outside closes them). The Hint button toggles the hint, or shows it while held ("Hold to peek").

### Screens and layouts
- Title (Play, Daily challenge, Journey, Profile, Settings, How to play, Invite a friend when signed in, Sign in with StarHermit for guests) → Choose your table (Learn, Journey, Daily, Practice, Challenge cards) → Set up (rules summary, ranked note, difficulty and seats for Practice, assists; Learn lists the six lessons) → Journey grid / Challenges / Daily (date, seed, par, goals, the board's standings when signed in) / the table ⇄ Pause (Resume, Settings, How to play, Leave table with a confirmation) → Results (headline, breakdown, stars and goals, achievements, par comparison, the leaderboard line, the recommendation; Retry, Next, Back to title). Profile (table name for guests or the account name, save status, lifetime stats, achievements).
- The table: the turn banner and Pause on top; the left rail (objective, progress, the shortcut bar), the right rail (hand and street, pot, current bet, to call, the last six feed lines); seat panels ringed round the table zone (the viewer at the bottom, the next seat on the viewer's left; dealer, folded, all-in and out badges; chips; the cards; the last action; the acting seat glows); the pot line and community cards in the centre; one toast line; the tray (the hint, the raise stepper — fixed limit makes the legal amount the only one, so it is shown disabled — the legal actions, Undo, Hint; mirrored for the left-handed tray).
- Layouts by the window's logical size: wide (≥ 1024 px: both rails), compact (640–1023 px: Objective and Table info drawers), phone (< 640 px: a compact top bar, the tray as a thumb-zone sheet with buttons sharing each row), short landscape (≤ 520 px tall: the status rail inline at the right, the Objective drawer). The runtime's UI scale replaces ui-scale.js on large screens.

### Settings
- The runtime's Options own volumes and mute, graphics quality and the frame-rate limit, the language, text size, high contrast, reduced motion and key / pad rebinding (Settings links to them: Open Options, Key bindings).
- The game's own settings (engine `settings`, synced with the account): Theme (the five themes; locked ones say how they unlock), Color palette (Default, Deuteranopia-safe, Tritanopia-safe), Left-handed action tray, Hint button behavior (Tap to toggle / Hold to peek), Shortcuts (the shortcut bar; also hidden from the bar itself), Replay tutorial.

### Graphics
- The salon is render.js's on starhermit:scene: the authored perspective shot with drift, award shake and the results push-in; the lathed table with felt and brass inlay; procedural canvas card faces and theme-coloured backs on ShapeGeometry cards (flipped, dealt and tucked); instanced chip stacks; nameplates; dealer button; the acting ring and glow; the win ring and spray; deck, railing, lanterns (halos, flicker, point lights); the river (the old GLSL shimmer as WGSL); far banks, trees, sky dome, fog, fireflies. Themes re-skin it.
- From three.js r160: punctual, hemisphere and ambient light intensities ÷ π; `new RoomEnvironment(renderer)` prefiltered by PMREM when detailed, given to each lit material as its envMap at its old envMapIntensity (r160 scaled the scene environment per material); ACES tone mapping. The composer is the runtime's post: GTAO (radius 0.35, 8/16 samples), UnrealBloom 0.45 / 0.35 / 0.92 (r160 model), the colour grade (smoothstep S-curve 0.18, saturation 1.08, split toning, vignette 0.2) and FXAA / SMAA / MSAA.
- Quality tiers (`frame().quality`) map to gfx.js's presets and budgets: Low (Lambert, no shadows or post, 128 px cards, 256 px felt, 32-segment river, low particles, plain detail), Balanced (Standard, 1024 shadows, bloom, grade, FXAA, 256 px cards, detailed), High (Physical cards and lacquered chips, 2048 shadows, GTAO, SMAA, two lantern lights), Ultra (4096 shadows, full-resolution GTAO and bloom, 512 px cards, 1024 px felt, 128-segment river, MSAA). Confetti and fireflies scale up to 1.5× within a tier by the level. Render scale, the pixel-ratio cap, adaptive resolution and the frame-rate readout are the runtime's.
- The detailed chips are two instanced meshes (rim and face) per denomination, since an InstancedMesh takes one material (render.js gave one instanced cylinder three).
- Cards and panels in the UI: the old DOM cards are drawn widgets (ranks, suits, a corner diamond on red suits, the striped back; lacquered when not on Low).

### Sound
- The authored clips (`sfx/*.opus`, `sfx/manifest.json`) per game event (audio.js mapEvents), loaded one at a time once the mixer runs; UI clicks on the interface bus. The generative music (menu, table, results: pentatonic pad and pluck random walk) and the river ambience (lowpassed brown noise with droplets and bird-like blips, seeded per theme) are rendered once into loops with the old seeds and envelopes, a slice a frame, and looped on the music bus (the runtime has no ambience bus; the ambience plays at the old ambience-to-music ratio). A hidden window silences them.

### Saves, platform and leaderboards
- The save is the engine save (`saves`, schema 1): `{ v, progress: { journey: { stars, unlocked }, lifetime, tutorial, challenges, achievements, daily }, boards, profile: { name } }` — the document the browser build mirrored to the cloud slot `game:<slug>`. Two devices' saves merge (`js/merge.js`: best stars, furthest unlock, every lesson and challenge, earliest achievement times, larger counters, the better best hand, the latest streak, the union of personal-best boards). The browser build's cloud slot shows as a foreign save: it is merged in and replaced once. Guests' old browser localStorage cannot be read (accepted).
- The browser build's settings KV groups (`graphics.theme`, `accessibility.palette` / `leftHanded` / `hintMode`, `ui.shortcutHints`) are adopted as the game's settings unless set since; then the old groups are removed.
- Signed in, a finished ranked table (Daily, Challenge) posts the player's final chips through a practice session whose `score-script.js` range-checks them to the `high-score` board (integer, higher is better, 0–1,000,000; as the JS SDK's submitScores did); the results show "Posting score…", then the rank, posted or not posted. The Daily screen lists the board's top ten. Daily results are also kept on the local personal-best board `daily:<date>`. Achievements stay in the save (no platform unlock path).
- The Daily's UTC day comes from the platform clock (`serverNow()`) when it has answered, else the device's.
- There is no multiplayer in the client: hosted tables are not offered (the repo's `server.js` is the dev-only node server with its own WebSocket relay, used by its tests; it is not packaged). With no hosted play, no result is refereed by a server script beyond the high-score range check.

### Localization
- Every player-facing string in nine locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) from `js/strings.js` (English keys; en-GB, es-ES, fr-CA list differences), in the runtime's interface language (`preferences().language`), switching live without ending a table. "River Stakes", "Hold'em" and the opponents' names stay as they are.

### Checks
- `npm test`: unit tests (rules, evaluator, replay, content, the dev server, the save model, the session on an injected clock, i18n coverage of native/*.ts) and `tests/native.mjs`: the web index up to date, `tsc` against the generated host API, `starhermit check .` with zero warnings, and the play scripts in `tests/native/` (Practice on a six-seat desktop table with the hint, pause and a retry; Learn lesson 1 by finger on a DPR-3 phone with the drawer, through to lesson 2; today's Daily sideways on a DPR-3 phone; Journey stage 1 and the Twenty Moves challenge by keys; every menu screen and the Firstlight theme).
- `npm run test:browser` (`tools/browser-play.mjs`) plays the packaged game in Chrome on the GPU at desktop (Practice to results by keys, pause), phone (lesson 1 by finger) and landscape (the Daily by finger), failing on console errors or warnings.

### Known limitations
- The browser build's per-effect graphics overrides, render scale, adaptive resolution and FPS readout are the runtime's Options (by level only).
- audio.js's synthesized fallback sounds while a clip loads are not played.
- The haptics toggle and the old in-memory telemetry ring are gone (neither had an effect on play).
- render.js's cards map their canvases through ShapeGeometry's shape-space UVs, which show mostly the card's border at this size: the 3D cards look as they did in the browser build (the UI's cards carry the faces).
- The old feed named the dealer by seat number ("?"); it now names the player.

## 1. Product vision

River Stakes is a game in which players bet through staged community cards, form the best five-card hand, and win chips by showdown or folds. Its signature setting is a tasteful riverside card salon with no real-money framing. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Bet through staged community cards, form the best five-card hand, and win chips by showdown or folds.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **post forced stakes, receive private cards, choose betting actions, reveal community stages, and settle**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Use play-only chips, fixed limits, responsible session reminders, and no cash-out or purchase of advantage. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, from the device clock.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Hosted play:** not offered in the client; a future version would use StarHermit realtime rooms (private invitations, reconnect, authoritative results).

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The 3D salon fills the window but is never the only UI. Menus, text, settings, the seats and cards, and assistive descriptions are starhermit:ui widgets over the salon.

### Responsive layouts

- **Wide desktop (≥1024 CSS px):** centered playfield, objective/progression rail on the left, contextual actions and social/status rail on the right. Maximum line length is 70 characters.
- **Compact desktop/tablet:** playfield remains central; secondary rails collapse into drawers. Pointer hover may preview but never be required.
- **Portrait mobile:** top safe-area status bar, square or perspective-fit playfield, bottom thumb-zone action tray, and sheet-based secondary panels. Never place critical controls under browser chrome or display cutouts.
- **Landscape mobile:** reserve a narrow status rail; preserve at least 44×44 CSS-pixel targets and 8-pixel separation.
- **Large screens:** the runtime's UI scale keeps the interface proportions; the full-window 3D table stays unscaled. The 3D seat ring follows the same clockwise order as the seat panels (next seat on the viewer's left).
- React to resize, orientation, device-pixel-ratio, safe-area insets, virtual keyboard, and visibility changes without losing input or restarting the round.

### Screens and overlays

- **Title/home:** Play is dominant; daily challenge, journey progress, and profile are one level below.
- **Mode setup:** show rules, expected duration, player count, assists, and whether the result is ranked before commitment.
- **Play HUD:** objective, progress, current actor/state, pause, and only context-relevant actions.
- **Pause/settings:** resume first; audio, graphics, controls, accessibility, help, and leave are clearly separated.
- **Results:** outcome headline, score breakdown, progress, achievements, comparison, replay/retry, and next recommended action.
- **Help:** visual rule cards generated from current control mappings and representative legal states.
- Lobby, roster, readiness, invitation, reconnect, result, and report states are first-class screens.

### Input

- Pointer/touch: raycast only against explicit interaction layers; use pointer capture for drags; cancel safely on lost capture.
- Touch: distinguish tap, drag, and camera gesture by distance/time thresholds; never require multi-touch for core play.
- Keyboard: directional navigation among legal targets, confirm, cancel, pause, undo/hint where valid, and camera reset.
- Gamepad: focus navigation, primary/secondary actions, pause, and remappable axes/buttons.
- Prevent accidental double commits with action identifiers, not arbitrary long debounce timers. Provide visible drag origin, target preview, and invalid-action explanation.

### Accessibility

- Full keyboard operation and visible focus; widget equivalents for every table control (the seats, cards and actions are UI widgets with accessible names); headings and live regions for objective, turn, score, errors, and results.
- Color is reinforced by shape, texture, icon, or label. Include contrast-safe and common color-vision palettes.
- Reduced-motion mode removes camera swoops, shake, parallax, rapid particles, and large scaling while preserving event timing.
- Independent sliders for music, effects, ambience, and voice; captions/text cues for meaningful audio; no audio-only gameplay.
- Options for larger text, high contrast, left-handed controls, hold-versus-toggle, timing assistance, haptics off, and tutorial replay.
- Announce the table state through a concise navigable model rather than describing every decorative object.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is a tasteful riverside card salon with no real-money framing. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### Scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.


### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.


### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.


## 5. Technical architecture

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands, periodic state hashes, terminal result.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- Show useful progress by asset group; load core rules/UI first and scenic assets lazily. Provide procedural low-detail substitutes if optional assets fail.
- Cache immutable hashed assets and the last safe local snapshot. Updates activate between rounds, never during one.
- Recover WebGL context by rebuilding GPU resources from retained CPU descriptors. If 3D is unavailable, present a clear compatibility message and preserve account/session state.
- Background tabs reduce rendering to zero or a low heartbeat while preserving required network lifecycle.


## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- Test pointer, coarse touch, keyboard-only, gamepad, screen reader, zoom to 200%, reduced motion, high contrast, safe areas, and both mobile orientations.
- Verify focus restoration after every modal, meaningful live announcements, no keyboard traps, and no hover-only instructions.
- Confirm all critical labels fit translated strings at 30% expansion and support right-to-left layout where localized.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Platform and network

- Test expired/rotated tokens, privacy settings, rate limits, offline start, reconnect at each game state, duplicate commands, out-of-order events, server restart, and version mismatch.
- Verify achievement idempotency, leaderboard validation, friends-only filtering, cloud-save conflict handling, activity start/end pairing, and server-time countdown accuracy.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.

