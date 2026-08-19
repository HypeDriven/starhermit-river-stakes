// River Stakes — replay + session orchestration tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../js/session.js';
import { createGame, applyCommand, hashState } from '../js/rules/engine.js';
import { Rng } from '../js/rules/rng.js';

const SEEDS = [1, 7, 42, 1337, 90210, 555, 271828, 314159, 80085, 20260101];

function makeConfig(seed) {
  return {
    seed,
    smallBlind: 5,
    bigBlind: 10,
    players: [
      { id: 'you', name: 'You', chips: 800, ai: null },
      { id: 'moss', name: 'Moss', chips: 800, ai: 'easy' },
      { id: 'heron', name: 'Heron', chips: 800, ai: 'normal' },
    ],
    maxHands: 6,
  };
}

/**
 * Drive a full match synchronously. aiDelay:0 makes Session settle AI moves
 * inside dispatch(); autoAdvance is off so the scripted human sends 'advance'
 * commands itself (no timers anywhere in this path).
 */
function playout(seed, policyRng) {
  const rng = policyRng || new Rng(seed, 'test-policy');
  const session = new Session({ config: makeConfig(seed), mode: 'practice', aiDelay: 0, autoAdvance: false, allowUndo: true });
  session.start();
  let guard = 0;
  while (!session.state.terminal) {
    assert.ok(guard++ < 5000, `seed ${seed}: playout exceeded command budget (possible hang)`);
    const legal = session.legal();
    assert.ok(legal.length > 0, `seed ${seed}: no human legal actions and no pending AI (aiDelay:0) — stalled at tick ${session.state.tick}`);
    const a = legal[rng.int(legal.length)];
    const res = session.dispatch(a.type, a.amount);
    assert.ok(res.ok, `seed ${seed}: legal action ${a.type} rejected: ${res.error && res.error.code}`);
  }
  return session;
}

test('10 seeded playouts export replays that verify ok with matching finalHash', () => {
  for (const seed of SEEDS) {
    const session = playout(seed);
    const envelope = session.exportReplay();
    assert.equal(envelope.schema, 1);
    assert.equal(envelope.seed, seed);
    assert.ok(envelope.commands.length > 0, `seed ${seed}: envelope has no commands`);
    assert.equal(envelope.commands.length, envelope.hashes.length);
    const v = Session.verifyReplay(envelope);
    assert.ok(v.ok, `seed ${seed}: verifyReplay failed: ${v.error && v.error.code} ${v.error && v.error.message}`);
    assert.equal(v.finalHash, session.hash(), `seed ${seed}: finalHash != live state hash`);
    assert.equal(v.finalHash, envelope.hashes[envelope.hashes.length - 1]);
  }
});

test('same seed + same policy => identical hash chain', () => {
  for (const seed of [11, 222]) {
    const a = playout(seed);
    const b = playout(seed);
    assert.deepEqual(a.exportReplay().hashes, b.exportReplay().hashes, `seed ${seed}: hash chains diverged`);
    assert.deepEqual(a.exportReplay().commands, b.exportReplay().commands, `seed ${seed}: command logs diverged`);
  }
});

test('tampered replays fail verification', () => {
  const session = playout(99);
  const good = session.exportReplay();
  assert.ok(good.commands.length >= 5, 'need a few commands to tamper with');

  const flipType = JSON.parse(JSON.stringify(good));
  flipType.commands[2].type = 'definitely-not-an-action';
  assert.equal(Session.verifyReplay(flipType).ok, false, 'bad type accepted');

  const badTick = JSON.parse(JSON.stringify(good));
  badTick.commands[3].tick += 1;
  assert.equal(Session.verifyReplay(badTick).ok, false, 'bad tick accepted');

  const badHash = JSON.parse(JSON.stringify(good));
  badHash.hashes[1] = '0000000000000000';
  const vh = Session.verifyReplay(badHash);
  assert.equal(vh.ok, false, 'hash mismatch accepted');
  assert.equal(vh.error.code, 'HASH_MISMATCH');

  const truncated = JSON.parse(JSON.stringify(good));
  truncated.hashes.pop();
  assert.equal(Session.verifyReplay(truncated).ok, false, 'length mismatch accepted');
});

test('verifyReplay never throws on garbage envelopes', () => {
  for (const env of [null, undefined, 42, 'nope', [], {}, { schema: 1 }, { schema: 2, commands: [], hashes: [] }, { schema: 1, commands: null, hashes: [] }]) {
    const v = Session.verifyReplay(env);
    assert.equal(v.ok, false, `envelope ${JSON.stringify(env)} should fail`);
    assert.ok(v.error && typeof v.error.code === 'string');
  }
});

