// The riverside card salon on starhermit:scene, as the browser build's
// js/render.js drew it with three.js r160: the authored low-distortion
// perspective shot (viewer always at the front; slow drift, an award-tier
// shake, the results push-in on a critically damped spring), the lathed oval
// table with its felt (medallion rings; woven nap and a darker rim when
// detailed) and brass inlay, the procedural cards (canvas faces, the
// theme-coloured diamond-ripple back; flipped, dealt and tucked on fold), the
// instanced chip stacks per seat, bet and pot (edge spots, inlay ring and
// lacquer when detailed) with flying chips, the nameplates, the dealer
// button, the acting ring and glow, the win ring and spray, the boardwalk
// deck and railing, the lanterns (halos, flicker, two real lights on High
// and Ultra), the river shimmer (the old GLSL as WGSL), the far banks and
// trees, the sky dome, fog and the fireflies. The renderer is driven by the
// session's snapshots (showSnapshot diffs and tweens what changed) and
// events (playEvents: the event hierarchy's animation), as before.
//
// From three.js r160 (physically based lights): colours, light intensities,
// the fitted shadow box and normalBias as written (minor 28). render.js prefiltered `new RoomEnvironment(renderer)`
// (r160: the 900-candela room) with PMREM as the scene environment when
// detailed; r160 scaled it by each material's envMapIntensity, so the port
// gives every lit material the environment as its own envMap at that
// intensity (the engine's scene environment takes only the scene's
// intensity at minor 20). The old composer (RenderPass in half floats → GTAO
// → UnrealBloom 0.45 / 0.35 / 0.92 → the colour grade + vignette →
// OutputPass with ACES → SMAA / FXAA) is the runtime's renderer.ao / bloom /
// grade / antialias, chosen per quality tier (native/quality.ts).
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, BackSide, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color,
  ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, DynamicDrawUsage, Fog, Group, HemisphereLight, InstancedMesh,
  LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PMREMGenerator,
  PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial, RepeatWrapping, RingGeometry, RoomEnvironment, SRGBColorSpace, Shape,
  ShapeGeometry, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, TorusGeometry, Vector2, Vector3, renderer, scene,
  type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import type { GameEvent, Snapshot, Theme } from "./game.ts";
import { CONFETTI_MAX, MOTE_MAX, type Budget, type Look } from "./quality.ts";

/* ------------------------------- Framing -------------------------------- */
export const FRAMING = {
  FOV: 40,
  CAM_POS: [0, 2.55, 4.15] as const,
  CAM_TARGET: [0, -0.10, -0.30] as const,
  CAM_PUSH_POS: [0, 2.05, 3.25] as const,
  CAM_PUSH_TARGET: [0, 0.0, -0.10] as const,
  DRIFT_POS_AMP: 0.045,
  DRIFT_SPEED: 0.11,
  SHAKE_AMP: 0.018,
};
const TABLE = { R: 1.8, SCALE_X: 1.32, SCALE_Z: 0.88, FELT_Y: 0.0, RAIL_TOP: 0.12 };
const SEAT = { COUNT: 6, RX: 3.05, RZ: 2.18, CARD_Z: 0.55, BET_Z: 1.15, STACK_X: 0.55 };
const CARD = { W: 0.34, H: 0.475, R: 0.045, FAN: 0.14, HOLE_GAP: 0.105, COMMUNITY_GAP: 0.40, COMMUNITY_Z: -0.30 };
const CHIP = { R: 0.052, H: 0.016, MAX_VISUAL: 20, MAX_STACKS: 4, INSTANCE_CAP: 256 };
const POT_POS = [0, TABLE.FELT_Y, 0.38] as const;
const PI = Math.PI;

const DEFAULT_PALETTE: Record<string, string> = {
  felt: "#2e6b4f", table: "#6b4a2f", rail: "#4a3120", accent: "#d8b25a",
  sky: "#87a8c0", skyTop: "#3d5f7d", water: "#2f5f6e", waterDeep: "#1d3f4c",
  bank: "#22392e", wood: "#5d4128", text: "#f2ead8", cardBack: "#7d2e35",
  lantern: "#ffca7a",
};
const DENOMS = [500, 100, 25, 5, 1];
const DENOM_COLORS = ["#8e44ad", "#2b2b30", "#2e8b57", "#c0392b", "#e8e4d8"];
const RANK_CHARS = "23456789TJQKA";
const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"];
const RED_SUITS = new Set([1, 2]);

/* --------------------------- Deterministic PRNG -------------------------- */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------- Tweens -------------------------------- */
const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOutCubic = (k: number): number => 1 - Math.pow(1 - k, 3);
interface Tween { t: number; dur: number; onUpdate: (k: number) => void; ease: (k: number) => number; onDone: (() => void) | null; dead: boolean }
class Tweens {
  list: Tween[] = [];
  add(dur: number, onUpdate: (k: number) => void, o: { ease?: (k: number) => number; delay?: number; onDone?: (() => void) | null } = {}): Tween {
    const tw: Tween = { t: -(o.delay ?? 0), dur: Math.max(dur, 0.0001), onUpdate, ease: o.ease ?? easeInOut, onDone: o.onDone ?? null, dead: false };
    this.list.push(tw);
    return tw;
  }
  kill(tw: Tween | null): void { if (tw) tw.dead = true; }
  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i]!;
      if (tw.dead) { this.list.splice(i, 1); continue; }
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = Math.min(1, tw.t / tw.dur);
      tw.onUpdate(tw.ease(k));
      if (k >= 1) { this.list.splice(i, 1); if (tw.onDone) tw.onDone(); }
    }
  }
  finishAll(): void {
    const l = this.list; this.list = [];
    for (const tw of l) {
      if (tw.dead) continue;
      try { tw.onUpdate(tw.ease(1)); if (tw.onDone) tw.onDone(); } catch { /* cosmetic */ }
    }
  }
}

/* ------------------------------ Canvas helpers --------------------------- */
type Ctx = OffscreenCanvasRenderingContext2D;
function makeCanvas(w: number, h: number): { c: OffscreenCanvas; ctx: Ctx } {
  const c = new OffscreenCanvas(w, h);
  return { c, ctx: c.getContext("2d")! as Ctx };
}
function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function srgb(c: OffscreenCanvas): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/* ----------------------------- shading tiers ---------------------------- */
type Lit = MeshLambertMaterial | MeshStandardMaterial | MeshPhysicalMaterial;
interface Pbr { roughness: number; metalness: number; envMapIntensity: number; clearcoat: number; clearcoatRoughness: number }
const SHADING = { lambert: 0, standard: 1, physical: 2 } as const;
/** render.js shadeAs: the preset's shading model for a lit surface (Physical-only surfaces step down). */
function shadeAs(old: Lit, tier: Budget["material"], authored: "standard" | "physical"): Lit {
  const want = Math.min(SHADING[tier], SHADING[authored]);
  const cur = old instanceof MeshPhysicalMaterial ? 2 : old instanceof MeshStandardMaterial ? 1 : 0;
  if (cur === want) return old;
  const pbr = (old.userData.pbr as Pbr | undefined) ?? (old instanceof MeshStandardMaterial
    ? { roughness: old.roughness, metalness: old.metalness, envMapIntensity: old.envMapIntensity, clearcoat: old instanceof MeshPhysicalMaterial ? old.clearcoat : 0, clearcoatRoughness: old instanceof MeshPhysicalMaterial ? old.clearcoatRoughness : 0 }
    : undefined);
  const base = { map: old.map, transparent: old.transparent, opacity: old.opacity, depthWrite: old.depthWrite, side: old.side, color: old.color.clone() };
  let m: Lit;
  if (want === 0) m = new MeshLambertMaterial(base);
  else if (want === 1) m = new MeshStandardMaterial({ ...base, ...(pbr ? { roughness: pbr.roughness, metalness: pbr.metalness, envMapIntensity: pbr.envMapIntensity } : {}) });
  else m = new MeshPhysicalMaterial({ ...base, ...(pbr ? { roughness: pbr.roughness, metalness: pbr.metalness, envMapIntensity: pbr.envMapIntensity, clearcoat: pbr.clearcoat, clearcoatRoughness: pbr.clearcoatRoughness } : {}) });
  if ("emissive" in old && "emissive" in m) { m.emissive.copy(old.emissive); m.emissiveIntensity = old.emissiveIntensity; }
  m.userData.pbr = pbr;
  m.userData.authored = authored;
  old.dispose();
  return m;
}

