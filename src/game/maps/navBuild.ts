import { NavGrid, type NavBounds } from '../npcs/NavGrid';
import { Group, RAPIER, type PhysicsWorld } from '../physics/PhysicsWorld';

/** Samples static geometry into a walkable height grid. Runs once per map load. */
export function buildNavGrid(physics: PhysicsWorld, b: NavBounds, cell = 1): NavGrid {
  const grid = new NavGrid(b.minX, b.minZ, b.maxX, b.maxZ, cell);
  const clearance = new RAPIER.Capsule(0.45, 0.42);
  const ID = { x: 0, y: 0, z: 0, w: 1 };
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const x = b.minX + (c + 0.5) * cell;
      const z = b.minZ + (r + 0.5) * cell;
      const hit = physics.raycast({ x, y: b.topY, z }, { x: 0, y: -1, z: 0 }, b.topY - b.bottomY, { mask: Group.STATIC });
      if (!hit || hit.normal.y < 0.7) continue;
      const i = grid.idx(c, r);
      grid.heights[i] = hit.point.y;
      const blocked = physics.isBlocked(clearance, { x, y: hit.point.y + 1.0, z }, ID, Group.STATIC);
      grid.walk[i] = blocked ? 0 : 1;
    }
  }
  return grid;
}
