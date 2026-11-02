import { ChaosError, Table, toPlain, type Value } from '../../chaosscript';
import { catalog } from '../../data/items';
import { materials } from '../../data/materials';
import { NpcComponent } from '../../game/npcs/NpcComponent';
import type { Entity } from '../../game/entities/Entity';
import { SCALE_MAX, SCALE_MIN } from '../../game/entities/EntityManager';
import { ScriptComponent } from '../../game/entities/ScriptComponent';
import { SOLID, type RayHit, Group, RAPIER } from '../../game/physics/PhysicsWorld';
import { VehicleComponent } from '../../game/vehicles/VehicleComponent';
import type { V3 } from '../../utils/math';
import { readFields, type Schema } from '../fields';
import type { ModHost } from '../ModHost';
import { fn, type ApiFn } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MAX_IMPULSE = 200_000;
const MAX_SPEED = 200;
const clampVec = (v: V3, m: number): V3 => ({ x: clamp(v.x, -m, m), y: clamp(v.y, -m, m), z: clamp(v.z, -m, m) });

const FILTER_FIELDS: Schema = {
  kind: { type: 'enum', options: ['prop', 'npc', 'vehicle'], doc: 'Only this kind of entity.' },
  def: { type: 'string', doc: 'Only this definition id.' },
  category: { type: 'string', doc: 'Only this spawn menu category.' },
};

function filter(h: ModHost, t: Table | null, where: string): (e: Entity) => boolean {
  if (!t) return () => true;
  const f = readFields(t, FILTER_FIELDS, where);
  const def = f.def ? h.resolveDef(f.def as string) : null;
  return (e) => (!f.kind || e.def.kind === f.kind) && (!def || e.def.id === def) && (!f.category || e.def.category === f.category);
}

const npcOf = (e: Entity) => e.component(NpcComponent);

const SPAWN_FIELDS: Schema = {
  scale: { type: 'number', min: SCALE_MIN, max: SCALE_MAX, default: '1', doc: 'Size multiplier.' },
  yaw: { type: 'number', default: '0', doc: 'Rotation around the vertical axis, in radians.' },
  velocity: { type: 'vec3', doc: 'Starting velocity.' },
  material: { type: 'string', doc: 'A material id to use instead of the default.' },
  tint: { type: 'color', doc: 'Paint colour.' },
  anchored: { type: 'boolean', default: 'false', doc: 'Fixed in place.' },
};

