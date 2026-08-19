// River Stakes — host (StarHermit) integration with offline fallback.
import { STORAGE } from './version.js';

const TELEMETRY_EVENTS = new Set(
  ['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error']);

const BOARD_CAP = 50;
const PRESENCE_INTERVAL_MS = 30000;

function fetchWithTimeout(url, opts = {}, ms = 2000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
    .finally(() => clearTimeout(timer));
}

function defaultWsUrl() {
  if (typeof location !== 'undefined' && location.host) {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }
  return 'ws://localhost:8080/ws';
}

export class Platform {
  /**
   * Detect host environment. Same-origin /api/health reachable => 'hosted'.
   * Reads window.__LAUNCH_TOKEN__ if present (held in memory only, NEVER persisted).
   * @returns {Promise<Platform>}
   */
  static async init() {
    const p = new Platform();
    p._token = (typeof window !== 'undefined' && window.__LAUNCH_TOKEN__) || null;
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
    p._mode = 'local';
    try {
      const res = await fetchWithTimeout('/api/health', {}, 1500);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && body.ok) p._mode = 'hosted';
      }
    } catch { /* offline / no host */ }
    p._clockOffset = 0;
    p._clockAt = 0;
    p._presenceTimer = null;
    p._activity = null;
    p._teleLog = [];
    return p;
  }

  get mode() { return this._mode; } // 'hosted' | 'local'

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this._token) h.Authorization = 'Bearer ' + this._token;
    return h;
  }

  /** Best-effort POST to the host API; resolves to parsed JSON or null. */
  async _post(path, body) {
    if (this._mode !== 'hosted') return null;
    try {
      const res = await fetchWithTimeout(path, {
        method: 'POST', headers: this._headers(), body: JSON.stringify(body),
      }, 3000);
      return await res.json().catch(() => null);
    } catch { return null; }
  }

  /** Round-trip-adjusted server time; Date.now() fallback in local mode. */
  async serverNow() {
    if (this._mode !== 'hosted') return Date.now();
    if (Date.now() - this._clockAt < 30000) return Date.now() + this._clockOffset;
    try {
      const t0 = Date.now();
      const res = await fetchWithTimeout('/api/v1/time', {}, 2000);
      const t1 = Date.now();
      const body = await res.json();
      if (typeof body.now === 'number') {
        this._clockOffset = body.now - (t0 + t1) / 2;
        this._clockAt = Date.now();
      }
    } catch { /* keep last offset */ }
    return Date.now() + this._clockOffset;
  }

  /** 'YYYY-MM-DD' based on server time. */
  async utcToday() {
    return new Date(await this.serverNow()).toISOString().slice(0, 10);
  }

  // --- storage -------------------------------------------------------------------

  /** localStorage-backed JSON load with parse guards; in-memory fallback. */
  loadJSON(key, fallback) {
    try {
      const raw = this._storage ? this._storage.getItem(key) : this._mem.get(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
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
  saveSettings(patch) {
    const next = Object.assign({}, this.loadSettings(), patch);
    this.saveJSON(STORAGE.settings, next);
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

  // --- achievements ----------------------------------------------------------------

  /**
   * Idempotent achievement unlock; returns true if newly unlocked.
   * Hosted mode additionally POSTs best-effort (failures ignored).
   * @param {string} key stable lowercase identifier
   */
  async unlockAchievement(key) {
    const prog = this.loadProgress();
    const map = prog.achievements || {};
    if (map[key]) return false;
    const ts = Date.now();
    map[key] = ts;
    this.saveProgress({ achievements: map });
    await this._post('/api/v1/achievements', { key, ts });
    return true;
  }

  /** @returns {Object<string, number>} key -> unlocked-at timestamp */
  achievements() {
    return this.loadProgress().achievements || {};
  }

  // --- leaderboards -----------------------------------------------------------------

  /**
   * Submit a score entry. Local boards in localStorage in local mode;
   * hosted mode POSTs best-effort and also keeps the local copy.
   * @param {string} boardId
   * @param {{value:number, ruleset:string, contentVersion:number, seed:number,
   *          assists:string[], durationMs:number, ts?:number, name?:string}} entry
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
    await this._post('/api/v1/boards', { boardId, entry: full });
    return full;
  }

  /**
   * @param {string} boardId
   * @param {{friendsOnly?: boolean}} opts no-op in local mode
   * @returns {Promise<Array>} sorted desc, top 50
   */
  async getBoard(boardId, { friendsOnly } = {}) {
    if (this._mode === 'hosted') {
      try {
        const q = friendsOnly ? '?friends=1' : '';
        const res = await fetchWithTimeout(
          '/api/v1/boards/' + encodeURIComponent(boardId) + q, {}, 2500);
        const body = await res.json();
        if (Array.isArray(body.entries)) return body.entries.slice(0, BOARD_CAP);
      } catch { /* fall through to local copy */ }
    }
    const boards = this.loadJSON(STORAGE.boards, {});
    const list = Array.isArray(boards[boardId]) ? boards[boardId] : [];
    return list.slice().sort((a, b) => b.value - a.value || a.ts - b.ts).slice(0, BOARD_CAP);
  }

  // --- presence & activity ------------------------------------------------------------

  /** Throttled heartbeat (30s) while playing; hosted mode only. */
  presenceStart(details = {}) {
    if (this._mode !== 'hosted') return;
    this.presenceStop();
    const beat = () => this._post('/api/v1/presence', { state: 'playing', details, ts: Date.now() });
    beat();
    this._presenceTimer = setInterval(beat, PRESENCE_INTERVAL_MS);
  }

  presenceStop() {
    if (this._presenceTimer) { clearInterval(this._presenceTimer); this._presenceTimer = null; }
    if (this._mode === 'hosted') this._post('/api/v1/presence', { state: 'idle', ts: Date.now() });
  }

  /** Playtime pairing; no-op locally. */
  activityStart(mode) {
    if (this._mode !== 'hosted') return;
    this._activity = { mode, t0: Date.now() };
    this._post('/api/v1/activity', { phase: 'start', mode, ts: this._activity.t0 });
  }

  activityEnd() {
    if (this._mode !== 'hosted' || !this._activity) return;
    const { mode, t0 } = this._activity;
    this._activity = null;
    this._post('/api/v1/activity', { phase: 'end', mode, ts: Date.now(), durationMs: Date.now() - t0 });
  }

  /**
   * Anonymous funnel telemetry; whitelisted events only, gated on
   * settings.telemetryConsent. Hosted: best-effort POST. Local: in-memory ring.
   */
  telemetry(event, data) {
    if (!TELEMETRY_EVENTS.has(event)) return;
    if (!this.loadSettings().telemetryConsent) return;
    const rec = { event, ts: Date.now() };
    if (data && typeof data === 'object') {
      // whitelist-ish: keep only primitives, drop any raw text fields
      rec.data = {};
      for (const [k, v] of Object.entries(data)) {
        if (['number', 'boolean'].includes(typeof v)) rec.data[k] = v;
      }
    }
    if (this._mode === 'hosted') this._post('/api/v1/telemetry', rec);
    else { this._teleLog.push(rec); if (this._teleLog.length > 100) this._teleLog.shift(); }
  }
}

export class HostedClient {
  /**
   * WebSocket client for hosted rooms. JSON messages.
   * @param {{name?: string, url?: string}} opts
   */
  constructor({ name, url } = {}) {
    this.name = name || 'Player';
    this.url = url || defaultWsUrl();
    this.playerId = null;
    this.serverTime = 0;
    this.roomCode = null;
    this._token = null; // in-memory only, used for rejoin
    this._ws = null;
    this._handlers = new Map();
    this._closed = false;      // intentional close
    this._connected = false;
    this._reconnectDelay = 500;
    this._reconnectTimer = null;
  }

  /**
   * @param {string} op 'lobby'|'started'|'snapshot'|'chat'|'result'|'whileAway'|'error'|'closed'|...
   * @param {(msg: object) => void} fn
   */
  on(op, fn) {
    if (!this._handlers.has(op)) this._handlers.set(op, []);
    this._handlers.get(op).push(fn);
    return this;
  }

  _emit(op, msg) {
    for (const fn of this._handlers.get(op) || []) {
      try { fn(msg); } catch (e) { setTimeout(() => { throw e; }, 0); }
    }
  }

  _openSocket() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this._ws = ws;
      ws.addEventListener('open', () => { settled = true; resolve(ws); });
      ws.addEventListener('error', (e) => { if (!settled) { settled = true; reject(e); } });
      ws.addEventListener('message', (e) => this._onMessage(e));
      ws.addEventListener('close', () => this._onClose());
    });
  }

  _waitFor(op, ms = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._once) this._once.delete(op);
        reject(new Error('HostedClient: timeout waiting for ' + op));
      }, ms);
      const wrap = (msg) => { clearTimeout(timer); resolve(msg); };
      if (!this._once) this._once = new Map();
      if (!this._once.has(op)) this._once.set(op, []);
      this._once.get(op).push(wrap);
    });
  }

  /**
   * Connect and identify. Resolves with { playerId, serverTime }.
   * @returns {Promise<{playerId: string, serverTime: number}>}
   */
  async connect() {
    this._closed = false;
    await this._openSocket();
    const hello = { op: 'hello', name: this.name };
    this._ws.send(JSON.stringify(hello));
    const welcome = await this._waitFor('welcome');
    this.playerId = welcome.playerId;
    this.serverTime = welcome.serverTime;
    this._connected = true;
    this._reconnectDelay = 500;
    return { playerId: this.playerId, serverTime: this.serverTime };
  }

  _onMessage(e) {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || typeof msg.op !== 'string') return;
    // track room credentials from lobby messages (in-memory only)
    if (msg.op === 'lobby' && msg.you) {
      this.roomCode = msg.code;
      this._token = msg.you.token;
    }
    const once = this._once && this._once.get(msg.op);
    if (once && once.length) { once.shift()(msg); return; }
    this._emit(msg.op, msg);
  }

  _onClose() {
    this._connected = false;
    this._ws = null;
    if (this._closed) { this._emit('closed', { reconnecting: false }); return; }
    this._emit('closed', { reconnecting: true });
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._closed || this._reconnectTimer) return;
    const delay = this._reconnectDelay;
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, 8000);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._closed) return;
      try {
        await this.connect();
        if (this.roomCode && this.playerId && this._token) {
          this.rejoin(this.roomCode, this._token);
        }
      } catch {
        this._scheduleReconnect();
      }
    }, delay);
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(obj));
  }

  /** Create a room; resolves with the 'lobby' message (contains code + your token). */
  createRoom(config) {
    const p = this._waitFor('lobby');
    this._send({ op: 'create', config });
    return p;
  }

  /** Join a room by 5-char code; resolves with the 'lobby' message. */
  joinRoom(code) {
    const p = this._waitFor('lobby');
    this._send({ op: 'join', code: String(code || '').toUpperCase() });
    return p;
  }

  /** Rejoin after a drop using the in-memory token. */
  rejoin(sessionId, token) {
    this._send({ op: 'rejoin', code: sessionId, playerId: this.playerId, token });
  }

  setReady(ready, force = false) { this._send({ op: 'ready', ready: !!ready, force: !!force }); }
  sendCommand(command) { this._send({ op: 'cmd', command }); }
  sendChat(text) { this._send({ op: 'chat', text: String(text) }); }

  /** Leave the room and close the connection cleanly (no auto-reconnect). */
  leave() {
    this._closed = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._send({ op: 'leave' });
    if (this._ws) { try { this._ws.close(); } catch {} this._ws = null; }
    this.roomCode = null;
    this._token = null;
  }
}
