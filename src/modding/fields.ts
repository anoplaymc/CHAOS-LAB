import { ChaosError, closest, isCallable, Table, toPlain, typeName, type Value } from '../chaosscript';
import type { Loc } from '../data/materials';
import type { ShapeDef } from '../data/items';
import type { ModelPart } from '../game/content/types';
import { shapeFrom } from '../game/mods/pack';
import { MODEL_MATERIALS } from '../rendering/parts';
import type { V3 } from '../utils/math';

export type FieldType = 'string' | 'number' | 'boolean' | 'loc' | 'color' | 'function' | 'vec3' | 'vec3list' | 'shape' | 'parts' | 'enum' | 'strings' | 'table' | 'locs' | 'triple';

export interface FieldSpec {
  type: FieldType;
  required?: boolean;
  /** Shown in the docs. Defaults themselves are applied by the code that reads the field. */
  default?: string;
  doc: string;
  min?: number;
  max?: number;
  options?: readonly string[];
}

export type Schema = Record<string, FieldSpec>;

export function typeLabel(f: FieldSpec): string {
  switch (f.type) {
    case 'loc': return 'text or {en=, ru=}';
    case 'color': return 'colour (0xRRGGBB or "#rrggbb")';
    case 'vec3': return 'position';
    case 'vec3list': return 'list of positions';
    case 'shape': return 'shape';
    case 'parts': return 'list of model parts';
    case 'enum': return (f.options ?? []).map((o) => `"${o}"`).join(' | ');
    case 'strings': return 'list of strings';
    case 'locs': return 'list of text';
    case 'triple': return '{x, y, z} numbers';
    case 'number': return f.min !== undefined && f.max !== undefined ? `number, ${f.min} to ${f.max}` : 'number';
    default: return f.type;
  }
}

/** A position written as {x=1, y=2, z=3} or {1, 2, 3}. */
export function toVec3(v: Value, where: string): V3 {
  if (v instanceof Table) {
    const a = v.get('x') ?? v.get(1);
    const b = v.get('y') ?? v.get(2);
    const c = v.get('z') ?? v.get(3);
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number' && Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) return { x: a, y: b, z: c };
  }
  throw new ChaosError(`${where} must be a position like {x=0, y=1, z=0}, got ${v instanceof Table ? 'a table without finite x, y and z' : typeName(v)}.`);
}

export function toLoc(v: Value, where: string): Loc {
  if (typeof v === 'string') return { en: v.slice(0, 300), ru: v.slice(0, 300) };
  if (v instanceof Table) {
    const en = v.get('en');
    const ru = v.get('ru');
    if (typeof en === 'string') return { en: en.slice(0, 300), ru: typeof ru === 'string' ? ru.slice(0, 300) : en.slice(0, 300) };
  }
  throw new ChaosError(`${where} must be text or a table like {en="...", ru="..."}, got ${typeName(v)}.`);
}

export function toColor(v: Value, where: string): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v;
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return parseInt(v.slice(1), 16);
  throw new ChaosError(`${where} must be a colour like 0xff8800 or "#ff8800", got ${typeof v === 'string' ? `"${v}"` : typeName(v)}.`);
}

function triple(v: Value, where: string): [number, number, number] {
  const p = toVec3(v, where);
  return [p.x, p.y, p.z];
}

const PART_FIELDS: Schema = {
  shape: { type: 'enum', required: true, options: ['box', 'rbox', 'sphere', 'cylinder', 'cone', 'torus'], doc: 'The primitive. rbox is a box with rounded edges.' },
  size: { type: 'triple', doc: 'box and rbox: width, height, depth.' },
  r: { type: 'number', min: 0.001, max: 24, doc: 'Radius of a sphere, cylinder, cone or torus.' },
  h: { type: 'number', min: 0.001, max: 24, doc: 'Height of a cylinder or cone.' },
  r_top: { type: 'number', min: 0.001, max: 24, doc: 'Top radius of a cylinder, when it differs from r.' },
  tube: { type: 'number', min: 0.001, max: 12, doc: 'Tube radius of a torus.' },
  pos: { type: 'triple', default: '{0, 0, 0}', doc: 'Position relative to the object centre.' },
  rot: { type: 'triple', default: '{0, 0, 0}', doc: 'Rotation in radians.' },
  color: { type: 'color', doc: 'Colour, when no material is given.' },
  material: { type: 'enum', options: MODEL_MATERIALS, doc: 'A library material. Takes priority over color.' },
  texture: { type: 'string', doc: 'Image from the manifest\'s assets, wrapped around this part.' },
  attach: { type: 'enum', options: ['root', 'torso', 'head', 'arm_l', 'arm_r', 'leg_l', 'leg_r'], default: '"root"', doc: 'NPC models only: which joint it moves with.' },
};

/** Documentation for one element of a `parts` list. */
export const MODEL_PART_FIELDS = PART_FIELDS;

const MAX_PARTS = 96;

