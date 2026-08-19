// River Stakes — zero-dependency Node (>=20) ESM server: static files, /api, WebSocket rooms, authoritative engine.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGame, applyCommand, legalActions, getSnapshot, summarize } from './js/rules/engine.js';
import { chooseAction } from './js/rules/ai.js';
import { Rng } from './js/rules/rng.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// --- WebSocket (RFC 6455, hand-rolled) ------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024; // 64 KiB

function acceptKey(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

class WsConn {
  constructor(socket, onMessage, onClose) {
    this.socket = socket;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragLen = 0;
    this.closed = false;
    this._closeSent = false;
    this._queue = [];
    this._writing = false;
    // app state
    this.playerId = null;
    this.name = 'Player';
    this.room = null;
    this.msgTimes = [];
    socket.on('data', (d) => this._data(d));
    const done = () => this._teardown();
    socket.on('close', done);
    socket.on('error', done);
    socket.on('end', done);
  }

  _teardown() {
    if (this.closed) return;
    this.closed = true;
    const cb = this.onClose; this.onClose = null;
    if (cb) cb(this);
  }

  _data(d) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    try {
      for (;;) {
        const frame = this._parseFrame();
        if (!frame) break;
        this._handleFrame(frame);
        if (this.closed) break;
      }
    } catch {
      this._fail(1002);
    }
  }

  _parseFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(MAX_MESSAGE)) { this._fail(1009); return null; }
      len = Number(big); off = 10;
    }
    if (len > MAX_MESSAGE) { this._fail(1009); return null; }
    const maskLen = masked ? 4 : 0;
    if (b.length < off + maskLen + len) return null;
    let payload = b.subarray(off + maskLen, off + maskLen + len);
    if (masked) {
      const mask = b.subarray(off, off + 4);
      const un = Buffer.alloc(len);
      for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3];
      payload = un;
    } else {
      payload = Buffer.from(payload); // copy: subarray aliases this.buf
    }
    this.buf = b.subarray(off + maskLen + len);
    return { fin, op, payload };
  }

  _handleFrame({ fin, op, payload }) {
    switch (op) {
      case 0x8: // close
        this._closeSent || this._writeFrame(0x8, payload.subarray(0, 2));
        this._closeSent = true;
        this.socket.end();
        this._teardown();
        break;
      case 0x9: // ping -> pong
        this._writeFrame(0xA, payload);
        break;
      case 0xA: // pong
        break;
      case 0x2: // binary: not used by this protocol
        this._fail(1003);
        break;
      case 0x1: // text (maybe fragmented)
      case 0x0: { // continuation
        if (op === 0x1) {
          if (this.frags.length) return this._fail(1002); // new message mid-fragment
          this.frags = [payload];
          this.fragLen = payload.length;
        } else {
          if (!this.frags.length) return this._fail(1002); // continuation without start
          this.frags.push(payload);
          this.fragLen += payload.length;
        }
        if (this.fragLen > MAX_MESSAGE) return this._fail(1009);
        if (fin) {
          const msg = Buffer.concat(this.frags).toString('utf8');
          this.frags = []; this.fragLen = 0;
          if (this.onMessage) this.onMessage(this, msg);
        }
        break;
      }
      default:
        this._fail(1002);
    }
  }

  /** Queue a JSON message on this connection's send queue. */
  send(obj) {
    if (this.closed) return;
    let payload;
    try { payload = Buffer.from(JSON.stringify(obj)); } catch { return; }
    this._writeFrame(0x1, payload);
  }

  _writeFrame(opcode, payload) {
    if (this.closed) return;
    this._queue.push(encodeFrame(opcode, payload));
    this._flush();
  }

  _flush() {
    if (this._writing || this.closed) return;
    while (this._queue.length) {
      const chunk = this._queue.shift();
      let ok;
      try { ok = this.socket.write(chunk); } catch { this._teardown(); return; }
      if (!ok) {
        this._writing = true;
        this.socket.once('drain', () => { this._writing = false; this._flush(); });
        return;
      }
    }
  }

  _fail(code) {
    this.close(code);
  }

  close(code = 1000) {
    if (this.closed) return;
    if (!this._closeSent) {
      this._closeSent = true;
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      this._writeFrame(0x8, payload);
    }
    try { this.socket.end(); } catch {}
    this._teardown();
  }

  destroy() {
    try { this.socket.destroy(); } catch {}
    this._teardown();
  }
}

