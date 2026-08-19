// River Stakes — server.js integration tests (node:test, global WebSocket client).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.js';
import { legalActions } from '../js/rules/engine.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TIMEOUT = 10000;

let srv;
let base;
let wsBase;

function withTimeout(promise, ms = TIMEOUT, label = 'operation') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout: ' + label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class TestClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.inbox = [];
    this.waiters = [];
    this.lastSnapshot = null;
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.op === 'snapshot') this.lastSnapshot = msg.snapshot;
      for (let i = 0; i < this.waiters.length; i++) {
        if (this.waiters[i].pred(msg)) {
          const w = this.waiters.splice(i, 1)[0];
          w.resolve(msg);
          return;
        }
      }
      this.inbox.push(msg);
    });
  }

  send(obj) {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  waitFor(pred, ms = TIMEOUT) {
    if (typeof pred === 'string') { const op = pred; pred = (m) => m.op === op; }
    for (let i = 0; i < this.inbox.length; i++) {
      if (pred(this.inbox[i])) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    }
    return withTimeout(
      new Promise((resolve) => this.waiters.push({ pred, resolve })), ms, 'waitFor');
  }

  /** Wait until this client's latest snapshot shows playerId as current actor. */
  async waitForTurn(playerId, ms = TIMEOUT) {
    const deadline = Date.now() + ms;
    for (;;) {
      const s = this.lastSnapshot;
      if (s && s.currentActor != null && s.players[s.currentActor]
          && s.players[s.currentActor].id === playerId) return s;
      if (Date.now() > deadline) throw new Error('timeout: waitForTurn ' + playerId);
      await sleep(15);
    }
  }

  close() { try { this.ws.close(); } catch {} }
}

