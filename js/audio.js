// River Stakes — fully procedural WebAudio (no asset files).

// Tiny local mulberry32 so audio stays standalone (no imports from rules/).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SOUND_NAMES = ['click', 'card', 'chips', 'check', 'fold', 'raise',
  'win', 'lose', 'turn', 'error', 'notify', 'eliminated'];

// Authored one-shot samples (sfx/<name>.opus, see sfx/manifest.json) mapped to
// the synthesized events they replace once loaded.
const SFX_SAMPLES = {
  click: 'ui-click',
  card: 'card-deal',
  chips: 'chip-stack',
  check: 'felt-tap',
  fold: 'card-slide',
  raise: 'raise-clink',
  win: 'win-cascade',
  lose: 'lose-thud',
  turn: 'turn-chime',
  error: 'error-buzz',
  notify: 'notify-ding',
  eliminated: 'elimination-drum',
};

export class AudioSystem {
  /**
   * @param {{volumes?: object, muted?: boolean}} settings
   */
  constructor(settings = {}) {
    this.volumes = Object.assign(
      { master: 1, music: 0.6, sfx: 0.9, ambience: 0.55, voice: 0.8 },
      settings.volumes || {});
    this.muted = !!settings.muted;
    this.ctx = null;
    this.masterGain = null;
    this.buses = {};
    this._noiseBuf = null;   // white noise source buffer (lazy)
    this._amb = null;        // ambience handle {nodes, timer, gain, stopped}
    this._music = null;      // music handle {timer, nextTime, step, mode, rng, stepDur}
    this._samples = new Map(); // sfx basename -> {state:'loading'|'ready'|'failed', buffer}
    this._playCounter = 0;
    this.available = typeof window !== 'undefined' &&
      !!(window.AudioContext || window.webkitAudioContext);
  }

