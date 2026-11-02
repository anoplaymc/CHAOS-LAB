import { ChaosError, ChaosLimitError, closest, fromPlain, installStdlib, Interpreter, isCallable, lint, NativeFunction, parse, STD_GLOBALS, STD_NAMESPACES, Table, typeName, type Chunk, type Diagnostic, type Plain, type Value } from '../chaosscript';
import { catalog, type ItemDef } from '../data/items';
import type { Loc } from '../data/materials';
import { MAPS, type Game } from '../game/core/Game';
import type { Entity } from '../game/entities/Entity';
import type { V3 } from '../utils/math';
import { ALL_API, API_NAMESPACES } from './api';
import type { ApiFn, Param } from './api/types';
import { EVENT_NAMES } from './events';
import { toColor, toVec3 } from './fields';
import type { Manifest } from './manifest';
import type { ModBundle, ModManager } from './ModManager';

export type LogLevel = 'info' | 'warn' | 'error';

const LOAD_FUEL = 5_000_000;
const CALL_FUEL = 200_000;
const STEP_FUEL = 1_000_000;
const MAX_TIMERS = 256;
const MAX_HANDLERS = 256;
const MAX_STORAGE = 256 * 1024;
const SPAWN_RATE = 60;
const MAX_EMIT_DEPTH = 8;
/** Failures that end a mod's callbacks: limit hits in total, and errors within the window. */
const MAX_LIMIT_HITS = 3;
const MAX_ERRORS = 25;
const ERROR_WINDOW = 10;

interface Handler { id: number; event: string; fn: Value }
interface Timer { id: number; left: number; every: number; fn: Value }

export interface HostButton { id: number; label: Loc; fn: Value }

/** Everything the linter needs to know about the API. */
export function lintContext() {
  return { globals: new Set([...STD_GLOBALS, ...Object.keys(API_NAMESPACES)]), namespaces: { ...STD_NAMESPACES, ...API_NAMESPACES } };
}

/** Parses and lints a mod's scripts without running anything. Syntax errors are reported as diagnostics. */
export function checkScripts(files: { path: string; text: string }[]): { chunks: Chunk[]; diagnostics: Diagnostic[] } {
  const chunks: Chunk[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const f of files) {
    try {
      chunks.push(parse(f.text, f.path));
    } catch (e) {
      const err = e as ChaosError;
      diagnostics.push({ severity: 'error', file: f.path, line: err.line, col: err.col, message: err.message });
    }
  }
  if (!diagnostics.length) diagnostics.push(...lint(chunks, lintContext()));
  return { chunks, diagnostics };
}

/** One running mod: its interpreter, permissions, limits and callbacks. Nothing from a script reaches the game except through here. */
export class ModHost {
  readonly vm: Interpreter;
  readonly id: string;
  readonly sounds = new Set<string>();
  phase: 'loading' | 'running' | 'faulted' | 'dead' = 'loading';
  faultReason: string | null = null;
  errorCount = 0;
  private handlers = new Map<string, Handler[]>();
  private timers: Timer[] = [];
  private nextId = 1;
  private limitHits = 0;
  private errorTimes: number[] = [];
  private spawnTokens = SPAWN_RATE;
  private spawnClock = 0;
  private heapClock = 0;
  private overBudgetWarned = false;
  private storage: Map<string, Plain>;
  private storageBytes = 0;
  private panels = new Set<string>();
  readonly buttons: HostButton[] = [];
  private claimed = new Set<string>();
  private assets: Record<string, string>;

  constructor(readonly game: Game, readonly manager: ModManager, readonly manifest: Manifest, bundle: ModBundle, storage: Record<string, Plain> | null) {
    this.id = manifest.id;
    this.assets = bundle.assets ?? {};
    this.storage = new Map(Object.entries(storage ?? {}));
    this.storageBytes = JSON.stringify(storage ?? {}).length;
    this.vm = new Interpreter({ fuel: CALL_FUEL });
    let seed = 7;
    for (let i = 0; i < this.id.length; i++) seed = (seed * 31 + this.id.charCodeAt(i)) >>> 0;
    installStdlib(this.vm, (s) => this.log('info', s), seed ^ Date.now());
    this.installApi();
  }