test('fuzz: 2000 malformed engine commands never throw, never hang, always {ok:false}', () => {
  const rng = new Rng(123456, 'fuzz');
  const state0 = createGame(makeConfig(777));
  const stateHash0 = hashState(state0);
  let state = state0;
  for (let i = 0; i < 2000; i++) {
    const kind = rng.int(5);
    let cmd;
    if (kind === 0) {
      // wrong tick, otherwise plausible
      cmd = { id: `fz-${i}`, tick: state.tick + 1 + rng.int(1000), playerId: 'you', type: 'advance' };
    } else if (kind === 1) {
      // bogus type
      const badTypes = ['zzz', 'Fold', 'RAISE ', '', 'checkraise', 'advance ', '__proto__'];
      cmd = { id: `fz-${i}`, tick: state.tick, playerId: 'you', type: badTypes[rng.int(badTypes.length)] };
    } else if (kind === 2) {
      // unknown player
      cmd = { id: `fz-${i}`, tick: state.tick, playerId: `ghost-${i}`, type: 'advance' };
    } else if (kind === 3) {
      // bad amounts
      const badAmounts = [-1, -1000, 2.5, 0.1, NaN, 'lots', null, {}, [], 1e15];
      cmd = { id: `fz-${i}`, tick: state.tick, playerId: 'you', type: 'raise', amount: badAmounts[rng.int(badAmounts.length)] };
    } else {
      // structurally malformed commands
      const junk = [null, undefined, 42, 'fold', {}, { id: `fz-${i}` }, { tick: 0 }, { id: `fz-${i}`, tick: state.tick }];
      cmd = junk[rng.int(junk.length)];
    }
    let res;
    try {
      res = applyCommand(state, cmd);
    } catch (e) {
      assert.fail(`command ${i} (${JSON.stringify(cmd)}) threw: ${(e && e.message) || e}`);
    }
    assert.ok(res && typeof res === 'object', `command ${i}: result is not an object`);
    assert.equal(res.ok, false, `command ${i} (${JSON.stringify(cmd)}) was accepted`);
    assert.ok(res.error && typeof res.error.code === 'string', `command ${i}: missing error code`);
  }
  assert.equal(hashState(state), stateHash0, 'fuzzing mutated/altered the state');
});

test('session-level garbage dispatch is rejected and counted, session survives', () => {
  const rng = new Rng(999, 'fuzz-session');
  const session = new Session({ config: makeConfig(31337), aiDelay: 0, autoAdvance: false });
  session.start();
  const hash0 = session.hash();
  const junk = ['zzz', 'Fold', '', null, undefined, 42, 'pot', 'checkraise'];
  for (let i = 0; i < 200; i++) {
    const res = session.dispatch(junk[rng.int(junk.length)], i % 2 ? -5 : undefined);
    assert.equal(res.ok, false, `garbage dispatch ${i} accepted`);
  }
  assert.equal(session._invalidActions ?? session.summary().invalidActions, 200);
  assert.equal(session.hash(), hash0, 'garbage dispatch changed state');
  session.dispose();
});

test('undo restores the last human decision point (allowUndo only)', () => {
  const session = new Session({ config: makeConfig(4242), aiDelay: 0, autoAdvance: false, allowUndo: true });
  session.start();
  assert.equal(session.canUndo(), false);
  assert.ok(session.dispatch('advance').ok);
  const before = session.hash();
  const legal = session.legal().filter((a) => a.type !== 'advance');
  assert.ok(legal.length > 0, 'expected a real decision after advancing');
  assert.ok(session.dispatch(legal[0].type, legal[0].amount).ok);
  assert.notEqual(session.hash(), before);
  assert.ok(session.canUndo());
  assert.equal(session.undo(), true);
  assert.equal(session.hash(), before, 'undo did not restore the pre-decision state');

  const noUndo = new Session({ config: makeConfig(4242), aiDelay: 0, autoAdvance: false });
  noUndo.start();
  noUndo.dispatch('advance');
  assert.equal(noUndo.canUndo(), false);
  assert.equal(noUndo.undo(), false);
  session.dispose();
  noUndo.dispose();
});

test('skip() settles pending AI timers instantly', () => {
  // huge delays: without skip() nothing would ever move in a test
  const session = new Session({ config: makeConfig(606), aiDelay: 60000, autoAdvance: true, autoAdvanceDelay: 60000 });
  session.start();
  assert.equal(session.state.phase, 'init');
  session.skip(); // settle the pending auto-advance + AI line synchronously
  assert.equal(session._timers.size, 0, 'skip left timers pending');
  let guard = 0;
  while (!session.state.terminal && guard++ < 500) {
    const legal = session.legal().filter((a) => a.type !== 'advance');
    if (legal.length === 0) { session.skip(); continue; }
    assert.ok(session.dispatch(legal[0].type, legal[0].amount).ok);
    session.skip();
  }
  assert.ok(session.state.terminal, 'skip-driven match did not terminate');
  session.dispose();
});

test('pause/resume suspend AI timers', async () => {
  const session = new Session({ config: makeConfig(808), aiDelay: 30, autoAdvance: false });
  session.start();
  session.dispatch('advance'); // AI now has pending timers
  session.pause();
  const hashPaused = session.hash();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(session.hash(), hashPaused, 'state moved while paused');
  session.resume();
  session.skip(); // settle everything rather than waiting for timers
  session.dispose();
});

test('summary() reports stats, invalid actions and final places', () => {
  const session = playout(2024);
  const sum = session.summary();
  assert.ok(sum.handsPlayed > 0);
  assert.equal(sum.invalidActions, 0);
  assert.ok(sum.terminal, 'expected a terminal match (maxHands: 6)');
  assert.ok(Number.isInteger(sum.elapsedMs) && sum.elapsedMs >= 0);
  assert.equal(sum.goalsContext.standings.length, 3);
  assert.equal(sum.goalsContext.places[sum.goalsContext.standings[0].id], 1);
  assert.equal(typeof sum.stats.you.handsWon, 'number');
  session.dispose();
});

test('saveSnapshot hook receives serialized states', () => {
  const saves = [];
  const session = new Session({ config: makeConfig(5150), aiDelay: 0, autoAdvance: false, saveSnapshot: (s) => saves.push(s) });
  session.start();
  session.dispatch('advance');
  assert.ok(saves.length >= 1, 'no autosave happened');
  assert.equal(typeof saves[saves.length - 1], 'string');
  session.dispose();
});
