import * as THREE from 'three';
import { catalog, type ItemDef } from '../../data/items';
import { setOutline } from '../../rendering/effects';
import type { V3 } from '../../utils/math';
import type { Entity } from '../entities/Entity';
import { SCALE_MAX, SCALE_MIN } from '../entities/EntityManager';
import { SOLID, type RayHit } from '../physics/PhysicsWorld';
import { Tool, type ToolHud } from '../weapons/Tool';
import type { LinkType } from './connections';
import { poseOf, recordLink, recordPlace, recordTransforms, recordValue, recordWire, type Pose } from './commands';
import { Ghost } from './Ghost';
import { ANGLE_STEPS, GRID_STEPS } from './placement';

export type BuildMode = 'place' | 'move' | 'rotate' | 'scale' | 'copy' | 'weld' | 'hinge' | 'spring' | 'rope' | 'wire';
export const BUILD_MODES: BuildMode[] = ['place', 'move', 'rotate', 'scale', 'copy', 'weld', 'hinge', 'spring', 'rope', 'wire'];

/** Snapping shared by the Spawner and the Construction tool, so it survives switching between them. */
export class BuildSettings {
  gridIndex = 2;
  angleIndex = 2;
  align = false;
  anchorNext = false;
  get grid() { return GRID_STEPS[this.gridIndex]!; }
  get angle() { return ANGLE_STEPS[this.angleIndex]!; }
}

/** Handles the preview pose and the commit shared by both placing tools. */
export class Placer {
  yaw = 0;
  pitch = 0;
  scale = 1;
  material: string | undefined;
  tint: number | null | undefined;
  private ghost: Ghost;
  pose: ReturnType<Tool['game']['placementAt']> | null = null;
  private def: ItemDef | null = null;

  constructor(private tool: { game: Tool['game'] }) {
    this.ghost = new Ghost(tool.game.scene);
  }

  update(def: ItemDef): void {
    this.def = def;
    const g = this.tool.game;
    const b = g.build;
    this.pose = g.placementAt(def, { scale: this.scale, yaw: this.yaw, pitch: this.pitch, grid: b.grid, angle: b.angle, align: b.align });
    this.ghost.show(def, this.pose.position, this.pose.rotation, this.scale, this.pose.valid);
  }

  hide(): void {
    this.ghost.hide();
    this.pose = null;
  }

  rotateBy(delta: number, pitch: boolean): void {
    const step = this.tool.game.build.angle || 15;
    if (pitch) this.pitch += delta * step;
    else this.yaw += delta * step;
  }

  commit(): Entity | null {
    const g = this.tool.game;
    const def = this.def;
    const pose = this.pose;
    if (!def || !pose) return null;
    if (!pose.valid) {
      g.toast(g.t('toast.blocked'), 'warn');
      g.audio.play('error');
      return null;
    }
    const r = g.trySpawn(def.id, {
      position: pose.position,
      rotation: pose.rotation,
      scale: this.scale,
      material: this.material,
      tint: this.tint,
      anchored: g.build.anchorNext && def.body === 'dynamic',
    });
    if (!r.ok) return null;
    recordPlace(g, r.entity);
    g.audio.play('place', 0.9, pose.position);
    g.fx.burst(pose.position, 8, 0x19e0c4, 1.8, 0.05, 0.3, 2);
    return r.entity;
  }
}

function buildHints(tool: Tool): [string, string][] {
  const t = tool.t;
  return [['B', t('build.grid')], ['N', t('build.angle')], ['V', t('build.align')], ['H', t('build.anchor')], ['Z/Y', t('build.undo')]];
}

function buildStatus(tool: Tool): string {
  const g = tool.game;
  const b = g.build;
  const flags = [`${tool.t('build.grid')}: ${b.grid || tool.t('build.off')}`, `${tool.t('build.angle')}: ${b.angle || tool.t('build.off')}`];
  if (b.align) flags.push(tool.t('build.align'));
  if (b.anchorNext) flags.push(tool.t('build.anchor'));
  return flags.join(' · ');
}

/** Places whatever is selected in the spawn menu, with a preview. */
export class SpawnerTool extends Tool {
  readonly id = 'spawner';
  readonly kind = 'tool' as const;
  private placer: Placer;
  selected = 'crate_wood';

  constructor(g: ConstructorParameters<typeof Tool>[0]) {
    super(g);
    this.placer = new Placer(this);
  }

  override update(): void {
    const def = catalog.get(this.selected);
    if (def && def.kind !== 'tool' && def.kind !== 'effect') this.placer.update(def);
    else this.placer.hide();
  }
  override primaryDown(): void { this.placer.commit(); }
  override secondaryDown(): void { this.placer.rotateBy(1, false); }
  override wheel(d: number): boolean {
    this.placer.rotateBy(d, this.game.input.isDown('sprint'));
    return true;
  }
  override unequip(): void { this.placer.hide(); }
  override reset(): void { this.placer.hide(); this.placer.yaw = this.placer.pitch = 0; }

