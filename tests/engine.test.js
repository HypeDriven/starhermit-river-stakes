// River Stakes — engine tests (phases, errors, blinds, side pots, terminal, serialization).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, legalActions, applyCommand, getSnapshot,
  serialize, deserialize, hashState, potTotal, summarize, PHASES,
} from '../js/rules/engine.js';
import { chooseAction } from '../js/rules/ai.js';
import { Rng } from '../js/rules/rng.js';

function mkConfig(over = {}) {
  return {
    seed: 42, smallBlind: 25, bigBlind: 50, maxHands: null,
    players: [
      { id: 'a', name: 'Ada', chips: 1000, ai: null },
      { id: 'b', name: 'Bo', chips: 1000, ai: null },
      { id: 'c', name: 'Cy', chips: 1000, ai: null },
    ],
    ...over,
  };
}

function cmd(state, playerId, type, amount) {
  const c = { id: `t-${state.tick}-${playerId}`, tick: state.tick, playerId, type };
  if (amount !== undefined) c.amount = amount;
  return c;
}

/** Apply a command for the current actor (or given player); asserts success. */
function apply(state, type, amount, playerId) {
  const pid = playerId ?? state.players[state.currentActor].id;
  const r = applyCommand(state, cmd(state, pid, type, amount));
  assert.ok(r.ok, JSON.stringify(r.error));
  return r;
}

function advance(state, playerId = 'a') {
  const r = applyCommand(state, cmd(state, playerId, 'advance'));
  assert.ok(r.ok, JSON.stringify(r.error));
  return r;
}

test('PHASES list', () => {
  assert.deepEqual(PHASES, ['init', 'preflop', 'flop', 'turn', 'river', 'showdown', 'handEnd', 'terminal']);
});

test('createGame starts in init with clean state', () => {
  const s = createGame(mkConfig());
  assert.equal(s.phase, 'init');
  assert.equal(s.tick, 0);
  assert.equal(s.handNumber, 0);
  assert.equal(s.players.length, 3);
  assert.equal(potTotal(s), 0);
  assert.ok(s.players.every((p) => p.cards === null && p.status === 'active'));
});

test('legalActions per phase: init gives everyone advance', () => {
  const s = createGame(mkConfig());
  for (const p of s.players) {
    assert.deepEqual(legalActions(s, p.id), [{ type: 'advance' }]);
  }
});

test('betting action in init phase -> BAD_PHASE', () => {
  const s = createGame(mkConfig());
  const r = applyCommand(s, cmd(s, 'a', 'call', 50));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BAD_PHASE');
});

test('advance deals the first hand (3-handed blinds)', () => {
  const { state: s, events } = advance(createGame(mkConfig()));
  assert.equal(s.phase, 'preflop');
  assert.equal(s.handNumber, 1);
  assert.equal(s.dealer, 0);
  // 3-handed: SB = seat after dealer, BB = next
  assert.equal(s.players[1].bet, 25); // SB
  assert.equal(s.players[2].bet, 50); // BB
  assert.equal(s.players[1].chips, 975);
  assert.equal(s.players[2].chips, 950);
  assert.equal(s.currentBet, 50);
  assert.equal(s.betsThisRound, 1);
  // first actor preflop is seat after BB -> seat 0
  assert.equal(s.currentActor, 0);
  // everyone dealt 2 cards, deck consistent
  for (const p of s.players) assert.equal(p.cards.length, 2);
  assert.equal(new Set([...s.deck]).size, 52);
  assert.ok(events.some((e) => e.type === 'handStart'));
  assert.ok(events.filter((e) => e.type === 'post').length === 2);
  assert.ok(events.some((e) => e.type === 'deal'));
  // legal actions for current actor
  const legal = legalActions(s, 'a');
  const types = legal.map((a) => a.type);
  assert.ok(types.includes('fold') && types.includes('call') && types.includes('raise') && types.includes('allin'));
  assert.equal(legal.find((a) => a.type === 'call').amount, 50);
  assert.equal(legal.find((a) => a.type === 'raise').amount, 100);
  // not-your-turn players get []
  assert.deepEqual(legalActions(s, 'b'), []);
});

