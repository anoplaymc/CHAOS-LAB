import * as THREE from 'three';
import type { ImpulseJoint, RigidBody } from '@dimforge/rapier3d-compat';
import { geo } from '../../rendering/geometry';
import { mat } from '../../rendering/materialLibrary';
import { rotate, type V3 } from '../../utils/math';
import type { Game } from '../core/Game';
import { NpcComponent } from '../npcs/NpcComponent';
import { Group, groups, RAPIER } from '../physics/PhysicsWorld';
import { VehicleComponent } from '../vehicles/VehicleComponent';
import type { Component, Entity } from './Entity';
import { ScriptComponent } from './ScriptComponent';

const PLATE_SCAN = 1 / 10;
const DYN_MASK = Group.PROP | Group.NPC | Group.VEHICLE | Group.PLAYER;

function named(e: Entity, name: string): THREE.Object3D | undefined {
  return e.root.getObjectByName(name);
}

const param = (e: Entity, k: string, fallback: number): number => {
  const v = e.params[k] ?? e.def.params?.[k];
  return typeof v === 'number' ? v : fallback;
};

class Explosive implements Component {
  constructor(private e: Entity, private game: Game) {}
  onBreak(): void {
    const p = this.e.position;
    this.game.queueExplosion(p, param(this.e, 'radius', 6), param(this.e, 'impulse', 900), param(this.e, 'damage', 70));
  }
}

class Button implements Component {
  private timer = 0;
  constructor(private e: Entity, private game: Game) {}
  onInteract(): boolean {
    this.timer = 1;
    this.game.audio.play('click');
    return true;
  }
  interactHint() { return this.game.t('hint.press'); }
  fixedUpdate(dt: number): void {
    this.timer = Math.max(0, this.timer - dt);
    const cap = named(this.e, 'cap');
    if (cap) cap.position.y = this.timer > 0 ? 0.0 : 0.05;
  }
  signalOut(): boolean { return this.timer > 0; }
}

class Lever implements Component {
  on = false;
  constructor(private e: Entity, private game: Game) {}
  onInteract(): boolean {
    this.on = !this.on;
    this.game.audio.play('lever');
    this.pose();
    return true;
  }
  interactHint() { return this.game.t(this.on ? 'hint.leverOff' : 'hint.leverOn'); }
  private pose() {
    const p = named(this.e, 'pivot');
    if (p) p.rotation.x = this.on ? 0.6 : -0.6;
  }
  signalOut(): boolean { return this.on; }
  save() { return { on: this.on }; }
  load(d: Record<string, unknown>) { this.on = d.on === true; this.pose(); }
}

class Plate implements Component {
  private scan = Math.random() * PLATE_SCAN;
  private on = false;
  private shape: RAPIER.Cuboid | null = null;
  constructor(private e: Entity, private game: Game) {}
  fixedUpdate(dt: number): void {
    this.scan -= dt;
    if (this.scan > 0) return;
    this.scan = PLATE_SCAN;
    const b = this.e.body;
    if (!b) return;
    const s = this.e.scale;
    this.shape ??= new RAPIER.Cuboid(0.72 * s, 0.1, 0.72 * s);
    const rot = b.rotation();
    const t = b.translation();
    const up = rotate({ x: 0, y: 0.16 * s, z: 0 }, rot);
    let pressed = false;
    this.game.physics.overlap(this.shape, { x: t.x + up.x, y: t.y + up.y, z: t.z + up.z }, rot, DYN_MASK, (c) => {
      if (c.parent() === b) return true;
      pressed = true;
      return false;
    });
    if (pressed !== this.on) {
      this.on = pressed;
      this.game.audio.play('click', 0.6);
      const cap = named(this.e, 'cap');
      if (cap) cap.position.y = pressed ? -0.015 : 0.01;
    }
  }
  signalOut(): boolean { return this.on; }
}

class TimerComp implements Component {
  private t = 0;
  private input = true;
  constructor(private e: Entity, private game: Game) {}
  setSignal(on: boolean): void { this.input = on; }
  fixedUpdate(dt: number): void {
    const running = this.input || !this.game.signals.hasInput(this.e.id);
    if (running) this.t += dt; else this.t = 0;
    const hand = named(this.e, 'hand');
    if (hand) hand.rotation.y = -(this.t / param(this.e, 'period', 3)) * Math.PI * 2;
  }
  signalOut(): boolean {
    const period = param(this.e, 'period', 3);
    return this.t % period > period - param(this.e, 'duty', 1);
  }
}

