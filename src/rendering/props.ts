import * as THREE from 'three';
import type { ItemDef, ShapeDef } from '../data/items';
import { geo, wedgePoints } from './geometry';
import { mat, signMat, solidMat, tinted } from './materialLibrary';
import { addParts } from './parts';

type M = THREE.Material;

function add(g: THREE.Object3D, geometry: THREE.BufferGeometry, material: M, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, name?: string): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  g.add(m);
  return m;
}

function sz(def: ItemDef): [number, number, number] {
  const s = def.shape;
  if (s.type === 'box' || s.type === 'wedge') return s.size;
  if (s.type === 'sphere') return [s.r * 2, s.r * 2, s.r * 2];
  if (s.type === 'cylinder' || s.type === 'capsule') return [s.r * 2, s.h, s.r * 2];
  return [1, 1, 1];
}

function frame(g: THREE.Object3D, w: number, h: number, d: number, t: number, m: M) {
  for (const sy of [-1, 1]) add(g, geo.rbox(w, t, d, 0.015), m, 0, (sy * (h - t)) / 2, 0);
  for (const sx of [-1, 1]) add(g, geo.rbox(t, h - t * 2, d, 0.015), m, (sx * (w - t)) / 2, 0, 0);
}

type Builder = (g: THREE.Group, def: ItemDef) => void;

