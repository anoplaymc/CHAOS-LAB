import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../game/core/Game';
import type { Entity } from '../game/entities/Entity';
import { NpcComponent } from '../game/npcs/NpcComponent';
import { serializeScene } from '../game/save/sceneIO';
import { readFolder } from '../modding/cli';
import { spawn } from './helpers';

const BOT = 'security_robots:guard_bot';
const ROOM = { x: 0, y: 1, z: 28 };

let game: Game;

const npc = (e: Entity) => e.components.find((c) => c instanceof NpcComponent) as NpcComponent;
const lines = () => game.mods.logs.filter((l) => l.mod === 'security_robots').map((l) => l.text);
const said = (word: string) => lines().filter((l) => l.includes(word));
const errors = () => game.mods.logs.filter((l) => l.level === 'error').map((l) => `${l.mod}: ${l.text}`);
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

const settingsButton = () => game.mods.menuButtons().find((b) => b.mod === 'Security Robots')!;
const menu = () => game.ui.get().modMenu!;
const press = (startsWith: string) => {
  const b = menu().buttons.find((x) => x.label.en.startsWith(startsWith));
  if (!b) throw new Error(`no button "${startsWith}" in ${menu().buttons.map((x) => x.label.en).join(', ')}`);
  b.run();
};
const label = (startsWith: string) => menu().buttons.find((x) => x.label.en.startsWith(startsWith))!.label.en;
const closeMenu = () => {
  game.ui.set({ modMenu: null });
  game.setOverlay(null);
};

/** Sets a choice setting through the real menu. */
function choose(name: string, value: string): void {
  settingsButton().run();
  for (let i = 0; i < 6 && !label(name).endsWith(value); i++) press(name);
  expect(label(name)).toContain(value);
  closeMenu();
}

/** A rogue target tough enough to last the test. */
function enemy(x: number, y: number, z: number, opts: { still?: boolean } = {}): Entity {
  const e = spawn(game, 'npc_robot', x, y, z);
  e.health = e.maxHealth = 100000;
  if (opts.still) npc(e).stun(30);
  return e;
}

beforeAll(async () => {
  await Game.init();
  game = new Game();
  game.input.virtualLock = true;
  game.startSession();
  const r = await game.mods.installBundle(readFolder('mods/security_robots'));
  expect(r.errors).toEqual([]);
  expect(r.record!.state).toBe('loaded');
});

afterAll(() => game.dispose());

beforeEach(() => {
  game.startSession();
  settingsButton().run();
  press('Reset to defaults');
  closeMenu();
  game.mods.clearLog();
  if (game.player.dead) game.player.respawn();
});

describe('Security Robots: patrolling a territory', () => {
  it('walks a route around where it was placed, and stays inside the territory', () => {
    const bot = spawn(game, BOT, ROOM.x, ROOM.y, ROOM.z);
    game.advance(0.2);
    expect(npc(bot).order.kind).toBe('patrol');
    expect(npc(bot).territory?.radius).toBe(10);
    let far = 0;
    let furthestOut = 0;
    const visited = new Set<string>();
    for (let i = 0; i < 120; i++) {
      game.advance(0.25);
      const d = flat(bot.position, ROOM);
      far = Math.max(far, d);
      furthestOut = Math.max(furthestOut, d);
      visited.add(`${Math.round(bot.position.x / 3)},${Math.round(bot.position.z / 3)}`);
    }
    expect(far).toBeGreaterThan(2.5);
    expect(furthestOut).toBeLessThan(10.5);
    expect(visited.size).toBeGreaterThan(3);
    expect(said('ALARM')).toEqual([]);
    expect(errors()).toEqual([]);
  });

  it('takes a new territory from its E menu, and goes there', () => {
    const bot = spawn(game, BOT, 0, 1, 24);
    game.advance(0.2);
    game.player.teleport({ x: 0, y: 1, z: 33 }, 0);
    game.advance(0.1);
    expect(npc(bot).onInteract()).toBe(true);
    press('Set territory here');
    closeMenu();
    const c = npc(bot).territory!.point;
    expect(flat(c, { x: 0, z: 33 })).toBeLessThan(0.5);
    choose('Territory radius', '6 m');
    expect(npc(bot).territory!.radius).toBe(6);
    game.advance(25);
    expect(flat(bot.position, c)).toBeLessThan(6.5);
    expect(errors()).toEqual([]);
  });

  it('keeps its territory through a saved game', () => {
    const bot = spawn(game, BOT, 0, 1, 27);
    game.advance(0.2);
    const post = { ...npc(bot).territory!.point };
    game.advance(6);
    expect(flat(bot.position, post)).toBeGreaterThan(0.5);
    game.mods.clearLog();
    game.loadSave(serializeScene(game, 'test', 'scene'));
    const back = game.entities.active.find((e) => e.def.id === BOT)!;
    game.advance(0.5);
    expect(npc(back).order.kind).toBe('patrol');
    expect(flat(npc(back).territory!.point, post)).toBeLessThan(0.01);
    expect(npc(back).territory!.radius).toBe(10);
    // Its scripts still work after loading.
    enemy(3, 1, 27);
    game.advance(1);
    expect(said('CONTACT npc_robot').length).toBe(1);
    expect(errors()).toEqual([]);
  });
});