class Inverter implements Component {
  private input = false;
  setSignal(on: boolean): void { this.input = on; }
  signalOut(): boolean { return !this.input; }
}

class Lamp implements Component {
  private on = false;
  constructor(private e: Entity, private game: Game) {}
  setSignal(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    const bulb = named(this.e, 'bulb') as THREE.Mesh | undefined;
    if (bulb) bulb.material = mat(on ? 'glow_amber' : 'steel_dark');
    void this.game;
  }
}

/** A powered hub holding a separate rotor body, joined by a revolute motor. */
export class Motor implements Component {
  rotor: RigidBody | null = null;
  private joint: ImpulseJoint | null = null;
  private powered = false;
  constructor(private e: Entity, private game: Game) {
    this.build();
  }
  private build(): void {
    const w = this.game.physics.w;
    const b = this.e.body!;
    const s = this.e.scale;
    const t = b.translation();
    const r = b.rotation();
    const local = { x: 0, y: 0.34 * s, z: 0 };
    const off = rotate(local, r);
    const rotor = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x + off.x, t.y + off.y, t.z + off.z).setRotation(r).setAngularDamping(0.8));
    const c = w.createCollider(
      RAPIER.ColliderDesc.cylinder(0.07 * s, 1.1 * s).setDensity(120).setFriction(0.9).setCollisionGroups(groups(Group.PROP, 0xffff & ~Group.SENSOR)),
      rotor,
    );
    this.game.physics.setOwner(c, this.e);
    const j = RAPIER.JointData.revolute({ x: 0, y: 0.2 * s, z: 0 }, { x: 0, y: -0.14 * s, z: 0 }, { x: 0, y: 1, z: 0 });
    this.joint = w.createImpulseJoint(j, b, rotor, true);
    this.joint.setContactsEnabled(false);
    const obj = new THREE.Group();
    const disc = new THREE.Mesh(geo.cyl(1.1, 1.1, 0.14, 28), mat('floor_tile'));
    disc.castShadow = disc.receiveShadow = true;
    const stripe = new THREE.Mesh(geo.box(2.1, 0.145, 0.16), mat('hazard'));
    stripe.castShadow = false;
    obj.add(disc, stripe);
    obj.scale.setScalar(s);
    this.game.entities.group.add(obj);
    this.rotor = rotor;
    this.e.extra = [{ body: rotor, object: obj, colliders: [c] }];
    this.apply();
  }
  private apply(): void {
    const j = this.joint as unknown as RAPIER.RevoluteImpulseJoint | null;
    if (!j) return;
    const speed = this.powered ? param(this.e, 'speed', 2.5) : 0;
    j.configureMotorVelocity(speed, param(this.e, 'torque', 8000));
    this.rotor?.wakeUp();
  }
  setSignal(on: boolean): void {
    if (on === this.powered) return;
    this.powered = on;
    this.apply();
    this.game.audio.play(on ? 'motorOn' : 'motorOff');
  }
  onInteract(): boolean {
    if (this.game.signals.hasInput(this.e.id)) return false;
    this.setSignal(!this.powered);
    return true;
  }
  interactHint() { return this.game.signals.hasInput(this.e.id) ? null : this.game.t(this.powered ? 'hint.stop' : 'hint.start'); }
  fixedUpdate(): void {
    if (this.powered) this.rotor?.wakeUp();
  }
  onBodyRebuilt(): void {
    if (this.e.extra[0]) this.e.extra[0].object.scale.setScalar(this.e.scale);
  }
  onMoved(): void {
    const b = this.e.body;
    if (!b || !this.rotor) return;
    const t = b.translation();
    const r = b.rotation();
    const off = rotate({ x: 0, y: 0.34 * this.e.scale, z: 0 }, r);
    this.rotor.setTranslation({ x: t.x + off.x, y: t.y + off.y, z: t.z + off.z }, true);
    this.rotor.setRotation(r, true);
    this.rotor.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rotor.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  save() {
    const r = this.rotor;
    if (!r) return { powered: this.powered };
    const t = r.translation();
    const q = r.rotation();
    return { powered: this.powered, rotor: { t: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w] } };
  }
  load(d: Record<string, unknown>) {
    this.powered = d.powered === true;
    const pose = d.rotor as { t?: unknown; q?: unknown } | undefined;
    const ok = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
    if (pose && this.rotor && ok(pose.t, 3) && ok(pose.q, 4)) {
      this.rotor.setTranslation({ x: pose.t[0]!, y: pose.t[1]!, z: pose.t[2]! }, true);
      this.rotor.setRotation({ x: pose.q[0]!, y: pose.q[1]!, z: pose.q[2]!, w: pose.q[3]! }, true);
    }
    this.apply();
  }
  get isPowered() { return this.powered; }
}

