// The session on an injected clock (the engine client's fixed steps): AI moves
// wait their 650 ms and automatic deals 1.8 s on that clock only, pause keeps
// the remaining delay, and the same seed and the same human choices replay to
// the same table, whatever the wall clock does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../js/session.js';
import { JOURNEY } from '../js/content.js';

function fakeClock() {
  let now = 0, seq = 0, timers = [];
  return {
    now: () => now,
    setTimeout: (cb, ms) => { const id = ++seq; timers.push({ id, at: now + ms, cb }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.cb();
      }
      now = end;
    },
    pending: () => timers.length,
  };
}

function play(stage, steps) {
  const clock = fakeClock();
  const s = new Session({ config: JSON.parse(JSON.stringify(stage.config)), aiDelay: 650, autoAdvance: true, humanId: 'you', clock });
  s.start();
  for (let i = 0; i < steps && !s.state.terminal; i++) {
    const legal = s.legal();
    if (legal.length) { const a = legal.find((x) => x.type === 'call') || legal.find((x) => x.type === 'check') || legal[0]; s.dispatch(a.type, a.amount); }
    else clock.advance(100);
  }
  return { s, clock };
}

test('AI delays and automatic deals run on the injected clock', () => {
  const clock = fakeClock();
  const s = new Session({ config: JSON.parse(JSON.stringify(JOURNEY[0].config)), aiDelay: 650, autoAdvance: true, humanId: 'you', clock });
  s.start();
  assert.equal(s.state.phase, 'init');
  assert.equal(clock.pending(), 1);
  clock.advance(1799);
  assert.equal(s.state.phase, 'init');
  clock.advance(1);
  assert.equal(s.state.phase, 'preflop');
  assert.equal(s.summary().elapsedMs, 1800);
  s.pause();
  assert.equal(clock.pending(), 0);
  clock.advance(5000);
  s.resume();
  assert.equal(s.summary().elapsedMs, 1800, 'paused time does not count');
});

test('the same choices replay to the same table', () => {
  const a = play(JOURNEY[3], 4000), b = play(JOURNEY[3], 4000);
  assert.ok(a.s.state.terminal, 'the match ends');
  assert.equal(a.s.hash(), b.s.hash());
  assert.equal(a.clock.now(), b.clock.now());
});
