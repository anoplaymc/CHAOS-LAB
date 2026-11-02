import { closest } from '../chaosscript';

/** The API version this build of the game provides. */
export const API_VERSION = '1.1';

export const PERMISSIONS = ['content', 'world', 'player', 'effects', 'ui', 'storage', 'rules', 'sandbox'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_INFO: Record<Permission, string> = {
  content: 'Register new props, NPCs, tools, weapons, vehicles, maps, modes, materials, sounds and effects.',
  world: 'Spawn, remove and change entities, give orders to NPCs, cause explosions.',
  player: 'Change the player: health, position, velocity, selected tool.',
  effects: 'Create particles and play sounds.',
  ui: 'Show messages, panels, menus and buttons.',
  storage: 'Save data between sessions (up to 256 KB).',
  rules: 'Change session rules such as gravity and damage.',
  sandbox: 'Override the player\'s abilities, time, lighting, weapons, NPC behaviour and debug views. All of it is undone when the mod stops.',
};

const ID_RE = /^[a-z][a-z0-9_]{1,47}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/;
const KNOWN = ['id', 'name', 'description', 'version', 'author', 'api_version', 'dependencies', 'conflicts', 'permissions', 'scripts', 'assets', 'hot_reload', 'enabled_by_default', 'homepage'];

export interface Dependency { id: string; version: string; optional: boolean }

export interface Manifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  api_version: string;
  dependencies: Dependency[];
  conflicts: string[];
  permissions: Permission[];
  scripts: string[];
  assets: string[];
  hot_reload: boolean;
  enabled_by_default: boolean;
}

export interface ManifestResult { manifest: Manifest | null; errors: string[]; warnings: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Paths in a mod stay inside it: no absolute paths, no "..", no backslashes. */
export function safePath(p: string): boolean {
  return FILE_RE.test(p) && !p.split('/').includes('..') && !p.split('/').includes('.');
}

export function parseVersion(v: string): [number, number, number] | null {
  if (!VERSION_RE.test(v)) return null;
  const [a, b, c] = v.split('.').map(Number) as [number, number, number];
  return [a, b, c];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Supports *, 1.2.3, ^1.2.3, ~1.2.3, >=1.2.3, >1.2.3, <=1.2.3 and <1.2.3. Space-separated terms must all match. */
export function validRange(range: string): boolean {
  return range.trim().split(/\s+/).every((term) => term === '*' || parseVersion(term.replace(/^(\^|~|>=|<=|>|<)/, '')) !== null);
}

export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.trim().split(/\s+/).every((term) => {
    if (term === '*') return true;
    const m = /^(\^|~|>=|<=|>|<)?(.*)$/.exec(term)!;
    const r = parseVersion(m[2]!);
    if (!r) return false;
    const c = compare(v, r);
    switch (m[1]) {
      case '^': return c >= 0 && v[0] === r[0];
      case '~': return c >= 0 && v[0] === r[0] && v[1] === r[1];
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '<': return c < 0;
      default: return c === 0;
    }
  });
}

/** A mod works if the game has the same major API version and at least the minor version it needs. */
export function apiCompatible(required: string, current = API_VERSION): boolean {
  const [ra, rb] = required.split('.').map(Number);
  const [ca, cb] = current.split('.').map(Number);
  return ra === ca && (rb ?? 0) <= (cb ?? 0);
}

export function parseManifest(raw: unknown): ManifestResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { manifest: null, errors: ['mod.json must contain a JSON object.'], warnings };

  for (const k of Object.keys(raw)) {
    if (KNOWN.includes(k)) continue;
    const hint = closest(k, KNOWN);
    warnings.push(`mod.json: unknown field "${k}" is ignored.${hint ? ` Did you mean "${hint}"?` : ''}`);
  }
  const str = (k: string, max: number): string => {
    const v = raw[k];
    if (typeof v !== 'string' || !v.trim()) {
      errors.push(`mod.json: "${k}" is required and must be text.`);
      return '';
    }
    if (v.length > max) errors.push(`mod.json: "${k}" is too long (limit ${max} characters).`);
    return v;
  };
  const id = str('id', 48);
  if (id && !ID_RE.test(id)) errors.push(`mod.json: id "${id}" is invalid. Use a lowercase letter, then lowercase letters, digits or _ (2 to 48 characters).`);
  const name = str('name', 80);
  const version = str('version', 20);
  if (version && !parseVersion(version)) errors.push(`mod.json: version "${version}" must look like 1.0.0.`);
  const author = typeof raw.author === 'string' ? raw.author.slice(0, 80) : '';
  if (!author) warnings.push('mod.json: no author given.');
  const description = typeof raw.description === 'string' ? raw.description.slice(0, 600) : '';
  if (!description) warnings.push('mod.json: no description given.');