class Fan implements Component {
  private on = true;
  private scan = 0;
  private spin = 0;
  private shape: RAPIER.Cuboid | null = null;
  constructor(private e: Entity, private game: Game) {}
  setSignal(on: boolean): void { this.on = on; }
  onInteract(): boolean {
    if (this.game.signals.hasInput(this.e.id)) return false;
    this.on = !this.on;
    this.game.audio.play('click');
    return true;
  }
  interactHint() { return this.game.signals.hasInput(this.e.id) ? null : this.game.t(this.on ? 'hint.stop' : 'hint.start'); }
  fixedUpdate(dt: number): void {
    this.spin += (this.on ? 18 : 0.5) * dt;
    const rotor = named(this.e, 'rotor');
    if (rotor) rotor.rotation.y = this.spin;
    if (!this.on) return;
    this.scan -= dt;
    if (this.scan > 0) return;
    const step = 1 / 20;
    this.scan = step;
    const b = this.e.body;
    if (!b) return;
    const range = param(this.e, 'range', 8) * this.e.scale;
    const accel = param(this.e, 'force', 26);
    const r = b.rotation();
    const t = b.translation();
    const axis = rotate({ x: 0, y: 1, z: 0 }, r);
    const center = { x: t.x + axis.x * range * 0.5, y: t.y + axis.y * range * 0.5, z: t.z + axis.z * range * 0.5 };
    this.shape ??= new RAPIER.Cuboid(0.8 * this.e.scale, range * 0.5, 0.8 * this.e.scale);
    this.game.physics.overlap(this.shape, center, r, DYN_MASK, (c) => {
      const owner = this.game.physics.ownerOf(c);
      const body = c.parent();
      const pos = c.translation();
      const along = (pos.x - t.x) * axis.x + (pos.y - t.y) * axis.y + (pos.z - t.z) * axis.z;
      const falloff = Math.max(0.15, 1 - along / range);
      const dv = accel * falloff * step;
      if (owner === this.game.player) {
        this.game.player.addVelocity({ x: axis.x * dv, y: axis.y * dv, z: axis.z * dv });
        if (axis.y > 0.5) this.game.player.setAirborne();
      } else if (body && body.isDynamic() && body !== b) {
        const m = body.mass();
        body.applyImpulse({ x: axis.x * dv * m, y: axis.y * dv * m, z: axis.z * dv * m }, true);
      }
      return true;
    });
    if (Math.random() < 0.6) {
      this.game.fx.sparks.emit(
        { x: t.x + (Math.random() - 0.5), y: t.y + 0.2, z: t.z + (Math.random() - 0.5) },
        { x: axis.x * 7, y: axis.y * 7, z: axis.z * 7 },
        new THREE.Color(0x66ccff).multiplyScalar(0.35), 0.05, 0.6, 0, 0,
      );
    }
  }
}

