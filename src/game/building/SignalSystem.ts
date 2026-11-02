import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Entity } from '../entities/Entity';
import { MAX_WIRES, SignalGraph, type WireError } from './signals';

const TICK = 1 / 20;

/** Connects the pure signal graph to live entities. */
export class SignalSystem {
  readonly graph = new SignalGraph();
  /** Wire debug view, drawn on top so a contraption's logic can be read at a glance. */
  showWires = false;
  private timer = 0;
  private lines: THREE.LineSegments;
  private positions = new Float32Array(MAX_WIRES * 6);
  private colors = new Float32Array(MAX_WIRES * 6);

  constructor(private game: Game) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 25;
    this.lines.visible = false;
    game.scene.add(this.lines);
  }

  update(): void {
    this.lines.visible = this.showWires;
    if (!this.showWires) return;
    const wires = this.graph.allWires;
    let n = 0;
    for (const w of wires) {
      const a = this.game.entities.get(w.from);
      const b = this.game.entities.get(w.to);
      if (!a?.body || !b?.body) continue;
      const on = this.graph.levels.get(w.from) === true;
      const pa = a.position;
      const pb = b.position;
      this.positions.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], n * 6);
      const c = on ? [1, 0.75, 0.1] : [0.1, 0.55, 0.5];
      this.colors.set([...c, ...c], n * 6);
      n++;
    }
    const g = this.lines.geometry;
    g.setDrawRange(0, n * 2);
    g.attributes.position!.needsUpdate = true;
    g.attributes.color!.needsUpdate = true;
  }

  register(e: Entity): void {
    this.graph.addNode({ id: e.id, hasIn: !!e.def.signal?.in, hasOut: !!e.def.signal?.out });
  }

  unregister(e: Entity): void {
    if (e.def.signal) this.graph.removeNode(e.id);
  }

  hasInput(id: number): boolean {
    return this.graph.hasInput(id);
  }

  connect(from: number, to: number): WireError | null {
    return this.graph.connect(from, to);
  }

  fixedUpdate(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = TICK;
    this.graph.evaluate(
      (id) => {
        const e = this.game.entities.get(id);
        if (!e) return false;
        for (const c of e.components) if (c.signalOut) return c.signalOut();
        return false;
      },
      (id, level) => {
        const e = this.game.entities.get(id);
        if (e) for (const c of e.components) c.setSignal?.(level);
      },
    );
  }

  clear(): void {
    this.graph.clear();
  }
}
