// River Stakes — graphics quality model: presets, per-category overrides, StarHermit hardware-level
// detection, per-preset asset/effect budgets and a cost summary. Pure (no three.js, no DOM) so the settings panel, the renderer and the unit
// tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  particles: ['low', 'high'],
  water: ['static', 'animated'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a render scale (multiplies the device pixel ratio) and a
// device-pixel-ratio cap.
const TABLE = {
  low: { scale: 0.85, dpr: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', particles: 'low', water: 'animated', detail: 'plain' },
  balanced: { scale: 1, dpr: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', particles: 'high', water: 'animated', detail: 'detailed' },
  high: { scale: 1, dpr: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', particles: 'high', water: 'animated', detail: 'detailed' },
  ultra: { scale: 1.25, dpr: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', particles: 'high', water: 'animated', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

/** Saved-settings shape with every category following the preset. */
export function defaultGraphics() {
  const out = { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false };
  for (const cat of Object.keys(CATEGORIES)) out[cat] = 'preset';
  return out;
}

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; js/gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Cards, chips, seats,
 * hit areas and rules are identical on every preset — only visuals change.
 *   material   table, felt, deck, card and chip shading: lambert (Low) / standard (Balanced) / physical
 *              lacquered chips and clear-coated cards (High, Ultra; Detail on)
 *   card       card-face and card-back canvas width in px (height 1.4×)
 *   texture    felt texture size in px (wood grain: 2:1 at this width; deck: half)
 *   water      river surface grid segments across (rows: a quarter)
 *   lights     real lantern point lights (Detail on)
 *   confetti   win chip-spray pool at Particles "high" (low: a third), scaled with the level
 *   motes      fireflies at Particles "high", scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', card: 128, texture: 256, water: 32, lights: 0, confetti: 120, motes: 40, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', card: 256, texture: 512, water: 48, lights: 0, confetti: 180, motes: 60, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', card: 256, texture: 512, water: 64, lights: 2, confetti: 240, motes: 70, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', card: 512, texture: 1024, water: 128, lights: 2, confetti: 360, motes: 110, bloomRes: 1, aoRes: 1 },
};
export const CONFETTI_MAX = 540;
export const MOTE_MAX = 165;

/** A preset's concrete budget for a hardware level (particle counts scale ≤ 1.5× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(1.5, G.scaleBudget(1, lv, floor)) : 1;
  b.confetti = Math.min(CONFETTI_MAX, Math.round(b.confetti * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return b;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = {
    preset, auto,
    renderScale: clamp(Number(s.render_scale) || 1, 0.5, 2),
    dprCap: row.dpr,
  };
  out.scale = row.scale * out.renderScale;
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' ||
    out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Saved settings after choosing a preset: every per-category override is cleared. */
export function choosePreset(saved, preset) {
  const out = { ...defaultGraphics(), ...(saved || {}) };
  out.preset = PRESETS.includes(preset) ? preset : 'auto';
  for (const cat of Object.keys(CATEGORIES)) out[cat] = 'preset';
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

const DESCRIBE_EN = {
  noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion',
  aoHigh: 'full ambient occlusion', bloom: 'bloom', noAa: 'no anti-aliasing', px: '{w}×{h} px',
};

/** One-line cost summary. `words` localizes the fragments (defaults to English). */
export function describe(r, pixels, words) {
  const w = { ...DESCRIBE_EN, ...(words || {}) };
  const parts = [
    r.shadows === 'off' ? w.noShadows : w.shadows.replace('{n}', SHADOW_MAP[r.shadows]),
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoHigh : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.antialias === 'off' ? w.noAa : r.antialias.toUpperCase(),
    pixels ? w.px.replace('{w}', pixels[0]).replace('{h}', pixels[1]) : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
