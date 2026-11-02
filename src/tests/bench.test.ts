import { it } from 'vitest';
import { headlessGame } from './helpers';

/** Stress measurement, only when asked for: BENCH=1 npx vitest run src/tests/bench.test.ts */
it.runIf(process.env.BENCH)('physics cost at rising entity counts', async () => {
  const game = await headlessGame();
  for (const [count, kind] of [[100, 'crate_wood'], [200, 'crate_wood'], [400, 'crate_wood'], [800, 'crate_wood'], [1500, 'crate_wood'], [20, 'npc_robot'], [32, 'npc_robot']] as [number, string][]) {
    game.startSession({ map: 'test_facility', mode: 'sandbox' });
    for (const e of [...game.entities.active]) if (!e.fixture) game.entities.remove(e);
    game.rules.damage = false;
    game.entities.registry.limits = { total: 5000, npcs: 100, vehicles: 6 };
    // The worst case: an awake, messy pile, all falling into the same spot and colliding at once.
    const id = kind === 'crate_wood' ? 'crate_metal' : kind;
    const side = Math.ceil(Math.cbrt(count));
    for (let i = 0; i < count; i++) {
      const x = (i % side) * 1.25 - side * 0.6 + Math.random() * 0.2;
      const z = (Math.floor(i / side) % side) * 1.25 - side * 0.6 + Math.random() * 0.2;
      const y = 1 + Math.floor(i / (side * side)) * 1.4;
      const r = game.entities.spawn(id, { position: { x: x * 0.5 + 8, y, z: z * 0.5 - 8 + 2 }, linvel: { x: Math.random() - 0.5, y: 0, z: Math.random() - 0.5 } });
      if (!r.ok) throw new Error('spawn');
    }
    const measure = (seconds: number) => {
      let worst = 0;
      const start = performance.now();
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        game.frame(1 / 60);
        worst = Math.max(worst, performance.now() - t);
      }
      return { avg: (performance.now() - start) / n, worst };
    };
    const active = measure(4);
    game.advance(6);
    const settled = measure(1);
    console.log(`BENCH ${kind} x${count}: settling avg ${active.avg.toFixed(2)}ms worst ${active.worst.toFixed(1)}ms | settled avg ${settled.avg.toFixed(2)}ms`);
  }
}, 600000);
