import { expect, test, type Page } from '@playwright/test';
import { writeZip, type ZipInput } from '../src/modding/zipWrite';

const manifest = (o: Record<string, unknown> = {}) => JSON.stringify({ id: 'imported_mod', name: 'Imported Mod', version: '3.2.1', author: 'Zip Author', description: 'Arrived in an archive.', api_version: '1.1', permissions: ['ui', 'storage'], scripts: ['main.chaos'], ...o });
const SCRIPT = 'input.bind("F10", function() ui.toast("imported key works", "success") end)\nui.add_button{ label = "Imported", on_click = function() end }\nstorage.set("ran", true)';
const good = (o: Record<string, unknown> = {}, prefix = 'imported_mod/'): ZipInput[] => [{ path: `${prefix}mod.json`, data: manifest(o) }, { path: `${prefix}main.chaos`, data: SCRIPT }, { path: `${prefix}README.md`, data: '# docs' }];

async function boot(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/?automation');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60000 });
  await page.evaluate(() => window.__chaos!.applySettings({ shadows: false, bloom: false, antialias: false, renderScale: 0.5, quality: 'low' }));
  await page.getByTestId('menu-mods').click();
  await expect(page.getByTestId('mods-import')).toBeVisible();
  return problems;
}

const choose = (page: Page, inputs: ZipInput[], name = 'mod.zip') => page.getByTestId('mod-import-input').setInputFiles({ name, mimeType: 'application/zip', buffer: Buffer.from(writeZip(inputs)) });
const raw = (page: Page, text: string) => page.getByTestId('mod-import-input').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from(text) });
const stored = (page: Page, id: string) => page.evaluate((x) => window.__chaos!.saves.db.get('mods', x).then((v) => !!v), id);

test('the full path through the real screen: preview, install, turn on, use, turn off, remove', async ({ page }) => {
  const problems = await boot(page);
  await choose(page, good({ enabled_by_default: false }));
  await expect(page.getByTestId('mod-import-preview')).toBeVisible();
  await expect(page.getByTestId('mod-import-name')).toHaveText('Imported Mod');
  await expect(page.getByTestId('mod-import-version')).toHaveText('3.2.1');
  await expect(page.getByTestId('mod-import-author')).toHaveText('Zip Author');
  await expect(page.getByTestId('mod-import-permissions')).toContainText('ui');
  await expect(page.getByTestId('mod-import-permissions')).toContainText('Save data');
  // Nothing has happened yet.
  expect(await page.evaluate(() => window.__chaos!.mods.get('imported_mod'))).toBeUndefined();
  expect(await stored(page, 'imported_mod')).toBe(false);

  await page.getByTestId('mod-import-install').click();
  await expect(page.getByTestId('mod-import-done')).toContainText('turned off');
  await page.getByTestId('mod-import-close').click();
  await expect(page.getByTestId('mod-import-dialog')).toHaveCount(0);

  // The list has it, as the manifest asked: off.
  await expect(page.getByTestId('mod-state-imported_mod')).toHaveText('Disabled');
  await page.getByTestId('mod-toggle-imported_mod').check();
  await expect(page.getByTestId('mod-state-imported_mod')).toHaveText('Running');
  await page.getByTestId('mods-back').click();
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.keyboard.press('F10');
  await expect(page.getByText('imported key works')).toBeVisible();

  // It survives a real reload, and everything else still runs.
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('menu-mods').click();
  await expect(page.getByTestId('mod-state-imported_mod')).toHaveText('Running');
  for (const id of ['chaos_playground', 'furniture_pack', 'robot_pack', 'super_tools', 'vehicle_pack', 'security_robots']) await expect(page.getByTestId(`mod-state-${id}`)).toHaveText('Running');

  await page.getByTestId('mod-toggle-imported_mod').uncheck();
  await expect(page.getByTestId('mod-state-imported_mod')).toHaveText('Disabled');
  await page.getByTestId('mod-remove-imported_mod').click();
  await page.getByTestId('mod-remove-yes-imported_mod').click();
  await expect(page.getByTestId('mod-imported_mod')).toHaveCount(0);
  await expect.poll(() => stored(page, 'imported_mod')).toBe(false);
  expect(problems).toEqual([]);
});

