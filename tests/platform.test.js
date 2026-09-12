// River Stakes — platform adapter tests (token, identity, cloud save, boards).
// Exercises js/platform.js through its public surface with a stubbed fetch.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from '../js/platform.js';

const SUB = 'a1b2c3d4e5f60718';
function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const TOKEN = jwt({ sub: SUB, game_scope: 'river-stakes' });

let calls;
let routes;

function stubFetch() {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const route = routes[String(url)];
    if (!route) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    return route(opts);
  };
}

const jsonRes = (status, body, ok = status >= 200 && status < 300) => ({
  ok, status,
  json: async () => body,
  arrayBuffer: async () => (body.arrayBuffer ? body.arrayBuffer() : new ArrayBuffer(0)),
});

function fakeLocation(hash, search, hostname) {
  const loc = { hash, search, hostname, pathname: '/index.html' };
  globalThis.location = loc;
  globalThis.history = {
    replaced: null,
    replaceState(_a, _b, url) { this.replaced = url; loc.hash = ''; },
  };
}

beforeEach(() => {
  routes = {};
  stubFetch();
  delete globalThis.location;
  delete globalThis.history;
});

test('fragment #game_token is read once, decoded, and stripped', async () => {
  fakeLocation(`#game_token=${TOKEN}&session_id=abc`, '', 'river-stakes.starhermit.com');
  const p = await Platform.init();
  assert.equal(p.mode, 'hosted');
  assert.equal(p.token, TOKEN);
  assert.equal(p.userId, SUB);
  assert.equal(p.gameKey, 'river-stakes');
  assert.equal(globalThis.history.replaced, '/index.html');
  assert.equal(globalThis.location.hash, '');
});

test('query-param token fallback is local-dev only', async () => {
  // localhost: accepted
  fakeLocation('', `?token=${TOKEN}`, 'localhost');
  let p = await Platform.init();
  assert.equal(p.token, TOKEN);
  // on-platform host: ignored
  fakeLocation('', `?token=${TOKEN}`, 'river-stakes.starhermit.com');
  p = await Platform.init();
  assert.equal(p.token, null);
  assert.equal(p.mode, 'local');
});

test('no token => local mode, dev-server probe sets localServer only', async () => {
  routes['/api/v1/time'] = async () => jsonRes(200, { now: Date.now() });
  const p = await Platform.init();
  assert.equal(p.mode, 'local');
  assert.equal(p.localServer, true);
  assert.equal(p.syncStatus, 'offline');
});

test('loadIdentity uses the profile nickname, never /api/v1/me', async () => {
  fakeLocation(`#game_token=${TOKEN}`, '', 'river-stakes.starhermit.com');
  routes[`/api/v1/users/${SUB}/profile`] = async (opts) => {
    assert.match(opts.headers.Authorization, /^Bearer /);
    return jsonRes(200, { id: SUB, username: 'moss_angler', nickname: 'River Rose' });
  };
  const p = await Platform.init();
  const id = await p.loadIdentity();
  assert.equal(id.nickname, 'River Rose');
  assert.ok(!calls.some((c) => c.url.includes('/api/v1/me')), 'never calls /api/v1/me');
  assert.ok(!calls.some((c) => c.url.includes('username')), 'never requests usernames');
});

test('loadIdentity falls back to Player + id8 on profile failure', async () => {
  fakeLocation(`#game_token=${TOKEN}`, '', 'river-stakes.starhermit.com');
  routes[`/api/v1/users/${SUB}/profile`] = async () => jsonRes(500, { error: 'x' }, false);
  const p = await Platform.init();
  const id = await p.loadIdentity();
  assert.equal(id.nickname, 'Player ' + SUB.slice(0, 8));
});

test('cloud save PUTs a zip (stored entry) with Bearer auth; load parses it', async () => {
  fakeLocation(`#game_token=${TOKEN}`, '', 'river-stakes.starhermit.com');
  const doc = { v: 1, savedAt: 1726000000000, progress: { lifetime: { hands: 42 } }, boards: {}, profile: { name: 'River Rose' } };
  let savedZip = null;
  routes['/api/v1/me/cloud-saves/river-stakes'] = async (opts) => {
    if (opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      assert.match(opts.headers.Authorization, /^Bearer /);
      assert.equal(typeof body.dataBase64, 'string');
      savedZip = Buffer.from(body.dataBase64, 'base64');
      return jsonRes(200, {});
    }
    // GET: serve back the very bytes the client wrote
    const ab = savedZip.buffer.slice(savedZip.byteOffset, savedZip.byteOffset + savedZip.byteLength);
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => ab };
  };
  const p = await Platform.init();
  p.scheduleCloudSave(doc);
  await p.flushCloud();
  assert.equal(p.syncStatus, 'synced');
  assert.ok(savedZip, 'PUT issued');

  // Strict structural check of the zip (local header + EOCD).
  assert.equal(savedZip.readUInt32LE(0), 0x04034b50, 'local header sig');
  assert.equal(savedZip.readUInt16LE(8), 0, 'stored (no compression)');
  const eocdOff = savedZip.length - 22;
  assert.equal(savedZip.readUInt32LE(eocdOff), 0x06054b50, 'EOCD sig');
  assert.equal(savedZip.readUInt16LE(eocdOff + 10), 1, 'one central entry');
  const cdOff = savedZip.readUInt32LE(eocdOff + 16);
  assert.equal(savedZip.readUInt32LE(cdOff), 0x02014b50, 'central dir sig');
  // Entry name + CRC round-trip through our own reader is verified by cloudLoad;
  // a python zipfile cross-check lives in the fix log validation.

  const remote = await p.cloudLoad();
  assert.deepEqual(remote, doc);
});

