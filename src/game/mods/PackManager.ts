import { catalog } from '../../data/items';
import { materials } from '../../data/materials';
import { KeyValueDb } from '../save/SaveStore';
import type { MapDef } from '../maps/MapBuilder';
import { packMapDef, parsePackText, validatePack, type ContentPack, type PackValidation } from './pack';

export interface InstalledPack { pack: ContentPack; enabled: boolean; problem: string | null }

/** Installs, persists and activates packs. Activation is atomic: validation happens before any registry changes. */
export class PackManager {
  private installed = new Map<string, InstalledPack>();
  constructor(private db: KeyValueDb, private maps: Record<string, MapDef>) {}

  list(): InstalledPack[] {
    return [...this.installed.values()];
  }

  private activate(p: ContentPack): void {
    for (const m of p.materials) materials.add(m);
    for (const e of p.entities) catalog.add(e);
    for (const m of p.maps) this.maps[m.id] = packMapDef(m);
  }

  private deactivate(p: ContentPack): void {
    catalog.removeBySource(p.id);
    materials.removeBySource(p.id);
    for (const m of p.maps) delete this.maps[m.id];
  }

  private persist(p: InstalledPack): Promise<void> {
    return this.db.put('packs', p.pack.id, { pack: p.pack, enabled: p.enabled });
  }

  /** Loads saved packs at startup, re-validating each. A bad record is reported rather than crashing boot. */
  async restore(): Promise<void> {
    const stored: { pack: unknown; enabled: boolean }[] = [];
    for (const key of await this.db.keys('packs')) {
      const r = await this.db.get<{ pack: unknown; enabled: boolean }>('packs', key);
      if (r) stored.push(r);
    }
    // Stored packs hold validated, namespaced data. Dependencies are checked once all are known.
    for (const s of stored) {
      const p = s.pack as ContentPack;
      if (!p || typeof p.id !== 'string' || !Array.isArray(p.entities)) continue;
      this.installed.set(p.id, { pack: p, enabled: s.enabled === true, problem: null });
    }
    this.resolve();
  }

  /** Enables everything enabled whose dependencies are present and enabled, in dependency order. */
  private resolve(): void {
    const active = new Set<string>();
    const queue = [...this.installed.values()];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const i of queue) {
        if (active.has(i.pack.id) || !i.enabled) continue;
        if (i.pack.dependencies.every((d) => active.has(d))) {
          this.deactivate(i.pack);
          this.activate(i.pack);
          active.add(i.pack.id);
          i.problem = null;
          progressed = true;
        }
      }
    }
    for (const i of queue) {
      if (active.has(i.pack.id)) continue;
      this.deactivate(i.pack);
      const missing = i.pack.dependencies.filter((d) => !active.has(d));
      i.problem = i.enabled && missing.length ? `Needs: ${missing.join(', ')}` : null;
    }
  }

  /** Validates and installs a pack from JSON text. On failure nothing at all has changed. */
  async importText(text: string): Promise<PackValidation> {
    const ids = [...this.installed.keys()];
    let replacing: string | undefined;
    try {
      const peek = JSON.parse(text) as { id?: unknown };
      if (typeof peek?.id === 'string' && this.installed.has(peek.id)) replacing = peek.id;
    } catch {
      // parsePackText reports it.
    }
    const old = replacing ? this.installed.get(replacing) : undefined;
    if (old) this.deactivate(old.pack);
    const result = parsePackText(text, { installedIds: ids, replacing });
    if (!result.pack) {
      if (old?.enabled) this.activate(old.pack);
      return result;
    }
    const entry: InstalledPack = { pack: result.pack, enabled: true, problem: null };
    this.installed.set(result.pack.id, entry);
    this.resolve();
    await this.persist(entry);
    return result;
  }

  validateOnly(raw: unknown): PackValidation {
    return validatePack(raw, { installedIds: [...this.installed.keys()] });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const i = this.installed.get(id);
    if (!i) return;
    i.enabled = enabled;
    this.resolve();
    await this.persist(i);
  }

  async remove(id: string): Promise<void> {
    const i = this.installed.get(id);
    if (!i) return;
    this.deactivate(i.pack);
    this.installed.delete(id);
    this.resolve();
    await this.db.delete('packs', id);
  }
}
