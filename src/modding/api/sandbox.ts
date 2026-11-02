import { ChaosError, fromPlain, Table, toPlain, type Value } from '../../chaosscript';
import { catalog } from '../../data/items';
import { SKY_PRESETS } from '../../game/maps/MapBuilder';
import { NpcComponent } from '../../game/npcs/NpcComponent';
import type { Entity } from '../../game/entities/Entity';
import { VehicleComponent } from '../../game/vehicles/VehicleComponent';
import { readFields, type Schema } from '../fields';
import { OVERLAY_NAMES, type EnvironmentState, type OverlayName } from '../SandboxControl';
import { fn, type ApiFn } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const NUMBER_OR_NIL = (min: number, max: number, doc: string) => ({ type: 'number' as const, min, max, doc });

const PLAYER_FIELDS: Schema = {
  speed: NUMBER_OR_NIL(-1, 10, 'Walking speed multiplier, at least 0.1.'),
  jump: NUMBER_OR_NIL(-1, 25, 'Jump height multiplier.'),
  gravity: NUMBER_OR_NIL(-1, 5, 'Multiplier on the gravity the player feels.'),
  fly_speed: NUMBER_OR_NIL(-1, 10, 'Flight speed multiplier, at least 0.1.'),
};

const WEAPON_FIELDS: Schema = {
  damage: NUMBER_OR_NIL(0, 100, 'Multiplier on damage the player deals with weapons.'),
  impulse: NUMBER_OR_NIL(0, 20, 'Multiplier on how hard the player\'s shots push.'),
  fire_rate: NUMBER_OR_NIL(0.1, 10, 'How quickly weapons cool down and recharge.'),
};

const NPC_FIELDS: Schema = {
  speed: NUMBER_OR_NIL(0, 5, 'Movement speed multiplier.'),
  sight: NUMBER_OR_NIL(0, 10, 'Sight range multiplier.'),
  hearing: NUMBER_OR_NIL(0, 10, 'Hearing range multiplier.'),
};

const VEHICLE_FIELDS: Schema = {
  engine: NUMBER_OR_NIL(0.1, 10, 'Engine force multiplier, which is its acceleration.'),
  top_speed: NUMBER_OR_NIL(0.1, 10, 'Top speed multiplier.'),
  grip: NUMBER_OR_NIL(0.1, 10, 'Tyre grip multiplier.'),
};

const ENV_FIELDS: Schema = {
  sun: NUMBER_OR_NIL(0, 5, 'Sunlight multiplier.'),
  ambient: NUMBER_OR_NIL(0, 5, 'Ambient light multiplier.'),
  fog: NUMBER_OR_NIL(0, 30, 'Fog density multiplier.'),
  preset: { type: 'enum', options: ['map', ...Object.keys(SKY_PRESETS)], doc: 'Sky and lighting to use. "map" is the map\'s own.' },
  hour: NUMBER_OR_NIL(-1, 24, 'Time of day, which moves the sun and blends the sky. Use -1 to go back to the map\'s fixed light.'),
};

const npcOf = (e: Entity) => e.component(NpcComponent);
const vehicleOf = (e: Entity) => e.component(VehicleComponent);

