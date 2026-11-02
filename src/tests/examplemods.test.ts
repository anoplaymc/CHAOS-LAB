import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../data/items';
import { Game, MAPS } from '../game/core/Game';
import { NPC_PROFILES } from '../game/npcs/NpcBrain';
import { NpcComponent } from '../game/npcs/NpcComponent';
import { DataTool } from '../game/weapons/DataTool';
import type { Entity } from '../game/entities/Entity';
import { BuiltinSource } from '../modding/sources';
import { serializeScene } from '../game/save/sceneIO';
import { spawn } from './helpers';

const serialize = () => serializeScene(game, 'test', 'scene');

let game: Game;
const errors = () => game.mods.logs.filter((l) => l.level === 'error').map((l) => `${l.mod}: ${l.text}`);
const noErrors = () => expect(errors().join('\n')).toBe('');
const ent = (id: string, x: number, y: number, z: number) => spawn(game, id, x, y, z);

/** Points the player at something. */
function aim(p: { x: number; y: number; z: number }): void {
  const a = game.aimRay();
  const dx = p.x - a.origin.x;
  const dy = p.y - a.origin.y;
  const dz = p.z - a.origin.z;
  game.player.yaw = Math.atan2(-dx, -dz);
  game.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  game.player.updateCamera(game.camera, 1, 0);
}

beforeAll(async () => {
  await Game.init();
  game = new Game();
  game.input.virtualLock = true;
  game.mods.addSource(new BuiltinSource());
  await game.mods.restore();
});

afterAll(() => game.dispose());

beforeEach(() => {
  game.mods.clearLog();
  game.startSession();
});