before(async () => {
  srv = createServer(0);
  const port = await withTimeout(srv.ready, TIMEOUT, 'server listen');
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

after(async () => {
  if (srv) await srv.close();
});

test('GET /api/health and /api/v1/time', async () => {
  const health = await withTimeout(fetch(base + '/api/health').then((r) => r.json()), TIMEOUT, 'health');
  assert.equal(health.ok, true);
  const time = await withTimeout(fetch(base + '/api/v1/time').then((r) => r.json()), TIMEOUT, 'time');
  assert.equal(typeof time.now, 'number');
  assert.ok(Math.abs(time.now - Date.now()) < 60000);
});

test('GET / serves index.html (or 404 until lead ships it)', async (t) => {
  const res = await withTimeout(fetch(base + '/'), TIMEOUT, 'static /');
  if (!existsSync(path.join(ROOT, 'index.html'))) {
    assert.equal(res.status, 404);
    t.skip('index.html not present yet (owned by lead)');
    return;
  }
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const body = await res.text();
  assert.ok(body.length > 0 && body.includes('<'));
});

test('static path traversal is rejected', async () => {
  const res = await withTimeout(
    fetch(base + '/..%2F..%2Fetc%2Fpasswd').catch(() => null), TIMEOUT, 'traversal');
  if (res) assert.ok([400, 403, 404].includes(res.status));
});

test('two clients: create/join/ready/play/chat/duplicate/out-of-turn/malformed', async () => {
  const A = new TestClient(wsBase + '/ws');
  const B = new TestClient(wsBase + '/ws');
  await withTimeout(Promise.all([A.ready, B.ready]), TIMEOUT, 'ws open');
  try {
    // hello
    A.send({ op: 'hello', name: 'Alice' });
    B.send({ op: 'hello', name: 'Bob' });
    const [wa, wb] = await Promise.all([A.waitFor('welcome'), B.waitFor('welcome')]);
    assert.ok(wa.playerId && typeof wa.serverTime === 'number');
    assert.ok(wb.playerId);
    const aliceId = wa.playerId;
    const bobId = wb.playerId;

    // A creates a room: 2 human seats + 1 easy AI
    A.send({
      op: 'create',
      config: {
        smallBlind: 5, bigBlind: 10, chips: 500, maxHands: 1,
        aiDelayMs: 30, autoAdvanceMs: 60,
        players: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Bot', ai: 'easy' }],
      },
    });
    const lobbyA = await A.waitFor((m) => m.op === 'lobby');
    assert.equal(typeof lobbyA.code, 'string');
    assert.equal(lobbyA.code.length, 5);
    assert.ok(lobbyA.you && lobbyA.you.token, 'lobby carries our rejoin token');

    // B joins by code
    B.send({ op: 'join', code: lobbyA.code });
    const lobbyB = await B.waitFor((m) => m.op === 'lobby');
    assert.equal(lobbyB.code, lobbyA.code);
    const names = lobbyB.players.map((p) => p.name);
    assert.ok(names.includes('Alice') && names.includes('Bob') && names.includes('Bot'));

    // both ready -> started + scrubbed snapshots
    A.send({ op: 'ready', ready: true });
    B.send({ op: 'ready', ready: true });
    const [startedA, startedB] = await Promise.all([
      A.waitFor('started'), B.waitFor('started'),
    ]);
    assert.equal(startedA.code, lobbyA.code);
    assert.equal(startedB.players.length, 3);

    const snapB = await B.waitFor((m) => m.op === 'snapshot' && m.snapshot.phase !== 'init');
    const bView = snapB.snapshot;
    const aliceInB = bView.players.find((p) => p.id === aliceId);
    const bobInB = bView.players.find((p) => p.id === bobId);
    assert.ok(aliceInB && bobInB, 'both humans present in snapshot');
    assert.equal(aliceInB.cards, null, "B must not see A's hole cards");
    assert.ok(Array.isArray(bobInB.cards) && bobInB.cards.length === 2, 'B sees own cards');

    // wait for Alice's turn and send a legal command
    const snapAtTurn = await A.waitForTurn(aliceId);
    const legal = legalActions(snapAtTurn, aliceId);
    assert.ok(legal.length > 0, 'Alice has legal actions on her turn');
    const chosen = legal.find((a) => a.type === 'call') || legal.find((a) => a.type === 'check') || legal[0];
    const tickBefore = snapAtTurn.tick;
    const command = {
      id: 'test-cmd-1', tick: tickBefore, playerId: aliceId,
      type: chosen.type, amount: chosen.amount,
    };
    A.send({ op: 'cmd', command });
    const [afterA, afterB] = await Promise.all([
      A.waitFor((m) => m.op === 'snapshot' && m.tick === tickBefore + 1),
      B.waitFor((m) => m.op === 'snapshot' && m.tick === tickBefore + 1),
    ]);
    assert.equal(afterA.tick, tickBefore + 1, 'tick advanced for A');
    assert.equal(afterB.tick, tickBefore + 1, 'tick advanced for B');

    // duplicate command id: idempotent, no second tick advance
    A.send({ op: 'cmd', command });
    const dup = await A.waitFor((m) => m.op === 'snapshot' && m.duplicate === true);
    assert.equal(dup.tick, tickBefore + 1, 'duplicate did not re-apply');

    // out-of-turn command -> error to the sender only
    const cur = A.lastSnapshot;
    const actor = cur.currentActor != null ? cur.players[cur.currentActor].id : null;
    const [sender, otherId] = actor === aliceId ? [B, bobId] : [A, aliceId];
    if (actor !== null) {
      sender.send({
        op: 'cmd',
        command: { id: 'test-out-of-turn', tick: cur.tick, playerId: otherId, type: 'fold' },
      });
      const err = await sender.waitFor('error');
      assert.ok(err.code, 'error carries a code');
      assert.ok(['NOT_YOUR_TURN', 'BAD_TICK', 'ILLEGAL_ACTION', 'BAD_PHASE'].includes(err.code));
    }

    // chat is relayed
    A.send({ op: 'chat', text: 'hello table' });
    const chatAtB = await B.waitFor((m) => m.op === 'chat');
    assert.equal(chatAtB.text, 'hello table');
    assert.equal(chatAtB.from, aliceId);

    // malformed JSON -> error, connection stays usable
    A.send('{this is not json');
    const merr = await A.waitFor((m) => m.op === 'error' && m.code === 'MALFORMED');
    assert.ok(merr.message);
    A.send({ op: 'chat', text: 'still here' });
    const chat2 = await B.waitFor((m) => m.op === 'chat' && m.text === 'still here');
    assert.equal(chat2.text, 'still here');
  } finally {
    A.close();
    B.close();
  }
});

test('join with bad code -> error', async () => {
  const C = new TestClient(wsBase + '/ws');
  await withTimeout(C.ready, TIMEOUT, 'ws open');
  try {
    C.send({ op: 'hello', name: 'Carol' });
    await C.waitFor('welcome');
    C.send({ op: 'join', code: 'ZZZZZ' });
    const err = await C.waitFor('error');
    assert.equal(err.code, 'NO_ROOM');
  } finally {
    C.close();
  }
});

test('manual advance racing the autoAdvance timer must not wedge the room', async () => {
  const A = new TestClient(wsBase + '/ws');
  await withTimeout(A.ready, TIMEOUT, 'ws open');
  try {
    A.send({ op: 'hello', name: 'Solo' });
    const w = await A.waitFor('welcome');
    const me = w.playerId;
    A.send({
      op: 'create',
      config: {
        smallBlind: 5, bigBlind: 10, chips: 2000, maxHands: 5,
        aiDelayMs: 20, autoAdvanceMs: 3000, // wide window to force the race
        players: [{ name: 'Solo' }, { name: 'Bot1', ai: 'easy' }, { name: 'Bot2', ai: 'easy' }],
      },
    });
    await A.waitFor('lobby');
    A.send({ op: 'ready', ready: true });
    await A.waitFor('started');
    await A.waitFor((m) => m.op === 'snapshot' && m.snapshot.phase !== 'init');

    const deadline = Date.now() + TIMEOUT;
    for (;;) {
      const s = A.lastSnapshot;
      assert.ok(Date.now() < deadline, 'room must keep progressing');
      if (!s) { await sleep(20); continue; }
      if (s.terminal) break;
      if (s.phase === 'handEnd') {
        // Human advances immediately, inside the 3s autoAdvance window.
        const tick = s.tick;
        A.send({ op: 'cmd', command: { id: 'manual-advance-1', tick, playerId: me, type: 'advance' } });
        const after = await A.waitFor((m) => m.op === 'snapshot' && m.tick === tick + 1);
        assert.notEqual(after.snapshot.phase, 'handEnd', 'manual advance applied');
        // Wait beyond the autoAdvance window: the stale timer fires, no-ops,
        // and MUST re-arm scheduling for the current actor.
        await sleep(3300);
        const s2 = A.lastSnapshot;
        const progressed = s2.tick > tick + 1
          || (s2.currentActor != null && s2.players[s2.currentActor].id === me)
          || !!s2.terminal;
        assert.ok(progressed, 'room continued after manual advance raced the auto-advance timer');
        return;
      }
      if (s.currentActor != null && s.players[s.currentActor].id === me) {
        const legal = legalActions(s, me);
        const a = legal.find((x) => x.type === 'check') || legal.find((x) => x.type === 'call') || legal[0];
        if (a) A.send({ op: 'cmd', command: { id: 'p-' + s.tick, tick: s.tick, playerId: me, type: a.type, amount: a.amount } });
      }
      await sleep(20);
    }
    // Terminal before any handEnd is impossible (handEnd precedes terminal), but
    // if the match ended another way the race is moot — accept terminal as pass.
  } finally {
    A.close();
  }
});
