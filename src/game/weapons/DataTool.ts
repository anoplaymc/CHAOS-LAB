import type { Loc } from '../../data/materials';
import { norm, type V3 } from '../../utils/math';
import type { Game } from '../core/Game';
import type { Entity } from '../entities/Entity';
import { SOLID, type RayHit } from '../physics/PhysicsWorld';
import { Cooldown, EnergyPool } from './timers';
import { Tool, type ToolHud } from './Tool';

export interface DataToolHit { hit: RayHit; entity: Entity | null }

/** A tool or weapon described by data. Core expansion items and scripted mods both use this one class. */
export interface DataToolSpec {
  id: string;
  kind: 'tool' | 'weapon';
  /** Energy capacity. Omit for a tool with no energy bar. */
  energy?: number;
  energyRegen?: number;
  /** Energy used per shot. */
  cost?: number;
  /** Seconds between shots. */
  cooldown?: number;
  /** Keeps firing while the button is held. */
  automatic?: boolean;
  /** What the primary button does by itself. 'none' leaves it all to callbacks. */
  fire?: 'none' | 'hitscan' | 'bolt' | 'cone';
  damage?: number;
  range?: number;
  impulse?: number;
  /** Rays per shot for 'cone'. */
  pellets?: number;
  /** Cone half width, roughly in radians. */
  spread?: number;
  /** Bolt speed in m/s. */
  speed?: number;
  color?: number;
  sound?: string;
  /** Seconds a hit target stays frozen. */
  freeze?: number;
  /** Beam jumps to this many more targets nearby. */
  chain?: number;
  hints?: [string, string | Loc][];
  onPrimary?(g: Game): void;
  onPrimaryUp?(g: Game): void;
  onSecondary?(g: Game): void;
  onSecondaryUp?(g: Game): void;
  onReload?(g: Game): void;
  onEquip?(g: Game): void;
  onUnequip?(g: Game): void;
  onUpdate?(g: Game, dt: number): void;
  /** Runs after each shot. */
  onFire?(g: Game): void;
  /** Runs for each thing a shot hits. */
  onHit?(g: Game, h: DataToolHit): void;
  /** Short status text in the HUD. */
  status?(g: Game): string | null;
}

export class DataTool extends Tool {
  readonly id: string;
  readonly kind: 'tool' | 'weapon';
  private pool: EnergyPool | null;
  private timer: Cooldown;
  private down = false;

  constructor(game: Game, readonly spec: DataToolSpec) {
    super(game);
    this.id = spec.id;
    this.kind = spec.kind;
    this.pool = spec.energy ? new EnergyPool(spec.energy, spec.energyRegen ?? spec.energy / 6) : null;
    this.timer = new Cooldown(spec.cooldown ?? 0.25);
  }

  override primaryDown(): void {
    this.down = true;
    this.spec.onPrimary?.(this.game);
    if (!this.spec.automatic) this.tryFire();
  }

  override primaryUp(): void {
    this.down = false;
    this.spec.onPrimaryUp?.(this.game);
  }

  override secondaryDown(): void { this.spec.onSecondary?.(this.game); }
  override secondaryUp(): void { this.spec.onSecondaryUp?.(this.game); }

  override reload(): void {
    this.spec.onReload?.(this.game);
    if (this.pool && this.pool.value < this.pool.max * 0.999) {
      this.pool.refill();
      this.timer.remaining = Math.max(this.timer.remaining, 0.45);
      this.game.audio.play('reload');
      this.game.viewModel.kick(-0.4);
    }
  }

  override equip(): void { this.spec.onEquip?.(this.game); }
  override unequip(): void {
    this.down = false;
    this.spec.onUnequip?.(this.game);
  }

  override reset(): void {
    this.down = false;
    this.pool?.refill();
    this.timer.reset();
  }

  override fixedUpdate(dt: number): void {
    this.timer.tick(dt);
    this.pool?.tick(dt);
  }

  override update(dt: number): void {
    if (this.down && this.spec.automatic) this.tryFire();
    this.spec.onUpdate?.(this.game, dt);
  }

