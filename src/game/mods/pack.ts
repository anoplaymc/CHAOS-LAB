import { catalog, CATEGORIES, type Category, type ItemDef, type ShapeDef } from '../../data/items';
import { materials, type ImpactSound, type Loc, type PhysMaterial } from '../../data/materials';
import { MOD_BEHAVIORS } from '../entities/behaviors';
import type { MapDef } from '../maps/MapBuilder';

/**
 * Content packs are data only. Nothing in a pack is ever evaluated: every value passes through the
 * checks below and is copied into a fresh object, so unknown fields, including scripts, cannot get through.
 */
export const MAX_PACK_BYTES = 2 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SPAWN_CATEGORIES = CATEGORIES.filter((c) => c !== 'tools' && c !== 'weapons');
export const LEVEL_MATERIALS = ['floor_tile', 'floor_dark', 'concrete', 'concrete_dark', 'asphalt', 'hazard', 'wall_light', 'wall_dark', 'wall_teal', 'corrugated', 'corrugated_teal', 'container_red', 'container_blue', 'container_amber', 'platform_candy', 'platform_mint', 'wood', 'steel', 'steel_dark'];
const SIGNALS: Record<string, ItemDef['signal']> = {
  button: { out: true }, lever: { out: true }, plate: { out: true }, timer: { in: true, out: true }, inverter: { in: true, out: true },
  lamp: { in: true }, fan: { in: true }, spring_pad: { in: true },
};

export interface ManifestMapBlock { pos: [number, number, number]; size: [number, number, number]; material?: string }

export interface PackMap {
  id: string;
  name: Loc;
  desc: Loc;
  spawn: [number, number, number];
  blocks: ManifestMapBlock[];
  props: { id: string; pos: [number, number, number] }[];
}

export interface ContentPack {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  dependencies: string[];
  assets: string[];
  entities: ItemDef[];
  materials: PhysMaterial[];
  maps: PackMap[];
}

export interface PackValidation {
  errors: string[];
  warnings: string[];
  pack: ContentPack | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 400): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function loc(v: unknown, fallback: string): Loc {
  if (typeof v === 'string') return { en: v.slice(0, 200), ru: v.slice(0, 200) };
  if (isObj(v)) {
    const en = str(v.en, 200) ?? fallback;
    return { en, ru: str(v.ru, 200) ?? en };
  }
  return { en: fallback, ru: fallback };
}

export function shapeFrom(v: unknown, where: string, errors: string[]): ShapeDef | null {
  if (!isObj(v)) {
    errors.push(`${where}: shape is required.`);
    return null;
  }
  const dim = (x: unknown) => inRange(x, 0.05, 12);
  switch (v.type) {
    case 'box':
    case 'wedge': {
      const s = v.size;
      if (Array.isArray(s) && s.length === 3 && s.every(dim)) return { type: v.type, size: [s[0], s[1], s[2]] };
      errors.push(`${where}: ${v.type} needs size [x, y, z], each 0.05 to 12.`);
      return null;
    }
    case 'sphere':
      if (dim(v.r)) return { type: 'sphere', r: v.r as number };
      errors.push(`${where}: sphere needs r from 0.05 to 12.`);
      return null;
    case 'cylinder':
    case 'capsule':
      if (dim(v.r) && dim(v.h)) return { type: v.type, r: v.r as number, h: v.h as number };
      errors.push(`${where}: ${v.type} needs r and h from 0.05 to 12.`);
      return null;
    default:
      errors.push(`${where}: unknown shape type "${String(v.type)}".`);
      return null;
  }
}

