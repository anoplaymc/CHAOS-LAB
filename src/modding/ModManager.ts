import { ChaosError, type Chunk, type Diagnostic, type Plain, parse, toDisplay, type Value } from '../chaosscript';
import type { Loc } from '../data/materials';
import { catalog } from '../data/items';
import { MODE_INFO, TOOL_TYPES, unregisterSource, MAP_STORE } from '../game/content/registry';
import type { Game } from '../game/core/Game';
import type { Entity } from '../game/entities/Entity';
import { apiCompatible, parseManifest, safePath, satisfies, type Manifest } from './manifest';
import { checkScripts, ModHost, type LogLevel } from './ModHost';

export type ModOrigin = 'builtin' | 'dev' | 'local';

/** The mod as files. Every source (bundled, dev server, installed) produces this. */
export interface ModBundle {
  origin: ModOrigin;
  /** mod.json as text. */
  manifest: string;
  /** Scripts, by path relative to the mod. */
  files: Record<string, string>;
  /** Image assets as data URLs. */
  assets?: Record<string, string>;
}

/** Where mods come from. The seam a future online workshop would plug into. */
export interface ModSource {
  readonly origin: ModOrigin;
  list(): Promise<ModBundle[]>;
}

export type ModState = 'disabled' | 'invalid' | 'blocked' | 'failed' | 'loaded' | 'faulted';

export interface ModRecord {
  /** From the manifest, or a placeholder when it couldn't be read. */
  id: string;
  manifest: Manifest | null;
  bundle: ModBundle;
  origin: ModOrigin;
  enabled: boolean;
  state: ModState;
  /** Why it isn't working, for people. */
  errors: string[];
  warnings: string[];
  diagnostics: Diagnostic[];
  host: ModHost | null;
  /** What it registered. */
  content: { items: string[]; maps: string[]; modes: string[]; tools: string[] };
  /** A builtin mod has an edited copy in local storage. */
  overridesBuiltin: boolean;
}

export interface ImportPreview {
  manifest: Manifest | null;
  errors: string[];
  warnings: string[];
  /** The mod already known by this id, which installing would take the place of. */
  replaces: { name: string; version: string; bundled: boolean } | null;
  dependencies: { id: string; version: string; optional: boolean; status: 'ok' | 'missing' | 'wrong_version' | 'disabled' }[];
  /** Enabled mods that can't run alongside it. */
  conflicts: string[];
}

export interface LogEntry { n: number; time: number; mod: string; level: LogLevel; text: string; file?: string; line?: number }
export interface ModPanel { key: string; title?: Loc; lines: Loc[] }
export interface ModMenu { owner: string; title: Loc; text?: Loc; buttons: { label: Loc; close: boolean; run: () => void }[] }

const MAX_LOG = 600;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** Parses a .chaosmod.json bundle. Throws with a message for people. */
export function parseBundleText(text: string): ModBundle {
  if (text.length > MAX_BUNDLE_BYTES) throw new Error('This mod file is too large (8 MB limit).');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a valid .chaosmod.json file: it is not JSON.');
  }
  const r = raw as { format?: unknown; manifest?: unknown; files?: unknown; assets?: unknown };
  if (!r || typeof r !== 'object' || r.format !== 'chaosmod-1' || typeof r.manifest !== 'string' || typeof r.files !== 'object' || r.files === null) {
    throw new Error('This is not a .chaosmod.json bundle. Package a mod with: npm run mod -- pack mods/your_mod');
  }
  return { origin: 'local', manifest: r.manifest, files: strings(r.files), assets: r.assets && typeof r.assets === 'object' ? strings(r.assets) : {} };
}

function strings(o: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && safePath(k)) out[k] = v;
  return out;
}

export function bundleToText(b: ModBundle): string {
  return JSON.stringify({ format: 'chaosmod-1', manifest: b.manifest, files: b.files, assets: b.assets ?? {} }, null, 1);
}

interface Examined { manifest: Manifest | null; errors: string[]; warnings: string[]; diagnostics: Diagnostic[]; chunks: Chunk[] }

