import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShapeDef } from '../data/items';

const cache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
}

export const geo = {
  box: (w: number, h: number, d: number) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  rbox: (w: number, h: number, d: number, r = 0.03) =>
    cached(`r${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01))),
  cyl: (rt: number, rb: number, h: number, seg = 16, open = false) =>
    cached(`c${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  sphere: (r: number, seg = 20) => cached(`s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7))),
  torus: (r: number, t: number, seg = 18) => cached(`t${r},${t},${seg}`, () => new THREE.TorusGeometry(r, t, 8, seg)),
  wedge: (x: number, y: number, z: number) => cached(`w${x},${y},${z}`, () => wedgeGeometry(x, y, z)),
  plane: (w: number, h: number) => cached(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h)),
};

/** Wedge rising along +Z: tall end at +Z. Centred on its bounding box, same as its convex collider. */
export function wedgeGeometry(x: number, y: number, z: number): THREE.BufferGeometry {
  const [hx, hy, hz] = [x / 2, y / 2, z / 2];
  const v = (a: number, b: number, c: number) => [a * hx, b * hy, c * hz];
  const faces: number[][][] = [
    [v(-1, -1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, -1, -1)], // slope
    [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)], // back
    [v(1, -1, -1), v(1, 1, 1), v(1, -1, 1)], // +x
    [v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1)], // -x
    [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)], // bottom
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  for (const f of faces) {
    const emit = (p: number[], u: number, w: number) => { pos.push(p[0]!, p[1]!, p[2]!); uv.push(u, w); };
    emit(f[0]!, 0, 0); emit(f[1]!, 0, 1); emit(f[2]!, 1, 1);
    if (f.length === 4) { emit(f[0]!, 0, 0); emit(f[2]!, 1, 1); emit(f[3]!, 1, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function wedgePoints(size: [number, number, number]): number[] {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  return [-hx, -hy, -hz, hx, -hy, -hz, -hx, -hy, hz, hx, -hy, hz, -hx, hy, hz, hx, hy, hz];
}

/** Box with UVs scaled so `tile` metres map onto one texture repeat. Not cached: used for batched level geometry. */
export function worldBox(w: number, h: number, d: number, tile = 2): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * faces[f]![0]) / tile, (uv.getY(idx) * faces[f]![1]) / tile);
    }
  }
  return g;
}

/** Collects static geometry by material and merges it to keep draw calls low. */
export class StaticBatcher {
  private buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean }>();

  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, material: THREE.Material, cast = true): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    const key = `${material.uuid}|${cast}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { material, geos: [], cast }));
    b.geos.push(g);
  }

  build(parent: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const b of this.buckets.values()) {
      for (const g of b.geos) {
        for (const name of Object.keys(g.attributes)) {
          if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        }
      }
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

export function halfExtents(shape: ShapeDef): [number, number, number] {
  switch (shape.type) {
    case 'box':
    case 'wedge':
      return [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2];
    case 'sphere':
      return [shape.r, shape.r, shape.r];
    case 'cylinder':
    case 'capsule':
      return [shape.r, shape.h / 2, shape.r];
    case 'convex': {
      const out: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < shape.points.length; i++) {
        const axis = i % 3;
        out[axis] = Math.max(out[axis]!, Math.abs(shape.points[i]!));
      }
      return out;
    }
  }
}

export function disposeGeometryCache(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
