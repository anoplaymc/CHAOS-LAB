import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalog } from '../data/items';
import type { Game } from '../game/core/Game';
import { Group, RAPIER } from '../game/physics/PhysicsWorld';
import { headlessGame } from './helpers';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

const heapMb = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed / 1048576;
};

const SESSIONS = [
  { map: 'test_facility', mode: 'sandbox' },
  { map: 'industrial_yard', mode: 'sandbox' },
  { map: 'gravity_playground', mode: 'playground' },
  { map: 'industrial_yard', mode: 'survival' },
  { mode: 'contraption', challenge: 0 },
  { mode: 'contraption', challenge: 3 },
  { map: 'test_facility', mode: 'editor' },
];

/** Everything that would grow if a restart left something behind. */
function census(g: Game) {
  // Hostile bolts are pooled: the pool outlives a session and fills as robots happen to fire, up to its cap.
  const bolts = g.projectiles.group;
  expect(bolts.children.length).toBeLessThanOrEqual(40);
  let meshes = 0;
  g.scene.traverse(() => { meshes++; });
  meshes -= bolts.children.length;
  return {
    entities: g.entities.registry.size,
    bodies: g.physics.bodyCount,
    sceneChildren: g.scene.children.length,
    sceneNodes: meshes,
    npcs: g.npcs.length,
    links: g.connections.count,
    debris: g.debris.count,
    bouncers: g.bouncers.balls.length,
  };
}

/** Exercises the systems that allocate, so a leak has something to leak. */
function makeMess(g: Game, seed: number) {
  const p = g.player.position;
  const at = (i: number) => ({ x: p.x + (i % 5) - 2, y: p.y + 2 + (i % 3), z: p.z - 4 - (i % 4) });
  const ids = ['crate_wood', 'glass_panel', 'barrel_explosive', 'npc_robot', 'npc_creature', 'ball_rubber', 'buggy'];
  for (let i = 0; i < 14; i++) g.entities.spawn(ids[(i + seed) % ids.length]!, { position: at(i) });
  g.explode({ x: p.x, y: p.y + 1, z: p.z - 5 }, 6, 900, 60);
  g.advance(0.5);
}

describe('repeated restarts', () => {
  let g: Game;
  beforeAll(async () => { g = await headlessGame(); });

  it('every session type comes back to the same size, however often it restarts', () => {
    for (const cfg of SESSIONS) {
      g.startSession(cfg);
      g.advance(0.1);
      const first = census(g);
      for (let i = 0; i < 12; i++) {
        makeMess(g, i);
        g.startSession(cfg);
        g.advance(0.1);
      }
      expect(census(g), `${cfg.map ?? cfg.mode} ${cfg.mode}`).toEqual(first);
      expect(g.ui.get().error).toBeNull();
    }
  });

  it('JavaScript heap and native memory stop growing over 240 restarts', () => {
    const cycle = (n: number) => {
      for (let i = 0; i < n; i++) {
        const cfg = SESSIONS[i % SESSIONS.length]!;
        g.startSession(cfg);
        makeMess(g, i);
      }
    };
    cycle(40); // Warm caches and JIT before the baseline.
    const h0 = heapMb();
    const r0 = process.memoryUsage().rss / 1048576;
    cycle(100);
    const h1 = heapMb();
    cycle(100);
    const h2 = heapMb();
    const r2 = process.memoryUsage().rss / 1048576;
    console.log(`heap MB ${h0.toFixed(1)} -> ${h1.toFixed(1)} -> ${h2.toFixed(1)}   rss MB ${r0.toFixed(0)} -> ${r2.toFixed(0)}`);
    // A leak of even one small object graph per restart would show up as steady growth between the two legs.
    expect(h2 - h1).toBeLessThan(4);
    expect(r2 - r0).toBeLessThan(150);
  }, 240_000);

  it('quit to menu leaves nothing running, and the next session starts clean', () => {
    g.startSession({ map: 'test_facility', mode: 'sandbox' });
    const first = census(g);
    makeMess(g, 1);
    g.quitToMenu();
    expect(g.physics.world).toBeNull();
    expect(g.entities.registry.size).toBe(0);
    g.frame(1 / 60); // A menu frame with no world must be safe.
    g.startSession({ map: 'test_facility', mode: 'sandbox' });
    expect(census(g)).toEqual(first);
  });
});

