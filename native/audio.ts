// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, the adaptive
// generative music (a slow pentatonic pad and a sparse pluck random walk per
// mode: menu, table, results) and the river ambience (filtered brown noise
// with the occasional droplet or bird-like blip, seeded per theme). The
// music and ambience are rendered once by the engine's offline audio context
// into a loop with the same seeds, envelopes and timing, and looped:
// the music on the music bus, the ambience on the music bus too (the runtime
// has no ambience bus) at the old ambience-to-music ratio (0.6 / 0.7). The
// synthesized transients audio.js played while a clip decoded are not ported:
// a clip still loading is silent. UI clicks go to the interface bus. The
// runtime's Options own the volumes and the mute. Clips all load at start.
import { OfflineAudioContext, context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";
import type { GameEvent } from "./game.ts";

/** audio.js SFX_SAMPLES. */
const SAMPLES: Record<string, string> = {
  click: "ui-click", card: "card-deal", chips: "chip-stack", check: "felt-tap", fold: "card-slide", raise: "raise-clink",
  win: "win-cascade", lose: "lose-thud", turn: "turn-chime", error: "error-buzz", notify: "notify-ding", eliminated: "elimination-drum",
};
export type Sfx = keyof typeof SAMPLES;
const clips = new Map<string, AudioClip>();
let suspended = false;

/** Loads every clip at once (onStart). */
export function loadSfx(): void {
  for (const name of Object.values(SAMPLES)) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export function play(name: Sfx): void {
  if (suspended) return;
  const file = SAMPLES[name];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  const bus: Bus = name === "click" ? "interface" : "effects";
  try { playClip(clip, { bus }); } catch { /* the mixer is full this frame: skip it */ }
}

/** audio.js mapEvents: engine events to sounds. */
export function mapEvents(events: GameEvent[], humanId: string): void {
  for (const ev of events) {
    switch (ev.type) {
      case "handStart": case "handEnd": play("notify"); break;
      case "post": play("chips"); break;
      case "deal": case "street": play("card"); break;
      case "showdown": play("turn"); break;
      case "award": play("win"); break;
      case "eliminated": play("eliminated"); break;
      case "terminal": play(!humanId || ev.terminal?.championId === humanId ? "win" : "lose"); break;
      case "action":
        switch (ev.action) {
          case "fold": play("fold"); break;
          case "check": play("check"); break;
          case "call": case "allin": play("chips"); break;
          case "bet": case "raise": play("raise"); break;
          default: play("click");
        }
        break;
      default: break;
    }
  }
}

// -- the offline synth (audio.js _tone / _noise, rendered) ------------------------------------
const RATE = 22050;
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
interface Voice { type: "sine" | "triangle" | "square" | "sawtooth"; freq: number; freqEnd: number; t: number; attack: number; dur: number; peak: number }
/** One oscillator voice (WebAudio's exponential ramps), `lead` seconds into the render. */
function scheduleVoice(off: OfflineAudioContext, v: Voice, lead = 0): void {
  const t = lead + v.t, peak = Math.max(0.0002, v.peak), end = t + v.dur;
  const g = off.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + v.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  const osc = off.createOscillator();
  osc.type = v.type;
  osc.frequency.setValueAtTime(Math.max(1, v.freq), t);
  if (v.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, v.freqEnd), end);
  osc.connect(g).connect(off.destination);
  osc.start(t);
  osc.stop(end + 0.05);
}
/** A loop being rendered: its clip when done. */
interface Loop { clip: AudioClip | null }
/** The render's first `length` samples past `lead`, with what ran past the end wrapped to the start. */
function looped(r: Float32Array, length: number, lead: number): Float32Array {
  const start = Math.round(lead * RATE);
  const out = r.slice(start, start + length);
  for (let i = start + length; i < r.length; i++) out[(i - start) % length]! += r[i]!;
  return out;
}
function finish(loop: Loop, rendering: Promise<Float32Array>): Loop {
  rendering.then((data) => { loop.clip = createClip([data], RATE); }, (e: unknown) => console.warn(`audio: ${String(e)}`));
  return loop;
}

/** audio.js startMusic presets, rendered as loops of whole pad cycles. */
const PRESETS = {
  menu: { stepDur: 0.42, root: 220.0, scale: [0, 3, 5, 7, 10], pluckProb: 0.32, padEvery: 8, padPeak: 0.05, steps: 32 },
  game: { stepDur: 0.34, root: 220.0, scale: [0, 3, 5, 7, 10], pluckProb: 0.5, padEvery: 8, padPeak: 0.06, steps: 32 },
  results: { stepDur: 0.5, root: 261.63, scale: [0, 2, 4, 7, 9], pluckProb: 0.36, padEvery: 6, padPeak: 0.055, steps: 30 },
};
export type MusicMode = keyof typeof PRESETS;
function musicLoop(mode: MusicMode): Loop {
  const cfg = PRESETS[mode];
  const length = Math.round(cfg.stepDur * cfg.steps * RATE);
  const off = new OfflineAudioContext(1, length + Math.round((cfg.stepDur * cfg.padEvery * 1.05 + 0.1) * RATE), RATE);
  const rng = mulberry32((hashString("music:" + mode) ^ 0x9e3779b9) >>> 0);
  let degree = 0;
  const add = (v: Voice): void => { scheduleVoice(off, v); };
  for (let step = 0; step < cfg.steps; step++) {
    const t = step * cfg.stepDur;
    if (step % cfg.padEvery === 0) {
      for (const semi of [0, 7, 12]) add({ type: "triangle", freq: cfg.root * Math.pow(2, semi / 12), freqEnd: 0, t, attack: 1.2, dur: cfg.stepDur * cfg.padEvery * 1.05, peak: cfg.padPeak });
    }
    if (rng() < cfg.pluckProb) {
      degree = Math.max(0, Math.min(cfg.scale.length * 2 - 1, degree + (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 2))));
      const oct = Math.floor(degree / cfg.scale.length);
      const semi = cfg.scale[degree % cfg.scale.length]! + 12 * (oct + 1);
      add({ type: "triangle", freq: cfg.root * Math.pow(2, semi / 12), freqEnd: 0, t, attack: 0.006, dur: 0.5, peak: 0.07 + rng() * 0.03 });
    }
  }
  return finish({ clip: null }, off.startRendering().then((r) => looped(r.getChannelData(0), length, 0)));
}
/** audio.js startAmbience: 4 s of lowpassed brown noise (looped three times) with droplets and bird-like blips, seeded per theme. */
function ambienceLoop(themeId: string): Loop {
  const seconds = 12, settle = 0.25, length = seconds * RATE;
  const off = new OfflineAudioContext(1, Math.round((settle + seconds + 0.4) * RATE), RATE);
  const rng = mulberry32(hashString(String(themeId)) || 1);
  const seed = Math.floor(rng() * 0xffffffff);
  const cutoff = 380 + rng() * 240;
  let t = 0.6 + rng() * 1.2;
  while (t < seconds - 0.3) {
    if (rng() < 0.55) {
      scheduleVoice(off, { type: "sine", freq: 900 + rng() * 700, freqEnd: 300 + rng() * 200, t, attack: 0.004, dur: 0.09, peak: 0.03 + rng() * 0.02 }, settle);
    } else {
      const f = 2200 + rng() * 1400;
      scheduleVoice(off, { type: "sine", freq: f, freqEnd: f * 1.3, t, attack: 0.004, dur: 0.07, peak: 0.02 }, settle);
      scheduleVoice(off, { type: "sine", freq: f * 1.1, freqEnd: f * 0.9, t: t + 0.1, attack: 0.004, dur: 0.06, peak: 0.016 }, settle);
    }
    t += 1.4 + rng() * 4.2;
  }
  // the bed: a 0.4-Q lowpass over 4 s of looped brown noise at gain 0.16; filtered periodic noise is periodic once settled
  const noise = off.createNoise({ color: "brown", seed, seconds: 4 });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  lp.Q.value = 20 * Math.log10(0.4); // the engine's Q is in dB, as Web Audio's
  const g = off.createGain();
  g.gain.value = 0.16;
  noise.connect(lp).connect(g).connect(off.destination);
  noise.start();
  return finish({ clip: null }, off.startRendering().then((r) => looped(r.getChannelData(0), length, settle)));
}

