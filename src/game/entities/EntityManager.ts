import * as THREE from 'three';
import { catalog, type ItemDef } from '../../data/items';
import { materials } from '../../data/materials';
import { buildVisual } from '../../rendering/props';
import { clearOverlay } from '../../rendering/effects';
import { solidMat } from '../../rendering/materialLibrary';
import type { Q4, V3 } from '../../utils/math';
import type { Game } from '../core/Game';
import { ALL, applyMaterial, colliderDesc, Group, groups, RAPIER } from '../physics/PhysicsWorld';
import { Entity } from './Entity';
import { EntityRegistry, type LimitReason } from './EntityRegistry';
import { attachBehaviors } from './behaviors';

export interface SpawnOptions {
  position: V3;
  rotation?: Q4;
  scale?: number;
  id?: number;
  material?: string;
  tint?: number | null;
  linvel?: V3;
  angvel?: V3;
  health?: number;
  anchored?: boolean;
  fixture?: boolean;
  state?: Record<string, unknown>;
  params?: Record<string, number | string | boolean>;
}

export type SpawnResult = { ok: true; entity: Entity } | { ok: false; reason: LimitReason | 'unknown' | 'budget' };

export const SCALE_MIN = 0.25;
export const SCALE_MAX = 3;

function memberOf(def: ItemDef): number {
  if (def.kind === 'npc') return Group.NPC;
  if (def.kind === 'vehicle') return Group.VEHICLE;
  return Group.PROP;
}

function filterOf(def: ItemDef): number {
  const f = ALL & ~Group.SENSOR;
  return def.kind === 'npc' ? f & ~Group.DEBRIS : f;
}

/** Sole owner of entities: spawning and removal is where bodies, colliders and visuals are paired up. */
export class EntityManager {
  readonly registry = new EntityRegistry<Entity>();
  readonly group = new THREE.Group();
  /** Iterating this array is faster than walking the registry during fixed updates. */
  active: Entity[] = [];
  private removeListeners = new Set<(e: Entity) => void>();

  constructor(private game: Game) {}

  attach(scene: THREE.Scene): void {
    scene.add(this.group);
  }

  onRemove(fn: (e: Entity) => void): () => void {
    this.removeListeners.add(fn);
    return () => this.removeListeners.delete(fn);
  }

  get(id: number): Entity | undefined {
    return this.registry.get(id);
  }

  checkLimit(def: ItemDef): LimitReason | null {
    return this.registry.check(def.kind);
  }

  spawn(defId: string, opts: SpawnOptions): SpawnResult {
    const def = catalog.get(defId);
    if (!def || def.kind === 'tool' || def.kind === 'effect') return { ok: false, reason: 'unknown' };
    if (!opts.fixture) {
      const limit = this.checkLimit(def);
      if (limit) return { ok: false, reason: limit };
    }
    const id = this.registry.allocId(opts.id);
    const root = new THREE.Group();
    root.name = `entity:${defId}:${id}`;
    const e = new Entity(id, def, root);
    e.fixture = !!opts.fixture;
    e.scale = opts.scale ?? 1;
    e.anchored = !!opts.anchored;
    if (opts.material && materials.has(opts.material)) e.materialId = opts.material;
    if (opts.params) e.params = opts.params;
    if (opts.health !== undefined) e.health = Math.min(opts.health, e.maxHealth);
    if (def.kind !== 'npc') {
      root.add(buildVisual(def));
      if (opts.tint !== undefined && opts.tint !== null) this.applyTint(e, opts.tint);
    }
    root.scale.setScalar(e.scale);
    const rot = opts.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
    root.position.set(opts.position.x, opts.position.y, opts.position.z);
    root.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    this.createBody(e, opts.position, rot);
    if (e.body && e.isDynamic) {
      if (opts.linvel) e.body.setLinvel(opts.linvel, true);
      if (opts.angvel) e.body.setAngvel(opts.angvel, true);
    }
    this.snapInterpolation(e);
    this.group.add(root);
    this.registry.add(e);
    this.active.push(e);
    attachBehaviors(e, this.game);
    if (opts.state) {
      for (const c of e.components) c.load?.(opts.state);
    }
    this.game.events.emit('entitySpawned', e);
    return { ok: true, entity: e };
  }

