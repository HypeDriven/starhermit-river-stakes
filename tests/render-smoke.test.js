// River Stakes — render.js headless smoke test (no WebGL required).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, supportsWebGL, FRAMING } from '../js/render.js';

test('supportsWebGL is false and non-throwing without a DOM', () => {
  assert.equal(supportsWebGL(), false);
});

test('Renderer.create returns null without WebGL (graceful fallback)', async () => {
  const fakeCanvas = { getContext: () => null };
  const r = await Renderer.create(fakeCanvas, { theme: {}, quality: 'medium', reducedMotion: false });
  assert.equal(r, null);
});

test('Renderer.create returns null for a bogus canvas', async () => {
  assert.equal(await Renderer.create(null, {}), null);
  assert.equal(await Renderer.create({}, {}), null);
});

test('framing constants are exposed and sane', () => {
  assert.equal(typeof FRAMING.FOV, 'number');
  assert.ok(FRAMING.FOV < 60, 'low-distortion perspective');
  assert.equal(FRAMING.CAM_POS.length, 3);
  assert.equal(FRAMING.CAM_TARGET.length, 3);
});

test('contract methods exist on the prototype', () => {
  for (const m of ['setTheme', 'setQuality', 'setReducedMotion', 'showSnapshot',
    'playEvents', 'resize', 'setPaused', 'dispose', 'debugInfo']) {
    assert.equal(typeof Renderer.prototype[m], 'function', m);
  }
});