/** All checks that don't need running the mod. Touches nothing. */
export function examineBundle(b: ModBundle): Examined {
  let raw: unknown;
  try {
    raw = JSON.parse(b.manifest);
  } catch (e) {
    return { manifest: null, errors: [`mod.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`], warnings: [], diagnostics: [], chunks: [] };
  }
  const r = parseManifest(raw);
  const errors = [...r.errors];
  const warnings = [...r.warnings];
  if (!r.manifest) return { manifest: null, errors, warnings, diagnostics: [], chunks: [] };
  const m = r.manifest;
  if (!apiCompatible(m.api_version)) errors.push(`This mod needs API version ${m.api_version}, which this game does not provide.`);
  const scripts: { path: string; text: string }[] = [];
  for (const path of m.scripts) {
    const text = b.files[path];
    if (text === undefined) errors.push(`Script "${path}" is listed in mod.json but the file is missing.`);
    else scripts.push({ path, text });
  }
  for (const a of m.assets) {
    const url = b.assets?.[a];
    if (!url) errors.push(`Asset "${a}" is listed in mod.json but the file is missing.`);
    else if (!IMAGE_RE.test(url)) errors.push(`Asset "${a}" is not a readable PNG, JPEG or WebP image.`);
    else if (url.length > 2_000_000) errors.push(`Asset "${a}" is too large (about 1.5 MB limit).`);
  }
  const { chunks, diagnostics } = checkScripts(scripts);
  for (const d of diagnostics) {
    if (d.severity === 'warning') warnings.push(`${d.file}:${d.line}: ${d.message}`);
  }
  for (const d of diagnostics) {
    if (d.severity === 'error') errors.push(`${d.file}:${d.line}: ${d.message}`);
  }
  return { manifest: m, errors, warnings, diagnostics, chunks };
}

interface EntitySnapshot { state?: Record<string, unknown>; def: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number }; linvel?: { x: number; y: number; z: number }; scale: number; scriptData: Record<string, unknown> | null; tint: number | null }

/** Finds, validates, loads, reloads and unloads mods. A broken mod ends up as a record with errors, and nothing else happens. */
export class ModManager {
  private records = new Map<string, ModRecord>();
  private sources: ModSource[] = [];
  private enabledPref = new Map<string, boolean>();
  /** Mods that come from a source, as opposed to only being installed locally. */
  private shipped = new Set<string>();
  private storageCache = new Map<string, Record<string, Plain>>();
  private listeners = new Set<() => void>();
  private logListeners = new Set<() => void>();
  private entries: LogEntry[] = [];
  private logCounter = 0;
  private revision = 0;
  private emitDepth = 0;
  private console: ModHost | null = null;
  /** The mod whose files are running right now. It isn't in `order` until they finish. */
  private loading: ModHost | null = null;
  /** Hosts in load order. */
  private order: ModHost[] = [];
  sessionActive = false;
  /** Also writes mod errors to the browser console. The CLI reports them itself. */
  echoErrors = true;

  constructor(private game: Game) {
    const ev = game.events;
    ev.on('sessionReady', () => { this.sessionActive = true; });
    ev.on('sessionStarted', ({ map, mode }) => {
      this.broadcast('session_start', () => ({ map, mode }));
    });
    ev.on('sessionEnded', () => {
      this.broadcast('session_end', () => ({}));
      this.sessionActive = false;
      for (const h of this.order) h.sessionEnded();
      this.console?.sessionEnded();
      game.sandbox.sessionEnded();
      game.ui.set({ modPanels: [], modMenu: null, modForm: null });
    });
    ev.on('entitySpawned', (e) => { if (this.sessionActive) this.broadcast('entity_spawned', () => ({ id: e.id, def: e.def.id })); });
    ev.on('entityRemoved', (e) => { if (this.sessionActive) this.broadcast('entity_removed', () => ({ id: e.id, def: e.def.id })); });
    ev.on('entityDamaged', ({ entity, amount, source }) => this.broadcast('entity_damaged', () => ({ id: entity.id, def: entity.def.id, amount, source: source.kind, attacker: source.entity?.id ?? null })));
    ev.on('entityBroken', ({ entity }) => this.broadcast('entity_broken', () => ({ id: entity.id, def: entity.def.id })));
    ev.on('entityInteracted', ({ entity }) => this.broadcast('entity_used', () => ({ id: entity.id, def: entity.def.id })));
    ev.on('npcKilled', ({ npc, byPlayer }) => this.broadcast('npc_killed', () => ({ id: npc.e.id, def: npc.e.def.id, by_player: byPlayer })));
    ev.on('playerDamaged', ({ amount, source, attacker }) => this.broadcast('player_damaged', () => ({ amount, source, attacker: attacker?.id ?? null })));
    ev.on('playerDied', () => this.broadcast('player_died', () => ({})));
    ev.on('explosion', ({ position, radius }) => this.broadcast('explosion', () => ({ position, radius })));
    ev.on('toolEquipped', ({ id }) => this.broadcast('tool_selected', () => ({ id })));
    game.moddingTick = (dt) => {
      if (this.game.editing) return;
      for (const h of this.order) h.fixedUpdate(dt);
      this.console?.fixedUpdate(dt);
    };
  }

