import * as THREE from 'three';
import type { ItemDef } from '../../data/items';
import { geo } from '../../rendering/geometry';
import { mat } from '../../rendering/materialLibrary';
import { dist, type V3 } from '../../utils/math';
import type { Game, SessionRules } from '../core/Game';
import type { Entity } from '../entities/Entity';
import type { MapBuilder, Zone } from '../maps/MapBuilder';
import { NpcComponent } from '../npcs/NpcComponent';
import { RAPIER } from '../physics/PhysicsWorld';
import { MODE_STORE } from '../content/registry';
import type { GameMode, ModeFactory, ModeHud, ModeResult } from './GameMode';

const BUILD_TOOLS = ['manipulator', 'spawner', 'construction', 'remover', 'inspector', 'paint'];

// ── Sandbox ──
export class SandboxMode implements GameMode {
  readonly id = 'sandbox';
  readonly defaultMap = 'test_facility';
  private autosave = 60;
  constructor(private game: Game) {}
  configure(): void {}
  allowedTools() { return null; }
  usesMapProps() { return true; }
  start(): void {}
  fixedUpdate(dt: number): void {
    this.autosave -= dt;
    if (this.autosave <= 0) {
      this.autosave = 60;
      void this.game.saveScene('autosave', this.game.t('save.autosave'));
    }
  }
  hud() { return null; }
  dispose(): void {}
}

// ── Editor: same tools as the sandbox, with the simulation held still ──
export class EditorMode implements GameMode {
  readonly id = 'editor';
  readonly defaultMap = 'test_facility';
  private off: (() => void) | null = null;
  constructor(private game: Game) {}
  configure(r: SessionRules): void {
    r.damage = false;
    r.aggression = 'passive';
  }
  allowedTools() { return BUILD_TOOLS; }
  usesMapProps() { return false; }
  start(): void {
    this.game.editing = true;
    this.off = this.game.events.on('entitySpawned', (e) => this.hold(e));
    for (const e of this.game.entities.active) this.hold(e);
    if (!this.game.player.flying) this.game.player.toggleFlight();
  }
  private hold(e: Entity): void {
    if (e.body?.isDynamic()) e.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  }
  fixedUpdate(): void {}
  hud(): ModeHud {
    const g = this.game;
    return { title: g.t('editor.title'), lines: [g.t('editor.help')], result: null };
  }
  dispose(): void {
    this.off?.();
    this.game.editing = false;
  }
}

// ── Survival ──
export const SURVIVAL_WAVES = 8;

export function waveComposition(wave: number): { robots: number; heavies: number } {
  return { robots: 2 + wave, heavies: wave >= 3 ? Math.floor((wave - 1) / 2) : 0 };
}

export class SurvivalMode implements GameMode {
  readonly id = 'survival';
  readonly defaultMap = 'industrial_yard';
  wave = 0;
  score = 0;
  lives = 3;
  private alive = new Set<NpcComponent>();
  private toSpawn: string[] = [];
  private spawnTimer = 0;
  private breakTimer = 3;
  private state: 'break' | 'wave' | 'over' = 'break';
  private result: ModeResult | null = null;
  private offs: (() => void)[] = [];

  constructor(private game: Game) {}

  configure(r: SessionRules): void {
    r.flight = false;
    r.damage = true;
    r.regen = false;
    r.manualRespawn = false;
    r.aggression = 'normal';
  }
  allowedTools() { return ['manipulator', 'blaster', 'impulse', 'freeze', 'bouncer', 'disintegrator', 'gravity']; }
  usesMapProps() { return true; }

  start(): void {
    const g = this.game;
    // Bystanders from the map would soak up the bots' attention.
    for (const e of [...g.entities.active]) if (e.def.kind === 'npc') g.entities.remove(e);
    this.offs.push(g.events.on('npcKilled', ({ npc }) => {
      if (!this.alive.delete(npc)) return;
      this.score += npc.profile.id === 'heavy' ? 300 : 100;
    }));
    g.player.onDeath = () => {
      this.lives--;
      if (this.lives <= 0) {
        g.player.holdDead();
        this.finish(false);
      } else {
        g.toast(g.t('survival.lifeLost', { n: this.lives }), 'warn');
      }
    };
    g.tools.selectById('blaster');
    g.setInputActive(true);
  }

