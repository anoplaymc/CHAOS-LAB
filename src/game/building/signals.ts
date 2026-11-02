/** Typed signal graph. Pure logic so loops and port rules can be unit-tested without a world. */
export type PortKind = 'in' | 'out';

export interface SignalNode {
  id: number;
  hasIn: boolean;
  hasOut: boolean;
}

export interface Wire {
  from: number;
  to: number;
}

export type WireError = 'self' | 'noOutput' | 'noInput' | 'duplicate' | 'cycle' | 'missing' | 'limit';

export const MAX_WIRES = 256;

export class SignalGraph {
  private nodes = new Map<number, SignalNode>();
  private wires: Wire[] = [];
  private order: number[] = [];
  private dirty = true;

  addNode(n: SignalNode): void {
    this.nodes.set(n.id, n);
    this.dirty = true;
  }

  removeNode(id: number): Wire[] {
    this.nodes.delete(id);
    const removed = this.wires.filter((w) => w.from === id || w.to === id);
    this.wires = this.wires.filter((w) => w.from !== id && w.to !== id);
    this.dirty = true;
    return removed;
  }

  get allWires(): readonly Wire[] {
    return this.wires;
  }

  wiresOf(id: number): Wire[] {
    return this.wires.filter((w) => w.from === id || w.to === id);
  }

  hasInput(id: number): boolean {
    return this.wires.some((w) => w.to === id);
  }

  has(from: number, to: number): boolean {
    return this.wires.some((w) => w.from === from && w.to === to);
  }

  canConnect(from: number, to: number): WireError | null {
    const a = this.nodes.get(from);
    const b = this.nodes.get(to);
    if (!a || !b) return 'missing';
    if (from === to) return 'self';
    if (!a.hasOut) return 'noOutput';
    if (!b.hasIn) return 'noInput';
    if (this.has(from, to)) return 'duplicate';
    if (this.wires.length >= MAX_WIRES) return 'limit';
    if (this.reaches(to, from)) return 'cycle';
    return null;
  }

  connect(from: number, to: number): WireError | null {
    const err = this.canConnect(from, to);
    if (err) return err;
    this.wires.push({ from, to });
    this.dirty = true;
    return null;
  }

  disconnect(from: number, to: number): boolean {
    const before = this.wires.length;
    this.wires = this.wires.filter((w) => !(w.from === from && w.to === to));
    this.dirty = true;
    return this.wires.length !== before;
  }

  clear(): void {
    this.nodes.clear();
    this.wires = [];
    this.dirty = true;
  }

  private reaches(start: number, goal: number): boolean {
    const seen = new Set<number>();
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === goal) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const w of this.wires) if (w.from === n) stack.push(w.to);
    }
    return false;
  }

  /** Topological order. Cycles cannot be created through connect(), and Kahn's algorithm ignores any remainder. */
  private rebuildOrder(): void {
    const indeg = new Map<number, number>();
    for (const id of this.nodes.keys()) indeg.set(id, 0);
    for (const w of this.wires) indeg.set(w.to, (indeg.get(w.to) ?? 0) + 1);
    const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    this.order = [];
    while (queue.length) {
      const n = queue.shift()!;
      this.order.push(n);
      for (const w of this.wires) {
        if (w.from !== n) continue;
        const d = indeg.get(w.to)! - 1;
        indeg.set(w.to, d);
        if (d === 0) queue.push(w.to);
      }
    }
    this.dirty = false;
  }

  /**
   * One propagation pass in dependency order, so a chain settles in one tick and every node is visited once.
   * `output(id, inputLevel)` computes a node's output, `input(id, level)` delivers its input.
   */
  evaluate(output: (id: number, input: boolean, wired: boolean) => boolean, input: (id: number, level: boolean) => void): void {
    if (this.dirty) this.rebuildOrder();
    const out = new Map<number, boolean>();
    for (const id of this.order) {
      let level = false;
      let wired = false;
      for (const w of this.wires) {
        if (w.to !== id) continue;
        wired = true;
        if (out.get(w.from)) level = true;
      }
      if (wired) input(id, level);
      out.set(id, output(id, level, wired));
    }
    this.levels = out;
  }

  levels = new Map<number, boolean>();
}