test('cloud save is skipped without a token; 404 load => null', async () => {
  routes['/api/v1/time'] = async () => jsonRes(404, {}, false);
  const p = await Platform.init();
  p.scheduleCloudSave({ progress: {} });
  assert.equal(p.syncStatus, 'offline');
  assert.equal(await p.cloudLoad(), null);
});

test('launch token refresh swaps in the re-minted token', async () => {
  fakeLocation(`#game_token=${TOKEN}`, '', 'river-stakes.starhermit.com');
  const fresh = jwt({ sub: SUB, game_scope: 'river-stakes', iat: 1726000100 });
  routes['/api/v1/games/river-stakes/launch-token'] = async (opts) => {
    assert.equal(opts.method, 'POST');
    assert.match(opts.headers.Authorization, new RegExp(`^Bearer ${TOKEN.replace(/[.]/g, '\\.')}`));
    return jsonRes(200, { token: fresh });
  };
  const p = await Platform.init();
  await p._refreshToken();
  assert.equal(p.token, fresh);
});

test('leaderboards: read-only entries with nickname resolution; no submit route', async () => {
  fakeLocation(`#game_token=${TOKEN}`, '', 'river-stakes.starhermit.com');
  routes['/api/v1/games/river-stakes'] = async () =>
    jsonRes(200, { leaderboardId: 'lb-1', me: { best: 10 } });
  routes['/api/v1/leaderboards/lb-1/entries?friendsOnly=&page=0&pageSize=10'] = async () =>
    jsonRes(200, { entries: [{ userId: 'ff00aa11bb22cc33', score: 1500 }, { userId: SUB, score: 900 }] });
  routes['/api/v1/users/ff00aa11bb22cc33/profile'] = async () =>
    jsonRes(200, { id: 'ff00aa11bb22cc33', nickname: 'Pike Pete' });
  routes[`/api/v1/users/${SUB}/profile`] = async () => jsonRes(500, {}, false);
  const p = await Platform.init();
  const board = await p.getGlobalBoard({ pageSize: 10 });
  assert.equal(board.length, 2);
  assert.equal(board[0].name, 'Pike Pete');
  assert.equal(board[0].value, 1500);
  assert.equal(board[1].name, 'Player ' + SUB.slice(0, 8));
  assert.ok(!calls.some((c) => c.opts.method === 'POST' && c.url.includes('leaderboard')),
    'leaderboards are never POSTed');

  // No leaderboardId => null (caller shows local records only)
  routes['/api/v1/games/river-stakes'] = async () => jsonRes(200, {});
  p._gameInfo = undefined;
  assert.equal(await p.getGlobalBoard({ pageSize: 10 }), null);
});

test('achievements stay local and idempotent', async () => {
  routes['/api/v1/time'] = async () => jsonRes(404, {}, false);
  const p = await Platform.init();
  assert.equal(await p.unlockAchievement('first_flow'), true);
  assert.equal(await p.unlockAchievement('first_flow'), false);
  assert.ok(p.achievements().first_flow > 0);
  assert.ok(!calls.some((c) => c.url.includes('achievements')), 'no achievement network call');
});

test('submitScore/getBoard keep personal bests local', async () => {
  routes['/api/v1/time'] = async () => jsonRes(404, {}, false);
  const p = await Platform.init();
  await p.submitScore('daily:2026-09-11', { value: 1200, ruleset: 'fixed-limit', contentVersion: 1, seed: 7, assists: [], durationMs: 5 });
  const board = await p.getBoard('daily:2026-09-11');
  assert.equal(board.length, 1);
  assert.equal(board[0].value, 1200);
  assert.ok(calls.every((c) => c.url === '/api/v1/time'), 'no board network call');
});