// --- Room manager ---------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const CHAT_CAP = 240;
const CHAT_PER_MIN = 10;
const CHAT_LOG_CAP = 100;
const MSG_RATE_PER_SEC = 30;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const ROOM_FINISHED_MS = 10 * 60 * 1000;
const SEAT_HOLD_MS = 10 * 60 * 1000;
const AI_DELAY_MS = 700;
const AUTO_ADVANCE_MS = 2500;

function randomCode(rooms) {
  for (let tries = 0; tries < 100; tries++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return randomBytes(5).toString('hex').toUpperCase().slice(0, 5);
}

function sendError(conn, code, message) {
  conn.send({ op: 'error', code, message });
}

function actorIdOf(state) {
  if (state.currentActor == null) return null;
  const p = state.players[state.currentActor];
  return p ? p.id : null;
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(conn, config) {
    config = (config && typeof config === 'object') ? config : {};
    const code = randomCode(this.rooms);
    const room = {
      code,
      config,
      state: null,
      players: new Map(), // playerId -> {id,name,token,socket,connected,isAI,difficulty,ready,cmdIds,chatTimes,logIndex}
      hostId: conn.playerId,
      chatLog: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      started: false,
      finished: false,
      finishedAt: 0,
      timer: null,
      seed: Number.isInteger(config.seed) ? (config.seed >>> 0) : randomInt(0x100000000),
      aiDelayMs: Number.isFinite(config.aiDelayMs) ? config.aiDelayMs : AI_DELAY_MS,
      autoAdvanceMs: Number.isFinite(config.autoAdvanceMs) ? config.autoAdvanceMs : AUTO_ADVANCE_MS,
    };
    this.rooms.set(code, room);
    // AI seats from config.players exist from the start
    for (const entry of (Array.isArray(config.players) ? config.players : [])) {
      if (entry && entry.ai) this._addAISeat(room, entry);
    }
    this._seatHuman(room, conn);
    return room;
  }

  _addAISeat(room, entry) {
    const id = 'ai-' + room.players.size + '-' + randomBytes(3).toString('hex');
    room.players.set(id, {
      id, name: String(entry.name || 'Bot').slice(0, 24),
      token: null, socket: null, connected: true,
      isAI: true, difficulty: ['easy', 'normal', 'hard'].includes(entry.ai) ? entry.ai : 'normal',
      ready: true, cmdIds: new Set(), chatTimes: [], logIndex: 0,
    });
  }

  _seatHuman(room, conn) {
    const player = {
      id: conn.playerId, name: conn.name,
      token: randomBytes(16).toString('hex'),
      socket: conn, connected: true,
      isAI: false, difficulty: null,
      ready: false, cmdIds: new Set(), chatTimes: [], logIndex: 0,
    };
    room.players.set(conn.playerId, player);
    conn.room = room;
    return player;
  }

  humanCap(room) {
    const list = Array.isArray(room.config.players) ? room.config.players : null;
    if (!list) return 6;
    const ai = list.filter((p) => p && p.ai).length;
    return Math.max(1, Math.min(6, list.length) - ai);
  }

  joinRoom(conn, code) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) { sendError(conn, 'NO_ROOM', 'Room not found'); return null; }
    if (room.started) { sendError(conn, 'STARTED', 'Room already started'); return null; }
    if (room.players.has(conn.playerId)) { conn.room = room; return room; } // same client re-joining lobby
    const humans = [...room.players.values()].filter((p) => !p.isAI).length;
    if (humans >= this.humanCap(room)) { sendError(conn, 'ROOM_FULL', 'Room is full'); return null; }
    this._seatHuman(room, conn);
    return room;
  }

  lobbyMsg(room, viewer) {
    return {
      op: 'lobby',
      code: room.code,
      host: room.hostId,
      started: room.started,
      players: [...room.players.values()].map((p) => ({
        id: p.id, name: p.name, ready: p.ready, isAI: p.isAI, connected: p.connected,
      })),
      you: viewer ? { playerId: viewer.id, token: viewer.token } : null,
    };
  }

  broadcastLobby(room) {
    for (const p of room.players.values()) {
      if (p.socket && p.connected && !p.isAI) p.socket.send(this.lobbyMsg(room, p));
    }
  }

  broadcast(room, msgFactory) {
    for (const p of room.players.values()) {
      if (p.isAI || !p.socket || !p.connected) continue;
      p.socket.send(typeof msgFactory === 'function' ? msgFactory(p) : msgFactory);
    }
  }

  broadcastState(room, events) {
    this.broadcast(room, (p) => ({
      op: 'snapshot',
      snapshot: getSnapshot(room.state, p.id),
      events,
      tick: room.state.tick,
    }));
  }

  startRoom(room) {
    if (room.started) return;
    const cfg = room.config;
    const chips = Number.isInteger(cfg.chips) && cfg.chips > 0 ? cfg.chips : 1000;
    const humans = [...room.players.values()].filter((p) => !p.isAI);
    const ais = [...room.players.values()].filter((p) => p.isAI);
    const players = [];
    for (const p of [...humans, ...ais]) {
      players.push({ id: p.id, name: p.name, chips, ai: p.isAI ? p.difficulty : null });
    }
    // fill empty seats up to the config's intended player count with AI
    const intended = Array.isArray(cfg.players) ? cfg.players.length : 0;
    let filler = 0;
    while (players.length < Math.min(6, Math.max(intended, 2)) && players.length < 6) {
      const id = 'ai-fill-' + filler++;
      players.push({ id, name: 'Bot ' + filler, chips, ai: 'normal' });
      room.players.set(id, {
        id, name: 'Bot ' + filler, token: null, socket: null, connected: true,
        isAI: true, difficulty: 'normal', ready: true,
        cmdIds: new Set(), chatTimes: [], logIndex: 0,
      });
    }
    const engineConfig = {
      seed: room.seed,
      smallBlind: Number.isInteger(cfg.smallBlind) && cfg.smallBlind > 0 ? cfg.smallBlind : 5,
      bigBlind: Number.isInteger(cfg.bigBlind) && cfg.bigBlind > 0 ? cfg.bigBlind : 10,
      players,
      maxHands: Number.isInteger(cfg.maxHands) && cfg.maxHands > 0 ? cfg.maxHands : null,
    };
    room.state = createGame(engineConfig);
    room.started = true;
    room.lastActivity = Date.now();
    this.broadcast(room, {
      op: 'started',
      code: room.code,
      players: players.map((p) => ({ id: p.id, name: p.name, isAI: !!p.ai })),
    });
    // system-side initial advance: 'init' phase lets any seated player advance
    const advancer = players[0].id;
    this.applyToRoom(room, { id: 'sys-advance-' + room.state.tick, tick: room.state.tick, playerId: advancer, type: 'advance' }, null);
  }

  applyToRoom(room, command, fromPlayer) {
    const res = applyCommand(room.state, command);
    if (!res.ok) {
      if (fromPlayer && fromPlayer.socket) sendError(fromPlayer.socket, res.error.code, res.error.message);
      return false;
    }
    room.state = res.state;
    room.lastActivity = Date.now();
    this.broadcastState(room, res.events);
    this.scheduleFollowUps(room);
    return true;
  }

  scheduleFollowUps(room) {
    if (!room.state || room.finished) return;
    if (room.state.terminal) { this.finishRoom(room); return; }
    if (room.timer) return; // something already scheduled
    const st = room.state;
    if (st.phase === 'handEnd' || st.phase === 'init') {
      room.timer = setTimeout(() => {
        room.timer = null;
        this.autoAdvance(room);
      }, room.autoAdvanceMs);
      if (room.timer.unref) room.timer.unref();
      return;
    }
    const actorId = actorIdOf(st);
    if (!actorId) return;
    const p = room.players.get(actorId);
    if (p && p.isAI) {
      room.timer = setTimeout(() => {
        room.timer = null;
        this.aiMove(room, actorId);
      }, room.aiDelayMs);
      if (room.timer.unref) room.timer.unref();
    }
  }

  autoAdvance(room) {
    if (!room.state || room.state.terminal || room.finished) return;
    const st = room.state;
    if (st.phase !== 'handEnd' && st.phase !== 'init') {
      // A player advanced manually while this timer was pending — re-arm for
      // whoever acts next instead of wedging the room.
      this.scheduleFollowUps(room);
      return;
    }
    for (const pl of st.players) {
      const legal = legalActions(st, pl.id);
      if (legal.some((a) => a.type === 'advance')) {
        this.applyToRoom(room, { id: 'sys-advance-' + st.tick, tick: st.tick, playerId: pl.id, type: 'advance' }, null);
        return;
      }
    }
  }

  aiMove(room, playerId) {
    if (!room.state || room.state.terminal || room.finished) return;
    const p = room.players.get(playerId);
    if (!p || !p.isAI) return;
    if (actorIdOf(room.state) !== playerId) {
      // Stale timer (state moved on since scheduling) — re-arm for the real actor.
      this.scheduleFollowUps(room);
      return;
    }
    const rng = new Rng((room.seed + room.state.tick) >>> 0, 'ai');
    let command;
    try {
      command = chooseAction(room.state, playerId, p.difficulty, rng);
    } catch {
      this.scheduleFollowUps(room); // never wedge the room on an AI failure
      return;
    }
    if (!command || !command.id) { this.scheduleFollowUps(room); return; }
    this.applyToRoom(room, command, null);
  }

  finishRoom(room) {
    if (room.finished) return;
    room.finished = true;
    room.finishedAt = Date.now();
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    let summary = null;
    try { summary = summarize(room.state); } catch { summary = null; }
    this.broadcast(room, { op: 'result', terminal: room.state.terminal, summary });
  }

  destroyRoom(room) {
    if (room.timer) clearTimeout(room.timer);
    this.broadcast(room, { op: 'error', code: 'ROOM_CLOSED', message: 'Room closed' });
    for (const p of room.players.values()) {
      if (p.socket) { p.socket.room = null; }
    }
    this.rooms.delete(room.code);
  }

  sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.finished && now - room.finishedAt > ROOM_FINISHED_MS) this.destroyRoom(room);
      else if (!room.finished && now - room.lastActivity > ROOM_IDLE_MS) this.destroyRoom(room);
      else if (!room.started) {
        // drop seats of players disconnected > 10 min from unstarted rooms
        for (const p of [...room.players.values()]) {
          if (!p.isAI && !p.connected && now - (p.disconnectedAt || 0) > SEAT_HOLD_MS) {
            room.players.delete(p.id);
            this.broadcastLobby(room);
          }
        }
      }
    }
  }
}

