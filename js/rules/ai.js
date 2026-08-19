// River Stakes — deterministic AI opponents (easy / normal / hard).

import { legalActions, potTotal } from './engine.js';
import { evaluate } from './evaluator.js';
import { rankOf, suitOf } from './cards.js';

/** Category -> rough strength in [0,1] (plus small kicker nudge). */
const CATEGORY_STRENGTH = [0.08, 0.3, 0.5, 0.62, 0.7, 0.76, 0.86, 0.95, 1];

/**
 * Preflop hand strength in [0,1] from a compact tier table:
 * pairs, big aces, broadways, suited/connected bonuses.
 */
function preflopStrength(c1, c2) {
  const hi = Math.max(rankOf(c1), rankOf(c2));
  const lo = Math.min(rankOf(c1), rankOf(c2));
  const suited = suitOf(c1) === suitOf(c2);
  if (hi === lo) return Math.min(1, 0.55 + (hi / 14) * 0.45); // pair: 22≈0.64, AA=1
  let s = ((hi + lo) / 28) * 0.55;
  if (hi === 14) s += 0.1;
  if (hi >= 13 && lo >= 10) s += 0.1; // broadway combo
  if (suited) s += 0.07;
  if (hi - lo === 1) s += 0.05; // connectors
  if (lo <= 5 && hi <= 9) s -= 0.05; // trashy low cards
  return Math.max(0, Math.min(1, s));
}

/** Postflop strength in [0,1] from the evaluator result. */
function postflopStrength(state, me) {
  const ev = evaluate([...me.cards, ...state.community]);
  const base = CATEGORY_STRENGTH[ev.category];
  const kicker = ((ev.tiebreak[0] || 2) / 14) * 0.06;
  return Math.min(1, base + kicker);
}

function handStrength(state, me) {
  if (state.community.length === 0) return preflopStrength(me.cards[0], me.cards[1]);
  return postflopStrength(state, me);
}

/** 0 (earliest) .. 1 (latest) position index relative to the dealer. */
function positionIndex(state, seat) {
  const n = state.players.length;
  return ((seat - state.dealer + n) % n) / n;
}

/**
 * Pick a legal action for a player. Deterministic given (state, rng).
 * @param {object} state full engine state
 * @param {string} playerId
 * @param {'easy'|'normal'|'hard'} difficulty
 * @param {import('./rng.js').Rng} rng seeded rng (any stream; never Math.random)
 * @returns {{id:string, tick:number, playerId:string, type:string, amount?:number}} command
 */
export function chooseAction(state, playerId, difficulty, rng) {
  const legal = legalActions(state, playerId);
  const cmd = (a) => {
    const c = { id: `ai-${state.tick}-${playerId}`, tick: state.tick, playerId, type: a.type };
    if (a.amount !== undefined) c.amount = a.amount;
    return c;
  };
  if (legal.length === 0) return cmd({ type: 'advance' }); // not our turn; caller shouldn't ask
  const advance = legal.find((a) => a.type === 'advance');
  if (advance) return cmd(advance);

  const find = (t) => legal.find((a) => a.type === t);
  const fallback = () => {
    // safe default: check if free, else call if possible, else fold
    const a = find('check') || find('call') || find('fold') || legal[0];
    return cmd(a);
  };
  const aggression = () => find('raise') || find('bet') || find('allin');

  if (difficulty === 'easy') {
    // random-leaning calling station
    const r = rng.next();
    const canCheck = !!find('check');
    if (canCheck) {
      if (r < 0.15 && aggression()) return cmd(aggression());
      return cmd(find('check'));
    }
    if (r < 0.08 && find('fold')) return cmd(find('fold'));
    if (r >= 0.08 && r < 0.22 && aggression()) return cmd(aggression());
    return fallback();
  }

  const me = state.players.find((p) => p.id === playerId);
  const strength = handStrength(state, me);
  const toCall = Math.max(0, state.currentBet - me.bet);

  if (difficulty === 'normal') {
    // pure hand-strength heuristic
    if (strength >= 0.7) {
      const agg = aggression();
      if (agg) return cmd(agg);
      return fallback();
    }
    if (strength >= 0.35) return fallback(); // call/check medium hands
    // weak: check free, otherwise fold
    if (toCall === 0 && find('check')) return cmd(find('check'));
    return cmd(find('fold'));
  }

  // hard: pot-odds-ish thresholds + position + seeded bluffs
  const pot = potTotal(state) + toCall;
  const price = pot > 0 ? toCall / pot : 1; // fraction of the pot we must pay
  const pos = positionIndex(state, me.seat); // later = better
  const edge = strength - price + pos * 0.06;
  if (strength >= 0.68 && edge > 0.25) {
    const agg = aggression();
    if (agg) return cmd(agg);
    return fallback();
  }
  if (edge >= 0.02) return fallback(); // priced in: call/check
  // seeded bluff: rare raise with air, more often in late position
  if (rng.next() < 0.04 + pos * 0.05) {
    const agg = aggression();
    if (agg) return cmd(agg);
  }
  if (toCall === 0 && find('check')) return cmd(find('check'));
  return cmd(find('fold'));
}
