import * as THREE from 'three';
import { geo } from '../../rendering/geometry';
import { animateRig, buildNpcModel, type NpcRig } from '../../rendering/npcModels';
import { damp, dist, norm, sub, type V3 } from '../../utils/math';
import type { Game } from '../core/Game';
import type { Component, DamageSource, Entity } from '../entities/Entity';
import { Group, RAPIER } from '../physics/PhysicsWorld';
import type { Loc } from '../../data/materials';
import type { NpcOrder } from '../content/types';
import { NPC_PROFILES, NpcBrain, type NpcProfile, type NpcReaction, type NpcState } from './NpcBrain';

const LOS_MASK = Group.STATIC | Group.PROP | Group.VEHICLE;
const HP_GEO = geo.plane(0.8, 0.07);
const hpBack = new THREE.MeshBasicMaterial({ color: 0x101416, transparent: true, opacity: 0.8, depthTest: false });
const hpFill = new THREE.MeshBasicMaterial({ color: 0xff4d3d, depthTest: false });

type Target = { kind: 'player' } | { kind: 'npc'; npc: NpcComponent };

export class NpcComponent implements Component {
  readonly profile: NpcProfile;
  readonly brain: NpcBrain;
  readonly rig: NpcRig;
  private path: V3[] = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private thinkTimer = Math.random() * 0.3;
  private target: Target | null = null;
  private targetVisible = false;
  private targetDist = Infinity;
  private lastKnown: V3 | null = null;
  private destination: V3 | null = null;
  private patrolIndex = 0;
  private threat: V3 | null = null;
  private threatDist = Infinity;
  private hurtTimer = 0;
  private stunTimer = 0;
  private noiseAt: V3 | null = null;
  private provoked = false;
  private attackTimer = 0.4 + Math.random() * 0.5;
  private phase = 0;
  private yaw = Math.random() * 6;
  private speed01 = 0;
  private hopTimer = Math.random();
  private deadTimer = 0;
  private hpBar: THREE.Group | null = null;
  private hpFillMesh: THREE.Mesh | null = null;
  private hpShow = 0;
  private arrived = false;
  private stuckTimer = 0;
  private lastPos: V3 = { x: 0, y: 0, z: 0 };
  private avoidSide = 1;
  private cueTimer = Math.random() * 3;
  private debugLine: THREE.Line | null = null;
  private debugLabel: THREE.Sprite | null = null;
  private debugState: NpcState | null = null;
  disabledByFreeze = false;
  /** What it does when not fighting. Comes from the profile and can be changed at runtime. */
  order: NpcOrder = { kind: 'none' };
  /** A place it won't leave to fight or investigate, whatever its order. */
  territory: { point: V3; radius: number } | null = null;
  /** An enemy it was told to fight, whatever its faction. */
  private ordered: NpcComponent | null = null;
  /** Replaces the type's attack damage for this one NPC. */
  attackDamage: number | null = null;
  /** Sandbox overrides for this one NPC. Types share a profile, so these never touch it. Not saved. */
  aiEnabled = true;
  stance: 'friendly' | 'neutral' | 'hostile' | null = null;
  speedScale = 1;
  sightScale = 1;
  hearingScale = 1;
  private hookTimer = Math.random() * 0.25;
  private hookStarted = false;
  private scareTimer = 0;
  private home: V3;

  constructor(readonly e: Entity, private game: Game) {
    const archetype = String(e.def.params?.archetype ?? 'creature');
    this.profile = NPC_PROFILES[archetype] ?? NPC_PROFILES.creature!;
    this.brain = new NpcBrain(this.profile);
    e.maxHealth = this.profile.health;
    e.health = Math.min(e.health === 100 ? this.profile.health : e.health, this.profile.health);
    this.rig = buildNpcModel(archetype);
    e.root.add(this.rig.root);
    const b = e.body!;
    b.lockRotations(true, true);
    b.setLinearDamping(0.05);
    b.setAdditionalSolverIterations(1);
    for (const c of e.colliders) {
      c.setFriction(0.0);
      c.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      c.setRestitution(0);
    }
    game.npcs.push(this);
    this.home = { ...e.position };
    this.order = this.defaultOrder();
  }

  private defaultOrder(): NpcOrder {
    const p = this.profile;
    switch (p.behavior) {
      case 'follow': return { kind: 'follow', target: 'player', distance: p.followDistance ?? 3.5 };
      case 'guard': return { kind: 'guard', point: { ...this.home }, radius: p.guardRadius ?? 9 };
      case 'tinker': return { kind: 'tinker', radius: 14, target: null };
      case 'stand': return { kind: 'go_to', point: { ...this.home } };
      default: return { kind: 'none' };
    }
  }

  /** Replaces the current order. The NPC starts on it at its next decision. */
  setOrder(order: NpcOrder): void {
    this.order = order;
    this.arrived = false;
    if (this.brain.state === 'patrol') this.chooseWaypoint();
  }

  private text(v: string | Loc): string {
    return typeof v === 'string' ? this.game.t(v) : v[this.game.settings.language];
  }