  private broadcast(event: string, payload: () => unknown): void {
    for (const h of [...this.order]) h.dispatch(event, payload);
    this.loading?.dispatch(event, payload);
    this.console?.dispatch(event, payload);
  }

  addSource(s: ModSource): void {
    this.sources.push(s);
  }

  // ── Reading state ──
  list(): ModRecord[] {
    return [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): ModRecord | undefined {
    return this.records.get(id);
  }

  isLoaded(id: string): boolean {
    const s = this.records.get(id)?.state;
    return s === 'loaded';
  }

  /** Bumps whenever something a UI would show has changed. */
  get rev(): number {
    return this.revision;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  changed(): void {
    this.revision++;
    for (const l of [...this.listeners]) l();
  }

  listenersChanged(): void {
    // Handlers are looked up per dispatch, so nothing needs refreshing yet.
  }

  // ── Log ──
  get logs(): readonly LogEntry[] {
    return this.entries;
  }

  subscribeLog = (fn: () => void): (() => void) => {
    this.logListeners.add(fn);
    return () => this.logListeners.delete(fn);
  };

  logEntry(mod: string, level: LogLevel, text: string, file?: string, line?: number): void {
    this.entries.push({ n: ++this.logCounter, time: this.game.time, mod, level, text: text.slice(0, 2000), file, line });
    if (this.entries.length > MAX_LOG) this.entries.splice(0, this.entries.length - MAX_LOG);
    for (const l of [...this.logListeners]) l();
    if (level === 'error' && this.echoErrors) console.warn(`[mod ${mod}] ${text}`);
  }

  clearLog(): void {
    this.entries = [];
    for (const l of [...this.logListeners]) l();
  }

  // ── Startup ──
  /** Reads saved preferences and all sources, then loads everything enabled. Can't throw: failures end up on records. */
  async restore(): Promise<void> {
    try {
      const db = this.game.saves.db;
      for (const key of await db.keys('mods')) {
        const v = await db.get<{ enabled?: boolean; bundle?: ModBundle }>('mods', key);
        if (typeof v?.enabled === 'boolean') this.enabledPref.set(key, v.enabled);
      }
      for (const key of await db.keys('moddata')) {
        const v = await db.get<Record<string, Plain>>('moddata', key);
        if (v) this.storageCache.set(key, v);
      }
    } catch (e) {
      console.warn('[CHAOS LAB] could not read mod preferences', e);
    }
    await this.rescan();
    this.loadAll();
  }

  /** Re-reads every source into records, without loading. */
  private async rescan(): Promise<void> {
    const found = new Map<string, ModBundle>();
    this.shipped.clear();
    // Later sources win, so a local edit shadows the builtin copy and the dev server shadows both.
    for (const s of this.sources) {
      try {
        for (const b of await s.list()) {
          const id = idOf(b, `${s.origin}?${found.size}`);
          found.set(id, b);
          this.shipped.add(id);
        }
      } catch (e) {
        this.logEntry('modloader', 'error', `Could not read mods from ${s.origin}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const [key, v] of await this.localBundles()) found.set(key, v);
    for (const [id, bundle] of found) this.updateRecord(id, bundle);
    for (const id of [...this.records.keys()]) if (!found.has(id) && this.records.get(id)!.state !== 'loaded' && !this.records.get(id)!.host) this.records.delete(id);
  }

  private async localBundles(): Promise<Map<string, ModBundle>> {
    const out = new Map<string, ModBundle>();
    try {
      const db = this.game.saves.db;
      for (const key of await db.keys('mods')) {
        const v = await db.get<{ bundle?: ModBundle }>('mods', key);
        if (v?.bundle) out.set(key, { ...v.bundle, origin: 'local' });
      }
    } catch {
      // Without storage, there are just no local mods.
    }
    return out;
  }

  private updateRecord(id: string, bundle: ModBundle): ModRecord {
    const x = examineBundle(bundle);
    const old = this.records.get(id);
    const pref = this.enabledPref.get(id);
    const rec: ModRecord = {
      id,
      manifest: x.manifest,
      bundle,
      origin: bundle.origin,
      enabled: pref ?? x.manifest?.enabled_by_default ?? false,
      state: old?.state === 'loaded' || old?.state === 'faulted' ? old.state : 'disabled',
      errors: [],
      warnings: x.warnings,
      diagnostics: x.diagnostics,
      host: old?.host ?? null,
      content: old?.content ?? { items: [], maps: [], modes: [], tools: [] },
      overridesBuiltin: bundle.origin === 'local' && this.shipped.has(id),
    };
    if (x.errors.length) {
      rec.state = rec.host ? rec.state : 'invalid';
      rec.errors = x.errors;
    }
    this.records.set(id, rec);
    return rec;
  }

  // ── Dependency resolution ──
  /** Load order for what should run, plus why anything else can't. Pure: changes nothing. */
  resolve(candidates: ModRecord[] = this.list()): { order: ModRecord[]; blocked: Map<string, string> } {
    const blocked = new Map<string, string>();
    const usable = candidates.filter((r) => r.enabled && r.manifest && !examineBundleCached(r).errors.length);
    const byId = new Map(usable.map((r) => [r.id, r]));

    // Declared conflicts: alphabetically first keeps running, and either side can declare it.
    for (const r of usable) {
      for (const other of byId.values()) {
        if (other === r || blocked.has(other.id) || blocked.has(r.id)) continue;
        if (r.manifest!.conflicts.includes(other.id) || other.manifest!.conflicts.includes(r.id)) {
          const [keep, drop] = r.id < other.id ? [r, other] : [other, r];
          blocked.set(drop.id, `Conflicts with "${keep.id}". Disable one of them.`);
        }
      }
    }
    // Dependencies, repeating because blocking one mod can block those depending on it.
    let again = true;
    while (again) {
      again = false;
      for (const r of usable) {
        if (blocked.has(r.id)) continue;
        for (const d of r.manifest!.dependencies) {
          const dep = this.records.get(d.id);
          let why: string | null = null;
          if (!dep || !dep.manifest) why = d.optional ? null : `Needs "${d.id}", which isn't installed.`;
          else if (!satisfies(dep.manifest.version, d.version)) why = d.optional ? null : `Needs "${d.id}" ${d.version}, but version ${dep.manifest.version} is installed.`;
          else if (!byId.has(d.id)) why = d.optional ? null : `Needs "${d.id}", which is ${dep.enabled ? 'not working' : 'disabled'}.`;
          else if (blocked.has(d.id)) why = d.optional ? null : `Needs "${d.id}", which can't load: ${blocked.get(d.id)}`;
          if (why) {
            blocked.set(r.id, why);
            again = true;
            break;
          }
        }
      }
    }
    // Topological order. Whatever can't be ordered is in or behind a cycle.
    const order: ModRecord[] = [];
    const done = new Set<string>();
    const pending = usable.filter((r) => !blocked.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));
    let progress = true;
    while (progress) {
      progress = false;
      for (const r of pending) {
        if (done.has(r.id)) continue;
        const ready = r.manifest!.dependencies.every((d) => done.has(d.id) || !byId.has(d.id) || blocked.has(d.id));
        if (ready) {
          order.push(r);
          done.add(r.id);
          progress = true;
        }
      }
    }
    for (const r of pending) {
      if (!done.has(r.id)) blocked.set(r.id, `Dependency cycle involving: ${pending.filter((x) => !done.has(x.id)).map((x) => x.id).join(', ')}.`);
    }
    return { order, blocked };
  }

  private loadAll(): void {
    const { order, blocked } = this.resolve();
    for (const r of this.list()) {
      if (r.host) continue;
      r.errors = examineBundleCached(r).errors;
      if (r.errors.length) r.state = 'invalid';
      else if (!r.enabled) r.state = 'disabled';
      else if (blocked.has(r.id)) {
        r.state = 'blocked';
        r.errors = [blocked.get(r.id)!];
      }
    }
    for (const r of order) {
      if (r.host) continue;
      // A dependency that failed while loading blocks this one.
      const dead = r.manifest!.dependencies.find((d) => !d.optional && !this.isLoaded(d.id));
      if (dead) {
        r.state = 'blocked';
        r.errors = [`Needs "${dead.id}", which failed to load.`];
        continue;
      }
      this.loadRecord(r);
    }
    this.changed();
  }

  private loadRecord(r: ModRecord): void {
    const m = r.manifest!;
    const x = examineBundleCached(r);
    r.errors = [];
    const host = new ModHost(this.game, this, m, r.bundle, this.storageCache.get(r.id) ?? null);
    const before = this.snapshotContent();
    this.loading = host;
    try {
      host.load(x.chunks);
      this.loading = null;
    } catch (e) {
      this.loading = null;
      const text = e instanceof ChaosError ? e.format() : e instanceof Error ? e.message : String(e);
      host.dispose();
      this.removeContent(r.id);
      r.state = 'failed';
      r.errors = [text];
      r.host = null;
      r.content = { items: [], maps: [], modes: [], tools: [] };
      this.logEntry(r.id, 'error', `Failed to load: ${text}`, e instanceof ChaosError ? e.file : undefined, e instanceof ChaosError ? e.line : undefined);
      return;
    }
    r.host = host;
    r.state = 'loaded';
    r.content = this.diffContent(before);
    this.order.push(host);
    this.logEntry(r.id, 'info', `Loaded v${m.version}: ${r.content.items.length} items, ${r.content.tools.length} tools, ${r.content.maps.length} maps, ${r.content.modes.length} modes.`);
  }

  private snapshotContent() {
    return { items: new Set(catalog.list().map((d) => d.id)), maps: new Set(Object.keys(MAP_STORE)), modes: new Set(MODE_INFO.keys()), tools: new Set(TOOL_TYPES.map((t) => t.id)) };
  }

  private diffContent(b: ReturnType<ModManager['snapshotContent']>): ModRecord['content'] {
    return {
      items: catalog.list().map((d) => d.id).filter((i) => !b.items.has(i)),
      maps: Object.keys(MAP_STORE).filter((i) => !b.maps.has(i)),
      modes: [...MODE_INFO.keys()].filter((i) => !b.modes.has(i)),
      tools: TOOL_TYPES.map((t) => t.id).filter((i) => !b.tools.has(i)),
    };
  }

  private removeContent(id: string): void {
    for (const t of TOOL_TYPES) if (t.source === id) this.game.tools.remove(t.id);
    unregisterSource(id);
    for (const t of this.game.tools.tools.map((x) => x.id)) {
      // Tools added directly during a load that then failed never reached TOOL_TYPES' source list.
      if (t.startsWith(`${id}:`) && !TOOL_TYPES.some((x) => x.id === t)) this.game.tools.remove(t);
    }
    for (const t of this.game.tools.tools) (t as { refreshParts?: () => void }).refreshParts?.();
  }

  // ── Unloading ──
  private entitiesOf(ids: Set<string>): Entity[] {
    if (!this.game.physics.world) return [];
    return this.game.entities.active.filter((e) => !e.dead && !!e.def.source && ids.has(e.def.source));
  }

  private unloadRecord(r: ModRecord): void {
    if (!r.host) return;
    const i = this.order.indexOf(r.host);
    if (i >= 0) this.order.splice(i, 1);
    const ui = this.game.ui.get();
    if (ui.modMenu?.owner === r.id) r.host.closeMenu();
    r.host.dispose();
    r.host = null;
    for (const e of this.entitiesOf(new Set([r.id]))) this.game.entities.remove(e);
    this.removeContent(r.id);
    r.content = { items: [], maps: [], modes: [], tools: [] };
    this.logEntry(r.id, 'info', 'Unloaded.');
  }

  /** Every loaded mod that needs `id`, directly or through another, dependents last. */
  private dependents(id: string): ModRecord[] {
    const out: ModRecord[] = [];
    const visit = (x: string) => {
      for (const r of this.list()) {
        if (!r.host || out.includes(r)) continue;
        if (r.manifest!.dependencies.some((d) => d.id === x)) {
          out.push(r);
          visit(r.id);
        }
      }
    };
    visit(id);
    return out;
  }

  private sessionUses(ids: Set<string>): boolean {
    if (!this.game.physics.world) return false;
    const s = this.game.session;
    return [s.map, s.mode].some((x) => x.includes(':') && ids.has(x.split(':')[0]!));
  }

  // ── Actions ──
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const r = this.records.get(id);
    if (!r) return;
    r.enabled = enabled;
    this.enabledPref.set(id, enabled);
    this.changed();
    await this.savePref(id);
    if (!enabled) {
      const all = [r, ...this.dependents(id)];
      if (this.sessionUses(new Set(all.map((x) => x.id)))) this.game.quitToMenu();
      for (const x of all.reverse()) {
        this.unloadRecord(x);
        x.state = 'disabled';
      }
    }
    this.loadAll();
  }

