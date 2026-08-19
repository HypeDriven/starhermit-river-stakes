// River Stakes — Three.js presentation layer: riverside card salon driven by engine snapshots.

/* ---------------------------------------------------------------------------
 * THREE is loaded dynamically inside Renderer.create so the module imports
 * cleanly (and the game stays playable) on clients without WebGL.
 * ------------------------------------------------------------------------- */
let THREE = null;

/* ------------------------------- Framing -------------------------------- */
// Authored, low-distortion perspective shot. The camera never moves per-seat:
// seats are arranged relative to the viewer (viewer always at the front).
export const FRAMING = {
  FOV: 40,                    // low-distortion perspective
  CAM_POS: [0, 2.55, 4.15],   // behind/above the viewer's seat
  CAM_TARGET: [0, -0.10, -0.30],
  CAM_PUSH_POS: [0, 2.05, 3.25],   // results push-in pose
  CAM_PUSH_TARGET: [0, 0.0, -0.10],
  DRIFT_POS_AMP: 0.045,       // slow decorative drift (off w/ reduced motion)
  DRIFT_SPEED: 0.11,
  SHAKE_AMP: 0.018,           // award-tier only, off w/ reduced motion
};

const TABLE = { R: 1.8, SCALE_X: 1.32, SCALE_Z: 0.88, FELT_Y: 0.0, RAIL_TOP: 0.12 };
const SEAT = { COUNT: 6, RX: 3.05, RZ: 2.18, CARD_Z: 0.55, BET_Z: 1.15, STACK_X: 0.55 };
const CARD = { W: 0.34, H: 0.475, R: 0.045, FAN: 0.14, HOLE_GAP: 0.105, COMMUNITY_GAP: 0.40, COMMUNITY_Z: -0.30 };
const CHIP = { R: 0.052, H: 0.016, MAX_VISUAL: 20, MAX_STACKS: 4, INSTANCE_CAP: 256 };
const POT_POS = [0, TABLE.FELT_Y, 0.38];
const LAYER = { ENV: 0, GAME: 1, SELECT: 2, FX: 3 };

const QUALITY_TIERS = {
  low:    { shadows: false, shadowMap: 0,    dpr: 1,   scale: 0.85, particles: false, props: 'low' },
  medium: { shadows: true,  shadowMap: 1024, dpr: 1.5, scale: 1.0,  particles: true,  props: 'medium' },
  high:   { shadows: true,  shadowMap: 2048, dpr: 2,   scale: 1.0,  particles: true,  props: 'high' },
};

// Defensive palette: every field falls back so a partial theme never breaks us.
const DEFAULT_PALETTE = {
  felt: '#2e6b4f', table: '#6b4a2f', rail: '#4a3120', accent: '#d8b25a',
  sky: '#87a8c0', skyTop: '#3d5f7d', water: '#2f5f6e', waterDeep: '#1d3f4c',
  bank: '#22392e', wood: '#5d4128', text: '#f2ead8', cardBack: '#7d2e35',
  lantern: '#ffca7a',
};

const DENOMS = [500, 100, 25, 5, 1];
const DENOM_COLORS = ['#8e44ad', '#2b2b30', '#2e8b57', '#c0392b', '#e8e4d8'];

const RANK_CHARS = '23456789TJQKA';
const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
const RED_SUITS = new Set([1, 2]);

/* --------------------------- Deterministic PRNG -------------------------- */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------- Tweens -------------------------------- */
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);

class Tweens {
  constructor() { this.list = []; }
  add(dur, onUpdate, { ease = easeInOut, delay = 0, onDone = null } = {}) {
    const tw = { t: -delay, dur: Math.max(dur, 0.0001), onUpdate, ease, onDone, dead: false };
    this.list.push(tw);
    return tw;
  }
  kill(tw) { if (tw) tw.dead = true; }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      if (tw.dead) { this.list.splice(i, 1); continue; }
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = Math.min(1, tw.t / tw.dur);
      tw.onUpdate(tw.ease(k));
      if (k >= 1) {
        this.list.splice(i, 1);
        if (tw.onDone) tw.onDone();
      }
    }
  }
  finishAll() {
    const l = this.list; this.list = [];
    for (const tw of l) {
      if (tw.dead) continue;
      try { tw.onUpdate(tw.ease(1)); if (tw.onDone) tw.onDone(); } catch (_) { /* cosmetic */ }
    }
  }
}