describe('the five example mods', () => {
  it('all load through the real loader with no errors', () => {
    expect(game.mods.list().flatMap((r) => r.errors).join('\n')).toBe('');
    const ids = game.mods.list().map((r) => [r.id, r.state]);
    for (const id of ['chaos_playground', 'furniture_pack', 'robot_pack', 'super_tools', 'vehicle_pack']) expect(ids).toContainEqual([id, 'loaded']);
    for (const r of game.mods.list()) expect(r.errors, r.id).toEqual([]);
    expect(game.mods.list().flatMap((r) => r.warnings)).toEqual([]);
  });

  it('are loaded by dependency order', () => {
    const r = game.mods.resolve();
    const names = r.order.map((x) => x.id);
    expect(names.indexOf('furniture_pack')).toBeLessThan(names.indexOf('chaos_playground'));
    expect(names.indexOf('robot_pack')).toBeLessThan(names.indexOf('chaos_playground'));
  });

  it('Robot Pack: new NPC types spawn, fight and use their scripts', () => {
    for (const id of ['skirmisher', 'turret', 'kamikaze', 'repair_bot']) expect(NPC_PROFILES[`robot_pack:${id}`], id).toBeDefined();
    const turret = ent('robot_pack:turret', -4, 1, 25);
    const skirmisher = ent('robot_pack:skirmisher', 4, 1, 30);
    const repair = ent('robot_pack:repair_bot', 0, 1, 26);
    expect(turret.component(NpcComponent)!.order.kind).toBe('guard');
    // The turret is lab faction and the skirmisher is rogue: they should start shooting each other.
    const hp = skirmisher.health;
    game.advance(6);
    expect(skirmisher.dead || skirmisher.health < hp).toBe(true);
    // Repair bot obeys E and heals damaged neighbours.
    const npc = repair.component(NpcComponent)!;
    expect(npc.interactHint()).toContain('Follow');
    npc.onInteract();
    expect(npc.order.kind).toBe('follow');
    npc.onInteract();
    expect(npc.order.kind).toBe('none');
    if (!turret.dead) {
      game.entities.setTransform(repair, { x: turret.position.x + 1, y: turret.position.y, z: turret.position.z }, repair.rotation);
      turret.health = 50;
      game.advance(2);
      expect(turret.health).toBeGreaterThan(50);
    }
    noErrors();
  });

  it('Robot Pack: the kamikaze reaches the player and explodes', () => {
    const hp = game.player.health;
    const k = ent('robot_pack:kamikaze', 0, 1, 25);
    let boom = 0;
    const off = game.events.on('explosion', () => boom++);
    for (let i = 0; i < 40 && !boom; i++) game.advance(0.25);
    off();
    expect(boom).toBe(1);
    expect(k.dead).toBe(true);
    expect(game.player.health).toBeLessThan(hp);
    noErrors();
  });

  it('Robot Pack: the squad effect places three robots through the spawn menu path', () => {
    const before = game.npcs.length;
    aim({ x: 0, y: 0, z: 22 });
    expect(catalog.get('robot_pack:squad')?.kind).toBe('effect');
    game.spawnAtCrosshair('robot_pack:squad');
    expect(game.npcs.length).toBe(before + 3);
    noErrors();
  });

  it('Furniture Pack: props are physical, breakable, interactive and textured', () => {
    for (const id of ['dining_chair', 'dining_table', 'armchair', 'wardrobe', 'desk_lamp', 'poster']) {
      const def = catalog.get(`furniture_pack:${id}`);
      expect(def?.model?.length, id).toBeGreaterThan(0);
    }
    expect(catalog.get('furniture_pack:poster')!.model![0]!.texture).toMatch(/^data:image\/png;base64,/);
    const chair = ent('furniture_pack:dining_chair', 2, 3, 25);
    const y = chair.position.y;
    game.advance(1);
    expect(chair.position.y).toBeLessThan(y);
    expect(chair.mass).toBeGreaterThan(0);
    game.damageEntity(chair, 1000, { kind: 'player' });
    game.advance(0.05);
    expect(chair.dead).toBe(true);

    const arm = ent('furniture_pack:armchair', -2, 1, 25);
    expect(arm.materialId).toBe('furniture_pack:cushion');

    const lamp = ent('furniture_pack:desk_lamp', 0, 1, 24);
    const c = lamp.components.find((x) => x.onInteract)!;
    expect(c.interactHint?.()).toContain('Switch');
    c.onInteract!();
    expect(lamp.scriptData?.on).toBe(true);
    expect(lamp.tint).toBe(0xfff0a0);
    game.advance(0.5);
    c.onInteract!();
    expect(lamp.tint).toBe(null);
    noErrors();
  });

  it('Vehicle Pack: both vehicles can be driven, including three wheels', () => {
    for (const id of ['monster', 'trike']) {
      game.startSession();
      game.player.teleport({ x: 0, y: 1, z: 33 }, 0);
      const v = ent(`vehicle_pack:${id}`, 0, 1.5, 30);
      game.advance(1.5);
      expect(v.def.vehicle!.wheels.length).toBe(id === 'trike' ? 3 : 4);
      const c = v.components.find((x) => x.onInteract)!;
      expect(c.onInteract!(), id).toBe(true);
      const z0 = v.position.z;
      game.input.enabled = true;
      game.input.pressAction('forward');
      game.advance(2);
      game.input.releaseAction('forward');
      expect(z0 - v.position.z, id).toBeGreaterThan(1);
      game.player.exitVehicle();
    }
    expect(game.mods.menuButtons().some((b) => b.label.en === 'Honk')).toBe(true);
    game.mods.menuButtons().find((b) => b.label.en === 'Honk')!.run();
    noErrors();
  });

  it('Super Tools: each tool does its job in the world', () => {
    const select = (id: string) => {
      expect(game.tools.selectById(`super_tools:${id}`), id).toBe(true);
      return game.tools.active;
    };
    const crate = ent('crate_wood', 0, 0.6, 25);
    game.advance(0.5);
    game.player.teleport({ x: 0, y: 1, z: 29 }, 0);
    game.advance(0.1);
    aim(crate.position);

    const lev = select('levitator');
    lev.primaryDown();
    lev.primaryUp();
    expect(crate.gravityScale).toBeLessThan(0);
    expect(lev.hud().status).toBe('Floating: 1');
    game.advance(0.3);
    expect(crate.position.y).toBeGreaterThan(0.6);
    aim(crate.position);
    lev.secondaryDown();
    expect(crate.gravityScale).toBe(1);
    game.advance(1.5);
    aim(crate.position);

    const stack = select('stacker');
    const n = game.entities.active.filter((e) => e.def.id === 'crate_wood').length;
    stack.primaryDown();
    stack.primaryUp();
    expect(game.entities.active.filter((e) => e.def.id === 'crate_wood').length).toBe(n + 3);
    stack.secondaryDown();
    expect(stack.hud().status).toBe('Height: 4');
    game.advance(1);

    const others = game.entities.active.filter((e) => e.def.id === 'crate_wood' && e !== crate);
    for (const o of others) if (o.position.z > 20) game.entities.remove(o);
    game.advance(0.5);

    const vortex = select('vortex');
    aim({ x: crate.position.x, y: 0.1, z: crate.position.z + 1 });
    const start = { ...crate.position };
    vortex.primaryDown();
    game.input.enabled = true;
    for (let i = 0; i < 30; i++) {
      vortex.update(1 / 60);
      game.advance(1 / 60);
    }
    vortex.primaryUp();
    expect(Math.hypot(crate.position.x - start.x, crate.position.y - start.y, crate.position.z - start.z)).toBeGreaterThan(0.2);

    const gun = select('confetti') as DataTool;
    expect(gun.kind).toBe('weapon');
    const target = ent('crate_metal', 2, 0.6, 26);
    game.advance(0.5);
    aim(target.position);
    expect(gun.tryFire()).toBe(true);
    expect(gun.hud().energy).toBeLessThan(1);

    const placer = select('pad_placer');
    aim({ x: -2, y: 0, z: 26 });
    placer.primaryDown();
    placer.primaryUp();
    const pad = game.entities.active.find((e) => e.def.id === 'super_tools:bounce_pad');
    expect(pad).toBeDefined();
    const ball = ent('ball_metal', pad!.position.x, 2, pad!.position.z);
    game.advance(0.7);
    let peak = ball.position.y;
    for (let i = 0; i < 30; i++) {
      game.advance(1 / 30);
      peak = Math.max(peak, ball.position.y);
    }
    expect(peak).toBeGreaterThan(2.5);
    game.tools.select(0);
    noErrors();
  });

  it('Chaos Playground: the mode runs, disasters work, and it finishes', () => {
    expect(MAPS['chaos_playground:arena']).toBeDefined();
    game.startSession({ mode: 'chaos_playground:survive' });
    expect(game.session.map).toBe('chaos_playground:arena');
    expect(game.entities.active.filter((e) => e.def.id === 'furniture_pack:dining_chair').length).toBe(10);
    const button = game.entities.active.find((e) => e.def.id === 'chaos_playground:big_red_button')!;
    expect(button).toBeDefined();
    expect(game.nav).not.toBeNull();
    expect(game.tools.isAllowed(game.tools.tools.find((t) => t.id === 'blaster')!)).toBe(false);
    expect(game.mode?.hud()?.title).toBe('Chaos Hour');

    const disasters = () => game.mods.logs.filter((l) => l.mod === 'chaos_playground' && l.text.startsWith('Disaster:')).length;
    const before = disasters();
    button.components.find((c) => c.onInteract)!.onInteract!();
    expect(disasters()).toBe(before + 1);

    // Every disaster, directly: the event carries a name.
    for (const name of ['meteor_shower', 'crate_rain', 'gravity_flip', 'shockwave', 'furniture_storm', 'robot_raid']) {
      game.mods.emitCustom('chaos_playground:disaster', { name });
      game.advance(0.3);
    }
    expect(game.rules.gravity).toBe(-2);
    game.advance(6);
    expect(game.rules.gravity).toBe(9.81);
    noErrors();

    // The whole mode, at game speed in fixed steps. Immortality so the check is about the script.
    game.rules.damage = false;
    for (let i = 0; i < 400 && !game.mode?.hud()?.result; i++) {
      for (const e of [...game.entities.active]) if (!e.fixture && e.def.kind === 'npc') game.entities.remove(e);
      game.advance(0.5);
    }
    const hud = game.mode?.hud();
    expect(hud?.result?.title).toMatch(/Untouched|You made it/);
    expect(disasters()).toBeGreaterThan(before + 10);
    noErrors();
  }, 180000);

  it('Chaos Playground: needs Furniture Pack, and works without optional Robot Pack', async () => {
    await game.mods.setEnabled('furniture_pack', false);
    expect(game.mods.get('chaos_playground')!.state).toBe('blocked');
    expect(game.mods.get('chaos_playground')!.errors[0]).toMatch(/furniture_pack/);
    expect(MAPS['chaos_playground:arena']).toBeUndefined();
    await game.mods.setEnabled('furniture_pack', true);
    expect(game.mods.get('chaos_playground')!.state).toBe('loaded');
    expect(MAPS['chaos_playground:arena']).toBeDefined();

    await game.mods.setEnabled('robot_pack', false);
    expect(game.mods.get('chaos_playground')!.state).toBe('loaded');
    game.startSession({ mode: 'chaos_playground:survive' });
    game.mods.emitCustom('chaos_playground:disaster', { name: 'robot_raid' });
    game.advance(0.5);
    noErrors();
    await game.mods.setEnabled('robot_pack', true);
  });

  it('survive saving and loading a scene', () => {
    ent('furniture_pack:desk_lamp', 0, 1, 25).components.find((c) => c.onInteract)!.onInteract!();
    ent('robot_pack:repair_bot', 2, 1, 25);
    ent('vehicle_pack:trike', -3, 1, 25);
    game.advance(0.5);
    let saved = null as ReturnType<typeof serialize> | null;
    saved = serialize();
    game.loadSave(saved);
    const lamp = game.entities.active.find((e) => e.def.id === 'furniture_pack:desk_lamp');
    expect(lamp?.scriptData?.on).toBe(true);
    expect(game.entities.active.some((e) => e.def.id === 'robot_pack:repair_bot')).toBe(true);
    expect(game.entities.active.some((e) => e.def.id === 'vehicle_pack:trike')).toBe(true);
    game.advance(0.5);
    noErrors();
  });

  it('restart repeatedly with everything loaded, without growth', () => {
    const count = () => {
      let nodes = 0;
      game.scene.traverse(() => nodes++);
      return { nodes, bodies: game.physics.bodyCount, ents: game.entities.registry.size };
    };
    game.restart();
    const base = count();
    for (let i = 0; i < 8; i++) {
      ent('robot_pack:skirmisher', 3, 1, 15);
      ent('furniture_pack:wardrobe', -3, 2, 25);
      ent('vehicle_pack:monster', 0, 2, 12);
      game.advance(0.5);
      game.restart();
    }
    expect(count()).toEqual(base);
    noErrors();
  });

  it('leave nothing behind when all are unloaded', async () => {
    // Any other mod in mods/ counts too. Dependents go first so nothing is left blocked.
    const all = game.mods.list().map((r) => r.id);
    for (const id of all) await game.mods.setEnabled(id, false);
    expect(catalog.list().filter((d) => d.source)).toEqual([]);
    expect(Object.keys(NPC_PROFILES).filter((k) => k.includes(':'))).toEqual([]);
    expect(game.tools.tools.filter((t) => t.id.includes(':'))).toEqual([]);
    expect(Object.keys(MAPS).filter((k) => k.includes(':'))).toEqual([]);
    game.advance(0.5);
    expect(game.ui.get().error).toBeNull();
    for (const id of all) await game.mods.setEnabled(id, true);
    expect(game.mods.list().every((r) => r.state === 'loaded')).toBe(true);
    noErrors();
  });
});

