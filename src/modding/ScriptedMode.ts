import { Table, type Value } from '../chaosscript';
import type { Loc } from '../data/materials';
import type { Game, SessionRules } from '../game/core/Game';
import type { GameMode, ModeHud, ModeResult } from '../game/modes/GameMode';
import type { ModHost } from './ModHost';

/** A game mode whose rules and loop come from a mod. A new one is made per session, like every other mode. */
export class ScriptedMode implements GameMode {
  readonly defaultMap: string;
  private result: ModeResult | null = null;
  private tick: ((...a: Value[]) => Value) | null;

  constructor(private game: Game, readonly host: ModHost, readonly id: string, private f: Record<string, unknown>) {
    const m = f.map as string | undefined;
    this.defaultMap = m ? host.resolveMap(m) : 'test_facility';
    this.tick = f.on_tick ? host.guard(f.on_tick as Value, `${id} on_tick`) : null;
  }

  configure(r: SessionRules): void {
    const f = this.f;
    if (typeof f.gravity === 'number') r.gravity = f.gravity;
    if (typeof f.damage === 'boolean') r.damage = f.damage;
    if (f.aggression) r.aggression = f.aggression as SessionRules['aggression'];
    if (typeof f.flight === 'boolean') r.flight = f.flight;
    if (typeof f.respawn === 'boolean') r.manualRespawn = f.respawn;
  }

  allowedTools(): string[] | null {
    return (this.f.tools as string[] | undefined) ?? null;
  }

  usesMapProps(): boolean {
    return this.f.use_map_props !== false;
  }

  start(): void {
    if (this.f.on_start) this.host.guard(this.f.on_start as Value, `${this.id} on_start`)();
  }

  fixedUpdate(dt: number): void {
    if (!this.result) this.tick?.(dt);
  }

  finish(win: boolean, title: Loc, detail: Loc | undefined, canContinue: boolean): void {
    const lang = this.game.settings.language;
    this.result = { win, title: title[lang], detail: detail?.[lang] ?? '', canContinue };
    this.game.onModeResult();
  }

  hud(): ModeHud | null {
    const lang = this.game.settings.language;
    let title: string = '';
    let lines: string[] = [];
    if (this.f.hud) {
      const r = this.host.guard(this.f.hud as Value, `${this.id} hud`)();
      if (r instanceof Table) {
        const t = r.get('title');
        if (typeof t === 'string') title = t;
        const l = r.get('lines');
        if (l instanceof Table) lines = l.list().filter((x): x is string | number => typeof x === 'string' || typeof x === 'number').slice(0, 12).map(String);
      }
    }
    if (!title && !lines.length && !this.result) return null;
    return { title: title || (this.f.name as Loc)[lang], lines, result: this.result };
  }

  dispose(): void {
    if (this.f.on_end) this.host.guard(this.f.on_end as Value, `${this.id} on_end`)();
  }
}