  hud(): ToolHud {
    const def = catalog.get(this.selected);
    return {
      energy: null,
      status: `${def?.name[this.game.settings.language] ?? ''} · ${buildStatus(this)}`,
      hints: [['LMB', this.t('tool.place')], ['RMB/Wheel', this.t('tool.turn')], ...buildHints(this)],
    };
  }
}

/** Build mode dispatch: one tool, ten verbs, one active at a time. */
export class ConstructionTool extends Tool {
  readonly id = 'construction';
  readonly kind = 'tool' as const;
  mode: BuildMode = 'place';
  private placer: Placer;
  private moveGhost: Ghost;
  private parts: ItemDef[] = [];
  private partIndex = 0;
  /** Set while copying: replaces the part list as the thing being placed. */
  private template: ItemDef | null = null;
  private selection: Entity[] = [];
  private moving = false;
  private linkFrom: { entity: Entity; point: V3; normal: V3; part: number } | null = null;
  private wireFrom: Entity | null = null;
  private hover: Entity | null = null;

  constructor(g: ConstructorParameters<typeof Tool>[0]) {
    super(g);
    this.placer = new Placer(this);
    this.moveGhost = new Ghost(g.scene);
    this.refreshParts();
  }

  refreshParts(): void {
    this.parts = catalog.list().filter((d) => d.buildPart);
  }

  get currentPart(): ItemDef | undefined {
    return this.template ?? this.parts[this.partIndex];
  }

  setPart(id: string): boolean {
    this.refreshParts();
    const i = this.parts.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.partIndex = i;
    this.template = null;
    this.placer.scale = 1;
    this.placer.material = undefined;
    this.placer.tint = undefined;
    this.setMode('place');
    return true;
  }

  cyclePart(delta: number): void {
    this.template = null;
    this.placer.scale = 1;
    this.placer.material = undefined;
    this.placer.tint = undefined;
    this.partIndex = (this.partIndex + delta + this.parts.length) % this.parts.length;
    this.game.audio.play('click', 0.4);
  }

  setMode(m: BuildMode): void {
    this.clearTransient();
    this.mode = m;
    this.game.signals.showWires = m === 'wire' || this.game.aiDebug;
  }

  private clearTransient(): void {
    this.placer.hide();
    this.moveGhost.hide();
    this.moving = false;
    this.linkFrom = null;
    this.wireFrom = null;
    for (const e of this.selection) if (!e.dead) setOutline(e.root, null);
    this.selection = [];
    this.setHover(null);
  }

  override equip(): void {
    this.refreshParts();
    this.game.signals.showWires = this.mode === 'wire' || this.game.aiDebug;
  }

  override unequip(): void {
    this.clearTransient();
    this.game.signals.showWires = this.game.aiDebug;
  }

  override reset(): void {
    this.placer.hide();
    this.moveGhost.hide();
    this.moving = false;
    this.linkFrom = null;
    this.wireFrom = null;
    this.selection = [];
    this.hover = null;
    this.template = null;
    this.placer.yaw = this.placer.pitch = 0;
  }

  private aim(): RayHit | null {
    const a = this.game.aimRay();
    return this.game.physics.raycast(a.origin, a.dir, 30, { mask: SOLID });
  }

  private target(): Entity | null {
    const e = this.aim()?.owner as Entity | undefined;
    return e?.def ? e : null;
  }

  private editable(e: Entity | null): e is Entity {
    if (!e) return false;
    if (e.fixture || e.locked) {
      this.game.toast(this.t('toast.notRemovable'), 'warn');
      this.game.audio.play('error');
      return false;
    }
    return true;
  }

  private setHover(e: Entity | null): void {
    if (this.hover === e) return;
    if (this.hover && !this.hover.dead && !this.selection.includes(this.hover)) setOutline(this.hover.root, null);
    this.hover = e;
    if (e && !this.selection.includes(e)) setOutline(e.root, 0x19e0c4);
  }

  override secondaryDown(): void {
    if (this.moving) {
      this.clearTransient();
      return;
    }
    const dir = this.game.input.isDown('sprint') ? -1 : 1;
    const i = BUILD_MODES.indexOf(this.mode);
    this.setMode(BUILD_MODES[(i + dir + BUILD_MODES.length) % BUILD_MODES.length]!);
    this.game.audio.play('click', 0.5);
  }

