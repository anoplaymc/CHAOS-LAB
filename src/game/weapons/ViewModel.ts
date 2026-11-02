import * as THREE from 'three';
import { geo } from '../../rendering/geometry';
import { mat } from '../../rendering/materialLibrary';
import { damp, type V3 } from '../../utils/math';
import { addParts } from '../../rendering/parts';
import type { ModelPart } from '../content/types';

function part(g: THREE.Object3D, gm: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const o = new THREE.Mesh(gm, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  g.add(o);
  return o;
}

const R = Math.PI / 2;
const REST_X = 0.19;
const REST_Y = -0.16;
const REST_Z = -0.42;
const SCALE = 0.72;
/**
 * The model is drawn this much smaller and closer to the eye, which looks identical on screen. It keeps the
 * furthest point (0.65 m at full size) inside the player capsule, so tools can't poke through nearby walls.
 */
const DEPTH = 0.5;

/** Each tool has a recognisable silhouette and accent colour. */
export const MODELS: Record<string, (g: THREE.Group) => number> = {
  manipulator(g) {
    part(g, geo.rbox(0.05, 0.06, 0.2, 0.012), mat('steel_dark'), 0, 0, 0.02);
    part(g, geo.cyl(0.024, 0.03, 0.14, 10), mat('paint_amber'), 0, 0.005, -0.12, R);
    for (const a of [0, 2.09, 4.19]) part(g, geo.box(0.008, 0.008, 0.08), mat('steel'), Math.cos(a) * 0.033, Math.sin(a) * 0.033 + 0.005, -0.21);
    part(g, geo.sphere(0.012, 8), mat('glow_amber'), 0, 0.005, -0.22);
    part(g, geo.rbox(0.028, 0.08, 0.03, 0.006), mat('rubber'), 0, -0.06, 0.06, 0.3);
    return -0.25;
  },
  spawner(g) {
    part(g, geo.rbox(0.09, 0.075, 0.2, 0.012), mat('paint_teal'), 0, 0, 0.02);
    part(g, geo.torus(0.04, 0.008, 18), mat('glow_teal'), 0, 0, -0.1);
    part(g, geo.box(0.05, 0.02, 0.02), mat('steel_dark'), 0, 0.045, 0.05);
    part(g, geo.rbox(0.028, 0.08, 0.03, 0.006), mat('rubber'), 0, -0.07, 0.07, 0.3);
    return -0.11;
  },
  construction(g) {
    part(g, geo.rbox(0.07, 0.06, 0.19, 0.012), mat('paint_amber'), 0, 0, 0.02);
    part(g, geo.box(0.11, 0.015, 0.05), mat('hazard'), 0, 0.03, -0.1);
    part(g, geo.cyl(0.012, 0.018, 0.09, 8), mat('steel'), 0, -0.002, -0.12, R);
    part(g, geo.rbox(0.028, 0.08, 0.03, 0.006), mat('rubber'), 0, -0.06, 0.07, 0.3);
    return -0.17;
  },
  remover(g) {
    part(g, geo.rbox(0.06, 0.06, 0.2, 0.012), mat('blackened'), 0, 0, 0.02);
    part(g, geo.cyl(0.04, 0.012, 0.08, 10), mat('paint_coral'), 0, 0, -0.12, R);
    part(g, geo.box(0.015, 0.02, 0.1), mat('glow_coral'), 0, 0.034, 0);
    part(g, geo.rbox(0.028, 0.08, 0.03, 0.006), mat('rubber'), 0, -0.06, 0.06, 0.3);
    return -0.16;
  },
  inspector(g) {
    part(g, geo.rbox(0.1, 0.13, 0.02, 0.012), mat('steel_dark'), 0, 0.02, 0, -0.4);
    part(g, geo.box(0.078, 0.09, 0.003), mat('screen'), 0, 0.024, -0.012, -0.4);
    part(g, geo.cyl(0.018, 0.018, 0.08, 8), mat('paint_amber'), 0, 0.095, 0, 0, 0, 0);
    return -0.1;
  },
  paint(g) {
    part(g, geo.rbox(0.05, 0.14, 0.05, 0.015), mat('paint_white'), 0, 0, 0.03);
    part(g, geo.cyl(0.026, 0.026, 0.05, 10), mat('paint_coral'), 0, 0.09, 0.03);
    part(g, geo.cyl(0.008, 0.012, 0.05, 8), mat('blackened'), 0, 0.095, -0.015, R);
    return -0.05;
  },
  blaster(g) {
    part(g, geo.rbox(0.05, 0.065, 0.24, 0.012), mat('paint_amber'), 0, 0, 0.02);
    part(g, geo.cyl(0.013, 0.013, 0.11, 8), mat('steel'), 0, 0.012, -0.15, R);
    part(g, geo.box(0.054, 0.012, 0.11), mat('blackened'), 0, 0.035, 0.03);
    part(g, geo.rbox(0.03, 0.09, 0.035, 0.006), mat('rubber'), 0, -0.07, 0.08, 0.3);
    return -0.21;
  },
  impulse(g) {
    part(g, geo.rbox(0.09, 0.09, 0.22, 0.02), mat('steel_dark'), 0, 0, 0.04);
    part(g, geo.cyl(0.075, 0.035, 0.11, 14), mat('paint_teal'), 0, 0, -0.12, R);
    part(g, geo.torus(0.066, 0.009, 18), mat('glow_teal'), 0, 0, -0.173);
    part(g, geo.torus(0.05, 0.007, 16), mat('glow_teal'), 0, 0, -0.09);
    part(g, geo.rbox(0.03, 0.09, 0.035, 0.006), mat('rubber'), 0, -0.085, 0.09, 0.3);
    return -0.18;
  },
  freeze(g) {
    part(g, geo.rbox(0.05, 0.06, 0.2, 0.012), mat('paint_white'), 0, 0, 0.03);
    part(g, geo.cyl(0.032, 0.032, 0.1, 10), mat('ice'), 0, 0.055, 0.03, R);
    part(g, geo.cyl(0.01, 0.018, 0.13, 8), mat('steel'), 0, 0, -0.13, R);
    part(g, geo.sphere(0.014, 8), mat('glow_teal'), 0, 0, -0.2);
    part(g, geo.rbox(0.028, 0.08, 0.03, 0.006), mat('rubber'), 0, -0.065, 0.08, 0.3);
    return -0.21;
  },
  bouncer(g) {
    part(g, geo.rbox(0.07, 0.07, 0.18, 0.02), mat('blackened'), 0, 0, 0.05);
    part(g, geo.cyl(0.045, 0.045, 0.16, 12), mat('paint_teal'), 0, 0, -0.1, R);
    part(g, geo.sphere(0.04, 10), mat('glow_teal'), 0, 0, -0.17);
    part(g, geo.torus(0.05, 0.006, 16), mat('paint_amber'), 0, 0, -0.03);
    part(g, geo.rbox(0.028, 0.08, 0.03, 0.006), mat('rubber'), 0, -0.07, 0.09, 0.3);
    return -0.19;
  },
  disintegrator(g) {
    part(g, geo.rbox(0.06, 0.05, 0.22, 0.012), mat('steel_dark'), 0, 0, 0.03);
    for (const s of [-1, 1]) part(g, geo.box(0.01, 0.05, 0.18), mat('glow_teal'), s * 0.033, 0.01, -0.13);
    part(g, geo.cyl(0.018, 0.018, 0.09, 8), mat('glow_teal'), 0, 0.035, 0.05, R);
    part(g, geo.rbox(0.028, 0.08, 0.03, 0.006), mat('rubber'), 0, -0.065, 0.08, 0.3);
    return -0.22;
  },
  gravity(g) {
    part(g, geo.rbox(0.06, 0.06, 0.16, 0.012), mat('wall_dark'), 0, 0, 0.05);
    part(g, geo.sphere(0.032, 12), mat('glow_violet'), 0, 0, -0.1);
    part(g, geo.torus(0.06, 0.007, 20), mat('steel'), 0, 0, -0.1);
    part(g, geo.torus(0.06, 0.007, 20), mat('steel'), 0, 0, -0.1, 0, R);
    part(g, geo.rbox(0.028, 0.08, 0.03, 0.006), mat('rubber'), 0, -0.065, 0.08, 0.3);
    return -0.1;
  },
};

/** A view model from data: an existing tool's model, extra parts, or both. Returns where the muzzle sits. */
export function dataViewModel(base: string | undefined, parts: ModelPart[] | undefined, muzzleZ = -0.2): (g: THREE.Group) => number {
  return (g) => {
    const z = base ? MODELS[base]?.(g) : undefined;
    if (parts) addParts(g, parts);
    return z ?? muzzleZ;
  };
}

export function buildToolModel(id: string): THREE.Group {
  const g = new THREE.Group();
  (MODELS[id] ?? MODELS.manipulator!)(g);
  return g;
}

export class ViewModel {
  readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private muzzleZ = -0.2;
  private recoil = 0;
  private swayX = 0;
  private swayY = 0;
  private switchAnim = 0;
  charge = 0;
  private tmp = new THREE.Vector3();
  private eye = new THREE.Vector3();

  constructor(private camera: THREE.Camera) {
    camera.add(this.root);
    this.root.position.set(REST_X, REST_Y, REST_Z).multiplyScalar(DEPTH);
    this.root.scale.setScalar(SCALE * DEPTH);
  }

  setTool(id: string): void {
    if (this.model) this.model.removeFromParent();
    const g = new THREE.Group();
    this.muzzleZ = (MODELS[id] ?? MODELS.manipulator!)(g);
    g.traverse((o) => {
      o.renderOrder = 5;
    });
    this.root.add(g);
    this.model = g;
    this.switchAnim = 1;
    this.charge = 0;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  kick(amount: number): void {
    this.recoil = Math.min(1.5, this.recoil + amount);
  }

  update(dt: number, mouseDx: number, mouseDy: number, moving: number, time: number, motion: boolean): void {
    this.recoil = damp(this.recoil, 0, 12, dt);
    this.switchAnim = damp(this.switchAnim, 0, 11, dt);
    this.swayX = damp(this.swayX, motion ? Math.max(-1, Math.min(1, mouseDx * 0.02)) : 0, 10, dt);
    this.swayY = damp(this.swayY, motion ? Math.max(-1, Math.min(1, mouseDy * 0.02)) : 0, 10, dt);
    const bob = motion ? moving : 0;
    this.root.position.set(
      REST_X - this.swayX * 0.012 + Math.cos(time * 7) * 0.0035 * bob,
      REST_Y + this.swayY * 0.012 - Math.abs(Math.sin(time * 7)) * 0.005 * bob - this.switchAnim * 0.16,
      REST_Z + this.recoil * 0.035,
    );
    this.root.rotation.set(this.recoil * 0.12 + this.switchAnim * 0.5, -this.swayX * 0.04, -this.swayX * 0.03);
    if (this.charge > 0.01) {
      this.root.position.x += (Math.random() - 0.5) * this.charge * 0.002;
      this.root.position.y += (Math.random() - 0.5) * this.charge * 0.002;
    }
    this.root.position.multiplyScalar(DEPTH);
  }

  muzzleWorld(): V3 {
    this.root.updateWorldMatrix(true, false);
    const p = this.tmp.set(0, 0.005, this.muzzleZ).applyMatrix4(this.root.matrixWorld);
    // Effects start from where the muzzle appears to be, not from the shrunken model right by the eye.
    this.camera.getWorldPosition(this.eye);
    p.sub(this.eye).divideScalar(DEPTH).add(this.eye);
    return { x: p.x, y: p.y, z: p.z };
  }
}
