// River Stakes on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules/), content (js/content.js)
// and session (js/session.js: AI seats, undo, replay chain) are the browser
// build's, unchanged but for the session's injectable clock; this module is
// what js/main.js did around them — the screen flow (title → modes → setup →
// Journey / Challenges / Daily / lesson list → the table ⇄ pause → results),
// starting every mode (Learn, Journey, Daily, Practice, Challenge), the
// betting actions by keys, pads, pointer and touch, the challenge
// constraints, undo, the hint, the lessons' steps, the results with goals,
// stars, achievements, the daily streak and the score post, and the
// lifecycle (a hidden window pauses the table, as visibilitychange did).
// Screens are drawn by screens.ts and hud.ts (starhermit:ui), the salon by
// table3d.ts (starhermit:scene).
//
// Time is the runtime's fixed steps: the session's AI delays (650 ms), the
// automatic deals (1.8 s), the speed challenges' clock and the toasts run on
// a clock advanced 1/60 s per fixed step, so slow frames never change a
// table and play scripts replay exactly.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import {
  Ai, Content, Engine, HAND_NAMES, ProgressModel, RngMod, createSession, type Challenge, type Config, type Constraint, type Daily,
  type GameEvent, type Goal, type GoalResult, type Legal, type Lesson, type Session, type Snapshot, type Stage, type Theme,
} from "./game.ts";
import * as audio from "./audio.ts";
import { N, S, T, chips } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as table3d from "./table3d.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export const HUMAN_ID = "you";
const OPPONENT_POOL: [string, string][] = [
  ["Moss", "easy"], ["Silt", "easy"], ["Wren", "easy"], ["Heron", "normal"], ["Reed", "normal"], ["Otter", "normal"], ["Pike", "hard"], ["Darter", "hard"],
];
const DIFFICULTY_MIX: Record<string, string[]> = {
  easy: ["easy", "easy", "easy"], normal: ["easy", "normal", "normal"], hard: ["normal", "hard", "hard"],
};

export type Screen = "title" | "modes" | "setup" | "daily" | "journey" | "challenges" | "achievements" | "profile" | "help" | "settings" | "game" | "results";
export type Modal = "pause" | "settings" | "help" | "confirm-leave";
export type Mode = "learn" | "journey" | "daily" | "practice" | "challenge";
export interface SetupOpts { mode: Mode; difficulty: string; players: number; hints: boolean; undo: boolean }
export interface Game {
  mode: Mode; config: Config; session: Session; goals: Goal[]; par: number | null; constraint: Constraint | null;
  objective: () => string; hintsEnabled: boolean; allowUndo: boolean; theme: Theme;
  options?: SetupOpts; stage?: Stage; challenge?: Challenge; daily?: Daily;
  lesson?: Lesson; lessonIndex?: number; stepIndex: number; lessonComplete?: boolean;
}
export interface Hud { snap: Snapshot; legal: Legal[]; isYourTurn: boolean; canUndo: boolean }
export interface Row { label: () => string; value: () => string }
export interface Results {
  headline: () => string; breakdown: Row[]; stars: number | null; goalsPassed: number | null; goalsTotal: number | null;
  progressText: (() => string) | null; achievements: string[]; comparison: (() => string) | null; leaderboard: boolean;
  lb: platform.Posted | null; canNext: boolean; recommendation: () => string;
}

export const app = {
  screen: "title" as Screen,
  setup: null as SetupOpts | null,
  modals: [] as Modal[],
  drawer: null as "left" | "right" | null,
  openedFrame: 0,
  focusNext: null as string | null,
  game: null as Game | null,
  hud: null as Hud | null,
  finished: false,
  hint: null as (() => string | null) | null,
  hintVisible: false,
  movesUsed: 0,
  raiseAmount: null as number | null,
  feed: [] as (() => string)[],
  toast: null as { text: () => string; until: number } | null,
  appToast: null as { text: string; until: number } | null,
  results: null as Results | null,
  nextUp: null as { lesson?: Lesson; index?: number; stage?: Stage } | null,
  daily: null as Daily | null,
  standings: null as platform.BoardRow[] | null | "loading",
  profileName: "",
};
let clockMs = 0;
export const now = (): number => clockMs;
/** A press built this frame that opened what it sits on must not act (a screen's first frame). */
export const fresh = (): boolean => frame().frame !== app.openedFrame;

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
let spokenAssertive = false;
/** ui.js announce: the live regions, one announcement a frame, joined. */
export function announce(text: string, assertive = false): void {
  if (!text) return;
  spoken.push(text);
  spokenAssertive ||= assertive;
}
function flushAnnouncements(): void {
  if (!spoken.length) return;
  const text = spoken.splice(0).join(" ").slice(0, 500);
  try { ui.announce(text, { politeness: spokenAssertive ? "assertive" : "polite" }); } catch { /* busy */ }
  spokenAssertive = false;
}
/** ui.js _toast: one consolidated notification line over the table (4 s). */
export function toast(text: () => string, assertive = false): void {
  app.toast = { text, until: clockMs + 4000 };
  announce(text(), assertive);
}
/** ui.js notify: a confirmation on any screen. */
export function notify(text: string): void {
  if (app.screen === "game") { toast(() => text); return; }
  app.appToast = { text, until: clockMs + 4000 };
  announce(text);
}
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pending.push(fn); }
export function themeById(id: string | undefined): Theme | null { return Content.THEMES.find((t) => t.id === id) ?? null; }
export function themeUnlocked(t: Theme): boolean { return ProgressModel.themeUnlocked(t, platform.save()); }
/** main.js _currentTheme: the chosen theme when unlocked, else Emberdusk. */
export function currentTheme(): Theme {
  const t = themeById(platform.options.theme);
  if (t && themeUnlocked(t)) return t;
  return themeById("emberdusk") ?? Content.THEMES[0]!;
}
/** The theme on screen: the table's while one is open, else the chosen one. */
export function shownTheme(): Theme { return app.game && (app.screen === "game" || app.screen === "results") ? app.game.theme : currentTheme(); }
export function profileName(): string {
  return platform.signedIn() ? (platform.displayName() || T("Player")) : (platform.save().profile.name || "Guest");
}

