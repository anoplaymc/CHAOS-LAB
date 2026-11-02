import { expect, test, type Page } from '@playwright/test';

/** Browser smoke test. Uses ?automation=1 so it also works where the browser refuses real pointer lock. */
const G = <T, A>(page: Page, fn: (a: A) => T, arg?: A) => page.evaluate(fn as never, arg as never) as Promise<T>;

test.describe.configure({ mode: 'serial' });

test('full loop: menu, map, physics, tools, NPC, pause, restart', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`request: ${r.url()}`));

  await page.goto('/?automation=1');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);

  // The WebGL canvas shows a real picture: many distinct colours, not a blank frame.
  const shot = await page.getByTestId('game-canvas').screenshot();
  expect(shot.length).toBeGreaterThan(20_000);
  const info = await G(page, () => {
    const g = window.__chaos!;
    return { gl: g.renderer!.renderer.getContext().getError(), ents: g.entities.registry.size, body: !!g.player.body, grounded: g.player.grounded };
  });
  expect(info.gl).toBe(0);
  expect(info.ents).toBeGreaterThan(20);
  expect(info.body).toBe(true);

  // Keyboard really moves the capsule.
  const z0 = await G(page, () => window.__chaos!.player.position.z);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  expect(await G(page, () => window.__chaos!.player.position.z)).toBeLessThan(z0 - 1);

  // Spawn menu opens, search ignores gameplay keys, an item spawns.
  await G(page, () => { const g = window.__chaos!; g.player.teleport({ x: 0, y: 1, z: 12 }, 0); g.player.pitch = -0.4; });
  await page.waitForTimeout(300);
  const before = await G(page, () => window.__chaos!.entities.registry.size);
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('spawn-menu')).toBeVisible();
  await page.getByTestId('spawn-search').pressSequentially('gfq');
  await expect(page.getByTestId('spawn-menu')).toBeVisible();
  await page.getByTestId('spawn-search').fill('crate');
  await page.getByTestId('spawn-crate_small').click();
  await page.getByTestId('spawn-now').click();
  await page.waitForTimeout(200);
  expect(await G(page, () => window.__chaos!.entities.registry.size)).toBe(before + 1);
  await page.getByTestId('spawn-search').fill('');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('spawn-menu')).toBeHidden();

  // A prop falls and comes to rest on the floor.
  const id = await G(page, () => { const r = window.__chaos!.entities.spawn('crate_metal', { position: { x: -6, y: 4, z: 12 } }); return r.ok ? r.entity.id : -1; });
  await page.waitForTimeout(2500);
  expect(await G(page, (i: number) => window.__chaos!.entities.get(i)!.position.y, id)).toBeLessThan(0.7);

  // Manipulator grabs and throws with mouse buttons.
  // Moving the mouse is a real look input, so it has to happen before aiming.
  await page.mouse.move(640, 360);
  await page.waitForTimeout(200);
  const target = await G(page, () => {
    const g = window.__chaos!;
    g.player.teleport({ x: 8, y: 1, z: -2 }, 0);
    const r = g.entities.spawn('crate_small', { position: { x: 8, y: 0.31, z: -6 } });
    g.tools.select(0);
    return r.ok ? r.entity.id : -1;
  });
  await page.waitForTimeout(500);
  await G(page, () => {
    const g = window.__chaos!;
    const e = g.camera.position;
    g.player.yaw = Math.atan2(-(8 - e.x), -(-6 - e.z));
    g.player.pitch = Math.atan2(0.31 - e.y, Math.hypot(8 - e.x, -6 - e.z));
  });
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.waitForTimeout(500);
  expect(await G(page, () => (window.__chaos!.tools.active as never as { held: { id: number } | null }).held?.id)).toBe(target);
  // Throw up the chamber: thrown straight down, the crate would rightly shatter on the floor.
  await G(page, () => { window.__chaos!.player.pitch = 0.3; });
  await page.waitForTimeout(300);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(150);
  await page.mouse.up({ button: 'right' });
  await page.mouse.up();
  const speed = await G(page, (i: number) => { const v = window.__chaos!.entities.get(i)!.body!.linvel(); return Math.hypot(v.x, v.y, v.z); }, target);
  expect(speed).toBeGreaterThan(5);

  // A weapon selected by number key fires.
  await page.keyboard.press('Digit7');
  await page.waitForTimeout(200);
  await expect(page.getByTestId('tool-name')).toContainText(/blaster/i);
  const e0 = await G(page, () => (window.__chaos!.tools.active as never as { energy: { value: number } }).energy.value);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  expect(await G(page, () => (window.__chaos!.tools.active as never as { energy: { value: number } }).energy.value)).toBeLessThan(e0);

  // NPC reaches a valid state.
  const npc = await G(page, () => { const r = window.__chaos!.entities.spawn('npc_robot', { position: { x: 5, y: 1.5, z: 5 } }); return r.ok ? r.entity.id : -1; });
  await page.waitForTimeout(1500);
  const state = await G(page, (i: number) => (window.__chaos!.entities.get(i)!.components[0] as never as { state: string }).state, npc);
  expect(['idle', 'patrol', 'investigate', 'chase', 'attack', 'flee', 'stunned']).toContain(state);

  // Pause freezes time.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  const t0 = await G(page, () => window.__chaos!.time);
  await page.waitForTimeout(400);
  expect(await G(page, () => window.__chaos!.time)).toBe(t0);
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  await page.waitForTimeout(400);
  expect(await G(page, () => window.__chaos!.time)).toBeGreaterThan(t0);

  // Restart leaves the same world size each time.
  await page.keyboard.press('Escape');
  await page.getByTestId('restart').click();
  await page.waitForTimeout(500);
  const a = await G(page, () => ({ n: window.__chaos!.entities.registry.size, s: window.__chaos!.scene.children.length }));
  await G(page, () => window.__chaos!.restart());
  await page.waitForTimeout(500);
  const b = await G(page, () => ({ n: window.__chaos!.entities.registry.size, s: window.__chaos!.scene.children.length }));
  expect(b).toEqual(a);

  // Quit returns to the menu.
  await page.keyboard.press('Escape');
  await page.getByTestId('quit').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();

  expect(errors).toEqual([]);
});
