// River Stakes — StarHermit platform integration with offline fallback.
import { STORAGE, SAVE_VERSION } from './version.js';

const TELEMETRY_EVENTS = new Set(
  ['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error']);

const BOARD_CAP = 50;

const TOKEN_REFRESH_MS = 45 * 60 * 1000;   // token lifetime is 60 min
const TOKEN_REFRESH_RETRY_MS = 60000;
const CLOUD_SAVE_DEBOUNCE_MS = 2000;
const API_TIMEOUT_MS = 8000;

// --- minimal ZIP writer/reader (stored entries only, no compression) -----------
// Saves are small JSON docs; stored entries are fine and need no dependencies.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function fetchWithTimeout(url, opts = {}, ms = API_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
    .finally(() => clearTimeout(timer));
}

/** base64url-decode a JWT payload (no signature verification). */
function decodeLaunchToken(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(b64 + pad));
    return (claims && typeof claims === 'object') ? claims : null;
  } catch { return null; }
}

function isLocalDevHost(hostname) {
  return !hostname || hostname === 'localhost' || hostname === '127.0.0.1'
    || hostname === '[::1]' || hostname.endsWith('.localhost');
}

/**
 * Read the launch token from the URL. Platform contract: it arrives in the
 * fragment `#game_token=<jwt>` (optional `&session_id=<guid>`); it is read ONCE
 * and then stripped from the URL. Query-param fallbacks are local-dev only.
 * The token is held in memory, NEVER persisted.
 */