test('heads-up blind order: dealer posts SB and acts first preflop', () => {
  let s = createGame(mkConfig({ players: [
    { id: 'a', name: 'Ada', chips: 1000, ai: null },
    { id: 'b', name: 'Bo', chips: 1000, ai: null },
  ] }));
  s = advance(s).state;
  assert.equal(s.dealer, 0);
  assert.equal(s.players[0].bet, 25); // dealer = SB
  assert.equal(s.players[1].bet, 50); // BB
  assert.equal(s.currentActor, 0); // dealer acts first preflop
  // dealer completes, BB checks -> flop; postflop BB (non-dealer) acts first
  s = apply(s, 'call').state;
  s = apply(s, 'check').state;
  assert.equal(s.phase, 'flop');
  assert.equal(s.currentActor, 1);
});

test('tick increments and BAD_TICK is enforced', () => {
  let s = createGame(mkConfig());
  const bad = applyCommand(s, cmd(s, 'a', 'advance'));
  bad.tick = 5;
  const r1 = applyCommand(s, { ...cmd(s, 'a', 'advance'), tick: 7 });
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, 'BAD_TICK');
  s = advance(s).state;
  assert.equal(s.tick, 1);
  // replaying the old tick is rejected
  const r2 = applyCommand(s, cmd({ ...s, tick: 0 }, 'a', 'advance'));
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, 'BAD_TICK');
});

test('error codes: MALFORMED, UNKNOWN_PLAYER, NOT_YOUR_TURN, ILLEGAL_ACTION, BAD_AMOUNT', () => {
  let s = createGame(mkConfig());
  assert.equal(applyCommand(s, null).error.code, 'MALFORMED');
  assert.equal(applyCommand(s, { id: 'x' }).error.code, 'MALFORMED');
  assert.equal(applyCommand(s, cmd(s, 'zzz', 'advance')).error.code, 'UNKNOWN_PLAYER');
  s = advance(s).state;
  // seat 0 acts; b is not the actor
  assert.equal(applyCommand(s, cmd(s, 'b', 'fold')).error.code, 'NOT_YOUR_TURN');
  // toCall is 50, so check is illegal
  assert.equal(applyCommand(s, cmd(s, 'a', 'check')).error.code, 'ILLEGAL_ACTION');
  // call with the wrong amount
  assert.equal(applyCommand(s, cmd(s, 'a', 'call', 51)).error.code, 'BAD_AMOUNT');
  // non-integer amount
  assert.equal(applyCommand(s, cmd(s, 'a', 'call', 50.5)).error.code, 'BAD_AMOUNT');
});

test('applyCommand does not mutate the input state', () => {
  let s = createGame(mkConfig());
  s = advance(s).state;
  const before = JSON.stringify(s);
  const r = applyCommand(s, cmd(s, 'a', 'call'));
  assert.ok(r.ok);
  assert.equal(JSON.stringify(s), before);
  assert.notEqual(r.state, s);
});

test('fold-to-win awards the pot without showdown', () => {
  let s = createGame(mkConfig({ players: [
    { id: 'a', name: 'Ada', chips: 1000, ai: null },
    { id: 'b', name: 'Bo', chips: 1000, ai: null },
  ] }));
  s = advance(s).state;
  const r = apply(s, 'fold'); // dealer/SB folds preflop
  s = r.state;
  assert.equal(s.phase, 'handEnd');
  assert.equal(s.showdown, null);
  assert.deepEqual(s.winners, ['b']);
  assert.equal(s.players[1].chips, 1025); // 950 + 75 pot
  assert.equal(s.players[0].chips, 975);
  assert.equal(potTotal(s), 0);
  assert.equal(s.stats.b.handsWon, 1);
  assert.equal(s.stats.b.potsWon, 75);
  assert.equal(s.stats.a.folds, 1);
  assert.ok(r.events.some((e) => e.type === 'award'));
  assert.ok(!r.events.some((e) => e.type === 'showdown'));
  // handEnd: everyone still in gets advance
  assert.deepEqual(legalActions(s, 'a'), [{ type: 'advance' }]);
  assert.deepEqual(legalActions(s, 'b'), [{ type: 'advance' }]);
});

test('4-bet cap: no raise (or all-in over) once 4 bets are in', () => {
  let s = createGame(mkConfig({ players: [
    { id: 'a', name: 'Ada', chips: 5000, ai: null },
    { id: 'b', name: 'Bo', chips: 5000, ai: null },
  ] }));
  s = advance(s).state;
  s = apply(s, 'raise', 100).state; // 2 bets
  s = apply(s, 'raise', 150).state; // 3 bets
  s = apply(s, 'raise', 200).state; // 4 bets (cap)
  const legal = legalActions(s, s.players[s.currentActor].id);
  const types = legal.map((a) => a.type);
  assert.deepEqual(types.sort(), ['call', 'fold']);
  assert.equal(legal.find((a) => a.type === 'call').amount, 50); // b has 150 in, currentBet 200
  s = apply(s, 'call').state;
  assert.equal(s.phase, 'flop');
});