  private finish(win: boolean): void {
    this.state = 'over';
    const g = this.game;
    if (win) this.score += this.lives * 500;
    this.result = {
      win,
      title: g.t(win ? 'survival.won' : 'survival.lost'),
      detail: g.t('survival.summary', { wave: this.wave, score: this.score }),
    };
    g.audio.play(win ? 'success' : 'error');
    g.onModeResult();
  }

  private spawnPoint(): V3 | null {
    const g = this.game;
    const nav = g.nav;
    const me = g.player.position;
    if (!nav) return { x: me.x + 16, y: me.y + 1, z: me.z };
    for (let i = 0; i < 25; i++) {
      const p = nav.randomNear(me, 42);
      if (p && p.y < 1 && dist(p, me) > 16) return { x: p.x, y: p.y + 1.6, z: p.z };
    }
    return null;
  }

  fixedUpdate(dt: number): void {
    if (this.state === 'over') return;
    const g = this.game;
    if (this.state === 'break') {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.startWave();
      return;
    }
    this.spawnTimer -= dt;
    if (this.toSpawn.length && this.spawnTimer <= 0) {
      this.spawnTimer = 0.8;
      const p = this.spawnPoint();
      if (p) {
        const r = g.entities.spawn(this.toSpawn[0]!, { position: p });
        if (r.ok) {
          this.toSpawn.shift();
          const n = r.entity.component(NpcComponent);
          if (n) {
            this.alive.add(n);
            n.hearNoise(g.player.position, 999);
          }
          g.fx.ring(p, 2.5, 0xff5a44, 0.5);
        }
      }
    }
    // Hunters always know roughly where the player is, so they can't get lost on a big map.
    for (const n of this.alive) if (n.state === 'idle' || n.state === 'patrol') n.alert(g.player.position);
    if (!this.toSpawn.length && this.alive.size === 0) this.endWave();
  }

  private startWave(): void {
    this.wave++;
    const w = waveComposition(this.wave);
    this.toSpawn = [...Array<string>(w.heavies).fill('npc_heavy'), ...Array<string>(w.robots).fill('npc_robot')];
    this.state = 'wave';
    this.spawnTimer = 0;
    this.game.audio.play('waveStart');
    this.game.toast(this.game.t('survival.waveStart', { n: this.wave }), 'warn');
  }

  private endWave(): void {
    const g = this.game;
    this.score += 250 * this.wave;
    if (this.wave >= SURVIVAL_WAVES) {
      this.finish(true);
      return;
    }
    this.state = 'break';
    this.breakTimer = 6;
    g.player.health = Math.min(g.player.maxHealth, g.player.health + 35);
    g.audio.play('success', 0.7);
    g.toast(g.t('survival.waveClear'), 'success');
  }

  hud(): ModeHud {
    const g = this.game;
    const remaining = this.alive.size + this.toSpawn.length;
    return {
      title: g.t('mode.survival'),
      lines: [
        g.t('survival.wave', { n: this.wave, max: SURVIVAL_WAVES }),
        this.state === 'break' ? g.t('survival.next', { s: Math.ceil(this.breakTimer) }) : g.t('survival.remaining', { n: remaining }),
        g.t('survival.score', { n: this.score }),
        g.t('survival.lives', { n: this.lives }),
      ],
      result: this.result,
    };
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.game.player.onDeath = null;
    this.alive.clear();
  }
}

// ── Contraption Challenge ──
export interface Challenge {
  id: string;
  /** Parts the player may place. */
  budget: number;
  /** Seconds; stars depend on it. */
  par: number;
  limit: number;
  tools: string[];
  /** What has to reach the target zone. */
  goal: 'player' | 'payload';
  build(b: MapBuilder): { target: Zone; payload?: { id: string; pos: V3 } };
}

const targetZone = (x: number, y: number, z: number, w: number, h: number, d: number): Zone => ({
  type: 'lowg',
  gravity: 1,
  min: { x: x - w / 2, y, z: z - d / 2 },
  max: { x: x + w / 2, y: y + h, z: z + d / 2 },
});

function deck(b: MapBuilder, x0: number, x1: number, z0: number, z1: number, y = 0): void {
  b.floor(x0, x1, z0, z1, y, 1, 'floor_tile', { tile: 2 });
}

