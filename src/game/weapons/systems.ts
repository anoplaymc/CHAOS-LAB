import * as THREE from 'three';
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import { geo } from '../../rendering/geometry';
import { addOverlay, clearOverlay, iceOverlay } from '../../rendering/effects';
import { mat } from '../../rendering/materialLibrary';
import { dist, norm, sub, type V3 } from '../../utils/math';
import type { Game } from '../core/Game';
import type { Entity } from '../entities/Entity';
import { NpcComponent } from '../npcs/NpcComponent';
import { Group, groups, RAPIER } from '../physics/PhysicsWorld';
import { StatusTimers } from './timers';

// ── Freeze ──
interface FrozenState { linvel: V3; angvel: V3; }

export class FreezeSystem {
  readonly timers: StatusTimers<FrozenState>;
  constructor(private game: Game) {
    this.timers = new StatusTimers((id, state) => this.restore(id, state));
  }

  freeze(e: Entity, seconds: number): boolean {
    if (!e.body || e.dead || e.def.body !== 'dynamic') return false;
    const started = this.timers.add(e.id, seconds, () => {
      const lv = e.body!.linvel();
      const av = e.body!.angvel();
      return { linvel: { x: lv.x, y: lv.y, z: lv.z }, angvel: { x: av.x, y: av.y, z: av.z } };
    });
    if (started) {
      this.game.tools.dropIfHolding(e);
      e.frozen = true;
      e.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      addOverlay(e.root, iceOverlay, 'ice');
      this.game.audio.play('frozen', 0.8, e.position);
      this.game.fx.burst(e.position, 18, 0x9fe8ff, 3, 0.09, 0.6, 2);
    }
    return true;
  }

  private restore(id: number, s: FrozenState): void {
    const e = this.game.entities.get(id);
    if (!e || !e.body) return;
    e.frozen = false;
    clearOverlay(e.root, 'ice');
    if (!e.anchored) {
      e.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      e.body.setLinvel(s.linvel, true);
      e.body.setAngvel(s.angvel, true);
    }
    this.game.audio.play('thaw', 0.7, e.position);
    this.game.fx.burst(e.position, 10, 0xd8f6ff, 2.5, 0.07, 0.4, 6);
  }

  isFrozen(id: number): boolean {
    return this.timers.has(id);
  }
}

// ── Gravity flips ──
export class GravityFlipSystem {
  readonly timers: StatusTimers<null>;
  constructor(private game: Game) {
    this.timers = new StatusTimers((id) => {
      const e = this.game.entities.get(id);
      if (e) {
        e.gravityScale = 1;
        this.game.zones.applyEntity(e);
        e.body?.wakeUp();
        clearOverlay(e.root, 'grav');
      }
    });
  }

  flip(e: Entity, seconds: number): boolean {
    if (!e.body || e.def.body !== 'dynamic' || e.frozen) return false;
    if (this.timers.has(e.id)) {
      this.timers.release(e.id);
      return true;
    }
    this.timers.add(e.id, seconds, () => null);
    e.gravityScale = -1;
    this.game.zones.applyEntity(e);
    e.body.wakeUp();
    addOverlay(e.root, gravOverlay, 'grav');
    return true;
  }
}

const gravOverlay = new THREE.MeshBasicMaterial({ color: 0x9060ff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });

// ── Gravity wells ──
interface Well { pos: V3; life: number; mesh: THREE.Mesh; scan: number }

const wellShape = () => new RAPIER.Ball(9);

