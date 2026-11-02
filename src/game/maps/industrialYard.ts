import type { MapBuilder, MapDef } from './MapBuilder';

function container(b: MapBuilder, x: number, y: number, z: number, yaw: number, material: string): void {
  b.box(x, y + 1.3, z, 2.6, 2.6, 6.1, material, { yaw, tile: 2.6 });
}

function warehouse(b: MapBuilder, cx: number, cz: number, w: number, d: number, h: number, material: string, label: string): void {
  const hw = w / 2;
  const hd = d / 2;
  const door = 8;
  const side = (hw * 2 - door) / 2;
  b.box(cx - hw, h / 2, cz, 0.5, h, d, material, { tile: 3 });
  b.box(cx + hw, h / 2, cz, 0.5, h, d, material, { tile: 3 });
  b.box(cx, h / 2, cz - hd, w, h, 0.5, material, { tile: 3 });
  b.box(cx - hw + side / 2, h / 2, cz + hd, side, h, 0.5, material, { tile: 3 });
  b.box(cx + hw - side / 2, h / 2, cz + hd, side, h, 0.5, material, { tile: 3 });
  b.box(cx, (h + 5) / 2, cz + hd, door, h - 5, 0.5, material, { tile: 3 });
  b.box(cx, 5 - 0.2, cz + hd + 0.01, door + 0.6, 0.4, 0.55, 'hazard', { tile: 1, collide: false });
  b.box(cx, h + 0.25, cz, w + 1.2, 0.5, d + 1.2, 'corrugated', { cast: true, tile: 3 });
  b.floor(cx - hw, cx + hw, cz - hd, cz + hd, 0.03, 0.03, 'concrete', { tile: 4, collide: false });
  b.sign(cx, 6.2, cz + hd + 0.28, 7, 1.4, 0, `wh_${label}`, [label], '#10181c', '#ffb000');
  b.light(cx - hw / 2, h - 0.4, cz, { w: 4, d: 1, intensity: 30, range: 18 });
  b.light(cx + hw / 2, h - 0.4, cz, { w: 4, d: 1, intensity: 30, range: 18 });
}

function cratePile(b: MapBuilder, x: number, z: number): void {
  for (let i = 0; i < 3; i++) b.prop('crate_wood', x + i * 1.03, 0.51, z);
  for (let i = 0; i < 2; i++) b.prop('crate_wood', x + 0.5 + i * 1.03, 1.52, z);
  b.prop('crate_small', x + 1, 2.33, z);
}

