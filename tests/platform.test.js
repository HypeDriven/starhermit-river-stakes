// River Stakes — platform adapter tests over the shipped StarHermit SDK with a
// stubbed fetch and launch fragment: token read/strip, profile nickname,
// cloud save round trip on `game:<slug>`, settings KV, control bindings,
// read-only boards, local achievements/boards, and no platform traffic
// standalone.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Platform } from '../js/platform.js';

const SDK = (() => {
  const m = { exports: {} };
  new Function('module', 'exports', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(m, m.exports);
  return m.exports;
})();

const SUB = 'a1b2c3d4e5f60718';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64u({ alg: 'none' })}.${b64u({ sub: SUB, game_scope: 'river-stakes', exp: 9999999999 })}.sig`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timers = { setTimeout: (fn, ms) => (ms > 5000 ? 0 : setTimeout(fn, ms)), clearTimeout: (t) => t && clearTimeout(t) };

let net;     // SDK (platform) traffic
let local;   // game's own dev-server traffic (global fetch)
function stubNet() {
  const calls = [];
  const store = { save: null, patches: [] };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, auth: init.headers && init.headers.Authorization });
    const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
    if (url === `/api/v1/users/${SUB}/profile`) return json(200, { nickname: 'River Rae', username: 'rae' });
    if (url === '/api/v1/users/u-2/profile') return json(200, { nickname: 'Dealer Dan' });
    if (url === '/api/v1/me/cloud-saves/game%3Ariver-stakes') {
      if (method === 'GET') return store.save ? new Response(store.save, { status: 200 }) : json(404, {});
      if (method === 'PUT') { store.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return json(200, { etag: `"v${calls.length}"` }); }
    }
    if (url === '/api/v1/games/river-stakes/settings') {
      if (method === 'GET') return json(200, { settings: { audio: { music: 0.2 }, other: 1 } });
      if (method === 'PATCH') { store.patches.push(JSON.parse(init.body).settings); return json(200, {}); }
    }
    if (url === '/api/v1/games/river-stakes/controls') return json(200, { actions: [{ action: 'fold', codes: ['KeyQ'] }] });
    if (url === '/api/v1/games/river-stakes') return json(200, { leaderboardId: 'lb-9' });
    if (url.startsWith('/api/v1/leaderboards/lb-9/entries')) return json(200, { items: [{ userId: 'u-2', score: 900, rank: 1 }] });
    return json(404, {});
  };
  return { calls, store, fetch };
}

function launch(hash, hostname) {
  const loc = { hash, search: '', hostname, pathname: '/index.html', href: `https://${hostname}/index.html${hash}`, origin: `https://${hostname}` };
  const win = { location: loc, history: { state: null, replaceState(_s, _t, url) { loc.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } } };
  globalThis.StarHermit = SDK.create({ window: win, fetch: net.fetch, ...timers });
  return loc;
}

beforeEach(() => {
  net = stubNet();
  local = [];
  globalThis.fetch = async (url) => { local.push(String(url)); return { ok: false, status: 404, json: async () => ({}) }; };
  delete globalThis.localStorage;
});

test('hosted: fragment token read + stripped, nickname, no dev-server probe', async () => {
  const loc = launch(`#game_token=${TOKEN}&session_id=abc`, 'river-stakes.starhermit.com');
  const p = await Platform.init();
  assert.equal(p.mode, 'hosted');
  assert.equal(loc.hash, '');
  assert.equal(p.token, TOKEN);
  assert.equal(p.userId, SUB);
  assert.equal(p.gameKey, 'river-stakes');
  assert.deepEqual(await p.loadIdentity(), { id: SUB, nickname: 'River Rae' });
  assert.equal(await p.nicknameFor('u-2'), 'Dealer Dan');
  assert.deepEqual(local, [], 'no own-server routes while hosted');
  assert.ok(!net.calls.some((c) => c.url === '/api/v1/me'));
  assert.ok(p.inviteLink().includes(`/game-invite/${SUB}/river-stakes`));
});

