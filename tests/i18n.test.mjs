// Localization coverage for the engine client: every English key native/*.ts
// shows (T('…'), N('…')), plus the content it translates (Journey stages,
// lessons and their steps and hints, challenges, achievements, themes, goal
// details, hand names), is translated in every full locale (en-GB → en-US,
// es-ES → es-419, fr-CA → fr-FR inherit); placeholders survive; no table row
// is unused. Locale chains and the account strings are the engine's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { codeKeys, audit } from './i18n-common.mjs';
import { JOURNEY, TUTORIAL, CHALLENGES, ACHIEVEMENTS, THEMES } from '../js/content.js';
import { HAND_NAMES } from '../js/rules/evaluator.js';

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
  assert.deepEqual(audit(JSON.parse(read('assets/strings.json')), used), []);
});
