// The look per graphics level. The engine owns its effects through
// levelSettings(): shadows and their map size, AO, bloom, grade and
// anti-aliasing come from the frame's level. The game keeps its art per quality
// tier (frame().quality): shading, texture sizes, the river, lights and
// particles, with the confetti and fireflies scaled within the tier by the
// level's particle budget (at most 1.5×). The runtime owns the rest of what the
// old Graphics panel did: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution, the frame-rate limit and readout.
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: QualityTier;
  /** The level's shadow map size (0 = off). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  particles: "low" | "high";
  water: "static" | "animated";
  /** Room reflections, wood grain, felt nap, chip inlays, brass trim, halos, far-bank trees, lantern lights. */
  detailed: boolean;
  budget: Budget;
}

type Art = Pick<Look, "particles" | "water" | "detailed">;
/** gfx.js TABLE's art. */
const ART: Record<QualityTier, Art> = {
  low: { particles: "low", water: "animated", detailed: false },
  balanced: { particles: "high", water: "animated", detailed: true },
  high: { particles: "high", water: "animated", detailed: true },
  ultra: { particles: "high", water: "animated", detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", card: 128, texture: 256, water: 32, lights: 0, confetti: 120, motes: 40 },
  balanced: { material: "standard", card: 256, texture: 512, water: 48, lights: 0, confetti: 180, motes: 60 },
  high: { material: "physical", card: 256, texture: 512, water: 64, lights: 2, confetti: 240, motes: 70 },
  ultra: { material: "physical", card: 512, texture: 1024, water: 128, lights: 2, confetti: 360, motes: 110 },
};
export const CONFETTI_MAX = 540;
export const MOTE_MAX = 165;
/** The level each tier's budgets were tuned at. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level's settings (plain data, compared by applyLook). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  const k = Math.min(1.5, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.confetti = Math.min(CONFETTI_MAX, Math.round(b.confetti * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: b,
  };
}
