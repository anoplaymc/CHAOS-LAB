import type { MapDef } from './MapBuilder';

const H = 14;

/** Bare hall for Contraption Challenge. Each challenge adds its own puzzle through the mode's map hook. */
export const PROVING_GROUND: MapDef = {
  id: 'proving_ground',
  name: { en: 'Proving Ground', ru: 'Полигон' },
  desc: { en: 'An empty hall where the Contraption Challenges are set up.', ru: 'Пустой зал для инженерных испытаний.' },
  sky: { top: 0x18262e, horizon: 0x33474f, bottom: 0x0b1114 },
  fog: { color: 0x1b2a30, density: 0.006 },
  ambience: 'indoor',
  sun: { dir: { x: 0.3, y: 1, z: 0.2 }, color: 0xfff1dc, intensity: 1.6 },
  hemi: { sky: 0xd4e2e6, ground: 0x8a9290, intensity: 1.5 },
  envPanels: 6,
  killY: -14,
  nav: null,
  build(b) {
    b.box(0, H + 0.25, 0, 62, 0.5, 62, 'concrete_dark', { cast: false, tile: 4 });
    for (const [x, z, w, d] of [[-30.5, 0, 1, 62], [30.5, 0, 1, 62], [0, -30.5, 62, 1], [0, 30.5, 62, 1]] as const) {
      b.box(x, H / 2, z, w, H, d, 'wall_dark', { tile: 4 });
      const inX = Math.sign(x) * -0.56;
      const inZ = Math.sign(z) * -0.56;
      const bw = d > w ? 0.1 : 60;
      const bd = d > w ? 60 : 0.1;
      b.box(x + inX, 2, z + inZ, bw, 4, bd, 'wall_light', { collide: false, tile: 2 });
      b.box(x + inX * 1.04, 4.1, z + inZ * 1.04, bw, 0.2, bd, 'paint_teal', { collide: false });
    }
    for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14], [0, 0]] as const) b.light(x, H - 1, z, { w: 6, d: 1.2, intensity: 110, range: 34 });
  },
};
