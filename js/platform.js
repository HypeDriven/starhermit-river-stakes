// River Stakes — StarHermit platform integration with offline fallback.
// Platform access goes through the canonical SDK (starhermit-sdk.js, loaded as
// a classic script before the modules; globalThis.StarHermit): launch token
// (#game_token / #access_token) + renewal, profile, cloud-save slot
// (game:<slug>), settings KV, controls, read-only leaderboards, invite link.
// Standalone (no token) nothing touches the network: device clock, local
// boards, achievements and records.
import { STORAGE, SAVE_VERSION } from './version.js';

const TELEMETRY_EVENTS = new Set(
  ['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error']);

const BOARD_CAP = 50;
const CLOUD_SAVE_DEBOUNCE_MS = 2000;
const SETTING_GROUPS = ['audio', 'graphics', 'accessibility', 'ui'];

/** Keyboard actions (KeyboardEvent.code). Mirrors control.* in starhermit.txt. */
export const DEFAULT_BINDINGS = {
  fold: ['KeyF'],
  call: ['KeyC', 'KeyX'],
  raise: ['KeyB', 'KeyR'],
  allin: ['KeyA'],
  undo: ['KeyU'],
  hint: ['KeyH'],
  pause: ['Escape'],
  prev: ['ArrowLeft'],
  next: ['ArrowRight'],
  skip: ['KeyS'],
};