export class GravityWellSystem {
  private wells: Well[] = [];
  private material = new THREE.MeshBasicMaterial({ color: 0x8a50ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
  constructor(private game: Game) {}

  place(p: V3): void {
    if (this.wells.length >= 3) this.removeWell(0);
    const mesh = new THREE.Mesh(geo.sphere(0.55, 16), this.material);
    mesh.position.set(p.x, p.y, p.z);
    this.game.fx.group.add(mesh);
    this.wells.push({ pos: { ...p }, life: 6, mesh, scan: 0 });
    this.game.audio.play('well', 1, p);
  }

  private removeWell(i: number): void {
    this.wells[i]!.mesh.removeFromParent();
    this.wells.splice(i, 1);
  }

  fixedUpdate(dt: number): void {
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i]!;
      w.life -= dt;
      w.mesh.scale.setScalar(1 + Math.sin(this.game.time * 9) * 0.12);
      w.mesh.rotation.y += dt * 4;
      if (w.life <= 0) {
        this.game.fx.ring(w.pos, 4, 0x8a50ff);
        this.removeWell(i);
        continue;
      }
      w.scan -= dt;
      if (w.scan > 0) continue;
      const step = 1 / 20;
      w.scan = step;
      const accel = 34;
      this.game.physics.overlap(wellShape(), w.pos, { x: 0, y: 0, z: 0, w: 1 }, Group.PROP | Group.NPC | Group.VEHICLE, (c) => {
        const b = c.parent();
        if (!b || !b.isDynamic()) return true;
        const to = sub(w.pos, b.translation());
        const d = Math.max(0.6, Math.hypot(to.x, to.y, to.z));
        const k = (accel * step * b.mass() * (1 - d / 10)) / d;
        b.applyImpulse({ x: to.x * k, y: to.y * k, z: to.z * k }, true);
        return true;
      });
      const pl = this.game.player;
      const d = dist(pl.position, w.pos);
      if (d < 9 && !pl.flying && !pl.driving) {
        const dir = norm(sub(w.pos, pl.position));
        const k = accel * step * 0.5 * (1 - d / 10);
        pl.addVelocity({ x: dir.x * k, y: dir.y * k, z: dir.z * k });
        pl.setAirborne();
      }
    }
  }

  clear(): void {
    while (this.wells.length) this.removeWell(0);
  }

  get count(): number {
    return this.wells.length;
  }
}

// ── Hostile energy bolts: simple sweep tests, pooled ──
interface Bolt { mesh: THREE.Mesh; pos: V3; dir: V3; speed: number; damage: number; life: number; owner: Entity | null; active: boolean }

export class ProjectileSystem {
  private bolts: Bolt[] = [];
  readonly group = new THREE.Group();
  constructor(private game: Game) {}

  fire(from: V3, dir: V3, speed: number, damage: number, owner: Entity | null): void {
    let b = this.bolts.find((x) => !x.active);
    if (!b) {
      if (this.bolts.length >= 40) return;
      const mesh = new THREE.Mesh(geo.sphere(0.11, 8), mat('glow_coral'));
      mesh.scale.set(1, 1, 2.8);
      this.group.add(mesh);
      b = { mesh, pos: { ...from }, dir, speed, damage, life: 0, owner, active: false };
      this.bolts.push(b);
    }
    b.pos = { ...from };
    b.dir = dir;
    b.speed = speed;
    b.damage = damage;
    b.owner = owner;
    b.life = 2.4;
    b.active = true;
    b.mesh.visible = true;
    b.mesh.position.set(from.x, from.y, from.z);
    b.mesh.lookAt(from.x + dir.x, from.y + dir.y, from.z + dir.z);
  }

  fixedUpdate(dt: number): void {
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        this.deactivate(b);
        continue;
      }
      const stepLen = b.speed * dt;
      const hit = this.game.physics.raycast(b.pos, b.dir, stepLen, {
        mask: Group.STATIC | Group.PROP | Group.NPC | Group.VEHICLE | Group.PLAYER,
        exclude: b.owner?.body ?? null,
      });
      if (hit) {
        // A bolt with no owner came from the player's own gun.
        const fromOwner = hit.owner === b.owner || (!b.owner && hit.owner === this.game.player);
        if (!fromOwner) {
          this.game.applyHit(hit, b.damage, b.dir, 30, { kind: b.owner ? 'npc' : 'player', entity: b.owner, point: hit.point });
          this.game.fx.burst(hit.point, 12, 0xff6a50, 3.5, 0.08, 0.35, 8);
          this.deactivate(b);
          continue;
        }
      }
      b.pos.x += b.dir.x * stepLen;
      b.pos.y += b.dir.y * stepLen;
      b.pos.z += b.dir.z * stepLen;
      b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
    }
  }

  private deactivate(b: Bolt): void {
    b.active = false;
    b.mesh.visible = false;
  }

  clear(): void {
    for (const b of this.bolts) this.deactivate(b);
  }

  get activeCount(): number {
    return this.bolts.filter((b) => b.active).length;
  }
}

