import * as THREE from 'three';
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import type { ItemDef } from '../../data/items';
import type { Registered } from './EntityRegistry';

export interface Component {
  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
  onDamage?(amount: number, source: DamageSource): void;
  /** Return true when the interaction was consumed. */
  onInteract?(): boolean;
  interactHint?(): string | null;
  onRemove?(): void;
  /** Extra persistent state, plain JSON only. */
  save?(): Record<string, unknown> | undefined;
  load?(data: Record<string, unknown>): void;
  /** Called when the body was rebuilt, e.g. after scaling. */
  onBodyRebuilt?(): void;
  /** Called after the entity was deliberately repositioned by a tool. */
  onMoved?(): void;
  /** Called once when health reaches zero, before removal. */
  onBreak?(): void;
  /** Signal input level; called only when wired. */
  setSignal?(on: boolean): void;
  signalOut?(): boolean;
}

export interface DamageSource {
  kind: 'player' | 'npc' | 'impact' | 'explosion' | 'other';
  entity?: Entity | null;
  point?: { x: number; y: number; z: number };
}

/** A secondary rigid body owned by this entity, such as a motor's rotor. */
export interface ExtraPart {
  body: RigidBody;
  object: THREE.Object3D;
  colliders: Collider[];
}

export class Entity implements Registered {
  body: RigidBody | null = null;
  colliders: Collider[] = [];
  extra: ExtraPart[] = [];
  components: Component[] = [];
  scale = 1;
  materialId: string;
  tint: number | null = null;
  health: number;
  maxHealth: number;
  anchored = false;
  fixture = false;
  /** Can be pushed around by physics but not edited: challenge payloads. */
  locked = false;
  /** Tag set by the frozen, held or disintegrating state: prevents conflicting tools from grabbing it. */
  frozen = false;
  held = false;
  dead = false;
  /** Multiplier from low-gravity zones, gravity tool, etc. */
  gravityScale = 1;
  /** Set by per-instance overrides such as map fixtures. */
  params: Record<string, number | string | boolean> = {};
  /** Set on entities the player placed in a budgeted challenge. */
  playerPlaced = false;
  /** Values a mod stored on this entity with entity.set_data. Plain data only: it goes into saves. */
  scriptData: Record<string, unknown> | null = null;
  // Interpolation state
  px = 0; py = 0; pz = 0; qx = 0; qy = 0; qz = 0; qw = 1;
  cx = 0; cy = 0; cz = 0; rx = 0; ry = 0; rz = 0; rw = 1;
  // Velocity before the last solver step, used to measure impacts.
  vx = 0; vy = 0; vz = 0;
  lastImpactSound = 0;

  constructor(
    readonly id: number,
    readonly def: ItemDef,
    readonly root: THREE.Object3D,
  ) {
    this.materialId = def.material;
    this.health = def.health ?? (def.breakSpeed ? 50 : 100);
    this.maxHealth = this.health;
  }

  get kind(): string {
    return this.def.kind;
  }

  get position(): { x: number; y: number; z: number } {
    return this.body ? this.body.translation() : { x: this.root.position.x, y: this.root.position.y, z: this.root.position.z };
  }

  get rotation(): { x: number; y: number; z: number; w: number } {
    return this.body ? this.body.rotation() : { x: this.root.quaternion.x, y: this.root.quaternion.y, z: this.root.quaternion.z, w: this.root.quaternion.w };
  }

  component<T extends Component>(ctor: new (...args: never[]) => T): T | undefined {
    for (const c of this.components) if (c instanceof ctor) return c;
    return undefined;
  }

  get isDynamic(): boolean {
    return !!this.body && this.body.isDynamic();
  }

  get mass(): number {
    return this.body ? this.body.mass() : 0;
  }
}
