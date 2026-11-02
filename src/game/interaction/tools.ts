import * as THREE from 'three';
import { setOutline } from '../../rendering/effects';
import { materials } from '../../data/materials';
import { clamp, type V3 } from '../../utils/math';
import { recordValue } from '../building/commands';
import { NpcComponent } from '../npcs/NpcComponent';
import type { Entity } from '../entities/Entity';
import { Group, SOLID } from '../physics/PhysicsWorld';
import { Tool, type ToolHud } from '../weapons/Tool';

export const MANIP_RANGE = 26;
export const MANIP_MAX_MASS = 800;
const HOLD_GAIN = 13;
const MAX_SPEED = 32;
const MAX_ACCEL = 240;
const ROT_GAIN = 9;
const MAX_ANGVEL = 14;
const LOSE_DISTANCE = 6;

const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const axisY = new THREE.Vector3(0, 1, 0);
const axisX = new THREE.Vector3(1, 0, 0);

/**
 * Velocity-controlled grab. Each step sets a velocity toward the hold point, never a position, so a
 * held object still collides with walls and pushes other props. CCD stops it tunnelling at speed.
 */
export class Manipulator extends Tool {
  readonly id = 'manipulator';
  readonly kind = 'tool' as const;
  held: Entity | null = null;
  private holdDist = 4;
  private relRot = new THREE.Quaternion();
  private hover: Entity | null = null;
  private lostTimer = 0;
  private pushing = 0;
  private hadCcd = false;

  get heldEntity(): Entity | null {
    return this.held;
  }

  private aimEntity(range: number): { e: Entity; dist: number } | null {
    const aim = this.game.aimRay();
    const hit = this.game.physics.raycast(aim.origin, aim.dir, range, { mask: SOLID & ~Group.STATIC | Group.STATIC });
    const e = hit?.owner as Entity | undefined;
    if (!hit || !e?.def) return null;
    return { e, dist: hit.distance };
  }

  grab(e: Entity, dist: number): boolean {
    const b = e.body;
    if (!b || e.frozen || !b.isDynamic()) return false;
    if (e.mass > MANIP_MAX_MASS) {
      this.game.toast(this.t('toast.tooHeavy', { mass: Math.round(e.mass) }), 'warn');
      this.game.audio.play('error');
      return false;
    }
    this.held = e;
    e.held = true;
    this.hadCcd = b.isCcdEnabled();
    b.enableCcd(true);
    this.game.zones.applyEntity(e);
    b.wakeUp();
    this.holdDist = clamp(dist, 1.6, MANIP_RANGE);
    this.lostTimer = 0;
    // Remember orientation relative to the player's yaw, so it turns with the player.
    const r = b.rotation();
    qA.setFromAxisAngle(axisY, this.game.player.yaw).invert();
    this.relRot.set(r.x, r.y, r.z, r.w).premultiply(qA);
    this.game.player.ignoreBody = b;
    this.game.audio.play('grab');
    setOutline(e.root, 0xffb000);
    return true;
  }

  release(): void {
    const e = this.held;
    if (!e) return;
    this.held = null;
    e.held = false;
    this.game.player.ignoreBody = null;
    setOutline(e.root, null);
    this.hover = null;
    if (e.body && !e.dead) {
      e.body.enableCcd(this.hadCcd);
      this.game.zones.applyEntity(e);
    }
    this.game.audio.play('release');
  }

  throw(): void {
    const e = this.held;
    if (!e?.body) return;
    const aim = this.game.aimRay();
    const speed = clamp(2600 / Math.max(1, e.mass), 6, 26);
    const pv = this.game.player.velocity;
    const b = e.body;
    this.release();
    b.setLinvel({ x: aim.dir.x * speed + pv.x * 0.5, y: aim.dir.y * speed + pv.y * 0.5 + 1, z: aim.dir.z * speed + pv.z * 0.5 }, true);
    b.setAngvel({ x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 }, true);
    this.game.audio.play('throw');
    this.game.viewModel.kick(0.8);
  }

  override primaryDown(): void {
    if (this.held) return;
    const t = this.aimEntity(MANIP_RANGE);
    if (t) this.grab(t.e, t.dist);
  }
  override primaryUp(): void {
    if (this.held) this.release();
  }
  override secondaryDown(): void {
    if (this.held) this.throw();
    else this.pushing = this.game.input.isDown('sprint') ? -1 : 1;
  }
  override secondaryUp(): void {
    this.pushing = 0;
  }
  override unequip(): void {
    this.release();
    this.pushing = 0;
    this.setHover(null);
  }
  override reset(): void {
    this.held = null;
    this.hover = null;
    this.pushing = 0;
  }

