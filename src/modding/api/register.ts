import { ChaosError, Table, type Value } from '../../chaosscript';
import { CATEGORIES, type Category, type ItemDef, type ShapeDef } from '../../data/items';
import { materials, type ImpactSound, type Loc } from '../../data/materials';
import { registerItem, registerMap, registerMaterial, registerMode, registerNpcType, registerToolType, onUnregister } from '../../game/content/registry';
import type { ModelPart, NpcBehaviorName, ScriptHooks, VehicleSpec } from '../../game/content/types';
import type { MapDef } from '../../game/maps/MapBuilder';
import { LEVEL_MATERIALS } from '../../game/mods/pack';
import { PERSONALITIES, type NpcProfile } from '../../game/npcs/NpcBrain';
import { DataTool, type DataToolSpec } from '../../game/weapons/DataTool';
import { dataViewModel, MODELS } from '../../game/weapons/ViewModel';
import type { V3 } from '../../utils/math';
import { readFields, type FieldSpec, type Schema } from '../fields';
import type { ModHost } from '../ModHost';
import { ScriptedMode } from '../ScriptedMode';
import { fn, type ApiFn } from './types';

const ID: FieldSpec = { type: 'string', required: true, doc: 'Lowercase name, unique in this mod. The full id becomes `your_mod:name`.' };
const NAME: FieldSpec = { type: 'loc', required: true, doc: 'Shown in menus.' };
const DESC: FieldSpec = { type: 'loc', doc: 'Shown in the spawn menu.' };

const BODY_FIELDS: Schema = {
  shape: { type: 'shape', required: true, doc: 'Collision shape: {type="box", size={x, y, z}}, {type="wedge", size={x, y, z}}, {type="sphere", r=}, {type="cylinder", r=, h=} or {type="capsule", r=, h=}. Dimensions are 0.05 to 12.' },
  material: { type: 'string', default: '"wood"', doc: 'Physics material: a built-in id (rubber, metal, wood, concrete, ice, gel, heavy, glass) or one this mod registered.' },
  color: { type: 'color', doc: 'Colour of the mesh generated from the shape, used when there is no model.' },
  visual: { type: 'string', doc: 'A built-in model name such as "crate", "barrel" or "bench". Optional.' },
  model: { type: 'parts', doc: 'A model built from primitive parts. See "Model parts" at the end of this document.' },
};

const PROP_FIELDS: Schema = {
  id: ID, name: NAME, desc: DESC,
  category: { type: 'enum', options: CATEGORIES.filter((c) => c !== 'npcs' && c !== 'vehicles' && c !== 'tools' && c !== 'weapons'), default: '"props"', doc: 'Spawn menu tab.' },
  ...BODY_FIELDS,
  body: { type: 'enum', options: ['dynamic', 'fixed'], default: '"dynamic"', doc: 'dynamic falls and can be thrown. fixed stays where it is placed.' },
  break_speed: { type: 'number', min: 0.5, max: 100, doc: 'Impact speed in m/s that starts to damage it. Without this it is unbreakable.' },
  health: { type: 'number', min: 1, max: 100000, default: '50 if breakable', doc: 'Health.' },
  debris: { type: 'enum', options: ['wood', 'glass', 'metal', 'stone', 'ice'], doc: 'What it shatters into when it breaks.' },
  debris_count: { type: 'number', min: 0, max: 24, default: '5', doc: 'How many chips.' },
  disintegrable: { type: 'boolean', default: 'true', doc: 'Whether the Disintegrator can dissolve it.' },
  build_part: { type: 'boolean', default: 'false', doc: 'Also list it in the Construction tool.' },
  behavior: { type: 'enum', options: ['explosive', 'button', 'lever', 'plate', 'timer', 'inverter', 'lamp', 'fan', 'spring_pad', 'emitter', 'delay', 'latch', 'conveyor', 'magnet', 'thruster', 'dispenser', 'teleporter', 'alarm'], doc: 'A built-in behaviour. See ENTITY_CREATION.md for each one\'s params.' },
  params: { type: 'table', doc: 'Numbers and text for the behaviour, such as {radius=4, impulse=500, damage=30}.' },
  signal: { type: 'enum', options: ['in', 'out', 'both'], doc: 'Wire ports. Use with on_signal and entity.set_signal.' },
  on_spawn: { type: 'function', doc: 'on_spawn(id). Runs once, on its first physics step.' },
  on_tick: { type: 'function', doc: 'on_tick(id, dt). Runs repeatedly. See tick_rate.' },
  tick_rate: { type: 'number', min: 0.05, max: 60, default: '0.1', doc: 'Seconds between on_tick calls.' },
  on_damage: { type: 'function', doc: 'on_damage(id, amount, source_kind). source_kind is "player", "npc", "impact", "explosion" or "other".' },
  on_interact: { type: 'function', doc: 'on_interact(id). The player pressed E on it.' },
  prompt: { type: 'loc', doc: 'Text of the E prompt.' },
  on_break: { type: 'function', doc: 'on_break(id). Health reached zero, just before it is removed.' },
  on_remove: { type: 'function', doc: 'on_remove(id). It is being removed for any reason.' },
  on_signal: { type: 'function', doc: 'on_signal(id, on). A wire into it changed.' },
};

