// River Stakes — graphics quality model (js/gfx.js) and panel strings (js/gfx-strings.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CATEGORIES, PRESETS, choosePreset, defaultGraphics, describe, detectPreset, presetTier, resolve,
  detectLevel, presetForLevel, budgetFor, LEVELS, BUDGETS, CONFETTI_MAX, MOTE_MAX,
} from '../js/gfx.js';
// js/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../js/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
import { GFX_STRINGS, pickLocale } from '../js/gfx-strings.js';

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('', DESK), 'low', 'no WebGL');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M2', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'card', 'texture', 'water', 'lights', 'confetti', 'motes', 'bloomRes', 'aoRes'];
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).motes > budgetFor('balanced', 4).motes, 'counts scale up within the preset');
  assert.ok(budgetFor('ultra', 20).confetti <= CONFETTI_MAX && budgetFor('ultra', 20).motes <= MOTE_MAX);
  assert.equal(resolve({}, 'low', 0).budget.material, 'lambert', 'headless SwiftShader: Low, Lambert');
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