  override pin(): void {
    const e = this.held ?? this.aimEntity(MANIP_RANGE)?.e;
    if (!e || e.def.body !== 'dynamic') return;
    const anchored = !e.anchored;
    if (this.held === e) this.release();
    this.game.entities.setAnchored(e, anchored);
    this.game.toast(this.t(anchored ? 'toast.pinned' : 'toast.unpinned'), 'info');
    this.game.audio.play('pin');
  }

  override wheel(delta: number): boolean {
    if (!this.held) return false;
    this.holdDist = clamp(this.holdDist - delta * 0.6, 1.6, MANIP_RANGE);
    return true;
  }

  override mouse(dx: number, dy: number): boolean {
    if (!this.held || !this.game.input.isDown('reload')) return false;
    qA.setFromAxisAngle(axisY, dx * 0.006);
    qB.setFromAxisAngle(axisX, dy * 0.006);
    this.relRot.premultiply(qA).premultiply(qB).normalize();
    return true;
  }

  private setHover(e: Entity | null): void {
    if (this.hover === e) return;
    if (this.hover && this.hover !== this.held && !this.hover.dead) setOutline(this.hover.root, null);
    this.hover = e;
    if (e && e !== this.held) setOutline(e.root, e.mass > MANIP_MAX_MASS || !e.isDynamic ? 0xe8432f : 0x19e0c4);
  }

  override update(): void {
    if (this.held) {
      if (this.held.dead) {
        this.held = null;
        this.game.player.ignoreBody = null;
        return;
      }
      const b = this.held.body!;
      this.game.fx.beam(this.game.viewModel.muzzleWorld(), b.translation(), 0xffb000, 0.012, 0.03);
      return;
    }
    const t = this.aimEntity(MANIP_RANGE);
    this.setHover(t && t.e.def.body === 'dynamic' ? t.e : null);
  }

  override fixedUpdate(dt: number): void {
    if (this.pushing !== 0 && !this.held && this.game.tools.active === this) this.applyPush(dt);
    const e = this.held;
    if (!e) return;
    const b = e.body;
    if (!b || e.dead || !b.isDynamic()) {
      this.release();
      return;
    }
    const pl = this.game.player;
    const eye = pl.eye;
    const f = pl.forward;
    const target: V3 = { x: eye.x + f.x * this.holdDist, y: eye.y + f.y * this.holdDist, z: eye.z + f.z * this.holdDist };
    const p = b.worldCom();
    const ex = target.x - p.x;
    const ey = target.y - p.y;
    const ez = target.z - p.z;
    const err = Math.hypot(ex, ey, ez);
    // Blocked by a wall: let go rather than wedging against it forever.
    this.lostTimer = err > LOSE_DISTANCE ? this.lostTimer + dt : 0;
    if (this.lostTimer > 0.7) {
      this.release();
      this.game.toast(this.t('toast.lostHold'), 'info');
      return;
    }
    // Velocity-limited P controller. Without an integral term it can't wind up and oscillate.
    let wx = ex * HOLD_GAIN;
    let wy = ey * HOLD_GAIN;
    let wz = ez * HOLD_GAIN;
    const ws = Math.hypot(wx, wy, wz);
    if (ws > MAX_SPEED) {
      const k = MAX_SPEED / ws;
      wx *= k; wy *= k; wz *= k;
    }
    const v = b.linvel();
    let dx = wx - v.x;
    let dy = wy - v.y;
    let dz = wz - v.z;
    const dl = Math.hypot(dx, dy, dz);
    const maxDv = (MAX_ACCEL * dt * clamp(300 / e.mass, 0.35, 1));
    if (dl > maxDv) {
      const k = maxDv / dl;
      dx *= k; dy *= k; dz *= k;
    }
    b.setLinvel({ x: v.x + dx, y: v.y + dy, z: v.z + dz }, true);

    // Same idea for rotation: drive angular velocity along the shortest arc to the desired orientation.
    qA.setFromAxisAngle(axisY, pl.yaw);
    qB.copy(qA).multiply(this.relRot);
    const r = b.rotation();
    qC.set(r.x, r.y, r.z, r.w).invert();
    qB.multiply(qC);
    if (qB.w < 0) qB.set(-qB.x, -qB.y, -qB.z, -qB.w);
    const angle = 2 * Math.acos(clamp(qB.w, -1, 1));
    const s = Math.sqrt(Math.max(1e-9, 1 - qB.w * qB.w));
    const mag = Math.min(MAX_ANGVEL, angle * ROT_GAIN);
    if (angle > 1e-3) b.setAngvel({ x: (qB.x / s) * mag, y: (qB.y / s) * mag, z: (qB.z / s) * mag }, true);
    else b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private applyPush(dt: number): void {
    const t = this.aimEntity(MANIP_RANGE);
    if (!t?.e.body || !t.e.body.isDynamic()) return;
    const aim = this.game.aimRay();
    const m = t.e.mass;
    const accel = 26 * this.pushing * dt * m * clamp(120 / m, 0.25, 1);
    t.e.body.applyImpulse({ x: aim.dir.x * accel, y: aim.dir.y * accel, z: aim.dir.z * accel }, true);
    this.game.fx.beam(this.game.viewModel.muzzleWorld(), t.e.position, 0x19e0c4, 0.01, 0.03);
  }

  hud(): ToolHud {
    if (this.held) {
      return {
        energy: null,
        status: `${Math.round(this.held.mass)} kg`,
        hints: [['RMB', this.t('tool.throw')], ['Wheel', this.t('tool.distance')], ['R', this.t('tool.rotate')], ['T', this.t('tool.pin')]],
      };
    }
    return { energy: null, hints: [['LMB', this.t('tool.grab')], ['RMB', this.t('tool.push')], ['T', this.t('tool.pin')]] };
  }
}

/** Deletes the aimed entity. Map fixtures refuse. */
export class Remover extends Tool {
  readonly id = 'remover';
  readonly kind = 'tool' as const;
  private hover: Entity | null = null;

