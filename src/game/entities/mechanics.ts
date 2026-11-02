import { rotate, type V3 } from '../../utils/math';
import type { Game } from '../core/Game';
import { Group, RAPIER } from '../physics/PhysicsWorld';
import { BEHAVIORS } from './behaviors';
import type { Component, Entity } from './Entity';

const DYNAMIC = Group.PROP | Group.NPC | Group.VEHICLE | Group.PLAYER;

const num = (e: Entity, k: string, d: number): number => {
  const v = e.params[k] ?? e.def.params?.[k];
  return typeof v === 'number' ? v : d;
};
const str = (e: Entity, k: string, d: string): string => {
  const v = e.params[k] ?? e.def.params?.[k];
  return typeof v === 'string' ? v : d;
};

/** Passes its input to its output after a wait. */
class Delay implements Component {
  private queue: { at: number; on: boolean }[] = [];
  private input = false;
  private out = false;
  private t = 0;
  constructor(private e: Entity) {}
  setSignal(on: boolean): void {
    if (on === this.input) return;
    this.input = on;
    this.queue.push({ at: this.t + num(this.e, 'delay', 1), on });
  }
  fixedUpdate(dt: number): void {
    this.t += dt;
    while (this.queue.length && this.queue[0]!.at <= this.t) this.out = this.queue.shift()!.on;
  }
  signalOut(): boolean { return this.out; }
}

/** Flips its output on each rising input edge, or on E. */
class Latch implements Component {
  private input = false;
  private on = false;
  constructor(private e: Entity, private game: Game) {}
  setSignal(v: boolean): void {
    if (v && !this.input) this.flip();
    this.input = v;
  }
  private flip(): void {
    this.on = !this.on;
    this.game.audio.play('lever', 0.6, this.e.position);
  }
  onInteract(): boolean {
    this.flip();
    return true;
  }
  interactHint(): string { return this.game.t(this.on ? 'hint.leverOff' : 'hint.leverOn'); }
  signalOut(): boolean { return this.on; }
  save() { return { on: this.on }; }
  load(d: Record<string, unknown>) { this.on = d.on === true; }
}

/** Carries whatever rests on it along its local -Z. */
class Conveyor implements Component {
  private on = true;
  private shape: RAPIER.Cuboid | null = null;
  private scan = 0;
  constructor(private e: Entity, private game: Game) {}
  setSignal(v: boolean): void { this.on = v; }
  onInteract(): boolean {
    if (this.game.signals.hasInput(this.e.id)) return false;
    this.on = !this.on;
    this.game.audio.play('click');
    return true;
  }
  interactHint() { return this.game.signals.hasInput(this.e.id) ? null : this.game.t(this.on ? 'hint.stop' : 'hint.start'); }
  fixedUpdate(dt: number): void {
    if (!this.on) return;
    this.scan -= dt;
    if (this.scan > 0) return;
    const step = 1 / 30;
    this.scan = step;
    const b = this.e.body;
    const s = this.e.def.shape;
    if (!b || s.type !== 'box') return;
    const k = this.e.scale;
    this.shape ??= new RAPIER.Cuboid((s.size[0] / 2) * k, 0.2, (s.size[2] / 2) * k);
    const r = b.rotation();
    const t = b.translation();
    const up = rotate({ x: 0, y: (s.size[1] / 2) * k + 0.2, z: 0 }, r);
    const dir = rotate({ x: 0, y: 0, z: -1 }, r);
    const speed = num(this.e, 'speed', 3);
    this.game.physics.overlap(this.shape, { x: t.x + up.x, y: t.y + up.y, z: t.z + up.z }, r, DYNAMIC, (c) => {
      const owner = this.game.physics.ownerOf(c);
      const body = c.parent();
      if (owner === this.game.player) {
        this.game.player.addVelocity({ x: dir.x * speed * step * 6, y: 0, z: dir.z * speed * step * 6 });
      } else if (body && body.isDynamic() && body !== b) {
        const v = body.linvel();
        const along = v.x * dir.x + v.z * dir.z;
        if (along < speed) {
          const m = body.mass();
          body.applyImpulse({ x: dir.x * m * step * 12, y: 0, z: dir.z * m * step * 12 }, true);
        }
      }
      return true;
    });
  }
}