function goalPad(b: MapBuilder, x: number, y: number, z: number, w: number, d: number): void {
  b.box(x, y + 0.02, z, w, 0.04, d, 'glow_teal', { collide: false, cast: false, tile: 8 });
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'bridge',
    budget: 6,
    par: 60,
    limit: 240,
    tools: BUILD_TOOLS,
    goal: 'player',
    build(b) {
      b.spawn = { x: 0, y: 0, z: 22 };
      deck(b, -15, 15, 8, 30);
      deck(b, -15, 15, -30, -6);
      b.sign(0, 3.2, -29.5, 9, 2.2, 0, 'ch_bridge', ['CROSS THE PIT'], '#10181c', '#ffb000');
      goalPad(b, 0, 0, -20, 8, 8);
      return { target: targetZone(0, 0, -20, 8, 3, 8) };
    },
  },
  {
    id: 'wire',
    budget: 3,
    par: 40,
    limit: 180,
    tools: BUILD_TOOLS,
    goal: 'player',
    build(b) {
      b.spawn = { x: 0, y: 0, z: 22 };
      deck(b, -30, 30, -30, 30);
      // A wall the door sits in.
      b.box(-16.2, 3.5, 0, 27.6, 7, 0.6, 'wall_dark', { tile: 3 });
      b.box(16.2, 3.5, 0, 27.6, 7, 0.6, 'wall_dark', { tile: 3 });
      b.box(0, 6.3, 0, 4.8, 1.4, 0.6, 'wall_dark', { tile: 3 });
      // Scaled to fill the opening exactly: the only way through is to power it.
      b.prop('door_powered', 0, 2.8, 0, { fixture: true, name: 'door', scale: 2 });
      b.sign(0, 6.3, 0.32, 8, 1.2, 0, 'ch_wire', ['POWER THE DOOR'], '#10181c', '#19e0c4');
      goalPad(b, 0, 0, -18, 8, 8);
      return { target: targetZone(0, 0, -18, 8, 3, 8) };
    },
  },
  {
    id: 'deliver',
    budget: 5,
    par: 90,
    limit: 300,
    tools: ['spawner', 'construction', 'remover', 'inspector', 'impulse'],
    goal: 'payload',
    build(b) {
      b.spawn = { x: -14, y: 0, z: 20 };
      deck(b, -30, 30, 8, 30);
      deck(b, -30, 30, -30, -6);
      b.sign(0, 3.4, -29.5, 11, 2.2, 0, 'ch_deliver', ['DELIVER THE SPHERE'], '#10181c', '#ffb000');
      goalPad(b, 0, 0, -16, 10, 10);
      return { target: targetZone(0, 0, -16, 10, 3, 10), payload: { id: 'ball_metal', pos: { x: 0, y: 0.51, z: 14 } } };
    },
  },
  {
    id: 'lift',
    budget: 4,
    par: 75,
    limit: 300,
    tools: ['spawner', 'construction', 'remover', 'inspector', 'impulse'],
    goal: 'payload',
    build(b) {
      b.spawn = { x: -8, y: 0, z: 20 };
      // Floor with a recessed bay against the ledge: a lift set in it starts flush with the floor and
      // rises exactly level with the ledge, so the crate can slide on at the bottom and off at the top.
      deck(b, -30, 30, -11, 30);
      deck(b, -30, 30, -30, -14);
      deck(b, -30, -1.5, -14, -11);
      deck(b, 1.5, 30, -14, -11);
      deck(b, -1.5, 1.5, -14, -11, -0.25);
      b.box(0, 0.01, -10.9, 3.4, 0.02, 0.2, 'hazard', { collide: false, tile: 1 });
      b.box(-1.6, 0.01, -12.5, 0.2, 0.02, 3.2, 'hazard', { collide: false, tile: 1 });
      b.box(1.6, 0.01, -12.5, 0.2, 0.02, 3.2, 'hazard', { collide: false, tile: 1 });
      b.box(0, 1.5, -22, 30, 3, 16, 'concrete', { tile: 3 });
      b.sign(0, 5.2, -29.9, 12, 2.4, 0, 'ch_lift', ['RAISE THE CRATE'], '#10181c', '#ffb000');
      goalPad(b, 0, 3, -22, 29.5, 15.5);
      return { target: targetZone(0, 3, -22, 30, 4, 16), payload: { id: 'crate_metal', pos: { x: 0, y: 0.51, z: 2 } } };
    },
  },
];