test('hosted: cloud save round trip on game:<slug>', async () => {
  launch(`#game_token=${TOKEN}`, 'localhost');
  const p = await Platform.init();
  assert.equal(await p.cloudLoad(), null);
  const statuses = [];
  p.onSyncStatus((s) => statuses.push(s));
  p.scheduleCloudSave({ v: 1, progress: { lifetime: { hands: 3 } } });
  await p.flushCloud();
  assert.ok(net.calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/me/cloud-saves/game%3Ariver-stakes' && c.auth === `Bearer ${TOKEN}`));
  assert.deepEqual(await p.cloudLoad(), { v: 1, progress: { lifetime: { hands: 3 } } });
  assert.deepEqual(statuses, ['saving', 'synced']);
});

test('hosted: settings KV groups win at start; changes patch the diff', async () => {
  launch(`#game_token=${TOKEN}`, 'localhost');
  const p = await Platform.init();
  assert.deepEqual(await p.platformSettings(), { audio: { music: 0.2 } });
  const settings = { audio: { music: 0.2 }, accessibility: { leftHanded: false }, ui: { shortcutHints: true } };
  p.settingsSynced(settings);
  p.saveSettings({ ...settings, accessibility: { leftHanded: true } });
  await sleep(700);
  assert.deepEqual(net.store.patches.at(-1), { accessibility: { leftHanded: true } });
});

test('hosted: bindings from the controls API; read-only board with nicknames', async () => {
  launch(`#game_token=${TOKEN}`, 'localhost');
  const p = await Platform.init();
  await p.loadBindings();
  assert.equal(p.actionFor('KeyQ'), 'fold');
  assert.equal(p.actionFor('KeyF'), null);
  assert.equal(p.actionFor('KeyX'), 'call');
  assert.deepEqual(await p.getGlobalBoard({ pageSize: 10 }), [{ name: 'Dealer Dan', value: 900, rank: 1 }]);
  assert.ok(!net.calls.some((c) => c.method === 'POST'), 'no score submission');
});

test('standalone on the platform host: no network at all; sign-in offered', async () => {
  launch('', '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com');
  const p = await Platform.init();
  assert.equal(p.mode, 'local');
  assert.equal(p.canSignIn(), true);
  assert.equal(await p.loadIdentity(), null);
  assert.equal(await p.cloudLoad(), null);
  p.scheduleCloudSave({ v: 1 });
  await p.flushCloud();
  assert.deepEqual(await p.platformSettings(), {});
  p.saveSettings({ audio: { music: 1 } });
  await p.loadBindings();
  assert.equal(p.actionFor('KeyF'), 'fold');
  assert.equal(await p.getGlobalBoard(), null);
  assert.equal(p.inviteLink(), null);
  await sleep(700);
  assert.deepEqual(net.calls, []);
  assert.deepEqual(local, [], 'no dev-server probe on a StarHermit host');
});

test('standalone locally: no network at all; achievements, boards and clock stay local', async () => {
  launch('', 'localhost');
  const p = await Platform.init();
  assert.equal(p.canSignIn(), false);
  assert.deepEqual(local, [], 'no own-server probe');
  assert.equal(p.utcToday(), new Date().toISOString().slice(0, 10), 'device-clock UTC day');
  assert.equal(await p.unlockAchievement('first_flow'), true);
  assert.equal(await p.unlockAchievement('first_flow'), false);
  await p.submitScore('daily:2026-09-11', { value: 1200, ruleset: 'fixed-limit', contentVersion: 1, seed: 7, assists: [], durationMs: 5 });
  assert.equal((await p.getBoard('daily:2026-09-11'))[0].value, 1200);
  assert.deepEqual(await p.postHighScore(1200), { posted: false, rank: null });
  assert.deepEqual(net.calls, []);
  assert.deepEqual(local, []);
});

test('hosted: postHighScore posts high-score and reads the rank', async () => {
  launch('#game_token=' + TOKEN, 'river-stakes.starhermit.com');
  const p = await Platform.init();
  const sent = [];
  globalThis.StarHermit.submitScores = async (sc) => { sent.push(sc); return Object.keys(sc); };
  globalThis.StarHermit.leaderboard = async (key) => ({ items: key === 'high-score' ? [{ userId: SUB, rank: 3 }] : [] });
  assert.deepEqual(await p.postHighScore(1480), { posted: true, rank: 3 });
  assert.deepEqual(sent, [{ 'high-score': 1480 }]);
  globalThis.StarHermit.submitScores = async () => [];
  assert.deepEqual(await p.postHighScore(10), { posted: false, rank: null });
});

test('leaderboard line strings in every locale', async () => {
  const { shText } = await import('../js/sh-i18n.js');
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    for (const l of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
      Object.defineProperty(globalThis, 'navigator', { value: { language: l }, configurable: true });
      for (const k of ['lbPosting', 'lbPosted', 'lbNotPosted']) assert.notEqual(shText(k), k, l + ' ' + k);
      assert.match(shText('lbRank', { rank: 4 }), /#4/, l);
    }
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'de-DE' }, configurable: true });
    assert.equal(shText('lbRank', { rank: 2 }), 'Platz in der Bestenliste: #2');
  } finally { if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; }
});

