import type { Loc } from '../../data/materials';
import type { V3 } from '../../utils/math';
import type { DamageSource, Entity } from '../entities/Entity';

/** One primitive of a model made from data. Positions are relative to the object's centre. */
export interface ModelPart {
  shape: 'box' | 'rbox' | 'sphere' | 'cylinder' | 'cone' | 'torus';
  /** box and rbox: [x, y, z]. */
  size?: [number, number, number];
  /** sphere, cylinder, cone and torus radius. */
  r?: number;
  /** cylinder and cone height. */
  h?: number;
  /** cylinder top radius, when it differs from r. */
  r_top?: number;
  /** torus tube radius. */
  tube?: number;
  pos?: [number, number, number];
  rot?: [number, number, number];
  color?: number;
  /** Named library material. Takes priority over color. */
  material?: string;
  /** An image as a data URL, from the mod's assets. */
  texture?: string;
  /** NPC models only: which joint this part follows. */
  attach?: 'root' | 'torso' | 'head' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r';
}

export interface VehicleSpec {
  /** Wheel mounts, relative to the chassis centre. The nose points to -Z, and wheels with negative z steer. */
  wheels: [number, number, number][];
  wheelRadius: number;
  /** Suspension rest length. */
  rest: number;
  /** Force per driven wheel. */
  engine: number;
  /** Above this speed in m/s the engine stops pushing. */
  topSpeed: number;
  /** Maximum steering angle in radians at low speed. */
  steer: number;
  /** Tyre friction slip. */
  grip: number;
  stiffness: number;
  density: number;
  wheelColor?: number;
}

export const BUGGY_SPEC: VehicleSpec = {
  wheels: [[-0.74, -0.12, -0.92], [0.74, -0.12, -0.92], [-0.74, -0.12, 0.92], [0.74, -0.12, 0.92]],
  wheelRadius: 0.36, rest: 0.38, engine: 1050, topSpeed: 26, steer: 0.62, grip: 2.6, stiffness: 26, density: 150,
};

/** Callbacks attached to an item definition. Scripted mods build these out of guarded calls into their interpreter. */
export interface ScriptHooks {
  spawn?(e: Entity): void;
  tick?(e: Entity, dt: number): void;
  /** Seconds between tick calls. */
  tickRate?: number;
  damage?(e: Entity, amount: number, src: DamageSource): void;
  interact?(e: Entity): boolean;
  hint?: Loc | string;
  brk?(e: Entity): void;
  remove?(e: Entity): void;
  signal?(e: Entity, on: boolean): void;
}

export type NpcBehaviorName = 'wander' | 'stand' | 'patrol' | 'follow' | 'guard' | 'tinker';

/** Callbacks for an NPC type. */
export interface NpcHooks {
  spawn?(e: Entity): void;
  /** Runs a few times a second. */
  think?(e: Entity, dt: number): void;
  damage?(e: Entity, amount: number, src: DamageSource): void;
  interact?(e: Entity): boolean;
  hint?: Loc | string;
  death?(e: Entity, byPlayer: boolean): void;
  attack?(e: Entity, target: { x: number; y: number; z: number }, targetEntity: Entity | null): void;
}

export interface NpcModelSpec {
  base: 'technician' | 'guard' | 'robot' | 'heavy' | 'creature' | 'humanoid';
  /** Uniform size multiplier. */
  scale?: number;
  color?: number;
  accent?: number;
  parts?: ModelPart[];
}

export type NpcOrder =
  | { kind: 'none' }
  | { kind: 'go_to'; point: V3 }
  | { kind: 'follow'; target: 'player' | number; distance: number }
  | { kind: 'guard'; point: V3; radius: number }
  | { kind: 'patrol'; route: V3[]; loop: boolean; index: number }
  | { kind: 'use'; target: number }
  | { kind: 'tinker'; radius: number; target: number | null };
