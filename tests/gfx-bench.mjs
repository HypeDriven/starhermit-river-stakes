// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// takes a seat at a full six-seat Practice table and keeps playing through the visible action tray (check /
// call, never fold), so cards deal and flip, chips slide to the pot, win sprays fire, the river shimmers
// and the camera drifts the whole time; a finished match is retried from the results screen (no reloads).
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const title = (page) => page.waitForSelector('.screen-title .title-logo', { timeout: 20000 });

export async function setPreset(page, preset) {
  await title(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#gfx-settings #gfx-preset', { timeout: 8000 });
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.getElementById('gl')?.dataset.gfxPreset === p, preset);
  await page.getByRole('button', { name: /Back/ }).click();
  await title(page);
}

async function sit(page) {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForSelector('.screen-modes .mode-grid', { timeout: 8000 });
  const card = page.locator('.mode-card', { hasText: 'Practice' });
  await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await card.locator('button').click();
  await page.waitForSelector('.screen-setup', { timeout: 8000 });
  await page.selectOption('#setup-seats', '6');
  await page.getByRole('button', { name: 'Take your seat', exact: true }).click();
  await page.waitForSelector('.hud-wrap', { timeout: 8000 });
}

async function step(page) {
  // No reloads while measuring: Retry on the results screen, Take your seat on the setup screen.
  if (await page.locator('.screen-results').count()) return page.locator('.screen-results .results-actions .btn-primary').first().click({ timeout: 2000 });
  if (await page.locator('.screen-setup').count()) return page.getByRole('button', { name: 'Take your seat', exact: true }).click({ timeout: 2000 });
  for (const type of ['check', 'call', 'advance', 'allin']) {
    const btn = page.locator(`.tray-buttons .action-btn.action-${type}`);
    if (await btn.count()) { await btn.first().click({ timeout: 2000 }); return; }
  }
}

export async function start(page) {
  await sit(page);
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await step(page); } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(400).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
