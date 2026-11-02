import { expect, test, type Page } from '@playwright/test';

const ALL = ['chaos_playground', 'furniture_pack', 'robot_pack', 'super_tools', 'vehicle_pack'];

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/?automation');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60000 });
  await page.evaluate(() => window.__chaos!.applySettings({ shadows: false, bloom: false, antialias: false, renderScale: 0.5, quality: 'low' }));
  return problems;
}

const modErrors = (page: Page) => page.evaluate(() => window.__chaos!.mods.logs.filter((l) => l.level === 'error').map((l) => `${l.mod}: ${l.text}`));

test('the mod manager lists the example mods, and toggling one really removes and restores its content', async ({ page }) => {
  const problems = await open(page);
  await page.getByTestId('menu-mods').click();
  await expect(page.getByTestId('mod-manager')).toBeVisible();
  for (const id of ALL) await expect(page.getByTestId(`mod-state-${id}`)).toHaveText('Running');

  await page.getByTestId('mod-more-chaos_playground').click();
  await expect(page.getByTestId('mod-chaos_playground')).toContainText('furniture_pack ^1.0.0');
  await expect(page.getByTestId('mod-chaos_playground')).toContainText('robot_pack ^1.0.0 (optional)');
  await expect(page.getByTestId('mod-chaos_playground')).toContainText('storage: Save data');

  // Turning off a dependency blocks what needs it, and says why.
  const has = (id: string) => page.evaluate((x) => window.__chaos!.mods.get('furniture_pack')?.content.items.includes(x) ?? false, id);
  expect(await has('furniture_pack:poster')).toBe(true);
  await page.getByTestId('mod-toggle-furniture_pack').uncheck();
  await expect(page.getByTestId('mod-state-furniture_pack')).toHaveText('Disabled');
  await expect(page.getByTestId('mod-state-chaos_playground')).toHaveText('Blocked');
  await expect(page.getByTestId('mod-error-chaos_playground')).toContainText('furniture_pack');
  expect(await page.evaluate(() => Object.keys(window.__chaos!.mods.get('chaos_playground')!.content.maps).length)).toBe(0);

  await page.getByTestId('mod-toggle-furniture_pack').check();
  await expect(page.getByTestId('mod-state-chaos_playground')).toHaveText('Running');

  // The choice is remembered across a real page reload.
  await page.getByTestId('mod-toggle-vehicle_pack').uncheck();
  await expect(page.getByTestId('mod-state-vehicle_pack')).toHaveText('Disabled');
  await page.waitForTimeout(200);
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('menu-mods').click();
  await expect(page.getByTestId('mod-state-vehicle_pack')).toHaveText('Disabled');
  await expect(page.getByTestId('mod-state-robot_pack')).toHaveText('Running');
  await page.getByTestId('mod-toggle-vehicle_pack').check();
  await expect(page.getByTestId('mod-state-vehicle_pack')).toHaveText('Running');
  expect(problems).toEqual([]);
});