  private target(): Entity | null {
    const aim = this.game.aimRay();
    const hit = this.game.physics.raycast(aim.origin, aim.dir, 60, { mask: SOLID });
    const e = hit?.owner as Entity | undefined;
    return e?.def ? e : null;
  }

  override primaryDown(): void {
    const e = this.target();
    if (e) this.game.removeByPlayer(e);
  }

  /** Alt-fire removes every link attached to the aimed object, leaving the object itself. */
  override secondaryDown(): void {
    const e = this.target();
    if (!e) return;
    const links = this.game.connections.ofEntity(e.id);
    for (const l of links) this.game.connections.remove(l.id);
    if (links.length) {
      this.game.toast(this.t('toast.unlinked', { n: links.length }), 'info');
      this.game.audio.play('remove', 0.5);
    }
  }

  override update(): void {
    const e = this.target();
    if (e === this.hover) return;
    if (this.hover && !this.hover.dead) setOutline(this.hover.root, null);
    this.hover = e;
    if (e) setOutline(e.root, 0xe8432f);
  }

  override unequip(): void {
    if (this.hover && !this.hover.dead) setOutline(this.hover.root, null);
    this.hover = null;
  }

  override reset(): void {
    this.hover = null;
  }

  hud(): ToolHud {
    return { energy: null, hints: [['LMB', this.t('tool.remove')], ['RMB', this.t('tool.unlink')], ['Z', this.t('build.undo')]] };
  }
}

export interface InspectInfo {
  id: number;
  name: string;
  material: string;
  mass: number;
  friction: number;
  restitution: number;
  speed: number;
  health: number | null;
  maxHealth: number;
  scale: number;
  anchored: boolean;
  frozen: boolean;
  links: number;
  wires: number;
  state: string | null;
}

/** Reads physical properties, and changes a target's material with alt-fire. */
export class Inspector extends Tool {
  readonly id = 'inspector';
  readonly kind = 'tool' as const;
  private locked: Entity | null = null;
  private hover: Entity | null = null;
  private timer = 0;

  /** The entity that the Delete key acts on and that the panel describes. */
  get focus(): Entity | null {
    if (this.locked?.dead) this.locked = null;
    return this.locked ?? this.hover;
  }

  private target(): Entity | null {
    const a = this.game.aimRay();
    const e = this.game.physics.raycast(a.origin, a.dir, 60, { mask: SOLID })?.owner as Entity | undefined;
    return e?.def ? e : null;
  }

  override primaryDown(): void {
    if (this.locked && !this.locked.dead) setOutline(this.locked.root, null);
    this.locked = this.target();
    if (this.locked) {
      setOutline(this.locked.root, 0xffb000);
      this.game.audio.play('click', 0.6);
    }
  }