  /** Puts a line of dialogue on screen under this NPC's name. */
  say(line: string | Loc): void {
    const who = this.profile.speaker ?? this.e.def.name;
    this.game.toast(`${this.text(who)}: ${this.text(line)}`, 'info');
    if (this.profile.voice !== 'silent') this.game.audio.play('npcTalk', 0.8, this.e.position);
  }

  /** Makes this NPC run from a point for a moment. */
  scare(p: V3, seconds = 3): void {
    this.threat = { ...p };
    this.scareTimer = Math.max(this.scareTimer, seconds);
  }

  /** How a nearby explosion is handled. Types that say nothing just hear the noise, as before. */
  reactToExplosion(p: V3, radius: number): void {
    const reaction: NpcReaction | undefined = this.profile.onExplosion;
    if (!reaction || !this.alive || dist(p, this.position) > Math.max(radius * 5, this.hearingRange)) return;
    if (reaction === 'flee') this.scare(p);
    else if (reaction === 'ignore') this.noiseAt = null;
  }

  /** Fixture NPCs can be pinned to a map patrol route. */
  get isHostileToPlayer(): boolean {
    if (this.stance) return this.stance === 'hostile';
    const h = this.profile.hostility;
    return h === 'always' || (h === 'provoked' && this.provoked);
  }

  /** Its side, counting a stance it was given. */
  get faction(): NpcProfile['faction'] {
    if (this.stance === 'friendly') return 'lab';
    if (this.stance === 'hostile') return 'rogue';
    return this.stance === 'neutral' ? 'neutral' : this.profile.faction;
  }

  get sightRange(): number {
    return this.profile.sight * this.sightScale;
  }

  get hearingRange(): number {
    return this.profile.hearing * this.hearingScale;
  }

  get state(): NpcState {
    return this.brain.state;
  }

  get alive(): boolean {
    return this.brain.state !== 'dead';
  }

  get position(): V3 {
    return this.e.position;
  }

  onRemove(): void {
    const i = this.game.npcs.indexOf(this);
    if (i >= 0) this.game.npcs.splice(i, 1);
    this.debugLine?.geometry.dispose();
    this.debugLine?.removeFromParent();
    this.debugLabel?.removeFromParent();
    (this.debugLabel?.material as THREE.SpriteMaterial | undefined)?.map?.dispose();
    (this.debugLabel?.material as THREE.SpriteMaterial | undefined)?.dispose();
  }

  onInteract(): boolean {
    if (!this.alive) return false;
    if (this.profile.hooks?.interact?.(this.e)) return true;
    const lines = this.profile.lines;
    if (lines?.length) {
      this.say(lines[Math.floor(Math.random() * lines.length)]!);
      return true;
    }
    return false;
  }

  interactHint() {
    if (!this.alive) return null;
    const h = this.profile.hooks?.hint;
    if (h) return this.text(h);
    return this.profile.lines?.length || this.profile.hooks?.interact ? this.game.t('hint.talk') : null;
  }

  onDamage(amount: number, src: DamageSource): void {
    if (!this.alive) return;
    this.hurtTimer = 2.5;
    this.hpShow = 4;
    if (src.kind === 'player') {
      if (this.profile.hostility === 'provoked') this.provoked = true;
      this.noiseAt = this.game.player.position;
    }
    if (src.entity) this.noiseAt = src.entity.position;
    this.profile.hooks?.damage?.(this.e, amount, src);
    if (this.profile.voice !== 'silent') this.game.audio.play(this.profile.voice === 'creature' ? 'creature' : 'npcHurt', 0.7, this.position);
    this.game.fx.burst(src.point ?? this.position, Math.min(14, 4 + amount / 4), this.profile.faction === 'rogue' ? 0xffc040 : 0xff6040, 3.5, 0.07, 0.4, 10);
    if (this.e.health <= 0) this.die(src);
  }

  private die(src: DamageSource): void {
    this.brain.force('dead');
    this.deadTimer = 7;
    const b = this.e.body;
    if (b) {
      b.lockRotations(false, true);
      const side = Math.random() > 0.5 ? 1 : -1;
      b.applyTorqueImpulse({ x: side * b.mass() * 0.9, y: 0, z: side * b.mass() * 0.5 }, true);
      for (const c of this.e.colliders) c.setFriction(0.8);
    }
    this.game.audio.play('npcDie', 0.9, this.position);
    this.hpShow = 0;
    if (this.hpBar) this.hpBar.visible = false;
    const byPlayer = src.kind === 'player' || (src.kind === 'explosion' && src.entity === null);
    this.profile.hooks?.death?.(this.e, byPlayer);
    this.game.events.emit('npcKilled', { npc: this, byPlayer });
  }

  stun(seconds: number): void {
    this.stunTimer = Math.max(this.stunTimer, seconds);
  }

  /** Makes this NPC go and look at a position, regardless of hearing range. */
  alert(p: V3): void {
    this.noiseAt = { ...p };
  }

