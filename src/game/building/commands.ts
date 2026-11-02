import type { Q4, V3 } from '../../utils/math';
import type { Game } from '../core/Game';
import type { Entity } from '../entities/Entity';
import { serializeEntity, spawnSaved } from '../save/sceneIO';
import type { SavedEntity } from '../save/schema';
import type { SavedLink } from './connections';

/** Undoable construction actions. Commands store plain snapshots and look entities up by id. */
interface Snapshot { entity: SavedEntity; links: SavedLink[]; wires: { from: number; to: number }[] }

function snapshot(game: Game, e: Entity): Snapshot {
  return {
    entity: serializeEntity(e),
    links: game.connections.ofEntity(e.id),
    wires: game.signals.graph.wiresOf(e.id).map((w) => ({ from: w.from, to: w.to })),
  };
}

function restore(game: Game, s: Snapshot): void {
  if (game.entities.get(s.entity.id)) return;
  spawnSaved(game, s.entity);
  for (const l of s.links) game.connections.restore(l);
  for (const w of s.wires) game.signals.connect(w.from, w.to);
}

export function recordPlace(game: Game, e: Entity): void {
  const first = snapshot(game, e);
  let latest = first;
  game.undo.push({
    label: 'place',
    undo: () => {
      const cur = game.entities.get(first.entity.id);
      if (cur) {
        latest = snapshot(game, cur);
        game.entities.remove(cur);
      }
    },
    redo: () => restore(game, latest),
  });
}

/** Removes an entity with everything needed to bring it back. */
export function removeWithUndo(game: Game, e: Entity): void {
  const s = snapshot(game, e);
  game.entities.remove(e);
  game.undo.push({
    label: 'remove',
    undo: () => restore(game, s),
    redo: () => {
      const cur = game.entities.get(s.entity.id);
      if (cur) game.entities.remove(cur);
    },
  });
}

export function removeManyWithUndo(game: Game, list: Entity[]): void {
  const snaps = list.map((e) => snapshot(game, e));
  for (const e of list) game.entities.remove(e);
  game.undo.push({
    label: 'remove',
    // Entities first: links between two restored entities need both ends to exist.
    undo: () => {
      for (const s of snaps) if (!game.entities.get(s.entity.id)) spawnSaved(game, s.entity);
      for (const s of snaps) {
        for (const l of s.links) if (!game.connections.ofEntity(l.a).some((x) => x.id === l.id)) game.connections.restore(l);
        for (const w of s.wires) game.signals.connect(w.from, w.to);
      }
    },
    redo: () => {
      for (const s of snaps) {
        const cur = game.entities.get(s.entity.id);
        if (cur) game.entities.remove(cur);
      }
    },
  });
}

export interface Pose { p: V3; q: Q4 }

export function poseOf(e: Entity): Pose {
  const p = e.position;
  const q = e.rotation;
  return { p: { x: p.x, y: p.y, z: p.z }, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
}

export function recordTransforms(game: Game, changes: { id: number; before: Pose; after: Pose }[]): void {
  const apply = (key: 'before' | 'after') => {
    for (const c of changes) {
      const e = game.entities.get(c.id);
      if (e) game.entities.setTransform(e, c[key].p, c[key].q);
    }
  };
  game.undo.push({ label: 'move', undo: () => apply('before'), redo: () => apply('after') });
}

/** One-value property changes: scale, tint and material all follow the same shape. */
export function recordValue<T>(game: Game, id: number, label: string, before: T, after: T, set: (e: Entity, v: T) => void): void {
  game.undo.push({
    label,
    undo: () => { const e = game.entities.get(id); if (e) set(e, before); },
    redo: () => { const e = game.entities.get(id); if (e) set(e, after); },
  });
}

export function recordLink(game: Game, link: SavedLink): void {
  game.undo.push({
    label: 'link',
    undo: () => { game.connections.remove(link.id); },
    redo: () => { game.connections.restore(link); },
  });
}

export function recordWire(game: Game, from: number, to: number, added: boolean): void {
  const add = () => { game.signals.connect(from, to); };
  const del = () => { game.signals.graph.disconnect(from, to); };
  game.undo.push({ label: 'wire', undo: added ? del : add, redo: added ? add : del });
}
