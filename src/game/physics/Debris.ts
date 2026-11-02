import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { geo } from '../../rendering/geometry';
import { mat } from '../../rendering/materialLibrary';
import { rand, type V3 } from '../../utils/math';
import { Group, groups, RAPIER, type PhysicsWorld } from './PhysicsWorld';

export type DebrisKind = 'wood' | 'glass' | 'metal' | 'stone' | 'ice';

interface Chip {
  mesh: THREE.Mesh;
  body: RigidBody;
  life: number;
  kind: DebrisKind;
}

const STYLE: Record<DebrisKind, { material: string; density: number; friction: number }> = {
  wood: { material: 'crate', density: 40, friction: 0.7 },
  glass: { material: 'glass', density: 90, friction: 0.3 },
  metal: { material: 'steel_dark', density: 300, friction: 0.4 },
  stone: { material: 'concrete', density: 160, friction: 0.9 },
  ice: { material: 'ice', density: 70, friction: 0.05 },
};

/** Short-lived physical chips. Hard budget: when full, the oldest chip goes first. */
export class DebrisSystem {
  private chips: Chip[] = [];
  readonly group = new THREE.Group();
  budget = 110;

  constructor(private physics: PhysicsWorld) {}

  get count(): number {
    return this.chips.length;
  }

  spawn(kind: DebrisKind, center: V3, spread: V3, count: number, blast: V3, speed = 3): void {
    const w = this.physics.world;
    if (!w) return;
    const style = STYLE[kind];
    for (let i = 0; i < count; i++) {
      if (this.chips.length >= this.budget) this.removeChip(0);
      const sx = roundTo(rand(0.1, 0.34));
      const sy = kind === 'glass' ? 0.03 : roundTo(rand(0.06, 0.24));
      const sz = roundTo(rand(0.1, 0.34));
      const pos = {
        x: center.x + rand(-spread.x, spread.x),
        y: center.y + rand(-spread.y, spread.y),
        z: center.z + rand(-spread.z, spread.z),
      };
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)));
      const body = w.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinearDamping(0.1)
          .setAngularDamping(0.25)
          .setLinvel(blast.x + rand(-speed, speed), blast.y + rand(0, speed), blast.z + rand(-speed, speed))
          .setAngvel({ x: rand(-9, 9), y: rand(-9, 9), z: rand(-9, 9) }),
      );
      w.createCollider(
        RAPIER.ColliderDesc.cuboid(sx / 2, Math.max(0.02, sy / 2), sz / 2)
          .setDensity(style.density)
          .setFriction(style.friction)
          .setRestitution(0.1)
          // Chips land on the world and props but never trip the player, NPCs or each other.
          .setCollisionGroups(groups(Group.DEBRIS, Group.STATIC | Group.PROP)),
        body,
      );
      // One shared box: the geometry cache never evicts, so a box per chip size would pile up across restarts.
      const mesh = new THREE.Mesh(geo.box(1, 1, 1), mat(style.material));
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = kind !== 'glass';
      this.group.add(mesh);
      this.chips.push({ mesh, body, life: rand(4, 7), kind });
    }
  }

  private removeChip(i: number): void {
    const chip = this.chips[i]!;
    this.chips.splice(i, 1);
    chip.mesh.removeFromParent();
    if (this.physics.world) this.physics.w.removeRigidBody(chip.body);
  }

  /** Geometry here is drawn from the shared cache, which caps variety by rounding sizes. */
  update(dt: number): void {
    for (let i = this.chips.length - 1; i >= 0; i--) {
      const c = this.chips[i]!;
      c.life -= dt;
      if (c.life <= 0) {
        this.removeChip(i);
        continue;
      }
      const p = c.body.translation();
      const r = c.body.rotation();
      c.mesh.position.set(p.x, p.y, p.z);
      c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (c.life < 0.5) c.mesh.scale.setScalar(Math.max(0.05, c.life * 2));
    }
  }

  clear(): void {
    while (this.chips.length) this.removeChip(this.chips.length - 1);
  }
}

/** Quantised sizes keep the shared geometry cache small no matter how much breaks. */
function roundTo(v: number): number {
  return Math.round(v * 25) / 25;
}