// ── Bouncer balls: real rigid bodies that collide and ricochet ──
export class BouncerBall {
  mesh: THREE.Mesh;
  body: RigidBody;
  collider: Collider;
  life = 9;
  lastHit = 0;
  constructor(game: Game, pos: V3, vel: V3, material: THREE.Material) {
    const w = game.physics.w;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinvel(vel.x, vel.y, vel.z).setCcdEnabled(true).setLinearDamping(0.03));
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.ball(0.17)
        .setRestitution(0.94)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setFriction(0.2)
        .setDensity(350)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setCollisionGroups(groups(Group.PROJECTILE, Group.STATIC | Group.PROP | Group.NPC | Group.VEHICLE | Group.PROJECTILE)),
      this.body,
    );
    this.collider.setContactForceEventThreshold(40);
    this.mesh = new THREE.Mesh(geo.sphere(0.17, 12), material);
    this.mesh.castShadow = true;
    this.mesh.position.set(pos.x, pos.y, pos.z);
    game.physics.setOwner(this.collider, this);
  }
}

export class BouncerSystem {
  balls: BouncerBall[] = [];
  readonly group = new THREE.Group();
  private material = new THREE.MeshStandardMaterial({ color: 0x38ffb0, emissive: 0x0d8a60, emissiveIntensity: 1.2, roughness: 0.3 });
  constructor(private game: Game) {}

  fire(pos: V3, vel: V3): void {
    if (this.balls.length >= 24) this.removeBall(0);
    const ball = new BouncerBall(this.game, pos, vel, this.material);
    this.group.add(ball.mesh);
    this.balls.push(ball);
  }

  private removeBall(i: number): void {
    const b = this.balls[i]!;
    this.balls.splice(i, 1);
    b.mesh.removeFromParent();
    if (this.game.physics.world) {
      this.game.physics.clearOwner(b.collider);
      this.game.physics.w.removeRigidBody(b.body);
    }
  }

  /** Called from impact handling. Fast balls hurt what they hit. */
  onImpact(ball: BouncerBall, other: unknown): void {
    if (this.game.time - ball.lastHit < 0.12) return;
    ball.lastHit = this.game.time;
    const v = ball.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    const p = ball.body.translation();
    this.game.audio.impact('rubber', Math.min(1, speed / 25), p);
    this.game.fx.burst(p, 4, 0x38ffb0, 2.2, 0.05, 0.25, 4);
    const ent = other as Entity;
    if (speed > 5 && ent && (ent as Entity).def !== undefined) {
      this.game.damageEntity(ent, speed * 0.9, { kind: 'player', point: p });
    }
  }

  popAll(): number {
    const n = this.balls.length;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const p = this.balls[i]!.body.translation();
      this.game.shockwave({ x: p.x, y: p.y, z: p.z }, 2.8, 110, 14, null);
      this.game.audio.play('pop', 0.8, p);
      this.removeBall(i);
    }
    return n;
  }

  update(dt: number): void {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i]!;
      b.life -= dt;
      if (b.life <= 0) {
        this.game.fx.burst(b.body.translation(), 6, 0x38ffb0, 2, 0.05, 0.3, 3);
        this.removeBall(i);
        continue;
      }
      const p = b.body.translation();
      b.mesh.position.set(p.x, p.y, p.z);
    }
  }

  clear(): void {
    while (this.balls.length) this.removeBall(this.balls.length - 1);
  }
}

export function stunNpc(e: Entity, seconds: number): void {
  e.component(NpcComponent)?.stun(seconds);
}
