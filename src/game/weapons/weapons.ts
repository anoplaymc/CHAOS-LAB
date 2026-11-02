import * as THREE from 'three';
import { norm, type V3 } from '../../utils/math';
import type { Entity } from '../entities/Entity';
import { NpcComponent } from '../npcs/NpcComponent';
import { Group, RAPIER, SOLID, type RayHit } from '../physics/PhysicsWorld';
import { Cooldown, EnergyPool } from './timers';
import { Tool, type ToolHud } from './Tool';
import { stunNpc } from './systems';

const AIM = SOLID;

abstract class Weapon extends Tool {
  readonly kind = 'weapon' as const;
  protected energy: EnergyPool;
  protected cooldown: Cooldown;
  protected down = false;

  constructor(game: ConstructorParameters<typeof Tool>[0], fireRate: number, max: number, regen: number) {
    super(game);
    this.cooldown = new Cooldown(fireRate);
    this.energy = new EnergyPool(max, regen);
  }

  override primaryDown(): void { this.down = true; }
  override primaryUp(): void { this.down = false; }
  override unequip(): void { this.down = false; }
  override reset(): void {
    this.down = false;
    this.energy.refill();
    this.cooldown.reset();
  }
  override fixedUpdate(dt: number): void {
    this.cooldown.tick(dt);
    this.energy.tick(dt);
  }
  override refillEnergy(): void { this.energy.refill(); }
  override reload(): void {
    if (this.energy.value >= this.energy.max * 0.999) return;
    this.energy.refill();
    this.cooldown.remaining = Math.max(this.cooldown.remaining, 0.45);
    this.game.audio.play('reload');
    this.game.viewModel.kick(-0.4);
  }

  protected muzzle(): V3 {
    return this.game.viewModel.muzzleWorld();
  }

  protected noMoreEnergy(): void {
    this.game.audio.play('empty');
  }
}

/** Fast hitscan with heat. Alt-fire zooms. */
export class Blaster extends Weapon {
  readonly id = 'blaster';
  constructor(g: ConstructorParameters<typeof Tool>[0]) { super(g, 0.11, 100, 16); }

  override secondaryDown(): void { this.game.zoom = 0.62; }
  override secondaryUp(): void { this.game.zoom = 1; }
  override unequip(): void { super.unequip(); this.game.zoom = 1; }

  override update(): void {
    if (!this.down || !this.cooldown.ready) return;
    if (!this.energy.spend(6.5)) {
      this.cooldown.remaining = 0.25;
      this.noMoreEnergy();
      return;
    }
    this.cooldown.trigger();
    const aim = this.game.aimRay();
    // Slight bloom when firing unzoomed, none when aiming.
    const spread = this.game.zoom < 1 ? 0 : 0.008;
    const dir = norm({ x: aim.dir.x + (Math.random() - 0.5) * spread, y: aim.dir.y + (Math.random() - 0.5) * spread, z: aim.dir.z + (Math.random() - 0.5) * spread });
    const hit = this.game.physics.raycast(aim.origin, dir, 90, { mask: AIM });
    const end = hit?.point ?? { x: aim.origin.x + dir.x * 90, y: aim.origin.y + dir.y * 90, z: aim.origin.z + dir.z * 90 };
    const from = this.muzzle();
    this.game.fx.beam(from, end, 0xffb000, 0.022, 0.08);
    this.game.fx.flash(from, 0xffb000, 7, 0.05);
    this.game.audio.play('blaster', 0.65);
    this.game.viewModel.kick(0.35);
    this.game.makeNoise(aim.origin, 22);
    if (hit) {
      this.game.applyHit(hit, 11, dir, 65, { kind: 'player', point: hit.point });
      this.game.fx.burst(hit.point, 8, 0xffc040, 4, 0.06, 0.3, 11, hit.normal);
      this.game.audio.impact('metal', 0.18, hit.point);
    }
  }

  hud(): ToolHud {
    return {
      energy: this.energy.fraction,
      overheated: this.energy.overheated,
      status: this.energy.overheated ? this.t('tool.overheated') : undefined,
      hints: [['LMB', this.t('tool.fire')], ['RMB', this.t('tool.zoom')], ['R', this.t('tool.vent')]],
    };
  }
}

/** Hold to charge, release for a cone shockwave. Real impulses scaled by distance. RMB pulls instead. */
export class ImpulseCannon extends Weapon {
  readonly id = 'impulse';
  charge = 0;
  private charging = false;
  private chargeSound = 0;
  constructor(g: ConstructorParameters<typeof Tool>[0]) { super(g, 0.65, 100, 20); }

