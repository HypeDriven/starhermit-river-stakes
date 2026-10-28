// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, the adaptive
// generative music (a slow pentatonic pad and a sparse pluck random walk per
// mode: menu, table, results) and the river ambience (filtered brown noise
// with the occasional droplet or bird-like blip, seeded per theme). The
// music and ambience were scheduled oscillators; a live synthesis graph makes
// clip loads fail on the web runtime, so each is rendered once (a slice a
// frame) into a loop with the same seeds, envelopes and timing, and looped:
// the music on the music bus, the ambience on the music bus too (the runtime
// has no ambience bus) at the old ambience-to-music ratio (0.6 / 0.7). The
// synthesized transients audio.js played while a clip decoded are not ported:
// a clip still loading is silent. UI clicks go to the interface bus. The
// runtime's Options own the volumes and the mute. Clips load once the mixer
// runs (natively at once, in a browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";
import type { GameEvent } from "./game.ts";

/** audio.js SFX_SAMPLES. */
const SAMPLES: Record<string, string> = {
  click: "ui-click", card: "card-deal", chips: "chip-stack", check: "felt-tap", fold: "card-slide", raise: "raise-clink",
  win: "win-cascade", lose: "lose-thud", turn: "turn-chime", error: "error-buzz", notify: "notify-ding", eliminated: "elimination-drum",
};
export type Sfx = keyof typeof SAMPLES;
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }

export function play(name: Sfx): void {
  if (suspended) return;
  const file = SAMPLES[name];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  const bus: Bus = name === "click" ? "interface" : "effects";
  try { playClip(clip, { bus }); } catch { clips.delete(file!); if (!queue.includes(file!)) queue.push(file!); }
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
/** One oscillator voice (WebAudio's exponential ramps) added into a looping buffer, samples [from, to) of the voice. */
function renderVoice(buf: Float32Array, v: Voice, from: number, to: number, phaseIn: number): number {
  const n = buf.length;
  const start = Math.round(v.t * RATE);
  const total = Math.round((v.dur + 0.05) * RATE);
  const atk = Math.max(1, Math.round(v.attack * RATE));
  const decay = Math.max(1, Math.round(v.dur * RATE) - atk);
  const peak = Math.max(0.0002, v.peak);
  const kAtk = Math.log(peak / 0.0001) / atk;
  const kDec = Math.log(0.0001 / peak) / decay;
  const fr = v.freqEnd ? Math.log(Math.max(1, v.freqEnd) / Math.max(1, v.freq)) / Math.max(1, Math.round(v.dur * RATE)) : 0;
  let phase = phaseIn;
  for (let i = from; i < Math.min(to, total); i++) {
    const g = i < atk ? 0.0001 * Math.exp(kAtk * i) : i < atk + decay ? peak * Math.exp(kDec * (i - atk)) : 0.0001;
    const f = Math.max(1, v.freq) * Math.exp(fr * Math.min(i, v.dur * RATE));
    phase += f / RATE;
    const p = phase - Math.floor(phase);
    let s: number;
    switch (v.type) {
      case "sine": s = Math.sin(2 * Math.PI * p); break;
      case "triangle": s = 1 - 4 * Math.abs(p - 0.5); break;
      case "square": s = p < 0.5 ? 1 : -1; break;
      default: s = 2 * p - 1;
    }
    const k = (start + i) % n;
    buf[k] = buf[k]! + s * g;
  }
  return phase;
}
interface Job { buf: Float32Array; v: Voice; at: number; total: number; phase?: number }
/** A loop being rendered: its voices, done a slice a frame. */
interface Loop { buf: Float32Array; jobs: Job[]; clip: AudioClip | null; noise?: () => void }

/** audio.js startMusic presets, rendered as loops of whole pad cycles. */
const PRESETS = {
  menu: { stepDur: 0.42, root: 220.0, scale: [0, 3, 5, 7, 10], pluckProb: 0.32, padEvery: 8, padPeak: 0.05, steps: 32 },
  game: { stepDur: 0.34, root: 220.0, scale: [0, 3, 5, 7, 10], pluckProb: 0.5, padEvery: 8, padPeak: 0.06, steps: 32 },
  results: { stepDur: 0.5, root: 261.63, scale: [0, 2, 4, 7, 9], pluckProb: 0.36, padEvery: 6, padPeak: 0.055, steps: 30 },
};
export type MusicMode = keyof typeof PRESETS;
function musicLoop(mode: MusicMode): Loop {
  const cfg = PRESETS[mode];
  const buf = new Float32Array(Math.round(cfg.stepDur * cfg.steps * RATE));
  const rng = mulberry32((hashString("music:" + mode) ^ 0x9e3779b9) >>> 0);
  let degree = 0;
  const jobs: Job[] = [];
  const add = (v: Voice): void => { jobs.push({ buf, v, at: 0, total: Math.round((v.dur + 0.05) * RATE) }); };
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
  return { buf, jobs, clip: null };
}
/** audio.js startAmbience: 4 s of lowpassed brown noise (looped three times) with droplets and bird-like blips, seeded per theme. */
function ambienceLoop(themeId: string): Loop {
  const seconds = 12;
  const buf = new Float32Array(seconds * RATE);
  const rng = mulberry32(hashString(String(themeId)) || 1);
  const len = 4 * RATE;
  const noise = new Float32Array(len);
  let last = 0;
  for (let i = 0; i < len; i++) { const white = rng() * 2 - 1; last = (last + 0.02 * white) / 1.02; noise[i] = last * 3.5; }
  const cutoff = 380 + rng() * 240;
  const jobs: Job[] = [];
  let t = 0.6 + rng() * 1.2;
  while (t < seconds - 0.3) {
    if (rng() < 0.55) {
      jobs.push({ buf, at: 0, total: 0, v: { type: "sine", freq: 900 + rng() * 700, freqEnd: 300 + rng() * 200, t, attack: 0.004, dur: 0.09, peak: 0.03 + rng() * 0.02 } });
    } else {
      const f = 2200 + rng() * 1400;
      jobs.push({ buf, at: 0, total: 0, v: { type: "sine", freq: f, freqEnd: f * 1.3, t, attack: 0.004, dur: 0.07, peak: 0.02 } });
      jobs.push({ buf, at: 0, total: 0, v: { type: "sine", freq: f * 1.1, freqEnd: f * 0.9, t: t + 0.1, attack: 0.004, dur: 0.06, peak: 0.016 } });
    }
    t += 1.4 + rng() * 4.2;
  }
  for (const j of jobs) j.total = Math.round((j.v.dur + 0.05) * RATE);
  // the bed: a 0.4-Q biquad lowpass (RBJ) over the looped brown noise at gain 0.16
  const loop: Loop = { buf, jobs, clip: null };
  loop.noise = () => {
    const w = (2 * Math.PI * cutoff) / RATE, cw = Math.cos(w), al = Math.sin(w) / (2 * 0.4);
    const a0 = 1 + al, b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = b0, a1 = (-2 * cw) / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let pass = 0; pass < 2; pass++) { // the second pass settles the filter so the loop's seam is clean
      for (let i = 0; i < buf.length; i++) {
        const x = noise[i % len]!;
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        if (pass === 1) buf[i] = buf[i]! + y * 0.16;
      }
    }
  };
  return loop;
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

const SLICE = 40000;
/** Renders some of a loop; true when it is a clip. */
function work(loop: Loop): boolean {
  if (loop.clip) return true;
  let budget = SLICE;
  while (loop.jobs.length && budget > 0) {
    const j = loop.jobs[0]!;
    const to = Math.min(j.total, j.at + budget);
    j.phase = renderVoice(j.buf, j.v, j.at, to, j.phase ?? 0);
    budget -= to - j.at;
    j.at = to;
    if (j.at >= j.total) loop.jobs.shift();
  }
  if (loop.jobs.length) return false;
  if (loop.noise) { loop.noise(); loop.noise = undefined; return false; }
  try { loop.clip = createClip([loop.buf], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); loop.jobs = []; return false; }
  return true;
}

/** Each frame: the clips once the mixer runs (one at a time), then the music and ambience loops. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const n of Object.values(SAMPLES)) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
    return;
  }
  if (loading) return;
  if (wantMusic && musicVoice?.mode !== wantMusic) {
    let loop = musicLoops.get(wantMusic);
    if (!loop) { loop = musicLoop(wantMusic); musicLoops.set(wantMusic, loop); }
    if (!work(loop)) return;
    try { musicVoice?.sound.fade(0, 0.8); } catch { /* gone */ }
    const old = musicVoice?.sound;
    if (old) setTimeout(() => { try { old.stop(); } catch { /* gone */ } }, 900);
    try { musicVoice = { mode: wantMusic, sound: playClip(loop.clip!, { bus: "music", gain: suspended ? 0 : 1, loop: true }) }; } catch { musicVoice = null; wantMusic = null; }
    return;
  }
  if (wantAmb && ambVoice?.id !== wantAmb) {
    let loop = ambLoops.get(wantAmb);
    if (!loop) { loop = ambienceLoop(wantAmb); ambLoops.set(wantAmb, loop); }
    if (!work(loop)) return;
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
