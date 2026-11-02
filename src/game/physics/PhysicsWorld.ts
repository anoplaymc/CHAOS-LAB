import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import type { ShapeDef } from '../../data/items';
import { materials, type PhysMaterial } from '../../data/materials';
import { wedgePoints } from '../../rendering/geometry';
import type { Q4, V3 } from '../../utils/math';
import { FIXED_DT } from '../core/loop';

export { RAPIER };

let initPromise: Promise<void> | null = null;

export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export const Group = {
  STATIC: 1,
  PROP: 2,
  PLAYER: 4,
  NPC: 8,
  DEBRIS: 16,
  PROJECTILE: 32,
  SENSOR: 64,
  VEHICLE: 128,
} as const;
export const ALL = 0xffff;

export function groups(member: number, filter: number): number {
  return (member << 16) | filter;
}

/** Everything solid except short-lived chips of debris. */
export const SOLID = Group.STATIC | Group.PROP | Group.NPC | Group.VEHICLE;

export interface RayHit {
  collider: Collider;
  body: RigidBody | null;
  owner: unknown;
  point: V3;
  normal: V3;
  distance: number;
}

export interface ImpactEvent {
  a: Collider;
  b: Collider;
  force: number;
}

export function colliderDesc(shape: ShapeDef, scale = 1): RAPIER.ColliderDesc {
  switch (shape.type) {
    case 'box':
      return RAPIER.ColliderDesc.cuboid((shape.size[0] / 2) * scale, (shape.size[1] / 2) * scale, (shape.size[2] / 2) * scale);
    case 'sphere':
      return RAPIER.ColliderDesc.ball(shape.r * scale);
    case 'cylinder':
      return RAPIER.ColliderDesc.cylinder((shape.h / 2) * scale, shape.r * scale);
    case 'capsule':
      return RAPIER.ColliderDesc.capsule(Math.max(0.01, shape.h / 2 - shape.r) * scale, shape.r * scale);
    case 'wedge': {
      const pts = Float32Array.from(wedgePoints(shape.size).map((v) => v * scale));
      return RAPIER.ColliderDesc.convexHull(pts) ?? RAPIER.ColliderDesc.cuboid(shape.size[0] * scale / 2, shape.size[1] * scale / 2, shape.size[2] * scale / 2);
    }
    case 'convex': {
      const pts = Float32Array.from(shape.points.map((v) => v * scale));
      return RAPIER.ColliderDesc.convexHull(pts) ?? RAPIER.ColliderDesc.ball(0.3 * scale);
    }
  }
}

export function queryShape(shape: ShapeDef, scale = 1, inset = 0.97): RAPIER.Shape {
  const k = scale * inset;
  switch (shape.type) {
    case 'box':
      return new RAPIER.Cuboid((shape.size[0] / 2) * k, (shape.size[1] / 2) * k, (shape.size[2] / 2) * k);
    case 'sphere':
      return new RAPIER.Ball(shape.r * k);
    case 'cylinder':
      return new RAPIER.Cylinder((shape.h / 2) * k, shape.r * k);
    case 'capsule':
      return new RAPIER.Capsule(Math.max(0.01, shape.h / 2 - shape.r) * k, shape.r * k);
    case 'wedge':
      return new RAPIER.ConvexPolyhedron(Float32Array.from(wedgePoints(shape.size).map((v) => v * k)), null);
    case 'convex':
      return new RAPIER.ConvexPolyhedron(Float32Array.from(shape.points.map((v) => v * k)), null);
  }
}

const RULE: Record<string, RAPIER.CoefficientCombineRule> = {
  min: RAPIER.CoefficientCombineRule.Min,
  max: RAPIER.CoefficientCombineRule.Max,
  average: RAPIER.CoefficientCombineRule.Average,
};

export function applyMaterial(c: Collider | RAPIER.ColliderDesc, m: PhysMaterial): void {
  if (c instanceof RAPIER.ColliderDesc) {
    c.setFriction(m.friction).setRestitution(m.restitution).setDensity(m.density);
    c.setFrictionCombineRule(RULE[m.frictionRule ?? 'average']!);
    c.setRestitutionCombineRule(RULE[m.restitutionRule ?? 'average']!);
  } else {
    c.setFriction(m.friction);
    c.setRestitution(m.restitution);
    c.setDensity(m.density);
    c.setFrictionCombineRule(RULE[m.frictionRule ?? 'average']!);
    c.setRestitutionCombineRule(RULE[m.restitutionRule ?? 'average']!);
  }
}