  override primaryDown(): void {
    if (!this.cooldown.ready) return;
    this.charging = true;
    this.charge = 0.15;
  }
  override primaryUp(): void {
    if (this.charging) this.fire(1, this.charge);
    this.charging = false;
    this.charge = 0;
  }
  override secondaryDown(): void {
    if (this.cooldown.ready && !this.charging) this.fire(-1, 0.55);
  }
  override unequip(): void { this.charging = false; this.charge = 0; }
  override reset(): void { super.reset(); this.charging = false; this.charge = 0; }

  override fixedUpdate(dt: number): void {
    super.fixedUpdate(dt);
    if (this.charging) this.charge = Math.min(1, this.charge + dt / 1.15);
  }

  override update(dt: number): void {
    if (!this.charging) return;
    this.chargeSound -= dt;
    if (this.chargeSound <= 0) {
      this.chargeSound = 0.12;
      this.game.audio.play('charge', 0.4 + this.charge * 0.6);
    }
    this.game.viewModel.charge = this.charge;
    if (this.charge > 0.2) {
      const m = this.muzzle();
      this.game.fx.burst(m, 1, 0x66d9ff, 0.8 + this.charge * 2, 0.05, 0.14, 0);
    }
  }

  /** Applies impulses to bodies in a forward cone. sign=-1 pulls toward the player. Returns count. */
  fire(sign: 1 | -1, power: number): number {
    const cost = 10 + power * 40;
    if (!this.energy.spend(cost)) {
      this.noMoreEnergy();
      return 0;
    }
    this.cooldown.trigger();
    this.game.viewModel.charge = 0;
    const aim = this.game.aimRay();
    const range = 6 + power * 14;
    const cosCone = Math.cos((30 * Math.PI) / 180);
    const strength = (500 + power * 3400) * sign * this.game.sandbox.impulseScale;
    let count = 0;
    this.game.physics.overlap(new RAPIER.Ball(range), aim.origin, { x: 0, y: 0, z: 0, w: 1 }, Group.PROP | Group.NPC | Group.VEHICLE | Group.PROJECTILE, (c) => {
      const b = c.parent();
      if (!b || !b.isDynamic()) return true;
      const p = b.translation();
      const to = { x: p.x - aim.origin.x, y: p.y - aim.origin.y, z: p.z - aim.origin.z };
      const d = Math.hypot(to.x, to.y, to.z);
      if (d < 0.01 || d > range) return true;
      const dot = (to.x * aim.dir.x + to.y * aim.dir.y + to.z * aim.dir.z) / d;
      if (dot < cosCone) return true;
      const k = (strength * (1 - (d / range) * 0.75)) / Math.max(1, Math.sqrt(b.mass() / 60));
      const lift = sign > 0 ? 0.18 : 0;
      b.applyImpulse({ x: aim.dir.x * k, y: (aim.dir.y + lift) * k, z: aim.dir.z * k }, true);
      b.applyTorqueImpulse({ x: (Math.random() - 0.5) * k * 0.1, y: (Math.random() - 0.5) * k * 0.1, z: (Math.random() - 0.5) * k * 0.1 }, true);
      const owner = this.game.physics.ownerOf(c) as Entity | undefined;
      if (owner?.def?.kind === 'npc') {
        stunNpc(owner, 0.6 + power);
        this.game.damageEntity(owner, 8 + power * 18, { kind: 'player' });
      }
      count++;
      return true;
    });
    const muzzle = this.muzzle();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const right = this.game.camera.getWorldDirection(new THREE.Vector3()).cross(new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, new THREE.Vector3(aim.dir.x, aim.dir.y, aim.dir.z));
      const r = range * 0.42;
      const end = {
        x: muzzle.x + aim.dir.x * range + (right.x * Math.cos(a) + up.x * Math.sin(a)) * r,
        y: muzzle.y + aim.dir.y * range + (right.y * Math.cos(a) + up.y * Math.sin(a)) * r,
        z: muzzle.z + aim.dir.z * range + (right.z * Math.cos(a) + up.z * Math.sin(a)) * r,
      };
      this.game.fx.beam(sign > 0 ? muzzle : end, sign > 0 ? end : muzzle, 0x66d9ff, 0.03 + power * 0.05, 0.2);
    }
    this.game.fx.flash(muzzle, 0x66d9ff, 22 * (0.5 + power), 0.14);
    this.game.audio.play('impulse', 0.45 + power * 0.55);
    this.game.viewModel.kick(0.7 + power);
    this.game.player.addShake(0.2 + power * 0.35);
    this.game.makeNoise(aim.origin, 28);
    // Recoil: at full power, a mid-air shot actually pushes the player back.
    if (sign > 0 && !this.game.player.grounded) {
      this.game.player.addVelocity({ x: -aim.dir.x * power * 6, y: -aim.dir.y * power * 6, z: -aim.dir.z * power * 6 });
    }
    return count;
  }

  hud(): ToolHud {
    return {
      energy: this.energy.fraction,
      overheated: this.energy.overheated,
      charge: this.charge,
      hints: [['LMB', this.t('tool.charge')], ['RMB', this.t('tool.pull')], ['R', this.t('tool.vent')]],
    };
  }
}