export function starsFor(partsUsed: number, budget: number, seconds: number, par: number): number {
  return 1 + (partsUsed <= Math.ceil(budget / 2) ? 1 : 0) + (seconds <= par ? 1 : 0);
}

export class ContraptionMode implements GameMode {
  readonly id = 'contraption';
  readonly defaultMap = 'proving_ground';
  readonly challenge: Challenge;
  time = 0;
  private payload: Entity | null = null;
  private payloadSpec: { id: string; pos: V3 } | undefined;
  private target: Zone | null = null;
  private inTarget = 0;
  private result: ModeResult | null = null;

  constructor(private game: Game, readonly index: number) {
    this.challenge = CHALLENGES[Math.max(0, Math.min(CHALLENGES.length - 1, index))]!;
  }

  configure(r: SessionRules): void {
    r.flight = false;
    r.damage = false;
  }
  allowedTools() { return this.challenge.tools; }
  usesMapProps() { return true; }

  extendMap(b: MapBuilder): void {
    const built = this.challenge.build(b);
    this.target = built.target;
    this.payloadSpec = built.payload;
  }

  start(): void {
    const s = this.payloadSpec;
    if (s) {
      const r = this.game.entities.spawn(s.id, { position: s.pos });
      if (r.ok) {
        this.payload = r.entity;
        // Otherwise the Move tool could simply put it on the goal.
        r.entity.locked = true;
      }
    }
    this.game.tools.setAllowed(this.challenge.tools);
    this.game.tools.selectById('construction');
  }

  get partsUsed(): number {
    return this.game.entities.active.filter((e) => !e.fixture && e !== this.payload).length;
  }

  placementDenied(_def: ItemDef): string | null {
    return this.partsUsed >= this.challenge.budget ? 'challenge.budget' : null;
  }

  private goalInside(): boolean {
    const z = this.target;
    if (!z) return false;
    const p = this.challenge.goal === 'player' ? this.game.player.feet : this.payload?.position;
    if (!p) return false;
    return p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y - 0.1 && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z;
  }

  fixedUpdate(dt: number): void {
    if (this.result) return;
    const g = this.game;
    this.time += dt;
    this.inTarget = this.goalInside() ? this.inTarget + dt : 0;
    if (this.payload?.dead) {
      this.fail(g.t('challenge.payloadLost'));
      return;
    }
    if (this.inTarget > 1) {
      const stars = starsFor(this.partsUsed, this.challenge.budget, this.time, this.challenge.par);
      this.result = {
        win: true,
        next: this.index < CHALLENGES.length - 1,
        title: `${g.t('challenge.done')} ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`,
        detail: g.t('challenge.summary', { parts: this.partsUsed, budget: this.challenge.budget, time: Math.round(this.time) }),
      };
      g.audio.play('success');
      g.onModeResult();
      return;
    }
    if (this.time > this.challenge.limit) this.fail(g.t('challenge.timeUp'));
  }

  private fail(detail: string): void {
    const g = this.game;
    this.result = { win: false, title: g.t('challenge.failed'), detail };
    g.audio.play('error');
    g.onModeResult();
  }

  hud(): ModeHud {
    const g = this.game;
    const c = this.challenge;
    return {
      title: `${g.t(`challenge.${c.id}.name`)} (${this.index + 1}/${CHALLENGES.length})`,
      lines: [
        g.t(`challenge.${c.id}.goal`),
        g.t('challenge.parts', { n: this.partsUsed, max: c.budget }),
        g.t('challenge.time', { t: Math.floor(this.time), limit: c.limit }),
      ],
      progress: this.inTarget > 0 ? this.inTarget : undefined,
      result: this.result,
    };
  }

  dispose(): void {
    this.game.tools.setAllowed(null);
  }
}

// ── Physics Playground ──
const GRAVITY_CYCLE = [9.81, 3.2, 14, 5.5];

const ORBS: V3[] = [
  { x: 0, y: 1.2, z: 13 }, { x: 8, y: 4.5, z: -4 }, { x: 0, y: 12, z: -7 }, { x: 26, y: 10.2, z: -4 },
  { x: -28, y: 7, z: -4 }, { x: -10, y: 7.8, z: -32 }, { x: 3, y: 10.2, z: -40 }, { x: 8, y: 19.2, z: -56 },
];

