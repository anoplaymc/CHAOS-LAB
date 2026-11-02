import type { Game } from '../core/Game';
import type { Entity } from '../entities/Entity';
import { TOOL_TYPES, type ToolType } from '../content/registry';
import { ConstructionTool, SpawnerTool } from '../building/ConstructionTool';
import { Inspector, Manipulator, PaintTool, Remover } from '../interaction/tools';
import type { Tool } from './Tool';
import { Blaster, Bouncer, Disintegrator, FreezeRay, GravityTool, ImpulseCannon } from './weapons';

export class ToolManager {
  readonly tools: Tool[];
  private index = 0;

  constructor(private game: Game) {
    this.tools = [
      new Manipulator(game), new SpawnerTool(game), new ConstructionTool(game), new Remover(game), new Inspector(game), new PaintTool(game),
      new Blaster(game), new ImpulseCannon(game), new FreezeRay(game),
      new Bouncer(game), new Disintegrator(game), new GravityTool(game),
      ...TOOL_TYPES.map((type) => type.create(game)),
    ];
  }

  /** Adds a registered tool after the existing ones, so slots already in use don't shift. */
  add(type: ToolType): void {
    if (this.tools.some((t) => t.id === type.id)) return;
    this.tools.push(type.create(this.game));
  }

  remove(id: string): void {
    const i = this.tools.findIndex((t) => t.id === id);
    if (i < 0) return;
    const wasActive = i === this.index;
    if (wasActive) this.active.unequip();
    this.tools.splice(i, 1);
    if (wasActive) {
      this.index = 0;
      this.active.equip();
      this.game.viewModel.setTool(this.active.id);
    } else if (i < this.index) {
      this.index--;
    }
  }

  get active(): Tool {
    return this.tools[this.index]!;
  }

  get activeIndex(): number {
    return this.index;
  }

  select(i: number): void {
    if (i < 0 || i >= this.tools.length || i === this.index) return;
    if (!this.isAllowed(this.tools[i]!)) {
      this.game.toast(this.game.t('toast.toolLocked'), 'warn');
      this.game.audio.play('error');
      return;
    }
    this.active.unequip();
    this.index = i;
    this.active.equip();
    this.game.viewModel.setTool(this.active.id);
    this.game.audio.play('click', 0.5);
    this.game.events.emit('toolEquipped', { id: this.active.id });
  }

  allowed: Set<string> | null = null;

  /** Restricts the hotbar for modes that limit tools. Null means every tool is available. */
  setAllowed(ids: string[] | null): void {
    this.allowed = ids ? new Set(ids) : null;
    if (this.allowed && !this.allowed.has(this.active.id)) {
      const i = this.tools.findIndex((t) => this.allowed!.has(t.id));
      if (i >= 0) this.select(i);
    }
  }

  isAllowed(t: Tool): boolean {
    return !this.allowed || this.allowed.has(t.id);
  }

  selectById(id: string): boolean {
    const i = this.tools.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.select(i);
    return true;
  }

  dropIfHolding(e: Entity): void {
    const m = this.tools[0] as Manipulator;
    if (m.heldEntity === e) m.release();
  }

  /** Frame-rate input handling: edge-triggered actions live here. */
  update(dt: number): void {
    const inp = this.game.input;
    const pl = this.game.player;
    const usable = !pl.dead && !pl.driving;
    if (usable) {
      const digit = inp.digitPressed;
      if (digit !== null) this.select(digit);
      const wheel = inp.wheelDelta;
      if (wheel !== 0 && !this.active.wheel(wheel)) {
        const n = this.tools.length;
        let i = this.index;
        for (let k = 0; k < n; k++) {
          i = (i + (wheel > 0 ? 1 : n - 1)) % n;
          if (this.isAllowed(this.tools[i]!)) break;
        }
        this.select(i);
      }
      if (inp.primaryPressed) this.active.primaryDown();
      if (inp.secondaryPressed) this.active.secondaryDown();
      if (inp.wasPressed('reload')) this.active.reload();
      if (inp.wasPressed('pin')) this.active.pin();
    }
    this.flushReleases();
    this.active.update(dt);
  }

  /** Button releases also have to arrive while paused, or a held object stays held with no button down. */
  flushReleases(): void {
    const inp = this.game.input;
    if (inp.primaryReleased) this.active.primaryUp();
    if (inp.secondaryReleased) this.active.secondaryUp();
  }

  fixedUpdate(dt: number): void {
    // Weapons regenerate energy in the background.
    const s = this.game.sandbox;
    for (const t of this.tools) {
      t.fixedUpdate(t.kind === 'weapon' ? dt * s.fireRateScale : dt);
      if (s.infiniteEnergy) t.refillEnergy();
    }
  }

  reset(): void {
    for (const t of this.tools) t.reset();
  }
}