/* ------------------------------- Particles ------------------------------- */
class ConfettiPool {
  max: number; cap: number; rng: () => number;
  pos: Float32Array; vel: Float32Array; col: Float32Array; life: Float32Array;
  points: Points; color = new Color();
  constructor(max: number, dot: Texture, rng: () => number) {
    this.max = max; this.cap = max; this.rng = rng;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.life = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new BufferAttribute(this.col, 3));
    const mat = new PointsMaterial({ size: 0.07, map: dot, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true });
    this.points = new Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  private attr(name: "position" | "color"): BufferAttribute { return this.points.geometry.getAttribute(name) as BufferAttribute; }
  burst(o: Vector3, count: number, colors: string[]): void {
    let spawned = 0;
    for (let i = 0; i < this.cap && spawned < count; i++) {
      if (this.life[i]! > 0) continue;
      spawned++;
      const i3 = i * 3;
      this.pos[i3] = o.x; this.pos[i3 + 1] = o.y + 0.05; this.pos[i3 + 2] = o.z;
      const a = this.rng() * PI * 2;
      const sp = 0.7 + this.rng() * 1.3;
      this.vel[i3] = Math.cos(a) * sp * 0.6;
      this.vel[i3 + 1] = 1.4 + this.rng() * 1.6;
      this.vel[i3 + 2] = Math.sin(a) * sp * 0.6;
      this.color.set(colors[(this.rng() * colors.length) | 0]!);
      this.col[i3] = this.color.r; this.col[i3 + 1] = this.color.g; this.col[i3 + 2] = this.color.b;
      this.life[i] = 0.9 + this.rng() * 0.7;
    }
    this.attr("position").needsUpdate = true;
    this.attr("color").needsUpdate = true;
  }
  setCap(n: number): void {
    this.cap = Math.max(0, Math.min(this.max, n));
    for (let i = this.cap; i < this.max; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -999; }
    this.points.geometry.setDrawRange(0, this.cap);
    this.attr("position").needsUpdate = true;
  }
  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      this.life[i]! -= dt;
      const i3 = i * 3;
      if (this.life[i]! <= 0 || this.pos[i3 + 1]! < -1.2) { this.life[i] = 0; this.pos[i3 + 1] = -999; continue; }
      this.vel[i3 + 1]! -= 3.2 * dt;
      this.pos[i3]! += this.vel[i3]! * dt;
      this.pos[i3 + 1]! += this.vel[i3 + 1]! * dt;
      this.pos[i3 + 2]! += this.vel[i3 + 2]! * dt;
    }
    if (any) this.attr("position").needsUpdate = true;
  }
  clear(): void {
    for (let i = 0; i < this.max; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -999; }
    this.attr("position").needsUpdate = true;
  }
}

/* ------------------------------- state ---------------------------------- */
interface CardSlot { pivot: Group; face: Mesh; back: Mesh; mode: "none" | "face" | "back"; card: number; flipTween: Tween | null; homePos: Vector3; dealPos: Vector3 }
interface SeatRig {
  index: number; root: Group; cards: CardSlot[]; nameSprite: Sprite; present: boolean; nameKey: string; cardKey: string; folded: boolean;
  vis: { chips: number; bet: number }; chipTween: Tween | null; betTween: Tween | null;
  stackWorld: Vector3; betWorld: Vector3; ringWorld: Vector3; perpWorld: Vector3;
}
const tweens = new Tweens();
const palette: Record<string, string> = { ...DEFAULT_PALETTE };
let theme: Theme | null = null;
let reducedMotion = false;
let look: Look | null = null;
let budget: Budget | null = null;
let detail: boolean | null = null;
let time = 0;
let push = 0, pushVel = 0, pushGoal = 0, shakeAmp = 0, camDist = 1;
let model: { tick: number } | null = null;
let viewerSeat = "";
let communityKey = "";
const playersById = new Map<string, Snapshot["players"][number]>();
const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3();
const m1 = new Matrix4();

const camera = new PerspectiveCamera(FRAMING.FOV, 1, 0.1, 200);
const camPos = new Vector3(...FRAMING.CAM_POS), camTarget = new Vector3(...FRAMING.CAM_TARGET);
const pushPos = new Vector3(...FRAMING.CAM_PUSH_POS), camPushTarget = new Vector3(...FRAMING.CAM_PUSH_TARGET);

// --- lighting: one warm key + soft fills (r160 intensities) ---
const keyLight = new DirectionalLight(0xffe0b8, 2.6);
keyLight.position.set(4, 7, 3);
keyLight.castShadow = true;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
// frustum fitted to the table, seats and the table's shadow on the deck
Object.assign(keyLight.shadow.camera, { left: -3.6, right: 3.6, top: 3.4, bottom: -3.4, near: 4, far: 14 });
keyLight.shadow.camera.updateProjectionMatrix();
const hemi = new HemisphereLight(0xbcd4e6, 0x3a2c20, 0.85);
const amb = new AmbientLight(0xfff2e0, 0.18);
scene.add(keyLight, keyLight.target, hemi, amb);