const BUILDERS: Record<string, Builder> = {
  crate(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.025 * x), def.color ? tinted(mat('crate'), def.color) : mat('crate'));
  },
  crate_metal(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x * 0.94, y * 0.94, z * 0.94, 0.03), mat('crate_metal'));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      add(g, geo.rbox(0.12 * x, y, 0.12 * z, 0.02), mat('steel_dark'), (sx * x * 0.44), 0, sy * z * 0.44);
      add(g, geo.rbox(x, 0.1 * y, 0.1 * z, 0.02), mat('paint_amber'), 0, (sx * y) / 2.2, sy * z * 0.45);
    }
  },
  barrel(g, def) {
    const { r, h } = def.shape as { r: number; h: number };
    const body = solidMat(def.color ?? 0x2a7f8c, 0.42, 0.55);
    add(g, geo.cyl(r * 0.96, r * 0.96, h * 0.96, 20), body);
    for (const y of [-0.42, -0.14, 0.14, 0.42]) add(g, geo.torus(r * 0.97, 0.018, 24), mat('steel_dark'), 0, y * h, 0, Math.PI / 2);
    add(g, geo.cyl(r * 0.8, r * 0.8, 0.02, 20), mat('steel_dark'), 0, h * 0.485, 0);
    add(g, geo.cyl(0.05, 0.05, 0.03, 8), mat('steel'), r * 0.45, h * 0.5, 0);
  },
  barrel_explosive(g, def) {
    const { r, h } = def.shape as { r: number; h: number };
    add(g, geo.cyl(r * 0.96, r * 0.96, h * 0.96, 20), mat('paint_coral'));
    add(g, geo.cyl(r * 0.98, r * 0.98, h * 0.2, 20), mat('hazard'));
    for (const y of [-0.46, 0.46]) add(g, geo.torus(r * 0.97, 0.02, 24), mat('blackened'), 0, y * h, 0, Math.PI / 2);
    add(g, geo.cyl(r * 0.8, r * 0.8, 0.02, 20), mat('blackened'), 0, h * 0.485, 0);
    add(g, geo.sphere(0.05, 10), mat('glow_amber'), r * 0.42, h * 0.5, 0);
  },
  cone(g) {
    add(g, geo.cyl(0.03, 0.24, 0.66, 14), mat('plastic_orange'), 0, 0.0, 0);
    add(g, geo.cyl(0.11, 0.17, 0.14, 14), mat('paint_white'), 0, 0.02, 0);
    add(g, geo.rbox(0.56, 0.04, 0.56, 0.015), mat('rubber'), 0, -0.33, 0);
  },
  pallet(g, def) {
    const [x, y, z] = sz(def);
    for (let i = 0; i < 5; i++) add(g, geo.box(x, y * 0.25, z * 0.15), mat('wood'), 0, y * 0.375, (i - 2) * z * 0.21);
    for (let i = -1; i <= 1; i++) add(g, geo.box(x * 0.12, y * 0.5, z), mat('wood_dark'), i * x * 0.44, -y * 0.2, 0);
  },
  tire(g, def) {
    const { r, h } = def.shape as { r: number; h: number };
    add(g, geo.torus(r - h / 2.2, h / 2.1, 24), mat('rubber'), 0, 0, 0, Math.PI / 2);
    add(g, geo.cyl(r * 0.45, r * 0.45, h * 0.5, 14), mat('steel_dark'));
  },
  gel_cube(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.14), mat('gel'));
    add(g, geo.rbox(x * 0.42, y * 0.42, z * 0.42, 0.08), mat('glow_coral'));
  },
  heavy_block(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.04), mat('steel_dark'));
    for (const s of [-1, 1]) add(g, geo.box(x * 1.003, y * 0.14, z * 0.3), mat('hazard'), 0, s * y * 0.3, 0);
    add(g, geo.box(x * 0.3, y * 0.05, z * 0.1), mat('blackened'), 0, y * 0.51, 0);
    add(g, geo.torus(0.12, 0.03, 14), mat('steel'), 0, y * 0.53, 0);
  },
  ice_block(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.07), mat('ice'));
    add(g, geo.rbox(x * 0.5, y * 0.5, z * 0.5, 0.05), solidMat(0xe6faff, 0.05, 0.1), 0.05, -0.04, 0.03, 0.4, 0.6, 0.2);
  },
  ball(g, def) {
    const { r } = def.shape as { r: number };
    add(g, geo.sphere(r, 24), solidMat(def.color ?? 0xffb000, 0.55, 0));
    add(g, geo.torus(r * 1.0, 0.012, 32), mat('blackened'));
    add(g, geo.torus(r * 1.0, 0.012, 32), mat('blackened'), 0, 0, 0, Math.PI / 2);
  },
  ball_metal(g, def) {
    const { r } = def.shape as { r: number };
    add(g, geo.sphere(r, 24), mat('steel'));
    add(g, geo.torus(r * 0.99, 0.025, 32), mat('paint_amber'), 0, 0, 0, Math.PI / 2);
  },
  concrete_block(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.03), mat('concrete'));
    for (const s of [-1, 1]) add(g, geo.box(x * 0.28, y * 0.6, z * 1.003), mat('concrete_dark'), s * x * 0.24, 0, 0);
  },
  glass_panel(g, def) {
    const [x, y, z] = sz(def);
    const m = add(g, geo.box(x, y, z), mat('glass'));
    m.castShadow = false;
    add(g, geo.box(x, 0.03, z * 1.5), mat('steel_dark'), 0, -y / 2 + 0.015, 0);
  },
  domino(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.03), solidMat(0xe8e6dc, 0.6, 0));
    add(g, geo.box(x * 0.9, 0.03, z * 1.01), mat('blackened'));
    add(g, geo.sphere(0.06, 10), mat('blackened'), 0, y * 0.25, z * 0.47);
    add(g, geo.sphere(0.06, 10), mat('blackened'), 0, -y * 0.25, z * 0.47);
  },
  beam_wood(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.02), mat('wood'));
    for (const s of [-1, 1]) add(g, geo.box(0.08, y * 1.04, z * 1.04), mat('steel_dark'), s * x * 0.46, 0, 0);
  },
  beam_metal(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.box(x, y * 0.16, z), mat('steel'), 0, y * 0.42, 0);
    add(g, geo.box(x, y * 0.16, z), mat('steel'), 0, -y * 0.42, 0);
    add(g, geo.box(x, y * 0.7, z * 0.2), mat('steel_dark'));
    for (let i = -2; i <= 2; i++) add(g, geo.cyl(y * 0.22, y * 0.22, z * 0.21, 10), mat('blackened'), (i * x) / 5.5, 0, 0, Math.PI / 2);
  },
  floor_panel(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.02), mat('floor_dark'));
    for (const s of [-1, 1]) add(g, geo.box(x, y * 0.6, 0.06), mat('hazard'), 0, y * 0.25, s * z * 0.46);
  },
  wall_panel(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.02), mat('wall_light'));
    add(g, geo.box(x * 0.98, 0.1, z * 1.1), mat('paint_teal'), 0, -y * 0.32, 0);
  },
  ramp(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.wedge(x, y, z), mat('floor_dark'));
    const ang = Math.atan2(y, z);
    for (const s of [-1, 1]) add(g, geo.box(0.1, 0.03, Math.hypot(y, z)), mat('paint_amber'), (s * x) / 2.2, 0.02, 0, -ang);
  },
  platform(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y * 0.7, z, 0.02), mat('floor_tile'), 0, y * 0.15, 0);
    add(g, geo.box(x * 0.92, y * 0.3, z * 0.92), mat('steel_dark'), 0, -y * 0.35, 0);
    for (const sx of [-1, 1]) add(g, geo.box(0.1, y * 0.72, z * 1.002), mat('hazard'), (sx * x) / 2.1, y * 0.15, 0);
  },
  pillar(g, def) {
    const { r, h } = def.shape as { r: number; h: number };
    add(g, geo.cyl(r * 0.8, r * 0.8, h, 16), mat('concrete'));
    add(g, geo.cyl(r, r, 0.14, 16), mat('steel_dark'), 0, h / 2 - 0.07, 0);
    add(g, geo.cyl(r, r, 0.14, 16), mat('steel_dark'), 0, -h / 2 + 0.07, 0);
  },
  door_leaf(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.015), mat('wood_dark'));
    add(g, geo.sphere(0.05, 10), mat('steel'), x * 0.4, 0, z * 0.8);
    add(g, geo.box(x * 0.6, y * 0.28, z * 1.2), mat('wood'), 0, y * 0.2, 0);
    add(g, geo.box(x * 0.6, y * 0.28, z * 1.2), mat('wood'), 0, -y * 0.2, 0);
  },
  window(g, def) {
    const [x, y, z] = sz(def);
    const pane = add(g, geo.box(x * 0.94, y * 0.92, z * 0.3), mat('glass'));
    pane.castShadow = false;
    frame(g, x, y, z, 0.08, mat('steel_dark'));
    add(g, geo.box(0.04, y * 0.9, z * 0.5), mat('steel_dark'));
  },
  pipe(g, def) {
    const { r, h } = def.shape as { r: number; h: number };
    add(g, geo.cyl(r, r, h, 14), solidMat(0x8c4b2c, 0.5, 0.65));
    for (const s of [-1, 1]) add(g, geo.cyl(r * 1.3, r * 1.3, 0.1, 14), mat('steel_dark'), 0, (s * h) / 2.1, 0);
  },
  button(g) {
    add(g, geo.rbox(0.6, 0.1, 0.6, 0.02), mat('steel_dark'), 0, -0.05, 0);
    add(g, geo.cyl(0.2, 0.22, 0.1, 18), mat('paint_coral'), 0, 0.05, 0).name = 'cap';
  },
  lever(g) {
    add(g, geo.rbox(0.5, 0.14, 0.5, 0.02), mat('steel_dark'), 0, -0.23, 0);
    const pivot = new THREE.Group();
    pivot.name = 'pivot';
    pivot.position.y = -0.16;
    pivot.rotation.x = -0.6;
    add(pivot, geo.cyl(0.035, 0.035, 0.46, 10), mat('steel'), 0, 0.23, 0);
    add(pivot, geo.sphere(0.075, 12), mat('paint_amber'), 0, 0.48, 0);
    g.add(pivot);
  },
  plate(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.box(x, y * 0.5, z), mat('hazard'), 0, -y * 0.25, 0);
    add(g, geo.rbox(x * 0.84, y * 0.8, z * 0.84, 0.02), mat('steel_dark'), 0, y * 0.1, 0).name = 'cap';
  },
  timer(g) {
    add(g, geo.rbox(0.5, 0.5, 0.5, 0.04), mat('steel_dark'));
    add(g, geo.cyl(0.17, 0.17, 0.03, 18), mat('paint_white'), 0, 0.26, 0);
    add(g, geo.box(0.03, 0.02, 0.15), mat('paint_coral'), 0, 0.28, 0.07).name = 'hand';
  },
  inverter(g) {
    add(g, geo.rbox(0.4, 0.3, 0.4, 0.03), mat('paint_teal'));
    add(g, geo.cyl(0, 0.12, 0.08, 3), mat('blackened'), 0, 0.17, 0);
  },
  motor(g) {
    add(g, geo.rbox(0.8, 0.4, 0.8, 0.04), mat('steel_dark'));
    add(g, geo.box(0.82, 0.08, 0.82), mat('hazard'), 0, -0.1, 0);
    add(g, geo.cyl(0.18, 0.18, 0.1, 14), mat('steel'), 0, 0.22, 0);
  },
  fan(g) {
    add(g, geo.torus(0.62, 0.07, 28), mat('steel_dark'), 0, 0, 0, Math.PI / 2);
    add(g, geo.rbox(1.4, 0.08, 0.1, 0.02), mat('steel_dark'), 0, -0.1, 0);
    add(g, geo.rbox(0.1, 0.08, 1.4, 0.02), mat('steel_dark'), 0, -0.1, 0);
    const rotor = new THREE.Group();
    rotor.name = 'rotor';
    add(rotor, geo.cyl(0.13, 0.13, 0.14, 12), mat('paint_amber'));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(rotor, geo.box(0.42, 0.02, 0.17), mat('steel'), Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32, 0.4, -a, 0);
    }
    g.add(rotor);
  },
  spring_pad(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y * 0.35, z, 0.03), mat('steel_dark'), 0, -y * 0.32, 0);
    add(g, geo.torus(0.3, 0.035, 18), mat('steel'), 0, -y * 0.08, 0, Math.PI / 2);
    add(g, geo.torus(0.26, 0.035, 18), mat('steel'), 0, y * 0.08, 0, Math.PI / 2);
    add(g, geo.rbox(x * 0.9, y * 0.24, z * 0.9, 0.03), mat('paint_teal'), 0, y * 0.36, 0).name = 'cap';
    add(g, geo.box(x * 0.3, 0.01, z * 0.3), mat('glow_teal'), 0, y * 0.49, 0);
  },
  door_powered(g, def) {
    const [x, y, z] = sz(def);
    const slider = new THREE.Group();
    slider.name = 'slider';
    add(slider, geo.rbox(x * 0.96, y * 0.96, z * 0.6, 0.02), mat('wall_dark'));
    add(slider, geo.box(x * 0.96, y * 0.12, z * 0.62), mat('hazard'), 0, -y * 0.3, 0);
    add(slider, geo.box(x * 0.5, y * 0.05, z * 0.64), mat('glow_amber'), 0, y * 0.25, 0).name = 'light';
    g.add(slider);
  },
  lift(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y, z, 0.03), mat('floor_dark'));
    for (const s of [-1, 1]) {
      add(g, geo.box(x * 1.002, y * 0.5, 0.12), mat('hazard'), 0, 0, s * z * 0.47);
      add(g, geo.box(0.12, y * 0.5, z * 1.002), mat('hazard'), s * x * 0.47, 0, 0);
    }
    add(g, geo.cyl(0.14, 0.14, 0.02, 14), mat('glow_teal'), 0, y * 0.51, 0);
  },
  lamp(g) {
    add(g, geo.rbox(0.4, 0.14, 0.4, 0.02), mat('steel_dark'), 0, -0.13, 0);
    add(g, geo.sphere(0.15, 16), mat('steel_dark'), 0, 0.06, 0).name = 'bulb';
  },
  buggy(g) {
    const paint = mat('paint_amber');
    add(g, geo.rbox(1.3, 0.28, 2.4, 0.06), mat('steel_dark'), 0, -0.05, 0);
    add(g, geo.rbox(1.2, 0.16, 0.8, 0.05), paint, 0, 0.14, -0.78);
    add(g, geo.rbox(0.5, 0.42, 0.42, 0.05), mat('blackened'), -0.31, 0.2, 0.16);
    add(g, geo.rbox(0.5, 0.42, 0.42, 0.05), mat('blackened'), 0.31, 0.2, 0.16);
    add(g, geo.rbox(1.2, 0.26, 0.5, 0.05), paint, 0, 0.13, 0.95);
    // Roll cage
    const tube = mat('paint_coral');
    for (const s of [-1, 1]) {
      add(g, geo.cyl(0.035, 0.035, 1.1, 8), tube, s * 0.55, 0.62, 0.45, 0.25);
      add(g, geo.cyl(0.035, 0.035, 1.1, 8), tube, s * 0.55, 0.62, -0.32, -0.6);
      add(g, geo.cyl(0.035, 0.035, 0.75, 8), tube, s * 0.55, 1.13, 0.1, Math.PI / 2);
    }
    add(g, geo.cyl(0.035, 0.035, 1.1, 8), tube, 0, 1.14, 0.47, 0, 0, Math.PI / 2);
    add(g, geo.cyl(0.035, 0.035, 1.1, 8), tube, 0, 1.14, -0.27, 0, 0, Math.PI / 2);
    for (const s of [-1, 1]) add(g, geo.cyl(0.09, 0.09, 0.05, 12), mat('glow_white'), s * 0.42, 0.14, -1.2, Math.PI / 2);
  },
  emitter(g, def) {
    add(g, geo.rbox(0.4, 0.2, 0.4, 0.03), mat('steel_dark'));
    add(g, geo.cyl(0.1, 0.13, 0.08, 12), def.color ? solidMat(def.color) : mat('steel'), 0, 0.13, 0);
  },
  blast(g) {
    add(g, geo.sphere(0.25, 16), mat('paint_coral'));
    add(g, geo.torus(0.25, 0.03, 20), mat('hazard'), 0, 0, 0, Math.PI / 2);
  },
  plant(g) {
    add(g, geo.cyl(0.2, 0.14, 0.34, 14), solidMat(0xc76a3c, 0.8, 0), 0, -0.28, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(g, geo.box(0.1, 0.6, 0.015), mat('leaf'), Math.cos(a) * 0.17, 0.1, Math.sin(a) * 0.17, Math.sin(a) * 0.55, -a, -Math.cos(a) * 0.55);
    }
  },
  terminal(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, y * 0.72, z, 0.03), mat('steel_dark'), 0, -y * 0.14, 0);
    add(g, geo.rbox(x, y * 0.42, z * 0.24, 0.03), mat('wall_dark'), 0, y * 0.26, -z * 0.3, -0.18);
    add(g, geo.box(x * 0.82, y * 0.31, 0.02), mat('screen'), 0, y * 0.27, -z * 0.14, -0.18);
    add(g, geo.box(x * 0.8, 0.03, z * 0.32), mat('blackened'), 0, y * 0.22, z * 0.26, 0.3);
    for (let i = 0; i < 3; i++) add(g, geo.cyl(0.03, 0.03, 0.02, 8), mat(['glow_coral', 'glow_amber', 'glow_teal'][i]!), (i - 1) * 0.16, -y * 0.05, z * 0.51, Math.PI / 2);
  },
  shelf(g, def) {
    const [x, y, z] = sz(def);
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) add(g, geo.box(0.05, y, 0.05), mat('paint_teal'), sx * (x / 2 - 0.03), 0, sz2 * (z / 2 - 0.03));
    for (const f of [-0.45, -0.1, 0.25, 0.47]) add(g, geo.box(x, 0.04, z), mat('steel_dark'), 0, f * y, 0);
    add(g, geo.rbox(0.42, 0.3, 0.32, 0.03), mat('crate'), -0.4, -0.1 * y + 0.17, 0);
    add(g, geo.cyl(0.14, 0.14, 0.36, 12), mat('paint_amber'), 0.45, 0.25 * y + 0.2, 0);
    add(g, geo.rbox(0.34, 0.24, 0.3, 0.03), mat('paint_coral'), 0.25, -0.45 * y + 0.14, 0);
  },
  bench(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.rbox(x, 0.08, z, 0.015), mat('wood'), 0, y / 2 - 0.04, 0);
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) add(g, geo.box(0.07, y - 0.08, 0.07), mat('steel_dark'), sx * (x / 2 - 0.08), -0.04, sz2 * (z / 2 - 0.08));
    add(g, geo.box(x * 0.92, 0.04, z * 0.86), mat('steel_dark'), 0, -y / 4, 0);
    add(g, geo.rbox(0.36, 0.12, 0.22, 0.02), mat('paint_coral'), -0.5, y / 2 + 0.06, 0.1);
    add(g, geo.cyl(0.02, 0.02, 0.32, 8), mat('steel'), 0.2, y / 2 + 0.02, -0.1, 0, 0.4, Math.PI / 2);
  },
  floor_lamp(g, def) {
    const { h } = def.shape as { r: number; h: number };
    add(g, geo.cyl(0.2, 0.2, 0.05, 14), mat('steel_dark'), 0, -h / 2 + 0.03, 0);
    add(g, geo.cyl(0.025, 0.025, h * 0.9, 8), mat('steel'), 0, 0, 0);
    add(g, geo.rbox(0.42, 0.28, 0.14, 0.03), mat('paint_amber'), 0, h / 2 - 0.14, 0.03);
    add(g, geo.box(0.34, 0.2, 0.02), mat('glow_white'), 0, h / 2 - 0.14, 0.11);
  },
  sign(g, def) {
    const [x, y, z] = sz(def);
    add(g, geo.box(0.08, y, z * 0.8), mat('steel_dark'));
    add(g, geo.box(x, x, z), signMat('hazard_generic', ['!', 'CAUTION'], '#f2aa00', '#16191b'), 0, y / 2 - x / 2, z * 0.2);
  },
};

