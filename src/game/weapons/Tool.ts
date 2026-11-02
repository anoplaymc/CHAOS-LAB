import type { Game } from '../core/Game';

export interface ToolHud {
  /** Energy bar 0..1, or null if unused. */
  energy: number | null;
  overheated?: boolean;
  /** Charge or progress meter 0..1. */
  charge?: number;
  /** Short mode or status line. */
  status?: string;
  /** Colour chip shown next to the tool name. */
  swatch?: number;
  /** Control hints: [key, action]. */
  hints: [string, string][];
}

export abstract class Tool {
  abstract readonly id: string;
  abstract readonly kind: 'tool' | 'weapon';
  constructor(readonly game: Game) {}
  get t() { return this.game.t.bind(this.game); }
  equip(): void {}
  unequip(): void {}
  primaryDown(): void {}
  primaryUp(): void {}
  secondaryDown(): void {}
  secondaryUp(): void {}
  reload(): void {}
  pin(): void {}
  /** Return true to consume the scroll wheel, otherwise it switches tools. */
  wheel(_delta: number): boolean { return false; }
  /** Return true when mouse motion belongs to the tool rather than the camera. */
  mouse(_dx: number, _dy: number): boolean { return false; }
  update(_dt: number): void {}
  fixedUpdate(_dt: number): void {}
  abstract hud(): ToolHud;
  /** Tops up an energy bar, for tools that have one. */
  refillEnergy(): void {}
  /** Clears transient state on map change. */
  reset(): void {}
}
