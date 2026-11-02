import type { ItemDef } from '../../data/items';
import type { Game, SessionRules } from '../core/Game';
import type { MapBuilder } from '../maps/MapBuilder';

export interface ModeResult { win: boolean; title: string; detail: string; canContinue?: boolean; next?: boolean }

export interface ModeHud {
  title: string;
  lines: string[];
  progress?: number;
  result: ModeResult | null;
}

/** A mode owns one play session. A new instance is created per session, so nothing leaks between sessions. */
export interface GameMode {
  readonly id: string;
  readonly defaultMap: string;
  /** Adjust this session's rules. They are always a fresh copy. */
  configure(rules: SessionRules): void;
  /** Tools available in this mode, or null for all. */
  allowedTools(): string[] | null;
  /** Add mode-specific geometry to the map under construction. */
  extendMap?(b: MapBuilder): void;
  /** True when the map's own props should be spawned. */
  usesMapProps(): boolean;
  start(): void;
  fixedUpdate(dt: number): void;
  /** Returns an i18n key explaining why this item can't be placed, or null. */
  placementDenied?(def: ItemDef): string | null;
  hud(): ModeHud | null;
  dispose(): void;
}

export const MODE_IDS = ['sandbox', 'survival', 'contraption', 'playground'] as const;
export type ModeId = (typeof MODE_IDS)[number] | 'editor';

export type ModeFactory = (game: Game, challenge: number) => GameMode;
