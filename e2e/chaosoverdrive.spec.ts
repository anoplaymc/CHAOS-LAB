import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const ID = 'chaos_overdrive';

// The mod is published from its own repository, so a checkout of the game may not have it.
test.skip(!existsSync(`mods/${ID}/mod.json`), 'CHAOS OVERDRIVE is not in this checkout');

async function boot(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/?automation');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60000 });
  await page.evaluate(() => window.__chaos!.applySettings({ shadows: false, bloom: false, antialias: false, renderScale: 0.5, quality: 'low' }));
  return problems;
}

const modErrors = (page: Page) => page.evaluate(() => window.__chaos!.mods.logs.filter((l) => l.level === 'error').map((l) => `${l.mod}: ${l.text}`));
const speedScale = (page: Page) => page.evaluate(() => window.__chaos!.player.speedScale);

/** A value set on a range input the way a person's drag would: through its own change event. */
async function slide(page: Page, id: string, value: number): Promise<void> {
  await page.getByTestId(`mf-${id}`).fill(String(value));
}

test('it is off by default, and the game works as usual with F6 doing nothing', async ({ page }) => {
  const problems = await boot(page);
  await page.getByTestId('menu-mods').click();
  await expect(page.getByTestId(`mod-state-${ID}`)).toHaveText('Disabled');
  await page.getByTestId('mods-back').click();
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.keyboard.press('F6');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('mod-form')).toHaveCount(0);
  expect(await page.evaluate((id) => window.__chaos!.sandbox.keysOf(id).length, ID)).toBe(0);
  expect(problems).toEqual([]);
});

