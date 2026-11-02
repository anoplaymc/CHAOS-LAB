import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { catalog } from '../data/items';
import { NPC_PROFILES } from '../game/npcs/NpcBrain';
import { MAP_STORE, MODE_INFO, TOOL_TYPES } from '../game/content/registry';
import { Game, MAPS } from '../game/core/Game';
import { materials } from '../data/materials';
import { ALL_API } from '../modding/api';
import { apiCompatible, parseManifest, satisfies, validRange } from '../modding/manifest';
import { bundleToText, parseBundleText, type ModBundle, type ModRecord } from '../modding/ModManager';
import { DataTool } from '../game/weapons/DataTool';

let game: Game;

interface ModOptions { id?: string; version?: string; permissions?: string[]; dependencies?: unknown[]; conflicts?: string[]; api?: string; hot_reload?: boolean; files?: Record<string, string> }

export function bundle(source: string, o: ModOptions = {}): ModBundle {
  const id = o.id ?? 'test_mod';
  const files = o.files ?? { 'main.chaos': source };
  return {
    origin: 'local',
    manifest: JSON.stringify({
      id, name: id, description: 'test', version: o.version ?? '1.0.0', author: 'test', api_version: o.api ?? '1.0',
      permissions: o.permissions ?? ['content', 'world', 'player', 'effects', 'ui', 'storage', 'rules'],
      dependencies: o.dependencies ?? [], conflicts: o.conflicts ?? [], scripts: Object.keys(files), hot_reload: o.hot_reload,
    }),
    files,
  };
}

async function install(source: string, o: ModOptions = {}): Promise<ModRecord> {
  const r = await game.mods.installBundle(bundle(source, o));
  expect(r.errors, r.errors.join('\n')).toEqual([]);
  return r.record!;
}

const errorsOf = (id = 'test_mod') => game.mods.logs.filter((l) => l.mod === id && l.level === 'error').map((l) => l.text);
const lastInfo = (id = 'test_mod') => game.mods.logs.filter((l) => l.mod === id && l.level === 'info').map((l) => l.text);
const step = (seconds: number) => game.advance(seconds);

beforeAll(async () => {
  await Game.init();
});

afterEach(async () => {
  if (!game) return;
  for (const r of game.mods.list()) await game.mods.uninstall(r.id);
  game.dispose();
});

async function fresh(): Promise<Game> {
  game = new Game();
  game.input.virtualLock = true;
  game.startSession();
  return game;
}

describe('manifest', () => {
  const good = { id: 'my_mod', name: 'My Mod', version: '1.2.3', author: 'a', description: 'd', api_version: '1.0', scripts: ['main.chaos'] };

  it('accepts a minimal manifest with defaults', () => {
    const r = parseManifest(good);
    expect(r.errors).toEqual([]);
    expect(r.manifest).toMatchObject({ id: 'my_mod', permissions: [], dependencies: [], hot_reload: true, enabled_by_default: true });
  });

  it('explains what is wrong', () => {
    const bad = (patch: object) => parseManifest({ ...good, ...patch }).errors.join(' ');
    expect(bad({ id: 'Bad Id' })).toMatch(/id "Bad Id" is invalid/);
    expect(bad({ version: '1.0' })).toMatch(/must look like 1.0.0/);
    expect(bad({ api_version: undefined })).toMatch(/api_version/);
    expect(bad({ scripts: [] })).toMatch(/at least one/);
    expect(bad({ scripts: ['../evil.chaos'] })).toMatch(/not allowed/);
    expect(bad({ scripts: ['/etc/passwd.chaos'] })).toMatch(/not allowed/);
    expect(bad({ scripts: ['main.js'] })).toMatch(/must end in .chaos/);
    expect(bad({ permissions: ['wrold'] })).toMatch(/Did you mean "world"/);
    expect(bad({ dependencies: [{ id: 'xx', version: 'banana' }] })).toMatch(/invalid version range/);
    expect(bad({ dependencies: ['my_mod'] })).toMatch(/depend on itself/);
    expect(bad({ assets: ['x.exe'] })).toMatch(/must be a .png/);
    expect(parseManifest('nope').errors[0]).toMatch(/JSON object/);
    expect(parseManifest({ ...good, permisions: [] }).warnings[0]).toMatch(/Did you mean "permissions"/);
  });

  it('checks version ranges', () => {
    expect(satisfies('1.2.3', '*')).toBe(true);
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '1.2.3')).toBe(false);
    expect(satisfies('1.5.0', '^1.2.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(validRange('^1.0.0')).toBe(true);
    expect(validRange('latest')).toBe(false);
    expect(apiCompatible('1.0', '1.0')).toBe(true);
    expect(apiCompatible('1.0', '1.4')).toBe(true);
    expect(apiCompatible('1.5', '1.4')).toBe(false);
    expect(apiCompatible('2.0', '1.4')).toBe(false);
  });
});

