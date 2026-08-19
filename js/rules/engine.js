// River Stakes — fixed-limit Texas Hold'em rules engine (immutable, deterministic, 2–6 players).

import { ENGINE_VERSION } from '../version.js';
import { Rng, stateHash } from './rng.js';
import { newDeck, cardToString } from './cards.js';
import { evaluate, compareEval, HAND_NAMES } from './evaluator.js';

export const PHASES = ['init', 'preflop', 'flop', 'turn', 'river', 'showdown', 'handEnd', 'terminal'];

const BET_PHASES = ['preflop', 'flop', 'turn', 'river'];
const BET_CAP = 4; // 1 bet + 3 raises per round
const LOG_CAP = 40;

function err(code, message) {
  return { ok: false, error: { code, message } };
}

function betSize(state) {
  return state.phase === 'turn' || state.phase === 'river'
    ? state.config.bigBlind * 2
    : state.config.bigBlind;
}

function pushLog(s, msg) {
  s.log.push(msg);
  while (s.log.length > LOG_CAP) s.log.shift();
}

function nameOf(s, seat) {
  return s.players[seat].name;
}

/** Next seat (clockwise, offset 1..n) whose player still has chips. */
function nextSeatWithChips(s, fromSeat) {
  const n = s.players.length;
  for (let o = 1; o <= n; o++) {
    const seat = (fromSeat + o) % n;
    if (s.players[seat].chips > 0) return seat;
  }
  return null;
}

/** Next seat with status 'active', scanning offset 1..n from fromSeat. */
function nextActiveSeat(s, fromSeat) {
  const n = s.players.length;
  for (let o = 1; o <= n; o++) {
    const seat = (fromSeat + o) % n;
    if (s.players[seat].status === 'active') return seat;
  }
  return null;
}

/** First 'active' seat at or after startSeat (clockwise). */
function firstActiveFrom(s, startSeat) {
  const n = s.players.length;
  for (let o = 0; o < n; o++) {
    const seat = (startSeat + o) % n;
    if (s.players[seat].status === 'active') return seat;
  }
  return null;
}

function livePlayers(s) {
  return s.players.filter((p) => p.status === 'active' || p.status === 'allin');
}

function activeCount(s) {
  return s.players.filter((p) => p.status === 'active').length;
}

/** Round ends when every active player has acted and matched the current bet. */
function roundComplete(s) {
  for (const p of s.players) {
    if (p.status !== 'active') continue;
    if (p.lastAction === null) return false;
    if (p.bet !== s.currentBet) return false;
  }
  return true;
}

function updateToCall(s) {
  s.toCall = s.currentActor === null ? 0 : Math.max(0, s.currentBet - s.players[s.currentActor].bet);
}

/**
 * Create a new game. Phase 'init'; send an 'advance' command to deal hand 1.
 * @param {{seed:number, smallBlind:number, bigBlind:number,
 *   players:{id:string, name:string, chips:number, ai:null|'easy'|'normal'|'hard'}[],
 *   maxHands:number|null}} config
 * @returns {object} initial state (plain JSON)
 */