/** Continuous beam. Focusing on a target for a moment locks it in place on a timer. */
export class FreezeRay extends Weapon {
  readonly id = 'freeze';
  static readonly DURATION = 6;
  private focus = 0;
  private focusId = -1;
  constructor(g: ConstructorParameters<typeof Tool>[0]) { super(g, 0, 100, 14); }

  override update(dt: number): void {
    if (!this.down) {
      this.focus = 0;
      this.focusId = -1;
      return;
    }
    if (!this.energy.spend(24 * dt)) {
      this.noMoreEnergy();
      this.down = false;
      return;
    }
    const aim = this.game.aimRay();
    const hit = this.game.physics.raycast(aim.origin, aim.dir, 40, { mask: AIM });
    const end = hit?.point ?? { x: aim.origin.x + aim.dir.x * 40, y: aim.origin.y + aim.dir.y * 40, z: aim.origin.z + aim.dir.z * 40 };
    this.game.fx.beam(this.muzzle(), end, 0x9fe8ff, 0.026 + Math.random() * 0.012, 0.04);
    this.game.audio.play('freeze', 0.6);
    if (hit) {
      this.game.fx.burst(hit.point, 2, 0xcff4ff, 1.6, 0.06, 0.3, 1);
      const e = hit.owner as Entity | undefined;
      if (e?.def && e.def.body === 'dynamic') {
        if (e.id !== this.focusId) {
          this.focusId = e.id;
          this.focus = 0;
        }
        this.focus += dt;
        if (this.focus >= 0.22) this.game.freeze.freeze(e, FreezeRay.DURATION);
      } else {
        this.focusId = -1;
        this.focus = 0;
      }
    }
  }

  override secondaryDown(): void {
    const aim = this.game.aimRay();
    const hit = this.game.physics.raycast(aim.origin, aim.dir, 40, { mask: AIM });
    const e = hit?.owner as Entity | undefined;
    if (e?.def && this.game.freeze.timers.release(e.id)) this.game.audio.play('click');
  }

  hud(): ToolHud {
    return {
      energy: this.energy.fraction,
      overheated: this.energy.overheated,
      hints: [['LMB', this.t('tool.freeze')], ['RMB', this.t('tool.thaw')], ['R', this.t('tool.vent')]],
    };
  }
}

/** Launches rigid-body balls that ricochet and damage on hit. Alt-fire pops them for mini-blasts. */
export class Bouncer extends Weapon {
  readonly id = 'bouncer';
  constructor(g: ConstructorParameters<typeof Tool>[0]) { super(g, 0.28, 100, 18); }

  override update(): void {
    if (!this.down || !this.cooldown.ready) return;
    if (!this.energy.spend(9)) {
      this.cooldown.remaining = 0.3;
      this.noMoreEnergy();
      return;
    }
    this.cooldown.trigger();
    const aim = this.game.aimRay();
    const from = { x: aim.origin.x + aim.dir.x * 0.75, y: aim.origin.y + aim.dir.y * 0.75 - 0.1, z: aim.origin.z + aim.dir.z * 0.75 };
    const pv = this.game.player.velocity;
    const speed = 26;
    this.game.bouncers.fire(from, { x: aim.dir.x * speed + pv.x * 0.3, y: aim.dir.y * speed + 1.2 + pv.y * 0.3, z: aim.dir.z * speed + pv.z * 0.3 });
    this.game.audio.play('bouncer', 0.8);
    this.game.viewModel.kick(0.55);
    this.game.makeNoise(aim.origin, 16);
  }

  override secondaryDown(): void {
    this.game.bouncers.popAll();
  }

  hud(): ToolHud {
    return {
      energy: this.energy.fraction,
      overheated: this.energy.overheated,
      status: `${this.game.bouncers.balls.length}/24`,
      hints: [['LMB', this.t('tool.fire')], ['RMB', this.t('tool.pop')], ['R', this.t('tool.vent')]],
    };
  }
}

/** Dissolves only props flagged as disintegrable; NPCs take heavy damage over time instead. */
export class Disintegrator extends Weapon {
  readonly id = 'disintegrator';
  private progress = 0;
  private targetId = -1;
  private warnCooldown = 0;
  constructor(g: ConstructorParameters<typeof Tool>[0]) { super(g, 0, 100, 12); }

  private timeFor(e: Entity): number {
    return 0.55 + Math.min(2.2, e.mass / 400);
  }

