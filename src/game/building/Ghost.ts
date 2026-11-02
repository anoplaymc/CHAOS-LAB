import * as THREE from 'three';
import type { ItemDef } from '../../data/items';
import { buildVisual, shapeMesh } from '../../rendering/props';
import type { Q4, V3 } from '../../utils/math';

const okMat = new THREE.MeshBasicMaterial({ color: 0x19e0c4, transparent: true, opacity: 0.42, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: 0xff4d3d, transparent: true, opacity: 0.5, depthWrite: false });

/** Translucent placement preview: shows green when the spot is free and red when blocked. */
export class Ghost {
  private root = new THREE.Group();
  private defId: string | null = null;
  private meshes: THREE.Mesh[] = [];
  constructor(parent: THREE.Object3D) {
    parent.add(this.root);
    this.root.visible = false;
  }

  show(def: ItemDef, pos: V3, rot: Q4, scale: number, valid: boolean): void {
    if (this.defId !== def.id) {
      this.root.clear();
      this.meshes = [];
      this.defId = def.id;
      if (def.kind === 'npc') shapeMesh(this.root, def.shape, okMat);
      else this.root.add(buildVisual(def));
      this.root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = false;
          o.receiveShadow = false;
          this.meshes.push(o);
        }
      });
    }
    const m = valid ? okMat : badMat;
    for (const mesh of this.meshes) mesh.material = m;
    this.root.position.set(pos.x, pos.y, pos.z);
    this.root.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    this.root.scale.setScalar(scale);
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }
}
