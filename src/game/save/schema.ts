/** Versioned, plain-JSON save format. Nothing here touches live physics objects. */
export const SCHEMA_VERSION = 2;
export const MAX_SAVE_BYTES = 8 * 1024 * 1024;
export const MAX_SAVE_ENTITIES = 5000;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface SavedEntity {
  id: number;
  def: string;
  p: Vec3;
  q: Quat;
  v?: Vec3;
  w?: Vec3;
  scale?: number;
  material?: string;
  tint?: number;
  health?: number;
  anchored?: boolean;
  state?: Record<string, unknown>;
}

export interface SavedLinkData {
  id: number;
  type: 'weld' | 'hinge' | 'spring' | 'rope';
  a: number;
  b: number;
  partA?: number;
  partB?: number;
  anchorA: { x: number; y: number; z: number };
  anchorB: { x: number; y: number; z: number };
  axis?: { x: number; y: number; z: number };
  length?: number;
  frameA?: { x: number; y: number; z: number; w: number };
  frameB?: { x: number; y: number; z: number; w: number };
}

export interface SaveFile {
  schema: number;
  kind: 'scene' | 'layout';
  name: string;
  createdAt: string;
  map: string;
  mode: string;
  rules: { gravity: number; damage: boolean; aggression: 'passive' | 'normal' | 'high' };
  nextId: number;
  entities: SavedEntity[];
  links: SavedLinkData[];
  wires: { from: number; to: number }[];
  player?: { p: Vec3; yaw: number; pitch: number; health: number; flying: boolean };
}

export type ValidationResult = { ok: true; value: SaveFile; warnings: string[] } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, n: number): boolean => Array.isArray(v) && v.length === n && v.every(num);
const xyz = (v: unknown): boolean => isObj(v) && num(v.x) && num(v.y) && num(v.z);
const xyzw = (v: unknown): boolean => xyz(v) && num((v as { w?: unknown }).w);
const MAX_COORD = 1e5;

/** v1 stored `props` with `pos`/`rot` and had no links, wires or rules. */
function migrate(data: Record<string, unknown>): Record<string, unknown> {
  let out = data;
  if (out.schema === 1) {
    const props = Array.isArray(out.props) ? out.props : [];
    out = {
      ...out,
      schema: 2,
      kind: 'scene',
      entities: props.map((x, i) => {
        const p = isObj(x) ? x : {};
        return { id: i + 1, def: p.id, p: p.pos, q: p.rot ?? [0, 0, 0, 1], material: p.material };
      }),
      links: [],
      wires: [],
      rules: { gravity: 9.81, damage: true, aggression: 'normal' },
      nextId: props.length + 1,
    };
    delete out.props;
  }
  return out;
}

