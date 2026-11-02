import * as THREE from 'three';
import { geo, StaticBatcher, wedgeGeometry, wedgePoints, worldBox } from '../../rendering/geometry';
import { mat, signMat } from '../../rendering/materialLibrary';
import type { SkyColors } from '../../rendering/GameRenderer';
import type { Loc } from '../../data/materials';
import type { Q4, V3 } from '../../utils/math';
import { Group, groups, RAPIER, type PhysicsWorld } from '../physics/PhysicsWorld';
import type { SpawnOptions } from '../entities/EntityManager';
import type { NavBounds } from '../npcs/NavGrid';

export interface Zone {
  type: 'lowg' | 'pad';
  min: V3;
  max: V3;
  gravity?: number;
  speed?: number;
}

export interface LightSpec { x: number; y: number; z: number; color: number; intensity: number; range: number }

export interface MapDef {
  id: string;
  name: Loc;
  desc: Loc;
  sky: SkyColors;
  fog: { color: number; density: number };
  ambience: 'indoor' | 'outdoor' | 'sky';
  sun: { dir: V3; color: number; intensity: number };
  hemi: { sky: number; ground: number; intensity: number };
  envPanels: number;
  killY: number;
  nav: NavBounds | null;
  build(b: MapBuilder): void;
}

export interface PlacedProp { id: string; opts: SpawnOptions; name?: string }

export interface BoxOpts {
  tile?: number;
  collide?: boolean;
  cast?: boolean;
  surface?: string;
  tag?: string;
  yaw?: number;
}

