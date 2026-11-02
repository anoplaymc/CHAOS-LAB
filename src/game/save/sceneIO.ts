import { catalog } from '../../data/items';
import type { Game } from '../core/Game';
import type { Entity } from '../entities/Entity';
import { NpcComponent } from '../npcs/NpcComponent';
import { SCHEMA_VERSION, type SaveFile, type SavedEntity, type Vec3 } from './schema';

const round = (v: number) => Math.round(v * 10000) / 10000;

/** Plain data for one entity. Live Rapier objects stay out of this by construction. */
export function serializeEntity(e: Entity): SavedEntity {
  const p = e.position;
  const q = e.rotation;
  const out: SavedEntity = {
    id: e.id,
    def: e.def.id,
    p: [round(p.x), round(p.y), round(p.z)],
    q: [q.x, q.y, q.z, q.w],
  };
  const b = e.body;
  if (b && b.isDynamic() && !b.isSleeping()) {
    const v = b.linvel();
    const w = b.angvel();
    out.v = [round(v.x), round(v.y), round(v.z)];
    out.w = [round(w.x), round(w.y), round(w.z)];
  }
  if (e.scale !== 1) out.scale = e.scale;
  if (e.materialId !== e.def.material) out.material = e.materialId;
  if (e.tint !== null) out.tint = e.tint;
  if (e.health !== e.maxHealth) out.health = e.health;
  if (e.anchored) out.anchored = true;
  let state: Record<string, unknown> | undefined;
  for (const c of e.components) {
    const s = c.save?.();
    if (s) state = { ...state, ...s };
  }
  if (state) out.state = state;
  return out;
}

export function spawnSaved(game: Game, s: SavedEntity): Entity | null {
  const r = game.entities.spawn(s.def, {
    id: s.id,
    position: { x: s.p[0], y: s.p[1], z: s.p[2] },
    rotation: { x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] },
    scale: s.scale,
    material: s.material,
    tint: s.tint,
    health: s.health,
    anchored: s.anchored,
    state: s.state,
    linvel: s.v ? { x: s.v[0], y: s.v[1], z: s.v[2] } : undefined,
    angvel: s.w ? { x: s.w[0], y: s.w[1], z: s.w[2] } : undefined,
  });
  return r.ok ? r.entity : null;
}

function isSaveable(e: Entity): boolean {
  if (e.fixture || e.dead) return false;
  const npc = e.component(NpcComponent);
  return !npc || npc.alive;
}

export function serializeScene(game: Game, name: string, kind: SaveFile['kind']): SaveFile {
  const entities = game.entities.active.filter(isSaveable).map(serializeEntity);
  const ids = new Set(entities.map((e) => e.id));
  const fixture = (id: number) => !!game.entities.get(id)?.fixture;
  const save: SaveFile = {
    schema: SCHEMA_VERSION,
    kind,
    name,
    createdAt: new Date().toISOString(),
    map: game.session.map,
    mode: game.session.mode,
    rules: { gravity: game.rules.gravity, damage: game.rules.damage, aggression: game.rules.aggression },
    nextId: game.entities.registry.nextId,
    entities,
    links: game.connections.list().filter((l) => (ids.has(l.a) || fixture(l.a)) && (l.b === 0 || ids.has(l.b) || fixture(l.b))),
    wires: game.signals.graph.allWires.filter((w) => (ids.has(w.from) || fixture(w.from)) && (ids.has(w.to) || fixture(w.to))).map((w) => ({ from: w.from, to: w.to })),
  };
  if (kind === 'scene' && game.player.body) {
    const pl = game.player;
    const f = pl.feet;
    save.player = { p: [round(f.x), round(f.y), round(f.z)] as Vec3, yaw: pl.yaw, pitch: pl.pitch, health: pl.health, flying: pl.flying };
  }
  return save;
}

export interface ApplyReport { missingDefs: string[]; droppedLinks: number; droppedWires: number }

/** Rebuilds a saved scene in a freshly started world. Everything is reconstructed from plain data. */
export function applyScene(game: Game, save: SaveFile): ApplyReport {
  const missing = new Set<string>();
  for (const s of save.entities) {
    if (!catalog.has(s.def)) {
      missing.add(s.def);
      continue;
    }
    spawnSaved(game, s);
  }
  game.entities.registry.nextId = save.nextId;
  let droppedLinks = 0;
  for (const l of save.links) if (!game.connections.restore(l)) droppedLinks++;
  let droppedWires = 0;
  for (const w of save.wires) if (game.signals.connect(w.from, w.to)) droppedWires++;
  if (save.player && save.kind === 'scene') {
    const pl = game.player;
    const [x, y, z] = save.player.p;
    pl.teleport({ x, y: y + 0.95, z }, save.player.yaw);
    pl.pitch = save.player.pitch;
    pl.health = Math.max(1, Math.min(pl.maxHealth, save.player.health));
    if (save.player.flying) pl.toggleFlight();
  }
  return { missingDefs: [...missing], droppedLinks, droppedWires };
}