  hearNoise(p: V3, radius: number): void {
    if (dist(p, this.position) <= Math.min(radius, this.hearingRange) && this.mayGoTo(p)) this.noiseAt = { ...p };
  }

  // ── Perception ──
  private validPlayerTarget(): boolean {
    const pl = this.game.player;
    if (pl.dead || pl.flying || !pl.body) return false;
    return this.game.rules.aggression !== 'passive' || this.provoked || this.stance === 'hostile';
  }

  private selectTarget(): void {
    const me = this.position;
    const prof = this.profile;
    let best: Target | null = null;
    const sightK = this.game.rules.aggression === 'high' ? 1.5 : 1;
    let bestD = this.sightRange * sightK;
    const ordered = this.ordered;
    if (ordered && (!ordered.alive || ordered.e.dead)) this.ordered = null;
    if (this.ordered && prof.attack !== 'none' && this.withinLeash(this.ordered.position)) {
      this.target = { kind: 'npc', npc: this.ordered };
      this.targetDist = dist(me, this.ordered.position);
      return;
    }
    if (prof.attack !== 'none') {
      if (this.isHostileToPlayer && this.validPlayerTarget() && this.withinLeash(this.game.player.position)) {
        const d = dist(me, this.game.player.position);
        if (d < bestD) { bestD = d; best = { kind: 'player' }; }
      }
      if (this.faction !== 'neutral') {
        for (const other of this.game.npcs) {
          if (other === this || !other.alive) continue;
          if (!this.isEnemy(other) || !this.withinLeash(other.position)) continue;
          const d = dist(me, other.position);
          if (d < bestD) { bestD = d; best = { kind: 'npc', npc: other }; }
        }
      }
    }
    // Out of range is not the same as gone: head for where the target was last seen.
    if (!best && this.target && this.lastKnown && this.targetStillValid(this.target) && this.mayGoTo(this.lastKnown)) this.noiseAt = { ...this.lastKnown };
    this.target = best;
    this.targetDist = best ? bestD : Infinity;
  }

  /** A guard, or an NPC with a territory, only fights what comes within reach of the place it looks after. */
  private withinLeash(p: V3): boolean {
    const o = this.order;
    if (o.kind === 'guard' && dist(o.point, p) > o.radius + this.profile.attackRange) return false;
    const t = this.territory;
    return !t || dist(t.point, p) <= t.radius + this.profile.attackRange;
  }

  /** Whether it may walk to this point to look for something. */
  private mayGoTo(p: V3): boolean {
    const o = this.order;
    if (o.kind === 'guard' && dist(o.point, p) > o.radius) return false;
    const t = this.territory;
    return !t || dist(t.point, p) <= t.radius;
  }

  /** Makes it fight another NPC of any faction until that one dies, or until cleared with null. */
  attackNpc(other: NpcComponent | null): void {
    this.ordered = other === this ? null : other;
    this.thinkTimer = 0;
  }

  /** Who it's fighting: the player, another NPC's entity, or nobody. */
  get targetEntity(): 'player' | Entity | null {
    const t = this.target;
    if (!t) return null;
    return t.kind === 'player' ? 'player' : t.npc.e;
  }

  get canSeeTarget(): boolean {
    return this.target !== null && this.targetVisible;
  }

  get wasProvoked(): boolean {
    return this.provoked;
  }

  set wasProvoked(v: boolean) {
    this.provoked = v;
  }

  isEnemy(other: NpcComponent): boolean {
    const a = this.faction;
    const b = other.faction;
    return (a === 'rogue' && b === 'lab') || (a === 'lab' && b === 'rogue');
  }

  /** Living enemies within sight range with a clear line, nearest first. */
  enemiesInSight(limit = 16): Entity[] {
    const me = this.position;
    const found = this.game.npcs.filter((n) => n !== this && n.alive && !n.e.dead && this.isEnemy(n)).map((n) => ({ n, d: dist(me, n.position) })).filter((x) => x.d <= this.sightRange).sort((a, b) => a.d - b.d).slice(0, limit);
    const out: Entity[] = [];
    for (const { n, d } of found) {
      const from = { x: me.x, y: me.y + 0.5, z: me.z };
      const q = n.position;
      const dir = norm(sub({ x: q.x, y: q.y + 0.4, z: q.z }, from));
      if (!this.game.physics.raycast(from, dir, d, { mask: LOS_MASK, exclude: this.e.body })) out.push(n.e);
    }
    return out;
  }

  private targetStillValid(t: Target): boolean {
    return t.kind === 'player' ? this.validPlayerTarget() : t.npc.alive && !t.npc.e.dead;
  }

  private targetPos(): V3 | null {
    if (!this.target) return null;
    if (this.target.kind === 'player') return this.game.player.position;
    return this.target.npc.alive && !this.target.npc.e.dead ? this.target.npc.position : null;
  }