export function createGame(config) {
  if (!config || typeof config !== 'object') throw new Error('config required');
  const { smallBlind, bigBlind, maxHands } = config;
  if (!Number.isInteger(smallBlind) || smallBlind <= 0) throw new Error('bad smallBlind');
  if (!Number.isInteger(bigBlind) || bigBlind < smallBlind) throw new Error('bad bigBlind');
  if (maxHands !== null && (!Number.isInteger(maxHands) || maxHands <= 0)) throw new Error('bad maxHands');
  if (!Array.isArray(config.players) || config.players.length < 2 || config.players.length > 6) {
    throw new Error('need 2..6 players');
  }
  const ids = new Set();
  const players = config.players.map((p, i) => {
    if (!p || typeof p.id !== 'string' || ids.has(p.id)) throw new Error('bad player id');
    ids.add(p.id);
    if (!Number.isInteger(p.chips) || p.chips <= 0) throw new Error('bad chips for ' + p.id);
    const ai = p.ai ?? null;
    if (ai !== null && ai !== 'easy' && ai !== 'normal' && ai !== 'hard') throw new Error('bad ai for ' + p.id);
    return {
      id: p.id, name: typeof p.name === 'string' ? p.name : p.id, seat: i,
      chips: p.chips, cards: null, bet: 0, totalBet: 0,
      status: 'active', isAI: ai !== null, lastAction: null,
    };
  });
  const seed = (config.seed ?? 0) >>> 0;
  const stats = {};
  for (const p of players) {
    stats[p.id] = { handsWon: 0, showdownsWon: 0, potsWon: 0, folds: 0, betsRaises: 0, bestHand: null };
  }
  return {
    v: ENGINE_VERSION,
    seed,
    tick: 0,
    handNumber: 0,
    phase: 'init',
    config: { smallBlind, bigBlind, maxHands: maxHands ?? null },
    players,
    dealer: -1,
    currentActor: null,
    toCall: 0,
    currentBet: 0,
    betsThisRound: 0,
    lastAggressor: null,
    community: [],
    deck: [],
    deckPos: 0,
    rngState: new Rng(seed, 'rules').getState(),
    pots: [],
    showdown: null,
    winners: null,
    terminal: null,
    stats,
    log: [],
  };
}

/**
 * Legal actions for a player in the current state.
 * @param {object} state
 * @param {string} playerId
 * @returns {object[]} Action[] ({type, amount?}); [] when not actionable.
 */
export function legalActions(state, playerId) {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) return [];
  if (state.phase === 'terminal') return [];
  if (state.phase === 'init' || state.phase === 'handEnd') {
    return p.status === 'out' ? [] : [{ type: 'advance' }];
  }
  if (!BET_PHASES.includes(state.phase)) return [];
  if (state.currentActor === null) return [];
  if (state.players[state.currentActor].id !== playerId) return [];
  if (p.status !== 'active') return [];

  const acts = [{ type: 'fold' }];
  const toCall = Math.max(0, state.currentBet - p.bet);
  if (toCall === 0) acts.push({ type: 'check' });
  else acts.push({ type: 'call', amount: Math.min(toCall, p.chips) });
  const size = betSize(state);
  const canRaise = state.betsThisRound < BET_CAP;
  if (canRaise && p.chips >= toCall + size) {
    const total = state.currentBet + size;
    acts.push({ type: state.currentBet === 0 ? 'bet' : 'raise', amount: total });
  }
  const allinTotal = p.bet + p.chips;
  if (p.chips > 0 && (allinTotal <= state.currentBet || canRaise)) {
    acts.push({ type: 'allin', amount: allinTotal });
  }
  return acts;
}

function postBlind(s, seat, amount, kind, events) {
  const p = s.players[seat];
  const posted = Math.min(amount, p.chips);
  p.chips -= posted;
  p.bet += posted;
  p.totalBet += posted;
  if (p.chips === 0) p.status = 'allin';
  events.push({ type: 'post', playerId: p.id, amount: posted, kind });
  pushLog(s, `${p.name} posts ${kind === 'sb' ? 'small' : 'big'} blind ${posted}`);
}

function dealStreetCards(s, events) {
  const take = s.community.length === 0 ? 3 : 1;
  const cards = [];
  for (let i = 0; i < take; i++) cards.push(s.deck[s.deckPos++]);
  s.community.push(...cards);
  s.phase = s.community.length === 3 ? 'flop' : (s.community.length === 4 ? 'turn' : 'river');
  events.push({ type: 'street', phase: s.phase, cards });
  pushLog(s, `${s.phase}: ${cards.map(cardToString).join(' ')}`);
}

/** Reset per-round betting fields and move to the next street. */
function startNextStreet(s, events) {
  dealStreetCards(s, events);
  for (const p of s.players) {
    p.bet = 0;
    p.lastAction = null;
  }
  s.currentBet = 0;
  s.betsThisRound = 0;
  s.lastAggressor = null;
  s.currentActor = firstActiveFrom(s, (s.dealer + 1) % s.players.length);
  updateToCall(s);
}