// ------------------------------------------------------------------ screens
export function show(screen: Screen, focus: string | null = null): void {
  app.screen = screen;
  app.drawer = null;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  ui.setFocus(null);
  if (screen === "daily") loadStandings();
  if (screen !== "game") announce(T("{screen} screen", { screen }));
}
export function openModal(m: Modal): void {
  if (m === "pause") {
    if (app.modals.includes("pause")) return;
    pauseToggle();
  }
  app.modals.push(m);
  app.openedFrame = frame().frame;
  ui.setFocus(null);
}
export function closeModal(): void {
  const m = app.modals.pop();
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  if (m === "pause") pauseToggle();
}
function loadStandings(): void {
  app.standings = "loading";
  void platform.standings(10).then((r) => { app.standings = r; });
}

// ------------------------------------------------------------------ modes (main.js play / select*)
export function setupMode(mode: Mode): void {
  app.setup = { mode, difficulty: "normal", players: 4, hints: true, undo: mode === "practice" };
  show("setup");
}
export function commitSetup(): void {
  const o = app.setup;
  if (!o) return;
  play(o.mode, o);
}
export function play(mode: Mode, options: Partial<SetupOpts> & { lesson?: number } = {}): void {
  if (mode === "journey") { show("journey"); return; }
  if (mode === "challenge") { show("challenges"); return; }
  if (mode === "daily") { show("daily"); return; }
  if (mode === "learn") { startLearn(lessonIndex(options.lesson)); return; }
  startPractice(options as SetupOpts);
}
function lessonIndex(lesson: number | undefined): number {
  if (lesson != null) return Math.max(0, lesson);
  const done = platform.save().progress.tutorial || {};
  const i = Content.TUTORIAL.findIndex((l) => !done[l.id]);
  return i < 0 ? 0 : i;
}
function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }
let practiceSeq = 0;
function practiceConfig(o: Partial<SetupOpts>): Config {
  // main.js seeded practice tables from the wall clock and Math.random; here from the clock and a counter
  const seed = (RngMod.seedFromString(String(Math.round(platform.nowMs())) + ":" + practiceSeq++) ^ Math.imul(practiceSeq, 0x9e3779b1)) >>> 0;
  const rng = new RngMod.Rng(seed, "practice-setup");
  const bb = 10;
  const count = Math.min(6, Math.max(2, o.players || 4));
  const mix = DIFFICULTY_MIX[o.difficulty ?? "normal"] || DIFFICULTY_MIX.normal!;
  const pool = rng.shuffle([...OPPONENT_POOL]);
  const players: Config["players"] = [{ id: HUMAN_ID, name: profileName(), chips: bb * 50, ai: null }];
  for (let i = 0; i < count - 1; i++) {
    const [name] = pool[i % pool.length]!;
    players.push({ id: "ai" + i, name, chips: bb * 50, ai: mix[i % mix.length]! });
  }
  return { seed, smallBlind: bb / 2, bigBlind: bb, players, maxHands: 24 };
}
/** A test hook: the next Practice table's seed (play scripts that need a known deal). */
export function startPractice(o: Partial<SetupOpts>): void {
  const config = practiceConfig(o);
  startLocal({
    mode: "practice", config, goals: [{ type: "winMatch" }], par: config.maxHands, constraint: null,
    objective: () => T("Win the table — practice match, unranked."), hintsEnabled: o.hints !== false, allowUndo: !!o.undo,
    theme: currentTheme(), options: { mode: "practice", difficulty: o.difficulty ?? "normal", players: o.players ?? 4, hints: o.hints !== false, undo: !!o.undo }, stepIndex: 0,
  });
}
export function startLearn(idx: number): void {
  const lesson = Content.TUTORIAL[idx];
  if (!lesson) return;
  startLocal({
    mode: "learn", config: clone(lesson.config), lesson, lessonIndex: idx, stepIndex: 0, goals: [], par: null, constraint: null,
    objective: () => `${T(lesson.title)} — ${T(lesson.goal)}`, hintsEnabled: true, allowUndo: true, theme: currentTheme(),
  });
  announce(`${T(lesson.title)}. ${T(lesson.body)}`);
  announceStep();
}
export function selectJourney(id: string): void {
  const stage = Content.JOURNEY.find((s) => s.id === id);
  if (!stage) return;
  startLocal({
    mode: "journey", stage, config: clone(stage.config), goals: stage.goals, par: stage.par, constraint: null,
    objective: () => `${stage.index}. ${T(stage.title)} — ${T(stage.desc)}`, hintsEnabled: true, allowUndo: false,
    theme: themeById(stage.theme) ?? currentTheme(), stepIndex: 0,
  });
}
export function selectChallenge(id: string): void {
  const ch = Content.CHALLENGES.find((c) => c.id === id);
  if (!ch) return;
  startLocal({
    mode: "challenge", challenge: ch, config: clone(ch.config), goals: ch.goals, par: ch.par, constraint: ch.constraint ?? null,
    objective: () => `${T(ch.title)} — ${T(ch.desc)}`, hintsEnabled: false, allowUndo: false, theme: themeById(ch.theme) ?? currentTheme(), stepIndex: 0,
  });
}
export function todaysDaily(): Daily {
  const date = platform.utcToday();
  if (!app.daily || app.daily.date !== date) app.daily = Content.dailyForDate(date);
  return app.daily;
}
export function selectDaily(): void {
  const d = todaysDaily();
  startLocal({
    mode: "daily", daily: d, config: clone(d.config), goals: d.goals, par: d.par, constraint: null,
    objective: () => T("Daily challenge for {date} — everyone plays this exact deal today.", { date: d.date }),
    hintsEnabled: false, allowUndo: false, theme: themeById(d.theme) ?? currentTheme(), stepIndex: 0,
  });
}

