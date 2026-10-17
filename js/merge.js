// River Stakes — merging two copies of the cloud-saved doc (this device and
// another device that saved first). Nothing either side earned is dropped:
// best stars per journey stage, the furthest unlock, every finished lesson and
// challenge, every achievement (earliest unlock time), the larger lifetime
// counters and the better best hand, the most recent daily streak, and the
// union of local personal-best board entries.
import { HAND_NAMES } from './rules/evaluator.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function maxMap(a, b) {
  const out = { ...(isObj(b) ? b : {}) };
  for (const [k, v] of Object.entries(isObj(a) ? a : {})) out[k] = Math.max(num(out[k]), num(v));
  return out;
}
function orMap(a, b) {
  const out = { ...(isObj(b) ? b : {}) };
  for (const [k, v] of Object.entries(isObj(a) ? a : {})) out[k] = out[k] || v;
  return out;
}

/** Merge two progress objects; unknown keys keep the local value. */
export function mergeProgress(local, remote) {
  const a = isObj(local) ? local : {};
  const b = isObj(remote) ? remote : {};
  const out = { ...b, ...a };
  const ja = a.journey || {}, jb = b.journey || {};
  out.journey = { ...jb, ...ja, stars: maxMap(ja.stars, jb.stars), unlocked: Math.max(num(ja.unlocked), num(jb.unlocked)) };
  const la = a.lifetime || {}, lb = b.lifetime || {};
  const lifetime = { ...lb, ...la };
  for (const k of new Set([...Object.keys(la), ...Object.keys(lb)])) {
    if (k === 'bestHand') continue;
    if (typeof la[k] === 'number' || typeof lb[k] === 'number') lifetime[k] = Math.max(num(la[k]), num(lb[k]));
  }
  const rank = (h) => (h ? HAND_NAMES.indexOf(h) : -1);
  lifetime.bestHand = rank(lb.bestHand) > rank(la.bestHand) ? lb.bestHand : (la.bestHand ?? lb.bestHand ?? null);
  if (Object.keys(lifetime).length) out.lifetime = lifetime;
  out.tutorial = orMap(a.tutorial, b.tutorial);
  out.challenges = orMap(a.challenges, b.challenges);
  const achievements = { ...(isObj(b.achievements) ? b.achievements : {}) };
  for (const [k, v] of Object.entries(isObj(a.achievements) ? a.achievements : {})) {
    const times = [v, achievements[k]].filter((t) => typeof t === 'number' && t > 0);
    achievements[k] = times.length ? Math.min(...times) : (achievements[k] || v);
  }
  out.achievements = achievements;
  const da = a.daily, db = b.daily;
  if (da || db) {
    out.daily = !db ? da : !da ? db
      : (String(da.lastDate || '') > String(db.lastDate || '') ? da
        : String(db.lastDate || '') > String(da.lastDate || '') ? db
          : { ...da, streak: Math.max(num(da.streak), num(db.streak)) });
  }
  return out;
}

/** Union of local personal-best board entries (deduplicated), best first. */
export function mergeBoards(local, remote, cap = 50) {
  const out = {};
  for (const src of [remote, local]) {
    for (const [id, list] of Object.entries(isObj(src) ? src : {})) {
      if (!Array.isArray(list)) continue;
      const seen = new Set((out[id] || []).map((e) => JSON.stringify(e)));
      out[id] = [...(out[id] || []), ...list.filter((e) => !seen.has(JSON.stringify(e)))];
    }
  }
  for (const id of Object.keys(out)) out[id] = out[id].sort((x, y) => num(y.value) - num(x.value) || num(x.ts) - num(y.ts)).slice(0, cap);
  return out;
}
