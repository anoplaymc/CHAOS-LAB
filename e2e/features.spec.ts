import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = process.env.SHOT_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};
const G = <T, A>(page: Page, fn: (a: A) => T, arg?: A) => page.evaluate(fn as never, arg as never) as Promise<T>;

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`request: ${r.url()}`));
  return errors;
}

const open = async (page: Page) => {
  await page.goto('/?automation=1');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
};

test('a saved construction survives a real page reload, and can be exported and re-imported', async ({ page }, info) => {
  const errors = watch(page);
  await open(page);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await G(page, () => {
    const g = window.__chaos!;
    g.player.teleport({ x: 0, y: 1, z: 12 }, 0);
    for (const [i, id] of ['crate_metal', 'crate_metal'].entries()) g.entities.spawn(id, { id: 500 + i, position: { x: -6 + i, y: 0.51, z: 12 } });
    g.entities.setTint(g.entities.get(500)!, 0xff0000);
    g.connections.connect('weld', g.entities.get(500)!, g.entities.get(501)!, { x: -5.5, y: 0.5, z: 12 }, { x: -5.5, y: 0.5, z: 12 }, null);
    g.setGravity(5);
  });
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-saves').click();
  await page.getByTestId('save-name').fill('Reload Test');
  await page.getByTestId('save-new').click();
  await expect(page.getByTestId('save-row').first()).toContainText('Reload Test');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).first().click();
  const dl = await downloadPromise;
  const exported = info.outputPath('export.json');
  await dl.saveAs(exported);

  // A real reload: only IndexedDB can bring this back.
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('menu-saves').click();
  await expect(page.getByTestId('save-row').first()).toContainText('Reload Test');
  await page.getByTestId('save-load').first().click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.waitForTimeout(300);
  const after = await G(page, () => {
    const g = window.__chaos!;
    return { tint: g.entities.get(500)?.tint, b: !!g.entities.get(501), links: g.connections.count, grav: g.rules.gravity };
  });
  expect(after).toEqual({ tint: 0xff0000, b: true, links: 1, grav: 5 });

  // Bad files are refused with a message and change nothing.
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-saves').click();
  const bad = info.outputPath('bad.json');
  writeFileSync(bad, '{"schema": 2, "kind": "nope"}');
  await page.getByTestId('save-file').setInputFiles(bad);
  await expect(page.getByTestId('save-error')).toContainText('Could not import');
  // The exported file imports back.
  await page.getByTestId('save-file').setInputFiles(exported);
  await expect(page.getByTestId('save-row').first()).toContainText('Reload Test');
  expect(errors).toEqual([]);
});

test('Workshop installs a pack, reports a bad one, survives reload, and its items spawn', async ({ page }, info) => {
  const errors = watch(page);
  await open(page);
  await page.getByTestId('menu-workshop').click();
  const bad = info.outputPath('badpack.json');
  mkdirSync(info.outputDir, { recursive: true });
  writeFileSync(bad, JSON.stringify({ id: 'evil', name: 'Evil', version: '1.0.0', script: 'alert(1)', entities: [{ id: 'x', shape: { type: 'sphere', r: 1 } }] }));
  await page.getByTestId('pack-file').setInputFiles(bad);
  await expect(page.getByTestId('workshop-errors')).toContainText('cannot run code');
  await page.getByTestId('install-sample').click();
  await expect(page.getByTestId('workshop-ok')).toContainText('Sample Toys');
  await expect(page.getByTestId('pack-sample-toys')).toBeVisible();
  await shot(page, 'workshop');

  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('menu-maps').click();
  await expect(page.getByTestId('map-sample-toys:tiny_arena')).toBeVisible();
  await page.getByTestId('map-sample-toys:tiny_arena').click();
  await page.getByTestId('start-map').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyG');
  await page.getByTestId('spawn-search').fill('jelly');
  await page.getByTestId('spawn-sample-toys:jelly_ball').click();
  await page.getByTestId('spawn-now').click();
  await page.waitForTimeout(200);
  expect(await G(page, () => window.__chaos!.entities.active.some((e) => e.def.id === 'sample-toys:jelly_ball'))).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.getByTestId('quit').click();

  await page.getByTestId('menu-workshop').click();
  await page.getByTestId('pack-toggle-sample-toys').uncheck();
  await page.waitForTimeout(100);
  expect(await G(page, () => window.__chaos!.packs.list()[0]!.enabled)).toBe(false);
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('pack-sample-toys')).toBeHidden();
  expect(errors).toEqual([]);
});

