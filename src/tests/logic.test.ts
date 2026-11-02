import { describe, expect, it } from 'vitest';
import { UndoStack } from '../game/building/undo';
import { SignalGraph } from '../game/building/signals';
import { validateLink } from '../game/building/connections';
import { computePlacement, snapAngle, snapPosition, supportDistance } from '../game/building/placement';
import { catalog } from '../data/items';
import { FixedStepper, FIXED_DT } from '../game/core/loop';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings } from '../game/core/settings';
import { EntityRegistry } from '../game/entities/EntityRegistry';
import { IDLE_TIME, NPC_PROFILES, NpcBrain, type Perception } from '../game/npcs/NpcBrain';
import { NavGrid } from '../game/npcs/NavGrid';
import { Cooldown, EnergyPool, StatusTimers } from '../game/weapons/timers';

describe('EntityRegistry', () => {
  const item = (id: number, kind = 'prop', fixture = false) => ({ id, kind, fixture });

  it('registers and removes', () => {
    const r = new EntityRegistry();
    r.add(item(r.allocId()));
    r.add(item(r.allocId()));
    expect(r.size).toBe(2);
    expect(r.remove(1)?.id).toBe(1);
    expect(r.get(1)).toBeUndefined();
    expect(r.remove(1)).toBeUndefined();
    expect(r.size).toBe(1);
  });

  it('rejects duplicate ids, and reuses a requested id only when free', () => {
    const r = new EntityRegistry();
    r.add(item(5));
    expect(() => r.add(item(5))).toThrow();
    expect(r.allocId(5)).not.toBe(5);
    expect(r.allocId(50)).toBe(50);
    expect(r.allocId()).toBeGreaterThan(50);
  });

  it('enforces limits per kind, ignoring fixtures', () => {
    const r = new EntityRegistry();
    r.limits = { total: 3, npcs: 1, vehicles: 1 };
    r.add(item(1, 'npc'));
    expect(r.check('npc')).toBe('npcs');
    expect(r.check('prop')).toBeNull();
    r.add(item(2, 'prop', true));
    expect(r.budgetUsed).toBe(1);
    r.add(item(3));
    r.add(item(4));
    expect(r.check('prop')).toBe('total');
    r.remove(3);
    expect(r.check('prop')).toBeNull();
  });
});

describe('FixedStepper', () => {
  it('runs whole steps and keeps the remainder', () => {
    const s = new FixedStepper();
    expect(s.advance(FIXED_DT * 2.5)).toBe(2);
    expect(s.alpha).toBeCloseTo(0.5, 5);
  });

  it('caps a lag spike instead of spiralling', () => {
    const s = new FixedStepper();
    expect(s.advance(5)).toBeLessThanOrEqual(5);
    expect(s.droppedTime).toBeGreaterThan(4);
    expect(s.advance(0)).toBe(0);
  });
});

describe('Cooldown and EnergyPool', () => {
  it('blocks until the cooldown has elapsed', () => {
    const c = new Cooldown(0.5);
    expect(c.trigger()).toBe(true);
    expect(c.trigger()).toBe(false);
    c.tick(0.49);
    expect(c.ready).toBe(false);
    c.tick(0.02);
    expect(c.trigger()).toBe(true);
  });

  it('overheats when emptied and recovers at the threshold', () => {
    const e = new EnergyPool(100, 10, 0.35);
    expect(e.spend(100)).toBe(true);
    expect(e.overheated).toBe(true);
    expect(e.spend(1)).toBe(false);
    e.tick(3);
    expect(e.overheated).toBe(true);
    e.tick(0.6);
    expect(e.overheated).toBe(false);
    expect(e.spend(1)).toBe(true);
  });
});

describe('StatusTimers', () => {
  it('restores exactly once on expiry', () => {
    const restored: number[] = [];
    const t = new StatusTimers<string>((id) => restored.push(id));
    t.add(1, 2, () => 'a');
    t.tick(1.9);
    expect(restored).toEqual([]);
    t.tick(0.2);
    expect(restored).toEqual([1]);
    t.tick(5);
    expect(restored).toEqual([1]);
  });

  it('extends instead of stacking, and forget skips the restore', () => {
    const restored: number[] = [];
    const t = new StatusTimers<null>((id) => restored.push(id));
    expect(t.add(1, 1, () => null)).toBe(true);
    expect(t.add(1, 3, () => null)).toBe(false);
    t.tick(2);
    expect(restored).toEqual([]);
    t.forget(1);
    t.tick(5);
    expect(restored).toEqual([]);
    expect(t.size).toBe(0);
  });
});