/** Validates untrusted JSON. Bad records are dropped with a warning; a bad envelope rejects the file. */
export function validateSave(raw: unknown): ValidationResult {
  if (!isObj(raw)) return { ok: false, errors: ['Save is not an object.'] };
  if (!num(raw.schema)) return { ok: false, errors: ['Missing schema version.'] };
  if (raw.schema > SCHEMA_VERSION) return { ok: false, errors: [`Save is from a newer version (${raw.schema}).`] };
  if (raw.schema < 1) return { ok: false, errors: ['Invalid schema version.'] };
  const d = migrate(raw);
  const errors: string[] = [];
  if (typeof d.map !== 'string' || !d.map) errors.push('Missing map.');
  if (d.kind !== 'scene' && d.kind !== 'layout') errors.push('Unknown save kind.');
  if (!Array.isArray(d.entities)) errors.push('Missing entity list.');
  if (errors.length) return { ok: false, errors };
  const list = d.entities as unknown[];
  if (list.length > MAX_SAVE_ENTITIES) return { ok: false, errors: [`Too many entities (${list.length}).`] };

  const warnings: string[] = [];
  const entities: SavedEntity[] = [];
  const seen = new Set<number>();
  for (const x of list) {
    const ok = isObj(x) && num(x.id) && Number.isInteger(x.id) && x.id > 0 && !seen.has(x.id) && typeof x.def === 'string' && vec(x.p, 3) && vec(x.q, 4)
      && (x.p as number[]).every((c) => Math.abs(c) < MAX_COORD);
    if (!ok) {
      warnings.push('Skipped a malformed entity.');
      continue;
    }
    const q = x.q as number[];
    const len = Math.hypot(...q);
    if (len < 1e-3) {
      warnings.push('Skipped an entity with an invalid rotation.');
      continue;
    }
    seen.add(x.id as number);
    const e: SavedEntity = { id: x.id as number, def: x.def as string, p: x.p as Vec3, q: q.map((c) => c / len) as Quat };
    if (vec(x.v, 3)) e.v = x.v as Vec3;
    if (vec(x.w, 3)) e.w = x.w as Vec3;
    if (num(x.scale)) e.scale = Math.max(0.25, Math.min(3, x.scale));
    if (typeof x.material === 'string') e.material = x.material;
    if (num(x.tint)) e.tint = x.tint;
    if (num(x.health)) e.health = x.health;
    if (x.anchored === true) e.anchored = true;
    if (isObj(x.state)) e.state = x.state;
    entities.push(e);
  }

  const links: SavedLinkData[] = [];
  for (const l of Array.isArray(d.links) ? d.links : []) {
    const ok = isObj(l) && num(l.id) && num(l.a) && num(l.b) && ['weld', 'hinge', 'spring', 'rope'].includes(l.type as string) && xyz(l.anchorA) && xyz(l.anchorB)
      && (l.axis === undefined || xyz(l.axis)) && (l.frameA === undefined || xyzw(l.frameA)) && (l.frameB === undefined || xyzw(l.frameB)) && (l.length === undefined || num(l.length));
    if (ok) links.push(l as unknown as SavedLinkData);
    else warnings.push('Skipped a malformed link.');
  }
  const wires: { from: number; to: number }[] = [];
  for (const w of Array.isArray(d.wires) ? d.wires : []) {
    if (isObj(w) && num(w.from) && num(w.to)) wires.push({ from: w.from, to: w.to });
    else warnings.push('Skipped a malformed wire.');
  }

  const r = isObj(d.rules) ? d.rules : {};
  const aggression = r.aggression === 'passive' || r.aggression === 'high' ? r.aggression : 'normal';
  const value: SaveFile = {
    schema: SCHEMA_VERSION,
    kind: d.kind as SaveFile['kind'],
    name: typeof d.name === 'string' ? d.name.slice(0, 80) : 'Untitled',
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date(0).toISOString(),
    map: d.map as string,
    mode: typeof d.mode === 'string' ? d.mode : 'sandbox',
    rules: { gravity: num(r.gravity) ? Math.max(-30, Math.min(30, r.gravity)) : 9.81, damage: r.damage !== false, aggression },
    nextId: num(d.nextId) ? d.nextId : entities.reduce((m, e) => Math.max(m, e.id + 1), 1),
    entities,
    links,
    wires,
  };
  const pl = d.player;
  if (isObj(pl) && vec(pl.p, 3) && num(pl.yaw) && num(pl.pitch)) {
    value.player = { p: pl.p as Vec3, yaw: pl.yaw, pitch: pl.pitch, health: num(pl.health) ? pl.health : 100, flying: pl.flying === true };
  }
  return { ok: true, value, warnings: [...new Set(warnings)] };
}

/** Parses a file's text, guarding size before JSON.parse so a huge file can't hang the page. */
export function parseSaveText(text: string): ValidationResult {
  if (text.length > MAX_SAVE_BYTES) return { ok: false, errors: ['Save file is too large.'] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['File is not valid JSON.'] };
  }
  return validateSave(raw);
}