/** Award the pot to the single remaining live player (everyone else folded). */
function awardUncontested(s, winner, events) {
  const amount = s.players.reduce((sum, p) => sum + p.totalBet, 0);
  winner.chips += amount;
  for (const p of s.players) { p.totalBet = 0; p.bet = 0; }
  s.pots = [{ amount, winners: [winner.id], handName: null }];
  s.winners = [winner.id];
  const st = s.stats[winner.id];
  st.handsWon++;
  st.potsWon += amount;
  s.phase = 'handEnd';
  s.currentActor = null;
  s.currentBet = 0;
  s.toCall = 0;
  s.betsThisRound = 0;
  events.push({ type: 'award', pots: s.pots });
  events.push({ type: 'handEnd', handNumber: s.handNumber });
  pushLog(s, `${winner.name} wins ${amount} (uncontested)`);
}

/** Seat distance from the dealer; the seat left of the dealer is "earliest". */
function seatDist(s, seat) {
  const n = s.players.length;
  return ((seat - s.dealer + n) % n) || n;
}

/** Evaluate live hands, split side pots, move to 'handEnd'. */
function settleShowdown(s, events) {
  const live = livePlayers(s);
  const evals = new Map();
  for (const p of live) evals.set(p.id, evaluate([...p.cards, ...s.community]));
  s.showdown = live.map((p) => ({ playerId: p.id, evalResult: evals.get(p.id) }));
  events.push({
    type: 'showdown',
    hands: live.map((p) => ({ playerId: p.id, name: p.name, evalResult: evals.get(p.id) })),
  });
  pushLog(s, 'showdown: ' + live.map((p) => `${p.name} ${evals.get(p.id).name}`).join(', '));

  for (const p of live) {
    const st = s.stats[p.id];
    const nm = evals.get(p.id).name;
    if (st.bestHand === null || HAND_NAMES.indexOf(nm) > HAND_NAMES.indexOf(st.bestHand)) st.bestHand = nm;
  }

  // Side pots from contribution levels (includes folded players' chips).
  const levels = [...new Set(s.players.filter((p) => p.totalBet > 0).map((p) => p.totalBet))].sort((a, b) => a - b);
  const pots = [];
  const winnerSet = [];
  let prev = 0;
  for (const level of levels) {
    const involved = s.players.filter((p) => p.totalBet >= level);
    const amount = (level - prev) * involved.length;
    prev = level;
    if (amount === 0) continue;
    let eligible = involved.filter((p) => p.status === 'active' || p.status === 'allin');
    if (eligible.length === 0) eligible = live.slice(); // safety net; should never happen
    let best = eligible[0];
    for (const p of eligible) {
      if (compareEval(evals.get(p.id), evals.get(best.id)) > 0) best = p;
    }
    const bestEval = evals.get(best.id);
    const winners = eligible
      .filter((p) => compareEval(evals.get(p.id), bestEval) === 0)
      .sort((a, b) => seatDist(s, a.seat) - seatDist(s, b.seat));
    const share = Math.floor(amount / winners.length);
    let rem = amount - share * winners.length; // odd chips to earliest seat from dealer
    for (const w of winners) {
      let gain = share;
      if (rem > 0) { gain++; rem--; }
      w.chips += gain;
      s.stats[w.id].potsWon += gain;
      if (!winnerSet.includes(w.id)) winnerSet.push(w.id);
    }
    pots.push({ amount, winners: winners.map((w) => w.id), handName: bestEval.name });
  }
  for (const id of winnerSet) {
    s.stats[id].handsWon++;
    s.stats[id].showdownsWon++;
  }
  for (const p of s.players) { p.totalBet = 0; p.bet = 0; }
  s.pots = pots;
  s.winners = winnerSet;
  s.phase = 'handEnd';
  s.currentActor = null;
  s.currentBet = 0;
  s.toCall = 0;
  s.betsThisRound = 0;
  events.push({ type: 'award', pots });
  events.push({ type: 'handEnd', handNumber: s.handNumber });
  pushLog(s, pots.map((pt) => `${pt.winners.map((id) => s.players.find((p) => p.id === id).name).join('/')} win ${pt.amount} (${pt.handName})`).join('; '));
}