  /** Create/resume the AudioContext. Call from the first user gesture. */
  unlock() {
    if (!this.available) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      try { this.ctx = new AC(); } catch { this.available = false; return; }
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      for (const name of ['music', 'sfx', 'ambience', 'voice']) {
        const g = this.ctx.createGain();
        g.gain.value = this.volumes[name];
        g.connect(this.masterGain);
        this.buses[name] = g;
      }
      this._applyMaster();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  _applyMaster() {
    if (!this.masterGain) return;
    const v = this.muted ? 0 : this.volumes.master;
    this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** @param {string} bus one of master|music|sfx|ambience|voice */
  setVolume(bus, v) {
    const val = Math.max(0, Math.min(1, Number(v) || 0));
    this.volumes[bus] = val;
    if (!this.ctx) return;
    if (bus === 'master') { this._applyMaster(); return; }
    const node = this.buses[bus];
    if (node) node.gain.setTargetAtTime(val, this.ctx.currentTime, 0.02);
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.ctx) this._applyMaster();
  }

  /** Page visibility hooks. */
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  _whiteNoise() {
    if (this._noiseBuf) return this._noiseBuf;
    const len = this.ctx.sampleRate | 0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rng = mulberry32(0xC0FFEE);
    for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  }

  // --- low-level synth helpers -------------------------------------------------

  _tone({ type = 'sine', freq = 440, freqEnd = 0, t = 0, attack = 0.004, dur = 0.1,
          peak = 0.2, bus = 'sfx', detune = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    if (detune) o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.buses[bus]);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _noise({ t = 0, dur = 0.08, peak = 0.2, filterType = 'bandpass', freq = 2000,
           q = 1, bus = 'sfx', attack = 0.002 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._whiteNoise();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.buses[bus]);
    src.start(t); src.stop(t + dur + 0.05);
  }

  // --- sound effects -----------------------------------------------------------

  /**
   * Try to play the authored sample mapped to an event. Lazily fetches,
   * decodes and caches sfx/<name>.opus (only called post-unlock, so the
   * context exists). Returns true when a cached sample was started; while a
   * sample is still loading — or after a fetch/decode failure — returns
   * false so the caller falls back to synthesis.
   * @param {string} name one of SOUND_NAMES
   */
  _playSample(name) {
    const file = SFX_SAMPLES[name];
    if (!file) return false;
    let rec = this._samples.get(file);
    if (!rec) {
      rec = { state: 'loading', buffer: null };
      this._samples.set(file, rec);
      fetch(`sfx/${file}.opus`)
        .then((res) => { if (!res.ok) throw new Error(`sfx ${res.status}`); return res.arrayBuffer(); })
        .then((data) => this.ctx.decodeAudioData(data))
        .then((buffer) => { rec.state = 'ready'; rec.buffer = buffer; })
        .catch(() => { rec.state = 'failed'; });
      return false;
    }
    if (rec.state !== 'ready') return false;
    const src = this.ctx.createBufferSource();
    src.buffer = rec.buffer;
    src.connect(this.buses.sfx);
    src.start();
    return true;
  }

  /**
   * Play a named short synthesized transient.
   * @param {string} name one of SOUND_NAMES
   * @param {{seed?: number}} opts seed selects pitch/variant deterministically
   */
  play(name, { seed } = {}) {
    if (!this.ctx || !SOUND_NAMES.includes(name)) return;
    if (this._playSample(name)) return;
    const rng = mulberry32(((seed ?? (Date.now() ^ (this._playCounter++ * 2654435761))) >>> 0) || 1);
    const t = this.ctx.currentTime + 0.01;
    const v = (lo, hi) => lo + rng() * (hi - lo); // seeded variant helper
    switch (name) {
      case 'click': // soft tick
        this._tone({ type: 'triangle', freq: v(1600, 2200), t, dur: 0.045, peak: 0.12 });
        this._noise({ t, dur: 0.02, peak: 0.05, freq: 5000, q: 0.8 });
        break;
      case 'card': // filtered noise snap
        this._noise({ t, dur: 0.07, peak: 0.22, freq: v(2600, 3600), q: 1.2 });
        this._tone({ type: 'sine', freq: v(700, 900), freqEnd: 300, t, dur: 0.05, peak: 0.06 });
        break;
      case 'chips': { // clustered clicks
        const n = 3 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const ti = t + i * v(0.025, 0.045);
          this._noise({ t: ti, dur: 0.03, peak: 0.16, filterType: 'highpass', freq: v(3200, 4800) });
          this._tone({ type: 'sine', freq: v(1800, 2600), t: ti, dur: 0.03, peak: 0.07 });
        }
        break;
      }
      case 'check': // double tap on the felt
        for (const dt of [0, 0.09]) {
          this._tone({ type: 'sine', freq: v(170, 210), freqEnd: 90, t: t + dt, dur: 0.07, peak: 0.2 });
          this._noise({ t: t + dt, dur: 0.025, peak: 0.08, filterType: 'lowpass', freq: 900 });
        }
        break;
      case 'fold': // low slide
        this._tone({ type: 'sawtooth', freq: v(200, 240), freqEnd: v(70, 95), t, dur: 0.24, peak: 0.08 });
        this._noise({ t, dur: 0.15, peak: 0.05, filterType: 'lowpass', freq: 500 });
        break;
      case 'raise': // rising blip
        this._tone({ type: 'square', freq: v(380, 440), freqEnd: v(850, 980), t, dur: 0.13, peak: 0.07 });
        this._tone({ type: 'sine', freq: v(760, 880), freqEnd: v(1600, 1900), t, dur: 0.13, peak: 0.06 });
        break;
      case 'win': { // warm arpeggio (major pentatonic)
        const root = v(255, 265); // ~C4
        const steps = [0, 4, 7, 12, 16];
        steps.forEach((s, i) => {
          this._tone({ type: 'triangle', freq: root * Math.pow(2, s / 12), t: t + i * 0.09, dur: 0.32, peak: 0.14 });
        });
        break;
      }
      case 'lose': { // descending tone
        const root = v(300, 330);
        [0, -3, -7].forEach((s, i) => {
          this._tone({ type: 'triangle', freq: root * Math.pow(2, s / 12), t: t + i * 0.14, dur: 0.3, peak: 0.12 });
        });
        break;
      }
      case 'turn': // soft chime
        this._tone({ type: 'sine', freq: v(840, 920), t, dur: 0.4, peak: 0.1, attack: 0.008 });
        this._tone({ type: 'sine', freq: v(1680, 1840), t, dur: 0.25, peak: 0.04 });
        break;
      case 'error': // muted buzz
        this._tone({ type: 'square', freq: v(105, 125), t, dur: 0.18, peak: 0.06 });
        this._noise({ t, dur: 0.16, peak: 0.05, filterType: 'lowpass', freq: 320 });
        break;
      case 'notify': // ding
        this._tone({ type: 'sine', freq: v(1250, 1380), t, dur: 0.5, peak: 0.12, attack: 0.003 });
        this._tone({ type: 'sine', freq: v(2500, 2760), t, dur: 0.2, peak: 0.03 });
        break;
      case 'eliminated': // low drum
        this._tone({ type: 'sine', freq: v(140, 160), freqEnd: 45, t, dur: 0.4, peak: 0.28, attack: 0.003 });
        this._noise({ t, dur: 0.1, peak: 0.12, filterType: 'lowpass', freq: 400 });
        break;
    }
  }

  /**
   * Map engine events to sounds.
   * @param {Array<object>} events engine Event[]
   */
  mapEvents(events = []) {
    if (!this.ctx) return;
    events.forEach((ev, i) => {
      const seed = (((ev.handNumber || 0) * 7919) + i * 131 + (ev.amount || 0)) >>> 0;
      switch (ev.type) {
        case 'handStart': this.play('notify', { seed }); break;
        case 'post': this.play('chips', { seed }); break;
        case 'deal': this.play('card', { seed }); break;
        case 'street': this.play('card', { seed }); break;
        case 'showdown': this.play('turn', { seed }); break;
        case 'award': this.play('win', { seed }); break;
        case 'eliminated': this.play('eliminated', { seed }); break;
        case 'handEnd': this.play('notify', { seed }); break;
        case 'terminal': this.play('win', { seed }); break;
        case 'action':
          switch (ev.action) {
            case 'fold': this.play('fold', { seed }); break;
            case 'check': this.play('check', { seed }); break;
            case 'call': this.play('chips', { seed }); break;
            case 'bet': case 'raise': this.play('raise', { seed }); break;
            case 'allin': this.play('chips', { seed }); break;
            default: this.play('click', { seed });
          }
          break;
        default: break;
      }
    });
  }

  // --- ambience ----------------------------------------------------------------

  /**
   * Quiet looping river/salon bed: filtered brown noise + occasional soft
   * droplet/bird-like blips, seeded per theme.
   * @param {string} themeId
   */
  startAmbience(themeId = 'default') {
    if (!this.ctx) return;
    this.stopAmbience();
    const ctx = this.ctx;
    const rng = mulberry32(hashString(String(themeId)) || 1);

    // brown noise loop
    const seconds = 4;
    const len = seconds * ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = rng() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380 + rng() * 240; lp.Q.value = 0.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 2);
    src.connect(lp); lp.connect(gain); gain.connect(this.buses.ambience);
    src.start();

    const amb = { src, gain, timer: null, stopped: false };
    this._amb = amb;

    // occasional droplets / bird-like blips
    const blip = () => {
      if (amb.stopped || !this.ctx) return;
      const t = ctx.currentTime + 0.02;
      if (rng() < 0.55) { // droplet
        this._tone({ type: 'sine', freq: 900 + rng() * 700, freqEnd: 300 + rng() * 200,
          t, dur: 0.09, peak: 0.03 + rng() * 0.02, bus: 'ambience' });
      } else { // bird-like double blip
        const f = 2200 + rng() * 1400;
        this._tone({ type: 'sine', freq: f, freqEnd: f * 1.3, t, dur: 0.07, peak: 0.02, bus: 'ambience' });
        this._tone({ type: 'sine', freq: f * 1.1, freqEnd: f * 0.9, t: t + 0.1, dur: 0.06, peak: 0.016, bus: 'ambience' });
      }
      amb.timer = setTimeout(blip, 1400 + rng() * 4200);
    };
    amb.timer = setTimeout(blip, 600 + rng() * 1200);
  }