describe('Security Robots: hostile NPCs', () => {
  it('reports a rogue robot once, and really fights it', () => {
    const bot = spawn(game, BOT, -3, 1, 27);
    game.advance(0.2);
    const target = enemy(3, 1, 27);
    game.advance(6);
    expect(said('CONTACT npc_robot').length).toBe(1);
    expect(said('ALARM hostile_').length).toBe(1);
    expect(npc(bot).targetEntity).toBe(target);
    expect(target.health).toBeLessThan(100000);
    expect(errors()).toEqual([]);
  });

  it('does not report friendly or neutral NPCs', () => {
    spawn(game, BOT, -3, 1, 27);
    spawn(game, 'npc_guard', 3, 1, 27);
    spawn(game, 'npc_creature', 3, 1, 25);
    game.advance(5);
    expect(said('CONTACT')).toEqual([]);
  });

  it('does not report an enemy it can see beyond the reach of its territory', () => {
    game.startSession({ map: 'industrial_yard' });
    game.mods.clearLog();
    choose('Territory radius', '6 m');
    const bot = spawn(game, BOT, 0, 1, 0);
    game.advance(0.2);
    // Reach is 6 + 18 = 24, and sight is 26.
    const target = enemy(0, 1, 25, { still: true });
    game.advance(0.5);
    expect(npc(bot).enemiesInSight()).toContain(target);
    expect(said('CONTACT')).toEqual([]);
    expect(npc(bot).targetEntity).toBe(null);
  });

  it('fights an enemy beyond the edge from inside its territory', () => {
    game.startSession({ map: 'industrial_yard' });
    game.mods.clearLog();
    const bot = spawn(game, BOT, 0, 1, 0);
    game.advance(0.2);
    // Territory radius 10 and attack range 18: the robot has to walk to the edge to get a shot.
    const target = enemy(0, 1, 26, { still: true });
    let furthest = 0;
    for (let i = 0; i < 40; i++) {
      game.advance(0.25);
      furthest = Math.max(furthest, flat(bot.position, { x: 0, z: 0 }));
    }
    expect(said('CONTACT npc_robot').length).toBe(1);
    expect(target.health).toBeLessThan(100000);
    expect(furthest).toBeLessThan(10.5);
  });

  it('only calls robots within radio range', () => {
    game.startSession({ map: 'industrial_yard' });
    choose('Territory radius', '20 m');
    choose('Radio range', '15 m');
    spawn(game, BOT, 0, 1, 0);
    spawn(game, BOT, 0, 1, 25);
    game.advance(0.2);
    game.mods.clearLog();
    game.explode({ x: 0, y: 1, z: 5 }, 1, 0, 0);
    game.advance(0.1);
    expect(said('ALARM explosion responders: 1').length).toBe(1);

    choose('Radio range', '60 m');
    game.advance(7);
    game.mods.clearLog();
    game.explode({ x: 0, y: 1, z: 5 }, 1, 0, 0);
    game.advance(0.1);
    expect(said('ALARM explosion responders: 2').length).toBe(1);
  });

  it('ends the alarm after the hostile is destroyed, and counts it', () => {
    spawn(game, BOT, -3, 1, 27);
    game.advance(0.2);
    const target = spawn(game, 'npc_robot', 3, 1, 27);
    target.health = 1;
    game.advance(3);
    expect(said('NEUTRALIZED npc_robot').length).toBe(1);
    expect(said('ALL CLEAR')).toEqual([]);
    game.advance(10);
    expect(said('ALL CLEAR').length).toBe(1);
    expect(game.ui.get().modPanels.flatMap((p) => p.lines.map((l: { en: string }) => l.en)).join(' ')).toContain('1');
  });
});