  /** Fires if the cooldown and energy allow. Returns whether a shot happened. */
  tryFire(): boolean {
    const s = this.spec;
    if ((s.fire ?? 'none') === 'none' && !s.onFire) return false;
    if (!this.timer.ready) return false;
    if (this.pool && !this.pool.spend(s.cost ?? 10)) {
      this.timer.remaining = 0.25;
      this.game.audio.play('empty');
      return false;
    }
    this.timer.trigger();
    const g = this.game;
    const aim = g.aimRay();
    const muzzle = g.viewModel.muzzleWorld();
    const color = s.color ?? 0xffb000;
    if (s.fire === 'hitscan') {
      this.shoot(aim.origin, aim.dir, muzzle, color);
    } else if (s.fire === 'cone') {
      const spread = s.spread ?? 0.08;
      for (let i = 0; i < (s.pellets ?? 6); i++) {
        const dir = norm({ x: aim.dir.x + (Math.random() - 0.5) * spread * 2, y: aim.dir.y + (Math.random() - 0.5) * spread * 2, z: aim.dir.z + (Math.random() - 0.5) * spread * 2 });
        this.shoot(aim.origin, dir, muzzle, color);
      }
    } else if (s.fire === 'bolt') {
      g.projectiles.fire(muzzle, { ...aim.dir }, s.speed ?? 28, s.damage ?? 10, null);
    }
    if (s.fire && s.fire !== 'none') {
      g.fx.flash(muzzle, color, 7, 0.05);
      g.audio.play(s.sound ?? 'blaster', 0.65);
      g.viewModel.kick(0.35);
      g.makeNoise(aim.origin, 20);
    }
    s.onFire?.(g);
    return true;
  }

  private shoot(origin: V3, dir: V3, muzzle: V3, color: number): void {
    const g = this.game;
    const s = this.spec;
    const range = s.range ?? 60;
    const hit = g.physics.raycast(origin, dir, range, { mask: SOLID });
    const end = hit?.point ?? { x: origin.x + dir.x * range, y: origin.y + dir.y * range, z: origin.z + dir.z * range };
    g.fx.beam(muzzle, end, color, 0.022, 0.08);
    if (!hit) return;
    this.apply(hit, dir, color);
    for (let i = 0, from = hit; i < (s.chain ?? 0); i++) {
      const next = this.nearestOther(from, 7);
      if (!next) break;
      g.fx.beam(from.point, next.point, color, 0.018, 0.12);
      this.apply(next, norm({ x: next.point.x - from.point.x, y: next.point.y - from.point.y, z: next.point.z - from.point.z }), color);
      from = next;
    }
  }

  private apply(hit: RayHit, dir: V3, color: number): void {
    const g = this.game;
    const s = this.spec;
    g.applyHit(hit, s.damage ?? 0, dir, s.impulse ?? 0, { kind: 'player', point: hit.point });
    g.fx.burst(hit.point, 6, color, 4, 0.06, 0.3, 11, hit.normal);
    const e = (hit.owner as Entity | undefined)?.def ? (hit.owner as Entity) : null;
    if (e && s.freeze) g.freeze.freeze(e, s.freeze);
    s.onHit?.(g, { hit, entity: e });
  }

  /** The nearest dynamic thing to jump to from the last hit, excluding what it already struck. */
  private nearestOther(from: RayHit, radius: number): RayHit | null {
    const g = this.game;
    const first = from.owner as Entity | undefined;
    let best: Entity | null = null;
    let bestD = radius;
    for (const e of g.entities.active) {
      if (e === first || e.fixture || !e.body?.isDynamic()) continue;
      const q = e.position;
      const d = Math.hypot(q.x - from.point.x, q.y - from.point.y, q.z - from.point.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) return null;
    const dir = norm({ x: best.position.x - from.point.x, y: best.position.y - from.point.y, z: best.position.z - from.point.z });
    const shot = g.physics.raycast({ x: from.point.x + dir.x * 0.05, y: from.point.y + dir.y * 0.05, z: from.point.z + dir.z * 0.05 }, dir, bestD + 1, { mask: SOLID, exclude: first?.body ?? undefined });
    return shot && shot.owner === best ? shot : null;
  }

  override hud(): ToolHud {
    const lang = this.game.settings.language;
    const hints: [string, string][] = (this.spec.hints ?? []).map(([k, v]) => [k, typeof v === 'string' ? this.game.t(v) : v[lang]]);
    const status = this.spec.status?.(this.game) ?? undefined;
    return { energy: this.pool ? this.pool.fraction : null, overheated: this.pool?.overheated, status: status ?? undefined, hints };
  }
}
