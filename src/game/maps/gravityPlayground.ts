import type { MapBuilder, MapDef } from './MapBuilder';

function island(b: MapBuilder, x: number, y: number, z: number, w: number, d: number, material = 'platform_candy'): void {
  b.floor(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y, 1.2, material, { tile: 2 });
  b.box(x, y - 1.6, z, w * 0.7, 0.8, d * 0.7, 'steel_dark', { tile: 2, collide: false });
  b.box(x, y - 2.3, z, w * 0.35, 0.8, d * 0.35, 'wall_teal', { tile: 2, collide: false });
}

function pad(b: MapBuilder, x: number, y: number, z: number, speed: number): void {
  b.box(x, y + 0.08, z, 2.4, 0.16, 2.4, 'platform_mint', { tile: 1 });
  b.box(x, y + 0.17, z, 1.4, 0.02, 1.4, 'glow_teal', { collide: false, cast: false });
  b.zones.push({ type: 'pad', min: { x: x - 1.2, y, z: z - 1.2 }, max: { x: x + 1.2, y: y + 0.7, z: z + 1.2 }, speed });
}

/** Map C. Floating islands in the sky, linked by jump pads, lifts and low gravity. */
export const GRAVITY_PLAYGROUND: MapDef = {
  id: 'gravity_playground',
  name: { en: 'Gravity Playground', ru: 'Гравитационная площадка' },
  desc: { en: 'Floating platforms, jump pads, low-gravity zones and bounce surfaces.', ru: 'Парящие платформы, прыжковые площадки, зоны низкой гравитации и упругие поверхности.' },
  sky: { top: 0x2b1f6b, horizon: 0xe87ab0, bottom: 0x2a4a8a },
  fog: { color: 0x9a6aa8, density: 0.0035 },
  ambience: 'sky',
  sun: { dir: { x: -0.4, y: 0.8, z: 0.45 }, color: 0xffe8d0, intensity: 3 },
  hemi: { sky: 0xd8c8ff, ground: 0x5a4a90, intensity: 1.2 },
  envPanels: 4,
  killY: -32,
  nav: null,
  build(b) {
    b.spawn = { x: 0, y: 0, z: 22 };
    b.spawnYaw = 0;
    island(b, 0, 0, 22, 18, 14);
    b.sign(0, 3.6, 15.2, 6, 1.6, 0, 'pg_arrow', ['JUMP PAD AHEAD', 'MIND THE GAP'], '#2b1f6b', '#ffe8d0', '#ff4fa3');
    for (const x of [-3, 3]) b.column(x, 15.15, 0, 4.4, 0.08, 'steel');
    pad(b, 0, 0, 17, 15);

    // Central hub, across a gap.
    island(b, 0, 2, -4, 26, 22);
    b.ramp(-9, 2.75, 2, 5, 1.5, 7, 0, 'platform_mint');
    b.floor(-11.5, -6.5, -9, -1.5, 3.5, 0.5, 'platform_mint', { tile: 2 });
    // Bounce surface.
    b.box(8, 2.1, -4, 5, 0.2, 5, 'bounce', { tag: 'bounce', tile: 2, surface: 'gel' });
    // Low-gravity column over the hub.
    b.zones.push({ type: 'lowg', min: { x: -5, y: 2, z: -12 }, max: { x: 5, y: 40, z: -3 }, gravity: 0.2 });
    b.box(0, 2.02, -7.5, 10, 0.04, 9, 'glow_violet', { collide: false, cast: false });
    for (const [x, z] of [[-5, -12], [5, -12], [-5, -3], [5, -3]] as const) b.column(x, z, 2, 12, 0.12, 'steel');

    // East: lift to a high island.
    b.prop('moving_platform', 17, 2.0, -4, { fixture: true, params: { travel: 7, speed: 2 } });
    island(b, 26, 9, -4, 12, 14, 'platform_mint');
    b.prop('barrel_explosive', 23, 9.56, -8);
    b.prop('barrel_explosive', 24.2, 9.56, -8);
    b.prop('ball_metal', 28, 9.51, 0);

    // West: a sideways shuttle across the void.
    b.prop('moving_platform', -19, 1.9, -4, { fixture: true, params: { travel: 6.5, speed: 2, axis: 'x' } });
    // The shuttle starts at -19 and travels +x, back to the hub's edge: the far island is to the west.
    island(b, -28, 2, -4, 14, 16);
    pad(b, -28, 2, -4, 18);

    // North: stepping stones to the summit.
    // Each stone is too high to jump to, so each carries a pad aimed by the player's air control.
    island(b, 0, 4, -24, 7, 7, 'platform_mint');
    island(b, -10, 6.5, -32, 6, 6);
    island(b, 3, 9, -40, 6, 6, 'platform_mint');
    island(b, 15, 11.5, -32, 6, 6);
    island(b, 8, 18, -56, 20, 16);
    pad(b, 0, 4, -24, 15);
    pad(b, -10, 6.5, -32, 15);
    pad(b, 3, 9, -40, 15);
    pad(b, 15, 11.5, -32, 20);
    b.prop('crate_wood', 6, 18.51, -56);
    b.prop('crate_wood', 7.1, 18.51, -56);
    b.prop('cube_bouncy', 12, 18.41, -52);

    // Toys on the hub.
    for (let i = 0; i < 4; i++) b.prop('cube_bouncy', -4 + i * 2.2, 2.41, 4);
    b.prop('ball_rubber', -3, 2.43, 1);
    b.prop('ball_rubber', 3, 2.43, 1);
    for (let i = 0; i < 6; i++) b.prop('crate_small', 10 + (i % 3) * 0.62, 2.31 + Math.floor(i / 3) * 0.62, 2);
    b.prop('fx_smoke', -10, 3.61, -5, { fixture: true });
  },
};