  // ── Loading ──
  /** Runs the mod's files. Throws on the first problem, leaving cleanup to the manager. */
  load(chunks: Chunk[]): void {
    for (const c of chunks) this.vm.run(c, LOAD_FUEL);
    this.phase = 'running';
  }

  /** Runs one more chunk, for the debug console. */
  evalChunk(chunk: Chunk): Value {
    let result: Value = null;
    this.vm.define('__result', new NativeFunction('__result', (a) => { result = a[0] ?? null; }));
    this.vm.run(chunk, LOAD_FUEL);
    this.vm.globals.vars.delete('__result');
    return result;
  }

  private installApi(): void {
    const tables = new Map<string, Table>();
    for (const f of ALL_API) {
      let t = tables.get(f.ns);
      if (!t) {
        t = new Table();
        tables.set(f.ns, t);
        this.vm.define(f.ns, t);
      }
      t.set(f.name, new NativeFunction(`${f.ns}.${f.name}`, this.wrap(f)));
    }
    for (const t of tables.values()) t.locked = true;
  }

  private wrap(f: ApiFn): (a: Value[]) => Value {
    const label = `${f.ns}.${f.name}`;
    const variadic = f.params[0]?.name.endsWith('...');
    return (raw) => {
      this.vm.burn(5 + (f.cost ?? 0));
      if (this.phase === 'dead') throw new ChaosError(`${label}: this mod has been unloaded.`);
      if (f.perm && !this.manifest.permissions.includes(f.perm)) {
        throw new ChaosError(`${label} needs the "${f.perm}" permission. Add "${f.perm}" to "permissions" in mod.json.`);
      }
      if (f.loadOnly && this.phase !== 'loading') throw new ChaosError(`${label} can only be called while the mod is loading, at the top level of a script.`);
      if (f.world && !this.inSession) throw new ChaosError(`${label} needs a running session. Call it from an event handler such as "session_start", or check game.in_session() first.`);
      if (variadic) return this.toScript((f.impl as (h: ModHost, ...v: Value[]) => unknown)(this, ...raw));
      if (raw.length > f.params.length) throw new ChaosError(`${label} takes at most ${f.params.length} argument${f.params.length === 1 ? '' : 's'}, got ${raw.length}. Signature: ${signature(f)}.`);
      const args: unknown[] = [];
      for (let i = 0; i < f.params.length; i++) {
        const p = f.params[i]!;
        const v = raw[i] ?? null;
        if (v === null) {
          if (!p.optional && p.type !== 'any') throw new ChaosError(`${label}: missing argument ${i + 1}, "${p.name}". Signature: ${signature(f)}.`);
          args.push(null);
          continue;
        }
        const conv = this.convert(v, p, `${label}: argument ${i + 1}, "${p.name}",`);
        // A gone entity is not an error: anything can be removed between two of a script's calls.
        if (p.type === 'entity' && conv === null) return null;
        args.push(conv);
      }
      return this.toScript((f.impl as (h: ModHost, ...v: unknown[]) => unknown)(this, ...args));
    };
  }

  private convert(v: Value, p: Param, where: string): unknown {
    const bad = (want: string): never => { throw new ChaosError(`${where} must be ${want}, got ${typeName(v)}.`); };
    switch (p.type) {
      case 'number': return typeof v === 'number' && Number.isFinite(v) ? v : bad('a number');
      case 'string': return typeof v === 'string' ? v : bad('text');
      case 'boolean': return typeof v === 'boolean' ? v : bad('true or false');
      case 'function': return isCallable(v) ? v : bad('a function');
      case 'table': return v instanceof Table ? v : bad('a table');
      case 'vec3': return toVec3(v, where);
      case 'color': return toColor(v, where);
      case 'entity': {
        if (typeof v !== 'number') bad('an entity id');
        const e = this.game.entities.get(v as number);
        return e && !e.dead ? e : null;
      }
      default: return v;
    }
  }