/* ------------------------------ Canvas helpers --------------------------- */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------- Particles ------------------------------- */
// Bounded, pooled chip-spray/confetti. Positions/velocities/life are
// preallocated typed arrays; dead particles park at y=-999 (no allocations
// in the render loop, hard cap of `max` sprites).
class ConfettiPool {
  constructor(scene, max, softDotTexture, rng) {
    this.max = max;
    this.rng = rng;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.07, map: softDotTexture, vertexColors: true,
      transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER.FX);
    this.points.raycast = () => {}; // FX never raycastable
    scene.add(this.points);
    this._color = null; // lazily created after THREE load
  }
  burst(origin, count, colorsHex) {
    if (!this._color) this._color = new THREE.Color();
    let spawned = 0;
    for (let i = 0; i < this.max && spawned < count; i++) {
      if (this.life[i] > 0) continue;
      spawned++;
      const i3 = i * 3;
      this.pos[i3] = origin.x; this.pos[i3 + 1] = origin.y + 0.05; this.pos[i3 + 2] = origin.z;
      const a = this.rng() * Math.PI * 2;
      const sp = 0.7 + this.rng() * 1.3;
      this.vel[i3] = Math.cos(a) * sp * 0.6;
      this.vel[i3 + 1] = 1.4 + this.rng() * 1.6;
      this.vel[i3 + 2] = Math.sin(a) * sp * 0.6;
      this._color.set(colorsHex[(this.rng() * colorsHex.length) | 0]);
      this.col[i3] = this._color.r; this.col[i3 + 1] = this._color.g; this.col[i3 + 2] = this._color.b;
      this.life[i] = 0.9 + this.rng() * 0.7;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0 || this.pos[i3 + 1] < -1.2) {
        this.life[i] = 0; this.pos[i3 + 1] = -999;
        continue;
      }
      this.vel[i3 + 1] -= 3.2 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }
  clear() {
    for (let i = 0; i < this.max; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -999; }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/**
 * True when a WebGL context is available. Safe to call in any environment.
 */
export function supportsWebGL() {
  try {
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    if (!c.getContext) return false;
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------------------- */
export class Renderer {
  /**
   * Build the salon scene. Returns null when three.js or WebGL is unavailable;
   * the DOM UI must remain fully usable in that case.
   * @param {HTMLCanvasElement} canvas
   * @param {{theme?:object, quality?:string, reducedMotion?:boolean}} opts
   * @returns {Promise<Renderer|null>}
   */
  static async create(canvas, opts = {}) {
    try {
      if (!canvas || typeof canvas.getContext !== 'function') return null;
      if (!supportsWebGL()) return null;
      THREE = await import('../vendor/three.module.js');
      const renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, powerPreference: 'high-performance',
      });
      if (!renderer.getContext()) return null;
      return new Renderer(canvas, renderer, opts);
    } catch (_) {
      return null;
    }
  }

  constructor(canvas, renderer, opts) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.quality = QUALITY_TIERS[opts.quality] ? opts.quality : 'medium';
    this.reducedMotion = !!opts.reducedMotion;
    this.paused = false;
    this.disposed = false;

    this.theme = null;
    this.palette = { ...DEFAULT_PALETTE };

    this._time = 0;
    this._raf = 0;
    this._clock = new THREE.Clock();
    this.tweens = new Tweens();
    this._rng = mulberry32(fnv1a('river-stakes-decor'));

    // camera spring / drift / shake state (critically damped, interruptible)
    this._push = 0; this._pushVel = 0; this._pushGoal = 0;
    this._shakeAmp = 0;
    this._camDist = 1;

    // scratch objects reused every frame (no per-frame allocation)
    this._v1 = null; this._v2 = null; this._v3 = null; this._m1 = null;

    this._model = null;          // last rendered snapshot model (for diffing)
    this._playersById = new Map();
    this._seats = [];            // 6 seat visual rigs
    this._community = [];        // 5 community card slots
    this._faceCache = new Map(); // card int -> CanvasTexture
    this._labelCache = new Map();// text -> CanvasTexture
    this._backTex = null;
    this._blankTex = null;

    this._buildScene();
    this.setTheme(opts.theme || {});
    this.setQuality(this.quality);
    this.resize();

    this._onResize = () => this.resize();
    if (typeof window !== 'undefined') window.addEventListener('resize', this._onResize);

    // Prewarm: compile every shader variant before the first visible frame.
    this.renderer.render(this.scene, this.camera);

    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  /* ------------------------------ scene build --------------------------- */
  _buildScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FRAMING.FOV, 1, 0.1, 200);
    for (const l of [LAYER.ENV, LAYER.GAME, LAYER.SELECT, LAYER.FX]) this.camera.layers.enable(l);
    this._camPos = new THREE.Vector3(...FRAMING.CAM_POS);
    this._camTarget = new THREE.Vector3(...FRAMING.CAM_TARGET);
    this._pushPos = new THREE.Vector3(...FRAMING.CAM_PUSH_POS);
    this._camPushTarget = new THREE.Vector3(...FRAMING.CAM_PUSH_TARGET);
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._m1 = new THREE.Matrix4();

    // --- lighting: one warm key + soft fills, correct color management ---
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.keyLight = new THREE.DirectionalLight(0xffe0b8, 2.6);
    this.keyLight.position.set(4, 7, 3);
    this.keyLight.castShadow = true;
    const sc = this.keyLight.shadow.camera;
    sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sc.near = 1; sc.far = 20;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;

    this.hemi = new THREE.HemisphereLight(0xbcd4e6, 0x3a2c20, 0.85);
    this.amb = new THREE.AmbientLight(0xfff2e0, 0.18);
    for (const l of [this.keyLight, this.hemi, this.amb]) {
      for (const layer of [LAYER.ENV, LAYER.GAME, LAYER.SELECT, LAYER.FX]) l.layers.enable(layer);
      this.scene.add(l);
    }

    // shared textures
    this._blankTex = this._makeSolidTexture('#ffffff');
    this._softDotTex = this._makeSoftDotTexture();

    this._buildTable();
    this._buildSeats();
    this._buildCommunity();
    this._buildChips();
    this._buildDealerButton();
    this._buildHighlight();
    this._buildEnvironment();
    this._buildFlyPool();

    this.confetti = new ConfettiPool(this.scene, 240, this._softDotTex, mulberry32(fnv1a('river-stakes-fx')));
  }

  _makeSolidTexture(hex) {
    const c = makeCanvas(4, 4);
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex; ctx.fillRect(0, 0, 4, 4);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _makeSoftDotTexture() {
    const c = makeCanvas(64, 64);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ------------------------------ the table ----------------------------- */
  _buildTable() {
    // Lathe profile: foot -> pedestal -> flared underside -> rounded rail ->
    // felt lip. One authored profile, scaled to an oval (not a bare primitive).
    const P = (x, y) => new THREE.Vector2(x, y);
    const profile = [
      P(0.00, -1.00), P(0.62, -1.00), P(0.68, -0.95), P(0.52, -0.90),
      P(0.36, -0.88), P(0.30, -0.55), P(0.30, -0.25),
      P(1.30, -0.16), P(1.62, -0.12), P(1.78, -0.06),
      P(1.82, 0.02), P(1.80, 0.09), P(1.72, TABLE.RAIL_TOP), P(1.62, TABLE.RAIL_TOP),
      P(1.56, 0.05), P(1.55, 0.005), P(0.00, -0.02),
    ];
    const woodGeo = new THREE.LatheGeometry(profile, 72);
    this.woodMat = new THREE.MeshStandardMaterial({ color: this.palette.table, roughness: 0.55, metalness: 0.05 });
    this.tableMesh = new THREE.Mesh(woodGeo, this.woodMat);
    this.tableMesh.scale.set(TABLE.SCALE_X, 1, TABLE.SCALE_Z);
    this.tableMesh.receiveShadow = true;
    this.tableMesh.layers.set(LAYER.ENV);
    this.scene.add(this.tableMesh);

    // felt: subtle radial vignette texture, receive shadow
    this._feltTex = this._makeFeltTexture();
    this.feltMat = new THREE.MeshStandardMaterial({ map: this._feltTex, roughness: 0.9, metalness: 0 });
    const feltGeo = new THREE.CircleGeometry(1.56, 64);
    feltGeo.rotateX(-Math.PI / 2);
    this.feltMesh = new THREE.Mesh(feltGeo, this.feltMat);
    this.feltMesh.scale.set(TABLE.SCALE_X, 1, TABLE.SCALE_Z);
    this.feltMesh.position.y = TABLE.FELT_Y + 0.001;
    this.feltMesh.receiveShadow = true;
    this.feltMesh.layers.set(LAYER.ENV);
    this.scene.add(this.feltMesh);

    // contact grounding: radial gradient blob under the table (cheap AO)
    const c = makeCanvas(256, 256);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 126);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    this._contactTex = new THREE.CanvasTexture(c);
    const contactGeo = new THREE.CircleGeometry(3.4, 40);
    contactGeo.rotateX(-Math.PI / 2);
    const contact = new THREE.Mesh(contactGeo,
      new THREE.MeshBasicMaterial({ map: this._contactTex, transparent: true, depthWrite: false }));
    contact.position.y = -0.985;
    contact.layers.set(LAYER.ENV);
    this.scene.add(contact);
  }

  _makeFeltTexture() {
    const c = makeCanvas(512, 512);
    const ctx = c.getContext('2d');
    const felt = this.palette.felt;
    ctx.fillStyle = felt; ctx.fillRect(0, 0, 512, 512);
    const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 260);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
    // faint original salon medallion ring, purely decorative
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(256, 256, 120, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(256, 256, 132, 0, Math.PI * 2); ctx.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  /* --------------------------- cards (procedural) ------------------------ */
  _cardShape() {
    if (this._cardShapeCache) return this._cardShapeCache;
    const w = CARD.W, h = CARD.H, r = CARD.R;
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2); s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0);
    s.lineTo(w / 2, h / 2 - r); s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2);
    s.lineTo(-w / 2 + r, h / 2); s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI);
    s.lineTo(-w / 2, -h / 2 + r); s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5);
    this._cardShapeCache = s;
    return s;
  }

  _cardGeometries() {
    if (this._cardGeoCache) return this._cardGeoCache;
    const shape = this._cardShape();
    const face = new THREE.ShapeGeometry(shape, 6);
    face.rotateX(-Math.PI / 2);      // lie flat, normal +Y, texture top toward -Z
    face.rotateY(Math.PI);           // texture top toward +Z (toward table center)
    const back = new THREE.ShapeGeometry(shape, 6);
    back.rotateX(Math.PI / 2);       // faces -Y (up when the pivot is flipped)
    this._cardGeoCache = { face, back };
    return this._cardGeoCache;
  }

  _faceTexture(card) {
    let t = this._faceCache.get(card);
    if (t) return t;
    const rank = 2 + (card % 13);
    const suit = (card / 13) | 0;
    const red = RED_SUITS.has(suit);
    const ink = red ? '#b23a32' : '#26282e';
    const c = makeCanvas(256, 360);
    const ctx = c.getContext('2d');
    // stock + border
    ctx.fillStyle = '#f8f4e9';
    roundRectPath(ctx, 0, 0, 256, 360, 26); ctx.fill();
    ctx.strokeStyle = red ? 'rgba(178,58,50,0.55)' : 'rgba(38,40,46,0.55)';
    ctx.lineWidth = 5;
    roundRectPath(ctx, 9, 9, 238, 342, 20); ctx.stroke();
    // corner rank + suit (top-left), mirrored bottom-right
    const rankCh = RANK_CHARS[rank - 2];
    const suitCh = SUIT_SYMBOLS[suit];
    ctx.fillStyle = ink;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const drawCorner = (x, y, rot) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.font = 'bold 58px Georgia, "Times New Roman", serif';
      ctx.fillText(rankCh, 0, 0);
      ctx.font = '52px Georgia, serif';
      ctx.fillText(suitCh, 0, 56);
      ctx.restore();
    };
    drawCorner(44, 22, 0);
    drawCorner(212, 338, Math.PI);
    // center pip
    ctx.font = '150px Georgia, serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(suitCh, 128, 186);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this._faceCache.set(card, t);
    return t;
  }

  _backTexture() {
    if (this._backTex) return this._backTex;
    const c = makeCanvas(256, 360);
    const ctx = c.getContext('2d');
    ctx.fillStyle = this.palette.cardBack;
    roundRectPath(ctx, 0, 0, 256, 360, 26); ctx.fill();
    // original diamond-ripple pattern: nested stroked diamonds
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      const s = 24 + i * 22;
      ctx.save(); ctx.translate(128, 180); ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 5;
    roundRectPath(ctx, 9, 9, 238, 342, 20); ctx.stroke();
    this._backTex = new THREE.CanvasTexture(c);
    this._backTex.colorSpace = THREE.SRGBColorSpace;
    return this._backTex;
  }

  /** One card slot: a pivot whose rotation.x flips face (0) / back (PI). */
  _makeCard() {
    const { face, back } = this._cardGeometries();
    const faceMat = new THREE.MeshStandardMaterial({ map: this._blankTex, roughness: 0.35, metalness: 0 });
    const backMat = new THREE.MeshStandardMaterial({ map: this._backTexture(), roughness: 0.35, metalness: 0 });
    const faceMesh = new THREE.Mesh(face, faceMat);
    faceMesh.position.y = 0.0012;
    const backMesh = new THREE.Mesh(back, backMat);
    backMesh.position.y = -0.0012;
    faceMesh.castShadow = true; backMesh.castShadow = true;
    const pivot = new THREE.Group();
    pivot.add(faceMesh, backMesh);
    pivot.visible = false;
    for (const o of [pivot, faceMesh, backMesh]) o.layers.set(LAYER.GAME);
    return { pivot, face: faceMesh, back: backMesh, mode: 'none', card: -1, flipTween: null };
  }

  _setCard(slot, mode, card, animate, delay = 0) {
    const flipDur = this.reducedMotion ? 0.12 : 0.45;
    this.tweens.kill(slot.flipTween);
    slot.flipTween = null;
    if (mode === 'none') {
      slot.mode = 'none'; slot.card = -1; slot.pivot.visible = false;
      return;
    }
    const changed = slot.mode !== mode || (mode === 'face' && slot.card !== card);
    slot.pivot.visible = true;
    const targetRot = mode === 'face' ? 0 : Math.PI;
    if (mode === 'face') {
      slot.face.material.map = this._faceTexture(card);
      slot.card = card;
    } else {
      slot.card = -1;
    }
    slot.mode = mode;
    if (!animate || !changed) {
      slot.pivot.rotation.x = targetRot;
      return;
    }
    const from = slot.pivot.rotation.x;
    slot.flipTween = this.tweens.add(flipDur, (k) => {
      slot.pivot.rotation.x = from + (targetRot - from) * k;
      slot.pivot.position.y = 0.006 + Math.sin(k * Math.PI) * 0.09;
    }, { ease: easeInOut, delay, onDone: () => { slot.pivot.position.y = 0.006; } });
  }

  /* --------------------------- seats / players --------------------------- */
  _buildSeats() {
    for (let i = 0; i < SEAT.COUNT; i++) {
      const root = new THREE.Group();
      root.layers.set(LAYER.GAME);
      this.scene.add(root);

      const cards = [this._makeCard(), this._makeCard()];
      cards[0].pivot.position.set(-CARD.HOLE_GAP, 0.006, SEAT.CARD_Z);
      cards[0].pivot.rotation.y = CARD.FAN;
      cards[1].pivot.position.set(CARD.HOLE_GAP, 0.006, SEAT.CARD_Z + 0.01);
      cards[1].pivot.rotation.y = -CARD.FAN;
      root.add(cards[0].pivot, cards[1].pivot);
      for (const slot of cards) {
        slot.homePos = slot.pivot.position.clone();
        slot.dealPos = slot.pivot.position.clone();
      }

      const nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._labelTexture(''), transparent: true, depthWrite: false,
      }));
      nameSprite.scale.set(0.95, 0.27, 1);
      nameSprite.position.set(0, 0.42, -0.42);
      nameSprite.layers.set(LAYER.GAME);
      root.add(nameSprite);

      const seat = {
        index: i, root, cards, nameSprite,
        present: false, key: '', nameKey: '', status: 'none',
        cardKey: 'N', folded: false,
        vis: { chips: 0, bet: 0 },
        chipTween: null, betTween: null,
        // world-space anchors, refreshed by _placeSeats()
        stackWorld: new THREE.Vector3(), betWorld: new THREE.Vector3(),
        ringWorld: new THREE.Vector3(), perpWorld: new THREE.Vector3(1, 0, 0),
        dealStart: [new THREE.Vector3(), new THREE.Vector3()],
      };
      this._seats.push(seat);
    }
  }

  _placeSeats(viewerSeat) {
    for (let i = 0; i < SEAT.COUNT; i++) {
      const rel = (((i - viewerSeat) % SEAT.COUNT) + SEAT.COUNT) % SEAT.COUNT;
      const a = (rel / SEAT.COUNT) * Math.PI * 2; // rel 0 = front (viewer)
      const seat = this._seats[i];
      seat.root.position.set(Math.sin(a) * SEAT.RX, 0, Math.cos(a) * SEAT.RZ);
      seat.root.lookAt(0, 0, 0); // local +Z faces the table centre
      seat.root.updateWorldMatrix(true, false);
      seat.stackWorld.set(SEAT.STACK_X, 0, 0.12); seat.root.localToWorld(seat.stackWorld);
      seat.betWorld.set(0, 0, SEAT.BET_Z); seat.root.localToWorld(seat.betWorld);
      seat.ringWorld.set(0, 0.02, SEAT.CARD_Z); seat.root.localToWorld(seat.ringWorld);
      seat.perpWorld.set(1, 0, 0).applyQuaternion(seat.root.quaternion);
      for (let c = 0; c < 2; c++) {
        this._v2.set(0, 0.35, 0); // deck point above the table centre
        seat.root.worldToLocal(this._v2);
        seat.dealStart[c].copy(this._v2);
        seat.cards[c].dealPos.copy(this._v2);
      }
    }
  }

  _labelTexture(text) {
    let t = this._labelCache.get(text);
    if (t) return t;
    if (this._labelCache.size > 96) { // bound the cache
      const first = this._labelCache.keys().next().value;
      this._labelCache.get(first).dispose();
      this._labelCache.delete(first);
    }
    const c = makeCanvas(256, 72);
    const ctx = c.getContext('2d');
    if (text) {
      ctx.fillStyle = 'rgba(20,16,12,0.72)';
      roundRectPath(ctx, 4, 6, 248, 60, 14); ctx.fill();
      ctx.strokeStyle = this.palette.accent; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
      roundRectPath(ctx, 4, 6, 248, 60, 14); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.palette.text;
      ctx.font = 'bold 30px Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text.slice(0, 22), 128, 37);
    }
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this._labelCache.set(text, t);
    return t;
  }

  _setNameplate(seat, name, chips) {
    const text = `${name} · ${chips}`;
    if (text === seat.nameKey) return;
    seat.nameKey = text;
    seat.nameSprite.material.map = this._labelTexture(text);
  }

  /* ---------------------------- community cards -------------------------- */
  _buildCommunity() {
    this.communityGroup = new THREE.Group();
    this.communityGroup.position.set(0, 0, CARD.COMMUNITY_Z);
    this.communityGroup.rotation.y = Math.PI; // tops away from the viewer
    this.communityGroup.layers.set(LAYER.GAME);
    this.scene.add(this.communityGroup);
    for (let i = 0; i < 5; i++) {
      const slot = this._makeCard();
      slot.pivot.position.set((2 - i) * CARD.COMMUNITY_GAP, 0.006, 0);
      this.communityGroup.add(slot.pivot);
      this._community.push(slot);
    }
    this._communityKey = '';
  }

  /* ------------------------- chips (instanced) --------------------------- */
  _buildChips() {
    const geo = new THREE.CylinderGeometry(CHIP.R, CHIP.R, CHIP.H, 20);
    this.chipMeshes = DENOMS.map((_, d) => {
      const mat = new THREE.MeshStandardMaterial({ color: DENOM_COLORS[d], roughness: 0.4, metalness: 0.08 });
      const m = new THREE.InstancedMesh(geo, mat, CHIP.INSTANCE_CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.layers.set(LAYER.GAME);
      this.scene.add(m);
      return m;
    });
    this._chipCursor = new Int32Array(DENOMS.length);
    this._potOffset = new THREE.Vector3();
    this.visPot = 0;
    this._potTween = null;
  }

  /** Greedy denomination split -> [{d, height}], visually capped. */
  _decompose(amount, out) {
    out.length = 0;
    let rest = Math.max(0, Math.round(amount));
    for (let d = 0; d < DENOMS.length && out.length < CHIP.MAX_STACKS; d++) {
      const n = Math.floor(rest / DENOMS[d]);
      if (n <= 0) continue;
      rest -= n * DENOMS[d];
      out.push({ d, height: Math.min(n, CHIP.MAX_VISUAL) });
    }
    return out;
  }

  _writeStacks(x, y, z, perpX, perpZ, stacks) {
    const n = stacks.length;
    for (let s = 0; s < n; s++) {
      const st = stacks[s];
      const off = (s - (n - 1) / 2) * CHIP.R * 2.5;
      const mesh = this.chipMeshes[st.d];
      for (let h = 0; h < st.height; h++) {
        const idx = this._chipCursor[st.d];
        if (idx >= CHIP.INSTANCE_CAP) break;
        this._m1.makeTranslation(
          x + perpX * off, y + CHIP.H / 2 + h * CHIP.H, z + perpZ * off);
        mesh.setMatrixAt(idx, this._m1);
        this._chipCursor[st.d] = idx + 1;
      }
    }
  }

  /** Rebuild every chip instance matrix from current visual amounts. */
  _layoutChips() {
    this._chipCursor.fill(0);
    const stacks = this._stacksScratch || (this._stacksScratch = []);
    for (const seat of this._seats) {
      if (!seat.present) continue;
      if (seat.vis.chips > 0) {
        this._writeStacks(seat.stackWorld.x, TABLE.FELT_Y, seat.stackWorld.z,
          seat.perpWorld.x, seat.perpWorld.z, this._decompose(seat.vis.chips, stacks));
      }
      if (seat.vis.bet > 0) {
        this._writeStacks(seat.betWorld.x, TABLE.FELT_Y, seat.betWorld.z,
          seat.perpWorld.x, seat.perpWorld.z, this._decompose(seat.vis.bet, stacks));
      }
    }
    if (this.visPot > 0) {
      const ps = this._decompose(this.visPot, stacks);
      for (let s = 0; s < ps.length; s++) {
        const st = ps[s];
        const a = s * 2.4, rad = 0.09 * Math.sqrt(s);
        const mesh = this.chipMeshes[st.d];
        for (let h = 0; h < st.height; h++) {
          const idx = this._chipCursor[st.d];
          if (idx >= CHIP.INSTANCE_CAP) break;
          this._m1.makeTranslation(
            POT_POS[0] + this._potOffset.x + Math.cos(a) * rad,
            POT_POS[1] + CHIP.H / 2 + h * CHIP.H,
            POT_POS[2] + this._potOffset.z + Math.sin(a) * rad);
          mesh.setMatrixAt(idx, this._m1);
          this._chipCursor[st.d] = idx + 1;
        }
      }
    }
    for (let d = 0; d < DENOMS.length; d++) {
      this.chipMeshes[d].count = this._chipCursor[d];
      this.chipMeshes[d].instanceMatrix.needsUpdate = true;
    }
    this.visPotDirty = false;
  }

  /* --------------------------- dealer button ----------------------------- */
  _buildDealerButton() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.028, 24),
      new THREE.MeshStandardMaterial({ color: 0xf3eee2, roughness: 0.35 }));
    base.castShadow = true;
    const c = makeCanvas(64, 64);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f3eee2'; ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#26282e';
    ctx.font = 'bold 40px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('D', 32, 34);
    const topTex = new THREE.CanvasTexture(c);
    topTex.colorSpace = THREE.SRGBColorSpace;
    const top = new THREE.Mesh(
      new THREE.CircleGeometry(0.062, 24),
      new THREE.MeshBasicMaterial({ map: topTex }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.015;
    g.add(base, top);
    g.position.set(0, TABLE.FELT_Y + 0.014, 1.0);
    g.visible = false;
    g.traverse((o) => o.layers.set(LAYER.GAME));
    this.dealerButton = g;
    this.scene.add(g);
  }

  /* -------------------- acting highlight (selection) --------------------- */
  _buildHighlight() {
    const ringGeo = new THREE.RingGeometry(0.30, 0.375, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.actorRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: this.palette.accent, transparent: true, opacity: 0.9,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    this.actorRing.visible = false;
    this.actorRing.layers.set(LAYER.SELECT);
    this.actorRing.raycast = () => {};
    this.scene.add(this.actorRing);

    this.actorGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._softDotTex, color: this.palette.accent,
      transparent: true, opacity: 0.0, depthWrite: false,
    }));
    this.actorGlow.scale.set(1.6, 0.9, 1);
    this.actorGlow.visible = false;
    this.actorGlow.layers.set(LAYER.SELECT);
    this.actorGlow.raycast = () => {};
    this.scene.add(this.actorGlow);

    // win glow: separate flashing ring for award tier
    const winGeo = new THREE.RingGeometry(0.34, 0.46, 48);
    winGeo.rotateX(-Math.PI / 2);
    this.winRing = new THREE.Mesh(winGeo, new THREE.MeshBasicMaterial({
      color: this.palette.accent, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    this.winRing.visible = false;
    this.winRing.layers.set(LAYER.FX);
    this.winRing.raycast = () => {};
    this.scene.add(this.winRing);
  }

  /* ------------------------------ fly pool ------------------------------- */
  _buildFlyPool() {
    this._flyPool = [];
    const geo = new THREE.CylinderGeometry(CHIP.R, CHIP.R, CHIP.H, 14);
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.4 });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.layers.set(LAYER.FX);
      m.raycast = () => {};
      this.scene.add(m);
      this._flyPool.push({ mesh: m, busy: false, tween: null });
    }
  }

  _chipFly(from, to) {
    const f = this._flyPool.find((p) => !p.busy);
    if (!f) return;
    f.busy = true;
    f.mesh.visible = true;
    const dur = this.reducedMotion ? 0.12 : 0.4;
    f.tween = this.tweens.add(dur, (k) => {
      f.mesh.position.set(
        from.x + (to.x - from.x) * k,
        from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.45,
        from.z + (to.z - from.z) * k);
    }, { ease: easeOutCubic, onDone: () => { f.mesh.visible = false; f.busy = false; } });
  }

  /* ------------------------------ environment ---------------------------- */
  _buildEnvironment() {
    const env = new THREE.Group();
    env.layers.set(LAYER.ENV);
    this.scene.add(env);
    this.envGroup = env;

    // sky: gradient dome (unlit, unaffected by fog)
    this._skyTex = this._makeSkyTexture();
    const skyGeo = new THREE.SphereGeometry(80, 24, 12);
    this.skyMat = new THREE.MeshBasicMaterial({ map: this._skyTex, side: THREE.BackSide, fog: false });
    const sky = new THREE.Mesh(skyGeo, this.skyMat);
    sky.layers.set(LAYER.ENV);
    env.add(sky);
    this.scene.fog = new THREE.Fog(new THREE.Color(this.palette.sky), 22, 70);

    // river: slow procedural vertex + fragment shimmer, unlit shader
    this.waterUniforms = {
      uTime: { value: 0 },
      uColA: { value: new THREE.Color(this.palette.waterDeep) },
      uColB: { value: new THREE.Color(this.palette.water) },
      uSky: { value: new THREE.Color(this.palette.sky) },
    };
    const waterGeo = new THREE.PlaneGeometry(140, 46, 64, 16);
    const waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: `
        uniform float uTime; varying vec2 vUv; varying float vWave;
        void main() {
          vUv = uv;
          vec3 p = position;
          float w = sin(p.x * 0.55 + uTime * 0.8) * 0.5
                  + sin(p.y * 1.35 - uTime * 0.55) * 0.5;
          vWave = w;
          p.z += w * 0.14;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uSky; uniform float uTime;
        varying vec2 vUv; varying float vWave;
        void main() {
          float band = sin(vUv.y * 90.0 + uTime * 1.2 + vWave * 3.0) * 0.5 + 0.5;
          float sparkle = smoothstep(0.93, 1.0, band) * 0.22;
          vec3 col = mix(uColA, uColB, vUv.y);
          col = mix(col, uSky, vUv.y * 0.35);
          col += sparkle + vWave * 0.03;
          gl_FragColor = vec4(col, 1.0);
        }`,
      fog: false,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.92, -32);
    water.layers.set(LAYER.ENV);
    env.add(water);

    // far bank silhouettes (two parallax layers, deterministic bumps)
    this._bankMats = [];
    this._bankMats.push(this._makeBank(env, -26, 3.2, 0.55, this.palette.bank));
    this._bankMats.push(this._makeBank(env, -40, 5.0, 0.8, this.palette.bank));

    // boardwalk deck under everything
    this._deckTex = this._makeDeckTexture();
    const deckGeo = new THREE.CircleGeometry(10, 48);
    deckGeo.rotateX(-Math.PI / 2);
    this.deckMat = new THREE.MeshStandardMaterial({ map: this._deckTex, roughness: 0.85, metalness: 0 });
    const deck = new THREE.Mesh(deckGeo, this.deckMat);
    deck.position.y = -1.0;
    deck.receiveShadow = true;
    deck.layers.set(LAYER.ENV);
    env.add(deck);

    // boardwalk railing: full ring + instanced posts
    this.railMat = new THREE.MeshStandardMaterial({ color: this.palette.rail, roughness: 0.6 });
    const railGeo = new THREE.TorusGeometry(8.2, 0.055, 8, 64);
    railGeo.rotateX(Math.PI / 2);
    const rail = new THREE.Mesh(railGeo, this.railMat);
    rail.position.y = -0.32;
    rail.layers.set(LAYER.ENV);
    env.add(rail);

    const postGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.72, 8);
    const postCount = 40;
    this.posts = new THREE.InstancedMesh(postGeo, this.railMat, postCount);
    const m = new THREE.Matrix4();
    for (let i = 0; i < postCount; i++) {
      const a = (i / postCount) * Math.PI * 2;
      m.makeTranslation(Math.cos(a) * 8.2, -0.66, Math.sin(a) * 8.2);
      this.posts.setMatrixAt(i, m);
    }
    this.posts.layers.set(LAYER.ENV);
    env.add(this.posts);

    // lantern props (post + emissive globe); placement reseeded per theme
    this.lanterns = [];
    this.lanternMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.5, metalness: 0.4 });
    this.lanternGlobeMat = new THREE.MeshStandardMaterial({
      color: 0x222222, emissive: new THREE.Color(this.palette.lantern),
      emissiveIntensity: 1.6, roughness: 0.4,
    });
    const postG = new THREE.CylinderGeometry(0.03, 0.045, 1.7, 8);
    const globeG = new THREE.SphereGeometry(0.14, 16, 12);
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(postG, this.lanternMat);
      post.position.y = -1.0 + 0.85;
      const globe = new THREE.Mesh(globeG, this.lanternGlobeMat);
      globe.position.y = -1.0 + 1.78;
      g.add(post, globe);
      g.traverse((o) => o.layers.set(LAYER.ENV));
      env.add(g);
      this.lanterns.push(g);
    }
    // two real point lights, high tier only
    this.lanternLights = [];
    for (let i = 0; i < 2; i++) {
      const pl = new THREE.PointLight(0xffca7a, 0, 9, 2);
      pl.layers.enable(LAYER.ENV); pl.layers.enable(LAYER.GAME);
      env.add(pl);
      this.lanternLights.push(pl);
    }

    // medium+ props: low-poly trees on the far bank (instanced cones)
    const treeGeo = new THREE.ConeGeometry(1, 3, 7);
    this.treeMat = new THREE.MeshStandardMaterial({ color: 0x24402e, roughness: 0.9 });
    this.trees = new THREE.InstancedMesh(treeGeo, this.treeMat, 18);
    this.trees.frustumCulled = false;
    this.trees.layers.set(LAYER.ENV);
    env.add(this.trees);
    this._propsMed = this.trees;

    this._layoutProps();
  }

  _makeBank(env, z, height, alpha, colorHex) {
    const rng = mulberry32(fnv1a('bank' + z + (this.theme && this.theme.id ? String(this.theme.id) : '')));
    const shape = new THREE.Shape();
    shape.moveTo(-70, -2);
    let y = height * 0.5;
    for (let x = -70; x <= 70; x += 5) {
      y = height * (0.35 + rng() * 0.65);
      shape.lineTo(x, y);
    }
    shape.lineTo(70, -2);
    shape.closePath();
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: Math.max(0.5, 1 - alpha * 0.4), fog: true,
    });
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    mesh.position.set(0, -0.9, z);
    mesh.layers.set(LAYER.ENV);
    env.add(mesh);
    return mat;
  }

  _makeSkyTexture() {
    const c = makeCanvas(16, 256);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, this.palette.skyTop);
    g.addColorStop(0.62, this.palette.sky);
    g.addColorStop(0.8, this.palette.accent);
    g.addColorStop(1, this.palette.sky);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _makeDeckTexture() {
    const c = makeCanvas(256, 256);
    const ctx = c.getContext('2d');
    ctx.fillStyle = this.palette.wood; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    for (let y = 0; y <= 256; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const rng = mulberry32(0xdecc);
    for (let i = 0; i < 90; i++) {
      const y = rng() * 256, x = rng() * 256, len = 20 + rng() * 60;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(5, 5);
    return t;
  }

  /** Deterministic decorative layout, seeded from the theme id. */
  _layoutProps() {
    const id = this.theme && this.theme.id != null ? String(this.theme.id) : 'default';
    const rng = mulberry32(fnv1a('decor:' + id));
    this._rng = rng;
    for (let i = 0; i < this.lanterns.length; i++) {
      const a = Math.PI * (0.65 + rng() * 1.7); // sides + back, never in front of camera
      const rad = 5.4 + rng() * 2.0;
      this.lanterns[i].position.set(Math.cos(a) * rad, 0, -Math.abs(Math.sin(a)) * rad * 0.8);
    }
    for (let i = 0; i < this.lanternLights.length; i++) {
      const src = this.lanterns[i];
      this.lanternLights[i].position.set(src.position.x, 0.85, src.position.z);
    }
    const m = this._m1;
    for (let i = 0; i < this.trees.count; i++) {
      const x = -34 + rng() * 68;
      const s = 0.7 + rng() * 1.4;
      m.makeScale(s, s, s);
      m.setPosition(x, -0.9 + 1.5 * s, -25 - rng() * 3);
      this.trees.setMatrixAt(i, m);
    }
    this.trees.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------- theming ------------------------------- */
  _pal(key) {
    const p = this.theme && this.theme.palette;
    const v = p && p[key];
    return (typeof v === 'string' && v) ? v : DEFAULT_PALETTE[key];
  }

  /**
   * Re-skin materials from a theme data object (palette). Defensive: any
   * missing palette field falls back to the default palette.
   */
  setTheme(themeObj) {
    this.theme = themeObj && typeof themeObj === 'object' ? themeObj : {};
    const p = this.palette;
    for (const k of Object.keys(DEFAULT_PALETTE)) p[k] = this._pal(k);

    this.woodMat.color.set(p.table);
    this.railMat.color.set(p.rail);
    this.deckMat.map = this._makeDeckTexture();
    this.deckMat.needsUpdate = true;
    const feltTex = this._makeFeltTexture();
    this.feltMat.map.dispose();
    this.feltMat.map = feltTex;
    this.feltMat.needsUpdate = true;
    this.skyMat.map = this._makeSkyTexture();
    this.skyMat.needsUpdate = true;
    this.scene.fog.color.set(p.sky);
    this.waterUniforms.uColA.value.set(p.waterDeep);
    this.waterUniforms.uColB.value.set(p.water);
    this.waterUniforms.uSky.value.set(p.sky);
    for (const bm of this._bankMats) bm.color.set(p.bank);
    this.lanternGlobeMat.emissive.set(p.lantern);
    for (const pl of this.lanternLights) pl.color.set(p.lantern);
    this.actorRing.material.color.set(p.accent);
    this.actorGlow.material.color.set(p.accent);
    this.winRing.material.color.set(p.accent);
    this.treeMat.color.set(p.bank);

    // card backs carry the theme's cardBack color
    if (this._backTex) { this._backTex.dispose(); this._backTex = null; }
    const backTex = this._backTexture();
    for (const seat of this._seats) seat.cards.forEach((s) => { s.back.material.map = backTex; });
    for (const slot of this._community) slot.back.material.map = backTex;

    // nameplates use theme text/accent colours — drop the cache
    for (const t of this._labelCache.values()) t.dispose();
    this._labelCache.clear();
    for (const seat of this._seats) { const k = seat.nameKey; seat.nameKey = ''; if (k) { seat.nameSprite.material.map = this._labelTexture(k); seat.nameKey = k; } }

    this._layoutProps();

    // authored ease: brief exposure dip marks the transition, interruptible
    if (this.renderer) {
      const r = this.renderer;
      this.tweens.kill(this._themeTween);
      this._themeTween = this.tweens.add(0.4, (k) => {
        r.toneMappingExposure = 1.0 - Math.sin(k * Math.PI) * 0.25;
      }, { onDone: () => { r.toneMappingExposure = 1.0; } });
    }
  }

  /* ------------------------------- quality ------------------------------- */
  /**
   * Quality tiers: shadows / dpr cap / render scale / particles / env props.
   * Never alters gameplay readability.
   */
  setQuality(q) {
    if (!QUALITY_TIERS[q]) return;
    this.quality = q;
    const tier = QUALITY_TIERS[q];
    const shadowsWere = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = tier.shadows;
    this.keyLight.castShadow = tier.shadows;
    if (tier.shadows) {
      if (this.keyLight.shadow.mapSize.x !== tier.shadowMap) {
        this.keyLight.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
        if (this.keyLight.shadow.map) {
          this.keyLight.shadow.map.dispose();
          this.keyLight.shadow.map = null;
        }
      }
    }
    if (shadowsWere !== tier.shadows) {
      this.scene.traverse((o) => {
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mm of mats) mm.needsUpdate = true;
        }
      });
    }
    this._propsMed.visible = tier.props !== 'low';
    const high = tier.props === 'high';
    for (const pl of this.lanternLights) pl.intensity = high ? 5 : 0;
    this._particlesEnabled = tier.particles;
    if (!tier.particles && this.confetti) this.confetti.clear();
    this.resize();
  }

  setReducedMotion(b) {
    this.reducedMotion = !!b;
    if (this.reducedMotion) {
      this._shakeAmp = 0;
      this._pushVel = 0;
      if (this.confetti) this.confetti.clear();
    }
  }

  /* ---------------------------- snapshot -> scene ------------------------ */
  _tweenSeatAmount(seat, key, to, dur) {
    const tkey = key === 'chips' ? 'chipTween' : 'betTween';
    this.tweens.kill(seat[tkey]);
    seat[tkey] = null;
    const from = seat.vis[key];
    if (from === to || dur <= 0) { seat.vis[key] = to; return; }
    seat[tkey] = this.tweens.add(dur, (k) => {
      seat.vis[key] = from + (to - from) * k;
      this._layoutChips();
    });
  }

  _tweenPot(to, dur) {
    this.tweens.kill(this._potTween);
    this._potTween = null;
    const from = this.visPot;
    if (from === to || dur <= 0) { this.visPot = to; return; }
    this._potTween = this.tweens.add(dur, (k) => {
      this.visPot = from + (to - from) * k;
      this._layoutChips();
    });
  }

  /**
   * Pure function of the snapshot: diffs against the last rendered state and
   * tweens only what changed. Calling it twice with the same snapshot is a
   * no-op. Hidden opponent hole cards render as backs; at showdown the
   * snapshot carries real cards and they flip.
   */
  showSnapshot(snap, viewerSeat = 0) {
    if (!snap || !Array.isArray(snap.players)) return;
    const vs = ((viewerSeat % SEAT.COUNT) + SEAT.COUNT) % SEAT.COUNT;
    if (this._viewerSeat !== vs) { this._viewerSeat = vs; this._placeSeats(vs); }
    const first = this._model === null;
    const dur = this.reducedMotion ? 0.1 : 0.35;
    const phase = snap.phase;
    const betting = phase === 'preflop' || phase === 'flop' || phase === 'turn' || phase === 'river';

    this._playersById.clear();
    const present = new Set();
    for (const p of snap.players) {
      this._playersById.set(p.id, p);
      const si = p.seat | 0;
      if (si < 0 || si >= SEAT.COUNT) continue;
      present.add(si);
      const seat = this._seats[si];
      seat.present = true;

      const out = p.status === 'out';
      const chips = out ? 0 : Math.max(0, p.chips | 0);
      const bet = out ? 0 : Math.max(0, p.bet | 0);
      this._tweenSeatAmount(seat, 'chips', chips, first ? 0 : dur);
      this._tweenSeatAmount(seat, 'bet', bet, first ? 0 : dur);

      // ---- cards ----
      const inHand = !out && phase !== 'init' &&
        (p.status === 'active' || p.status === 'allin' || p.status === 'folded');
      const revealed = inHand && Array.isArray(p.cards);
      const newKey = !inHand ? 'N' : revealed ? 'F' + p.cards.join(',') : 'B';
      const prevKey = seat.cardKey || 'N';
      const folded = p.status === 'folded';
      if (first || newKey !== prevKey) {
        const deal = !first && prevKey === 'N' && newKey !== 'N';
        for (let c = 0; c < 2; c++) {
          const slot = seat.cards[c];
          const mode = !inHand ? 'none' : revealed ? 'face' : 'back';
          // reset any fold tuck/dim, then re-deal / flip as needed
          slot.pivot.position.x = slot.homePos.x;
          slot.pivot.position.z = slot.homePos.z;
          slot.face.material.color.set(0xffffff);
          slot.back.material.color.set(0xffffff);
          this._setCard(slot, mode, revealed ? p.cards[c] : -1, !first && !deal, c * 0.1);
          if (deal) { // card slide from the deck point (legal-move tier)
            const from = slot.dealPos, home = slot.homePos;
            slot.pivot.position.copy(from);
            const slideDur = this.reducedMotion ? 0.08 : 0.38;
            this.tweens.add(slideDur, (k) => {
              slot.pivot.position.x = from.x + (home.x - from.x) * k;
              slot.pivot.position.z = from.z + (home.z - from.z) * k;
            }, { ease: easeOutCubic, delay: c * 0.07 + si * 0.05 });
          }
        }
        seat.cardKey = newKey;
        seat.folded = folded;
      } else if (seat.folded !== folded) {
        seat.folded = folded;
        for (const slot of seat.cards) {
          const zFrom = slot.pivot.position.z;
          const zTo = folded ? slot.homePos.z + 0.16 : slot.homePos.z;
          const tint = folded ? 0x6f6f6f : 0xffffff;
          slot.face.material.color.set(tint);
          slot.back.material.color.set(tint);
          if (zFrom !== zTo) {
            this.tweens.add(this.reducedMotion ? 0.1 : 0.3, (k) => {
              slot.pivot.position.z = zFrom + (zTo - zFrom) * k;
            });
          }
        }
      }

      // ---- nameplate ----
      this._setNameplate(seat, String(p.name || '?'), chips);
      seat.nameSprite.material.opacity = out ? 0.3 : folded ? 0.55 : 1;
    }

    // seats with no player: clear visuals
    for (let i = 0; i < SEAT.COUNT; i++) {
      if (present.has(i)) continue;
      const seat = this._seats[i];
      seat.present = false;
      seat.cardKey = 'N'; seat.folded = false;
      for (const slot of seat.cards) this._setCard(slot, 'none', -1, false);
      this._tweenSeatAmount(seat, 'chips', 0, 0);
      this._tweenSeatAmount(seat, 'bet', 0, 0);
      seat.nameSprite.material.map = this._labelTexture('');
      seat.nameKey = '';
    }

    // ---- community ----
    const comm = Array.isArray(snap.community) ? snap.community : [];
    const commKey = comm.join(',');
    if (first || commKey !== this._communityKey) {
      const oldLen = this._communityKey ? this._communityKey.split(',').filter((s) => s !== '').length : 0;
      for (let i = 0; i < 5; i++) {
        if (i < comm.length) this._setCard(this._community[i], 'face', comm[i], i >= oldLen, (i - Math.max(0, oldLen)) * 0.12);
        else this._setCard(this._community[i], 'none', -1, false);
      }
      this._communityKey = commKey;
    }

    // ---- pot ----
    let pot = 0;
    if (Array.isArray(snap.pots) && snap.pots.length) {
      for (const x of snap.pots) pot += x.amount | 0;
    } else {
      for (const p of snap.players) pot += (p.totalBet | 0) - (p.bet | 0);
    }
    pot = Math.max(0, pot);
    this._tweenPot(pot, first ? 0 : dur);
    if (pot === 0) this._potOffset.set(0, 0, 0);

    // ---- dealer button ----
    const d = snap.dealer;
    if (typeof d === 'number' && present.has(d) && phase !== 'init') {
      this._v1.set(-0.48, TABLE.FELT_Y + 0.02, 0.8);
      this._seats[d].root.localToWorld(this._v1);
      if (first || !this.dealerButton.visible) {
        this.dealerButton.position.copy(this._v1);
        this.dealerButton.visible = true;
      } else {
        const from = this.dealerButton.position.clone();
        const to = this._v1.clone();
        this.tweens.add(dur, (k) => this.dealerButton.position.lerpVectors(from, to, k));
      }
    } else {
      this.dealerButton.visible = false;
    }

    // ---- acting-player highlight (selection layer) ----
    const actor = typeof snap.currentActor === 'number' ? snap.currentActor : -1;
    const acting = betting && actor >= 0 && actor < SEAT.COUNT && present.has(actor);
    this.actorRing.visible = acting;
    this.actorGlow.visible = acting;
    if (acting) {
      const s = this._seats[actor];
      this.actorRing.position.copy(s.ringWorld);
      this._v1.set(0, 0.40, -0.45);
      s.root.localToWorld(this._v1);
      this.actorGlow.position.copy(this._v1);
      this.actorGlow.material.opacity = this.reducedMotion ? 0.35 : 0.5;
    }

    // ---- camera push-in lifecycle ----
    if (phase === 'terminal') this._pushGoal = this.reducedMotion ? 0 : 1;
    else if (phase === 'init' || phase === 'preflop') this._pushGoal = 0;

    this._layoutChips();
    this._model = { tick: snap.tick };
  }

  /* -------------------------------- events ------------------------------- */
  _flashWinRing(worldPos) {
    const ring = this.winRing;
    ring.position.copy(worldPos);
    ring.visible = true;
    this.tweens.kill(this._winTween);
    const dur = this.reducedMotion ? 0.3 : 0.9;
    this._winTween = this.tweens.add(dur, (k) => {
      ring.material.opacity = 0.85 * (1 - k);
      const s = 1 + k * 0.6;
      ring.scale.set(s, 1, s);
    }, { ease: easeOutCubic, onDone: () => { ring.visible = false; } });
  }

  /**
   * Cosmetic animation per event hierarchy:
   * input ack (subtle) < legal move (card slide / chip push) < showdown/award
   * (pot slide, win glow, bounded confetti) < terminal (gentle push-in).
   * fast=true settles everything to the final state instantly.
   */
  playEvents(events, { fast = false } = {}) {
    if (Array.isArray(events) && !fast) {
      for (const ev of events) {
        if (!ev || typeof ev.type !== 'string') continue;
        switch (ev.type) {
          case 'post': { // blinds: chip push, legal-move tier
            const p = this._playersById.get(ev.playerId);
            if (p) {
              const s = this._seats[p.seat | 0];
              if (s && s.present) this._chipFly(s.stackWorld, s.betWorld);
            }
            break;
          }
          case 'action': {
            const p = this._playersById.get(ev.playerId);
            if (!p) break;
            const s = this._seats[p.seat | 0];
            if (!s || !s.present) break;
            if (ev.action === 'bet' || ev.action === 'raise' || ev.action === 'call' || ev.action === 'allin') {
              this._chipFly(s.stackWorld, s.betWorld);
            } else if (ev.action === 'check') { // input ack: subtle
              this.tweens.add(0.18, (k) => {
                const sc = 1 + Math.sin(k * Math.PI) * 0.03;
                s.root.scale.set(sc, 1, sc);
              }, { onDone: () => s.root.scale.set(1, 1, 1) });
            }
            break;
          }
          case 'deal': {
            if (!this.reducedMotion) {
              this.tweens.add(0.3, (k) => {
                const sc = 1 + Math.sin(k * Math.PI) * 0.04;
                this.communityGroup.scale.set(sc, 1, sc);
              }, { onDone: () => this.communityGroup.scale.set(1, 1, 1) });
            }
            break;
          }
          case 'street': {
            this.tweens.add(this.reducedMotion ? 0.12 : 0.3, (k) => {
              const sc = 1 + Math.sin(k * Math.PI) * 0.05;
              this.communityGroup.scale.set(sc, 1, sc);
            }, { onDone: () => this.communityGroup.scale.set(1, 1, 1) });
            break;
          }
          case 'showdown': {
            this._v3.set(0, TABLE.FELT_Y + 0.03, CARD.COMMUNITY_Z);
            this._flashWinRing(this._v3);
            break;
          }
          case 'award': {
            const pots = Array.isArray(ev.pots) ? ev.pots : [];
            const winnerId = pots.length && pots[0].winners && pots[0].winners.length
              ? pots[0].winners[0] : null;
            const wp = winnerId != null ? this._playersById.get(winnerId) : null;
            if (wp) {
              const s = this._seats[wp.seat | 0];
              if (s && s.present) {
                // pot mound slides to the winner
                const from = this._potOffset.clone();
                const to = new THREE.Vector3(
                  s.betWorld.x - POT_POS[0], 0, s.betWorld.z - POT_POS[2]);
                this.tweens.add(this.reducedMotion ? 0.15 : 0.6, (k) => {
                  this._potOffset.lerpVectors(from, to, k);
                  this._layoutChips();
                }, { ease: easeInOut });
                this._flashWinRing(s.ringWorld);
                if (this._particlesEnabled && !this.reducedMotion && this.confetti) {
                  this.confetti.burst(s.betWorld, 120,
                    [this.palette.accent, '#f7e9c4', '#ffffff']);
                }
                if (!this.reducedMotion) this._shakeAmp = FRAMING.SHAKE_AMP;
              }
            }
            break;
          }
          case 'terminal': {
            if (!this.reducedMotion) this._pushGoal = 1;
            break;
          }
          case 'handStart': {
            this._pushGoal = 0;
            this._potOffset.set(0, 0, 0);
            break;
          }
          default:
            break; // handEnd / eliminated: snapshot visuals already cover them
        }
      }
    }
    if (fast) {
      // settle to the exact deterministic end state
      if (Array.isArray(events)) {
        for (const ev of events) {
          if (ev && ev.type === 'terminal' && !this.reducedMotion) this._pushGoal = 1;
        }
      }
      this.tweens.finishAll();
      if (this.confetti) this.confetti.clear();
      this._push = this._pushGoal;
      this._pushVel = 0;
      this._shakeAmp = 0;
      this._potOffset.set(0, 0, 0);
      this.winRing.visible = false;
      this.communityGroup.scale.set(1, 1, 1);
      this._layoutChips();
    }
  }

  /* ------------------------------ frame loop ----------------------------- */
  _tick() {
    if (this.disposed || this.paused) return;
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(this._clock.getDelta(), 0.1); // clock-driven, never frame-count
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt) {
    this._time += dt;
    this.tweens.update(dt);
    const rm = this.reducedMotion;

    if (!rm) this.waterUniforms.uTime.value += dt; // river shimmer

    // acting-player ring: pulsing, or static highlight under reduced motion
    if (this.actorRing.visible) {
      const s = rm ? 1 : 1 + 0.07 * Math.sin(this._time * 5.0);
      this.actorRing.scale.set(s, 1, s);
    }

    // lantern flicker (subtle, decorative)
    this.lanternGlobeMat.emissiveIntensity = rm ? 1.6
      : 1.6 + Math.sin(this._time * 7.3) * 0.12 + Math.sin(this._time * 13.1) * 0.06;

    // camera push-in: critically damped spring, interruptible, never lerped
    const omega = 3.0;
    const acc = (this._pushGoal - this._push) * omega * omega - 2 * omega * this._pushVel;
    this._pushVel += acc * dt;
    this._push += this._pushVel * dt;

    this._shakeAmp *= Math.exp(-5 * dt);

    const t = this._time;
    const v = this._v1;
    v.lerpVectors(this._camPos, this._pushPos, this._push);
    if (this._camDist !== 1) {
      v.sub(this._camTarget).multiplyScalar(this._camDist).add(this._camTarget);
    }
    if (!rm) { // slow authored drift + optional award-tier shake
      v.x += Math.sin(t * FRAMING.DRIFT_SPEED * Math.PI * 2) * FRAMING.DRIFT_POS_AMP;
      v.y += Math.sin(t * FRAMING.DRIFT_SPEED * 2.7 * Math.PI + 1.3) * FRAMING.DRIFT_POS_AMP * 0.6;
      if (this._shakeAmp > 0.0005) {
        v.x += Math.sin(t * 47.0) * this._shakeAmp;
        v.y += Math.sin(t * 39.0) * this._shakeAmp;
      }
    }
    this.camera.position.copy(v);
    this._v2.lerpVectors(this._camTarget, this._camPushTarget, this._push);
    this.camera.lookAt(this._v2);

    if (this._particlesEnabled && this.confetti) this.confetti.update(dt);
  }

  /* ------------------------------- lifecycle ----------------------------- */
  /** Reads the canvas client size, applies aspect + dpr cap + render scale. */
  resize() {
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 400;
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // portrait fit: pull the authored shot back so the table stays framed
    this._camDist = aspect >= 1.15 ? 1 : Math.min(2.1, 1.15 / Math.max(aspect, 0.3));
    const tier = QUALITY_TIERS[this.quality];
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.renderer.setPixelRatio(Math.min(dpr, tier.dpr) * tier.scale);
    this.renderer.setSize(w, h, false);
  }

  setPaused(b) {
    b = !!b;
    if (b === this.paused) return;
    this.paused = b;
    if (b) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    } else if (!this.disposed) {
      this._clock.getDelta(); // discard the paused interval
      this._raf = requestAnimationFrame(this._tick);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    if (typeof window !== 'undefined' && this._onResize) {
      window.removeEventListener('resize', this._onResize);
    }
    this.tweens.list.length = 0;
    for (const t of this._faceCache.values()) t.dispose();
    this._faceCache.clear();
    for (const t of this._labelCache.values()) t.dispose();
    this._labelCache.clear();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    });
    this.renderer.dispose();
  }

  debugInfo() {
    const info = this.renderer.info.render;
    return { drawCalls: info.calls, triangles: info.triangles, quality: this.quality };
  }
}