/** Validates a parsed manifest against the currently loaded content. Never touches the registries. */
export function validatePack(raw: unknown, ctx: { installedIds: string[]; replacing?: string } = { installedIds: [] }): PackValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { errors: ['Manifest must be a JSON object.'], warnings, pack: null };

  for (const k of ['script', 'scripts', 'code', 'main', 'js']) {
    if (k in raw) errors.push(`Field "${k}" is not allowed: content packs are data-only and cannot run code.`);
  }
  const id = str(raw.id, 48);
  if (!id || !ID_RE.test(id)) errors.push('id must be lowercase letters, digits, _ or -, up to 48 characters.');
  const name = str(raw.name, 80);
  if (!name) errors.push('name is required.');
  const version = str(raw.version, 20);
  if (!version || !VERSION_RE.test(version)) errors.push('version must look like 1.0.0.');
  const author = str(raw.author, 80) ?? '';
  if (!author) warnings.push('No author given.');
  const description = str(raw.description, 500) ?? '';

  const dependencies: string[] = [];
  if (raw.dependencies !== undefined && !Array.isArray(raw.dependencies)) errors.push('dependencies must be a list of pack ids.');
  for (const d of Array.isArray(raw.dependencies) ? raw.dependencies : []) {
    if (typeof d !== 'string' || !ID_RE.test(d)) errors.push(`Invalid dependency "${String(d)}".`);
    else if (d === id) errors.push('A pack cannot depend on itself.');
    else if (!ctx.installedIds.includes(d)) errors.push(`Missing dependency: "${d}" is not installed.`);
    else dependencies.push(d);
  }
  if (id && ctx.installedIds.includes(id) && ctx.replacing !== id) errors.push(`A pack with id "${id}" is already installed.`);

  const assets: string[] = [];
  for (const a of Array.isArray(raw.assets) ? raw.assets : []) {
    if (typeof a === 'string') assets.push(a.slice(0, 200));
  }
  if (assets.length) warnings.push('External assets are recorded but not loaded yet: objects fall back to generated meshes.');

  const prefix = `${id ?? 'pack'}:`;
  const source = id ?? 'pack';
  const newMaterials: PhysMaterial[] = [];
  const seen = new Set<string>();
  const addId = (full: string, kind: string, exists: boolean) => {
    if (seen.has(full)) errors.push(`Duplicate ${kind} id "${full}" in this pack.`);
    else if (exists) errors.push(`Duplicate ${kind} id "${full}": it already exists.`);
    seen.add(full);
  };
  for (const m of Array.isArray(raw.materials) ? raw.materials.slice(0, 64) : []) {
    if (!isObj(m) || typeof m.id !== 'string' || !ID_RE.test(m.id)) {
      errors.push('Each material needs a valid id.');
      continue;
    }
    const full = prefix + m.id;
    addId(full, 'material', materials.has(full) && ctx.replacing !== id);
    if (!inRange(m.friction, 0, 2)) errors.push(`${full}: friction must be 0 to 2.`);
    if (!inRange(m.restitution, 0, 1.2)) errors.push(`${full}: restitution must be 0 to 1.2.`);
    if (!inRange(m.density, 1, 5000)) errors.push(`${full}: density must be 1 to 5000.`);
    const sounds: ImpactSound[] = ['wood', 'metal', 'rubber', 'stone', 'glass', 'ice', 'gel'];
    newMaterials.push({
      id: full,
      name: loc(m.name, m.id),
      friction: m.friction as number,
      restitution: m.restitution as number,
      density: m.density as number,
      sound: sounds.includes(m.sound as ImpactSound) ? (m.sound as ImpactSound) : 'wood',
      fragility: inRange(m.fragility, 0, 5) ? m.fragility : 1,
      tint: inRange(m.tint, 0, 0xffffff) ? m.tint : 0xc9c5b8,
      source,
    });
  }

  const matKnown = (mid: string) => materials.has(mid) || newMaterials.some((x) => x.id === mid);
  const entities: ItemDef[] = [];
  for (const [i, e] of (Array.isArray(raw.entities) ? raw.entities.slice(0, 256) : []).entries()) {
    const where = `entities[${i}]`;
    if (!isObj(e) || typeof e.id !== 'string' || !ID_RE.test(e.id)) {
      errors.push(`${where}: a valid id is required.`);
      continue;
    }
    const full = prefix + e.id;
    addId(full, 'entity', catalog.has(full) && ctx.replacing !== id);
    const shape = shapeFrom(e.shape, full, errors);
    const category = (SPAWN_CATEGORIES as string[]).includes(e.category as string) && e.category !== 'npcs' && e.category !== 'vehicles' ? (e.category as Category) : 'props';
    if (e.category !== undefined && category !== e.category) warnings.push(`${full}: category "${String(e.category)}" isn't available to packs; using props.`);
    let material = typeof e.material === 'string' ? e.material : 'wood';
    if (!matKnown(material) && matKnown(prefix + material)) material = prefix + material;
    if (!matKnown(material)) errors.push(`${full}: unknown material "${material}".`);
    const body = e.body === 'fixed' ? 'fixed' : 'dynamic';
    const behavior = typeof e.behavior === 'string' ? e.behavior : undefined;
    if (behavior && !MOD_BEHAVIORS.includes(behavior)) errors.push(`${full}: behaviour "${behavior}" is not available to packs.`);
    const params: Record<string, number | string> = {};
    if (isObj(e.params)) {
      for (const [k, v] of Object.entries(e.params).slice(0, 16)) {
        if (inRange(v, -1e4, 1e4)) params[k] = v as number;
        else if (typeof v === 'string' && v.length < 32) params[k] = v;
        else errors.push(`${full}: parameter "${k}" must be a number within range or a short string.`);
      }
    }
    if (!shape) continue;
    const def: ItemDef = {
      id: full,
      category,
      kind: 'prop',
      name: loc(e.name, e.id),
      desc: loc(e.desc ?? e.description, ''),
      shape,
      visual: str(e.visual, 40) ?? `mod:${full}`,
      material,
      color: inRange(e.color, 0, 0xffffff) ? e.color : undefined,
      body,
      source,
    };
    if (inRange(e.breakSpeed, 0.5, 100)) {
      def.breakSpeed = e.breakSpeed;
      def.health = inRange(e.health, 1, 5000) ? e.health : 50;
      def.debris = { count: 5, kind: 'wood' };
      const d = e.debris;
      const kinds = ['wood', 'glass', 'metal', 'stone', 'ice'];
      if (typeof d === 'string' && kinds.includes(d)) def.debris.kind = d as 'wood';
    }
    if (e.disintegrable !== false) def.disintegrable = true;
    if (behavior) {
      def.behavior = behavior;
      if (SIGNALS[behavior]) def.signal = SIGNALS[behavior];
      if (body === 'dynamic' && !['explosive', 'emitter'].includes(behavior)) def.body = 'fixed';
    }
    if (Object.keys(params).length) def.params = params;
    entities.push(def);
  }

  const maps: PackMap[] = [];
  const isVec = (v: unknown, lo: number, hi: number): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => inRange(x, lo, hi));
  for (const [i, m] of (Array.isArray(raw.maps) ? raw.maps.slice(0, 16) : []).entries()) {
    const where = `maps[${i}]`;
    if (!isObj(m) || typeof m.id !== 'string' || !ID_RE.test(m.id)) {
      errors.push(`${where}: a valid id is required.`);
      continue;
    }
    const full = prefix + m.id;
    addId(full, 'map', false);
    if (!isVec(m.spawn, -500, 500)) errors.push(`${full}: spawn must be [x, y, z].`);
    const blocks: ManifestMapBlock[] = [];
    const rawBlocks = Array.isArray(m.blocks) ? m.blocks : [];
    if (!rawBlocks.length) errors.push(`${full}: needs at least one block to stand on.`);
    if (rawBlocks.length > 2000) errors.push(`${full}: too many blocks (max 2000).`);
    for (const b of rawBlocks.slice(0, 2000)) {
      if (!isObj(b) || !isVec(b.pos, -500, 500) || !isVec(b.size, 0.05, 500)) {
        errors.push(`${full}: a block needs pos and size.`);
        break;
      }
      const material = typeof b.material === 'string' && LEVEL_MATERIALS.includes(b.material) ? b.material : 'concrete';
      blocks.push({ pos: b.pos, size: b.size, material });
    }
    const props: PackMap['props'] = [];
    for (const p of Array.isArray(m.props) ? m.props.slice(0, 400) : []) {
      if (isObj(p) && typeof p.id === 'string' && isVec(p.pos, -500, 500)) {
        const known = catalog.has(p.id) || entities.some((x) => x.id === p.id || x.id === prefix + p.id);
        if (!known) warnings.push(`${full}: skipping unknown prop "${p.id}".`);
        else props.push({ id: catalog.has(p.id) ? p.id : (entities.some((x) => x.id === p.id) ? p.id : prefix + p.id), pos: p.pos });
      }
    }
    maps.push({ id: full, name: loc(m.name, m.id), desc: loc(m.desc ?? m.description, ''), spawn: isVec(m.spawn, -500, 500) ? m.spawn : [0, 1, 0], blocks, props });
  }
  if (!entities.length && !newMaterials.length && !maps.length) errors.push('Pack has no entities, materials or maps.');
  if (errors.length || !id || !name || !version) return { errors, warnings: [...new Set(warnings)], pack: null };
  return {
    errors,
    warnings: [...new Set(warnings)],
    pack: { id, name, version, author, description, dependencies, assets, entities, materials: newMaterials, maps },
  };
}

