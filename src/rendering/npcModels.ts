import * as THREE from 'three';
import { geo } from './geometry';
import type { ModelPart, NpcModelSpec } from '../game/content/types';
import { NPC_PROFILES } from '../game/npcs/NpcBrain';
import { mat, solidMat } from './materialLibrary';
import { buildPart } from './parts';

export interface NpcRig {
  root: THREE.Group;
  head: THREE.Object3D;
  torso: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  extra: THREE.Object3D[];
  /** Height of the walking cycle's bounce. */
  bob: number;
  stride: number;
}

function mesh(p: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.castShadow = true;
  p.add(o);
  return o;
}

function joint(p: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  p.add(g);
  return g;
}

/** Humanoid skeleton shared by Technician and Guard; Y=0 at capsule centre, `h` is total height. */
function humanoid(h: number, suit: THREE.Material, limb: THREE.Material, boots: THREE.Material): NpcRig {
  const root = new THREE.Group();
  const feet = -h / 2;
  const hip = feet + h * 0.47;
  const torso = joint(root, 0, hip, 0);
  mesh(torso, geo.rbox(0.42, h * 0.3, 0.24, 0.08), suit, 0, h * 0.16, 0);
  mesh(torso, geo.rbox(0.36, h * 0.09, 0.22, 0.05), limb, 0, -h * 0.015, 0);
  const head = joint(torso, 0, h * 0.34, 0);
  const arm = (s: number) => {
    const j = joint(torso, s * 0.27, h * 0.29, 0);
    mesh(j, geo.rbox(0.11, h * 0.2, 0.11, 0.05), suit, 0, -h * 0.09, 0);
    mesh(j, geo.rbox(0.09, h * 0.19, 0.09, 0.04), limb, 0, -h * 0.26, 0);
    return j;
  };
  const leg = (s: number) => {
    const j = joint(root, s * 0.12, hip, 0);
    mesh(j, geo.rbox(0.15, h * 0.26, 0.15, 0.05), limb, 0, -h * 0.13, 0);
    mesh(j, geo.rbox(0.13, h * 0.2, 0.13, 0.05), limb, 0, -h * 0.34, 0);
    mesh(j, geo.rbox(0.16, 0.09, 0.28, 0.03), boots, 0, -h * 0.445, -0.05);
    return j;
  };
  return { root, head, torso, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1), extra: [], bob: 0.03, stride: 0.75 };
}

function technician(): NpcRig {
  const rig = humanoid(1.8, mat('paint_white'), solidMat(0x2d4a5c, 0.8, 0), mat('rubber'));
  mesh(rig.head, geo.sphere(0.16, 16), solidMat(0xd9a982, 0.7, 0), 0, 0.09, 0);
  mesh(rig.head, geo.cyl(0.17, 0.18, 0.1, 16), mat('paint_amber'), 0, 0.2, 0); // hard hat
  mesh(rig.head, geo.cyl(0.25, 0.25, 0.02, 18), mat('paint_amber'), 0, 0.15, -0.03);
  mesh(rig.head, geo.rbox(0.25, 0.07, 0.03, 0.01), mat('glow_teal'), 0, 0.1, -0.15); // goggles
  mesh(rig.torso, geo.box(0.44, 0.34, 0.03), mat('paint_white'), 0, -0.14, -0.1); // coat tail
  mesh(rig.torso, geo.box(0.11, 0.06, 0.01), mat('paint_coral'), 0.1, 0.4, -0.125); // pocket tag
  return rig;
}

function guard(): NpcRig {
  const rig = humanoid(1.85, solidMat(0x24404f, 0.5, 0.45), solidMat(0x18242b, 0.8, 0.1), mat('blackened'));
  mesh(rig.head, geo.rbox(0.31, 0.32, 0.33, 0.12), mat('wall_dark'), 0, 0.11, 0);
  mesh(rig.head, geo.rbox(0.27, 0.09, 0.03, 0.01), mat('glow_amber'), 0, 0.13, -0.165);
  mesh(rig.torso, geo.rbox(0.5, 0.36, 0.32, 0.06), solidMat(0x35586a, 0.45, 0.55), 0, 0.33, 0); // vest
  for (const s of [-1, 1]) mesh(rig.torso, geo.rbox(0.18, 0.1, 0.2, 0.04), mat('paint_teal'), s * 0.3, 0.54, 0); // pauldrons
  mesh(rig.armR, geo.rbox(0.07, 0.07, 0.5, 0.02), mat('blackened'), 0, -0.45, -0.22); // stun rifle
  mesh(rig.armR, geo.box(0.03, 0.03, 0.08), mat('glow_amber'), 0, -0.45, -0.49);
  return rig;
}

