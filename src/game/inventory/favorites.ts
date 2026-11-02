interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

const KEY = 'chaoslab.inventory.v1';
const MAX_RECENT = 12;

function storage(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Favourites and recently used items for the spawn menu. Small enough for localStorage. */
export class Inventory {
  favorites = new Set<string>();
  recent: string[] = [];

  constructor(private kv: KV | null = storage()) {
    try {
      const raw = JSON.parse(kv?.getItem(KEY) ?? '{}') as { favorites?: unknown; recent?: unknown };
      if (Array.isArray(raw.favorites)) this.favorites = new Set(raw.favorites.filter((x) => typeof x === 'string'));
      if (Array.isArray(raw.recent)) this.recent = raw.recent.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT);
    } catch {
      // Corrupt inventory data just means starting empty.
    }
  }

  private persist(): void {
    try {
      this.kv?.setItem(KEY, JSON.stringify({ favorites: [...this.favorites], recent: this.recent }));
    } catch {
      // Blocked storage: they last for the session.
    }
  }

  toggleFavorite(id: string): boolean {
    const on = !this.favorites.has(id);
    if (on) this.favorites.add(id);
    else this.favorites.delete(id);
    this.persist();
    return on;
  }

  touch(id: string): void {
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, MAX_RECENT);
    this.persist();
  }
}