export const SANDBOX_API: ApiFn[] = [
  // ── sandbox: the player ──
  fn('sandbox', 'set_god', { params: [{ name: 'on', type: 'boolean' }], perm: 'sandbox', world: true, doc: 'God mode: no damage, full health, and blasts don\'t throw the player.', example: 'sandbox.set_god(true)\nplayer.damage(50)\nassert(player.health() == player.max_health())\nsandbox.set_god(false)', impl: (h, on: boolean) => { const p = h.game.player; h.game.sandbox.override(h.id, 'player:god', on ? true : null, () => p.god, (v) => { p.god = v; }); } }),
  fn('sandbox', 'set_player_tuning', {
    params: [{ name: 'tuning', type: 'table', doc: 'Fields to change. A field set to -1 goes back to normal, and a field left out stays as it is.' }],
    perm: 'sandbox', world: true,
    fields: PLAYER_FIELDS,
    doc: 'Scales how the player moves.',
    example: 'sandbox.set_player_tuning{ speed = 2, jump = 4 }\nsandbox.set_player_tuning{ speed = -1, jump = -1 }',
    impl: (h, t: Table) => {
      const f = readFields(t, PLAYER_FIELDS, 'sandbox.set_player_tuning') as Record<string, number | undefined>;
      const p = h.game.player;
      const map = [['speed', 'speedScale', 0.1], ['jump', 'jumpScale', 0], ['gravity', 'gravityScale', 0], ['fly_speed', 'flySpeedScale', 0.1]] as const;
      for (const [name, field, least] of map) {
        const v = f[name];
        if (v !== undefined) h.game.sandbox.override(h.id, `player:${name}`, v < 0 ? null : Math.max(least, v), () => p[field], (x) => { p[field] = x; });
      }
    },
  }),
  fn('sandbox', 'set_flight', { params: [{ name: 'on', type: 'boolean' }, { name: 'noclip', type: 'boolean', optional: true, doc: 'true passes through everything. false, the default, stops at walls.' }], returns: 'true if it changed', perm: 'sandbox', world: true, doc: 'Turns flight on or off, whatever the game mode allows. It can\'t change while driving or dead.', example: 'assert(sandbox.set_flight(true, false))\nassert(player.is_flying())\nsandbox.set_flight(false)', impl: (h, on: boolean, noclip: boolean | null) => h.game.sandbox.setFlight(h.id, on, noclip === true) }),
  fn('sandbox', 'set_rule_gravity', { params: [{ name: 'g', type: 'number', optional: true, doc: '-20 to 40. nil restores it.' }], perm: 'sandbox', world: true, doc: 'Changes world gravity, keeping the session\'s real value for saved games.', example: 'sandbox.set_rule_gravity(3)\nassert(game.gravity() == 3)\nsandbox.set_rule_gravity(nil)\nassert(game.gravity() == 9.81)', impl: (h, g: number | null) => h.game.sandbox.overrideRule(h.id, 'gravity', g === null ? null : clamp(g, -20, 40), (v) => h.game.setGravity(v)) }),
  fn('sandbox', 'set_rule_damage', { params: [{ name: 'enabled', type: 'boolean', optional: true, doc: 'nil restores it.' }], perm: 'sandbox', world: true, doc: 'Turns player damage on or off, keeping the session\'s real value for saved games.', example: 'sandbox.set_rule_damage(false)\nsandbox.set_rule_damage(nil)', impl: (h, on: boolean | null) => h.game.sandbox.overrideRule(h.id, 'damage', on, (v) => { h.game.rules.damage = v; }) }),
  fn('sandbox', 'set_rule_aggression', { params: [{ name: 'level', type: 'string', optional: true, doc: '"passive", "normal", "high", or nil to restore it.' }], perm: 'sandbox', world: true, doc: 'How readily NPCs attack, keeping the session\'s real value for saved games.', example: 'sandbox.set_rule_aggression("passive")\nsandbox.set_rule_aggression(nil)', impl: (h, a: string | null) => {
    if (a !== null && a !== 'passive' && a !== 'normal' && a !== 'high') throw new ChaosError(`sandbox.set_rule_aggression: level must be "passive", "normal" or "high", got "${a}".`);
    h.game.sandbox.overrideRule(h.id, 'aggression', a as 'passive' | 'normal' | 'high' | null, (v) => { h.game.rules.aggression = v; });
  } }),
  fn('sandbox', 'set_air_control', { params: [{ name: 'amount', type: 'number', optional: true, doc: '0 to 5. nil restores it.' }], perm: 'sandbox', world: true, doc: 'How much the player can steer in the air.', example: 'sandbox.set_air_control(2)\nsandbox.set_air_control(nil)', impl: (h, v: number | null) => h.game.sandbox.override(h.id, 'rule:air', v === null ? null : clamp(v, 0, 5), () => h.game.rules.airControl, (x) => { h.game.rules.airControl = x; }) }),

  // ── sandbox: weapons ──
  fn('sandbox', 'set_infinite_energy', { params: [{ name: 'on', type: 'boolean' }], perm: 'sandbox', world: true, doc: 'Keeps every energy bar full.', example: 'sandbox.set_infinite_energy(true)\nsandbox.set_infinite_energy(false)', impl: (h, on: boolean) => { const s = h.game.sandbox; s.override(h.id, 'weapons:energy', on ? true : null, () => s.infiniteEnergy, (v) => { s.infiniteEnergy = v; }); } }),
  fn('sandbox', 'refill_energy', { params: [], perm: 'sandbox', world: true, doc: 'Fills every tool\'s energy bar once.', example: 'sandbox.refill_energy()', impl: (h) => { for (const t of h.game.tools.tools) t.refillEnergy(); } }),
  fn('sandbox', 'set_weapon_tuning', {
    params: [{ name: 'tuning', type: 'table', doc: 'Fields to change. A field left out stays as it is, and 1 is normal.' }], perm: 'sandbox', world: true, fields: WEAPON_FIELDS,
    doc: 'Scales the player\'s weapons.', example: 'sandbox.set_weapon_tuning{ damage = 3, fire_rate = 2 }\nsandbox.set_weapon_tuning{ damage = 1, fire_rate = 1 }',
    impl: (h, t: Table) => {
      const f = readFields(t, WEAPON_FIELDS, 'sandbox.set_weapon_tuning') as Record<string, number | undefined>;
      const s = h.game.sandbox;
      const map = [['damage', 'damageScale'], ['impulse', 'impulseScale'], ['fire_rate', 'fireRateScale']] as const;
      for (const [name, field] of map) {
        const v = f[name];
        if (v !== undefined) s.override(h.id, `weapons:${name}`, v === 1 ? null : v, () => s[field], (x) => { s[field] = x; });
      }
    },
  }),
  fn('sandbox', 'set_unlock_tools', { params: [{ name: 'on', type: 'boolean' }], perm: 'sandbox', world: true, doc: 'Lets the player use every tool in a mode that limits them.', example: 'sandbox.set_unlock_tools(true)\nsandbox.set_unlock_tools(false)', impl: (h, on: boolean) => h.game.sandbox.setToolsUnlocked(h.id, on) }),
  fn('sandbox', 'tools', { params: [], returns: 'list of {id, kind, slot, allowed, name}', world: true, doc: 'Every tool in the hotbar, in order. Reading it needs no permission.', example: 'assert(#sandbox.tools() >= 12)', impl: (h) => h.game.tools.tools.map((t, i) => ({ id: t.id, kind: t.kind, slot: i + 1, allowed: h.game.tools.isAllowed(t), name: catalog.list().find((d) => d.toolId === t.id)?.name[h.game.settings.language] ?? t.id })) }),

  // ── sandbox: the world ──
  fn('sandbox', 'set_time_scale', { params: [{ name: 'scale', type: 'number', optional: true, doc: '0.1 to 3. nil restores normal speed.' }], perm: 'sandbox', world: true, doc: 'Slows or speeds up the simulation, player included. Frames still run at most 5 steps, so it can\'t run away.', example: 'sandbox.set_time_scale(0.5)\nsandbox.set_time_scale(nil)', impl: (h, v: number | null) => { const s = h.game.sandbox; s.override(h.id, 'world:time', v === null ? null : clamp(v, 0.1, 3), () => s.timeScale, (x) => { s.timeScale = x; }); } }),
  fn('sandbox', 'set_world_frozen', { params: [{ name: 'on', type: 'boolean' }], perm: 'sandbox', world: true, doc: 'Holds every physics object and NPC still, keeping its motion for when it ends. The player can still move. Debris and shots already fired carry on.', example: 'sandbox.set_world_frozen(true)\nassert(sandbox.world_frozen())\nsandbox.set_world_frozen(false)', impl: (h, on: boolean) => h.game.sandbox.setWorldFrozen(h.id, on) }),
  fn('sandbox', 'world_frozen', { params: [], returns: 'boolean', doc: 'True while the world is held still.', example: 'assert(sandbox.world_frozen() == false)', impl: (h) => h.game.sandbox.worldFrozen }),
  fn('sandbox', 'set_blast_scale', { params: [{ name: 'scale', type: 'number', optional: true, doc: '0 to 10. nil restores it.' }], perm: 'sandbox', world: true, doc: 'Multiplies the push of every explosion and shockwave.', example: 'sandbox.set_blast_scale(2)\nsandbox.set_blast_scale(nil)', impl: (h, v: number | null) => { const s = h.game.sandbox; s.override(h.id, 'world:blast', v === null ? null : clamp(v, 0, 10), () => s.blastScale, (x) => { s.blastScale = x; }); } }),
  fn('sandbox', 'set_environment', {
    params: [{ name: 'changes', type: 'table', optional: true, doc: 'Fields to change. A field left out stays as it is. nil puts the map\'s light back.' }], perm: 'sandbox', world: true, fields: ENV_FIELDS,
    doc: 'Changes the sky, sun, ambient light, fog and time of day.', example: 'sandbox.set_environment{ hour = 21, fog = 3 }\nassert(sandbox.environment().hour == 21)\nsandbox.set_environment(nil)',
    impl: (h, t: Table | null) => {
      if (!t) { h.game.sandbox.setEnvironment(h.id, null); return; }
      const f = readFields(t, ENV_FIELDS, 'sandbox.set_environment') as { sun?: number; ambient?: number; fog?: number; preset?: string; hour?: number };
      const patch: Partial<EnvironmentState> = {};
      if (f.sun !== undefined) patch.sun = f.sun;
      if (f.ambient !== undefined) patch.ambient = f.ambient;
      if (f.fog !== undefined) patch.fog = f.fog;
      if (f.preset !== undefined) patch.preset = f.preset === 'map' ? null : f.preset;
      if (f.hour !== undefined) patch.hour = f.hour < 0 ? null : f.hour;
      h.game.sandbox.setEnvironment(h.id, patch);
    },
  }),
  fn('sandbox', 'environment', { params: [], returns: '{sun, ambient, fog, preset, hour}', doc: 'The current changes to the light. preset and hour are nil when unchanged.', example: 'assert(sandbox.environment().sun == 1)', impl: (h) => h.game.sandbox.environment }),

  // ── sandbox: debug views ──
  fn('sandbox', 'set_overlay', { params: [{ name: 'name', type: 'string', doc: `${OVERLAY_NAMES.map((n) => `"${n}"`).join(', ')}.` }, { name: 'on', type: 'boolean' }], perm: 'sandbox', world: true, doc: 'A debug view drawn in the world: physics colliders, NPC sight and hearing rings, NPC movement, NPC state labels, or a box around highlighted entities.', example: 'sandbox.set_overlay("colliders", true)\nsandbox.set_overlay("colliders", false)', impl: (h, name: string, on: boolean) => {
    if (!(OVERLAY_NAMES as string[]).includes(name)) throw new ChaosError(`sandbox.set_overlay: unknown overlay "${name}". Use ${OVERLAY_NAMES.join(', ')}.`);
    const o = h.game.sandbox.overlays;
    const n = name as OverlayName;
    h.game.sandbox.override(h.id, `overlay:${n}`, on ? true : null, () => false, (v) => o.set(n, v));
  } }),
  fn('sandbox', 'set_highlight', { params: [{ name: 'ids', type: 'table', doc: 'A list of entity ids. An empty list clears it.' }], perm: 'sandbox', world: true, doc: 'Which entities the "highlight" overlay marks.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nsandbox.set_highlight({id})\nsandbox.set_overlay("highlight", true)\nsandbox.set_overlay("highlight", false)\nsandbox.set_highlight({})\nentity.remove(id)', impl: (h, t: Table) => { h.game.sandbox.overlays.highlight = new Set(t.list().filter((x): x is number => typeof x === 'number').slice(0, 64)); } }),
  fn('sandbox', 'perf', { params: [], returns: '{fps, frame_ms, physics_ms, entities, bodies, npcs, particles, debris}', world: true, doc: 'Live performance numbers, as on the F3 panel.', example: 'assert(sandbox.perf().bodies > 0)', impl: (h) => h.game.perfSnapshot() }),

  // ── sandbox: entities ──
  fn('sandbox', 'track_spawn', { params: [{ name: 'id', type: 'entity' }], perm: 'sandbox', doc: 'Marks an entity as this mod\'s, so it\'s removed when the mod stops.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nsandbox.track_spawn(id)\nassert(sandbox.is_tracked(id))\nentity.remove(id)', impl: (h, e: Entity) => h.game.sandbox.trackSpawn(h.id, e) }),
  fn('sandbox', 'is_tracked', { params: [{ name: 'id', type: 'number' }], returns: 'boolean', doc: 'True if a mod marked this entity with sandbox.track_spawn.', example: 'assert(sandbox.is_tracked(-1) == false)', impl: (h, id: number) => h.game.sandbox.isTracked(id) }),
  fn('sandbox', 'remember_entity', { params: [{ name: 'id', type: 'entity' }], perm: 'sandbox', doc: 'Remembers its scale, material, paint, anchoring, gravity scale and damping, to restore with sandbox.restore_entity or when the mod stops. Only the first call counts until it\'s restored.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nsandbox.remember_entity(id)\nentity.set_scale(id, 2)\nsandbox.restore_entity(id)\nassert(entity.scale(id) == 1)\nentity.remove(id)', impl: (h, e: Entity) => h.game.sandbox.rememberEntity(h.id, e) }),
  fn('sandbox', 'restore_entity', { params: [{ name: 'id', type: 'number' }], returns: 'true if there was something to restore', perm: 'sandbox', doc: 'Puts back what sandbox.remember_entity and sandbox.set_mass recorded.', example: 'assert(sandbox.restore_entity(-1) == false)', impl: (h, id: number) => h.game.sandbox.restoreEntity(id) }),
  fn('sandbox', 'set_mass', { params: [{ name: 'id', type: 'entity' }, { name: 'kg', type: 'number', doc: '0.1 to 20000.' }], perm: 'sandbox', doc: 'Changes its mass. sandbox.restore_entity puts it back.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nsandbox.set_mass(id, 500)\nassert(math.abs(entity.mass(id) - 500) < 1)\nsandbox.restore_entity(id)\nentity.remove(id)', impl: (h, e: Entity, kg: number) => h.game.sandbox.setMass(h.id, e, clamp(kg, 0.1, 20000)) }),
  fn('sandbox', 'set_invulnerable', { params: [{ name: 'id', type: 'entity' }, { name: 'on', type: 'boolean' }], perm: 'sandbox', doc: 'Makes one entity ignore all damage.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nsandbox.set_invulnerable(id, true)\nentity.damage(id, 5)\nassert(entity.health(id) == 60)\nsandbox.set_invulnerable(id, false)\nentity.remove(id)', impl: (h, e: Entity, on: boolean) => h.game.sandbox.setInvulnerable(h.id, e, on) }),
  fn('sandbox', 'is_invulnerable', { params: [{ name: 'id', type: 'entity' }], returns: 'boolean', doc: 'True if it ignores damage.', example: 'local id = entity.spawn("crate_wood", {x=0, y=30, z=0})\nassert(not sandbox.is_invulnerable(id))\nentity.remove(id)', impl: (_, e: Entity) => e.invulnerable }),

  // ── sandbox: NPCs ──
  fn('sandbox', 'npc_info', { params: [{ name: 'id', type: 'entity' }], returns: 'table, or nil if not an NPC', doc: 'What an NPC is like and what it\'s doing: type numbers, stance, faction, state, order, target, and its current multipliers.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nassert(sandbox.npc_info(id).faction == "lab")\nentity.remove(id)', impl: (_, e: Entity) => {
    const n = npcOf(e);
    if (!n) return null;
    const p = n.profile;
    return { type: p.id, faction: n.faction, stance: n.stance ?? 'default', hostile_to_player: n.isHostileToPlayer, state: n.state, order: n.order.kind, ai: n.aiEnabled, health: e.health, max_health: e.maxHealth, walk_speed: p.walkSpeed * n.speedScale, run_speed: p.runSpeed * n.speedScale, sight: n.sightRange, hearing: n.hearingRange, attack: p.attack, attack_range: p.attackRange, attack_damage: n.attackDamage ?? p.attackDamage, speed_scale: n.speedScale, sight_scale: n.sightScale, hearing_scale: n.hearingScale, target: n.targetEntity === 'player' ? 'player' : n.targetEntity?.id ?? null };
  } }),
  fn('sandbox', 'npc_set_ai', { params: [{ name: 'id', type: 'entity' }, { name: 'on', type: 'boolean' }], perm: 'sandbox', doc: 'Stops or resumes an NPC\'s thinking. It can still be pushed around.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nsandbox.npc_set_ai(id, false)\nassert(sandbox.npc_info(id).ai == false)\nsandbox.npc_set_ai(id, true)\nentity.remove(id)', impl: (h, e: Entity, on: boolean) => { const n = npcOf(e); if (n) h.game.sandbox.overrideNpc(h.id, n, 'aiEnabled', on ? null : false); } }),
  fn('sandbox', 'npc_set_stance', { params: [{ name: 'id', type: 'entity' }, { name: 'stance', type: 'string', optional: true, doc: '"friendly" joins the lab, "neutral" fights nobody, "hostile" hunts the player and joins the rogues. nil is its type\'s own. An NPC without an attack can\'t fight whatever its stance.' }], perm: 'sandbox', doc: 'Changes which side one NPC is on.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nsandbox.npc_set_stance(id, "hostile")\nassert(sandbox.npc_info(id).hostile_to_player)\nsandbox.npc_set_stance(id, nil)\nentity.remove(id)', impl: (h, e: Entity, s: string | null) => {
    if (s !== null && s !== 'friendly' && s !== 'neutral' && s !== 'hostile') throw new ChaosError(`sandbox.npc_set_stance: stance must be "friendly", "neutral" or "hostile", got "${s}".`);
    const n = npcOf(e);
    if (n) h.game.sandbox.overrideNpc(h.id, n, 'stance', s as 'friendly' | 'neutral' | 'hostile' | null);
  } }),
  fn('sandbox', 'npc_set_tuning', {
    params: [{ name: 'id', type: 'entity' }, { name: 'tuning', type: 'table', doc: 'Fields to change. A field left out stays as it is, and 1 is normal.' }], perm: 'sandbox', fields: NPC_FIELDS,
    doc: 'Scales one NPC\'s speed and detection ranges.', example: 'local id = entity.spawn("npc_guard", {x=0, y=30, z=0})\nsandbox.npc_set_tuning(id, { speed = 2, sight = 3 })\nassert(sandbox.npc_info(id).speed_scale == 2)\nentity.remove(id)',
    impl: (h, e: Entity, t: Table) => {
      const f = readFields(t, NPC_FIELDS, 'sandbox.npc_set_tuning') as Record<string, number | undefined>;
      const n = npcOf(e);
      if (!n) return;
      const map = [['speed', 'speedScale'], ['sight', 'sightScale'], ['hearing', 'hearingScale']] as const;
      for (const [name, field] of map) {
        const v = f[name];
        if (v !== undefined) h.game.sandbox.overrideNpc(h.id, n, field, v === 1 ? null : v);
      }
    },
  }),

  // ── sandbox: vehicles ──
  fn('sandbox', 'vehicle_info', { params: [{ name: 'id', type: 'entity' }], returns: 'table, or nil if not a vehicle', doc: 'A vehicle\'s numbers and its current multipliers.', example: 'local id = entity.spawn("buggy", {x=0, y=30, z=0})\nassert(sandbox.vehicle_info(id).top_speed > 0)\nentity.remove(id)', impl: (h, e: Entity) => {
    const v = vehicleOf(e);
    if (!v) return null;
    return { engine: v.spec.engine * v.engineScale, top_speed: v.spec.topSpeed * v.topSpeedScale, grip: v.spec.grip * v.gripScale, engine_scale: v.engineScale, top_speed_scale: v.topSpeedScale, grip_scale: v.gripScale, wheels: v.spec.wheels.length, driven: h.game.player.driving === v };
  } }),
  fn('sandbox', 'vehicle_set_tuning', {
    params: [{ name: 'id', type: 'entity' }, { name: 'tuning', type: 'table', doc: 'Fields to change. A field left out stays as it is, and 1 is normal.' }], perm: 'sandbox', fields: VEHICLE_FIELDS,
    doc: 'Scales one vehicle\'s engine, top speed and grip.', example: 'local id = entity.spawn("buggy", {x=0, y=30, z=0})\nsandbox.vehicle_set_tuning(id, { engine = 2 })\nassert(sandbox.vehicle_info(id).engine_scale == 2)\nentity.remove(id)',
    impl: (h, e: Entity, t: Table) => {
      const f = readFields(t, VEHICLE_FIELDS, 'sandbox.vehicle_set_tuning') as Record<string, number | undefined>;
      const v = vehicleOf(e);
      if (!v) return;
      const s = h.game.sandbox;
      if (f.engine !== undefined) s.override(h.id, `e${e.id}:v_engine`, f.engine === 1 ? null : f.engine, () => v.engineScale, (x) => { v.engineScale = x; });
      if (f.top_speed !== undefined) s.override(h.id, `e${e.id}:v_top`, f.top_speed === 1 ? null : f.top_speed, () => v.topSpeedScale, (x) => { v.topSpeedScale = x; });
      if (f.grip !== undefined) s.override(h.id, `e${e.id}:v_grip`, f.grip === 1 ? null : f.grip, () => v.gripScale, (x) => v.setGripScale(x));
    },
  }),
  fn('sandbox', 'vehicle_upright', { params: [{ name: 'id', type: 'entity' }], perm: 'sandbox', doc: 'Lifts a vehicle and sets it back on its wheels, as R does when driving.', example: 'local id = entity.spawn("buggy", {x=0, y=30, z=0})\nsandbox.vehicle_upright(id)\nentity.remove(id)', impl: (_, e: Entity) => vehicleOf(e)?.resetUpright() }),

  // ── sandbox: the whole mod ──
  fn('sandbox', 'active', { params: [], returns: 'list of strings', doc: 'Names of the overrides this mod has in place.', example: 'sandbox.set_god(true)\nassert(table.contains(sandbox.active(), "player:god"))\nsandbox.set_god(false)', impl: (h) => h.game.sandbox.keysOf(h.id) }),
  fn('sandbox', 'revert_all', { params: [{ name: 'remove_spawned', type: 'boolean', optional: true, doc: 'Also removes what sandbox.track_spawn marked. Default false.' }], perm: 'sandbox', doc: 'Undoes every override this mod has in place, as if it had stopped.', example: 'sandbox.set_god(true)\nsandbox.revert_all()\nassert(#sandbox.active() == 0)', impl: (h, removeSpawned: boolean | null) => {
    const s = h.game.sandbox;
    for (const k of s.keysOf(h.id).reverse()) if (removeSpawned === true || !/^e\d+:spawned$/.test(k)) s.release(k);
  } }),
  fn('game', 'item_info', { params: [{ name: 'id', type: 'string' }], returns: 'table, or nil if there is no such item', doc: 'Details of one catalog item, for showing to the player.', example: 'assert(game.item_info("crate_wood").material == "wood")\nassert(game.item_info("nothing") == nil)', impl: (h, id: string) => {
    const d = catalog.get(h.resolveDef(id));
    if (!d) return null;
    const lang = h.game.settings.language;
    return { id: d.id, name: d.name[lang], description: d.desc[lang], kind: d.kind, category: d.category, material: d.material, body: d.body, shape: d.shape.type, health: d.health ?? null, breakable: d.breakSpeed !== undefined, tool: d.toolId ?? null, source: d.source ?? null };
  } }),
  fn('mod', 'logs', { params: [{ name: 'limit', type: 'number', optional: true, doc: 'Most recent entries to return, up to 200. Default 50.' }, { name: 'level', type: 'string', optional: true, doc: '"info", "warn" or "error". Default all.' }], returns: 'list of {mod, level, text, time}', perm: 'sandbox', doc: 'The log of every mod, as shown in the debug console.', example: 'log.info("hello")\nassert(#mod.logs(5) > 0)', cost: 40, impl: (h, n: number | null, level: string | null) => h.manager.logs.filter((l) => !level || l.level === level).slice(-clamp(n ?? 50, 1, 200)).map((l) => ({ mod: l.mod, level: l.level, text: l.text, time: l.time })) }),
  fn('mod', 'status', { params: [], returns: '{phase, errors, timers, handlers, keys, storage_bytes, heap_cells}', doc: 'How this mod\'s script is doing.', example: 'assert(mod.status().phase ~= nil)', cost: 200, impl: (h) => h.stats() }),
  fn('mod', 'api', { params: [{ name: 'word', type: 'string', optional: true, doc: 'Only functions whose name or description contains this.' }], returns: 'list of {name, signature, doc, permission}', doc: 'The API functions that exist.', example: 'assert(#mod.api("sandbox.set_god") == 1)', cost: 400, impl: (h, w: string | null) => h.apiEntries(w) }),

  // ── ui panels ──
  fn('ui', 'open_panel', { params: [{ name: 'view', type: 'table', doc: 'What to show. See ui.update_panel.' }, { name: 'on_event', type: 'function', doc: 'on_event(e), with e.type "control", "nav", "reset" or "chip", e.id and e.value.' }], perm: 'ui', world: true, doc: 'Opens a large panel with sections of toggles, sliders, lists, buttons, text boxes and key choosers, and frees the mouse. It\'s plain data that the game draws. The world keeps running.', example: 'ui.open_panel({ title = "Lab", sections = { { title = "Power", controls = { { type = "toggle", id = "on", label = "On", value = true } } } } }, function(e) log.info(e.type, e.id, e.value) end)\nassert(ui.panel_open())\nui.close_panel()', cost: 50, impl: (h, t: Table, f: Value) => wrapPlain(() => h.openForm(t, f)) }),
  fn('ui', 'update_panel', { params: [{ name: 'view', type: 'table', doc: 'title, subtitle, scale, nav (list of {id, label, badge}), active, search ({id, value, placeholder}), chips (list of {id, label}), sections (list of {title, note, controls}), footer (a list of controls), and confirm ({text, yes, no}). A control has a type: text (text, style), toggle, slider (min, max, step, unit), select (options as {value, label}), button (style, disabled), input (placeholder), textarea (rows, readonly, filename), key, or unavailable (reason). Most have id, label, hint and value, and a reset=true adds a reset button.' }], perm: 'ui', world: true, doc: 'Replaces what an open panel shows. Fields being edited keep their place. Limit: 1500 controls.', example: 'ui.open_panel({ title = "Lab" }, function(e) end)\nui.update_panel({ title = "Lab 2" })\nui.close_panel()', cost: 50, impl: (h, t: Table) => wrapPlain(() => h.updateForm(t)) }),
  fn('ui', 'close_panel', { params: [], perm: 'ui', world: true, doc: 'Closes this mod\'s panel.', example: 'ui.close_panel()', impl: (h) => h.closeForm() }),
  fn('ui', 'panel_open', { params: [], returns: 'boolean', doc: 'True while this mod\'s panel is on screen. Esc closes it without telling the mod.', example: 'assert(ui.panel_open() == false)', impl: (h) => h.formOpen }),

  // ── input ──
  fn('input', 'bind', { params: [{ name: 'code', type: 'string', doc: 'A key code such as "F6" or "KeyO".' }, { name: 'f', type: 'function' }], returns: 'binding id', perm: 'ui', doc: 'Runs f when the key is pressed during play. An unknown or reserved key is an error. Ends when the mod unloads.', example: 'local b = input.bind("F9", function() log.info("pressed") end)\nassert(input.unbind(b))', impl: (h, code: string, f: Value) => h.bindKey(code, f) }),
  fn('input', 'unbind', { params: [{ name: 'id', type: 'number' }], returns: 'true if it existed', perm: 'ui', doc: 'Removes a binding.', example: 'assert(input.unbind(-1) == false)', impl: (h, id: number) => h.unbindKey(id) }),

  // ── json ──
  fn('json', 'encode', { params: [{ name: 'value', type: 'any', doc: 'Text, numbers, booleans and tables of those.' }], returns: 'text', doc: 'Turns plain data into JSON text.', example: 'assert(json.encode({a=1}) == "{\\"a\\":1}")', cost: 100, impl: (_, v: Value) => wrapPlain(() => JSON.stringify(toPlain(v, 'json.encode'))) }),
  fn('json', 'decode', { params: [{ name: 'text', type: 'string', doc: 'At most 256 KB.' }], returns: 'value, or nil if it isn\'t valid JSON', doc: 'Reads JSON text into plain data.', example: 'assert(json.decode("{\\"a\\":1}").a == 1)\nassert(json.decode("not json") == nil)', cost: 100, impl: (_, s: string) => {
    if (s.length > 256 * 1024) return null;
    try {
      return fromPlain(JSON.parse(s));
    } catch {
      return null;
    }
  } }),
];

/** toPlain reports problems as plain errors, which scripts should see as their own. */
function wrapPlain<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof ChaosError) throw e;
    throw new ChaosError(e instanceof Error ? e.message : String(e));
  }
}