// --- message handling -------------------------------------------------------------

function handleMessage(mgr, conn, raw) {
  // per-socket rate limit
  const now = Date.now();
  conn.msgTimes = conn.msgTimes.filter((t) => now - t < 1000);
  if (conn.msgTimes.length >= MSG_RATE_PER_SEC) {
    sendError(conn, 'RATE_LIMITED', 'Too many messages');
    return;
  }
  conn.msgTimes.push(now);

  let msg;
  try { msg = JSON.parse(raw); } catch {
    sendError(conn, 'MALFORMED', 'Invalid JSON');
    return;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.op !== 'string') {
    sendError(conn, 'MALFORMED', 'Expected {op: string, ...}');
    return;
  }

  const room = conn.room;
  const player = room ? room.players.get(conn.playerId) : null;

  switch (msg.op) {
    case 'hello': {
      conn.name = String(msg.name || 'Player').slice(0, 24) || 'Player';
      if (!conn.playerId) conn.playerId = randomBytes(8).toString('hex');
      conn.send({ op: 'welcome', playerId: conn.playerId, serverTime: Date.now() });
      break;
    }
    case 'create': {
      if (!conn.playerId) { sendError(conn, 'NO_HELLO', 'Send hello first'); return; }
      if (room) { sendError(conn, 'IN_ROOM', 'Already in a room'); return; }
      const r = mgr.createRoom(conn, msg.config);
      mgr.broadcastLobby(r);
      break;
    }
    case 'join': {
      if (!conn.playerId) { sendError(conn, 'NO_HELLO', 'Send hello first'); return; }
      if (room) { sendError(conn, 'IN_ROOM', 'Already in a room'); return; }
      const r = mgr.joinRoom(conn, msg.code);
      if (r) mgr.broadcastLobby(r);
      break;
    }
    case 'rejoin': {
      const r = mgr.rooms.get(String(msg.code || '').toUpperCase());
      if (!r) { sendError(conn, 'NO_ROOM', 'Room not found'); return; }
      const p = r.players.get(String(msg.playerId || ''));
      if (!p || p.isAI || !p.token || p.token !== String(msg.token || '')) {
        sendError(conn, 'AUTH', 'Invalid rejoin credentials');
        return;
      }
      const missed = r.state ? r.state.log.slice(p.logIndex || 0) : [];
      p.connected = true;
      p.socket = conn;
      p.logIndex = r.state ? r.state.log.length : 0;
      conn.playerId = p.id;
      conn.name = p.name;
      conn.room = r;
      r.lastActivity = Date.now();
      conn.send(mgr.lobbyMsg(r, p));
      if (r.state) {
        conn.send({ op: 'snapshot', snapshot: getSnapshot(r.state, p.id), events: [], tick: r.state.tick });
        conn.send({ op: 'whileAway', missed });
      }
      mgr.broadcastLobby(r);
      break;
    }
    case 'ready': {
      if (!player || !room) { sendError(conn, 'NO_ROOM', 'Not in a room'); return; }
      if (room.started) { sendError(conn, 'STARTED', 'Game already started'); return; }
      player.ready = !!msg.ready;
      room.lastActivity = Date.now();
      mgr.broadcastLobby(room);
      const humans = [...room.players.values()].filter((p) => !p.isAI);
      const allReady = humans.length > 0 && humans.every((p) => p.ready);
      const forceStart = msg.force === true && conn.playerId === room.hostId;
      if (player.ready && (allReady || forceStart)) mgr.startRoom(room);
      break;
    }
    case 'cmd': {
      if (!player || !room) { sendError(conn, 'NO_ROOM', 'Not in a room'); return; }
      if (!room.started || !room.state) { sendError(conn, 'NOT_STARTED', 'Game not started'); return; }
      const command = msg.command;
      if (!command || typeof command !== 'object' || typeof command.id !== 'string' || !command.id) {
        sendError(conn, 'MALFORMED', 'command must have a unique string id');
        return;
      }
      command.playerId = player.id; // never trust the client-supplied playerId
      if (player.cmdIds.has(command.id)) {
        // idempotent duplicate: reply with the current snapshot, no re-apply
        conn.send({
          op: 'snapshot',
          snapshot: getSnapshot(room.state, player.id),
          events: [],
          tick: room.state.tick,
          duplicate: true,
        });
        return;
      }
      if (player.cmdIds.size > 500) player.cmdIds.clear();
      const tickBefore = room.state.tick;
      if (mgr.applyToRoom(room, command, player)) {
        player.cmdIds.add(command.id);
        if (room.state.tick === tickBefore) player.cmdIds.delete(command.id); // defensive; engine always bumps tick on ok
      }
      break;
    }
    case 'chat': {
      if (!player || !room) { sendError(conn, 'NO_ROOM', 'Not in a room'); return; }
      const tnow = Date.now();
      player.chatTimes = player.chatTimes.filter((t) => tnow - t < 60000);
      if (player.chatTimes.length >= CHAT_PER_MIN) {
        sendError(conn, 'CHAT_RATE', 'Chat rate limit (10/min)');
        return;
      }
      player.chatTimes.push(tnow);
      // NOTE: text is relayed as plain text; clients MUST HTML-escape before rendering.
      const text = String(msg.text ?? '').slice(0, CHAT_CAP);
      if (!text.trim()) return;
      const entry = { from: player.id, name: player.name, text, ts: tnow };
      room.chatLog.push(entry);
      if (room.chatLog.length > CHAT_LOG_CAP) room.chatLog.shift();
      room.lastActivity = tnow;
      mgr.broadcast(room, { op: 'chat', ...entry });
      break;
    }
    case 'leave': {
      handleDisconnect(mgr, conn);
      break;
    }
    default:
      sendError(conn, 'UNKNOWN_OP', 'Unknown op: ' + msg.op);
  }
}