  override secondaryDown(): void {
    const e = this.focus;
    if (!e || e.fixture || e.locked || !e.body) return;
    const list = materials.list();
    const before = e.materialId;
    const next = list[(list.findIndex((m) => m.id === before) + 1) % list.length]!;
    const set = (x: Entity, id: string) => this.game.entities.setMaterial(x, id);
    set(e, next.id);
    recordValue(this.game, e.id, 'material', before, next.id, set);
    this.game.toast(next.name[this.game.settings.language], 'info');
    this.game.audio.impact(next.sound, 0.5, e.position);
  }

  override update(dt: number): void {
    const e = this.target();
    if (e !== this.hover) {
      if (this.hover && !this.hover.dead && this.hover !== this.locked) setOutline(this.hover.root, null);
      this.hover = e;
      if (e && e !== this.locked) setOutline(e.root, 0x19e0c4);
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.15;
      this.game.ui.set({ inspect: this.describe(this.focus) });
    }
  }

  private describe(e: Entity | null): InspectInfo | null {
    if (!e?.body) return null;
    const c = e.colliders[0];
    const v = e.body.linvel();
    const m = materials.get(e.materialId);
    const npc = e.component(NpcComponent);
    return {
      id: e.id,
      name: e.def.name[this.game.settings.language],
      material: m.name[this.game.settings.language],
      mass: e.body.isDynamic() ? e.body.mass() : c?.mass() ?? 0,
      friction: c?.friction() ?? 0,
      restitution: c?.restitution() ?? 0,
      speed: Math.hypot(v.x, v.y, v.z),
      health: e.def.breakSpeed !== undefined || e.def.kind === 'npc' ? Math.max(0, e.health) : null,
      maxHealth: e.maxHealth,
      scale: e.scale,
      anchored: e.anchored,
      frozen: e.frozen,
      links: this.game.connections.ofEntity(e.id).length,
      wires: this.game.signals.graph.wiresOf(e.id).length,
      state: npc ? npc.state : null,
    };
  }

  override unequip(): void {
    if (this.locked && !this.locked.dead) setOutline(this.locked.root, null);
    if (this.hover && !this.hover.dead) setOutline(this.hover.root, null);
    this.locked = this.hover = null;
    this.game.ui.set({ inspect: null });
  }

  override reset(): void {
    this.locked = this.hover = null;
    this.game.ui.set({ inspect: null });
  }

  hud(): ToolHud {
    return { energy: null, hints: [['LMB', this.t('tool.inspectLock')], ['RMB', this.t('tool.cycleMaterial')], ['Del', this.t('help.delete')]] };
  }
}

export const PAINT_COLORS = [0xe8432f, 0xffb000, 0xf4e04d, 0x38c172, 0x19a596, 0x3b82f6, 0x8a50ff, 0xff4fa3, 0xe8e6dc, 0x2a2f33];

export class PaintTool extends Tool {
  readonly id = 'paint';
  readonly kind = 'tool' as const;
  private index = 0;

  private target(): Entity | null {
    const a = this.game.aimRay();
    const e = this.game.physics.raycast(a.origin, a.dir, 40, { mask: SOLID })?.owner as Entity | undefined;
    return e?.def && e.def.kind !== 'npc' ? e : null;
  }

  get color(): number {
    return PAINT_COLORS[this.index]!;
  }

  private paint(color: number | null): void {
    const e = this.target();
    if (!e || e.fixture) return;
    const before = e.tint;
    const set = (x: Entity, c: number | null) => this.game.entities.setTint(x, c);
    set(e, color);
    recordValue(this.game, e.id, 'paint', before, color, set);
    this.game.audio.play('paint');
    const a = this.game.aimRay();
    this.game.fx.beam(this.game.viewModel.muzzleWorld(), { x: a.origin.x + a.dir.x * 3, y: a.origin.y + a.dir.y * 3, z: a.origin.z + a.dir.z * 3 }, color ?? 0xffffff, 0.03, 0.12);
  }

  override primaryDown(): void { this.paint(this.color); }
  override secondaryDown(): void {
    this.index = (this.index + 1) % PAINT_COLORS.length;
    this.game.audio.play('click', 0.5);
  }
  override reload(): void { this.paint(null); }
  override wheel(d: number): boolean {
    this.index = (this.index + (d > 0 ? 1 : PAINT_COLORS.length - 1)) % PAINT_COLORS.length;
    return true;
  }

  hud(): ToolHud {
    return {
      energy: null,
      swatch: this.color,
      hints: [['LMB', this.t('tool.paint')], ['RMB/Wheel', this.t('tool.nextColor')], ['R', this.t('tool.clearPaint')]],
    };
  }
}