test('spawn menu: icons, categories, favourites, keyboard navigation, empty state', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await G(page, () => { const g = window.__chaos!; g.player.teleport({ x: 0, y: 1, z: 12 }, 0); g.player.pitch = -0.4; });
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('spawn-menu')).toBeVisible();
  await expect(page.locator('.item .thumb img').first()).toBeVisible({ timeout: 15_000 });
  await shot(page, 'spawnmenu');

  // Typing gameplay keys in search must not trigger gameplay.
  const flying = await G(page, () => window.__chaos!.player.flying);
  await page.getByTestId('spawn-search').pressSequentially('fgqe');
  await expect(page.getByTestId('spawn-menu')).toBeVisible();
  expect(await G(page, () => window.__chaos!.player.flying)).toBe(flying);
  await expect(page.getByTestId('spawn-empty')).toBeVisible();
  await page.getByTestId('spawn-search').fill('');

  await page.getByTestId('cat-favorites').click();
  await expect(page.getByTestId('spawn-empty')).toContainText('★');
  await page.getByTestId('cat-npcs').click();
  await page.getByTestId('spawn-npc_robot').click();
  await page.getByTestId('spawn-fav').click();
  await page.getByTestId('cat-favorites').click();
  await expect(page.getByTestId('spawn-npc_robot')).toBeVisible();

  // Keyboard: search, arrow into the grid, Enter spawns.
  await page.getByTestId('spawn-search').fill('crate');
  const before = await G(page, () => window.__chaos!.entities.registry.size);
  await page.getByTestId('spawn-search').press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  expect(await G(page, () => window.__chaos!.entities.registry.size)).toBe(before + 1);
  await page.getByTestId('spawn-search').fill('');
  await page.getByTestId('cat-recent').click();
  await expect(page.locator('.item')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test('placement with preview and real mouse: construction tool builds, undo removes', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.mouse.move(640, 360);
  await page.waitForTimeout(200);
  await G(page, () => { const g = window.__chaos!; g.player.teleport({ x: 6, y: 1, z: 18 }, 0); g.player.pitch = -0.5; });
  await page.waitForTimeout(300);
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(200);
  await expect(page.getByTestId('tool-name')).toContainText(/construction/i);
  const n0 = await G(page, () => window.__chaos!.entities.registry.size);
  await page.keyboard.press('BracketRight');
  await page.waitForTimeout(300);
  await shot(page, 'construction');
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await G(page, () => window.__chaos!.entities.registry.size)).toBe(n0 + 1);
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(200);
  expect(await G(page, () => window.__chaos!.entities.registry.size)).toBe(n0);
  await page.keyboard.press('KeyY');
  await page.waitForTimeout(200);
  expect(await G(page, () => window.__chaos!.entities.registry.size)).toBe(n0 + 1);
  // Right mouse changes mode.
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
  await expect(page.getByTestId('tool-status')).toContainText(/move/i);
  // Quick menu.
  await page.keyboard.press('KeyQ');
  await expect(page.getByTestId('quick-menu')).toBeVisible();
  await shot(page, 'quickmenu');
  await page.getByTestId('quick-paint').click();
  await expect(page.getByTestId('tool-name')).toContainText(/paint/i);
  // Inspector panel, cleanup with confirmation.
  await page.keyboard.press('Digit5');
  await G(page, () => { const g = window.__chaos!; g.entities.spawn('crate_wood', { position: { x: 8, y: 0.51, z: -2 } }); g.player.teleport({ x: 8, y: 1, z: 1.5 }, 0); });
  await page.waitForTimeout(300);
  await G(page, () => { const g = window.__chaos!; const e = g.camera.position; g.player.yaw = 0; g.player.pitch = Math.atan2(0.5 - e.y, Math.hypot(8 - e.x, -2 - e.z)); });
  await page.waitForTimeout(600);
  await expect(page.getByTestId('inspect-panel')).toContainText('Wooden Crate');
  await shot(page, 'inspector');
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-cleanup').click();
  await page.getByTestId('clean-props').check();
  await page.getByTestId('clean-go').click();
  await expect(page.getByTestId('clean-question')).toBeVisible();
  const props0 = await G(page, () => window.__chaos!.countByCategory().props ?? 0);
  expect(props0).toBeGreaterThan(0);
  await page.getByTestId('clean-yes').click();
  expect(await G(page, () => window.__chaos!.countByCategory().props ?? 0)).toBe(0);
  expect(errors).toEqual([]);
});

