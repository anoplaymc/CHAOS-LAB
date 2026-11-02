import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { KeyValueDb } from '../game/save/SaveStore';

it('does not hang when an older tab is holding the database, and keeps working from memory', async () => {
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('chaoslab', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('saves'); r.result.createObjectStore('layouts'); r.result.createObjectStore('packs'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const db = new KeyValueDb();
  expect(await db.keys('mods')).toEqual([]);
  await db.put('mods', 'a', { enabled: true });
  expect(await db.get('mods', 'a')).toEqual({ enabled: true });
  expect(db.durable).toBe(false);
  old.close();
});

it('upgrades the database once nothing holds it, keeping existing data', async () => {
  const name = 'chaoslab';
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { for (const s of ['saves', 'layouts', 'packs']) r.result.createObjectStore(s); };
    r.onsuccess = () => {
      const t = r.result.transaction('packs', 'readwrite');
      t.objectStore('packs').put({ kept: true }, 'old');
      t.oncomplete = () => { r.result.close(); resolve(); };
    };
    r.onerror = () => reject(r.error);
  });
  const db = new KeyValueDb();
  expect(await db.get('packs', 'old')).toEqual({ kept: true });
  await db.put('mods', 'a', { enabled: false });
  expect(await db.get('mods', 'a')).toEqual({ enabled: false });
  expect(db.durable).toBe(true);
});
