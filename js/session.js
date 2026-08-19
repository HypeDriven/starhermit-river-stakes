// River Stakes — local game orchestration: session wrapper, AI seats, undo, replay, autosave
import { createGame, applyCommand, legalActions, getSnapshot, hashState, serialize } from './rules/engine.js';
import { chooseAction } from './rules/ai.js';
import { Rng } from './rules/rng.js';
import { BUILD_VERSION } from './version.js';

const DEFAULT_AI_DELAY = 600;
const DEFAULT_AUTO_ADVANCE_DELAY = 1800;
const MAX_SYNC_STEPS = 20000; // safety cap for synchronous AI pumps

/**
 * Session wraps one immutable engine state timeline. Human commands go through
 * dispatch(); AI seats are driven by chooseAction() with a session Rng forked
 * from the config seed (stream 'ai'). All applied commands (human + AI + auto
 * advance) are recorded with post-command hashes so exportReplay()/verifyReplay()
 * form a tamper-evident chain.
 *
 * Timer model: with aiDelay > 0 AI moves and auto-advances run on setTimeout;
 * every handle is tracked so pause()/skip()/dispose() are exact. With
 * aiDelay === 0 everything settles synchronously inside dispatch()/start() —
 * tests can drive a full match without awaiting timers.
 */
export class Session {
  /**
   * @param {object} opts { config, mode, allowUndo, aiDelay, autoAdvance,
   *   autoAdvanceDelay, humanId, saveSnapshot?, onSnapshot?, onEvents?, onTurn? }
   */
  constructor(opts = {}) {
    if (!opts.config) throw new Error('Session requires opts.config');
    this.opts = opts;
    this.config = opts.config;
    this.mode = opts.mode || 'practice';
    this.allowUndo = !!opts.allowUndo;
    this.aiDelay = opts.aiDelay == null ? DEFAULT_AI_DELAY : opts.aiDelay;
    this.autoAdvance = !!opts.autoAdvance;
    this.autoAdvanceDelay = opts.autoAdvanceDelay == null ? DEFAULT_AUTO_ADVANCE_DELAY : opts.autoAdvanceDelay;
    this.humanId = opts.humanId || (opts.config.players[0] && opts.config.players[0].id);
    this._onSnapshot = typeof opts.onSnapshot === 'function' ? opts.onSnapshot : () => {};
    this._onEvents = typeof opts.onEvents === 'function' ? opts.onEvents : () => {};
    this._onTurn = typeof opts.onTurn === 'function' ? opts.onTurn : () => {};
    this._saveSnapshot = typeof opts.saveSnapshot === 'function' ? opts.saveSnapshot : null;

    this._aiRng = new Rng((opts.config.seed >>> 0) || 0, 'ai');
    this._aiLevel = new Map();
    for (const p of opts.config.players) if (p.ai) this._aiLevel.set(p.id, p.ai);

    this._state = null;
    this._history = [];      // full immutable states, [0] = createGame result
    this._commands = [];     // all applied commands (human, AI, auto-advance)
    this._hashes = [];       // hashState after each applied command
    this._undoStack = [];    // lengths snapshots taken before each human decision
    this._invalidActions = 0;
    this._cmdCounter = 0;
    this._timers = new Set(); // { handle, fireAt, remaining, cb }
    this._paused = false;
    this._disposed = false;
    this._startedAt = 0;
    this._pausedAt = 0;
    this._pausedTotal = 0;
  }

  /** Create the game and emit the first snapshot. @returns {Session} this */
  start() {
    if (this._state || this._disposed) return this;
    this._state = createGame(this.config);
    this._history.push(this._state);
    this._startedAt = Date.now();
    this._emit([]);
    this._scheduleNext();
    return this;
  }