describe('NPC framework', () => {
  const npc = (e: Entity) => e.component(NpcComponent)!;

  it('follows the player', () => {
    game.player.teleport({ x: 0, y: 1, z: 29 }, 0);
    const n = ent('npc_courier', 4, 1, 25);
    expect(npc(n).order.kind).toBe('follow');
    game.advance(0.5);
    game.player.teleport({ x: 5, y: 1, z: 31 }, 0);
    game.advance(5);
    const p = game.player.position;
    expect(Math.hypot(n.position.x - p.x, n.position.z - p.z)).toBeLessThan(6);
  });

  it('follows another entity', () => {
    const lead = ent('crate_metal', 6, 0.6, 30);
    const n = ent('npc_technician', -4, 1, 26);
    npc(n).setOrder({ kind: 'follow', target: lead.id, distance: 2 });
    game.advance(6);
    expect(Math.hypot(n.position.x - lead.position.x, n.position.z - lead.position.z)).toBeLessThan(4.5);
  });

  it('goes to a point and stays there', () => {
    const n = ent('npc_technician', -3, 1, 30);
    npc(n).setOrder({ kind: 'go_to', point: { x: 4, y: 0, z: 25 } });
    game.advance(7);
    expect(Math.hypot(n.position.x - 4, n.position.z - 25)).toBeLessThan(2.5);
    game.advance(5);
    expect(Math.hypot(n.position.x - 4, n.position.z - 25)).toBeLessThan(2.5);
  });

  it('patrols a route in order', () => {
    const n = ent('npc_guard', 0, 1, 26);
    npc(n).setOrder({ kind: 'patrol', route: [{ x: -4, y: 0, z: 26 }, { x: 4, y: 0, z: 26 }], loop: true, index: 0 });
    let nearA = false;
    let nearB = false;
    for (let i = 0; i < 60; i++) {
      game.advance(0.5);
      if (Math.hypot(n.position.x + 4, n.position.z - 26) < 2) nearA = true;
      if (Math.hypot(n.position.x - 4, n.position.z - 26) < 2) nearB = true;
    }
    expect(nearA && nearB).toBe(true);
  });

  it('guards an area: fights near it, and returns to it', () => {
    game.player.teleport({ x: 0, y: 1, z: 32 }, 0);
    const g = ent('npc_sentry', -14, 1, 12);
    expect(npc(g).order.kind).toBe('guard');
    const near = ent('npc_robot', -10, 1, 13);
    game.advance(0.1);
    near.health = 5000;
    near.maxHealth = 5000;
    let chased = false;
    for (let i = 0; i < 30 && !chased; i++) {
      game.advance(0.2);
      chased = npc(g).state === 'chase' || npc(g).state === 'attack';
    }
    expect(chased).toBe(true);
    game.entities.remove(near);
    // Far away enemies are ignored. This one is out of the leash.
    const far = ent('npc_robot', 16, 1, 12);
    far.health = far.maxHealth = 5000;
    game.advance(6);
    expect(['idle', 'patrol']).toContain(npc(g).state);
    const home = (npc(g).order as { point: { x: number; z: number } }).point;
    expect(Math.hypot(g.position.x - home.x, g.position.z - home.z)).toBeLessThan(12);
    game.entities.remove(far);
  });

  it('uses interactive objects', () => {
    const lever = ent('lever', 3, 0.3, 26);
    const n = ent('npc_technician', -2, 1, 26);
    expect((lever.components[0] as { on?: boolean }).on).toBe(false);
    npc(n).setOrder({ kind: 'use', target: lever.id });
    game.advance(8);
    expect((lever.components[0] as { on?: boolean }).on).toBe(true);
    expect(npc(n).order.kind).toBe('none');
  });

  it('tinkers with nearby things by itself', () => {
    ent('crate_small', 3, 0.4, 26);
    const n = ent('npc_janitor', -1, 1, 26);
    expect(npc(n).order.kind).toBe('tinker');
    game.advance(1);
    const light = game.entities.active.filter((e) => e !== n && !e.fixture && e.def.kind === 'prop' && e.body?.isDynamic());
    const start = new Map(light.map((e) => [e, { ...e.position }]));
    let moved = false;
    for (let i = 0; i < 120 && !moved; i++) {
      game.advance(0.5);
      moved = light.some((e) => e.dead || Math.hypot(e.position.x - start.get(e)!.x, e.position.z - start.get(e)!.z) > 0.3);
    }
    expect(moved).toBe(true);
  });

  it('applies personalities', () => {
    const lazy = NPC_PROFILES.npc_janitor!;
    expect(lazy.personality).toBe('lazy');
    expect(lazy.walkSpeed).toBeLessThan(1.5);
    expect(NPC_PROFILES.npc_courier!.skittish).toBe(true);
    expect(NPC_PROFILES.npc_sentry!.onExplosion).toBe('investigate');
    expect(NPC_PROFILES.npc_scout_bot!.hearing).toBeGreaterThan(26);
  });

  it('reacts to explosions according to its type', () => {
    const skrit = ent('npc_critter_blue', 0, 1, 26);
    game.advance(0.3);
    game.explode({ x: 1, y: 1, z: 26 }, 2, 0, 0);
    game.advance(0.5);
    expect(npc(skrit).state).toBe('flee');
    game.entities.remove(skrit);
    const lazy = ent('npc_janitor', 0, 1, 26);
    game.advance(0.1);
    game.explode({ x: 1, y: 1, z: 26 }, 2, 0, 0);
    game.advance(0.3);
    expect(npc(lazy).state).not.toBe('flee');
  });

  it('moves on from a patrol point it can\'t reach, instead of jittering against the wall', () => {
    const n = ent('npc_guard', 0, 1, 28);
    // The second point is behind the spawn room's end wall.
    npc(n).setOrder({ kind: 'patrol', route: [{ x: 0, y: 0, z: 40 }, { x: -4, y: 0, z: 26 }], loop: true, index: 0 });
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      game.advance(0.5);
      reached = Math.hypot(n.position.x + 4, n.position.z - 26) < 2.5;
    }
    expect(reached).toBe(true);
  });

  it('keeps to a territory while patrolling: no chasing, investigating or staying outside', () => {
    game.player.teleport({ x: 0, y: 1, z: 33 }, 0);
    const n = ent('npc_guard', 0, 1, 27);
    const home = { x: 0, y: 0, z: 27 };
    npc(n).territory = { point: home, radius: 4 };
    npc(n).setOrder({ kind: 'patrol', route: [{ x: -2, y: 0, z: 27 }, { x: 2, y: 0, z: 27 }], loop: true, index: 0 });
    const distance = () => Math.hypot(n.position.x - home.x, n.position.z - home.z);
    // A noise outside the territory is ignored.
    game.makeNoise({ x: 0, y: 1, z: 22 }, 50);
    game.advance(3);
    expect(distance()).toBeLessThan(6);
    // Pushed out, it comes back.
    game.entities.setTransform(n, { x: 6.5, y: 1, z: 33 }, n.rotation);
    game.advance(8);
    expect(distance()).toBeLessThan(6);
  });

  it('remembers its order, territory, data and overrides in a saved game', () => {
    const n = ent('npc_guard', 0, 1, 27);
    npc(n).territory = { point: { x: 0, y: 0, z: 27 }, radius: 9 };
    npc(n).attackDamage = 33;
    npc(n).wasProvoked = true;
    npc(n).setOrder({ kind: 'patrol', route: [{ x: -2, y: 0, z: 27 }, { x: 2, y: 0, z: 27 }], loop: true, index: 0 });
    n.scriptData = { mark: 7 };
    game.loadSave(serialize());
    const back = game.entities.active.find((e) => e.def.id === 'npc_guard' && e.scriptData?.mark === 7);
    expect(back).toBeDefined();
    const c = npc(back!);
    expect(c.order.kind).toBe('patrol');
    expect(c.territory?.radius).toBe(9);
    expect(c.attackDamage).toBe(33);
    expect(c.wasProvoked).toBe(true);
  });

  it('applies a per-NPC damage override to real shots', () => {
    const shooter = ent('npc_guard', -3, 1, 27);
    const target = ent('npc_robot', 3, 1, 27);
    target.health = target.maxHealth = 5000;
    npc(shooter).attackDamage = 50;
    let hit = 0;
    const off = game.events.on('entityDamaged', (d) => { if (d.entity === target && d.source.entity === shooter) hit = d.amount; });
    for (let i = 0; i < 40 && !hit; i++) game.advance(0.25);
    off();
    expect(hit).toBe(50);
    expect(npc(shooter).targetEntity).toBe(target);
    expect(npc(shooter).enemiesInSight()).toContain(target);
  });

  it('fights any NPC it is told to, and reports who did damage', () => {
    const a = ent('npc_guard', -3, 1, 27);
    const b = ent('npc_technician', 3, 1, 27);
    expect(npc(a).isEnemy(npc(b))).toBe(false);
    game.advance(0.5);
    expect(npc(a).targetEntity).toBeNull();
    npc(a).attackNpc(npc(b));
    let by: unknown = null;
    const off = game.events.on('entityDamaged', (d) => { if (d.entity === b) by = d.source.entity; });
    for (let i = 0; i < 24 && !by; i++) game.advance(0.25);
    off();
    expect(by).toBe(a);
  });

  it('talks through data, not hardcoded ids', () => {
    const c = ent('npc_courier', 0, 1, 26);
    expect(npc(c).interactHint()).toBe(game.t('hint.talk'));
    const n = game.ui.get().toasts.length;
    expect(npc(c).onInteract()).toBe(true);
    expect(game.ui.get().toasts.length).toBeGreaterThan(Math.min(n, 3));
    expect(npc(ent('npc_robot', 3, 1, 26)).interactHint()).toBeNull();
    // The original technician still talks, through the same route.
    const t = ent('npc_technician', -3, 1, 26);
    expect(npc(t).interactHint()).toBe(game.t('hint.talk'));
    expect(npc(t).onInteract()).toBe(true);
  });
});