test('mod content appears in the spawn menu and works in the running game', async ({ page }) => {
  const problems = await open(page);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('spawn-menu')).toBeVisible();

  // A mod's prop, made with data and with a generated icon, spawned through the menu.
  await page.getByTestId('spawn-search').fill('armchair');
  await expect(async () => {
    await page.getByTestId('spawn-furniture_pack:armchair').click();
    await expect(page.locator('.detail h3')).toHaveText('Armchair', { timeout: 500 });
  }).toPass();
  await page.getByTestId('spawn-now').click();
  await page.getByTestId('spawn-search').fill('');
  await page.getByTestId('cat-npcs').click();
  await expect(page.getByTestId('spawn-robot_pack:repair_bot')).toBeVisible();
  await expect(page.getByTestId('spawn-npc_courier')).toBeVisible();
  await page.getByTestId('cat-vehicles').click();
  await expect(page.getByTestId('spawn-vehicle_pack:trike')).toBeVisible();
  await expect(page.getByTestId('spawn-truck')).toBeVisible();
  await page.getByTestId('cat-tools').click();
  await expect(page.getByTestId('spawn-super_tools:levitator#item')).toBeVisible();
  // Icons render one by one at software-GL speed, and can swallow a click while they do.
  await expect(async () => {
    await page.getByTestId('spawn-super_tools:levitator#item').click();
    await expect(page.locator('.detail h3')).toHaveText('Levitator', { timeout: 500 });
  }).toPass();
  await page.getByTestId('spawn-now').click();
  await expect(page.getByTestId('tool-name')).toHaveText('Levitator');
  await expect(page.getByTestId('tool-status')).toHaveText('Floating: 0');

  const n = await page.evaluate(() => window.__chaos!.entities.active.filter((e) => e.def.id === 'furniture_pack:armchair').length);
  expect(n).toBe(1);

  // Quick menu shows mod tools past the original twelve.
  await page.keyboard.press('KeyQ');
  await expect(page.getByTestId('quick-super_tools:vortex')).toBeVisible();
  await page.getByTestId('quick-super_tools:confetti').click();
  await expect(page.getByTestId('tool-name')).toHaveText('Confetti Cannon');

  // The Mod Menu lists buttons mods added.
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('mod-menu')).toContainText('Honk');
  await expect(page.getByTestId('mod-menu')).toContainText('Trigger a disaster');
  await page.getByTestId('mod-menu-close').click();
  expect(await modErrors(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('a Mod Menu button can open a dialog, and dialog buttons work', async ({ page }) => {
  const problems = await open(page);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.keyboard.press('KeyM');
  await page.getByTestId('mod-menu').getByRole('button', { name: /Security Robots settings/ }).click();
  const dialog = page.getByTestId('mod-dialog');
  await expect(dialog).toBeVisible();
  const before = await dialog.textContent();
  await page.getByTestId('mod-dialog-0').click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.textContent()).not.toBe(before);
  await dialog.getByRole('button').last().click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__chaos!.ui.get().overlay)).toBeNull();
  expect(await modErrors(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('a scripted mode from a mod starts from the menu, on the mod\'s map, and shows its HUD', async ({ page }) => {
  const problems = await open(page);
  await page.getByTestId('menu-modes').click();
  await page.getByTestId('mode-chaos_playground:survive').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('mode-panel')).toContainText('Chaos Hour');
  await expect(page.getByTestId('mode-panel')).toContainText('Time left');
  expect(await page.evaluate(() => window.__chaos!.session.map)).toBe('chaos_playground:arena');
  const chairs = await page.evaluate(() => window.__chaos!.entities.active.filter((e) => e.def.id === 'furniture_pack:dining_chair').length);
  expect(chairs).toBe(10);
  // A disaster, delivered the way the button does it, while the real loop runs.
  await page.evaluate(() => window.__chaos!.mods.emitCustom('chaos_playground:disaster', { name: 'crate_rain' }));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__chaos!.time)).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__chaos!.ui.get().error)).toBeNull();
  expect(await modErrors(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('editing a script in the game: a mistake is reported, and a fix takes effect without losing the session', async ({ page }) => {
  const problems = await open(page);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-mods').click();
  await page.getByTestId('mod-edit-vehicle_pack').click();
  await expect(page.getByTestId('mod-editor')).toBeVisible();

  const code = page.getByTestId('mod-code');
  const original = await code.inputValue();
  expect(original).toContain('Monster Truck');

  await code.fill(`${original}\nthis line is not valid`);
  await page.getByTestId('mod-save').click();
  await expect(page.getByTestId('mod-editor-errors')).toContainText('main.chaos');
  await expect(page.getByTestId('mod-editor-errors')).toContainText('this');
  expect(await page.evaluate(() => window.__chaos!.ui.get().error)).toBeNull();

  await code.fill(original.replace('Monster Truck', 'Edited Truck'));
  await page.getByTestId('mod-save').click();
  await expect(page.getByTestId('mod-editor-ok')).toBeVisible();
  expect(await page.evaluate(() => (window.__chaos!.mods.get('vehicle_pack')!.content.items))).toContain('vehicle_pack:monster');
  const name = await page.evaluate(() => {
    const g = window.__chaos!;
    const r = g.entities.spawn('vehicle_pack:monster', { position: { x: 0, y: 2, z: 25 } });
    return r.ok ? r.entity.def.name.en : null;
  });
  expect(name).toBe('Edited Truck');
  await page.getByTestId('mod-editor-back').click();

  // The edited copy is local and can be discarded, returning to the original.
  await expect(page.getByTestId('mod-remove-vehicle_pack')).toHaveText('Discard edits');
  await page.getByTestId('mod-remove-vehicle_pack').click();
  await page.getByTestId('mod-remove-yes-vehicle_pack').click();
  await expect.poll(() => page.evaluate(() => window.__chaos!.mods.get('vehicle_pack')?.bundle.files['main.chaos'] ?? '')).toContain('Monster Truck');
  await expect(page.getByTestId('mod-state-vehicle_pack')).toHaveText('Running');
  await expect(page.getByTestId('mod-remove-vehicle_pack')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('installing bad and good mods from files gives clear results', async ({ page }) => {
  const problems = await open(page);
  await page.getByTestId('menu-mods').click();
  const install = (name: string, text: string) => page.getByTestId('mod-file-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

  await install('junk.json', 'not json at all');
  await expect(page.getByTestId('mods-errors')).toContainText('not JSON');

  const bundle = (script: string, id = 'uploaded_mod') => JSON.stringify({
    format: 'chaosmod-1',
    manifest: JSON.stringify({ id, name: 'Uploaded', version: '1.0.0', author: 'e2e', description: 'x', api_version: '1.0', permissions: ['content'], scripts: ['main.chaos'] }),
    files: { 'main.chaos': script },
  });
  await install('syntax.chaosmod.json', bundle('register.prop{ id ='));
  await expect(page.getByTestId('mods-errors')).toContainText('main.chaos:1');
  await install('typo.chaosmod.json', bundle('entity.spwan("x", {x=0,y=0,z=0})'));
  await expect(page.getByTestId('mods-errors')).toContainText('Did you mean "spawn"');
  await expect(page.getByTestId('mod-uploaded_mod')).toHaveCount(0);

  // Valid syntax, but it fails when run: it installs, is shown as failed, and everything else keeps working.
  await install('throws.chaosmod.json', bundle('register.prop{ id = "a", name = "A", shape = {type="sphere", r=0.5} }\nerror("nope")'));
  await expect(page.getByTestId('mod-state-uploaded_mod')).toHaveText('Failed to load');
  await expect(page.getByTestId('mod-error-uploaded_mod')).toContainText('main.chaos:2: nope');
  expect(await page.evaluate(() => window.__chaos!.mods.list().find((r) => r.id === 'robot_pack')!.state)).toBe('loaded');

  await install('good.chaosmod.json', bundle('register.prop{ id = "a", name = "Good Ball", shape = {type="sphere", r=0.5} }'));
  await expect(page.getByTestId('mods-ok')).toContainText('Uploaded');
  await expect(page.getByTestId('mod-state-uploaded_mod')).toHaveText('Running');

  // It survives a reload, then can be removed.
  await page.waitForTimeout(200);
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('menu-mods').click();
  await expect(page.getByTestId('mod-state-uploaded_mod')).toHaveText('Running');
  await page.getByTestId('mod-remove-uploaded_mod').click();
  await page.getByTestId('mod-remove-yes-uploaded_mod').click();
  await expect(page.getByTestId('mod-uploaded_mod')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('the debug console opens anywhere, runs ChaosScript and shows a broken mod\'s errors', async ({ page }) => {
  const problems = await open(page);
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('console')).toBeVisible();
  const input = page.getByTestId('console-input');
  const log = page.getByTestId('console-log');
  await expect(log).toContainText('Robot Pack ready');

  await input.fill('mods');
  await input.press('Enter');
  await expect(log).toContainText('super_tools v1.0.0: loaded');
  await input.fill('1 + 41');
  await input.press('Enter');
  await expect(log).toContainText('42');
  await input.fill('nope.field');
  await input.press('Enter');
  await expect(log).toContainText('Unknown variable "nope"');
  await input.press('Backquote');
  await expect(page.getByTestId('console')).toBeHidden();

  // In play, the console reaches the world and pausing isn't needed.
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('console')).toBeVisible();
  await input.fill('entity.spawn("robot_pack:repair_bot", {x=0, y=1, z=25})');
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__chaos!.entities.active.some((e) => e.def.id === 'robot_pack:repair_bot'))).toBe(true);
  await input.fill('while true do end');
  await input.press('Enter');
  await expect(log).toContainText('instruction budget');

  // A mod that goes wrong at runtime: reported with its line, stopped, and the game still runs.
  await page.evaluate(() => window.__chaos!.mods.installBundle({
    origin: 'local',
    manifest: JSON.stringify({ id: 'broken_mod', name: 'Broken', version: '1.0.0', author: 'e2e', description: 'x', api_version: '1.0', scripts: ['main.chaos'] }),
    files: { 'main.chaos': 'events.on("tick", function()\n  error("deliberate")\nend)' },
  }));
  await expect(log).toContainText('main.chaos:2: deliberate');
  await expect.poll(() => page.evaluate(() => window.__chaos!.mods.get('broken_mod')!.host?.phase), { timeout: 15000 }).toBe('faulted');
  const t0 = await page.evaluate(() => window.__chaos!.time);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__chaos!.time)).toBeGreaterThan(t0);
  expect(await page.evaluate(() => window.__chaos!.ui.get().error)).toBeNull();
  await page.getByTestId('console-close').click();
  await expect(page.getByTestId('console')).toBeHidden();
  await page.evaluate(() => window.__chaos!.mods.uninstall('broken_mod'));
  expect(problems).toEqual([]);
});
