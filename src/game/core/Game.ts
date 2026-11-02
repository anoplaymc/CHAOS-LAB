import * as THREE from 'three';
import { catalog, type ItemDef } from '../../data/items';
import { materials } from '../../data/materials';
import { translate } from '../../data/i18n';
import { AudioEngine } from '../../audio/AudioEngine';
import { Effects } from '../../rendering/effects';
import { GameRenderer, makeSkyMaterial, qualityLights } from '../../rendering/GameRenderer';
import { disposeMaterialLibrary } from '../../rendering/materialLibrary';
import { disposeGeometryCache } from '../../rendering/geometry';
import { Emitter } from '../../utils/emitter';
import { Store } from '../../utils/store';
import { dist, type V3 } from '../../utils/math';
import { ANGLE_STEPS, computePlacement, GRID_STEPS, MAX_PLACE_DISTANCE } from '../building/placement';
import { ConnectionManager } from '../building/connections';
import { MAP_STORE } from '../content/registry';
import '../content/coreExpansion';
import { SignalSystem } from '../building/SignalSystem';
import { Entity, type DamageSource } from '../entities/Entity';
import { EntityManager, type SpawnOptions, type SpawnResult } from '../entities/EntityManager';
import { DEFAULT_LIMITS, type Limits } from '../entities/EntityRegistry';
import { MapBuilder, type LoadedMap, type MapDef } from '../maps/MapBuilder';
import { buildNavGrid } from '../maps/navBuild';
import { INDUSTRIAL_YARD } from '../maps/industrialYard';
import { GRAVITY_PLAYGROUND } from '../maps/gravityPlayground';
import { PROVING_GROUND } from '../maps/provingGround';
import { TEST_FACILITY } from '../maps/testFacility';
import { ZoneSystem } from '../maps/ZoneSystem';
import type { NavGrid } from '../npcs/NavGrid';
import { NpcComponent } from '../npcs/NpcComponent';
import { DebrisSystem } from '../physics/Debris';
import { Group, initPhysics, PhysicsWorld, RAPIER, SOLID, queryShape, type ImpactEvent, type RayHit } from '../physics/PhysicsWorld';
import { Player } from '../player/Player';
import { ViewModel } from '../weapons/ViewModel';
import { BouncerBall, BouncerSystem, FreezeSystem, GravityFlipSystem, GravityWellSystem, ProjectileSystem } from '../weapons/systems';
import { ToolManager } from '../weapons/ToolManager';
import type { ToolHud } from '../weapons/Tool';
import { BuildSettings, ConstructionTool, SpawnerTool } from '../building/ConstructionTool';
import { recordPlace, removeManyWithUndo, removeWithUndo } from '../building/commands';
import { UndoStack } from '../building/undo';
import { FIXTURE_ID_BASE } from '../entities/EntityRegistry';
import type { InspectInfo } from '../interaction/tools';
import { Inventory } from '../inventory/favorites';
import type { GameMode, ModeHud } from '../modes/GameMode';
import { MODE_FACTORIES, PlaygroundMode } from '../modes/modes';
import { PackManager } from '../mods/PackManager';
import { ModManager, type ModMenu, type ModPanel } from '../../modding/ModManager';
import type { ModForm } from '../../modding/form';
import { SandboxControl } from '../../modding/SandboxControl';
import { defaultModSources } from '../../modding/sources';
import { applyScene, serializeScene } from '../save/sceneIO';
import type { SaveFile } from '../save/schema';
import { SaveStore } from '../save/SaveStore';
import type { Category } from '../../data/items';
import { FIXED_DT, FixedStepper } from './loop';
import { Input, type Action } from './input';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

for (const m of [TEST_FACILITY, INDUSTRIAL_YARD, GRAVITY_PLAYGROUND, PROVING_GROUND]) MAP_STORE[m.id] = m;
export const MAPS: Record<string, MapDef> = MAP_STORE;

export interface SessionConfig {
  map?: string;
  mode?: string;
  challenge?: number;
  /** Rebuild this scene instead of the map's default props. */
  save?: SaveFile;
  /** Custom layout applied on top of the bare map. */
  layout?: SaveFile;
}

export interface GameEvents {
  entitySpawned: Entity;
  entityRemoved: Entity;
  playerDied: undefined;
  playerDamaged: { amount: number; source: string; attacker: Entity | null };
  npcKilled: { npc: NpcComponent; byPlayer: boolean };
  entityDamaged: { entity: Entity; amount: number; source: DamageSource };
  entityBroken: { entity: Entity };
  entityInteracted: { entity: Entity };
  explosion: { position: V3; radius: number };
  toolEquipped: { id: string };
  /** The world exists and the mode is about to start. */
  sessionReady: undefined;
  sessionStarted: { map: string; mode: string };
  sessionEnded: undefined;
}

export interface SessionRules {
  gravity: number;
  damage: boolean;
  aggression: 'passive' | 'normal' | 'high';
  flight: boolean;
  regen: boolean;
  airControl: number;
  keepCorpses: boolean;
  /** Whether the player may respawn on demand. Survival charges a life for it instead. */
  manualRespawn: boolean;
  limits: Limits;
}

export function defaultRules(): SessionRules {
  return { gravity: 9.81, damage: true, aggression: 'normal', flight: true, regen: true, airControl: 0.35, keepCorpses: false, manualRespawn: true, limits: { ...DEFAULT_LIMITS } };
}

export interface HudSnapshot extends ToolHud {
  toolId: string;
  slot: number;
  health: number;
  maxHealth: number;
  prompt: string | null;
  flying: boolean;
  driving: boolean;
}

export interface Toast { id: number; text: string; kind: 'info' | 'warn' | 'error' | 'success' }

export interface DebugInfo {
  fps: number;
  frameMs: number;
  physicsMs: number;
  entities: number;
  bodies: number;
  npcs: number;
  particles: number;
  debris: number;
  gravity: number;
  position: string;
  grounded: boolean;
}

export interface UiState {
  screen: 'menu' | 'playing';
  overlay: 'spawn' | 'quick' | 'cleanup' | 'mod' | 'modform' | 'console' | null;
  paused: boolean;
  needsClick: boolean;
  dead: boolean;
  damagePulse: number;
  hud: HudSnapshot | null;
  toasts: Toast[];
  debug: boolean;
  debugInfo: DebugInfo | null;
  overloaded: boolean;
  error: string | null;
  settings: Settings;
  inspect: InspectInfo | null;
  modeHud: ModeHud | null;
  sessionId: number;
  modPanels: ModPanel[];
  modMenu: ModMenu | null;
  modForm: ModForm | null;
}

