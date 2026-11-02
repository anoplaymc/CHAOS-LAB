import type { Game } from '../core/Game';
import type { Entity } from '../entities/Entity';
import type { V3 } from '../../utils/math';
import type { Zone } from './MapBuilder';

const inside = (z: Zone, p: V3) => p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z;

/** Applies map volumes (low gravity, jump pads) to the player and dynamic bodies. */
export class ZoneSystem {
  zones: Zone[] = [];
  private timer = 0;

  constructor(private game: Game) {}

  factorAt(p: V3): number {
    let f = 1;
    for (const z of this.zones) if (z.type === 'lowg' && inside(z, p)) f = Math.min(f, z.gravity ?? 0.3);
    return f;
  }

  /** Final body gravity scale: held objects float, otherwise zone factor times any tool effect. */
  applyEntity(e: Entity): void {
    const b = e.body;
    if (!b || !b.isDynamic()) return;
    const scale = e.held ? 0 : e.gravityScale * this.factorAt(e.position);
    if (b.gravityScale() !== scale) b.setGravityScale(scale, true);
  }

  fixedUpdate(dt: number): void {
    const pl = this.game.player;
    if (pl.body) {
      pl.gravityFactor = this.factorAt(pl.position);
      if (pl.grounded) {
        for (const z of this.zones) {
          if (z.type === 'pad' && inside(z, pl.feet)) {
            pl.setVerticalVelocity(z.speed ?? 14);
            this.game.audio.play('spring');
          }
        }
      }
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    for (const e of this.game.entities.active) this.applyEntity(e);
  }
}