describe('core content expansion', () => {
  it('every catalog item spawns, runs and removes cleanly', () => {
    for (const d of catalog.list()) {
      if (d.kind === 'tool' || d.kind === 'effect') continue;
      game.startSession();
      const r = game.entities.spawn(d.id, { position: { x: 0, y: 3, z: 24 } });
      expect(r.ok, d.id).toBe(true);
      game.advance(0.2);
      if (r.ok && !r.entity.dead) game.entities.remove(r.entity);
      game.advance(0.05);
      expect(game.ui.get().error, d.id).toBeNull();
    }
    noErrors();
  }, 120000);

  it('every tool can be selected, clicked and used without trouble', () => {
    const crate = ent('crate_wood', 0, 0.6, 26);
    game.advance(0.3);
    aim(crate.position);
    game.input.enabled = true;
    for (let i = 0; i < game.tools.tools.length; i++) {
      game.tools.select(i);
      const t = game.tools.active;
      t.primaryDown();
      game.advance(0.05);
      t.primaryUp();
      t.secondaryDown();
      game.advance(0.05);
      t.secondaryUp();
      t.reload();
      t.hud();
      t.reset();
      expect(game.ui.get().error, t.id).toBeNull();
    }
    game.tools.select(0);
    noErrors();
  });

  it('has the new mechanisms working', () => {
    // Conveyor carries a crate along -Z.
    const belt = ent('conveyor', 3, 0.1, 28);
    const onBelt = ent('crate_small', 3, 0.6, 28.5);
    game.advance(2);
    expect(onBelt.position.z).toBeLessThan(28.2);
    game.entities.remove(belt);

    // Magnet pulls metal and leaves wood alone.
    const mag = ent('magnet', -5, 0.2, 26);
    const steel = ent('ball_metal', -2, 0.6, 26);
    const wood = ent('crate_small', -5, 0.4, 29);
    const woodStart = { ...wood.position };
    const d0 = Math.abs(steel.position.x - mag.position.x);
    game.advance(2);
    expect(Math.abs(steel.position.x - mag.position.x)).toBeLessThan(d0);
    expect(Math.hypot(wood.position.x - woodStart.x, wood.position.z - woodStart.z)).toBeLessThan(0.2);
    game.entities.remove(mag);

    // Dispenser makes a crate on E.
    const disp = ent('dispenser', 4, 0.6, 24);
    const before = game.entities.active.filter((e) => e.def.id === 'crate_small').length;
    disp.components[0]!.onInteract!();
    expect(game.entities.active.filter((e) => e.def.id === 'crate_small').length).toBe(before + 1);

    // Teleporter moves what touches it to the other pad.
    const padA = ent('teleporter', -5, 0.1, 22);
    const padB = ent('teleporter', 5, 0.1, 31);
    const rider = ent('crate_small', -5, 0.7, 22);
    game.advance(0.4);
    expect(Math.hypot(rider.position.x - padB.position.x, rider.position.z - padB.position.z)).toBeLessThan(2);
    expect(padA.dead).toBe(false);

    // Thruster flies.
    const th = ent('thruster', 0, 0.5, 24);
    th.components[0]!.onInteract!();
    game.advance(0.8);
    expect(th.position.y).toBeGreaterThan(1.2);

    // Alarm draws NPCs.
    const g = ent('npc_guard', 3, 1, 24);
    const bell = ent('alarm_bell', -3, 0.3, 24);
    game.advance(0.3);
    bell.components[0]!.onInteract!();
    game.advance(0.5);
    expect(['investigate', 'chase', 'attack']).toContain(g.component(NpcComponent)!.state);
    noErrors();
  });

  it('has working delay and latch logic on real wires', () => {
    const lever = ent('lever', 0, 0.3, 26);
    const delay = ent('delay_gate', 2, 0.15, 26);
    const latch = ent('latch_gate', 4, 0.15, 26);
    const lamp = ent('lamp', 6, 0.2, 26);
    expect(game.signals.connect(lever.id, delay.id)).toBeNull();
    expect(game.signals.connect(delay.id, latch.id)).toBeNull();
    expect(game.signals.connect(latch.id, lamp.id)).toBeNull();
    const out = (e: Entity) => e.components[0]!.signalOut!();
    lever.components[0]!.onInteract!();
    game.advance(0.4);
    expect(out(delay)).toBe(false);
    game.advance(1);
    expect(out(delay)).toBe(true);
    game.advance(0.2);
    expect(out(latch)).toBe(true);
    lever.components[0]!.onInteract!();
    game.advance(1.4);
    expect(out(delay)).toBe(false);
    expect(out(latch)).toBe(true);
    lever.components[0]!.onInteract!();
    game.advance(1.4);
    expect(out(latch)).toBe(false);
  });

  it('has new weapons with distinct effects', () => {
    const t = ent('crate_metal', 0, 0.6, 24);
    const near = ent('crate_metal', 1.8, 0.6, 24);
    game.advance(0.4);
    aim(t.position);
    expect(game.tools.selectById('foam')).toBe(true);
    (game.tools.active as DataTool).tryFire();
    expect(t.frozen).toBe(true);
    game.freeze.timers.release(t.id);
    game.tools.selectById('scatter');
    const v0 = t.body!.linvel().z;
    (game.tools.active as DataTool).tryFire();
    game.advance(0.05);
    expect(t.body!.linvel().z).not.toBe(v0);
    game.tools.selectById('tesla');
    aim(t.position);
    const nearV = near.body!.linvel();
    const before = Math.hypot(nearV.x, nearV.z);
    (game.tools.active as DataTool).tryFire();
    game.advance(0.05);
    const after = near.body!.linvel();
    expect(Math.hypot(after.x, after.z)).toBeGreaterThanOrEqual(before);
    game.tools.select(0);
    noErrors();
  });

  it('has new core tools that do what they say', () => {
    const crate = ent('crate_wood', 0, 0.6, 26);
    game.advance(0.4);
    aim(crate.position);
    game.tools.selectById('anchor');
    game.tools.active.primaryDown();
    expect(crate.anchored).toBe(true);
    game.tools.active.primaryDown();
    expect(crate.anchored).toBe(false);
    game.tools.selectById('resizer');
    game.tools.active.primaryDown();
    expect(crate.scale).toBeCloseTo(1.25);
    game.tools.active.secondaryDown();
    expect(crate.scale).toBeCloseTo(1);
    game.tools.selectById('cloner');
    const n = game.entities.active.filter((e) => e.def.id === 'crate_wood').length;
    game.tools.active.primaryDown();
    expect(game.entities.active.filter((e) => e.def.id === 'crate_wood').length).toBe(n + 1);
    game.tools.select(0);
  });

  it('has vehicles with different wheel counts and tuning', () => {
    expect(catalog.get('truck')!.vehicle!.wheels.length).toBe(6);
    game.player.teleport({ x: 0, y: 1, z: 33 }, 0);
    const v = ent('kart', 0, 1, 30);
    game.advance(1);
    v.components.find((c) => c.onInteract)!.onInteract!();
    const z0 = v.position.z;
    game.input.enabled = true;
    game.input.pressAction('forward');
    game.advance(2);
    game.input.releaseAction('forward');
    expect(z0 - v.position.z).toBeGreaterThan(1);
    game.player.exitVehicle();
  });
});
