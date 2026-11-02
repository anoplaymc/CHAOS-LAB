/** Small pure timing primitives shared by tools. Everything is tick-driven so tests need no real clock. */
export class Cooldown {
  remaining = 0;
  constructor(public duration: number) {}
  get ready(): boolean {
    return this.remaining <= 0;
  }
  /** Returns false when still cooling down. */
  trigger(): boolean {
    if (!this.ready) return false;
    this.remaining = this.duration;
    return true;
  }
  tick(dt: number): void {
    this.remaining = Math.max(0, this.remaining - dt);
  }
  get fraction(): number {
    return this.duration > 0 ? this.remaining / this.duration : 0;
  }
  reset(): void {
    this.remaining = 0;
  }
}

export class EnergyPool {
  value: number;
  /** Set when emptied. Blocks use until recovered to `recoverAt` or a reload. */
  overheated = false;
  constructor(public max: number, public regen: number, public recoverAt = 0.35) {
    this.value = max;
  }
  spend(amount: number): boolean {
    if (this.overheated || this.value < amount) {
      if (this.value < amount) this.overheated = true;
      return false;
    }
    this.value -= amount;
    if (this.value <= 0) this.overheated = true;
    return true;
  }
  tick(dt: number): void {
    this.value = Math.min(this.max, this.value + this.regen * dt);
    if (this.overheated && this.value >= this.max * this.recoverAt) this.overheated = false;
  }
  refill(): void {
    this.value = this.max;
    this.overheated = false;
  }
  get fraction(): number {
    return this.value / this.max;
  }
}

/** Timer map keyed by id. `apply` runs on first add; `restore` runs on expiry or explicit release. */
export class StatusTimers<S> {
  private items = new Map<number, { left: number; state: S }>();
  constructor(private restore: (id: number, state: S) => void) {}
  add(id: number, seconds: number, makeState: () => S): boolean {
    const cur = this.items.get(id);
    if (cur) {
      cur.left = Math.max(cur.left, seconds);
      return false;
    }
    this.items.set(id, { left: seconds, state: makeState() });
    return true;
  }
  has(id: number): boolean {
    return this.items.has(id);
  }
  remaining(id: number): number {
    return this.items.get(id)?.left ?? 0;
  }
  tick(dt: number): void {
    for (const [id, item] of this.items) {
      item.left -= dt;
      if (item.left <= 0) {
        this.items.delete(id);
        this.restore(id, item.state);
      }
    }
  }
  /** Ends a status early and restores it. */
  release(id: number): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.delete(id);
    this.restore(id, item.state);
    return true;
  }
  /** Forgets a status without restoring: for entities that no longer exist. */
  forget(id: number): void {
    this.items.delete(id);
  }
  releaseAll(): void {
    for (const id of [...this.items.keys()]) this.release(id);
  }
  clear(): void {
    this.items.clear();
  }
  get size(): number {
    return this.items.size;
  }
}
