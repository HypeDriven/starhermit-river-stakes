// River Stakes — bootstrap + application controller: wires platform, UI, renderer, audio, sessions.
import { Platform } from './platform.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';
import { Renderer } from './render.js';
import { defaultGraphics, resolve as resolveGraphics } from './gfx.js';
import { Session } from './session.js';
import {
  THEMES, TUTORIAL, JOURNEY, CHALLENGES, ACHIEVEMENTS,
  dailyForDate, evaluateGoals, CONTENT_VERSION,
} from './content.js';
import { seedFromString, Rng } from './rules/rng.js';
import { legalActions } from './rules/engine.js';
import { chooseAction } from './rules/ai.js';
import { STORAGE, SAVE_VERSION } from './version.js';
import { T, N, onLanguage } from './lang.js';
import { mergeProgress, mergeBoards } from './merge.js';

const HUMAN_ID = 'you';
const OPPONENT_POOL = [
  ['Moss', 'easy'], ['Silt', 'easy'], ['Wren', 'easy'],
  ['Heron', 'normal'], ['Reed', 'normal'], ['Otter', 'normal'],
  ['Pike', 'hard'], ['Darter', 'hard'],
];
const DIFFICULTY_MIX = {
  easy: ['easy', 'easy', 'easy'],
  normal: ['easy', 'normal', 'normal'],
  hard: ['normal', 'hard', 'hard'],
};

/** "✓ detail  ✗ detail" for evaluated goals, rendered in the current language. */
function goalsLine(goalsEval) {
  if (!goalsEval) return '';
  return () => goalsEval.results.map((r) => (r.ok ? '✓ ' : '✗ ') + (r.detailFn ? r.detailFn() : r.detail)).join('  ');
}

function mergeDeep(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      mergeDeep(target[k], v);
    } else if (v !== undefined) target[k] = v;
  }
  return target;
}

const DEFAULT_SETTINGS = {
  audio: { master: 1, music: 0.7, effects: 0.9, ambience: 0.6, voice: 0.8, muted: false },
  graphics: { tier: 'medium', theme: 'emberdusk', gfx: defaultGraphics() },
  accessibility: {
    reducedMotion: false, highContrast: false, palette: 'default',
    textSize: 'normal', leftHanded: false, hintMode: 'toggle', haptics: true,
  },
  ui: { shortcutHints: true },
  telemetryConsent: false,
};

class App {
  constructor() {
    this.platform = null;
    this.ui = null;
    this.audio = null;
    this.renderer = null;
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.profile = { name: 'Guest' };
    this.progress = {};
    this.game = null;        // active local game context
    this.finished = false;   // terminal/results guard for the active game
    this._hint = null;
    this._constraintTimer = null;
  }

  /* ------------------------------------------------------------- boot */

  async boot() {
    this.platform = await Platform.init();
    this.settings = mergeDeep(structuredClone(DEFAULT_SETTINGS), this.platform.loadSettings());
    this.profile = Object.assign({ name: 'Guest' }, this.platform.loadProfile());
    this.progress = this.platform.loadProgress() || {};
    if (!this.progress.journey) this.progress.journey = { stars: {}, unlocked: 0 };
    if (!this.progress.lifetime) {
      this.progress.lifetime = { hands: 0, handsWon: 0, showdownsWon: 0, potsWon: 0, bestHand: null, journeysCleared: 0, dailiesPlayed: 0 };
    }

    // Hosted: adopt the account nickname and merge the cloud save with local progress.
    if (this.platform.token) {
      try {
        const identity = await this.platform.loadIdentity();
        if (identity && identity.nickname) {
          this.profile.name = identity.nickname;
          this.platform.saveProfile({ name: this.profile.name }); // keep the offline cache coherent
        }
      } catch { /* keep the locally cached name */ }
      try {
        const remote = await this.platform.cloudLoad();
        // Merge with this device's progress; save back when it added anything
        // (an empty slot is seeded from the local copy).
        if (!remote || this._applyCloudDoc(remote)) this._persistCloud();
        this.platform.onConflict(() => this._resolveConflict());
      } catch { /* keep local progress */ }
      // Per-player settings KV: the platform value wins over local values.
      const ps = await this.platform.platformSettings();
      if (Object.keys(ps).length) {
        mergeDeep(this.settings, ps);
        this.platform.saveJSON(STORAGE.settings, this.settings);
      }
      this.platform.settingsSynced(this.settings);
    }
    await this.platform.loadBindings();

    this.audio = new AudioSystem({
      volumes: {
        master: this.settings.audio.master, music: this.settings.audio.music,
        sfx: this.settings.audio.effects, ambience: this.settings.audio.ambience,
        voice: this.settings.audio.voice,
      },
      muted: this.settings.audio.muted,
      humanId: HUMAN_ID,
    });

    this.ui = new UI(document.getElementById('ui'), this._controller());
    this.ui.youId = HUMAN_ID;
    // Language change (Settings → Language or the account preference arriving):
    // re-render the UI and the table view in place, keeping the game running.
    onLanguage(() => this._relabel());
    this.ui.setBindings(this.platform.bindings);
    this.platform.onAuth((a) => {
      if (!a.signedIn) this.ui.announce(this.ui.sh('signedOut'), false);
      this._refreshCaches();
      if (this.ui.screen === 'title' || this.ui.screen === 'profile') this.ui.showScreen(this.ui.screen);
    });
    this.ui.applySettings(this.settings);

    // 3D presentation; the DOM UI is fully usable without it.
    const canvas = document.getElementById('gl');
    try {
      this.renderer = await Renderer.create(canvas, {
        theme: this._currentTheme(),
        graphics: this.settings.graphics.gfx,
        reducedMotion: this.settings.accessibility.reducedMotion,
      });
    } catch { this.renderer = null; }
    if (!this.renderer) this._show3DFallbackNotice();
    this._applyGraphicsAttrs();

    this._applyTheme(this._currentTheme());
    this._wireWindowEvents();
    this.platform.onSyncStatus(() => {
      this._refreshCaches();
      if (this.ui.screen === 'profile') this.ui.showScreen('profile');
    });
    this._refreshCaches();
    this.ui.showScreen('title');
    this.platform.telemetry('start', { mode: this.platform.mode === 'hosted' ? 1 : 0 });

    // Daily card from the device clock's UTC day.
    this._daily = dailyForDate(this.platform.utcToday());
    this._refreshCaches();
  }