  private bodyDesc(e: Entity, pos: V3, rot: Q4): RAPIER.RigidBodyDesc {
    const type = e.def.body;
    let desc: RAPIER.RigidBodyDesc;
    if (type === 'kinematic') desc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    else if (type === 'fixed' || e.anchored) desc = RAPIER.RigidBodyDesc.fixed();
    else desc = RAPIER.RigidBodyDesc.dynamic();
    const m = materials.get(e.materialId);
    desc.setTranslation(pos.x, pos.y, pos.z).setRotation(rot).setLinearDamping(m.linearDamping ?? 0.02).setAngularDamping(m.angularDamping ?? 0.05);
    return desc;
  }

  private createBody(e: Entity, pos: V3, rot: Q4): void {
    const w = this.game.physics.w;
    const body = w.createRigidBody(this.bodyDesc(e, pos, rot));
    e.body = body;
    this.createCollider(e);
    if (body.isDynamic() && e.def.kind === 'prop' && e.def.shape.type === 'sphere') body.enableCcd(true);
  }

  private createCollider(e: Entity): void {
    const w = this.game.physics.w;
    const m = materials.get(e.materialId);
    const desc = colliderDesc(e.def.shape, e.scale);
    applyMaterial(desc, m);
    const member = memberOf(e.def);
    desc.setCollisionGroups(groups(member, filterOf(e.def)));
    desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    const c = w.createCollider(desc, e.body!);
    // Resting load is far below this (m*g), so events mostly report real impacts.
    c.setContactForceEventThreshold(c.mass() * 80 + 40);
    e.colliders = [c];
    this.game.physics.setOwner(c, e);
  }

  remove(e: Entity): void {
    if (!this.registry.get(e.id)) return;
    for (const l of this.removeListeners) l(e);
    for (const c of e.components) c.onRemove?.();
    this.registry.remove(e.id);
    const i = this.active.indexOf(e);
    if (i >= 0) this.active.splice(i, 1);
    const phys = this.game.physics;
    if (phys.world) {
      for (const c of e.colliders) phys.clearOwner(c);
      for (const part of e.extra) {
        for (const c of part.colliders) phys.clearOwner(c);
        phys.w.removeRigidBody(part.body);
        part.object.removeFromParent();
      }
      if (e.body) phys.w.removeRigidBody(e.body);
    }
    e.body = null;
    e.colliders = [];
    e.extra = [];
    e.root.removeFromParent();
    e.dead = true;
    this.game.events.emit('entityRemoved', e);
  }

  /** Removes every entity. Only for world teardown, where listeners should not record undo steps. */
  clear(): void {
    for (const e of [...this.active]) this.remove(e);
    this.registry.clear();
    this.active = [];
  }