  /**
   * Human command. Builds {id,tick,playerId,type,amount?} from live state.
   * Invalid attempts are counted and returned as {ok:false,error}.
   * @returns {object} engine result
   */
  dispatch(type, amount) {
    if (this._disposed || !this._state) {
      return { ok: false, error: { code: 'GAME_OVER', message: 'session not running' } };
    }
    const cmd = { id: `h-${this._cmdCounter++}`, tick: this._state.tick, playerId: this.humanId, type };
    if (amount !== undefined) cmd.amount = amount;
    const res = applyCommand(this._state, cmd);
    if (!res.ok) {
      this._invalidActions++;
      return res;
    }
    // remember the pre-decision point so undo() can restore it
    this._undoStack.push({
      historyLength: this._history.length,
      commandsLength: this._commands.length,
      hashesLength: this._hashes.length,
    });
    this._commit(res, cmd);
    this._scheduleNext();
    return res;
  }

  /** @returns {object[]} legal actions for the human seat */
  legal() {
    return this._state ? legalActions(this._state, this.humanId) : [];
  }

  /** @returns {object|null} viewer-scrubbed snapshot for the human seat */
  snapshot() {
    return this._state ? getSnapshot(this._state, this.humanId) : null;
  }

  /** @returns {string|null} hashState of the live (unscrubbed) state — for tests/tooling */
  hash() {
    return this._state ? hashState(this._state) : null;
  }

  /** Full live state (unscrubbed). Intended for tests/tooling; UI should use snapshot(). */
  get state() {
    return this._state;
  }

  /** @returns {boolean} whether undo() can currently restore a human decision point */
  canUndo() {
    return this.allowUndo && !this._disposed && this._undoStack.length > 0;
  }

  /**
   * Restore the last human decision point (state, command log and hash chain are
   * truncated). Only when opts.allowUndo. Note: the AI Rng stream is not rewound,
   * so AI play may diverge from the undone line — replays stay exact because the
   * old commands are dropped from the envelope.
   * @returns {boolean}
   */
  undo() {
    if (!this.canUndo()) return false;
    this._clearTimers();
    const pt = this._undoStack.pop();
    this._history.length = pt.historyLength;
    this._commands.length = pt.commandsLength;
    this._hashes.length = pt.hashesLength;
    this._state = this._history[this._history.length - 1];
    this._emit([]);
    this._scheduleNext();
    return true;
  }

  /** Flush pending AI/auto-advance timers and settle to the next human decision NOW. */
  skip() {
    this._clearTimers();
    this._settleSync();
  }

  /** Suspend AI timers (solo backgrounding rule). Remaining delays are preserved. */
  pause() {
    if (this._paused || this._disposed) return;
    this._paused = true;
    this._pausedAt = Date.now();
    for (const t of this._timers) {
      clearTimeout(t.handle);
      t.remaining = Math.max(0, t.fireAt - this._pausedAt);
      t.handle = null;
    }
  }

  /** Resume paused AI timers with their remaining delays. */
  resume() {
    if (!this._paused || this._disposed) return;
    this._paused = false;
    this._pausedTotal += Date.now() - this._pausedAt;
    const now = Date.now();
    for (const t of this._timers) {
      const ms = t.remaining == null ? this.aiDelay : t.remaining;
      t.fireAt = now + ms;
      t.handle = setTimeout(() => {
        this._timers.delete(t);
        if (this._disposed || this._paused) return;
        t.cb();
      }, ms);
    }
    if (this._timers.size === 0) this._scheduleNext();
  }

  /** @returns {boolean} */
  get paused() {
    return this._paused;
  }