describe('running scripts in the game', () => {
  it('loads a .chaos script and runs it', async () => {
    await fresh();
    const r = await install('log.info("hello from " .. mod.id())');
    expect(r.state).toBe('loaded');
    expect(lastInfo()).toContain('hello from test_mod');
  });

  it('registers a prop that spawns, collides and falls in the real world', async () => {
    await fresh();
    await install(`register.prop{ id = "ball", name = "Ball", shape = {type="sphere", r=0.5}, material = "rubber", color = 0xff0000 }`);
    const def = catalog.get('test_mod:ball');
    expect(def?.source).toBe('test_mod');
    const e = game.spawnAtCrosshair('test_mod:ball');
    expect(e).not.toBeNull();
    const y0 = e!.position.y;
    const e2 = game.entities.spawn('test_mod:ball', { position: { x: 0, y: 3, z: 25 } });
    expect(e2.ok).toBe(true);
    step(1);
    if (e2.ok) expect(e2.entity.position.y).toBeLessThan(3);
    expect(e!.position.y).toBeLessThanOrEqual(y0 + 0.5);
  });

  it('registers an NPC that thinks, takes orders and dies', async () => {
    await fresh();
    await install(`
      global thinks = 0
      global died = false
      register.npc{
        id = "bot", name = "Bot", health = 30, walk_speed = 3, model = {base="robot", color=0x3388ff},
        on_think = function(self, dt) thinks = thinks + 1 end,
        on_death = function(self, by) died = true; log.info("dead") end,
      }
      events.on("session_start", function(e) end)
    `);
    const r = game.entities.spawn('test_mod:bot', { position: { x: 0, y: 1, z: 25 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(game.npcs.some((n) => n.e === r.entity)).toBe(true);
    expect(NPC_PROFILES['test_mod:bot']?.health).toBe(30);
    step(1.5);
    const host = game.mods.get('test_mod')!.host!;
    expect(host.vm.globals.vars.get('thinks')).toBeGreaterThan(3);
    game.damageEntity(r.entity, 50, { kind: 'player' });
    expect(lastInfo()).toContain('dead');
  });

  it('registers a tool that shows up, can be selected and reacts to clicks', async () => {
    await fresh();
    const before = game.tools.tools.length;
    await install(`
      global clicks = 0
      register.tool{ id = "clicker", name = "Clicker", on_primary = function() clicks = clicks + 1 end, status = function() return "clicks " .. clicks end, hints = {{"LMB", "Click"}} }
    `);
    expect(game.tools.tools.length).toBe(before + 1);
    expect(game.tools.selectById('test_mod:clicker')).toBe(true);
    expect(game.tools.active.id).toBe('test_mod:clicker');
    game.tools.active.primaryDown();
    game.tools.active.primaryUp();
    expect(game.tools.active.hud().status).toBe('clicks 1');
    expect(catalog.list().some((d) => d.toolId === 'test_mod:clicker')).toBe(true);
  });

  it('registers a weapon whose shots really hit and push things', async () => {
    await fresh();
    await install(`global hits = 0
      register.weapon{ id = "gun", name = "Gun", fire = "hitscan", damage = 25, impulse = 400, cooldown = 0.01, on_hit = function(hit) hits = hits + 1; assert(hit.entity ~= nil) end }`);
    game.tools.selectById('test_mod:gun');
    const c = game.entities.spawn('crate_wood', { position: { x: 0, y: 1.2, z: 23 } });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    step(0.2);
    game.player.teleport({ x: 0, y: 1, z: 27 }, 0);
    step(0.1);
    const a = game.aimRay();
    const crate = c.entity.position;
    game.player.pitch = Math.atan2(crate.y - a.origin.y, a.origin.z - crate.z);
    step(0.02);
    const hp = c.entity.health;
    (game.tools.active as DataTool).tryFire();
    expect(c.entity.health).toBeLessThan(hp);
    expect(game.mods.get('test_mod')!.host!.vm.globals.vars.get('hits')).toBe(1);
    expect(errorsOf()).toEqual([]);
  });

  it('registers a vehicle that drives', async () => {
    await fresh();
    await install(`register.vehicle{ id = "cart", name = "Cart", size = {x=1.4, y=0.5, z=2.4}, color = 0x19e0c4, engine = 900 }`);
    game.player.teleport({ x: 0, y: 1, z: 30 }, 0);
    const r = game.entities.spawn('test_mod:cart', { position: { x: 0, y: 1, z: 28 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    step(1);
    const comp = r.entity.components.find((c) => c.onInteract)!;
    expect(comp.onInteract!()).toBe(true);
    expect(game.player.driving).toBeTruthy();
    const z0 = r.entity.position.z;
    game.input.enabled = true;
    game.input.pressAction('forward');
    step(2);
    game.input.releaseAction('forward');
    expect(Math.abs(r.entity.position.z - z0)).toBeGreaterThan(1);
    game.player.exitVehicle();
  });

  it('registers a map and a mode that can actually be played', async () => {
    await fresh();
    await install(`
      local ticks = 0
      global started = false
      register.map{ id = "pad", name = "Pad", spawn = {x=0, y=0, z=5}, blocks = {{pos={0,-0.5,0}, size={40,1,40}, material="concrete"}}, props = {{id="crate_wood", pos={0,0.52,0}}}, sky = "dusk" }
      register.mode{ id = "game", name = "Game", map = "pad", gravity = 5,
        on_start = function() started = true; assert(player.position() ~= nil) end,
        on_tick = function(dt) ticks = ticks + 1; if ticks == 30 then mode.finish{ win = true, title = "Done", detail = "ok" } end end,
        hud = function() return {title="Game", lines={"t " .. ticks}} end,
      }
    `);
    expect(MAPS['test_mod:pad']).toBeDefined();
    expect(MODE_INFO.get('test_mod:game')?.map).toBe('pad');
    game.startSession({ mode: 'test_mod:game' });
    expect(game.session.map).toBe('test_mod:pad');
    expect(game.rules.gravity).toBe(5);
    expect(game.mods.get('test_mod')!.host!.vm.globals.vars.get('started')).toBe(true);
    expect(game.entities.active.some((e) => e.def.id === 'crate_wood')).toBe(true);
    expect(game.nav).not.toBeNull();
    step(0.1);
    expect(game.mode?.hud()?.title).toBe('Game');
    step(1);
    expect(game.mode?.hud()?.result?.title).toBe('Done');
    expect(errorsOf(), errorsOf().join()).toEqual([]);
  });

  it('delivers events and timers, and cancels timers when the session ends', async () => {
    await fresh();
    await install(`
      global seen = {}
      local function note(name) return function(e) table.insert(seen, name) end end
      for _, n in ipairs({"session_start", "session_end", "entity_spawned", "entity_removed", "entity_damaged", "explosion", "player_damaged", "tool_selected", "tick"}) do
        if n ~= "tick" then events.on(n, note(n)) end
      end
      global ticks = 0
      events.on("tick", function(e) ticks = ticks + 1; assert(e.dt > 0) end)
      global fired = 0
      events.on("session_start", function() timer.every(0.1, function() fired = fired + 1 end) end)
    `);
    const vars = () => game.mods.get('test_mod')!.host!.vm.globals.vars;
    game.restart();
    step(0.55);
    expect(vars().get('fired')).toBeGreaterThanOrEqual(4);
    expect(vars().get('ticks')).toBeGreaterThan(30);
    const r = game.entities.spawn('crate_wood', { position: { x: 0, y: 1, z: 25 } });
    if (r.ok) { game.damageEntity(r.entity, 1, { kind: 'player' }); game.entities.remove(r.entity); }
    game.explode({ x: 0, y: 30, z: 0 }, 2, 10, 0);
    game.player.takeDamage(1, 'test');
    game.tools.selectById('blaster');
    const seen = (vars().get('seen') as import('../chaosscript').Table).list();
    for (const n of ['session_end', 'session_start', 'entity_spawned', 'entity_damaged', 'entity_removed', 'explosion', 'player_damaged', 'tool_selected']) expect(seen).toContain(n);
    const firedBefore = vars().get('fired');
    game.restart();
    expect(vars().get('fired')).toBe(firedBefore);
    expect(errorsOf()).toEqual([]);
  });

  it('calls prop hooks: spawn, tick, damage, interact, break, remove and signal', async () => {
    await fresh();
    await install(`
      global log_ = {}
      local function note(t) table.insert(log_, t) end
      register.prop{ id = "box", name = "Box", shape = {type="box", size={1,1,1}}, material = "wood", break_speed = 5, health = 10, debris = "wood",
        signal = "both", tick_rate = 0.1,
        on_spawn = function(id) note("spawn") end,
        on_tick = function(id, dt) note("tick") end,
        on_damage = function(id, a, k) note("damage:" .. k) end,
        on_interact = function(id) note("interact"); return true end, prompt = "Poke",
        on_break = function(id) note("break") end,
        on_remove = function(id) note("remove") end,
        on_signal = function(id, on) note("signal") end,
      }
    `);
    const r = game.entities.spawn('test_mod:box', { position: { x: 0, y: 1, z: 25 } });
    if (!r.ok) throw new Error('spawn');
    step(0.3);
    const comp = r.entity.components[0]!;
    expect(comp.interactHint?.()).toBe('Poke');
    comp.onInteract!();
    comp.setSignal!(true);
    game.damageEntity(r.entity, 100, { kind: 'player' });
    step(0.1);
    expect(r.entity.dead).toBe(true);
    const list = (game.mods.get('test_mod')!.host!.vm.globals.vars.get('log_') as import('../chaosscript').Table).list();
    for (const n of ['spawn', 'tick', 'damage:player', 'interact', 'break', 'remove', 'signal']) expect(list).toContain(n);
    expect(list.indexOf('spawn')).toBe(0);
  });

  it('keeps mod data in storage, across a reload', async () => {
    await fresh();
    const src = 'local n = storage.get("runs", 0)\nstorage.set("runs", n + 1)\nlog.info("runs", n + 1)';
    await install(src);
    await game.mods.reload('test_mod');
    expect(lastInfo()).toContain('runs 2');
  });

  it('refuses storage beyond the limit', async () => {
    await fresh();
    await install(`
      local big = string.rep("x", 300000)
      local r = pcall(function() storage.set("big", big) end)
      assert(not r.ok)
      log.info(r.error)
    `);
    expect(lastInfo().join()).toMatch(/over the limit/);
  });

  it('sends custom events between mods with copied data', async () => {
    await fresh();
    await install('global got = nil; events.on("bus:ping", function(e) got = e.n; e.n = 99 end)', { id: 'mod_a' });
    await install('global got = nil; events.on("bus:ping", function(e) got = e.n end)\nevents.emit("bus:ping", {n=7})', { id: 'mod_b' });
    expect(game.mods.get('mod_a')!.host!.vm.globals.vars.get('got')).toBe(7);
    expect(game.mods.get('mod_b')!.host!.vm.globals.vars.get('got')).toBe(7);
  });

  it('shows panels and menus, and removes them at the end', async () => {
    await fresh();
    await install(`
      global clicked = false
      ui.show_panel{ id = "p", title = "T", lines = {"a", "b"} }
      local b = ui.add_button{ label = "Hi", on_click = function() clicked = true end }
      events.on("demo:open", function() ui.open_menu{ title = "M", buttons = {{ label = "Go", on_click = function() clicked = "menu" end }} } end)
    `);
    expect(game.ui.get().modPanels.length).toBe(1);
    expect(game.mods.menuButtons().length).toBe(1);
    game.mods.menuButtons()[0]!.run();
    expect(game.mods.get('test_mod')!.host!.vm.globals.vars.get('clicked')).toBe(true);
    game.mods.emitCustom('demo:open', null);
    expect(game.ui.get().overlay).toBe('mod');
    game.ui.get().modMenu!.buttons[0]!.run();
    expect(game.mods.get('test_mod')!.host!.vm.globals.vars.get('clicked')).toBe('menu');
    await game.mods.setEnabled('test_mod', false);
    expect(game.ui.get().modPanels.length).toBe(0);
    expect(game.ui.get().modMenu).toBeNull();
  });
});

describe('permissions', () => {
  it('blocks what the manifest did not ask for, with instructions', async () => {
    await fresh();
    const r = await install(`
      local a = pcall(function() entity.spawn("crate_wood", {x=0, y=1, z=25}) end)
      local b = pcall(function() fx.burst({x=0, y=1, z=0}, 5, 0xff0000) end)
      local c = pcall(function() player.set_health(1) end)
      local d = pcall(function() storage.set("a", 1) end)
      local e = pcall(function() ui.toast("x") end)
      local f = pcall(function() game.set_gravity(1) end)
      local g = pcall(function() register.prop{ id="x", name="x", shape={type="sphere", r=1} } end)
      log.info(a.error)
      assert(not a.ok and not b.ok and not c.ok and not d.ok and not e.ok and not f.ok and not g.ok)
      assert(entity.exists(-1) == false)
    `, { permissions: [] });
    expect(r.state).toBe('loaded');
    expect(lastInfo()[0]).toMatch(/needs the "world" permission. Add "world" to "permissions" in mod.json/);
    expect(game.player.health).toBe(100);
  });
});

describe('error isolation', () => {
  it('reports a syntax error without loading anything', async () => {
    await fresh();
    const r = await game.mods.installBundle(bundle('register.prop{ id = "x"\nthis is broken'));
    expect(r.errors[0]).toMatch(/main.chaos:2/);
    expect(game.mods.get('test_mod')).toBeUndefined();
  });

  it('rolls back everything when a script fails partway through loading', async () => {
    await fresh();
    const r = await install(`
      register.material{ id = "m", name = "M", friction = 1, restitution = 0, density = 10 }
      register.prop{ id = "ok", name = "OK", shape = {type="sphere", r=1}, material = "m" }
      register.npc{ id = "n", name = "N" }
      register.tool{ id = "t", name = "T" }
      register.map{ id = "pad", name = "P", spawn = {0,0,0}, blocks = {{pos={0,0,0}, size={1,1,1}}} }
      error("deliberate failure")
    `);
    expect(r.state).toBe('failed');
    expect(r.errors[0]).toMatch(/main.chaos:7: deliberate failure/);
    expect(catalog.has('test_mod:ok')).toBe(false);
    expect(materials.has('test_mod:m')).toBe(false);
    expect(NPC_PROFILES['test_mod:n']).toBeUndefined();
    expect(TOOL_TYPES.some((t) => t.id === 'test_mod:t')).toBe(false);
    expect(game.tools.tools.some((t) => t.id === 'test_mod:t')).toBe(false);
    expect(MAP_STORE['test_mod:pad']).toBeUndefined();
    step(0.1);
    expect(game.ui.get().error).toBeNull();
  });

  it('survives a callback that throws, and stops a mod that keeps failing', async () => {
    await fresh();
    await install('global n = 0; events.on("tick", function() n = n + 1; error("boom " .. n) end)');
    step(0.1);
    expect(errorsOf().length).toBeGreaterThan(1);
    expect(game.ui.get().error).toBeNull();
    step(1);
    const r = game.mods.get('test_mod')!;
    expect(r.host!.phase).toBe('faulted');
    const n = r.host!.vm.globals.vars.get('n');
    step(0.5);
    expect(r.host!.vm.globals.vars.get('n')).toBe(n);
    expect(game.ui.get().error).toBeNull();
  });

  it('stops an endless loop without stalling the game', async () => {
    await fresh();
    await install('events.on("tick", function() while true do end end)');
    const t = performance.now();
    step(0.1);
    expect(performance.now() - t).toBeLessThan(5000);
    expect(game.mods.get('test_mod')!.host!.phase).toBe('faulted');
    expect(errorsOf()[0]).toMatch(/ran out of its instruction budget/);
    expect(game.ui.get().error).toBeNull();
  });

  it('stops an endless loop at load time too', async () => {
    await fresh();
    const r = await install('while true do end');
    expect(r.state).toBe('failed');
    expect(r.errors[0]).toMatch(/instruction budget/);
  });

  it('keeps other mods running when one breaks', async () => {
    await fresh();
    await install('events.on("tick", function() error("bad") end)', { id: 'bad_mod' });
    await install('global n = 0; events.on("tick", function() n = n + 1 end)', { id: 'good_mod' });
    step(1);
    expect(game.mods.get('good_mod')!.host!.vm.globals.vars.get('n')).toBeGreaterThan(30);
    expect(game.mods.get('good_mod')!.state).toBe('loaded');
  });

  it('survives a throwing NPC, prop and tool hook', async () => {
    await fresh();
    await install(`
      register.npc{ id = "n", name = "N", on_think = function() error("think") end, on_damage = function() error("hurt") end }
      register.prop{ id = "p", name = "P", shape = {type="sphere", r=0.4}, on_tick = function() error("tick") end, on_interact = function() error("use") end }
      register.tool{ id = "t", name = "T", on_primary = function() error("click") end, status = function() error("status") end }
    `);
    const n = game.entities.spawn('test_mod:n', { position: { x: 0, y: 1, z: 25 } });
    const p = game.entities.spawn('test_mod:p', { position: { x: 2, y: 1, z: 25 } });
    if (!n.ok || !p.ok) throw new Error('spawn');
    step(0.2);
    game.damageEntity(n.entity, 1, { kind: 'player' });
    p.entity.components[0]!.onInteract!();
    game.tools.selectById('test_mod:t');
    game.tools.active.primaryDown();
    game.tools.active.hud();
    step(0.2);
    expect(game.ui.get().error).toBeNull();
    for (const w of ['think', 'hurt', 'tick', 'use', 'click', 'status']) expect(errorsOf().join()).toContain(w);
  });

  it('stops a mod that hoards memory', async () => {
    await fresh();
    await install(`
      global hoard = {}
      events.on("tick", function()
        local t = {}
        for i = 1, 20000 do t[i] = i end
        table.insert(hoard, t)
      end)
    `);
    step(6);
    const r = game.mods.get('test_mod')!;
    expect(r.host!.phase).toBe('faulted');
    expect(r.host!.faultReason).toMatch(/too much data/);
  });

  it('rejects bad arguments with useful messages', async () => {
    await fresh();
    const check = async (src: string, re: RegExp) => {
      const r = await install(src);
      expect(r.errors.join(), src).toMatch(re);
      await game.mods.uninstall('test_mod');
    };
    await check('entity.spawn("crate_wood", 5)', /argument 2, "position", must be a position like/);
    await check('entity.spawn("craet_wood", {x=0, y=1, z=0})', /Unknown definition "craet_wood". Did you mean "crate_wood"/);
    await check('entity.spawn()', /missing argument 1, "def"/);
    await check('vec.new(1, 2, 3, 4)', /takes at most 3 arguments/);
    await check('register.prop{ id = "x", name = "x" }', /field "shape" is required/);
    await check('register.prop{ id = "x", name = "x", shape = {type="sphere", r=1}, colour = 1 }', /unknown field "colour". Did you mean "color"/);
    await check('register.prop{ id = "x", name = "x", shape = {type="blob"} }', /unknown shape type/);
    await check('register.prop{ id = "x", name = "x", shape = {type="sphere", r=1}, body = "floppy" }', /field "body" must be one of/);
    await check('register.prop{ id = "x", name = "x", shape = {type="sphere", r=1}, material = "cheese" }', /unknown material "cheese"/);
    await check('register.prop{ id = "My:Thing", name = "x", shape = {type="sphere", r=1} }', /id "My:Thing" is invalid/);
    await check('register.prop{ id = "x", name = "x", shape = {type="sphere", r=1} }\nregister.prop{ id = "x", name = "y", shape = {type="sphere", r=1} }', /already registered "x"/);
    await check('events.on("entity_damagd", function() end)', /Did you mean "entity_damaged"/);
    await check('events.emit("nocolon")', /must contain ":"/);
    await check('ui.toast("x", "shouty")', /kind must be/);
  });

  it('catches misspelt API names before running', async () => {
    await fresh();
    const r = await game.mods.installBundle(bundle('entity.spwan("crate_wood", {x=0,y=1,z=0})\nlog.nfo("x")\nprint(undefined_name)'));
    expect(r.errors.join('\n')).toMatch(/main.chaos:1: "entity" has no "spwan". Did you mean "spawn"/);
    expect(r.errors.join('\n')).toMatch(/main.chaos:2: "log" has no "nfo"/);
    expect(r.errors.join('\n')).toMatch(/main.chaos:3: Reading unknown variable "undefined_name"/);
  });

  it('refuses register calls after loading', async () => {
    await fresh();
    await install('events.on("demo:late", function() register.prop{ id = "late", name = "x", shape = {type="sphere", r=1} } end)');
    game.mods.emitCustom('demo:late', null);
    expect(errorsOf().join()).toMatch(/can only be called while the mod is loading/);
    expect(catalog.has('test_mod:late')).toBe(false);
  });

  it('cannot overwrite core content or reach another mod\'s namespace', async () => {
    await fresh();
    const r = await install('register.prop{ id = "other:thing", name = "x", shape = {type="sphere", r=1} }');
    expect(r.errors[0]).toMatch(/invalid/);
    const def = catalog.get('crate_wood');
    await install('register.prop{ id = "crate_wood", name = "Fake", shape = {type="sphere", r=1} }', { id: 'mod_c' });
    expect(catalog.get('crate_wood')).toBe(def);
    expect(catalog.has('mod_c:crate_wood')).toBe(true);
  });
});

describe('dependencies and conflicts', () => {
  it('loads in dependency order whatever the install order', async () => {
    await fresh();
    await install('log.info("a loaded")', { id: 'mod_a', dependencies: ['mod_b'] });
    expect(game.mods.get('mod_a')!.state).toBe('blocked');
    expect(game.mods.get('mod_a')!.errors[0]).toMatch(/Needs "mod_b", which isn't installed/);
    await install('register.prop{ id = "base", name = "B", shape = {type="sphere", r=1} }', { id: 'mod_b' });
    expect(game.mods.get('mod_a')!.state).toBe('loaded');
  });

  it('lets a dependent use its dependency\'s content', async () => {
    await fresh();
    await install('register.prop{ id = "base", name = "B", shape = {type="sphere", r=1} }', { id: 'mod_b' });
    const r = await install('events.on("session_start", function() end)\nassert(game.items("props")[1] ~= nil)\nlocal e = entity.spawn("mod_b:base", {x=0, y=30, z=0})\nassert(entity.def(e) == "mod_b:base")', { id: 'mod_a', dependencies: [{ id: 'mod_b', version: '^1.0.0' }] });
    expect(r.state).toBe('loaded');
  });

  it('reports a version mismatch', async () => {
    await fresh();
    await install('', { id: 'mod_b', version: '1.0.0' });
    const r = await install('', { id: 'mod_a', dependencies: [{ id: 'mod_b', version: '^2.0.0' }] });
    expect(r.state).toBe('blocked');
    expect(r.errors[0]).toMatch(/Needs "mod_b" \^2.0.0, but version 1.0.0 is installed/);
  });

  it('allows a missing optional dependency', async () => {
    await fresh();
    const r = await install('log.info(mod.is_loaded("nothing"))', { id: 'mod_a', dependencies: [{ id: 'nothing', optional: true }] });
    expect(r.state).toBe('loaded');
    expect(lastInfo('mod_a')).toContain('false');
  });

  it('detects dependency cycles', async () => {
    await fresh();
    await install('', { id: 'mod_a', dependencies: ['mod_b'] });
    await install('', { id: 'mod_b', dependencies: ['mod_a'] });
    expect(game.mods.get('mod_a')!.state).toBe('blocked');
    expect(game.mods.get('mod_b')!.errors[0]).toMatch(/cycle/);
  });

  it('blocks dependents of a failed or disabled mod, then recovers', async () => {
    await fresh();
    await install('', { id: 'mod_b' });
    await install('', { id: 'mod_a', dependencies: ['mod_b'] });
    await game.mods.setEnabled('mod_b', false);
    expect(game.mods.get('mod_a')!.state).toBe('blocked');
    expect(game.mods.get('mod_a')!.errors[0]).toMatch(/disabled/);
    await game.mods.setEnabled('mod_b', true);
    expect(game.mods.get('mod_a')!.state).toBe('loaded');
    await game.mods.editFile('mod_b', 'main.chaos', 'error("broken now")');
    expect(game.mods.get('mod_b')!.state).toBe('failed');
    expect(game.mods.get('mod_a')!.state).toBe('blocked');
    await game.mods.editFile('mod_b', 'main.chaos', 'log.info("fixed")');
    expect(game.mods.get('mod_a')!.state).toBe('loaded');
  });

  it('detects declared conflicts', async () => {
    await fresh();
    await install('', { id: 'mod_a' });
    const r = await install('', { id: 'mod_b', conflicts: ['mod_a'] });
    expect(game.mods.get('mod_a')!.state).toBe('loaded');
    expect(r.state).toBe('blocked');
    expect(r.errors[0]).toMatch(/Conflicts with "mod_a"/);
    await game.mods.setEnabled('mod_a', false);
    expect(game.mods.get('mod_b')!.state).toBe('loaded');
  });

  it('refuses an incompatible API version', async () => {
    await fresh();
    const r = await game.mods.installBundle(bundle('', { api: '9.0' }));
    expect(r.errors[0]).toMatch(/needs API version 9.0/);
  });

  it('reports missing files', async () => {
    await fresh();
    const b = bundle('');
    b.files = {};
    expect((await game.mods.installBundle(b)).errors[0]).toMatch(/file is missing/);
  });
});

describe('load, unload and reload', () => {
  it('unloads completely and loads again', async () => {
    await fresh();
    const src = `
      register.material{ id = "m", name = "M", friction = 1, restitution = 0, density = 10 }
      register.prop{ id = "p", name = "P", shape = {type="sphere", r=0.5}, material = "m" }
      register.npc{ id = "n", name = "N" }
      register.tool{ id = "t", name = "T" }
      register.weapon{ id = "w", name = "W" }
      register.vehicle{ id = "v", name = "V", size = {1, 0.5, 2} }
      register.map{ id = "pad", name = "P", spawn = {0,0,0}, blocks = {{pos={0,-1,0}, size={9,1,9}}} }
      register.mode{ id = "g", name = "G" }
      register.sound{ id = "s", layers = {{freq=440, dur=0.1, vol=0.1}} }
      register.effect{ id = "e", name = "E", on_use = function(p) end }
      global ticks = 0
      events.on("tick", function() ticks = ticks + 1 end)
      ui.show_panel{ id = "x", lines = {"hello"} }
    `;
    const items0 = catalog.list().length;
    const tools0 = game.tools.tools.length;
    const r = await install(src);
    expect(r.state).toBe('loaded');
    expect(r.content.items.length).toBe(6);
    expect(r.content.tools.length).toBe(2);
    expect(game.tools.tools.length).toBe(tools0 + 2);
    const p = game.entities.spawn('test_mod:p', { position: { x: 0, y: 1, z: 25 } });
    game.tools.selectById('test_mod:t');
    step(0.2);

    await game.mods.setEnabled('test_mod', false);
    const after = game.mods.get('test_mod')!;
    expect(after.state).toBe('disabled');
    expect(after.host).toBeNull();
    expect(catalog.list().length).toBe(items0);
    expect(game.tools.tools.length).toBe(tools0);
    expect(game.tools.active.id).toBe('manipulator');
    expect(materials.has('test_mod:m')).toBe(false);
    expect(NPC_PROFILES['test_mod:n']).toBeUndefined();
    expect(MODE_INFO.has('test_mod:g')).toBe(false);
    expect(MAPS['test_mod:pad']).toBeUndefined();
    if (p.ok) expect(p.entity.dead).toBe(true);
    expect(game.ui.get().modPanels.length).toBe(0);
    step(0.2);
    expect(game.ui.get().error).toBeNull();

    await game.mods.setEnabled('test_mod', true);
    expect(game.mods.get('test_mod')!.state).toBe('loaded');
    expect(catalog.has('test_mod:p')).toBe(true);
    expect(game.tools.tools.length).toBe(tools0 + 2);
    expect(errorsOf()).toEqual([]);
  });

  it('picks up an edited script on reload, keeping placed objects', async () => {
    await fresh();
    await install(`register.prop{ id = "p", name = "Old name", shape = {type="box", size={1,1,1}}, material = "wood", color = 0xff0000 }`);
    const r = game.entities.spawn('test_mod:p', { position: { x: 1, y: 0.6, z: 25 } });
    if (!r.ok) throw new Error('spawn');
    step(0.5);
    const at = { ...r.entity.position };
    const after = await game.mods.editFile('test_mod', 'main.chaos', `register.prop{ id = "p", name = "New name", shape = {type="box", size={1,1,1}}, material = "metal", color = 0x00ff00 }
      log.info("second version")`);
    expect(after!.state).toBe('loaded');
    expect(lastInfo()).toContain('second version');
    expect(catalog.get('test_mod:p')!.name.en).toBe('New name');
    expect(r.entity.dead).toBe(true);
    const kept = game.entities.active.filter((e) => e.def.id === 'test_mod:p');
    expect(kept.length).toBe(1);
    expect(kept[0]!.def.material).toBe('metal');
    expect(Math.hypot(kept[0]!.position.x - at.x, kept[0]!.position.z - at.z)).toBeLessThan(0.1);
  });

  it('reports a broken edit, then recovers with the next one', async () => {
    await fresh();
    await install('register.prop{ id = "p", name = "P", shape = {type="sphere", r=0.5} }');
    game.entities.spawn('test_mod:p', { position: { x: 0, y: 1, z: 25 } });
    let r = await game.mods.editFile('test_mod', 'main.chaos', 'register.prop{ id = ');
    expect(r!.state).toBe('invalid');
    expect(r!.errors[0]).toMatch(/main.chaos:1/);
    expect(catalog.has('test_mod:p')).toBe(false);
    step(0.1);
    expect(game.ui.get().error).toBeNull();
    r = await game.mods.editFile('test_mod', 'main.chaos', 'register.prop{ id = "p", name = "P2", shape = {type="sphere", r=0.5} }');
    expect(r!.state).toBe('loaded');
    expect(catalog.get('test_mod:p')!.name.en).toBe('P2');
  });

  it('reloads dependents along with their dependency', async () => {
    await fresh();
    await install('register.prop{ id = "b", name = "B", shape = {type="sphere", r=0.5} }', { id: 'mod_b' });
    await install('global loads = 0; log.info("a loaded")', { id: 'mod_a', dependencies: ['mod_b'] });
    const before = lastInfo('mod_a').filter((x) => x === 'a loaded').length;
    await game.mods.reload('mod_b');
    expect(lastInfo('mod_a').filter((x) => x === 'a loaded').length).toBe(before + 1);
    expect(game.mods.get('mod_a')!.state).toBe('loaded');
  });

  it('respects hot_reload = false during a session', async () => {
    await fresh();
    await install('log.info("run")', { hot_reload: false });
    await game.mods.reload('test_mod');
    expect(lastInfo().filter((x) => x === 'run').length).toBe(1);
    expect(game.mods.logs.some((l) => l.level === 'warn' && /hot_reload/.test(l.text))).toBe(true);
  });

  it('leaves the session when its own map is unloaded, and restarts it on reload', async () => {
    await fresh();
    await install('register.map{ id = "pad", name = "P", spawn = {0,0,0}, blocks = {{pos={0,-1,0}, size={30,1,30}}} }');
    game.startSession({ map: 'test_mod:pad' });
    expect(game.session.map).toBe('test_mod:pad');
    await game.mods.reload('test_mod');
    expect(game.session.map).toBe('test_mod:pad');
    expect(game.ui.get().screen).toBe('playing');
    await game.mods.setEnabled('test_mod', false);
    expect(game.ui.get().screen).toBe('menu');
    game.startSession();
  });

  it('remembers enabled state and installed mods through a restart of the game', async () => {
    await fresh();
    await install('log.info("first")', { id: 'mod_a' });
    await install('log.info("first")', { id: 'mod_b' });
    await game.mods.setEnabled('mod_b', false);
    const db = game.saves.db;
    game.mods.unloadAll();
    const second = new Game();
    (second.saves as { db: typeof db }).db = db;
    await second.mods.restore();
    expect(second.mods.get('mod_a')!.state).toBe('loaded');
    expect(second.mods.get('mod_b')!.state).toBe('disabled');
    second.dispose();
    await db.delete('mods', 'mod_a');
    await db.delete('mods', 'mod_b');
  });

  it('round-trips the bundle format and rejects bad files', () => {
    const b = bundle('log.info("x")');
    const back = parseBundleText(bundleToText(b));
    expect(back.files).toEqual(b.files);
    expect(back.manifest).toBe(b.manifest);
    expect(() => parseBundleText('nope')).toThrow(/not JSON/);
    expect(() => parseBundleText('{"a":1}')).toThrow(/not a .chaosmod.json/);
    expect(parseBundleText(JSON.stringify({ format: 'chaosmod-1', manifest: '{}', files: { '../x.chaos': 'a', 'ok.chaos': 'b' } })).files).toEqual({ 'ok.chaos': 'b' });
  });

  it('installs from a folder listing and validates it', async () => {
    await fresh();
    const b = bundle('log.info("from folder")');
    const r = await game.mods.installFiles([{ path: 'my_folder/mod.json', text: b.manifest }, { path: 'my_folder/main.chaos', text: b.files['main.chaos'] }, { path: 'my_folder/notes.txt', text: 'ignored' }]);
    expect(r.errors).toEqual([]);
    expect(r.record!.state).toBe('loaded');
    expect((await game.mods.installFiles([{ path: 'x/readme.md', text: 'x' }])).errors[0]).toMatch(/no mod.json/);
  });

  it('runs the debug console safely', async () => {
    await fresh();
    expect(game.mods.evaluate('1 + 2')).toEqual({ ok: true, text: '3' });
    expect(game.mods.evaluate('local x = 5\nlog.info(x)').ok).toBe(true);
    expect(game.mods.evaluate('player.health()').text).toBe('100');
    expect(game.mods.evaluate('nope.x').ok).toBe(false);
    expect(game.mods.evaluate('while true do end').ok).toBe(false);
    expect(game.mods.evaluate('if').ok).toBe(false);
    expect(game.ui.get().error).toBeNull();
  });
});

describe('API documentation contract', () => {
  it('every function has docs and an example', () => {
    for (const f of ALL_API) {
      expect(f.doc.length, `${f.ns}.${f.name}`).toBeGreaterThan(5);
      expect(f.example.length, `${f.ns}.${f.name}`).toBeGreaterThan(3);
    }
  });

  it('every example runs against a real game', async () => {
    await fresh();
    const failures: string[] = [];
    for (const f of ALL_API) {
      const r = await game.mods.installBundle(bundle(f.example, { id: 'example_mod' }));
      if (r.errors.length) failures.push(`${f.ns}.${f.name}: ${r.errors.join('; ')}`);
      else if (r.record?.state !== 'loaded') failures.push(`${f.ns}.${f.name}: ${r.record?.errors.join('; ')}`);
      await game.mods.uninstall('example_mod');
      if (!game.physics.world) game.startSession();
      if (game.player.dead) game.player.respawn();
      if (game.ui.get().overlay) game.setOverlay(null);
    }
    expect(failures.join('\n')).toBe('');
  }, 120000);
});