describe('Security Robots: found by independent review', () => {
  it('counts an enemy destroyed before the robot looked around', () => {
    const bot = spawn(game, BOT, -3, 1, 27);
    game.advance(0.05);
    const target = spawn(game, 'npc_robot', 3, 1, 27);
    // The same step, so no on_think can have seen it. This raced in 1 of about 6 runs of the test above.
    game.damageEntity(target, 1000, { kind: 'npc', entity: bot });
    expect(said('NEUTRALIZED npc_robot').length).toBe(1);
    game.advance(13);
    expect(said('ALL CLEAR').length).toBe(1);
  });

  it('fights an NPC that hurts the player, whatever its faction', () => {
    const bot = spawn(game, BOT, -3, 1, 27);
    const attacker = spawn(game, 'npc_technician', 3, 1, 27);
    game.advance(0.3);
    game.player.takeDamage(1, 'npc', attacker);
    game.advance(0.5);
    expect(bot.components.find((c) => 'targetEntity' in c)).toBeDefined();
    expect((bot.components.find((c) => 'targetEntity' in c) as unknown as { targetEntity: unknown }).targetEntity).toBe(attacker);
    const hp = attacker.health;
    game.advance(4);
    expect(attacker.dead || attacker.health < hp).toBe(true);
  });

  it('keeps its patrol through a reload of the mod', async () => {
    spawn(game, BOT, 0, 1, 27);
    game.advance(0.5);
    await game.mods.reload('security_robots');
    const bot = game.entities.active.find((e) => e.def.id === BOT)!;
    const order = bot.components.find((c) => 'order' in c) as unknown as { order: { kind: string } };
    game.advance(0.5);
    expect(order.order.kind).toBe('patrol');
  });
});

describe('Security Robots: game events', () => {
  it('goes to an explosion in its territory, and only then', () => {
    const bot = spawn(game, BOT, 0, 1, 27);
    game.advance(0.2);
    game.explode({ x: 60, y: 1, z: 27 }, 2, 0, 0);
    game.advance(0.5);
    expect(said('ALARM explosion')).toEqual([]);

    game.advance(7);
    const blast = { x: 4, y: 1, z: 31 };
    game.explode(blast, 2, 0, 0);
    game.advance(0.1);
    expect(said('ALARM explosion').length).toBe(1);
    expect(npc(bot).state).toBe('investigate');
    // It gets there, looks, and goes back to its route.
    let nearest = Infinity;
    for (let i = 0; i < 12; i++) {
      game.advance(0.25);
      nearest = Math.min(nearest, flat(bot.position, blast));
    }
    expect(nearest).toBeLessThan(2);
  });

  it('ignores explosions when the setting is off', () => {
    const bot = spawn(game, BOT, 0, 1, 27);
    game.advance(0.2);
    settingsButton().run();
    press('React to explosions');
    closeMenu();
    game.explode({ x: 4, y: 1, z: 31 }, 2, 0, 0);
    game.advance(0.5);
    expect(said('ALARM')).toEqual([]);
    expect(npc(bot).state).not.toBe('investigate');
  });

  it('comes to the player when an NPC hurts them, unless it is the one shooting', () => {
    const bot = spawn(game, BOT, 0, 1, 24);
    game.advance(0.2);
    game.player.teleport({ x: 3, y: 1, z: 31 }, 0);
    game.player.takeDamage(1, 'npc');
    game.advance(0.5);
    expect(said('ALARM player_attacked').length).toBe(1);
    expect(npc(bot).state).toBe('investigate');

    game.mods.clearLog();
    game.advance(7);
    game.damageEntity(bot, 1, { kind: 'player' });
    game.advance(1);
    expect(npc(bot).targetEntity).toBe('player');
    game.player.takeDamage(1, 'npc');
    game.advance(0.2);
    expect(said('ALARM player_attacked')).toEqual([]);
  });

  it('calls for help when a robot is destroyed', () => {
    const a = spawn(game, BOT, -4, 1, 27);
    const b = spawn(game, BOT, 4, 1, 27);
    game.advance(0.2);
    game.damageEntity(a, 100000, { kind: 'npc', entity: null });
    game.advance(0.1);
    expect(npc(a).alive).toBe(false);
    expect(said('ALARM robot_down responders: 1').length).toBe(1);
    expect(npc(b).state).toBe('investigate');
  });

  it('tells other mods about alarms and all-clears', async () => {
    const r = await game.mods.installBundle({
      format: 'chaosmod-1',
      manifest: JSON.stringify({ id: 'sr_listener', name: 'Listener', version: '1.0.0', api_version: '1.0', author: 'test', description: 'test', scripts: ['main.chaos'] }),
      files: { 'main.chaos': `
        events.on("security_robots:alarm", function(e) log.info("HEARD", e.reason, e.responders) end)
        events.on("security_robots:all_clear", function(e) log.info("HEARD clear") end)
      ` },
      assets: {},
    } as never);
    expect(r.errors).toEqual([]);
    game.startSession();
    game.mods.clearLog();
    spawn(game, BOT, 0, 1, 27);
    game.advance(0.2);
    game.explode({ x: 3, y: 1, z: 30 }, 2, 0, 0);
    game.advance(0.2);
    const heard = () => game.mods.logs.filter((l) => l.mod === 'sr_listener').map((l) => l.text);
    expect(heard()).toEqual(['HEARD explosion 1']);
    game.advance(10);
    expect(heard()).toEqual(['HEARD explosion 1', 'HEARD clear']);
    await game.mods.uninstall('sr_listener');
  });
});