/** Deal out remaining community cards and settle at showdown. */
function runoutAndShowdown(s, events) {
  while (s.community.length < 5) dealStreetCards(s, events);
  settleShowdown(s, events);
}

/** Called when a betting round completes: fold-win, runout, showdown, or next street. */
function resolveRound(s, events) {
  const live = livePlayers(s);
  if (live.length === 1) {
    awardUncontested(s, live[0], events);
    return;
  }
  if (s.community.length === 5) {
    settleShowdown(s, events);
    return;
  }
  if (activeCount(s) <= 1) {
    runoutAndShowdown(s, events);
    return;
  }
  startNextStreet(s, events);
}

function applyAction(s, seat, type, amount, events) {
  const p = s.players[seat];
  const size = betSize(s);
  switch (type) {
    case 'fold':
      p.status = 'folded';
      p.lastAction = 'fold';
      s.stats[p.id].folds++;
      break;
    case 'check':
      p.lastAction = 'check';
      break;
    case 'call': {
      p.chips -= amount;
      p.bet += amount;
      p.totalBet += amount;
      p.lastAction = 'call';
      if (p.chips === 0) p.status = 'allin';
      break;
    }
    case 'bet':
    case 'raise': {
      const add = amount - p.bet;
      p.chips -= add;
      p.totalBet += add;
      p.bet = amount;
      s.currentBet = amount;
      s.betsThisRound++;
      s.lastAggressor = seat;
      p.lastAction = type;
      s.stats[p.id].betsRaises++;
      if (p.chips === 0) p.status = 'allin';
      break;
    }
    case 'allin': {
      const add = p.chips;
      p.bet += add;
      p.totalBet += add;
      p.chips = 0;
      p.status = 'allin';
      p.lastAction = 'allin';
      if (p.bet > s.currentBet) {
        if (p.bet - s.currentBet >= size) {
          // full raise: counts toward the cap
          s.betsThisRound++;
          s.lastAggressor = seat;
          s.stats[p.id].betsRaises++;
        }
        s.currentBet = p.bet;
      }
      break;
    }
    default:
      throw new Error('unknown action ' + type); // unreachable: prevalidated
  }
  events.push({ type: 'action', playerId: p.id, action: type, amount });
  pushLog(s, `${p.name} ${type}${amount ? ' ' + amount : ''}`);

  if (livePlayers(s).length === 1 || roundComplete(s)) {
    resolveRound(s, events);
  } else {
    s.currentActor = nextActiveSeat(s, seat);
    updateToCall(s);
  }
}

function setTerminal(s, events, reason) {
  const standings = [...s.players]
    .sort((a, b) => b.chips - a.chips || a.seat - b.seat)
    .map((p, i) => ({ id: p.id, name: p.name, chips: p.chips, place: i + 1 }));
  s.terminal = { reason, standings, championId: standings[0].id };
  s.phase = 'terminal';
  s.currentActor = null;
  s.toCall = 0;
  events.push({ type: 'terminal', terminal: s.terminal });
  pushLog(s, `game over (${reason}): ${standings[0].name} wins`);
}