const NPC_FIELDS: Schema = {
  id: ID, name: NAME, desc: DESC,
  height: { type: 'number', min: 0.4, max: 8, default: 'from model base', doc: 'Total height in metres. The model is scaled to match.' },
  radius: { type: 'number', min: 0.15, max: 2, default: '0.35', doc: 'Body radius.' },
  model: { type: 'table', doc: 'Appearance: {base="robot", color=0xff0000, accent=0x333333, parts={...}}. base is "technician", "guard", "robot", "heavy", "creature" or "humanoid". parts use attach to follow a joint.' },
  material: { type: 'string', default: '"rubber"', doc: 'Physics material.' },
  health: { type: 'number', min: 1, max: 100000, default: '100', doc: 'Health.' },
  walk_speed: { type: 'number', min: 0, max: 30, default: '2', doc: 'Speed in m/s when calm.' },
  run_speed: { type: 'number', min: 0, max: 40, default: '4.5', doc: 'Speed in m/s when chasing or fleeing.' },
  sight: { type: 'number', min: 0, max: 200, default: '20', doc: 'How far it can see a target.' },
  hearing: { type: 'number', min: 0, max: 200, default: '12', doc: 'How far it hears noise.' },
  attack: { type: 'enum', options: ['none', 'bolt', 'tracer', 'slam', 'script'], default: '"none"', doc: 'How it fights. "script" calls on_attack instead.' },
  attack_range: { type: 'number', min: 0, max: 200, default: '12', doc: 'Starts attacking within this distance.' },
  attack_cooldown: { type: 'number', min: 0.05, max: 60, default: '1', doc: 'Seconds between attacks.' },
  attack_damage: { type: 'number', min: 0, max: 1000, default: '10', doc: 'Damage per attack.' },
  faction: { type: 'enum', options: ['lab', 'rogue', 'neutral'], default: '"neutral"', doc: 'lab and rogue fight each other on sight.' },
  hostility: { type: 'enum', options: ['never', 'provoked', 'always'], default: '"never"', doc: 'When it attacks the player. provoked means after being hurt by the player.' },
  flees_when_hurt: { type: 'boolean', default: 'false', doc: 'Runs when damaged.' },
  skittish: { type: 'boolean', default: 'false', doc: 'Runs from anything fast nearby.' },
  memory: { type: 'number', min: 0, max: 120, default: '4', doc: 'Seconds it keeps chasing after losing sight.' },
  hops: { type: 'boolean', default: 'false', doc: 'Moves in hops.' },
  voice: { type: 'enum', options: ['human', 'creature', 'robot', 'silent'], default: '"human"', doc: 'Which family of sounds it makes.' },
  behavior: { type: 'enum', options: ['wander', 'stand', 'patrol', 'follow', 'guard', 'tinker'], default: '"wander"', doc: 'What it does when not fighting. Change it at runtime with the npc functions.' },
  guard_radius: { type: 'number', min: 1, max: 100, default: '9', doc: 'For behavior="guard". It guards the place it spawned.' },
  follow_distance: { type: 'number', min: 1, max: 40, default: '3.5', doc: 'For behavior="follow".' },
  personality: { type: 'enum', options: Object.keys(PERSONALITIES), doc: 'A preset that adjusts the numbers above. See NPC_CREATION.md.' },
  on_explosion: { type: 'enum', options: ['ignore', 'investigate', 'flee'], doc: 'What it does when an explosion happens nearby.' },
  lines: { type: 'locs', doc: 'Lines it says when the player presses E.' },
  prompt: { type: 'loc', doc: 'Text of the E prompt.' },
  on_spawn: { type: 'function', doc: 'on_spawn(id). Runs on its first physics step.' },
  on_think: { type: 'function', doc: 'on_think(id, dt). Runs 4 times a second while alive.' },
  on_damage: { type: 'function', doc: 'on_damage(id, amount, source_kind, attacker). attacker is the entity responsible, or nil.' },
  on_interact: { type: 'function', doc: 'on_interact(id). Return false to fall through to lines.' },
  on_death: { type: 'function', doc: 'on_death(id, by_player).' },
  on_attack: { type: 'function', doc: 'on_attack(id, target_position, target_entity). For attack="script". target_entity is nil when the target is the player.' },
};

const TOOL_FIELDS: Schema = {
  id: ID, name: NAME, desc: DESC,
  fire: { type: 'enum', options: ['none', 'hitscan', 'bolt', 'cone'], default: '"none"', doc: 'What the primary button does by itself. Leave as none to do it all in on_primary.' },
  energy: { type: 'number', min: 1, max: 10000, doc: 'Energy capacity. Without this there is no energy bar.' },
  energy_regen: { type: 'number', min: 0, max: 10000, default: 'energy / 6', doc: 'Energy per second.' },
  cost: { type: 'number', min: 0, max: 10000, default: '10', doc: 'Energy per shot.' },
  cooldown: { type: 'number', min: 0, max: 60, default: '0.25', doc: 'Seconds between shots.' },
  automatic: { type: 'boolean', default: 'false', doc: 'Keeps firing while held.' },
  damage: { type: 'number', min: 0, max: 10000, default: '0', doc: 'Per hit.' },
  range: { type: 'number', min: 0, max: 500, default: '60', doc: 'Metres, for hitscan and cone.' },
  impulse: { type: 'number', min: 0, max: 100000, default: '0', doc: 'Push per hit.' },
  pellets: { type: 'number', min: 1, max: 32, default: '6', doc: 'Rays per shot, for cone.' },
  spread: { type: 'number', min: 0, max: 1, default: '0.08', doc: 'Cone width.' },
  speed: { type: 'number', min: 1, max: 200, default: '28', doc: 'm/s, for bolt.' },
  beam_color: { type: 'color', default: '0xffb000', doc: 'Beam and impact colour.' },
  sound: { type: 'string', default: '"blaster"', doc: 'Sound per shot. See sound.names().' },
  freeze: { type: 'number', min: 0, max: 60, doc: 'Seconds a hit target stays frozen.' },
  chain: { type: 'number', min: 0, max: 8, default: '0', doc: 'The beam jumps to this many nearby targets.' },
  view_base: { type: 'string', default: '"manipulator"', doc: 'Which built-in tool\'s model to hold: manipulator, spawner, construction, remover, inspector, paint, blaster, impulse, freeze, bouncer, disintegrator or gravity.' },
  view_parts: { type: 'parts', doc: 'Extra parts on the held model. The whole model is about 0.3 units long, so use small sizes.' },
  hints: { type: 'table', doc: 'Control hints for the HUD: {{"LMB", "Fire"}, {"R", "Vent"}}.' },
  on_primary: { type: 'function', doc: 'on_primary(). Left button pressed.' },
  on_primary_up: { type: 'function', doc: 'on_primary_up(). Left button released.' },
  on_secondary: { type: 'function', doc: 'on_secondary(). Right button pressed.' },
  on_secondary_up: { type: 'function', doc: 'on_secondary_up(). Right button released.' },
  on_reload: { type: 'function', doc: 'on_reload(). R pressed.' },
  on_equip: { type: 'function', doc: 'on_equip(). Selected.' },
  on_unequip: { type: 'function', doc: 'on_unequip(). Put away.' },
  on_update: { type: 'function', doc: 'on_update(dt). Every frame while selected. Keep it short.' },
  on_fire: { type: 'function', doc: 'on_fire(). After each shot.' },
  on_hit: { type: 'function', doc: 'on_hit(hit). For each thing hit. hit has point, normal, distance and entity.' },
  status: { type: 'function', doc: 'status() returns short text for the HUD.' },
};