  /** Reloads a mod and everything depending on it, re-reading its files from their source. */
  async reload(id: string): Promise<ModRecord | undefined> {
    const r = this.records.get(id);
    if (!r) return undefined;
    if (r.manifest && !r.manifest.hot_reload && this.game.physics.world) {
      this.logEntry(id, 'warn', 'This mod has hot_reload turned off. Quit to the menu to reload it.');
      this.game.toast(this.game.t('mods.noHotReload'), 'warn');
      return r;
    }
    const fresh = await this.freshBundle(id);
    return this.swap(id, fresh ?? r.bundle);
  }

  private async freshBundle(id: string): Promise<ModBundle | null> {
    const local = (await this.localBundles()).get(id);
    if (local) return local;
    for (const s of [...this.sources].reverse()) {
      try {
        const b = (await s.list()).find((x) => idOf(x, '') === id);
        if (b) return b;
      } catch {
        // A source going away keeps the last known files.
      }
    }
    return null;
  }

  /** Replaces a mod's files and restarts it, keeping its entities in the world where possible. */
  private swap(id: string, bundle: ModBundle): ModRecord | undefined {
    const r = this.records.get(id);
    const affected = r ? [r, ...this.dependents(id)] : [];
    const ids = new Set(affected.map((x) => x.id));
    const snapshots = this.entitiesOf(ids).map(capture);
    const sessionTouched = this.sessionUses(ids);
    for (const x of [...affected].reverse()) {
      this.unloadRecord(x);
      x.state = 'disabled';
    }
    this.updateRecord(id, bundle);
    this.loadAll();
    const after = this.records.get(id);
    if (this.game.physics.world) {
      if (sessionTouched) {
        const s = this.game.session;
        if (s.map in MAP_STORE && (s.mode in MODE_INFO || !s.mode.includes(':'))) this.game.restart();
        else this.game.quitToMenu();
      } else {
        let lost = 0;
        for (const s of snapshots) if (!restore(this.game, s)) lost++;
        if (lost) this.logEntry(id, 'warn', `${lost} placed objects could not be kept, because their definitions changed or no longer exist.`);
      }
    }
    this.changed();
    return after;
  }