/** Declarative level building: visuals go to a batcher, collision to one static body. */
export class MapBuilder {
  readonly batcher = new StaticBatcher();
  readonly props: PlacedProp[] = [];
  readonly patrols: V3[][] = [];
  readonly zones: Zone[] = [];
  readonly lights: LightSpec[] = [];
  spawn: V3 = { x: 0, y: 0, z: 0 };
  spawnYaw = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);

  constructor(private physics: PhysicsWorld) {}

  private matrix(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    return this.m.compose(this.v.set(x, y, z), this.q, this.s);
  }

  private collider(desc: RAPIER.ColliderDesc, x: number, y: number, z: number, rot: Q4 | null, o: BoxOpts): void {
    desc.setTranslation(x, y, z);
    if (rot) desc.setRotation(rot);
    desc.setFriction(0.7);
    desc.setCollisionGroups(groups(Group.STATIC, 0xffff));
    if (o.tag === 'bounce') desc.setRestitution(1.05).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    const c = this.physics.w.createCollider(desc, this.physics.ground);
    this.physics.setOwner(c, { tag: o.tag, surface: o.surface ?? 'metal' });
  }

  /** Axis-aligned (or yawed) solid box centred on x,y,z. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, material: string, o: BoxOpts = {}): void {
    const g = worldBox(w, h, d, o.tile ?? 2);
    this.batcher.add(g, this.matrix(x, y, z, 0, o.yaw ?? 0), mat(material), o.cast !== false);
    g.dispose();
    if (o.collide !== false) {
      this.q.setFromEuler(this.e.set(0, o.yaw ?? 0, 0));
      this.collider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), x, y, z, { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, o);
    }
  }

  /** Floor slab whose top surface is at `top`. */
  floor(x0: number, x1: number, z0: number, z1: number, top: number, thick: number, material: string, o: BoxOpts = {}): void {
    this.box((x0 + x1) / 2, top - thick / 2, (z0 + z1) / 2, x1 - x0, thick, z1 - z0, material, o);
  }

  /** Wedge with its tall end facing local +Z, then yawed. */
  ramp(x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, material: string): void {
    const g = wedgeGeometry(w, h, d);
    this.batcher.add(g, this.matrix(x, y, z, 0, yaw), mat(material));
    g.dispose();
    const desc = RAPIER.ColliderDesc.convexHull(Float32Array.from(wedgePoints([w, h, d])));
    this.q.setFromEuler(this.e.set(0, yaw, 0));
    if (desc) this.collider(desc, x, y, z, { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, {});
  }

  /**
   * Steps climbing along Z from z0, spanning x0..x1. Collision is a smooth hidden ramp rather than the
   * steps themselves: a capsule can wedge in the notch between two box steps.
   */
  stairs(x0: number, x1: number, z0: number, baseY: number, steps: number, rise: number, run: number, material: string, dir: 1 | -1 = 1): void {
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      this.box((x0 + x1) / 2, baseY + h / 2, z0 + dir * (i + 0.5) * run, x1 - x0, h, run, material, { tile: 1, collide: false });
    }
    const w = x1 - x0;
    const height = rise * steps;
    const depth = run * steps;
    const desc = RAPIER.ColliderDesc.convexHull(Float32Array.from(wedgePoints([w, height, depth])));
    // A wedge's tall end faces local +Z, so a stair climbing toward -Z needs a half turn.
    this.q.setFromEuler(this.e.set(0, dir === 1 ? 0 : Math.PI, 0));
    if (desc) this.collider(desc, (x0 + x1) / 2, baseY + height / 2, z0 + (dir * depth) / 2, { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, { surface: 'concrete' });
  }

  /** Visual-only cylinder along an axis: pipes, conduits. */
  pipe(x: number, y: number, z: number, length: number, axis: 'x' | 'y' | 'z', r: number, material: string): void {
    const rx = axis === 'z' ? Math.PI / 2 : 0;
    const rz = axis === 'x' ? Math.PI / 2 : 0;
    this.batcher.add(geo.cyl(r, r, length, 10), this.matrix(x, y, z, rx, 0, rz), mat(material));
  }

  /** Solid round column. */
  column(x: number, z: number, baseY: number, h: number, r: number, material: string): void {
    this.batcher.add(geo.cyl(r, r, h, 16), this.matrix(x, baseY + h / 2, z), mat(material));
    this.collider(RAPIER.ColliderDesc.cylinder(h / 2, r), x, baseY + h / 2, z, null, {});
  }

  sign(x: number, y: number, z: number, w: number, h: number, yaw: number, key: string, lines: string[], bg: string, fg: string, accent?: string): void {
    this.batcher.add(geo.plane(w, h), this.matrix(x, y, z, 0, yaw), signMat(key, lines, bg, fg, accent), false);
  }

  /** Ceiling light: emissive panel with a real point light when the budget allows. */
  light(x: number, y: number, z: number, opts: { w?: number; d?: number; glow?: string; color?: number; intensity?: number; range?: number } = {}): void {
    this.box(x, y, z, opts.w ?? 3, 0.1, opts.d ?? 0.8, opts.glow ?? 'glow_white', { collide: false, cast: false, tile: 8 });
    this.box(x, y + 0.13, z, (opts.w ?? 3) + 0.25, 0.18, (opts.d ?? 0.8) + 0.25, 'steel_dark', { collide: false, cast: false });
    this.lights.push({ x, y: y - 0.4, z, color: opts.color ?? 0xfff0d8, intensity: opts.intensity ?? 60, range: opts.range ?? 26 });
  }

  prop(id: string, x: number, y: number, z: number, o: Partial<SpawnOptions> & { yaw?: number; name?: string } = {}): void {
    const { yaw, name, ...rest } = o;
    const rotation = rest.rotation ?? (yaw ? { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } : undefined);
    this.props.push({ id, name, opts: { position: { x, y, z }, ...rest, rotation } });
  }

  readonly wires: [string, string][] = [];

  /** Wires two named fixture props together. */
  wire(from: string, to: string): void {
    this.wires.push([from, to]);
  }
}

export interface LoadedMap {
  def: MapDef;
  patrols: V3[][];
  zones: Zone[];
  group: THREE.Group;
  meshes: THREE.Mesh[];
}