const AIM_RESULT = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 } };

export class Game {
  readonly events = new Emitter<GameEvents>();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.05, 600);
  readonly physics = new PhysicsWorld();
  readonly entities = new EntityManager(this);
  /** Temporary overrides mods make. Each is undone when that mod stops, or when the session ends. */
  readonly sandbox = new SandboxControl(this);
  readonly audio = new AudioEngine();
  readonly input = new Input();
  readonly player = new Player(this);
  readonly signals = new SignalSystem(this);
  readonly connections = new ConnectionManager(this);
  readonly zones = new ZoneSystem(this);
  readonly debris = new DebrisSystem(this.physics);
  readonly freeze = new FreezeSystem(this);
  readonly gravityFlips = new GravityFlipSystem(this);
  readonly wells = new GravityWellSystem(this);
  readonly projectiles = new ProjectileSystem(this);
  readonly bouncers = new BouncerSystem(this);
  readonly fx: Effects;
  readonly viewModel: ViewModel;
  readonly tools: ToolManager;
  readonly debugGroup = new THREE.Group();
  readonly ui: Store<UiState>;
  readonly build = new BuildSettings();
  readonly undo = new UndoStack(100);
  readonly saves = new SaveStore();
  readonly inventory = new Inventory();
  readonly packs: PackManager;
  readonly mods: ModManager;
  mode: GameMode | null = null;
  /** Editor mode holds the simulation still. */
  editing = false;
  session: { map: string; mode: string; challenge: number; layout?: SaveFile } = { map: TEST_FACILITY.id, mode: 'sandbox', challenge: 0 };
  settings: Settings;
  renderer: GameRenderer | null = null;
  rules: SessionRules = defaultRules();
  map: LoadedMap | null = null;
  nav: NavGrid | null = null;
  npcs: NpcComponent[] = [];
  npcBudget = { perception: 6, paths: 1 };
  time = 0;
  zoom = 1;
  aiDebug = false;
  private stepper = new FixedStepper();
  private raf = 0;
  private lastFrame = 0;
  private running = false;
  private worldLights: THREE.Light[] = [];
  private sky: THREE.Mesh | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private pendingBreak: Entity[] = [];
  private pendingExplosions: { p: V3; radius: number; impulse: number; damage: number; delay: number }[] = [];
  private toastId = 0;
  private toastTimers = new Set<ReturnType<typeof setTimeout>>();
  private killTimer = 0;
  private hudTimer = 0;
  private frameTimes: number[] = [];
  private physicsMs = 0;
  private smoothFps = 60;
  private overloadTime = 0;
  private promptText: string | null = null;
  private promptTarget: Entity | null = null;
  private promptTargetAt = -1;
  private fovCurrent = 78;
  private unsubs: (() => void)[] = [];
  /** Set by the mod system. Runs once per fixed step. */
  moddingTick: ((dt: number) => void) | null = null;

  constructor() {
    this.settings = loadSettings();
    this.packs = new PackManager(this.saves.db, MAPS);
    this.mods = new ModManager(this);
    this.ui = new Store<UiState>({
      screen: 'menu', overlay: null, paused: false, needsClick: false, dead: false, damagePulse: 0, hud: null, toasts: [],
      debug: false, debugInfo: null, overloaded: false, error: null, settings: this.settings, inspect: null, modeHud: null, sessionId: 0, modPanels: [], modMenu: null, modForm: null,
    });
    this.fx = new Effects(this.scene);
    this.entities.attach(this.scene);
    this.scene.add(this.camera, this.debugGroup, this.debris.group, this.projectiles.group, this.bouncers.group, this.connections.group);
    this.viewModel = new ViewModel(this.camera);
    this.tools = new ToolManager(this);
    this.viewModel.setTool(this.tools.active.id);
    this.audio.applySettings(this.settings);
    this.fx.setQuality(this.settings.quality);
    this.unsubs.push(
      this.entities.onRemove((e) => {
        this.tools.dropIfHolding(e);
        this.connections.onEntityRemoved(e);
        this.signals.unregister(e);
        this.freeze.timers.forget(e.id);
        this.gravityFlips.timers.forget(e.id);
      }),
    );
  }

  static async init(): Promise<void> {
    await initPhysics();
  }

  /** Reloads installed content packs. Failure must not stop the game from starting. */
  async restorePacks(): Promise<void> {
    try {
      await this.packs.restore();
      for (const t of this.tools.tools) (t as Partial<ConstructionTool>).refreshParts?.call(t);
    } catch (e) {
      console.warn('[CHAOS LAB] could not restore content packs', e);
    }
  }

  /** Finds and loads mods. Anything wrong with a mod ends up in its record: this never stops the game from starting. */
  async restoreMods(): Promise<void> {
    try {
      for (const s of defaultModSources()) this.mods.addSource(s);
      await this.mods.restore();
      for (const t of this.tools.tools) (t as Partial<ConstructionTool>).refreshParts?.call(t);
    } catch (e) {
      console.warn('[CHAOS LAB] could not load mods', e);
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    return translate(this.settings.language, key, params);
  }

  // ── Browser attachment ──
  attachCanvas(canvas: HTMLCanvasElement, opts: { automation?: boolean } = {}): void {
    this.renderer = new GameRenderer(canvas, this.settings);
    const parent = canvas.parentElement ?? canvas;
    this.input.virtualLock = !!opts.automation;
    this.input.attach(parent);
    this.input.onEscape = () => this.handleEscape();
    this.input.onLockChange = (locked) => this.handleLockChange(locked);
    this.input.onLockRefused = () => this.handleLockRefused();
    this.input.onGlobalAction = (a) => this.handleGlobalAction(a);
    this.input.onModKey = (code) => this.mods.handleKey(code);
    this.fx.sparks.setViewportScale(this.renderer.pointScale);
    this.fx.smoke.setViewportScale(this.renderer.pointScale);
    this.start();
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      try {
        this.frame(dt);
      } catch (e) {
        // Keep the page alive and make the failure visible instead of freezing silently.
        console.error('[CHAOS LAB] frame failed', e);
        if (!this.ui.get().error) {
          this.ui.set({ error: e instanceof Error ? e.message : String(e) });
          this.toast(`Simulation error: ${e instanceof Error ? e.message : String(e)}`, 'error');
        }
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.running = false;
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf);
    this.teardownWorld();
    this.mods.dispose();
    this.input.detach();
    this.audio.dispose();
    this.fx.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    for (const u of this.unsubs) u();
    for (const id of this.toastTimers) clearTimeout(id);
    this.events.clear();
    disposeMaterialLibrary();
    disposeGeometryCache();
  }

  // ── Session lifecycle ──
  startSession(cfg: SessionConfig = {}): void {
    this.teardownWorld();
    const modeId = cfg.mode ?? cfg.save?.mode ?? 'sandbox';
    const mode = (MODE_FACTORIES[modeId] ?? MODE_FACTORIES.sandbox!)(this, cfg.challenge ?? 0);
    const mapId = cfg.map ?? cfg.save?.map ?? cfg.layout?.map ?? mode.defaultMap;
    const def = MAPS[mapId] ?? TEST_FACILITY;
    this.session = { map: def.id, mode: mode.id, challenge: cfg.challenge ?? 0, layout: cfg.layout };
    this.mode = mode;
    // Rules are rebuilt every session: this is what keeps one mode's settings out of the next.
    this.rules = defaultRules();
    mode.configure(this.rules);
    if (cfg.save) Object.assign(this.rules, cfg.save.rules);
    this.entities.registry.limits = this.rules.limits;
    this.physics.create({ x: 0, y: -this.rules.gravity, z: 0 });
    const builder = new MapBuilder(this.physics);
    def.build(builder);
    mode.extendMap?.(builder);
    this.loadMapVisuals(def, builder);
    this.zones.zones = builder.zones;
    this.player.init(builder.spawn, builder.spawnYaw);
    // Scene queries only see colliders after a step, and the nav grid is built from queries.
    this.physics.step();
    this.nav = def.nav ? buildNavGrid(this.physics, def.nav) : null;
    this.spawnMapProps(builder, !cfg.save && !cfg.layout && mode.usesMapProps());
    this.tools.reset();
    this.undo.clear();
    this.tools.setAllowed(mode.allowedTools());
    if (cfg.save) this.reportApply(applyScene(this, cfg.save));
    else if (cfg.layout) this.reportApply(applyScene(this, { ...cfg.layout, kind: 'layout', player: undefined }));
    this.time = 0;
    this.stepper.reset();
    this.ui.set({ screen: 'playing', overlay: null, paused: false, dead: false, overloaded: false, sessionId: this.ui.get().sessionId + 1, modeHud: mode.hud(), needsClick: false });
    this.audio.startAmbience(def.ambience);
    this.setInputActive(true);
    this.events.emit('sessionReady', undefined);
    mode.start();
    this.refreshHud();
    this.player.updateCamera(this.camera, 1, 1);
    this.events.emit('sessionStarted', { map: def.id, mode: mode.id });
  }

  private spawnMapProps(b: MapBuilder, includeLoose: boolean): void {
    const named = new Map<string, number>();
    let fixtures = 0;
    for (const p of b.props) {
      // Fixtures get ids from build order, so saved wires to them stay valid across reloads.
      if (p.opts.fixture) {
        const r = this.entities.spawn(p.id, { ...p.opts, id: FIXTURE_ID_BASE + fixtures++ });
        if (r.ok && p.name) named.set(p.name, r.entity.id);
      } else if (includeLoose) {
        const r = this.entities.spawn(p.id, p.opts);
        if (r.ok && p.name) named.set(p.name, r.entity.id);
      }
    }
    for (const [from, to] of b.wires) {
      const a = named.get(from);
      const c = named.get(to);
      if (a !== undefined && c !== undefined) this.signals.connect(a, c);
    }
  }

  private reportApply(r: ReturnType<typeof applyScene>): void {
    if (r.missingDefs.length) this.toast(this.t('save.missing', { n: r.missingDefs.length, list: r.missingDefs.slice(0, 3).join(', ') }), 'warn');
    if (r.droppedLinks + r.droppedWires > 0) this.toast(this.t('save.dropped', { n: r.droppedLinks + r.droppedWires }), 'warn');
  }

  restart(): void {
    const s = this.session;
    this.startSession({ map: s.map, mode: s.mode, challenge: s.challenge, layout: s.layout });
  }

  /** Called by a mode when it has a result to show: frees the mouse for the result screen. */
  onModeResult(): void {
    this.ui.set({ modeHud: this.mode?.hud() ?? null });
    this.setInputActive(false);
  }

  /** Dismisses a result screen where the mode allows carrying on. */
  continueAfterResult(): void {
    if (this.mode instanceof PlaygroundMode) this.mode.continueAfterResult();
    this.ui.set({ modeHud: this.mode?.hud() ?? null });
    this.setInputActive(true);
  }

  setGravity(g: number): void {
    this.rules.gravity = g;
    this.physics.setGravity({ x: 0, y: -g, z: 0 });
  }

  /** The live lighting of the current map, for the sandbox environment controls. */
  lightingHandles(): { def: MapDef; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sky: THREE.Mesh; fog: THREE.FogExp2 } | null {
    const hemi = this.worldLights[0];
    if (!this.map || !this.sun || !this.sky || !(hemi instanceof THREE.HemisphereLight) || !(this.scene.fog instanceof THREE.FogExp2)) return null;
    return { def: this.map.def, sun: this.sun, hemi, sky: this.sky, fog: this.scene.fog };
  }

  // ── Saving ──
  async saveScene(slot: string, name: string, kind: SaveFile['kind'] = 'scene'): Promise<SaveFile> {
    const data = serializeScene(this, name, kind);
    await this.saves.write(slot, data);
    return data;
  }

  loadSave(save: SaveFile): void {
    if (save.kind === 'layout') this.startSession({ map: save.map, layout: save, mode: 'sandbox' });
    else this.startSession({ save, map: save.map, mode: save.mode });
  }

  /** Removes everything in the given categories. Undoable, and always behind a UI confirmation. */
  cleanup(categories: Category[]): number {
    const set = new Set(categories);
    const list = this.entities.active.filter((e) => !e.fixture && !e.locked && set.has(e.def.category));
    removeManyWithUndo(this, list);
    if (set.has('effects')) this.debris.clear();
    return list.length;
  }

  countByCategory(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entities.active) if (!e.fixture) out[e.def.category] = (out[e.def.category] ?? 0) + 1;
    return out;
  }

  selectForPlacement(id: string): void {
    const def = catalog.get(id);
    if (!def) return;
    const construction = this.tools.tools.find((t) => t.id === 'construction') as ConstructionTool | undefined;
    if (def.buildPart && construction?.setPart(id)) {
      this.tools.selectById('construction');
      return;
    }
    const spawner = this.tools.tools.find((t) => t.id === 'spawner') as SpawnerTool | undefined;
    if (spawner) spawner.selected = id;
    this.tools.selectById('spawner');
  }

  quitToMenu(): void {
    this.setInputActive(false);
    this.teardownWorld();
    this.audio.stopAmbience();
    this.ui.set({ screen: 'menu', overlay: null, paused: false, dead: false, hud: null, needsClick: false, modeHud: null, inspect: null });
  }

  private loadMapVisuals(def: MapDef, b: MapBuilder): void {
    const group = new THREE.Group();
    const meshes = b.batcher.build(group);
    this.scene.add(group);
    this.map = { def, patrols: b.patrols, zones: b.zones, group, meshes };
    this.scene.fog = new THREE.FogExp2(def.fog.color, def.fog.density);
    this.scene.background = new THREE.Color(def.sky.horizon);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), makeSkyMaterial(def.sky));
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.sky = sky;
    // Fewer point lights on lower quality: raise the base fill so interiors don't fall to black.
    const cap = qualityLights(this.settings.quality);
    const fill = 1 + Math.max(0, b.lights.length - cap) * 0.22;
    const hemi = new THREE.HemisphereLight(def.hemi.sky, def.hemi.ground, def.hemi.intensity * fill);
    const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
    const dir = new THREE.Vector3(def.sun.dir.x, def.sun.dir.y, def.sun.dir.z).normalize();
    sun.userData.dir = dir;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -38;
    sun.shadow.camera.right = sun.shadow.camera.top = 38;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(hemi, sun, sun.target);
    this.sun = sun;
    this.worldLights = [hemi, sun];
    for (const l of b.lights.slice(0, cap)) {
      const pl = new THREE.PointLight(l.color, l.intensity, l.range, 1.6);
      pl.position.set(l.x, l.y, l.z);
      this.scene.add(pl);
      this.worldLights.push(pl);
    }
    this.renderer?.setSun(sun);
    this.renderer?.setEnvironment(this.scene, def.sky, def.envPanels);
  }

  private teardownWorld(): void {
    // The mode's own cleanup still sees a live world.
    this.mode?.dispose();
    this.mode = null;
    if (this.physics.world) this.events.emit('sessionEnded', undefined);
    this.tools.setAllowed(null);
    this.undo.clear();
    this.zoom = 1;
    this.tools.reset();
    this.player.ignoreBody = null;
    this.pendingBreak.length = 0;
    this.pendingExplosions.length = 0;
    this.promptTarget = null;
    this.promptTargetAt = -1;
    if (this.physics.world) {
      this.debris.clear();
      this.bouncers.clear();
      this.wells.clear();
      this.projectiles.clear();
      this.freeze.timers.clear();
      this.gravityFlips.timers.clear();
      this.connections.clear();
      this.entities.clear();
      this.signals.clear();
      this.player.dispose();
    }
    this.npcs = [];
    this.nav = null;
    this.fx.clear();
    if (this.map) {
      for (const m of this.map.meshes) m.geometry.dispose();
      this.map.group.removeFromParent();
      this.map = null;
    }
    this.sun?.target.removeFromParent();
    for (const l of this.worldLights) {
      l.removeFromParent();
      l.dispose();
    }
    this.worldLights = [];
    this.sun = null;
    if (this.sky) {
      this.sky.removeFromParent();
      this.sky.geometry.dispose();
      (this.sky.material as THREE.Material).dispose();
      this.sky = null;
    }
    this.physics.destroy();
  }

  // ── Input and state routing ──
  setInputActive(active: boolean): void {
    this.input.enabled = active;
    if (active) {
      this.audio.unlock();
      this.input.requestLock();
    } else {
      this.input.releaseAll();
      this.input.exitLock();
    }
  }

  private handleEscape(): void {
    const ui = this.ui.get();
    if (ui.screen !== 'playing' || ui.modeHud?.result) {
      if (ui.overlay === 'console') this.ui.set({ overlay: null });
      return;
    }
    if (ui.overlay === 'console' && ui.paused) this.ui.set({ overlay: null });
    else if (ui.overlay) this.setOverlay(null);
    else if (ui.paused) this.resume();
    else this.pause();
  }

  private handleLockChange(locked: boolean): void {
    const ui = this.ui.get();
    this.ui.set({ needsClick: !locked && this.input.enabled && ui.screen === 'playing' && !ui.overlay && !ui.paused });
    // Losing the lock without opening a menu means the browser took it, normally through Esc.
    if (!locked && ui.screen === 'playing' && !ui.overlay && !ui.paused && this.input.enabled) this.pause();
  }

  private handleLockRefused(): void {
    const ui = this.ui.get();
    if (ui.screen === 'playing' && !ui.overlay && !ui.paused && this.input.enabled) this.ui.set({ needsClick: true });
  }

  private handleGlobalAction(a: Action): boolean {
    const ui = this.ui.get();
    if (a === 'debug') {
      this.ui.set({ debug: !ui.debug });
      return true;
    }
    if (a === 'console') {
      if (ui.overlay === 'console') {
        if (ui.screen === 'playing' && !ui.paused) this.setOverlay(null);
        else this.ui.set({ overlay: null });
      } else if (ui.screen === 'playing' && !ui.paused) {
        this.setOverlay('console');
      } else {
        this.ui.set({ overlay: 'console' });
      }
      return true;
    }
    if (a === 'aiDebug' && ui.screen === 'playing') {
      this.aiDebug = !this.aiDebug;
      this.signals.showWires = this.aiDebug || ((this.tools.active as ConstructionTool).mode === 'wire');
      return true;
    }
    if (ui.screen !== 'playing' || ui.paused) return false;
    if (ui.modeHud?.result) return false;
    if (a === 'spawnMenu') {
      this.setOverlay(ui.overlay === 'spawn' ? null : 'spawn');
      return true;
    }
    if (a === 'quickMenu') {
      this.setOverlay(ui.overlay === 'quick' ? null : 'quick');
      return true;
    }
    if (a === 'modMenu') {
      this.setOverlay(ui.overlay === 'mod' ? null : 'mod');
      return true;
    }
    return false;
  }

  setOverlay(overlay: UiState['overlay']): void {
    this.ui.set({ overlay });
    this.setInputActive(overlay === null);
  }

  pause(): void {
    if (this.ui.get().paused) return;
    this.ui.set({ paused: true, needsClick: false });
    this.setInputActive(false);
  }

  resume(): void {
    this.ui.set({ paused: false });
    this.stepper.reset();
    this.setInputActive(true);
  }

  applySettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.ui.set({ settings: this.settings });
    this.audio.applySettings(this.settings);
    this.renderer?.applySettings(this.settings);
    this.fx.setQuality(this.settings.quality);
  }

  resetSettings(): void {
    this.applySettings({ ...DEFAULT_SETTINGS, language: this.settings.language });
  }

  toast(text: string, kind: Toast['kind'] = 'info'): void {
    const t: Toast = { id: ++this.toastId, text, kind };
    this.ui.set({ toasts: [...this.ui.get().toasts.slice(-3), t] });
    const timer = setTimeout(() => {
      this.toastTimers.delete(timer);
      this.ui.set({ toasts: this.ui.get().toasts.filter((x) => x.id !== t.id) });
    }, kind === 'error' ? 5000 : 3200);
    this.toastTimers.add(timer);
  }

  // ── Main loop ──
  /** One rendered frame. Tests may call it directly with a chosen dt. */
  frame(dt: number): void {
    const start = performance.now();
    const ui = this.ui.get();
    // Without the pointer the player can't react, so the world waits for the click that recaptures it.
    const playing = ui.screen === 'playing' && !ui.paused && !ui.needsClick && !!this.physics.world;
    let mouse = { dx: 0, dy: 0 };
    if (playing) {
      mouse = this.input.consumeMouse();
      if (!this.tools.active.mouse(mouse.dx, mouse.dy)) this.player.look(mouse.dx, mouse.dy);
      this.handleFrameInput();
      const steps = this.stepper.advance(dt * this.sandbox.timeScale);
      const physStart = performance.now();
      for (let i = 0; i < steps; i++) this.fixedStep();
      this.physicsMs = performance.now() - physStart;
      const alpha = this.stepper.alpha;
      this.entities.sync(alpha);
      this.player.updateCamera(this.camera, alpha, dt);
      this.updateCameraProjection(dt);
      this.tools.update(dt);
      for (const e of [...this.entities.active]) for (const c of e.components) c.update?.(dt);
      this.debris.update(dt);
      this.bouncers.update(dt);
      this.connections.update();
      this.signals.update();
      this.fx.update(dt);
      this.sandbox.overlays.update(dt);
      this.viewModel.setVisible(!this.player.driving && !this.player.dead);
      this.viewModel.update(dt, mouse.dx, mouse.dy, Math.min(1, this.player.speed / 8), this.time, this.settings.cameraMotion);
      this.updatePrompt();
      if (this.sky) this.sky.position.copy(this.camera.position);
      this.followSun();
      this.updateAudioListener();
    } else {
      this.input.consumeMouse();
      if (this.physics.world) this.tools.flushReleases();
    }
    if (dt > 0) this.smoothFps += (1 / dt - this.smoothFps) * 0.05;
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      if (playing) this.refreshHud();
      if (playing && this.mode) this.ui.set({ modeHud: this.mode.hud() });
      this.refreshDebug(dt);
    }
    this.input.endFrame();
    if (this.renderer && this.physics.world) {
      this.fx.sparks.setViewportScale(this.renderer.pointScale);
      this.fx.smoke.setViewportScale(this.renderer.pointScale);
      this.renderer.render(this.scene, this.camera);
    } else if (this.renderer) {
      this.renderer.renderer.clear();
    }
    this.frameTimes.push(performance.now() - start);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    this.watchOverload(dt);
  }

  /** Runs simulated time deterministically, without a browser. */
  advance(seconds: number): void {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) this.frame(FIXED_DT);
  }

  private handleFrameInput(): void {
    const inp = this.input;
    const pl = this.player;
    if (inp.wasPressed('jump') && !pl.flying) pl.queueJump();
    if (inp.wasPressed('flight')) pl.toggleFlight();
    if (inp.wasPressed('respawn') && this.rules.manualRespawn) pl.respawn();
    if (inp.wasPressed('interact')) this.interact();
    if (inp.wasPressed('delete')) {
      const focus = (this.tools.active as { focus?: Entity | null }).focus;
      const e = focus ?? (this.aimHit(40)?.owner as Entity | undefined);
      if (e?.def) this.removeByPlayer(e);
    }
    if (inp.wasPressed('undo')) {
      const c = this.undo.undo();
      if (c) { this.audio.play('undo'); this.toast(this.t('toast.undo', { what: this.t(`undo.${c.label}`) }), 'info'); }
    }
    if (inp.wasPressed('redo')) {
      const c = this.undo.redo();
      if (c) { this.audio.play('undo'); this.toast(this.t('toast.redo', { what: this.t(`undo.${c.label}`) }), 'info'); }
    }
    const b = this.build;
    if (inp.wasPressed('gridSnap')) { b.gridIndex = (b.gridIndex + 1) % GRID_STEPS.length; this.audio.play('click', 0.4); }
    if (inp.wasPressed('angleSnap')) { b.angleIndex = (b.angleIndex + 1) % ANGLE_STEPS.length; this.audio.play('click', 0.4); }
    if (inp.wasPressed('surfaceAlign')) { b.align = !b.align; this.audio.play('click', 0.4); }
    if (inp.wasPressed('anchorNext')) { b.anchorNext = !b.anchorNext; this.audio.play('click', 0.4); }
    const active = this.tools.active as Partial<ConstructionTool>;
    if (active.cyclePart) {
      if (inp.wasPressed('partPrev')) active.cyclePart.call(active, -1);
      if (inp.wasPressed('partNext')) active.cyclePart.call(active, 1);
    }
  }

  private fixedStep(): void {
    const dt = FIXED_DT;
    this.time += dt;
    this.npcBudget.perception = 6;
    this.npcBudget.paths = 1;
    if (!this.editing) this.zones.fixedUpdate(dt);
    this.player.fixedUpdate(dt);
    this.tools.fixedUpdate(dt);
    this.signals.fixedUpdate(dt);
    this.freeze.timers.tick(dt);
    this.gravityFlips.timers.tick(dt);
    this.wells.fixedUpdate(dt);
    this.projectiles.fixedUpdate(dt);
    if (!this.editing) {
      for (const e of [...this.entities.active]) {
        if (e.dead) continue;
        for (const c of e.components) c.fixedUpdate?.(dt);
      }
    }
    this.mode?.fixedUpdate(dt);
    this.moddingTick?.(dt);
    for (const e of this.entities.active) {
      const b = e.body;
      if (b && b.isDynamic() && !b.isSleeping()) {
        const v = b.linvel();
        e.vx = v.x; e.vy = v.y; e.vz = v.z;
      }
    }
    const impacts = this.physics.step();
    this.handleImpacts(impacts);
    this.entities.capture();
    this.player.capture();
    this.flushDestruction(dt);
    this.killTimer -= dt;
    if (this.killTimer <= 0) {
      this.killTimer = 0.2;
      this.enforceKillPlane();
    }
  }

  private enforceKillPlane(): void {
    const killY = this.map?.def.killY ?? -50;
    for (const e of [...this.entities.active]) {
      if (e.fixture) continue;
      const b = e.body;
      if (b && !b.isFixed() && b.translation().y < killY) this.entities.remove(e);
    }
    if (this.player.body && !this.player.flying && !this.player.driving && this.player.position.y < killY) this.player.respawn();
  }

  // ── Impacts and damage ──
  private deltaV(e: Entity): number {
    const b = e.body;
    if (!b || !b.isDynamic()) return 0;
    const v = b.linvel();
    return Math.hypot(v.x - e.vx, v.y - e.vy, v.z - e.vz);
  }

  private handleImpacts(events: ImpactEvent[]): void {
    for (const ev of events) {
      const oa = this.physics.ownerOf(ev.a);
      const ob = this.physics.ownerOf(ev.b);
      if (oa instanceof BouncerBall) { this.bouncers.onImpact(oa, ob); continue; }
      if (ob instanceof BouncerBall) { this.bouncers.onImpact(ob, oa); continue; }
      const ea = oa instanceof Entity ? oa : null;
      const eb = ob instanceof Entity ? ob : null;
      const dva = ea ? this.deltaV(ea) : 0;
      const dvb = eb ? this.deltaV(eb) : 0;
      if (oa === this.player || ob === this.player) {
        const other = oa === this.player ? eb : ea;
        const dv = oa === this.player ? dvb : dva;
        if (other && dv > 7 && other.mass > 30) this.player.takeDamage((dv - 7) * Math.min(1, other.mass / 150) * 3.5, 'impact');
      }
      const strongest = Math.max(dva, dvb);
      if (strongest > 1.2) {
        const src = dva >= dvb ? ea : eb;
        if (src && !src.dead) {
          this.audio.impact(materials.get(src.materialId).sound, strongest / 11, src.position);
          if (strongest > 4 && this.time - src.lastImpactSound > 0.2) {
            src.lastImpactSound = this.time;
            this.makeNoise(src.position, 12);
            this.fx.puff(src.position, 2, 0x8a8880, 0.3, 0.35, 0.6, 0.3);
          }
        }
      }
      if (ea) this.impactDamage(ea, dva || dvb);
      if (eb) this.impactDamage(eb, dvb || dva);
    }
  }

  private impactDamage(e: Entity, dv: number): void {
    if (e.dead) return;
    if (e.def.kind === 'npc') {
      if (dv > 9) this.damageEntity(e, (dv - 9) * 5, { kind: 'impact' });
      return;
    }
    const base = e.def.breakSpeed;
    if (!base) return;
    const frag = materials.get(e.materialId).fragility;
    if (frag <= 0) return;
    const threshold = base * (materials.get(e.def.material).fragility / frag);
    if (dv > threshold) this.damageEntity(e, (dv / threshold - 1) * e.maxHealth * 1.5 + e.maxHealth * 0.25, { kind: 'impact' });
  }

  damageEntity(e: Entity, amount: number, src: DamageSource): void {
    if (e.dead || amount <= 0 || e.invulnerable) return;
    const breakable = e.def.breakSpeed !== undefined || e.def.kind === 'npc';
    if (!breakable) return;
    if (src.kind === 'player') amount *= this.sandbox.damageScale;
    e.health -= amount;
    for (const c of e.components) c.onDamage?.(amount, src);
    this.events.emit('entityDamaged', { entity: e, amount, source: src });
    if (e.health <= 0 && e.def.kind !== 'npc' && !this.pendingBreak.includes(e)) this.pendingBreak.push(e);
  }

  /** Shared hit logic for hitscan and bolts: impulse at the point, damage to the owner. */
  applyHit(hit: RayHit, damage: number, dir: V3, impulse: number, src: DamageSource): void {
    if (hit.owner === this.player) {
      this.player.takeDamage(damage, src.kind, src.entity);
      return;
    }
    const b = hit.body;
    const k = src.kind === 'player' ? impulse * this.sandbox.impulseScale : impulse;
    if (b && b.isDynamic()) b.applyImpulseAtPoint({ x: dir.x * k, y: dir.y * k, z: dir.z * k }, hit.point, true);
    if (hit.owner instanceof Entity) this.damageEntity(hit.owner, damage, src);
  }

  private flushDestruction(dt: number): void {
    if (this.pendingBreak.length) {
      for (const e of this.pendingBreak.splice(0)) if (!e.dead) this.breakEntity(e);
    }
    for (let i = this.pendingExplosions.length - 1; i >= 0; i--) {
      const x = this.pendingExplosions[i]!;
      x.delay -= dt;
      if (x.delay <= 0) {
        this.pendingExplosions.splice(i, 1);
        this.explode(x.p, x.radius, x.impulse, x.damage);
      }
    }
  }

  private breakEntity(e: Entity): void {
    for (const c of e.components) c.onBreak?.();
    this.events.emit('entityBroken', { entity: e });
    const d = e.def.debris;
    const p = e.position;
    if (d) {
      const v = e.body?.linvel() ?? { x: 0, y: 0, z: 0 };
      const s = 0.3 * e.scale;
      this.debris.spawn(d.kind, p, { x: s, y: s, z: s }, d.count, { x: v.x * 0.5, y: v.y * 0.5, z: v.z * 0.5 });
      const sound = d.kind === 'glass' || d.kind === 'ice' ? 'glass' : d.kind === 'wood' ? 'breakWood' : d.kind === 'stone' ? 'breakStone' : 'breakMetal';
      this.audio.play(sound, 1, p);
      this.fx.puff(p, 5, d.kind === 'glass' ? 0xbfe8ee : 0x9a8a70, 0.4, 0.5, 0.8, 0.4);
    }
    this.entities.remove(e);
  }

  queueExplosion(p: V3, radius: number, impulse: number, damage: number): void {
    if (this.pendingExplosions.length > 24) return;
    this.pendingExplosions.push({ p: { ...p }, radius, impulse, damage, delay: 0.07 });
  }

  explode(p: V3, radius: number, impulse: number, damage: number): void {
    this.fx.explosion(p, radius);
    this.audio.play('explode', 1, p);
    this.player.addShake(Math.max(0, 1.1 - dist(p, this.player.position) / (radius * 3)));
    this.makeNoise(p, radius * 5);
    for (const n of this.npcs) n.reactToExplosion(p, radius);
    this.blast(p, radius, impulse, damage, null, { kind: 'explosion', entity: null, point: p });
    this.events.emit('explosion', { position: { ...p }, radius });
  }

  /** A blast without fire: heavy-bot slams and popping bouncers. */
  shockwave(p: V3, radius: number, impulse: number, damage: number, source: Entity | null): void {
    this.fx.ring(p, radius, 0xffd080, 0.35);
    this.fx.burst(p, 20, 0xc9b890, radius * 1.3, 0.1, 0.5, 8);
    this.player.addShake(Math.max(0, 0.8 - dist(p, this.player.position) / (radius * 3)));
    this.blast(p, radius, impulse, damage, source, { kind: source ? 'npc' : 'player', entity: source, point: p });
  }

  private blast(p: V3, radius: number, baseImpulse: number, damage: number, source: Entity | null, src: DamageSource): void {
    const impulse = baseImpulse * this.sandbox.blastScale;
    this.physics.overlap(new RAPIER.Ball(radius), p, { x: 0, y: 0, z: 0, w: 1 }, Group.PROP | Group.NPC | Group.VEHICLE | Group.PROJECTILE, (c) => {
      const owner = this.physics.ownerOf(c);
      if (owner === source) return true;
      const b = c.parent();
      const q = c.translation();
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dz = q.z - p.z;
      const d = Math.max(0.3, Math.hypot(dx, dy, dz));
      const fall = Math.max(0, 1 - d / radius);
      if (b && b.isDynamic()) {
        const k = (impulse * fall) / d;
        b.applyImpulse({ x: dx * k, y: dy * k + impulse * fall * 0.35, z: dz * k }, true);
        b.applyTorqueImpulse({ x: (Math.random() - 0.5) * k, y: (Math.random() - 0.5) * k, z: (Math.random() - 0.5) * k }, true);
      }
      if (owner instanceof Entity) this.damageEntity(owner, damage * fall, src);
      return true;
    });
    const pl = this.player;
    if (pl.body && !pl.flying && !pl.driving && !pl.god) {
      const q = pl.position;
      const d = Math.max(0.5, dist(q, p));
      if (d < radius) {
        const fall = 1 - d / radius;
        pl.takeDamage(damage * fall, 'blast', source);
        const k = (impulse * fall * 0.022) / d;
        pl.addVelocity({ x: (q.x - p.x) * k, y: Math.abs(q.y - p.y) * k + impulse * fall * 0.01, z: (q.z - p.z) * k });
        pl.setAirborne();
      }
    }
  }

  dissolve(e: Entity): void {
    const p = e.position;
    this.fx.burst(p, 40, 0x38ff90, 3, 0.1, 0.9, -3);
    this.audio.play('dissolved', 1, p);
    this.entities.remove(e);
  }

  makeNoise(p: V3, radius: number): void {
    for (const n of this.npcs) n.hearNoise(p, radius);
  }

  removeByPlayer(e: Entity): boolean {
    if (e.fixture || e.locked) {
      this.toast(this.t('toast.notRemovable'), 'warn');
      this.audio.play('error');
      return false;
    }
    const p = e.position;
    this.fx.burst(p, 16, 0xe8432f, 2.5, 0.07, 0.4, 2);
    this.audio.play('remove', 0.9, p);
    removeWithUndo(this, e);
    return true;
  }

  // ── Aiming and interaction ──
  aimRay(): { origin: V3; dir: V3 } {
    const c = this.camera.position;
    AIM_RESULT.origin.x = c.x; AIM_RESULT.origin.y = c.y; AIM_RESULT.origin.z = c.z;
    const f = this.player.forward;
    AIM_RESULT.dir.x = f.x; AIM_RESULT.dir.y = f.y; AIM_RESULT.dir.z = f.z;
    return AIM_RESULT;
  }

  aimHit(range: number, mask: number = SOLID): RayHit | null {
    const a = this.aimRay();
    return this.physics.raycast(a.origin, a.dir, range, { mask });
  }

  private interactTarget(): Entity | null {
    const hit = this.aimHit(3.2);
    const e = hit?.owner as Entity | undefined;
    if (e?.def && e.components.some((c) => c.onInteract)) return e;
    const me = this.player.position;
    for (const v of this.entities.active) {
      if (v.def.kind === 'vehicle' && dist(v.position, me) < 3.2) return v;
    }
    return null;
  }

  private interact(): void {
    const pl = this.player;
    if (pl.dead) return;
    if (pl.driving) {
      pl.exitVehicle();
      return;
    }
    // A walking NPC can step off the crosshair between seeing the prompt and pressing the key.
    const recent = this.time - this.promptTargetAt < 0.5 && !this.promptTarget?.dead ? this.promptTarget : null;
    const e = this.interactTarget() ?? recent;
    if (e) {
      this.events.emit('entityInteracted', { entity: e });
      for (const c of e.components) if (c.onInteract?.()) break;
    }
  }

  private updatePrompt(): void {
    if (this.player.driving) {
      this.promptText = this.t('hint.exit');
      return;
    }
    const e = this.interactTarget();
    this.promptText = null;
    if (e) for (const c of e.components) {
      const h = c.interactHint?.();
      if (h) {
        this.promptText = h;
        this.promptTarget = e;
        this.promptTargetAt = this.time;
        break;
      }
    }
  }

  // ── Spawning ──
  /** Spawns with a limit check that explains itself to the player. */
  trySpawn(defId: string, opts: SpawnOptions): SpawnResult {
    const def = catalog.get(defId);
    const denied = def && this.mode?.placementDenied?.(def);
    if (denied) {
      this.toast(this.t(denied), 'warn');
      this.audio.play('error');
      return { ok: false, reason: 'budget' };
    }
    const r = this.entities.spawn(defId, opts);
    if (!r.ok) {
      const limits = this.entities.registry.limits;
      if (r.reason === 'unknown') this.toast(this.t('toast.unknownItem'), 'warn');
      else this.toast(this.t(`toast.limit.${r.reason}`, { n: r.reason === 'budget' ? 0 : limits[r.reason] }), 'warn');
      this.audio.play('error');
    }
    return r;
  }

  /** Pose for placing `def` at the crosshair, and whether it fits. */
  placementAt(def: ItemDef, o: { scale?: number; yaw?: number; pitch?: number; grid?: number; angle?: number; align?: boolean; ignore?: Entity[] } = {}): { position: V3; rotation: { x: number; y: number; z: number; w: number }; valid: boolean } {
    const a = this.aimRay();
    const skip = o.ignore;
    const scale = o.scale ?? 1;
    const hit = this.physics.raycast(a.origin, a.dir, MAX_PLACE_DISTANCE, {
      mask: SOLID,
      predicate: skip ? (c) => !skip.includes(this.physics.ownerOf(c) as Entity) : undefined,
    });
    const d = 5;
    const pose = computePlacement({
      def, scale, hit: hit ? { point: hit.point, normal: hit.normal } : null,
      fallbackPoint: { x: a.origin.x + a.dir.x * d, y: a.origin.y + a.dir.y * d, z: a.origin.z + a.dir.z * d },
      yawDeg: o.yaw ?? (this.player.yaw * 180) / Math.PI, pitchDeg: o.pitch ?? 0, grid: o.grid ?? 0, angleStep: o.angle ?? 0, alignToSurface: o.align ?? false,
    });
    const blocked = this.physics.isBlocked(queryShape(def.shape, scale), pose.position, pose.rotation, SOLID | Group.PLAYER, skip ? (c) => skip.includes(this.physics.ownerOf(c) as Entity) : undefined);
    return { position: pose.position, rotation: pose.rotation, valid: !blocked };
  }

  /** Spawn menu action: creates the item at the crosshair if it fits. */
  spawnAtCrosshair(defId: string): Entity | null {
    const def = catalog.get(defId);
    if (!def) return null;
    if (def.kind === 'tool') {
      if (def.toolId && this.tools.selectById(def.toolId)) this.setOverlay(null);
      else this.toast(this.t('toast.unknownItem'), 'warn');
      return null;
    }
    const place = this.placementAt(def);
    if (!place.valid) {
      this.toast(this.t('toast.blocked'), 'warn');
      this.audio.play('error');
      return null;
    }
    if (def.kind === 'effect' && def.use) {
      def.use(place.position);
      return null;
    }
    if (def.kind === 'effect') {
      const p = def.params ?? {};
      this.queueExplosion(place.position, Number(p.radius ?? 6), Number(p.impulse ?? 900), Number(p.damage ?? 40));
      return null;
    }
    const r = this.trySpawn(defId, { position: place.position, rotation: place.rotation });
    if (!r.ok) return null;
    recordPlace(this, r.entity);
    this.inventory.touch(defId);
    this.audio.play('place', 0.8, place.position);
    return r.entity;
  }

  // ── Presentation ──
  private updateCameraProjection(dt: number): void {
    const target = this.settings.fov * this.zoom;
    this.fovCurrent += (target - this.fovCurrent) * Math.min(1, 14 * dt);
    const r = this.renderer;
    const aspect = r ? r.width / r.height : 16 / 9;
    if (Math.abs(this.camera.fov - this.fovCurrent) > 0.01 || Math.abs(this.camera.aspect - aspect) > 0.001) {
      this.camera.fov = this.fovCurrent;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
  }

  private followSun(): void {
    const s = this.sun;
    if (!s) return;
    const p = this.camera.position;
    const sx = Math.round(p.x / 4) * 4;
    const sz = Math.round(p.z / 4) * 4;
    const dir = s.userData.dir as THREE.Vector3;
    s.target.position.set(sx, 0, sz);
    s.position.set(sx + dir.x * 80, dir.y * 80, sz + dir.z * 80);
  }

  private right = { x: 1, y: 0, z: 0 };
  private updateAudioListener(): void {
    const y = this.player.yaw;
    this.right.x = Math.cos(y);
    this.right.z = -Math.sin(y);
    this.audio.listener = { position: this.camera.position, right: this.right };
  }

  private refreshHud(): void {
    const t = this.tools.active;
    const pl = this.player;
    this.ui.set({
      hud: {
        ...t.hud(),
        toolId: t.id,
        slot: this.tools.activeIndex,
        health: Math.max(0, Math.round(pl.health)),
        maxHealth: pl.maxHealth,
        prompt: this.promptText,
        flying: pl.flying,
        driving: !!pl.driving,
      },
    });
  }

  /** Live numbers for tools and the F3 panel's mod equivalent. */
  perfSnapshot(): { fps: number; frame_ms: number; physics_ms: number; entities: number; bodies: number; npcs: number; particles: number; debris: number } {
    const avg = this.frameTimes.length ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length : 0;
    return { fps: Math.round(this.smoothFps), frame_ms: Number(avg.toFixed(1)), physics_ms: Number(this.physicsMs.toFixed(1)), entities: this.entities.registry.size, bodies: this.physics.bodyCount, npcs: this.npcs.length, particles: this.fx.activeParticles, debris: this.debris.count };
  }

  private refreshDebug(dt: number): void {
    if (!this.ui.get().debug) return;
    const avg = this.frameTimes.length ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length : 0;
    const w = this.physics.world;
    const p = this.player.body ? this.player.position : { x: 0, y: 0, z: 0 };
    this.ui.set({
      debugInfo: {
        fps: dt > 0 ? Math.round(1 / dt) : 0,
        frameMs: Number(avg.toFixed(1)),
        physicsMs: Number(this.physicsMs.toFixed(1)),
        entities: this.entities.registry.size,
        bodies: this.physics.bodyCount,
        npcs: this.npcs.length,
        particles: this.fx.activeParticles,
        debris: this.debris.count,
        gravity: w ? -w.gravity.y : 0,
        position: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
        grounded: this.player.grounded,
      },
    });
  }

  private watchOverload(dt: number): void {
    if (this.ui.get().screen !== 'playing' || this.ui.get().paused) return;
    this.overloadTime = dt > 1 / 22 ? this.overloadTime + dt : Math.max(0, this.overloadTime - dt * 2);
    const over = this.overloadTime > 4;
    if (over !== this.ui.get().overloaded) this.ui.set({ overloaded: over });
  }
}

