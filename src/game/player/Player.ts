import * as THREE from 'three';
import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import { clamp, damp, type V3 } from '../../utils/math';
import type { Game } from '../core/Game';
import { Group, groups, RAPIER } from '../physics/PhysicsWorld';
import type { Entity } from '../entities/Entity';

export const PLAYER_RADIUS = 0.34;
export const PLAYER_STAND_HALF = 0.56;
const RADIUS = PLAYER_RADIUS;
const STAND_HALF = PLAYER_STAND_HALF;
const CROUCH_HALF = 0.2;
const EYE_STAND = 1.62;
const EYE_CROUCH = 0.96;
const JUMP_HEIGHT = 1.3;
const COYOTE = 0.11;
const BUFFER = 0.12;
const STEP_ASSIST_HEIGHT = 0.46;
const STEP_ASSIST_DELAY = 0.1;
const MAX_UNSTICK_DROP = 6;

export interface DriveTarget {
  entity: Entity;
  cameraPose(out: { position: THREE.Vector3; quaternion: THREE.Quaternion }, yaw: number, pitch: number): void;
  exit(): V3 | null;
}

/** Capsule controller built on Rapier's kinematic character controller. Camera always derives from the body. */
export class Player {
  body: RigidBody | null = null;
  collider: Collider | null = null;
  private controller: KinematicCharacterController | null = null;
  velocity = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  grounded = false;
  crouching = false;
  flying = false;
  dead = false;
  health = 100;
  maxHealth = 100;
  gravityFactor = 1;
  driving: DriveTarget | null = null;
  groundTag: string | null = null;
  private airTime = 0;
  private blockedTime = 0;
  private progressAnchor: V3 = { x: 0, y: 0, z: 0 };
  private jumpBuffer = 0;
  private lastHurt = 0;
  private respawnTimer = 0;
  private stepDistance = 0;
  private eyeHeight = EYE_STAND;
  private prev = new THREE.Vector3();
  private cur = new THREE.Vector3();
  private fallSpeed = 0;
  private shake = 0;
  private bobPhase = 0;
  spawnPoint: V3 = { x: 0, y: 1, z: 0 };
  spawnYaw = 0;
  /** Set by a game mode to control what happens after a death. */
  onDeath: (() => void) | null = null;
  /** A held body that the controller should not treat as solid ground. */
  ignoreBody: RigidBody | null = null;

  constructor(private game: Game) {}

