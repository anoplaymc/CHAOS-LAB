/** The decision layer of an NPC. Pure logic, so transitions can be tested without physics. */
import type { Loc } from '../../data/materials';
import type { NpcBehaviorName, NpcHooks, NpcModelSpec } from '../content/types';

export type NpcState = 'idle' | 'patrol' | 'investigate' | 'chase' | 'attack' | 'flee' | 'stunned' | 'dead';

/** What an NPC does when it hears of an event. */
export type NpcReaction = 'ignore' | 'investigate' | 'flee';

export interface NpcProfile {
  id: string;
  health: number;
  walkSpeed: number;
  runSpeed: number;
  sight: number;
  hearing: number;
  attackRange: number;
  attackCooldown: number;
  attackDamage: number;
  attack: 'none' | 'bolt' | 'tracer' | 'slam' | 'script';
  /** Which side of the lab's little conflict this NPC is on. */
  faction: 'lab' | 'rogue' | 'neutral';
  /** always: hunts the player. provoked: only after being hurt by the player. never: harmless. */
  hostility: 'always' | 'provoked' | 'never';
  fleesWhenHurt: boolean;
  /** Runs from fast movement nearby. */
  skittish: boolean;
  memory: number;
  hops: boolean;
  /** Which family of sounds it makes. Defaults to 'human'. */
  voice?: 'human' | 'creature' | 'robot' | 'silent';
  /** Multiplier on the walk animation's speed. */
  gait?: number;
  /** What it does when not fighting. Defaults to 'wander'. */
  behavior?: NpcBehaviorName;
  guardRadius?: number;
  followDistance?: number;
  /** Lines spoken with E, as i18n keys or text. Having any makes it talkable. */
  lines?: (string | Loc)[];
  speaker?: string | Loc;
  /** A named preset that adjusts the numbers above. See PERSONALITIES. */
  personality?: string;
  /** Reaction to an explosion nearby. Defaults to its hearing behaviour. */
  onExplosion?: NpcReaction;
  model?: NpcModelSpec;
  hooks?: NpcHooks;
}

/** Personalities are data: each adjusts a profile when an NPC type is registered. */
export const PERSONALITIES: Record<string, (p: NpcProfile) => Partial<NpcProfile>> = {
  brave: () => ({ fleesWhenHurt: false, skittish: false, onExplosion: 'investigate' }),
  cowardly: (p) => ({ fleesWhenHurt: true, skittish: true, walkSpeed: p.walkSpeed * 0.95, runSpeed: p.runSpeed * 1.25, memory: p.memory * 0.5, onExplosion: 'flee' }),
  curious: (p) => ({ hearing: p.hearing * 1.6, sight: p.sight * 1.2, onExplosion: 'investigate' }),
  lazy: (p) => ({ walkSpeed: p.walkSpeed * 0.65, runSpeed: p.runSpeed * 0.75, hearing: p.hearing * 0.6, sight: p.sight * 0.7, onExplosion: 'ignore' }),
  hyper: (p) => ({ walkSpeed: p.walkSpeed * 1.5, runSpeed: p.runSpeed * 1.35, attackCooldown: p.attackCooldown * 0.75, gait: (p.gait ?? 1) * 1.4 }),
  relentless: (p) => ({ memory: p.memory * 3, sight: p.sight * 1.3, fleesWhenHurt: false, onExplosion: 'ignore' }),
};

export function applyPersonality(p: NpcProfile): NpcProfile {
  const preset = p.personality ? PERSONALITIES[p.personality] : undefined;
  return preset ? { ...p, ...preset(p) } : p;
}

