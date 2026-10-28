// The engine client's save model (js/progress.js): the document, the merge of
// two devices' saves (js/merge.js: nothing either side earned is dropped), the
// browser build's cloud slot read as a foreign save, the old settings KV
// carried into the game's options, theme unlocks, the daily streak and the
// local personal-best boards.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySave, normalize, mergeSave, sameSave, readForeign, readLegacySettings, pickOptions, themeUnlocked, updateDailyStreak, addBoardEntry,
  DEFAULT_OPTIONS,
} from '../js/progress.js';
import { THEMES } from '../js/content.js';

test('normalize: a broken document becomes the empty save, fields are clamped', () => {
  assert.deepEqual(normalize(null), emptySave());
  const d = normalize({ progress: { journey: { stars: { j01: 9, j02: 'x' }, unlocked: -3 }, lifetime: { hands: 'many', bestHand: 'Flush' } }, profile: { name: 'A'.repeat(40) } });
  assert.deepEqual(d.progress.journey, { stars: { j01: 3 }, unlocked: 0 });
  assert.equal(d.progress.lifetime.hands, 0);
  assert.equal(d.progress.lifetime.bestHand, 'Flush');
  assert.equal(d.profile.name.length, 24);
});

test('two devices merge: best stars, furthest unlock, lessons, challenges, earliest achievements, larger counters, latest streak, boards', () => {
  const a = {
    progress: {
      journey: { stars: { j01: 3, j02: 1 }, unlocked: 2 }, lifetime: { hands: 40, handsWon: 10, showdownsWon: 2, potsWon: 900, bestHand: 'Two pair', journeysCleared: 2, dailiesPlayed: 1 },
      tutorial: { 't01-blinds': true }, achievements: { first_flow: 2000 }, daily: { lastDate: '2026-10-20', streak: 3 },
    },
    boards: { 'daily:2026-10-20': [{ value: 600, ts: 1, name: 'A' }] }, profile: { name: 'Ann' },
  };
  const b = {
    progress: {
      journey: { stars: { j02: 2, j03: 1 }, unlocked: 3 }, lifetime: { hands: 60, handsWon: 5, showdownsWon: 4, potsWon: 100, bestHand: 'Flush', journeysCleared: 3, dailiesPlayed: 4 },
      challenges: { 'c01-no-easy-out': true }, achievements: { first_flow: 1000, mechanic_master: 3000 }, daily: { lastDate: '2026-10-22', streak: 1 },
    },
    boards: { 'daily:2026-10-20': [{ value: 700, ts: 2, name: 'B' }] }, profile: { name: '' },
  };
  const m = mergeSave(b, a);
  assert.deepEqual(m.progress.journey, { stars: { j01: 3, j02: 2, j03: 1 }, unlocked: 3 });
  assert.equal(m.progress.lifetime.hands, 60);
  assert.equal(m.progress.lifetime.handsWon, 10);
  assert.equal(m.progress.lifetime.bestHand, 'Flush');
  assert.deepEqual(m.progress.tutorial, { 't01-blinds': true });
  assert.deepEqual(m.progress.challenges, { 'c01-no-easy-out': true });
  assert.deepEqual(m.progress.achievements, { first_flow: 1000, mechanic_master: 3000 });
  assert.deepEqual(m.progress.daily, { lastDate: '2026-10-22', streak: 1 });
  assert.deepEqual(m.boards['daily:2026-10-20'].map((e) => e.value), [700, 600]);
  assert.equal(m.profile.name, 'Ann');
  assert.ok(sameSave(mergeSave(m, m), m));
  assert.ok(sameSave(mergeSave(a, m), m), 'merging again adds nothing');
});

test('the browser build cloud slot (saveJSON document) reads as a foreign save', () => {
  const old = JSON.stringify({ v: 1, savedAt: 123, progress: { journey: { stars: { j05: 2 }, unlocked: 5 }, lifetime: { hands: 12 } }, boards: {}, profile: { name: 'Old' } });
  const f = readForeign(old);
  assert.equal(f.progress.journey.stars.j05, 2);
  assert.equal(f.profile.name, 'Old');
  assert.equal(readForeign('not json'), null);
  assert.equal(readForeign(JSON.stringify({ v: 1 })), null);
});

test('the old settings KV groups carry the game options over; invalid values are dropped', () => {
  assert.deepEqual(readLegacySettings({
    audio: { master: 0.4 }, graphics: { theme: 'noir-tide', gfx: {} }, accessibility: { palette: 'tritanopia', leftHanded: true, hintMode: 'hold', reducedMotion: true },
    ui: { shortcutHints: false },
  }), { theme: 'noir-tide', palette: 'tritanopia', leftHanded: true, hintMode: 'hold', shortcutHints: false });
  assert.deepEqual(pickOptions({ theme: 'nope', palette: 'x', hintMode: 'tap' }), {});
  assert.deepEqual(Object.keys(DEFAULT_OPTIONS).sort(), ['hintMode', 'leftHanded', 'palette', 'shortcutHints', 'theme']);
});

test('themes unlock by default, by a cleared Journey stage or by an achievement', () => {
  const s = emptySave();
  const byId = (id) => THEMES.find((t) => t.id === id);
  assert.ok(themeUnlocked(byId('emberdusk'), s));
  assert.ok(!themeUnlocked(byId('noir-tide'), s));
  s.progress.journey.stars.j10 = 1;
  assert.ok(themeUnlocked(byId('noir-tide'), s));
  assert.ok(!themeUnlocked(byId('regatta'), s));
  s.progress.achievements = { estuary_champion: 5 };
  assert.ok(themeUnlocked(byId('regatta'), s));
});

test('the daily streak counts consecutive UTC days once each', () => {
  const p = {};
  assert.equal(updateDailyStreak(p, '2026-10-01'), 1);
  assert.equal(updateDailyStreak(p, '2026-10-01'), 0);
  assert.equal(updateDailyStreak(p, '2026-10-02'), 2);
  assert.equal(updateDailyStreak(p, '2026-10-04'), 1);
});

test('personal-best boards keep the best 50 and the 60 latest boards', () => {
  const s = emptySave();
  for (let i = 0; i < 55; i++) addBoardEntry(s, 'daily:2026-10-01', { value: i, ts: i, name: 'x' });
  assert.equal(s.boards['daily:2026-10-01'].length, 50);
  assert.equal(s.boards['daily:2026-10-01'][0].value, 54);
  for (let d = 0; d < 70; d++) addBoardEntry(s, `daily:2027-${String(1 + Math.floor(d / 28)).padStart(2, '0')}-${String(1 + (d % 28)).padStart(2, '0')}`, { value: 1, ts: 1, name: 'x' });
  assert.equal(Object.keys(s.boards).length, 60);
  assert.ok(!s.boards['daily:2026-10-01']);
});
