import * as THREE from 'three';
import type { DynamicRayCastVehicleController } from '@dimforge/rapier3d-compat';
import { geo } from '../../rendering/geometry';
import { mat } from '../../rendering/materialLibrary';
import { clamp, damp, rotate, type V3 } from '../../utils/math';
import type { Game } from '../core/Game';
import type { Component, Entity } from '../entities/Entity';
import { PLAYER_RADIUS, PLAYER_STAND_HALF, type DriveTarget } from '../player/Player';
import { Group, groups, RAPIER } from '../physics/PhysicsWorld';
import { solidMat } from '../../rendering/materialLibrary';
import { BUGGY_SPEC, type VehicleSpec } from '../content/types';

/** Where the driver gets out, in order of preference: the right door, then wherever else there is room. */
const EXIT_SIDES: V3[] = [{ x: 1.8, y: 0, z: 0 }, { x: -1.8, y: 0, z: 0 }, { x: 0, y: 0, z: 2.4 }, { x: 0, y: 0, z: -2.4 }];

/**
 * Arcade-tuned vehicle on Rapier's raycast controller. Real suspension and grip,
 * plus a small stabiliser torque that keeps it from rolling constantly. Wheels are visual, not bodies.
 */
export class VehicleComponent implements Component, DriveTarget {
  private controller: DynamicRayCastVehicleController | null = null;
  private wheels: THREE.Group[] = [];
  private steer = 0;
  private camPos = new THREE.Vector3();
  private camInit = false;
  private tmp = new THREE.Vector3();
  private look = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private spin: number[];
  readonly spec: VehicleSpec;
  /** Per-vehicle sandbox multipliers. The spec is shared by every vehicle of this type. */
  engineScale = 1;
  topSpeedScale = 1;
  gripScale = 1;

  constructor(readonly entity: Entity, private game: Game) {
    this.spec = entity.def.vehicle ?? BUGGY_SPEC;
    this.spin = this.spec.wheels.map(() => 0);
    this.build();
  }