  async reloadAll(): Promise<void> {
    for (const r of this.list()) {
      if (r.enabled && !r.manifest?.dependencies.length) await this.reload(r.id);
    }
    this.loadAll();
  }

  /** Installs or replaces a mod from a bundle's text. A bundle that fails validation changes nothing. */
  async installText(text: string): Promise<{ record?: ModRecord; errors: string[]; warnings: string[] }> {
    let bundle: ModBundle;
    try {
      bundle = parseBundleText(text);
    } catch (e) {
      return { errors: [e instanceof Error ? e.message : String(e)], warnings: [] };
    }
    return this.installBundle(bundle);
  }

  /** Installs from loose files, as read from a folder. */
  async installFiles(files: { path: string; text?: string; dataUrl?: string }[]): Promise<{ record?: ModRecord; errors: string[]; warnings: string[] }> {
    // A folder picker includes the folder's own name as the first path segment.
    const manifestFile = files.find((f) => f.path === 'mod.json' || /^[^/]+\/mod\.json$/.test(f.path));
    if (!manifestFile?.text) return { errors: ['This folder has no mod.json at its top level.'], warnings: [] };
    const prefix = manifestFile.path.slice(0, -'mod.json'.length);
    const bundle: ModBundle = { origin: 'local', manifest: manifestFile.text, files: {}, assets: {} };
    for (const f of files) {
      if (!f.path.startsWith(prefix)) continue;
      const rel = f.path.slice(prefix.length);
      if (!safePath(rel) || rel === 'mod.json') continue;
      if (f.text !== undefined && rel.endsWith('.chaos')) bundle.files[rel] = f.text;
      if (f.dataUrl) bundle.assets![rel] = f.dataUrl;
    }
    return this.installBundle(bundle);
  }