const VEHICLE_FIELDS: Schema = {
  id: ID, name: NAME, desc: DESC,
  size: { type: 'triple', required: true, doc: 'Chassis collision box: width, height, length. The nose points to -Z.' },
  model: { type: 'parts', doc: 'Chassis model from parts.' },
  visual: { type: 'string', doc: 'A built-in model, such as "buggy".' },
  color: { type: 'color', doc: 'Colour of a plain box chassis, used when there is no model.' },
  material: { type: 'string', default: '"metal"', doc: 'Physics material of the chassis.' },
  wheels: { type: 'vec3list', doc: 'Wheel mounts relative to the centre, 2 to 8 of them. Those with negative z steer. Default: four, from size.' },
  wheel_radius: { type: 'number', min: 0.1, max: 2, default: '0.36', doc: 'Wheel radius.' },
  suspension: { type: 'number', min: 0.05, max: 2, default: '0.38', doc: 'Suspension rest length.' },
  engine: { type: 'number', min: 0, max: 20000, default: '1050', doc: 'Force per driven wheel.' },
  top_speed: { type: 'number', min: 1, max: 80, default: '26', doc: 'm/s.' },
  steer: { type: 'number', min: 0.05, max: 1.2, default: '0.62', doc: 'Maximum steering angle in radians.' },
  grip: { type: 'number', min: 0.1, max: 12, default: '2.6', doc: 'Tyre grip.' },
  stiffness: { type: 'number', min: 1, max: 200, default: '26', doc: 'Suspension stiffness.' },
  density: { type: 'number', min: 10, max: 2000, default: '150', doc: 'Chassis density, which sets its weight.' },
  wheel_color: { type: 'color', doc: 'Tyre colour.' },
};

const MATERIAL_FIELDS: Schema = {
  id: ID, name: NAME,
  friction: { type: 'number', min: 0, max: 2, required: true, doc: 'Grip.' },
  restitution: { type: 'number', min: 0, max: 1.2, required: true, doc: 'Bounce.' },
  density: { type: 'number', min: 1, max: 5000, required: true, doc: 'Weight per cubic metre.' },
  sound: { type: 'enum', options: ['wood', 'metal', 'rubber', 'stone', 'glass', 'ice', 'gel'], default: '"wood"', doc: 'Impact sound.' },
  fragility: { type: 'number', min: 0, max: 5, default: '1', doc: 'Multiplies impact damage. 0 is unbreakable.' },
  tint: { type: 'color', default: '0xc9c5b8', doc: 'Colour when the Inspector applies this material.' },
};

const MAP_FIELDS: Schema = {
  id: ID, name: NAME, desc: DESC,
  spawn: { type: 'vec3', required: true, doc: 'Where the player\'s feet start. Put a block under it.' },
  blocks: { type: 'table', required: true, doc: `List of solid boxes: {pos={x,y,z}, size={x,y,z}, material="concrete"}. Up to 2000. Materials: ${LEVEL_MATERIALS.join(', ')}.` },
  props: { type: 'table', doc: 'List of things to place: {id="crate_wood", pos={x,y,z}, yaw=0}. Up to 400.' },
  lights: { type: 'table', doc: 'List of ceiling lights: {pos={x,y,z}, color=0xffffff, intensity=40, range=20}. Up to 16.' },
  patrols: { type: 'table', doc: 'List of routes (lists of positions) that guards with behavior="patrol" walk.' },
  zones: { type: 'table', doc: 'List of volumes: {type="lowg", min=, max=, gravity=0.3} or {type="pad", min=, max=, speed=14}.' },
  sky: { type: 'enum', options: ['day', 'dusk', 'night', 'cloud'], default: '"day"', doc: 'Sky and light preset.' },
  ambience: { type: 'enum', options: ['indoor', 'outdoor', 'sky'], default: '"outdoor"', doc: 'Background sound.' },
  nav: { type: 'boolean', default: 'true', doc: 'Build a navigation grid over the blocks, so NPCs can path around walls.' },
  kill_y: { type: 'number', default: '-40', doc: 'Below this height the player respawns and objects are removed.' },
};

const MODE_FIELDS: Schema = {
  id: ID, name: NAME, desc: DESC,
  map: { type: 'string', default: '"test_facility"', doc: 'Default map id. A name without ":" looks in this mod first.' },
  tools: { type: 'strings', doc: 'Allowed tool ids. Default: all.' },
  use_map_props: { type: 'boolean', default: 'true', doc: 'Whether the map\'s own props appear.' },
  gravity: { type: 'number', min: -20, max: 40, doc: 'Session gravity.' },
  damage: { type: 'boolean', doc: 'Whether the player takes damage.' },
  aggression: { type: 'enum', options: ['passive', 'normal', 'high'], doc: 'NPC aggression.' },
  flight: { type: 'boolean', doc: 'Whether flight is allowed.' },
  respawn: { type: 'boolean', doc: 'Whether the player may respawn on demand.' },
  on_start: { type: 'function', doc: 'on_start(). The session has begun.' },
  on_tick: { type: 'function', doc: 'on_tick(dt). Every physics step, 60 times a second. Keep it short.' },
  on_end: { type: 'function', doc: 'on_end(). The session is ending.' },
  hud: { type: 'function', doc: 'hud() returns {title="...", lines={"...", "..."}} for the corner panel, 10 times a second.' },
};

const SOUND_FIELDS: Schema = {
  id: ID,
  layers: { type: 'table', required: true, doc: 'List of tones played together: {freq=440, dur=0.2, vol=0.3, wave="sine", slide=880, delay=0}. wave is sine, square, sawtooth or triangle. Add noise=true for a burst of filtered noise. Up to 8.' },
};

const EFFECT_FIELDS: Schema = {
  id: ID, name: NAME, desc: DESC,
  category: { type: 'enum', options: ['effects', 'props', 'physics'], default: '"effects"', doc: 'Spawn menu tab.' },
  color: { type: 'color', default: '0xffb000', doc: 'Icon colour.' },
  on_use: { type: 'function', required: true, doc: 'on_use(position). The player placed it from the spawn menu.' },
};

