import * as THREE from 'three';
import type { Game, SessionRules } from '../game/core/Game';
import type { Entity } from '../game/entities/Entity';
import { SKY_PRESETS } from '../game/maps/MapBuilder';
import type { NpcComponent } from '../game/npcs/NpcComponent';
import { RAPIER } from '../game/physics/PhysicsWorld';
import type { V3 } from '../utils/math';

export type OverlayName = 'colliders' | 'npc_radius' | 'npc_direction' | 'npc_labels' | 'highlight';
export const OVERLAY_NAMES: OverlayName[] = ['colliders', 'npc_radius', 'npc_direction', 'npc_labels', 'highlight'];

export interface EnvironmentState { sun: number; ambient: number; fog: number; preset: string | null; hour: number | null }
const ENV_DEFAULT: EnvironmentState = { sun: 1, ambient: 1, fog: 1, preset: null, hour: null };

const COLLIDER_VERTICES = 240_000;
const SHAPE_VERTICES = 60_000;

/** Debug lines drawn from real game data. Nothing is created until one is turned on, and it costs nothing while off. */
export class DebugOverlays {
  readonly on = new Set<OverlayName>();
  highlight = new Set<number>();
  private colliders: THREE.LineSegments | null = null;
  private shapes: THREE.LineSegments | null = null;
  private colliderTimer = 0;

  constructor(private game: Game) {}

  set(name: OverlayName, on: boolean): void {
    if (on) this.on.add(name);
    else this.on.delete(name);
    if (name === 'npc_labels') this.game.aiDebug = on;
    if (!this.on.size) this.dispose();
    else if (!on) this.update(1);
  }

  /** Vertices drawn at the moment, for tests and diagnostics. */
  get drawn(): { colliders: number; shapes: number } {
    return { colliders: this.colliders?.geometry.drawRange.count ?? 0, shapes: this.shapes?.geometry.drawRange.count ?? 0 };
  }