export function shapeMesh(g: THREE.Object3D, shape: ShapeDef, material: M): void {
  switch (shape.type) {
    case 'box': add(g, geo.rbox(shape.size[0], shape.size[1], shape.size[2], 0.03), material); break;
    case 'wedge': add(g, geo.wedge(shape.size[0], shape.size[1], shape.size[2]), material); break;
    case 'sphere': add(g, geo.sphere(shape.r), material); break;
    case 'cylinder': add(g, geo.cyl(shape.r, shape.r, shape.h), material); break;
    case 'capsule': add(g, new THREE.CapsuleGeometry(shape.r, Math.max(0.01, shape.h - shape.r * 2), 6, 14), material); break;
    case 'convex': {
      let m = 0;
      for (const v of shape.points) m = Math.max(m, Math.abs(v));
      add(g, geo.sphere(m * 0.8, 10), material);
      break;
    }
  }
}

export function buildVisual(def: ItemDef): THREE.Group {
  const g = new THREE.Group();
  const builder = BUILDERS[def.visual];
  if (builder) {
    builder(g, def);
  } else if (!def.model) {
    // Modded content or missing art: an honest fallback generated from the collision shape.
    shapeMesh(g, def.shape, def.color !== undefined ? solidMat(def.color, 0.5, 0.25) : solidMat(0xc9c5b8, 0.6, 0.15));
  }
  if (def.model) addParts(g, def.model);
  return g;
}

export function hasBuilder(visual: string): boolean {
  return visual in BUILDERS;
}

export { wedgePoints };