  const api = typeof raw.api_version === 'string' ? raw.api_version : '';
  if (!/^\d+\.\d+$/.test(api)) errors.push('mod.json: "api_version" is required and must look like "1.0".');

  const dependencies: Dependency[] = [];
  if (raw.dependencies !== undefined && !Array.isArray(raw.dependencies)) errors.push('mod.json: "dependencies" must be a list.');
  for (const d of Array.isArray(raw.dependencies) ? raw.dependencies : []) {
    const entry = typeof d === 'string' ? { id: d } : d;
    if (!isObj(entry) || typeof entry.id !== 'string' || !ID_RE.test(entry.id)) {
      errors.push(`mod.json: invalid dependency ${JSON.stringify(d)}. Use "mod_id" or {"id": "mod_id", "version": "^1.0.0"}.`);
      continue;
    }
    const range = typeof entry.version === 'string' ? entry.version : '*';
    if (!validRange(range)) errors.push(`mod.json: dependency "${entry.id}" has an invalid version range "${range}".`);
    if (entry.id === id) errors.push('mod.json: a mod cannot depend on itself.');
    dependencies.push({ id: entry.id, version: range, optional: entry.optional === true });
  }

  const conflicts: string[] = [];
  for (const c of Array.isArray(raw.conflicts) ? raw.conflicts : []) {
    if (typeof c === 'string' && ID_RE.test(c)) conflicts.push(c);
    else errors.push(`mod.json: invalid conflict entry ${JSON.stringify(c)}.`);
  }

  const permissions: Permission[] = [];
  if (raw.permissions !== undefined && !Array.isArray(raw.permissions)) errors.push('mod.json: "permissions" must be a list.');
  for (const p of Array.isArray(raw.permissions) ? raw.permissions : []) {
    if ((PERMISSIONS as readonly unknown[]).includes(p)) permissions.push(p as Permission);
    else {
      const hint = typeof p === 'string' ? closest(p, PERMISSIONS) : null;
      errors.push(`mod.json: unknown permission ${JSON.stringify(p)}.${hint ? ` Did you mean "${hint}"?` : ''} Available: ${PERMISSIONS.join(', ')}.`);
    }
  }

  const scripts: string[] = [];
  if (!Array.isArray(raw.scripts) || raw.scripts.length === 0) errors.push('mod.json: "scripts" must list at least one .chaos file.');
  for (const s of Array.isArray(raw.scripts) ? raw.scripts : []) {
    if (typeof s !== 'string' || !safePath(s)) errors.push(`mod.json: script path ${JSON.stringify(s)} is not allowed. Use a relative path inside the mod.`);
    else if (!s.endsWith('.chaos')) errors.push(`mod.json: script "${s}" must end in .chaos.`);
    else scripts.push(s);
  }

  const assets: string[] = [];
  for (const a of Array.isArray(raw.assets) ? raw.assets : []) {
    if (typeof a !== 'string' || !safePath(a)) errors.push(`mod.json: asset path ${JSON.stringify(a)} is not allowed. Use a relative path inside the mod.`);
    else if (!/\.(png|jpe?g|webp)$/i.test(a)) errors.push(`mod.json: asset "${a}" must be a .png, .jpg or .webp image.`);
    else assets.push(a);
  }

  if (errors.length) return { manifest: null, errors, warnings };
  return {
    manifest: {
      id, name, description, version, author, api_version: api, dependencies, conflicts, permissions, scripts, assets,
      hot_reload: raw.hot_reload !== false,
      enabled_by_default: raw.enabled_by_default !== false,
    },
    errors,
    warnings,
  };
}