  /**
   * Per-player stats from state.stats plus session-level bookkeeping.
   * @returns {{stats:object, handsPlayed:number, invalidActions:number, elapsedMs:number,
   *   terminal:object|null, goalsContext:{standings:Array, finalChips:object, places:object}}}
   */
  summary() {
    const elapsedMs = this._elapsed();
    if (!this._state) {
      return { stats: {}, handsPlayed: 0, invalidActions: this._invalidActions, elapsedMs,
        terminal: null, goalsContext: { standings: [], finalChips: {}, places: {} } };
    }
    const s = this._state;
    const standings = s.terminal ? s.terminal.standings : computeStandings(s);
    const finalChips = {};
    const places = {};
    for (const st of standings) {
      finalChips[st.id] = st.chips;
      places[st.id] = st.place;
    }
    return {
      stats: s.stats,
      handsPlayed: s.handNumber,
      invalidActions: this._invalidActions,
      elapsedMs,
      terminal: s.terminal,
      goalsContext: { standings, finalChips, places },
    };
  }

  /**
   * Replay envelope per contract: { schema:1, build, seed, config, createdAt,
   * commands (incl. AI), hashes (after each command), result }.
   * @returns {object}
   */
  exportReplay() {
    return {
      schema: 1,
      build: BUILD_VERSION,
      seed: this.config.seed,
      config: this.config,
      createdAt: new Date().toISOString(),
      commands: this._commands.map((c) => ({ ...c })),
      hashes: [...this._hashes],
      result: this._state ? this._state.terminal : null,
    };
  }

