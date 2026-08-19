// River Stakes — evaluator tests (categories, wheel, tie-breaks, kickers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, compareEval, HAND_NAMES } from '../js/rules/evaluator.js';
import { cardFromString } from '../js/rules/cards.js';

/** 'Ah Kd ...' -> int[] */
function cs(str) {
  return str.trim().split(/\s+/).map(cardFromString);
}

test('HAND_NAMES has 9 categories', () => {
  assert.equal(HAND_NAMES.length, 9);
  assert.equal(HAND_NAMES[0], 'High Card');
  assert.equal(HAND_NAMES[8], 'Straight Flush');
});

test('high card', () => {
  const r = evaluate(cs('Ah Kd 9c 7s 5h 3d 2c'));
  assert.equal(r.category, 0);
  assert.equal(r.name, 'High Card');
  assert.deepEqual(r.tiebreak, [14, 13, 9, 7, 5]);
  assert.equal(r.chosen.length, 5);
});

test('one pair with kickers', () => {
  const r = evaluate(cs('Ah Ad 9c 7s 5h 3d 2c'));
  assert.equal(r.category, 1);
  assert.deepEqual(r.tiebreak, [14, 9, 7, 5]);
});

test('two pair with kicker', () => {
  const r = evaluate(cs('Ah Ad 9c 9s 5h 3d 2c'));
  assert.equal(r.category, 2);
  assert.deepEqual(r.tiebreak, [14, 9, 5]);
});

test('three of a kind', () => {
  const r = evaluate(cs('Ah Ad Ac 7s 5h 3d 2c'));
  assert.equal(r.category, 3);
  assert.deepEqual(r.tiebreak, [14, 7, 5]);
});

test('straight', () => {
  const r = evaluate(cs('9h 8d 7c 6s 5h 2d 2c'));
  assert.equal(r.category, 4);
  assert.deepEqual(r.tiebreak, [9]);
});

test('wheel straight A-2-3-4-5', () => {
  const r = evaluate(cs('Ah 2d 3c 4s 5h 9d Kc'));
  assert.equal(r.category, 4);
  assert.equal(r.name, 'Straight');
  assert.deepEqual(r.tiebreak, [5]); // five high, not ace high
});

test('flush', () => {
  const r = evaluate(cs('Ah Kh 9h 7h 5h 3d 2c'));
  assert.equal(r.category, 5);
  assert.deepEqual(r.tiebreak, [14, 13, 9, 7, 5]);
});

test('full house', () => {
  const r = evaluate(cs('Ah Ad Ac 7s 7h 3d 2c'));
  assert.equal(r.category, 6);
  assert.deepEqual(r.tiebreak, [14, 7]);
});

test('four of a kind', () => {
  const r = evaluate(cs('Ah Ad Ac As 7h 3d 2c'));
  assert.equal(r.category, 7);
  assert.deepEqual(r.tiebreak, [14, 7]);
});

test('straight flush', () => {
  const r = evaluate(cs('9h 8h 7h 6h 5h 3d 2c'));
  assert.equal(r.category, 8);
  assert.deepEqual(r.tiebreak, [9]);
});

test('wheel straight flush', () => {
  const r = evaluate(cs('Ah 2h 3h 4h 5h Kd Qc'));
  assert.equal(r.category, 8);
  assert.deepEqual(r.tiebreak, [5]);
});

test('five cards exactly (minimum input)', () => {
  const r = evaluate(cs('Ah Kd Qc Js Th'));
  assert.equal(r.category, 4);
  assert.deepEqual(r.tiebreak, [14]);
});

test('best 5 of 7 is chosen', () => {
  // Board gives a flush; two hole cards play in it.
  const r = evaluate(cs('Ah Kh Qh Jh 9h 2d 2c'));
  assert.equal(r.category, 5);
  assert.deepEqual(r.tiebreak, [14, 13, 12, 11, 9]);
  assert.deepEqual([...r.chosen].sort((a, b) => a - b), [...cs('Ah Kh Qh Jh 9h')].sort((a, b) => a - b));
});

