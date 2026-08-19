// River Stakes — bootstrap + application controller: wires platform, UI, renderer, audio, sessions.
import { Platform, HostedClient } from './platform.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';
import { Renderer } from './render.js';
import { Session } from './session.js';
import {
  THEMES, TUTORIAL, JOURNEY, CHALLENGES, ACHIEVEMENTS,
  dailyForDate, evaluateGoals, CONTENT_VERSION,
} from './content.js';
import { seedFromString, Rng } from './rules/rng.js';
import { legalActions } from './rules/engine.js';
import { chooseAction } from './rules/ai.js';
import { STORAGE, SAVE_VERSION } from './version.js';

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
  graphics: { tier: 'medium', theme: 'emberdusk' },
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
    this.hosted = null;      // active hosted context { client, code, snapshot, isHost }
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

    this.audio = new AudioSystem({
      volumes: {
        master: this.settings.audio.master, music: this.settings.audio.music,
        sfx: this.settings.audio.effects, ambience: this.settings.audio.ambience,
        voice: this.settings.audio.voice,
      },
      muted: this.settings.audio.muted,
    });

    this.ui = new UI(document.getElementById('ui'), this._controller());
    this.ui.youId = HUMAN_ID;
    this.ui.applySettings(this.settings);

    // 3D presentation; the DOM UI is fully usable without it.
    const canvas = document.getElementById('gl');
    try {
      this.renderer = await Renderer.create(canvas, {
        theme: this._currentTheme(),
        quality: this.settings.graphics.tier,
        reducedMotion: this.settings.accessibility.reducedMotion,
      });
    } catch { this.renderer = null; }
    if (!this.renderer) this._show3DFallbackNotice();

    this._applyTheme(this._currentTheme());
    this._wireWindowEvents();
    this._refreshCaches();
    this.ui.showScreen('title');
    this.platform.telemetry('start', { mode: this.platform.mode === 'hosted' ? 1 : 0 });

    // Pre-compute the daily card (server-time synchronized).
    this.platform.utcToday().then((today) => {
      this._daily = dailyForDate(today);
      this._refreshCaches();
    }).catch(() => {});
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
      } else {
        if (this.game && this.game.session) this.game.session.resume();
        if (this.renderer) this.renderer.setPaused(false);
        this.audio.resume();
      }
    });
    window.addEventListener('resize', () => { if (this.renderer) this.renderer.resize(); });
    window.addEventListener('orientationchange', () => { if (this.renderer) this.renderer.resize(); });

    // Skip/fast-forward: settle all pending AI moves into the exact end state.
    document.addEventListener('keydown', (e) => {
      if (e.key === 's' && this.ui.screen === 'game' && this.game && this.game.session
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
    this.ui.announce('3D view unavailable; using the accessible table view.', false);
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
    this._refreshCaches();
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
      profileSave: (p) => this.profileSave(p),
      tutorialAck: () => this.tutorialAck(),
      listLessons: () => TUTORIAL.map((l, i) => ({ id: l.id, index: i, title: `${i + 1}. ${l.title}` })),
      listThemes: () => THEMES.map((t) => ({ id: t.id, name: t.name, locked: !this._themeUnlocked(t) })),
      setTheme: (id) => this.setTheme(id),
      hostedCreate: (opts) => this.hostedCreate(opts || {}),
      hostedJoin: (code) => this.hostedJoin(code),
      hostedReady: (b) => this.hostedReady(b),
      hostedChat: (text) => this.hostedChat(text),
      hostedLeave: () => this.hostedLeave(),
    };
  }

  play(mode, options) {
    if (mode === 'journey') { this.ui.showScreen('journey'); return; }
    if (mode === 'challenge') { this.ui.showScreen('challenges'); return; }
    if (mode === 'daily') { this.ui.showScreen('daily', this._daily); return; }
    if (mode === 'hosted') { this.ui.showScreen('setup', { mode: 'hosted' }); return; }
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
      objective: 'Win the table — practice match, unranked.',
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
      objective: `${lesson.title} — ${lesson.goal}`,
      hintsEnabled: true, allowUndo: true,
      theme: this._currentTheme(),
    });
    this.ui.announce(`${lesson.title}. ${lesson.body}`, false);
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
      objective: `${stage.index}. ${stage.title} — ${stage.desc}`,
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
      objective: `${ch.title} — ${ch.desc}`,
      hintsEnabled: false, allowUndo: false,
      theme,
    });
  }

  selectDaily() {
    if (!this._daily) { this.ui.announce('Daily challenge is still loading.', true); return; }
    const d = this._daily;
    const theme = THEMES.find((t) => t.id === d.theme) || this._currentTheme();
    this._startLocalGame({
      mode: 'daily', daily: d,
      config: structuredClone(d.config),
      goals: d.goals, par: d.par,
      objective: `Daily challenge for ${d.date} — everyone plays this exact deal today.`,
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
    this.platform.activityStart(ctx.mode);
    this.platform.presenceStart({ mode: ctx.mode });
    this.ui.showScreen('game');
    session.start();
    if (ctx.mode === 'challenge' && ctx.constraint && ctx.constraint.type === 'speedTarget') {
      const maxMs = ctx.constraint.maxMs;
      this._constraintTimer = setInterval(() => {
        if (!this.game || this.finished) return;
        if (this.game.session.summary().elapsedMs > maxMs) {
          this._finishLocal({ forceFail: 'Time expired — the clock beat you this run.' });
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
      hint: this._hint,
      objective: this._objectiveText(snap),
      progress: this._progressText(snap, summary),
    };
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
      return g.lesson.title + (step ? ' — ' + step.text : '');
    }
    return g.objective || '';
  }

  _progressText(snap, summary) {
    const g = this.game;
    if (!g) return '';
    const parts = [];
    parts.push(`Hand ${snap.handNumber || 0}` + (snap.config.maxHands ? ` of ${snap.config.maxHands}` : ''));
    const you = snap.players.find((p) => p.id === HUMAN_ID);
    if (you) parts.push(`Your stack: ${you.chips}`);
    const st = (snap.stats || {})[HUMAN_ID];
    if (st && st.handsWon) parts.push(`Hands won: ${st.handsWon}`);
    if (g.mode === 'challenge' && g.constraint) {
      const c = g.constraint;
      if (c.type === 'moveLimit' || c.moveLimit) {
        parts.push(`Actions left: ${Math.max(0, (c.moves || c.moveLimit) - this._movesUsed)}`);
      }
      if (c.type === 'speedTarget') {
        const left = Math.max(0, c.maxMs - summary.elapsedMs);
        parts.push(`Time left: ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`);
      }
    }
    return parts.join(' · ');
  }

  /* ------------------------------------------------------------- actions */

  action(type, amount) {
    if (this.hosted) return this._hostedAction(type, amount);
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
      this.ui.announce('Folding before the flop is not allowed in this challenge.', true);
      this.audio.play('error');
      return { ok: false, error: { code: 'CONSTRAINT', message: 'noFoldPreflop' } };
    }
    if (c && (c.type === 'moveLimit' || c.moveLimit)) {
      const limit = c.moves || c.moveLimit;
      if (this._movesUsed >= limit) {
        const legal = legalActions(snap, HUMAN_ID);
        const auto = legal.find((a) => a.type === 'check') || legal.find((a) => a.type === 'fold');
        if (!auto) return;
        this.ui.announce('Action limit reached — the table plays the safest move for you.', true);
        type = auto.type;
        amount = auto.amount;
      }
    }

    if (g.mode === 'learn') this._learnOnAction(type);
    const res = g.session.dispatch(type, amount);
    if (!res.ok) {
      this.ui.announce(`Cannot ${type}: ${res.error.message}`, true);
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
    this.ui.announce(ok ? 'Undone — back to your previous decision.' : 'Nothing to undo.', !ok);
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
        try { text = step.hint(snap, legal); } catch { text = null; }
      }
    }
    if (!text) {
      try {
        const rng = new Rng((snap.seed ^ snap.tick) >>> 0, 'hint');
        const pick = chooseAction(snap, HUMAN_ID, 'normal', rng);
        const call = legal.find((a) => a.type === 'call');
        const check = legal.find((a) => a.type === 'check');
        if (pick && pick.type === 'call' && call) text = `Consider calling ${call.amount} to stay in the hand.`;
        else if (pick && (pick.type === 'bet' || pick.type === 'raise')) text = 'Your hand has some strength — a bet could build the pot.';
        else if (pick && pick.type === 'fold') text = 'This hand looks weak for the price — folding is reasonable.';
        else if (check) text = 'No bet is live — checking costs nothing.';
      } catch { text = null; }
    }
    this._hint = text || 'Watch the pot size and your position before acting.';
    const you = snap.players.find((p) => p.id === HUMAN_ID) || null;
    this.ui.updateGame({
      snapshot: snap, legal, isYourTurn: legal.length > 0,
      canUndo: g.session.canUndo(), mode: g.mode, seatedYou: you,
      hintsEnabled: g.hintsEnabled, hint: this._hint,
      objective: this._objectiveText(snap), progress: this._progressText(snap, g.session.summary()),
    });
  }

  pauseToggle() {
    if (this.game && this.game.session && !this.hosted) {
      if (this.game.session.paused) this.game.session.resume();
      else this.game.session.pause();
    }
    // Hosted play: the authoritative clock keeps running; pause is cosmetic only.
  }

  /* ------------------------------------------------------------- learn flow */

  _announceStep() {
    const g = this.game;
    if (!g || g.mode !== 'learn') return;
    const step = g.lesson.steps[g.stepIndex];
    if (step) {
      this._hint = typeof step.hint === 'function'
        ? (() => { try { return step.hint(g.session.snapshot(), legalActions(g.session.snapshot(), HUMAN_ID)); } catch { return null; } })()
        : null;
      this.ui.announce(step.text, false);
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
      this.ui.announce(`${g.lesson.title} complete. Finish the hand or leave when ready.`, false);
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

  _finishLocal({ forceFail }) {
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

    const newAchievements = [];
    const unlock = (key) => {
      this.platform.unlockAchievement(key).then((fresh) => { if (fresh) newAchievements.push(key); });
    };

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
        ? (stars >= 3 ? 'Flawless waters — stage mastered!' : 'Stage complete!')
        : (forceFail || 'The river takes this one — stage goals unmet.');
      progress = {
        stars,
        goalsPassed: goalsEval ? goalsEval.results.filter((r) => r.ok).length : 0,
        goalsTotal: g.goals.length,
        text: goalsEval ? goalsEval.results.map((r) => (r.ok ? '✓ ' : '✗ ') + r.detail).join('  ') : '',
      };
      const nextIdx = g.stage.index; // index is 1-based; next stage = same index in array
      canNext = passed && nextIdx < JOURNEY.length;
      this._nextUp = canNext ? JOURNEY[nextIdx] : null;
    } else if (g.mode === 'daily') {
      lt.dailiesPlayed++;
      this._updateDailyStreak(g.daily.date);
      const value = standing ? standing.chips : ((summary.goalsContext.finalChips || {})[HUMAN_ID] || 0);
      this.platform.submitScore(`daily:${g.daily.date}`, {
        value, ruleset: 'fixed-limit', contentVersion: CONTENT_VERSION,
        seed: g.daily.seed, assists: [], durationMs: summary.elapsedMs,
      });
      unlock('steady_current');
      headline = passed ? 'Daily challenge complete!' : (forceFail || 'Daily challenge finished — goals unmet.');
      progress = {
        goalsPassed: goalsEval ? goalsEval.results.filter((r) => r.ok).length : 0,
        goalsTotal: g.goals.length,
        text: `Score submitted for ${g.daily.date}: ${value} chips.`,
      };
    } else if (g.mode === 'challenge') {
      if (passed) {
        this.progress.challenges = Object.assign({}, this.progress.challenges, { [g.challenge.id]: true });
      }
      headline = passed ? 'Challenge cleared!' : (forceFail || 'Challenge failed — try a different line.');
      progress = {
        goalsPassed: goalsEval ? goalsEval.results.filter((r) => r.ok).length : 0,
        goalsTotal: g.goals.length,
        text: goalsEval ? goalsEval.results.map((r) => (r.ok ? '✓ ' : '✗ ') + r.detail).join('  ') : '',
      };
    } else if (g.mode === 'learn') {
      headline = g.lessonComplete ? `Lesson complete: ${g.lesson.title}` : 'Lesson ended.';
      const nextIdx = g.lessonIndex + 1;
      canNext = g.lessonComplete && nextIdx < TUTORIAL.length;
      this._nextUp = canNext ? { lesson: TUTORIAL[nextIdx], index: nextIdx } : null;
      progress = { text: g.lessonComplete ? 'All steps performed. Well played.' : 'You left before finishing every step.' };
    } else {
      headline = standing && standing.place === 1 ? 'You win the table!' : 'Match over.';
      progress = { text: 'Practice is unranked — play with the assists you like.' };
    }

    if (lt.hands >= 1000) unlock('thousand_hands');
    this._saveProgress();
    this.platform.telemetry('round_end', { hands: summary.handsPlayed });
    this.platform.activityEnd();
    this.platform.presenceStop();

    const breakdown = [
      { label: 'Mode', value: g.mode },
      { label: 'Hands played', value: summary.handsPlayed },
      { label: 'Hands won', value: stats.handsWon || 0 },
      { label: 'Showdowns won', value: stats.showdownsWon || 0 },
      { label: 'Final chips', value: standing ? standing.chips : '—' },
      { label: 'Place', value: standing ? `#${standing.place} of ${terminal.standings.length}` : '—' },
      { label: 'Invalid actions', value: summary.invalidActions },
      { label: 'Time', value: `${Math.floor(summary.elapsedMs / 60000)}:${String(Math.floor((summary.elapsedMs % 60000) / 1000)).padStart(2, '0')}` },
    ];
    const comparison = g.par != null
      ? `Par for this table is ${g.par} hands — you played ${summary.handsPlayed}.`
      : null;
    const recommendation = g.mode === 'journey'
      ? (passed ? (canNext ? `Continue to stage ${g.stage.index + 1}: ${JOURNEY[g.stage.index].title}.` : 'Journey complete — try the daily challenge!')
        : 'Retry the stage — hints are on, and the deal is identical every attempt.')
      : g.mode === 'learn'
        ? (canNext ? 'Next lesson introduces the next rule.' : 'All lessons done — the Journey awaits.')
        : g.mode === 'daily'
          ? 'Come back tomorrow for a fresh deal, or warm up in Practice.'
          : 'Try a Journey stage or a Challenge for a sterner test.';

    this.audio.startMusic('results');
    this.ui.showResults({
      headline, breakdown, progress,
      achievements: newAchievements,
      comparison,
      canRetry: true, canNext,
      recommendation,
    });
    this.ui.announce(headline, true);
  }

  _updateDailyStreak(today) {
    const d = this.progress.daily || { lastDate: null, streak: 0 };
    if (d.lastDate === today) return;
    const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    d.streak = d.lastDate === yesterday ? d.streak + 1 : 1;
    d.lastDate = today;
    this.progress.daily = d;
    if (d.streak >= 7) this.platform.unlockAchievement('steady_current');
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
    if (this.hosted && this.hosted.client) { try { this.hosted.client.leave(); } catch {} }
    this.game = null;
    this.hosted = null;
    this.finished = false;
    this._hint = null;
    this._nextUp = null;
    this.platform.activityEnd();
    this.platform.presenceStop();
  }

  /* ------------------------------------------------------------- settings & profile */

  saveSettings(patch) {
    mergeDeep(this.settings, patch);
    this.platform.saveSettings(this.settings);
    const a = this.settings.audio;
    this.audio.setVolume('master', a.master);
    this.audio.setVolume('music', a.music);
    this.audio.setVolume('sfx', a.effects);
    this.audio.setVolume('ambience', a.ambience);
    this.audio.setVolume('voice', a.voice);
    this.audio.setMuted(a.muted);
    if (this.renderer) {
      this.renderer.setQuality(this.settings.graphics.tier);
      this.renderer.setReducedMotion(this.settings.accessibility.reducedMotion);
    }
    if (patch.graphics && patch.graphics.theme) this.setTheme(patch.graphics.theme);
    this.platform.telemetry('settings_change', {});
  }

  setTheme(id) {
    const t = THEMES.find((x) => x.id === id);
    if (!t) return;
    if (!this._themeUnlocked(t)) {
      this.ui.announce(`${t.name} is locked — keep playing to unlock it.`, true);
      return;
    }
    this.settings.graphics.theme = id;
    this.platform.saveSettings(this.settings);
    this._applyTheme(t);
    this.audio.startAmbience(id);
    this.ui.announce(`Theme: ${t.name}.`, false);
  }

  profileSave(p) {
    if (p && p.name) {
      this.profile.name = p.name.slice(0, 24);
      this.platform.saveProfile({ name: this.profile.name });
      this._refreshCaches();
      this.ui.announce('Profile saved.', false);
      this.audio.play('notify');
    }
  }

  /* ------------------------------------------------------------- hosted play */

  async _hostedConnect() {
    if (this.platform.mode !== 'hosted') {
      throw new Error('Hosted play needs the game server. Run `npm start` and open the served page.');
    }
    if (this.hosted && this.hosted.client) return this.hosted.client;
    const client = new HostedClient({ name: this.profile.name });
    await client.connect();
    return client;
  }

  async hostedCreate(opts) {
    try {
      const client = await this._hostedConnect();
      this._wireHosted(client);
      const seats = Math.min(6, Math.max(2, opts.players || 4));
      const aiNames = ['Heron', 'Reed', 'Otter', 'Pike', 'Silt'];
      const config = {
        chips: 1000, smallBlind: 5, bigBlind: 10, maxHands: 24,
        players: Array.from({ length: seats }, (_, i) =>
          i === 0 ? { name: this.profile.name, ai: null } : { name: aiNames[(i - 1) % aiNames.length], ai: 'normal' }),
      };
      const lobby = await client.createRoom(config);
      this.hosted = { client, code: lobby.code, snapshot: null, isHost: true, cmdCounter: 0 };
      this.ui.showScreen('lobby', this._lobbyView(lobby));
    } catch (e) {
      this.ui.announce('Could not create a table: ' + (e && e.message), true);
      this.audio.play('error');
    }
  }

  async hostedJoin(code) {
    try {
      const client = await this._hostedConnect();
      this._wireHosted(client);
      const lobby = await client.joinRoom(code);
      this.hosted = { client, code: lobby.code, snapshot: null, isHost: false, cmdCounter: 0 };
      this.ui.showScreen('lobby', this._lobbyView(lobby));
    } catch (e) {
      this.ui.announce('Could not join: ' + (e && e.message), true);
      this.audio.play('error');
    }
  }

  _lobbyView(msg) {
    const me = this.hosted && this.hosted.client.playerId;
    const players = (msg.players || []).map((p) => ({
      id: p.id, name: p.name, ready: p.ready, isHost: p.id === msg.host, away: p.connected === false,
    }));
    return {
      code: msg.code,
      players,
      youId: me,
      isHost: msg.host === me,
      canStart: players.every((p) => p.ready || p.id === msg.host),
      youReady: !!(msg.players || []).find((p) => p.id === me && p.ready),
    };
  }

  _wireHosted(client) {
    if (client._wiredByApp) return;
    client._wiredByApp = true;
    client.on('lobby', (msg) => {
      if (this.hosted) this.hosted.isHost = msg.host === client.playerId;
      this.ui.lobbyUpdate(this._lobbyView(msg));
    });
    client.on('started', () => {
      this.finished = false;
      this._applyTheme(this._currentTheme());
      this.audio.startMusic('game');
      this.audio.startAmbience(this._currentTheme().id);
      this.platform.activityStart('hosted');
      this.platform.presenceStart({ mode: 'hosted' });
      this.ui.showScreen('game');
    });
    client.on('snapshot', (msg) => this._hostedSnapshot(msg));
    client.on('chat', (msg) => this.ui.showEvents([{ type: 'chat', name: msg.name, text: msg.text }]));
    client.on('whileAway', (msg) => {
      if (msg.missed && msg.missed.length) {
        this.ui.announce(`While you were away: ${msg.missed.slice(-3).join(' · ')}`, false);
      }
    });
    client.on('result', (msg) => this._hostedResult(msg));
    client.on('error', (msg) => {
      this.ui.announce(msg.message || 'Table error', true);
      this.audio.play('error');
    });
    client.on('closed', (msg) => {
      if (msg.reconnecting) this.ui.announce('Connection lost — reconnecting…', true);
      else if (this.hosted) this.ui.announce('Reconnected.', false);
    });
  }

  _hostedSnapshot(msg) {
    if (!this.hosted) return;
    this.hosted.snapshot = msg.snapshot;
    const snap = msg.snapshot;
    const myId = this.hosted.client.playerId;
    let legal = [];
    try { legal = legalActions(snap, myId); } catch { legal = []; }
    const you = snap.players.find((p) => p.id === myId) || null;
    this.ui.youId = myId;
    this.ui.updateGame({
      snapshot: snap, legal,
      isYourTurn: !snap.terminal && legal.length > 0,
      canUndo: false, mode: 'hosted', seatedYou: you,
      hintsEnabled: false, hint: null,
      objective: `Hosted table ${this.hosted.code || ''} — first to the top of the standings.`,
      progress: `Hand ${snap.handNumber || 0}` + (snap.config && snap.config.maxHands ? ` of ${snap.config.maxHands}` : ''),
    });
    if (this.renderer && you) this.renderer.showSnapshot(snap, you.seat);
    if (msg.events && msg.events.length) {
      this.ui.showEvents(msg.events);
      this.audio.mapEvents(msg.events);
      if (this.renderer) this.renderer.playEvents(msg.events, {});
    }
  }

  _hostedAction(type, amount) {
    const h = this.hosted;
    if (!h || !h.snapshot) return;
    const command = {
      id: `c-${h.client.playerId}-${h.cmdCounter++}`,
      tick: h.snapshot.tick,
      playerId: h.client.playerId,
      type,
    };
    if (amount !== undefined) command.amount = amount;
    h.client.sendCommand(command);
    this.audio.play('click');
  }

  hostedReady(b) {
    if (!this.hosted) return;
    const force = !!b && this.hosted.isHost;
    this.hosted.client.setReady(!!b, force);
  }

  hostedChat(text) {
    if (this.hosted && text && text.trim()) this.hosted.client.sendChat(text.trim());
  }

  hostedLeave() {
    if (this.hosted && this.hosted.client) { try { this.hosted.client.leave(); } catch {} }
    this.hosted = null;
    this.ui.showScreen('modes');
  }

  _hostedResult(msg) {
    if (this.finished) return;
    this.finished = true;
    const t = msg.terminal || {};
    const myId = this.hosted && this.hosted.client.playerId;
    const me = (t.standings || []).find((s) => s.id === myId);
    const headline = me && me.place === 1 ? 'You take the table!' : `Table over — you finished #${me ? me.place : '?'}.`;
    const breakdown = (t.standings || []).map((s) => ({
      label: `#${s.place} ${s.name}`, value: `${s.chips} chips`,
    }));
    this.audio.startMusic('results');
    this.platform.activityEnd();
    this.platform.presenceStop();
    this.ui.showResults({
      headline, breakdown,
      progress: { text: t.reason === 'maxHands' ? 'Hand limit reached.' : 'Last player standing.' },
      achievements: [], comparison: null, canRetry: false, canNext: false,
      recommendation: 'Head back to the lobby for a rematch, or try the daily challenge.',
    });
    this.ui.announce(headline, true);
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
    msg.textContent = 'River Stakes failed to start: ' + ((err && err.message) || err);
    el.append(msg);
    throw err;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

export { App, boot };