/** Advance from 'init'/'handEnd': rotate dealer, eliminate broke players, deal next hand. */
function advanceHand(s, events) {
  for (const p of s.players) {
    if (p.chips <= 0 && p.status !== 'out') {
      p.status = 'out';
      events.push({ type: 'eliminated', playerId: p.id });
      pushLog(s, `${p.name} is eliminated`);
    }
  }
  const withChips = s.players.filter((p) => p.chips > 0);
  if (withChips.length <= 1) {
    setTerminal(s, events, 'lastPlayerStanding');
    return;
  }
  if (s.config.maxHands !== null && s.handNumber >= s.config.maxHands) {
    setTerminal(s, events, 'maxHands');
    return;
  }
  s.dealer = nextSeatWithChips(s, s.dealer);
  for (const p of s.players) {
    p.cards = null;
    p.bet = 0;
    p.totalBet = 0;
    p.lastAction = null;
    if (p.status !== 'out') p.status = 'active';
  }
  s.community = [];
  s.pots = [];
  s.showdown = null;
  s.winners = null;
  s.currentBet = 0;
  s.toCall = 0;
  s.betsThisRound = 0;
  s.lastAggressor = null;
  s.handNumber += 1;

  const rng = new Rng(s.seed, 'rules');
  rng.setState(s.rngState);
  s.deck = rng.shuffle(newDeck());
  s.deckPos = 0;
  s.rngState = rng.getState();

  events.push({ type: 'handStart', handNumber: s.handNumber, dealer: s.dealer });
  pushLog(s, `hand #${s.handNumber} — dealer: ${nameOf(s, s.dealer)}`);

  // Seats participating in this hand (captured BEFORE blinds, since posting
  // a blind can leave a player with 0 chips and they must still get cards).
  const inHand = new Set(s.players.filter((p) => p.chips > 0).map((p) => p.seat));
  const n = s.players.length;
  const nextInHand = (fromSeat) => {
    for (let o = 1; o <= n; o++) {
      const seat = (fromSeat + o) % n;
      if (inHand.has(seat)) return seat;
    }
    return null;
  };
  let sbSeat;
  let bbSeat;
  let firstActor;
  if (inHand.size === 2) {
    // heads-up: dealer posts SB and acts first preflop
    sbSeat = s.dealer;
    bbSeat = nextInHand(s.dealer);
    firstActor = sbSeat;
  } else {
    sbSeat = nextInHand(s.dealer);
    bbSeat = nextInHand(sbSeat);
    firstActor = nextInHand(bbSeat);
  }
  postBlind(s, sbSeat, s.config.smallBlind, 'sb', events);
  postBlind(s, bbSeat, s.config.bigBlind, 'bb', events);
  s.currentBet = s.config.bigBlind;
  s.betsThisRound = 1; // the big blind is the first bet
  s.lastAggressor = bbSeat;

  // deal hole cards, one at a time starting left of the dealer
  for (const seat of inHand) s.players[seat].cards = [];
  for (let round = 0; round < 2; round++) {
    let seat = nextInHand(s.dealer);
    for (let i = 0; i < inHand.size; i++) {
      s.players[seat].cards.push(s.deck[s.deckPos++]);
      seat = nextInHand(seat);
    }
  }
  events.push({ type: 'deal' });
  s.phase = 'preflop';

  if (activeCount(s) === 0) {
    // Blinds put everyone all-in: straight to a showdown runout.
    // (live.length >= 2 is guaranteed by the terminal check above.)
    runoutAndShowdown(s, events);
    return;
  }
  // Otherwise the first active player from the designated seat acts.
  s.currentActor = firstActiveFrom(s, firstActor);
  updateToCall(s);
}

/**
 * Apply a validated command. Never mutates the input state.
 * @param {object} state
 * @param {{id:string, tick:number, playerId:string, type:string, amount?:number}} command
 * @returns {{ok:true, state:object, events:object[]} | {ok:false, error:{code:string, message:string}}}
 */