/** Pulls metal things toward itself while powered. */
class Magnet implements Component {
  private on = true;
  private scan = 0;
  private shape: RAPIER.Ball | null = null;
  constructor(private e: Entity, private game: Game) {}
  setSignal(v: boolean): void { this.on = v; }
  onInteract(): boolean {
    if (this.game.signals.hasInput(this.e.id)) return false;
    this.on = !this.on;
    this.game.audio.play('click');
    return true;
  }
  interactHint() { return this.game.signals.hasInput(this.e.id) ? null : this.game.t(this.on ? 'hint.stop' : 'hint.start'); }
  fixedUpdate(dt: number): void {
    if (!this.on) return;
    this.scan -= dt;
    if (this.scan > 0) return;
    const step = 1 / 20;
    this.scan = step;
    const p = this.e.position;
    const range = num(this.e, 'range', 8);
    const force = num(this.e, 'force', 30);
    this.shape ??= new RAPIER.Ball(range);
    this.game.physics.overlap(this.shape, p, { x: 0, y: 0, z: 0, w: 1 }, Group.PROP | Group.VEHICLE, (c) => {
      const owner = this.game.physics.ownerOf(c) as Entity | undefined;
      const body = c.parent();
      if (!owner?.def || owner === this.e || !body?.isDynamic()) return true;
      if (owner.materialId !== 'metal' && owner.materialId !== 'heavy') return true;
      const q = body.translation();
      const d = { x: p.x - q.x, y: p.y - q.y, z: p.z - q.z };
      const l = Math.max(0.5, Math.hypot(d.x, d.y, d.z));
      const m = body.mass();
      const k = (force * (1 - Math.min(1, l / range)) * m * step) / l;
      body.applyImpulse({ x: d.x * k, y: d.y * k, z: d.z * k }, true);
      return true;
    });
  }
}

/** A dynamic body that pushes itself along its local +Y while on. Weld it to something. */
class Thruster implements Component {
  private on = false;
  constructor(private e: Entity, private game: Game) {}
  setSignal(v: boolean): void { this.on = v; }
  onInteract(): boolean {
    if (this.game.signals.hasInput(this.e.id)) return false;
    this.on = !this.on;
    this.game.audio.play(this.on ? 'motorOn' : 'motorOff', 0.7, this.e.position);
    return true;
  }
  interactHint() { return this.game.signals.hasInput(this.e.id) ? null : this.game.t(this.on ? 'hint.stop' : 'hint.start'); }
  fixedUpdate(dt: number): void {
    const b = this.e.body;
    if (!this.on || !b || !b.isDynamic()) return;
    const axis = rotate({ x: 0, y: 1, z: 0 }, b.rotation());
    const f = num(this.e, 'force', 1600) * dt;
    b.applyImpulse({ x: axis.x * f, y: axis.y * f, z: axis.z * f }, true);
    const t = b.translation();
    const tail = { x: t.x - axis.x * 0.4, y: t.y - axis.y * 0.4, z: t.z - axis.z * 0.4 };
    if (Math.random() < 0.5) this.game.fx.burst(tail, 2, 0xff8a30, 3, 0.08, 0.25, 0, { x: -axis.x, y: -axis.y, z: -axis.z });
  }
  save() { return { on: this.on }; }
  load(d: Record<string, unknown>) { this.on = d.on === true; }
}

/** Spawns an item on E or a rising wire, with a cooldown. */
class Dispenser implements Component {
  private input = false;
  private cooldown = 0;
  constructor(private e: Entity, private game: Game) {}
  setSignal(v: boolean): void {
    if (v && !this.input) this.dispense();
    this.input = v;
  }
  fixedUpdate(dt: number): void { this.cooldown = Math.max(0, this.cooldown - dt); }
  onInteract(): boolean {
    this.dispense();
    return true;
  }
  interactHint() { return this.game.t('hint.press'); }
  private dispense(): void {
    if (this.cooldown > 0) return;
    this.cooldown = num(this.e, 'cooldown', 1);
    const p = this.e.position;
    const out = rotate({ x: 0, y: 0, z: num(this.e, 'reach', 1) }, this.e.rotation);
    const r = this.game.entities.spawn(str(this.e, 'dispense', 'crate_small'), { position: { x: p.x + out.x, y: p.y + 0.6 + out.y, z: p.z + out.z }, linvel: { x: out.x * 2, y: 1, z: out.z * 2 } });
    this.game.audio.play(r.ok ? 'place' : 'error', 0.8, p);
  }
}

