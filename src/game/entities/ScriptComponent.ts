import type { Game } from '../core/Game';
import type { ScriptHooks } from '../content/types';
import type { Component, DamageSource, Entity } from './Entity';

/** Connects an item definition's callbacks to the entity lifecycle. Holds per-instance script data so saves keep it. */
export class ScriptComponent implements Component {
  private timer = Math.random() * 0.1;
  /** Output level set through entity.set_signal. */
  out = false;
  private started = false;

  constructor(private e: Entity, private hooks: ScriptHooks, private game: Game) {}

  fixedUpdate(dt: number): void {
    // Runs here rather than in the constructor so entity.spawn has returned before the mod's on_spawn sees the entity.
    if (!this.started) {
      this.started = true;
      this.hooks.spawn?.(this.e);
    }
    if (!this.hooks.tick) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const rate = this.hooks.tickRate ?? 0.1;
    this.timer = rate;
    this.hooks.tick(this.e, rate);
  }

  onDamage(amount: number, src: DamageSource): void {
    this.hooks.damage?.(this.e, amount, src);
  }

  onInteract(): boolean {
    if (!this.hooks.interact) return false;
    return this.hooks.interact(this.e);
  }

  interactHint(): string | null {
    const h = this.hooks.hint;
    if (!h) return this.hooks.interact ? this.game.t('hint.press') : null;
    return typeof h === 'string' ? h : h[this.game.settings.language];
  }

  onBreak(): void {
    this.hooks.brk?.(this.e);
  }

  onRemove(): void {
    this.hooks.remove?.(this.e);
  }

  setSignal(on: boolean): void {
    this.hooks.signal?.(this.e, on);
  }

  signalOut(): boolean {
    return this.out;
  }

  save(): Record<string, unknown> | undefined {
    const d = this.e.scriptData;
    return d && Object.keys(d).length ? { script: d } : undefined;
  }

  load(data: Record<string, unknown>): void {
    const d = data.script;
    if (d && typeof d === 'object' && !Array.isArray(d)) this.e.scriptData = d as Record<string, unknown>;
  }
}