describe('NpcBrain', () => {
  const see: Perception = { hasTarget: true, targetVisible: true, targetDist: 10, threatDist: Infinity, noise: false, hurt: false, stunned: false, health: 50, arrived: false };
  const calm: Perception = { ...see, hasTarget: false, targetVisible: false, targetDist: Infinity };

  it('hostile robot: idle -> chase -> attack -> chase, then gives up when the target is gone', () => {
    const b = new NpcBrain(NPC_PROFILES.robot!);
    expect(b.update(0.1, { ...see, targetDist: 40 })).toBe('chase');
    expect(b.update(0.1, see)).toBe('attack');
    expect(b.update(0.1, { ...see, targetDist: 100 })).toBe('chase');
    expect(b.update(0.1, calm)).toBe('idle');
  });

  it('chase becomes investigate once memory of the target runs out', () => {
    const b = new NpcBrain(NPC_PROFILES.robot!);
    b.update(0.1, { ...see, targetDist: 40 });
    const hidden = { ...see, targetVisible: false };
    expect(b.update(1, hidden)).toBe('chase');
    expect(b.update(NPC_PROFILES.robot!.memory, hidden)).toBe('investigate');
  });

  it('friendly and passive NPCs never fight, even when they can see a target', () => {
    for (const id of ['technician', 'creature']) {
      const b = new NpcBrain(NPC_PROFILES[id]!);
      expect(b.update(0.1, see)).toBe('idle');
      expect(b.update(IDLE_TIME + 0.1, see)).toBe('patrol');
    }
  });

  it('flees when hurt, and skittish creatures flee from nearby movement', () => {
    const t = new NpcBrain(NPC_PROFILES.technician!);
    expect(t.update(0.1, { ...calm, hurt: true })).toBe('flee');
    const c = new NpcBrain(NPC_PROFILES.creature!);
    expect(c.update(0.1, { ...calm, threatDist: 1 })).toBe('flee');
  });

  it('stun pre-empts everything and recovers; death is terminal', () => {
    const b = new NpcBrain(NPC_PROFILES.robot!);
    b.update(0.1, see);
    expect(b.update(0.1, { ...see, stunned: true })).toBe('stunned');
    expect(b.update(0.1, see)).toBe('idle');
    expect(b.update(0.1, { ...see, health: 0 })).toBe('dead');
    expect(b.update(0.1, see)).toBe('dead');
  });
});

describe('NavGrid', () => {
  const open = () => {
    const g = new NavGrid(0, 0, 10, 10, 1);
    g.walk.fill(1);
    return g;
  };

  it('routes around a wall', () => {
    const g = open();
    for (let r = 0; r < 9; r++) g.walk[g.idx(5, r)] = 0;
    const path = g.findPath({ x: 1.5, z: 1.5 }, { x: 8.5, z: 1.5 })!;
    expect(path).not.toBeNull();
    expect(Math.max(...path.map((p) => p.z))).toBeGreaterThan(8.9);
  });

  it('refuses unreachable goals and big height steps', () => {
    const g = open();
    for (let r = 0; r < 10; r++) g.walk[g.idx(5, r)] = 0;
    expect(g.findPath({ x: 1.5, z: 1.5 }, { x: 8.5, z: 1.5 })).toBeNull();
    const h = open();
    for (let r = 0; r < 10; r++) for (let c = 5; c < 10; c++) h.heights[h.idx(c, r)] = 3;
    expect(h.findPath({ x: 1.5, z: 1.5 }, { x: 8.5, z: 1.5 })).toBeNull();
  });
});

describe('SignalGraph', () => {
  const graph = () => {
    const g = new SignalGraph();
    g.addNode({ id: 1, hasIn: false, hasOut: true });
    g.addNode({ id: 2, hasIn: true, hasOut: true });
    g.addNode({ id: 3, hasIn: true, hasOut: true });
    g.addNode({ id: 4, hasIn: true, hasOut: false });
    return g;
  };

  it('enforces port types', () => {
    const g = graph();
    expect(g.connect(4, 2)).toBe('noOutput');
    expect(g.connect(2, 1)).toBe('noInput');
    expect(g.connect(1, 1)).toBe('self');
    expect(g.connect(1, 99)).toBe('missing');
    expect(g.connect(1, 2)).toBeNull();
    expect(g.connect(1, 2)).toBe('duplicate');
  });

  it('rejects loops, direct and indirect', () => {
    const g = graph();
    expect(g.connect(2, 3)).toBeNull();
    expect(g.connect(3, 2)).toBe('cycle');
    expect(g.connect(1, 2)).toBeNull();
  });

  it('settles a chain in one pass, visiting each node once', () => {
    const g = graph();
    g.connect(1, 2);
    g.connect(2, 3);
    g.connect(3, 4);
    const delivered = new Map<number, boolean>();
    let visits = 0;
    g.evaluate((id, input) => { visits++; return id === 1 ? true : input; }, (id, level) => delivered.set(id, level));
    expect(delivered.get(4)).toBe(true);
    expect(visits).toBe(4);
  });

  it('drops wires with their node', () => {
    const g = graph();
    g.connect(1, 2);
    g.connect(2, 4);
    expect(g.removeNode(2)).toHaveLength(2);
    expect(g.allWires).toHaveLength(0);
  });
});

