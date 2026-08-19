// River Stakes — pure 5–7 card Texas Hold'em hand evaluator.

import { rankOf, suitOf } from './cards.js';

export const HAND_NAMES = [
  'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

/** Evaluate exactly 5 cards -> {category, tiebreak}. */
function eval5(cards) {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const cnt = new Map();
  for (const r of ranks) cnt.set(r, (cnt.get(r) || 0) + 1);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5; // wheel A-2-3-4-5
  }
  // groups sorted by count desc then rank desc
  const groups = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const counts = groups.map((g) => g[1]);
  let category;
  let tiebreak;
  if (flush && straightHigh) {
    category = 8; tiebreak = [straightHigh];
  } else if (counts[0] === 4) {
    category = 7; tiebreak = [groups[0][0], groups[1][0]];
  } else if (counts[0] === 3 && counts[1] === 2) {
    category = 6; tiebreak = [groups[0][0], groups[1][0]];
  } else if (flush) {
    category = 5; tiebreak = ranks;
  } else if (straightHigh) {
    category = 4; tiebreak = [straightHigh];
  } else if (counts[0] === 3) {
    category = 3; tiebreak = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (counts[0] === 2 && counts[1] === 2) {
    category = 2; tiebreak = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (counts[0] === 2) {
    category = 1; tiebreak = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  } else {
    category = 0; tiebreak = ranks;
  }
  return { category, tiebreak };
}

function cmpTB(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length === 0 ? 0 : (a.length < b.length ? -1 : 1);
}

/**
 * Evaluate the best 5-card hand out of 5–7 cards.
 * @param {number[]} cards int[5..7]
 * @returns {{category:number, tiebreak:number[], name:string, chosen:number[]}}
 */
export function evaluate(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) {
    throw new Error('evaluate needs 5..7 cards');
  }
  const seen = new Set();
  for (const c of cards) {
    if (!Number.isInteger(c) || c < 0 || c > 51 || seen.has(c)) throw new Error('bad card: ' + c);
    seen.add(c);
  }
  const n = cards.length;
  let best = null;
  let bestChosen = null;
  // 5-card combinations via index bitmask loops (n is 5..7, tiny).
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const combo = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const r = eval5(combo);
            if (!best || r.category > best.category ||
                (r.category === best.category && cmpTB(r.tiebreak, best.tiebreak) > 0)) {
              best = r;
              bestChosen = combo;
            }
          }
  return { category: best.category, tiebreak: best.tiebreak, name: HAND_NAMES[best.category], chosen: bestChosen };
}

/**
 * Compare two eval results: category first, then tiebreak lexicographically.
 * @param {{category:number, tiebreak:number[]}} a
 * @param {{category:number, tiebreak:number[]}} b
 * @returns {number} -1 | 0 | 1
 */
export function compareEval(a, b) {
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  const c = cmpTB(a.tiebreak, b.tiebreak);
  return c === 0 ? 0 : (c < 0 ? -1 : 1);
}
