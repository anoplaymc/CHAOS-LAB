import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Game, defaultRules } from '../game/core/Game';
import { NpcComponent } from '../game/npcs/NpcComponent';
import { serializeScene } from '../game/save/sceneIO';
import { VehicleComponent } from '../game/vehicles/VehicleComponent';
import { readFolder } from '../modding/cli';
import type { FormControl } from '../modding/form';
import { parseManifest } from '../modding/manifest';
import { BuiltinSource } from '../modding/sources';
import { spawn } from './helpers';

const ID = 'chaos_overdrive';
let game: Game;
let whenOff: Record<string, unknown>;

const errors = () => game.mods.logs.filter((l) => l.level === 'error').map((l) => `${l.mod}: ${l.text}`);
const form = () => game.ui.get().modForm!;
const toasts = () => game.ui.get().toasts.map((t) => t.text);
const open = () => { if (game.ui.get().overlay !== 'modform') expect(game.mods.handleKey('F6')).toBe(true); expect(game.ui.get().overlay).toBe('modform'); };
const close = () => { if (game.ui.get().overlay === 'modform') game.mods.handleKey('F6'); expect(game.ui.get().overlay).toBeNull(); };
const nav = (id: string) => { open(); form().send('nav', id, null); };
const send = (id: string, value: boolean | number | string = true) => form().send('control', id, value);
const controls = () => form().sections.flatMap((s) => s.controls);
const control = (id: string) => controls().find((c) => 'id' in c && c.id === id) as Extract<FormControl, { id: string }> | undefined;
const yes = () => { expect(form().confirm).not.toBeNull(); send('confirm_yes'); };

/** Uses the menu the way the panel does, on the named page. */
const set = (page: string, id: string, value: boolean | number | string = true) => { nav(page); expect(control(id), `${id} on ${page}`).toBeDefined(); send(id, value); };

function aim(p: { x: number; y: number; z: number }): void {
  const a = game.aimRay();
  const dx = p.x - a.origin.x;
  const dy = p.y - a.origin.y;
  const dz = p.z - a.origin.z;
  game.player.yaw = Math.atan2(-dx, -dz);
  game.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  game.player.updateCamera(game.camera, 1, 0);
}

function selectEntity(id: number): void {
  // A new collider can't be hit until the world has stepped.
  game.advance(0.05);
  const e = game.entities.get(id)!;
  aim(e.position);
  game.mods.handleKey('F7');
}

/** From one wall of the spawn room toward the other. */
const walked = (seconds: number) => {
  game.player.teleport({ x: 6, y: 1.2, z: 29 }, Math.PI / 2);
  game.advance(0.2);
  const a = game.player.position;
  const start = { x: a.x, z: a.z };
  game.input.pressAction('forward');
  game.advance(seconds);
  game.input.releaseAction('forward');
  const b = game.player.position;
  return Math.hypot(b.x - start.x, b.z - start.z);
};

async function enable(): Promise<void> {
  const r = await game.mods.installBundle(readFolder(`mods/${ID}`));
  expect(r.errors).toEqual([]);
  await game.mods.setEnabled(ID, true);
  expect(game.mods.get(ID)!.state).toBe('loaded');
}

