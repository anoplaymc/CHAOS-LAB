import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Game } from '../game/core/Game';
import type { Manipulator } from '../game/interaction/tools';
import { NpcComponent } from '../game/npcs/NpcComponent';
import { Group, groups, PhysicsWorld, RAPIER } from '../game/physics/PhysicsWorld';
import type { VehicleComponent } from '../game/vehicles/VehicleComponent';
import { headlessGame, spawn } from './helpers';

/** Real Rapier and the real Game, stepped deterministically. No mocks. */
describe('simulation', () => {
  let game: Game;

  beforeAll(async () => {
    game = await headlessGame();
  });
  afterAll(() => game.dispose());
  beforeEach(() => {
    game.restart();
    game.rules.damage = false;
    game.player.teleport({ x: 0, y: 1, z: 12 }, 0);
    game.player.pitch = 0;
    game.advance(0.1);
  });

  const aimAt = (x: number, y: number, z: number) => {
    const e = game.camera.position;
    game.player.yaw = Math.atan2(-(x - e.x), -(z - e.z));
    game.player.pitch = Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z));
    game.advance(1 / 60);
  };

  /** The player may walk off the far side, so report the highest point reached. */
  const walkAndMeasureTop = (seconds: number) => {
    let top = 0;
    for (let t = 0; t < seconds; t += 0.05) {
      game.advance(0.05);
      top = Math.max(top, game.player.feet.y);
    }
    return top;
  };

  it('a dropped crate falls, lands on the floor and goes to sleep', () => {
    const c = spawn(game, 'crate_metal', -6, 5, 12);
    game.advance(0.4);
    expect(c.position.y).toBeLessThan(5);
    game.advance(3);
    expect(c.position.y).toBeCloseTo(0.5, 1);
    expect(c.body!.isSleeping()).toBe(true);
  });

  it('crates collide: one lands on another rather than passing through', () => {
    const a = spawn(game, 'crate_metal', -6, 0.51, 12);
    const b = spawn(game, 'crate_metal', -6, 4, 12);
    game.advance(4);
    expect(b.position.y).toBeCloseTo(a.position.y + 1, 1);
  });

  it('bouncy gel keeps bouncing far higher than wood', () => {
    const gel = spawn(game, 'cube_bouncy', -7, 6, 12);
    const wood = spawn(game, 'pallet', -5, 6, 12);
    let gelTop = 0;
    let woodTop = 0;
    game.advance(1.15);
    for (let i = 0; i < 120; i++) {
      game.advance(1 / 60);
      gelTop = Math.max(gelTop, gel.position.y);
      woodTop = Math.max(woodTop, wood.position.y);
    }
    expect(gelTop).toBeGreaterThan(woodTop + 2);
  });

  it('ice slides much further than concrete under the same push', () => {
    const ice = spawn(game, 'block_ice', -8, 0.46, 15);
    const con = spawn(game, 'concrete_block', -8, 0.31, 12);
    game.advance(0.3);
    const i0 = ice.position.x;
    const c0 = con.position.x;
    ice.body!.setLinvel({ x: 5, y: 0, z: 0 }, true);
    con.body!.setLinvel({ x: 5, y: 0, z: 0 }, true);
    game.advance(1.5);
    expect(ice.position.x - i0).toBeGreaterThan((con.position.x - c0) * 2);
  });

  it('a hard enough impact breaks a crate into debris; a soft landing does not', () => {
    const soft = spawn(game, 'crate_wood', -8, 1.2, 14);
    const hard = spawn(game, 'crate_wood', -4, 3, 14);
    hard.body!.setLinvel({ x: 0, y: -22, z: 0 }, true);
    game.advance(1);
    expect(game.entities.get(soft.id)).toBeDefined();
    expect(game.entities.get(hard.id)).toBeUndefined();
    expect(game.debris.count).toBeGreaterThan(0);
  });

  it('debris respects its budget and expires', () => {
    game.debris.budget = 10;
    const p = { x: 0, y: 3, z: 12 };
    game.debris.spawn('wood', p, p, 30, { x: 0, y: 0, z: 0 });
    expect(game.debris.count).toBeLessThanOrEqual(10);
    game.advance(8);
    expect(game.debris.count).toBe(0);
    game.debris.budget = 110;
  });

  it('removing an entity removes its body, collider and visual', () => {
    const bodies = game.physics.bodyCount;
    const c = spawn(game, 'crate_small', -6, 3, 12);
    const col = c.colliders[0]!;
    expect(game.physics.bodyCount).toBe(bodies + 1);
    expect(game.physics.ownerOf(col)).toBe(c);
    const root = c.root;
    game.entities.remove(c);
    expect(game.physics.bodyCount).toBe(bodies);
    expect(game.physics.ownerOf(col)).toBeUndefined();
    expect(root.parent).toBeNull();
    expect(c.dead).toBe(true);
    game.advance(0.1);
  });

  it('removal of a motor also removes its rotor body', () => {
    const bodies = game.physics.bodyCount;
    const m = spawn(game, 'motor', -6, 0.21, 12);
    expect(game.physics.bodyCount).toBe(bodies + 2);
    game.entities.remove(m);
    expect(game.physics.bodyCount).toBe(bodies);
    game.advance(0.1);
  });

  it('restart never leaves a second world or duplicates entities', () => {
    const n = game.entities.registry.size;
    const kids = game.scene.children.length;
    for (let i = 0; i < 3; i++) {
      spawn(game, 'crate_small', -6, 3 + i, 12);
      game.restart();
    }
    expect(PhysicsWorld.liveWorlds).toBe(1);
    expect(game.entities.registry.size).toBe(n);
    expect(game.scene.children.length).toBe(kids);
    expect(game.npcs).toHaveLength(0);
  });

  it('explosions overlap-query without poisoning the world, push neighbours and chain', () => {
    const a = spawn(game, 'barrel_explosive', -8, 0.56, 12);
    const b = spawn(game, 'barrel_explosive', -6.8, 0.56, 12);
    const crate = spawn(game, 'crate_metal', -10.5, 0.51, 12);
    game.advance(0.3);
    const x0 = crate.position.x;
    game.damageEntity(a, 999, { kind: 'player' });
    game.advance(0.6);
    expect(game.entities.get(a.id)).toBeUndefined();
    expect(game.entities.get(b.id)).toBeUndefined();
    expect(crate.position.x).toBeLessThan(x0 - 0.1);
    game.restart();
    expect(game.physics.world).not.toBeNull();
  });

  it('manipulator holds an object at the crosshair without oscillating, then throws it', () => {
    const c = spawn(game, 'crate_small', 0, 0.31, 8);
    game.advance(0.3);
    aimAt(0, 0.3, 8);
    const m = game.tools.active as Manipulator;
    m.primaryDown();
    expect(m.held).toBe(c);
    game.player.pitch = 0.1;
    game.advance(1.5);
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      game.advance(1 / 60);
      samples.push(c.position.y);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.005);
    expect(c.position.y).toBeGreaterThan(1.5);
    m.secondaryDown();
    expect(m.held).toBeNull();
    game.advance(1 / 60);
    const v = c.body!.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(10);
    expect(c.body!.gravityScale()).toBe(1);
  });

  it('a held object cannot be pulled through a wall', () => {
    const c = spawn(game, 'crate_small', -19, 0.31, 2);
    game.player.teleport({ x: -18, y: 1, z: 2 }, Math.PI / 2);
    game.advance(0.3);
    aimAt(-19, 0.3, 2);
    const m = game.tools.active as Manipulator;
    m.primaryDown();
    expect(m.held).toBe(c);
    // Hold point is beyond the wall at x=-22.
    m.wheel(-20);
    aimAt(-40, 1.5, 2);
    game.advance(2);
    expect(c.position.x).toBeGreaterThan(-22);
    m.release();
  });

  it('manipulator refuses objects above its mass limit', () => {
    const c = spawn(game, 'block_heavy', 0, 0.51, 8);
    game.advance(0.2);
    aimAt(0, 0.5, 8);
    const m = game.tools.active as Manipulator;
    m.primaryDown();
    expect(m.held).toBeNull();
    expect(game.entities.get(c.id)).toBeDefined();
  });

  it('removing a held entity releases it cleanly', () => {
    const c = spawn(game, 'crate_small', 0, 0.31, 8);
    game.advance(0.2);
    aimAt(0, 0.3, 8);
    const m = game.tools.active as Manipulator;
    m.primaryDown();
    game.entities.remove(c);
    expect(m.held).toBeNull();
    expect(game.player.ignoreBody).toBeNull();
    game.advance(0.2);
  });

  it('freeze holds a body in place and restores its motion on the timer', () => {
    const c = spawn(game, 'crate_metal', -6, 6, 12);
    game.advance(0.3);
    const vy = c.body!.linvel().y;
    expect(game.freeze.freeze(c, 2)).toBe(true);
    const y = c.position.y;
    game.advance(1);
    expect(c.position.y).toBe(y);
    expect(c.frozen).toBe(true);
    game.advance(1.1);
    expect(c.frozen).toBe(false);
    expect(c.body!.isDynamic()).toBe(true);
    expect(c.body!.linvel().y).toBeLessThanOrEqual(vy + 0.01);
    game.advance(0.5);
    expect(c.position.y).toBeLessThan(y);
  });

  it('freeze on an anchored object does not turn it dynamic when it ends', () => {
    const c = spawn(game, 'crate_metal', -6, 3, 12);
    game.entities.setAnchored(c, true);
    game.freeze.freeze(c, 0.2);
    game.advance(0.4);
    expect(c.body!.isFixed()).toBe(true);
  });

  it('a removed frozen entity does not break the timers', () => {
    const c = spawn(game, 'crate_metal', -6, 3, 12);
    game.freeze.freeze(c, 0.2);
    game.entities.remove(c);
    game.advance(0.4);
    expect(game.freeze.timers.size).toBe(0);
  });

  it('the nav grid is built from the map and routes through the doorway into the spawn room', () => {
    const nav = game.nav!;
    const walkable = nav.walk.reduce((a, b) => a + b, 0);
    expect(walkable).toBeGreaterThan(800);
    const path = nav.findPath({ x: 8, z: -14 }, { x: 0, z: 29 })!;
    expect(path).not.toBeNull();
    // The only way in is the doorway at z=20, |x| < 3.
    const atDoor = path.filter((p) => p.z > 19 && p.z < 22);
    for (const p of atDoor) expect(Math.abs(p.x)).toBeLessThan(3.2);
    // The top of the machine block is flat, but no path may climb onto it.
    expect(nav.findPath({ x: -8, z: -1 }, { x: -15, z: -1 })).toBeNull();
  });

  it('an NPC that loses sight uses a real nav path to reach the last known position', () => {
    game.player.teleport({ x: 8, y: 1, z: 2 }, 0);
    const r = spawn(game, 'npc_robot', 8, 1.5, -12);
    const n = r.component(NpcComponent)!;
    game.advance(2);
    expect(n.state).toBe('attack');
    game.player.teleport({ x: -5, y: 1, z: 31 }, Math.PI);
    const states = new Set<string>();
    let longest = 0;
    for (let i = 0; i < 60; i++) {
      game.advance(0.1);
      states.add(n.state);
      longest = Math.max(longest, n.debugInfo().pathLength);
    }
    expect(states.has('investigate')).toBe(true);
    expect(longest).toBeGreaterThan(1);
    expect(Math.hypot(r.position.x - 8, r.position.z - 2)).toBeLessThan(6);
  });

  it('an NPC paths around a wall to a destination it cannot walk straight to', () => {
    // The machine block sits between these two points on the west side of the chamber.
    const r = spawn(game, 'npc_guard', -15, 1.5, -4.5);
    const n = r.component(NpcComponent)!;
    game.advance(0.3);
    n.brain.force('investigate');
    (n as unknown as { destination: { x: number; y: number; z: number } }).destination = { x: -15, y: 0, z: 2.5 };
    let reached = false;
    for (let i = 0; i < 100 && !reached; i++) {
      game.advance(0.1);
      reached = Math.hypot(r.position.x + 15, r.position.z - 2.5) < 1.5;
    }
    expect(reached).toBe(true);
  });

  it('the buggy settles, drives, steers, reverses, exits, and cleans up after itself', () => {
    for (const e of [...game.entities.active]) if (!e.fixture) game.entities.remove(e);
    const v = spawn(game, 'buggy', -2, 1, 16);
    game.advance(1);
    expect(v.position.y).toBeGreaterThan(0.4);
    expect(v.position.y).toBeLessThan(1.1);
    expect(v.components[0]!.onInteract!()).toBe(true);
    expect(game.player.driving).not.toBeNull();
    const heading = () => {
      const r = v.rotation;
      return Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y));
    };
    game.input.pressAction('forward');
    game.advance(1.2);
    expect(v.body!.linvel().z).toBeLessThan(-4);
    game.input.pressAction('left');
    const h0 = heading();
    game.advance(0.5);
    game.input.releaseAction('left');
    game.input.releaseAction('forward');
    expect(heading() - h0).toBeGreaterThan(0.1);
    game.input.pressAction('jump');
    game.advance(1.6);
    game.input.releaseAction('jump');
    expect(Math.hypot(v.body!.linvel().x, v.body!.linvel().z)).toBeLessThan(1.5);
    const fwd = () => { const a = heading(); return { x: -Math.sin(a), z: -Math.cos(a) }; };
    game.input.pressAction('back');
    game.advance(1);
    game.input.releaseAction('back');
    const f = fwd();
    expect(v.body!.linvel().x * f.x + v.body!.linvel().z * f.z).toBeLessThan(-1);
    game.player.exitVehicle();
    expect(game.player.driving).toBeNull();
    expect(game.player.collider!.isEnabled()).toBe(true);
    const bodies = game.physics.bodyCount;
    game.entities.remove(v);
    expect(game.physics.bodyCount).toBe(bodies - 1);
    game.advance(0.2);
  });

  it('every NPC archetype spawns, stands, and enters a valid AI state', () => {
    const valid = ['idle', 'patrol', 'investigate', 'chase', 'attack', 'flee', 'stunned'];
    const ids = ['npc_technician', 'npc_creature', 'npc_guard', 'npc_robot', 'npc_heavy'];
    const npcs = ids.map((id, i) => spawn(game, id, -8 + i * 3, 2, 10));
    game.advance(3);
    for (const e of npcs) {
      const n = e.component(NpcComponent)!;
      expect(valid).toContain(n.state);
      expect(e.position.y).toBeGreaterThan(0);
      expect(e.position.y).toBeLessThan(3);
    }
  });

  it('the plate powers a wired motor and door, and releasing it stops them', () => {
    const plate = spawn(game, 'pressure_plate', -10, 0.06, 8);
    const door = spawn(game, 'door_powered', -6, 1.41, 8);
    expect(game.signals.connect(plate.id, door.id)).toBeNull();
    const x0 = door.position.x;
    const load = spawn(game, 'crate_metal', -10, 1, 8);
    game.advance(3);
    expect(door.position.x).toBeGreaterThan(x0 + 1.5);
    game.entities.remove(load);
    game.advance(3);
    expect(door.position.x).toBeCloseTo(x0, 1);
  });

  it('the player cannot be spawned into, and placement refuses blocked spots', () => {
    game.player.teleport({ x: -21.2, y: 1, z: 2 }, Math.PI / 2);
    game.advance(0.2);
    game.player.pitch = 0;
    game.advance(1 / 60);
    expect(game.spawnAtCrosshair('platform')).toBeNull();
  });

  it('reaching the entity limit is refused with an explanation', () => {
    const n = game.entities.registry.budgetUsed;
    game.entities.registry.limits = { ...game.rules.limits, total: n + 2 };
    for (let i = 0; i < 2; i++) expect(game.trySpawn('crate_small', { position: { x: i * 2, y: 15, z: 10 } }).ok).toBe(true);
    const r = game.trySpawn('crate_small', { position: { x: 9, y: 15, z: 10 } });
    expect(r.ok).toBe(false);
    expect(game.ui.get().toasts.at(-1)?.text).toContain('limit');
  });

  it('pausing stops simulated time and resuming continues it', () => {
    game.pause();
    const t = game.time;
    game.advance(0.5);
    expect(game.time).toBe(t);
    game.resume();
    game.advance(0.5);
    expect(game.time).toBeGreaterThan(t);
  });

  it('the player walks, is stopped by walls, and can climb the ramp and the stairs', () => {
    const inp = game.input;
    game.player.teleport({ x: -18, y: 1, z: 2 }, Math.PI / 2);
    game.advance(0.1);
    inp.pressAction('forward');
    game.advance(3);
    inp.releaseAction('forward');
    expect(game.player.position.x).toBeLessThan(-20);
    expect(game.player.position.x).toBeGreaterThan(-22);

    game.player.teleport({ x: 16, y: 1, z: 5 }, 0);
    game.advance(0.1);
    inp.pressAction('forward');
    game.advance(3.5);
    inp.releaseAction('forward');
    expect(game.player.feet.y).toBeGreaterThan(2.5);

    game.player.teleport({ x: -19.5, y: 1, z: -1 }, 0);
    game.advance(0.1);
    inp.pressAction('forward');
    game.advance(2.6);
    inp.releaseAction('forward');
    expect(game.player.feet.y).toBeGreaterThan(2.2);
  });

  it('stairs never trap the player, from any start position', () => {
    for (const x of [-20.6, -20.2, -19.8, -19.5, -19.2, -18.9, -18.6, -18.4]) {
      for (const settle of [0.1, 0.5, 1]) {
        game.restart();
        game.rules.damage = false;
        game.player.teleport({ x, y: 1, z: -1 }, 0);
        game.player.pitch = 0;
        game.advance(settle);
        game.input.pressAction('forward');
        expect(walkAndMeasureTop(3), `x=${x} settle=${settle}`).toBeGreaterThan(2.4);
        game.input.releaseAction('forward');
      }
    }
  });

  it('raw low steps, the kind players build, do not wedge the player either', () => {
    for (const e of [...game.entities.active]) if (!e.fixture) game.entities.remove(e);
    const w = game.physics.w;
    for (let i = 0; i < 8; i++) {
      const h = 0.25 * (i + 1);
      w.createCollider(RAPIER.ColliderDesc.cuboid(4, h / 2, 0.25).setTranslation(-8, h / 2, 12 - (i + 0.5) * 0.5).setCollisionGroups(groups(Group.STATIC, 0xffff)), game.physics.ground);
    }
    game.advance(1 / 60);
    for (const x of [-11, -10.3, -9.7, -9, -8.4, -7.7, -7, -6.2, -5.1]) {
      game.player.teleport({ x, y: 0.95, z: 14 }, 0);
      game.player.pitch = 0;
      game.advance(0.3);
      game.input.pressAction('forward');
      expect(walkAndMeasureTop(2.4), `x=${x}`).toBeGreaterThan(1.95);
      game.input.releaseAction('forward');
    }
  });

  it('slopes do not bleed speed: walking up the ramp keeps pace with walking on the flat', () => {
    game.player.teleport({ x: 16, y: 1, z: 4.5 }, 0);
    game.advance(0.3);
    game.input.pressAction('forward');
    game.advance(0.7);
    const z0 = game.player.position.z;
    game.advance(0.5);
    game.input.releaseAction('forward');
    // 26 degree-ish ramp at 5.8 m/s walking speed: horizontal speed stays well above a crawl.
    expect((z0 - game.player.position.z) / 0.5).toBeGreaterThan(4);
  });

  it('walking into a wall at an angle slides along it instead of stopping', () => {
    game.player.teleport({ x: -20.5, y: 1, z: 13.2 }, Math.PI / 4);
    game.advance(0.2);
    game.input.pressAction('forward');
    game.advance(1);
    const z0 = game.player.position.z;
    game.advance(0.5);
    game.input.releaseAction('forward');
    expect(z0 - game.player.position.z).toBeGreaterThan(1);
  });

  it('jumping into a ceiling stops the rise rather than sticking', () => {
    const slab = game.entities.spawn('platform', { position: { x: 0, y: 2.6, z: 12 }, anchored: true });
    expect(slab.ok).toBe(true);
    game.player.teleport({ x: 0, y: 1, z: 12 }, 0);
    game.advance(0.3);
    game.player.queueJump();
    game.advance(0.25);
    expect(game.player.velocity.y).toBeLessThanOrEqual(0);
    game.advance(0.8);
    expect(game.player.grounded).toBe(true);
  });

  it('step assist will not climb walls or tall obstacles', () => {
    game.player.teleport({ x: -18, y: 1, z: 2 }, Math.PI / 2);
    game.advance(0.2);
    game.input.pressAction('forward');
    game.advance(4);
    game.input.releaseAction('forward');
    expect(game.player.feet.y).toBeLessThan(0.2);
    expect(game.player.position.x).toBeGreaterThan(-22);
  });

  it('crouching under a low ceiling stays crouched until there is room', () => {
    const p = game.player;
    // Slab 1.4m above the floor: enough for a crouching capsule only.
    const slab = game.entities.spawn('platform', { position: { x: 0, y: 1.55, z: 12 }, anchored: true });
    if (!slab.ok) throw new Error('slab');
    game.player.teleport({ x: 0, y: 0.6, z: 16 }, 0);
    game.advance(0.2);
    game.input.pressAction('crouch');
    game.advance(0.2);
    expect(p.crouching).toBe(true);
    game.player.teleport({ x: 0, y: p.position.y, z: 12 }, 0);
    game.advance(0.2);
    game.input.releaseAction('crouch');
    game.advance(0.2);
    expect(p.crouching).toBe(true);
    game.player.teleport({ x: 0, y: p.position.y, z: 16 }, 0);
    game.advance(0.2);
    expect(p.crouching).toBe(false);
  });

  it('getting out of a buggy parked against a wall leaves the player in the room, not on the roof', () => {
    const v = spawn(game, 'buggy', 5.9, 1, 28);
    game.advance(1);
    game.player.teleport({ x: 3.5, y: 1, z: 28 }, 0);
    game.advance(0.1);
    const car = v.components[0] as never as VehicleComponent;
    game.player.enterVehicle(car);
    game.advance(0.2);
    game.player.exitVehicle();
    game.advance(0.6);
    const f = game.player.feet;
    expect(game.player.driving).toBeNull();
    expect(f.y).toBeLessThan(1.5);
    expect(Math.abs(f.x)).toBeLessThan(6.7);
    expect(f.z).toBeGreaterThan(21);
    expect(f.z).toBeLessThan(35);
  });

  it('every tool model stays inside the player capsule, so none pokes through a wall the player touches', () => {
    const capsuleReach = 0.34 + 0.03;
    for (let i = 0; i < game.tools.tools.length; i++) {
      game.tools.select(i);
      game.advance(1);
      game.camera.updateWorldMatrix(true, true);
      const eye = game.camera.getWorldPosition(new THREE.Vector3());
      let far = 0;
      game.viewModel.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const pos = o.geometry.attributes.position as THREE.BufferAttribute;
        const v3 = new THREE.Vector3();
        for (let k = 0; k < pos.count; k++) far = Math.max(far, v3.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld).distanceTo(eye));
      });
      expect(far, game.tools.active.id).toBeLessThan(capsuleReach);
      expect(far, `${game.tools.active.id} still visible past the near plane`).toBeGreaterThan(game.camera.near);
    }
    game.tools.select(0);
  });

  it('clearing effects also clears what the GPU draws: no frozen fireball after a restart', () => {
    game.explode({ x: 0, y: 1, z: 8 }, 4, 500, 0);
    game.advance(0.1);
    const sparks = game.fx.sparks;
    expect(sparks.active).toBeGreaterThan(0);
    const g = sparks.points.geometry;
    const attrs = ['position', 'pcolor', 'size'].map((n) => g.getAttribute(n) as THREE.BufferAttribute);
    const before = attrs.map((a) => a.version);
    sparks.clear();
    expect(attrs.map((a) => a.version)).toEqual(before.map((n) => n + 1));
    const col = g.getAttribute('pcolor').array;
    for (let i = 3; i < col.length; i += 4) expect(col[i]).toBe(0);
  });

  it('turning flight off just under the ceiling drops the player to the floor, not through onto the roof', () => {
    const p = game.player;
    p.toggleFlight();
    // The chamber ceiling starts at y = 11. Standing height 1.8 m puts the top of the capsule just inside it.
    p.teleport({ x: 0, y: 10.2, z: 10 }, 0);
    game.advance(0.05);
    p.toggleFlight();
    expect(p.flying).toBe(false);
    game.advance(2);
    expect(p.feet.y).toBeLessThan(0.2);
    expect(p.grounded).toBe(true);
  });

  it('a player buried in a floor is still lifted out on top of it, never pushed underneath', () => {
    const p = game.player;
    p.teleport({ x: 0, y: 0.5, z: 10 }, 0);
    p.unstuck();
    game.advance(0.5);
    expect(p.feet.y).toBeGreaterThan(-0.1);
    expect(p.feet.y).toBeLessThan(0.5);
  });

  it('debris chips of every size share one geometry, so nothing accumulates in the geometry cache', () => {
    game.debris.spawn('wood', { x: 0, y: 2, z: 8 }, { x: 1, y: 1, z: 1 }, 40, { x: 0, y: 0, z: 0 });
    const chips = game.debris.group.children as THREE.Mesh[];
    expect(chips.length).toBeGreaterThanOrEqual(40);
    expect(new Set(chips.map((m) => m.geometry)).size).toBe(1);
    expect(new Set(chips.map((m) => m.scale.x)).size).toBeGreaterThan(1);
  });

  /** Flood-fills every spot a standing player can walk to from spawn and returns those with no floor under them. */
  const floorHoles = (limit: number) => {
    const STEP = 0.25;
    const capsule = new RAPIER.Capsule(0.56, 0.34);
    const ID = { x: 0, y: 0, z: 0, w: 1 };
    const spawnPoint = game.player.spawnPoint;
    const key = (i: number, k: number) => `${i},${k}`;
    const seen = new Set<string>([key(0, 0)]);
    const queue: [number, number][] = [[0, 0]];
    const holes: string[] = [];
    while (queue.length && seen.size < limit) {
      const [i, k] = queue.pop()!;
      const x = spawnPoint.x + i * STEP;
      const z = spawnPoint.z + k * STEP;
      const down = game.physics.raycast({ x, y: 0.5, z }, { x: 0, y: -1, z: 0 }, 4, { mask: Group.STATIC });
      if (!down) {
        holes.push(`${x.toFixed(2)},${z.toFixed(2)}`);
        continue;
      }
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = key(i + di, k + dk);
        if (seen.has(n)) continue;
        seen.add(n);
        const pos = { x: spawnPoint.x + (i + di) * STEP, y: 0.94, z: spawnPoint.z + (k + dk) * STEP };
        if (!game.physics.isBlocked(capsule, pos, ID, Group.STATIC, (c) => c === game.player.collider)) queue.push([i + di, k + dk]);
      }
    }
    return { holes, cells: seen.size };
  };

  it('the Test Facility has no hole in its floor anywhere a player can walk', () => {
    const r = floorHoles(100_000);
    expect(r.cells).toBeGreaterThan(5000);
    expect(r.holes).toEqual([]);
  });
});