export const WORLD_API: ApiFn[] = [
  // ── game ──
  fn('game', 'time', { params: [], returns: 'number', doc: 'Seconds of play since the session started.', example: 'assert(game.time() >= 0)', impl: (h) => h.game.time }),
  fn('game', 'in_session', { params: [], returns: 'boolean', doc: 'True while a world exists. It is false in the main menu.', example: 'log.info("in a session:", game.in_session())', impl: (h) => h.inSession }),
  fn('game', 'map', { params: [], returns: 'string', doc: 'Id of the current map, as last started.', example: 'log.info("map:", game.map())', impl: (h) => h.game.session.map }),
  fn('game', 'current_mode', { params: [], returns: 'string', doc: 'Id of the current game mode, as last started.', example: 'log.info("mode:", game.current_mode())', impl: (h) => h.game.session.mode }),
  fn('game', 'language', { params: [], returns: '"en" or "ru"', doc: 'The player\'s language setting.', example: 'assert(game.language() == "en" or game.language() == "ru")', impl: (h) => h.game.settings.language }),
  fn('game', 'gravity', { params: [], returns: 'number', doc: 'Session gravity in m/s². The default is 9.81.', example: 'assert(game.gravity() > 0)', impl: (h) => h.game.rules.gravity }),
  fn('game', 'set_gravity', { params: [{ name: 'g', type: 'number', doc: '-20 to 40. Negative pulls upward.' }], perm: 'rules', world: true, doc: 'Changes gravity for this session.', example: 'game.set_gravity(4)\nassert(game.gravity() == 4)\ngame.set_gravity(9.81)', impl: (h, g: number) => h.game.setGravity(clamp(g, -20, 40)) }),
  fn('game', 'set_damage', { params: [{ name: 'enabled', type: 'boolean' }], perm: 'rules', world: true, doc: 'Turns player damage on or off for this session.', example: 'game.set_damage(false)\ngame.set_damage(true)', impl: (h, on: boolean) => { h.game.rules.damage = on; } }),
  fn('game', 'set_aggression', { params: [{ name: 'level', type: 'string', doc: '"passive", "normal" or "high".' }], perm: 'rules', world: true, doc: 'How readily NPCs attack, for this session.', example: 'game.set_aggression("passive")\ngame.set_aggression("normal")', impl: (h, a: string) => {
    if (a !== 'passive' && a !== 'normal' && a !== 'high') throw new ChaosError(`game.set_aggression: level must be "passive", "normal" or "high", got "${a}".`);
    h.game.rules.aggression = a;
  } }),
  fn('game', 'explode', { params: [{ name: 'position', type: 'vec3' }, { name: 'radius', type: 'number', doc: 'Metres, 0.5 to 20.' }, { name: 'impulse', type: 'number', optional: true, doc: 'Push strength, up to 5000. Default 900.' }, { name: 'damage', type: 'number', optional: true, doc: 'Up to 500. Default 40.' }], perm: 'world', world: true, doc: 'A real explosion: fire, sound, push and damage, which also alerts NPCs. Happens at the end of the current step.', example: 'game.explode({x=0, y=30, z=0}, 3, 200, 0)', impl: (h, p: V3, r: number, i: number | null, d: number | null) => h.game.queueExplosion(p, clamp(r, 0.5, 20), clamp(i ?? 900, 0, 5000), clamp(d ?? 40, 0, 500)) }),
  fn('game', 'shockwave', { params: [{ name: 'position', type: 'vec3' }, { name: 'radius', type: 'number' }, { name: 'impulse', type: 'number', optional: true }, { name: 'damage', type: 'number', optional: true }], perm: 'world', world: true, doc: 'A blast without fire: a ring and a push. Limits as for game.explode.', example: 'game.shockwave({x=0, y=30, z=0}, 3, 300, 0)', impl: (h, p: V3, r: number, i: number | null, d: number | null) => h.game.shockwave(p, clamp(r, 0.5, 20), clamp(i ?? 600, 0, 5000), clamp(d ?? 0, 0, 500), null) }),
  fn('game', 'noise', { params: [{ name: 'position', type: 'vec3' }, { name: 'radius', type: 'number' }], perm: 'world', world: true, doc: 'A sound NPCs can hear and come to investigate.', example: 'game.noise({x=0, y=1, z=0}, 20)', impl: (h, p: V3, r: number) => h.game.makeNoise(p, clamp(r, 0, 200)) }),
  fn('game', 'items', { params: [{ name: 'category', type: 'string', optional: true }], returns: 'list of {id, name, kind, category, source}', doc: 'Everything in the spawn catalog, including other mods\' content. Name is in the player\'s language.', example: 'local all = game.items("props")\nassert(#all > 0)\nlog.info(all[1].id, all[1].name)', cost: 200, impl: (h, c: string | null) => catalog.list().filter((d) => !c || d.category === c).map((d) => ({ id: d.id, name: d.name[h.game.settings.language], kind: d.kind, category: d.category, source: d.source ?? null })) }),
  fn('game', 'materials', { params: [], returns: 'list of ids', doc: 'Every physics material id.', example: 'assert(table.contains(game.materials(), "wood"))', impl: () => materials.list().map((m) => m.id) }),

  // ── entity ──
  fn('entity', 'spawn', {
    params: [{ name: 'def', type: 'string', doc: 'Definition id. A name without ":" looks in this mod first, then core.' }, { name: 'position', type: 'vec3' }, { name: 'options', type: 'table', optional: true, doc: 'scale, yaw, velocity, material, tint, anchored' }],
    returns: 'id, or nil if the limit is reached',
    perm: 'world', world: true, fields: SPAWN_FIELDS, cost: 20,
    doc: 'Creates an entity. Returns nil when the session\'s entity limit or the mod\'s spawn rate limit (60 per second) is hit. An unknown definition is an error.',
    example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0}, {yaw=0.5, scale=1.5})\nassert(entity.exists(id))\nentity.remove(id)',
    impl: (h, def: string, p: V3, opts: Table | null) => {
      const id = h.resolveDef(def);
      const d = catalog.get(id);
      if (!d) throw h.unknownDef(def);
      if (d.kind === 'tool' || d.kind === 'effect') throw new ChaosError(`entity.spawn: "${id}" is a ${d.kind} and can't be placed in the world.`);
      if (!h.takeSpawnToken()) return null;
      const o = opts ? readFields(opts, SPAWN_FIELDS, 'entity.spawn options') : {};
      const yaw = o.yaw as number | undefined;
      const r = h.game.entities.spawn(id, {
        position: p,
        rotation: yaw ? { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } : undefined,
        scale: o.scale as number | undefined,
        linvel: o.velocity ? clampVec(o.velocity as V3, MAX_SPEED) : undefined,
        material: o.material as string | undefined,
        tint: o.tint as number | undefined,
        anchored: o.anchored as boolean | undefined,
      });
      return r.ok ? r.entity.id : null;
    },
  }),
  fn('entity', 'remove', { params: [{ name: 'id', type: 'entity' }], returns: 'true if removed', perm: 'world', doc: 'Removes an entity. Map fixtures can\'t be removed.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.remove(id))\nassert(not entity.exists(id))', impl: (h, e: Entity) => { if (e.fixture) return false; h.game.entities.remove(e); return true; } }),
  fn('entity', 'exists', { params: [{ name: 'id', type: 'number' }], returns: 'boolean', doc: 'True if this id is a live entity.', example: 'assert(entity.exists(-1) == false)', impl: (h, id: number) => { const e = h.game.entities.get(id); return !!e && !e.dead; } }),
  fn('entity', 'def', { params: [{ name: 'id', type: 'entity' }], returns: 'string', doc: 'The definition id, such as "crate_wood" or "my_mod:chair".', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.def(id) == "crate_wood")\nentity.remove(id)', impl: (_, e: Entity) => e.def.id }),
  fn('entity', 'kind', { params: [{ name: 'id', type: 'entity' }], returns: '"prop", "npc" or "vehicle"', doc: 'What sort of entity it is.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.kind(id) == "prop")\nentity.remove(id)', impl: (_, e: Entity) => e.def.kind }),
  fn('entity', 'position', { params: [{ name: 'id', type: 'entity' }], returns: 'position', doc: 'Where its centre is.', example: 'local id = entity.spawn("crate_wood", {x=2, y=30, z=0})\nassert(entity.position(id).x == 2)\nentity.remove(id)', impl: (_, e: Entity) => ({ ...e.position }) }),
  fn('entity', 'set_position', { params: [{ name: 'id', type: 'entity' }, { name: 'position', type: 'vec3' }], perm: 'world', doc: 'Moves it instantly and stops its motion.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_position(id, {x=1, y=31, z=1})\nentity.remove(id)', impl: (h, e: Entity, p: V3) => h.game.entities.setTransform(e, p, e.rotation) }),
  fn('entity', 'set_yaw', { params: [{ name: 'id', type: 'entity' }, { name: 'yaw', type: 'number' }], perm: 'world', doc: 'Sets its rotation around the vertical axis, in radians, and stops its motion.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_yaw(id, 1.57)\nentity.remove(id)', impl: (h, e: Entity, y: number) => h.game.entities.setTransform(e, e.position, { x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) }) }),
  fn('entity', 'velocity', { params: [{ name: 'id', type: 'entity' }], returns: 'position-shaped velocity', doc: 'Linear velocity in m/s.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.velocity(id).y == 0)\nentity.remove(id)', impl: (_, e: Entity) => { const v = e.body?.linvel() ?? { x: 0, y: 0, z: 0 }; return { x: v.x, y: v.y, z: v.z }; } }),
  fn('entity', 'set_velocity', { params: [{ name: 'id', type: 'entity' }, { name: 'velocity', type: 'vec3' }], perm: 'world', doc: 'Sets linear velocity, each axis limited to ±200. Does nothing to anchored or fixed things.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_velocity(id, {x=0, y=5, z=0})\nassert(entity.velocity(id).y == 5)\nentity.remove(id)', impl: (_, e: Entity, v: V3) => { if (e.isDynamic) e.body!.setLinvel(clampVec(v, MAX_SPEED), true); } }),
  fn('entity', 'apply_impulse', { params: [{ name: 'id', type: 'entity' }, { name: 'impulse', type: 'vec3', doc: 'Force × time. Divide by entity.mass for a change in velocity.' }], perm: 'world', doc: 'Pushes it, each axis limited to ±200000.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.apply_impulse(id, {x=0, y=100, z=0})\nassert(entity.velocity(id).y > 0)\nentity.remove(id)', impl: (_, e: Entity, v: V3) => { if (e.isDynamic) e.body!.applyImpulse(clampVec(v, MAX_IMPULSE), true); } }),
  fn('entity', 'mass', { params: [{ name: 'id', type: 'entity' }], returns: 'number', doc: 'Mass in game kilograms.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.mass(id) > 0)\nentity.remove(id)', impl: (_, e: Entity) => e.mass }),
  fn('entity', 'health', { params: [{ name: 'id', type: 'entity' }], returns: 'number', doc: 'Current health. Things without break_speed ignore damage.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.health(id) == 60)\nentity.remove(id)', impl: (_, e: Entity) => e.health }),
  fn('entity', 'max_health', { params: [{ name: 'id', type: 'entity' }], returns: 'number', doc: 'Full health.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.max_health(id) == 60)\nentity.remove(id)', impl: (_, e: Entity) => e.maxHealth }),
  fn('entity', 'set_health', { params: [{ name: 'id', type: 'entity' }, { name: 'health', type: 'number' }], perm: 'world', doc: 'Sets health, from 1 up to its maximum. Use entity.damage to kill or break it.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_health(id, 10)\nassert(entity.health(id) == 10)\nentity.remove(id)', impl: (_, e: Entity, v: number) => { e.health = clamp(v, 1, e.maxHealth); } }),
  fn('entity', 'damage', { params: [{ name: 'id', type: 'entity' }, { name: 'amount', type: 'number' }, { name: 'attacker', type: 'number', optional: true, doc: 'The NPC doing it. Its target then reports source "npc" and reacts to it.' }], perm: 'world', doc: 'Damages it the normal way, which can break it or kill it. Source is "other", or "npc" with an attacker.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.damage(id, 5)\nassert(entity.health(id) == 55)\nentity.remove(id)', impl: (h, e: Entity, a: number, by: number | null) => {
    const attacker = by === null ? undefined : h.game.entities.get(by);
    h.game.damageEntity(e, clamp(a, 0, 100000), attacker ? { kind: 'npc', entity: attacker, point: e.position } : { kind: 'other' });
  } }),
  fn('entity', 'set_gravity_scale', { params: [{ name: 'id', type: 'entity' }, { name: 'scale', type: 'number', doc: '-5 to 5. 1 is normal, 0 floats, negative rises.' }], perm: 'world', doc: 'Gravity multiplier for this object.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_gravity_scale(id, 0)\nentity.remove(id)', impl: (h, e: Entity, s: number) => { e.gravityScale = clamp(s, -5, 5); h.game.zones.applyEntity(e); } }),
  fn('entity', 'set_damping', { params: [{ name: 'id', type: 'entity' }, { name: 'linear', type: 'number', doc: '0 to 20' }, { name: 'angular', type: 'number', optional: true, doc: '0 to 20' }], perm: 'world', doc: 'Air resistance for this object. Higher slows it faster.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_damping(id, 2, 2)\nentity.remove(id)', impl: (_, e: Entity, l: number, a: number | null) => { e.body?.setLinearDamping(clamp(l, 0, 20)); if (a !== null) e.body?.setAngularDamping(clamp(a, 0, 20)); } }),
  fn('entity', 'set_anchored', { params: [{ name: 'id', type: 'entity' }, { name: 'anchored', type: 'boolean' }], perm: 'world', doc: 'Fixes a dynamic object in place, or releases it.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_anchored(id, true)\nassert(entity.is_anchored(id))\nentity.remove(id)', impl: (h, e: Entity, on: boolean) => h.game.entities.setAnchored(e, on) }),
  fn('entity', 'is_anchored', { params: [{ name: 'id', type: 'entity' }], returns: 'boolean', doc: 'True if fixed in place by anchoring.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(not entity.is_anchored(id))\nentity.remove(id)', impl: (_, e: Entity) => e.anchored }),
  fn('entity', 'freeze', { params: [{ name: 'id', type: 'entity' }, { name: 'seconds', type: 'number', doc: 'Up to 60.' }], perm: 'world', doc: 'Freezes a dynamic thing in place, with the ice effect.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.freeze(id, 2)\nentity.remove(id)', impl: (h, e: Entity, s: number) => h.game.freeze.freeze(e, clamp(s, 0, 60)) }),
  fn('entity', 'scale', { params: [{ name: 'id', type: 'entity' }], returns: 'number', doc: 'Size multiplier.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.scale(id) == 1)\nentity.remove(id)', impl: (_, e: Entity) => e.scale }),
  fn('entity', 'set_scale', { params: [{ name: 'id', type: 'entity' }, { name: 'scale', type: 'number', doc: '0.25 to 3' }], perm: 'world', doc: 'Resizes it, including its collision shape.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_scale(id, 2)\nassert(entity.scale(id) == 2)\nentity.remove(id)', impl: (h, e: Entity, s: number) => h.game.entities.setScale(e, s) }),
  fn('entity', 'set_tint', { params: [{ name: 'id', type: 'entity' }, { name: 'color', type: 'color', optional: true, doc: 'nil restores the original look.' }], perm: 'world', doc: 'Paints it.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_tint(id, 0xff8800)\nentity.set_tint(id, nil)\nentity.remove(id)', impl: (h, e: Entity, c: number | null) => h.game.entities.setTint(e, c) }),
  fn('entity', 'material', { params: [{ name: 'id', type: 'entity' }], returns: 'string', doc: 'Its physics material id.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.material(id) == "wood")\nentity.remove(id)', impl: (_, e: Entity) => e.materialId }),
  fn('entity', 'set_material', { params: [{ name: 'id', type: 'entity' }, { name: 'material', type: 'string' }], perm: 'world', doc: 'Changes its friction, bounce, weight and impact sound to those of another material.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_material(id, "ice")\nassert(entity.material(id) == "ice")\nentity.remove(id)', impl: (h, e: Entity, m: string) => {
    const id = materials.has(`${h.id}:${m}`) ? `${h.id}:${m}` : m;
    if (!materials.has(id)) throw new ChaosError(`entity.set_material: unknown material "${m}". See game.materials().`);
    h.game.entities.setMaterial(e, id);
  } }),
  fn('entity', 'find_near', {
    params: [{ name: 'position', type: 'vec3' }, { name: 'radius', type: 'number' }, { name: 'filter', type: 'table', optional: true, doc: 'kind, def or category' }],
    returns: 'list of ids, nearest first', world: true, cost: 100, fields: FILTER_FIELDS,
    doc: 'Entities whose centres are within the radius. Returns at most 256.',
    example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nlocal near = entity.find_near({x=0, y=30, z=0}, 2, {kind="prop"})\nassert(table.contains(near, id))\nentity.remove(id)',
    impl: (h, p: V3, r: number, f: Table | null) => {
      const pass = filter(h, f, 'entity.find_near filter');
      const out: { id: number; d: number }[] = [];
      for (const e of h.game.entities.active) {
        if (e.dead || !pass(e)) continue;
        const q = e.position;
        const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
        if (d <= r) out.push({ id: e.id, d });
      }
      out.sort((a, b) => a.d - b.d);
      return out.slice(0, 256).map((x) => x.id);
    },
  }),
  fn('entity', 'list', { params: [{ name: 'filter', type: 'table', optional: true, doc: 'kind, def or category' }], returns: 'list of ids', world: true, cost: 100, fields: FILTER_FIELDS, doc: 'All live entities, up to 1000.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(table.contains(entity.list({def="crate_wood"}), id))\nentity.remove(id)', impl: (h, f: Table | null) => {
    const pass = filter(h, f, 'entity.list filter');
    return h.game.entities.active.filter((e) => !e.dead && pass(e)).slice(0, 1000).map((e) => e.id);
  } }),
  fn('entity', 'set_data', { params: [{ name: 'id', type: 'entity' }, { name: 'key', type: 'string' }, { name: 'value', type: 'any', doc: 'Text, number, boolean, or a table of those. nil deletes.' }], perm: 'world', doc: 'Stores a value on this entity. Scripted props and NPCs keep it in saved games.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nentity.set_data(id, "owner", "me")\nassert(entity.get_data(id, "owner") == "me")\nentity.remove(id)', impl: (_, e: Entity, k: string, v: Value) => {
    const d = (e.scriptData ??= Object.create(null) as Record<string, unknown>);
    if (v === null) delete d[k];
    else d[k] = toPlain(v, `entity.set_data "${k}"`);
  } }),
  fn('entity', 'get_data', { params: [{ name: 'id', type: 'entity' }, { name: 'key', type: 'string' }], returns: 'value or nil', doc: 'Reads a value set with entity.set_data. Other mods\' values are visible too.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(entity.get_data(id, "nothing") == nil)\nentity.remove(id)', impl: (_, e: Entity, k: string) => {
    const d = e.scriptData;
    return d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null;
  } }),
  fn('entity', 'set_signal', { params: [{ name: 'id', type: 'entity' }, { name: 'on', type: 'boolean' }], perm: 'world', doc: 'Sets the wire output of a scripted prop registered with signal="out" or "both".', example: 'local id = entity.spawn("button", {x=0, y=30, z=0})\nentity.set_signal(id, true)\nentity.remove(id)', impl: (_, e: Entity, on: boolean) => { const c = e.component(ScriptComponent); if (c) c.out = on; } }),

  // ── npc ──
  fn('npc', 'is_npc', { params: [{ name: 'id', type: 'entity' }], returns: 'boolean', doc: 'True if this entity is an NPC.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nassert(npc.is_npc(id))\nentity.remove(id)', impl: (_, e: Entity) => !!npcOf(e) }),
  fn('npc', 'state', { params: [{ name: 'id', type: 'entity' }], returns: '"idle", "patrol", "investigate", "chase", "attack", "flee", "stunned" or "dead"', doc: 'What its brain is doing.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nassert(npc.state(id) == "idle")\nentity.remove(id)', impl: (_, e: Entity) => npcOf(e)?.state ?? null }),
  fn('npc', 'order', { params: [{ name: 'id', type: 'entity' }], returns: '"none", "go_to", "follow", "guard", "patrol", "use" or "tinker"', doc: 'What it has been told to do when not fighting.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nnpc.follow(id)\nassert(npc.order(id) == "follow")\nentity.remove(id)', impl: (_, e: Entity) => npcOf(e)?.order.kind ?? null }),
  fn('npc', 'faction', { params: [{ name: 'id', type: 'entity' }], returns: '"lab", "rogue" or "neutral"', doc: 'Which side it is on.', example: 'local id = entity.spawn("npc_robot", {x=0, y=30, z=0})\nassert(npc.faction(id) == "rogue")\nentity.remove(id)', impl: (_, e: Entity) => npcOf(e)?.profile.faction ?? null }),
  fn('npc', 'is_enemy', { params: [{ name: 'a', type: 'entity' }, { name: 'b', type: 'entity' }], returns: 'boolean', doc: 'True if these two NPCs fight each other on sight: one "lab" and one "rogue".', example: 'local a = entity.spawn("npc_guard", {x=0, y=30, z=0})\nlocal b = entity.spawn("npc_robot", {x=3, y=30, z=0})\nassert(npc.is_enemy(a, b))\nentity.remove(a)\nentity.remove(b)', impl: (_, a: Entity, b: Entity) => { const x = npcOf(a); const y = npcOf(b); return !!x && !!y && x.isEnemy(y); } }),
  fn('npc', 'enemies_in_sight', { params: [{ name: 'id', type: 'entity' }], returns: 'list of ids, nearest first', cost: 60, doc: 'Living enemy NPCs within its sight range and with a clear line to it. Checks at most the 16 nearest.', example: 'local a = entity.spawn("npc_guard", {x=0, y=30, z=0})\nlocal b = entity.spawn("npc_robot", {x=3, y=30, z=0})\nassert(npc.enemies_in_sight(a)[1] == b)\nentity.remove(a)\nentity.remove(b)', impl: (_, e: Entity) => npcOf(e)?.enemiesInSight().map((x) => x.id) ?? null }),
  fn('npc', 'target', { params: [{ name: 'id', type: 'entity' }], returns: 'an entity id, "player", or nil', doc: 'Who it has chosen to fight right now, which it re-decides a few times a second. Only NPCs with an attack ever have one.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nassert(npc.target(id) == nil)\nentity.remove(id)', impl: (_, e: Entity) => { const t = npcOf(e)?.targetEntity ?? null; return t === null || t === 'player' ? t : t.id; } }),
  fn('npc', 'can_see_target', { params: [{ name: 'id', type: 'entity' }], returns: 'boolean', doc: 'True if it has a target and a clear line to it.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nassert(not npc.can_see_target(id))\nentity.remove(id)', impl: (_, e: Entity) => npcOf(e)?.canSeeTarget ?? false }),
  fn('npc', 'attack', { params: [{ name: 'id', type: 'entity' }, { name: 'target', type: 'number', optional: true, doc: 'Another NPC, of any faction. nil clears it.' }], returns: 'true if the order was given', perm: 'world', doc: 'Makes it fight that NPC until it dies or the order is cleared, even outside its usual enemies. It needs an attack. A guard order or a territory still limits how far it goes.', example: 'local a = entity.spawn("npc_guard", {x=0, y=30, z=0})\nlocal b = entity.spawn("npc_technician", {x=3, y=30, z=0})\nassert(npc.attack(a, b))\nassert(not npc.is_enemy(a, b))\nnpc.attack(a, nil)\nentity.remove(a)\nentity.remove(b)', impl: (h, e: Entity, t: number | null) => {
    const n = npcOf(e);
    if (!n) return false;
    if (t === null) { n.attackNpc(null); return true; }
    const other = h.game.entities.get(t);
    const o = other ? npcOf(other) : undefined;
    if (!o || !o.alive || o === n) return false;
    n.attackNpc(o);
    return true;
  } }),
  fn('npc', 'set_territory', { params: [{ name: 'id', type: 'entity' }, { name: 'position', type: 'vec3', optional: true, doc: 'Centre. nil removes the territory.' }, { name: 'radius', type: 'number', optional: true, doc: 'Default 10.' }], perm: 'world', doc: 'A place it stays in whatever its order. It only fights what comes within radius + its attack range of the centre, won\'t walk out to investigate, and returns if pushed out. Kept in saved games.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nnpc.set_territory(id, {x=0, y=0, z=0}, 8)\nnpc.patrol(id, {{x=-5, y=0, z=0}, {x=5, y=0, z=0}})\nnpc.set_territory(id, nil)\nentity.remove(id)', impl: (_, e: Entity, p: V3 | null, r: number | null) => { const n = npcOf(e); if (n) n.territory = p ? { point: p, radius: clamp(r ?? 10, 1, 200) } : null; } }),
  fn('npc', 'set_attack_damage', { params: [{ name: 'id', type: 'entity' }, { name: 'damage', type: 'number', optional: true, doc: 'Up to 1000. nil goes back to the type\'s value.' }], perm: 'world', doc: 'Damage per attack for this one NPC, for bolt, tracer and slam attacks. Kept in saved games.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nnpc.set_attack_damage(id, 20)\nentity.remove(id)', impl: (_, e: Entity, d: number | null) => { const n = npcOf(e); if (n) n.attackDamage = d === null ? null : clamp(d, 0, 1000); } }),
  fn('npc', 'is_provoked', { params: [{ name: 'id', type: 'entity' }], returns: 'boolean', doc: 'True if the player has hurt it, for hostility="provoked".', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nassert(not npc.is_provoked(id))\nentity.remove(id)', impl: (_, e: Entity) => npcOf(e)?.wasProvoked ?? false }),
  fn('npc', 'set_provoked', { params: [{ name: 'id', type: 'entity' }, { name: 'provoked', type: 'boolean' }], perm: 'world', doc: 'Makes a hostility="provoked" NPC treat the player as an enemy, or forgive them.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nnpc.set_provoked(id, true)\nassert(npc.is_provoked(id))\nentity.remove(id)', impl: (_, e: Entity, v: boolean) => { const n = npcOf(e); if (n) n.wasProvoked = v; } }),
  fn('npc', 'go_to', { params: [{ name: 'id', type: 'entity' }, { name: 'position', type: 'vec3' }], perm: 'world', doc: 'Walks there, then stays. Uses the map\'s navigation grid when it has one.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nnpc.go_to(id, {x=3, y=0, z=3})\nentity.remove(id)', impl: (_, e: Entity, p: V3) => npcOf(e)?.setOrder({ kind: 'go_to', point: p }) }),
  fn('npc', 'follow', { params: [{ name: 'id', type: 'entity' }, { name: 'target', type: 'number', optional: true, doc: 'An entity id. Default: the player.' }, { name: 'distance', type: 'number', optional: true, doc: 'How close to stay. Default 3.5.' }], perm: 'world', doc: 'Keeps following until given another order.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nnpc.follow(id, nil, 2)\nentity.remove(id)', impl: (_, e: Entity, t: number | null, d: number | null) => npcOf(e)?.setOrder({ kind: 'follow', target: t ?? 'player', distance: clamp(d ?? 3.5, 1, 40) }) }),
  fn('npc', 'guard', { params: [{ name: 'id', type: 'entity' }, { name: 'position', type: 'vec3' }, { name: 'radius', type: 'number', optional: true, doc: 'Default 9.' }], perm: 'world', doc: 'Stays near a point and only fights enemies that come near it.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nnpc.guard(id, {x=0, y=0, z=0}, 6)\nassert(npc.order(id) == "guard")\nentity.remove(id)', impl: (_, e: Entity, p: V3, r: number | null) => npcOf(e)?.setOrder({ kind: 'guard', point: p, radius: clamp(r ?? 9, 1, 100) }) }),
  fn('npc', 'patrol', { params: [{ name: 'id', type: 'entity' }, { name: 'route', type: 'table', doc: 'A list of positions.' }, { name: 'loop', type: 'boolean', optional: true, doc: 'Default true.' }], perm: 'world', doc: 'Walks a route in order, without stopping between points. A point it can\'t reach is skipped after a couple of seconds.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nnpc.patrol(id, {{x=0, y=0, z=0}, {x=5, y=0, z=0}})\nentity.remove(id)', impl: (h, e: Entity, r: Table, l: boolean | null) => npcOf(e)?.setOrder({ kind: 'patrol', route: h.vecList(r, 'npc.patrol route').slice(0, 64), loop: l !== false, index: 0 }) }),
  fn('npc', 'use', { params: [{ name: 'id', type: 'entity' }, { name: 'target', type: 'entity', doc: 'What to go and use.' }], perm: 'world', doc: 'Walks to something and uses it, as if pressing E: buttons, levers, doors. Gives a light prop a shove instead.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nlocal b = entity.spawn("button", {x=4, y=30, z=0})\nnpc.use(id, b)\nassert(npc.order(id) == "use")\nentity.remove(id)\nentity.remove(b)', impl: (_, e: Entity, t: Entity) => npcOf(e)?.setOrder({ kind: 'use', target: t.id }) }),
  fn('npc', 'tinker', { params: [{ name: 'id', type: 'entity' }, { name: 'radius', type: 'number', optional: true, doc: 'Default 14.' }], perm: 'world', doc: 'Wanders over to nearby objects and fiddles with them, indefinitely.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nnpc.tinker(id, 10)\nentity.remove(id)', impl: (_, e: Entity, r: number | null) => npcOf(e)?.setOrder({ kind: 'tinker', radius: clamp(r ?? 14, 2, 100), target: null }) }),
  fn('npc', 'stop', { params: [{ name: 'id', type: 'entity' }], perm: 'world', doc: 'Clears its order, so it goes back to wandering.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nnpc.follow(id)\nnpc.stop(id)\nassert(npc.order(id) == "none")\nentity.remove(id)', impl: (_, e: Entity) => npcOf(e)?.setOrder({ kind: 'none' }) }),
  fn('npc', 'say', { params: [{ name: 'id', type: 'entity' }, { name: 'text', type: 'string' }], perm: 'world', doc: 'Shows a line of dialogue with its name.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nnpc.say(id, "Hello!")\nentity.remove(id)', impl: (_, e: Entity, t: string) => npcOf(e)?.say({ en: t.slice(0, 200), ru: t.slice(0, 200) }) }),
  fn('npc', 'stun', { params: [{ name: 'id', type: 'entity' }, { name: 'seconds', type: 'number', doc: 'Up to 30.' }], perm: 'world', doc: 'Stops it acting for a while.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nnpc.stun(id, 1)\nentity.remove(id)', impl: (_, e: Entity, s: number) => npcOf(e)?.stun(clamp(s, 0, 30)) }),
  fn('npc', 'alert', { params: [{ name: 'id', type: 'entity' }, { name: 'position', type: 'vec3' }], perm: 'world', doc: 'Sends a fighter to investigate a place, whatever its hearing range.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nnpc.alert(id, {x=1, y=0, z=1})\nentity.remove(id)', impl: (_, e: Entity, p: V3) => npcOf(e)?.alert(p) }),
  fn('npc', 'scare', { params: [{ name: 'id', type: 'entity' }, { name: 'from', type: 'vec3' }, { name: 'seconds', type: 'number', optional: true, doc: 'Default 3.' }], perm: 'world', doc: 'Makes it run away from a point.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nnpc.scare(id, {x=0, y=30, z=2})\nentity.remove(id)', impl: (_, e: Entity, p: V3, s: number | null) => npcOf(e)?.scare(p, clamp(s ?? 3, 0, 30)) }),
  fn('npc', 'all', { params: [], returns: 'list of ids', world: true, cost: 30, doc: 'Every NPC that is alive.', example: 'local id = entity.spawn("npc_technician", {x=0, y=30, z=0})\nassert(table.contains(npc.all(), id))\nentity.remove(id)', impl: (h) => h.game.npcs.filter((n) => n.alive).map((n) => n.e.id) }),

  // ── vehicle ──
  fn('vehicle', 'is_vehicle', { params: [{ name: 'id', type: 'entity' }], returns: 'boolean', doc: 'True if this entity can be driven.', example: 'local id = entity.spawn("buggy", {x=0, y=30, z=0})\nassert(vehicle.is_vehicle(id))\nentity.remove(id)', impl: (_, e: Entity) => !!e.component(VehicleComponent) }),
  fn('vehicle', 'speed', { params: [{ name: 'id', type: 'entity' }], returns: 'number', doc: 'Speed in m/s.', example: 'local id = entity.spawn("buggy", {x=0, y=30, z=0})\nassert(vehicle.speed(id) == 0)\nentity.remove(id)', impl: (_, e: Entity) => { const v = e.body?.linvel(); return v ? Math.hypot(v.x, v.y, v.z) : 0; } }),
  fn('vehicle', 'is_driven', { params: [{ name: 'id', type: 'entity' }], returns: 'boolean', doc: 'True if the player is driving this one.', example: 'local id = entity.spawn("buggy", {x=0, y=30, z=0})\nassert(not vehicle.is_driven(id))\nentity.remove(id)', impl: (h, e: Entity) => !!e.component(VehicleComponent) && h.game.player.driving === e.component(VehicleComponent) }),
  fn('vehicle', 'enter', { params: [{ name: 'id', type: 'entity' }], returns: 'true if the player got in', perm: 'player', doc: 'Puts the player in the driver\'s seat.', example: 'local id = entity.spawn("buggy", {x=0, y=30, z=0})\nassert(vehicle.enter(id))\nvehicle.exit()\nentity.remove(id)', impl: (h, e: Entity) => { const v = e.component(VehicleComponent); return v ? v.onInteract() : false; } }),
  fn('vehicle', 'exit', { params: [], perm: 'player', world: true, doc: 'Takes the player out of any vehicle.', example: 'vehicle.exit()', impl: (h) => { if (h.game.player.driving) h.game.player.exitVehicle(); } }),

  // ── player ──
  fn('player', 'position', { params: [], returns: 'position', world: true, doc: 'The centre of the player\'s body.', example: 'assert(player.position().y ~= nil)', impl: (h) => ({ ...h.game.player.position }) }),
  fn('player', 'feet', { params: [], returns: 'position', world: true, doc: 'The soles of the player\'s feet.', example: 'assert(player.feet().y < player.position().y)', impl: (h) => ({ ...h.game.player.feet }) }),
  fn('player', 'eye', { params: [], returns: 'position', world: true, doc: 'Where the camera is, when on foot.', example: 'assert(player.eye().y > player.position().y)', impl: (h) => ({ ...h.game.player.eye }) }),
  fn('player', 'look_dir', { params: [], returns: 'unit vector', world: true, doc: 'The direction the player faces.', example: 'local d = player.look_dir()\nassert(math.abs(vec.length(d) - 1) < 0.01)', impl: (h) => ({ ...h.game.player.forward }) }),
  fn('player', 'velocity', { params: [], returns: 'vector', world: true, doc: 'Velocity in m/s.', example: 'assert(player.velocity().x ~= nil)', impl: (h) => ({ ...h.game.player.velocity }) }),
  fn('player', 'health', { params: [], returns: 'number', world: true, doc: 'Current health.', example: 'assert(player.health() > 0)', impl: (h) => h.game.player.health }),
  fn('player', 'max_health', { params: [], returns: 'number', world: true, doc: 'Full health.', example: 'assert(player.max_health() >= player.health())', impl: (h) => h.game.player.maxHealth }),
  fn('player', 'set_health', { params: [{ name: 'health', type: 'number' }], perm: 'player', world: true, doc: 'Sets health, from 1 up to full. Use player.damage to hurt the player.', example: 'player.set_health(50)\nassert(player.health() == 50)\nplayer.set_health(100)', impl: (h, v: number) => { const p = h.game.player; if (!p.dead) p.health = clamp(v, 1, p.maxHealth); } }),
  fn('player', 'damage', { params: [{ name: 'amount', type: 'number' }], perm: 'player', world: true, doc: 'Hurts the player the normal way, which can kill. Respects the session\'s damage rule.', example: 'player.damage(1)\nplayer.set_health(100)', impl: (h, a: number) => h.game.player.takeDamage(clamp(a, 0, 1000), `mod:${h.id}`) }),
  fn('player', 'teleport', { params: [{ name: 'position', type: 'vec3' }, { name: 'yaw', type: 'number', optional: true, doc: 'Direction to face, in radians.' }], perm: 'player', world: true, doc: 'Moves the player\'s body centre there instantly.', example: 'local p = player.position()\nplayer.teleport({x=p.x, y=p.y, z=p.z}, 0)', impl: (h, p: V3, y: number | null) => h.game.player.teleport(p, y ?? undefined) }),
  fn('player', 'launch', { params: [{ name: 'velocity', type: 'vec3' }], perm: 'player', world: true, doc: 'Throws the player. Each axis is limited to ±100.', example: 'player.launch({x=0, y=2, z=0})\nassert(not player.is_grounded())', impl: (h, v: V3) => h.game.player.launch(clampVec(v, 100)) }),
  fn('player', 'respawn', { params: [], perm: 'player', world: true, doc: 'Back to the map\'s spawn point, at full health.', example: 'player.respawn()', impl: (h) => h.game.player.respawn() }),
  fn('player', 'is_dead', { params: [], returns: 'boolean', world: true, doc: 'True while waiting to respawn.', example: 'assert(player.is_dead() == false)', impl: (h) => h.game.player.dead }),
  fn('player', 'is_flying', { params: [], returns: 'boolean', world: true, doc: 'True in flight mode.', example: 'assert(player.is_flying() == false)', impl: (h) => h.game.player.flying }),
  fn('player', 'is_driving', { params: [], returns: 'boolean', world: true, doc: 'True in a vehicle.', example: 'assert(player.is_driving() == false)', impl: (h) => !!h.game.player.driving }),
  fn('player', 'is_grounded', { params: [], returns: 'boolean', world: true, doc: 'True when standing on something.', example: 'log.info("grounded:", player.is_grounded())', impl: (h) => h.game.player.grounded }),
  fn('player', 'tool', { params: [], returns: 'string', world: true, doc: 'Id of the selected tool, such as "blaster" or "my_mod:hammer".', example: 'assert(type(player.tool()) == "string")', impl: (h) => h.game.tools.active.id }),
  fn('player', 'select_tool', { params: [{ name: 'id', type: 'string', doc: 'A tool id. A name without ":" looks in this mod first.' }], returns: 'true if selected', perm: 'player', world: true, doc: 'Switches the selected tool.', example: 'assert(player.select_tool("blaster"))\nassert(player.tool() == "blaster")\nplayer.select_tool("manipulator")', impl: (h, id: string) => h.game.tools.selectById(h.game.tools.tools.some((t) => t.id === `${h.id}:${id}`) ? `${h.id}:${id}` : id) }),

  // ── physics ──
  fn('physics', 'raycast', { params: [{ name: 'origin', type: 'vec3' }, { name: 'direction', type: 'vec3', doc: 'Normalised for you.' }, { name: 'range', type: 'number', doc: 'Up to 500.' }], returns: '{point, normal, distance, entity} or nil', world: true, cost: 20, doc: 'The first solid thing along a line. entity is an id, or nil for the map.', example: 'local r = physics.raycast({x=0, y=50, z=0}, {x=0, y=-1, z=0}, 500)\nif r then log.info(r.distance, r.entity) end', impl: (h, o: V3, d: V3, range: number) => {
    const len = Math.hypot(d.x, d.y, d.z);
    if (len === 0) throw new ChaosError('physics.raycast: direction cannot be zero.');
    return hitTable(h.game.physics.raycast(o, { x: d.x / len, y: d.y / len, z: d.z / len }, clamp(range, 0, 500), { mask: SOLID }));
  } }),
  fn('physics', 'aim', { params: [{ name: 'range', type: 'number', optional: true, doc: 'Default 100.' }], returns: '{point, normal, distance, entity} or nil', world: true, cost: 20, doc: 'What is under the crosshair. This is the usual way for a tool to pick its target.', example: 'local r = physics.aim(50)\nif r and r.entity then log.info(entity.def(r.entity)) end', impl: (h, r: number | null) => hitTable(h.game.aimHit(clamp(r ?? 100, 0, 500))) }),
  fn('physics', 'overlap_sphere', { params: [{ name: 'position', type: 'vec3' }, { name: 'radius', type: 'number', doc: 'Up to 50.' }], returns: 'list of ids', world: true, cost: 60, doc: 'Entities whose collision shapes touch a sphere. More exact than entity.find_near, which only checks centres.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nlog.info(#physics.overlap_sphere({x=0, y=30, z=0}, 2))\nentity.remove(id)', impl: (h, p: V3, r: number) => {
    const seen = new Set<number>();
    h.game.physics.overlap(new RAPIER.Ball(clamp(r, 0.01, 50)), p, { x: 0, y: 0, z: 0, w: 1 }, Group.PROP | Group.NPC | Group.VEHICLE, (c) => {
      const o = h.game.physics.ownerOf(c) as Entity | undefined;
      if (o?.def) seen.add(o.id);
      return seen.size < 256;
    });
    return [...seen];
  } }),

  // ── vec ──
  fn('vec', 'new', { params: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'z', type: 'number' }], returns: 'position', doc: 'Makes a position.', example: 'assert(vec.new(1, 2, 3).y == 2)', impl: (_, x: number, y: number, z: number) => ({ x, y, z }) }),
  fn('vec', 'add', { params: [{ name: 'a', type: 'vec3' }, { name: 'b', type: 'vec3' }], returns: 'position', doc: 'a + b.', example: 'assert(vec.add({x=1, y=0, z=0}, {x=1, y=1, z=0}).x == 2)', impl: (_, a: V3, b: V3) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }) }),
  fn('vec', 'sub', { params: [{ name: 'a', type: 'vec3' }, { name: 'b', type: 'vec3' }], returns: 'position', doc: 'a - b.', example: 'assert(vec.sub({x=1, y=0, z=0}, {x=1, y=1, z=0}).y == -1)', impl: (_, a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }) }),
  fn('vec', 'scale', { params: [{ name: 'v', type: 'vec3' }, { name: 's', type: 'number' }], returns: 'position', doc: 'v × s.', example: 'assert(vec.scale({x=1, y=2, z=3}, 2).z == 6)', impl: (_, v: V3, s: number) => ({ x: v.x * s, y: v.y * s, z: v.z * s }) }),
  fn('vec', 'length', { params: [{ name: 'v', type: 'vec3' }], returns: 'number', doc: 'Length.', example: 'assert(vec.length({x=3, y=4, z=0}) == 5)', impl: (_, v: V3) => Math.hypot(v.x, v.y, v.z) }),
  fn('vec', 'dist', { params: [{ name: 'a', type: 'vec3' }, { name: 'b', type: 'vec3' }], returns: 'number', doc: 'Distance between two points.', example: 'assert(vec.dist({x=0, y=0, z=0}, {x=0, y=2, z=0}) == 2)', impl: (_, a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) }),
  fn('vec', 'normalize', { params: [{ name: 'v', type: 'vec3' }], returns: 'position', doc: 'Same direction with length 1, or zero for a zero vector.', example: 'assert(vec.normalize({x=0, y=9, z=0}).y == 1)', impl: (_, v: V3) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; } }),
  fn('vec', 'dot', { params: [{ name: 'a', type: 'vec3' }, { name: 'b', type: 'vec3' }], returns: 'number', doc: 'Dot product.', example: 'assert(vec.dot({x=1, y=0, z=0}, {x=0, y=1, z=0}) == 0)', impl: (_, a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z }),
  fn('vec', 'cross', { params: [{ name: 'a', type: 'vec3' }, { name: 'b', type: 'vec3' }], returns: 'position', doc: 'Cross product.', example: 'assert(vec.cross({x=1, y=0, z=0}, {x=0, y=1, z=0}).z == 1)', impl: (_, a: V3, b: V3) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }) }),

  // ── fx ──
  fn('fx', 'burst', { params: [{ name: 'position', type: 'vec3' }, { name: 'count', type: 'number', doc: 'Up to 200.' }, { name: 'color', type: 'color' }, { name: 'speed', type: 'number', optional: true, doc: 'Default 6.' }, { name: 'size', type: 'number', optional: true, doc: 'Default 0.1.' }, { name: 'life', type: 'number', optional: true, doc: 'Seconds. Default 0.5.' }], perm: 'effects', world: true, cost: 10, doc: 'Sparks flying out from a point.', example: 'fx.burst({x=0, y=2, z=0}, 20, 0xffb000, 5)', impl: (h, p: V3, n: number, c: number, s: number | null, z: number | null, l: number | null) => h.game.fx.burst(p, clamp(n, 0, 200), c, s ?? 6, z ?? 0.1, clamp(l ?? 0.5, 0.01, 6)) }),
  fn('fx', 'puff', { params: [{ name: 'position', type: 'vec3' }, { name: 'count', type: 'number', doc: 'Up to 60.' }, { name: 'color', type: 'color' }, { name: 'size', type: 'number', optional: true, doc: 'Default 0.5.' }, { name: 'life', type: 'number', optional: true, doc: 'Seconds. Default 1.' }], perm: 'effects', world: true, cost: 10, doc: 'A soft rising cloud.', example: 'fx.puff({x=0, y=2, z=0}, 5, 0x888888)', impl: (h, p: V3, n: number, c: number, z: number | null, l: number | null) => h.game.fx.puff(p, clamp(n, 0, 60), c, 0.4, z ?? 0.5, clamp(l ?? 1, 0.01, 8)) }),
  fn('fx', 'beam', { params: [{ name: 'from', type: 'vec3' }, { name: 'to', type: 'vec3' }, { name: 'color', type: 'color' }, { name: 'width', type: 'number', optional: true, doc: 'Default 0.03.' }, { name: 'life', type: 'number', optional: true, doc: 'Seconds. Default 0.1.' }], perm: 'effects', world: true, doc: 'A straight glowing line.', example: 'fx.beam({x=0, y=2, z=0}, {x=3, y=2, z=0}, 0x66d9ff)', impl: (h, a: V3, b: V3, c: number, w: number | null, l: number | null) => h.game.fx.beam(a, b, c, clamp(w ?? 0.03, 0.001, 1), clamp(l ?? 0.1, 0.01, 4)) }),
  fn('fx', 'ring', { params: [{ name: 'position', type: 'vec3' }, { name: 'radius', type: 'number' }, { name: 'color', type: 'color' }], perm: 'effects', world: true, doc: 'An expanding ring.', example: 'fx.ring({x=0, y=1, z=0}, 3, 0x19e0c4)', impl: (h, p: V3, r: number, c: number) => h.game.fx.ring(p, clamp(r, 0.1, 50), c) }),
  fn('fx', 'flash', { params: [{ name: 'position', type: 'vec3' }, { name: 'color', type: 'color' }, { name: 'brightness', type: 'number', optional: true, doc: 'Default 40.' }], perm: 'effects', world: true, doc: 'A brief light.', example: 'fx.flash({x=0, y=2, z=0}, 0xffffff)', impl: (h, p: V3, c: number, b: number | null) => h.game.fx.flash(p, c, clamp(b ?? 40, 0, 200)) }),
  fn('fx', 'explosion', { params: [{ name: 'position', type: 'vec3' }, { name: 'radius', type: 'number' }], perm: 'effects', world: true, doc: 'The look of an explosion, with no push or damage. See game.explode for the real one.', example: 'fx.explosion({x=0, y=30, z=0}, 3)', impl: (h, p: V3, r: number) => h.game.fx.explosion(p, clamp(r, 0.1, 30)) }),
  fn('fx', 'shake', { params: [{ name: 'amount', type: 'number', doc: '0 to 2.' }], perm: 'effects', world: true, doc: 'Shakes the camera.', example: 'fx.shake(0.3)', impl: (h, a: number) => h.game.player.addShake(clamp(a, 0, 2)) }),
];

function hitTable(hit: RayHit | null): Record<string, unknown> | null {
  if (!hit) return null;
  const o = hit.owner as Entity | undefined;
  return { point: { ...hit.point }, normal: { ...hit.normal }, distance: hit.distance, entity: o?.def ? o.id : null };
}
