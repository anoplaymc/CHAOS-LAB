import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// In a file of its own that sorts last: removing the temporary mod makes Vite reload pages, which would disturb a test running next.

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/?automation');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60000 });
  return problems;
}

test('saving a file under mods/ on disk reloads that mod in the running game', async ({ page }) => {
  const dir = join(process.cwd(), 'mods', 'zz_hot_test');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mod.json'), JSON.stringify({ id: 'zz_hot_test', name: 'Hot', version: '1.0.0', author: 'e2e', description: 'x', api_version: '1.0', permissions: ['content'], scripts: ['main.chaos'] }));
  writeFileSync(join(dir, 'main.chaos'), 'register.prop{ id = "thing", name = "First", shape = {type="sphere", r=0.5} }');
  try {
    const problems = await open(page);
    const nameOf = () => page.evaluate(async () => {
      const { catalog } = await import('/src/data/items.ts' as string);
      return catalog.get('zz_hot_test:thing')?.name.en ?? null;
    });
    await page.evaluate(() => window.__chaos!.mods.reload('zz_hot_test'));
    await expect.poll(() => page.evaluate(() => window.__chaos!.mods.get('zz_hot_test')?.state)).toBe('loaded');
    expect(await page.evaluate(() => window.__chaos!.mods.get('zz_hot_test')!.origin)).toBe('dev');
    await page.waitForTimeout(500);
    const path = join(dir, 'main.chaos');
    writeFileSync(path, readFileSync(path, 'utf8').replace('First', 'Second'));
    await expect.poll(nameOf, { timeout: 15000 }).toBe('Second');
    // A broken save is reported, then fixed by the next one.
    writeFileSync(path, 'register.prop{ id =');
    await expect.poll(() => page.evaluate(() => window.__chaos!.mods.get('zz_hot_test')?.state), { timeout: 15000 }).toBe('invalid');
    writeFileSync(path, 'register.prop{ id = "thing", name = "Third", shape = {type="sphere", r=0.5} }');
    await expect.poll(nameOf, { timeout: 15000 }).toBe('Third');
    expect(problems).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