export const NPC_PROFILES: Record<string, NpcProfile> = {
  technician: { id: 'technician', health: 60, walkSpeed: 1.6, runSpeed: 5, sight: 14, hearing: 12, attackRange: 0, attackCooldown: 1, attackDamage: 0, attack: 'none', faction: 'lab', hostility: 'never', fleesWhenHurt: true, skittish: false, memory: 2, hops: false, lines: ['npc.tech1', 'npc.tech2', 'npc.tech3', 'npc.tech4'], speaker: 'npc.techName' },
  creature: { id: 'creature', health: 25, walkSpeed: 1.8, runSpeed: 5.5, sight: 9, hearing: 9, attackRange: 0, attackCooldown: 1, attackDamage: 0, attack: 'none', faction: 'neutral', hostility: 'never', fleesWhenHurt: true, skittish: true, memory: 1, hops: true, voice: 'creature' },
  guard: { id: 'guard', health: 110, walkSpeed: 1.9, runSpeed: 4.6, sight: 24, hearing: 16, attackRange: 16, attackCooldown: 0.8, attackDamage: 9, attack: 'tracer', faction: 'lab', hostility: 'provoked', fleesWhenHurt: false, skittish: false, memory: 5, hops: false, behavior: 'patrol' },
  robot: { id: 'robot', health: 70, walkSpeed: 2.2, runSpeed: 4.4, sight: 28, hearing: 14, attackRange: 18, attackCooldown: 1.15, attackDamage: 12, attack: 'bolt', faction: 'rogue', hostility: 'always', fleesWhenHurt: false, skittish: false, memory: 4, hops: false, voice: 'robot' },
  heavy: { id: 'heavy', health: 340, walkSpeed: 1.3, runSpeed: 2.5, sight: 22, hearing: 12, attackRange: 4.2, attackCooldown: 2.6, attackDamage: 26, attack: 'slam', faction: 'rogue', hostility: 'always', fleesWhenHurt: false, skittish: false, memory: 6, hops: false, gait: 0.5 },
};

export interface Perception {
  /** A valid target exists, regardless of whether it can be seen right now. */
  hasTarget: boolean;
  targetVisible: boolean;
  targetDist: number;
  /** Distance to a nearby fast-moving thing, or Infinity. */
  threatDist: number;
  noise: boolean;
  hurt: boolean;
  stunned: boolean;
  health: number;
  /** The current waypoint or destination has been reached. */
  arrived: boolean;
  /** An order wants it moving now, so it shouldn't wait out its idle time. */
  wantsMove?: boolean;
  /** Something frightening happened that this NPC reacts to by running. */
  scared?: boolean;
}

export const IDLE_TIME = 2.2;
export const FLEE_TIME = 3.5;
export const INVESTIGATE_TIME = 7;

export class NpcBrain {
  state: NpcState = 'idle';
  time = 0;
  transitions = 0;
  private sinceSeen = 0;

  constructor(readonly profile: NpcProfile) {}

  private go(next: NpcState): void {
    if (next === this.state) return;
    this.state = next;
    this.time = 0;
    this.transitions++;
  }

  force(next: NpcState): void {
    this.go(next);
  }

  update(dt: number, p: Perception): NpcState {
    this.time += dt;
    this.sinceSeen = p.targetVisible ? 0 : this.sinceSeen + dt;
    if (this.state === 'dead') return 'dead';
    if (p.health <= 0) {
      this.go('dead');
      return this.state;
    }
    if (p.stunned) {
      this.go('stunned');
      return this.state;
    }
    const prof = this.profile;
    const fights = prof.attack !== 'none';
    const shouldFlee = (p.hurt && prof.fleesWhenHurt) || (prof.skittish && p.threatDist < prof.hearing * 0.55) || p.scared === true;
    switch (this.state) {
      case 'stunned':
        this.go('idle');
        break;
      case 'idle':
        if (shouldFlee) this.go('flee');
        else if (fights && p.hasTarget && p.targetVisible) this.go('chase');
        else if (fights && p.noise) this.go('investigate');
        else if (p.wantsMove || this.time > IDLE_TIME) this.go('patrol');
        break;
      case 'patrol':
        if (shouldFlee) this.go('flee');
        else if (fights && p.hasTarget && p.targetVisible) this.go('chase');
        else if (fights && p.noise) this.go('investigate');
        else if (p.arrived) this.go('idle');
        break;
      case 'investigate':
        if (fights && p.hasTarget && p.targetVisible) this.go('chase');
        else if (p.arrived || this.time > INVESTIGATE_TIME) this.go('patrol');
        break;
      case 'chase':
        if (!p.hasTarget) this.go('idle');
        else if (p.targetVisible && p.targetDist <= prof.attackRange) this.go('attack');
        else if (this.sinceSeen > prof.memory) this.go('investigate');
        break;
      case 'attack':
        if (!p.hasTarget) this.go('idle');
        else if (!p.targetVisible || p.targetDist > prof.attackRange * 1.25) this.go('chase');
        break;
      case 'flee':
        if (this.time > FLEE_TIME && !shouldFlee) this.go('idle');
        break;
    }
    return this.state;
  }
}