/** Map B. Open yard: warehouses north, container rows and ramps for vehicles in the middle. */
export const INDUSTRIAL_YARD: MapDef = {
  id: 'industrial_yard',
  name: { en: 'Industrial Yard', ru: 'Промзона' },
  desc: { en: 'Outdoor yard with warehouses, container stacks and room for vehicles.', ru: 'Открытая площадка со складами, штабелями контейнеров и местом для транспорта.' },
  sky: { top: 0x3a6ea5, horizon: 0xd8c8a8, bottom: 0x6a665c },
  fog: { color: 0xc8c4b4, density: 0.0065 },
  ambience: 'outdoor',
  sun: { dir: { x: 0.55, y: 0.75, z: 0.35 }, color: 0xfff0d0, intensity: 3.2 },
  hemi: { sky: 0xbfd8f0, ground: 0x7a7468, intensity: 1.1 },
  envPanels: 3,
  killY: -30,
  nav: { minX: -62, maxX: 62, minZ: -62, maxZ: 62, topY: 3.4, bottomY: -2 },
  build(b) {
    b.spawn = { x: 0, y: 0, z: 50 };
    b.spawnYaw = 0;
    b.floor(-65, 65, -65, 65, 0, 1, 'asphalt', { tile: 6, surface: 'concrete' });

    // Perimeter wall with a hazard band.
    for (const [x, z, w, d] of [[0, -63, 126, 1], [0, 63, 126, 1], [-63, 0, 1, 126], [63, 0, 1, 126]] as const) {
      b.box(x, 2.5, z, w, 5, d, 'concrete', { tile: 3, surface: 'concrete' });
      b.box(x, 5.1, z, w + 0.1, 0.25, d + 0.1, 'hazard', { tile: 1, collide: false });
    }
    // Painted lanes.
    for (let z = -50; z <= 50; z += 10) b.box(0, 0.012, z, 0.3, 0.02, 5, 'paint_amber', { collide: false, cast: false });
    b.box(-6, 0.012, 0, 0.18, 0.02, 110, 'paint_white', { collide: false, cast: false });
    b.box(6, 0.012, 0, 0.18, 0.02, 110, 'paint_white', { collide: false, cast: false });

    warehouse(b, -36, -38, 34, 26, 9, 'corrugated_teal', 'HALL A');
    warehouse(b, 34, -40, 30, 22, 9, 'corrugated', 'HALL B');

    // Container rows.
    const mats = ['container_red', 'container_blue', 'container_amber'];
    for (let i = 0; i < 7; i++) {
      const z = -14 + i * 7;
      container(b, -24, 0, z, Math.PI / 2, mats[i % 3]!);
      if (i % 2 === 0) container(b, -24, 2.6, z, Math.PI / 2, mats[(i + 1) % 3]!);
      if (i === 2) container(b, -24, 5.2, z, Math.PI / 2, mats[2]!);
    }
    for (let i = 0; i < 5; i++) {
      const z = 6 + i * 7;
      container(b, 30, 0, z, Math.PI / 2, mats[(i + 1) % 3]!);
      if (i % 2 === 1) container(b, 30, 2.6, z, Math.PI / 2, mats[i % 3]!);
    }

    // Vehicle ramps and a jump.
    b.ramp(14, 1, 12, 8, 2, 8, Math.PI, 'floor_dark');
    b.floor(10, 18, 2, 8, 2, 2, 'concrete', { tile: 2, surface: 'concrete' });
    b.ramp(14, 1, -2, 8, 2, 8, 0, 'floor_dark');
    b.ramp(-8, 0.75, -24, 6, 1.5, 7, 0, 'floor_dark');

    // Loading dock with stairs.
    b.floor(44, 60, 6, 26, 1.5, 1.5, 'concrete', { tile: 3, surface: 'concrete' });
    b.stairs(46, 50, 31.5, 0, 6, 0.25, 0.9, 'concrete', -1);
    b.box(44, 2.3, 16, 0.2, 1.6, 20, 'hazard', { tile: 1 });

    // Open building area.
    b.floor(-18, 2, 20, 42, 0.02, 0.03, 'floor_build', { tile: 2, collide: false });
    b.sign(-8, 0.03, 31, 0.1, 0.1, 0, 'yard_blank', [''], '#000', '#000');

    // Floodlight masts.
    for (const [x, z] of [[-50, 40], [50, 45], [-4, -8], [50, -14], [-50, 2]] as const) {
      b.column(x, z, 0, 11, 0.2, 'steel_dark');
      b.box(x, 11.2, z, 2.4, 0.4, 0.5, 'steel_dark', { collide: false });
      b.box(x, 11, z, 2.2, 0.08, 0.4, 'glow_white', { collide: false, cast: false });
    }

    // Props.
    cratePile(b, 10, 30);
    cratePile(b, -40, -36);
    cratePile(b, 30, -44);
    for (let i = 0; i < 4; i++) b.prop('barrel', 22 + i * 0.85, 0.56, 42);
    for (let i = 0; i < 3; i++) b.prop('barrel_explosive', -10 + i * 1.3, 0.56, 8);
    for (let i = 0; i < 6; i++) b.prop('cone', -3 + i * 1.2, 0.36, 44);
    for (let i = 0; i < 3; i++) b.prop('tire', 18 + i * 1.3, 0.17, 18);
    b.prop('pallet', 50, 1.59, 18);
    b.prop('crate_metal', 52, 2.02, 12);
    b.prop('crate_metal', 53.1, 2.02, 12);
    b.prop('buggy', 6, 0.9, 44, { yaw: Math.PI / 2 });
    b.prop('buggy', -36, 0.9, -32);
    b.prop('npc_technician', 2, 1, 38);
    b.prop('npc_guard', -10, 1, 15);
    b.prop('npc_guard', 22, 1, -20);

    b.patrols.push([{ x: -14, y: 0, z: 18 }, { x: -14, y: 0, z: -18 }, { x: 18, y: 0, z: -18 }, { x: 18, y: 0, z: 30 }]);
    b.patrols.push([{ x: 22, y: 0, z: -24 }, { x: -6, y: 0, z: -24 }, { x: -40, y: 0, z: -18 }, { x: -50, y: 0, z: 30 }, { x: -14, y: 0, z: 50 }]);
    b.patrols.push([{ x: 34, y: 0, z: -44 }, { x: 34, y: 0, z: -22 }, { x: 44, y: 0, z: 0 }]);
  },
};