  async installBundle(input: ModBundle, opts: { followManifest?: boolean } = {}): Promise<{ record?: ModRecord; errors: string[]; warnings: string[] }> {
    const bundle: ModBundle = { ...input, origin: 'local' };
    const x = examineBundle(bundle);
    if (x.errors.length || !x.manifest) return { errors: x.errors, warnings: x.warnings };
    const enabled = this.enabledPref.get(x.manifest.id) ?? (opts.followManifest ? x.manifest.enabled_by_default : true);
    await this.game.saves.db.put('mods', x.manifest.id, { enabled, bundle });
    if (!this.enabledPref.has(x.manifest.id)) this.enabledPref.set(x.manifest.id, enabled);
    const record = this.swap(x.manifest.id, bundle);
    return { record, errors: [], warnings: x.warnings };
  }

  /** Everything to know about installing a bundle, before anything is changed. */
  previewImport(input: ModBundle): ImportPreview {
    const x = examineBundle({ ...input, origin: 'local' });
    const m = x.manifest;
    if (!m) return { manifest: null, errors: x.errors, warnings: x.warnings, replaces: null, dependencies: [], conflicts: [] };
    const old = this.records.get(m.id);
    const replaces = old ? { name: old.manifest?.name ?? old.id, version: old.manifest?.version ?? '?', bundled: old.origin !== 'local' || old.overridesBuiltin } : null;
    const dependencies = m.dependencies.map((d): ImportPreview['dependencies'][number] => {
      const dep = this.records.get(d.id);
      let status: ImportPreview['dependencies'][number]['status'] = 'ok';
      if (!dep?.manifest) status = 'missing';
      else if (!satisfies(dep.manifest.version, d.version)) status = 'wrong_version';
      else if (!dep.enabled) status = 'disabled';
      return { id: d.id, version: d.version, optional: d.optional, status };
    });
    const conflicts = this.list().filter((r) => r.id !== m.id && r.enabled && (m.conflicts.includes(r.id) || r.manifest?.conflicts.includes(m.id))).map((r) => r.id);
    return { manifest: m, errors: x.errors, warnings: x.warnings, replaces, dependencies, conflicts };
  }

