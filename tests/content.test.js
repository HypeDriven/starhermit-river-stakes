// River Stakes — content data validation tests
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_VERSION, THEMES, TUTORIAL, JOURNEY, CHALLENGES, ACHIEVEMENTS,
  GOAL_TYPES, CONSTRAINT_TYPES, dailyForDate, evaluateGoals, validateAll,
} from '../js/content.js';

test('validateAll() reports no errors', () => {
  const { errors } = validateAll();
  assert.deepEqual(errors, [], `content validation errors:\n- ${errors.join('\n- ')}`);
});

test('CONTENT_VERSION is a positive integer', () => {
  assert.ok(Number.isInteger(CONTENT_VERSION) && CONTENT_VERSION >= 1);
});

test('themes: exactly 5, unique ids, full palettes', () => {
  assert.equal(THEMES.length, 5);
  const ids = new Set(THEMES.map((t) => t.id));
  assert.equal(ids.size, 5);
  for (const t of THEMES) {
    for (const key of ['background', 'felt', 'table', 'accent', 'text', 'cardBack', 'river', 'sky']) {
      assert.match(t.palette[key], /^#[0-9a-fA-F]{6}$/, `theme ${t.id} palette.${key}`);
    }
  }
});

test('tutorial: >=6 lessons covering the core rules one at a time', () => {
  assert.ok(TUTORIAL.length >= 6);
  const text = TUTORIAL.map((l) => `${l.id} ${l.title} ${l.body} ${l.goal}`).join(' ').toLowerCase();
  for (const concept of ['blind', 'call', 'raise', 'fold', 'community', 'showdown']) {
    assert.ok(text.includes(concept), `tutorial never teaches '${concept}'`);
  }
  for (const lesson of TUTORIAL) {
    assert.ok(lesson.steps.length > 0, `${lesson.id} has no steps`);
    assert.equal(lesson.config.players.filter((p) => p.ai == null).length, 1, `${lesson.id}: exactly one human`);
    assert.ok(lesson.config.players.every((p) => p.ai == null || p.ai === 'easy'), `${lesson.id}: tutorial AI must be passive/easy`);
    for (const step of lesson.steps) {
      const hint = step.hint(null, [{ type: 'call', amount: 10 }, { type: 'fold' }, { type: 'advance' }]);
      assert.equal(typeof hint, 'string', `${lesson.id} hint must return a string`);
    }
  }
});

test('journey: >=40 stages, ordered ids, every 5th mastery', () => {
  assert.ok(JOURNEY.length >= 40);
  JOURNEY.forEach((s, i) => {
    assert.equal(s.id, `j${String(i + 1).padStart(2, '0')}`);
    assert.equal(s.index, i + 1);
    assert.equal(s.mastery, (i + 1) % 5 === 0, `${s.id} mastery cadence`);
    assert.ok(Number.isInteger(s.seed) && s.seed >= 0, `${s.id} seed`);
    assert.ok(THEMES.some((t) => t.id === s.theme), `${s.id} theme '${s.theme}' exists`);
    assert.ok(s.goals.length > 0, `${s.id} has goals`);
  });
});

test('journey difficulty scales by structure, not just numbers', () => {
  const first10 = JOURNEY.slice(0, 10);
  const last10 = JOURNEY.slice(-10);
  const aiLevel = (s) => Math.max(...s.config.players.map((p) => ({ easy: 0, normal: 1, hard: 2 }[p.ai] ?? -1)));
  const stackBB = (s) => s.config.players[0].chips / s.config.bigBlind;
  assert.ok(first10.every((s) => s.config.players.length <= 3), 'early journey should start small');
  assert.ok(last10.every((s) => s.config.players.length >= 5), 'late journey should use full tables');
  assert.ok(Math.min(...last10.map(stackBB)) < Math.min(...first10.map(stackBB)), 'late stacks should be shallower in big blinds');
  assert.ok(Math.max(...last10.map(aiLevel)) > Math.max(...first10.map(aiLevel)), 'late opponents should be stronger');
});

test('every goal type appears somewhere in journey or challenges', () => {
  const used = new Set();
  for (const item of [...JOURNEY, ...CHALLENGES]) for (const g of item.goals) used.add(g.type);
  for (const type of GOAL_TYPES) assert.ok(used.has(type), `goal type '${type}' never used`);
});

test('challenges: >=6 with valid constraints', () => {
  assert.ok(CHALLENGES.length >= 6);
  const ids = new Set();
  for (const c of CHALLENGES) {
    assert.ok(!ids.has(c.id), `duplicate challenge ${c.id}`);
    ids.add(c.id);
    assert.ok(CONSTRAINT_TYPES.includes(c.constraint.type), `${c.id} constraint type`);
    assert.ok(THEMES.some((t) => t.id === c.theme), `${c.id} theme exists`);
  }
  const used = new Set(CHALLENGES.map((c) => c.constraint.type));
  for (const t of ['moveLimit', 'speedTarget', 'shortStack', 'noFoldPreflop']) {
    assert.ok(used.has(t), `constraint type '${t}' never used`);
  }
});

test('dailyForDate is deterministic and varies across dates', () => {
  const a1 = dailyForDate('2026-03-14');
  const a2 = dailyForDate('2026-03-14');
  assert.deepEqual(a1, a2, 'same date must produce deep-identical content');
  assert.equal(a1.date, '2026-03-14');
  assert.equal(a1.id, 'daily-2026-03-14');

  const seeds = new Set();
  const themes = new Set();
  for (let d = 1; d <= 10; d++) {
    const day = dailyForDate(`2026-04-${String(d).padStart(2, '0')}`);
    seeds.add(day.seed);
    themes.add(day.theme);
    assert.ok(Number.isInteger(day.config.seed));
    assert.ok(day.config.players.length >= 2 && day.config.players.length <= 6);
    assert.ok(day.goals.length > 0);
    assert.ok(THEMES.some((t) => t.id === day.theme), `daily theme '${day.theme}' exists`);
  }
  assert.ok(seeds.size >= 8, `daily seeds barely vary (${seeds.size}/10)`);
  assert.ok(themes.size >= 2, 'daily themes should vary across dates');

  assert.throws(() => dailyForDate('14/03/2026'), /YYYY-MM-DD/);
});

test('evaluateGoals: pass and fail paths per goal type', () => {
  const summary = {
    stats: { you: { handsWon: 3, showdownsWon: 2, potsWon: 400, folds: 5, betsRaises: 8, bestHand: 'Flush' } },
    handsPlayed: 10,
    invalidActions: 1,
    elapsedMs: 60000,
    terminal: { reason: 'maxHands', standings: [], championId: 'you' },
    goalsContext: { standings: [], finalChips: { you: 1500 }, places: { you: 1 } },
  };
  const pass = evaluateGoals(
    [{ type: 'winMatch' }, { type: 'finishTop', place: 2 }, { type: 'chipsAtLeast', amount: 1200 },
     { type: 'winHands', count: 3 }, { type: 'winShowdowns', count: 2 }, { type: 'surviveHands', count: 10 }],
    summary, 'you');
  assert.equal(pass.passed, true, JSON.stringify(pass.results));
  assert.equal(pass.results.length, 6);
  assert.ok(pass.results.every((r) => r.ok && typeof r.detail === 'string'));

  const fail = evaluateGoals(
    [{ type: 'chipsAtLeast', amount: 5000 }, { type: 'winHands', count: 9 }, { type: 'finishTop', place: 1 }],
    summary, 'you');
  assert.equal(fail.passed, false);
  assert.deepEqual(fail.results.map((r) => r.ok), [false, false, true]);

  // non-terminal summaries cannot satisfy placement goals
  const live = { ...summary, terminal: null };
  assert.equal(evaluateGoals([{ type: 'winMatch' }], live, 'you').passed, false);
  // unknown goal types fail closed
  assert.equal(evaluateGoals([{ type: 'mindread' }], summary, 'you').passed, false);
});

test('achievements: stable lowercase keys, unique, with check ids', () => {
  assert.ok(ACHIEVEMENTS.length >= 5);
  const keys = new Set();
  for (const a of ACHIEVEMENTS) {
    assert.match(a.key, /^[a-z0-9_]+$/, `achievement key '${a.key}' must be lowercase-stable`);
    assert.ok(!keys.has(a.key), `duplicate achievement '${a.key}'`);
    keys.add(a.key);
    assert.ok(a.name && a.desc && a.check, `achievement '${a.key}' incomplete`);
  }
  // theme unlock references a real achievement
  const regatta = THEMES.find((t) => t.id === 'regatta');
  assert.ok(keys.has(regatta.unlock.achievement), 'regatta unlock achievement must exist');
});