  init(spawn: V3, yaw: number): void {
    const w = this.game.physics.w;
    this.spawnPoint = spawn;
    this.spawnYaw = yaw;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + RADIUS + STAND_HALF + 0.05, spawn.z));
    const desc = RAPIER.ColliderDesc.capsule(STAND_HALF, RADIUS)
      .setCollisionGroups(groups(Group.PLAYER, Group.STATIC | Group.PROP | Group.NPC | Group.VEHICLE | Group.PROJECTILE))
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
      .setFriction(0.1);
    this.collider = w.createCollider(desc, this.body);
    this.collider.setContactForceEventThreshold(1200);
    this.game.physics.setOwner(this.collider, this);
    const c = w.createCharacterController(0.03);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    c.enableAutostep(0.42, 0.18, false);
    c.enableSnapToGround(0.28);
    c.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    c.setApplyImpulsesToDynamicBodies(true);
    c.setCharacterMass(85);
    c.setNormalNudgeFactor(0.0005);
    this.controller = c;
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.grounded = false;
    this.flying = false;
    this.crouching = false;
    this.dead = false;
    this.driving = null;
    this.health = this.maxHealth;
    this.eyeHeight = EYE_STAND;
    this.respawnTimer = 0;
    this.gravityFactor = 1;
    this.captureInitial();
  }

  dispose(): void {
    const w = this.game.physics.world;
    if (w && this.controller) w.removeCharacterController(this.controller);
    this.controller = null;
    this.body = null;
    this.collider = null;
  }

  private captureInitial(): void {
    const p = this.body!.translation();
    this.cur.set(p.x, p.y, p.z);
    this.prev.copy(this.cur);
  }

  get position(): V3 {
    return this.body ? this.body.translation() : this.spawnPoint;
  }

  get feet(): V3 {
    const p = this.position;
    return { x: p.x, y: p.y - this.halfTotal, z: p.z };
  }

  private get halfTotal(): number {
    return (this.crouching ? CROUCH_HALF : STAND_HALF) + RADIUS;
  }

  get eye(): V3 {
    const f = this.feet;
    return { x: f.x, y: f.y + this.eyeHeight, z: f.z };
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Direction the camera faces, derived from yaw and pitch. */
  get forward(): V3 {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  look(dx: number, dy: number): void {
    const s = this.game.settings;
    const k = 0.0021 * s.sensitivity;
    this.yaw -= dx * k;
    this.pitch = clamp(this.pitch - dy * k * (s.invertY ? -1 : 1), -1.55, 1.55);
  }

  queueJump(): void {
    this.jumpBuffer = BUFFER;
  }

  setAirborne(): void {
    this.grounded = false;
    this.airTime = COYOTE + 1;
  }

  /** Spring pads: replaces velocity along the launch direction. */
  launch(v: V3): void {
    this.velocity.x += v.x * 0.3;
    this.velocity.z += v.z * 0.3;
    this.velocity.y = Math.max(this.velocity.y, v.y);
    this.setAirborne();
  }

  /** Launch pads, fans, explosions. */
  addVelocity(v: V3): void {
    this.velocity.x += v.x;
    this.velocity.y += v.y;
    this.velocity.z += v.z;
    if (v.y > 0) this.grounded = false;
  }

  setVerticalVelocity(y: number): void {
    this.velocity.y = y;
    this.grounded = false;
    this.airTime = COYOTE + 1;
  }

  toggleFlight(): void {
    if (this.driving || this.dead || !this.game.rules.flight) return;
    this.flying = !this.flying;
    this.collider?.setEnabled(!this.flying);
    this.velocity.y = 0;
    this.game.toast(this.game.t(this.flying ? 'toast.flightOn' : 'toast.flightOff'), 'info');
    if (!this.flying) this.unstuck();
  }

  /** Moves to the nearest spot where the capsule fits, after leaving noclip or a vehicle. */
  unstuck(): void {
    const b = this.body;
    if (!b) return;
    const p = b.translation();
    const shape = new RAPIER.Capsule(this.crouching ? CROUCH_HALF : STAND_HALF, RADIUS);
    const mask = Group.STATIC | Group.PROP | Group.VEHICLE;
    const fits = (y: number) => !this.game.physics.isBlocked(shape, { x: p.x, y, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, mask, (c) => c === this.collider);
    for (let i = 0; i < 40; i++) {
      // Down clears a ceiling the head is touching. It stays short of a capsule's height, so it can't reach under a floor.
      const y = fits(p.y + i * 0.25) ? p.y + i * 0.25 : i <= MAX_UNSTICK_DROP && fits(p.y - i * 0.25) ? p.y - i * 0.25 : null;
      if (y === null) continue;
      if (i > 0) {
        b.setTranslation({ x: p.x, y, z: p.z }, true);
        this.captureInitial();
      }
      return;
    }
    this.respawn();
  }

  teleport(pos: V3, yaw?: number): void {
    const b = this.body;
    if (!b) return;
    b.setTranslation(pos, true);
    this.velocity = { x: 0, y: 0, z: 0 };
    if (yaw !== undefined) this.yaw = yaw;
    this.captureInitial();
  }

  respawn(): void {
    if (this.driving) this.exitVehicle();
    this.flying = false;
    this.collider?.setEnabled(true);
    this.dead = false;
    this.health = this.maxHealth;
    this.setCrouch(false);
    const s = this.spawnPoint;
    this.teleport({ x: s.x, y: s.y + RADIUS + STAND_HALF + 0.05, z: s.z }, this.spawnYaw);
    this.pitch = 0;
    this.unstuck();
    this.game.ui.set({ dead: false });
  }

  enterVehicle(target: DriveTarget): void {
    this.driving = target;
    this.collider?.setEnabled(false);
    this.flying = false;
  }

  exitVehicle(): void {
    const t = this.driving;
    if (!t) return;
    this.driving = null;
    const pos = t.exit();
    this.collider?.setEnabled(true);
    if (pos) this.teleport(pos);
    this.unstuck();
  }

  takeDamage(amount: number, _source: string, attacker?: Entity | null): void {
    if (this.dead || this.flying || !this.game.rules.damage || amount <= 0) return;
    this.health -= amount;
    this.game.events.emit('playerDamaged', { amount, source: _source, attacker: attacker ?? null });
    this.lastHurt = this.game.time;
    this.game.ui.set({ damagePulse: this.game.ui.get().damagePulse + 1 });
    this.game.audio.play('hurt');
    this.addShake(0.5);
    if (this.health <= 0) this.die();
  }

  private die(): void {
    this.health = 0;
    this.dead = true;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.respawnTimer = 2.5;
    if (this.driving) this.exitVehicle();
    this.game.ui.set({ dead: true });
    this.game.events.emit('playerDied', undefined);
    this.onDeath?.();
  }

  /** Prevents the automatic respawn. Game modes call this when no more lives remain. */
  holdDead(): void {
    this.respawnTimer = Number.POSITIVE_INFINITY;
  }

  addShake(amount: number): void {
    if (this.game.settings.cameraMotion) this.shake = Math.min(1.2, this.shake + amount);
  }

  private setCrouch(want: boolean): void {
    if (want === this.crouching || !this.collider || !this.body) return;
    const p = this.body.translation();
    const delta = STAND_HALF - CROUCH_HALF;
    if (!want) {
      // Only stand up if the taller capsule fits.
      const standCenter = { x: p.x, y: p.y + delta + 0.02, z: p.z };
      const shape = new RAPIER.Capsule(STAND_HALF, RADIUS - 0.02);
      const blocked = this.game.physics.isBlocked(shape, standCenter, { x: 0, y: 0, z: 0, w: 1 }, Group.STATIC | Group.PROP | Group.VEHICLE, (c) => c === this.collider);
      if (blocked) return;
      this.collider.setHalfHeight(STAND_HALF);
      this.body.setTranslation({ x: p.x, y: p.y + delta, z: p.z }, true);
    } else {
      this.collider.setHalfHeight(CROUCH_HALF);
      this.body.setTranslation({ x: p.x, y: p.y - delta, z: p.z }, true);
    }
    this.crouching = want;
    // The body moved instantly, compensate interpolation so the camera only moves by the eye height blend.
    const np = this.body.translation();
    this.prev.y += np.y - p.y;
    this.cur.y += np.y - p.y;
  }

  fixedUpdate(dt: number): void {
    const b = this.body;
    const col = this.collider;
    if (!b || !col || !this.controller) return;
    if (this.driving) {
      // The capsule rides along invisibly so distance checks stay meaningful.
      const p = this.driving.entity.position;
      b.setNextKinematicTranslation({ x: p.x, y: p.y + 0.6, z: p.z });
      return;
    }
    if (this.dead) {
      if (this.respawnTimer !== Number.POSITIVE_INFINITY) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) this.respawn();
      }
      return;
    }
    const input = this.game.input;
    const fwd = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    const str = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wishX = -sin * fwd + cos * str;
    let wishZ = -cos * fwd - sin * str;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }

    if (this.flying) {
      this.flyUpdate(dt, wishX, wishZ, fwd);
      return;
    }

    this.setCrouch(input.isDown('crouch'));
    const sprint = input.isDown('sprint') && !this.crouching;
    const maxSpeed = this.crouching ? 2.9 : sprint ? 9.2 : 5.8;
    const gravity = Math.abs(this.game.physics.w.gravity.y) * this.gravityFactor;
    const wantX = wishX * maxSpeed;
    const wantZ = wishZ * maxSpeed;

    // Acceleration: strong on the ground, limited in the air, with friction only when grounded.
    const accel = this.grounded ? (wishLen > 0 ? 60 : 46) : this.game.rules.airControl * 40;
    const dvx = wantX - this.velocity.x;
    const dvz = wantZ - this.velocity.z;
    const dvLen = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (this.grounded || wishLen > 0) {
      const k = dvLen > maxDv ? maxDv / dvLen : 1;
      this.velocity.x += dvx * k;
      this.velocity.z += dvz * k;
    }

    // Coyote time plus jump buffering make jumps feel fair at ledges.
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    if (this.jumpBuffer > 0 && this.airTime < COYOTE) {
      // Take-off speed follows world gravity only, so a low-gravity zone really does mean higher jumps.
      const g = Math.max(1, Math.abs(this.game.physics.w.gravity.y));
      this.velocity.y = Math.sqrt(2 * g * JUMP_HEIGHT);
      this.jumpBuffer = 0;
      this.airTime = COYOTE + 1;
      this.grounded = false;
      this.game.audio.play('jump');
    }

    if (!this.grounded) {
      this.velocity.y -= gravity * dt;
      if (this.velocity.y < -45) this.velocity.y = -45;
    } else if (this.velocity.y < 0) {
      this.velocity.y = -1.5;
    }

    const platform = this.groundVelocity();
    const dx = (this.velocity.x + platform.x) * dt;
    const dy = (this.velocity.y + platform.y) * dt;
    const dz = (this.velocity.z + platform.z) * dt;
    const ignore = this.ignoreBody;
    this.controller.computeColliderMovement(
      col, { x: dx, y: dy, z: dz },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(Group.PLAYER, Group.STATIC | Group.PROP | Group.NPC | Group.VEHICLE),
      ignore ? (c) => c.parent() !== ignore : undefined,
    );
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    const p = b.translation();
    b.setNextKinematicTranslation({ x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z });

    this.clipVelocityAgainstObstacles();

    if (!wasGrounded && this.grounded) this.land();
    if (!this.grounded) this.fallSpeed = Math.max(this.fallSpeed, -this.velocity.y);
    this.updateGroundTag();

    const moved = Math.hypot(mv.x - platform.x * dt, mv.z - platform.z * dt);
    this.stepAssist(dt, wishX, wishZ, wishLen);
    if (this.grounded && moved > 0.0005) {
      this.stepDistance += moved;
      this.bobPhase += moved * 2.6;
      if (this.stepDistance > (sprint ? 2.5 : 1.9)) {
        this.stepDistance = 0;
        this.game.audio.playFootstep(this.groundSurface());
      }
    }

    // Health slowly recovers when the mode allows it.
    if (this.game.rules.regen && this.game.time - this.lastHurt > 6 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 6 * dt);
    }
  }

  /**
   * Removes velocity pointing into walls and ceilings, using the controller's real contact normals. Comparing
   * requested against actual movement doesn't work: slopes shorten horizontal travel, which reads as being blocked.
   */
  private clipVelocityAgainstObstacles(): void {
    const c = this.controller!;
    const v = this.velocity;
    for (let i = 0; i < c.numComputedCollisions(); i++) {
      const hit = c.computedCollision(i);
      if (!hit) continue;
      const n = hit.normal1;
      // Pushable props take the momentum instead of stopping the player dead.
      if (hit.collider?.parent()?.isDynamic()) continue;
      if (n.y < 0.5) {
        const into = v.x * n.x + v.z * n.z;
        if (into < 0) {
          v.x -= into * n.x;
          v.z -= into * n.z;
        }
      }
      if (n.y < -0.3 && v.y > 0) v.y = 0;
    }
  }

  /**
   * Rapier's autostep handles most ledges, but a capsule can still wedge against a low edge. If the player
   * is pushing forward and getting nowhere, step up when there is standing room just above and ahead.
   */
  private stepAssist(dt: number, wishX: number, wishZ: number, wishLen: number): void {
    const b = this.body!;
    const p = b.translation();
    if (wishLen < 0.1 || !this.grounded) {
      this.blockedTime = 0;
      this.progressAnchor = { x: p.x, y: p.y, z: p.z };
      return;
    }
    this.blockedTime += dt;
    if (this.blockedTime < STEP_ASSIST_DELAY) return;
    this.blockedTime = 0;
    // Real displacement: the controller can report small movements that jitter in place.
    const progress = ((p.x - this.progressAnchor.x) * wishX + (p.z - this.progressAnchor.z) * wishZ) / wishLen;
    this.progressAnchor = { x: p.x, y: p.y, z: p.z };
    if (progress > 0.05) return;
    const half = this.crouching ? CROUCH_HALF : STAND_HALF;
    const shape = new RAPIER.Capsule(half, RADIUS - 0.01);
    const ID = { x: 0, y: 0, z: 0, w: 1 };
    const mask = Group.STATIC | Group.PROP | Group.VEHICLE;
    const self = (c: Collider) => c === this.collider;
    const dx = wishX / wishLen;
    const dz = wishZ / wishLen;
    // Lowest lift that clears the edge, so the hop is as small as possible.
    for (const lift of [0.28, STEP_ASSIST_HEIGHT]) {
      const raised = { x: p.x, y: p.y + lift, z: p.z };
      const ahead = { x: raised.x + dx * 0.12, y: raised.y, z: raised.z + dz * 0.12 };
      if (this.game.physics.isBlocked(shape, raised, ID, mask, self) || this.game.physics.isBlocked(shape, ahead, ID, mask, self)) continue;
      // There has to be something to land on just ahead, or this would walk the player off into the air.
      const probe = { x: ahead.x + dx * 0.4, y: ahead.y, z: ahead.z + dz * 0.4 };
      if (!this.game.physics.raycast(probe, { x: 0, y: -1, z: 0 }, half + RADIUS + lift + 0.1, { mask })) continue;
      b.setNextKinematicTranslation(ahead);
      return;
    }
  }

  private flyUpdate(dt: number, wishX: number, wishZ: number, fwd: number): void {
    const b = this.body!;
    const input = this.game.input;
    const sprint = input.isDown('sprint');
    const speed = sprint ? 26 : 12;
    const vert = (input.isDown('jump') ? 1 : 0) - (input.isDown('crouch') ? 1 : 0);
    const pitchY = Math.sin(this.pitch) * fwd;
    const flat = Math.cos(this.pitch);
    const tx = wishX * (fwd !== 0 ? flat : 1) * speed;
    const tz = wishZ * (fwd !== 0 ? flat : 1) * speed;
    const ty = (pitchY + vert) * speed;
    const k = 1 - Math.exp(-8 * dt);
    this.velocity.x += (tx - this.velocity.x) * k;
    this.velocity.y += (ty - this.velocity.y) * k;
    this.velocity.z += (tz - this.velocity.z) * k;
    const p = b.translation();
    b.setNextKinematicTranslation({ x: p.x + this.velocity.x * dt, y: p.y + this.velocity.y * dt, z: p.z + this.velocity.z * dt });
    this.grounded = false;
    this.fallSpeed = 0;
  }

  private land(): void {
    const v = this.fallSpeed;
    this.fallSpeed = 0;
    if (v > 4) this.game.audio.play('land', Math.min(1, v / 14));
    if (v > 15) this.takeDamage((v - 15) * 7, 'fall');
    if (v > 7) this.addShake(Math.min(0.5, v / 40));
  }

  /** Velocity of a large moving object under the player, so it carries them along. */
  private groundVelocity(): V3 {
    // Rapier's controller already carries a character on kinematic bodies. This only adds heavy dynamic ones.
    if (!this.grounded) return { x: 0, y: 0, z: 0 };
    const f = this.feet;
    const hit = this.game.physics.raycast({ x: f.x, y: f.y + 0.1, z: f.z }, { x: 0, y: -1, z: 0 }, 0.5, { mask: Group.STATIC | Group.PROP });
    const body = hit?.body;
    if (!hit || !body || !body.isDynamic() || body.mass() <= 500) return { x: 0, y: 0, z: 0 };
    return body.velocityAtPoint(hit.point);
  }

  private updateGroundTag(): void {
    this.groundTag = null;
    if (!this.grounded) return;
    const f = this.feet;
    const hit = this.game.physics.raycast({ x: f.x, y: f.y + 0.1, z: f.z }, { x: 0, y: -1, z: 0 }, 0.4, { mask: Group.STATIC | Group.PROP });
    const owner = hit?.owner as { tag?: string } | undefined;
    if (owner?.tag === 'bounce') {
      this.groundTag = 'bounce';
      this.setVerticalVelocity(15);
      this.game.audio.play('bounce');
    }
  }

  private groundSurface(): string {
    const f = this.feet;
    const hit = this.game.physics.raycast({ x: f.x, y: f.y + 0.1, z: f.z }, { x: 0, y: -1, z: 0 }, 0.4, { mask: Group.STATIC | Group.PROP });
    const owner = hit?.owner as { surface?: string } | undefined;
    return owner?.surface ?? 'metal';
  }

  /** Stores physics state for render interpolation. Runs right after the world step. */
  capture(): void {
    if (!this.body) return;
    const p = this.body.translation();
    this.prev.copy(this.cur);
    this.cur.set(p.x, p.y, p.z);
  }

  private tmp = new THREE.Vector3();
  private pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  updateCamera(camera: THREE.PerspectiveCamera, alpha: number, dt: number): void {
    if (!this.body) return;
    if (this.driving) {
      this.driving.cameraPose(this.pose, this.yaw, this.pitch);
      camera.position.copy(this.pose.position);
      camera.quaternion.copy(this.pose.quaternion);
      return;
    }
    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight = damp(this.eyeHeight, targetEye, 14, dt);
    this.tmp.lerpVectors(this.prev, this.cur, alpha);
    const motion = this.game.settings.cameraMotion;
    const speed01 = clamp(this.speed / 9, 0, 1);
    const bob = motion && this.grounded ? Math.sin(this.bobPhase * 2) * 0.022 * speed01 : 0;
    const sway = motion && this.grounded ? Math.cos(this.bobPhase) * 0.012 * speed01 : 0;
    camera.position.set(
      this.tmp.x + Math.cos(this.yaw) * sway,
      this.tmp.y - this.halfTotal + this.eyeHeight + bob,
      this.tmp.z - Math.sin(this.yaw) * sway,
    );
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.05 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.05 : 0;
    this.euler.set(this.pitch + sx, this.yaw + sy, 0);
    camera.quaternion.setFromEuler(this.euler);
  }
}