  _wireWindowEvents() {
    const unlock = () => {
      this.audio.unlock();
      this.audio.startMusic('menu');
      this.audio.startAmbience(this._currentTheme().id);
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.game && this.game.session) this.game.session.pause(); // solo sim pauses
        if (this.renderer) this.renderer.setPaused(true);
        this.audio.suspend();
        this.platform.flushCloud(); // flush the cloud mirror before we go away
      } else {
        if (this.game && this.game.session) this.game.session.resume();
        if (this.renderer) this.renderer.setPaused(false);
        this.audio.resume();
      }
    });
    window.addEventListener('pagehide', () => this.platform.flushCloud());
    window.addEventListener('resize', () => { if (this.renderer) this.renderer.resize(); });
    window.addEventListener('orientationchange', () => { if (this.renderer) this.renderer.resize(); });

    // Skip/fast-forward: settle all pending AI moves into the exact end state.
    document.addEventListener('keydown', (e) => {
      if (this.platform.actionFor(e.code) === 'skip' && this.ui.screen === 'game' && this.game && this.game.session
          && !e.repeat && !/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) {
        this.game.session.skip();
      }
    });
  }

  _show3DFallbackNotice() {
    const note = document.createElement('div');
    note.className = 'webgl-fallback';
    note.setAttribute('role', 'status');
    note.innerHTML = '3D table unavailable (WebGL not supported) — the full game continues below in accessible table view. ' +
      '<button type="button" class="btn btn-small">Dismiss</button>';
    note.querySelector('button').onclick = () => note.remove();
    document.body.append(note);
    this.ui.announce(T('3D view unavailable; using the accessible table view.'), false);
  }

  /* ------------------------------------------------------------- themes */

  _currentTheme() {
    const wanted = (this.settings.graphics && this.settings.graphics.theme) || 'emberdusk';
    const t = THEMES.find((x) => x.id === wanted);
    if (t && this._themeUnlocked(t)) return t;
    return THEMES.find((x) => x.id === 'emberdusk') || THEMES[0];
  }

  _themeUnlocked(t) {
    if (!t || t.unlock === 'default') return true;
    const u = t.unlock || {};
    if (u.journey != null) {
      const id = 'j' + String(u.journey).padStart(2, '0');
      return (this.progress.journey.stars[id] || 0) > 0;
    }
    if (u.achievement) return !!this.platform.achievements()[u.achievement];
    return false;
  }

  _applyTheme(theme) {
    this.ui.setTheme(theme);
    if (this.renderer) this.renderer.setTheme(theme);
  }

  /* ------------------------------------------------------------- caches */

  _refreshCaches() {
    const lt = this.progress.lifetime;
    this.ui.cache.journey = { stages: JOURNEY, progress: this.progress.journey };
    this.ui.cache.challenges = { challenges: CHALLENGES, completed: this.progress.challenges || {} };
    this.ui.cache.achievements = { list: ACHIEVEMENTS, unlocked: this.platform.achievements() };
    this.ui.cache.profile = {
      name: this.profile.name,
      account: !!(this.platform && this.platform.token),
      sync: this.platform ? this.platform.syncStatus : 'offline',
      stats: {
        handsPlayed: lt.hands, handsWon: lt.handsWon, showdownsWon: lt.showdownsWon,
        potsWon: lt.potsWon, bestHand: lt.bestHand,
        journeysCleared: this.progress.journey ? Object.keys(this.progress.journey.stars).length : 0,
        dailiesPlayed: lt.dailiesPlayed,
        achievements: Object.keys(this.platform.achievements()).length,
      },
    };
    if (this._daily) this.ui.cache.daily = this._daily;
  }

  _saveProgress() {
    this.platform.saveProgress(this.progress);
    this._persistCloud();
    this._refreshCaches();
  }

  /**
   * Merge a cloud-saved doc with the local state (mergeProgress/mergeBoards:
   * nothing either device earned is dropped); localStorage remains the
   * offline cache. Returns true when the local side had something the cloud
   * copy lacked (so the merge should be saved back).
   */
  _applyCloudDoc(doc) {
    let grew = false;
    if (doc.progress && typeof doc.progress === 'object') {
      const local = { ...this.progress, achievements: this.platform.achievements() };
      this.progress = mergeProgress(local, doc.progress);
      grew = JSON.stringify(this.progress) !== JSON.stringify(mergeProgress(doc.progress, doc.progress));
      this.platform.saveJSON(STORAGE.progress, this.progress);
    } else grew = true;
    const boards = mergeBoards(this.platform.loadJSON(STORAGE.boards, {}), doc.boards);
    if (JSON.stringify(boards) !== JSON.stringify(mergeBoards({}, doc.boards))) grew = true;
    this.platform.saveJSON(STORAGE.boards, boards);
    if (!this.platform.userId && doc.profile && typeof doc.profile.name === 'string' && doc.profile.name) {
      this.profile.name = doc.profile.name; // no account identity: restore the cached name
    }
    return grew;
  }

  /** Another device saved since our load: reload the cloud doc, merge it in, save the merge. */
  async _resolveConflict() {
    const doc = await this.platform.cloudLoad().catch(() => null);
    if (doc) this._applyCloudDoc(doc);
    this._refreshCaches();
    if (!this.platform.saveConflicted()) this._persistCloud(0);
  }

  /** Queue a cloud mirror of the save doc (debounced; no-op without a token). */
  _persistCloud(delayMs) {
    if (!this.platform || !this.platform.token) return;
    this.platform.scheduleCloudSave({
      v: SAVE_VERSION,
      savedAt: Date.now(),
      progress: { ...this.progress, achievements: this.platform.achievements() },
      boards: this.platform.loadJSON(STORAGE.boards, {}),
      profile: { name: this.profile.name },
    }, delayMs);
  }

  /* ------------------------------------------------------------- modes */

  _controller() {
    return {
      play: (mode, options) => this.play(mode, options || {}),
      action: (type, amount) => this.action(type, amount),
      advance: () => this.action('advance'),
      undo: () => this.undo(),
      hint: () => this.hint(),
      pauseToggle: () => this.pauseToggle(),
      leaveToTitle: () => this.leaveToTitle(),
      retry: () => this.retry(),
      nextStage: () => this.nextStage(),
      dismissResults: () => {},
      selectJourney: (id) => this.selectJourney(id),
      selectChallenge: (id) => this.selectChallenge(id),
      selectDaily: () => this.selectDaily(),
      saveSettings: (patch) => this.saveSettings(patch),
      graphicsInfo: (words) => this.graphicsInfo(words),
      profileSave: (p) => this.profileSave(p),
      tutorialAck: () => this.tutorialAck(),
      listLessons: () => TUTORIAL.map((l, i) => ({ id: l.id, index: i, title: l.title })),
      listThemes: () => THEMES.map((t) => ({ id: t.id, name: t.name, locked: !this._themeUnlocked(t) })),
      setTheme: (id) => this.setTheme(id),
      loadStandings: () => this.platform.getGlobalBoard({ pageSize: 10 }),
      account: () => ({ signedIn: !!this.platform.token, canSignIn: this.platform.canSignIn() }),
      signIn: () => this.platform.signIn(),
      invite: () => this.invite(),
      actionFor: (code) => this.platform.actionFor(code),
    };
  }

  play(mode, options) {
    if (mode === 'journey') { this.ui.showScreen('journey'); return; }
    if (mode === 'challenge') { this.ui.showScreen('challenges'); return; }
    if (mode === 'daily') { this.ui.showScreen('daily', this._daily); return; }
    if (mode === 'learn') {
      const idx = this._lessonIndex(options);
      this._startLearn(idx);
      return;
    }
    this._startPractice(options);
  }

  _lessonIndex(options) {
    if (options && options.lesson != null) {
      const i = typeof options.lesson === 'number'
        ? options.lesson
        : TUTORIAL.findIndex((l) => l.id === options.lesson);
      return Math.max(0, i);
    }
    // first uncompleted lesson, else 0
    const done = this.progress.tutorial || {};
    const i = TUTORIAL.findIndex((l) => !done[l.id]);
    return i < 0 ? 0 : i;
  }

  _practiceConfig(options) {
    const seed = (seedFromString(String(Date.now())) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const rng = new Rng(seed, 'practice-setup');
    const bb = (options.blinds && options.blinds.bb) || 10;
    const count = Math.min(6, Math.max(2, options.players || 4));
    const mix = DIFFICULTY_MIX[options.difficulty] || DIFFICULTY_MIX.normal;
    const pool = rng.shuffle([...OPPONENT_POOL]);
    const players = [{ id: HUMAN_ID, name: this.profile.name, chips: bb * 50, ai: null }];
    for (let i = 0; i < count - 1; i++) {
      const [name] = pool[i % pool.length];
      players.push({ id: 'ai' + i, name, chips: bb * 50, ai: mix[i % mix.length] });
    }
    return { seed, smallBlind: bb / 2, bigBlind: bb, players, maxHands: 24 };
  }

  _startPractice(options) {
    const config = this._practiceConfig(options);
    this._startLocalGame({
      mode: 'practice',
      config,
      goals: [{ type: 'winMatch' }],
      par: config.maxHands,
      objective: () => T('Win the table — practice match, unranked.'),
      hintsEnabled: options.hints !== false,
      allowUndo: !!options.undo,
      theme: this._currentTheme(),
      options,
    });
  }

  _startLearn(idx) {
    const lesson = TUTORIAL[idx];
    if (!lesson) return;
    this._startLocalGame({
      mode: 'learn',
      config: structuredClone(lesson.config),
      lesson, lessonIndex: idx, stepIndex: 0,
      goals: [], par: null,
      objective: () => `${T(lesson.title)} — ${T(lesson.goal)}`,
      hintsEnabled: true, allowUndo: true,
      theme: this._currentTheme(),
    });
    this.ui.announce(`${T(lesson.title)}. ${T(lesson.body)}`, false);
    this._announceStep();
  }

  selectJourney(id) {
    const stage = JOURNEY.find((s) => s.id === id);
    if (!stage) return;
    const theme = THEMES.find((t) => t.id === stage.theme) || this._currentTheme();
    this._startLocalGame({
      mode: 'journey', stage,
      config: structuredClone(stage.config),
      goals: stage.goals, par: stage.par,
      objective: () => `${stage.index}. ${T(stage.title)} — ${T(stage.desc)}`,
      hintsEnabled: true, allowUndo: false,
      theme,
    });
  }

  selectChallenge(id) {
    const ch = CHALLENGES.find((c) => c.id === id);
    if (!ch) return;
    const theme = THEMES.find((t) => t.id === ch.theme) || this._currentTheme();
    this._startLocalGame({
      mode: 'challenge', challenge: ch,
      config: structuredClone(ch.config),
      goals: ch.goals, par: ch.par, constraint: ch.constraint || null,
      objective: () => `${T(ch.title)} — ${T(ch.desc)}`,
      hintsEnabled: false, allowUndo: false,
      theme,
    });
  }

  selectDaily() {
    if (!this._daily) { this.ui.announce(T('Daily challenge is still loading.'), true); return; }
    const d = this._daily;
    const theme = THEMES.find((t) => t.id === d.theme) || this._currentTheme();
    this._startLocalGame({
      mode: 'daily', daily: d,
      config: structuredClone(d.config),
      goals: d.goals, par: d.par,
      objective: () => T('Daily challenge for {date} — everyone plays this exact deal today.', { date: d.date }),
      hintsEnabled: false, allowUndo: false,
      theme,
    });
  }

  /* ------------------------------------------------------------- local game */

  _startLocalGame(ctx) {
    this._teardownGame();
    this.finished = false;
    this._hint = null;
    this._movesUsed = 0;
    const session = new Session({
      config: ctx.config,
      mode: ctx.mode,
      allowUndo: ctx.allowUndo,
      autoAdvance: true,
      aiDelay: 650,
      humanId: HUMAN_ID,
      onSnapshot: (snap, view) => this._onSnapshot(snap, view),
      onEvents: (events) => this._onEvents(events),
      onTurn: (isHuman) => { if (isHuman) this.audio.play('turn'); },
      saveSnapshot: (state) => this.platform.saveJSON(STORAGE.snapshot, {
        v: SAVE_VERSION, mode: ctx.mode, savedAt: Date.now(), state,
      }),
    });
    this.game = Object.assign({}, ctx, { session });
    this._applyTheme(ctx.theme);
    this.audio.startAmbience(ctx.theme.id);
    this.audio.startMusic('game');
    this.ui.showScreen('game');
    session.start();
    if (ctx.mode === 'challenge' && ctx.constraint && ctx.constraint.type === 'speedTarget') {
      const maxMs = ctx.constraint.maxMs;
      this._constraintTimer = setInterval(() => {
        if (!this.game || this.finished) return;
        if (this.game.session.summary().elapsedMs > maxMs) {
          this._finishLocal({ forceFail: N('Time expired — the clock beat you this run.') });
        }
      }, 1000);
    }
  }

  _onSnapshot(snap, view) {
    if (!this.game || this.finished) {
      if (snap && snap.terminal) this._finishLocal({});
      if (!this.game) return;
    }
    const you = snap.players.find((p) => p.id === HUMAN_ID) || null;
    let legal = view.legal || [];
    const constraint = this.game.constraint;
    if (constraint && (constraint.type === 'noFoldPreflop' || constraint.noFoldPreflop) && snap.phase === 'preflop') {
      legal = legal.filter((a) => a.type !== 'fold');
    }
    const summary = this.game.session.summary();
    const hudView = {
      snapshot: snap,
      legal,
      isYourTurn: view.isYourTurn,
      canUndo: view.canUndo,
      mode: this.game.mode,
      seatedYou: you,
      hintsEnabled: this.game.hintsEnabled,
      hint: this._hintText(),
      objective: this._objectiveText(snap),
      progress: this._progressText(snap, summary),
    };
    this._lastHud = { snap, view: hudView };
    this.ui.updateGame(hudView);
    if (this.renderer && you) this.renderer.showSnapshot(snap, you.seat);
    if (snap.terminal) this._finishLocal({});
  }

  _onEvents(events) {
    this.ui.showEvents(events);
    this.audio.mapEvents(events);
    if (this.renderer) this.renderer.playEvents(events, {});
    if (this.game && this.game.mode === 'learn') this._learnOnEvents(events);
  }

  _objectiveText(snap) {
    const g = this.game;
    if (!g) return '';
    if (g.mode === 'learn') {
      const step = g.lesson.steps[g.stepIndex];
      return T(g.lesson.title) + (step ? ' — ' + T(step.text) : '');
    }
    return typeof g.objective === 'function' ? g.objective() : (g.objective || '');
  }

  /** The hint line in the current language (hints are kept as functions). */
  _hintText() {
    const h = this._hint;
    return typeof h === 'function' ? h() : h;
  }

  /** Language changed: re-render the UI and the table view in place. */
  _relabel() {
    this.ui.relabel();
    const last = this._lastHud;
    if (this.game && !this.finished && last && this.ui.screen === 'game') {
      const snap = this.game.session.snapshot() || last.snap;
      this.ui.updateGame(Object.assign({}, last.view, {
        snapshot: snap, hint: this._hintText(),
        objective: this._objectiveText(snap), progress: this._progressText(snap, this.game.session.summary()),
      }));
    }
  }

  _progressText(snap, summary) {
    const g = this.game;
    if (!g) return '';
    const parts = [];
    parts.push(snap.config.maxHands ? T('Hand {n} of {total}', { n: snap.handNumber || 0, total: snap.config.maxHands }) : T('Hand {n}', { n: snap.handNumber || 0 }));
    const you = snap.players.find((p) => p.id === HUMAN_ID);
    if (you) parts.push(T('Your stack: {n}', { n: you.chips }));
    const st = (snap.stats || {})[HUMAN_ID];
    if (st && st.handsWon) parts.push(T('Hands won: {n}', { n: st.handsWon }));
    if (g.mode === 'challenge' && g.constraint) {
      const c = g.constraint;
      if (c.type === 'moveLimit' || c.moveLimit) {
        parts.push(T('Actions left: {n}', { n: Math.max(0, (c.moves || c.moveLimit) - this._movesUsed) }));
      }
      if (c.type === 'speedTarget') {
        const left = Math.max(0, c.maxMs - summary.elapsedMs);
        parts.push(T('Time left: {time}', { time: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` }));
      }
    }
    return parts.join(' · ');
  }

  /* ------------------------------------------------------------- actions */

  action(type, amount) {
    const g = this.game;
    if (!g || !g.session || this.finished) return;
    const snap = g.session.snapshot();
    if (!snap) return;

    if (type === 'advance') {
      if (g.mode === 'learn') this._learnOnAction('advance');
      const advRes = g.session.dispatch('advance');
      this.audio.play('click');
      return advRes;
    }

    // Challenge constraints
    const c = g.constraint;
    if (c && (c.type === 'noFoldPreflop' || c.noFoldPreflop) && type === 'fold' && snap.phase === 'preflop') {
      this.ui.announce(T('Folding before the flop is not allowed in this challenge.'), true);
      this.audio.play('error');
      return { ok: false, error: { code: 'CONSTRAINT', message: 'noFoldPreflop' } };
    }
    if (c && (c.type === 'moveLimit' || c.moveLimit)) {
      const limit = c.moves || c.moveLimit;
      if (this._movesUsed >= limit) {
        const legal = legalActions(snap, HUMAN_ID);
        const auto = legal.find((a) => a.type === 'check') || legal.find((a) => a.type === 'fold');
        if (!auto) return;
        this.ui.announce(T('Action limit reached — the table plays the safest move for you.'), true);
        type = auto.type;
        amount = auto.amount;
      }
    }

    if (g.mode === 'learn') this._learnOnAction(type);
    const res = g.session.dispatch(type, amount);
    if (!res.ok) {
      this.ui.announce(T('Cannot {action}: {reason}', { action: T(type), reason: res.error.message }), true);
      this.audio.play('error');
    } else {
      this._movesUsed++;
      this._hint = null;
      this.audio.play('click');
    }
    return res;
  }

  undo() {
    if (!this.game || !this.game.session) return;
    const ok = this.game.session.undo();
    this.ui.announce(ok ? T('Undone — back to your previous decision.') : T('Nothing to undo.'), !ok);
    if (ok) this.audio.play('click');
  }

  hint() {
    const g = this.game;
    if (!g || !g.session) return;
    const snap = g.session.snapshot();
    const legal = legalActions(snap, HUMAN_ID);
    let text = null;
    if (g.mode === 'learn') {
      const step = g.lesson.steps[g.stepIndex];
      if (step && typeof step.hint === 'function') {
        try { if (step.hint(snap, legal)) text = () => step.hint(snap, legal); } catch { text = null; }
      }
    }
    if (!text) {
      try {
        const rng = new Rng((snap.seed ^ snap.tick) >>> 0, 'hint');
        const pick = chooseAction(snap, HUMAN_ID, 'normal', rng);
        const call = legal.find((a) => a.type === 'call');
        const check = legal.find((a) => a.type === 'check');
        if (pick && pick.type === 'call' && call) text = () => T('Consider calling {n} to stay in the hand.', { n: call.amount });
        else if (pick && (pick.type === 'bet' || pick.type === 'raise')) text = () => T('Your hand has some strength — a bet could build the pot.');
        else if (pick && pick.type === 'fold') text = () => T('This hand looks weak for the price — folding is reasonable.');
        else if (check) text = () => T('No bet is live — checking costs nothing.');
      } catch { text = null; }
    }
    this._hint = text || (() => T('Watch the pot size and your position before acting.'));
    const you = snap.players.find((p) => p.id === HUMAN_ID) || null;
    this.ui.updateGame({
      snapshot: snap, legal, isYourTurn: legal.length > 0,
      canUndo: g.session.canUndo(), mode: g.mode, seatedYou: you,
      hintsEnabled: g.hintsEnabled, hint: this._hintText(),
      objective: this._objectiveText(snap), progress: this._progressText(snap, g.session.summary()),
    });
  }

  pauseToggle() {
    if (this.game && this.game.session) {
      if (this.game.session.paused) this.game.session.resume();
      else this.game.session.pause();
    }
  }

  /* ------------------------------------------------------------- learn flow */

  _announceStep() {
    const g = this.game;
    if (!g || g.mode !== 'learn') return;
    const step = g.lesson.steps[g.stepIndex];
    if (step) {
      const snap = g.session.snapshot();
      const legal = legalActions(snap, HUMAN_ID);
      this._hint = typeof step.hint === 'function'
        ? () => { try { return step.hint(snap, legal); } catch { return null; } }
        : null;
      this.ui.announce(T(step.text), false);
      this.platform.telemetry('tutorial_step', { step: g.stepIndex });
    }
  }

  _learnAdvanceStep() {
    const g = this.game;
    if (!g || g.mode !== 'learn') return;
    g.stepIndex++;
    if (g.stepIndex >= g.lesson.steps.length) {
      const done = Object.assign({}, this.progress.tutorial, { [g.lesson.id]: true });
      this.progress.tutorial = done;
      this._saveProgress();
      this.platform.telemetry('tutorial_step', { step: 99 });
      // Let the current hand finish naturally; mark lesson complete.
      this.ui.announce(T('{title} complete. Finish the hand or leave when ready.', { title: T(g.lesson.title) }), false);
      this.audio.play('win');
      g.lessonComplete = true;
    } else {
      this._announceStep();
    }
  }

  _learnOnAction(type) {
    const g = this.game;
    const step = g && g.lesson && g.lesson.steps[g.stepIndex];
    if (step && step.requireAction && step.requireAction === type) this._learnAdvanceStep();
  }

  _learnOnEvents(events) {
    const g = this.game;
    if (!g || g.lessonComplete) return;
    const step = g.lesson.steps[g.stepIndex];
    if (step && step.requireEvent && events.some((e) => e.type === step.requireEvent)) {
      this._learnAdvanceStep();
    }
  }

  tutorialAck() {
    if (this.game && this.game.mode === 'learn') this._learnAdvanceStep();
  }

  /* ------------------------------------------------------------- results */

  async _finishLocal({ forceFail }) {
    if (!this.game || this.finished) return;
    const snap = this.game.session.snapshot();
    if (!snap.terminal && !forceFail && !this.game.lessonComplete) return;
    this.finished = true;
    if (this._constraintTimer) { clearInterval(this._constraintTimer); this._constraintTimer = null; }

    const g = this.game;
    const summary = g.session.summary();
    const goalsEval = g.goals && g.goals.length ? evaluateGoals(g.goals, summary, HUMAN_ID) : null;
    const passed = forceFail ? false : (goalsEval ? goalsEval.passed : true);
    const terminal = snap.terminal;
    const standing = terminal && terminal.standings
      ? terminal.standings.find((s) => s.id === HUMAN_ID) : null;
    const stats = (snap.stats || {})[HUMAN_ID] || {};

    // Lifetime progress
    const lt = this.progress.lifetime;
    lt.hands += summary.handsPlayed;
    lt.handsWon += stats.handsWon || 0;
    lt.showdownsWon += stats.showdownsWon || 0;
    lt.potsWon += stats.potsWon || 0;
    if (stats.bestHand && !lt.bestHand) lt.bestHand = stats.bestHand;

    // Collect candidate unlocks first, then await them before showResults so
    // freshly earned achievements actually appear on the results screen.
    const pendingUnlocks = [];
    const unlock = (key) => { if (!pendingUnlocks.includes(key)) pendingUnlocks.push(key); };

    let stars = 0;
    let progress = null;
    let canNext = false;
    let headline;

    if (g.mode === 'journey') {
      if (passed) {
        stars = 1;
        if (standing && standing.place === 1) stars++;
        if (summary.handsPlayed <= (g.par || Infinity)) stars++;
        const prev = this.progress.journey.stars[g.stage.id] || 0;
        this.progress.journey.stars[g.stage.id] = Math.max(prev, stars);
        this.progress.journey.unlocked = Math.max(this.progress.journey.unlocked, g.stage.index);
        lt.journeysCleared = Object.keys(this.progress.journey.stars).length;
        unlock('first_flow');
        if (g.stage.mastery) unlock('mechanic_master');
        if (g.stage.id === 'j40') unlock('estuary_champion');
      }
      headline = passed
        ? (stars >= 3 ? N('Flawless waters — stage mastered!') : N('Stage complete!'))
        : (forceFail || N('The river takes this one — stage goals unmet.'));
      progress = {
        stars,
        goalsPassed: goalsEval ? goalsEval.results.filter((r) => r.ok).length : 0,
        goalsTotal: g.goals.length,
        text: goalsLine(goalsEval),
      };
      const nextIdx = g.stage.index; // index is 1-based; next stage = same index in array
      canNext = passed && nextIdx < JOURNEY.length;
      this._nextUp = canNext ? JOURNEY[nextIdx] : null;
    } else if (g.mode === 'daily') {
      lt.dailiesPlayed++;
      this._updateDailyStreak(g.daily.date, unlock);
      const value = standing ? standing.chips : ((summary.goalsContext.finalChips || {})[HUMAN_ID] || 0);
      this.platform.submitScore(`daily:${g.daily.date}`, {
        value, ruleset: 'fixed-limit', contentVersion: CONTENT_VERSION,
        seed: g.daily.seed, assists: [], durationMs: summary.elapsedMs,
      });
      this._persistCloud();
      headline = passed ? N('Daily challenge complete!') : (forceFail || N('Daily challenge finished — goals unmet.'));
      const date = g.daily.date;
      progress = {
        goalsPassed: goalsEval ? goalsEval.results.filter((r) => r.ok).length : 0,
        goalsTotal: g.goals.length,
        text: () => T('Result recorded for {date}: {n} chips.', { date, n: value }),
      };
    } else if (g.mode === 'challenge') {
      if (passed) {
        this.progress.challenges = Object.assign({}, this.progress.challenges, { [g.challenge.id]: true });
      }
      headline = passed ? N('Challenge cleared!') : (forceFail || N('Challenge failed — try a different line.'));
      progress = {
        goalsPassed: goalsEval ? goalsEval.results.filter((r) => r.ok).length : 0,
        goalsTotal: g.goals.length,
        text: goalsLine(goalsEval),
      };
    } else if (g.mode === 'learn') {
      const lessonTitle = g.lesson.title;
      headline = g.lessonComplete ? () => T('Lesson complete: {title}', { title: T(lessonTitle) }) : N('Lesson ended.');
      const nextIdx = g.lessonIndex + 1;
      canNext = g.lessonComplete && nextIdx < TUTORIAL.length;
      this._nextUp = canNext ? { lesson: TUTORIAL[nextIdx], index: nextIdx } : null;
      progress = { text: g.lessonComplete ? () => T('All steps performed. Well played.') : () => T('You left before finishing every step.') };
    } else {
      headline = standing && standing.place === 1 ? N('You win the table!') : N('Match over.');
      progress = { text: () => T('Practice is unranked — play with the assists you like.') };
    }
    const headlineKey = headline;
    headline = typeof headlineKey === 'function' ? headlineKey : () => T(headlineKey);

    if (lt.hands >= 1000) unlock('thousand_hands');
    this._saveProgress();
    this.platform.telemetry('round_end', { hands: summary.handsPlayed });

    let newAchievements = [];
    try {
      const results = await Promise.allSettled(pendingUnlocks.map((key) => this.platform.unlockAchievement(key)));
      newAchievements = pendingUnlocks.filter((_, i) => results[i].status === 'fulfilled' && results[i].value);
    } catch { /* an unlock failure must not block the results screen */ }
    this._refreshCaches();
    if (this.game !== g || !this.finished) return;

    const MODE_NAMES = { learn: N('Learn'), journey: N('Journey'), daily: N('Daily'), practice: N('Practice'), challenge: N('Challenge') };
    const place = standing ? { place: standing.place, total: terminal.standings.length } : null;
    const breakdown = [
      { label: () => T('Mode'), value: () => T(MODE_NAMES[g.mode] || g.mode) },
      { label: () => T('Hands played'), value: summary.handsPlayed },
      { label: () => T('Hands won'), value: stats.handsWon || 0 },
      { label: () => T('Showdowns won'), value: stats.showdownsWon || 0 },
      { label: () => T('Final chips'), value: standing ? standing.chips : '—' },
      { label: () => T('Place'), value: place ? () => T('#{place} of {total}', place) : '—' },
      { label: () => T('Invalid actions'), value: summary.invalidActions },
      { label: () => T('Time'), value: `${Math.floor(summary.elapsedMs / 60000)}:${String(Math.floor((summary.elapsedMs % 60000) / 1000)).padStart(2, '0')}` },
    ];
    const par = g.par, played = summary.handsPlayed;
    const comparison = par != null
      ? () => T('Par for this table is {par} hands — you played {n}.', { par, n: played })
      : null;
    const nextStage = g.mode === 'journey' && canNext ? { n: g.stage.index + 1, title: JOURNEY[g.stage.index].title } : null;
    const recKey = g.mode === 'journey'
      ? (passed ? (canNext ? null : N('Journey complete — try the daily challenge!'))
        : N('Retry the stage — hints are on, and the deal is identical every attempt.'))
      : g.mode === 'learn'
        ? (canNext ? N('Next lesson introduces the next rule.') : N('All lessons done — the Journey awaits.'))
        : g.mode === 'daily'
          ? N('Come back tomorrow for a fresh deal, or warm up in Practice.')
          : N('Try a Journey stage or a Challenge for a sterner test.');
    const recommendation = nextStage
      ? () => T('Continue to stage {n}: {title}.', { n: nextStage.n, title: T(nextStage.title) })
      : () => T(recKey);

    // Signed in: ranked tables (Daily, Challenge) post their final chips to the platform board.
    const postLb = (g.mode === 'daily' || g.mode === 'challenge') && !!this.platform.token;
    this.audio.startMusic('results');
    this.ui.showResults({
      headline, breakdown, progress,
      achievements: newAchievements,
      comparison, leaderboard: postLb,
      canRetry: true, canNext,
      recommendation,
    });
    if (postLb) {
      const chips = standing ? standing.chips : ((summary.goalsContext.finalChips || {})[HUMAN_ID] || 0);
      this.platform.postHighScore(chips).then((r) => {
        if (this.game === g && this.ui.screen === 'results') this.ui.setResultsLeaderboard(r);
      });
    }
    this.ui.announce(headline(), true);
  }

  _updateDailyStreak(today, unlock) {
    const d = this.progress.daily || { lastDate: null, streak: 0 };
    if (d.lastDate === today) return;
    const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    d.streak = d.lastDate === yesterday ? d.streak + 1 : 1;
    d.lastDate = today;
    this.progress.daily = d;
    if (d.streak >= 7 && typeof unlock === 'function') unlock('steady_current');
  }

  retry() {
    const g = this.game;
    this.platform.telemetry('retry', {});
    if (!g) { this.ui.showScreen('modes'); return; }
    if (g.mode === 'practice') return this._startPractice(g.options || {});
    if (g.mode === 'journey') return this.selectJourney(g.stage.id);
    if (g.mode === 'daily') return this.selectDaily();
    if (g.mode === 'challenge') return this.selectChallenge(g.challenge.id);
    if (g.mode === 'learn') return this._startLearn(g.lessonIndex);
    this.ui.showScreen('modes');
  }

  nextStage() {
    const up = this._nextUp;
    if (!up) { this.ui.showScreen('title'); return; }
    if (up.lesson) return this._startLearn(up.index);
    if (up.id) return this.selectJourney(up.id);
    this.ui.showScreen('title');
  }

  leaveToTitle() {
    this._teardownGame();
    this._applyTheme(this._currentTheme());
    this.audio.startMusic('menu');
    this._refreshCaches();
    this.ui.showScreen('title');
  }

  _teardownGame() {
    if (this._constraintTimer) { clearInterval(this._constraintTimer); this._constraintTimer = null; }
    if (this.game && this.game.session) this.game.session.dispose();
    this.game = null;
    this.audio.humanId = HUMAN_ID;
    this.finished = false;
    this._hint = null;
    this._nextUp = null;
  }

  /* ------------------------------------------------------------- settings & profile */

  saveSettings(patch) {
    mergeDeep(this.settings, patch);
    this.platform.saveSettings(this.settings);
    this._persistCloud();
    const a = this.settings.audio;
    this.audio.setVolume('master', a.master);
    this.audio.setVolume('music', a.music);
    this.audio.setVolume('sfx', a.effects);
    this.audio.setVolume('ambience', a.ambience);
    this.audio.setVolume('voice', a.voice);
    this.audio.setMuted(a.muted);
    if (this.renderer) {
      if (patch.graphics && patch.graphics.gfx) this.renderer.setGraphics(this.settings.graphics.gfx);
      this.renderer.setReducedMotion(this.settings.accessibility.reducedMotion);
    }
    if (patch.graphics && patch.graphics.gfx) this._applyGraphicsAttrs();
    if (patch.graphics && patch.graphics.theme) this.setTheme(patch.graphics.theme);
    this.platform.telemetry('settings_change', {});
  }

  /** Resolved graphics tiers on <html> (DOM board detail + test hooks), with or without WebGL. */
  _applyGraphicsAttrs() {
    const g = this.renderer ? this.renderer.q : resolveGraphics(this.settings.graphics.gfx, 'balanced');
    const root = document.documentElement;
    root.dataset.gfxPreset = g.preset;
    root.dataset.gfxDetail = g.detail;
  }

  /** Settings panel data: GPU, detected preset, resolved tiers, cost summary. */
  graphicsInfo(words) {
    if (this.renderer) return this.renderer.graphicsInfo(words);
    return { gpu: '', detected: 'balanced', resolved: resolveGraphics(this.settings.graphics.gfx, 'balanced'), summary: '', no3d: true, postFailed: false };
  }

  setTheme(id) {
    const t = THEMES.find((x) => x.id === id);
    if (!t) return;
    if (!this._themeUnlocked(t)) {
      this.ui.announce(T('{name} is locked — keep playing to unlock it.', { name: T(t.name) }), true);
      return;
    }
    this.settings.graphics.theme = id;
    this.platform.saveSettings(this.settings);
    this._applyTheme(t);
    this.audio.startAmbience(id);
    this.ui.announce(T('Theme: {name}.', { name: T(t.name) }), false);
  }

  async invite() {
    const url = this.platform.inviteLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.ui.notify(this.ui.sh('inviteCopied'));
    } catch {
      this.ui.notify(this.ui.sh('inviteLink', { url }));
    }
  }

  profileSave(p) {
    // On-platform the table name comes from the StarHermit account nickname.
    if (this.platform.token) {
      this.ui.announce(T('Your table name comes from your StarHermit account.'), false);
      return;
    }
    if (p && p.name) {
      this.profile.name = p.name.slice(0, 24);
      this.platform.saveProfile({ name: this.profile.name });
      this._persistCloud();
      this._refreshCaches();
      this.ui.announce(T('Profile saved.'), false);
      this.audio.play('notify');
    }
  }
}

/* ------------------------------------------------------------- bootstrap */

async function boot() {
  const app = new App();
  window.__riverStakes = app; // debugging handle
  try {
    await app.boot();
  } catch (err) {
    const el = document.getElementById('ui') || document.body;
    const msg = document.createElement('div');
    msg.setAttribute('role', 'alert');
    msg.style.cssText = 'padding:2rem;font-family:system-ui;color:#fff;background:#33110f;';
    msg.textContent = T('River Stakes failed to start: {reason}', { reason: (err && err.message) || err });
    el.append(msg);
    throw err;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

export { App, boot };