  /**
   * Replay an envelope's commands through a fresh engine and compare the hash
   * chain. Never throws; any failure returns { ok:false, finalHash:null, error }.
   * @param {object} envelope
   * @returns {{ok:boolean, finalHash:string|null, error?:{code:string, message:string}}}
   */
  static verifyReplay(envelope) {
    const fail = (code, message) => ({ ok: false, finalHash: null, error: { code, message } });
    try {
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        return fail('MALFORMED', 'envelope is not an object');
      }
      if (envelope.schema !== 1) return fail('BAD_SCHEMA', `unsupported schema ${envelope.schema}`);
      if (!envelope.config || typeof envelope.config !== 'object') return fail('MALFORMED', 'missing config');
      if (!Array.isArray(envelope.commands) || !Array.isArray(envelope.hashes)) {
        return fail('MALFORMED', 'commands/hashes must be arrays');
      }
      if (envelope.commands.length !== envelope.hashes.length) {
        return fail('LENGTH_MISMATCH', 'commands and hashes length mismatch');
      }
      let state = createGame(envelope.config);
      for (let i = 0; i < envelope.commands.length; i++) {
        const cmd = envelope.commands[i];
        if (!cmd || typeof cmd !== 'object') return fail('MALFORMED', `command ${i} is not an object`);
        let res;
        try {
          res = applyCommand(state, cmd);
        } catch (e) {
          return fail('EXCEPTION', `command ${i} threw: ${(e && e.message) || e}`);
        }
        if (!res.ok) {
          const code = (res.error && res.error.code) || 'REPLAY_FAILED';
          const msg = (res.error && res.error.message) || 'command rejected';
          return fail(code, `command ${i}: ${msg}`);
        }
        state = res.state;
        if (hashState(state) !== envelope.hashes[i]) {
          return fail('HASH_MISMATCH', `hash mismatch after command ${i}`);
        }
      }
      return { ok: true, finalHash: hashState(state) };
    } catch (e) {
      return fail('EXCEPTION', String((e && e.message) || e));
    }
  }

  /** Clear all timers and mark the session dead (callbacks become no-ops). */
  dispose() {
    this._clearTimers();
    this._disposed = true;
  }

  // ---- internals ----

  _elapsed() {
    if (!this._startedAt) return 0;
    const now = this._paused ? this._pausedAt : Date.now();
    return Math.max(0, now - this._startedAt - this._pausedTotal);
  }

  _commit(res, cmd) {
    this._state = res.state;
    this._history.push(res.state);
    const norm = { id: cmd.id, tick: cmd.tick, playerId: cmd.playerId, type: cmd.type };
    if (cmd.amount !== undefined) norm.amount = cmd.amount;
    this._commands.push(norm);
    this._hashes.push(hashState(res.state));
    this._emit(res.events);
    if (this._saveSnapshot) {
      try { this._saveSnapshot(serialize(res.state)); } catch { /* storage hook must not break play */ }
    }
  }

  _emit(events) {
    if (this._disposed) return;
    if (events && events.length) this._onEvents(events);
    const snap = getSnapshot(this._state, this.humanId);
    const legal = legalActions(this._state, this.humanId);
    const isYourTurn = !this._state.terminal && legal.length > 0;
    this._onSnapshot(snap, { legal, isYourTurn, canUndo: this.canUndo(), mode: this.mode });
    this._onTurn(isYourTurn);
  }

  /** Kind of pending automatic step, without consuming AI Rng: 'ai' | 'advance' | null. */
  _nextAutoKind() {
    const s = this._state;
    if (!s || s.terminal) return null;
    if (s.phase === 'init' || s.phase === 'handEnd') {
      // Advance automatically when autoAdvance is on, or when the human seat is
      // out of the match (spectating AI-only hands) and cannot send it.
      const humanCanAdvance = legalActions(s, this.humanId).some((a) => a.type === 'advance');
      if (!this.autoAdvance && humanCanAdvance) return null;
      return this._advanceCommand() ? 'advance' : null;
    }
    if (s.currentActor != null) {
      const actor = s.players[s.currentActor];
      if (actor && actor.isAI) return 'ai';
    }
    return null;
  }

  _advanceCommand() {
    const s = this._state;
    for (const p of s.players) {
      if (p.status === 'out') continue;
      const acts = legalActions(s, p.id);
      if (acts.some((a) => a.type === 'advance')) {
        return { id: `auto-${s.tick}-${p.id}`, tick: s.tick, playerId: p.id, type: 'advance' };
      }
    }
    return null;
  }

  _aiCommand() {
    const s = this._state;
    const actor = s.players[s.currentActor];
    const level = this._aiLevel.get(actor.id) || 'easy';
    return chooseAction(s, actor.id, level, this._aiRng);
  }

  /** Perform one automatic step. @returns {boolean} whether anything happened */
  _stepOnce() {
    const kind = this._nextAutoKind();
    if (!kind) return false;
    const cmd = kind === 'advance' ? this._advanceCommand() : this._aiCommand();
    if (!cmd) return false;
    const res = applyCommand(this._state, cmd);
    if (!res.ok) return false; // never spin on a rejected auto command
    this._commit(res, cmd);
    return true;
  }

  _settleSync() {
    let n = 0;
    while (n++ < MAX_SYNC_STEPS) {
      if (this._disposed || this._paused) return;
      if (!this._stepOnce()) return;
    }
  }

  _scheduleNext() {
    if (this._disposed || this._paused) return;
    if (this.aiDelay === 0) {
      this._settleSync();
      return;
    }
    if (this._timers.size > 0) return; // one step already pending
    const kind = this._nextAutoKind();
    if (!kind) return;
    const ms = kind === 'advance' ? this.autoAdvanceDelay : this.aiDelay;
    this._schedule(() => {
      if (this._stepOnce()) this._scheduleNext();
    }, ms);
  }

  _schedule(cb, ms) {
    const t = { handle: null, fireAt: Date.now() + ms, remaining: null, cb };
    t.handle = setTimeout(() => {
      this._timers.delete(t);
      if (this._disposed || this._paused) return;
      cb();
    }, ms);
    this._timers.add(t);
  }

  _clearTimers() {
    for (const t of this._timers) if (t.handle) clearTimeout(t.handle);
    this._timers.clear();
  }
}

/** Standings by chips (ties broken by seat) for non-terminal states. */
function computeStandings(state) {
  return [...state.players]
    .sort((a, b) => b.chips - a.chips || a.seat - b.seat)
    .map((p, i) => ({ id: p.id, name: p.name, chips: p.chips, place: i + 1 }));
}