  toScript(v: unknown): Value {
    if (v === undefined || v === null) return null;
    if (typeof v === 'object' && !(v instanceof Table) && !(v instanceof NativeFunction) && !isCallable(v as Value)) return fromPlain(v);
    return v as Value;
  }

  // ── Calling into the script ──
  /** A safe function for the game to call. Errors stay here, and after an unload it just does nothing. */
  guard(fn: Value, label: string): (...args: Value[]) => Value {
    this.vm.roots.push(fn);
    return (...args) => this.invoke(fn, args, label);
  }

  /** The common callback shape: one entity. */
  hook1(fn: Value, label: string): (e: Entity) => void {
    const g = this.guard(fn, label);
    return (e) => void g(e.id);
  }

  invoke(fn: Value, args: Value[], label: string): Value {
    if (this.phase === 'dead' || this.phase === 'faulted') return null;
    try {
      return this.vm.call(fn, args, CALL_FUEL);
    } catch (e) {
      this.report(e, label);
      return null;
    }
  }

  private report(e: unknown, label: string): void {
    const err = e instanceof ChaosError ? e : new ChaosError(e instanceof Error ? e.message : String(e));
    this.errorCount++;
    this.manager.logEntry(this.id, 'error', `${label}: ${err.format()}`, err.file, err.line);
    if (err instanceof ChaosLimitError && ++this.limitHits >= MAX_LIMIT_HITS) {
      this.fault(`Stopped after hitting its limits ${MAX_LIMIT_HITS} times. Last: ${err.message}`);
      return;
    }
    const now = performance.now() / 1000;
    this.errorTimes.push(now);
    while (this.errorTimes.length && now - this.errorTimes[0]! > ERROR_WINDOW) this.errorTimes.shift();
    if (this.errorTimes.length >= MAX_ERRORS) this.fault(`Stopped after ${MAX_ERRORS} errors in ${ERROR_WINDOW} seconds. Last: ${err.message}`);
  }

  /** Stops every callback. Its content stays registered and inert, so the session carries on. */
  fault(reason: string): void {
    if (this.phase === 'faulted' || this.phase === 'dead') return;
    this.phase = 'faulted';
    this.faultReason = reason;
    this.timers = [];
    this.clearSessionUi();
    this.manager.logEntry(this.id, 'error', reason);
    this.game.toast(`${this.manifest.name}: ${this.game.t('mods.faulted')}`, 'error');
    this.manager.changed();
  }

  dispose(): void {
    this.phase = 'dead';
    this.handlers.clear();
    this.timers = [];
    this.buttons.length = 0;
    this.clearSessionUi();
    this.vm.roots.length = 0;
  }

  get alive(): boolean {
    return this.phase === 'running';
  }

  get inSession(): boolean {
    return this.manager.sessionActive;
  }