  override wheel(d: number): boolean {
    if (this.mode === 'place' || this.moving) {
      this.placer.rotateBy(d, this.game.input.isDown('sprint'));
      return true;
    }
    if (this.mode === 'scale') {
      this.scaleTarget(d > 0 ? 0.9 : 1.1);
      return true;
    }
    return false;
  }

  private scaleTarget(k: number): void {
    const e = this.target();
    if (!this.editable(e)) return;
    const before = e.scale;
    const after = Math.max(SCALE_MIN, Math.min(SCALE_MAX, before * k));
    if (after === before) {
      this.game.toast(this.t('toast.scaleLimit'), 'warn');
      return;
    }
    const set = (x: Entity, v: number) => this.game.entities.setScale(x, v);
    set(e, after);
    recordValue(this.game, e.id, 'scale', before, after, set);
    this.game.audio.play('click', 0.6);
  }

  override pin(): void {
    const e = this.target();
    if (!this.editable(e) || e.def.body !== 'dynamic') return;
    const before = e.anchored;
    const set = (x: Entity, v: boolean) => this.game.entities.setAnchored(x, v);
    set(e, !before);
    recordValue(this.game, e.id, 'anchor', before, !before, set);
    this.game.toast(this.t(!before ? 'toast.pinned' : 'toast.unpinned'), 'info');
    this.game.audio.play('pin');
  }

  override primaryDown(): void {
    switch (this.mode) {
      case 'place':
        this.placer.commit();
        return;
      case 'move':
        this.clickMove();
        return;
      case 'rotate': {
        const e = this.target();
        if (!this.editable(e)) return;
        const before = poseOf(e);
        const step = ((this.game.build.angle || 15) * Math.PI) / 180;
        const axis = this.game.input.isDown('sprint') ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const q = new THREE.Quaternion().setFromAxisAngle(axis, step).multiply(new THREE.Quaternion(before.q.x, before.q.y, before.q.z, before.q.w));
        const after: Pose = { p: before.p, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
        this.game.entities.setTransform(e, after.p, after.q);
        recordTransforms(this.game, [{ id: e.id, before, after }]);
        this.game.audio.play('click', 0.6);
        return;
      }
      case 'scale':
        this.scaleTarget(this.game.input.isDown('sprint') ? 0.9 : 1.1);
        return;
      case 'copy': {
        const e = this.target();
        if (!e || e.locked || e.def.kind === 'npc' || e.def.kind === 'vehicle') return;
        this.template = e.def;
        this.placer.scale = e.scale;
        this.placer.material = e.materialId;
        this.placer.tint = e.tint;
        this.setMode('place');
        this.game.toast(this.t('toast.copied'), 'info');
        return;
      }
      case 'wire':
        this.clickWire();
        return;
      default:
        this.clickLink(this.mode);
    }
  }

  private clickMove(): void {
    if (this.moving) {
      const main = this.selection[0];
      if (!main || main.dead) {
        this.clearTransient();
        return;
      }
      const def = main.def;
      const b = this.game.build;
      const pose = this.game.placementAt(def, { scale: main.scale, yaw: this.placer.yaw, pitch: this.placer.pitch, grid: b.grid, angle: b.angle, align: b.align, ignore: this.selection });
      if (!pose.valid) {
        this.game.toast(this.t('toast.blocked'), 'warn');
        this.game.audio.play('error');
        return;
      }
      const start = poseOf(main);
      const dx = pose.position.x - start.p.x;
      const dy = pose.position.y - start.p.y;
      const dz = pose.position.z - start.p.z;
      const changes = this.selection.filter((e) => !e.dead).map((e) => {
        const before = poseOf(e);
        const after: Pose = e === main ? { p: pose.position, q: pose.rotation } : { p: { x: before.p.x + dx, y: before.p.y + dy, z: before.p.z + dz }, q: before.q };
        this.game.entities.setTransform(e, after.p, after.q);
        return { id: e.id, before, after };
      });
      recordTransforms(this.game, changes);
      this.game.audio.play('place');
      this.clearTransient();
      return;
    }
    const e = this.target();
    if (!this.editable(e)) return;
    const shift = this.game.input.isDown('sprint');
    if (shift) {
      // Shift-click builds up a group. A plain click then moves the group.
      if (!this.selection.includes(e)) this.selection.push(e);
      setOutline(e.root, 0xffb000);
      this.game.audio.play('click', 0.5);
      return;
    }
    if (!this.selection.includes(e)) {
      for (const x of this.selection) setOutline(x.root, null);
      this.selection = [e];
    } else {
      this.selection = [e, ...this.selection.filter((x) => x !== e)];
    }
    for (const x of this.selection) setOutline(x.root, 0xffb000);
    this.moving = true;
    const eul = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(e.rotation.x, e.rotation.y, e.rotation.z, e.rotation.w), 'YXZ');
    this.placer.yaw = THREE.MathUtils.radToDeg(eul.y);
    this.placer.pitch = THREE.MathUtils.radToDeg(eul.x);
    this.game.audio.play('grab');
  }