class SpringPad implements Component {
  private cooldown = 0;
  private scan = 0;
  private input = false;
  private shape: RAPIER.Cuboid | null = null;
  private armed = false;
  constructor(private e: Entity, private game: Game) {}
  setSignal(on: boolean): void {
    if (on && !this.input) this.armed = true;
    this.input = on;
  }
  fixedUpdate(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const cap = named(this.e, 'cap');
    if (cap) cap.position.y = 0.11 + Math.max(0, this.cooldown - 0.4) * 1.2;
    this.scan -= dt;
    if (this.scan > 0 || this.cooldown > 0) return;
    this.scan = 1 / 30;
    const wired = this.game.signals.hasInput(this.e.id);
    if (wired && !this.armed) return;
    const b = this.e.body;
    if (!b) return;
    const s = this.e.scale;
    this.shape ??= new RAPIER.Cuboid(0.66 * s, 0.12, 0.66 * s);
    const r = b.rotation();
    const t = b.translation();
    const axis = rotate({ x: 0, y: 1, z: 0 }, r);
    const center = { x: t.x + axis.x * 0.26 * s, y: t.y + axis.y * 0.26 * s, z: t.z + axis.z * 0.26 * s };
    const speed = param(this.e, 'speed', 13);
    let fired = false;
    this.game.physics.overlap(this.shape, center, r, DYN_MASK, (c) => {
      const owner = this.game.physics.ownerOf(c);
      const body = c.parent();
      if (owner === this.game.player) {
        this.game.player.launch({ x: axis.x * speed, y: axis.y * speed, z: axis.z * speed });
        fired = true;
      } else if (body && body.isDynamic()) {
        const v = body.linvel();
        const along = v.x * axis.x + v.y * axis.y + v.z * axis.z;
        const add = Math.max(0, speed - along);
        const m = body.mass();
        body.applyImpulse({ x: axis.x * add * m, y: axis.y * add * m, z: axis.z * add * m }, true);
        fired = true;
      }
      return true;
    });
    this.armed = false;
    if (fired) {
      this.cooldown = 0.6;
      this.game.audio.play('spring');
      this.game.fx.burst(center, 14, 0x19e0c4, 3, 0.08, 0.4, 5);
    }
  }
}

/**
 * Slides along its local X by its own width. Moved with setTranslation rather than a kinematic target: the
 * character controller carries anything touching a kinematic body with velocity, which dragged people along.
 * Props in the way are still pushed out by the solver.
 */
class Door implements Component {
  home: V3;
  private open = false;
  private t = 0;
  constructor(private e: Entity, private game: Game) {
    this.home = e.position;
  }
  setSignal(on: boolean): void {
    if (on !== this.open) {
      this.open = on;
      this.game.audio.play('door');
    }
  }
  onInteract(): boolean {
    if (this.game.signals.hasInput(this.e.id)) {
      this.game.toast(this.game.t('toast.doorWired'), 'info');
      return false;
    }
    this.open = !this.open;
    this.game.audio.play('door');
    return true;
  }
  interactHint() { return this.game.signals.hasInput(this.e.id) ? this.game.t('hint.doorWired') : this.game.t(this.open ? 'hint.close' : 'hint.open'); }
  fixedUpdate(dt: number): void {
    const target = this.open ? 1 : 0;
    if (this.t === target) return;
    this.t = target > this.t ? Math.min(1, this.t + dt * 1.2) : Math.max(0, this.t - dt * 1.2);
    const b = this.e.body;
    if (!b) return;
    const w = (this.e.def.shape.type === 'box' ? this.e.def.shape.size[0] : 2) * this.e.scale * 0.94;
    const off = rotate({ x: w * this.t, y: 0, z: 0 }, b.rotation());
    b.setTranslation({ x: this.home.x + off.x, y: this.home.y + off.y, z: this.home.z + off.z }, true);
  }
  onMoved(): void { this.home = this.e.position; this.t = 0; }
  save() { return { home: this.home, open: this.open, slide: this.t }; }
  load(d: Record<string, unknown>) {
    const h = d.home as V3 | undefined;
    if (h && Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.z)) this.home = h;
    this.open = d.open === true;
    this.t = typeof d.slide === 'number' ? Math.min(1, Math.max(0, d.slide)) : 0;
  }
  get isOpen() { return this.open; }
}