  // ── Per-step work ──
  fixedUpdate(dt: number): void {
    if (!this.alive) return;
    this.spawnClock += dt;
    if (this.spawnClock >= 1) {
      this.spawnClock = 0;
      this.spawnTokens = SPAWN_RATE;
    }
    this.vm.spent = 0;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (!t) continue;
      t.left -= dt;
      if (t.left > 0) continue;
      if (t.every > 0) t.left += t.every;
      else this.timers.splice(this.timers.indexOf(t), 1);
      this.invoke(t.fn, [], 'timer');
      if (!this.alive) return;
    }
    if (this.handlers.get('tick')?.length) {
      if (this.vm.spent > STEP_FUEL) {
        if (!this.overBudgetWarned) {
          this.overBudgetWarned = true;
          this.log('warn', 'Skipping tick handlers this step: the mod used its budget for the step in timers.');
        }
      } else {
        this.dispatch('tick', () => ({ dt }));
      }
    }
    this.heapClock += dt;
    if (this.heapClock >= 5) {
      this.heapClock = 0;
      const cells = this.vm.measureHeap();
      if (cells > this.vm.limits.heapCells) this.fault(`Stopped for holding too much data: about ${cells} cells, limit ${this.vm.limits.heapCells}.`);
    }
  }

  dispatch(event: string, payload: () => unknown): void {
    const list = this.handlers.get(event);
    if (!list?.length || this.stopped) return;
    for (const h of [...list]) {
      // Each handler gets its own copy, so one can't change what the next one sees.
      const data = this.toScript(payload());
      this.invoke(h.fn, data === null ? [new Table()] : [data], `event ${event}`);
      if (this.stopped) return;
    }
  }

  private get stopped(): boolean {
    return this.phase === 'dead' || this.phase === 'faulted';
  }

  hasListeners(event: string): boolean {
    return !!this.handlers.get(event)?.length;
  }

  // ── Helpers for API implementations ──
  log(level: LogLevel, text: string): void {
    this.manager.logEntry(this.id, level, text);
  }

  warn(text: string): void {
    this.log('warn', text);
  }

  hasPermission(p: string): boolean {
    return (this.manifest.permissions as string[]).includes(p);
  }

  /** Reserves `name` under this mod's namespace. */
  claimId(name: string, where: string): string {
    if (!/^[a-z0-9][a-z0-9_]{0,47}$/.test(name)) {
      throw new ChaosError(`${where}: id "${name}" is invalid. Use lowercase letters, digits and _, without the mod's prefix: the game adds "${this.id}:" for you.`);
    }
    const full = `${this.id}:${name}`;
    const key = `${where}/${full}`;
    if (this.claimed.has(key)) throw new ChaosError(`${where}: this mod already registered "${name}".`);
    this.claimed.add(key);
    return full;
  }

  /** `chair` means this mod's chair if there is one, otherwise the core item. `other:chair` is exact. */
  resolveDef(name: string): string {
    if (name.includes(':')) return name;
    const own = `${this.id}:${name}`;
    return catalog.has(own) ? own : name;
  }

  resolveMap(name: string): string {
    if (name.includes(':')) return name;
    const own = `${this.id}:${name}`;
    return own in MAPS ? own : name;
  }

  unknownDef(name: string): ChaosError {
    const ids = catalog.list().filter((d: ItemDef) => d.kind !== 'tool').map((d: ItemDef) => d.id);
    const own = ids.filter((d) => d.startsWith(`${this.id}:`)).map((d) => d.slice(this.id.length + 1));
    const hint = closest(name, [...own, ...ids]);
    return new ChaosError(`Unknown definition "${name}".${hint ? ` Did you mean "${hint}"?` : ''} game.items() lists everything.`);
  }

  takeSpawnToken(): boolean {
    if (this.spawnTokens <= 0) return false;
    this.spawnTokens--;
    return true;
  }

  vec3(v: Value, where: string): V3 {
    return toVec3(v, where);
  }

  vecList(t: Value, where: string): V3[] {
    if (!(t instanceof Table)) throw new ChaosError(`${where} must be a list of positions, got ${typeName(t)}.`);
    return t.list().map((p, i) => toVec3(p, `${where}[${i + 1}]`));
  }

  resolveAsset = (path: string, where: string): string => {
    if (!this.manifest.assets.includes(path)) throw new ChaosError(`${where}: texture "${path}" is not listed in "assets" in mod.json.`);
    const url = this.assets[path];
    if (!url) throw new ChaosError(`${where}: texture "${path}" could not be read.`);
    return url;
  };

  // ── Events ──
  subscribe(event: string, fn: Value): number {
    if (!event.includes(':') && !(event in EVENT_NAMES)) {
      const hint = closest(event, Object.keys(EVENT_NAMES));
      throw new ChaosError(`events.on: unknown event "${event}".${hint ? ` Did you mean "${hint}"?` : ` Known: ${Object.keys(EVENT_NAMES).join(', ')}.`} Custom events contain ":".`);
    }
    let total = 0;
    for (const l of this.handlers.values()) total += l.length;
    if (total >= MAX_HANDLERS) throw new ChaosError(`events.on: too many handlers (limit ${MAX_HANDLERS}).`);
    const h: Handler = { id: this.nextId++, event, fn };
    let list = this.handlers.get(event);
    if (!list) this.handlers.set(event, (list = []));
    list.push(h);
    this.vm.roots.push(fn);
    this.manager.listenersChanged();
    return h.id;
  }

  unsubscribe(id: number): boolean {
    for (const list of this.handlers.values()) {
      const i = list.findIndex((h) => h.id === id);
      if (i >= 0) {
        list.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  emitDepth = 0;
  get emitAllowed(): boolean {
    return this.emitDepth < MAX_EMIT_DEPTH;
  }

  // ── Timers ──
  addTimer(after: number, every: number, fn: Value): number {
    if (this.timers.length >= MAX_TIMERS) throw new ChaosError(`Too many timers (limit ${MAX_TIMERS}).`);
    const t: Timer = { id: this.nextId++, left: Math.max(0, after), every, fn };
    this.timers.push(t);
    return t.id;
  }

  cancelTimer(id: number): boolean {
    const i = this.timers.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.timers.splice(i, 1);
    return true;
  }

  sessionEnded(): void {
    this.timers = [];
    this.clearSessionUi();
  }

  // ── UI ──
  showPanel(id: string, title: Loc | undefined, lines: Loc[]): void {
    const key = `${this.id}/${id}`;
    if (!this.panels.has(key) && this.panels.size >= 4) throw new ChaosError('ui.show_panel: a mod can show at most 4 panels.');
    this.panels.add(key);
    const panels = this.game.ui.get().modPanels.filter((p) => p.key !== key);
    this.game.ui.set({ modPanels: [...panels, { key, title, lines }] });
  }

  hidePanel(id: string): void {
    const key = `${this.id}/${id}`;
    if (!this.panels.delete(key)) return;
    this.game.ui.set({ modPanels: this.game.ui.get().modPanels.filter((p) => p.key !== key) });
  }

  openMenu(title: Loc, text: Loc | undefined, buttons: { label: Loc; click: Value; close: boolean }[]): void {
    for (const b of buttons) this.vm.roots.push(b.click);
    this.game.ui.set({
      modMenu: {
        owner: this.id, title, text,
        buttons: buttons.map((b) => ({ label: b.label, close: b.close, run: () => void this.invoke(b.click, [], 'menu button') })),
      },
    });
    this.game.setOverlay('mod');
  }

  closeMenu(): void {
    if (this.game.ui.get().modMenu?.owner !== this.id) return;
    this.game.ui.set({ modMenu: null });
    if (this.game.ui.get().overlay === 'mod') this.game.setOverlay(null);
  }

  addButton(label: Loc, fn: Value): number {
    const b: HostButton = { id: this.nextId++, label, fn };
    this.buttons.push(b);
    this.vm.roots.push(fn);
    return b.id;
  }

  removeButton(id: number): void {
    const i = this.buttons.findIndex((b) => b.id === id);
    if (i >= 0) this.buttons.splice(i, 1);
  }

  private clearSessionUi(): void {
    if (this.panels.size) {
      const gone = this.panels;
      this.panels = new Set();
      this.game.ui.set({ modPanels: this.game.ui.get().modPanels.filter((p) => !gone.has(p.key)) });
    }
    this.closeMenu();
  }

  // ── Storage ──
  storageGet(key: string): Value {
    const v = this.storage.get(key);
    return v === undefined ? null : fromPlain(v);
  }

  storageSet(key: string, value: Plain): void {
    const next = new Map(this.storage);
    if (value === null) next.delete(key);
    else next.set(key, value);
    const data = Object.fromEntries(next);
    const size = JSON.stringify(data).length;
    if (size > MAX_STORAGE) throw new ChaosError(`storage.set: this would use ${size} bytes, over the limit of ${MAX_STORAGE}.`);
    this.storage = next;
    this.storageBytes = size;
    this.manager.saveStorage(this.id, data);
  }

  storageKeys(): string[] {
    return [...this.storage.keys()];
  }

  get storageUsed(): number {
    return this.storageBytes;
  }
}

export function signature(f: ApiFn): string {
  const args = f.params.map((p) => (p.optional ? `[${p.name}]` : p.name)).join(', ');
  return `${f.ns}.${f.name}(${args})${f.returns ? ` -> ${f.returns}` : ''}`;
}