  private build(): void {
    const e = this.entity;
    const body = e.body!;
    for (const c of e.colliders) {
      c.setDensity(this.spec.density);
      c.setFriction(0.3);
    }
    body.setAngularDamping(0.5);
    body.setLinearDamping(0.05);
    body.enableCcd(true);
    const ctl = this.game.physics.w.createVehicleController(body);
    ctl.indexUpAxis = 1;
    ctl.setIndexForwardAxis = 2;
    const { wheels, rest, wheelRadius, stiffness, grip } = this.spec;
    for (const w of wheels) {
      ctl.addWheel({ x: w[0], y: w[1], z: w[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, wheelRadius);
    }
    for (let i = 0; i < wheels.length; i++) {
      ctl.setWheelSuspensionStiffness(i, stiffness);
      ctl.setWheelMaxSuspensionTravel(i, 0.3);
      ctl.setWheelSuspensionCompression(i, 3.2);
      ctl.setWheelSuspensionRelaxation(i, 4.2);
      ctl.setWheelFrictionSlip(i, grip);
      ctl.setWheelSideFrictionStiffness(i, 1);
      ctl.setWheelMaxSuspensionForce(i, 12000);
    }
    this.controller = ctl;
    for (let i = 0; i < wheels.length; i++) {
      const g = new THREE.Group();
      const tyre = new THREE.Mesh(geo.cyl(wheelRadius, wheelRadius, 0.3, 18), this.spec.wheelColor !== undefined ? solidMat(this.spec.wheelColor, 0.8, 0.05) : mat('rubber'));
      tyre.rotation.z = Math.PI / 2;
      tyre.castShadow = true;
      const hub = new THREE.Mesh(geo.cyl(0.17, 0.17, 0.32, 10), mat('paint_amber'));
      hub.rotation.z = Math.PI / 2;
      const bar = new THREE.Mesh(geo.box(0.33, 0.06, wheelRadius * 1.4), mat('steel_dark'));
      g.add(tyre, hub, bar);
      e.root.add(g);
      this.wheels.push(g);
    }
  }

  setGripScale(k: number): void {
    this.gripScale = k;
    for (let i = 0; i < this.spec.wheels.length; i++) this.controller?.setWheelFrictionSlip(i, this.spec.grip * k);
  }

  onRemove(): void {
    if (this.game.player.driving === this) this.game.player.exitVehicle();
    if (this.controller && this.game.physics.world) this.game.physics.w.removeVehicleController(this.controller);
    this.controller = null;
    this.game.audio.setEngine(0, 0);
  }

  onBodyRebuilt(): void {
    for (const c of this.entity.colliders) c.setDensity(this.spec.density);
  }

  onInteract(): boolean {
    const pl = this.game.player;
    if (pl.driving) return false;
    pl.enterVehicle(this);
    this.camInit = false;
    this.game.audio.play('door', 0.5);
    this.game.toast(this.game.t('toast.vehicleHelp'), 'info');
    return true;
  }

  interactHint() {
    return this.game.t('hint.drive');
  }

  exit(): V3 | null {
    const b = this.entity.body;
    this.game.audio.setEngine(0, 0);
    if (!b) return null;
    const t = b.translation();
    const r = b.rotation();
    const physics = this.game.physics;
    const capsule = new RAPIER.Capsule(PLAYER_STAND_HALF, PLAYER_RADIUS);
    const y = t.y + 1;
    for (const side of EXIT_SIDES) {
      const s = rotate(side, r);
      const len = Math.hypot(s.x, s.z);
      // A buggy on its side has a door facing the sky.
      if (len < 1) continue;
      // The ray stops the exit landing on the far side of a wall thin enough for the capsule to fit beyond it.
      if (physics.raycast({ x: t.x, y, z: t.z }, { x: s.x / len, y: 0, z: s.z / len }, len + PLAYER_RADIUS, { mask: Group.STATIC })) continue;
      const pos = { x: t.x + s.x, y, z: t.z + s.z };
      if (!physics.isBlocked(capsule, pos, { x: 0, y: 0, z: 0, w: 1 }, Group.STATIC | Group.PROP | Group.VEHICLE, (c) => c.parent() === b)) return pos;
    }
    // Hemmed in on every side: climb out over the top.
    return { x: t.x, y: t.y + 2, z: t.z };
  }

  resetUpright(): void {
    const b = this.entity.body;
    if (!b) return;
    const t = b.translation();
    const r = b.rotation();
    const fwd = rotate({ x: 0, y: 0, z: -1 }, r);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    b.setTranslation({ x: t.x, y: t.y + 1.2, z: t.z }, true);
    b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.game.entities.snapInterpolation(this.entity);
  }

  fixedUpdate(dt: number): void {
    const ctl = this.controller;
    const b = this.entity.body;
    if (!ctl || !b || this.entity.frozen) return;
    const driving = this.game.player.driving === this;
    const input = this.game.input;
    const throttle = driving ? (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0) : 0;
    const steerInput = driving ? (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0) : 0;
    const handbrake = !driving || input.isDown('jump');
    const speed = ctl.currentVehicleSpeed();
    const speedAbs = Math.abs(speed);
    // The chassis' nose is at -Z, while the controller's forward axis is +Z.
    const fwdSpeed = -speed;
    const { wheels, steer: steerLimit } = this.spec;
    const enginePower = this.spec.engine * this.engineScale;
    const topSpeed = this.spec.topSpeed * this.topSpeedScale;
    const steerMax = clamp(steerLimit - speedAbs * 0.018, 0.2, steerLimit);
    this.steer = damp(this.steer, steerInput * steerMax, 9, dt);
    const braking = throttle !== 0 && fwdSpeed * throttle < -0.8;
    const engine = braking ? 0 : -throttle * (speedAbs > topSpeed ? 0 : enginePower);
    for (let i = 0; i < wheels.length; i++) {
      const front = wheels[i]![2] < 0;
      if (front) ctl.setWheelSteering(i, this.steer);
      ctl.setWheelEngineForce(i, front ? engine * 0.6 : engine);
      ctl.setWheelBrake(i, handbrake ? (driving ? (front ? 20 : 60) : 12) : braking ? 45 : throttle === 0 ? 2.5 : 0);
    }
    if (driving || !b.isSleeping()) {
      const self = b;
      ctl.updateVehicle(dt, undefined, groups(Group.VEHICLE, Group.STATIC | Group.PROP), (c) => c.parent() !== self);
    }
    if (driving) {
      b.wakeUp();
      this.game.audio.setEngine(Math.min(1, speedAbs / 24), Math.abs(throttle));
      // Roll stabiliser: gently rights the chassis while wheels have contact or it's in the air.
      const up = rotate({ x: 0, y: 1, z: 0 }, b.rotation());
      const m = b.mass();
      const k = 2.4 * m * dt;
      b.applyTorqueImpulse({ x: up.z * k, y: 0, z: -up.x * k }, true);
    }
  }

  update(dt: number): void {
    const ctl = this.controller;
    if (!ctl) return;
    if (this.game.player.driving === this && this.game.input.wasPressed('reload')) this.resetUpright();
    const { wheels, rest, wheelRadius } = this.spec;
    for (let i = 0; i < wheels.length; i++) {
      const g = this.wheels[i]!;
      const w = wheels[i]!;
      const susp = ctl.wheelSuspensionLength(i) ?? rest;
      g.position.set(w[0], w[1] - susp, w[2]);
      this.spin[i]! += (-ctl.currentVehicleSpeed() / wheelRadius) * dt;
      g.rotation.set(this.spin[i]!, w[2] < 0 ? this.steer : 0, 0, 'YXZ');
    }
  }

  cameraPose(out: { position: THREE.Vector3; quaternion: THREE.Quaternion }, yaw: number, pitch: number): void {
    const root = this.entity.root;
    const orbitPitch = clamp(pitch, -1, 0.2);
    const offset = this.tmp.set(0, 0, 7).applyEuler(new THREE.Euler(orbitPitch - 0.22, yaw, 0, 'YXZ'));
    const target = this.look.copy(root.position).add(new THREE.Vector3(0, 1.1, 0));
    const desired = offset.add(target);
    // Keep the camera out of walls.
    const delta = { x: desired.x - target.x, y: desired.y - target.y, z: desired.z - target.z };
    const d = Math.hypot(delta.x, delta.y, delta.z);
    const hit = this.game.physics.raycast(target, { x: delta.x / d, y: delta.y / d, z: delta.z / d }, d, { mask: Group.STATIC, exclude: this.entity.body });
    if (hit) desired.lerpVectors(target, desired, Math.max(0.1, (hit.distance - 0.3) / d));
    if (!this.camInit) {
      this.camPos.copy(desired);
      this.camInit = true;
    }
    this.camPos.lerp(desired, 0.22);
    out.position.copy(this.camPos);
    this.m.lookAt(this.camPos, target, new THREE.Vector3(0, 1, 0));
    out.quaternion.setFromRotationMatrix(this.m);
  }

  save() {
    return { vehicle: true };
  }
}