const musicLoops = new Map<MusicMode, Loop>();
const ambLoops = new Map<string, Loop>();
let wantMusic: MusicMode | null = null;
let wantAmb: string | null = null;
let musicVoice: { mode: MusicMode; sound: Sound } | null = null;
let ambVoice: { id: string; sound: Sound } | null = null;
const AMB_GAIN = 0.6 / 0.7;

/** audio.js startMusic: the mode's loop (rendered on first use). */
export function startMusic(mode: MusicMode): void { wantMusic = mode; }
/** audio.js startAmbience: the theme's river bed. */
export function startAmbience(themeId: string): void { wantAmb = themeId; }
/** A hidden window silences everything (audio.js suspend). */
export function setSuspended(on: boolean): void {
  if (on === suspended) return;
  suspended = on;
  try { musicVoice?.sound.fade(on ? 0 : 1, 0.2); } catch { /* gone */ }
  try { ambVoice?.sound.fade(on ? 0 : AMB_GAIN, 0.2); } catch { /* gone */ }
}

/** Each frame once the mixer runs: the music and ambience loops. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantMusic && musicVoice?.mode !== wantMusic) {
    let loop = musicLoops.get(wantMusic);
    if (!loop) { loop = musicLoop(wantMusic); musicLoops.set(wantMusic, loop); }
    if (!loop.clip) return;
    try { musicVoice?.sound.fade(0, 0.8); } catch { /* gone */ }
    const old = musicVoice?.sound;
    if (old) setTimeout(() => { try { old.stop(); } catch { /* gone */ } }, 900);
    try { musicVoice = { mode: wantMusic, sound: playClip(loop.clip!, { bus: "music", gain: suspended ? 0 : 1, loop: true }) }; } catch { musicVoice = null; wantMusic = null; }
    return;
  }
  if (wantAmb && ambVoice?.id !== wantAmb) {
    let loop = ambLoops.get(wantAmb);
    if (!loop) { loop = ambienceLoop(wantAmb); ambLoops.set(wantAmb, loop); }
    if (!loop.clip) return;
    try { ambVoice?.sound.fade(0, 0.8); } catch { /* gone */ }
    const old = ambVoice?.sound;
    if (old) setTimeout(() => { try { old.stop(); } catch { /* gone */ } }, 900);
    try {
      const sound = playClip(loop.clip!, { bus: "music", gain: 0, loop: true });
      sound.fade(suspended ? 0 : AMB_GAIN, 2);
      ambVoice = { id: wantAmb, sound };
    } catch { ambVoice = null; wantAmb = null; }
  }
}