function readParams(h: ModHost, t: Table | undefined, where: string): Record<string, number | string | boolean> | undefined {
  if (!t) return undefined;
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of t.entries()) {
    if (typeof k !== 'string' || (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean')) throw new ChaosError(`${where}: params must map names to numbers, text or booleans.`);
    out[k] = typeof v === 'string' && k === 'dispense' ? h.resolveDef(v) : v;
  }
  return out;
}

function resolveMaterial(h: ModHost, m: unknown, fallback: string, where: string): string {
  const name = typeof m === 'string' ? m : fallback;
  const own = `${h.id}:${name}`;
  if (materials.has(own)) return own;
  if (materials.has(name)) return name;
  throw new ChaosError(`${where}: unknown material "${name}". Built-in: rubber, metal, wood, concrete, ice, gel, heavy, glass. Register your own first with register.material.`);
}

const SIGNAL_PORTS: Record<string, ItemDef['signal']> = { in: { in: true }, out: { out: true }, both: { in: true, out: true } };
const BUILTIN_SIGNALS: Record<string, ItemDef['signal']> = {
  button: { out: true }, lever: { out: true }, plate: { out: true }, timer: { in: true, out: true }, inverter: { in: true, out: true },
  lamp: { in: true }, fan: { in: true }, spring_pad: { in: true }, delay: { in: true, out: true }, latch: { in: true, out: true }, conveyor: { in: true }, magnet: { in: true }, thruster: { in: true }, dispenser: { in: true }, alarm: { in: true },
};
const ALWAYS_FIXED = new Set(['button', 'lever', 'plate', 'timer', 'inverter', 'lamp', 'fan', 'spring_pad', 'delay', 'latch', 'conveyor', 'magnet', 'dispenser', 'teleporter', 'alarm']);

const SKIES: Record<string, Pick<MapDef, 'sky' | 'fog' | 'sun' | 'hemi'>> = {
  day: { sky: { top: 0x24384a, horizon: 0x8aa0a8, bottom: 0x20282c }, fog: { color: 0x8aa0a8, density: 0.004 }, sun: { dir: { x: 0.5, y: 0.8, z: 0.3 }, color: 0xfff0d8, intensity: 2.6 }, hemi: { sky: 0xcfe0f0, ground: 0x6a6a64, intensity: 1.1 } },
  dusk: { sky: { top: 0x2a2440, horizon: 0xd8805a, bottom: 0x241c24 }, fog: { color: 0xc07858, density: 0.006 }, sun: { dir: { x: -0.7, y: 0.35, z: 0.4 }, color: 0xffb080, intensity: 2.2 }, hemi: { sky: 0xc09090, ground: 0x4a4048, intensity: 0.9 } },
  night: { sky: { top: 0x060a14, horizon: 0x18243a, bottom: 0x05070c }, fog: { color: 0x18243a, density: 0.008 }, sun: { dir: { x: 0.3, y: 0.8, z: -0.4 }, color: 0x8aa8e0, intensity: 0.7 }, hemi: { sky: 0x4a5a80, ground: 0x20242c, intensity: 0.7 } },
  cloud: { sky: { top: 0x6a7a88, horizon: 0xb8c4cc, bottom: 0x505860 }, fog: { color: 0xb8c4cc, density: 0.007 }, sun: { dir: { x: 0.2, y: 0.9, z: 0.3 }, color: 0xe8e8e8, intensity: 1.5 }, hemi: { sky: 0xd0d8e0, ground: 0x707478, intensity: 1.3 } },
};

function buildMap(h: ModHost, f: Record<string, unknown>, id: string): MapDef {
  const where = `register.map "${id}"`;
  const num3 = (v: Value, w: string): [number, number, number] => {
    const p = h.vec3(v, w);
    return [p.x, p.y, p.z];
  };
  const blocks = (f.blocks as Table).list().map((b, i) => {
    const w = `${where}: blocks[${i + 1}]`;
    if (!(b instanceof Table)) throw new ChaosError(`${w} must be a table.`);
    const material = b.get('material');
    if (material !== null && (typeof material !== 'string' || !LEVEL_MATERIALS.includes(material))) throw new ChaosError(`${w}: unknown material ${String(material)}. Available: ${LEVEL_MATERIALS.join(', ')}.`);
    const size = num3(b.get('size'), `${w}: size`);
    if (size.some((s) => !(s >= 0.05 && s <= 500))) throw new ChaosError(`${w}: size values must be 0.05 to 500.`);
    return { pos: num3(b.get('pos'), `${w}: pos`), size, material: (material as string | null) ?? 'concrete' };
  });
  if (blocks.length === 0) throw new ChaosError(`${where}: needs at least one block to stand on.`);
  if (blocks.length > 2000) throw new ChaosError(`${where}: too many blocks (limit 2000).`);
  const props = ((f.props as Table | undefined)?.list() ?? []).slice(0, 400).map((p, i) => {
    const w = `${where}: props[${i + 1}]`;
    if (!(p instanceof Table) || typeof p.get('id') !== 'string') throw new ChaosError(`${w} needs id and pos.`);
    const yaw = p.get('yaw');
    return { id: p.get('id') as string, pos: num3(p.get('pos'), `${w}: pos`), yaw: typeof yaw === 'number' ? yaw : 0 };
  });
  const lights = ((f.lights as Table | undefined)?.list() ?? []).slice(0, 16).map((l, i) => {
    const w = `${where}: lights[${i + 1}]`;
    if (!(l instanceof Table)) throw new ChaosError(`${w} must be a table.`);
    const n = (k: string, d: number) => { const v = l.get(k); return typeof v === 'number' ? v : d; };
    return { pos: num3(l.get('pos'), `${w}: pos`), color: n('color', 0xfff0d8), intensity: Math.min(200, n('intensity', 40)), range: Math.min(100, n('range', 20)) };
  });
  const patrols = ((f.patrols as Table | undefined)?.list() ?? []).map((r, i) => h.vecList(r, `${where}: patrols[${i + 1}]`));
  const zones = ((f.zones as Table | undefined)?.list() ?? []).map((z, i) => {
    const w = `${where}: zones[${i + 1}]`;
    if (!(z instanceof Table)) throw new ChaosError(`${w} must be a table.`);
    const type = z.get('type');
    if (type !== 'lowg' && type !== 'pad') throw new ChaosError(`${w}: type must be "lowg" or "pad".`);
    const n = (k: string) => { const v = z.get(k); return typeof v === 'number' ? v : undefined; };
    return { type, min: h.vec3(z.get('min'), `${w}: min`), max: h.vec3(z.get('max'), `${w}: max`), gravity: n('gravity'), speed: n('speed') } as const;
  });
  const look = SKIES[(f.sky as string | undefined) ?? 'day']!;
  let nav: MapDef['nav'] = null;
  if (f.nav !== false) {
    let [minX, maxX, minZ, maxZ, topY, bottomY] = [Infinity, -Infinity, Infinity, -Infinity, -Infinity, Infinity];
    for (const b of blocks) {
      minX = Math.min(minX, b.pos[0] - b.size[0] / 2);
      maxX = Math.max(maxX, b.pos[0] + b.size[0] / 2);
      minZ = Math.min(minZ, b.pos[2] - b.size[2] / 2);
      maxZ = Math.max(maxZ, b.pos[2] + b.size[2] / 2);
      topY = Math.max(topY, b.pos[1] + b.size[1] / 2);
      bottomY = Math.min(bottomY, b.pos[1] - b.size[1] / 2);
    }
    // Grid cost grows with area, so very large maps go without.
    if ((maxX - minX) * (maxZ - minZ) <= 40_000) nav = { minX, maxX, minZ, maxZ, topY: topY + 2, bottomY: bottomY - 1 };
    else h.warn(`${where}: map is too large for a navigation grid, so NPCs will walk directly.`);
  }
  const spawn = f.spawn as V3;
  return {
    id, name: f.name as Loc, desc: (f.desc as Loc | undefined) ?? { en: '', ru: '' },
    ...look, ambience: (f.ambience as MapDef['ambience'] | undefined) ?? 'outdoor', envPanels: 3,
    killY: (f.kill_y as number | undefined) ?? -40, nav,
    build(b) {
      b.spawn = spawn;
      for (const k of blocks) b.box(k.pos[0], k.pos[1], k.pos[2], k.size[0], k.size[1], k.size[2], k.material, { tile: 3 });
      for (const p of props) b.prop(h.resolveDef(p.id), p.pos[0], p.pos[1], p.pos[2], { yaw: p.yaw, fixture: false });
      for (const l of lights) b.lights.push({ x: l.pos[0], y: l.pos[1], z: l.pos[2], color: l.color, intensity: l.intensity, range: l.range });
      b.patrols.push(...patrols);
      b.zones.push(...zones);
    },
  };
}

export const REGISTER_API: ApiFn[] = [
  fn('register', 'material', {
    params: [{ name: 'def', type: 'table' }], returns: 'full id', perm: 'content', loadOnly: true, fields: MATERIAL_FIELDS,
    doc: 'Adds a physics material.',
    example: 'local id = register.material{ id = "jelly", name = "Jelly", friction = 0.3, restitution = 1, density = 30, sound = "gel" }\nassert(table.contains(game.materials(), id))',
    impl: (h, t: Table) => {
      const f = readFields(t, MATERIAL_FIELDS, 'register.material');
      const id = h.claimId(f.id as string, 'register.material');
      registerMaterial({ id, name: f.name as Loc, friction: f.friction as number, restitution: f.restitution as number, density: f.density as number, sound: (f.sound as ImpactSound | undefined) ?? 'wood', fragility: (f.fragility as number | undefined) ?? 1, tint: (f.tint as number | undefined) ?? 0xc9c5b8 }, h.id);
      return id;
    },
  }),
  fn('register', 'prop', {
    params: [{ name: 'def', type: 'table' }], returns: 'full id', perm: 'content', loadOnly: true, fields: PROP_FIELDS,
    doc: 'Adds a physical object to the spawn menu.',
    example: 'local id = register.prop{\n  id = "stool",\n  name = "Stool",\n  shape = {type="cylinder", r=0.3, h=0.6},\n  material = "wood",\n  model = {\n    {shape="cylinder", r=0.3, h=0.08, pos={0, 0.26, 0}, color=0x8a5a2a},\n    {shape="cylinder", r=0.05, h=0.5, pos={0, -0.05, 0}, material="steel"},\n  },\n  break_speed = 9,\n  debris = "wood",\n  on_interact = function(self) log.info("sat on", self); return true end,\n  prompt = "Sit",\n}\nlocal e = entity.spawn(id, {x=0, y=30, z=0})\nassert(entity.def(e) == id)\nentity.remove(e)',
    impl: (h, t: Table) => {
      const where = 'register.prop';
      const f = readFields(t, PROP_FIELDS, where, { resolveAsset: h.resolveAsset });
      const id = h.claimId(f.id as string, where);
      const behavior = f.behavior as string | undefined;
      if (f.signal && behavior) throw new ChaosError(`${where}: use either signal with on_signal, or a built-in behavior, not both.`);
      const def: ItemDef = {
        id, kind: 'prop', category: (f.category as Category | undefined) ?? 'props', name: f.name as Loc, desc: (f.desc as Loc | undefined) ?? { en: '', ru: '' },
        shape: f.shape as ShapeDef, visual: (f.visual as string | undefined) ?? `mod:${id}`, material: resolveMaterial(h, f.material, 'wood', where),
        color: f.color as number | undefined, model: f.model as ModelPart[] | undefined,
        body: f.body === 'fixed' || (behavior && ALWAYS_FIXED.has(behavior)) ? 'fixed' : 'dynamic',
        disintegrable: f.disintegrable !== false, buildPart: f.build_part === true,
        behavior, params: readParams(h, f.params as Table | undefined, where), signal: f.signal ? SIGNAL_PORTS[f.signal as string] : behavior ? BUILTIN_SIGNALS[behavior] : undefined,
      };
      if (f.break_speed !== undefined) {
        def.breakSpeed = f.break_speed as number;
        def.health = (f.health as number | undefined) ?? 50;
        if (f.debris) def.debris = { kind: f.debris as NonNullable<ItemDef['debris']>['kind'], count: (f.debris_count as number | undefined) ?? 5 };
      } else if (f.health !== undefined) {
        def.health = f.health as number;
      }
      const hooks: ScriptHooks = {};
      if (f.on_spawn) hooks.spawn = h.hook1(f.on_spawn as Value, `${id} on_spawn`);
      if (f.on_tick) {
        const tick = h.guard(f.on_tick as Value, `${id} on_tick`);
        hooks.tick = (e, dt) => void tick(e.id, dt);
        hooks.tickRate = f.tick_rate as number | undefined;
      }
      if (f.on_damage) {
        const c = h.guard(f.on_damage as Value, `${id} on_damage`);
        hooks.damage = (e, a, s) => void c(e.id, a, s.kind);
      }
      if (f.on_interact) {
        const c = h.guard(f.on_interact as Value, `${id} on_interact`);
        hooks.interact = (e) => c(e.id) !== false;
      }
      if (f.prompt) hooks.hint = f.prompt as Loc;
      if (f.on_break) hooks.brk = h.hook1(f.on_break as Value, `${id} on_break`);
      if (f.on_remove) hooks.remove = h.hook1(f.on_remove as Value, `${id} on_remove`);
      if (f.on_signal) {
        const c = h.guard(f.on_signal as Value, `${id} on_signal`);
        hooks.signal = (e, on) => void c(e.id, on);
      }
      if (Object.keys(hooks).length) def.script = hooks;
      registerItem(def, h.id);
      return id;
    },
  }),
  fn('register', 'npc', {
    params: [{ name: 'def', type: 'table' }], returns: 'full id', perm: 'content', loadOnly: true, fields: NPC_FIELDS,
    doc: 'Adds an NPC type, and its entry in the spawn menu.',
    example: 'local id = register.npc{\n  id = "drone",\n  name = "Patrol Drone",\n  height = 1.2,\n  model = {base="robot", color=0x3388ff},\n  health = 40,\n  walk_speed = 3,\n  attack = "bolt",\n  attack_damage = 5,\n  faction = "rogue",\n  hostility = "always",\n  behavior = "guard",\n  on_think = function(self, dt) end,\n  on_death = function(self, by_player) log.info("drone down") end,\n}\nlocal e = entity.spawn(id, {x=0, y=30, z=0})\nassert(npc.is_npc(e))\nentity.remove(e)',
    impl: (h, t: Table) => {
      const where = 'register.npc';
      const f = readFields(t, NPC_FIELDS, where);
      const id = h.claimId(f.id as string, where);
      const modelT = f.model as Table | undefined;
      const m = modelT ? readFields(modelT, {
        base: { type: 'enum', options: ['technician', 'guard', 'robot', 'heavy', 'creature', 'humanoid'], doc: '' },
        color: { type: 'color', doc: '' }, accent: { type: 'color', doc: '' }, parts: { type: 'parts', doc: '' },
      }, `${where}: model`, { resolveAsset: h.resolveAsset }) : {};
      const base = (m.base as 'robot' | undefined) ?? 'humanoid';
      const baseHeight = { technician: 1.8, guard: 1.85, robot: 1.7, heavy: 2.6, creature: 0.8, humanoid: 1.8 }[base];
      const height = (f.height as number | undefined) ?? baseHeight;
      const radius = (f.radius as number | undefined) ?? (0.35 * height) / 1.8;
      const profile: NpcProfile = {
        id, health: (f.health as number | undefined) ?? 100,
        walkSpeed: (f.walk_speed as number | undefined) ?? 2, runSpeed: (f.run_speed as number | undefined) ?? 4.5,
        sight: (f.sight as number | undefined) ?? 20, hearing: (f.hearing as number | undefined) ?? 12,
        attackRange: (f.attack_range as number | undefined) ?? 12, attackCooldown: (f.attack_cooldown as number | undefined) ?? 1, attackDamage: (f.attack_damage as number | undefined) ?? 10,
        attack: (f.attack as NpcProfile['attack'] | undefined) ?? 'none',
        faction: (f.faction as NpcProfile['faction'] | undefined) ?? 'neutral', hostility: (f.hostility as NpcProfile['hostility'] | undefined) ?? 'never',
        fleesWhenHurt: f.flees_when_hurt === true, skittish: f.skittish === true, memory: (f.memory as number | undefined) ?? 4, hops: f.hops === true,
        voice: f.voice as NpcProfile['voice'], behavior: f.behavior as NpcBehaviorName | undefined,
        guardRadius: f.guard_radius as number | undefined, followDistance: f.follow_distance as number | undefined,
        personality: f.personality as string | undefined, onExplosion: f.on_explosion as NpcProfile['onExplosion'],
        lines: f.lines as Loc[] | undefined, speaker: f.name as Loc,
        model: { base, color: m.color as number | undefined, accent: m.accent as number | undefined, parts: m.parts as ModelPart[] | undefined, scale: height / baseHeight },
        hooks: {},
      };
      const hooks = profile.hooks!;
      if (f.prompt) hooks.hint = f.prompt as Loc;
      if (f.on_spawn) hooks.spawn = h.hook1(f.on_spawn as Value, `${id} on_spawn`);
      if (f.on_think) {
        const c = h.guard(f.on_think as Value, `${id} on_think`);
        hooks.think = (e, dt) => void c(e.id, dt);
      }
      if (f.on_damage) {
        const c = h.guard(f.on_damage as Value, `${id} on_damage`);
        hooks.damage = (e, a, s) => void c(e.id, a, s.kind, s.entity?.id ?? null);
      }
      if (f.on_interact) {
        const c = h.guard(f.on_interact as Value, `${id} on_interact`);
        hooks.interact = (e) => c(e.id) !== false;
      }
      if (f.on_death) {
        const c = h.guard(f.on_death as Value, `${id} on_death`);
        hooks.death = (e, by) => void c(e.id, by);
      }
      if (f.on_attack) {
        const c = h.guard(f.on_attack as Value, `${id} on_attack`);
        hooks.attack = (e, p, target) => void c(e.id, h.toScript({ x: p.x, y: p.y, z: p.z }), target ? target.id : null);
      } else if (f.attack === 'script') {
        throw new ChaosError(`${where}: attack="script" needs on_attack.`);
      }
      registerNpcType(profile, h.id);
      registerItem({
        id, kind: 'npc', category: 'npcs', name: f.name as Loc, desc: (f.desc as Loc | undefined) ?? { en: '', ru: '' },
        shape: { type: 'capsule', r: radius, h: height }, visual: `mod:${id}`, material: resolveMaterial(h, f.material, 'rubber', where), body: 'dynamic',
        behavior: 'npc', params: { archetype: id },
      }, h.id);
      return id;
    },
  }),
  ...(['tool', 'weapon'] as const).map((kind) => fn('register', kind, {
    params: [{ name: 'def', type: 'table' }], returns: 'full id (also the tool id)', perm: 'content', loadOnly: true, fields: TOOL_FIELDS,
    doc: kind === 'tool' ? 'Adds a tool: a hotbar slot after the built-in ones, and an entry in the Tools tab of the spawn menu.' : 'Adds a weapon. It is the same as a tool, listed under Weapons and with a coral hotbar slot.',
    example: kind === 'tool'
      ? 'local id = register.tool{\n  id = "poker",\n  name = "Poker",\n  view_base = "inspector",\n  hints = {{"LMB", "Poke"}},\n  on_primary = function()\n    local hit = physics.aim(20)\n    if hit and hit.entity then\n      entity.apply_impulse(hit.entity, {x=0, y=200, z=0})\n    end\n  end,\n  status = function() return "ready" end,\n}\nassert(player.select_tool(id))\nassert(player.tool() == id)\nplayer.select_tool("manipulator")'
      : 'local id = register.weapon{\n  id = "pop_gun",\n  name = "Pop Gun",\n  fire = "hitscan",\n  damage = 6,\n  impulse = 80,\n  cooldown = 0.3,\n  energy = 100,\n  cost = 10,\n  beam_color = 0x19e0c4,\n  view_base = "blaster",\n  on_hit = function(hit) fx.ring(hit.point, 1, 0x19e0c4) end,\n}\nassert(player.select_tool(id))\nplayer.select_tool("manipulator")',
    impl: (h: ModHost, t: Table) => {
      const where = `register.${kind}`;
      const f = readFields(t, TOOL_FIELDS, where, { resolveAsset: h.resolveAsset });
      const id = h.claimId(f.id as string, where);
      const noArgs = (k: string): (() => void) | undefined => {
        if (!f[k]) return undefined;
        const c = h.guard(f[k] as Value, `${id} ${k}`);
        return () => void c();
      };
      const hints = (f.hints as Table | undefined)?.list().map((row, i) => {
        if (!(row instanceof Table) || typeof row.get(1) !== 'string' || typeof row.get(2) !== 'string') throw new ChaosError(`${where}: hints[${i + 1}] must look like {"LMB", "Fire"}.`);
        return [row.get(1), { en: row.get(2), ru: row.get(2) }] as [string, Loc];
      });
      const status = f.status ? h.guard(f.status as Value, `${id} status`) : null;
      const update = f.on_update ? h.guard(f.on_update as Value, `${id} on_update`) : null;
      const hit = f.on_hit ? h.guard(f.on_hit as Value, `${id} on_hit`) : null;
      const base = f.view_base as string | undefined;
      if (base && !MODELS[base]) throw new ChaosError(`${where}: unknown view_base "${base}". Use one of: manipulator, spawner, construction, remover, inspector, paint, blaster, impulse, freeze, bouncer, disintegrator, gravity.`);
      const spec: DataToolSpec = {
        id, kind, energy: f.energy as number | undefined, energyRegen: f.energy_regen as number | undefined, cost: f.cost as number | undefined, cooldown: f.cooldown as number | undefined,
        automatic: f.automatic === true, fire: f.fire as DataToolSpec['fire'], damage: f.damage as number | undefined, range: f.range as number | undefined, impulse: f.impulse as number | undefined,
        pellets: f.pellets as number | undefined, spread: f.spread as number | undefined, speed: f.speed as number | undefined, color: f.beam_color as number | undefined, sound: f.sound as string | undefined,
        freeze: f.freeze as number | undefined, chain: f.chain as number | undefined, hints,
        onPrimary: noArgs('on_primary'), onPrimaryUp: noArgs('on_primary_up'), onSecondary: noArgs('on_secondary'), onSecondaryUp: noArgs('on_secondary_up'),
        onReload: noArgs('on_reload'), onEquip: noArgs('on_equip'), onUnequip: noArgs('on_unequip'), onFire: noArgs('on_fire'),
        onUpdate: update ? (_g, dt) => void update(dt) : undefined,
        onHit: hit ? (_g, x) => void hit(h.toScript({ point: { ...x.hit.point }, normal: { ...x.hit.normal }, distance: x.hit.distance, entity: x.entity?.id ?? null })) : undefined,
        status: status ? () => { const s = status(); return typeof s === 'string' ? s.slice(0, 80) : null; } : undefined,
      };
      MODELS[id] = dataViewModel(base ?? (f.view_parts ? undefined : 'manipulator'), f.view_parts as ModelPart[] | undefined);
      onUnregister(h.id, () => delete MODELS[id]);
      registerToolType({ id, create: (g) => new DataTool(g, spec) }, h.id);
      registerItem({
        id: `${id}#item`, kind: 'tool', toolId: id, category: kind === 'tool' ? 'tools' : 'weapons', name: f.name as Loc, desc: (f.desc as Loc | undefined) ?? { en: '', ru: '' },
        shape: { type: 'box', size: [0.5, 0.3, 0.8] }, visual: `tool:${id}`, material: 'metal', body: 'fixed',
      }, h.id);
      h.game.tools.add({ id, create: (g) => new DataTool(g, spec) });
      return id;
    },
  })),
  fn('register', 'vehicle', {
    params: [{ name: 'def', type: 'table' }], returns: 'full id', perm: 'content', loadOnly: true, fields: VEHICLE_FIELDS,
    doc: 'Adds a drivable vehicle: a chassis on raycast suspension. The player gets in with E.',
    example: 'local id = register.vehicle{\n  id = "cart",\n  name = "Cart",\n  size = {x=1.2, y=0.4, z=2},\n  color = 0x19e0c4,\n  engine = 700,\n  top_speed = 14,\n}\nlocal e = entity.spawn(id, {x=0, y=30, z=0})\nassert(vehicle.is_vehicle(e))\nentity.remove(e)',
    impl: (h, t: Table) => {
      const where = 'register.vehicle';
      const f = readFields(t, VEHICLE_FIELDS, where, { resolveAsset: h.resolveAsset });
      const id = h.claimId(f.id as string, where);
      const size = f.size as [number, number, number];
      if (size.some((s) => !(s >= 0.3 && s <= 12))) throw new ChaosError(`${where}: size values must be 0.3 to 12.`);
      const wheelsIn = f.wheels as V3[] | undefined;
      if (wheelsIn && (wheelsIn.length < 2 || wheelsIn.length > 8)) throw new ChaosError(`${where}: needs 2 to 8 wheels.`);
      const [sx, sy, sz] = size;
      const wheels: [number, number, number][] = wheelsIn?.map((w) => [w.x, w.y, w.z])
        ?? [[-sx / 2, -sy * 0.24, -sz * 0.35], [sx / 2, -sy * 0.24, -sz * 0.35], [-sx / 2, -sy * 0.24, sz * 0.35], [sx / 2, -sy * 0.24, sz * 0.35]];
      const spec: VehicleSpec = {
        wheels, wheelRadius: (f.wheel_radius as number | undefined) ?? 0.36, rest: (f.suspension as number | undefined) ?? 0.38,
        engine: (f.engine as number | undefined) ?? 1050, topSpeed: (f.top_speed as number | undefined) ?? 26, steer: (f.steer as number | undefined) ?? 0.62,
        grip: (f.grip as number | undefined) ?? 2.6, stiffness: (f.stiffness as number | undefined) ?? 26, density: (f.density as number | undefined) ?? 150, wheelColor: f.wheel_color as number | undefined,
      };
      registerItem({
        id, kind: 'vehicle', category: 'vehicles', name: f.name as Loc, desc: (f.desc as Loc | undefined) ?? { en: '', ru: '' },
        shape: { type: 'box', size }, visual: (f.visual as string | undefined) ?? `mod:${id}`, model: f.model as ModelPart[] | undefined, color: f.color as number | undefined,
        material: resolveMaterial(h, f.material, 'metal', where), body: 'dynamic', behavior: 'vehicle', vehicle: spec,
      }, h.id);
      return id;
    },
  }),
  fn('register', 'map', {
    params: [{ name: 'def', type: 'table' }], returns: 'full id', perm: 'content', loadOnly: true, fields: MAP_FIELDS,
    doc: 'Adds a map to the map menu.',
    example: 'local id = register.map{\n  id = "pad",\n  name = "Test Pad",\n  spawn = {x=0, y=0, z=6},\n  blocks = {{pos={0, -0.5, 0}, size={30, 1, 30}, material="concrete"}},\n  props = {{id="crate_wood", pos={0, 0.52, 0}}},\n  sky = "dusk",\n}\nlog.info("registered", id)',
    impl: (h, t: Table) => {
      const f = readFields(t, MAP_FIELDS, 'register.map');
      const id = h.claimId(f.id as string, 'register.map');
      registerMap(buildMap(h, f, id), h.id);
      return id;
    },
  }),
  fn('register', 'mode', {
    params: [{ name: 'def', type: 'table' }], returns: 'full id', perm: 'content', loadOnly: true, fields: MODE_FIELDS,
    doc: 'Adds a game mode to the Modes menu.',
    example: 'local score = 0\nlocal id = register.mode{\n  id = "collector",\n  name = "Collector",\n  desc = "Touch ten crates.",\n  map = "test_facility",\n  gravity = 6,\n  on_start = function() score = 0 end,\n  on_tick = function(dt) end,\n  hud = function() return {title="Collector", lines={"Score: " .. score}} end,\n}\nlog.info("registered", id)',
    impl: (h, t: Table) => {
      const f = readFields(t, MODE_FIELDS, 'register.mode');
      const id = h.claimId(f.id as string, 'register.mode');
      registerMode({ id, name: f.name as Loc, desc: (f.desc as Loc | undefined) ?? { en: '', ru: '' }, map: f.map as string | undefined }, (game) => new ScriptedMode(game, h, id, f), h.id);
      return id;
    },
  }),
  fn('register', 'sound', {
    params: [{ name: 'def', type: 'table' }], returns: 'full id', perm: 'content', loadOnly: true, fields: SOUND_FIELDS,
    doc: 'Adds a sound built from synthesised tones. Play it with sound.play.',
    example: 'local id = register.sound{\n  id = "ding",\n  layers = {\n    {freq=880, dur=0.2, vol=0.2, wave="sine"},\n    {freq=1320, dur=0.15, vol=0.1, wave="triangle", delay=0.05},\n  },\n}\nsound.play(id)',
    impl: (h, t: Table) => {
      const f = readFields(t, SOUND_FIELDS, 'register.sound');
      const id = h.claimId(f.id as string, 'register.sound');
      const layers = (f.layers as Table).list().slice(0, 8).map((l, i) => {
        const w = `register.sound "${f.id as string}": layers[${i + 1}]`;
        if (!(l instanceof Table)) throw new ChaosError(`${w} must be a table.`);
        const x = readFields(l, {
          freq: { type: 'number', required: true, min: 20, max: 12000, doc: '' }, dur: { type: 'number', required: true, min: 0.005, max: 4, doc: '' }, vol: { type: 'number', required: true, min: 0, max: 1, doc: '' },
          wave: { type: 'enum', options: ['sine', 'square', 'sawtooth', 'triangle'], doc: '' }, slide: { type: 'number', min: 10, max: 12000, doc: '' }, delay: { type: 'number', min: 0, max: 4, doc: '' }, noise: { type: 'boolean', doc: '' },
        }, w);
        return { freq: x.freq as number, dur: x.dur as number, vol: x.vol as number, wave: x.wave as OscillatorType | undefined, slide: x.slide as number | undefined, delay: x.delay as number | undefined, noise: x.noise as boolean | undefined };
      });
      if (!layers.length) throw new ChaosError(`register.sound "${f.id as string}": needs at least one layer.`);
      h.game.audio.addSound(id, layers);
      h.sounds.add(id);
      onUnregister(h.id, () => { h.game.audio.removeSound(id); h.sounds.delete(id); });
      return id;
    },
  }),
  fn('register', 'effect', {
    params: [{ name: 'def', type: 'table' }], returns: 'full id', perm: 'content', loadOnly: true, fields: EFFECT_FIELDS,
    doc: 'Adds a one-shot entry to the spawn menu. Using it runs a function at the crosshair, and nothing is left behind.',
    example: 'local id = register.effect{\n  id = "party",\n  name = "Party Popper",\n  on_use = function(pos) fx.burst(pos, 60, 0xff4fa3, 8) end,\n}\nlog.info("registered", id)',
    impl: (h, t: Table) => {
      const f = readFields(t, EFFECT_FIELDS, 'register.effect');
      const id = h.claimId(f.id as string, 'register.effect');
      const use = h.guard(f.on_use as Value, `${id} on_use`);
      registerItem({
        id, kind: 'effect', category: (f.category as Category | undefined) ?? 'effects', name: f.name as Loc, desc: (f.desc as Loc | undefined) ?? { en: '', ru: '' },
        shape: { type: 'sphere', r: 0.3 }, visual: `mod:${id}`, material: 'metal', color: (f.color as number | undefined) ?? 0xffb000, body: 'fixed',
        use: (p) => void use(h.toScript({ x: p.x, y: p.y, z: p.z })),
      }, h.id);
      return id;
    },
  }),
];