test('hosted: a lost conditional save emits onConflict; the merge keeps both devices\' progress', async () => {
  const { mergeProgress, mergeBoards } = await import('../js/merge.js');
  // ETag-versioned slot: writes after a load are conditional (If-Match / If-None-Match).
  let slot = null, version = 0;
  const puts = [];
  net.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const h = init.headers || {};
    const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/v1/me/cloud-saves/game%3Ariver-stakes/info') return json(200, slot ? { exists: true, etag: `"v${version}"` } : { exists: false });
    if (url === '/api/v1/me/cloud-saves/game%3Ariver-stakes') {
      if (method === 'GET') return slot ? new Response(slot, { status: 200 }) : json(404, {});
      const cur = slot ? `"v${version}"` : null;
      puts.push(h['If-Match'] || h['If-None-Match'] || null);
      if ((h['If-Match'] && h['If-Match'] !== cur) || (h['If-None-Match'] === '*' && slot)) return json(412, { error: 'precondition failed', etag: cur });
      slot = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
      version++;
      return json(200, { etag: `"v${version}"` });
    }
    return json(404, {});
  };
  launch(`#game_token=${TOKEN}`, 'river-stakes.starhermit.com');
  const p = await Platform.init();
  assert.equal(await p.cloudLoad(), null); // empty slot: the first write is If-None-Match: *
  let conflicts = 0;
  p.onConflict(() => { conflicts++; });
  const mine = { journey: { stars: { j01: 3, j02: 1 }, unlocked: 2 }, lifetime: { hands: 40, handsWon: 12, bestHand: 'Flush' }, tutorial: { t01: true }, achievements: { first_flow: 500 } };
  p.scheduleCloudSave({ v: 1, progress: mine, boards: {} }, 0);
  await p.flushCloud();
  assert.equal(puts[0], '*');
  // Another device saves different progress.
  const theirs = { journey: { stars: { j01: 1, j03: 2 }, unlocked: 3 }, lifetime: { hands: 55, handsWon: 9, bestHand: 'Straight' }, challenges: { c02: true }, achievements: { first_flow: 300, mechanic_master: 900 }, daily: { lastDate: '2026-10-16', streak: 4 } };
  slot = Buffer.from(globalThis.StarHermit._zip('save.json', new TextEncoder().encode(JSON.stringify({ v: 1, progress: theirs }))));
  version++;
  p.scheduleCloudSave({ v: 1, progress: mine, boards: {} }, 0);
  await p.flushCloud();
  await sleep(10);
  assert.equal(conflicts, 1);
  assert.equal(p.saveConflicted(), true);
  const remote = await p.cloudLoad(); // reload lifts the block
  assert.equal(p.saveConflicted(), false);
  const merged = mergeProgress(mine, remote.progress);
  assert.deepEqual(merged.journey, { stars: { j01: 3, j02: 1, j03: 2 }, unlocked: 3 });
  assert.equal(merged.lifetime.hands, 55);
  assert.equal(merged.lifetime.handsWon, 12);
  assert.equal(merged.lifetime.bestHand, 'Flush');
  assert.deepEqual(merged.tutorial, { t01: true });
  assert.deepEqual(merged.challenges, { c02: true });
  assert.deepEqual(merged.achievements, { first_flow: 300, mechanic_master: 900 });
  assert.deepEqual(merged.daily, { lastDate: '2026-10-16', streak: 4 });
  p.scheduleCloudSave({ v: 1, progress: merged, boards: {} }, 0);
  assert.equal(await p.flushCloud(), true);
  assert.equal(puts.at(-1), '"v2"', 'merge written on top of the other device\'s version');
  const boards = mergeBoards({ daily: [{ value: 10, ts: 1 }] }, { daily: [{ value: 30, ts: 2 }, { value: 10, ts: 1 }] });
  assert.deepEqual(boards.daily.map((e) => e.value), [30, 10]);
});