  setScale(e: Entity, scale: number): void {
    if (!e.body || !this.game.physics.world) return;
    const next = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale));
    if (next === e.scale) return;
    e.scale = next;
    for (const c of e.colliders) {
      this.game.physics.clearOwner(c);
      this.game.physics.w.removeCollider(c, true);
    }
    this.createCollider(e);
    e.root.scale.setScalar(next);
    e.body.wakeUp();
    for (const c of e.components) c.onBodyRebuilt?.();
  }

  setTransform(e: Entity, pos: V3, rot: Q4): void {
    if (!e.body) return;
    e.body.setTranslation(pos, true);
    e.body.setRotation(rot, true);
    if (e.body.isDynamic()) {
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.snapInterpolation(e);
    for (const c of e.components) c.onMoved?.();
  }

  setAnchored(e: Entity, anchored: boolean): void {
    if (!e.body || e.def.body !== 'dynamic' || e.anchored === anchored) return;
    e.anchored = anchored;
    if (e.frozen) return; // The freeze restore path decides the body type.
    e.body.setBodyType(anchored ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
  }

  setMaterial(e: Entity, id: string): void {
    if (!materials.has(id) || !e.body) return;
    e.materialId = id;
    const m = materials.get(id);
    for (const c of e.colliders) applyMaterial(c, m);
    e.body.setLinearDamping(m.linearDamping ?? 0.02);
    e.body.setAngularDamping(m.angularDamping ?? 0.05);
    e.body.wakeUp();
  }

  setTint(e: Entity, color: number | null): void {
    this.applyTint(e, color);
  }

  private applyTint(e: Entity, color: number | null): void {
    e.tint = color;
    e.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.overlay) return;
      if (!o.userData.baseMaterial) o.userData.baseMaterial = o.material;
      if (color === null) {
        o.material = o.userData.baseMaterial;
      } else {
        const base = o.userData.baseMaterial as THREE.MeshStandardMaterial;
        // Glowing and glass parts keep their look; only opaque surfaces take paint.
        if (base.isMeshStandardMaterial && !base.transparent) o.material = solidMat(color, base.roughness, Math.min(0.5, base.metalness));
      }
    });
  }

  clearOverlays(e: Entity, tag: string): void {
    clearOverlay(e.root, tag);
  }

  snapInterpolation(e: Entity): void {
    const p = e.position;
    const r = e.rotation;
    e.px = e.cx = p.x; e.py = e.cy = p.y; e.pz = e.cz = p.z;
    e.qx = e.rx = r.x; e.qy = e.ry = r.y; e.qz = e.rz = r.z; e.qw = e.rw = r.w;
    e.root.position.set(p.x, p.y, p.z);
    e.root.quaternion.set(r.x, r.y, r.z, r.w);
  }

  /** Copies body state into interpolation slots. Sleeping and fixed bodies are skipped cheaply. */
  capture(): void {
    for (const e of this.active) {
      const b = e.body;
      if (!b) continue;
      if (b.isFixed()) continue;
      if (b.isSleeping()) {
        e.px = e.cx; e.py = e.cy; e.pz = e.cz;
        e.qx = e.rx; e.qy = e.ry; e.qz = e.rz; e.qw = e.rw;
        continue;
      }
      const p = b.translation();
      const r = b.rotation();
      e.px = e.cx; e.py = e.cy; e.pz = e.cz;
      e.qx = e.rx; e.qy = e.ry; e.qz = e.rz; e.qw = e.rw;
      e.cx = p.x; e.cy = p.y; e.cz = p.z;
      e.rx = r.x; e.ry = r.y; e.rz = r.z; e.rw = r.w;
    }
  }

  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();

  /** Interpolated transforms for rendering. */
  sync(alpha: number): void {
    for (const e of this.active) {
      const b = e.body;
      if (!b || b.isFixed()) continue;
      e.root.position.set(e.px + (e.cx - e.px) * alpha, e.py + (e.cy - e.py) * alpha, e.pz + (e.cz - e.pz) * alpha);
      this.qa.set(e.qx, e.qy, e.qz, e.qw);
      this.qb.set(e.rx, e.ry, e.rz, e.rw);
      e.root.quaternion.copy(this.qa).slerp(this.qb, alpha);
      for (const part of e.extra) {
        const p = part.body.translation();
        const r = part.body.rotation();
        part.object.position.set(p.x, p.y, p.z);
        part.object.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
    // Rotors hang off fixed hubs too.
    for (const e of this.active) {
      if (!e.extra.length || !e.body?.isFixed()) continue;
      for (const part of e.extra) {
        const p = part.body.translation();
        const r = part.body.rotation();
        part.object.position.set(p.x, p.y, p.z);
        part.object.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
  }

  /** Called on anchored entities after loading so visuals reflect their final poses. */
  syncAll(): void {
    for (const e of this.active) this.snapInterpolation(e);
  }
}
