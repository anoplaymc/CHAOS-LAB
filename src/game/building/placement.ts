import * as THREE from 'three';
import type { ItemDef, ShapeDef } from '../../data/items';
import { halfExtents } from '../../rendering/geometry';
import { snap, type Q4, type V3 } from '../../utils/math';

export const GRID_STEPS = [0, 0.25, 0.5, 1];
export const ANGLE_STEPS = [0, 15, 45, 90];
/** How far above a surface objects are placed, to keep them from starting in contact. */
export const SURFACE_GAP = 0.012;
export const MAX_PLACE_DISTANCE = 14;

const tmpQ = new THREE.Quaternion();

/**
 * The distance from a shape's centre to its support plane along a world direction.
 * Boxes project their half extents; round shapes use their radius.
 */
export function supportDistance(shape: ShapeDef, scale: number, rot: Q4, normal: V3): number {
  const [hx, hy, hz] = halfExtents(shape);
  tmpQ.set(rot.x, rot.y, rot.z, rot.w);
  if (shape.type === 'sphere') return hx * scale;
  const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(tmpQ);
  const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQ);
  const az = new THREE.Vector3(0, 0, 1).applyQuaternion(tmpQ);
  const n = new THREE.Vector3(normal.x, normal.y, normal.z);
  return (Math.abs(ax.dot(n)) * hx + Math.abs(ay.dot(n)) * hy + Math.abs(az.dot(n)) * hz) * scale;
}

export function snapPosition(p: V3, grid: number, normal: V3): V3 {
  if (grid <= 0) return { ...p };
  // Keep the coordinate along the surface normal: snapping it would push objects into their support.
  return {
    x: Math.abs(normal.x) > 0.7 ? p.x : snap(p.x, grid),
    y: Math.abs(normal.y) > 0.7 ? p.y : snap(p.y, grid),
    z: Math.abs(normal.z) > 0.7 ? p.z : snap(p.z, grid),
  };
}

export function snapAngle(deg: number, step: number): number {
  return step > 0 ? snap(deg, step) : deg;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Rotation from yaw + pitch, optionally aligned so the object's up axis follows the surface normal. */
export function placementRotation(yawDeg: number, pitchDeg: number, normal: V3 | null): Q4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0, 'YXZ'));
  if (normal) {
    const align = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(normal.x, normal.y, normal.z).normalize());
    q.premultiply(align);
  }
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export interface PlacementInput {
  def: ItemDef;
  scale: number;
  hit: { point: V3; normal: V3 } | null;
  /** Used when the aim ray hit nothing. */
  fallbackPoint: V3;
  yawDeg: number;
  pitchDeg: number;
  grid: number;
  angleStep: number;
  alignToSurface: boolean;
}

export interface PlacementPose {
  position: V3;
  rotation: Q4;
  normal: V3;
}

/** Pure placement maths: everything except the overlap test, which needs the physics world. */
export function computePlacement(i: PlacementInput): PlacementPose {
  const yaw = snapAngle(i.yawDeg, i.angleStep);
  const pitch = snapAngle(i.pitchDeg, i.angleStep);
  const normal = i.hit?.normal ?? { x: 0, y: 1, z: 0 };
  const rotation = placementRotation(yaw, pitch, i.alignToSurface && i.hit ? normal : null);
  if (!i.hit) return { position: snapPosition(i.fallbackPoint, i.grid, { x: 0, y: 0, z: 0 }), rotation, normal };
  const support = supportDistance(i.def.shape, i.scale, rotation, normal) + SURFACE_GAP;
  const snapped = snapPosition(i.hit.point, i.grid, normal);
  return {
    position: { x: snapped.x + normal.x * support, y: snapped.y + normal.y * support, z: snapped.z + normal.z * support },
    rotation,
    normal,
  };
}
