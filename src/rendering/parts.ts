import * as THREE from 'three';
import type { ModelPart } from '../game/content/types';
import { geo } from './geometry';
import { mat, solidMat } from './materialLibrary';

/** Library materials a data model may name. */
export const MODEL_MATERIALS = [
  'steel', 'steel_dark', 'blackened', 'rubber', 'wood', 'crate', 'hazard', 'concrete', 'wall_dark', 'wall_light', 'floor_tile', 'ice', 'screen',
  'paint_white', 'paint_amber', 'paint_coral', 'paint_teal', 'glow_amber', 'glow_coral', 'glow_teal', 'glow_violet', 'glow_white',
];

function geometry(p: ModelPart): THREE.BufferGeometry {
  switch (p.shape) {
    case 'box': {
      const [x, y, z] = p.size ?? [1, 1, 1];
      return geo.box(x, y, z);
    }
    case 'rbox': {
      const [x, y, z] = p.size ?? [1, 1, 1];
      return geo.rbox(x, y, z, Math.min(x, y, z) * 0.12);
    }
    case 'sphere':
      return geo.sphere(p.r ?? 0.5, 16);
    case 'cylinder':
      return geo.cyl(p.r_top ?? p.r ?? 0.5, p.r ?? 0.5, p.h ?? 1, 16);
    case 'cone':
      return geo.cyl(0.001, p.r ?? 0.5, p.h ?? 1, 16);
    case 'torus':
      return geo.torus(p.r ?? 0.5, p.tube ?? 0.08, 20);
  }
}

const textured = new Map<string, THREE.Material>();

/** Shared per image. Without a document (tests, the mod CLI) it falls back to a plain colour. */
function textureMat(url: string): THREE.Material {
  if (typeof document === 'undefined') return solidMat(0xc9c5b8, 0.6, 0.1);
  let m = textured.get(url);
  if (!m) {
    const map = new THREE.TextureLoader().load(url);
    map.colorSpace = THREE.SRGBColorSpace;
    textured.set(url, (m = new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0.05 })));
  }
  return m;
}

export function buildPart(p: ModelPart): THREE.Mesh {
  const m = new THREE.Mesh(geometry(p), p.texture ? textureMat(p.texture) : p.material ? mat(p.material) : solidMat(p.color ?? 0xc9c5b8, 0.55, 0.2));
  const [x, y, z] = p.pos ?? [0, 0, 0];
  const [rx, ry, rz] = p.rot ?? [0, 0, 0];
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function addParts(parent: THREE.Object3D, parts: ModelPart[]): void {
  for (const p of parts) parent.add(buildPart(p));
}