export function applyCommand(state, command) {
  if (!state || typeof state !== 'object') return err('MALFORMED', 'state required');
  if (!command || typeof command !== 'object' ||
      typeof command.id !== 'string' || command.id.length === 0 ||
      !Number.isInteger(command.tick) ||
      typeof command.playerId !== 'string' ||
      typeof command.type !== 'string') {
    return err('MALFORMED', 'command needs id, tick, playerId, type');
  }
  if (command.tick !== state.tick) return err('BAD_TICK', `expected tick ${state.tick}, got ${command.tick}`);
  if (state.phase === 'terminal') return err('GAME_OVER', 'game is terminal');
  const player = state.players.find((p) => p.id === command.playerId);
  if (!player) return err('UNKNOWN_PLAYER', 'no player ' + command.playerId);

  if (command.type === 'advance') {
    if (state.phase !== 'init' && state.phase !== 'handEnd') {
      return err('BAD_PHASE', 'advance only valid in init/handEnd');
    }
    if (player.status === 'out') return err('ILLEGAL_ACTION', 'eliminated players cannot advance');
    const s = structuredClone(state);
    const events = [];
    advanceHand(s, events);
    s.tick += 1;
    return { ok: true, state: s, events };
  }

  if (!BET_PHASES.includes(state.phase)) return err('BAD_PHASE', `no actions in phase ${state.phase}`);
  if (state.currentActor === null || state.players[state.currentActor].id !== command.playerId) {
    return err('NOT_YOUR_TURN', 'not this player\'s turn');
  }
  const legal = legalActions(state, command.playerId);
  const la = legal.find((a) => a.type === command.type);
  if (!la) return err('ILLEGAL_ACTION', `${command.type} is not legal now`);
  if (command.amount !== undefined) {
    if (!Number.isInteger(command.amount)) return err('BAD_AMOUNT', 'amount must be an integer');
    if ((la.amount ?? 0) !== command.amount) {
      return err('BAD_AMOUNT', `amount must be ${la.amount ?? 0}`);
    }
  }

  const s = structuredClone(state);
  const events = [];
  applyAction(s, s.currentActor, la.type, la.amount ?? 0, events);
  s.tick += 1;
  return { ok: true, state: s, events };
}

/**
 * Deep clone scrubbed for a viewer: other players' hole cards are hidden
 * unless the hand is at showdown/handEnd/terminal. Deck and rng state are
 * never exposed (they would reveal future cards).
 * @param {object} state
 * @param {string} viewerId
 * @returns {object}
 */
export function getSnapshot(state, viewerId) {
  const s = structuredClone(state);
  const reveal = state.phase === 'showdown' || state.phase === 'handEnd' || state.phase === 'terminal';
  if (!reveal) {
    for (const p of s.players) {
      if (p.id !== viewerId) p.cards = null;
    }
  }
  s.deck = [];
  s.rngState = null;
  return s;
}

/**
 * Serialize state to JSON.
 * @param {object} state
 * @returns {string}
 */
export function serialize(state) {
  return JSON.stringify(state);
}

/**
 * Parse and validate a serialized state; migrates older versions (v1: no-op).
 * @param {string} str
 * @returns {object} state
 * @throws on invalid input
 */
export function deserialize(str) {
  const s = JSON.parse(str);
  if (!s || typeof s !== 'object' || !Number.isInteger(s.v)) throw new Error('invalid state: missing v');
  if (s.v > ENGINE_VERSION) throw new Error(`unsupported state version ${s.v}`);
  if (!PHASES.includes(s.phase)) throw new Error('invalid state: bad phase');
  if (!Array.isArray(s.players) || s.players.length < 2) throw new Error('invalid state: players');
  if (!Number.isInteger(s.tick) || typeof s.seed !== 'number') throw new Error('invalid state: tick/seed');
  // v1 -> current: no migration needed.
  return s;
}

/**
 * Deterministic 16-char hex hash of the full state.
 * @param {object} state
 * @returns {string}
 */
export function hashState(state) {
  return stateHash(state);
}

/**
 * Chips currently in the middle (committed this hand, not yet awarded).
 * @param {object} state
 * @returns {number}
 */
export function potTotal(state) {
  return state.players.reduce((sum, p) => sum + p.totalBet, 0);
}

/**
 * Summary of the game for results screens.
 * @param {object} state
 * @returns {{terminal:object|null, standings:object[], statsByPlayer:object, handsPlayed:number}}
 */
export function summarize(state) {
  const standings = [...state.players]
    .sort((a, b) => b.chips - a.chips || a.seat - b.seat)
    .map((p, i) => ({ id: p.id, name: p.name, chips: p.chips, place: i + 1 }));
  return {
    terminal: state.terminal,
    standings,
    statsByPlayer: state.stats,
    handsPlayed: state.handNumber,
  };
}
