import * as THREE from 'three';
import type { ImpulseJoint } from '@dimforge/rapier3d-compat';
import type { Q4, V3 } from '../../utils/math';
import { rotate, sub } from '../../utils/math';
import type { Entity } from '../entities/Entity';
import type { Game } from '../core/Game';
import { RAPIER } from '../physics/PhysicsWorld';

export type LinkType = 'weld' | 'hinge' | 'spring' | 'rope';
export const LINK_TYPES: LinkType[] = ['weld', 'hinge', 'spring', 'rope'];

export type LinkError = 'self' | 'missing' | 'duplicate' | 'bothStatic' | 'limit' | 'badType';

export interface SavedLink {
  id: number;
  type: LinkType;
  a: number;
  /** 0 attaches to the world. */
  b: number;
  /** Which body of the entity: 0 is the main body, 1 and up are extra parts such as rotors. */
  partA?: number;
  partB?: number;
  anchorA: V3;
  anchorB: V3;
  axis?: V3;
  /** Rest length of springs and ropes. */
  length?: number;
  /** Relative rotation of weld frames. */
  frameA?: Q4;
  frameB?: Q4;
}

export const MAX_LINKS = 300;

export interface LinkEnd { id: number; dynamic: boolean }

/** Pure rules for what may be linked. */
export function validateLink(type: string, a: LinkEnd | null, b: LinkEnd | null, world: boolean, existing: readonly { a: number; b: number; type: string }[], max = MAX_LINKS): LinkError | null {
  if (!['weld', 'hinge', 'spring', 'rope'].includes(type)) return 'badType';
  if (!a) return 'missing';
  if (!b && !world) return 'missing';
  if (b && a.id === b.id) return 'self';
  const bId = b?.id ?? 0;
  if (existing.length >= max) return 'limit';
  if (!a.dynamic && !(b && b.dynamic)) return 'bothStatic';
  if (existing.some((l) => l.type === type && ((l.a === a.id && l.b === bId) || (l.a === bId && l.b === a.id)))) return 'duplicate';
  return null;
}

interface LiveLink extends SavedLink {
  joint: ImpulseJoint | null;
  line: THREE.Line | null;
}

const LINE_MAT: Record<string, THREE.LineBasicMaterial> = {};
function lineMat(type: LinkType) {
  return (LINE_MAT[type] ??= new THREE.LineBasicMaterial({ color: type === 'spring' ? 0x19e0c4 : type === 'rope' ? 0xd8c090 : 0xffb000 }));
}

/** Owns every joint created by players. Joints die with their bodies, and records follow. */
export class ConnectionManager {
  private links = new Map<number, LiveLink>();
  private nextId = 1;
  readonly group = new THREE.Group();
  showWelds = false;

  constructor(private game: Game) {}

  list(): SavedLink[] {
    return [...this.links.values()].map(({ joint: _j, line: _l, ...rest }) => rest);
  }

  ofEntity(id: number): SavedLink[] {
    return this.list().filter((l) => l.a === id || l.b === id);
  }

  get count(): number {
    return this.links.size;
  }

  private bodyOf(e: Entity | undefined, part: number | undefined) {
    if (!e) return this.game.physics.ground;
    if (part && e.extra[part - 1]) return e.extra[part - 1]!.body;
    return e.body;
  }

  /** Creates a link between world-space points. Returns an error key on failure. */
  connect(type: LinkType, a: Entity, b: Entity | null, worldA: V3, worldB: V3, axisWorld: V3 | null, partA = 0, partB = 0, id?: number): { ok: true; link: SavedLink } | { ok: false; error: LinkError } {
    const err = validateLink(type, { id: a.id, dynamic: a.isDynamic || partA > 0 }, b ? { id: b.id, dynamic: b.isDynamic || partB > 0 } : null, !b, this.list());
    if (err) return { ok: false, error: err };
    const bodyA = this.bodyOf(a, partA)!;
    const bodyB = this.bodyOf(b ?? undefined, partB)!;
    const ta = bodyA.translation();
    const ra = bodyA.rotation();
    const tb = bodyB.translation();
    const rb = bodyB.rotation();
    const local = (p: V3, t: V3, r: Q4) => rotate(sub(p, t), { x: -r.x, y: -r.y, z: -r.z, w: r.w });
    const link: SavedLink = {
      id: id ?? this.nextId++,
      type,
      a: a.id,
      b: b?.id ?? 0,
      partA: partA || undefined,
      partB: partB || undefined,
      anchorA: local(worldA, ta, ra),
      anchorB: local(worldB, tb, rb),
    };
    if (type === 'hinge') {
      const axis = axisWorld ?? { x: 0, y: 1, z: 0 };
      link.axis = rotate(axis, { x: -ra.x, y: -ra.y, z: -ra.z, w: ra.w });
    }
    if (type === 'weld') {
      link.frameA = { x: ra.x, y: ra.y, z: ra.z, w: ra.w };
      link.frameB = { x: rb.x, y: rb.y, z: rb.z, w: rb.w };
    }
    if (type === 'spring' || type === 'rope') {
      link.length = Math.max(0.1, Math.hypot(worldA.x - worldB.x, worldA.y - worldB.y, worldA.z - worldB.z));
    }
    return this.restore(link) ? { ok: true, link } : { ok: false, error: 'missing' };
  }

