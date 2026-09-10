// River Stakes — audio event mapping tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem } from '../js/audio.js';

function playedFor(humanId, terminal) {
  const audio = new AudioSystem({ humanId });
  audio.ctx = {};
  const played = [];
  audio.play = (name) => { played.push(name); };
  audio.mapEvents([{ type: 'terminal', terminal, handNumber: 1 }]);
  return played;
}

test('terminal event plays win when the human is champion', () => {
  const terminal = { reason: 'hands', championId: 'you', standings: [{ id: 'you', place: 1 }] };
  assert.deepEqual(playedFor('you', terminal), ['win']);
});

test('terminal event plays lose when another player is champion', () => {
  const terminal = { reason: 'hands', championId: 'p2', standings: [{ id: 'p2', place: 1 }, { id: 'you', place: 2 }] };
  assert.deepEqual(playedFor('you', terminal), ['lose']);
});

test('terminal event falls back to win without a humanId', () => {
  const terminal = { reason: 'hands', championId: 'p2', standings: [{ id: 'p2', place: 1 }] };
  assert.deepEqual(playedFor(null, terminal), ['win']);
});

test('non-terminal events still map to their sounds', () => {
  const audio = new AudioSystem({ humanId: 'you' });
  audio.ctx = {};
  const played = [];
  audio.play = (name) => { played.push(name); };
  audio.mapEvents([
    { type: 'deal', handNumber: 1 },
    { type: 'action', action: 'fold', handNumber: 1 },
    { type: 'action', action: 'raise', handNumber: 1 },
  ]);
  assert.deepEqual(played, ['card', 'fold', 'raise']);
});