function handleDisconnect(mgr, conn) {
  const room = conn.room;
  conn.room = null;
  if (!room) return;
  const p = room.players.get(conn.playerId);
  // Only mark away if this connection is still the player's live socket
  // (a stale socket closing after a successful rejoin must not disconnect them).
  if (p && p.socket === conn) {
    p.connected = false;
    p.socket = null;
    p.disconnectedAt = Date.now();
    p.logIndex = room.state ? room.state.log.length : 0;
  }
  mgr.broadcastLobby(room);
}

// --- HTTP -------------------------------------------------------------------------

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function handleHttp(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') return sendJSON(res, 200, { ok: true });
  if (req.method === 'GET' && pathname === '/api/v1/time') return sendJSON(res, 200, { now: Date.now() });
  if (pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'not found' });

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, { error: 'method not allowed' });

  // safe path resolution (no traversal)
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return sendJSON(res, 403, { error: 'forbidden' });
  }
  let data;
  try {
    data = await readFile(filePath);
  } catch {
    return sendJSON(res, 404, { error: 'not found' });
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=300';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
  if (req.method === 'HEAD') res.end();
  else res.end(data);
}

// --- server factory -----------------------------------------------------------------

/**
 * Create the River Stakes server.
 * @param {number} port 0 = ephemeral
 * @returns {{server: import('node:http').Server, port: number, ready: Promise<number>, close: () => Promise<void>}}
 */