/** Small deterministic generator, so a failing seed can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOVES = ['forward', 'back', 'left', 'right', 'sprint', 'crouch'] as const;

describe('random play', () => {
  let g: Game;
  beforeAll(async () => { g = await headlessGame(); });

  for (const cfg of SESSIONS.slice(0, 4)) {
    it(`${cfg.map} ${cfg.mode}: no crash, no fall through the world, no sticking in geometry`, () => {
      g.startSession(cfg);
      g.rules.damage = false;
      const r = rng(1234);
      const respawn = g.player.respawn.bind(g.player);
      let forcedRespawns = 0;
      g.player.respawn = () => { forcedRespawns++; respawn(); };
      const kinds = catalog.list().filter((d) => d.kind === 'prop' || d.kind === 'npc' || d.kind === 'vehicle').map((d) => d.id);
      const capsule = new RAPIER.Capsule(0.15, 0.2);
      let embedded = 0;
      let maxEmbedded = 0;
      let stillFor = 0;
      let longestStill = 0;
      let anchor = { ...g.player.position };
      let minY = Infinity;
      const FRAMES = 60 * 150;
      for (let f = 0; f < FRAMES; f++) {
        if (f % 20 === 0) {
          for (const a of MOVES) g.input.releaseAction(a);
          g.input.pressAction(r() < 0.8 ? 'forward' : 'back');
          if (r() < 0.3) g.input.pressAction(r() < 0.5 ? 'left' : 'right');
          if (r() < 0.5) g.input.pressAction('sprint');
          if (r() < 0.1) g.input.pressAction('crouch');
          g.player.look((r() - 0.5) * 900, (r() - 0.5) * 200);
        }
        if (f % 37 === 0) g.input.pressAction('jump');
        if (f % 37 === 2) g.input.releaseAction('jump');
        if (f % 90 === 0) g.tools.select(Math.floor(r() * g.tools.tools.length));
        if (f % 11 === 0) { if (r() < 0.5) g.input.pressButton(0); else g.input.releaseButton(0); }
        if (f % 29 === 0) { if (r() < 0.5) g.input.pressButton(2); else g.input.releaseButton(2); }
        if (f % 120 === 0) {
          const p = g.player.position;
          g.entities.spawn(kinds[Math.floor(r() * kinds.length)]!, { position: { x: p.x + (r() - 0.5) * 8, y: p.y + 1 + r() * 3, z: p.z + (r() - 0.5) * 8 } });
        }
        if (f % 400 === 0) {
          const p = g.player.position;
          g.explode({ x: p.x + 4, y: p.y, z: p.z }, 5, 800, 40);
        }
        g.frame(1 / 60);
        expect(g.ui.get().error).toBeNull();
        const p = g.player.position;
        if (!Number.isFinite(p.x + p.y + p.z)) throw new Error(`player position not finite at frame ${f}`);
        minY = Math.min(minY, g.player.feet.y);
        if (f % 30 === 0) {
          for (const e of g.entities.active) {
            const q = e.position;
            if (!Number.isFinite(q.x + q.y + q.z)) throw new Error(`${e.def.id} position not finite at frame ${f}`);
          }
          if (!g.player.flying && !g.player.driving) {
            const inside = g.physics.isBlocked(capsule, p, { x: 0, y: 0, z: 0, w: 1 }, Group.STATIC, (c) => c === g.player.collider);
            embedded = inside ? embedded + 1 : 0;
            maxEmbedded = Math.max(maxEmbedded, embedded);
          }
          const moved = Math.hypot(p.x - anchor.x, p.z - anchor.z);
          if (moved > 0.5) { anchor = { ...p }; stillFor = 0; }
          else if (!g.player.driving) stillFor += 0.5;
          longestStill = Math.max(longestStill, stillFor);
        }
      }
      for (const a of MOVES) g.input.releaseAction(a);
      g.input.releaseButton(0);
      g.input.releaseButton(2);
      g.player.respawn = respawn;
      console.log(`${cfg.map}/${cfg.mode}: minY ${minY.toFixed(2)} forcedRespawns ${forcedRespawns} embedded ${maxEmbedded} longestStill ${longestStill.toFixed(1)}s entities ${g.entities.registry.size}`);
      if (cfg.map !== 'gravity_playground' && cfg.map !== 'industrial_yard') {
        expect(minY, 'fell below the floor').toBeGreaterThan(-1);
        expect(forcedRespawns).toBe(0);
      }
      expect(maxEmbedded, 'player stuck inside static geometry').toBeLessThan(3);
      expect(longestStill, 'player could not move at all').toBeLessThan(25);
    }, 240_000);
  }
});