test('the full cycle through the real UI: enable, use the menu with real input, disable, and everything is back', async ({ page }) => {
  const problems = await boot(page);

  // Enabled through the Mod Manager, as a player would.
  await page.getByTestId('menu-mods').click();
  await page.getByTestId(`mod-toggle-${ID}`).check();
  await expect(page.getByTestId(`mod-state-${ID}`)).toHaveText('Running');
  await page.getByTestId('mods-back').click();
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();

  // Real key press opens it, and gameplay input stops.
  await page.keyboard.press('F6');
  await expect(page.getByTestId('mod-form')).toBeVisible();
  await expect(page.getByTestId('mf-title')).toHaveText('CHAOS OVERDRIVE');
  await expect(page.getByTestId('mf-subtitle')).toContainText('v1.0.0');
  expect(await page.evaluate(() => window.__chaos!.input.enabled)).toBe(false);

  // Every category opens.
  for (const c of ['player', 'movement', 'physics', 'npc', 'weapons', 'vehicles', 'world', 'spawning', 'visuals', 'time', 'teleport', 'chaos', 'tools', 'profiles']) {
    await page.getByTestId(`mf-nav-${c}`).click();
    await expect(page.getByTestId(`mf-nav-${c}`)).toHaveClass(/on/);
    await expect(page.getByTestId('mf-main').locator('section').first()).toBeVisible();
  }

  // A toggle, by mouse, changes the game and shows as active.
  await page.getByTestId('mf-nav-player').click();
  await page.locator('.mf-toggle', { has: page.getByTestId('mf-god') }).click();
  await expect(page.getByTestId('mf-god')).toBeChecked();
  expect(await page.evaluate(() => window.__chaos!.player.god)).toBe(true);
  await expect(page.getByTestId('mf-chip-god')).toBeVisible();
  await expect(page.getByTestId('mf-nav-player').locator('em')).toHaveText('1');

  // A slider.
  await page.getByTestId('mf-nav-movement').click();
  await slide(page, 'speed', 3);
  await expect.poll(() => speedScale(page)).toBe(3);

  // Reset one thing from its own button.
  await page.getByTestId('mf-reset-speed').click();
  await expect.poll(() => speedScale(page)).toBe(1);

  // Search, typed for real, keeps its focus while the panel redraws around it.
  await page.getByTestId('mf-search').click();
  await page.keyboard.type('clip', { delay: 30 });
  await expect(page.getByTestId('mf-noclip')).toBeAttached();
  await expect(page.getByTestId('mf-god')).toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(page.getByTestId('mf-search')).toBeFocused();
  await expect(page.getByTestId('mf-search')).toHaveValue('clip');

  // A select, then spawning from the real list, confirmation included.
  await page.getByTestId('mf-nav-spawning').click();
  await page.getByTestId('mf-spawn_group').selectOption('props');
  await page.getByTestId('mf-spawn_query').fill('small');
  await page.getByTestId('mf-spawn_pick|crate_small').click();
  await expect(page.getByTestId('mf-main')).toContainText('Small Crate');
  await page.getByTestId('mf-spawn_where').selectOption('front');
  await slide(page, 'spawn_count', 12);
  await page.getByTestId('mf-spawn_go').click();
  await expect(page.getByTestId('mf-confirm')).toContainText('12');
  await page.getByTestId('mf-confirm-no').click();
  await expect(page.getByTestId('mf-confirm')).toHaveCount(0);
  await slide(page, 'spawn_count', 2);
  await page.getByTestId('mf-spawn_go').click();
  await expect.poll(() => page.evaluate(() => window.__chaos!.entities.active.filter((e) => window.__chaos!.sandbox.isTracked(e.id)).length), { timeout: 20000 }).toBe(2);

  // Choosing a new key, with a real key press, and the new key works.
  await page.getByTestId('mf-nav-profiles').click();
  await page.getByTestId('mf-key_menu').click();
  await expect(page.getByTestId('mf-key_menu')).toContainText('Press a key');
  await page.keyboard.press('F9');
  await expect(page.getByTestId('mf-key_menu')).toHaveText('F9');
  await page.keyboard.press('F9');
  await expect(page.getByTestId('mod-form')).toHaveCount(0);
  expect(await page.evaluate(() => window.__chaos!.input.enabled)).toBe(true);
  await page.keyboard.press('F9');
  await expect(page.getByTestId('mod-form')).toBeVisible();
  // Esc closes it too, with no pause menu behind it.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mod-form')).toHaveCount(0);
  expect(await page.evaluate(() => window.__chaos!.ui.get().paused)).toBe(false);
  await page.keyboard.press('F9');
  await expect(page.getByTestId('mod-form')).toBeVisible();
  await page.getByTestId('mf-key_menu').click();
  await page.keyboard.press('F6');
  await expect(page.getByTestId('mf-key_menu')).toHaveText('F6');

  // Also from the Mod Menu, which stays open.
  await page.getByTestId('mf-close').click();
  await page.keyboard.press('KeyM');
  await page.getByText('CHAOS OVERDRIVE', { exact: false }).first().click();
  await expect(page.getByTestId('mod-form')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('mod-form')).toBeVisible();

  // Fits a small window.
  await page.setViewportSize({ width: 800, height: 500 });
  const box = await page.locator('.mf-window').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(800);
  expect(box!.height).toBeLessThanOrEqual(500);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByTestId('mf-close').click();

  // A saved setting survives a real reload of the page.
  await page.keyboard.press('F6');
  await page.getByTestId('mf-nav-movement').click();
  await slide(page, 'jump', 3);
  await expect.poll(() => page.evaluate(() => window.__chaos!.player.jumpScale)).toBe(3);
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__chaos!.player.jumpScale)).toBe(3);
  expect(await page.evaluate(() => window.__chaos!.player.god)).toBe(true);

  // Disabled through the Mod Manager: everything is back, and its keys are gone.
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-mods').click();
  await page.getByTestId(`mod-toggle-${ID}`).uncheck();
  await expect(page.getByTestId(`mod-state-${ID}`)).toHaveText('Disabled');
  await page.getByTestId('mods-back').click();
  const state = await page.evaluate((id) => {
    const g = window.__chaos!;
    return { god: g.player.god, jump: g.player.jumpScale, keys: g.sandbox.keysOf(id).length, form: g.ui.get().modForm };
  }, ID);
  expect(state).toEqual({ god: false, jump: 1, keys: 0, form: null });
  await page.getByTestId('resume').click();
  await page.keyboard.press('F6');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('mod-form')).toHaveCount(0);

  expect(await modErrors(page)).toEqual([]);
  expect(problems).toEqual([]);
});