  /** Recreates a joint from saved data. Used by undo and scene loading. */
  restore(l: SavedLink): boolean {
    const a = this.game.entities.get(l.a);
    const b = l.b ? this.game.entities.get(l.b) : undefined;
    if (!a || (l.b && !b)) return false;
    const bodyA = this.bodyOf(a, l.partA);
    const bodyB = this.bodyOf(b, l.partB);
    if (!bodyA || !bodyB) return false;
    let data: RAPIER.JointData;
    switch (l.type) {
      case 'weld':
        // Each frame is the inverse of its body's rotation at link time, which preserves the relative pose.
        data = RAPIER.JointData.fixed(l.anchorA, l.frameA ? inv(l.frameA) : ID, l.anchorB, l.frameB ? inv(l.frameB) : ID);
        break;
      case 'hinge': {
        const axisA = l.axis ?? { x: 0, y: 1, z: 0 };
        const ra = bodyA.rotation();
        const rb = bodyB.rotation();
        const world = rotate(axisA, ra);
        const axisB = rotate(world, { x: -rb.x, y: -rb.y, z: -rb.z, w: rb.w });
        data = RAPIER.JointData.revoluteWithAxes(l.anchorA, l.anchorB, axisA, axisB);
        break;
      }
      case 'spring':
        data = RAPIER.JointData.spring(l.length ?? 1, Math.max(150, 1600 * Math.min(1, bodyA.mass() / 100 + 0.2)), 40, l.anchorA, l.anchorB);
        break;
      case 'rope':
        data = RAPIER.JointData.rope(l.length ?? 1, l.anchorA, l.anchorB);
        break;
      default:
        return false;
    }
    const joint = this.game.physics.w.createImpulseJoint(data, bodyA, bodyB, true);
    if (l.type === 'weld') joint.setContactsEnabled(false);
    let line: THREE.Line | null = null;
    if (l.type === 'spring' || l.type === 'rope') {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      line = new THREE.Line(g, lineMat(l.type));
      line.frustumCulled = false;
      this.group.add(line);
    }
    this.links.set(l.id, { ...l, joint, line });
    this.nextId = Math.max(this.nextId, l.id + 1);
    return true;
  }

  remove(id: number): SavedLink | null {
    const l = this.links.get(id);
    if (!l) return null;
    if (l.joint && this.game.physics.world && l.joint.isValid()) this.game.physics.w.removeImpulseJoint(l.joint, true);
    this.dropVisual(l);
    this.links.delete(id);
    const { joint: _j, line: _l, ...rest } = l;
    return rest;
  }

  private dropVisual(l: LiveLink): void {
    if (l.line) {
      l.line.geometry.dispose();
      l.line.removeFromParent();
      l.line = null;
    }
  }

  /** Rapier removes joints with their bodies. Call before a body is removed to keep records in step. */
  onEntityRemoved(e: Entity): void {
    for (const l of this.links.values()) {
      if (l.a === e.id || l.b === e.id) {
        if (l.joint && this.game.physics.world && l.joint.isValid()) this.game.physics.w.removeImpulseJoint(l.joint, true);
        this.dropVisual(l);
        this.links.delete(l.id);
      }
    }
  }

  update(): void {
    for (const l of this.links.values()) {
      if (!l.line) continue;
      const attr = l.line.geometry.attributes.position as THREE.BufferAttribute;
      const a = this.game.entities.get(l.a);
      const b = l.b ? this.game.entities.get(l.b) : undefined;
      if (!a) continue;
      const pa = this.worldPoint(this.bodyOf(a, l.partA), l.anchorA);
      const pb = this.worldPoint(this.bodyOf(b, l.partB), l.anchorB);
      attr.setXYZ(0, pa.x, pa.y, pa.z);
      attr.setXYZ(1, pb.x, pb.y, pb.z);
      attr.needsUpdate = true;
    }
  }

  private worldPoint(body: { translation(): V3; rotation(): Q4 } | null, local: V3): V3 {
    if (!body) return local;
    const t = body.translation();
    const r = rotate(local, body.rotation());
    return { x: t.x + r.x, y: t.y + r.y, z: t.z + r.z };
  }

  clear(): void {
    for (const l of this.links.values()) this.dropVisual(l);
    this.links.clear();
    this.nextId = 1;
  }
}

const ID: Q4 = { x: 0, y: 0, z: 0, w: 1 };
const inv = (q: Q4): Q4 => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