test('3-way all-in: side pots with exact chip math', () => {
  let s = createGame(mkConfig({
    seed: 7, smallBlind: 25, bigBlind: 50,
    players: [
      { id: 'a', name: 'Ada', chips: 100, ai: null },
      { id: 'b', name: 'Bo', chips: 150, ai: null },
      { id: 'c', name: 'Cy', chips: 400, ai: null },
    ],
  }));
  s = advance(s).state; // dealer a, SB b (25), BB c (50)
  assert.equal(s.currentActor, 0);
  s = apply(s, 'allin', 100).state; // a all-in (full raise to 100)
  s = apply(s, 'allin', 150).state; // b all-in (full raise to 150)
  s = apply(s, 'allin', 400).state; // c all-in (full raise to 400)
  assert.equal(s.phase, 'handEnd');
  assert.equal(s.community.length, 5); // auto-runout happened
  assert.equal(s.pots.length, 3);
  assert.deepEqual(s.pots.map((p) => p.amount), [300, 100, 250]);
  // last pot is uncontested: c gets their 250 back regardless of cards
  assert.deepEqual(s.pots[2].winners, ['c']);
  assert.deepEqual(s.pots[0].winners.length >= 1, true);
  // chip conservation: 650 total, pot empty
  assert.equal(s.players.reduce((t, p) => t + p.chips, 0), 650);
  assert.equal(potTotal(s), 0);
  // pots[0] and pots[1] winners are among eligible players
  for (const w of s.pots[0].winners) assert.ok(['a', 'b', 'c'].includes(w));
  for (const w of s.pots[1].winners) assert.ok(['b', 'c'].includes(w));
});

test('showdown split pot (seed 2: board plays)', () => {
  let s = createGame(mkConfig({
    seed: 2, smallBlind: 50, bigBlind: 100,
    players: [
      { id: 'a', name: 'Ada', chips: 1000, ai: null },
      { id: 'b', name: 'Bo', chips: 1000, ai: null },
    ],
  }));
  s = advance(s).state;
  s = apply(s, 'allin', 1000).state;
  s = apply(s, 'allin', 1000).state;
  assert.equal(s.phase, 'handEnd');
  assert.equal(s.showdown.length, 2);
  assert.deepEqual(s.winners.sort(), ['a', 'b']);
  assert.equal(s.pots[0].amount, 2000);
  assert.deepEqual(s.pots[0].winners.sort(), ['a', 'b']);
  assert.equal(s.players[0].chips, 1000);
  assert.equal(s.players[1].chips, 1000);
});

test('maxHands terminal', () => {
  let s = createGame(mkConfig({
    maxHands: 1,
    players: [
      { id: 'a', name: 'Ada', chips: 1000, ai: null },
      { id: 'b', name: 'Bo', chips: 1000, ai: null },
    ],
  }));
  s = advance(s).state;
  s = apply(s, 'fold').state;
  assert.equal(s.phase, 'handEnd');
  const r = advance(s);
  s = r.state;
  assert.equal(s.phase, 'terminal');
  assert.equal(s.terminal.reason, 'maxHands');
  assert.equal(s.terminal.standings.length, 2);
  assert.equal(s.terminal.championId, 'b'); // b won the only hand
  assert.ok(r.events.some((e) => e.type === 'terminal'));
  // terminal: no legal actions, commands rejected
  assert.deepEqual(legalActions(s, 'a'), []);
  const r2 = applyCommand(s, cmd(s, 'a', 'advance'));
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, 'GAME_OVER');
});

test('lastPlayerStanding terminal (seed 1: short stack busts)', () => {
  let s = createGame(mkConfig({
    seed: 1, smallBlind: 50, bigBlind: 100,
    players: [
      { id: 'a', name: 'Ada', chips: 1000, ai: null },
      { id: 'b', name: 'Bo', chips: 100, ai: null },
    ],
  }));
  s = advance(s).state;
  assert.equal(s.players[1].status, 'allin'); // BB posted all-in
  s = apply(s, 'call').state; // a completes; b is all-in -> runout
  assert.equal(s.phase, 'handEnd');
  assert.equal(s.players[1].chips, 0);
  const r = advance(s);
  s = r.state;
  assert.equal(s.phase, 'terminal');
  assert.equal(s.terminal.reason, 'lastPlayerStanding');
  assert.equal(s.terminal.championId, 'a');
  assert.equal(s.players[0].chips, 1100);
  assert.ok(r.events.some((e) => e.type === 'eliminated' && e.playerId === 'b'));
});