// shared textures
function softDotTexture(): CanvasTexture {
  const { c, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.6, "rgba(255,255,255,0.7)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return srgb(c);
}
function solidTexture(hex: string): CanvasTexture {
  const { c, ctx } = makeCanvas(4, 4);
  ctx.fillStyle = hex; ctx.fillRect(0, 0, 4, 4);
  return srgb(c);
}
const blankTex = solidTexture("#ffffff");
const softDotTex = softDotTexture();
const texSize = (): number => budget?.texture ?? 512;
const cardSize = (): number => budget?.card ?? 256;

/** Grayscale wood grain; multiplied by the theme's table colour. */
function makeWoodTexture(): CanvasTexture {
  const n = texSize();
  const { c, ctx } = makeCanvas(n, n / 2);
  ctx.scale(n / 512, n / 512);
  ctx.fillStyle = "#e6e0da"; ctx.fillRect(0, 0, 512, 256);
  const rng = mulberry32(fnv1a("river-stakes-wood"));
  for (let i = 0; i < 220; i++) {
    const y = rng() * 256;
    const l = 150 + rng() * 105;
    ctx.strokeStyle = `rgba(${l | 0},${(l * 0.92) | 0},${(l * 0.86) | 0},${0.25 + rng() * 0.35})`;
    ctx.lineWidth = 0.6 + rng() * 2.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * (1 + rng() * 2));
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(60,40,30,0.10)";
  for (let i = 0; i < 12; i++) ctx.fillRect(0, rng() * 256, 512, 2 + rng() * 6);
  const t = srgb(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(6, 1);
  t.anisotropy = 4;
  return t;
}
function makeFeltTexture(): CanvasTexture {
  const n = texSize();
  const { c, ctx } = makeCanvas(n, n);
  ctx.scale(n / 512, n / 512);
  ctx.fillStyle = palette.felt!; ctx.fillRect(0, 0, 512, 512);
  const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 260);
  g.addColorStop(0, "rgba(255,255,255,0.07)"); g.addColorStop(0.75, "rgba(0,0,0,0.05)"); g.addColorStop(1, "rgba(0,0,0,0.30)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(256, 256, 120, 0, PI * 2); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(256, 256, 132, 0, PI * 2); ctx.stroke();
  if (detail) {
    const rng = mulberry32(fnv1a("felt-nap"));
    for (let i = 0; i < 9000; i++) {
      const v = rng();
      ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.05 + v * 0.08})` : `rgba(255,255,255,${0.02 + (v - 0.5) * 0.06})`;
      ctx.fillRect(rng() * 512, rng() * 512, 1 + rng() * 1.5, 1);
    }
    const rim = ctx.createRadialGradient(256, 256, 200, 256, 256, 256);
    rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(0.85, "rgba(0,0,0,0.12)"); rim.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = rim; ctx.fillRect(0, 0, 512, 512);
  }
  const t = srgb(c);
  t.anisotropy = 4;
  return t;
}
function makeSkyTexture(): CanvasTexture {
  const { c, ctx } = makeCanvas(16, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, palette.skyTop!); g.addColorStop(0.62, palette.sky!); g.addColorStop(0.8, palette.accent!); g.addColorStop(1, palette.sky!);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  return srgb(c);
}
function makeDeckTexture(): CanvasTexture {
  const n = texSize() / 2;
  const { c, ctx } = makeCanvas(n, n);
  ctx.scale(n / 256, n / 256);
  ctx.fillStyle = palette.wood!; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 3;
  for (let y = 0; y <= 256; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  const rng = mulberry32(0xdecc);
  for (let i = 0; i < 90; i++) {
    const y = rng() * 256, x = rng() * 256, len = 20 + rng() * 60;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  const t = srgb(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(5, 5);
  return t;
}

/* ------------------------------ the table ----------------------------- */
const profile = [
  [0.00, -1.00], [0.62, -1.00], [0.68, -0.95], [0.52, -0.90],
  [0.36, -0.88], [0.30, -0.55], [0.30, -0.25],
  [1.30, -0.16], [1.62, -0.12], [1.78, -0.06],
  [1.82, 0.02], [1.80, 0.09], [1.72, TABLE.RAIL_TOP], [1.62, TABLE.RAIL_TOP],
  [1.56, 0.05], [1.55, 0.005], [0.00, -0.02],
].map(([x, y]) => new Vector2(x!, y!));
let woodTex = makeWoodTexture();
let woodMat: Lit = new MeshStandardMaterial({ color: palette.table, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.6 });
const tableMesh = new Mesh(new LatheGeometry(profile, 72), woodMat);
tableMesh.scale.set(TABLE.SCALE_X, 1, TABLE.SCALE_Z);
tableMesh.receiveShadow = true;
tableMesh.castShadow = true;
scene.add(tableMesh);
const trimGeo = new TorusGeometry(1.675, 0.011, 8, 128);
trimGeo.rotateX(PI / 2);
const brassMat = new MeshStandardMaterial({ color: palette.accent, metalness: 1, roughness: 0.5, envMapIntensity: 0.25 });
const brassTrim = new Mesh(trimGeo, brassMat);
brassTrim.scale.set(TABLE.SCALE_X, 1, TABLE.SCALE_Z);
brassTrim.position.y = TABLE.RAIL_TOP + 0.002;
brassTrim.visible = false;
scene.add(brassTrim);
let feltMat: Lit = new MeshStandardMaterial({ map: blankTex, roughness: 0.9, metalness: 0, envMapIntensity: 0.25 });
const feltGeo = new CircleGeometry(1.56, 64);
feltGeo.rotateX(-PI / 2);
const feltMesh = new Mesh(feltGeo, feltMat);
feltMesh.scale.set(TABLE.SCALE_X, 1, TABLE.SCALE_Z);
feltMesh.position.y = TABLE.FELT_Y + 0.001;
feltMesh.receiveShadow = true;
scene.add(feltMesh);
{ // contact grounding: radial gradient blob under the table (cheap AO)
  const { c, ctx } = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 126);
  g.addColorStop(0, "rgba(0,0,0,0.5)"); g.addColorStop(0.7, "rgba(0,0,0,0.28)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const contactGeo = new CircleGeometry(3.4, 40);
  contactGeo.rotateX(-PI / 2);
  const contact = new Mesh(contactGeo, new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false }));
  contact.position.y = -0.985;
  scene.add(contact);
}

/* --------------------------- cards (procedural) ------------------------ */
const cardShape = ((): Shape => {
  const w = CARD.W, h = CARD.H, r = CARD.R;
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.absarc(w / 2 - r, -h / 2 + r, r, -PI / 2, 0);
  s.lineTo(w / 2, h / 2 - r); s.absarc(w / 2 - r, h / 2 - r, r, 0, PI / 2);
  s.lineTo(-w / 2 + r, h / 2); s.absarc(-w / 2 + r, h / 2 - r, r, PI / 2, PI);
  s.lineTo(-w / 2, -h / 2 + r); s.absarc(-w / 2 + r, -h / 2 + r, r, PI, PI * 1.5);
  return s;
})();
const faceGeo = new ShapeGeometry(cardShape, 6);
faceGeo.rotateX(-PI / 2);
faceGeo.rotateY(PI);
const backGeo = new ShapeGeometry(cardShape, 6);
backGeo.rotateX(PI / 2);
const faceCache = new Map<number, CanvasTexture>();
let backTex: CanvasTexture | null = null;
function faceTexture(card: number): CanvasTexture {
  let t = faceCache.get(card);
  if (t) return t;
  const rank = 2 + (card % 13);
  const suit = (card / 13) | 0;
  const red = RED_SUITS.has(suit);
  const ink = red ? "#b23a32" : "#26282e";
  const cw = cardSize();
  const { c, ctx } = makeCanvas(cw, Math.round((cw * 360) / 256));
  ctx.scale(cw / 256, cw / 256);
  ctx.fillStyle = "#f8f4e9";
  roundRectPath(ctx, 0, 0, 256, 360, 26); ctx.fill();
  ctx.strokeStyle = red ? "rgba(178,58,50,0.55)" : "rgba(38,40,46,0.55)";
  ctx.lineWidth = 5;
  roundRectPath(ctx, 9, 9, 238, 342, 20); ctx.stroke();
  const rankCh = RANK_CHARS[rank - 2]!;
  const suitCh = SUIT_SYMBOLS[suit]!;
  ctx.fillStyle = ink;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  const corner = (x: number, y: number, rot: number): void => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.font = "bold 58px serif";
    ctx.fillText(rankCh, 0, 0);
    ctx.font = "52px serif";
    ctx.fillText(suitCh, 0, 56);
    ctx.restore();
  };
  corner(44, 22, 0);
  corner(212, 338, PI);
  ctx.font = "150px serif";
  ctx.textBaseline = "middle";
  ctx.fillText(suitCh, 128, 186);
  t = srgb(c);
  t.anisotropy = 4;
  faceCache.set(card, t);
  return t;
}
function backTexture(): CanvasTexture {
  if (backTex) return backTex;
  const cw = cardSize();
  const { c, ctx } = makeCanvas(cw, Math.round((cw * 360) / 256));
  ctx.scale(cw / 256, cw / 256);
  ctx.fillStyle = palette.cardBack!;
  roundRectPath(ctx, 0, 0, 256, 360, 26); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.20)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    const s = 24 + i * 22;
    ctx.save(); ctx.translate(128, 180); ctx.rotate(PI / 4);
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 5;
  roundRectPath(ctx, 9, 9, 238, 342, 20); ctx.stroke();
  backTex = srgb(c);
  return backTex;
}
function makeCard(): CardSlot {
  const faceMat = new MeshPhysicalMaterial({ map: blankTex, roughness: 0.55, metalness: 0, envMapIntensity: 0.2 });
  const backMat = new MeshPhysicalMaterial({ map: backTexture(), roughness: 0.45, metalness: 0, envMapIntensity: 0.35 });
  const face = new Mesh(faceGeo, faceMat);
  face.position.y = 0.0012;
  const back = new Mesh(backGeo, backMat);
  back.position.y = -0.0012;
  face.castShadow = true; back.castShadow = true;
  const pivot = new Group();
  pivot.add(face, back);
  pivot.visible = false;
  return { pivot, face, back, mode: "none", card: -1, flipTween: null, homePos: new Vector3(), dealPos: new Vector3() };
}
const lit = (m: Mesh): Lit => m.material as Lit;
function setCard(slot: CardSlot, mode: CardSlot["mode"], card: number, animate: boolean, delay = 0): void {
  const flipDur = reducedMotion ? 0.12 : 0.45;
  tweens.kill(slot.flipTween);
  slot.flipTween = null;
  if (mode === "none") { slot.mode = "none"; slot.card = -1; slot.pivot.visible = false; return; }
  const changed = slot.mode !== mode || (mode === "face" && slot.card !== card);
  slot.pivot.visible = true;
  const targetRot = mode === "face" ? 0 : PI;
  if (mode === "face") { lit(slot.face).map = faceTexture(card); slot.card = card; } else slot.card = -1;
  slot.mode = mode;
  if (!animate || !changed) { slot.pivot.rotation.x = targetRot; return; }
  const from = slot.pivot.rotation.x;
  slot.flipTween = tweens.add(flipDur, (k) => {
    slot.pivot.rotation.x = from + (targetRot - from) * k;
    slot.pivot.position.y = 0.006 + Math.sin(k * PI) * 0.09;
  }, { ease: easeInOut, delay, onDone: () => { slot.pivot.position.y = 0.006; } });
}

/* --------------------------- seats / players --------------------------- */
const labelCache = new Map<string, CanvasTexture>();
function labelTexture(text: string): CanvasTexture {
  let t = labelCache.get(text);
  if (t) return t;
  // bounded: the engine holds at most 120 images (render.js kept 96 plates; 52 card faces and the scene's
  // textures need the rest), and a plate is redrawn whenever a seat's chips change
  if (labelCache.size > 18) {
    const used = new Set(seats.map((s) => s.nameKey));
    for (const k of labelCache.keys()) {
      if (used.has(k) || k === "") continue;
      labelCache.get(k)!.dispose();
      labelCache.delete(k);
      break;
    }
  }
  const { c, ctx } = makeCanvas(256, 72);
  if (text) {
    ctx.fillStyle = "rgba(20,16,12,0.72)";
    roundRectPath(ctx, 4, 6, 248, 60, 14); ctx.fill();
    ctx.strokeStyle = palette.accent!; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
    roundRectPath(ctx, 4, 6, 248, 60, 14); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.text!;
    ctx.font = "bold 30px serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 22), 128, 37);
  }
  t = srgb(c);
  labelCache.set(text, t);
  return t;
}
const seats: SeatRig[] = [];
for (let i = 0; i < SEAT.COUNT; i++) {
  const root = new Group();
  scene.add(root);
  const cards = [makeCard(), makeCard()];
  cards[0]!.pivot.position.set(-CARD.HOLE_GAP, 0.006, SEAT.CARD_Z);
  cards[0]!.pivot.rotation.y = CARD.FAN;
  cards[1]!.pivot.position.set(CARD.HOLE_GAP, 0.006, SEAT.CARD_Z + 0.01);
  cards[1]!.pivot.rotation.y = -CARD.FAN;
  root.add(cards[0]!.pivot, cards[1]!.pivot);
  for (const slot of cards) { slot.homePos.copy(slot.pivot.position); slot.dealPos.copy(slot.pivot.position); }
  const nameSprite = new Sprite(new SpriteMaterial({ map: labelTexture(""), transparent: true, depthWrite: false }));
  nameSprite.scale.set(0.95, 0.27, 1);
  nameSprite.position.set(0, 0.42, -0.42);
  nameSprite.visible = false; // an empty plate draws nothing (render.js drew its transparent canvas)
  root.add(nameSprite);
  seats.push({
    index: i, root, cards, nameSprite, present: false, nameKey: "", cardKey: "N", folded: false,
    vis: { chips: 0, bet: 0 }, chipTween: null, betTween: null,
    stackWorld: new Vector3(), betWorld: new Vector3(), ringWorld: new Vector3(), perpWorld: new Vector3(1, 0, 0),
  });
}
function placeSeats(viewer: number, count: number): void {
  const n = count >= 2 && count <= 4 ? count : SEAT.COUNT;
  for (let i = 0; i < SEAT.COUNT; i++) {
    const rel = i < n ? (((i - viewer) % n) + n) % n : i;
    const a = (rel / n) * PI * 2;
    const seat = seats[i]!;
    seat.root.position.set(-Math.sin(a) * SEAT.RX, 0, Math.cos(a) * SEAT.RZ);
    seat.root.lookAt(0, 0, 0);
    seat.root.updateWorldMatrix(true, false);
    seat.stackWorld.set(SEAT.STACK_X, 0, 0.12); seat.root.localToWorld(seat.stackWorld);
    seat.betWorld.set(0, 0, SEAT.BET_Z); seat.root.localToWorld(seat.betWorld);
    seat.ringWorld.set(0, 0.02, SEAT.CARD_Z); seat.root.localToWorld(seat.ringWorld);
    seat.perpWorld.set(1, 0, 0).applyQuaternion(seat.root.quaternion);
    for (let c = 0; c < 2; c++) {
      v2.set(0, 0.35, 0);
      seat.root.worldToLocal(v2);
      seat.cards[c]!.dealPos.copy(v2);
    }
  }
}
function setNameplate(seat: SeatRig, name: string, chips: number): void {
  const text = `${name} · ${chips}`;
  if (text === seat.nameKey) return;
  seat.nameKey = text;
  seat.nameSprite.material.map = labelTexture(text);
  seat.nameSprite.visible = true;
}

/* ---------------------------- community cards -------------------------- */
const communityGroup = new Group();
communityGroup.position.set(0, 0, CARD.COMMUNITY_Z);
communityGroup.rotation.y = PI;
scene.add(communityGroup);
const community: CardSlot[] = [];
for (let i = 0; i < 5; i++) {
  const slot = makeCard();
  slot.pivot.position.set((2 - i) * CARD.COMMUNITY_GAP, 0.006, 0);
  communityGroup.add(slot.pivot);
  community.push(slot);
}
const cardSlots = (): CardSlot[] => [...seats.flatMap((s) => s.cards), ...community];

/* ------------------------- chips (instanced) --------------------------- */
const chipGeo = new CylinderGeometry(CHIP.R, CHIP.R, CHIP.H, 20);
function chipTextures(hex: string): [CanvasTexture, CanvasTexture] {
  const light = hex.toLowerCase() === "#e8e4d8";
  const spot = light ? "#3a5f8c" : "#f3ecdb";
  const side = makeCanvas(256, 16);
  side.ctx.fillStyle = hex; side.ctx.fillRect(0, 0, 256, 16);
  side.ctx.fillStyle = spot;
  for (let i = 0; i < 8; i++) side.ctx.fillRect(i * 32 + 8, 0, 14, 16);
  const cap = makeCanvas(128, 128);
  const ctx = cap.ctx;
  ctx.fillStyle = hex; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = spot; ctx.lineWidth = 12;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    ctx.beginPath(); ctx.arc(64, 64, 56, a + 0.12, a + 0.52); ctx.stroke();
  }
  ctx.strokeStyle = light ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.45)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(64, 64, 36, 0, PI * 2); ctx.stroke();
  ctx.fillStyle = light ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.10)";
  ctx.beginPath(); ctx.arc(64, 64, 35, 0, PI * 2); ctx.fill();
  const out = [side.c, cap.c].map((cv) => { const t = srgb(cv); t.anisotropy = 4; return t; });
  return [out[0]!, out[1]!];
}
let chipMatsPlain: Lit[] = DENOMS.map((_, d) => new MeshStandardMaterial({ color: DENOM_COLORS[d], roughness: 0.4, metalness: 0.08 }));
// detailed chips: edge spots on the rim, dashed inlay ring on the face, lacquer clearcoat (render.js gave one
// instanced cylinder the [side, cap, cap] materials; an InstancedMesh here takes one material, so the rim and the
// top face are two instanced meshes; the bottom face lies on the felt, unseen)
let chipMatsRich: Lit[][] = DENOMS.map((_, d) => {
  const [side, cap] = chipTextures(DENOM_COLORS[d]!);
  const o = { roughness: 0.4, metalness: 0.02, clearcoat: 0.4, clearcoatRoughness: 0.35, envMapIntensity: 0.5 };
  return [new MeshPhysicalMaterial({ ...o, map: side }), new MeshPhysicalMaterial({ ...o, map: cap })];
});
const chipSideGeo = new CylinderGeometry(CHIP.R, CHIP.R, CHIP.H, 20, 1, true);
const chipCapGeo = new CircleGeometry(CHIP.R, 20);
chipCapGeo.rotateX(-PI / 2);
chipCapGeo.translate(0, CHIP.H / 2, 0);
function chipMesh(geo: BufferGeometry, mat: Lit): InstancedMesh {
  const m = new InstancedMesh(geo, mat, CHIP.INSTANCE_CAP);
  m.instanceMatrix.setUsage(DynamicDrawUsage);
  m.castShadow = true;
  m.frustumCulled = false;
  m.count = 0;
  scene.add(m);
  return m;
}
/** Per denomination: the plain cylinder, and the detailed rim and face. */
const chipMeshes = DENOMS.map((_, d) => ({
  plain: chipMesh(chipGeo, chipMatsPlain[d]!), side: chipMesh(chipSideGeo, chipMatsRich[d]![0]!), cap: chipMesh(chipCapGeo, chipMatsRich[d]![1]!),
}));
function showChipKind(rich: boolean): void {
  for (const c of chipMeshes) { c.plain.visible = !rich; c.side.visible = rich; c.cap.visible = rich; }
}
const chipCursor = new Int32Array(DENOMS.length);
const potOffset = new Vector3();
let visPot = 0;
let potTween: Tween | null = null;
const stacksScratch: { d: number; height: number }[] = [];
function decompose(amount: number, out: { d: number; height: number }[]): { d: number; height: number }[] {
  out.length = 0;
  let rest = Math.max(0, Math.round(amount));
  for (let d = 0; d < DENOMS.length && out.length < CHIP.MAX_STACKS; d++) {
    const n = Math.floor(rest / DENOMS[d]!);
    if (n <= 0) continue;
    rest -= n * DENOMS[d]!;
    out.push({ d, height: Math.min(n, CHIP.MAX_VISUAL) });
  }
  return out;
}
function writeStacks(x: number, y: number, z: number, px: number, pz: number, stacks: { d: number; height: number }[]): void {
  const n = stacks.length;
  for (let s = 0; s < n; s++) {
    const st = stacks[s]!;
    const off = (s - (n - 1) / 2) * CHIP.R * 2.5;
    for (let h = 0; h < st.height; h++) {
      const idx = chipCursor[st.d]!;
      if (idx >= CHIP.INSTANCE_CAP) break;
      m1.makeTranslation(x + px * off, y + CHIP.H / 2 + h * CHIP.H, z + pz * off);
      setChip(st.d, idx);
      chipCursor[st.d] = idx + 1;
    }
  }
}
function layoutChips(): void {
  chipCursor.fill(0);
  for (const seat of seats) {
    if (!seat.present) continue;
    if (seat.vis.chips > 0) writeStacks(seat.stackWorld.x, TABLE.FELT_Y, seat.stackWorld.z, seat.perpWorld.x, seat.perpWorld.z, decompose(seat.vis.chips, stacksScratch));
    if (seat.vis.bet > 0) writeStacks(seat.betWorld.x, TABLE.FELT_Y, seat.betWorld.z, seat.perpWorld.x, seat.perpWorld.z, decompose(seat.vis.bet, stacksScratch));
  }
  if (visPot > 0) {
    const ps = decompose(visPot, stacksScratch);
    for (let s = 0; s < ps.length; s++) {
      const st = ps[s]!;
      const a = s * 2.4, rad = 0.09 * Math.sqrt(s);
      for (let h = 0; h < st.height; h++) {
        const idx = chipCursor[st.d]!;
        if (idx >= CHIP.INSTANCE_CAP) break;
        m1.makeTranslation(POT_POS[0] + potOffset.x + Math.cos(a) * rad, POT_POS[1] + CHIP.H / 2 + h * CHIP.H, POT_POS[2] + potOffset.z + Math.sin(a) * rad);
        setChip(st.d, idx);
        chipCursor[st.d] = idx + 1;
      }
    }
  }
  for (let d = 0; d < DENOMS.length; d++) {
    const c = chipMeshes[d]!;
    for (const m of [c.plain, c.side, c.cap]) { m.count = chipCursor[d]!; m.instanceMatrix.needsUpdate = true; }
  }
}
function setChip(d: number, idx: number): void {
  const c = chipMeshes[d]!;
  if (detail) { c.side.setMatrixAt(idx, m1); c.cap.setMatrixAt(idx, m1); } else c.plain.setMatrixAt(idx, m1);
}

/* --------------------------- dealer button ----------------------------- */
const dealerButton = new Group();
{
  const base = new Mesh(new CylinderGeometry(0.075, 0.075, 0.028, 24), new MeshStandardMaterial({ color: 0xf3eee2, roughness: 0.35 }));
  base.castShadow = true;
  const { c, ctx } = makeCanvas(64, 64);
  ctx.fillStyle = "#f3eee2"; ctx.beginPath(); ctx.arc(32, 32, 30, 0, PI * 2); ctx.fill();
  ctx.fillStyle = "#26282e";
  ctx.font = "bold 40px serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("D", 32, 34);
  const top = new Mesh(new CircleGeometry(0.062, 24), new MeshBasicMaterial({ map: srgb(c) }));
  top.rotation.x = -PI / 2;
  top.position.y = 0.015;
  dealerButton.add(base, top);
  dealerButton.position.set(0, TABLE.FELT_Y + 0.014, 1.0);
  dealerButton.visible = false;
  scene.add(dealerButton);
}

/* -------------------- acting highlight (selection) --------------------- */
const ringGeo = new RingGeometry(0.30, 0.375, 48);
ringGeo.rotateX(-PI / 2);
const actorRing = new Mesh(ringGeo, new MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide }));
actorRing.visible = false;
scene.add(actorRing);
const actorGlow = new Sprite(new SpriteMaterial({ map: softDotTex, color: palette.accent, transparent: true, opacity: 0.0, depthWrite: false }));
actorGlow.scale.set(1.6, 0.9, 1);
actorGlow.visible = false;
scene.add(actorGlow);
const winGeo = new RingGeometry(0.34, 0.46, 48);
winGeo.rotateX(-PI / 2);
const winRing = new Mesh(winGeo, new MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
winRing.visible = false;
scene.add(winRing);

/* ------------------------------ fly pool ------------------------------- */
const flyPool: { mesh: Mesh; busy: boolean }[] = [];
{
  const geo = new CylinderGeometry(CHIP.R, CHIP.R, CHIP.H, 14);
  const mat = new MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.4 });
  for (let i = 0; i < 10; i++) {
    const m = new Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    flyPool.push({ mesh: m, busy: false });
  }
}
function chipFly(from: Vector3, to: Vector3): void {
  const f = flyPool.find((p) => !p.busy);
  if (!f) return;
  f.busy = true;
  f.mesh.visible = true;
  const a = from.clone(), b = to.clone();
  tweens.add(reducedMotion ? 0.12 : 0.4, (k) => {
    f.mesh.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k + Math.sin(k * PI) * 0.45, a.z + (b.z - a.z) * k);
  }, { ease: easeOutCubic, onDone: () => { f.mesh.visible = false; f.busy = false; } });
}

/* ------------------------------ environment ---------------------------- */
let skyTex = makeSkyTexture();
const skyMat = new MeshBasicMaterial({ map: skyTex, side: BackSide, fog: false });
scene.add(new Mesh(new SphereGeometry(80, 24, 12), skyMat));
scene.fog = new Fog(new Color(palette.sky), 22, 70);

// river: the old vertex wave + fragment shimmer (GLSL → WGSL; v = 1 − uv.y)
const waterUniforms = {
  uTime: { value: 0 },
  uColA: { value: new Color(palette.waterDeep) },
  uColB: { value: new Color(palette.water) },
  uSky: { value: new Color(palette.sky) },
  uGlint: { value: new Color(palette.lantern) },
};
const waterMat = new ShaderMaterial({
  uniforms: waterUniforms,
  vertexShader: /* wgsl */ `
fn vertex(v: Vertex) -> Vertex {
  var o = v;
  let p = v.position;
  let w = sin(p.x * 0.55 + uniforms.uTime * 0.8) * 0.5 + sin(p.y * 1.35 - uniforms.uTime * 0.55) * 0.5;
  o.position = vec3f(p.x, p.y, p.z + w * 0.14);
  o.v0 = vec4f(w, 0.0, 0.0, 0.0);
  return o;
}`,
  fragmentShader: /* wgsl */ `
fn fragment(f: Fragment) -> vec4f {
  let vy = 1.0 - f.uv.y;
  let vx = f.uv.x;
  let wave = f.v0.x;
  let band = sin(vy * 90.0 + uniforms.uTime * 1.2 + wave * 3.0) * 0.5 + 0.5;
  let sparkle = smoothstep(0.93, 1.0, band) * 0.12;
  var col = mix(uniforms.uColA, uniforms.uColB, vy);
  col = mix(col, uniforms.uSky, pow(vy, 1.6) * 0.4);
  col = col + sparkle * mix(vec3f(1.0), uniforms.uSky, 0.4) + vec3f(wave * 0.03);
  let ripple = smoothstep(0.55, 1.0, sin(vy * 160.0 - uniforms.uTime * 0.9 + wave * 5.0 + sin(vx * 60.0) * 1.5));
  let column = exp(-pow((vx - 0.5) * 9.0, 2.0)) * (1.0 - smoothstep(0.0, 0.55, vy));
  col = col + uniforms.uGlint * ripple * column * 0.6;
  return vec4f(col, 1.0);
}`,
  fog: false,
});
let waterSegs = 64;
const waterGeoFor = (n: number): PlaneGeometry => new PlaneGeometry(140, 46, n, Math.max(4, n / 4));
const water = new Mesh(waterGeoFor(64), waterMat);
water.rotation.x = -PI / 2;
water.position.set(0, -0.92, -32);
scene.add(water);
let waterAnimated = true;

const bankMeshes: Mesh[] = [];
function makeBank(z: number, height: number, alpha: number): Mesh {
  const rng = mulberry32(fnv1a("bank" + z + (theme?.id != null ? String(theme.id) : "")));
  const shape = new Shape();
  shape.moveTo(-70, -2);
  for (let x = -70; x <= 70; x += 5) shape.lineTo(x, height * (0.35 + rng() * 0.65));
  shape.lineTo(70, -2);
  shape.closePath();
  const mat = new MeshBasicMaterial({ color: palette.bank, transparent: true, opacity: Math.max(0.5, 1 - alpha * 0.4), fog: true });
  const mesh = new Mesh(new ShapeGeometry(shape), mat);
  mesh.position.set(0, -0.9, z);
  scene.add(mesh);
  return mesh;
}
bankMeshes.push(makeBank(-26, 3.2, 0.55), makeBank(-40, 5.0, 0.8));

let deckMat: Lit = new MeshStandardMaterial({ map: makeDeckTexture(), roughness: 0.85, metalness: 0, envMapIntensity: 0.35 });
const deckGeo = new CircleGeometry(10, 48);
deckGeo.rotateX(-PI / 2);
const deckMesh = new Mesh(deckGeo, deckMat);
deckMesh.position.y = -1.0;
deckMesh.receiveShadow = true;
scene.add(deckMesh);

const railMat = new MeshStandardMaterial({ color: palette.rail, roughness: 0.6 });
{
  const railGeo = new TorusGeometry(8.2, 0.055, 8, 64);
  railGeo.rotateX(PI / 2);
  const rail = new Mesh(railGeo, railMat);
  rail.position.y = -0.32;
  scene.add(rail);
  const postCount = 40;
  const posts = new InstancedMesh(new CylinderGeometry(0.035, 0.04, 0.72, 8), railMat, postCount);
  for (let i = 0; i < postCount; i++) {
    const a = (i / postCount) * PI * 2;
    m1.makeTranslation(Math.cos(a) * 8.2, -0.66, Math.sin(a) * 8.2);
    posts.setMatrixAt(i, m1);
  }
  posts.instanceMatrix.needsUpdate = true;
  scene.add(posts);
}

const lanterns: Group[] = [];
const lanternHalos: Sprite[] = [];
const lanternMat = new MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.5, metalness: 0.4 });
const lanternGlobeMat = new MeshStandardMaterial({ color: 0x222222, emissive: new Color(palette.lantern), emissiveIntensity: 1.6, roughness: 0.4 });
{
  const postG = new CylinderGeometry(0.03, 0.045, 1.7, 8);
  const globeG = new SphereGeometry(0.14, 16, 12);
  for (let i = 0; i < 4; i++) {
    const g = new Group();
    const post = new Mesh(postG, lanternMat);
    post.position.y = -1.0 + 0.85;
    const globe = new Mesh(globeG, lanternGlobeMat);
    globe.position.y = -1.0 + 1.78;
    const halo = new Sprite(new SpriteMaterial({
      map: softDotTex, color: new Color(palette.lantern).multiplyScalar(1.6), transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending,
    }));
    halo.scale.set(0.9, 0.9, 1);
    halo.position.y = globe.position.y;
    halo.visible = false;
    lanternHalos.push(halo);
    g.add(post, globe, halo);
    scene.add(g);
    lanterns.push(g);
  }
}
const lanternLights: PointLight[] = [];
for (let i = 0; i < 2; i++) {
  const pl = new PointLight(0xffca7a, 0, 9, 2);
  pl.visible = false;
  scene.add(pl);
  lanternLights.push(pl);
}
const treeMat = new MeshStandardMaterial({ color: 0x24402e, roughness: 0.9 });
const trees = new InstancedMesh(new ConeGeometry(1, 3, 7), treeMat, 18);
trees.frustumCulled = false;
scene.add(trees);

function layoutProps(): void {
  const id = theme?.id != null ? String(theme.id) : "default";
  const rng = mulberry32(fnv1a("decor:" + id));
  for (const l of lanterns) {
    const a = PI * (0.65 + rng() * 1.7);
    const rad = 5.4 + rng() * 2.0;
    l.position.set(Math.cos(a) * rad, 0, -Math.abs(Math.sin(a)) * rad * 0.8);
  }
  lanternLights.forEach((pl, i) => { const src = lanterns[i]!; pl.position.set(src.position.x, 0.85, src.position.z); });
  for (let i = 0; i < trees.count; i++) {
    const x = -34 + rng() * 68;
    const s = 0.7 + rng() * 1.4;
    m1.makeScale(s, s, s);
    m1.setPosition(x, -0.9 + 1.5 * s, -25 - rng() * 3);
    trees.setMatrixAt(i, m1);
  }
  trees.instanceMatrix.needsUpdate = true;
}

const confetti = new ConfettiPool(CONFETTI_MAX, softDotTex, mulberry32(fnv1a("river-stakes-fx")));
let confettiCap = 180;
let particlesHigh = true;

// fireflies over the deck and the river edge (particles: high)
const motes = (() => {
  const n = MOTE_MAX;
  const rng = mulberry32(fnv1a("river-stakes-motes"));
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = PI * (0.55 + rng() * 1.9);
    const r = 4.2 + rng() * 6.5;
    seed[i * 4] = Math.cos(a) * r;
    seed[i * 4 + 1] = -0.6 + rng() * 2.4;
    seed[i * 4 + 2] = -Math.abs(Math.sin(a)) * r - 0.5;
    seed[i * 4 + 3] = rng() * 100;
    pos[i * 3] = seed[i * 4]!; pos[i * 3 + 1] = seed[i * 4 + 1]!; pos[i * 3 + 2] = seed[i * 4 + 2]!;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  const mat = new PointsMaterial({ size: 0.07, map: softDotTex, color: new Color(palette.lantern), transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);
  return { points, mat, pos, seed, n, count: n };
})();
function updateMotes(t: number): void {
  if (!motes.points.visible) return;
  const { pos, seed } = motes;
  for (let i = 0; i < motes.count; i++) {
    const k = seed[i * 4 + 3]!;
    pos[i * 3] = seed[i * 4]! + Math.sin(t * 0.21 + k) * 0.6;
    pos[i * 3 + 1] = seed[i * 4 + 1]! + Math.sin(t * 0.37 + k * 1.7) * 0.25;
    pos[i * 3 + 2] = seed[i * 4 + 2]! + Math.cos(t * 0.17 + k * 0.6) * 0.5;
  }
  (motes.points.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
  motes.mat.opacity = 0.7 + Math.sin(t * 1.3) * 0.2;
}

/* ------------------------------ the environment light ------------------------------ */
let envTex: Texture | null = null;
function environmentTexture(): Texture | null {
  if (!envTex) {
    try {
      const pm = new PMREMGenerator(renderer);
      envTex = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
      pm.dispose();
    } catch (e) { console.warn(`environment: ${String(e)}`); envTex = null; }
  }
  return envTex;
}
/** Every lit material: the room as its own envMap at its envMapIntensity when detailed (r160's per-material scale). */
function applyEnvironment(): void {
  const env = detail ? environmentTexture() : null;
  const mats = new Set<Material>();
  scene.traverse((o) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) mats.add(x);
  });
  for (const x of [...chipMatsPlain, ...chipMatsRich.flat()]) mats.add(x);
  for (const x of mats) if (x instanceof MeshStandardMaterial) x.envMap = env;
  hemi.intensity = env ? 0.5 : 0.85;
  amb.intensity = env ? 0.06 : 0.18;
}

/* ------------------------------- theming ------------------------------- */
/** render.js setTheme: re-skin materials from a theme's palette (missing fields from the defaults). */
export function setTheme(t: Theme | null): void {
  if (t && theme && t.id === theme.id) return;
  theme = t;
  for (const k of Object.keys(DEFAULT_PALETTE)) {
    const v = t?.palette?.[k];
    palette[k] = typeof v === "string" && v ? v : DEFAULT_PALETTE[k]!;
  }
  woodMat.color.set(palette.table!);
  railMat.color.set(palette.rail!);
  deckMat.map?.dispose();
  deckMat.map = makeDeckTexture();
  rebuildFelt();
  skyTex.dispose();
  skyTex = makeSkyTexture();
  skyMat.map = skyTex;
  scene.fog!.color.set(palette.sky!);
  waterUniforms.uColA.value.set(palette.waterDeep!);
  waterUniforms.uColB.value.set(palette.water!);
  waterUniforms.uSky.value.set(palette.sky!);
  waterUniforms.uGlint.value.set(palette.lantern!);
  for (const b of bankMeshes) (b.material as MeshBasicMaterial).color.set(palette.bank!);
  lanternGlobeMat.emissive.set(palette.lantern!);
  for (const h of lanternHalos) h.material.color.set(palette.lantern!).multiplyScalar(1.6);
  motes.mat.color.set(palette.lantern!);
  brassMat.color.set(palette.accent!).lerp(new Color("#8a6c40"), 0.7);
  for (const pl of lanternLights) pl.color.set(palette.lantern!);
  (actorRing.material as MeshBasicMaterial).color.set(palette.accent!);
  actorGlow.material.color.set(palette.accent!);
  (winRing.material as MeshBasicMaterial).color.set(palette.accent!);
  treeMat.color.set(palette.bank!);
  if (backTex) { backTex.dispose(); backTex = null; }
  const back = backTexture();
  for (const slot of cardSlots()) lit(slot.back).map = back;
  for (const tx of labelCache.values()) tx.dispose();
  labelCache.clear();
  for (const seat of seats) { const k = seat.nameKey; seat.nameKey = ""; if (k) { seat.nameSprite.material.map = labelTexture(k); seat.nameKey = k; } }
  layoutProps();
  tweens.kill(themeTween);
  themeTween = tweens.add(0.4, (k) => { exposure = 1.0 - Math.sin(k * PI) * 0.25; }, { onDone: () => { exposure = 1.0; } });
}
let themeTween: Tween | null = null;
let exposure = 1.0;
function rebuildFelt(): void {
  const t = makeFeltTexture();
  if (feltMat.map && feltMat.map !== blankTex) feltMat.map.dispose();
  feltMat.map = t;
}

/* ------------------------------ graphics ------------------------------ */
/** render.js setGraphics + the composer: the tier's shadows, post effects, detail, particles and budgets. */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  look = next;
  applyBudget(next.budget);
  renderer.shadowMap.enabled = next.shadows > 0;
  keyLight.castShadow = next.shadows > 0;
  if (next.shadows > 0) {
    const ms = keyLight.shadow.mapSize;
    if (typeof ms === "number") keyLight.shadow.mapSize = next.shadows; else ms.set(next.shadows, next.shadows);
  }
  applyDetail(next.detailed);
  particlesHigh = next.particles === "high";
  confetti.setCap(particlesHigh ? confettiCap : Math.round(confettiCap / 3));
  applyMotion();
  renderer.toneMapping = ACESFilmicToneMapping;
  // UnrealBloomPass(0.45, 0.35, 0.92): only the lantern globes, halos and bright glints bloom.
  // r160 page: UnrealBloomPass 0.45 → 0.45² at minor 29 (r185 bloom).
  renderer.bloom = next.bloom ? { strength: 0.45 * 0.45, radius: 0.35, threshold: 0.92, resolution: next.budget.bloomRes } : null;
  // GTAO radius 0.35, distance exponent 1.2, thickness 0.6, 16 / 8 samples and the denoise per tier; blend 0.75.
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.35, distanceExponent: 1.2, thickness: 0.6, scale: 1,
    samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // GradeShader on the composer's linear buffer: a 0.18 S-curve, saturation 1.08, cool shadows / warm highlights by a
  // smoothstep of luma from 0.15 to 0.8, a 0.2 vignette from 0.38 to 0.9 (wider than tall: 1.1 × 1).
  renderer.grade = next.grade ? {
    space: "linear", contrast: 0.18, saturation: 1.08, split: [0.15, 0.8], shadows: [0.97, 0.99, 1.05], highlights: [1.05, 1.0, 0.95], levels: [0.97, 0.015], overRange: "keep",
    vignette: { amount: 0.2, inner: 0.38, outer: 0.9, scale: [1.1, 1] },
  } : null;
  renderer.antialias = next.antialias;
}
function applyDetail(on: boolean): void {
  if (detail === on) return;
  detail = on;
  woodMat.map = on ? woodTex : null;
  if (woodMat instanceof MeshStandardMaterial) woodMat.roughness = on ? 0.42 : 0.55;
  rebuildFelt();
  showChipKind(on);
  layoutChips();
  for (const slot of cardSlots()) for (const m of [lit(slot.face), lit(slot.back)]) {
    if (m instanceof MeshPhysicalMaterial) { m.clearcoat = on ? 0.2 : 0; m.clearcoatRoughness = 0.5; }
  }
  brassTrim.visible = on;
  for (const h of lanternHalos) h.visible = on;
  trees.visible = on;
  applyLights();
  applyEnvironment();
}
function applyLights(): void {
  const n = detail && budget ? budget.lights : 0;
  lanternLights.forEach((pl, i) => { pl.visible = i < n; pl.intensity = i < n ? 3 : 0; });
}
function applyBudget(b: Budget): void {
  const prev = budget;
  budget = b;
  if (b.texture !== (prev?.texture ?? 512)) {
    const wood = makeWoodTexture();
    if (woodMat.map === woodTex) woodMat.map = wood;
    woodTex.dispose(); woodTex = wood;
    deckMat.map?.dispose();
    deckMat.map = makeDeckTexture();
    if (detail !== null) rebuildFelt();
  }
  if (b.card !== (prev?.card ?? 256)) {
    for (const t of faceCache.values()) t.dispose();
    faceCache.clear();
    if (backTex) { backTex.dispose(); backTex = null; }
    const back = backTexture();
    for (const slot of cardSlots()) {
      lit(slot.back).map = back;
      lit(slot.face).map = slot.mode === "face" && slot.card >= 0 ? faceTexture(slot.card) : blankTex;
    }
  }
  if (prev?.material !== b.material) {
    const t = b.material;
    woodMat = shadeAs(woodMat, t, "standard"); tableMesh.material = woodMat;
    feltMat = shadeAs(feltMat, t, "standard"); feltMesh.material = feltMat;
    deckMat = shadeAs(deckMat, t, "standard"); deckMesh.material = deckMat;
    for (const slot of cardSlots()) {
      slot.face.material = shadeAs(lit(slot.face), t, "physical");
      slot.back.material = shadeAs(lit(slot.back), t, "physical");
    }
    chipMatsPlain = chipMatsPlain.map((m) => shadeAs(m, t, "standard"));
    chipMatsRich = chipMatsRich.map(([side, cap]) => [shadeAs(side!, t, "physical"), shadeAs(cap!, t, "physical")]);
    chipMeshes.forEach((c, d) => { c.plain.material = chipMatsPlain[d]!; c.side.material = chipMatsRich[d]![0]!; c.cap.material = chipMatsRich[d]![1]!; });
    if (detail !== null) {
      for (const slot of cardSlots()) for (const m of [lit(slot.face), lit(slot.back)]) {
        if (m instanceof MeshPhysicalMaterial) { m.clearcoat = detail ? 0.2 : 0; m.clearcoatRoughness = 0.5; }
      }
      if (woodMat instanceof MeshStandardMaterial) woodMat.roughness = detail ? 0.42 : 0.55;
      applyEnvironment();
    }
  }
  if (waterSegs !== b.water) {
    waterSegs = b.water;
    const old = water.geometry;
    water.geometry = waterGeoFor(b.water);
    old.dispose();
  }
  applyLights();
  motes.count = Math.min(motes.n, b.motes);
  motes.points.geometry.setDrawRange(0, motes.count);
  confettiCap = b.confetti;
}
function applyMotion(): void {
  waterAnimated = (look?.water ?? "animated") !== "static" && !reducedMotion;
  motes.points.visible = (look?.particles ?? "high") === "high" && !reducedMotion;
}
export function setReducedMotion(b: boolean): void {
  if (reducedMotion === b) return;
  reducedMotion = b;
  applyMotion();
  if (reducedMotion) { shakeAmp = 0; pushVel = 0; confetti.clear(); }
}

/* ---------------------------- snapshot -> scene ------------------------ */
function tweenSeatAmount(seat: SeatRig, key: "chips" | "bet", to: number, dur: number): void {
  const tkey = key === "chips" ? "chipTween" : "betTween";
  tweens.kill(seat[tkey]);
  seat[tkey] = null;
  const from = seat.vis[key];
  if (from === to || dur <= 0) { seat.vis[key] = to; return; }
  seat[tkey] = tweens.add(dur, (k) => { seat.vis[key] = from + (to - from) * k; layoutChips(); });
}
function tweenPot(to: number, dur: number): void {
  tweens.kill(potTween);
  potTween = null;
  const from = visPot;
  if (from === to || dur <= 0) { visPot = to; return; }
  potTween = tweens.add(dur, (k) => { visPot = from + (to - from) * k; layoutChips(); });
}

/** render.js showSnapshot: diffs against the last rendered state and tweens only what changed. */
export function showSnapshot(snap: Snapshot, viewer = 0): void {
  if (!snap || !Array.isArray(snap.players)) return;
  const vs = ((viewer % SEAT.COUNT) + SEAT.COUNT) % SEAT.COUNT;
  const ring = vs + ":" + snap.players.length;
  if (viewerSeat !== ring) { viewerSeat = ring; placeSeats(vs, snap.players.length); }
  const first = model === null;
  const dur = reducedMotion ? 0.1 : 0.35;
  const phase = snap.phase;
  const betting = phase === "preflop" || phase === "flop" || phase === "turn" || phase === "river";
  playersById.clear();
  const present = new Set<number>();
  for (const p of snap.players) {
    playersById.set(p.id, p);
    const si = p.seat | 0;
    if (si < 0 || si >= SEAT.COUNT) continue;
    present.add(si);
    const seat = seats[si]!;
    seat.present = true;
    const out = p.status === "out";
    const chips = out ? 0 : Math.max(0, p.chips | 0);
    const bet = out ? 0 : Math.max(0, p.bet | 0);
    tweenSeatAmount(seat, "chips", chips, first ? 0 : dur);
    tweenSeatAmount(seat, "bet", bet, first ? 0 : dur);
    const inHand = !out && phase !== "init" && (p.status === "active" || p.status === "allin" || p.status === "folded");
    const revealed = inHand && Array.isArray(p.cards);
    const newKey = !inHand ? "N" : revealed ? "F" + p.cards!.join(",") : "B";
    const prevKey = seat.cardKey || "N";
    const folded = p.status === "folded";
    if (first || newKey !== prevKey) {
      const deal = !first && prevKey === "N" && newKey !== "N";
      for (let c = 0; c < 2; c++) {
        const slot = seat.cards[c]!;
        const mode = !inHand ? "none" : revealed ? "face" : "back";
        slot.pivot.position.x = slot.homePos.x;
        slot.pivot.position.z = slot.homePos.z;
        lit(slot.face).color.set(0xffffff);
        lit(slot.back).color.set(0xffffff);
        setCard(slot, mode, revealed ? p.cards![c]! : -1, !first && !deal, c * 0.1);
        if (deal) {
          const from = slot.dealPos.clone(), home = slot.homePos.clone();
          slot.pivot.position.copy(from);
          tweens.add(reducedMotion ? 0.08 : 0.38, (k) => {
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
        lit(slot.face).color.set(tint);
        lit(slot.back).color.set(tint);
        if (zFrom !== zTo) tweens.add(reducedMotion ? 0.1 : 0.3, (k) => { slot.pivot.position.z = zFrom + (zTo - zFrom) * k; });
      }
    }
    setNameplate(seat, String(p.name || "?"), chips);
    seat.nameSprite.material.opacity = out ? 0.3 : folded ? 0.55 : 1;
  }
  for (let i = 0; i < SEAT.COUNT; i++) {
    if (present.has(i)) continue;
    const seat = seats[i]!;
    seat.present = false;
    seat.cardKey = "N"; seat.folded = false;
    for (const slot of seat.cards) setCard(slot, "none", -1, false);
    tweenSeatAmount(seat, "chips", 0, 0);
    tweenSeatAmount(seat, "bet", 0, 0);
    seat.nameSprite.material.map = labelTexture("");
    seat.nameSprite.visible = false;
    seat.nameKey = "";
  }
  const comm = Array.isArray(snap.community) ? snap.community : [];
  const commKey = comm.join(",");
  if (first || commKey !== communityKey) {
    const oldLen = communityKey ? communityKey.split(",").filter((s) => s !== "").length : 0;
    for (let i = 0; i < 5; i++) {
      if (i < comm.length) setCard(community[i]!, "face", comm[i]!, i >= oldLen, (i - Math.max(0, oldLen)) * 0.12);
      else setCard(community[i]!, "none", -1, false);
    }
    communityKey = commKey;
  }
  let pot = 0;
  if (Array.isArray(snap.pots) && snap.pots.length) for (const x of snap.pots) pot += x.amount | 0;
  else for (const p of snap.players) pot += (p.totalBet | 0) - (p.bet | 0);
  pot = Math.max(0, pot);
  tweenPot(pot, first ? 0 : dur);
  if (pot === 0) potOffset.set(0, 0, 0);
  const d = snap.dealer;
  if (typeof d === "number" && present.has(d) && phase !== "init") {
    v1.set(-0.48, TABLE.FELT_Y + 0.02, 0.8);
    seats[d]!.root.localToWorld(v1);
    if (first || !dealerButton.visible) { dealerButton.position.copy(v1); dealerButton.visible = true; }
    else {
      const from = dealerButton.position.clone(), to = v1.clone();
      tweens.add(dur, (k) => { dealerButton.position.copy(from).lerp(to, k); });
    }
  } else dealerButton.visible = false;
  const actor = typeof snap.currentActor === "number" ? snap.currentActor : -1;
  const acting = betting && actor >= 0 && actor < SEAT.COUNT && present.has(actor);
  actorRing.visible = acting;
  actorGlow.visible = acting;
  if (acting) {
    const s = seats[actor]!;
    actorRing.position.copy(s.ringWorld);
    v1.set(0, 0.40, -0.45);
    s.root.localToWorld(v1);
    actorGlow.position.copy(v1);
    actorGlow.material.opacity = reducedMotion ? 0.35 : 0.5;
  }
  if (phase === "terminal") pushGoal = reducedMotion ? 0 : 1;
  else if (phase === "init" || phase === "preflop") pushGoal = 0;
  layoutChips();
  model = { tick: snap.tick };
}

/* -------------------------------- events ------------------------------- */
let winTween: Tween | null = null;
function flashWinRing(pos: Vector3): void {
  winRing.position.copy(pos);
  winRing.visible = true;
  tweens.kill(winTween);
  winTween = tweens.add(reducedMotion ? 0.3 : 0.9, (k) => {
    (winRing.material as MeshBasicMaterial).opacity = 0.85 * (1 - k);
    const s = 1 + k * 0.6;
    winRing.scale.set(s, 1, s);
  }, { ease: easeOutCubic, onDone: () => { winRing.visible = false; } });
}
/** render.js playEvents: input ack < legal move (card slide, chip push) < showdown/award (pot slide, win glow, spray) < terminal (push-in). */
export function playEvents(events: GameEvent[], fast = false): void {
  if (!fast) {
    for (const ev of events) {
      switch (ev.type) {
        case "post": {
          const p = playersById.get(ev.playerId ?? "");
          const s = p ? seats[p.seat | 0] : null;
          if (s && s.present) chipFly(s.stackWorld, s.betWorld);
          break;
        }
        case "action": {
          const p = playersById.get(ev.playerId ?? "");
          const s = p ? seats[p.seat | 0] : null;
          if (!s || !s.present) break;
          if (ev.action === "bet" || ev.action === "raise" || ev.action === "call" || ev.action === "allin") chipFly(s.stackWorld, s.betWorld);
          else if (ev.action === "check") {
            tweens.add(0.18, (k) => { const sc = 1 + Math.sin(k * PI) * 0.03; s.root.scale.set(sc, 1, sc); }, { onDone: () => s.root.scale.set(1, 1, 1) });
          }
          break;
        }
        case "deal":
          if (!reducedMotion) tweens.add(0.3, (k) => { const sc = 1 + Math.sin(k * PI) * 0.04; communityGroup.scale.set(sc, 1, sc); }, { onDone: () => communityGroup.scale.set(1, 1, 1) });
          break;
        case "street":
          tweens.add(reducedMotion ? 0.12 : 0.3, (k) => { const sc = 1 + Math.sin(k * PI) * 0.05; communityGroup.scale.set(sc, 1, sc); }, { onDone: () => communityGroup.scale.set(1, 1, 1) });
          break;
        case "showdown":
          v3.set(0, TABLE.FELT_Y + 0.03, CARD.COMMUNITY_Z);
          flashWinRing(v3);
          break;
        case "award": {
          const pots = Array.isArray(ev.pots) ? ev.pots : [];
          const winnerId = pots.length && pots[0]!.winners && pots[0]!.winners.length ? pots[0]!.winners[0]! : null;
          const wp = winnerId != null ? playersById.get(winnerId) : null;
          const s = wp ? seats[wp.seat | 0] : null;
          if (s && s.present) {
            const from = potOffset.clone();
            const to = new Vector3(s.betWorld.x - POT_POS[0], 0, s.betWorld.z - POT_POS[2]);
            tweens.add(reducedMotion ? 0.15 : 0.6, (k) => { potOffset.copy(from).lerp(to, k); layoutChips(); }, { ease: easeInOut });
            flashWinRing(s.ringWorld);
            if (!reducedMotion) {
              confetti.burst(s.betWorld, particlesHigh ? 120 : 40, [palette.accent!, "#f7e9c4", "#ffffff"]);
              shakeAmp = FRAMING.SHAKE_AMP;
            }
          }
          break;
        }
        case "terminal": if (!reducedMotion) pushGoal = 1; break;
        case "handStart": pushGoal = 0; potOffset.set(0, 0, 0); break;
        default: break;
      }
    }
  } else {
    for (const ev of events) if (ev.type === "terminal" && !reducedMotion) pushGoal = 1;
    tweens.finishAll();
    confetti.clear();
    push = pushGoal;
    pushVel = 0;
    shakeAmp = 0;
    potOffset.set(0, 0, 0);
    winRing.visible = false;
    communityGroup.scale.set(1, 1, 1);
    layoutChips();
  }
}

/* ------------------------------ frame loop ----------------------------- */
let size = { w: 0, h: 0 };
/** Each frame: the window size (camera aspect, portrait pull-back), tweens, river, fireflies, flicker, the camera spring. */
export function update(dt: number, w: number, h: number): void {
  dt = Math.min(dt, 0.1);
  if (w > 0 && h > 0 && (w !== size.w || h !== size.h)) {
    size = { w, h };
    const aspect = w / Math.max(1, h);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    // portrait fit: pull the authored shot back so the table stays framed
    camDist = aspect >= 1.15 ? 1 : Math.min(2.1, 1.15 / Math.max(aspect, 0.3));
  }
  time += dt;
  tweens.update(dt);
  const rm = reducedMotion;
  if (waterAnimated) waterUniforms.uTime.value += dt;
  updateMotes(time);
  if (actorRing.visible) { const s = rm ? 1 : 1 + 0.07 * Math.sin(time * 5.0); actorRing.scale.set(s, 1, s); }
  const flick = rm ? 0 : Math.sin(time * 7.3) * 0.12 + Math.sin(time * 13.1) * 0.06;
  lanternGlobeMat.emissiveIntensity = 2.4 + flick * 1.5;
  lanternHalos.forEach((hl, i) => { const s = 0.9 + (rm ? 0 : Math.sin(time * 5.1 + i * 1.7) * 0.05); hl.scale.set(s, s, 1); });
  const omega = 3.0;
  const acc = (pushGoal - push) * omega * omega - 2 * omega * pushVel;
  pushVel += acc * dt;
  push += pushVel * dt;
  shakeAmp *= Math.exp(-5 * dt);
  const v = v1.copy(camPos).lerp(pushPos, push);
  if (camDist !== 1) v.sub(camTarget).multiplyScalar(camDist).add(camTarget);
  if (!rm) {
    v.x += Math.sin(time * FRAMING.DRIFT_SPEED * PI * 2) * FRAMING.DRIFT_POS_AMP;
    v.y += Math.sin(time * FRAMING.DRIFT_SPEED * 2.7 * PI + 1.3) * FRAMING.DRIFT_POS_AMP * 0.6;
    if (shakeAmp > 0.0005) { v.x += Math.sin(time * 47.0) * shakeAmp; v.y += Math.sin(time * 39.0) * shakeAmp; }
  }
  camera.position.copy(v);
  v2.copy(camTarget).lerp(camPushTarget, push);
  camera.lookAt(v2);
  confetti.update(dt);
  renderer.toneMappingExposure = exposure;
}
/** Whether the salon draws (hidden only while the runtime covers the window). */
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }
/** A new table: the next snapshot is the first (no tweens from the last table's state). */
export function resetTable(): void { model = null; viewerSeat = ""; communityKey = ""; tweens.finishAll(); confetti.clear(); }