/** Owns the Rapier world. Destroying and re-creating happens only through `create` and `destroy`. */
export class PhysicsWorld {
  world: RAPIER.World | null = null;
  private queue: RAPIER.EventQueue | null = null;
  private owners = new Map<number, unknown>();
  private impacts: ImpactEvent[] = [];
  private staticRoot: RigidBody | null = null;
  /** Live world count, asserted by tests: a map restart must never leave a second world behind. */
  static liveWorlds = 0;

  create(gravity: V3): void {
    if (this.world) this.destroy();
    this.world = new RAPIER.World(gravity);
    this.world.timestep = FIXED_DT;
    this.world.numSolverIterations = 6;
    this.queue = new RAPIER.EventQueue(true);
    this.staticRoot = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    PhysicsWorld.liveWorlds++;
  }

  destroy(): void {
    if (!this.world) return;
    this.queue?.free();
    this.world.free();
    this.world = null;
    this.queue = null;
    this.staticRoot = null;
    this.owners.clear();
    this.impacts.length = 0;
    PhysicsWorld.liveWorlds--;
  }

  get w(): RAPIER.World {
    if (!this.world) throw new Error('Physics world is not running');
    return this.world;
  }

  get ground(): RigidBody {
    return this.staticRoot!;
  }

  get bodyCount(): number {
    return this.world ? this.world.bodies.len() : 0;
  }

  setOwner(c: Collider, owner: unknown): void {
    this.owners.set(c.handle, owner);
  }
  clearOwner(c: Collider): void {
    this.owners.delete(c.handle);
  }
  ownerOf(c: Collider): unknown {
    return this.owners.get(c.handle);
  }

  setGravity(g: V3): void {
    if (!this.world) return;
    this.world.gravity = g;
    // Sleeping bodies would otherwise ignore the change.
    this.world.bodies.forEach((b) => {
      if (b.isDynamic()) b.wakeUp();
    });
  }

  /** Steps the simulation and returns the collision impacts that happened during it. */
  step(): ImpactEvent[] {
    const w = this.w;
    w.step(this.queue!);
    this.impacts.length = 0;
    this.queue!.drainContactForceEvents((e) => {
      const a = w.getCollider(e.collider1());
      const b = w.getCollider(e.collider2());
      if (a && b) this.impacts.push({ a, b, force: e.maxForceMagnitude() });
    });
    this.queue!.drainCollisionEvents(() => undefined);
    return this.impacts;
  }

  raycast(origin: V3, dir: V3, maxDist: number, opts: { mask?: number; exclude?: RigidBody | null; includeSensors?: boolean; predicate?: (c: Collider) => boolean } = {}): RayHit | null {
    if (!this.world) return null;
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray, maxDist, true,
      opts.includeSensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(ALL, opts.mask ?? SOLID),
      undefined, opts.exclude ?? undefined, opts.predicate,
    );
    if (!hit) return null;
    return {
      collider: hit.collider,
      body: hit.collider.parent(),
      owner: this.owners.get(hit.collider.handle),
      point: { x: origin.x + dir.x * hit.timeOfImpact, y: origin.y + dir.y * hit.timeOfImpact, z: origin.z + dir.z * hit.timeOfImpact },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      distance: hit.timeOfImpact,
    };
  }

  /**
   * Visits colliders that intersect the shape. Results are collected first and visited after the query
   * returns: Rapier holds a borrow during its callback, and changing a body inside it would poison the world.
   */
  overlap(shape: RAPIER.Shape, pos: V3, rot: Q4, mask: number, visit: (c: Collider) => boolean | void, exclude?: (c: Collider) => boolean): void {
    if (!this.world) return;
    const found: Collider[] = [];
    this.world.intersectionsWithShape(pos, rot, shape, (c) => {
      found.push(c);
      return true;
    }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(ALL, mask), undefined, undefined, exclude ? (c) => !exclude(c) : undefined);
    for (const c of found) if (visit(c) === false) break;
  }

  /** True when the shape would overlap something solid. Used to validate placement and teleports. */
  isBlocked(shape: RAPIER.Shape, pos: V3, rot: Q4, mask: number, ignore?: (c: Collider) => boolean): boolean {
    if (!this.world) return false;
    return !!this.world.intersectionWithShape(pos, rot, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(ALL, mask), undefined, undefined, ignore ? (c) => !ignore(c) : undefined);
  }
}

export { materials };