test('every mode starts from the menu and shows its loop', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await shot(page, 'menu');
  await page.getByTestId('menu-modes').click();
  await shot(page, 'modes');

  await page.getByTestId('start-game').click(); // Survival, preselected.
  await expect(page.getByTestId('mode-panel')).toContainText('Wave');
  await page.waitForTimeout(1500);
  await shot(page, 'map-yard');
  await G(page, () => { window.__chaos!.rules.damage = false; });
  await page.waitForTimeout(3500);
  expect(await G(page, () => window.__chaos!.npcs.length)).toBeGreaterThan(0);
  await G(page, () => { const g = window.__chaos!; const n = g.npcs[0]!; const p = n.position; g.player.teleport({ x: p.x, y: p.y + 1, z: p.z + 7 }, 0); g.player.pitch = -0.1; });
  await page.waitForTimeout(500);
  await shot(page, 'survival');
  await page.keyboard.press('Escape');
  await page.getByTestId('quit').click();

  await page.getByTestId('menu-modes').click();
  await page.getByTestId('mode-playground').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('mode-panel')).toContainText('Orbs');
  await page.waitForTimeout(1500);
  await shot(page, 'map-gravity');
  await page.keyboard.press('Escape');
  await page.getByTestId('quit').click();

  await page.getByTestId('menu-modes').click();
  await page.getByTestId('mode-contraption').click();
  await shot(page, 'challenges');
  await page.getByTestId('challenge-bridge').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('mode-panel')).toContainText('Parts: 0 / 6');
  await page.waitForTimeout(1000);
  await shot(page, 'challenge-bridge');
  // Win through the mode itself, to check the result screen and its buttons.
  await G(page, () => { const g = window.__chaos!; g.player.teleport({ x: 0, y: 1, z: -20 }, 0); });
  await expect(page.getByTestId('mode-result')).toBeVisible({ timeout: 10_000 });
  await shot(page, 'result');
  await page.getByTestId('result-next').click();
  await expect(page.getByTestId('mode-panel')).toContainText('Power Up');
  await page.waitForTimeout(800);
  await shot(page, 'challenge-wire');
  await page.keyboard.press('Escape');
  await page.getByTestId('quit').click();

  await page.getByTestId('menu-modes').click();
  await page.getByTestId('mode-editor').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('mode-panel')).toContainText('Physics is paused');
  await G(page, () => { const g = window.__chaos!; g.player.teleport({ x: 0, y: 4, z: 12 }, 0); g.player.pitch = -0.5; });
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyG');
  await page.getByTestId('spawn-search').fill('barrel');
  await page.getByTestId('spawn-barrel').dblclick();
  await page.waitForTimeout(200);
  await page.getByTestId('spawn-close').click();
  await page.waitForTimeout(800);
  expect(await G(page, () => window.__chaos!.entities.active.filter((e) => !e.fixture).length)).toBe(1);
  await page.keyboard.press('Escape');
  await page.getByTestId('layout-name').fill('My Layout');
  await page.getByTestId('save-layout').click();
  await page.waitForTimeout(200);
  await page.getByTestId('test-layout').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await G(page, () => ({ edit: window.__chaos!.editing, n: window.__chaos!.entities.active.filter((e) => !e.fixture).length }))).toEqual({ edit: false, n: 1 });
  expect(errors).toEqual([]);
});

test('language switches to Russian and persists', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('language').selectOption('ru');
  await shot(page, 'settings-ru');
  await page.reload();
  await expect(page.getByTestId('main-menu')).toContainText('Войти в лабораторию', { timeout: 30_000 });
  await page.getByTestId('play').click();
  await expect(page.getByTestId('tool-name')).toContainText('Манипулятор');
  await page.waitForTimeout(500);
  await shot(page, 'game-ru');
  expect(errors).toEqual([]);
});

