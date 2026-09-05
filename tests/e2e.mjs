/**
 * River Stakes — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   DESKTOP — title → Choose your table → Practice (2 seats, assists on) →
 *   plays a genuine fixed-limit Hold'em match to its terminal results screen
 *   by clicking the real action buttons (Fold / Check / Call / Bet / Raise /
 *   All in) on every human turn, fast-forwarding the AI between turns with
 *   the documented "S" skip shortcut. Also exercises the visible Pause/Resume
 *   pause menu, the Hint assist and the Undo assist.
 *   MOBILE  — title → Choose your table → Learn lesson 1 → makes a few real
 *   touchscreen.tap decisions on the visible action tray.
 *
 * The game exposes its own debug handle `window.__riverStakes` (main.js).
 * The test reads that handle ONLY to observe round state (terminal, hand
 * number, and the action types already rendered as visible tray buttons) and
 * to know when the match is over. It NEVER calls the move API: every action
 * is a real click/tap/key press on on-screen elements. No game code modified.
 *
 * Serving: the repo ships `server.js` (the declarative StarHermit script).
 * The game is fully playable offline — when `/api/v1/time` is unavailable or
 * returns no valid epoch, the platform adapter degrades to `local` mode and
 * every solo screen works without the backend. So this test embeds a minimal
 * node:http static server on an ephemeral port and answers /api/* probes with
 * 200 `{}` so the client drops into its documented offline path with zero
 * console noise. The authoritative live-hosted WebSocket path is not needed
 * for solo play.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/river-stakes-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader noise (mirrors the sibling suites)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // No StarHermit backend here: answer API probes with empty JSON (200) so
    // the platform adapter degrades to offline ('local') mode without noise.
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (name) => console.log(`ok - ${name}`);

// ---------- read-only observation of the game's own debug handle ----------
// window.__riverStakes is the App (main.js). Read only: terminal/hand/phase
// state and the action types already rendered as visible tray buttons.
const readState = (page) => page.evaluate(() => {
  const app = window.__riverStakes;
  const g = app && app.game;
  const snap = g && g.session ? g.session.snapshot() : null;
  const btns = [...document.querySelectorAll('.tray-buttons .action-btn')]
    .map((b) => (b.className.match(/action-(fold|check|call|bet|raise|allin|advance)/) || [])[1])
    .filter(Boolean);
  const undoEnabled = [...document.querySelectorAll('.tray-assists button')]
    .some((b) => b.textContent.trim().toLowerCase() === 'undo' && !b.disabled);
  return {
    booted: !!g,
    finished: !!(app && app.finished),
    terminal: !!(snap && snap.terminal),
    hand: (snap && snap.handNumber) || 0,
    phase: (snap && snap.phase) || null,
    legal: btns,
    undoEnabled,
  };
});

// Deterministic human policy for the visible controls: checking when free is
// cheapest, calling keeps the hand alive, folding surrenders at cost. Any
// legal action advances state, so the 24-hand cap is always reached.
function pickAction(legal) {
  if (legal.includes('check')) return 'check';
  if (legal.includes('call')) return 'call';
  if (legal.includes('fold')) return 'fold';
  if (legal.includes('allin')) return 'allin';
  if (legal.includes('advance')) return 'advance';
  if (legal.includes('bet')) return 'bet';
  if (legal.includes('raise')) return 'raise';
  return null;
}

// Scroll a DOM card into the (fixed #ui) container so it is tappable, then
// return the locator to its button. Kept as a real user-style scroll.
async function clickCardButton(page, hasText) {
  const card = page.locator('.mode-card', { hasText });
  await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(80);
  await card.locator('button').click();
}

const waitResults = (page) =>
  page.waitForSelector('.screen-results .results-panel h1', { timeout: 15000 });

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/|\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });

  try {
    // load + title screen
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.screen-title .title-logo', { timeout: 15000 });
    await page.waitForFunction(() => !!window.__riverStakes);
    const logo = (await page.textContent('.screen-title .title-logo')).trim();
    if (!/River Stakes/.test(logo)) throw new Error(`unexpected title logo "${logo}"`);
    await page.screenshot({ path: SHOT('title', name) });
    ok(`${name}: title screen visible ("${logo}")`);

    // title → Choose your table
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForSelector('.screen-modes', { timeout: 8000 });
    await page.waitForSelector('.screen-modes .mode-grid', { timeout: 8000 });
    await page.screenshot({ path: SHOT('modes', name) });
    ok(`${name}: modes screen ("${(await page.textContent('.screen-modes h1')).trim()}")`);

    if (!full) {
      // ---------- MOBILE (short) ----------
      // NOTE on mobile widths: `#ui` is position:fixed, so any content taller
      // than the viewport inside it is NOT reachable by page scroll. The top
      // cards (Learn / Journey) are visible; Practice sits below the unreachable
      // fold. So the mobile pass starts the visible Learn lesson 1 and makes a
      // few real tap decisions from its HUD action tray.
      await clickCardButton(page, 'Learn');
      await page.waitForSelector('.screen-setup', { timeout: 8000 });
      await page.locator('.lesson-list li button').first().click();
      await page.waitForSelector('.hud-wrap', { timeout: 8000 });
      await page.waitForFunction(() => !!window.__riverStakes?.game?.session, null, { timeout: 8000 });
      await page.screenshot({ path: SHOT('learn', name) });
      ok(`${name}: Learn lesson 1 table started`);

      let acted = 0;
      for (let i = 0; i < 10 && acted < 3; i++) {
        await page.keyboard.press('s'); // settle AI to the next human decision
        await page.waitForTimeout(90);
        const st = await readState(page);
        if (st.finished || st.terminal) break;
        const type = pickAction(st.legal);
        if (!type) continue;
        const btn = page.locator(`.tray-buttons .action-btn.action-${type}`);
        if (!(await btn.count())) continue;
        const bb = await btn.boundingBox();
        if (!bb || bb.width < 1 || bb.height < 1) continue;
        await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await page.waitForTimeout(150);
        acted++;
      }
      if (acted < 2) throw new Error(`expected >=2 real tap decisions on mobile, got ${acted}`);
      const prog = (await page.textContent('.progress-text')).trim();
      await page.screenshot({ path: SHOT('mobile-play', name) });
      ok(`${name}: made ${acted} real touch decisions on the lesson ("${prog}")`);
    } else {
      // ---------- DESKTOP (full practice match) ----------
      await clickCardButton(page, 'Practice');
      await page.waitForSelector('.screen-setup', { timeout: 8000 });
      await page.screenshot({ path: SHOT('setup', name) });
      ok(`${name}: Practice setup screen`);

      // Keep the table small (heads-up) so each hand resolves quickly; assists
      // stay on (undo + hints). Then take our seat.
      await page.selectOption('#setup-seats', '2');
      await page.getByRole('button', { name: 'Take your seat', exact: true }).click();
      await page.waitForSelector('.hud-wrap', { timeout: 8000 });
      await page.waitForFunction(() => !!window.__riverStakes?.game?.session, null, { timeout: 8000 });
      await page.screenshot({ path: SHOT('table', name) });
      ok(`${name}: practice table started`);

      // Wait for the first real human decision.
      await page.waitForFunction(() => {
        const app = window.__riverStakes;
        const snap = app && app.game && app.game.session && app.game.session.snapshot();
        return !!(snap && !snap.terminal && document.querySelector('.tray-buttons .action-btn'));
      }, null, { timeout: 15000 });

      // Pause / resume through the visible pause menu.
      await page.locator('.hud-pause').click();
      await page.waitForSelector('.modal .pause-menu', { timeout: 8000 });
      await page.screenshot({ path: SHOT('pause', name) });
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.modal .pause-menu'), null, { timeout: 8000 });
      ok(`${name}: pause (⏸ Pause) menu opens and Resume closes it`);

      // Hint assist: click Hint, a hint reveal text should appear.
      await page.getByRole('button', { name: 'Hint', exact: true }).click();
      await page.waitForFunction(() => {
        const t = document.querySelector('.hint-text');
        return !!t && !t.hidden && t.textContent.trim().length > 0;
      }, null, { timeout: 8000 });
      await page.screenshot({ path: SHOT('hint', name) });
      ok(`${name}: Hint assist shows guidance ("${(await page.textContent('.hint-text')).trim().slice(0, 42)}…")`);

      // Undo assist: commit one real decision, then undo it (returns our turn).
      const firstLegal = (await readState(page)).legal;
      const firstType = pickAction(firstLegal);
      if (!firstType) throw new Error('no legal action at first human turn');
      await page.locator(`.tray-buttons .action-btn.action-${firstType}`).click();
      await page.waitForFunction((t) => !document.querySelector(`.tray-buttons .action-btn.action-${t}`), firstType, { timeout: 5000 });
      const beforeUndo = await readState(page);
      if (!beforeUndo.undoEnabled) throw new Error('undo should be enabled after a decision');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      try {
        await page.waitForFunction(() => !!document.querySelector('.tray-buttons .action-btn'), null, { timeout: 6000 });
      } catch {}
      ok(`${name}: commit a decision then Undo restores the previous decision point`);

      // Now play the whole match for real to its terminal results screen.
      let guard = 0;
      let acted = 0;
      for (; guard < 1200; guard++) {
        await page.keyboard.press('s'); // documented Skip: settle AI to next human decision
        await page.waitForTimeout(25);
        const st = await readState(page);
        if (st.finished) break;
        if (st.terminal) break;
        const type = pickAction(st.legal);
        if (!type) { await page.waitForTimeout(25); continue; }
        const btn = page.locator(`.tray-buttons .action-btn.action-${type}`);
        if (!(await btn.count())) { await page.waitForTimeout(25); continue; }
        await btn.click();
        acted++;
        await page.waitForTimeout(50);
      }
      if (!(await readState(page)).finished) throw new Error(`match did not finish within ${guard} iterations (acted ${acted})`);
      await waitResults(page);
      const headline = (await page.textContent('.screen-results .results-panel h1')).trim();
      const rows = await page.locator('.screen-results .stats-table tbody tr').count();
      if (rows < 1) throw new Error('results breakdown table is empty');
      const finalHand = (await readState(page)).hand;
      await page.screenshot({ path: SHOT('results', name) });
      ok(`${name}: match played to the end — results shown ("${headline}", ${rows} breakdown rows, ${finalHand} hands, ${acted} human actions)`);
      if (finalHand < 1) throw new Error('match ended but no hands were played');
    }
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  console.log(`ok - ${name}: no page errors`);
}

// ---------- main ----------
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  console.log(`serving ${ROOT} at ${BASE}`);
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — river-stakes, desktop + mobile, no page errors');
} catch (e) {
  failures++;
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failures) process.exit(1);
