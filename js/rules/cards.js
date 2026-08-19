// River Stakes — card representation helpers (cards are ints 0..51).

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = ['s', 'h', 'd', 'c'];
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];

/**
 * @param {number} c card int 0..51
 * @returns {number} rank 2..14 (14 = Ace)
 */
export function rankOf(c) {
  return 2 + (c % 13);
}

/**
 * @param {number} c card int 0..51
 * @returns {number} suit 0..3 (0=spades, 1=hearts, 2=diamonds, 3=clubs)
 */
export function suitOf(c) {
  return (c / 13) | 0;
}

/**
 * @param {number} c card int 0..51
 * @returns {string} e.g. 'Ah', 'Td'
 */
export function cardToString(c) {
  if (!Number.isInteger(c) || c < 0 || c > 51) throw new Error('bad card: ' + c);
  return RANK_CHARS[c % 13] + SUIT_CHARS[(c / 13) | 0];
}

/**
 * Inverse of cardToString.
 * @param {string} s e.g. 'Ah', 'Td'
 * @returns {number} card int 0..51
 * @throws on bad input
 */
export function cardFromString(s) {
  if (typeof s !== 'string' || s.length !== 2) throw new Error('bad card string: ' + s);
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const suit = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || suit < 0) throw new Error('bad card string: ' + s);
  return suit * 13 + r;
}

/** @returns {number[]} a fresh ordered deck [0..51] */
export function newDeck() {
  const d = new Array(52);
  for (let i = 0; i < 52; i++) d[i] = i;
  return d;
}
