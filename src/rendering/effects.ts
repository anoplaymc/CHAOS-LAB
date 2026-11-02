import * as THREE from 'three';
import { geo } from './geometry';
import { rand, type V3 } from '../utils/math';

const VERT = /* glsl */ `
attribute float size;
attribute vec4 pcolor;
varying vec4 vColor;
uniform float scale;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.25, d);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

/** Fixed-capacity ring buffer of CPU particles. Emission beyond capacity overwrites the oldest. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private sizes: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private head = 0;
  active = 0;
  budget: number;

  constructor(readonly capacity: number, blending: THREE.Blending, private opacity = 1) {
    this.budget = capacity;
    this.pos = new Float32Array(capacity * 3).fill(-9999);
    this.col = new Float32Array(capacity * 4);
    this.sizes = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: { scale: { value: 500 } },
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setViewportScale(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale!.value = px;
  }

  emit(p: V3, v: V3, color: THREE.Color, size: number, life: number, gravity = 0, drag = 0): void {
    const i = this.head;
    this.head = (this.head + 1) % Math.min(this.budget, this.capacity);
    if (this.life[i]! <= 0) this.active++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b; this.col[i * 4 + 3] = this.opacity;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.sizes[i] = size;
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt: number): void {
    if (this.active === 0) return;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) continue;
      const l = (this.life[i] = this.life[i]! - dt);
      if (l <= 0) {
        this.active--;
        this.col[i * 4 + 3] = 0;
        this.sizes[i] = 0;
        this.pos[i * 3 + 1] = -9999;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i]! * dt);
      this.vel[i * 3] = this.vel[i * 3]! * d;
      this.vel[i * 3 + 1] = (this.vel[i * 3 + 1]! - this.grav[i]! * dt) * d;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2]! * d;
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt;
      const t = l / this.maxLife[i]!;
      this.col[i * 4 + 3] = Math.min(1, t * 2) * this.opacity;
      this.sizes[i] = this.baseSize[i]! * (this.drag[i]! > 2 ? 1.6 - t * 0.6 : t * 0.5 + 0.5);
    }
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.pcolor!.needsUpdate = true;
    g.attributes.size!.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.sizes.fill(0);
    // A point of size 0 still rasterizes as one pixel, so it has to be transparent as well.
    for (let i = 3; i < this.col.length; i += 4) this.col[i] = 0;
    this.active = 0;
    // update() skips an empty system, so this is the only chance to tell the GPU they're gone.
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.pcolor!.needsUpdate = true;
    g.attributes.size!.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

interface Beam { mesh: THREE.Mesh; life: number; max: number; base: number }
interface Ring { mesh: THREE.Mesh; life: number; max: number; radius: number }

const C = new THREE.Color();
const up = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** One-stop visual effects: pooled and bounded. Nothing here allocates per-frame or grows without limit. */
export class Effects {
  readonly group = new THREE.Group();
  readonly sparks = new ParticleSystem(1800, THREE.AdditiveBlending);
  readonly smoke = new ParticleSystem(500, THREE.NormalBlending, 0.28);
  private beams: Beam[] = [];
  private beamIndex = 0;
  private rings: Ring[] = [];
  private ringIndex = 0;
  private lights: { light: THREE.PointLight; life: number; max: number; peak: number }[] = [];
  private lightIndex = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.group.add(this.sparks.points, this.smoke.points);
    const beamGeo = geo.cyl(1, 1, 1, 6, true);
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.beams.push({ mesh, life: 0, max: 1, base: 1 });
    }
    const ringGeo = geo.sphere(1, 18);
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, radius: 1 });
    }
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 2);
      this.group.add(light);
      this.lights.push({ light, life: 0, max: 1, peak: 1 });
    }
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    const f = q === 'low' ? 0.35 : q === 'medium' ? 0.7 : 1;
    this.sparks.budget = Math.floor(this.sparks.capacity * f);
    this.smoke.budget = Math.floor(this.smoke.capacity * f);
  }

  get activeParticles(): number {
    return this.sparks.active + this.smoke.active;
  }

  beam(from: V3, to: V3, color: number, width = 0.02, life = 0.08): void {
    const b = this.beams[this.beamIndex]!;
    this.beamIndex = (this.beamIndex + 1) % this.beams.length;
    tmpA.set(from.x, from.y, from.z);
    tmpB.set(to.x, to.y, to.z);
    const dir = tmpB.clone().sub(tmpA);
    const length = dir.length();
    b.mesh.position.copy(tmpA).addScaledVector(dir, 0.5);
    b.mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    b.mesh.scale.set(width, length, width);
    (b.mesh.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(2);
    (b.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    b.mesh.visible = true;
    b.life = b.max = life;
    b.base = width;
  }

  ring(p: V3, radius: number, color: number, life = 0.45): void {
    const r = this.rings[this.ringIndex]!;
    this.ringIndex = (this.ringIndex + 1) % this.rings.length;
    r.mesh.position.set(p.x, p.y, p.z);
    (r.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    r.mesh.visible = true;
    r.life = r.max = life;
    r.radius = radius;
  }

  flash(p: V3, color: number, peak = 40, life = 0.18): void {
    const l = this.lights[this.lightIndex]!;
    this.lightIndex = (this.lightIndex + 1) % this.lights.length;
    l.light.position.set(p.x, p.y, p.z);
    l.light.color.set(color);
    l.light.intensity = peak;
    l.life = l.max = life;
    l.peak = peak;
  }

  burst(p: V3, n: number, color: number, speed = 6, size = 0.1, life = 0.5, gravity = 12, dirBias?: V3): void {
    C.set(color);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const z = rand(-1, 1);
      const s = Math.sqrt(1 - z * z) * rand(0.2, 1) * speed;
      const v = { x: Math.cos(a) * s, y: z * speed * rand(0.2, 1), z: Math.sin(a) * s };
      if (dirBias) { v.x += dirBias.x * speed; v.y += dirBias.y * speed; v.z += dirBias.z * speed; }
      this.sparks.emit(p, v, C, size * rand(0.6, 1.3), life * rand(0.5, 1.2), gravity, 0.6);
    }
  }

  puff(p: V3, n: number, color: number, spread = 0.4, size = 0.5, life = 1, rise = 0.6): void {
    C.set(color);
    for (let i = 0; i < n; i++) {
      this.smoke.emit(
        { x: p.x + rand(-spread, spread), y: p.y + rand(-spread, spread), z: p.z + rand(-spread, spread) },
        { x: rand(-0.5, 0.5), y: rise * rand(0.5, 1.5), z: rand(-0.5, 0.5) },
        C, size * rand(0.7, 1.4), life * rand(0.6, 1.3), 0, 2.5,
      );
    }
  }

  explosion(p: V3, radius: number): void {
    this.flash(p, 0xffa040, 90 * radius, 0.3);
    this.ring(p, radius, 0xffa040, 0.4);
    this.burst(p, 70, 0xff9020, radius * 2.2, 0.34, 0.8, 9);
    this.burst(p, 40, 0xffe080, radius * 3.2, 0.16, 0.7, 14);
    this.puff(p, 14, 0x6b6660, radius * 0.45, radius * 0.5, 1.3, 1.6);
  }

  update(dt: number): void {
    this.sparks.update(dt);
    this.smoke.update(dt);
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const t = Math.max(0, b.life / b.max);
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = t;
      const w = b.base * (0.4 + 0.6 * t);
      b.mesh.scale.x = w;
      b.mesh.scale.z = w;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const t = 1 - r.life / r.max;
      r.mesh.scale.setScalar(0.1 + r.radius * (1 - (1 - t) * (1 - t)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * (1 - t) * 0.22;
    }
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      l.light.intensity = l.life > 0 ? (l.peak * l.life) / l.max : 0;
    }
  }

  clear(): void {
    this.sparks.clear();
    this.smoke.clear();
    for (const b of this.beams) { b.life = 0; b.mesh.visible = false; }
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
    for (const l of this.lights) { l.life = 0; l.light.intensity = 0; }
  }

  dispose(): void {
    this.sparks.dispose();
    this.smoke.dispose();
    for (const b of this.beams) (b.mesh.material as THREE.Material).dispose();
    for (const r of this.rings) (r.mesh.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}

// ── Overlays: selection outlines and status tints rendered as extra meshes sharing a prop's geometry.

const OUTLINE_VERT = /* glsl */ `
uniform float thickness;
void main() {
  vec3 n = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz += n * thickness * max(0.4, -mv.z * 0.12);
  gl_Position = projectionMatrix * mv;
}`;
const OUTLINE_FRAG = /* glsl */ `
uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }`;

const outlineMats = new Map<number, THREE.ShaderMaterial>();

function outlineMat(color: number): THREE.ShaderMaterial {
  let m = outlineMats.get(color);
  if (!m) {
    m = new THREE.ShaderMaterial({
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      side: THREE.BackSide,
      uniforms: { thickness: { value: 0.03 }, color: { value: new THREE.Color(color).multiplyScalar(1.6) } },
    });
    outlineMats.set(color, m);
  }
  return m;
}

export function setOutline(root: THREE.Object3D, color: number | null): void {
  if (root.userData.outlineColor === color) return;
  clearOverlay(root, 'outline');
  root.userData.outlineColor = color;
  if (color !== null) addOverlay(root, outlineMat(color), 'outline');
}

export function addOverlay(root: THREE.Object3D, material: THREE.Material, tag: string): void {
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.overlay) targets.push(o);
  });
  for (const t of targets) {
    const m = new THREE.Mesh(t.geometry, material);
    m.userData.overlay = tag;
    m.castShadow = false;
    m.receiveShadow = false;
    t.add(m);
  }
}

export function clearOverlay(root: THREE.Object3D, tag: string): void {
  const doomed: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.overlay === tag) doomed.push(o);
  });
  for (const d of doomed) d.removeFromParent();
}

export const iceOverlay = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2288aa, roughness: 0.1, transparent: true, opacity: 0.5, depthWrite: false });