export function parsePackText(text: string, ctx: { installedIds: string[]; replacing?: string }): PackValidation {
  if (text.length > MAX_PACK_BYTES) return { errors: ['Pack file is too large (2 MB limit).'], warnings: [], pack: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { errors: ['File is not valid JSON.'], warnings: [], pack: null };
  }
  return validatePack(raw, ctx);
}

export function packMapDef(m: PackMap): MapDef {
  return {
    id: m.id,
    name: m.name,
    desc: m.desc,
    sky: { top: 0x24384a, horizon: 0x8aa0a8, bottom: 0x20282c },
    fog: { color: 0x8aa0a8, density: 0.004 },
    ambience: 'outdoor',
    sun: { dir: { x: 0.5, y: 0.8, z: 0.3 }, color: 0xfff0d8, intensity: 2.6 },
    hemi: { sky: 0xcfe0f0, ground: 0x6a6a64, intensity: 1.1 },
    envPanels: 3,
    killY: -40,
    nav: null,
    build(b) {
      b.spawn = { x: m.spawn[0], y: m.spawn[1], z: m.spawn[2] };
      for (const k of m.blocks) b.box(k.pos[0], k.pos[1], k.pos[2], k.size[0], k.size[1], k.size[2], k.material ?? 'concrete', { tile: 3 });
      for (const p of m.props) b.prop(p.id, p.pos[0], p.pos[1], p.pos[2]);
    },
  };
}