describe('validateLink', () => {
  const dyn = (id: number) => ({ id, dynamic: true });
  const fix = (id: number) => ({ id, dynamic: false });

  it('validates link ends', () => {
    expect(validateLink('weld', dyn(1), dyn(2), false, [])).toBeNull();
    expect(validateLink('weld', dyn(1), null, true, [])).toBeNull();
    expect(validateLink('weld', dyn(1), dyn(1), false, [])).toBe('self');
    expect(validateLink('weld', dyn(1), null, false, [])).toBe('missing');
    expect(validateLink('weld', fix(1), fix(2), false, [])).toBe('bothStatic');
    expect(validateLink('glue', dyn(1), dyn(2), false, [])).toBe('badType');
  });

  it('spots duplicates in either direction, and the limit', () => {
    const existing = [{ a: 2, b: 1, type: 'weld' }];
    expect(validateLink('weld', dyn(1), dyn(2), false, existing)).toBe('duplicate');
    expect(validateLink('rope', dyn(1), dyn(2), false, existing)).toBeNull();
    expect(validateLink('rope', dyn(1), dyn(2), false, existing, 1)).toBe('limit');
  });
});

describe('placement', () => {
  const crate = catalog.require('crate_wood');
  const up = { x: 0, y: 1, z: 0 };

  it('rests a box on the surface it was aimed at', () => {
    const pose = computePlacement({ def: crate, scale: 1, hit: { point: { x: 2, y: 3, z: 4 }, normal: up }, fallbackPoint: { x: 0, y: 0, z: 0 }, yawDeg: 0, pitchDeg: 0, grid: 0, angleStep: 0, alignToSurface: false });
    expect(pose.position.y).toBeCloseTo(3.512, 3);
    expect(pose.position.x).toBe(2);
  });

  it('accounts for rotation when offsetting from a surface', () => {
    const q = Math.SQRT1_2;
    const beam = catalog.require('beam_wood');
    expect(supportDistance(beam.shape, 1, { x: 0, y: 0, z: q, w: q }, up)).toBeCloseTo(1.5, 4);
    expect(supportDistance(beam.shape, 1, { x: 0, y: 0, z: 0, w: 1 }, up)).toBeCloseTo(0.12, 4);
    expect(supportDistance(beam.shape, 2, { x: 0, y: 0, z: 0, w: 1 }, up)).toBeCloseTo(0.24, 4);
  });

  it('never grid-snaps along the surface normal', () => {
    expect(snapPosition({ x: 1.3, y: 2.3, z: 3.3 }, 0.5, up)).toEqual({ x: 1.5, y: 2.3, z: 3.5 });
    expect(snapPosition({ x: 1.3, y: 2.3, z: 3.3 }, 0, up)).toEqual({ x: 1.3, y: 2.3, z: 3.3 });
  });

  it('snaps angles', () => {
    expect(snapAngle(50, 45)).toBe(45);
    expect(snapAngle(50, 0)).toBe(50);
  });
});

describe('UndoStack', () => {
  it('undoes and redoes in order, and new work clears redo', () => {
    const log: string[] = [];
    const cmd = (n: string) => ({ label: n, undo: () => log.push(`-${n}`), redo: () => log.push(`+${n}`) });
    const s = new UndoStack();
    s.push(cmd('a'));
    s.push(cmd('b'));
    s.undo();
    s.undo();
    expect(s.undo()).toBeNull();
    s.redo();
    expect(log).toEqual(['-b', '-a', '+a']);
    s.push(cmd('c'));
    expect(s.canRedo).toBe(false);
  });

  it('is bounded', () => {
    const s = new UndoStack(2);
    for (const n of ['a', 'b', 'c']) s.push({ label: n, undo() {}, redo() {} });
    expect(s.undo()?.label).toBe('c');
    expect(s.undo()?.label).toBe('b');
    expect(s.undo()).toBeNull();
  });
});

describe('settings', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('persists through storage', () => {
    const store = memory();
    saveSettings({ ...DEFAULT_SETTINGS, fov: 95, language: 'ru' }, store);
    const loaded = loadSettings(store);
    expect(loaded.fov).toBe(95);
    expect(loaded.language).toBe('ru');
  });

  it('survives corrupt storage and bad values', () => {
    const store = memory();
    store.setItem('chaoslab.settings.v1', '{not json');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ fov: 9000, sensitivity: 'fast', quality: 'ultra', invertY: 1, masterVolume: NaN });
    expect(s.fov).toBe(110);
    expect(s.sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.invertY).toBe(false);
    expect(s.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
  });
});
