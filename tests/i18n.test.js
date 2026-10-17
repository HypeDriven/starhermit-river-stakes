// Localization coverage: every English key the markup, code and UI STRINGS
// use is translated in every locale (en-GB → en-US, es-ES → es-419, fr-CA →
// fr-FR inherit), placeholders survive, all content (stages, lessons,
// challenges, achievements, themes, hand names) is covered, and the language
// follows sh-language.js and switches live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTables, codeKeys, htmlKeys, audit, bootI18n, LOCALES } from './i18n-common.mjs';
import { stringKeys } from '../js/ui.js';
import { JOURNEY, TUTORIAL, CHALLENGES, ACHIEVEMENTS, THEMES } from '../js/content.js';
import { HAND_NAMES } from '../js/rules/evaluator.js';
import { GFX_STRINGS } from '../js/gfx-strings.js';
import { shText } from '../js/sh-i18n.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

function usedKeys() {
  const keys = new Set(htmlKeys(read('index.html')));
  for (const f of ['js/main.js', 'js/ui.js', 'js/content.js', 'js/platform.js']) codeKeys(read(f), ['D']).forEach((k) => keys.add(k));
  stringKeys().forEach((k) => keys.add(k));
  for (const s of JOURNEY) { keys.add(s.title); keys.add(s.desc); }
  for (const l of TUTORIAL) { keys.add(l.title); keys.add(l.body); keys.add(l.goal); for (const st of l.steps) keys.add(st.text); }
  for (const c of CHALLENGES) { keys.add(c.title); keys.add(c.desc); }
  for (const a of ACHIEVEMENTS) { keys.add(a.name); keys.add(a.desc); }
  for (const t of THEMES) keys.add(t.name);
  for (const h of HAND_NAMES) keys.add(h);
  return [...keys].filter((k) => /[A-Za-z]/.test(k)).sort();
}

test('every used key is translated in every locale; placeholders intact', () => {
  const used = usedKeys();
  assert.ok(used.length > 450, 'keys found: ' + used.length);
  assert.deepEqual(audit(loadTables(ROOT, 'js/strings.js', 'RV_STRINGS'), used), []);
});

test('the locale follows sh-language and switches live', () => {
  const { I18N, events, doc } = bootI18n(ROOT, { strings: 'js/strings.js', i18n: 'js/i18n.js', global: 'RVI18N', languages: ['de-DE'] });
  assert.equal(I18N.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I18N.T('Paused'), 'Pausiert');
  I18N.language.setChoice('fr-CA');
  assert.equal(I18N.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  assert.equal(I18N.T('Shortcuts'), 'Raccourcis clavier');
  assert.equal(I18N.T('Paused'), 'En pause');
  I18N.language.setChoice('en-GB');
  assert.equal(I18N.T('Color palette'), 'Colour palette');
  I18N.language.setChoice('it-IT');
  assert.equal(I18N.T('Raise to {amount}', { amount: 40 }), 'Rilancia a 40');
});

test('Graphics and StarHermit strings cover all nine locales', () => {
  for (const l of LOCALES) assert.ok(GFX_STRINGS[l], l);
  assert.equal(shText('signIn'), 'Sign in with StarHermit');
});