// ------------------------------------------------------------------ the session's clock
interface Timer { id: number; at: number; cb: () => void }
let timers: Timer[] = [];
let timerSeq = 0;
const clock = {
  now: (): number => clockMs,
  setTimeout: (cb: () => void, ms: number): number => { const id = ++timerSeq; timers.push({ id, at: clockMs + Math.max(0, ms), cb }); return id; },
  clearTimeout: (id: number): void => { timers = timers.filter((t) => t.id !== id); },
};
function runTimers(): void {
  for (let guard = 0; guard < 64; guard++) {
    let next: Timer | null = null;
    for (const t of timers) if (t.at <= clockMs && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
    if (!next) return;
    timers = timers.filter((t) => t !== next);
    next.cb();
  }
}

// ------------------------------------------------------------------ the local game (main.js _startLocalGame)
type GameInit = Omit<Game, "session">;
function startLocal(ctx: GameInit): void {
  teardown();
  app.finished = false;
  app.hint = null;
  app.hintVisible = false;
  app.movesUsed = 0;
  app.raiseAmount = null;
  app.feed = [];
  app.toast = null;
  app.results = null;
  const session = createSession({
    config: ctx.config, mode: ctx.mode, allowUndo: ctx.allowUndo, autoAdvance: true, aiDelay: 650, humanId: HUMAN_ID, clock,
    onSnapshot: (snap, view) => onSnapshot(snap, view),
    onEvents: (events) => onEvents(events),
    onTurn: (isHuman) => { if (isHuman) audio.play("turn"); },
  });
  app.game = { ...ctx, session };
  table3d.setTheme(ctx.theme);
  audio.startAmbience(ctx.theme.id);
  audio.startMusic("game");
  show("game");
  session.start();
}
function onSnapshot(snap: Snapshot, view: { legal: Legal[]; isYourTurn: boolean; canUndo: boolean }): void {
  const g = app.game;
  if (!g) return;
  let legal = view.legal || [];
  const c = g.constraint;
  if (c && (c.type === "noFoldPreflop" || c.noFoldPreflop) && snap.phase === "preflop") legal = legal.filter((a) => a.type !== "fold");
  const prevTurn = app.hud?.isYourTurn;
  app.hud = { snap, legal, isYourTurn: view.isYourTurn, canUndo: view.canUndo };
  const you = snap.players.find((p) => p.id === HUMAN_ID);
  if (you) table3d.showSnapshot(snap, you.seat);
  // ui.js updateGame: the turn banner and the objective are announced when they change
  const banner = bannerText();
  if (banner && (view.isYourTurn !== prevTurn || !view.isYourTurn)) announceOnce("turn", banner);
  announceOnce("objective", objectiveText());
  if (snap.terminal && !app.finished) void finish({});
}
const lastSaid: Record<string, string> = {};
function announceOnce(key: string, text: string): void {
  if (!text || lastSaid[key] === text) return;
  lastSaid[key] = text;
  announce(text);
}
export function bannerText(): string {
  const h = app.hud;
  if (!h) return "";
  const actor = h.snap.currentActor != null ? h.snap.players[h.snap.currentActor] : null;
  return h.isYourTurn ? T("Your turn") : actor ? T("Waiting for {name}", { name: actor.name }) : "";
}
function onEvents(events: GameEvent[]): void {
  showEvents(events);
  audio.mapEvents(events, HUMAN_ID);
  table3d.playEvents(events);
  if (app.game?.mode === "learn") learnOnEvents(events);
}

// ------------------------------------------------------------------ the feed (ui.js showEvents)
export const PHASE_NAMES: Record<string, string> = { init: N("Ready"), preflop: N("Preflop"), flop: N("Flop"), turn: N("Turn"), river: N("River"), showdown: N("Showdown"), handEnd: N("Hand over"), terminal: N("Match over") };
export const phaseName = (p: string): string => (PHASE_NAMES[p] ? T(PHASE_NAMES[p]!) : String(p || ""));
const ACTION_NAMES: Record<string, string> = { fold: N("fold"), check: N("check"), call: N("call"), bet: N("bet"), raise: N("raise"), allin: N("all in"), advance: N("deal") };
export const actionName = (a: string): string => (ACTION_NAMES[a] ? T(ACTION_NAMES[a]!) : String(a || ""));
export const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"];
export const SUIT_NAMES = [N("Spades"), N("Hearts"), N("Diamonds"), N("Clubs")];
export const RANK_NAMES: Record<string, string> = { 2: N("Two"), 3: N("Three"), 4: N("Four"), 5: N("Five"), 6: N("Six"), 7: N("Seven"), 8: N("Eight"), 9: N("Nine"), 10: N("Ten"), J: N("Jack"), Q: N("Queen"), K: N("King"), A: N("Ace") };
export function cardParts(c: number): { rank: string; suit: number } {
  const ch = "23456789TJQKA"[c % 13]!;
  return { rank: ch === "T" ? "10" : ch, suit: (c / 13) | 0 };
}
export function cardName(c: number | null): string {
  if (c == null) return T("Card face down");
  const { rank, suit } = cardParts(c);
  return T("{rank} of {suit}", { rank: T(RANK_NAMES[rank]!), suit: T(SUIT_NAMES[suit]!) });
}
export function cardsText(cards: number[] | undefined): string {
  return (cards || []).map((c) => { const { rank, suit } = cardParts(c); return rank + SUIT_SYMBOLS[suit]; }).join(" ");
}
const EVENTS: Record<string, string> = {
  handStart: N("Hand {n} begins — {dealer} has the button."), postSb: N("{name} posts the small blind, {amount}."), postBb: N("{name} posts the big blind, {amount}."),
  deal: N("Cards are dealt."), fold: N("{name} folds."), check: N("{name} checks."), call: N("{name} calls {amount}."), bet: N("{name} bets {amount}."),
  raise: N("{name} raises to {amount}."), allin: N("{name} is all in for {amount}."), advance: N("{name} moves the hand along."),
  streetFlop: N("Flop: {cards}"), streetTurn: N("Turn: {cards}"), streetRiver: N("River: {cards}"), street: N("{phase}: {cards}"),
  showdown: N("{name} shows {hand}."), award: N("{name} wins {amount} with {hand}."), awardSplit: N("{name} collects {amount}."),
  eliminated: N("{name} is eliminated."), handEnd: N("Hand {n} is complete."), terminal: N("{name} wins the table!"), youWin: N("You win {amount} with {hand}."),
};
const names = new Map<string, string>();
function showEvents(events: GameEvent[]): void {
  const snap = app.game?.session.snapshot();
  for (const p of snap?.players ?? []) names.set(p.id, p.name);
  const name = (id: string | undefined): (() => string) => () => (id === HUMAN_ID ? T("You") : names.get(id ?? "") || id || "?");
  const line = (key: string, vars: Record<string, string | number | (() => string)> = {}): (() => string) => () => {
    const v: Record<string, string | number> = {};
    for (const [k, x] of Object.entries(vars)) v[k] = typeof x === "function" ? x() : x;
    return T(EVENTS[key]!, v);
  };
  const hand = (n: string | undefined): (() => string) => () => (n ? T(n) : "");
  for (const ev of events) {
    let text: (() => string) | null = null, isToast = false, assertive = false;
    switch (ev.type) {
      case "handStart": {
        // the event names the dealer's seat (the old feed printed it as "?")
        const dealer = snap?.players.find((p) => p.seat === ev.dealer)?.id;
        text = line("handStart", { n: ev.handNumber ?? 0, dealer: name(dealer) });
        break;
      }
      case "post": text = line(ev.kind === "sb" ? "postSb" : "postBb", { name: name(ev.playerId), amount: chips(ev.amount ?? 0) }); break;
      case "deal": text = line("deal"); break;
      case "action": text = line(EVENTS[ev.action ?? ""] ? ev.action! : "advance", { name: name(ev.playerId), amount: chips(ev.amount || 0) }); break;
      case "street": {
        const key = ev.phase === "flop" ? "streetFlop" : ev.phase === "turn" ? "streetTurn" : ev.phase === "river" ? "streetRiver" : "street";
        const cards = cardsText(ev.cards);
        text = line(key, { cards, phase: () => phaseName(ev.phase ?? "") });
        isToast = true;
        break;
      }
      case "showdown": {
        const parts = (ev.hands || []).map((h) => line("showdown", { name: h.name ? h.name : name(h.playerId), hand: hand(h.evalResult?.name) }));
        text = parts.length ? () => parts.map((f) => f()).join(" ") : null;
        isToast = parts.length > 0;
        break;
      }
      case "award": {
        const parts: (() => string)[] = [];
        for (const pot of ev.pots || []) for (const w of pot.winners || []) {
          const key = w === HUMAN_ID ? "youWin" : pot.winners.length > 1 ? "awardSplit" : "award";
          parts.push(line(key, { name: name(w), amount: chips(pot.amount / (pot.winners.length || 1)), hand: hand(pot.handName) }));
        }
        text = parts.length ? () => parts.map((f) => f()).join(" ") : null;
        isToast = true;
        assertive = (ev.pots || []).some((p) => (p.winners || []).includes(HUMAN_ID));
        break;
      }
      case "eliminated": text = line("eliminated", { name: name(ev.playerId) }); isToast = true; break;
      case "handEnd": text = line("handEnd", { n: ev.handNumber ?? 0 }); break;
      case "terminal": text = line("terminal", { name: name(ev.terminal?.championId ?? undefined) }); isToast = true; assertive = true; break;
    }
    if (text) {
      app.feed.push(text);
      if (app.feed.length > 100) app.feed.splice(0, app.feed.length - 100);
      if (isToast) toast(text, assertive); else announce(text());
    }
  }
}

// ------------------------------------------------------------------ texts the rails show
export function objectiveText(): string {
  const g = app.game;
  if (!g) return "";
  if (g.mode === "learn" && g.lesson) {
    const step = g.lesson.steps[g.stepIndex];
    return T(g.lesson.title) + (step ? " — " + T(step.text) : "");
  }
  return g.objective();
}
export function progressText(): string {
  const g = app.game, h = app.hud;
  if (!g || !h) return "";
  const snap = h.snap;
  const parts: string[] = [];
  parts.push(snap.config.maxHands ? T("Hand {n} of {total}", { n: snap.handNumber || 0, total: snap.config.maxHands }) : T("Hand {n}", { n: snap.handNumber || 0 }));
  const you = snap.players.find((p) => p.id === HUMAN_ID);
  if (you) parts.push(T("Your stack: {n}", { n: you.chips }));
  const st = (snap.stats || {})[HUMAN_ID];
  if (st && st.handsWon) parts.push(T("Hands won: {n}", { n: st.handsWon }));
  const c = g.constraint;
  if (g.mode === "challenge" && c) {
    if (c.type === "moveLimit" || c.moveLimit) parts.push(T("Actions left: {n}", { n: Math.max(0, (c.moves || c.moveLimit || 0) - app.movesUsed) }));
    if (c.type === "speedTarget") {
      const left = Math.max(0, (c.maxMs ?? 0) - g.session.summary().elapsedMs);
      parts.push(T("Time left: {time}", { time: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` }));
    }
  }
  return parts.join(" · ");
}
export function hintText(): string | null { return app.hint ? app.hint() : null; }

// ------------------------------------------------------------------ actions (main.js action / ui.js _commitAction)
export function act(type: string, amount?: number): void {
  const g = app.game;
  if (!g || app.finished) return;
  const snap = g.session.snapshot();
  if (!snap) return;
  if (type === "advance") {
    if (g.mode === "learn") learnOnAction("advance");
    g.session.dispatch("advance");
    audio.play("click");
    announce(T("{action} sent.", { action: actionName(type) }));
    return;
  }
  const c = g.constraint;
  if (c && (c.type === "noFoldPreflop" || c.noFoldPreflop) && type === "fold" && snap.phase === "preflop") {
    announce(T("Folding before the flop is not allowed in this challenge."), true);
    audio.play("error");
    return;
  }
  if (c && (c.type === "moveLimit" || c.moveLimit)) {
    const limit = c.moves || c.moveLimit || 0;
    if (app.movesUsed >= limit) {
      const legal = Engine.legalActions(snap, HUMAN_ID);
      const auto = legal.find((a) => a.type === "check") || legal.find((a) => a.type === "fold");
      if (!auto) return;
      announce(T("Action limit reached — the table plays the safest move for you."), true);
      type = auto.type;
      amount = auto.amount;
    }
  }
  if (g.mode === "learn") learnOnAction(type);
  const res = g.session.dispatch(type, amount);
  if (!res.ok) {
    announce(T("Cannot {action}: {reason}", { action: T(type), reason: res.error?.message ?? "" }), true);
    audio.play("error");
  } else {
    app.movesUsed++;
    app.hint = null;
    app.hintVisible = false;
    audio.play("click");
    announce(T("{action} sent.", { action: actionName(type) }));
  }
}
/** The tray's button for a legal action (ui.js _renderTray): bet / raise take the stepper's amount. */
export function commit(a: Legal): void {
  let amount = a.amount;
  if ((a.type === "bet" || a.type === "raise") && app.raiseAmount != null) amount = app.raiseAmount;
  act(a.type, amount);
}
export function undo(): void {
  const g = app.game;
  if (!g) return;
  const ok = g.session.undo();
  announce(ok ? T("Undone — back to your previous decision.") : T("Nothing to undo."), !ok);
  if (ok) audio.play("click");
}
/** main.js hint: the lesson step's hint, else the normal AI's pick for your seat, phrased as advice. */
export function hint(): void {
  const g = app.game;
  if (!g) return;
  const snap = g.session.snapshot();
  if (!snap) return;
  const legal = Engine.legalActions(snap, HUMAN_ID);
  let text: (() => string | null) | null = null;
  if (g.mode === "learn" && g.lesson) {
    const step = g.lesson.steps[g.stepIndex];
    if (step && typeof step.hint === "function") {
      try { if (step.hint(snap, legal)) text = () => step.hint!(snap, legal); } catch { text = null; }
    }
  }
  if (!text) {
    try {
      // the hint reads the scrubbed snapshot (the AI never needs the hidden cards: it rates its own hand)
      const rng = new RngMod.Rng(((g.config.seed ^ snap.tick) >>> 0), "hint");
      const pick = Ai.chooseAction(snap, HUMAN_ID, "normal", rng);
      const call = legal.find((a) => a.type === "call");
      const check = legal.find((a) => a.type === "check");
      if (pick && pick.type === "call" && call) text = () => T("Consider calling {n} to stay in the hand.", { n: call.amount ?? 0 });
      else if (pick && (pick.type === "bet" || pick.type === "raise")) text = () => T("Your hand has some strength — a bet could build the pot.");
      else if (pick && pick.type === "fold") text = () => T("This hand looks weak for the price — folding is reasonable.");
      else if (check) text = () => T("No bet is live — checking costs nothing.");
    } catch { text = null; }
  }
  app.hint = text || (() => T("Watch the pot size and your position before acting."));
  const shown = app.hint();
  if (shown) announce(T("Hint: {text}", { text: shown }));
}
export function toggleHint(): void {
  if (app.hintVisible) { app.hintVisible = false; return; }
  app.hintVisible = true;
  hint();
}
export function pauseToggle(): void {
  const s = app.game?.session;
  if (!s) return;
  if (s.paused) s.resume(); else s.pause();
}
export function skip(): void { app.game?.session.skip(); }

// ------------------------------------------------------------------ the lessons (main.js learn flow)
function announceStep(): void {
  const g = app.game;
  if (!g || g.mode !== "learn" || !g.lesson) return;
  const step = g.lesson.steps[g.stepIndex];
  if (!step) return;
  const snap = g.session.snapshot();
  const legal = snap ? Engine.legalActions(snap, HUMAN_ID) : [];
  app.hint = typeof step.hint === "function" ? () => { try { return snap ? step.hint!(snap, legal) : null; } catch { return null; } } : null;
  announce(T(step.text));
}
function learnAdvanceStep(): void {
  const g = app.game;
  if (!g || g.mode !== "learn" || !g.lesson) return;
  g.stepIndex++;
  if (g.stepIndex >= g.lesson.steps.length) {
    const p = platform.save().progress;
    p.tutorial = { ...(p.tutorial || {}), [g.lesson.id]: true };
    platform.persist();
    announce(T("{title} complete. Finish the hand or leave when ready.", { title: T(g.lesson.title) }));
    audio.play("win");
    g.lessonComplete = true;
  } else announceStep();
}
function learnOnAction(type: string): void {
  const g = app.game;
  const step = g?.lesson?.steps[g.stepIndex];
  if (step && step.requireAction && step.requireAction === type) learnAdvanceStep();
}
function learnOnEvents(events: GameEvent[]): void {
  const g = app.game;
  if (!g || g.lessonComplete || !g.lesson) return;
  const step = g.lesson.steps[g.stepIndex];
  if (step && step.requireEvent && events.some((e) => e.type === step.requireEvent)) learnAdvanceStep();
}
export function tutorialAck(): void { if (app.game?.mode === "learn") learnAdvanceStep(); }

// ------------------------------------------------------------------ results (main.js _finishLocal)
const timeText = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
function goalsLine(results: GoalResult[]): () => string {
  return () => results.map((r) => (r.ok ? "✓ " : "✗ ") + (r.detailFn ? r.detailFn() : r.detail)).join("  ");
}
export async function finish({ forceFail }: { forceFail?: string }): Promise<void> {
  const g = app.game;
  if (!g || app.finished) return;
  const snap = g.session.snapshot()!;
  if (!snap.terminal && !forceFail && !g.lessonComplete) return;
  app.finished = true;
  const summary = g.session.summary();
  const goalsEval = g.goals && g.goals.length ? Content.evaluateGoals(g.goals, summary, HUMAN_ID) : null;
  const passed = forceFail ? false : goalsEval ? goalsEval.passed : true;
  const terminal = snap.terminal;
  const standing = terminal?.standings ? terminal.standings.find((s) => s.id === HUMAN_ID) ?? null : null;
  const stats = (snap.stats || {})[HUMAN_ID] || { handsWon: 0, showdownsWon: 0, potsWon: 0, bestHand: null };
  const save = platform.save();
  const progress = save.progress;
  const lt = progress.lifetime;
  lt.hands += summary.handsPlayed;
  lt.handsWon += stats.handsWon || 0;
  lt.showdownsWon += stats.showdownsWon || 0;
  lt.potsWon += stats.potsWon || 0;
  if (stats.bestHand && !lt.bestHand) lt.bestHand = stats.bestHand;
  const unlocks: string[] = [];
  const unlock = (key: string): void => { if (!unlocks.includes(key)) unlocks.push(key); };
  let stars = 0, canNext = false;
  let headline: string | (() => string);
  let progressText: (() => string) | null = null;
  let goalsPassed: number | null = null, goalsTotal: number | null = null;
  app.nextUp = null;
  const passedCount = goalsEval ? goalsEval.results.filter((r) => r.ok).length : 0;
  if (g.mode === "journey" && g.stage) {
    if (passed) {
      stars = 1;
      if (standing && standing.place === 1) stars++;
      if (summary.handsPlayed <= (g.par || Infinity)) stars++;
      progress.journey.stars[g.stage.id] = Math.max(progress.journey.stars[g.stage.id] || 0, stars);
      progress.journey.unlocked = Math.max(progress.journey.unlocked, g.stage.index);
      lt.journeysCleared = Object.keys(progress.journey.stars).length;
      unlock("first_flow");
      if (g.stage.mastery) unlock("mechanic_master");
      if (g.stage.id === "j40") unlock("estuary_champion");
    }
    headline = passed ? (stars >= 3 ? N("Flawless waters — stage mastered!") : N("Stage complete!")) : forceFail || N("The river takes this one — stage goals unmet.");
    goalsPassed = passedCount; goalsTotal = g.goals.length;
    progressText = goalsEval ? goalsLine(goalsEval.results) : null;
    canNext = passed && g.stage.index < Content.JOURNEY.length;
    if (canNext) app.nextUp = { stage: Content.JOURNEY[g.stage.index] };
  } else if (g.mode === "daily" && g.daily) {
    lt.dailiesPlayed++;
    if (ProgressModel.updateDailyStreak(progress, g.daily.date) >= 7) unlock("steady_current");
    const value = standing ? standing.chips : (summary.goalsContext.finalChips[HUMAN_ID] ?? 0);
    ProgressModel.addBoardEntry(save, `daily:${g.daily.date}`, {
      value, ts: Math.round(platform.nowMs()), name: profileName(), ruleset: "fixed-limit", contentVersion: Content.CONTENT_VERSION,
      seed: g.daily.seed, assists: [], durationMs: summary.elapsedMs,
    });
    headline = passed ? N("Daily challenge complete!") : forceFail || N("Daily challenge finished — goals unmet.");
    goalsPassed = passedCount; goalsTotal = g.goals.length;
    const date = g.daily.date;
    progressText = () => T("Result recorded for {date}: {n} chips.", { date, n: value });
  } else if (g.mode === "challenge" && g.challenge) {
    if (passed) progress.challenges = { ...(progress.challenges || {}), [g.challenge.id]: true };
    headline = passed ? N("Challenge cleared!") : forceFail || N("Challenge failed — try a different line.");
    goalsPassed = passedCount; goalsTotal = g.goals.length;
    progressText = goalsEval ? goalsLine(goalsEval.results) : null;
  } else if (g.mode === "learn" && g.lesson) {
    const title = g.lesson.title;
    headline = g.lessonComplete ? () => T("Lesson complete: {title}", { title: T(title) }) : N("Lesson ended.");
    const nextIdx = (g.lessonIndex ?? 0) + 1;
    canNext = !!g.lessonComplete && nextIdx < Content.TUTORIAL.length;
    if (canNext) app.nextUp = { lesson: Content.TUTORIAL[nextIdx], index: nextIdx };
    progressText = g.lessonComplete ? () => T("All steps performed. Well played.") : () => T("You left before finishing every step.");
  } else {
    headline = standing && standing.place === 1 ? N("You win the table!") : N("Match over.");
    progressText = () => T("Practice is unranked — play with the assists you like.");
  }
  if (lt.hands >= 1000) unlock("thousand_hands");
  const ach = (progress.achievements = progress.achievements || {});
  const newly: string[] = [];
  for (const key of unlocks) if (!ach[key]) { ach[key] = Math.round(platform.nowMs()); newly.push(key); }
  platform.persist();
  const head = typeof headline === "function" ? headline : ((k: string) => () => T(k))(headline);
  const MODE_NAMES: Record<Mode, string> = { learn: N("Learn"), journey: N("Journey"), daily: N("Daily"), practice: N("Practice"), challenge: N("Challenge") };
  const place = standing && terminal ? { place: standing.place, total: terminal.standings.length } : null;
  const breakdown: Row[] = [
    { label: () => T("Mode"), value: () => T(MODE_NAMES[g.mode]) },
    { label: () => T("Hands played"), value: () => String(summary.handsPlayed) },
    { label: () => T("Hands won"), value: () => String(stats.handsWon || 0) },
    { label: () => T("Showdowns won"), value: () => String(stats.showdownsWon || 0) },
    { label: () => T("Final chips"), value: () => (standing ? String(standing.chips) : "—") },
    { label: () => T("Place"), value: () => (place ? T("#{place} of {total}", place) : "—") },
    { label: () => T("Invalid actions"), value: () => String(summary.invalidActions) },
    { label: () => T("Time"), value: () => timeText(summary.elapsedMs) },
  ];
  const par = g.par, played = summary.handsPlayed;
  const nextStage = g.mode === "journey" && canNext && g.stage ? { n: g.stage.index + 1, title: Content.JOURNEY[g.stage.index]!.title } : null;
  const recKey = g.mode === "journey"
    ? (passed ? (canNext ? "" : N("Journey complete — try the daily challenge!")) : N("Retry the stage — hints are on, and the deal is identical every attempt."))
    : g.mode === "learn" ? (canNext ? N("Next lesson introduces the next rule.") : N("All lessons done — the Journey awaits."))
      : g.mode === "daily" ? N("Come back tomorrow for a fresh deal, or warm up in Practice.") : N("Try a Journey stage or a Challenge for a sterner test.");
  const postLb = (g.mode === "daily" || g.mode === "challenge") && platform.signedIn();
  app.results = {
    headline: head, breakdown, stars: g.mode === "journey" ? stars : null, goalsPassed, goalsTotal, progressText, achievements: newly,
    comparison: par != null ? () => T("Par for this table is {par} hands — you played {n}.", { par, n: played }) : null,
    leaderboard: postLb, lb: null, canNext,
    recommendation: nextStage ? () => T("Continue to stage {n}: {title}.", { n: nextStage.n, title: T(nextStage.title) }) : () => T(recKey),
  };
  audio.startMusic("results");
  show("results");
  if (postLb) {
    const r = app.results;
    const final = standing ? standing.chips : (summary.goalsContext.finalChips[HUMAN_ID] ?? 0);
    void platform.postHighScore(final).then((res) => { r.lb = res; });
  }
  announce(head(), true);
}
export function resultsLbLine(): string | null {
  const r = app.results;
  if (!r || !r.leaderboard) return null;
  if (!r.lb) return S("lbPosting");
  return !r.lb.posted ? S("lbNotPosted") : r.lb.rank ? S("lbRank", { rank: r.lb.rank }) : S("lbPosted");
}
export function retry(): void {
  const g = app.game;
  if (!g) { show("modes"); return; }
  if (g.mode === "practice") startPractice(g.options ?? {});
  else if (g.mode === "journey" && g.stage) selectJourney(g.stage.id);
  else if (g.mode === "daily") selectDaily();
  else if (g.mode === "challenge" && g.challenge) selectChallenge(g.challenge.id);
  else if (g.mode === "learn") startLearn(g.lessonIndex ?? 0);
  else show("modes");
}
export function nextStage(): void {
  const up = app.nextUp;
  if (!up) { leaveToTitle(); return; }
  if (up.lesson) startLearn(up.index ?? 0);
  else if (up.stage) selectJourney(up.stage.id);
  else leaveToTitle();
}
export function leaveToTitle(): void {
  teardown();
  app.modals = [];
  table3d.setTheme(currentTheme());
  audio.startAmbience(currentTheme().id);
  audio.startMusic("menu");
  show("title", "btn-play");
}
function teardown(): void {
  app.game?.session.dispose();
  app.game = null;
  app.hud = null;
  app.finished = false;
  app.hint = null;
  app.nextUp = null;
  timers = [];
}

// ------------------------------------------------------------------ settings, profile, account
export function setTheme(id: string): void {
  const t = themeById(id);
  if (!t) return;
  if (!themeUnlocked(t)) { announce(T("{name} is locked — keep playing to unlock it.", { name: T(t.name) }), true); return; }
  platform.setOption("theme", id);
  table3d.setTheme(t);
  audio.startAmbience(id);
  announce(T("Theme: {name}.", { name: T(t.name) }));
}
export function profileSave(name: string): void {
  if (platform.signedIn()) { announce(T("Your table name comes from your StarHermit account.")); return; }
  const n = name.trim().slice(0, 24);
  if (!n) return;
  platform.save().profile.name = n;
  platform.persist();
  announce(T("Profile saved."));
  audio.play("notify");
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); notify(S("inviteCopied")); } catch { notify(S("inviteLink", { url: link })); }
}
export function bestHandName(): string | null {
  const b = platform.save().progress.lifetime.bestHand;
  return b && HAND_NAMES.includes(b) ? T(b) : b;
}

// ------------------------------------------------------------------ keys and pads (ui.js _onKeydown)
export const TRAY_IDS: string[] = [];
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  if (app.modals.length) {
    if (a === "pause" && fresh()) later(closeModal);
    return;
  }
  if (app.screen !== "game" || !app.game) return;
  if (app.finished) return;
  if (a === "skip") { later(skip); return; }
  const legal = app.hud?.legal ?? [];
  const find = (t: string): Legal | undefined => legal.find((x) => x.type === t);
  const press = (l: Legal | undefined): void => { if (l) later(() => commit(l)); };
  switch (a) {
    case "fold": press(find("fold")); break;
    case "call": press(find("check") ?? find("call")); break;
    case "raise": press(find("raise") ?? find("bet")); break;
    case "allin": press(find("allin")); break;
    case "undo": if (app.hud?.canUndo) later(undo); break;
    case "hint": if (app.game.hintsEnabled || app.hint) later(toggleHint); break;
    case "pause": if (fresh()) later(() => openModal("pause")); break;
    case "prev": case "next": {
      if (!TRAY_IDS.length) break;
      const cur = TRAY_IDS.indexOf(ui.focused() ?? "");
      const dir = a === "next" ? 1 : -1;
      const i = cur < 0 ? (dir > 0 ? 0 : TRAY_IDS.length - 1) : (cur + dir + TRAY_IDS.length) % TRAY_IDS.length;
      ui.setFocus(TRAY_IDS[i]!);
      break;
    }
  }
});

// ------------------------------------------------------------------ the clock
let hidden = false;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / 60;
  runTimers();
  const g = app.game;
  if (g && !app.finished && g.mode === "challenge" && g.constraint?.type === "speedTarget" && !g.session.paused
    && g.session.summary().elapsedMs > (g.constraint.maxMs ?? Infinity)) {
    void finish({ forceFail: N("Time expired — the clock beat you this run.") });
  }
  if (app.toast && app.toast.until < clockMs) app.toast = null;
  if (app.appToast && app.appToast.until < clockMs) app.appToast = null;
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  table3d.applyLook(lookFor(f.quality, f.levelIndex));
}
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  table3d.setReducedMotion(preferences().reducedMotion);
  applyLook();
  table3d.setTheme(currentTheme());
  table3d.setActive(true);
  audio.startMusic("menu");
  audio.startAmbience(currentTheme().id);
  show("title", "btn-play");
});
onPreferencesChange((p) => table3d.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => { if (!app.game) table3d.setTheme(currentTheme()); });
platform.onProgressMerged(() => { if (app.screen === "title") announce(T("Progress restored from your StarHermit cloud save.")); });
onSessionEnded(() => notify(S("signedOut")));
onSuspend(() => {
  hidden = true;
  // backgrounding pauses solo play (main.js visibilitychange)
  app.game?.session.pause();
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => {
  hidden = false;
  if (app.game && !app.modals.includes("pause")) app.game.session.resume();
  audio.setSuspended(false);
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(shownTheme(), platform.options.palette, ui.preferences().highContrast);
  audio.update();
});
onRender(() => {
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  const f = frame();
  table3d.update(frameDt, f.width, f.height);
  flushAnnouncements();
});
