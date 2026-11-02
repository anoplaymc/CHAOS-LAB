import type { SoundLayer } from '../../audio/AudioEngine';
import { catalog, type ItemDef } from '../../data/items';
import { materials, type Loc, type PhysMaterial } from '../../data/materials';
import type { Game, SessionRules } from '../core/Game';
import type { MapDef } from '../maps/MapBuilder';
import type { GameMode, ModeFactory } from '../modes/GameMode';
import { applyPersonality, NPC_PROFILES, type NpcProfile } from '../npcs/NpcBrain';
import type { Tool } from '../weapons/Tool';

/**
 * The one way to add content. Core expansion data and scripted mods both come through here, each under a
 * source name, so everything a mod added can be removed exactly. Nothing can replace an existing id.
 */
export class ContentError extends Error {}

export interface ToolType {
  id: string;
  create(game: Game): Tool;
  source?: string;
}

export interface ModeInfo {
  id: string;
  name: Loc;
  desc: Loc;
  map?: string;
  source: string;
}

export const MAP_STORE: Record<string, MapDef> = {};
export const MODE_STORE: Record<string, ModeFactory> = {};
export const TOOL_TYPES: ToolType[] = [];
export const MODE_INFO = new Map<string, ModeInfo>();

export type SessionRulePatch = Partial<Pick<SessionRules, 'gravity' | 'damage' | 'aggression' | 'flight' | 'regen' | 'airControl' | 'keepCorpses' | 'manualRespawn'>>;

const undoBySource = new Map<string, (() => void)[]>();

function claim(source: string | undefined, undo: () => void): void {
  if (!source) return;
  let list = undoBySource.get(source);
  if (!list) undoBySource.set(source, (list = []));
  list.push(undo);
}

function claimed(kind: string, id: string, exists: boolean): void {
  if (exists) throw new ContentError(`${kind} id "${id}" already exists.`);
}

export function registerItem(def: ItemDef, source?: string): void {
  claimed('Item', def.id, catalog.has(def.id));
  catalog.add(source ? { ...def, source } : def);
  claim(source, () => catalog.remove(def.id));
}

export function registerMaterial(m: PhysMaterial, source?: string): void {
  claimed('Material', m.id, materials.has(m.id));
  materials.add(source ? { ...m, source } : m);
  claim(source, () => materials.remove(m.id));
}

/** Registers an NPC's behaviour profile. It still needs an item with params.archetype = this id to appear in the game. */
export function registerNpcType(profile: NpcProfile, source?: string): void {
  claimed('NPC type', profile.id, profile.id in NPC_PROFILES);
  NPC_PROFILES[profile.id] = applyPersonality(profile);
  claim(source, () => delete NPC_PROFILES[profile.id]);
}

export function registerToolType(type: ToolType, source?: string): void {
  claimed('Tool', type.id, TOOL_TYPES.some((t) => t.id === type.id));
  const entry = { ...type, source };
  TOOL_TYPES.push(entry);
  claim(source, () => {
    const i = TOOL_TYPES.indexOf(entry);
    if (i >= 0) TOOL_TYPES.splice(i, 1);
  });
}

export function registerMap(def: MapDef, source?: string): void {
  claimed('Map', def.id, def.id in MAP_STORE);
  MAP_STORE[def.id] = def;
  claim(source, () => delete MAP_STORE[def.id]);
}

export function registerMode(info: Omit<ModeInfo, 'source'>, factory: (game: Game, challenge: number) => GameMode, source: string): void {
  claimed('Mode', info.id, info.id in MODE_STORE);
  MODE_STORE[info.id] = factory;
  MODE_INFO.set(info.id, { ...info, source });
  claim(source, () => {
    delete MODE_STORE[info.id];
    MODE_INFO.delete(info.id);
  });
}

/** Removes everything a source registered, newest first. */
export function unregisterSource(source: string): void {
  const list = undoBySource.get(source);
  if (!list) return;
  undoBySource.delete(source);
  for (let i = list.length - 1; i >= 0; i--) list[i]!();
}

/** Lets a mod host clean up things the registry can't see, such as sounds held by one game's audio engine. */
export function onUnregister(source: string, undo: () => void): void {
  claim(source, undo);
}

export type { SoundLayer };
