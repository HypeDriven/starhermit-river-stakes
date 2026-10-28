// The browser build's pure game modules (shared with the node tests), typed
// for this client: the fixed-limit Hold'em rules (js/rules/: engine, AI,
// evaluator, seeded rng), the session (js/session.js: AI seats, undo, replay
// envelope, its timers on this client's fixed-step clock), the content
// (js/content.js: five themes, six lessons, the 40-stage Journey, six
// Challenges, the Daily generator, goals, achievements) and the save model
// (js/progress.js over js/merge.js).
import * as engineMod from "../js/rules/engine.js";
import * as aiMod from "../js/rules/ai.js";
import * as rngMod from "../js/rules/rng.js";
import * as evalMod from "../js/rules/evaluator.js";
import * as sessionMod from "../js/session.js";
import * as contentMod from "../js/content.js";
import * as progressMod from "../js/progress.js";

export type Phase = "init" | "preflop" | "flop" | "turn" | "river" | "showdown" | "handEnd" | "terminal";
export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin" | "advance";
export interface Player {
  id: string; name: string; seat: number; chips: number; cards: number[] | null; bet: number; totalBet: number;
  status: "active" | "folded" | "allin" | "out"; isAI: boolean; lastAction: string | null;
}
export interface Standing { id: string; name: string; chips: number; place: number }
export interface TerminalInfo { reason: string; championId: string | null; standings: Standing[] }
export interface PlayerStats { handsWon: number; showdownsWon: number; potsWon: number; folds: number; betsRaises: number; bestHand: string | null }
export interface Snapshot {
  tick: number; handNumber: number; phase: Phase; config: { smallBlind: number; bigBlind: number; maxHands: number | null };
  players: Player[]; dealer: number; currentActor: number | null; toCall: number; currentBet: number;
  community: number[]; pots: { amount: number; eligible?: string[] }[]; terminal: TerminalInfo | null;
  stats: Record<string, PlayerStats>; log: string[];
}
export interface Legal { type: ActionType; amount?: number }
export interface GameEvent {
  type: string; playerId?: string; action?: string; amount?: number; kind?: string; handNumber?: number; dealer?: number; dealerId?: string;
  phase?: string; cards?: number[]; hands?: { playerId: string; name?: string; evalResult?: { name: string } }[];
  pots?: { amount: number; winners: string[]; handName?: string }[]; terminal?: TerminalInfo;
}
export interface Config { seed: number; smallBlind: number; bigBlind: number; maxHands: number | null; players: { id: string; name: string; chips: number; ai: string | null }[] }
export interface Summary {
  stats: Record<string, PlayerStats>; handsPlayed: number; invalidActions: number; elapsedMs: number; terminal: TerminalInfo | null;
  goalsContext: { standings: Standing[]; finalChips: Record<string, number>; places: Record<string, number> };
}
export interface Clock { now(): number; setTimeout(cb: () => void, ms: number): number; clearTimeout(h: number): void }
export interface SessionOpts {
  config: Config; mode: string; allowUndo: boolean; autoAdvance: boolean; aiDelay: number; humanId: string; clock: Clock;
  onSnapshot(snap: Snapshot, view: { legal: Legal[]; isYourTurn: boolean; canUndo: boolean; mode: string }): void;
  onEvents(events: GameEvent[]): void;
  onTurn(isHuman: boolean): void;
}
export interface Session {
  start(): Session;
  dispatch(type: string, amount?: number): { ok: boolean; error?: { code: string; message: string } };
  legal(): Legal[];
  snapshot(): Snapshot | null;
  canUndo(): boolean;
  undo(): boolean;
  skip(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  summary(): Summary;
  dispose(): void;
}
export interface Goal { type: string; amount?: number; count?: number; place?: number }
export interface GoalResult { goal: Goal; ok: boolean; detail: string; detailFn?: () => string }
export interface Theme { id: string; name: string; desc: string; palette: Record<string, string>; unlock: string | { journey?: number; achievement?: string } }
export interface LessonStep { text: string; requireAction?: string; requireEvent?: string; hint?: (snap: Snapshot, legal: Legal[]) => string | null }
export interface Lesson { id: string; title: string; body: string; config: Config; goal: string; steps: LessonStep[] }
export interface Stage { id: string; index: number; title: string; desc: string; seed: number; theme: string; config: Config; par: number; mastery: boolean; goals: Goal[]; teaches: string | null }
export interface Constraint { type: string; moves?: number; moveLimit?: number; maxMs?: number; noFoldPreflop?: boolean; bigBlinds?: number }
export interface Challenge { id: string; title: string; desc: string; seed: number; theme: string; config: Config; constraint: Constraint | null; goals: Goal[]; par: number }
export interface Daily { id: string; date: string; seed: number; theme: string; config: Config; goals: Goal[]; par: number }
export interface Achievement { key: string; name: string; desc: string }
export interface Lifetime { hands: number; handsWon: number; showdownsWon: number; potsWon: number; bestHand: string | null; journeysCleared: number; dailiesPlayed: number }
export interface ProgressDoc {
  journey: { stars: Record<string, number>; unlocked: number }; lifetime: Lifetime; tutorial?: Record<string, boolean>;
  challenges?: Record<string, boolean>; achievements?: Record<string, number>; daily?: { lastDate: string | null; streak: number };
}
export interface BoardEntry { value: number; ts: number; name: string; ruleset?: string; contentVersion?: number; seed?: number; assists?: string[]; durationMs?: number }
export interface SaveDoc { v: number; progress: ProgressDoc; boards: Record<string, BoardEntry[]>; profile: { name: string } }
export interface Options { theme: string; palette: "default" | "deuteranopia" | "tritanopia"; leftHanded: boolean; hintMode: "toggle" | "hold"; shortcutHints: boolean }

interface EngineApi { legalActions(state: Snapshot, playerId: string): Legal[]; HAND_NAMES?: string[] }
interface AiApi { chooseAction(state: Snapshot, playerId: string, level: string, rng: unknown): { type: string; amount?: number } | null }
interface RngApi { seedFromString(s: string): number; Rng: new (seed: number, stream?: string) => { next(): number; shuffle<T>(a: T[]): T[] } }
interface ContentApi {
  THEMES: Theme[]; TUTORIAL: Lesson[]; JOURNEY: Stage[]; CHALLENGES: Challenge[]; ACHIEVEMENTS: Achievement[]; CONTENT_VERSION: number;
  dailyForDate(date: string): Daily;
  evaluateGoals(goals: Goal[], summary: Summary, humanId: string): { passed: boolean; results: GoalResult[] };
}
interface ProgressApi {
  emptySave(): SaveDoc; normalize(raw: unknown): SaveDoc; mergeSave(remote: unknown, local: unknown): SaveDoc; sameSave(a: unknown, b: unknown): boolean;
  readForeign(text: string): SaveDoc | null; DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; BROWSER_KEYS: string[]; PALETTES: string[];
  pickOptions(raw: unknown): Partial<Options>; readLegacySettings(kv: Record<string, unknown>): Partial<Options>;
  themeUnlocked(theme: Theme, save: SaveDoc): boolean; updateDailyStreak(progress: ProgressDoc, today: string): number;
  addBoardEntry(save: SaveDoc, boardId: string, entry: BoardEntry): void;
}

export const Engine = engineMod as unknown as EngineApi;
export const Ai = aiMod as unknown as AiApi;
export const RngMod = rngMod as unknown as RngApi;
export const HAND_NAMES = (evalMod as unknown as { HAND_NAMES: string[] }).HAND_NAMES;
export const Content = contentMod as unknown as ContentApi;
export const ProgressModel = progressMod as unknown as ProgressApi;
export const createSession = (o: SessionOpts): Session => new (sessionMod as unknown as { Session: new (o: SessionOpts) => Session }).Session(o);
