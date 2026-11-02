import type { V3 } from '../../utils/math';

export interface NavBounds { minX: number; maxX: number; minZ: number; maxZ: number; topY: number; bottomY: number }

/**
 * Single-layer height-grid navigation. Good for floors and low platforms; it does not understand
 * overlapping floors or jump links. NPCs that cannot path fall back to direct steering.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly walk: Uint8Array;
  readonly heights: Float32Array;

  constructor(readonly minX: number, readonly minZ: number, maxX: number, maxZ: number, readonly cell: number) {
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cell));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
    this.walk = new Uint8Array(this.cols * this.rows);
    this.heights = new Float32Array(this.cols * this.rows);
  }

  idx(c: number, r: number): number {
    return r * this.cols + c;
  }

  inBounds(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  cellOf(p: { x: number; z: number }): [number, number] {
    return [Math.floor((p.x - this.minX) / this.cell), Math.floor((p.z - this.minZ) / this.cell)];
  }

  center(c: number, r: number): V3 {
    return { x: this.minX + (c + 0.5) * this.cell, y: this.heights[this.idx(c, r)]!, z: this.minZ + (r + 0.5) * this.cell };
  }

  private passable(c: number, r: number): boolean {
    return this.inBounds(c, r) && this.walk[this.idx(c, r)] === 1;
  }

  private stepOk(c0: number, r0: number, c1: number, r1: number): boolean {
    return Math.abs(this.heights[this.idx(c0, r0)]! - this.heights[this.idx(c1, r1)]!) <= 0.6;
  }

  /** Nearest walkable cell in growing rings. */
  nearestWalkable(p: { x: number; z: number }, maxRing = 6): [number, number] | null {
    const [c0, r0] = this.cellOf(p);
    if (this.passable(c0, r0)) return [c0, r0];
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          if (this.passable(c0 + dc, r0 + dr)) return [c0 + dc, r0 + dr];
        }
      }
    }
    return null;
  }

  /** A* over the 8-connected grid. No corner cutting. Expansions are capped to bound frame cost. */
  findPath(from: { x: number; z: number }, to: { x: number; z: number }, maxExpansions = 2500): V3[] | null {
    const start = this.nearestWalkable(from);
    const goal = this.nearestWalkable(to);
    if (!start || !goal) return null;
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const startI = this.idx(start[0], start[1]);
    const goalI = this.idx(goal[0], goal[1]);
    g[startI] = 0;
    const h = (c: number, r: number) => {
      const dc = Math.abs(c - goal[0]);
      const dr = Math.abs(r - goal[1]);
      return dc + dr + (Math.SQRT2 - 2) * Math.min(dc, dr);
    };
    heap.push(startI, h(start[0], start[1]));
    let expansions = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goalI) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expansions > maxExpansions) return null;
      const r = Math.floor(cur / this.cols);
      const c = cur - r * this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (!this.passable(nc, nr) || !this.stepOk(c, r, nc, nr)) continue;
          if (dc !== 0 && dr !== 0 && (!this.passable(c + dc, r) || !this.passable(c, r + dr))) continue;
          const ni = this.idx(nc, nr);
          const cost = g[cur]! + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
          if (cost < g[ni]!) {
            g[ni] = cost;
            parent[ni] = cur;
            heap.push(ni, cost + h(nc, nr));
          }
        }
      }
    }
    if (parent[goalI] === -1 && goalI !== startI) return null;
    const path: V3[] = [];
    let i = goalI;
    while (i !== -1) {
      const r = Math.floor(i / this.cols);
      path.push(this.center(i - r * this.cols, r));
      i = parent[i]!;
    }
    path.reverse();
    return this.simplify(path);
  }

  /** Drops points on straight runs: fewer corners means smoother steering. */
  private simplify(path: V3[]): V3[] {
    if (path.length < 3) return path;
    const out = [path[0]!];
    for (let i = 1; i < path.length - 1; i++) {
      const a = out[out.length - 1]!;
      const b = path[i]!;
      const c = path[i + 1]!;
      const d1x = Math.sign(b.x - a.x);
      const d1z = Math.sign(b.z - a.z);
      const d2x = Math.sign(c.x - b.x);
      const d2z = Math.sign(c.z - b.z);
      if (d1x !== d2x || d1z !== d2z) out.push(b);
    }
    out.push(path[path.length - 1]!);
    return out;
  }

  randomNear(p: { x: number; z: number }, radius: number): V3 | null {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * radius;
      const q = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
      const [c, r] = this.cellOf(q);
      if (this.passable(c, r)) return this.center(c, r);
    }
    return null;
  }
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.prio[up]! <= this.prio[i]!) break;
      this.swap(i, up);
      i = up;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastI = this.items.pop()!;
    const lastP = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastI;
      this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}