/** Short label for a KeyboardEvent.code. */
export function keyLabel(code) {
  const named = { Escape: 'Esc', ArrowLeft: '\u2190', ArrowRight: '\u2192', ArrowUp: '\u2191', ArrowDown: '\u2193', Space: 'Space', Enter: 'Enter' };
  if (named[code]) return named[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  return code;
}

const SH = () => globalThis.StarHermit || null;

export class Platform {
  /**
   * Detect the host environment. Hosted mode is active while the SDK holds a
   * launch token; without one the game is fully local.
   * @returns {Promise<Platform>}
   */
  static async init() {
    const p = new Platform();
    const sh = SH();
    if (sh) sh.init(); // reads + strips the launch fragment; idempotent
    // probe storage (private mode can throw)
    p._storage = null;
    p._mem = new Map();
    try {
      if (typeof localStorage !== 'undefined') {
        const k = '__rs_probe__';
        localStorage.setItem(k, '1');
        localStorage.removeItem(k);
        p._storage = localStorage;
      }
    } catch { p._storage = null; }
    p._identity = null;         // {id, nickname} — hosted only
    p._gameInfo = undefined;
    p._teleLog = [];
    p._syncStatus = p.token ? 'synced' : 'offline';
    p._syncListeners = [];
    p._sentSettings = {};
    p._settingsTimer = null;
    p._bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    if (sh) {
      sh.on('saved', (ok) => p._setSyncStatus(ok ? 'synced' : 'error'));
      sh.on('auth', (a) => { if (!a.signedIn) { p._identity = null; p._setSyncStatus('offline'); } });
    }
    return p;
  }

  get mode() { return this.token ? 'hosted' : 'local'; } // 'hosted' | 'local'
  /** Launch token, in memory only (SDK). Null in local mode. */
  get token() { const sh = SH(); return sh && sh.signedIn ? sh.token : null; }
  /** Authenticated user id (JWT `sub`), hosted only. */
  get userId() { const sh = SH(); return this.token ? sh.userId : null; }
  /** Game slug from the JWT `game_scope`; never hard-coded. */
  get gameKey() { const sh = SH(); return sh ? sh.slug : null; }

  // --- account -------------------------------------------------------------------
  canSignIn() { const sh = SH(); return !!(sh && sh.canSignIn()); }
  signIn() { const sh = SH(); return !!(sh && sh.signIn()); }
  inviteLink() { return this.token ? SH().inviteLink() : null; }
  /** fn({signedIn}) when the session signs in/out (renewal refused). */
  onAuth(fn) { const sh = SH(); return sh ? sh.on('auth', fn) : () => {}; }

  // --- identity --------------------------------------------------------------------

  /**
   * Account profile for the launch-token subject: the nickname (SDK; "Player
   * <id>" fallback). Never /api/v1/me, never usernames.
   * @returns {Promise<{id: string, nickname: string} | null>}
   */
  async loadIdentity() {
    if (this._identity) return this._identity;
    if (!this.token || !this.userId) return null;
    const p = await SH().profile().catch(() => null);
    this._identity = { id: this.userId, nickname: p ? p.displayName : 'Player ' + this.userId.slice(0, 8) };
    return this._identity;
  }

  /** Resolve any user id to a display nickname (cached by the SDK). */
  async nicknameFor(userId) {
    if (!this.token || !userId) return null;
    const p = await SH().profile(String(userId)).catch(() => null);
    return p ? p.displayName : 'Player ' + String(userId).slice(0, 8);
  }

  // --- storage -------------------------------------------------------------------

  /** localStorage-backed JSON load with parse guards; in-memory fallback. */
  loadJSON(key, fallback) {
    try {
      const raw = this._storage ? this._storage.getItem(key) : this._mem.get(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : fallback;
    } catch { return fallback; }
  }

  saveJSON(key, value) {
    let raw;
    try { raw = JSON.stringify(value); } catch { return; }
    try {
      if (this._storage) this._storage.setItem(key, raw);
      else this._mem.set(key, raw);
    } catch {
      // storage full/blocked: keep an in-memory copy so the session still works
      this._mem.set(key, raw);
    }
  }

  loadSettings() { return this.loadJSON(STORAGE.settings, {}); }
  /** Persist settings locally and mirror changed groups to the platform settings KV. */
  saveSettings(patch) {
    const next = Object.assign({}, this.loadSettings(), patch);
    this.saveJSON(STORAGE.settings, next);
    this._mirrorSettings(next);
    return next;
  }
  loadProfile() { return this.loadJSON(STORAGE.profile, {}); }
  saveProfile(patch) {
    const next = Object.assign({}, this.loadProfile(), patch);
    this.saveJSON(STORAGE.profile, next);
    return next;
  }
  loadProgress() { return this.loadJSON(STORAGE.progress, {}); }
  saveProgress(patch) {
    const next = Object.assign({}, this.loadProgress(), patch);
    this.saveJSON(STORAGE.progress, next);
    return next;
  }

  // --- per-player settings KV (platform wins at start) --------------------------------

  /**
   * Platform settings groups to apply over local settings (hosted only):
   * resolves { audio?, graphics?, accessibility?, ui? } — empty standalone.
   */
  async platformSettings() {
    if (!this.token) return {};
    const remote = await SH().getSettings().catch(() => ({}));
    const out = {};
    for (const g of SETTING_GROUPS) if (remote && remote[g] && typeof remote[g] === 'object') out[g] = remote[g];
    return out;
  }
  /** Record what the platform already holds so only real changes are patched. */
  settingsSynced(settings) {
    this._sentSettings = JSON.parse(JSON.stringify(this._pickGroups(settings)));
  }
  _pickGroups(settings) {
    return Object.fromEntries(SETTING_GROUPS.filter((g) => settings && settings[g]).map((g) => [g, settings[g]]));
  }
  _mirrorSettings(settings) {
    if (!this.token) return;
    clearTimeout(this._settingsTimer);
    this._settingsTimer = setTimeout(() => {
      const now = this._pickGroups(settings);
      const diff = {};
      for (const [k, v] of Object.entries(now)) if (JSON.stringify(v) !== JSON.stringify(this._sentSettings[k])) diff[k] = v;
      if (!Object.keys(diff).length) return;
      this._sentSettings = JSON.parse(JSON.stringify(now));
      SH().patchSettings(diff);
    }, 600);
  }

  // --- controls --------------------------------------------------------------------
  async loadBindings() {
    const sh = SH();
    if (sh) this._bindings = await sh.loadBindings(DEFAULT_BINDINGS).catch(() => this._bindings);
    return this._bindings;
  }
  get bindings() { return this._bindings; }
  actionFor(code) {
    for (const [a, codes] of Object.entries(this._bindings)) if (codes.includes(code)) return a;
    return null;
  }

  // --- cloud save (hosted mirror; localStorage stays the offline cache) -------------

  /** 'offline' | 'synced' | 'saving' | 'error' */
  get syncStatus() { return this._syncStatus; }

  /** Subscribe to sync-status changes (fn receives the new status). */
  onSyncStatus(fn) { this._syncListeners.push(fn); }

  _setSyncStatus(status) {
    if (this._syncStatus === status) return;
    this._syncStatus = status;
    for (const fn of this._syncListeners) { try { fn(status); } catch { /* listener guard */ } }
  }

  /** Load the remote save doc (hosted only); null when none / offline. Remote wins. */
  async cloudLoad() {
    if (!this.token) return null;
    const doc = await SH().loadJSON();
    return (doc && typeof doc === 'object' && !Array.isArray(doc)) ? doc : null;
  }

  /** Queue a cloud save (debounced ~2 s; flushed on pagehide/visibilitychange). */
  scheduleCloudSave(doc) {
    if (!this.token || !doc) return;
    this._setSyncStatus('saving');
    SH().saveJSON(doc, CLOUD_SAVE_DEBOUNCE_MS);
  }

  /** Flush any queued cloud save immediately (pagehide / visibilitychange). */
  flushCloud() {
    if (!this.token) return Promise.resolve(false);
    return SH().flushSave(true);
  }

  // --- clock -----------------------------------------------------------------------

  /** 'YYYY-MM-DD' (UTC) from the device clock. */
  utcToday() {
    return new Date().toISOString().slice(0, 10);
  }

  // --- achievements (local; part of the cloud-saved doc) ----------------------------

  /**
   * Idempotent achievement unlock; returns true if newly unlocked. Pure browser
   * game: there is no server-authoritative unlock path, so unlocks stay local
   * and ride along in the cloud-saved doc.
   * @param {string} key stable lowercase identifier
   */
  async unlockAchievement(key) {
    const prog = this.loadProgress();
    const map = prog.achievements || {};
    if (map[key]) return false;
    const ts = Date.now();
    map[key] = ts;
    this.saveProgress({ achievements: map });
    return true;
  }

  /** @returns {Object<string, number>} key -> unlocked-at timestamp */
  achievements() {
    return this.loadProgress().achievements || {};
  }

  // --- leaderboards -----------------------------------------------------------------

  /**
   * Record a personal-best entry. Boards are kept in localStorage (+ the cloud
   * mirror); clients can NEVER submit scores to a platform leaderboard, so this
   * never issues a network request.
   */
  async submitScore(boardId, entry) {
    const full = Object.assign({}, entry, {
      ts: entry.ts ?? Date.now(),
      name: entry.name ?? this.loadProfile().name ?? 'Guest',
    });
    const boards = this.loadJSON(STORAGE.boards, {});
    const list = Array.isArray(boards[boardId]) ? boards[boardId] : [];
    list.push(full);
    list.sort((a, b) => b.value - a.value || a.ts - b.ts);
    boards[boardId] = list.slice(0, BOARD_CAP);
    this.saveJSON(STORAGE.boards, boards);
    return full;
  }

  /**
   * Signed in only: post a finished ranked table's final chips to the platform
   * `high-score` board (score-script.js). Resolves { posted, rank } — the
   * player's rank there, or null. Standalone → not posted, no request.
   */
  async postHighScore(chips) {
    const sh = SH();
    if (!this.token || !sh || typeof sh.submitScores !== 'function') return { posted: false, rank: null };
    let keys = [];
    try { keys = await sh.submitScores({ 'high-score': Math.max(0, Math.round(chips)) }); } catch { keys = []; }
    if (!keys.includes('high-score')) return { posted: false, rank: null };
    try {
      const r = await sh.leaderboard('high-score', { pageSize: 100 });
      const me = (r.items || []).find((i) => i.userId === this.userId);
      return { posted: true, rank: me ? me.rank : null };
    } catch { return { posted: true, rank: null }; }
  }

  /** Personal-best board: local records only, never a network request. */
  async getBoard(boardId) {
    const boards = this.loadJSON(STORAGE.boards, {});
    const list = Array.isArray(boards[boardId]) ? boards[boardId] : [];
    return list.slice().sort((a, b) => b.value - a.value || a.ts - b.ts).slice(0, BOARD_CAP);
  }

  /** Game definition (SDK getGame) — cached; null offline or on error. */
  async gameInfo() {
    if (this._gameInfo !== undefined) return this._gameInfo;
    if (!this.token) return null;
    const sh = SH();
    const info = await sh.getGame();
    if (info && !info.leaderboardId) {
      const boards = await sh.leaderboards();
      if (boards && boards[0]) info.leaderboardId = boards[0].id;
    }
    this._gameInfo = info || null;
    return this._gameInfo;
  }

  /**
   * Read-only platform leaderboard entries (hosted only), names resolved via
   * profiles. Null when there is no board or the read fails.
   * @returns {Promise<Array<{name:string, value:number, rank?:number}>|null>}
   */
  async getGlobalBoard({ friendsOnly = false, page = 1, pageSize = 50 } = {}) {
    const info = await this.gameInfo();
    const lbId = info && info.leaderboardId;
    if (!lbId) return null;
    const data = await SH().leaderboardEntries(lbId, { page: page || 1, pageSize, scope: friendsOnly ? 'friends' : undefined });
    const list = Array.isArray(data) ? data : ((data && (data.items || data.entries)) || []);
    return Promise.all(list.map(async (e, i) => {
      const value = Number(e.value ?? e.score ?? e.points);
      const userId = e.userId ?? e.user_id ?? e.id;
      return {
        name: (e.name && String(e.name)) || (userId != null ? await this.nicknameFor(String(userId)) : null) || 'Player',
        value: Number.isFinite(value) ? value : 0,
        rank: e.rank != null ? Number(e.rank) : i + 1,
      };
    }));
  }

  // --- telemetry ---------------------------------------------------------------------

  /**
   * Anonymous funnel telemetry; whitelisted events only, gated on
   * settings.telemetryConsent. Kept in an in-memory ring; the platform has no
   * per-game telemetry endpoint reachable by launch tokens.
   */
  telemetry(event, data) {
    if (!TELEMETRY_EVENTS.has(event)) return;
    if (!this.loadSettings().telemetryConsent) return;
    const rec = { event, ts: Date.now() };
    if (data && typeof data === 'object') {
      rec.data = {};
      for (const [k, v] of Object.entries(data)) {
        if (['number', 'boolean'].includes(typeof v)) rec.data[k] = v;
      }
    }
    this._teleLog.push(rec);
    if (this._teleLog.length > 100) this._teleLog.shift();
  }
}