test('board plays: chosen is the community cards', () => {
  const r = evaluate(cs('Ah Kh Qh Jh Th 2d 3c'));
  assert.equal(r.category, 8); // royal straight flush on board
  assert.deepEqual(r.tiebreak, [14]);
});

test('tie-break: same pair, kicker decides', () => {
  const a = evaluate(cs('Kh Kd Ah 7s 5h 3d 2c')); // pair K, ace kicker
  const b = evaluate(cs('Kc Ks Qh 7d 5c 3h 2d')); // pair K, queen kicker
  assert.equal(compareEval(a, b), 1);
  assert.equal(compareEval(b, a), -1);
  assert.equal(compareEval(a, a), 0);
});

test('tie-break: same two pair, kicker decides', () => {
  const a = evaluate(cs('Ah Ad 9c 9s Kh 3d 2c'));
  const b = evaluate(cs('As Ac 9h 9d Qh 3s 2d'));
  assert.equal(compareEval(a, b), 1);
});

test('tie-break: two pair, higher second pair wins', () => {
  const a = evaluate(cs('Ah Ad Tc Ts 5h 3d 2c'));
  const b = evaluate(cs('As Ac 9h 9d Kh 3s 2d'));
  assert.equal(compareEval(a, b), 1);
});

test('tie-break: flush compared card by card', () => {
  const a = evaluate(cs('Ah Kh 9h 7h 6h 3d 2c'));
  const b = evaluate(cs('As Ks 9s 7s 5s 3h 2d'));
  assert.equal(compareEval(a, b), 1); // 6 > 5 on the fifth card
});

test('tie-break: full house, higher trips wins', () => {
  const a = evaluate(cs('Kh Kd Kc 2s 2h 5d 7c'));
  const b = evaluate(cs('Qh Qd Qc As Ah 5s 7s'));
  assert.equal(compareEval(a, b), 1);
});

test('tie-break: quads kicker', () => {
  const a = evaluate(cs('9h 9d 9c 9s Ah 3d 2c')); // quad 9s, ace kicker
  const b = evaluate(cs('9h 9d 9c 9s Kh 4d 5c')); // quad 9s, king kicker
  assert.equal(compareEval(a, b), 1);
});

test('straight: six-high beats wheel', () => {
  const six = evaluate(cs('6h 5d 4c 3s 2h Kd Qc'));
  const wheel = evaluate(cs('Ah 2d 3c 4s 5h Kd Qc'));
  assert.equal(compareEval(six, wheel), 1);
});

test('straight: ace-high beats king-high', () => {
  const broadway = evaluate(cs('Ah Kd Qc Js Th 2d 3c'));
  const kingHigh = evaluate(cs('Kh Qd Jc Ts 9h 2d 3c'));
  assert.equal(compareEval(broadway, kingHigh), 1);
});

test('category ordering: flush beats straight, full house beats flush', () => {
  const straight = evaluate(cs('9h 8d 7c 6s 5h 2d 3c'));
  const flush = evaluate(cs('Ah Kh 9h 7h 5h 2d 3c'));
  const fullHouse = evaluate(cs('9h 9d 9c 5s 5h 2d 3c'));
  assert.equal(compareEval(flush, straight), 1);
  assert.equal(compareEval(fullHouse, flush), 1);
});

test('identical hands tie', () => {
  const a = evaluate(cs('Ah Kh Qd Jc Ts 2d 3c'));
  const b = evaluate(cs('As Ks Qh Jd Tc 2h 3s'));
  assert.equal(compareEval(a, b), 0);
});

test('evaluate rejects bad input', () => {
  assert.throws(() => evaluate(cs('Ah Kh Qh Jh'))); // too few
  assert.throws(() => evaluate(cs('Ah Ah Qh Jh Th'))); // duplicate
  assert.throws(() => evaluate([0, 1, 2, 3, 99])); // out of range
});
