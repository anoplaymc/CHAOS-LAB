import { validateSave, type SaveFile } from './schema';

const DB = 'chaoslab';
const VERSION = 2;
const STORES = ['saves', 'layouts', 'packs', 'mods', 'moddata'] as const;
export type StoreName = (typeof STORES)[number];

/** Promise wrapper over IndexedDB. When IndexedDB is blocked, data lives in memory for the session. */
export class KeyValueDb {
  private db: Promise<IDBDatabase> | null = null;
  private memory = new Map<string, Map<string, unknown>>();
  durable = true;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('IndexedDB unavailable'));
          return;
        }
        const req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = () => {
          for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
        };
        req.onsuccess = () => {
          // Lets a newer version of the game upgrade the database while this tab stays open.
          req.result.onversionchange = () => req.result.close();
          resolve(req.result);
        };
        req.onerror = () => reject(req.error);
        // An older tab is holding the database. This session runs from memory rather than waiting forever.
        req.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
      });
    }
    return this.db;
  }

  private mem(store: StoreName): Map<string, unknown> {
    let m = this.memory.get(store);
    if (!m) this.memory.set(store, (m = new Map()));
    return m;
  }

  private async tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = run(t.objectStore(store));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async put(store: StoreName, key: string, value: unknown): Promise<void> {
    try {
      await this.tx(store, 'readwrite', (s) => s.put(value, key));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') throw new Error('Browser storage is full.');
      this.durable = false;
      this.mem(store).set(key, value);
    }
  }

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    try {
      return await this.tx<T>(store, 'readonly', (s) => s.get(key));
    } catch {
      this.durable = false;
      return this.mem(store).get(key) as T | undefined;
    }
  }

  async delete(store: StoreName, key: string): Promise<void> {
    try {
      await this.tx(store, 'readwrite', (s) => s.delete(key));
    } catch {
      this.mem(store).delete(key);
    }
  }

  async keys(store: StoreName): Promise<string[]> {
    try {
      return (await this.tx(store, 'readonly', (s) => s.getAllKeys())).map(String);
    } catch {
      this.durable = false;
      return [...this.mem(store).keys()];
    }
  }
}

export interface SaveSummary { slot: string; name: string; map: string; createdAt: string; count: number; corrupt: boolean }

/** Named slots for scenes and custom layouts. Anything read back is re-validated. */
export class SaveStore {
  constructor(readonly db = new KeyValueDb()) {}

  private store(kind: SaveFile['kind']): StoreName {
    return kind === 'layout' ? 'layouts' : 'saves';
  }

  async write(slot: string, save: SaveFile): Promise<void> {
    await this.db.put(this.store(save.kind), slot, save);
  }

  async read(kind: SaveFile['kind'], slot: string): Promise<SaveFile | null> {
    const raw = await this.db.get<unknown>(this.store(kind), slot);
    if (raw === undefined) return null;
    const r = validateSave(raw);
    return r.ok ? r.value : null;
  }

  async remove(kind: SaveFile['kind'], slot: string): Promise<void> {
    await this.db.delete(this.store(kind), slot);
  }

  async list(kind: SaveFile['kind']): Promise<SaveSummary[]> {
    const out: SaveSummary[] = [];
    for (const slot of await this.db.keys(this.store(kind))) {
      const r = validateSave(await this.db.get<unknown>(this.store(kind), slot));
      out.push(r.ok
        ? { slot, name: r.value.name, map: r.value.map, createdAt: r.value.createdAt, count: r.value.entities.length, corrupt: false }
        : { slot, name: slot, map: '?', createdAt: '', count: 0, corrupt: true });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