  private checkLos(): void {
    const tp = this.targetPos();
    if (!tp) {
      this.targetVisible = false;
      return;
    }
    const me = this.position;
    const from = { x: me.x, y: me.y + 0.5, z: me.z };
    const to = { x: tp.x, y: tp.y + 0.4, z: tp.z };
    const delta = sub(to, from);
    const d = Math.hypot(delta.x, delta.y, delta.z);
    const dir = norm(delta);
    const hit = this.game.physics.raycast(from, dir, d, { mask: LOS_MASK, exclude: this.e.body });
    this.targetVisible = !hit;
    if (this.targetVisible) this.lastKnown = { ...tp };
  }

  private scanThreats(): void {
    this.threatDist = Infinity;
    if (!this.profile.skittish) return;
    const me = this.position;
    const pl = this.game.player;
    const pd = dist(me, pl.position);
    if (pl.speed > 6.5 && pd < this.hearingRange) {
      this.threatDist = pd;
      this.threat = pl.position;
    }
    for (const e of this.game.entities.active) {
      if (!e.body || !e.body.isDynamic() || e.body.isSleeping() || e === this.e) continue;
      const v = e.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) < 5) continue;
      const d = dist(me, e.position);
      if (d < this.threatDist) {
        this.threatDist = d;
        this.threat = e.position;
      }
    }
  }

  fixedUpdate(dt: number): void {
    const b = this.e.body;
    if (!b) return;
    if (this.brain.state === 'dead') {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0 && !this.game.rules.keepCorpses) this.game.entities.remove(this.e);
      return;
    }
    if (!this.aiEnabled) {
      // Physics still applies: it can be pushed and can fall, but it doesn't think or walk.
      this.target = null;
      this.targetVisible = false;
      if (b.isDynamic()) {
        const v = b.linvel();
        b.setLinvel({ x: v.x * 0.8, y: v.y, z: v.z * 0.8 }, true);
      }
      return;
    }
    this.runHooks(dt);
    if (this.e.dead || !this.e.body) return;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.stunTimer = Math.max(0, this.stunTimer - dt);
    this.scareTimer = Math.max(0, this.scareTimer - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    const me = b.translation();

    const distToPlayer = dist(me, this.game.player.position);
    const far = distToPlayer > 70;
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0 && this.game.npcBudget.perception > 0) {
      this.game.npcBudget.perception--;
      this.thinkTimer = far ? 1 : 0.28;
      this.selectTarget();
      this.checkLos();
      this.scanThreats();
    }
    if (this.target && !this.targetPos()) {
      this.target = null;
      this.targetVisible = false;
    }
    if (this.target) {
      const tp = this.targetPos();
      if (tp) this.targetDist = dist(me, tp);
    }
    const noise = this.noiseAt !== null;
    const prev = this.brain.state;
    const state = this.brain.update(dt, {
      hasTarget: this.target !== null,
      targetVisible: this.targetVisible,
      targetDist: this.targetDist,
      threatDist: this.threatDist,
      noise,
      hurt: this.hurtTimer > 2.2,
      stunned: this.stunTimer > 0 || this.e.frozen,
      health: this.e.health,
      arrived: this.arrived,
      wantsMove: this.orderWantsMove(me),
      scared: this.scareTimer > 0,
    });
    if (state !== prev) this.onStateChanged(prev, state);
    if (this.e.frozen) return;
    if (state === 'patrol') this.trackOrder(me);
    if (far && state !== 'chase' && state !== 'attack') {
      // Distant NPCs in calm states stop steering: physics still applies, the AI just idles.
      return;
    }
    this.steer(dt, state, me);
    if (state === 'attack') this.attack();
    this.cueTimer -= dt;
    if (this.cueTimer <= 0) {
      this.cueTimer = 4 + Math.random() * 6;
      if (distToPlayer < 18) {
        if (this.profile.voice === 'creature') this.game.audio.play('creature', 0.25, me);
        else if (this.profile.voice === 'robot') this.game.audio.play('robotIdle', 0.3, me);
      }
    }
  }

  private runHooks(dt: number): void {
    const hooks = this.profile.hooks;
    if (!hooks) return;
    if (!this.hookStarted) {
      this.hookStarted = true;
      hooks.spawn?.(this.e);
    }
    if (!hooks.think) return;
    this.hookTimer -= dt;
    if (this.hookTimer > 0) return;
    this.hookTimer = 0.25;
    hooks.think(this.e, 0.25);
  }

  // ── Orders ──
  private orderTarget(): V3 | null {
    const o = this.order;
    if (o.kind === 'follow') return o.target === 'player' ? (this.game.player.body ? this.game.player.position : null) : this.game.entities.get(o.target)?.position ?? null;
    if (o.kind === 'use') return this.game.entities.get(o.target)?.position ?? null;
    if (o.kind === 'tinker' && o.target !== null) return this.game.entities.get(o.target)?.position ?? null;
    return null;
  }

  private orderWantsMove(me: V3): boolean {
    const o = this.order;
    const home = this.territory;
    if (home && Math.hypot(home.point.x - me.x, home.point.z - me.z) > home.radius) return true;
    switch (o.kind) {
      case 'go_to': return Math.hypot(o.point.x - me.x, o.point.z - me.z) > 1.2;
      case 'follow': {
        const t = this.orderTarget();
        return !!t && Math.hypot(t.x - me.x, t.z - me.z) > o.distance + 0.8;
      }
      case 'guard': return Math.hypot(o.point.x - me.x, o.point.z - me.z) > o.radius;
      case 'patrol': return o.route.length > 0;
      case 'use': return true;
      default: return false;
    }
  }

  /** Keeps the destination up to date with a moving target, and notices having reached it. */
  private trackOrder(me: V3): void {
    const o = this.order;
    if (o.kind === 'follow') {
      const t = this.orderTarget();
      if (!t) return;
      this.destination = t;
      if (Math.hypot(t.x - me.x, t.z - me.z) <= o.distance) this.arrived = true;
    } else if (o.kind === 'use' || o.kind === 'tinker') {
      const t = this.orderTarget();
      if (o.kind === 'use' && !t) {
        this.order = { kind: 'none' };
        return;
      }
      if (t) {
        this.destination = t;
        if (Math.hypot(t.x - me.x, t.z - me.z) <= 2) this.useTarget();
      }
    }
  }

  private useTarget(): void {
    const o = this.order;
    if (o.kind !== 'use' && o.kind !== 'tinker') return;
    const id = o.target;
    const t = id === null ? undefined : this.game.entities.get(id);
    if (o.kind === 'use') this.order = { kind: 'none' };
    else o.target = null;
    this.arrived = true;
    if (!t) return;
    let used = false;
    for (const c of t.components) if (c.onInteract?.()) { used = true; break; }
    if (!used && t.body?.isDynamic()) {
      // Nothing to press, so it gives the thing a shove.
      const me = this.position;
      const away = norm({ x: t.position.x - me.x, y: 0, z: t.position.z - me.z });
      const m = t.body.mass();
      t.body.applyImpulse({ x: away.x * m * 3, y: m * 1.5, z: away.z * m * 3 }, true);
      this.game.audio.play('click', 0.4, t.position);
    }
  }

  /** Something to walk over and fiddle with: interactive things first, then light props. */
  private pickTinkerTarget(radius: number): number | null {
    const me = this.position;
    let best: number | null = null;
    let bestScore = Infinity;
    for (const e of this.game.entities.active) {
      if (e === this.e || e.dead || e.def.kind === 'npc' || e.def.kind === 'vehicle') continue;
      const d = dist(me, e.position);
      if (d > radius || d < 2.2) continue;
      const interactive = e.components.some((c) => c.onInteract);
      if (!interactive && !(e.body?.isDynamic() && e.mass < 200)) continue;
      const score = (interactive ? d * 0.5 : d) + Math.random() * 5;
      if (score < bestScore) {
        bestScore = score;
        best = e.id;
      }
    }
    return best;
  }

  private onStateChanged(_from: NpcState, to: NpcState): void {
    this.arrived = false;
    this.path = [];
    this.pathIndex = 0;
    this.repathTimer = 0;
    if (to === 'investigate') {
      this.destination = this.noiseAt ?? this.lastKnown ?? null;
      this.noiseAt = null;
      if (!this.destination) this.arrived = true;
    }
    if (to === 'patrol') this.chooseWaypoint();
    if (to === 'chase' && (_from === 'idle' || _from === 'patrol' || _from === 'investigate')) {
      this.game.audio.play('npcAlert', 0.6, this.position);
      this.hpShow = Math.max(this.hpShow, 1.5);
    }
    if (to === 'flee' && this.profile.voice !== 'silent') this.game.audio.play(this.profile.voice === 'creature' ? 'creature' : 'npcTalk', 0.5, this.position);
  }

  private chooseWaypoint(): void {
    const o = this.order;
    const me0 = this.position;
    const home = this.territory;
    if (home && Math.hypot(home.point.x - me0.x, home.point.z - me0.z) > home.radius) {
      this.destination = home.point;
      return;
    }
    switch (o.kind) {
      case 'go_to':
        this.destination = o.point;
        return;
      case 'follow':
      case 'use': {
        const t = this.orderTarget();
        this.destination = t;
        if (!t) this.arrived = true;
        return;
      }
      case 'guard': {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * o.radius * 0.6;
        const near = { x: o.point.x + Math.cos(a) * r, y: me0.y, z: o.point.z + Math.sin(a) * r };
        this.destination = this.game.nav?.randomNear(o.point, o.radius * 0.6) ?? near;
        return;
      }
      case 'patrol':
        if (!o.route.length) break;
        this.destination = o.route[o.index % o.route.length]!;
        o.index = o.index + 1;
        if (!o.loop && o.index > o.route.length) {
          this.order = { kind: 'none' };
          this.arrived = true;
        }
        return;
      case 'tinker':
        o.target = this.pickTinkerTarget(o.radius);
        if (o.target !== null) {
          this.destination = this.orderTarget();
          return;
        }
        break;
      default:
        break;
    }
    const routes = this.game.map?.patrols ?? [];
    if (this.profile.behavior === 'patrol' && routes.length) {
      const route = routes[this.e.id % routes.length]!;
      this.patrolIndex = (this.patrolIndex + 1) % route.length;
      this.destination = route[this.patrolIndex]!;
      return;
    }
    const me = this.position;
    const nav = this.game.nav;
    const q = nav?.randomNear(me, 9);
    if (q) {
      this.destination = q;
    } else {
      const a = Math.random() * Math.PI * 2;
      this.destination = { x: me.x + Math.cos(a) * 4, y: me.y, z: me.z + Math.sin(a) * 4 };
    }
  }

  private goalFor(state: NpcState, me: V3): { goal: V3 | null; speed: number; useNav: boolean } {
    const prof = this.profile;
    const haste = this.game.rules.aggression === 'high' ? 1.2 : 1;
    switch (state) {
      case 'patrol':
      case 'investigate':
        return { goal: this.destination, speed: state === 'investigate' ? prof.runSpeed * 0.8 : prof.walkSpeed, useNav: true };
      case 'chase':
        return { goal: this.targetVisible ? this.targetPos() : (this.lastKnown ?? this.targetPos()), speed: prof.runSpeed * haste, useNav: !this.targetVisible };
      case 'attack': {
        // Ranged attackers keep distance; melee presses forward.
        if (prof.attack === 'slam') return { goal: this.targetPos(), speed: prof.walkSpeed, useNav: false };
        return { goal: null, speed: 0, useNav: false };
      }
      case 'flee': {
        const from = this.threat ?? this.noiseAt ?? this.game.player.position;
        const away = norm({ x: me.x - from.x, y: 0, z: me.z - from.z });
        const dir = Math.hypot(away.x, away.z) > 0 ? away : { x: 1, y: 0, z: 0 };
        return { goal: { x: me.x + dir.x * 6, y: me.y, z: me.z + dir.z * 6 }, speed: prof.runSpeed, useNav: false };
      }
      default:
        return { goal: null, speed: 0, useNav: false };
    }
  }

  private steer(dt: number, state: NpcState, me: V3): void {
    const b = this.e.body!;
    const { goal, speed: baseSpeed, useNav } = this.goalFor(state, me);
    const speed = baseSpeed * this.speedScale;
    let dirX = 0;
    let dirZ = 0;
    if (goal && speed > 0) {
      let aim = goal;
      if (useNav && this.game.nav) {
        this.repathTimer -= dt;
        if (this.repathTimer <= 0 && this.game.npcBudget.paths > 0) {
          this.game.npcBudget.paths--;
          this.repathTimer = 0.9 + Math.random() * 0.4;
          this.path = this.game.nav.findPath(me, goal) ?? [];
          this.pathIndex = this.path.length > 1 ? 1 : 0;
        }
        if (this.path.length) {
          while (this.pathIndex < this.path.length - 1 && Math.hypot(this.path[this.pathIndex]!.x - me.x, this.path[this.pathIndex]!.z - me.z) < 0.9) this.pathIndex++;
          aim = this.path[Math.min(this.pathIndex, this.path.length - 1)]!;
        }
      }
      const dx = aim.x - me.x;
      const dz = aim.z - me.z;
      const d = Math.hypot(dx, dz);
      if (Math.hypot(goal.x - me.x, goal.z - me.z) < 1.2) {
        this.arrived = true;
      } else if (d > 0.01) {
        dirX = dx / d;
        dirZ = dz / d;
      }
      // Stuck detection: patrols pick something else; chases try another way round. Measured over a window,
      // because an NPC jittering against an obstacle moves quickly from frame to frame while getting nowhere.
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.4) {
        const moved = Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z);
        if (moved < speed * this.stuckTimer * 0.2) {
          this.avoidSide = -this.avoidSide;
          if (state === 'patrol') this.arrived = true;
        }
        this.stuckTimer = 0;
        this.lastPos = { ...me };
      }
    }

    if (dirX !== 0 || dirZ !== 0) {
      // Short feelers around solid props, plus a ledge check so NPCs don't walk into the void.
      const avoid = this.avoid(me, dirX, dirZ);
      dirX = avoid.x;
      dirZ = avoid.z;
    }

    const v = b.linvel();
    const k = 18 * dt;
    const onFoot = Math.abs(v.y) < 3;
    const vx = v.x + (dirX * speed - v.x) * Math.min(1, onFoot ? k : k * 0.2);
    const vz = v.z + (dirZ * speed - v.z) * Math.min(1, onFoot ? k : k * 0.2);
    let vy = v.y;
    if (this.profile.hops && (dirX !== 0 || dirZ !== 0) && onFoot) {
      this.hopTimer -= dt;
      // Only from the ground: hopping again at the top of a hop climbs into the air like a staircase.
      if (this.hopTimer <= 0 && this.onGround(me)) {
        this.hopTimer = 0.42;
        vy = 3.2;
      }
    }
    b.setLinvel({ x: vx, y: vy, z: vz }, true);

    const horizontal = Math.hypot(vx, vz);
    this.speed01 = Math.min(1, horizontal / Math.max(0.1, this.profile.runSpeed * 0.8));
    let faceX = dirX;
    let faceZ = dirZ;
    const tp = state === 'attack' || state === 'chase' ? this.targetPos() : null;
    if (tp) {
      faceX = tp.x - me.x;
      faceZ = tp.z - me.z;
    }
    if (faceX !== 0 || faceZ !== 0) {
      const targetYaw = Math.atan2(-faceX, -faceZ);
      let diff = targetYaw - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, 8 * dt);
    }
  }

  private onGround(me: V3): boolean {
    const shape = this.e.def.shape;
    const halfH = shape.type === 'capsule' ? shape.h / 2 : 0.8;
    return !!this.game.physics.raycast({ x: me.x, y: me.y - halfH + 0.1, z: me.z }, { x: 0, y: -1, z: 0 }, 0.2, { mask: Group.STATIC | Group.PROP | Group.VEHICLE, exclude: this.e.body });
  }

  private avoid(me: V3, dx: number, dz: number): { x: number; z: number } {
    const phys = this.game.physics;
    const shape = this.e.def.shape;
    const r = shape.type === 'capsule' ? shape.r : 0.4;
    const halfH = shape.type === 'capsule' ? shape.h / 2 : 0.8;
    const look = r + 0.9;
    const origin = { x: me.x, y: me.y - halfH + 0.55, z: me.z };
    const hit = phys.raycast(origin, { x: dx, y: 0, z: dz }, look, { mask: Group.STATIC | Group.PROP | Group.VEHICLE, exclude: this.e.body });
    let x = dx;
    let z = dz;
    if (hit) {
      const s = this.avoidSide;
      // Sidestep along the obstacle.
      x = dx * 0.25 + -dz * s;
      z = dz * 0.25 + dx * s;
      const l = Math.hypot(x, z);
      x /= l;
      z /= l;
    }
    // Is there floor ahead?
    const probe = { x: me.x + x * (r + 0.6), y: me.y, z: me.z + z * (r + 0.6) };
    const floor = phys.raycast(probe, { x: 0, y: -1, z: 0 }, halfH + 2.5, { mask: Group.STATIC | Group.PROP, exclude: this.e.body });
    if (!floor) {
      this.arrived = true;
      return { x: 0, z: 0 };
    }
    return { x, z };
  }

  private attack(): void {
    if (this.attackTimer > 0) return;
    const prof = this.profile;
    const tp = this.targetPos();
    if (!tp) return;
    this.attackTimer = prof.attackCooldown * (this.game.rules.aggression === 'high' ? 0.75 : 1);
    if (prof.attack === 'script') {
      prof.hooks?.attack?.(this.e, tp, this.target?.kind === 'npc' ? this.target.npc.e : null);
      return;
    }
    const me = this.position;
    const muzzle = { x: me.x - Math.sin(this.yaw) * 0.5, y: me.y + 0.45, z: me.z - Math.cos(this.yaw) * 0.5 };
    const aimAt = { x: tp.x + (Math.random() - 0.5) * 0.5, y: tp.y + 0.25, z: tp.z + (Math.random() - 0.5) * 0.5 };
    const dir = norm(sub(aimAt, muzzle));
    if (prof.attack === 'bolt') {
      this.game.projectiles.fire(muzzle, dir, 22, this.attackDamage ?? prof.attackDamage, this.e);
      this.game.audio.play('robotShot', 0.7, muzzle);
    } else if (prof.attack === 'tracer') {
      const hit = this.game.physics.raycast(muzzle, dir, prof.attackRange * 1.3, { mask: Group.STATIC | Group.PROP | Group.NPC | Group.VEHICLE | Group.PLAYER, exclude: this.e.body });
      const end = hit?.point ?? { x: muzzle.x + dir.x * prof.attackRange, y: muzzle.y + dir.y * prof.attackRange, z: muzzle.z + dir.z * prof.attackRange };
      this.game.fx.beam(muzzle, end, 0xffb000, 0.015, 0.09);
      this.game.audio.play('tracer', 0.5, muzzle);
      if (hit) this.game.applyHit(hit, this.attackDamage ?? prof.attackDamage, dir, 120, { kind: 'npc', entity: this.e, point: hit.point });
    } else if (prof.attack === 'slam') {
      this.game.shockwave(me, 6, 1000, this.attackDamage ?? prof.attackDamage, this.e);
      this.game.audio.play('slam', 1, me);
    }
  }

  update(dt: number): void {
    this.rig.root.rotation.y = this.yaw;
    if (this.brain.state === 'dead') {
      animateRig(this.rig, this.phase, 0, this.game.time);
      return;
    }
    this.phase += dt * this.speed01 * 10 * (this.profile.gait ?? 1);
    this.speed01 = damp(this.speed01, 0, 3, dt);
    animateRig(this.rig, this.phase, this.e.frozen ? 0 : this.speed01, this.e.frozen ? 0 : this.game.time);
    if (this.profile.attack !== 'none' && this.brain.state === 'attack') {
      this.rig.armR.rotation.x = -1.35;
    }
    this.updateHpBar(dt);
    if (this.game.aiDebug) this.drawDebug();
    else if (this.debugLine) this.hideDebug();
  }

  private updateHpBar(dt: number): void {
    this.hpShow = Math.max(0, this.hpShow - dt);
    if (this.hpShow <= 0) {
      if (this.hpBar) this.hpBar.visible = false;
      return;
    }
    if (!this.hpBar) {
      const g = new THREE.Group();
      const back = new THREE.Mesh(HP_GEO, hpBack);
      back.renderOrder = 20;
      const fill = new THREE.Mesh(HP_GEO, hpFill);
      fill.position.z = 0.001;
      fill.renderOrder = 21;
      g.add(back, fill);
      const shape = this.e.def.shape;
      g.position.y = (shape.type === 'capsule' ? shape.h / 2 : 1) + 0.28;
      this.e.root.add(g);
      this.hpBar = g;
      this.hpFillMesh = fill;
    }
    this.hpBar.visible = true;
    this.hpBar.quaternion.copy(this.game.camera.quaternion);
    const k = Math.max(0.001, this.e.health / this.e.maxHealth);
    this.hpFillMesh!.scale.x = k;
    this.hpFillMesh!.position.x = -0.4 * (1 - k);
  }

  // ── Debug visualisation (F4) ──
  private drawDebug(): void {
    if (!this.debugLine) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 64), 3));
      this.debugLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x19e0c4, depthTest: false }));
      this.debugLine.frustumCulled = false;
      this.debugLine.renderOrder = 30;
      this.game.debugGroup.add(this.debugLine);
    }
    const attr = this.debugLine.geometry.attributes.position as THREE.BufferAttribute;
    let n = 0;
    const me = this.position;
    const put = (p: V3) => {
      if (n < 64) attr.setXYZ(n++, p.x, p.y, p.z);
    };
    put(me);
    if (this.path.length) for (let i = this.pathIndex; i < this.path.length; i++) put({ x: this.path[i]!.x, y: this.path[i]!.y + 0.15, z: this.path[i]!.z });
    else if (this.destination) put(this.destination);
    const tp = this.targetPos();
    if (tp) put(tp);
    this.debugLine.geometry.setDrawRange(0, n);
    attr.needsUpdate = true;
    this.debugLine.visible = true;
    if (this.debugState !== this.brain.state && typeof document !== 'undefined') {
      this.debugState = this.brain.state;
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = 'rgba(8,14,16,0.82)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = this.brain.state === 'attack' || this.brain.state === 'chase' ? '#ff6a50' : '#19e0c4';
      ctx.font = 'bold 34px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.brain.state.toUpperCase(), 128, 44);
      const tex = new THREE.CanvasTexture(c);
      if (!this.debugLabel) {
        this.debugLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
        this.debugLabel.scale.set(1.6, 0.4, 1);
        const shape = this.e.def.shape;
        this.debugLabel.position.y = (shape.type === 'capsule' ? shape.h / 2 : 1) + 0.6;
        this.e.root.add(this.debugLabel);
      } else {
        (this.debugLabel.material as THREE.SpriteMaterial).map?.dispose();
        (this.debugLabel.material as THREE.SpriteMaterial).map = tex;
      }
    }
    if (this.debugLabel) this.debugLabel.visible = true;
  }

  private hideDebug(): void {
    if (this.debugLine) this.debugLine.visible = false;
    if (this.debugLabel) this.debugLabel.visible = false;
  }

  debugInfo() {
    return {
      state: this.brain.state,
      target: this.target?.kind ?? null,
      visible: this.targetVisible,
      distance: this.targetDist,
      pathLength: this.path.length,
    };
  }

  save() {
    const d = this.e.scriptData;
    return {
      npc: { state: this.brain.state === 'dead' ? 'dead' : 'idle', provoked: this.provoked, yaw: this.yaw, order: this.order, territory: this.territory, attackDamage: this.attackDamage },
      ...(d && Object.keys(d).length ? { script: d } : {}),
    };
  }

  load(d: Record<string, unknown>) {
    if (d.script && typeof d.script === 'object' && !Array.isArray(d.script)) this.e.scriptData = d.script as Record<string, unknown>;
    const n = d.npc as { state?: string; provoked?: boolean; yaw?: number; order?: NpcOrder; territory?: { point: V3; radius: number } | null; attackDamage?: number | null } | undefined;
    if (!n) return;
    this.provoked = n.provoked === true;
    if (typeof n.yaw === 'number') this.yaw = n.yaw;
    if (n.order && typeof n.order.kind === 'string') this.order = n.order;
    if (n.territory) this.territory = n.territory;
    if (typeof n.attackDamage === 'number') this.attackDamage = n.attackDamage;
  }
}