interface Palette { color?: number; accent?: number }

function robot(pal: Palette = {}): NpcRig {
  const root = new THREE.Group();
  const h = 1.7;
  const metal = pal.accent !== undefined ? solidMat(pal.accent, 0.45, 0.6) : mat('steel_dark');
  const red = pal.color !== undefined ? solidMat(pal.color, 0.45, 0.35) : mat('paint_coral');
  const feet = -h / 2;
  const hip = feet + h * 0.42;
  const torso = joint(root, 0, hip, 0);
  // Inverted-triangle silhouette: wide shoulders, narrow waist.
  mesh(torso, geo.cyl(0.36, 0.14, 0.62, 6), red, 0, 0.33, 0);
  mesh(torso, geo.sphere(0.13, 12), mat('glow_coral'), 0, 0.37, -0.25);
  mesh(torso, geo.cyl(0.12, 0.12, 0.14, 10), metal, 0, 0, 0);
  const head = joint(torso, 0, 0.68, 0);
  mesh(head, geo.rbox(0.34, 0.2, 0.26, 0.04), metal, 0, 0.08, 0);
  mesh(head, geo.rbox(0.28, 0.05, 0.03, 0.01), mat('glow_coral'), 0, 0.09, -0.135);
  mesh(head, geo.cyl(0.012, 0.012, 0.3, 6), mat('steel'), 0.1, 0.32, 0);
  mesh(head, geo.sphere(0.03, 8), mat('glow_coral'), 0.1, 0.47, 0);
  const arm = (s: number) => {
    const j = joint(torso, s * 0.45, 0.55, 0);
    mesh(j, geo.sphere(0.11, 10), metal);
    mesh(j, geo.rbox(0.09, 0.32, 0.09, 0.03), mat('steel'), 0, -0.2, 0);
    mesh(j, geo.cyl(0.075, 0.09, 0.28, 8), red, 0, -0.45, -0.04, 0.2);
    return j;
  };
  const leg = (s: number) => {
    const j = joint(root, s * 0.15, hip, 0);
    mesh(j, geo.rbox(0.1, 0.36, 0.1, 0.03), mat('steel'), 0, -0.17, 0.03, 0.2);
    mesh(j, geo.rbox(0.09, 0.34, 0.09, 0.03), metal, 0, -0.45, 0.03, -0.15);
    mesh(j, geo.rbox(0.18, 0.08, 0.32, 0.03), metal, 0, -0.67, -0.06);
    return j;
  };
  return { root, head, torso, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1), extra: [], bob: 0.05, stride: 0.9 };
}

function heavy(pal: Palette = {}): NpcRig {
  const root = new THREE.Group();
  const h = 2.6;
  const feet = -h / 2;
  const hip = feet + 1.05;
  const armor = pal.color !== undefined ? solidMat(pal.color, 0.5, 0.35) : mat('paint_amber');
  const dark = pal.accent !== undefined ? solidMat(pal.accent, 0.45, 0.6) : mat('steel_dark');
  const torso = joint(root, 0, hip, 0);
  mesh(torso, geo.rbox(1.3, 1.0, 0.9, 0.12), armor, 0, 0.6, 0);
  mesh(torso, geo.box(1.32, 0.18, 0.92), mat('hazard'), 0, 0.28, 0);
  mesh(torso, geo.cyl(0.2, 0.2, 0.08, 16), mat('glow_coral'), 0, 0.72, -0.46, Math.PI / 2);
  const head = joint(torso, 0, 1.13, -0.1);
  mesh(head, geo.rbox(0.48, 0.24, 0.42, 0.06), dark, 0, 0.1, 0);
  mesh(head, geo.rbox(0.36, 0.05, 0.02, 0.01), mat('glow_coral'), 0, 0.11, -0.215);
  const arm = (s: number) => {
    const j = joint(torso, s * 0.86, 0.92, 0);
    mesh(j, geo.rbox(0.42, 0.42, 0.42, 0.08), dark);
    mesh(j, geo.rbox(0.28, 0.7, 0.28, 0.05), mat('steel'), 0, -0.5, 0);
    mesh(j, geo.rbox(0.5, 0.5, 0.5, 0.08), armor, 0, -1.05, 0);
    return j;
  };
  const leg = (s: number) => {
    const j = joint(root, s * 0.42, hip, 0);
    mesh(j, geo.rbox(0.36, 0.56, 0.36, 0.06), dark, 0, -0.3, 0);
    mesh(j, geo.rbox(0.42, 0.34, 0.42, 0.06), mat('steel'), 0, -0.72, 0);
    mesh(j, geo.rbox(0.56, 0.16, 0.72, 0.04), dark, 0, -0.97, -0.08);
    return j;
  };
  return { root, head, torso, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1), extra: [], bob: 0.05, stride: 0.45 };
}