  /** Changes one file of a mod, in a local copy, then reloads it. */
  async editFile(id: string, path: string, text: string): Promise<ModRecord | undefined> {
    const r = this.records.get(id);
    if (!r) return undefined;
    const bundle: ModBundle = { ...r.bundle, origin: 'local', files: { ...r.bundle.files }, assets: r.bundle.assets };
    if (path === 'mod.json') bundle.manifest = text;
    else bundle.files[path] = text;
    await this.game.saves.db.put('mods', id, { enabled: r.enabled, bundle });
    return this.swap(id, bundle);
  }

  /** Removes a local copy. A builtin mod goes back to its original files, and an installed one is gone. */
  async uninstall(id: string): Promise<void> {
    const r = this.records.get(id);
    if (!r) return;
    const all = [r, ...this.dependents(id)];
    if (this.sessionUses(new Set(all.map((x) => x.id)))) this.game.quitToMenu();
    for (const x of [...all].reverse()) {
      this.unloadRecord(x);
      x.state = 'disabled';
    }
    if (this.shipped.has(id)) {
      // Discarding edits to an included mod: its data and on/off choice stay.
      await this.game.saves.db.put('mods', id, { enabled: r.enabled });
    } else {
      await this.game.saves.db.delete('mods', id);
      await this.game.saves.db.delete('moddata', id);
      this.storageCache.delete(id);
      this.enabledPref.delete(id);
      this.records.delete(id);
    }
    await this.rescan();
    this.loadAll();
  }

  private async savePref(id: string): Promise<void> {
    const r = this.records.get(id);
    if (!r) return;
    const existing = await this.game.saves.db.get<{ bundle?: ModBundle }>('mods', id);
    await this.game.saves.db.put('mods', id, { enabled: r.enabled, bundle: existing?.bundle });
  }

