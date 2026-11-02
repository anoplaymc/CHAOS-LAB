import type { Permission } from '../manifest';
import type { Schema } from '../fields';
import type { ModHost } from '../ModHost';

export type ParamType = 'number' | 'string' | 'boolean' | 'vec3' | 'entity' | 'function' | 'table' | 'any' | 'color' | 'plain';

export interface Param {
  name: string;
  type: ParamType;
  optional?: boolean;
  doc?: string;
}

/**
 * One API function. This entry is the implementation, its argument checks, its permission check,
 * its documentation and its example, so none of them can drift from the others.
 */
export interface ApiFn {
  ns: string;
  name: string;
  params: Param[];
  returns?: string;
  perm?: Permission;
  /** Needs a running session. Calling it from the menu is a clear error. */
  world?: boolean;
  /** Only callable while the mod's files are first running. */
  loadOnly?: boolean;
  doc: string;
  /** Self-contained code. A test runs every one of these against a real game. */
  example: string;
  /** Fields of the definition table, for register.* functions. */
  fields?: Schema;
  /** Extra fuel a call costs. */
  cost?: number;
  impl: (h: ModHost, ...a: never[]) => unknown;
}

/** Wraps an entry so the implementation's parameter types are checked here without repeating them in the spec. */
export function fn<A extends unknown[]>(ns: string, name: string, def: Omit<ApiFn, 'ns' | 'name' | 'impl'> & { impl: (h: ModHost, ...a: A) => unknown }): ApiFn {
  return { ...def, ns, name, impl: def.impl as unknown as ApiFn['impl'] };
}

export const NS_DOCS: Record<string, string> = {
  log: 'Write to the debug console. `print` does the same as `log.info`.',
  mod: 'Information about this mod and others.',
  register: 'Add content. These can only be called while the mod is loading, which means at the top level of a script.',
  game: 'The session and the world as a whole.',
  entity: 'Everything in the world that is not the map itself. An entity is an integer id. Any function given an id that no longer exists returns nil and does nothing.',
  npc: 'Give orders to NPCs and query them.',
  vehicle: 'Vehicles.',
  player: 'The player.',
  physics: 'Queries against the physical world.',
  vec: 'Helpers for positions, which are tables like `{x=0, y=1, z=0}`.',
  fx: 'Visual effects. They are visual only and push nothing.',
  sound: 'Sound effects.',
  ui: 'Messages, panels and menus.',
  storage: 'Data kept between sessions and reloads. Values are text, numbers, booleans and tables of those. The limit is 256 KB per mod.',
  events: 'Run code when something happens. See the event table at the end of this document.',
  timer: 'Run code later. Timers run on game time, so they stop while paused, and they are cancelled when the session ends.',
  mode: 'For scripted game modes.',
  sandbox: 'Temporary overrides for sandbox and test tools. Every one of them is undone when the mod stops, is disabled or faults, and when the session ends, so a mod applies them again from `session_start`. Passing nil to a setter restores the original value.',
  input: 'Keys a mod can bind. The game\'s own keys and the browser\'s F5, F11 and F12 can\'t be taken.',
  json: 'Convert plain data to and from JSON text.',
};

export const NS_ORDER = ['log', 'mod', 'register', 'game', 'entity', 'npc', 'vehicle', 'player', 'physics', 'vec', 'fx', 'sound', 'ui', 'storage', 'events', 'timer', 'mode', 'sandbox', 'input', 'json'];