/** Ping-pongs between home and home + axis * travel. Kinematic so it carries the player and props. */
export class Lift implements Component {
  home: V3;
  private t = 0;
  private dir = 1;
  private dwell = 0;
  private input = true;
  constructor(private e: Entity, private game: Game) {
    this.home = e.position;
  }
  setSignal(on: boolean): void { this.input = on; }
  fixedUpdate(dt: number): void {
    const b = this.e.body;
    if (!b) return;
    const wired = this.game.signals.hasInput(this.e.id);
    const travel = param(this.e, 'travel', 3);
    const speed = param(this.e, 'speed', 1.4);
    const axis = (this.e.params.axis as string | undefined) ?? 'y';
    const running = this.input || !wired;
    this.dwell = Math.max(0, this.dwell - dt);
    if (running && this.dwell === 0) {
      this.t += this.dir * speed * dt;
      // A pause at each end makes it possible to get on and off.
      if (this.t >= travel) { this.t = travel; this.dir = -1; this.dwell = 1; }
      if (this.t <= 0) { this.t = 0; this.dir = 1; this.dwell = 1; }
    }
    b.setNextKinematicTranslation({
      x: this.home.x + (axis === 'x' ? this.t : 0),
      y: this.home.y + (axis === 'y' ? this.t : 0),
      z: this.home.z + (axis === 'z' ? this.t : 0),
    });
  }
  onMoved(): void { this.home = this.e.position; this.t = 0; }
  save() { return { home: this.home, t: this.t, dir: this.dir }; }
  load(d: Record<string, unknown>) {
    const h = d.home as V3 | undefined;
    if (h && Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.z)) this.home = h;
    if (typeof d.t === 'number') this.t = d.t;
    if (d.dir === 1 || d.dir === -1) this.dir = d.dir;
  }
}

class Emitter implements Component {
  private t = 0;
  constructor(private e: Entity, private game: Game) {}
  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    const kind = this.e.def.params?.kind;
    const p = this.e.position;
    const top = { x: p.x, y: p.y + 0.25, z: p.z };
    const color = typeof this.e.def.params?.color === 'number' ? this.e.def.params.color : null;
    if (kind === 'fountain') {
      this.t = 0.05;
      this.game.fx.burst(top, 3, color ?? 0x66d9ff, 5, 0.07, 0.8, 11, { x: 0, y: 1, z: 0 });
    } else if (kind === 'firework') {
      this.t = 1.6 + Math.random();
      const burst = { x: p.x + (Math.random() - 0.5) * 4, y: p.y + 7 + Math.random() * 3, z: p.z + (Math.random() - 0.5) * 4 };
      const c = [0xff5a44, 0xffb000, 0x19e0c4, 0xa080ff, 0xff4fa3][Math.floor(Math.random() * 5)]!;
      this.game.fx.burst(burst, 40, c, 7, 0.1, 1.1, 6);
      this.game.fx.flash(burst, c, 30, 0.2);
      this.game.audio.play('tracer', 0.5, burst);
    } else if (kind === 'sparks') {
      this.t = 0.7 + Math.random();
      this.game.fx.burst(top, 18, color ?? 0xffc060, 4, 0.06, 0.6, 9, { x: 0, y: 0.6, z: 0 });
    } else {
      this.t = 0.12;
      this.game.fx.puff(top, 1, color ?? 0x888884, 0.08, 0.7, 2.2, 1.4);
    }
  }
}

export type BehaviorFactory = (e: Entity, g: Game) => Component;

export const BEHAVIORS: Record<string, BehaviorFactory> = {
  explosive: (e, g) => new Explosive(e, g),
  button: (e, g) => new Button(e, g),
  lever: (e, g) => new Lever(e, g),
  plate: (e, g) => new Plate(e, g),
  timer: (e, g) => new TimerComp(e, g),
  inverter: () => new Inverter(),
  lamp: (e, g) => new Lamp(e, g),
  motor: (e, g) => new Motor(e, g),
  fan: (e, g) => new Fan(e, g),
  spring_pad: (e, g) => new SpringPad(e, g),
  door: (e, g) => new Door(e, g),
  lift: (e, g) => new Lift(e, g),
  emitter: (e, g) => new Emitter(e, g),
  npc: (e, g) => new NpcComponent(e, g),
  vehicle: (e, g) => new VehicleComponent(e, g),
};

/** Whitelist of behaviours a content pack may reference. Unknown names are refused during validation. */
export const MOD_BEHAVIORS = ['explosive', 'button', 'lever', 'plate', 'timer', 'inverter', 'lamp', 'fan', 'spring_pad', 'emitter'];

export function attachBehaviors(e: Entity, game: Game): void {
  const b = e.def.behavior;
  if (b && BEHAVIORS[b]) e.components.push(BEHAVIORS[b]!(e, game));
  if (e.def.script) e.components.push(new ScriptComponent(e, e.def.script, game));
  if (e.def.signal) game.signals.register(e);
}