test('bad archives are refused with a reason, and leave nothing behind', async ({ page }) => {
  const problems = await boot(page);
  const before = await page.evaluate(() => window.__chaos!.mods.list().map((r) => r.id));
  const refused = async (message: RegExp) => {
    await expect(page.getByTestId('mod-import-error')).toContainText(message);
    await expect(page.getByTestId('mod-import-install')).toHaveCount(0);
    await page.getByTestId('mod-import-close').click();
    await expect(page.getByTestId('mod-import-dialog')).toHaveCount(0);
  };

  await raw(page, 'this is not a zip archive');
  await refused(/not a ZIP/);
  await choose(page, [{ path: 'notes.txt', data: 'no mod here' }]);
  await refused(/no mod\.json/);
  await choose(page, [...good(), { path: '../../outside.chaos', data: 'x' }]);
  await refused(/climbs out/);
  await choose(page, [...good(), { path: '/etc/evil.chaos', data: 'x' }]);
  await refused(/absolute path/);
  await choose(page, [...good(), { path: 'imported_mod/link', data: '/etc/passwd', mode: 0o120777 }]);
  await refused(/symbolic link/);
  await choose(page, [{ path: 'mod.json', data: manifest() }, { path: 'main.chaos', data: new Uint8Array(1024 * 1024), declaredSize: 50 }]);
  await refused(/more than it declares/);

  // Refused after reading: the facts show, and Install can't be pressed.
  for (const [o, message] of [[{ api_version: '9.0' }, /needs API version 9\.0/], [{ api_version: '1.99' }, /needs API version 1\.99/], [{ id: 'BAD ID' }, /invalid/]] as const) {
    await choose(page, good(o));
    await expect(page.getByTestId('mod-import-error')).toContainText(message);
    await expect(page.getByTestId('mod-import-install')).toBeDisabled();
    await page.getByTestId('mod-import-cancel').click();
    await expect(page.getByTestId('mod-import-dialog')).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__chaos!.mods.list().map((r) => r.id))).toEqual(before);
  expect(await stored(page, 'imported_mod')).toBe(false);
  expect(problems).toEqual([]);
});

test('cancelling, dependencies, and replacing another mod only when told to', async ({ page }) => {
  const problems = await boot(page);
  // Cancelled at the preview: nothing installed.
  await choose(page, good());
  await expect(page.getByTestId('mod-import-preview')).toBeVisible();
  await page.getByTestId('mod-import-cancel').click();
  await expect(page.getByTestId('mod-import-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__chaos!.mods.get('imported_mod'))).toBeUndefined();

  // A missing dependency says so beforehand, and the mod shows why it's blocked.
  await choose(page, good({ dependencies: ['no_such_mod'] }));
  await expect(page.getByTestId('mod-import-deps')).toContainText('not installed');
  await page.getByTestId('mod-import-install').click();
  await expect(page.getByTestId('mod-import-error')).toContainText('no_such_mod');
  await page.getByTestId('mod-import-close').click();
  await expect(page.getByTestId('mod-state-imported_mod')).toHaveText('Blocked');
  await page.getByTestId('mod-remove-imported_mod').click();
  await page.getByTestId('mod-remove-yes-imported_mod').click();
  await expect(page.getByTestId('mod-imported_mod')).toHaveCount(0);

  // Same id as a mod that came with the game: Replace waits for the tick.
  const original = await page.evaluate(() => window.__chaos!.mods.get('robot_pack')!.manifest!.version);
  await choose(page, good({ id: 'robot_pack', name: 'Fake Robots', version: '9.9.9' }));
  await expect(page.getByTestId('mod-import-replaces')).toContainText('came with the game');
  await expect(page.getByTestId('mod-import-install')).toBeDisabled();
  await page.getByTestId('mod-import-cancel').click();
  expect(await page.evaluate(() => window.__chaos!.mods.get('robot_pack')!.manifest!.version)).toBe(original);

  await choose(page, good({ id: 'robot_pack', name: 'Fake Robots', version: '9.9.9' }));
  await page.getByTestId('mod-import-agree').check();
  await page.getByTestId('mod-import-install').click();
  await expect(page.getByTestId('mod-import-done')).toBeVisible();
  await page.getByTestId('mod-import-close').click();
  expect(await page.evaluate(() => window.__chaos!.mods.get('robot_pack')!.manifest!.version)).toBe('9.9.9');
  // And the original comes back.
  await page.getByTestId('mod-remove-robot_pack').click();
  await page.getByTestId('mod-remove-yes-robot_pack').click();
  await expect.poll(() => page.evaluate(() => window.__chaos!.mods.get('robot_pack')!.manifest!.version)).toBe(original);
  await expect(page.getByTestId('mod-state-robot_pack')).toHaveText('Running');
  expect(problems).toEqual([]);
});