/** A plain person in the given colours, for types that don't need a bespoke silhouette. */
function plainHumanoid(pal: Palette = {}): NpcRig {
  const rig = humanoid(1.8, solidMat(pal.color ?? 0x7a8b99, 0.6, 0.1), solidMat(pal.accent ?? 0x2d3a44, 0.8, 0), mat('rubber'));
  mesh(rig.head, geo.sphere(0.16, 16), solidMat(0xd9a982, 0.7, 0), 0, 0.09, 0);
  return rig;
}

function creature(pal: Palette = {}): NpcRig {
  const root = new THREE.Group();
  const skin = solidMat(pal.color ?? 0x74d66a, 0.45, 0.05);
  const torso = joint(root, 0, -0.02, 0);
  mesh(torso, geo.sphere(0.33, 16), skin);
  mesh(torso, geo.sphere(0.21, 14), solidMat(0xc7f0a6, 0.5, 0), 0, -0.1, -0.15);
  const head = joint(torso, 0, 0.13, -0.26);
  for (const s of [-1, 1]) {
    mesh(head, geo.cyl(0.018, 0.024, 0.2, 8), skin, s * 0.1, 0.21, 0.05, 0, 0, -s * 0.25);
    mesh(head, geo.sphere(0.075, 12), mat('paint_white'), s * 0.13, 0.31, 0.05);
    mesh(head, geo.sphere(0.035, 8), mat('blackened'), s * 0.13, 0.31, -0.01);
  }
  const limb = (x: number, z: number) => {
    const j = joint(root, x, -0.2, z);
    mesh(j, geo.cyl(0.05, 0.07, 0.2, 8), skin, 0, -0.09, 0);
    mesh(j, geo.sphere(0.07, 8), solidMat(0x55a84e, 0.5, 0), 0, -0.18, -0.03);
    return j;
  };
  return { root, head, torso, armL: limb(-0.2, -0.16), armR: limb(0.2, -0.16), legL: limb(-0.2, 0.16), legR: limb(0.2, 0.16), extra: [], bob: 0.12, stride: 0.7 };
}

const BASES: Record<NpcModelSpec['base'], (pal: Palette) => NpcRig> = { technician, guard, robot, heavy, creature, humanoid: plainHumanoid };

function attachPoint(rig: NpcRig, part: ModelPart): THREE.Object3D {
  switch (part.attach) {
    case 'torso': return rig.torso;
    case 'head': return rig.head;
    case 'arm_l': return rig.armL;
    case 'arm_r': return rig.armR;
    case 'leg_l': return rig.legL;
    case 'leg_r': return rig.legR;
    default: return rig.root;
  }
}

/** `archetype` is an NPC type id. Types with a data model use it, the original five use their names. */
export function buildNpcModel(archetype: string): NpcRig {
  const spec = NPC_PROFILES[archetype]?.model;
  const make = spec ? BASES[spec.base] : (BASES as Record<string, (p: Palette) => NpcRig>)[archetype] ?? creature;
  const rig = make({ color: spec?.color, accent: spec?.accent });
  rig.torso.userData.baseY = rig.torso.position.y;
  for (const p of spec?.parts ?? []) attachPoint(rig, p).add(buildPart(p));
  if (spec?.scale) rig.root.scale.setScalar(spec.scale);
  return rig;
}

export function animateRig(rig: NpcRig, phase: number, speed01: number, t: number): void {
  const s = Math.sin(phase) * rig.stride * speed01;
  rig.legL.rotation.x = s;
  rig.legR.rotation.x = -s;
  rig.armL.rotation.x = -s * 0.8;
  rig.armR.rotation.x = s * 0.8;
  rig.torso.position.y = rig.torso.userData.baseY + Math.abs(Math.cos(phase)) * rig.bob * speed01 + Math.sin(t * 1.8) * 0.006;
  rig.head.rotation.y = Math.sin(t * 0.7) * 0.25 * (1 - speed01);
}