  stopAmbience() {
    const amb = this._amb;
    if (!amb) return;
    this._amb = null;
    amb.stopped = true;
    if (amb.timer) clearTimeout(amb.timer);
    if (this.ctx) {
      try {
        amb.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
        const src = amb.src;
        setTimeout(() => { try { src.stop(); } catch {} }, 800);
      } catch {}
    }
  }

  // --- music -------------------------------------------------------------------

  /**
   * Simple adaptive generative loop: slow pentatonic pad + sparse pluck via
   * scheduled oscillators with a lookahead scheduler.
   * @param {'menu'|'game'|'results'} mode
   */
  startMusic(mode = 'menu') {
    if (!this.ctx) return;
    this.stopMusic();
    const presets = {
      menu:    { stepDur: 0.42, root: 220.0,  scale: [0, 3, 5, 7, 10], pluckProb: 0.32, padEvery: 8, padPeak: 0.05 },
      game:    { stepDur: 0.34, root: 220.0,  scale: [0, 3, 5, 7, 10], pluckProb: 0.5,  padEvery: 8, padPeak: 0.06 },
      results: { stepDur: 0.5,  root: 261.63, scale: [0, 2, 4, 7, 9],  pluckProb: 0.36, padEvery: 6, padPeak: 0.055 },
    };
    const cfg = presets[mode] || presets.menu;
    const mus = {
      mode, cfg,
      rng: mulberry32((hashString('music:' + mode) ^ 0x9E3779B9) >>> 0),
      step: 0,
      nextTime: this.ctx.currentTime + 0.08,
      timer: null,
      degree: 0,
    };
    this._music = mus;

    const scheduleStep = (step, t) => {
      const { rng } = mus;
      // pad: root + fifth + octave, slow attack
      if (step % cfg.padEvery === 0) {
        for (const semi of [0, 7, 12]) {
          this._tone({ type: 'triangle', freq: cfg.root * Math.pow(2, semi / 12),
            t, attack: 1.2, dur: cfg.stepDur * cfg.padEvery * 1.05, peak: cfg.padPeak, bus: 'music' });
        }
      }
      // sparse pluck, random walk over the pentatonic scale
      if (rng() < cfg.pluckProb) {
        mus.degree = Math.max(0, Math.min(cfg.scale.length * 2 - 1,
          mus.degree + (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 2))));
        const oct = Math.floor(mus.degree / cfg.scale.length);
        const semi = cfg.scale[mus.degree % cfg.scale.length] + 12 * (oct + 1);
        this._tone({ type: 'triangle', freq: cfg.root * Math.pow(2, semi / 12),
          t, attack: 0.006, dur: 0.5, peak: 0.07 + rng() * 0.03, bus: 'music' });
      }
    };

    mus.timer = setInterval(() => {
      if (!this.ctx) return;
      while (mus.nextTime < this.ctx.currentTime + 0.18) {
        scheduleStep(mus.step, mus.nextTime);
        mus.nextTime += cfg.stepDur;
        mus.step++;
      }
    }, 45);
  }

  stopMusic() {
    const mus = this._music;
    if (!mus) return;
    this._music = null;
    if (mus.timer) clearInterval(mus.timer);
    // Scheduled pad/pluck oscillators are short-lived and stop themselves.
  }

  /** Tear everything down (keeps the context for reuse after unlock). */
  stopAll() {
    this.stopAmbience();
    this.stopMusic();
  }
}
