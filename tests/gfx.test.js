// River Stakes — graphics quality model (js/gfx.js) and panel strings (js/gfx-strings.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, PRESETS, choosePreset, defaultGraphics, describe, detectPreset, presetTier, resolve,
} from '../js/gfx.js';
import { GFX_STRINGS, pickLocale } from '../js/gfx-strings.js';

test('detectPreset maps GPU strings to presets', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 730'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('touch/mobile devices cap Auto at Balanced', () => {
  assert.equal(detectPreset('Apple M2', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
});

test('resolve: auto follows the detected preset, explicit preset wins', () => {
  const a = resolve({}, 'low');
  assert.equal(a.preset, 'low');
  assert.equal(a.auto, true);
  assert.equal(a.shadows, 'off');
  assert.equal(a.post, false, 'Low renders without a post chain');
  assert.equal(a.dprCap, 1);
  const h = resolve({ preset: 'high' }, 'low');
  assert.equal(h.preset, 'high');
  assert.equal(h.auto, false);
  assert.equal(h.shadows, 'medium');
  assert.equal(h.post, true);
  assert.equal(resolve({ preset: 'bogus' }, 'nonsense').preset, 'balanced');
});

test('resolve: per-category overrides, invalid values fall back to the preset', () => {
  const r = resolve({ preset: 'high', bloom: 'off', ao: 'preset', shadows: 'nope', particles: 'low' }, 'low');
  assert.equal(r.bloom, 'off');
  assert.equal(r.ao, presetTier('high', 'ao'));
  assert.equal(r.shadows, presetTier('high', 'shadows'));
  assert.equal(r.particles, 'low');
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    for (const p of PRESETS) assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
  }
});

test('resolve: render scale is clamped to 50–200% of the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }, 'low').scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }, 'low').scale, 0.5);
  assert.equal(resolve({ preset: 'low', render_scale: 1 }, 'low').scale, 0.85);
  assert.equal(resolve({ preset: 'high', render_scale: 'x' }, 'low').renderScale, 1);
});

test('adaptive defaults on, frame-rate readout defaults off', () => {
  const r = resolve(defaultGraphics(), 'balanced');
  assert.equal(r.adaptive, true);
  assert.equal(r.showFps, false);
  assert.equal(resolve({ adaptive: false, show_fps: true }, 'low').adaptive, false);
  assert.equal(resolve({ adaptive: false, show_fps: true }, 'low').showFps, true);
});

test('choosing a preset clears every override and keeps scale/toggles', () => {
  const saved = { ...defaultGraphics(), preset: 'high', bloom: 'off', shadows: 'high', render_scale: 1.5, show_fps: true };
  const next = choosePreset(saved, 'low');
  assert.equal(next.preset, 'low');
  for (const cat of Object.keys(CATEGORIES)) assert.equal(next[cat], 'preset', cat);
  assert.equal(next.render_scale, 1.5);
  assert.equal(next.show_fps, true);
  assert.equal(choosePreset(saved, 'auto').preset, 'auto');
});

test('describe summarises cost and pixels, localizable', () => {
  assert.equal(describe(resolve({ preset: 'low' }), [640, 400]), 'no shadows · MSAA · 640×400 px');
  const hi = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(hi, /2048² shadows · ambient occlusion · bloom · SMAA · 1280×800 px/);
  const de = describe(resolve({ preset: 'low' }), null, GFX_STRINGS['de-DE'].describe);
  assert.equal(de, 'keine Schatten · MSAA');
});

test('graphics strings exist for every required locale with the same keys', () => {
  const need = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const shape = (o) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? shape(v).map((x) => k + '.' + x) : [k])).sort();
  const ref = shape(GFX_STRINGS['en-US']);
  for (const l of need) {
    assert.ok(GFX_STRINGS[l], l);
    assert.deepEqual(shape(GFX_STRINGS[l]), ref, l);
  }
  for (const cat of Object.keys(CATEGORIES)) {
    assert.ok(GFX_STRINGS['en-US'].categories[cat], cat);
    for (const t of CATEGORIES[cat]) assert.ok(GFX_STRINGS['en-US'].tiers[t], t);
  }
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('pt-PT'), 'pt-BR');
  assert.equal(pickLocale('ja-JP'), 'en-US');
});