function toParts(v: Value, where: string, resolveAsset?: (path: string, where: string) => string): ModelPart[] {
  if (!(v instanceof Table)) throw new ChaosError(`${where} must be a list of parts, got ${typeName(v)}.`);
  const list = v.list();
  if (list.length > MAX_PARTS) throw new ChaosError(`${where} has ${list.length} parts (limit ${MAX_PARTS}).`);
  return list.map((p, i) => {
    const w = `${where}[${i + 1}]`;
    if (!(p instanceof Table)) throw new ChaosError(`${w} must be a table, got ${typeName(p)}.`);
    const f = readFields(p, PART_FIELDS, w);
    const part = f as unknown as ModelPart & { texture?: string };
    if ((f.shape === 'box' || f.shape === 'rbox') && !f.size) throw new ChaosError(`${w}: a ${String(f.shape)} needs size = {x, y, z}.`);
    if (f.shape !== 'box' && f.shape !== 'rbox' && f.r === undefined) throw new ChaosError(`${w}: a ${String(f.shape)} needs r.`);
    if (part.size && part.size.some((n) => !(n > 0 && n <= 48))) throw new ChaosError(`${w}: size values must be above 0 and at most 48.`);
    if (part.texture) {
      if (!resolveAsset) throw new ChaosError(`${w}: textures aren't available here.`);
      part.texture = resolveAsset(part.texture, w);
    }
    return part;
  });
}

function shape(v: Value, where: string): ShapeDef {
  const errors: string[] = [];
  const s = shapeFrom(toPlain(v, where), where, errors);
  if (!s) throw new ChaosError(`${errors[0] ?? `${where}: invalid shape.`} Example: {type="box", size={1, 1, 1}}, {type="sphere", r=0.5}, {type="cylinder", r=0.3, h=1}.`);
  return s;
}

export interface FieldContext { resolveAsset?: (path: string, where: string) => string }

function readValue(v: Value, f: FieldSpec, where: string, ctx: FieldContext): unknown {
  switch (f.type) {
    case 'string':
      if (typeof v !== 'string') throw new ChaosError(`${where} must be text, got ${typeName(v)}.`);
      return v;
    case 'boolean':
      if (typeof v !== 'boolean') throw new ChaosError(`${where} must be true or false, got ${typeName(v)}.`);
      return v;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ChaosError(`${where} must be a number, got ${typeName(v)}.`);
      if (f.min !== undefined && v < f.min) throw new ChaosError(`${where} must be at least ${f.min}, got ${v}.`);
      if (f.max !== undefined && v > f.max) throw new ChaosError(`${where} must be at most ${f.max}, got ${v}.`);
      return v;
    case 'loc': return toLoc(v, where);
    case 'color': return toColor(v, where);
    case 'function':
      if (!isCallable(v)) throw new ChaosError(`${where} must be a function, got ${typeName(v)}.`);
      return v;
    case 'vec3': return toVec3(v, where);
    case 'triple': return triple(v, where);
    case 'vec3list':
      if (!(v instanceof Table)) throw new ChaosError(`${where} must be a list of positions, got ${typeName(v)}.`);
      return v.list().map((p, i) => toVec3(p, `${where}[${i + 1}]`));
    case 'shape': return shape(v, where);
    case 'parts': return toParts(v, where, ctx.resolveAsset);
    case 'enum': {
      const opts = f.options ?? [];
      if (typeof v !== 'string' || !opts.includes(v)) {
        const hint = typeof v === 'string' ? closest(v, opts) : null;
        throw new ChaosError(`${where} must be one of ${opts.map((o) => `"${o}"`).join(', ')}, got ${typeof v === 'string' ? `"${v}"` : typeName(v)}.${hint ? ` Did you mean "${hint}"?` : ''}`);
      }
      return v;
    }
    case 'strings':
      if (!(v instanceof Table)) throw new ChaosError(`${where} must be a list of text, got ${typeName(v)}.`);
      return v.list().map((s, i) => {
        if (typeof s !== 'string') throw new ChaosError(`${where}[${i + 1}] must be text, got ${typeName(s)}.`);
        return s;
      });
    case 'locs':
      if (!(v instanceof Table)) throw new ChaosError(`${where} must be a list of text, got ${typeName(v)}.`);
      return v.list().map((s, i) => toLoc(s, `${where}[${i + 1}]`));
    case 'table':
      if (!(v instanceof Table)) throw new ChaosError(`${where} must be a table, got ${typeName(v)}.`);
      return v;
  }
}

/** Checks a definition table against its schema. Unknown fields are errors, because they are nearly always typos. */
export function readFields(t: Table, schema: Schema, where: string, ctx: FieldContext = {}): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, raw] of t.entries()) {
    if (typeof k !== 'string') throw new ChaosError(`${where}: only named fields are allowed here, found a ${typeName(k as Value)} key.`);
    const f = schema[k];
    if (!f || !Object.prototype.hasOwnProperty.call(schema, k)) {
      const hint = closest(k, Object.keys(schema));
      throw new ChaosError(`${where}: unknown field "${k}".${hint ? ` Did you mean "${hint}"?` : ` Known fields: ${Object.keys(schema).join(', ')}.`}`);
    }
    out[k] = readValue(raw, f, `${where}: field "${k}"`, ctx);
  }
  for (const [k, f] of Object.entries(schema)) {
    if (f.required && !(k in out)) throw new ChaosError(`${where}: field "${k}" is required (${typeLabel(f)}).`);
  }
  return out;
}