  private lines(capacity: number): THREE.LineSegments {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    g.setDrawRange(0, 0);
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 }));
    l.frustumCulled = false;
    l.renderOrder = 31;
    this.game.debugGroup.add(l);
    return l;
  }

  update(dt: number): void {
    if (!this.on.size || !this.game.physics.world) return;
    this.colliderTimer -= dt;
    if (this.on.has('colliders') && this.colliderTimer <= 0) {
      this.colliderTimer = 0.1;
      this.updateColliders();
    } else if (!this.on.has('colliders') && this.colliders) {
      this.colliders.geometry.setDrawRange(0, 0);
    }
    if (this.on.has('npc_radius') || this.on.has('npc_direction') || this.on.has('highlight')) this.updateShapes();
    else this.shapes?.geometry.setDrawRange(0, 0);
  }

  private updateColliders(): void {
    this.colliders ??= this.lines(COLLIDER_VERTICES);
    const r = this.game.physics.w.debugRender();
    const geo = this.colliders.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute;
    const n = Math.min(COLLIDER_VERTICES, Math.floor(r.vertices.length / 3)) & ~1;
    (pos.array as Float32Array).set(r.vertices.subarray(0, n * 3));
    const colors = col.array as Float32Array;
    for (let i = 0; i < n; i++) {
      colors[i * 3] = r.colors[i * 4]!;
      colors[i * 3 + 1] = r.colors[i * 4 + 1]!;
      colors[i * 3 + 2] = r.colors[i * 4 + 2]!;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.setDrawRange(0, n);
  }

  private updateShapes(): void {
    this.shapes ??= this.lines(SHAPE_VERTICES);
    const geo = this.shapes.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute;
    let n = 0;
    const c = new THREE.Color();
    const line = (a: V3, b: V3, color: number) => {
      if (n + 2 > SHAPE_VERTICES) return;
      c.setHex(color);
      pos.setXYZ(n, a.x, a.y, a.z);
      col.setXYZ(n++, c.r, c.g, c.b);
      pos.setXYZ(n, b.x, b.y, b.z);
      col.setXYZ(n++, c.r, c.g, c.b);
    };
    const circle = (p: V3, r: number, color: number) => {
      const SEGMENTS = 40;
      for (let i = 0; i < SEGMENTS; i++) {
        const a = (i / SEGMENTS) * Math.PI * 2;
        const b = ((i + 1) / SEGMENTS) * Math.PI * 2;
        line({ x: p.x + Math.cos(a) * r, y: p.y, z: p.z + Math.sin(a) * r }, { x: p.x + Math.cos(b) * r, y: p.y, z: p.z + Math.sin(b) * r }, color);
      }
    };
    for (const npc of this.game.npcs) {
      if (!npc.alive) continue;
      const p = npc.position;
      if (this.on.has('npc_radius')) {
        circle(p, npc.sightRange, 0x4da3ff);
        circle(p, npc.hearingRange, 0xffb000);
        if (npc.profile.attack !== 'none') circle(p, npc.profile.attackRange, 0xff5a44);
      }
      if (this.on.has('npc_direction')) {
        const v = npc.e.body?.linvel();
        if (v) line(p, { x: p.x + v.x * 0.6, y: p.y + v.y * 0.6, z: p.z + v.z * 0.6 }, 0x19e0c4);
      }
    }
    if (this.on.has('highlight')) {
      for (const id of this.highlight) {
        const e = this.game.entities.get(id);
        if (e && !e.dead) this.box(e, line);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.setDrawRange(0, n);
  }

  private box(e: Entity, line: (a: V3, b: V3, color: number) => void): void {
    const s = e.def.shape;
    const k = e.scale * 1.05;
    let h: V3;
    if (s.type === 'box' || s.type === 'wedge') h = { x: (s.size[0] / 2) * k, y: (s.size[1] / 2) * k, z: (s.size[2] / 2) * k };
    else if (s.type === 'sphere') h = { x: s.r * k, y: s.r * k, z: s.r * k };
    else if (s.type === 'cylinder' || s.type === 'capsule') h = { x: s.r * k, y: (s.h / 2) * k, z: s.r * k };
    else h = { x: 0.6 * k, y: 0.6 * k, z: 0.6 * k };
    const q = e.rotation;
    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const p = e.position;
    const corner = (x: number, y: number, z: number): V3 => {
      const v = new THREE.Vector3(x * h.x, y * h.y, z * h.z).applyQuaternion(quat);
      return { x: p.x + v.x, y: p.y + v.y, z: p.z + v.z };
    };
    const signs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [a, b] = signs[i]!;
      const [c, d] = signs[(i + 1) % 4]!;
      line(corner(a, -1, b), corner(c, -1, d), 0xffe24d);
      line(corner(a, 1, b), corner(c, 1, d), 0xffe24d);
      line(corner(a, -1, b), corner(a, 1, b), 0xffe24d);
    }
  }

  dispose(): void {
    for (const l of [this.colliders, this.shapes]) {
      if (!l) continue;
      l.removeFromParent();
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
    this.colliders = null;
    this.shapes = null;
  }
}

interface Entry { owner: string; undo: () => void }

/**
 * Temporary changes mods make to the game, each with the way to undo it. This is what makes "disable the mod and
 * everything is back" true without the script's help: a stopped script can't clean up after itself.
 */
export class SandboxControl {
  damageScale = 1;
  impulseScale = 1;
  blastScale = 1;
  fireRateScale = 1;
  infiniteEnergy = false;
  timeScale = 1;
  /** What a rule was before an override, so that a saved game keeps the real value. */
  readonly baseRules: Partial<Pick<SessionRules, 'gravity' | 'damage' | 'aggression'>> = {};
  readonly overlays: DebugOverlays;
  private ledger = new Map<string, Entry>();
  private frozen: Map<number, { linvel: V3; angvel: V3 }> | null = null;
  private env: EnvironmentState = { ...ENV_DEFAULT };
  private envBase: { hemi: number } | null = null;

  constructor(private game: Game) {
    this.overlays = new DebugOverlays(game);
    game.events.on('entitySpawned', (e) => { if (this.frozen) this.holdForWorldFreeze(e); });
    game.entities.onRemove((e) => {
      // Its overrides went with it. Entries for it mustn't run later against a gone entity.
      this.frozen?.delete(e.id);
      for (const key of [...this.ledger.keys()]) if (key.startsWith(`e${e.id}:`)) this.ledger.delete(key);
      this.overlays.highlight.delete(e.id);
    });
  }

  // ── The ledger ──
  private claim(owner: string, key: string, undo: () => void): void {
    if (!this.ledger.has(key)) this.ledger.set(key, { owner, undo });
  }

  has(key: string): boolean {
    return this.ledger.has(key);
  }

  /** Undoes one override. */
  release(key: string): boolean {
    const entry = this.ledger.get(key);
    if (!entry) return false;
    this.ledger.delete(key);
    entry.undo();
    return true;
  }

  /** Undoes everything a mod did, oldest last, so values come back as they first were. */
  releaseOwner(owner: string): void {
    for (const [key, entry] of [...this.ledger].reverse()) if (entry.owner === owner) this.release(key);
  }

  /** The world is about to go, with its entities. Nothing needs removing: only values held outside the world. */
  sessionEnded(): void {
    for (const key of [...this.ledger.keys()]) if (/^e\d+:spawned$/.test(key)) this.ledger.delete(key);
    for (const key of [...this.ledger.keys()].reverse()) this.release(key);
  }

  keysOf(owner: string): string[] {
    return [...this.ledger].filter(([, e]) => e.owner === owner).map(([k]) => k);
  }

  /** Sets a value, remembering the first original. A null value puts the original back. */
  override<T>(owner: string, key: string, value: T | null, get: () => T, set: (v: T) => void): void {
    if (value === null) {
      this.release(key);
      return;
    }
    if (!this.ledger.has(key)) {
      const original = get();
      this.claim(owner, key, () => set(original));
    }
    set(value);
  }

  // ── Rules ──
  overrideRule<K extends 'gravity' | 'damage' | 'aggression'>(owner: string, rule: K, value: SessionRules[K] | null, apply: (v: SessionRules[K]) => void): void {
    const key = `rule:${rule}`;
    if (value === null) {
      this.release(key);
      return;
    }
    if (!this.ledger.has(key)) {
      const original = this.game.rules[rule];
      this.baseRules[rule] = original as never;
      this.claim(owner, key, () => {
        delete this.baseRules[rule];
        apply(original);
      });
    }
    apply(value);
  }

  // ── The player and tools ──
  setFlight(owner: string, on: boolean, noclip: boolean): boolean {
    const p = this.game.player;
    if (!p.setFlight(on, noclip)) return false;
    if (on) this.claim(owner, 'player:flight', () => { p.setFlight(false, false); });
    else this.ledger.delete('player:flight');
    return true;
  }

  setToolsUnlocked(owner: string, on: boolean): void {
    const tools = this.game.tools;
    if (!on) {
      this.release('weapons:unlock');
      return;
    }
    const was = tools.allowed;
    this.claim(owner, 'weapons:unlock', () => { tools.allowed = was; });
    tools.allowed = null;
  }

  // ── Entities ──
  /** Removes it when the mod stops. Things a mod creates shouldn't outlive it. */
  trackSpawn(owner: string, e: Entity): void {
    this.claim(owner, `e${e.id}:spawned`, () => {
      if (!e.dead && this.game.physics.world) this.game.entities.remove(e);
    });
  }

  isTracked(id: number): boolean {
    return this.ledger.has(`e${id}:spawned`);
  }

  untrackSpawn(id: number): void {
    this.ledger.delete(`e${id}:spawned`);
  }

  /** Remembers how it is now, so a later restore, or the mod stopping, can put it back. Later calls change nothing. */
  rememberEntity(owner: string, e: Entity): void {
    const b = e.body;
    if (!b) return;
    const was = { gravityScale: e.gravityScale, anchored: e.anchored, material: e.materialId, scale: e.scale, tint: e.tint, linear: b.linearDamping(), angular: b.angularDamping() };
    this.claim(owner, `e${e.id}:base`, () => {
      if (e.dead || !e.body || !this.game.physics.world) return;
      const m = this.game.entities;
      m.setScale(e, was.scale);
      if (e.materialId !== was.material) m.setMaterial(e, was.material);
      if (e.tint !== was.tint) m.setTint(e, was.tint);
      m.setAnchored(e, was.anchored);
      e.gravityScale = was.gravityScale;
      this.game.zones.applyEntity(e);
      e.body.setLinearDamping(was.linear);
      e.body.setAngularDamping(was.angular);
    });
  }

  restoreEntity(id: number): boolean {
    // Mass depends on the shape, so it goes back after the scale does.
    const base = this.release(`e${id}:base`);
    const mass = this.release(`e${id}:mass`);
    return base || mass;
  }

  setMass(owner: string, e: Entity, kg: number): void {
    const c = e.colliders[0];
    const b = e.body;
    if (!c || !b) return;
    this.rememberEntity(owner, e);
    const put = (m: number) => {
      if (e.dead || !e.body || !e.colliders[0]) return;
      e.colliders[0].setMass(m);
      e.body.recomputeMassPropertiesFromColliders();
      e.body.wakeUp();
    };
    this.override(owner, `e${e.id}:mass`, kg, () => c.mass(), put);
  }

  setInvulnerable(owner: string, e: Entity, on: boolean): void {
    this.override(owner, `e${e.id}:invulnerable`, on ? true : null, () => e.invulnerable, (v) => { e.invulnerable = v; });
  }

  // ── NPCs ──
  overrideNpc<K extends 'aiEnabled' | 'stance' | 'speedScale' | 'sightScale' | 'hearingScale'>(owner: string, npc: NpcComponent, field: K, value: NpcComponent[K] | null): void {
    this.override(owner, `e${npc.e.id}:${field}`, value, () => npc[field], (v) => { npc[field] = v; });
  }

  // ── Stopping the world ──
  get worldFrozen(): boolean {
    return this.frozen !== null;
  }

  private holdForWorldFreeze(e: Entity): void {
    const b = e.body;
    if (!b || !b.isDynamic() || e.frozen || !this.frozen) return;
    const lv = b.linvel();
    const av = b.angvel();
    this.frozen.set(e.id, { linvel: { x: lv.x, y: lv.y, z: lv.z }, angvel: { x: av.x, y: av.y, z: av.z } });
    this.game.tools.dropIfHolding(e);
    e.frozen = true;
    b.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  }

  /** Holds every physics object still, keeping its motion to give back. The player and the camera carry on. */
  setWorldFrozen(owner: string, on: boolean): void {
    if (!on) {
      this.release('world:frozen');
      return;
    }
    if (this.frozen) return;
    this.frozen = new Map();
    for (const e of this.game.entities.active) this.holdForWorldFreeze(e);
    this.claim(owner, 'world:frozen', () => {
      const held = this.frozen;
      this.frozen = null;
      if (!held || !this.game.physics.world) return;
      for (const [id, motion] of held) {
        const e = this.game.entities.get(id);
        if (!e?.body) continue;
        e.frozen = false;
        if (e.anchored) continue;
        e.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        e.body.setLinvel(motion.linvel, true);
        e.body.setAngvel(motion.angvel, true);
      }
    });
  }

  // ── Lighting ──
  get environment(): EnvironmentState {
    return { ...this.env };
  }

  setEnvironment(owner: string, patch: Partial<EnvironmentState> | null): void {
    if (patch === null) {
      this.release('env');
      return;
    }
    const h = this.game.lightingHandles();
    if (!h) return;
    if (!this.envBase) this.envBase = { hemi: h.hemi.intensity };
    this.claim(owner, 'env', () => {
      this.env = { ...ENV_DEFAULT };
      this.applyEnvironment();
      this.envBase = null;
    });
    this.env = { ...this.env, ...patch };
    this.applyEnvironment();
  }

  private applyEnvironment(): void {
    const h = this.game.lightingHandles();
    if (!h || !this.envBase) return;
    const e = this.env;
    const def = h.def;
    const fill = this.envBase.hemi / def.hemi.intensity;
    const preset = e.preset ? SKY_PRESETS[e.preset] : undefined;
    const base = preset ?? def;
    const c = (hex: number) => new THREE.Color(hex);
    const sky = { top: c(base.sky.top), horizon: c(base.sky.horizon), bottom: c(base.sky.bottom) };
    const fogColor = c(base.fog.color);
    const sunColor = c(base.sun.color);
    const hemiSky = c(base.hemi.sky);
    const hemiGround = c(base.hemi.ground);
    let sunIntensity = base.sun.intensity;
    let hemiIntensity = base.hemi.intensity;
    let dir = new THREE.Vector3(base.sun.dir.x, base.sun.dir.y, base.sun.dir.z);
    if (e.hour !== null) {
      // The sun rises at 6 and sets at 18. Colours run night, dusk, day by how high it is.
      const angle = ((e.hour - 6) / 24) * Math.PI * 2;
      const height = Math.sin(angle);
      dir = new THREE.Vector3(Math.cos(angle) * 0.8, Math.max(0.08, height), 0.35);
      const [from, to, t] = height < 0.05
        ? [SKY_PRESETS.night!, SKY_PRESETS.dusk!, Math.max(0, (height + 0.25) / 0.3)] as const
        : [SKY_PRESETS.dusk!, SKY_PRESETS.day!, Math.min(1, (height - 0.05) / 0.45)] as const;
      const mix = (out: THREE.Color, a: number, b: number) => out.copy(c(a)).lerp(c(b), t);
      mix(sky.top, from.sky.top, to.sky.top);
      mix(sky.horizon, from.sky.horizon, to.sky.horizon);
      mix(sky.bottom, from.sky.bottom, to.sky.bottom);
      mix(fogColor, from.fog.color, to.fog.color);
      mix(sunColor, from.sun.color, to.sun.color);
      mix(hemiSky, from.hemi.sky, to.hemi.sky);
      mix(hemiGround, from.hemi.ground, to.hemi.ground);
      sunIntensity = from.sun.intensity + (to.sun.intensity - from.sun.intensity) * t;
      hemiIntensity = from.hemi.intensity + (to.hemi.intensity - from.hemi.intensity) * t;
    }
    const u = (h.sky.material as THREE.ShaderMaterial).uniforms as { top: { value: THREE.Color }; horizon: { value: THREE.Color }; bottom: { value: THREE.Color } };
    u.top.value.copy(sky.top);
    u.horizon.value.copy(sky.horizon);
    u.bottom.value.copy(sky.bottom);
    if (this.game.scene.background instanceof THREE.Color) this.game.scene.background.copy(sky.horizon);
    h.fog.color.copy(fogColor);
    h.fog.density = base.fog.density * e.fog;
    h.sun.color.copy(sunColor);
    h.sun.intensity = sunIntensity * e.sun;
    (h.sun.userData.dir as THREE.Vector3).copy(dir.normalize());
    h.hemi.color.copy(hemiSky);
    h.hemi.groundColor.copy(hemiGround);
    h.hemi.intensity = hemiIntensity * e.ambient * fill;
  }
}
