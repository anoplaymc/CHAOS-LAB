/** Pure bookkeeping for entity ids and limits, independent from physics and rendering. */
export interface Limits {
  total: number;
  npcs: number;
  vehicles: number;
}

/** Fixture ids are assigned from here in build order, so they stay stable between loads of the same map. */
export const FIXTURE_ID_BASE = 1_000_000;

export const DEFAULT_LIMITS: Limits = { total: 400, npcs: 32, vehicles: 6 };

export type LimitReason = 'total' | 'npcs' | 'vehicles';

export interface Registered {
  id: number;
  kind: string;
  /** Map fixtures do not count against the player's budget. */
  fixture: boolean;
}

export class EntityRegistry<T extends Registered> {
  private items = new Map<number, T>();
  private next = 1;
  private budgeted = 0;
  private counts = { npc: 0, vehicle: 0 };
  limits: Limits = { ...DEFAULT_LIMITS };

  allocId(requested?: number): number {
    if (requested !== undefined && !this.items.has(requested)) {
      if (requested < FIXTURE_ID_BASE) this.next = Math.max(this.next, requested + 1);
      return requested;
    }
    return this.next++;
  }

  check(kind: string): LimitReason | null {
    if (this.budgeted >= this.limits.total) return 'total';
    if (kind === 'npc' && this.counts.npc >= this.limits.npcs) return 'npcs';
    if (kind === 'vehicle' && this.counts.vehicle >= this.limits.vehicles) return 'vehicles';
    return null;
  }

  add(item: T): void {
    if (this.items.has(item.id)) throw new Error(`Duplicate entity id ${item.id}`);
    this.items.set(item.id, item);
    if (!item.fixture) this.budgeted++;
    if (item.kind === 'npc') this.counts.npc++;
    if (item.kind === 'vehicle') this.counts.vehicle++;
  }

  remove(id: number): T | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;
    this.items.delete(id);
    if (!item.fixture) this.budgeted--;
    if (item.kind === 'npc') this.counts.npc--;
    if (item.kind === 'vehicle') this.counts.vehicle--;
    return item;
  }

  get(id: number): T | undefined {
    return this.items.get(id);
  }

  all(): IterableIterator<T> {
    return this.items.values();
  }

  get size(): number {
    return this.items.size;
  }
  get budgetUsed(): number {
    return this.budgeted;
  }
  get npcCount(): number {
    return this.counts.npc;
  }
  get nextId(): number {
    return this.next;
  }
  set nextId(v: number) {
    this.next = Math.max(this.next, v);
  }

  clear(): void {
    this.items.clear();
    this.budgeted = 0;
    this.counts = { npc: 0, vehicle: 0 };
    this.next = 1;
  }
}
