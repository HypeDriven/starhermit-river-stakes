// River Stakes — the engine client's save model. Pure (no storage, no
// platform) so the engine client (native/platform.ts) and the node tests
// share it.
//
// The engine save (starhermit:storage `saves`, schema 1) is the document the
// browser build mirrored to the cloud slot game:<slug> through the JS SDK's
// saveJSON (js/main.js _persistCloud):
//   { v: 1, progress: { journey: { stars, unlocked }, lifetime, tutorial,
//     challenges, achievements, daily }, boards, profile: { name } }
// Two saves merge with js/merge.js (mergeProgress / mergeBoards: nothing either
// device earned is dropped), as the browser build merged on its saveconflict.
// readForeign() reads that old cloud slot's text (no checksum there).
import { mergeBoards, mergeProgress } from './merge.js';
import { stableStringify } from './rules/rng.js';
import { THEMES } from './content.js';

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const SAVE_VERSION = 1;

export function emptyLifetime() {
  return { hands: 0, handsWon: 0, showdownsWon: 0, potsWon: 0, bestHand: null, journeysCleared: 0, dailiesPlayed: 0 };
}

export function emptySave() {
  return { v: SAVE_VERSION, progress: { journey: { stars: {}, unlocked: 0 }, lifetime: emptyLifetime() }, boards: {}, profile: { name: '' } };
}

/** A save document from anything (missing or broken fields from the empty one). */
export function normalize(raw) {
  const d = obj(raw) ? JSON.parse(JSON.stringify(raw)) : {};
  const out = emptySave();
  const p = obj(d.progress) || {};
  out.progress = { ...p };
  const j = obj(p.journey) || {};
  out.progress.journey = { ...j, stars: {}, unlocked: Math.max(0, Math.floor(num(j.unlocked))) };
  for (const [k, v] of Object.entries(obj(j.stars) || {})) if (Number.isFinite(v)) out.progress.journey.stars[k] = Math.max(0, Math.min(3, Math.floor(v)));
  const lt = obj(p.lifetime) || {};
  out.progress.lifetime = { ...emptyLifetime(), ...lt };
  for (const k of ['hands', 'handsWon', 'showdownsWon', 'potsWon', 'journeysCleared', 'dailiesPlayed']) out.progress.lifetime[k] = Math.max(0, Math.floor(num(lt[k])));
  out.progress.lifetime.bestHand = typeof lt.bestHand === 'string' ? lt.bestHand : null;
  for (const k of ['tutorial', 'challenges', 'achievements']) {
    if (obj(p[k])) out.progress[k] = { ...p[k] }; else delete out.progress[k];
  }
  if (obj(p.daily)) out.progress.daily = { lastDate: typeof p.daily.lastDate === 'string' ? p.daily.lastDate : null, streak: Math.max(0, Math.floor(num(p.daily.streak))) };
  else delete out.progress.daily;
  out.boards = {};
  for (const [k, v] of Object.entries(obj(d.boards) || {})) if (Array.isArray(v)) out.boards[k] = v.filter((e) => obj(e) && Number.isFinite(e.value));
  out.profile = { name: typeof obj(d.profile)?.name === 'string' ? d.profile.name.slice(0, 24) : '' };
  return out;
}

/** Merge two saves (this device's and another device's / the old cloud slot's). */
export function mergeSave(remote, local) {
  const a = normalize(local), b = normalize(remote);
  return normalize({
    v: SAVE_VERSION,
    progress: mergeProgress(a.progress, b.progress),
    boards: mergeBoards(a.boards, b.boards),
    profile: { name: a.profile.name || b.profile.name },
  });
}

export function sameSave(a, b) {
  return stableStringify(normalize(a)) === stableStringify(normalize(b));
}

/** The browser build's cloud slot text (the saveJSON document): a save, or null when it is not one. */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const doc = JSON.parse(text);
    if (!obj(doc) || !obj(doc.progress)) return null;
    return normalize(doc);
  } catch { return null; }
}

/**
 * The game's own options (engine `settings`, synced with the account) and the
 * browser build's settings KV groups they came from (platform.js
 * SETTING_GROUPS: audio, graphics, accessibility, ui). Volumes, mute,
 * graphics quality, reduced motion, high contrast, text size and the language
 * are the runtime's Options now; the theme, the card palette, the left-handed
 * tray, the hint button's behaviour and the shortcut bar stay the game's.
 */
export const DEFAULT_OPTIONS = { theme: 'emberdusk', palette: 'default', leftHanded: false, hintMode: 'toggle', shortcutHints: true };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
export const BROWSER_KEYS = ['audio', 'graphics', 'accessibility', 'ui'];
export const PALETTES = ['default', 'deuteranopia', 'tritanopia'];
export const HINT_MODES = ['toggle', 'hold'];

/** Valid option values from anything. */
export function pickOptions(raw) {
  const r = obj(raw) || {};
  const out = {};
  if (THEMES.some((t) => t.id === r.theme)) out.theme = r.theme;
  if (PALETTES.includes(r.palette)) out.palette = r.palette;
  if (typeof r.leftHanded === 'boolean') out.leftHanded = r.leftHanded;
  if (HINT_MODES.includes(r.hintMode)) out.hintMode = r.hintMode;
  if (typeof r.shortcutHints === 'boolean') out.shortcutHints = r.shortcutHints;
  return out;
}

/** The browser build's settings KV (group → value) as the game's options. */
export function readLegacySettings(kv) {
  const k = obj(kv) || {};
  const g = obj(k.graphics) || {}, a = obj(k.accessibility) || {}, u = obj(k.ui) || {};
  return pickOptions({ theme: g.theme, palette: a.palette, leftHanded: a.leftHanded, hintMode: a.hintMode, shortcutHints: u.shortcutHints });
}

/** main.js _themeUnlocked: a theme is open by default, by a cleared Journey stage, or by an achievement. */
export function themeUnlocked(theme, save) {
  if (!theme || theme.unlock === 'default') return true;
  const u = theme.unlock || {};
  const p = normalize(save).progress;
  if (u.journey != null) return (p.journey.stars['j' + String(u.journey).padStart(2, '0')] || 0) > 0;
  if (u.achievement) return !!(p.achievements || {})[u.achievement];
  return false;
}

/** main.js _updateDailyStreak: one entry per UTC day; consecutive days build the streak. Returns the new streak (0: already played). */
export function updateDailyStreak(progress, today) {
  const d = progress.daily || { lastDate: null, streak: 0 };
  if (d.lastDate === today) return 0;
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  d.streak = d.lastDate === yesterday ? d.streak + 1 : 1;
  d.lastDate = today;
  progress.daily = d;
  return d.streak;
}

/** platform.js submitScore: a personal-best entry on a local board (best 50 kept). */
export function addBoardEntry(save, boardId, entry, cap = 50) {
  const list = Array.isArray(save.boards[boardId]) ? save.boards[boardId] : [];
  list.push(entry);
  list.sort((x, y) => num(y.value) - num(x.value) || num(x.ts) - num(y.ts));
  save.boards[boardId] = list.slice(0, cap);
  // the save is one document: keep the 60 latest boards (daily:YYYY-MM-DD sorts by date)
  const ids = Object.keys(save.boards).sort();
  for (const id of ids.slice(0, Math.max(0, ids.length - 60))) delete save.boards[id];
}
