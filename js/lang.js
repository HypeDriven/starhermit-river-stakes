// River Stakes: the game modules' T(). The engine client installs the engine's
// strings (native/i18n.ts); node tests get the English keys.
const hasOwn = Object.prototype.hasOwnProperty;
let translate = null;
/** The engine client's lookup. */
export function setTranslator(fn) { translate = fn; }

/** Translate an English source string; {name} placeholders are filled from vars. */
export function T(key, vars) {
  if (translate) return translate(String(key), vars);
  const s = String(key);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (hasOwn.call(vars, k) ? String(vars[k]) : m)) : s;
}

/** Marks an English key for a later T() (content tables). */
export const N = (key) => key;