/** Sends anything touching it to the nearest pad of the same channel. */
class Teleporter implements Component {
  cooldown = 0;
  private scan = 0;
  private shape: RAPIER.Cuboid | null = null;
  constructor(private e: Entity, private game: Game) {}
  private partner(): Entity | null {
    const channel = str(this.e, 'channel', 'a');
    const p = this.e.position;
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const o of this.game.entities.active) {
      if (o === this.e || o.def.behavior !== 'teleporter' || str(o, 'channel', 'a') !== channel) continue;
      const q = o.position;
      const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }
  fixedUpdate(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.scan -= dt;
    if (this.scan > 0 || this.cooldown > 0) return;
    this.scan = 0.1;
    const b = this.e.body;
    if (!b) return;
    const k = this.e.scale;
    this.shape ??= new RAPIER.Cuboid(0.65 * k, 0.3, 0.65 * k);
    const t = b.translation();
    let target: { kind: 'player' } | { kind: 'body'; c: RAPIER.Collider } | null = null;
    this.game.physics.overlap(this.shape, { x: t.x, y: t.y + 0.4, z: t.z }, { x: 0, y: 0, z: 0, w: 1 }, DYNAMIC, (c) => {
      if (c.parent() === b) return true;
      if (this.game.physics.ownerOf(c) === this.game.player) target = { kind: 'player' };
      else if (c.parent()?.isDynamic()) target = { kind: 'body', c };
      return !target;
    });
    if (!target) return;
    const to = this.partner();
    if (!to) return;
    const q = to.position;
    const dest: V3 = { x: q.x, y: q.y + 1.2, z: q.z };
    const found = target as { kind: 'player' } | { kind: 'body'; c: RAPIER.Collider };
    if (found.kind === 'player') this.game.player.teleport({ x: dest.x, y: dest.y + 0.6, z: dest.z });
    else found.c.parent()!.setTranslation(dest, true);
    this.cooldown = 1;
    const other = to.component(Teleporter);
    if (other) other.cooldown = 1.5;
    this.game.audio.play('gravity', 0.8, q);
    this.game.fx.ring(q, 1.4, 0xa080ff, 0.4);
    this.game.fx.burst(t, 14, 0xa080ff, 3, 0.08, 0.4, 2);
  }
}

/** Rings on E or a wire, and sends NPCs nearby to look. */
class Alarm implements Component {
  private input = false;
  private cooldown = 0;
  constructor(private e: Entity, private game: Game) {}
  setSignal(v: boolean): void {
    if (v && !this.input) this.ring();
    this.input = v;
  }
  fixedUpdate(dt: number): void { this.cooldown = Math.max(0, this.cooldown - dt); }
  onInteract(): boolean {
    this.ring();
    return true;
  }
  interactHint() { return this.game.t('hint.press'); }
  private ring(): void {
    if (this.cooldown > 0) return;
    this.cooldown = 2;
    const p = this.e.position;
    this.game.audio.play('npcAlert', 1, p);
    this.game.fx.flash(p, 0xff4030, 40, 0.3);
    this.game.fx.ring(p, 3, 0xff4030, 0.5);
    this.game.makeNoise(p, num(this.e, 'radius', 40));
  }
}

Object.assign(BEHAVIORS, {
  delay: (e: Entity) => new Delay(e),
  latch: (e: Entity, g: Game) => new Latch(e, g),
  conveyor: (e: Entity, g: Game) => new Conveyor(e, g),
  magnet: (e: Entity, g: Game) => new Magnet(e, g),
  thruster: (e: Entity, g: Game) => new Thruster(e, g),
  dispenser: (e: Entity, g: Game) => new Dispenser(e, g),
  teleporter: (e: Entity, g: Game) => new Teleporter(e, g),
  alarm: (e: Entity, g: Game) => new Alarm(e, g),
});

