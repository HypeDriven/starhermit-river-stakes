// Localization coverage for the engine client: every English key native/*.ts
// shows (T('…'), N('…')), plus the content it translates (Journey stages,
// lessons and their steps and hints, challenges, achievements, themes, goal
// details, hand names), is translated in every full locale (en-GB → en-US,
// es-ES → es-419, fr-CA → fr-FR inherit); placeholders survive; no table row
// is unused; js/lang.js picks locales and falls back like the browser build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadTables, codeKeys, audit, LOCALES } from './i18n-common.mjs';
import { JOURNEY, TUTORIAL, CHALLENGES, ACHIEVEMENTS, THEMES } from '../js/content.js';
import { HAND_NAMES } from '../js/rules/evaluator.js';
import { T, setLang, pickLocale } from '../js/lang.js';
import { shText } from '../js/sh-i18n.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

export function usedKeys() {
  const keys = new Set();
  for (const f of readdirSync(new URL('native/', ROOT)).filter((n) => n.endsWith('.ts'))) codeKeys(read(`native/${f}`)).forEach((k) => keys.add(k));
  codeKeys(read('js/content.js'), ['D']).forEach((k) => keys.add(k));
  for (const s of JOURNEY) { keys.add(s.title); keys.add(s.desc); }
  for (const l of TUTORIAL) { keys.add(l.title); keys.add(l.body); keys.add(l.goal); for (const st of l.steps) keys.add(st.text); }
  for (const c of CHALLENGES) { keys.add(c.title); keys.add(c.desc); }
  for (const a of ACHIEVEMENTS) { keys.add(a.name); keys.add(a.desc); }
  for (const t of THEMES) keys.add(t.name);
  for (const h of HAND_NAMES) keys.add(h);
  return [...keys].filter((k) => /[A-Za-z]/.test(k)).sort();
}

test('every used key is translated in every locale; placeholders intact; no unused rows', () => {
  const used = usedKeys();
  assert.ok(used.length > 400, 'keys found: ' + used.length);
  assert.deepEqual(audit(loadTables(ROOT, 'js/strings.js', 'RV_STRINGS'), used), []);
});

test('the language follows the runtime tag with the regional fallbacks', () => {
  assert.equal(pickLocale('de'), 'de-DE');
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('ja-JP'), 'en-US');
  setLang('de-DE');
  assert.equal(T('Paused'), 'Pausiert');
  setLang('fr-CA');
  assert.equal(T('Shortcuts'), 'Raccourcis clavier');
  assert.equal(T('Paused'), 'En pause'); // inherited from fr-FR
  setLang('en-GB');
  assert.equal(T('Color palette'), 'Colour palette');
  setLang('it-IT');
  assert.equal(shText('signIn'), 'Accedi con StarHermit');
  setLang('en-US');
  assert.equal(shText('signIn'), 'Sign in with StarHermit');
  for (const l of LOCALES) assert.equal(pickLocale(l), l);
});
