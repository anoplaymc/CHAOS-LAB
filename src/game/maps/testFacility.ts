import type { MapDef } from './MapBuilder';

const CHAMBER_H = 11;

/** Map A. Spawn room to the south, one large chamber with work areas in its corners. */
export const TEST_FACILITY: MapDef = {
  id: 'test_facility',
  name: { en: 'Test Facility', ru: 'Испытательный комплекс' },
  desc: { en: 'A physics laboratory with a spawn room, main chamber and test zones.', ru: 'Физическая лаборатория: комната спавна, главный зал и испытательные зоны.' },
  sky: { top: 0x18262e, horizon: 0x33474f, bottom: 0x0b1114 },
  fog: { color: 0x1b2a30, density: 0.009 },
  ambience: 'indoor',
  sun: { dir: { x: 0.35, y: 1, z: 0.25 }, color: 0xfff1dc, intensity: 1.5 },
  hemi: { sky: 0xbcd6de, ground: 0x6c7674, intensity: 1.0 },
  envPanels: 6,
  killY: -30,
  nav: { minX: -22, maxX: 22, minZ: -20, maxZ: 34, topY: 3.9, bottomY: -2 },
  build(b) {
    b.spawn = { x: 0, y: 0, z: 29 };
    b.spawnYaw = 0;

    // ── Main chamber shell. Ceiling doesn't cast, so the key light reads as coming through skylights.
    b.floor(-22, 22, -20, 20, 0, 1, 'floor_tile', { tile: 4 });
    b.box(0, CHAMBER_H + 0.25, 0, 46, 0.5, 42, 'concrete_dark', { cast: false, tile: 4 });
    const wall = (x: number, z: number, w: number, d: number) => b.box(x, CHAMBER_H / 2, z, w, CHAMBER_H, d, 'wall_dark', { tile: 4 });
    wall(-22.5, 0, 1, 42); // west
    wall(22.5, 0, 1, 42); // east
    wall(0, -20.5, 46, 1); // north
    wall(-14.75, 20.5, 15.5, 1); // south-west, leaves the doorway to the spawn room
    wall(14.75, 20.5, 15.5, 1); // south-east
    b.box(0, (CHAMBER_H + 4) / 2, 20.5, 14, CHAMBER_H - 4, 1, 'wall_dark', { tile: 4 });
    // Either side of the door frame. No floor runs under the wall here, so a gap would be a pit into the void.
    for (const x of [-5.25, 5.25]) b.box(x, 2, 20.5, 3.5, 4, 1, 'wall_dark', { tile: 4 });

    // Pale wainscot band, teal stripe and skirting give the walls scale.
    for (const [x, z, w, d] of [[-21.95, 0, 0.1, 40], [21.95, 0, 0.1, 40], [0, -19.95, 44, 0.1]] as const) {
      b.box(x, 1.5, z, w, 3, d, 'wall_light', { collide: false, tile: 2 });
      b.box(x, 3.1, z, w + 0.04, 0.18, d + 0.04, 'paint_teal', { collide: false });
      b.box(x, 0.12, z, w + 0.06, 0.24, d + 0.06, 'blackened', { collide: false });
    }
    for (const x of [-12.5, 12.5]) {
      b.box(x, 1.5, 19.95, 18, 3, 0.1, 'wall_light', { collide: false, tile: 2 });
      b.box(x, 3.1, 19.93, 18, 0.18, 0.14, 'paint_teal', { collide: false });
    }

    // Structural columns and roof trusses.
    for (const x of [-21, -7, 7, 21]) {
      b.box(x, CHAMBER_H / 2, -19.3, 0.9, CHAMBER_H, 0.9, 'steel_dark', { tile: 2 });
      b.box(x, 10.3, 0, 0.4, 0.7, 40, 'steel_dark', { collide: false, cast: false, tile: 2 });
    }
    for (const z of [-14, -5, 5, 14]) {
      b.box(-21.4, CHAMBER_H / 2, z, 0.6, CHAMBER_H, 0.9, 'steel_dark', { tile: 2 });
      b.box(21.4, CHAMBER_H / 2, z, 0.6, CHAMBER_H, 0.9, 'steel_dark', { tile: 2 });
    }

    // Ceiling lights over the work areas.
    for (const [x, z] of [[-12, -10], [12, -10], [-12, 10], [12, 10], [0, 0]] as const) b.light(x, 9.9, z, { w: 5, d: 1 });
    for (const [x, z] of [[0, -14], [0, 13], [-18, 0], [18, 0]] as const) b.box(x, 9.9, z, 3, 0.1, 0.8, 'glow_white', { collide: false, cast: false, tile: 8 });

    // Pipes along the upper walls.
    b.pipe(-21.4, 8.2, 0, 40, 'z', 0.22, 'steel');
    b.pipe(-21.4, 7.5, 0, 40, 'z', 0.13, 'paint_coral');
    b.pipe(21.4, 8.2, 0, 40, 'z', 0.22, 'steel');
    b.pipe(21.4, 7.5, 0, 40, 'z', 0.13, 'paint_amber');
    b.pipe(0, 8.6, -19.5, 42, 'x', 0.26, 'paint_teal');
    for (const x of [-16, -3, 10]) b.pipe(x, 5, -19.5, 7, 'y', 0.11, 'steel_dark');

    // ── Doorway to the spawn room
    // 2 cm proud of the spawn room walls, whose ends would otherwise share this inner face and z-fight.
    b.box(-3.24, 2.2, 20.5, 0.52, 4.4, 1.3, 'hazard', { tile: 1 });
    b.box(3.24, 2.2, 20.5, 0.52, 4.4, 1.3, 'hazard', { tile: 1 });
    b.box(0, 4.15, 20.5, 7, 0.5, 1.3, 'hazard', { tile: 1, collide: false });
    b.sign(0, 5.4, 19.98, 5, 1.1, Math.PI, 'main_chamber', ['MAIN CHAMBER'], '#10181c', '#ffb000');

    // ── Spawn room
    b.floor(-7, 7, 21, 35, 0, 1, 'floor_dark', { tile: 2 });
    b.box(0, 5.25, 28, 15, 0.5, 15, 'concrete', { cast: false, tile: 4 });
    b.box(-7.5, 2.5, 28, 1, 5, 15, 'wall_light', { tile: 2 });
    b.box(7.5, 2.5, 28, 1, 5, 15, 'wall_light', { tile: 2 });
    b.box(0, 2.5, 35.5, 15, 5, 1, 'wall_light', { tile: 2 });
    b.box(-5.25, 2.5, 21.2, 4.5, 5, 0.4, 'wall_light', { tile: 2 });
    b.box(5.25, 2.5, 21.2, 4.5, 5, 0.4, 'wall_light', { tile: 2 });
    b.floor(-3, 3, 20, 21, 0.0, 1, 'floor_dark', { tile: 2 });
    b.box(-6.98, 4.6, 28, 0.06, 0.5, 14, 'paint_teal', { collide: false });
    b.box(6.98, 4.6, 28, 0.06, 0.5, 14, 'paint_teal', { collide: false });
    b.light(0, 4.85, 28, { w: 4, d: 1, intensity: 26, range: 16 });
    b.sign(0, 2.9, 34.98, 6, 1.8, Math.PI, 'welcome', ['CHAOS LAB', 'RESULTS NOT GUARANTEED'], '#10181c', '#e8e6dc', '#ffb000');
    b.sign(-6.98, 2.3, 26, 3.4, 2.2, Math.PI / 2, 'help1', ['G  SPAWN MENU', 'LMB  GRAB', 'RMB  THROW'], '#14565c', '#e8e6dc');
    b.sign(6.98, 2.3, 26, 3.4, 2.2, -Math.PI / 2, 'help2', ['1-8  TOOLS', 'F  FLIGHT', 'E  INTERACT'], '#14565c', '#e8e6dc');
    b.prop('crate_small', -4.5, 0.32, 31);
    b.prop('crate_small', -3.8, 0.32, 32);
    b.prop('crate_small', -4.2, 0.95, 31.5);
    b.prop('deco_plant', 5.8, 0.47, 33.8);
    b.prop('deco_terminal', 4, 0.61, 33.9, { yaw: Math.PI, fixture: true });

    // ── East gantry: raised deck reached by a long ramp
    b.floor(12, 22, -20, -6, 3, 0.4, 'floor_dark', { tile: 2 });
    for (const [x, z] of [[12.3, -6.3], [12.3, -13], [12.3, -19.7]] as const) b.box(x, 1.4, z, 0.4, 2.8, 0.4, 'steel_dark', { tile: 1 });
    b.ramp(16, 1.5, -1, 4, 3, 10, Math.PI, 'floor_tile');
    b.box(12.05, 3.55, -13, 0.1, 1.1, 14, 'hazard', { tile: 1 });
    b.box(13, 3.55, -6.05, 2, 1.1, 0.1, 'hazard', { tile: 1 });
    b.box(20, 3.55, -6.05, 4, 1.1, 0.1, 'hazard', { tile: 1 });
    b.prop('barrel_explosive', 14, 3.56, -9);
    b.prop('barrel_explosive', 15, 3.56, -9.4);
    b.prop('ball_metal', 16, 3.51, -7.5);
    b.prop('crate_metal', 19, 3.51, -15);
    b.prop('crate_metal', 20.2, 3.51, -15);
    b.prop('crate_metal', 19.6, 4.52, -15);
    b.sign(21.85, 5.6, -13, 5, 1.2, -Math.PI / 2, 'gantry', ['GANTRY 02'], '#10181c', '#ffb000');

    // ── West mezzanine: stairs up to a balcony
    b.floor(-22, -12, -20, -9, 2.5, 0.4, 'floor_dark', { tile: 2 });
    b.stairs(-21, -18, -4, 0, 10, 0.25, 0.5, 'concrete', -1);
    b.box(-11.95, 3.05, -14.5, 0.1, 1.1, 11, 'hazard', { tile: 1 });
    for (const z of [-9.3, -19.7]) b.box(-12.3, 1.15, z, 0.4, 2.3, 0.4, 'steel_dark', { tile: 1 });
    b.prop('deco_shelf', -18, 3.51, -19.3);
    b.prop('deco_bench', -14.5, 2.96, -19);
    b.prop('crate_wood', -15, 3.01, -12);
    b.prop('crate_wood', -15, 4.02, -12);

    // ── Construction area, south-west
    b.floor(-20, -6, 4, 18, 0.02, 0.04, 'floor_build', { tile: 2, collide: false });
    b.box(-13, 0.03, 3.9, 14, 0.06, 0.2, 'hazard', { collide: false, tile: 1 });
    b.box(-13, 0.03, 18.1, 14, 0.06, 0.2, 'hazard', { collide: false, tile: 1 });
    b.box(-5.9, 0.03, 11, 0.2, 0.06, 14, 'hazard', { collide: false, tile: 1 });
    b.box(-20.1, 0.03, 11, 0.2, 0.06, 14, 'hazard', { collide: false, tile: 1 });
    b.sign(-21.85, 5, 11, 7, 1.4, Math.PI / 2, 'build_area', ['CONSTRUCTION'], '#10181c', '#19e0c4');
    b.prop('beam_wood', -8, 0.13, 6);
    b.prop('beam_wood', -8, 0.38, 6.05);
    b.prop('floor_panel', -17, 0.07, 6);
    b.prop('floor_panel', -17, 0.2, 6);
    b.prop('deco_bench', -19, 0.46, 16, { yaw: Math.PI / 2 });

    // A working example machine: a load on the plate spins the turntable and opens the door behind it.
    b.prop('pressure_plate', -9, 0.06, 15.5, { fixture: true, name: 'demo_plate' });
    b.prop('motor', -13, 0.21, 15.5, { fixture: true, name: 'demo_motor' });
    b.prop('lamp', -10.6, 0.21, 17.2, { fixture: true, name: 'demo_lamp' });
    b.prop('door_powered', -16.4, 1.41, 15.5, { fixture: true, name: 'demo_door', yaw: Math.PI / 2 });
    b.wire('demo_plate', 'demo_motor');
    b.wire('demo_plate', 'demo_door');
    b.wire('demo_plate', 'demo_lamp');
    b.prop('crate_metal', -9, 0.61, 12.2);
    b.sign(-13, 3.2, 19.92, 7, 1.2, Math.PI, 'demo_sign', ['PUT A CRATE ON THE PLATE'], '#10181c', '#19e0c4');
    b.prop('cone', -11.5, 2.5, 15.5);

    // ── NPC test zone, south-east, behind low barriers and a window
    b.floor(6, 20, 6, 18, 0.015, 0.03, 'concrete_dark', { tile: 2, collide: false });
    b.box(13, 0.6, 5.8, 14, 1.2, 0.3, 'concrete', { tile: 2 });
    b.box(6, 0.6, 14.5, 0.3, 1.2, 7, 'concrete', { tile: 2 });
    b.box(13, 1.25, 5.8, 14, 0.08, 0.34, 'hazard', { tile: 1, collide: false });
    b.box(6, 1.25, 14.5, 0.34, 0.08, 7, 'hazard', { tile: 1, collide: false });
    b.sign(21.85, 5, 12, 7, 1.4, -Math.PI / 2, 'npc_zone', ['NPC TEST ZONE'], '#10181c', '#ff6a50');
    b.box(11, 0.4, 13, 2, 0.8, 1, 'concrete', { tile: 2 });
    b.box(16, 0.4, 9, 1, 0.8, 2, 'concrete', { tile: 2 });
    b.patrols.push([{ x: 8, y: 0, z: 8 }, { x: 18, y: 0, z: 8 }, { x: 18, y: 0, z: 16 }, { x: 8, y: 0, z: 16 }]);
    b.patrols.push([{ x: -2, y: 0, z: -14 }, { x: 8, y: 0, z: -14 }, { x: 8, y: 0, z: -3 }, { x: -6, y: 0, z: -3 }]);

    // ── Centre: impact arena
    b.floor(-5, 5, -9, 1, 0.012, 0.024, 'floor_dark', { tile: 2, collide: false });
    for (const [x, z] of [[-5, -4], [5, -4]] as const) b.box(x, 0.02, z, 0.12, 0.04, 10, 'hazard', { collide: false, tile: 1 });
    for (const z of [-9, 1]) b.box(0, 0.02, z, 10.12, 0.04, 0.12, 'hazard', { collide: false, tile: 1 });
    // A crate pyramid begging to be knocked over.
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i <= 2 - row; i++) {
        b.prop('crate_wood', -2 + i * 1.04 + row * 0.52, 0.51 + row * 1.01, -5);
      }
    }
    b.prop('barrel', 3, 0.56, -2);
    b.prop('barrel', 3.9, 0.56, -2.3);
    b.prop('cube_bouncy', -3.5, 0.41, -0.5);
    b.prop('ball_rubber', 0.5, 0.43, -0.5);
    b.prop('block_ice', 3.5, 0.46, -7);
    // Domino line leading off the arena.
    for (let i = 0; i < 9; i++) b.prop('domino', -4 + i * 0.75, 0.56, 3.5, { yaw: Math.PI / 2 });
    // Glass panes to smash, propped up in timber frames.
    b.prop('glass_panel', -9, 0.81, -9, { yaw: 0.3 });
    b.prop('glass_panel', -9, 0.81, -5.5, { yaw: 0.3 });
    b.box(-9.2, 0.15, -7.2, 0.5, 0.3, 6, 'wood', { tile: 2 });

    // ── Storage along the north wall
    for (const [x, z] of [[-6, -18.6], [-4.7, -18.6], [-5.3, -17.3]] as const) b.prop('crate_wood', x, 0.51, z);
    b.prop('crate_small', -5.3, 1.32, -18);
    b.prop('barrel', 2, 0.56, -18.8);
    b.prop('barrel', 3, 0.56, -18.8);
    b.prop('barrel', 2.5, 0.56, -17.9);
    b.prop('pallet', 6, 0.09, -18);
    b.prop('deco_terminal', 9, 0.61, -19.1, { fixture: true });
    b.prop('deco_terminal', 10.2, 0.61, -19.1, { fixture: true });
    b.sign(0, 6.3, -19.93, 8, 1.8, 0, 'chamber_sign', ['TEST CHAMBER 01'], '#10181c', '#e8e6dc', '#ffb000');
    // Machinery block for silhouette.
    b.box(-15, 1.5, -1, 4, 3, 3, 'wall_teal', { tile: 2 });
    b.box(-15, 3.3, -1, 3, 0.6, 2, 'steel_dark', { tile: 2 });
    b.pipe(-15, 6.5, -1, 6, 'y', 0.35, 'steel');
    b.box(-12.97, 1.9, -1, 0.05, 1.2, 1.8, 'screen', { collide: false, cast: false });
  },
};