  private partOf(hit: RayHit, e: Entity): number {
    const i = e.extra.findIndex((p) => p.body === hit.body);
    return i + 1;
  }

  private clickLink(type: LinkType): void {
    const hit = this.aim();
    if (!hit) return;
    const owner = hit.owner as Entity | undefined;
    const isEnt = !!owner?.def;
    if (!this.linkFrom) {
      if (!isEnt || !owner) {
        this.game.toast(this.t('toast.linkStart'), 'warn');
        return;
      }
      this.linkFrom = { entity: owner, point: hit.point, normal: hit.normal, part: this.partOf(hit, owner) };
      setOutline(owner.root, 0xffb000);
      this.game.audio.play('click', 0.7);
      return;
    }
    const from = this.linkFrom;
    this.linkFrom = null;
    if (!from.entity.dead) setOutline(from.entity.root, null);
    if (from.entity.dead) return;
    const r = this.game.connections.connect(
      type, from.entity, isEnt ? owner! : null, from.point, type === 'weld' || type === 'hinge' ? from.point : hit.point,
      type === 'hinge' ? from.normal : null, from.part, isEnt ? this.partOf(hit, owner!) : 0,
    );
    if (!r.ok) {
      this.game.toast(this.t(`link.${r.error}`), 'warn');
      this.game.audio.play('error');
      return;
    }
    recordLink(this.game, r.link);
    this.game.audio.play('link');
    this.game.fx.burst(hit.point, 10, 0xffb000, 2, 0.05, 0.3, 3);
    this.game.toast(this.t('toast.linked', { type: this.t(`build.${type}`) }), 'success');
  }

  private clickWire(): void {
    const e = this.target();
    if (!e) return;
    if (!e.def.signal) {
      this.game.toast(this.t('wire.noPorts'), 'warn');
      this.game.audio.play('error');
      return;
    }
    if (!this.wireFrom) {
      if (!e.def.signal.out) {
        this.game.toast(this.t('wire.noOutput'), 'warn');
        this.game.audio.play('error');
        return;
      }
      this.wireFrom = e;
      setOutline(e.root, 0xffb000);
      this.game.audio.play('click', 0.7);
      return;
    }
    const from = this.wireFrom;
    this.wireFrom = null;
    if (!from.dead) setOutline(from.root, null);
    if (from.dead) return;
    const g = this.game.signals.graph;
    // Wiring an existing pair again removes it.
    if (g.has(from.id, e.id)) {
      g.disconnect(from.id, e.id);
      recordWire(this.game, from.id, e.id, false);
      this.game.toast(this.t('wire.removed'), 'info');
      this.game.audio.play('remove', 0.5);
      return;
    }
    const err = this.game.signals.connect(from.id, e.id);
    if (err) {
      this.game.toast(this.t(`wire.${err}`), 'warn');
      this.game.audio.play('error');
      return;
    }
    recordWire(this.game, from.id, e.id, true);
    this.game.audio.play('link');
    this.game.toast(this.t('wire.added'), 'success');
  }

  override update(): void {
    if (this.mode === 'place') {
      const part = this.currentPart;
      if (part) this.placer.update(part);
      return;
    }
    if (this.moving) {
      const main = this.selection[0];
      if (!main || main.dead) {
        this.clearTransient();
        return;
      }
      const b = this.game.build;
      const pose = this.game.placementAt(main.def, { scale: main.scale, yaw: this.placer.yaw, pitch: this.placer.pitch, grid: b.grid, angle: b.angle, align: b.align, ignore: this.selection });
      this.moveGhost.show(main.def, pose.position, pose.rotation, main.scale, pose.valid);
      return;
    }
    this.setHover(this.target());
  }

  hud(): ToolHud {
    const name = this.t(`build.${this.mode}`);
    let status = name;
    if (this.mode === 'place') status = `${name}: ${this.currentPart?.name[this.game.settings.language] ?? ''}`;
    if (this.linkFrom || this.wireFrom) status = `${name}: ${this.t('build.pickSecond')}`;
    const hints: [string, string][] = [['LMB', this.t(`build.do.${this.mode}`)], ['RMB', this.t('build.nextMode')]];
    if (this.mode === 'place') hints.push(['[ ]', this.t('build.part')], ['Wheel', this.t('tool.turn')]);
    if (this.mode === 'move') hints.push(['Shift+LMB', this.t('build.group')]);
    return { energy: null, status: `${status}\n${buildStatus(this)}`, hints: [...hints, ...buildHints(this)] };
  }
}