export class PlaygroundMode implements GameMode {
  readonly id = 'playground';
  readonly defaultMap = 'gravity_playground';
  private group = new THREE.Group();
  private orbs: { pos: V3; mesh: THREE.Mesh; taken: boolean }[] = [];
  collected = 0;
  time = 0;
  private gravityTimer = 25;
  private gravityIndex = 0;
  private warned = false;
  private result: ModeResult | null = null;
  private material = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 0.4) });

  constructor(private game: Game) {}

  configure(r: SessionRules): void {
    r.damage = false;
  }
  allowedTools() { return null; }
  usesMapProps() { return true; }

  extendMap(b: MapBuilder): void {
    // Timed obstacles: sweepers that shove the player across the hub.
    b.prop('moving_platform', -12, 2.9, -13.5, { fixture: true, params: { travel: 24, speed: 4, axis: 'x' }, scale: 0.7 });
    b.prop('moving_platform', -6, 2.9, 7.5, { fixture: true, params: { travel: 12, speed: 3.2, axis: 'x' }, scale: 0.5 });
  }

  start(): void {
    this.game.scene.add(this.group);
    for (const pos of ORBS) {
      const mesh = new THREE.Mesh(geo.sphere(0.32, 14), mat('glow_amber'));
      mesh.position.set(pos.x, pos.y, pos.z);
      this.group.add(mesh);
      this.orbs.push({ pos, mesh, taken: false });
    }
    this.game.tools.selectById('manipulator');
  }

  fixedUpdate(dt: number): void {
    const g = this.game;
    if (!this.result) this.time += dt;
    const me = g.player.position;
    for (const o of this.orbs) {
      if (o.taken) continue;
      o.mesh.position.y = o.pos.y + Math.sin(g.time * 2 + o.pos.x) * 0.15;
      o.mesh.rotation.y += dt;
      if (dist(me, o.mesh.position) < 1.8) {
        o.taken = true;
        o.mesh.visible = false;
        this.collected++;
        g.audio.play('pickup');
        g.fx.burst(o.pos, 18, 0xffc040, 4, 0.08, 0.5, 4);
        if (this.collected === this.orbs.length && !this.result) {
          this.result = {
            win: true,
            canContinue: true,
            title: g.t('playground.done'),
            detail: g.t('playground.summary', { t: this.time.toFixed(1) }),
          };
          g.audio.play('success');
          g.onModeResult();
        }
      }
    }
    this.gravityTimer -= dt;
    if (this.gravityTimer < 3 && !this.warned) {
      this.warned = true;
      g.toast(g.t('playground.shift'), 'warn');
      g.audio.play('gravityShift');
    }
    if (this.gravityTimer <= 0) {
      this.gravityTimer = 25;
      this.warned = false;
      this.gravityIndex = (this.gravityIndex + 1) % GRAVITY_CYCLE.length;
      g.setGravity(GRAVITY_CYCLE[this.gravityIndex]!);
    }
  }

  hud(): ModeHud {
    const g = this.game;
    return {
      title: g.t('mode.playground'),
      lines: [
        g.t('playground.orbs', { n: this.collected, max: this.orbs.length }),
        g.t('playground.gravity', { g: GRAVITY_CYCLE[this.gravityIndex]!.toFixed(1), s: Math.ceil(this.gravityTimer) }),
        g.t('challenge.time', { t: Math.floor(this.time), limit: '∞' }),
      ],
      result: this.result,
    };
  }

  /** Lets the player keep playing after finishing the optional objective. */
  continueAfterResult(): void {
    if (this.result) this.result = { ...this.result, canContinue: false };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.material.dispose();
  }
}

Object.assign(MODE_STORE, {
  sandbox: (g: Game) => new SandboxMode(g),
  survival: (g: Game) => new SurvivalMode(g),
  contraption: (g: Game, c: number) => new ContraptionMode(g, c),
  playground: (g: Game) => new PlaygroundMode(g),
  editor: (g: Game) => new EditorMode(g),
});
export const MODE_FACTORIES: Record<string, ModeFactory> = MODE_STORE;