  override update(dt: number): void {
    this.warnCooldown = Math.max(0, this.warnCooldown - dt);
    if (!this.down) {
      this.progress = 0;
      this.targetId = -1;
      return;
    }
    const aim = this.game.aimRay();
    const hit = this.game.physics.raycast(aim.origin, aim.dir, 28, { mask: AIM });
    const end = hit?.point ?? { x: aim.origin.x + aim.dir.x * 28, y: aim.origin.y + aim.dir.y * 28, z: aim.origin.z + aim.dir.z * 28 };
    const e = hit?.owner as Entity | undefined;
    const valid = !!e?.def && (e.def.disintegrable === true || e.def.kind === 'npc') && !e.fixture;
    if (e?.def && !valid && this.warnCooldown <= 0) {
      this.warnCooldown = 2;
      this.game.toast(this.t('toast.notDisintegrable'), 'warn');
    }
    this.game.fx.beam(this.muzzle(), end, valid ? 0x38ff90 : 0x557766, valid ? 0.03 : 0.012, 0.04);
    if (!valid || !e) {
      this.progress = 0;
      this.targetId = -1;
      return;
    }
    if (!this.energy.spend(32 * dt)) {
      this.noMoreEnergy();
      this.down = false;
      return;
    }
    if (e.id !== this.targetId) {
      this.targetId = e.id;
      this.progress = 0;
    }
    this.game.audio.play('disintegrate', 0.7, hit!.point);
    this.game.fx.burst(hit!.point, 3, 0x38ff90, 2.2, 0.07, 0.5, -2);
    if (e.def.kind === 'npc') {
      this.game.damageEntity(e, 42 * dt, { kind: 'player', point: hit!.point });
      return;
    }
    this.progress += dt;
    if (this.progress >= this.timeFor(e)) {
      this.game.dissolve(e);
      this.progress = 0;
      this.targetId = -1;
    }
  }

  override hud(): ToolHud {
    const e = this.targetId >= 0 ? this.game.entities.get(this.targetId) : undefined;
    return {
      energy: this.energy.fraction,
      overheated: this.energy.overheated,
      charge: e ? this.progress / this.timeFor(e) : 0,
      hints: [['LMB', this.t('tool.dissolve')], ['R', this.t('tool.vent')]],
    };
  }
}

/** Flips one object's gravity on a timer; alt-fire places a gravity well. R undoes all flips. */
export class GravityTool extends Weapon {
  readonly id = 'gravity';
  private wellCooldown = new Cooldown(2.5);
  constructor(g: ConstructorParameters<typeof Tool>[0]) { super(g, 0.4, 100, 14); }

  override primaryDown(): void {
    if (!this.cooldown.ready) return;
    const hit = this.aimHit();
    const e = hit?.owner as Entity | undefined;
    if (!hit || !e?.def) return;
    if (!this.energy.spend(14)) {
      this.noMoreEnergy();
      return;
    }
    if (this.game.gravityFlips.flip(e, 8)) {
      this.cooldown.trigger();
      this.game.audio.play('gravity');
      this.game.fx.beam(this.muzzle(), hit.point, 0x9060ff, 0.05, 0.25);
      this.game.fx.burst(hit.point, 14, 0xa080ff, 3, 0.08, 0.5, -6);
      this.game.viewModel.kick(0.4);
      if (e.def.kind === 'npc') e.component(NpcComponent)?.stun(1.2);
    }
  }

  override secondaryDown(): void {
    if (!this.wellCooldown.ready) return;
    if (!this.energy.spend(40)) {
      this.noMoreEnergy();
      return;
    }
    this.wellCooldown.trigger();
    const hit = this.aimHit();
    const aim = this.game.aimRay();
    const p = hit
      ? { x: hit.point.x + hit.normal.x * 1.2, y: hit.point.y + hit.normal.y * 1.2, z: hit.point.z + hit.normal.z * 1.2 }
      : { x: aim.origin.x + aim.dir.x * 14, y: aim.origin.y + aim.dir.y * 14, z: aim.origin.z + aim.dir.z * 14 };
    this.game.wells.place(p);
    this.game.fx.beam(this.muzzle(), p, 0x8a50ff, 0.06, 0.3);
    this.game.viewModel.kick(0.6);
  }

  override reload(): void {
    this.game.gravityFlips.timers.releaseAll();
    super.reload();
  }

  override fixedUpdate(dt: number): void {
    super.fixedUpdate(dt);
    this.wellCooldown.tick(dt);
  }

  private aimHit(): RayHit | null {
    const aim = this.game.aimRay();
    return this.game.physics.raycast(aim.origin, aim.dir, 45, { mask: AIM });
  }

  hud(): ToolHud {
    return {
      energy: this.energy.fraction,
      overheated: this.energy.overheated,
      status: `${this.t('tool.flips')}: ${this.game.gravityFlips.timers.size}  ${this.t('tool.wells')}: ${this.game.wells.count}/3`,
      hints: [['LMB', this.t('tool.flip')], ['RMB', this.t('tool.well')], ['R', this.t('tool.resetGravity')]],
    };
  }
}
