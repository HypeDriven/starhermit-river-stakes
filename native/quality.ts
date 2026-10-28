// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the confetti and fireflies scaled within the tier by the level
// (frame().levelIndex, at most 1.5×, as the browser build scaled them by its
// hardware level). The runtime owns the rest of what the old Graphics panel
// did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The old panel's
// per-effect overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Table, felt, deck, card and chip shading: Lambert (Low), Standard (Balanced), Physical cards and lacquered chips (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Card face and back canvas width (height 1.4×). */
  card: number;
  /** Felt texture size (wood grain 2:1 at this width; deck half). */
  texture: number;
  /** River surface grid segments across (rows a quarter). */
  water: number;
  /** Real lantern point lights (Detail on). */
  lights: number;
  /** Win spray pool at Particles "high" (low: a third). */
  confetti: number;
  /** Fireflies at Particles "high". */
  motes: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  particles: "low" | "high";
  water: "static" | "animated";
  /** Room reflections, wood grain, felt nap, chip inlays, brass trim, halos, far-bank trees, lantern lights. */
  detailed: boolean;
  budget: Budget;
}

/** gfx.js TABLE. */
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", particles: "low", water: "animated", detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", particles: "high", water: "animated", detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", particles: "high", water: "animated", detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", particles: "high", water: "animated", detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", card: 128, texture: 256, water: 32, lights: 0, confetti: 120, motes: 40, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", card: 256, texture: 512, water: 48, lights: 0, confetti: 180, motes: 60, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", card: 256, texture: 512, water: 64, lights: 2, confetti: 240, motes: 70, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", card: 512, texture: 1024, water: 128, lights: 2, confetti: 360, motes: 110, bloomRes: 1, aoRes: 1 },
};
export const CONFETTI_MAX = 540;
export const MOTE_MAX = 165;
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  const k = Math.min(1.5, Math.pow(1.23, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.confetti = Math.min(CONFETTI_MAX, Math.round(b.confetti * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return { preset, ...TABLE[preset], budget: b };
}