  saveStorage(id: string, data: Record<string, Plain>): void {
    this.storageCache.set(id, data);
    void this.game.saves.db.put('moddata', id, data).catch((e: unknown) => {
      this.logEntry(id, 'warn', `Could not save mod data: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  // ── Custom events ──
  emitCustom(name: string, data: Plain): void {
    if (this.emitDepth >= 8) throw new ChaosError(`events.emit: "${name}" is nested too deeply. Check for events that emit each other.`);
    this.emitDepth++;
    try {
      this.broadcast(name, () => (data === null ? {} : typeof data === 'object' ? data : { value: data }));
    } finally {
      this.emitDepth--;
    }
  }

  // ── Debug console ──
  /** Runs a line of ChaosScript in a sandbox with every permission. Never touches a mod's own state. */
  evaluate(source: string): { ok: boolean; text: string } {
    const host = this.consoleHost();
    const attempts = [`__result(${source})`, source];
    let syntax: unknown = null;
    for (const code of attempts) {
      let chunk: Chunk;
      try {
        chunk = parse(code, 'console');
      } catch (e) {
        syntax ??= e;
        continue;
      }
      try {
        const v = host.evalChunk(chunk);
        return { ok: true, text: v === null ? 'nil' : displayValue(v) };
      } catch (e) {
        return { ok: false, text: e instanceof ChaosError ? e.format() : String(e) };
      }
    }
    return { ok: false, text: syntax instanceof ChaosError ? syntax.format() : String(syntax) };
  }

  private consoleHost(): ModHost {
    if (this.console) return this.console;
    const manifest: Manifest = { id: 'console', name: 'Console', description: '', version: '0.0.0', author: '', api_version: '1.0', dependencies: [], conflicts: [], permissions: ['world', 'player', 'effects', 'ui', 'storage', 'rules', 'sandbox'], scripts: [], assets: [], hot_reload: true, enabled_by_default: true };
    this.console = new ModHost(this.game, this, manifest, { origin: 'dev', manifest: '', files: {} }, null);
    this.console.phase = 'running';
    return this.console;
  }

  // ── Teardown ──
  unloadAll(): void {
    for (const r of this.list().reverse()) {
      if (r.host) {
        this.unloadRecord(r);
        r.state = r.enabled ? 'disabled' : r.state;
      }
    }
    this.console?.dispose();
    this.console = null;
  }

  dispose(): void {
    this.unloadAll();
    this.listeners.clear();
    this.logListeners.clear();
  }

  /** A key press during play, offered to mods that bound it. Returns true if one used it. */
  handleKey(code: string): boolean {
    const ui = this.game.ui.get();
    if (!this.sessionActive || ui.screen !== 'playing' || ui.paused || ui.modeHud?.result) return false;
    return this.order.some((h) => h.pressKey(code));
  }

  /** Mod Menu entries from every running mod. */
  menuButtons(): { mod: string; id: number; label: Loc; run: () => void }[] {
    const out: { mod: string; id: number; label: Loc; run: () => void }[] = [];
    for (const h of this.order) for (const b of h.buttons) out.push({ mod: h.manifest.name, id: b.id, label: b.label, run: () => void h.invoke(b.fn, [], 'button') });
    return out;
  }
}

function idOf(b: ModBundle, fallback: string): string {
  try {
    const raw = JSON.parse(b.manifest) as { id?: unknown };
    if (typeof raw?.id === 'string' && raw.id) return raw.id;
  } catch {
    // Reported when the record is examined.
  }
  return `invalid_${fallback}`;
}

const examined = new WeakMap<ModBundle, Examined>();
function examineBundleCached(r: ModRecord): Examined {
  let x = examined.get(r.bundle);
  if (!x) examined.set(r.bundle, (x = examineBundle(r.bundle)));
  return x;
}

function capture(e: Entity): EntitySnapshot {
  const v = e.isDynamic ? e.body!.linvel() : undefined;
  let state: Record<string, unknown> | undefined;
  for (const c of e.components) {
    const s = c.save?.();
    if (s) state = { ...state, ...s };
  }
  return { state, def: e.def.id, position: { ...e.position }, rotation: { ...e.rotation }, linvel: v ? { x: v.x, y: v.y, z: v.z } : undefined, scale: e.scale, scriptData: e.scriptData, tint: e.tint };
}

function restore(game: Game, s: EntitySnapshot): boolean {
  if (!catalog.has(s.def)) return false;
  const r = game.entities.spawn(s.def, { position: s.position, rotation: s.rotation, linvel: s.linvel, scale: s.scale, tint: s.tint, state: s.state });
  if (!r.ok) return false;
  r.entity.scriptData = s.scriptData;
  return true;
}

function displayValue(v: Value): string {
  return toDisplay(v);
}
