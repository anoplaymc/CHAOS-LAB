import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { catalog } from '../data/items';
import { materials } from '../data/materials';
import type { ConstructionTool, SpawnerTool } from '../game/building/ConstructionTool';
import { MAPS, type Game } from '../game/core/Game';
import { Motor } from '../game/entities/behaviors';
import { Inventory } from '../game/inventory/favorites';
import { CHALLENGES, ContraptionMode, EditorMode, PlaygroundMode, starsFor, SurvivalMode, SURVIVAL_WAVES, waveComposition } from '../game/modes/modes';
import { PackManager } from '../game/mods/PackManager';
import { parsePackText, validatePack } from '../game/mods/pack';
import { NpcComponent } from '../game/npcs/NpcComponent';
import { serializeScene } from '../game/save/sceneIO';
import { KeyValueDb, SaveStore } from '../game/save/SaveStore';
import { MAX_SAVE_BYTES, parseSaveText, SCHEMA_VERSION, validateSave } from '../game/save/schema';
import { headlessGame, spawn } from './helpers';

const validSave = () => ({
  schema: SCHEMA_VERSION, kind: 'scene', name: 'x', createdAt: '2026-01-01T00:00:00Z', map: 'test_facility', mode: 'sandbox',
  rules: { gravity: 9.81, damage: true, aggression: 'normal' }, nextId: 5,
  entities: [{ id: 1, def: 'crate_wood', p: [0, 1, 0], q: [0, 0, 0, 1] }], links: [], wires: [],
});