// The mod is published from its own repository, so a checkout of the game may not have it.
describe.runIf(existsSync(`mods/${ID}/mod.json`))('CHAOS OVERDRIVE', () => {
beforeAll(async () => {
  await Game.init();
  game = new Game();
  game.input.virtualLock = true;
  game.mods.addSource(new BuiltinSource());
  await game.mods.restore();
  // Before anything turns it on, in a session exactly as a player would have it.
  game.startSession();
  const r = game.mods.get(ID)!;
  whenOff = { byDefault: r.manifest!.enabled_by_default, enabled: r.enabled, state: r.state, host: r.host !== null, key: game.mods.handleKey('F6'), overrides: game.sandbox.keysOf(ID).length, button: game.mods.menuButtons().some((b) => b.mod === 'CHAOS OVERDRIVE'), timeScale: game.sandbox.timeScale, god: game.player.god };
});

afterAll(() => game.dispose());

beforeEach(async () => {
  if (game.mods.get(ID)?.state !== 'loaded') await enable();
  game.startSession();
  game.mods.clearLog();
  // Each test starts from a clean profile, whatever the last one left.
  open();
  form().send('nav', 'player', null);
  send('footer_stop');
  close();
  game.mods.clearLog();
});

describe('switched off', () => {
  it('ships off by default, and a game with it off has nothing of it', () => {
    expect(whenOff).toEqual({ byDefault: false, enabled: false, state: 'disabled', host: false, key: false, overrides: 0, button: false, timeScale: 1, god: false });
  });

  it('asks for only the permissions it uses, and no network or file access exists to ask for', () => {
    const m = parseManifest(JSON.parse(readFolder(`mods/${ID}`).manifest)).manifest!;
    expect(m.permissions).toEqual(['world', 'player', 'effects', 'ui', 'storage', 'sandbox']);
  });
});

describe('the menu', () => {
  it('opens and closes with F6, frees the mouse, and has all 14 categories', () => {
    open();
    expect(game.input.enabled).toBe(false);
    expect(form().title).toBe('CHAOS OVERDRIVE');
    expect(form().subtitle).toContain('v1.0.0');
    expect(form().subtitle).toContain('Running');
    expect(form().nav.map((n) => n.label)).toEqual(['Player', 'Movement', 'Physics', 'NPC Control', 'Weapons & Items', 'Vehicles', 'World Control', 'Spawning', 'Visuals', 'Time & Weather', 'Teleportation', 'Fun & Chaos', 'Mod Tools', 'Profiles & Settings']);
    close();
    expect(game.input.enabled).toBe(true);
  });

  it('also opens from the Mod Menu, and stays open', () => {
    game.setOverlay('mod');
    const b = game.mods.menuButtons().find((x) => x.mod === 'CHAOS OVERDRIVE')!;
    b.run();
    expect(game.ui.get().overlay).toBe('modform');
    close();
  });

  it('every control on every page works, or reports a problem without breaking anything', () => {
    // A little of everything to act on, so the "selected" rows appear.
    const crate = spawn(game, 'crate_wood', 2, 1, 26);
    const guard = spawn(game, 'npc_guard', -2, 1, 26);
    const buggy = spawn(game, 'buggy', 0, 1, 24);
    selectEntity(buggy.id);
    selectEntity(guard.id);
    selectEntity(crate.id);
    open();
    let used = 0;
    const seen = new Set<string>();
    // Each of these is tested by itself below. Here they'd leave things behind for later controls and later tests.
    const destructive = /remove|delete|footer_close|respawn|tp_|veh_enter|veh_teleport|point_go|point_save|profile_new|set_capture|import_run|equip\|/;
    for (const n of form().nav) {
      nav(n.id);
      for (const c of controls()) {
        if (!('id' in c)) continue;
        if (seen.has(c.id) || destructive.test(c.id)) continue;
        seen.add(c.id);
        used++;
        if (game.ui.get().overlay !== 'modform') open();
        if (c.type === 'button' && !c.disabled) send(c.id);
        else if (c.type === 'toggle') { send(c.id, !c.value); game.advance(0.05); send(c.id, c.value); }
        else if (c.type === 'slider') { send(c.id, c.max); game.advance(0.05); send(c.id, c.value); }
        else if (c.type === 'select' && c.options[0]) { send(c.id, c.options[0].value); send(c.id, c.value); }
        else if (c.type === 'input') send(c.id, 'test');
        if (form().confirm) send('confirm_no');
        game.advance(0.05);
        if (game.ui.get().overlay !== 'modform') open();
        form().send('nav', n.id, null);
      }
    }
    game.advance(1);
    expect(used).toBeGreaterThan(90);
    expect(errors()).toEqual([]);
    expect(game.mods.get(ID)!.host!.phase).toBe('running');
    expect(game.ui.get().error).toBeNull();
  }, 60000);

  it('finds functions by name, across pages', () => {
    open();
    send('search', 'noclip');
    const ids = controls().flatMap((c) => ('id' in c ? [c.id] : []));
    expect(ids).toContain('noclip');
    expect(ids).not.toContain('god');
    expect(form().sections[0]!.title).toContain('Movement');
    send('search', 'zzzzz');
    expect(JSON.stringify(controls())).toContain('Nothing matches');
    send('search', '');
    close();
  });

  it('shows active effects, and resets one or all of them', () => {
    set('player', 'god', true);
    set('movement', 'speed', 3);
    expect(form().chips.map((c) => c.id)).toEqual(expect.arrayContaining(['god', 'speed']));
    expect(form().nav.find((n) => n.id === 'player')!.badge).toBe('1');
    form().send('reset', 'speed', null);
    expect(game.player.speedScale).toBe(1);
    expect(game.player.god).toBe(true);
    form().send('chip', 'god', null);
    expect(game.player.god).toBe(false);
    expect(form().chips).toEqual([]);
    close();
  });

  it('tells the player what happened, including when it fails', () => {
    set('physics', 'sel_stop');
    expect(toasts().join()).toContain('Select an object first');
    expect(game.mods.get(ID)!.host!.errorCount).toBe(0);
    set('player', 'heal');
    expect(toasts().join()).toContain('Health restored');
    close();
  });

  it('keys can be changed, refuse the game\'s own, and persist', () => {
    set('profiles', 'key_menu', 'KeyG');
    expect(toasts().join()).toContain('reserved');
    send('key_menu', 'F7');
    expect(toasts().join()).toContain('already used');
    send('key_menu', 'F9');
    expect(game.mods.handleKey('F6')).toBe(false);
    game.mods.handleKey('F9');
    expect(game.ui.get().overlay).toBeNull();
    game.mods.handleKey('F9');
    expect(game.ui.get().overlay).toBe('modform');
    send('key_menu', 'F6');
    close();
    expect(errors()).toEqual([]);
  });
});

describe('player and movement', () => {
  it('God Mode really blocks damage, and turning it off really restores damage', () => {
    set('player', 'god', true);
    close();
    game.player.takeDamage(90, 'test');
    expect(game.player.health).toBe(100);
    set('player', 'god', false);
    close();
    game.player.takeDamage(30, 'test');
    expect(game.player.health).toBe(70);
  });

  it('Invulnerable uses the damage rule, without affecting what a save records', () => {
    set('player', 'invulnerable', true);
    close();
    expect(game.rules.damage).toBe(false);
    expect(serializeScene(game, 't', 'scene').rules.damage).toBe(true);
  });

  it('speed really changes how far the player walks', () => {
    const normal = walked(1);
    set('movement', 'speed', 3);
    close();
    const fast = walked(1);
    expect(fast).toBeGreaterThan(normal * 1.8);
    expect(normal).toBeGreaterThan(1);
  });

  it('jump height really changes how high the player goes', () => {
    const takeOff = () => {
      game.advance(1);
      expect(game.player.grounded).toBe(true);
      game.player.queueJump();
      game.advance(1 / 60);
      return game.player.velocity.y;
    };
    const normal = takeOff();
    expect(normal).toBeGreaterThan(3);
    set('movement', 'jump', 4);
    close();
    // Speed goes with the square root of height.
    expect(takeOff()).toBeCloseTo(normal * 2, 0);
  });

  it('player gravity changes only what the player feels', () => {
    set('movement', 'player_gravity', 0);
    close();
    expect(game.player.gravityScale).toBe(0);
    expect(game.rules.gravity).toBe(9.81);
    const y = game.player.position.y;
    game.player.setVerticalVelocity(1);
    game.advance(1);
    expect(game.player.position.y).toBeGreaterThan(y + 0.8);
  });

  it('Free Flight stops at a wall, and No Clip goes through it', () => {
    const flyInto = () => {
      game.player.teleport({ x: 0, y: 2, z: 29 }, Math.PI);
      game.player.pitch = 0;
      game.input.pressAction('forward');
      game.advance(3);
      game.input.releaseAction('forward');
      return game.player.position.z;
    };
    set('movement', 'fly', true);
    close();
    expect(game.player.flying).toBe(true);
    const stopped = flyInto();
    set('movement', 'noclip', true);
    close();
    const through = flyInto();
    expect(through).toBeGreaterThan(stopped + 5);
    set('movement', 'noclip', false);
    set('movement', 'fly', false);
    close();
    expect(game.player.flying).toBe(false);
  });

  it('flight works in a mode whose rules forbid it, and is lost cleanly with a vehicle', () => {
    game.rules.flight = false;
    set('movement', 'fly', true);
    close();
    expect(game.player.flying).toBe(true);
    game.player.toggleFlight();
    expect(game.player.flying).toBe(true);
    const buggy = spawn(game, 'buggy', 2, 1, 26);
    buggy.component(VehicleComponent)!.onInteract();
    expect(game.player.flying).toBe(false);
    game.advance(0.5);
    nav('movement');
    expect((control('fly') as { value: boolean }).value).toBe(false);
    close();
    game.player.exitVehicle();
  });

  it('saved teleport points survive a new session and work', () => {
    game.player.teleport({ x: 3, y: 2, z: 27 });
    nav('teleport');
    send('point_name', 'Test Point');
    send('point_save');
    close();
    game.startSession();
    nav('teleport');
    expect(controls().some((c) => c.type === 'button' && c.label === 'Go: Test Point')).toBe(true);
    send('point_go|1');
    expect(game.player.position.x).toBeCloseTo(3, 0);
    send('point_delete|1');
    expect(controls().some((c) => c.type === 'button' && c.label === 'Go: Test Point')).toBe(false);
    close();
  });
});

describe('physics', () => {
  it('gravity multiplier and Gravity Off really change the world', () => {
    set('physics', 'gravity', 2);
    expect(game.physics.w.gravity.y).toBeCloseTo(-19.62);
    send('zero_g', true);
    expect(game.physics.w.gravity.y).toBeCloseTo(0);
    const crate = spawn(game, 'crate_small', -3, 2.5, 26);
    close();
    game.advance(0.5);
    expect(crate.position.y).toBeCloseTo(2.5, 1);
    set('physics', 'zero_g', false);
    set('physics', 'gravity', 1);
    close();
    expect(game.rules.gravity).toBe(9.81);
  });

  it('a save made while gravity is changed keeps the real gravity', () => {
    set('physics', 'gravity', 3);
    close();
    expect(game.rules.gravity).toBeCloseTo(29.43);
    expect(serializeScene(game, 't', 'scene').rules.gravity).toBe(9.81);
    set('physics', 'gravity', 1);
    close();
    expect(serializeScene(game, 't', 'scene').rules.gravity).toBe(9.81);
  });

  it('pausing physics holds objects and gives their motion back, while the player still moves', () => {
    const crate = spawn(game, 'crate_wood', 2, 8, 26);
    game.advance(0.2);
    const fallingAt = crate.body!.linvel().y;
    set('physics', 'world_frozen', true);
    close();
    const held = crate.position.y;
    const late = spawn(game, 'crate_small', -2, 8, 26);
    game.advance(0.5);
    expect(crate.position.y).toBe(held);
    expect(late.position.y).toBe(8);
    expect(walked(0.5)).toBeGreaterThan(0.5);
    set('physics', 'world_frozen', false);
    close();
    expect(crate.body!.linvel().y).toBeCloseTo(fallingAt, 3);
    game.advance(0.3);
    expect(crate.position.y).toBeLessThan(held);
    expect(late.position.y).toBeLessThan(8);
  });

  it('selected object: select, mass, freeze, push, carry and restore', () => {
    const crate = spawn(game, 'crate_wood', 2, 1, 26);
    game.advance(0.5);
    const mass = crate.mass;
    selectEntity(crate.id);
    expect(toasts().join()).toContain('Selected');
    set('physics', 'sel_mass', 500);
    game.advance(0.05);
    expect(crate.mass).toBeCloseTo(500, 0);
    send('sel_material', 'ice');
    expect(crate.materialId).toBe('ice');
    send('sel_scale', 2);
    expect(crate.scale).toBe(2);
    send('sel_frozen', true);
    expect(crate.anchored).toBe(true);
    send('sel_frozen', false);
    send('push_dir', 'up');
    send('sel_push');
    expect(crate.body!.linvel().y).toBeGreaterThan(5);
    send('sel_carry', true);
    close();
    game.advance(0.2);
    const eye = game.player.eye;
    expect(Math.hypot(crate.position.x - eye.x, crate.position.y - eye.y, crate.position.z - eye.z)).toBeLessThan(3.6);
    set('physics', 'sel_carry', false);
    send('sel_restore');
    game.advance(0.05);
    expect(crate.scale).toBe(1);
    expect(crate.materialId).toBe('wood');
    expect(crate.mass).toBeCloseTo(mass, 1);
    close();
  });
});

describe('NPCs', () => {
  it('creates from the catalog, and shows real state', () => {
    aim({ x: 0, y: 0, z: 24 });
    set('npc', 'npc_type', 'npc_guard');
    send('npc_spawn');
    const n = game.npcs[game.npcs.length - 1]!;
    expect(n.e.def.id).toBe('npc_guard');
    expect(JSON.stringify(controls())).toContain('faction lab');
    send('npc_clear');
    yes();
    expect(n.e.dead).toBe(true);
    close();
  });

  it('stopping the AI really stops it, and resuming really resumes it', () => {
    const e = spawn(game, 'npc_robot', 3, 1, 26);
    selectEntity(e.id);
    set('npc', 'npc_ai', false);
    close();
    const n = e.component(NpcComponent)!;
    game.advance(0.5);
    const a = { ...e.position };
    game.advance(2);
    expect(Math.hypot(e.position.x - a.x, e.position.z - a.z)).toBeLessThan(0.05);
    expect(n.targetEntity).toBeNull();
    set('npc', 'npc_ai', true);
    close();
    game.advance(2);
    expect(n.targetEntity).toBe('player');
  });

  it('invulnerability, health and freezing work on one NPC', () => {
    const e = spawn(game, 'npc_guard', 3, 1, 26);
    selectEntity(e.id);
    set('npc', 'npc_invulnerable', true);
    game.damageEntity(e, 5000, { kind: 'player' });
    expect(e.dead).toBe(false);
    expect(e.health).toBe(e.maxHealth);
    send('npc_invulnerable', false);
    game.damageEntity(e, 5, { kind: 'other' });
    expect(e.health).toBe(e.maxHealth - 5);
    send('npc_heal');
    expect(e.health).toBe(e.maxHealth);
    send('npc_frozen', true);
    expect(e.anchored).toBe(true);
    send('npc_frozen', false);
    close();
  });

  it('stance decides who it fights, without touching other NPCs of its type', () => {
    const a = spawn(game, 'npc_guard', 2, 1, 26);
    const b = spawn(game, 'npc_guard', -2, 1, 26);
    const na = a.component(NpcComponent)!;
    const nb = b.component(NpcComponent)!;
    expect(na.isHostileToPlayer).toBe(false);
    selectEntity(a.id);
    set('npc', 'npc_stance', 'hostile');
    expect(na.isHostileToPlayer).toBe(true);
    expect(nb.isHostileToPlayer).toBe(false);
    close();
    game.advance(1.5);
    expect(na.targetEntity).toBe('player');
    set('npc', 'npc_stance', 'neutral');
    expect(na.faction).toBe('neutral');
    send('npc_stance', 'default');
    expect(na.stance).toBeNull();
    close();
  });

  it('speed and detection scale one NPC, and never the shared type', () => {
    const a = spawn(game, 'npc_guard', 2, 1, 26);
    const b = spawn(game, 'npc_guard', -2, 1, 26);
    const na = a.component(NpcComponent)!;
    const sight = na.profile.sight;
    selectEntity(a.id);
    set('npc', 'npc_detection', 3);
    send('npc_speed', 2);
    expect(na.sightRange).toBeCloseTo(sight * 3);
    expect(na.speedScale).toBe(2);
    expect(b.component(NpcComponent)!.sightRange).toBe(sight);
    expect(na.profile.sight).toBe(sight);
    close();
  });

  it('follow and patrol orders are given, and mass actions ask first', () => {
    const a = spawn(game, 'npc_guard', 2, 1, 26);
    const b = spawn(game, 'npc_technician', -2, 1, 26);
    selectEntity(a.id);
    set('npc', 'npc_follow');
    const na = a.component(NpcComponent)!;
    expect(na.order.kind).toBe('follow');
    send('npc_patrol');
    expect(na.order.kind).toBe('patrol');
    send('npc_stop');
    expect(na.order.kind).toBe('none');
    send('npc_mass_action', 'remove');
    send('npc_mass_run');
    expect(a.dead).toBe(false);
    send('confirm_no');
    expect(a.dead).toBe(false);
    send('npc_mass_run');
    yes();
    expect(a.dead).toBe(true);
    expect(b.dead).toBe(true);
    close();
  });
});

describe('weapons and vehicles', () => {
  it('equips from the real catalog, and damage tuning changes real hits', () => {
    set('weapons', 'equip|blaster');
    expect(game.player && game.tools.active.id).toBe('blaster');
    const crate = spawn(game, 'concrete_block', 2, 1, 26);
    game.advance(0.3);
    const before = crate.health;
    send('weapon_damage', 5);
    game.damageEntity(crate, 2, { kind: 'player' });
    expect(before - crate.health).toBe(10);
    game.damageEntity(crate, 2, { kind: 'other' });
    expect(before - crate.health).toBe(12);
    close();
  });

  it('infinite energy keeps weapons firing, where normally they overheat', () => {
    const fire = () => {
      game.tools.selectById('blaster');
      game.tools.active.reset();
      game.player.pitch = -1.5;
      game.tools.active.primaryDown();
      let shots = 0;
      for (let i = 0; i < 360; i++) {
        game.advance(1 / 60);
        if (game.tools.active.hud().overheated) shots++;
      }
      game.tools.active.primaryUp();
      return shots;
    };
    expect(fire()).toBeGreaterThan(0);
    set('player', 'infinite_energy', true);
    close();
    expect(fire()).toBe(0);
  });

  it('Unlock All Tools lifts a mode\'s limit, and puts it back', () => {
    game.tools.setAllowed(['manipulator']);
    expect(game.tools.isAllowed(game.tools.tools[6]!)).toBe(false);
    set('weapons', 'unlock_tools', true);
    expect(game.tools.isAllowed(game.tools.tools[6]!)).toBe(true);
    send('unlock_tools', false);
    expect(game.tools.isAllowed(game.tools.tools[6]!)).toBe(false);
    game.tools.setAllowed(null);
    close();
  });

  it('vehicles: created, tuned per vehicle, entered, rights itself and is cleared', () => {
    aim({ x: 0, y: 0, z: 22 });
    set('vehicles', 'veh_type', 'buggy');
    send('veh_spawn');
    const e = game.entities.active.find((x) => x.def.id === 'buggy' && !x.fixture && game.sandbox.isTracked(x.id))!;
    const other = spawn(game, 'buggy', 5, 1, 30);
    const v = e.component(VehicleComponent)!;
    nav('vehicles');
    send('veh_engine', 3);
    send('veh_top', 2);
    expect(v.engineScale).toBe(3);
    expect(v.topSpeedScale).toBe(2);
    expect(other.component(VehicleComponent)!.engineScale).toBe(1);
    send('veh_enter');
    expect(game.player.driving).toBe(v);
    game.player.exitVehicle();
    send('veh_repair');
    expect(e.dead).toBe(false);
    send('veh_clear');
    yes();
    expect(e.dead).toBe(true);
    expect(other.dead).toBe(false);
    close();
  });
});

describe('time, light and visuals', () => {
  it('time scale really changes how much simulated time passes', () => {
    const run = () => { const t = game.time; game.advance(1); return game.time - t; };
    const normal = run();
    set('time', 'time_scale', 0.5);
    close();
    expect(run()).toBeCloseTo(normal * 0.5, 0);
    set('time', 'time_scale', 2);
    close();
    expect(run()).toBeCloseTo(normal * 2, 0);
    set('time', 'time_scale', 1);
    close();
    expect(game.sandbox.timeScale).toBe(1);
  });

  it('light, fog and time of day change the real scene, and come back', () => {
    const h = () => game.lightingHandles()!;
    const was = { sun: h().sun.intensity, fog: h().fog.density, hemi: h().hemi.intensity, color: h().sun.color.getHex() };
    set('world', 'sun', 3);
    expect(h().sun.intensity).toBeCloseTo(was.sun * 3);
    send('fog', 4);
    expect(h().fog.density).toBeCloseTo(was.fog * 4);
    set('time', 'use_hour', true);
    send('hour', 0);
    const night = h().sun.intensity;
    send('hour', 12);
    expect(h().sun.intensity).toBeGreaterThan(night);
    send('weather', 'fog');
    expect(h().fog.density).toBeGreaterThan(was.fog);
    send('weather', 'clear');
    send('use_hour', false);
    set('world', 'sun', 1);
    send('fog', 1);
    expect(h().sun.intensity).toBeCloseTo(was.sun);
    expect(h().fog.density).toBeCloseTo(was.fog);
    expect(h().hemi.intensity).toBeCloseTo(was.hemi);
    expect(h().sun.color.getHex()).toBe(was.color);
    close();
  });

  it('overlays draw real data and switch on and off independently', () => {
    const o = game.sandbox.overlays;
    spawn(game, 'npc_guard', 2, 1, 26);
    set('visuals', 'ov_colliders', true);
    close();
    game.advance(0.2);
    expect(o.drawn.colliders).toBeGreaterThan(100);
    expect(o.drawn.shapes).toBe(0);
    set('visuals', 'ov_radius', true);
    close();
    game.advance(0.1);
    expect(o.drawn.shapes).toBeGreaterThan(100);
    set('visuals', 'ov_colliders', false);
    close();
    game.advance(0.2);
    expect(o.drawn.colliders).toBe(0);
    expect(o.drawn.shapes).toBeGreaterThan(100);
    set('visuals', 'ov_labels', true);
    expect(game.aiDebug).toBe(true);
    send('ov_labels', false);
    expect(game.aiDebug).toBe(false);
    send('ov_radius', false);
    close();
    game.advance(0.05);
    expect(game.debugGroup.children.filter((c) => c.visible)).toEqual([]);
  });

  it('HUD readouts appear and go independently, with real numbers', () => {
    const panels = () => game.ui.get().modPanels.filter((p) => p.key.startsWith(ID));
    set('visuals', 'hud_coords', true);
    expect(JSON.stringify(panels())).toContain('XYZ');
    expect(JSON.stringify(panels())).not.toContain('FPS');
    send('hud_fps', true);
    expect(JSON.stringify(panels())).toContain('FPS');
    send('hud_coords', false);
    expect(JSON.stringify(panels())).not.toContain('XYZ');
    send('hud_fps', false);
    expect(panels()).toEqual([]);
    close();
  });
});

describe('spawning', () => {
  const pick = (id: string, group: string) => {
    nav('spawning');
    send('spawn_group', group);
    send(`spawn_pick|${id}`);
    send('spawn_where', 'front');
  };
  const mine = () => game.entities.active.filter((e) => game.sandbox.isTracked(e.id));

  it('lists only what exists, by category, with a search', () => {
    nav('spawning');
    for (const [group, sample] of [['props', 'crate_wood'], ['npcs', 'npc_guard'], ['items', 'cube_bouncy'], ['weapons', 'wpn_blaster'], ['vehicles', 'buggy']] as const) {
      send('spawn_group', group);
      expect(control(`spawn_pick|${sample}`), sample).toBeDefined();
    }
    send('spawn_group', 'props');
    send('spawn_query', 'barrel');
    expect(control('spawn_pick|barrel')).toBeDefined();
    expect(control('spawn_pick|crate_wood')).toBeUndefined();
    send('spawn_query', '');
    close();
  });

  it('creates the requested number at the chosen interval', () => {
    pick('crate_small', 'props');
    send('spawn_scale', 1);
    send('spawn_count', 5);
    send('spawn_interval', 0.1);
    send('spawn_go');
    close();
    expect(mine().length).toBe(1);
    game.advance(0.25);
    expect(mine().length).toBe(3);
    game.advance(1);
    expect(mine().length).toBe(5);
    game.advance(1);
    expect(mine().length).toBe(5);
    nav('spawning');
    send('spawn_clear');
    yes();
    expect(mine().length).toBe(0);
    close();
  });

  it('asks before a big batch, can be cancelled, and is capped', () => {
    pick('crate_small', 'props');
    send('spawn_count', 100000);
    expect((control('spawn_count') as { value: number }).value).toBe(100);
    send('spawn_go');
    expect(mine().length).toBe(0);
    expect(form().confirm!.text).toContain('100');
    yes();
    close();
    game.advance(0.3);
    const during = mine().length;
    expect(during).toBeGreaterThan(0);
    nav('spawning');
    send('spawn_cancel');
    close();
    game.advance(1);
    expect(mine().length).toBe(during);
  });

  it('a spawn limit stops a job instead of retrying forever', () => {
    game.rules.limits.total = game.entities.active.filter((e) => !e.fixture).length + 2;
    pick('crate_small', 'props');
    send('spawn_count', 8);
    send('spawn_interval', 0.05);
    send('spawn_go');
    close();
    game.advance(2);
    expect(mine().length).toBe(2);
    expect(toasts().join()).toContain('limit');
    expect(errors()).toEqual([]);
  });

  it('a weapon from the list is equipped, not created', () => {
    pick('wpn_gravity', 'weapons');
    send('spawn_go');
    expect(game.tools.active.id).toBe('gravity');
    close();
  });
});

describe('chaos', () => {
  it('impulses move nearby things, and experiments end by themselves, restoring what they changed', () => {
    // Steel, since a wooden crate can break in this and take its overrides with it.
    const crate = spawn(game, 'crate_metal', 2, 1, 27);
    game.advance(0.5);
    set('chaos', 'chaos_impulse');
    expect(crate.body!.linvel().y + Math.abs(crate.body!.linvel().x)).toBeGreaterThan(1);
    send('chaos_seconds', 1);
    send('chaos_roulette');
    close();
    game.advance(0.5);
    expect(crate.gravityScale).not.toBe(1);
    game.advance(1);
    expect(crate.gravityScale).toBe(1);
  });

  it('STOP ALL ends everything at once, but keeps what was created', () => {
    const crate = spawn(game, 'crate_wood', 2, 1, 27);
    set('player', 'god', true);
    send('footer_stop');
    set('chaos', 'chaos_storm');
    set('time', 'time_scale', 0.5);
    set('physics', 'world_frozen', true);
    nav('spawning');
    send('spawn_group', 'props');
    send('spawn_pick|crate_small');
    send('spawn_count', 8);
    send('spawn_go');
    send('footer_stop');
    expect(game.player.god).toBe(false);
    expect(game.sandbox.timeScale).toBe(1);
    expect(game.sandbox.worldFrozen).toBe(false);
    expect(form().chips).toEqual([]);
    close();
    const made = game.entities.active.filter((e) => game.sandbox.isTracked(e.id)).length;
    game.advance(2);
    expect(game.entities.active.filter((e) => game.sandbox.isTracked(e.id)).length).toBe(made);
    expect(made).toBeGreaterThan(0);
    expect(crate.dead).toBe(false);
  });

  it('a saved set can be applied again', () => {
    nav('spawning');
    send('spawn_group', 'props');
    send('spawn_pick|crate_small');
    send('spawn_where', 'front');
    send('spawn_count', 1);
    send('spawn_go');
    close();
    game.advance(0.1);
    nav('chaos');
    send('set_name', 'Stack');
    send('set_capture');
    const count = () => game.entities.active.filter((e) => e.def.id === 'crate_small').length;
    const before = count();
    send('set_apply|Stack');
    expect(count()).toBe(before + 1);
    send('set_delete|Stack');
    expect(control('set_apply|Stack')).toBeUndefined();
    close();
    expect(errors()).toEqual([]);
  });
});

describe('profiles and tools', () => {
  it('settings come back in the next session', () => {
    set('movement', 'speed', 2.5);
    close();
    game.advance(1.1);
    game.startSession();
    expect(game.player.speedScale).toBe(2.5);
  });

  it('profiles keep separate settings, and switching undoes the old ones', () => {
    nav('profiles');
    send('profile_new_name', 'Fast');
    send('profile_new');
    set('movement', 'speed', 2);
    nav('profiles');
    send('profile_pick', 'Default');
    expect(game.player.speedScale).toBe(1);
    send('profile_pick', 'Fast');
    expect(game.player.speedScale).toBe(2);
    send('profile_delete');
    yes();
    expect(game.player.speedScale).toBe(1);
    close();
  });

  it('exports and imports, keeping only what is valid', () => {
    set('movement', 'speed', 2);
    set('player', 'god', true);
    nav('profiles');
    send('profile_export');
    const text = (control('export_text') as { value: string }).value;
    expect(JSON.parse(text).values).toMatchObject({ speed: 2, god: true });
    send('footer_stop');
    expect(game.player.god).toBe(false);
    send('import_text', text);
    send('import_run');
    expect(game.player.god).toBe(true);
    expect(game.player.speedScale).toBe(2);
    send('import_text', 'not json at all');
    send('import_run');
    expect(toasts().join()).toContain("isn't an exported");
    send('import_text', JSON.stringify({ values: { speed: 99999, god: 'yes', nonsense: 1, __proto__x: 1 } }));
    send('import_run');
    expect(game.player.speedScale).toBe(10);
    expect(game.player.god).toBe(false);
    close();
    expect(errors()).toEqual([]);
  });

  it('Mod Tools report real facts, and the diagnostic report is plain data about the mods', () => {
    nav('tools');
    const text = JSON.stringify(controls());
    expect(text).toContain('robot_pack'.length ? 'Robot Pack' : '');
    expect(text).toContain('running');
    send('tools_diag');
    const report = JSON.parse((control('diag_text') as { value: string }).value);
    expect(report.mod).toBe(ID);
    expect(report.mods.length).toBeGreaterThan(4);
    expect(Object.keys(report).sort()).toEqual(['active_settings', 'created', 'errors', 'map', 'mod', 'mode', 'mods', 'overrides', 'perf', 'script', 'version']);
    send('api_word', 'set_god');
    expect(JSON.stringify(controls())).toContain('sandbox.set_god(on)');
    close();
  });

  it('counts what it can do, and marks what it can\'t', () => {
    const unavailable: string[] = [];
    let working = 0;
    for (const n of form0().nav) {
      nav(n.id);
      for (const c of controls()) {
        if (c.type === 'unavailable') unavailable.push(c.label);
        else if (c.type !== 'text') working++;
      }
    }
    close();
    expect(working).toBeGreaterThan(90);
    expect(unavailable).toEqual(expect.arrayContaining(['Rain, Snow & Wind', 'Survival Lives & Challenge Budgets']));
  });
});

function form0() {
  open();
  return form();
}

describe('turning it off', () => {
  it('undoes everything without the script\'s help', async () => {
    const crate = spawn(game, 'crate_wood', 2, 1, 26);
    const guard = spawn(game, 'npc_guard', -2, 1, 26);
    const buggy = spawn(game, 'buggy', 0, 1, 24);
    game.advance(0.3);
    const crateMass = crate.mass;
    const envBefore = game.lightingHandles()!.sun.intensity;

    set('player', 'god', true);
    set('player', 'invulnerable', true);
    set('player', 'ignored', true);
    set('player', 'infinite_energy', true);
    set('movement', 'speed', 4);
    set('movement', 'jump', 4);
    set('movement', 'player_gravity', 0.5);
    set('movement', 'air_control', 3);
    set('movement', 'noclip', true);
    set('physics', 'gravity', 2);
    set('physics', 'world_frozen', true);
    set('physics', 'world_frozen', false);
    set('weapons', 'weapon_damage', 9);
    set('weapons', 'weapon_impulse', 9);
    set('weapons', 'weapon_rate', 9);
    set('time', 'time_scale', 2);
    set('chaos', 'blast_scale', 5);
    set('world', 'sun', 3);
    set('visuals', 'ov_colliders', true);
    set('visuals', 'ov_labels', true);
    set('visuals', 'hud_coords', true);
    selectEntity(crate.id);
    set('physics', 'sel_mass', 900);
    send('sel_scale', 2);
    send('sel_material', 'ice');
    selectEntity(guard.id);
    set('npc', 'npc_stance', 'hostile');
    send('npc_ai', false);
    send('npc_invulnerable', true);
    send('npc_speed', 3);
    selectEntity(buggy.id);
    set('vehicles', 'veh_top', 4);
    aim({ x: 0, y: 0, z: 30 });
    set('world', 'world_pick', 'crate_small');
    send('world_spawn');
    const mine = game.entities.active.filter((e) => game.sandbox.isTracked(e.id));
    expect(mine.length).toBe(1);
    expect(game.sandbox.keysOf(ID).length).toBeGreaterThan(15);

    await game.mods.setEnabled(ID, false);

    const r = game.mods.get(ID)!;
    expect(r.state).toBe('disabled');
    expect(r.host).toBeNull();
    expect(game.ui.get().overlay).toBeNull();
    expect(game.ui.get().modForm).toBeNull();
    expect(game.ui.get().modPanels.filter((p) => p.key.startsWith(ID))).toEqual([]);
    expect(game.mods.handleKey('F6')).toBe(false);
    expect(game.sandbox.keysOf(ID)).toEqual([]);

    const p = game.player;
    expect([p.god, p.speedScale, p.jumpScale, p.gravityScale, p.flying]).toEqual([false, 1, 1, 1, false]);
    expect(p.collider!.isEnabled()).toBe(true);
    const rules = defaultRules();
    expect(game.rules.gravity).toBe(rules.gravity);
    expect(game.rules.damage).toBe(true);
    expect(game.rules.aggression).toBe(rules.aggression);
    expect(game.rules.airControl).toBe(rules.airControl);
    expect(game.physics.w.gravity.y).toBeCloseTo(-9.81);
    const s = game.sandbox;
    expect([s.timeScale, s.damageScale, s.impulseScale, s.fireRateScale, s.blastScale, s.infiniteEnergy, s.worldFrozen]).toEqual([1, 1, 1, 1, 1, false, false]);
    expect(s.baseRules).toEqual({});
    expect(game.aiDebug).toBe(false);
    expect(game.lightingHandles()!.sun.intensity).toBeCloseTo(envBefore);

    game.advance(0.05);
    expect(game.debugGroup.children.filter((c) => c.visible)).toEqual([]);
    expect(crate.scale).toBe(1);
    expect(crate.materialId).toBe('wood');
    expect(crate.mass).toBeCloseTo(crateMass, 1);
    const n = guard.component(NpcComponent)!;
    expect([n.stance, n.aiEnabled, n.speedScale]).toEqual([null, true, 1]);
    expect(guard.invulnerable).toBe(false);
    expect(buggy.component(VehicleComponent)!.topSpeedScale).toBe(1);
    expect(mine[0]!.dead).toBe(true);

    // The world still runs normally without it.
    game.advance(1);
    expect(game.ui.get().error).toBeNull();
    expect(errors()).toEqual([]);
  });

  it('can be turned off and on repeatedly, keeping settings and without leaking anything', async () => {
    set('movement', 'speed', 3);
    close();
    game.advance(1.1);
    for (let i = 0; i < 4; i++) {
      await game.mods.setEnabled(ID, false);
      expect(game.player.speedScale).toBe(1);
      expect(game.mods.handleKey('F6')).toBe(false);
      await game.mods.setEnabled(ID, true);
      expect(game.mods.get(ID)!.state).toBe('loaded');
      expect(game.player.speedScale).toBe(3);
      open();
      close();
    }
    expect(game.sandbox.keysOf(ID).filter((k) => k === 'player:speed').length).toBe(1);
    expect(errors()).toEqual([]);
  });

  it('a reload in the middle of a session comes back working', async () => {
    set('player', 'god', true);
    close();
    game.advance(1.1);
    await game.mods.reload(ID);
    expect(game.mods.get(ID)!.state).toBe('loaded');
    expect(game.player.god).toBe(true);
    open();
    close();
    expect(errors()).toEqual([]);
  });

  it('a session ending clears effects from the world, and leaves no stale selection behind', () => {
    const crate = spawn(game, 'crate_wood', 2, 1, 26);
    selectEntity(crate.id);
    set('physics', 'sel_scale', 2);
    set('physics', 'sel_carry', true);
    close();
    game.startSession();
    game.advance(0.5);
    expect(errors()).toEqual([]);
    nav('physics');
    expect(JSON.stringify(controls())).toContain('Nothing selected');
    close();
  });

  it('a mod that faults has its overrides undone too', async () => {
    const source = `
      sandbox.set_time_scale(nil)
      events.on("session_start", function(e) sandbox.set_god(true) end)
      local n = 0
      if game.in_session() then sandbox.set_god(true) end
      input.bind("F10", function() error("boom") end)
    `;
    const r = await game.mods.installBundle({ origin: 'local', manifest: JSON.stringify({ id: 'fault_test', name: 'F', version: '1.0.0', author: 'a', description: 'd', api_version: '1.1', permissions: ['sandbox', 'ui'], scripts: ['m.chaos'] }), files: { 'm.chaos': source } });
    expect(r.errors).toEqual([]);
    expect(game.player.god).toBe(true);
    game.mods.get('fault_test')!.host!.fault('test');
    expect(game.player.god).toBe(false);
    await game.mods.uninstall('fault_test');
  });
});

describe('alongside other mods', () => {
  it('leaves their content and behaviour alone', () => {
    for (const id of ['chaos_playground', 'furniture_pack', 'robot_pack', 'super_tools', 'vehicle_pack', 'security_robots']) expect(game.mods.get(id)?.state, id).toBe('loaded');
    const turret = spawn(game, 'robot_pack:turret', -4, 1, 25);
    set('physics', 'gravity', 0.5);
    close();
    game.advance(1);
    expect(turret.dead).toBe(false);
    expect(errors()).toEqual([]);
  });
});

describe('safety of the new API', () => {
  it('needs the sandbox permission', async () => {
    const r = await game.mods.installBundle({ origin: 'local', manifest: JSON.stringify({ id: 'no_perm', name: 'N', version: '1.0.0', author: 'a', description: 'd', api_version: '1.1', permissions: [], scripts: ['m.chaos'] }), files: { 'm.chaos': 'local r = pcall(sandbox.set_god, true)\nassert(not r.ok)\nassert(string.find(r.error, "sandbox") ~= nil)' } });
    expect(r.errors).toEqual([]);
    expect(r.record!.state).toBe('loaded');
    expect(game.player.god).toBe(false);
    await game.mods.uninstall('no_perm');
  });

  it('a panel only ever carries text and known fields', async () => {
    const r = await game.mods.installBundle({ origin: 'local', manifest: JSON.stringify({ id: 'panel_test', name: 'P', version: '1.0.0', author: 'a', description: 'd', api_version: '1.1', permissions: ['ui'], scripts: ['m.chaos'] }), files: { 'm.chaos': `
      if game.in_session() then
        ui.open_panel({ title = "<img src=x onerror=alert(1)>", evil = "x", sections = { { title = "S", controls = { { type = "text", text = "<b>x</b>", onclick = "x" } } } } }, function(e) end)
        local bad = pcall(ui.update_panel, { sections = { { controls = { { type = "script" } } } } })
        assert(not bad.ok)
        local fn = pcall(ui.update_panel, { title = function() end })
        assert(not fn.ok)
      end` } });
    expect(r.errors).toEqual([]);
    expect(r.record!.state).toBe('loaded');
    const f = game.ui.get().modForm!;
    expect(f.title).toBe('<img src=x onerror=alert(1)>');
    expect(Object.keys(f)).not.toContain('evil');
    expect(Object.keys(f.sections[0]!.controls[0]!)).toEqual(['type', 'text', 'style']);
    game.setOverlay(null);
    await game.mods.uninstall('panel_test');
    expect(game.ui.get().modForm).toBeNull();
  });
});
});