test('survives WebGL context loss and window resizing', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.waitForTimeout(500);

  await page.setViewportSize({ width: 900, height: 500 });
  await page.waitForTimeout(400);
  const small = await G(page, () => { const r = window.__chaos!.renderer!; return { w: r.width, h: r.height, aspect: window.__chaos!.camera.aspect }; });
  expect(small.w).toBe(900);
  expect(small.h).toBe(500);
  expect(small.aspect).toBeCloseTo(1.8, 1);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  const ok = await G(page, () => {
    const gl = window.__chaos!.renderer!.renderer.getContext();
    // getExtension returns null once the context is lost, so keep hold of it for the restore below.
    const ext = gl.getExtension('WEBGL_lose_context');
    (window as never as { __ext: unknown }).__ext = ext;
    ext?.loseContext();
    return !!ext;
  });
  expect(ok).toBe(true);
  await page.waitForTimeout(400);
  expect(await G(page, () => window.__chaos!.renderer!.contextLost)).toBe(true);
  const t0 = await G(page, () => window.__chaos!.time);
  await page.waitForTimeout(300);
  // The simulation keeps running while there's nothing to draw on.
  expect(await G(page, () => window.__chaos!.time)).toBeGreaterThan(t0);
  await G(page, () => { (window as never as { __ext: { restoreContext(): void } }).__ext.restoreContext(); });
  await page.waitForTimeout(800);
  expect(await G(page, () => window.__chaos!.renderer!.contextLost)).toBe(false);
  const shot2 = await page.getByTestId('game-canvas').screenshot();
  expect(shot2.length).toBeGreaterThan(20_000);
  // The first read may report the moment of restoring, when three.js frees objects from the lost context.
  await G(page, () => window.__chaos!.renderer!.renderer.getContext().getError());
  await page.waitForTimeout(300);
  expect(await G(page, () => window.__chaos!.renderer!.renderer.getContext().getError())).toBe(0);
  expect(errors.filter((e) => !e.includes('context lost'))).toEqual([]);
});

test('every sound effect produces real audio at a sane level', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  // Rendered offline: this needs no sound device, and lets the test measure the actual samples.
  const results = await G(page, async () => {
    const names = ['click', 'lever', 'uiHover', 'uiClick', 'error', 'success', 'jump', 'land', 'hurt', 'bounce', 'spring', 'door', 'motorOn', 'motorOff', 'grab', 'release', 'throw', 'pin', 'place', 'remove', 'paint', 'undo', 'link', 'blaster', 'charge', 'impulse', 'freeze', 'frozen', 'thaw', 'bouncer', 'pop', 'disintegrate', 'dissolved', 'gravity', 'well', 'reload', 'empty', 'explode', 'glass', 'breakWood', 'breakStone', 'breakMetal', 'npcAlert', 'npcHurt', 'npcDie', 'npcTalk', 'creature', 'robotIdle', 'robotShot', 'tracer', 'slam', 'waveStart', 'gravityShift', 'pickup'];
    const Engine = window.__chaos!.audio.constructor as new () => import('../src/audio/AudioEngine').AudioEngine;
    const out: Record<string, number> = {};
    const measure = async (label: string, run: (a: import('../src/audio/AudioEngine').AudioEngine) => void) => {
      const ctx = new OfflineAudioContext(2, 44100 * 1.6, 44100);
      const audio = new Engine();
      audio.applySettings({ ...window.__chaos!.settings, masterVolume: 1, sfxVolume: 1, ambienceVolume: 1 });
      audio.useContext(ctx);
      run(audio);
      const buf = await ctx.startRendering();
      let peak = 0;
      for (let c = 0; c < 2; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
      out[label] = peak;
    };
    for (const n of names) await measure(n, (a) => a.play(n, 1));
    for (const s of ['wood', 'metal', 'rubber', 'gel', 'ice', 'glass', 'stone']) await measure(`impact:${s}`, (a) => a.impact(s, 1, { x: 0, y: 0, z: 0 }));
    for (const s of ['metal', 'concrete', 'gel']) await measure(`step:${s}`, (a) => a.playFootstep(s));
    return out;
  });
  const silent = Object.entries(results).filter(([, p]) => p < 0.004).map(([n]) => n);
  const loud = Object.entries(results).filter(([, p]) => p > 1).map(([n, p]) => `${n}=${p.toFixed(2)}`);
  console.log(`Sound peaks: ${Object.keys(results).length} effects, max ${Math.max(...Object.values(results)).toFixed(3)}, min ${Math.min(...Object.values(results)).toFixed(4)}`);
  expect(silent).toEqual([]);
  expect(loud).toEqual([]);
  expect(errors).toEqual([]);
});