describe('save validation', () => {
  it('accepts a good save', () => {
    const r = validateSave(validSave());
    expect(r.ok).toBe(true);
  });

  it('rejects non-objects, future versions and missing fields', () => {
    expect(validateSave(null).ok).toBe(false);
    expect(validateSave([]).ok).toBe(false);
    expect(validateSave({ ...validSave(), schema: 999 }).ok).toBe(false);
    expect(validateSave({ ...validSave(), map: undefined }).ok).toBe(false);
    expect(validateSave({ ...validSave(), entities: 'nope' }).ok).toBe(false);
  });

  it('drops malformed records but keeps the rest', () => {
    const r = validateSave({
      ...validSave(),
      entities: [
        { id: 1, def: 'crate_wood', p: [0, 1, 0], q: [0, 0, 0, 1] },
        { id: 1, def: 'crate_wood', p: [0, 1, 0], q: [0, 0, 0, 1] }, // duplicate id
        { id: 2, def: 'crate_wood', p: [NaN, 1, 0], q: [0, 0, 0, 1] },
        { id: 3, def: 'crate_wood', p: [1e9, 1, 0], q: [0, 0, 0, 1] },
        { id: 4, def: 'crate_wood', p: [0, 1, 0], q: [0, 0, 0, 0] },
        { id: 5, def: 42, p: [0, 1, 0], q: [0, 0, 0, 1] },
        'garbage',
      ],
      links: [{ id: 1, type: 'teleport', a: 1, b: 0, anchorA: {}, anchorB: {} }],
      wires: [{ from: 'a', to: 2 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.entities).toHaveLength(1);
      expect(r.value.links).toHaveLength(0);
      expect(r.value.wires).toHaveLength(0);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  it('normalises quaternions and clamps risky values', () => {
    const r = validateSave({ ...validSave(), rules: { gravity: 9999, aggression: 'furious' }, entities: [{ id: 1, def: 'crate_wood', p: [0, 1, 0], q: [0, 0, 0, 2], scale: 500 }] });
    expect(r.ok && r.value.entities[0]!.q[3]).toBe(1);
    expect(r.ok && r.value.entities[0]!.scale).toBe(3);
    expect(r.ok && r.value.rules.gravity).toBe(30);
    expect(r.ok && r.value.rules.aggression).toBe('normal');
  });

  it('migrates the old schema forward', () => {
    const r = validateSave({ schema: 1, map: 'test_facility', name: 'old', props: [{ id: 'crate_wood', pos: [1, 2, 3], material: 'ice' }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.schema).toBe(SCHEMA_VERSION);
      expect(r.value.entities[0]).toMatchObject({ def: 'crate_wood', p: [1, 2, 3], material: 'ice' });
    }
  });

  it('handles broken and oversized text without throwing', () => {
    expect(parseSaveText('{oops').ok).toBe(false);
    expect(parseSaveText('x'.repeat(MAX_SAVE_BYTES + 1)).ok).toBe(false);
    // JSON is data: a "constructor" or script key is not executed or trusted.
    const evil = parseSaveText(JSON.stringify({ ...validSave(), __proto__: { hacked: true }, code: 'alert(1)' }));
    expect(evil.ok).toBe(true);
    expect(({} as { hacked?: boolean }).hacked).toBeUndefined();
    if (evil.ok) expect('code' in evil.value).toBe(false);
  });
});

describe('inventory', () => {
  const kv = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('persists favourites and most-recent order', () => {
    const store = kv();
    const a = new Inventory(store);
    a.toggleFavorite('x');
    a.touch('a');
    a.touch('b');
    a.touch('a');
    const b = new Inventory(store);
    expect(b.favorites.has('x')).toBe(true);
    expect(b.recent).toEqual(['a', 'b']);
    expect(b.toggleFavorite('x')).toBe(false);
  });

  it('ignores corrupt data', () => {
    const store = kv();
    store.setItem('chaoslab.inventory.v1', 'nope{');
    expect(new Inventory(store).recent).toEqual([]);
  });
});

describe('content packs', () => {
  const good = () => ({
    id: 'testpack', name: 'Test', version: '1.2.3', author: 'me',
    materials: [{ id: 'goo', friction: 0.5, restitution: 0.5, density: 100 }],
    entities: [{ id: 'blob', name: 'Blob', shape: { type: 'sphere', r: 0.5 }, material: 'goo', category: 'physics' }],
  });
  const ctx = { installedIds: [] as string[] };

  it('accepts a good manifest, and namespaces its ids', () => {
    const r = validatePack(good(), ctx);
    expect(r.errors).toEqual([]);
    expect(r.pack!.entities[0]!.id).toBe('testpack:blob');
    expect(r.pack!.entities[0]!.material).toBe('testpack:goo');
  });

  it.each([
    ['bad id', { id: 'Bad ID!' }],
    ['no name', { name: undefined }],
    ['bad version', { version: 'latest' }],
    ['script field', { script: 'alert(1)' }],
    ['code field', { code: 'x' }],
    ['missing dependency', { dependencies: ['ghost'] }],
    ['self dependency', { dependencies: ['testpack'] }],
    ['no content', { materials: [], entities: [] }],
    ['unknown material', { materials: [], entities: [{ id: 'a', shape: { type: 'sphere', r: 1 }, material: 'nope' }] }],
    ['duplicate entity', { entities: [{ id: 'a', shape: { type: 'sphere', r: 1 } }, { id: 'a', shape: { type: 'sphere', r: 1 } }] }],
    ['forbidden behaviour', { entities: [{ id: 'a', shape: { type: 'sphere', r: 1 }, behavior: 'npc' }] }],
    ['huge shape', { entities: [{ id: 'a', shape: { type: 'box', size: [1e6, 1, 1] } }] }],
    ['NaN param', { entities: [{ id: 'a', shape: { type: 'sphere', r: 1 }, params: { x: Infinity } }] }],
    ['bad density', { materials: [{ id: 'm', friction: 0.5, restitution: 0.5, density: -1 }] }],
    ['map with no ground', { maps: [{ id: 'm', spawn: [0, 0, 0], blocks: [] }] }],
  ])('rejects: %s', (_name, patch) => {
    const r = validatePack({ ...good(), ...patch }, ctx);
    expect(r.pack).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('never carries unknown fields into a definition', () => {
    const raw = good() as unknown as { entities: Record<string, unknown>[] };
    raw.entities[0]!.onHit = 'fetch("evil")';
    raw.entities[0]!.kind = 'npc';
    const e = validatePack(raw, ctx).pack!.entities[0]!;
    expect((e as unknown as Record<string, unknown>).onHit).toBeUndefined();
    expect(e.kind).toBe('prop');
  });

  it('rejects oversize and non-JSON text', () => {
    expect(parsePackText('not json', ctx).pack).toBeNull();
    expect(parsePackText('x'.repeat(3 * 1024 * 1024), ctx).pack).toBeNull();
  });

  describe('PackManager', () => {
    let db: KeyValueDb;
    let maps: Record<string, never>;
    beforeEach(() => {
      indexedDB = new IDBFactory();
      db = new KeyValueDb();
      maps = {};
    });
    const mgr = () => new PackManager(db, maps);
    const text = (o: object) => JSON.stringify(o);

    it('registers content, restores after a restart, and toggles cleanly', async () => {
      const m = mgr();
      await m.importText(text(good()));
      expect(catalog.has('testpack:blob')).toBe(true);
      expect(materials.has('testpack:goo')).toBe(true);
      catalog.removeBySource('testpack');
      materials.removeBySource('testpack');

      const reborn = mgr();
      await reborn.restore();
      expect(catalog.has('testpack:blob')).toBe(true);
      await reborn.setEnabled('testpack', false);
      expect(catalog.has('testpack:blob')).toBe(false);
      await reborn.setEnabled('testpack', true);
      expect(catalog.has('testpack:blob')).toBe(true);
      await reborn.remove('testpack');
      expect(catalog.has('testpack:blob')).toBe(false);
      expect(reborn.list()).toHaveLength(0);
    });

    it('a failed import leaves everything exactly as it was', async () => {
      const m = mgr();
      await m.importText(text(good()));
      const before = catalog.list().length;
      const r = await m.importText(text({ ...good(), entities: [{ id: 'broken', shape: { type: 'blob' } }] }));
      expect(r.pack).toBeNull();
      expect(catalog.list().length).toBe(before);
      expect(catalog.has('testpack:blob')).toBe(true);
      await m.remove('testpack');
    });

    it('resolves dependencies, in either install order on restore', async () => {
      const m = mgr();
      const base = { ...good(), id: 'base-pack' };
      const dep = { ...good(), id: 'addon-pack', dependencies: ['base-pack'] };
      expect((await m.importText(text(dep))).pack).toBeNull();
      await m.importText(text(base));
      expect((await m.importText(text(dep))).pack).not.toBeNull();
      await m.setEnabled('base-pack', false);
      expect(catalog.has('addon-pack:blob')).toBe(false);
      expect(m.list().find((p) => p.pack.id === 'addon-pack')!.problem).toContain('base-pack');
      await m.setEnabled('base-pack', true);
      expect(catalog.has('addon-pack:blob')).toBe(true);
      await m.remove('addon-pack');
      await m.remove('base-pack');
    });
  });
});

describe('with a running game', () => {
  let game: Game;
  beforeAll(async () => {
    game = await headlessGame();
  });
  afterAll(() => game.dispose());
  beforeEach(() => {
    indexedDB = new IDBFactory();
    game.startSession({ mode: 'sandbox', map: 'test_facility' });
    game.rules.damage = false;
    game.player.teleport({ x: 0, y: 1, z: 12 }, 0);
    game.advance(0.1);
  });

  const aimAt = (x: number, y: number, z: number) => {
    const e = game.camera.position;
    game.player.yaw = Math.atan2(-(x - e.x), -(z - e.z));
    game.player.pitch = Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z));
    game.advance(1 / 60);
  };
  const construction = () => {
    game.tools.selectById('construction');
    return game.tools.active as ConstructionTool;
  };
  /** Runs a real click through the tool manager, as a mouse press would. */
  const click = (button: 0 | 2 = 0) => {
    game.input.pressButton(button);
    game.advance(1 / 60);
    game.input.releaseButton(button);
    game.advance(1 / 60);
  };

  describe('scene save and load', () => {
    it('round-trips a whole construction through JSON and a world rebuild', () => {
      const a = spawn(game, 'crate_metal', -6, 0.51, 12);
      const b = spawn(game, 'crate_metal', -5, 0.51, 12);
      const scaled = spawn(game, 'crate_wood', -8, 0.8, 10);
      game.entities.setScale(scaled, 1.5);
      game.entities.setTint(scaled, 0xff0000);
      game.entities.setMaterial(scaled, 'ice');
      const pinned = spawn(game, 'floor_panel', 4, 3, 10);
      game.entities.setAnchored(pinned, true);
      const npc = spawn(game, 'npc_guard', 6, 1.5, 3);
      const lever = spawn(game, 'lever', -10, 0.31, 12);
      const lamp = spawn(game, 'lamp', -10, 0.21, 14);
      expect(game.signals.connect(lever.id, lamp.id)).toBeNull();
      const lk = game.connections.connect('weld', a, b, { x: -5.5, y: 0.5, z: 12 }, { x: -5.5, y: 0.5, z: 12 }, null);
      expect(lk.ok).toBe(true);
      lever.components[0]!.onInteract!();
      game.setGravity(4);
      game.advance(0.5);

      const data = JSON.parse(JSON.stringify(serializeScene(game, 'test', 'scene')));
      const parsed = validateSave(data);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const count = game.entities.active.filter((e) => !e.fixture).length;
      game.loadSave(parsed.value);
      game.advance(0.1);

      expect(game.entities.active.filter((e) => !e.fixture).length).toBe(count);
      expect(game.rules.gravity).toBe(4);
      expect(game.connections.count).toBe(1);
      const s2 = game.entities.get(scaled.id)!;
      expect(s2.scale).toBe(1.5);
      expect(s2.tint).toBe(0xff0000);
      expect(s2.materialId).toBe('ice');
      expect(game.entities.get(pinned.id)!.body!.isFixed()).toBe(true);
      expect(game.entities.get(npc.id)!.component(NpcComponent)).toBeDefined();
      expect(game.signals.hasInput(lamp.id)).toBe(true);
      expect(game.entities.get(lever.id)!.components[0]!.signalOut!()).toBe(true);
      const pa = game.entities.get(a.id)!.position;
      const pb = game.entities.get(b.id)!.position;
      expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeCloseTo(1, 1);
    });

    it('saves do not contain live physics objects', () => {
      spawn(game, 'crate_metal', -6, 0.51, 12);
      expect(() => JSON.stringify(serializeScene(game, 'x', 'scene'))).not.toThrow();
      const s = serializeScene(game, 'x', 'scene');
      expect(JSON.stringify(s)).not.toContain('handle');
    });

    it('survives a browser restart: a new store on the same database reads it back', async () => {
      spawn(game, 'crate_metal', -6, 0.51, 12);
      await game.saveScene('slot:a', 'My Base');
      const fresh = new SaveStore(new KeyValueDb());
      const list = await fresh.list('scene');
      expect(list.map((s) => s.name)).toContain('My Base');
      const loaded = await fresh.read('scene', 'slot:a');
      expect(loaded?.entities.some((e) => e.def === 'crate_metal')).toBe(true);
    });

    it('reports a corrupted stored save instead of failing', async () => {
      const db = new KeyValueDb();
      await db.put('saves', 'bad', { schema: 2, nonsense: true });
      const store = new SaveStore(db);
      const list = await store.list('scene');
      expect(list[0]!.corrupt).toBe(true);
      expect(await store.read('scene', 'bad')).toBeNull();
    });

    it('a save referencing unknown objects loads the rest and warns', () => {
      const r = validateSave({ ...validSave(), entities: [{ id: 1, def: 'no_such_thing', p: [0, 2, 0], q: [0, 0, 0, 1] }, { id: 2, def: 'crate_wood', p: [3, 2, 3], q: [0, 0, 0, 1] }] });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      game.loadSave(r.value);
      expect(game.entities.get(2)).toBeDefined();
      expect(game.ui.get().toasts.some((t) => t.text.includes('no_such_thing'))).toBe(true);
    });

    it('a motor keeps its rotor pose and power state', () => {
      const m = spawn(game, 'motor', -6, 0.21, 12);
      (m.component(Motor) as Motor).setSignal(true);
      game.advance(1);
      const before = m.component(Motor)!.rotor!.rotation();
      const data = serializeScene(game, 'x', 'scene');
      game.loadSave(data);
      const m2 = game.entities.get(m.id)!.component(Motor)!;
      expect(m2.isPowered).toBe(true);
      expect(m2.rotor!.rotation().y).toBeCloseTo(before.y, 2);
    });
  });

  describe('construction tool', () => {
    it('places a part with a valid preview, and undo and redo remove and restore it', () => {
      const n = game.entities.registry.size;
      const c = construction();
      c.setPart('floor_panel');
      aimAt(0, 0, 8);
      click();
      expect(game.entities.registry.size).toBe(n + 1);
      const placed = game.entities.active.at(-1)!;
      expect(placed.def.id).toBe('floor_panel');
      expect(placed.position.y).toBeCloseTo(0.07, 1);
      const id = placed.id;
      game.undo.undo();
      expect(game.entities.get(id)).toBeUndefined();
      game.undo.redo();
      expect(game.entities.get(id)?.def.id).toBe('floor_panel');
    });

    it('grid snapping lands parts on grid lines', () => {
      const c = construction();
      c.setPart('floor_panel');
      game.build.gridIndex = 3; // 1m
      aimAt(0.37, 0, 8.21);
      click();
      const p = game.entities.active.at(-1)!.position;
      expect(p.x).toBeCloseTo(Math.round(p.x), 3);
      expect(p.z).toBeCloseTo(Math.round(p.z), 3);
      game.build.gridIndex = 2;
    });

    it('refuses a blocked spot and explains why', () => {
      const c = construction();
      c.setPart('platform');
      const n = game.entities.registry.size;
      // Right up against the wall: a 3m slab can't fit.
      game.player.teleport({ x: -21.2, y: 1, z: 2 }, Math.PI / 2);
      game.player.pitch = 0;
      game.advance(0.2);
      click();
      expect(game.entities.registry.size).toBe(n);
      expect(game.ui.get().toasts.at(-1)?.text).toMatch(/No room/);
    });

    it('moves, rotates and scales with undo for each', () => {
      const e = spawn(game, 'crate_metal', 0, 0.51, 8);
      game.advance(0.3);
      const c = construction();
      c.setMode('move');
      aimAt(0, 0.5, 8);
      click();
      aimAt(3, 0, 6);
      click();
      expect(e.position.x).toBeGreaterThan(2);
      game.undo.undo();
      expect(e.position.x).toBeCloseTo(0, 1);

      c.setMode('rotate');
      aimAt(0, 0.5, 8);
      const q0 = e.rotation.y;
      click();
      expect(e.rotation.y).not.toBeCloseTo(q0, 2);
      game.undo.undo();
      expect(e.rotation.y).toBeCloseTo(q0, 2);

      c.setMode('scale');
      aimAt(0, 0.5, 8);
      const mass = e.mass;
      click();
      expect(e.scale).toBeCloseTo(1.1, 3);
      expect(e.mass).toBeGreaterThan(mass);
      game.undo.undo();
      expect(e.scale).toBe(1);
    });

    it('scale stays inside its safe limits', () => {
      const e = spawn(game, 'crate_metal', 0, 0.51, 8);
      for (let i = 0; i < 40; i++) game.entities.setScale(e, e.scale * 1.5);
      expect(e.scale).toBe(3);
      for (let i = 0; i < 40; i++) game.entities.setScale(e, e.scale * 0.5);
      expect(e.scale).toBe(0.25);
    });

    it('duplicates an object with its properties', () => {
      const e = spawn(game, 'crate_metal', 0, 0.51, 8);
      game.entities.setTint(e, 0x00ff00);
      game.entities.setScale(e, 1.2);
      game.advance(0.2);
      const c = construction();
      c.setMode('copy');
      aimAt(0, 0.5, 8);
      click();
      expect(c.mode).toBe('place');
      game.player.teleport({ x: 0, y: 1, z: 12 }, 0);
      aimAt(-4, 0, 8);
      click();
      const copy = game.entities.active.at(-1)!;
      expect(copy).not.toBe(e);
      expect(copy.def.id).toBe('crate_metal');
      expect(copy.tint).toBe(0x00ff00);
      expect(copy.scale).toBeCloseTo(1.2, 3);
    });

    it('group-moves a multi-selection', () => {
      const a = spawn(game, 'crate_metal', 0, 0.51, 8);
      const b = spawn(game, 'crate_metal', 2, 0.51, 8);
      game.advance(0.3);
      const c = construction();
      c.setMode('move');
      game.input.pressAction('sprint');
      aimAt(2, 0.5, 8);
      click();
      aimAt(0, 0.5, 8);
      click();
      game.input.releaseAction('sprint');
      click();
      aimAt(-6, 0, 12);
      click();
      expect(a.position.x).toBeLessThan(-4);
      expect(b.position.x - a.position.x).toBeCloseTo(2, 0);
      expect(b.position.z).toBeCloseTo(a.position.z, 1);
      game.undo.undo();
      expect(a.position.x).toBeCloseTo(0, 1);
      expect(b.position.x).toBeCloseTo(2, 1);
    });

    it('hinges and welds through the tool, and undo removes the link', () => {
      const a = spawn(game, 'crate_metal', 0, 2.5, 8);
      game.entities.setAnchored(a, true);
      const door = spawn(game, 'door_hinged', 1.2, 2.5, 8);
      game.advance(0.05);
      const c = construction();
      c.setMode('hinge');
      aimAt(0.45, 2.5, 8.51);
      click();
      aimAt(0.75, 2.5, 8.1);
      click();
      expect(game.connections.count).toBe(1);
      game.advance(0.5);
      // Pinned to its hinge, the leaf hangs instead of falling.
      expect(door.position.y).toBeGreaterThan(1.5);
      game.undo.undo();
      expect(game.connections.count).toBe(0);
      game.advance(1);
      expect(door.position.y).toBeLessThan(2);
    });

    it('wires through the tool, rejects a bad port, and toggles off', () => {
      const lever = spawn(game, 'lever', 0, 0.31, 8);
      const lamp = spawn(game, 'lamp', 2, 0.21, 8);
      const crate = spawn(game, 'crate_metal', -2, 0.51, 8);
      game.advance(0.1);
      const c = construction();
      c.setMode('wire');
      aimAt(2, 0.25, 8);
      click();
      expect(game.ui.get().toasts.at(-1)?.text).toMatch(/no output/);
      aimAt(-2, 0.5, 8);
      click();
      expect(game.ui.get().toasts.at(-1)?.text).toMatch(/no signal ports/);
      aimAt(0, 0.25, 8);
      click();
      aimAt(2, 0.25, 8);
      click();
      expect(game.signals.graph.has(lever.id, lamp.id)).toBe(true);
      aimAt(0, 0.25, 8);
      click();
      aimAt(2, 0.25, 8);
      click();
      expect(game.signals.graph.has(lever.id, lamp.id)).toBe(false);
      void crate;
    });

    it('a loose structure keeps standing, and comes down when its base is knocked out', () => {
      const base = spawn(game, 'crate_metal', -8, 0.51, 10);
      const top = spawn(game, 'crate_metal', -8, 1.52, 10);
      game.advance(2);
      expect(top.position.y).toBeCloseTo(1.5, 1);
      game.entities.remove(base);
      game.advance(1.5);
      expect(top.position.y).toBeCloseTo(0.5, 1);
    });
  });

  describe('undo with removal', () => {
    it('restores a removed object with its links and wires', () => {
      const a = spawn(game, 'crate_metal', -6, 0.51, 12);
      const b = spawn(game, 'crate_metal', -5, 0.51, 12);
      const lever = spawn(game, 'lever', -10, 0.31, 12);
      const lamp = spawn(game, 'lamp', -10, 0.21, 14);
      game.signals.connect(lever.id, lamp.id);
      game.connections.connect('weld', a, b, { x: -5.5, y: 0.5, z: 12 }, { x: -5.5, y: 0.5, z: 12 }, null);
      game.removeByPlayer(a);
      game.removeByPlayer(lever);
      expect(game.connections.count).toBe(0);
      expect(game.signals.hasInput(lamp.id)).toBe(false);
      game.undo.undo();
      expect(game.signals.hasInput(lamp.id)).toBe(true);
      game.undo.undo();
      expect(game.entities.get(a.id)).toBeDefined();
      expect(game.connections.count).toBe(1);
    });

    it('fixtures refuse removal', () => {
      const fixture = game.entities.active.find((e) => e.fixture)!;
      expect(game.removeByPlayer(fixture)).toBe(false);
      expect(game.entities.get(fixture.id)).toBeDefined();
    });

    it('cleanup removes only the chosen categories and can be undone', () => {
      const before = game.countByCategory();
      expect(before.props).toBeGreaterThan(0);
      const n = game.cleanup(['props']);
      expect(n).toBe(before.props);
      const after = game.countByCategory();
      expect(after.props).toBeUndefined();
      expect(after.physics).toBe(before.physics);
      game.undo.undo();
      expect(game.countByCategory().props).toBe(before.props);
    });
  });

  describe('inspector and paint', () => {
    it('inspector describes a target and swaps its material', () => {
      const e = spawn(game, 'crate_wood', 0, 0.51, 8);
      game.advance(0.2);
      game.tools.selectById('inspector');
      aimAt(0, 0.5, 8);
      game.advance(0.3);
      const info = game.ui.get().inspect!;
      expect(info.name).toBe('Wooden Crate');
      expect(info.material).toBe('Wood');
      expect(info.mass).toBeGreaterThan(50);
      const m0 = e.materialId;
      click(2);
      expect(e.materialId).not.toBe(m0);
      expect(e.colliders[0]!.friction()).toBeCloseTo(materials.get(e.materialId).friction, 4);
      game.undo.undo();
      expect(e.materialId).toBe(m0);
    });

    it('paints, undoes, and clears', () => {
      const e = spawn(game, 'crate_wood', 0, 0.51, 8);
      game.advance(0.2);
      game.tools.selectById('paint');
      aimAt(0, 0.5, 8);
      click();
      expect(e.tint).not.toBeNull();
      game.undo.undo();
      expect(e.tint).toBeNull();
    });
  });

  it('the spawner places the selected item', () => {
    game.selectForPlacement('barrel');
    expect(game.tools.active.id).toBe('spawner');
    expect((game.tools.active as SpawnerTool).selected).toBe('barrel');
    aimAt(0, 0, 8);
    const n = game.entities.registry.size;
    click();
    expect(game.entities.registry.size).toBe(n + 1);
    expect(game.entities.active.at(-1)!.def.id).toBe('barrel');
    game.selectForPlacement('platform');
    expect(game.tools.active.id).toBe('construction');
  });

  it('the demo machine in the Test Facility works: plate powers turntable, door and lamp', () => {
    game.advance(0.1);
    const f = (id: string) => game.entities.active.find((e) => e.fixture && e.def.id === id)!;
    const plate = f('pressure_plate');
    const motor = f('motor').component(Motor)!;
    const door = f('door_powered');
    expect(game.signals.graph.wiresOf(plate.id)).toHaveLength(3);
    const home = door.position.z;
    game.advance(1);
    expect(motor.isPowered).toBe(false);
    const crate = game.entities.active.find((e) => !e.fixture && e.def.id === 'crate_metal' && Math.abs(e.position.x + 9) < 0.1 && Math.abs(e.position.z - 12.2) < 0.1)!;
    game.entities.setTransform(crate, { x: -9, y: 0.75, z: 15.5 }, { x: 0, y: 0, z: 0, w: 1 });
    game.advance(2);
    expect(motor.isPowered).toBe(true);
    expect(Math.abs(motor.rotor!.angvel().y)).toBeGreaterThan(1);
    expect(Math.abs(door.position.z - home)).toBeGreaterThan(1.5);
    // Taking the crate off stops it all again.
    game.entities.setTransform(crate, { x: -9, y: 0.51, z: 12.2 }, { x: 0, y: 0, z: 0, w: 1 });
    game.advance(2.5);
    expect(motor.isPowered).toBe(false);
    expect(door.position.z).toBeCloseTo(home, 1);
  });

  it('wires to map fixtures survive a save and reload', () => {
    game.advance(0.1);
    const door = game.entities.active.find((e) => e.fixture && e.def.id === 'door_powered')!;
    const lever = spawn(game, 'lever', 2, 0.31, 12);
    expect(game.signals.connect(lever.id, door.id)).toBeNull();
    const data = serializeScene(game, 'x', 'scene');
    game.loadSave(data);
    const door2 = game.entities.active.find((e) => e.fixture && e.def.id === 'door_powered')!;
    expect(door2.id).toBe(door.id);
    expect(game.signals.graph.has(lever.id, door2.id)).toBe(true);
  });

  describe('every map', () => {
    for (const id of Object.keys(MAPS)) {
      // The proving ground is a bare hall: its floor comes from each challenge, tested below.
      if (id === 'proving_ground') continue;

      it(`${id}: player stands at spawn without falling or being stuck`, () => {
        game.startSession({ map: id, mode: 'sandbox' });
        game.rules.damage = false;
        game.advance(2);
        const p = game.player;
        expect(p.grounded).toBe(true);
        expect(p.dead).toBe(false);
        const before = p.position;
        game.input.pressAction('forward');
        game.advance(0.8);
        game.input.releaseAction('forward');
        const after = p.position;
        expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1);
      });

      it(`${id}: props settle without exploding or falling through the world`, () => {
        game.startSession({ map: id, mode: 'sandbox' });
        game.rules.damage = false;
        const n = game.entities.active.filter((e) => e.def.kind === 'prop').length;
        game.advance(5);
        const props = game.entities.active.filter((e) => e.def.kind === 'prop');
        expect(props.length).toBe(n);
        for (const e of props) {
          expect(Number.isFinite(e.position.y), e.def.id).toBe(true);
          expect(e.position.y, e.def.id).toBeGreaterThan(-1);
        }
      });
    }

    it('the yard nav grid covers the map, and guards can patrol it', () => {
      game.startSession({ map: 'industrial_yard', mode: 'sandbox' });
      game.rules.damage = false;
      const nav = game.nav!;
      expect(nav.walk.reduce((a, b) => a + b, 0)).toBeGreaterThan(5000);
      expect(game.map!.patrols.length).toBe(3);
      expect(nav.findPath({ x: 0, z: 50 }, { x: -36, z: -38 })).not.toBeNull();
      const guards = game.npcs.filter((n) => n.profile.id === 'guard');
      expect(guards.length).toBe(2);
      const start = guards[0]!.position;
      game.advance(8);
      expect(Math.hypot(guards[0]!.position.x - start.x, guards[0]!.position.z - start.z)).toBeGreaterThan(2);
    });

    it('jump pads launch, low gravity floats, and bounce surfaces bounce', () => {
      game.startSession({ map: 'gravity_playground', mode: 'sandbox' });
      game.rules.damage = false;
      game.advance(0.5);
      const p = game.player;
      // Pad at (0, 0, 17).
      p.teleport({ x: 0, y: 1.3, z: 17 }, 0);
      let top = 0;
      for (let i = 0; i < 60; i++) { game.advance(1 / 60); top = Math.max(top, p.feet.y); }
      expect(top).toBeGreaterThan(5);

      // Low-gravity column over the hub.
      p.teleport({ x: 0, y: 8, z: -7 }, 0);
      game.advance(0.1);
      expect(p.gravityFactor).toBeCloseTo(0.2, 2);
      const crate = spawn(game, 'crate_metal', 0, 12, -7);
      game.advance(0.3);
      expect(crate.body!.gravityScale()).toBeCloseTo(0.2, 2);

      // Bounce surface at (8, 2.2, -4).
      p.teleport({ x: 8, y: 3.6, z: -4 }, 0);
      top = 0;
      for (let i = 0; i < 120; i++) { game.advance(1 / 60); top = Math.max(top, p.feet.y); }
      expect(top).toBeGreaterThan(6);
    });

    it('falling out of the world respawns the player and removes the object', () => {
      game.startSession({ map: 'gravity_playground', mode: 'sandbox' });
      game.rules.damage = false;
      const c = spawn(game, 'crate_small', 40, -20, 40);
      game.player.teleport({ x: 40, y: -20, z: 40 }, 0);
      game.advance(2.5);
      expect(game.entities.get(c.id)).toBeUndefined();
      expect(game.player.position.z).toBeCloseTo(22, 0);
    });

    it('a lift and a sideways shuttle carry the player along', () => {
      game.startSession({ map: 'gravity_playground', mode: 'sandbox' });
      game.rules.damage = false;
      const lifts = game.entities.active.filter((e) => e.def.id === 'moving_platform');
      expect(lifts).toHaveLength(2);
      const shuttle = lifts[1]!;
      const p = game.player;
      const s = shuttle.position;
      p.teleport({ x: s.x, y: s.y + 1.1, z: s.z }, 0);
      game.advance(0.7);
      expect(p.grounded).toBe(true);
      const offset = p.position.x - shuttle.position.x;
      game.advance(1.5);
      expect(Math.abs(p.position.x - shuttle.position.x - offset)).toBeLessThan(0.3);
      expect(shuttle.position.x).not.toBeCloseTo(s.x, 0);
    });
  });

  describe('modes', () => {
    it('settings never leak from one mode to the next', () => {
      game.startSession({ mode: 'sandbox', map: 'test_facility' });
      game.setGravity(2);
      game.rules.damage = false;
      game.rules.aggression = 'high';
      game.rules.limits.total = 11;
      game.startSession({ mode: 'survival', map: 'test_facility' });
      expect(game.rules.gravity).toBe(9.81);
      expect(game.physics.w.gravity.y).toBeCloseTo(-9.81, 2);
      expect(game.rules.damage).toBe(true);
      expect(game.rules.flight).toBe(false);
      expect(game.rules.aggression).toBe('normal');
      expect(game.rules.limits.total).not.toBe(11);
      expect(game.tools.isAllowed(game.tools.tools.find((t) => t.id === 'construction')!)).toBe(false);
      game.startSession({ mode: 'sandbox', map: 'test_facility' });
      expect(game.rules.flight).toBe(true);
      expect(game.tools.isAllowed(game.tools.tools.find((t) => t.id === 'construction')!)).toBe(true);
      expect(game.player.onDeath).toBeNull();
    });

    it('wave composition grows', () => {
      expect(waveComposition(1)).toEqual({ robots: 3, heavies: 0 });
      expect(waveComposition(5).heavies).toBeGreaterThan(0);
      expect(waveComposition(5).robots).toBeGreaterThan(waveComposition(2).robots);
    });

    const killWave = (mode: SurvivalMode) => {
      for (let i = 0; i < 400; i++) {
        for (const n of [...game.npcs]) if (n.alive) game.damageEntity(n.e, 9999, { kind: 'player' });
        game.advance(0.1);
        if (mode.hud().result) return;
        if (mode.hud().lines[1]!.startsWith('Next')) return;
      }
    };

    it('survival runs waves through to victory, then resets cleanly', () => {
      game.startSession({ mode: 'survival', map: 'industrial_yard' });
      const mode = game.mode as SurvivalMode;
      game.rules.damage = false;
      expect(game.npcs.length).toBe(0); // bystanders are cleared
      game.advance(3.5);
      expect(mode.wave).toBe(1);
      game.advance(4);
      expect(game.npcs.length).toBeGreaterThan(0);
      for (let w = 0; w < SURVIVAL_WAVES && !mode.hud().result; w++) {
        killWave(mode);
        game.advance(7);
      }
      const r = mode.hud().result;
      expect(r?.win).toBe(true);
      expect(mode.score).toBeGreaterThan(1000);
      expect(game.input.enabled).toBe(false);

      game.restart();
      const fresh = game.mode as SurvivalMode;
      expect(fresh).not.toBe(mode);
      expect(fresh.wave).toBe(0);
      expect(fresh.score).toBe(0);
      expect(game.npcs.length).toBe(0);
      expect(fresh.hud().result).toBeNull();
    });

    it('survival ends after three deaths, and stops respawning', () => {
      game.startSession({ mode: 'survival', map: 'industrial_yard' });
      const mode = game.mode as SurvivalMode;
      for (let i = 0; i < 3; i++) {
        game.player.takeDamage(9999, 'test');
        expect(game.player.dead).toBe(true);
        if (i < 2) {
          game.advance(3);
          expect(game.player.dead).toBe(false);
        }
      }
      expect(mode.hud().result?.win).toBe(false);
      game.advance(4);
      expect(game.player.dead).toBe(true);
      game.restart();
      expect(game.player.dead).toBe(false);
    });

    it('every challenge loads, with its budget, its tools and a way to lose', () => {
      for (let i = 0; i < CHALLENGES.length; i++) {
        game.startSession({ mode: 'contraption', challenge: i });
        const m = game.mode as ContraptionMode;
        expect(game.map!.def.id).toBe('proving_ground');
        game.advance(1);
        expect(game.player.grounded).toBe(true);
        expect(game.player.dead).toBe(false);
        expect(m.partsUsed).toBe(0);
        m.time = 1e6;
        game.advance(0.1);
        expect(m.hud().result?.win).toBe(false);
      }
    });

    it('Bridge: the part budget binds, and a bridge built with parts wins', () => {
      game.startSession({ mode: 'contraption', challenge: 0 });
      const m = game.mode as ContraptionMode;
      const c = game.tools.tools.find((t) => t.id === 'construction') as ConstructionTool;
      expect(game.tools.active).toBe(c);
      for (let i = 0; i < 6; i++) expect(game.trySpawn('platform', { position: { x: 0, y: -0.15, z: 6.5 - i * 3 }, anchored: true }).ok).toBe(true);
      const over = game.trySpawn('platform', { position: { x: 5, y: 3, z: 0 } });
      expect(over.ok).toBe(false);
      expect(game.ui.get().toasts.at(-1)?.text).toMatch(/budget/i);
      expect(m.partsUsed).toBe(6);
      // Walk it for real: from the start deck across the pit to the pad.
      game.player.teleport({ x: 0, y: 1, z: 12 }, 0);
      game.player.pitch = 0;
      game.advance(0.2);
      game.input.pressAction('forward');
      for (let i = 0; i < 200 && !m.hud().result; i++) game.advance(0.05);
      game.input.releaseAction('forward');
      const r = m.hud().result;
      expect(r?.win).toBe(true);
      expect(r?.next).toBe(true);
    });

    it('falling into the pit respawns and the challenge carries on', () => {
      game.startSession({ mode: 'contraption', challenge: 0 });
      game.player.teleport({ x: 0, y: 1, z: 1 }, 0);
      game.advance(3);
      expect(game.player.position.z).toBeGreaterThan(15);
      expect((game.mode as ContraptionMode).hud().result).toBeNull();
    });

    it('Power Up: the door blocks the way until it is wired', () => {
      game.startSession({ mode: 'contraption', challenge: 1 });
      const m = game.mode as ContraptionMode;
      game.advance(0.1);
      const door = game.entities.active.find((e) => e.def.id === 'door_powered')!;
      // Door refuses E only when wired; pressing E is the unwired behaviour.
      game.player.teleport({ x: 0, y: 1, z: 6 }, 0);
      game.player.pitch = 0;
      game.advance(0.1);
      game.input.pressAction('forward');
      game.advance(2);
      game.input.releaseAction('forward');
      expect(game.player.position.z).toBeGreaterThan(0.3);
      const lever = game.trySpawn('lever', { position: { x: 3, y: 0.31, z: 5 } });
      expect(lever.ok).toBe(true);
      if (!lever.ok) return;
      expect(game.signals.connect(lever.entity.id, door.id)).toBeNull();
      lever.entity.components[0]!.onInteract!();
      game.advance(2.5);
      game.input.pressAction('forward');
      for (let i = 0; i < 80 && !m.hud().result; i++) game.advance(0.1);
      game.input.releaseAction('forward');
      expect(door.position.x, 'door slid open').toBeGreaterThan(3);
      expect(game.player.position.z, 'walked through').toBeLessThan(-14);
      expect(m.hud().result?.win).toBe(true);
    });

    it('Power Up: the door fills the opening, so there is no way round it', () => {
      game.startSession({ mode: 'contraption', challenge: 1 });
      game.advance(0.1);
      for (const x of [-2.1, -1.5, 0, 1.5, 2.1]) {
        game.player.teleport({ x, y: 1, z: 4 }, 0);
        game.player.pitch = 0;
        game.advance(0.1);
        game.input.pressAction('forward');
        game.advance(1.5);
        game.input.releaseAction('forward');
        expect(game.player.position.z, `x=${x}`).toBeGreaterThan(0.2);
      }
    });

    /** Aims at a body from the given spot and fires the real cannon at full charge. */
    const shoot = (from: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }) => {
      game.player.teleport(from, 0);
      game.advance(0.1);
      aimAt(at.x, at.y, at.z);
      game.tools.selectById('impulse');
      const cannon = game.tools.active as unknown as { fire(sign: 1 | -1, power: number): number; reset(): void };
      cannon.reset();
      return cannon.fire(1, 1);
    };

    it('challenge payloads cannot be moved, copied, re-materialled or removed by tools', () => {
      game.startSession({ mode: 'contraption', challenge: 3 });
      game.advance(0.1);
      const payload = game.entities.active.find((e) => e.def.id === 'crate_metal')!;
      expect(payload.locked).toBe(true);
      expect(game.removeByPlayer(payload)).toBe(false);
      game.player.teleport({ x: 0, y: 1, z: 7 }, 0);
      game.advance(0.1);
      aimAt(0, 0.5, 2);
      const c = construction();
      const at = payload.position.z;
      c.setMode('move');
      click();
      aimAt(0, 3, -22);
      click();
      expect(payload.position.z).toBeCloseTo(at, 1);
      expect(game.cleanup(['props'])).toBe(0);
      expect(game.entities.get(payload.id)).toBeDefined();
    });

    it('Special Delivery can be solved as intended: a bridge and the cannon', () => {
      game.startSession({ mode: 'contraption', challenge: 2 });
      const m = game.mode as ContraptionMode;
      expect(game.tools.isAllowed(game.tools.tools[0]!)).toBe(false);
      game.advance(0.2);
      // Five anchored platforms span the 14m pit. The start edge is at z=8.
      for (let i = 0; i < 5; i++) {
        const r = game.trySpawn('platform', { position: { x: 0, y: -0.15, z: 7 - i * 3 }, anchored: true });
        expect(r.ok).toBe(true);
      }
      const ball = game.entities.active.find((e) => e.def.id === 'ball_metal')!;
      for (let i = 0; i < 12 && !m.hud().result; i++) {
        const p = ball.position;
        // Keep on shooting from behind the ball, like a player would.
        shoot({ x: p.x, y: 1, z: p.z + 5 }, p);
        for (let k = 0; k < 24 && !m.hud().result; k++) game.advance(0.1);
      }
      expect(m.hud().result?.win, `ball ended at ${JSON.stringify(ball.position)}`).toBe(true);
    });

    it('Going Up can be solved as intended: a lift and the cannon', () => {
      game.startSession({ mode: 'contraption', challenge: 3 });
      const m = game.mode as ContraptionMode;
      game.advance(0.2);
      const crate = game.entities.active.find((e) => e.def.id === 'crate_metal')!;
      // A lift in the bay against the ledge, whose front face is at z=-14.
      const lift = game.trySpawn('moving_platform', { position: { x: 0, y: -0.115, z: -12.5 } });
      expect(lift.ok).toBe(true);
      if (!lift.ok) return;
      const liftAt = lift.entity;
      /** Stands behind the crate on the line to the goal point, and fires through it. */
      const shootToward = (gx: number, gz: number) => {
        const p = crate.position;
        const d = Math.hypot(p.x - gx, p.z - gz) || 1;
        const from = { x: p.x + ((p.x - gx) / d) * 3.2, y: p.y + 0.7, z: p.z + ((p.z - gz) / d) * 3.2 };
        return shoot(from, { x: p.x, y: p.y, z: p.z });
      };
      const onLift = () => Math.abs(crate.position.x - liftAt.position.x) < 0.9 && Math.abs(crate.position.z - liftAt.position.z) < 0.9 && crate.position.y > liftAt.position.y;
      for (let i = 0; i < 60 && !onLift(); i++) {
        // The last shove waits until the lift is low enough for the crate to get onto it.
        const far = Math.hypot(crate.position.x, crate.position.z + 12.5) > 3.2;
        if (far || liftAt.position.y < 0) shootToward(0, -12.5);
        for (let k = 0; k < 10 && !onLift(); k++) {
          game.advance(0.05);
          if (!far && liftAt.position.y < 0) break;
        }
      }
      expect(onLift(), `crate at ${JSON.stringify(crate.position)}, lift at ${JSON.stringify(liftAt.position)}`).toBe(true);
      for (let i = 0; i < 300 && !m.hud().result; i++) {
        game.advance(0.1);
        // Near the top of its travel, knock the crate off the lift and onto the ledge.
        if (crate.position.y > 3.4 && crate.position.z > -14.6) {
          const p = crate.position;
          shootToward(p.x, -22);
          game.advance(0.6);
        }
      }
      expect(m.hud().result?.win, `crate ended at ${JSON.stringify(crate.position)}`).toBe(true);
    });

    it('destroying the payload fails the challenge', () => {
      game.startSession({ mode: 'contraption', challenge: 2 });
      const m = game.mode as ContraptionMode;
      game.advance(0.2);
      const payload = game.entities.active.find((e) => e.def.id === 'ball_metal')!;
      game.entities.remove(payload);
      game.advance(0.1);
      expect(m.hud().result?.win).toBe(false);
    });

    it('stars reward using few parts and being quick', () => {
      expect(starsFor(1, 6, 10, 60)).toBe(3);
      expect(starsFor(6, 6, 10, 60)).toBe(2);
      expect(starsFor(6, 6, 100, 60)).toBe(1);
    });

    it('Playground: orbs collect, gravity shifts on its timer, and the world resets', () => {
      game.startSession({ mode: 'playground' });
      const m = game.mode as PlaygroundMode;
      expect(game.map!.def.id).toBe('gravity_playground');
      game.rules.damage = false;
      game.advance(0.2);
      game.player.teleport({ x: 0, y: 1.2, z: 13 }, 0);
      game.advance(0.2);
      expect(m.collected).toBe(1);
      expect(game.rules.gravity).toBe(9.81);
      game.advance(25);
      expect(game.rules.gravity).toBe(3.2);
      expect(game.physics.w.gravity.y).toBeCloseTo(-3.2, 2);
      game.restart();
      expect(game.rules.gravity).toBe(9.81);
      expect((game.mode as PlaygroundMode).collected).toBe(0);
    });

    /** Holds forward and sprint, steering toward a point: only movement a player could do. */
    const walkTo = (x: number, z: number, maxSeconds: number, done: () => boolean) => {
      const inp = game.input;
      inp.pressAction('forward');
      inp.pressAction('sprint');
      for (let t = 0; t < maxSeconds && !done(); t += 1 / 30) {
        const p = game.player.position;
        game.player.yaw = Math.atan2(-(x - p.x), -(z - p.z));
        game.advance(1 / 30);
      }
      inp.releaseAction('forward');
      inp.releaseAction('sprint');
    };

    it('Playground: a player using only movement can reach the hub and climb to the summit', () => {
      game.startSession({ mode: 'playground' });
      const m = game.mode as PlaygroundMode;
      game.rules.damage = false;
      const pl = game.player;
      game.advance(0.3);
      const on = (y: number, x: number, z: number, r: number) => () => pl.grounded && Math.abs(pl.feet.y - y) < 0.4 && Math.hypot(pl.position.x - x, pl.position.z - z) < r;
      // Spawn island to the hub, across the gap, by jump pad.
      walkTo(0, 17, 4, () => pl.velocity.y > 5);
      expect(pl.velocity.y, 'launched by the first pad').toBeGreaterThan(5);
      walkTo(0, 0, 6, on(2, 0, 0, 7));
      expect(pl.feet.y, 'landed on the hub').toBeCloseTo(2, 0);
      // Low-gravity jump: must beat a normal 1.3m jump by a wide margin.
      walkTo(0, -7, 3, () => Math.hypot(pl.position.x, pl.position.z + 7) < 1);
      game.input.pressAction('jump');
      game.advance(1 / 60);
      game.input.releaseAction('jump');
      pl.queueJump();
      let top = 0;
      for (let i = 0; i < 180; i++) { game.advance(1 / 60); top = Math.max(top, pl.feet.y); }
      expect(top - 2, 'low gravity jump beats the normal 1.3m by a wide margin').toBeGreaterThan(3);
      // Off the hub to the first stone and along the whole chain of pads.
      const stones: [number, number, number][] = [[0, 4, -24], [-10, 6.5, -32], [3, 9, -40], [15, 11.5, -32], [8, 18, -56]];
      game.advance(1);
      for (const [x, y, z] of stones) {
        const last = x === 8;
        // Landing on a pad launches straight away, so being at surface height on the stone counts as arriving.
        const arrived = () => Math.abs(pl.feet.y - y) < 0.35 && Math.hypot(pl.position.x - x, pl.position.z - z) < (last ? 9 : 3);
        walkTo(x, z, 9, arrived);
        expect(arrived(), `reached stone at ${x},${z}; player at ${JSON.stringify(pl.feet)}`).toBe(true);
        if (!last) {
          walkTo(x, z, 2, () => pl.velocity.y > 5);
          expect(pl.velocity.y, `launched from stone at ${x},${z}`).toBeGreaterThan(5);
        }
      }
      game.advance(1);
      expect(pl.grounded).toBe(true);
      expect(pl.feet.y).toBeCloseTo(18, 0);
      expect(m.collected, 'collected orbs along the way').toBeGreaterThanOrEqual(2);
    });

    it('Playground: collecting every orb shows a result you can continue from', () => {
      game.startSession({ mode: 'playground' });
      const m = game.mode as PlaygroundMode;
      game.rules.damage = false;
      const orbs = (m as unknown as { orbs: { pos: { x: number; y: number; z: number } }[] }).orbs;
      for (const o of orbs) {
        game.player.teleport({ x: o.pos.x, y: o.pos.y, z: o.pos.z }, 0);
        game.advance(0.05);
      }
      expect(m.hud().result?.win).toBe(true);
      expect(game.input.enabled).toBe(false);
      game.continueAfterResult();
      expect(game.input.enabled).toBe(true);
      expect(game.ui.get().modeHud?.result?.canContinue).toBe(false);
    });

    it('Editor: holds physics, saves a layout, and the layout plays with real physics', async () => {
      game.startSession({ mode: 'editor', map: 'test_facility' });
      expect(game.mode).toBeInstanceOf(EditorMode);
      expect(game.editing).toBe(true);
      expect(game.player.flying).toBe(true);
      expect(game.entities.active.filter((e) => !e.fixture)).toHaveLength(0);
      const r = game.entities.spawn('crate_wood', { position: { x: 2, y: 6, z: 12 } });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      game.advance(1);
      expect(r.entity.position.y).toBe(6);
      const npc = spawn(game, 'npc_robot', 5, 2, 12);
      game.advance(0.5);
      expect(npc.position.y).toBe(2);
      const layout = await game.saveScene('layout:mine', 'Mine', 'layout');
      expect(layout.player).toBeUndefined();

      const stored = await game.saves.read('layout', 'layout:mine');
      expect(stored?.entities).toHaveLength(2);
      game.startSession({ map: stored!.map, layout: stored!, mode: 'sandbox' });
      expect(game.editing).toBe(false);
      expect(game.player.flying).toBe(false);
      const crate = game.entities.active.find((e) => e.def.id === 'crate_wood')!;
      game.rules.aggression = 'passive';
      game.advance(2.5);
      expect(crate.position.y).toBeLessThan(1);
      // A restart of a layout session keeps the layout rather than the default props.
      game.restart();
      expect(game.entities.active.filter((e) => !e.fixture)).toHaveLength(2);
    });
  });

  it('data-driven content from a pack spawns with its own physics, and pack maps load', async () => {
    const raw = {
      id: 'simpack', name: 'Sim', version: '1.0.0', author: 'a',
      materials: [{ id: 'slick', friction: 0.01, restitution: 0.9, density: 50 }],
      entities: [
        { id: 'ball', shape: { type: 'sphere', r: 0.4 }, material: 'slick', category: 'physics', name: 'Ball' },
        { id: 'bomb', shape: { type: 'box', size: [0.5, 0.5, 0.5] }, material: 'metal', breakSpeed: 6, health: 5, behavior: 'explosive', params: { radius: 4, impulse: 400, damage: 10 } },
      ],
      maps: [{ id: 'arena', name: 'Arena', spawn: [0, 0, 0], blocks: [{ pos: [0, -0.5, 0], size: [20, 1, 20] }], props: [{ id: 'ball', pos: [3, 1, 0] }] }],
    };
    await game.packs.importText(JSON.stringify(raw));
    const e = spawn(game, 'simpack:ball', -6, 3, 12);
    expect(e.colliders[0]!.friction()).toBeCloseTo(0.01, 3);
    const bomb = spawn(game, 'simpack:bomb', 6, 1, 12);
    game.advance(0.2);
    game.damageEntity(bomb, 100, { kind: 'player' });
    game.advance(0.3);
    expect(game.entities.get(bomb.id)).toBeUndefined();
    expect(MAPS['simpack:arena']).toBeDefined();
    game.startSession({ map: 'simpack:arena', mode: 'sandbox' });
    game.advance(1.5);
    expect(game.player.grounded).toBe(true);
    expect(game.entities.active.some((x) => x.def.id === 'simpack:ball')).toBe(true);
    await game.packs.remove('simpack');
    expect(MAPS['simpack:arena']).toBeUndefined();
    game.startSession({ mode: 'sandbox', map: 'test_facility' });
  });
});