export function createServer(port = 0) {
  const mgr = new RoomManager();
  const conns = new Set();

  const server = http.createServer((req, res) => {
    handleHttp(req, res).catch(() => {
      try { sendJSON(res, 500, { error: 'internal' }); } catch {}
    });
  });

  server.on('upgrade', (req, socket) => {
    const pathname = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (pathname !== '/ws' || !key || upgrade !== 'websocket') {
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n');
    socket.setNoDelay(true);
    const conn = new WsConn(
      socket,
      (c, raw) => handleMessage(mgr, c, raw),
      (c) => { handleDisconnect(mgr, c); conns.delete(c); });
    conns.add(conn);
  });

  const gcTimer = setInterval(() => mgr.sweep(), 60000);
  if (gcTimer.unref) gcTimer.unref();

  const api = {
    server,
    port,
    ready: null,
    close() {
      return new Promise((resolve) => {
        clearInterval(gcTimer);
        for (const room of [...mgr.rooms.values()]) mgr.destroyRoom(room);
        for (const conn of [...conns]) conn.destroy();
        server.close(() => resolve());
        // if the server never opened (error), close() callback may not fire
        setTimeout(resolve, 1000).unref?.();
      });
    },
  };

  api.ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      api.port = server.address().port;
      resolve(api.port);
    });
  });

  return api;
}

// --- main ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8080;
  const { ready } = createServer(port);
  ready.then((p) => {
    console.log(`River Stakes server listening at http://localhost:${p}`);
    console.log(`WebSocket endpoint: ws://localhost:${p}/ws`);
  }).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