function readLaunchToken() {
  if (typeof location === 'undefined') return null;
  if (location.hash) {
    const m = location.hash.match(/(?:^|[#&])game_token=([^&]+)/);
    if (m) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* strip best-effort */ }
      return decodeURIComponent(m[1]);
    }
  }
  if (location.search && isLocalDevHost(location.hostname)) {
    const params = new URLSearchParams(location.search);
    const t = params.get('token') || params.get('launch') || params.get('launch_token');
    if (t) return t;
  }
  return null;
}

function defaultWsUrl() {
  if (typeof location !== 'undefined' && location.host) {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }
  return 'ws://localhost:8080/ws';
}

export class Platform {
  /**
   * Detect the host environment. Hosted mode activates iff a launch token was
   * read from the URL. Without a token we probe the game's own dev server
   * (`/api/v1/time`) solely for clock sync and local multiplayer — those routes
   * are NOT platform routes and are never touched on-platform.
   * @returns {Promise<Platform>}
   */
  static async init() {
    const p = new Platform();
    p._token = readLaunchToken();
    const claims = p._token ? decodeLaunchToken(p._token) : null;
    p._sub = claims && claims.sub ? String(claims.sub) : null;
    p._slug = claims && claims.game_scope ? String(claims.game_scope) : null;
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
    p._mode = p._token ? 'hosted' : 'local';
    p._localServer = false;
    p._clockOffset = 0;
    p._clockAt = 0;
    if (!p._token) {
      try {
        const t0 = Date.now();
        const res = await fetchWithTimeout('/api/v1/time', {}, 1500);
        if (res.ok) {
          const body = await res.json().catch(() => null);
          // The dev server exposes the epoch as `now`.
          const serverMs = Number(body && (body.now ?? body.serverTime ?? body.epochMs));
          if (Number.isFinite(serverMs)) {
            const t1 = Date.now();
            p._clockOffset = serverMs - (t0 + t1) / 2;
            p._clockAt = t1;
            p._localServer = true;
          }
        }
      } catch { /* offline / no dev server */ }
    }
    p._identity = null;         // {id, nickname} — hosted only, cached in memory
    p._nameCache = new Map();   // userId -> nickname (leaderboard resolution)
    p._gameInfo = undefined;    // GET /api/v1/games/{slug} cache
    p._teleLog = [];
    p._syncStatus = p._token ? 'synced' : 'offline';
    p._syncListeners = [];
    p._cloudDoc = null;
    p._cloudTimer = null;
    p._cloudFlushing = false;
    p._refreshTimer = null;
    if (p._token) p._scheduleRefresh();
    return p;
  }

  get mode() { return this._mode; }          // 'hosted' | 'local'
  /** The game's own dev server is reachable (local mode multiplayer + clock). */
  get localServer() { return this._localServer; }
  /** Launch token, in memory only. Null in local mode. */
  get token() { return this._token; }
  /** Authenticated user id (JWT `sub`), hosted only. */
  get userId() { return this._sub; }
  /** Game slug from the JWT `game_scope`; never hard-coded. */
  get gameKey() { return this._slug; }

  // --- auth ------------------------------------------------------------------------

  _headers(extra) {
    const h = Object.assign({}, extra);
    if (this._token) h.Authorization = 'Bearer ' + this._token;
    return h;
  }

  /**
   * Authenticated same-origin REST call. Every request carries the launch
   * token as `Authorization: Bearer` while one is in memory.
   */
  async api(path, { method = 'GET', body, timeout = API_TIMEOUT_MS } = {}) {
    const opts = { method, headers: this._headers() };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetchWithTimeout(path, opts, timeout);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status + ' ' + path);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Token lifetime is 60 min; re-mint every 45 min, retry failures ~60 s. */
  _scheduleRefresh() {
    if (!this._token) return;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this._refreshToken(), TOKEN_REFRESH_MS);
    if (this._refreshTimer.unref) this._refreshTimer.unref();
  }

  async _refreshToken() {
    if (!this._token || !this._slug) return;
    try {
      const data = await this.api(
        `/api/v1/games/${encodeURIComponent(this._slug)}/launch-token`,
        { method: 'POST', timeout: 10000 });
      const next = data && (data.token || data.launchToken || data.launch_token);
      if (typeof next === 'string' && next) this._token = next; // swap in the fresh token
      this._scheduleRefresh();
    } catch {
      this._refreshTimer = setTimeout(() => this._refreshToken(), TOKEN_REFRESH_RETRY_MS);
      if (this._refreshTimer.unref) this._refreshTimer.unref();
    }
  }

  // --- identity --------------------------------------------------------------------

  /**
   * Account profile for the launch-token subject. Display the NICKNAME;
   * fall back to "Player " + id8. NEVER call /api/v1/me (403 for launch
   * tokens) and never display usernames.
   * @returns {Promise<{id: string, nickname: string} | null>}
   */
  async loadIdentity() {
    if (this._identity) return this._identity;
    if (!this._token || !this._sub) return null;
    let nickname = null;
    try {
      const p = await this.api(`/api/v1/users/${encodeURIComponent(this._sub)}/profile`);
      if (p && typeof p.nickname === 'string' && p.nickname.trim()) nickname = p.nickname.trim();
    } catch { /* fall through to the id-based fallback */ }
    this._identity = { id: this._sub, nickname: nickname || ('Player ' + this._sub.slice(0, 8)) };
    return this._identity;
  }

  /** Resolve any user id to a display nickname (cached). */
  async nicknameFor(userId) {
    if (!this._token || !userId) return null;
    if (this._nameCache.has(userId)) return this._nameCache.get(userId);
    let name = null;
    try {
      const p = await this.api(`/api/v1/users/${encodeURIComponent(userId)}/profile`);
      if (p && typeof p.nickname === 'string' && p.nickname.trim()) name = p.nickname.trim();
    } catch { /* fallback below */ }
    name = name || ('Player ' + String(userId).slice(0, 8));
    this._nameCache.set(userId, name);
    return name;
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

  /**
   * Load the remote save doc (hosted only). 404 = none. On conflict the caller
   * prefers what this returns. Returns null offline / on error.
   */
  async cloudLoad() {
    if (!this._token || !this._slug) return null;
    try {
      const res = await fetchWithTimeout(
        `/api/v1/me/cloud-saves/${encodeURIComponent(this._slug)}`,
        { headers: this._headers() }, API_TIMEOUT_MS);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
      return (doc && typeof doc === 'object' && !Array.isArray(doc)) ? doc : null;
    } catch { return null; }
  }

  /**
   * Queue a cloud save (debounced ~2 s; flush on pagehide/visibilitychange via
   * flushCloud()). Skipped entirely without a token — localStorage is the
   * offline cache and stays authoritative locally.
   */
  scheduleCloudSave(doc) {
    if (!this._token || !this._slug || !doc) return;
    this._cloudDoc = doc;
    if (this._cloudTimer) clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => { this._cloudTimer = null; this._flushCloud(); },
      CLOUD_SAVE_DEBOUNCE_MS);
    if (this._cloudTimer.unref) this._cloudTimer.unref();
  }

  /** Flush any queued cloud save immediately (pagehide / visibilitychange). */
  flushCloud() {
    if (this._cloudTimer) { clearTimeout(this._cloudTimer); this._cloudTimer = null; }
    return this._flushCloud();
  }

  async _flushCloud() {
    if (!this._token || !this._slug || !this._cloudDoc || this._cloudFlushing) return;
    const doc = this._cloudDoc;
    this._cloudFlushing = true;
    this._setSyncStatus('saving');
    try {
      const bytes = zipStore('save.json', new TextEncoder().encode(JSON.stringify(doc)));
      await this.api(`/api/v1/me/cloud-saves/${encodeURIComponent(this._slug)}`, {
        method: 'PUT',
        body: { dataBase64: bytesToBase64(bytes) },
        timeout: 10000,
      });
      this._setSyncStatus('synced');
    } catch {
      this._setSyncStatus('error');
    } finally {
      this._cloudFlushing = false;
    }
    // A save queued while we were in flight targets the latest doc; re-run.
    if (this._cloudDoc && this._cloudDoc !== doc) this.scheduleCloudSave(this._cloudDoc);
  }

  // --- clock -----------------------------------------------------------------------

  /** Round-trip-adjusted dev-server time; Date.now() fallback. */
  async serverNow() {
    if (this._mode !== 'local' || !this._localServer) return Date.now();
    if (Date.now() - this._clockAt < 30000) return Date.now() + this._clockOffset;
    try {
      const t0 = Date.now();
      const res = await fetchWithTimeout('/api/v1/time', {}, 2000);
      const t1 = Date.now();
      const body = await res.json();
      const serverMs = Number(body.now ?? body.serverTime ?? body.epochMs);
      if (Number.isFinite(serverMs)) {
        this._clockOffset = serverMs - (t0 + t1) / 2;
        this._clockAt = Date.now();
      }
    } catch { /* keep last offset */ }
    return Date.now() + this._clockOffset;
  }

  /** 'YYYY-MM-DD' based on server time. */
  async utcToday() {
    return new Date(await this.serverNow()).toISOString().slice(0, 10);
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
   * mirror); clients can NEVER submit scores to a platform leaderboard
   * (script/elo-owned), so this never issues a network request.
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
    return full;
  }

  /**
   * Personal-best board: local records only, never a network request.
   * @param {string} boardId
   * @returns {Promise<Array>} sorted desc, top 50
   */
  async getBoard(boardId) {
    const boards = this.loadJSON(STORAGE.boards, {});
    const list = Array.isArray(boards[boardId]) ? boards[boardId] : [];
    return list.slice().sort((a, b) => b.value - a.value || a.ts - b.ts).slice(0, BOARD_CAP);
  }

  /** GET /api/v1/games/{slug} — cached; null offline or on error. */
  async gameInfo() {
    if (this._gameInfo !== undefined) return this._gameInfo;
    if (!this._token || !this._slug) { this._gameInfo = null; return null; }
    try {
      this._gameInfo = await this.api(`/api/v1/games/${encodeURIComponent(this._slug)}`);
    } catch {
      this._gameInfo = null;
    }
    return this._gameInfo;
  }

  /**
   * Read-only platform leaderboard entries (hosted only). Resolves userIds to
   * nicknames via the profile helper. Returns null when there is no
   * leaderboardId or the read fails — callers show local records only.
   * @returns {Promise<Array<{name:string, value:number, rank?:number}>|null>}
   */
  async getGlobalBoard({ friendsOnly = false, page = 0, pageSize = 50 } = {}) {
    const info = await this.gameInfo();
    const lbId = info && info.leaderboardId;
    if (!lbId) return null;
    try {
      const q = new URLSearchParams({
        friendsOnly: friendsOnly ? 'true' : '',
        page: String(page),
        pageSize: String(pageSize),
      });
      const data = await this.api(`/api/v1/leaderboards/${encodeURIComponent(lbId)}/entries?${q}`);
      const list = Array.isArray(data) ? data : ((data && (data.entries || data.items)) || []);
      return await Promise.all(list.map(async (e, i) => {
        const value = Number(e.value ?? e.score ?? e.points);
        const userId = e.userId ?? e.user_id ?? e.id;
        return {
          name: (e.name && String(e.name)) || (userId != null ? await this.nicknameFor(String(userId)) : null) || 'Player',
          value: Number.isFinite(value) ? value : 0,
          rank: e.rank != null ? Number(e.rank) : i + 1,
        };
      }));
    } catch {
      return null;
    }
  }

  // --- telemetry ---------------------------------------------------------------------

  /**
   * Anonymous funnel telemetry; whitelisted events only, gated on
   * settings.telemetryConsent. Kept in an in-memory ring; the platform has no
   * per-game telemetry endpoint reachable by launch tokens, so this never
   * sends over the network.
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
    this._teleLog.push(rec);
    if (this._teleLog.length > 100) this._teleLog.shift();
  }
}

/**
 * WebSocket client for LOCAL multiplayer on the game's own dev server
 * (`npm start`). This JSON protocol is specific to that server; on the
 * StarHermit platform hosted tables are honestly disabled (see main.js), so
 * this client is never opened against platform hosts.
 */
export class HostedClient {
  /**
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