describe('Security Robots: settings', () => {
  it('only shoots back at the player while the setting is on, and forgives on death', () => {
    const bot = spawn(game, BOT, 0, 1, 25);
    game.advance(0.2);
    game.damageEntity(bot, 1, { kind: 'player' });
    expect(npc(bot).wasProvoked).toBe(true);

    settingsButton().run();
    press('Shoot back');
    closeMenu();
    expect(npc(bot).wasProvoked).toBe(false);
    game.damageEntity(bot, 1, { kind: 'player' });
    expect(npc(bot).wasProvoked).toBe(false);

    settingsButton().run();
    press('Shoot back');
    closeMenu();
    game.damageEntity(bot, 1, { kind: 'player' });
    expect(npc(bot).wasProvoked).toBe(true);
    game.player.takeDamage(100000, 'other');
    game.advance(0.1);
    expect(npc(bot).wasProvoked).toBe(false);
  });

  it('applies damage and radius to placed robots, and keeps them for later sessions', () => {
    const bot = spawn(game, BOT, 0, 1, 27);
    game.advance(0.2);
    expect(npc(bot).attackDamage).toBe(8);
    choose('Damage per shot', '14');
    choose('Territory radius', '20 m');
    expect(npc(bot).attackDamage).toBe(14);
    expect(npc(bot).territory!.radius).toBe(20);

    game.startSession();
    const next = spawn(game, BOT, 0, 1, 27);
    game.advance(0.2);
    expect(npc(next).attackDamage).toBe(14);
    expect(npc(next).territory!.radius).toBe(20);
  });

  it('hides the status panel when turned off, and when there are no robots', () => {
    const panel = () => game.ui.get().modPanels.filter((p) => p.key === 'security_robots/status');
    game.advance(1.2);
    expect(panel()).toEqual([]);
    const bot = spawn(game, BOT, 0, 1, 27);
    game.advance(1.2);
    expect(panel().length).toBe(1);
    settingsButton().run();
    press('Status panel');
    closeMenu();
    expect(panel()).toEqual([]);
    settingsButton().run();
    press('Status panel');
    closeMenu();
    expect(panel().length).toBe(1);
    game.entities.remove(bot);
    game.advance(1.2);
    expect(panel()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  it('survives a reload during play: the robot comes back with its territory and still works', async () => {
    const bot = spawn(game, BOT, 0, 1, 27);
    game.advance(3);
    const post = { ...npc(bot).territory!.point };
    await game.mods.reload('security_robots');
    game.mods.clearLog();
    const back = game.entities.active.find((e) => e.def.id === BOT)!;
    game.advance(0.5);
    expect(flat(npc(back).territory!.point, post)).toBeLessThan(0.01);
    expect(npc(back).order.kind).toBe('patrol');
    enemy(3, 1, 27);
    game.advance(2);
    expect(said('CONTACT npc_robot').length).toBe(1);
    expect(errors()).toEqual([]);
  });
});