test('serialization round-trip preserves state and hash', () => {
  let s = createGame(mkConfig());
  s = advance(s).state;
  s = apply(s, 'call').state;
  s = apply(s, 'raise', 100).state;
  const str = serialize(s);
  const back = deserialize(str);
  assert.deepEqual(back, s);
  assert.equal(hashState(back), hashState(s));
  // game can continue from the restored state
  const r = applyCommand(back, cmd(back, 'c', 'fold'));
  assert.ok(r.ok);
});

test('hash stability: same seed + same commands -> identical hashes', () => {
  const play = () => {
    let s = createGame(mkConfig());
    const hashes = [hashState(s)];
    const push = (type, amount, pid) => {
      const r = apply(s, type, amount, pid);
      s = r.state;
      hashes.push(hashState(s));
    };
    push('advance', undefined, 'a');
    push('call'); push('call'); push('check'); // preflop: a calls, b calls, c(BB) checks
    push('check'); push('check'); push('check'); // flop
    push('check'); push('check'); push('check'); // turn
    push('check'); push('check'); push('check'); // river -> showdown
    return hashes;
  };
  assert.deepEqual(play(), play());
});

test('getSnapshot hides other players cards and the deck', () => {
  let s = createGame(mkConfig());
  s = advance(s).state;
  const snap = getSnapshot(s, 'a');
  assert.deepEqual(snap.players[0].cards, s.players[0].cards);
  assert.equal(snap.players[1].cards, null);
  assert.equal(snap.players[2].cards, null);
  assert.deepEqual(snap.deck, []);
  assert.equal(snap.rngState, null);
  // input untouched
  assert.notEqual(s.players[1].cards, null);
  // at handEnd the cards are revealed
  let s2 = createGame(mkConfig({ players: [
    { id: 'a', name: 'Ada', chips: 1000, ai: null },
    { id: 'b', name: 'Bo', chips: 1000, ai: null },
  ] }));
  s2 = advance(s2).state;
  s2 = apply(s2, 'fold').state;
  const snap2 = getSnapshot(s2, 'a');
  assert.deepEqual(snap2.players[1].cards, s2.players[1].cards);
});

test('deserialize rejects garbage', () => {
  assert.throws(() => deserialize('{"v":99}'));
  assert.throws(() => deserialize('not json'));
  assert.throws(() => deserialize('{"v":1,"phase":"nope","players":[1,2],"tick":0,"seed":0}'));
});

test('summarize reports standings, stats, hands played', () => {
  let s = createGame(mkConfig({ maxHands: 1, players: [
    { id: 'a', name: 'Ada', chips: 1000, ai: null },
    { id: 'b', name: 'Bo', chips: 1000, ai: null },
  ] }));
  s = advance(s).state;
  s = apply(s, 'fold').state;
  s = advance(s).state; // -> terminal
  const sum = summarize(s);
  assert.equal(sum.handsPlayed, 1);
  assert.equal(sum.terminal.reason, 'maxHands');
  assert.equal(sum.standings[0].id, 'b');
  assert.equal(sum.standings[0].place, 1);
  assert.equal(sum.statsByPlayer.b.handsWon, 1);
});

test('AI only picks legal actions and advances; games terminate', () => {
  let s = createGame(mkConfig({
    seed: 99, maxHands: 5,
    players: [
      { id: 'a', name: 'Ada', chips: 800, ai: 'hard' },
      { id: 'b', name: 'Bo', chips: 800, ai: 'normal' },
      { id: 'c', name: 'Cy', chips: 800, ai: 'easy' },
    ],
  }));
  const rng = new Rng(1234, 'ai');
  let guard = 0;
  while (s.phase !== 'terminal') {
    assert.ok(++guard < 5000, 'engine hung');
    let pid;
    if (s.phase === 'init' || s.phase === 'handEnd') pid = 'a';
    else pid = s.players[s.currentActor].id;
    const c = chooseAction(s, pid, 'normal', rng);
    const legal = legalActions(s, pid);
    assert.ok(legal.some((a) => a.type === c.type && (a.amount ?? undefined) === (c.amount ?? undefined)),
      `illegal AI action ${JSON.stringify(c)}`);
    const r = applyCommand(s, c);
    assert.ok(r.ok);
    s = r.state;
  }
});
