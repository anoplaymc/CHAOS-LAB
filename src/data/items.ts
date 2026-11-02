import type { ModelPart, ScriptHooks, VehicleSpec } from '../game/content/types';
import type { Loc } from './materials';

export type ShapeDef =
  | { type: 'box'; size: [number, number, number] }
  | { type: 'sphere'; r: number }
  | { type: 'cylinder'; r: number; h: number }
  | { type: 'capsule'; r: number; h: number }
  | { type: 'wedge'; size: [number, number, number] }
  | { type: 'convex'; points: number[] };

export type Category =
  | 'props' | 'physics' | 'construction' | 'mechanical' | 'vehicles'
  | 'npcs' | 'weapons' | 'tools' | 'effects' | 'decorations';

export const CATEGORIES: Category[] = ['props', 'physics', 'construction', 'mechanical', 'vehicles', 'npcs', 'weapons', 'tools', 'effects', 'decorations'];

export interface ItemDef {
  id: string;
  category: Category;
  name: Loc;
  desc: Loc;
  kind: 'prop' | 'npc' | 'vehicle' | 'tool' | 'effect';
  shape: ShapeDef;
  /** Key in the procedural prop library. Unknown keys fall back to a mesh made from the shape. */
  visual: string;
  material: string;
  color?: number;
  body: 'dynamic' | 'fixed' | 'kinematic';
  /** Velocity change (m/s) in one impact below which the object takes no damage. Omit for unbreakable props. */
  breakSpeed?: number;
  health?: number;
  debris?: { count: number; kind: 'wood' | 'glass' | 'metal' | 'stone' | 'ice' };
  disintegrable?: boolean;
  behavior?: string;
  params?: Record<string, number | string | boolean>;
  signal?: { in?: boolean; out?: boolean };
  /** Shown in the Construction tool's part list. */
  buildPart?: boolean;
  toolId?: string;
  source?: string;
  /** A model made from primitives, drawn on top of `visual` if that names a built-in model. */
  model?: ModelPart[];
  /** Tuning for kind 'vehicle'. Defaults to the buggy. */
  vehicle?: VehicleSpec;
  /** Callbacks for scripted items. */
  script?: ScriptHooks;
  /** Callback for kind 'effect' instead of the default blast. */
  use?: (position: { x: number; y: number; z: number }) => void;
}

const L = (en: string, ru: string): Loc => ({ en, ru });
const box = (x: number, y: number, z: number): ShapeDef => ({ type: 'box', size: [x, y, z] });

type P = Partial<ItemDef> & Pick<ItemDef, 'id' | 'name' | 'desc' | 'shape' | 'visual' | 'material'>;
const prop = (category: Category, p: P): ItemDef => ({ category, kind: 'prop', body: 'dynamic', ...p });
const tool = (category: Category, id: string, toolId: string, name: Loc, desc: Loc): ItemDef => ({
  id, category, kind: 'tool', toolId, name, desc, shape: box(0.5, 0.3, 0.8), visual: 'tool:' + toolId, material: 'metal', body: 'fixed',
});

export const CORE_ITEMS: ItemDef[] = [
  // ───────── Props
  prop('props', { id: 'crate_wood', name: L('Wooden Crate', 'Деревянный ящик'), desc: L('The lab classic. Splinters on hard impacts.', 'Классика лаборатории. Разлетается при сильном ударе.'), shape: box(1, 1, 1), visual: 'crate', material: 'wood', breakSpeed: 9, health: 60, debris: { count: 7, kind: 'wood' }, disintegrable: true }),
  prop('props', { id: 'crate_small', name: L('Small Crate', 'Малый ящик'), desc: L('Light, stackable, easy to throw.', 'Лёгкий, штабелируется, легко бросать.'), shape: box(0.6, 0.6, 0.6), visual: 'crate', material: 'wood', breakSpeed: 8, health: 30, debris: { count: 5, kind: 'wood' }, disintegrable: true }),
  prop('props', { id: 'crate_metal', name: L('Steel Crate', 'Стальной ящик'), desc: L('Heavy and practically indestructible.', 'Тяжёлый и почти неразрушимый.'), shape: box(1, 1, 1), visual: 'crate_metal', material: 'metal', disintegrable: true }),
  prop('props', { id: 'barrel', name: L('Drum', 'Бочка'), desc: L('Rolls away the moment you look at it.', 'Укатывается, стоит только взглянуть.'), shape: { type: 'cylinder', r: 0.38, h: 1.1 }, visual: 'barrel', material: 'metal', color: 0x2a7f8c, disintegrable: true }),
  prop('props', { id: 'barrel_explosive', name: L('Volatile Drum', 'Взрывоопасная бочка'), desc: L('Explodes when damaged. Chains into neighbours.', 'Взрывается при повреждении. Вызывает цепную реакцию.'), shape: { type: 'cylinder', r: 0.38, h: 1.1 }, visual: 'barrel_explosive', material: 'metal', color: 0xe8432f, breakSpeed: 12, health: 35, behavior: 'explosive', params: { radius: 6, impulse: 900, damage: 70 }, disintegrable: true }),
  prop('props', { id: 'cone', name: L('Traffic Cone', 'Дорожный конус'), desc: L('Mandatory safety equipment.', 'Обязательное средство безопасности.'), shape: { type: 'convex', points: coneHull(0.24, 0.7) }, visual: 'cone', material: 'rubber', color: 0xff6a1a }),
  prop('props', { id: 'pallet', name: L('Pallet', 'Поддон'), desc: L('Flat, light, oddly satisfying to stack.', 'Плоский, лёгкий, приятно складывать.'), shape: box(1.2, 0.16, 1.0), visual: 'pallet', material: 'wood', breakSpeed: 9, health: 25, debris: { count: 4, kind: 'wood' }, disintegrable: true }),
  prop('props', { id: 'tire', name: L('Tyre', 'Покрышка'), desc: L('Bounces with unsettling enthusiasm.', 'Подпрыгивает с пугающим энтузиазмом.'), shape: { type: 'cylinder', r: 0.5, h: 0.32 }, visual: 'tire', material: 'rubber' }),

  // ───────── Physics objects
  prop('physics', { id: 'cube_bouncy', name: L('Gel Cube', 'Гелевый куб'), desc: L('Keeps almost all energy after each bounce.', 'Почти не теряет энергию при отскоке.'), shape: box(0.8, 0.8, 0.8), visual: 'gel_cube', material: 'gel', color: 0xff4fa3 }),
  prop('physics', { id: 'block_heavy', name: L('Heavy Block', 'Тяжёлый блок'), desc: L('Over 1400 kg. Too heavy for the manipulator: shove it with the Impulse Cannon.', 'Больше 1400 кг. Манипулятору не поднять: толкайте импульсной пушкой.'), shape: box(1, 1, 1), visual: 'heavy_block', material: 'heavy' }),
  prop('physics', { id: 'block_ice', name: L('Ice Block', 'Ледяной блок'), desc: L('Almost no friction. Slides until something stops it.', 'Почти без трения. Скользит, пока не упрётся.'), shape: box(0.9, 0.9, 0.9), visual: 'ice_block', material: 'ice', breakSpeed: 8, health: 40, debris: { count: 6, kind: 'ice' }, disintegrable: true }),
  prop('physics', { id: 'ball_rubber', name: L('Rubber Ball', 'Резиновый мяч'), desc: L('Grippy and very bouncy.', 'Цепкий и прыгучий.'), shape: { type: 'sphere', r: 0.42 }, visual: 'ball', material: 'rubber', color: 0xffb000 }),
  prop('physics', { id: 'ball_metal', name: L('Wrecking Sphere', 'Стальной шар'), desc: L('Dense steel sphere. Great for knocking things down.', 'Плотный стальной шар. Отлично всё сносит.'), shape: { type: 'sphere', r: 0.5 }, visual: 'ball_metal', material: 'metal', disintegrable: true }),
  prop('physics', { id: 'concrete_block', name: L('Concrete Block', 'Бетонный блок'), desc: L('High friction, no bounce, stays where it lands.', 'Большое трение, без отскока, остаётся на месте.'), shape: box(1.2, 0.6, 0.6), visual: 'concrete_block', material: 'concrete', breakSpeed: 14, health: 90, debris: { count: 6, kind: 'stone' }, disintegrable: true }),
  prop('physics', { id: 'glass_panel', name: L('Glass Pane', 'Стеклянная панель'), desc: L('Shatters on a firm knock.', 'Разбивается от хорошего удара.'), shape: box(1.6, 1.6, 0.08), visual: 'glass_panel', material: 'glass', breakSpeed: 3, health: 10, debris: { count: 10, kind: 'glass' }, disintegrable: true }),
  prop('physics', { id: 'domino', name: L('Domino Slab', 'Плита-домино'), desc: L('Tall and thin. Line them up.', 'Высокая и тонкая. Выстройте ряд.'), shape: box(0.5, 1.1, 0.14), visual: 'domino', material: 'wood', disintegrable: true }),

  // ───────── Construction
  prop('construction', { id: 'beam_wood', buildPart: true, name: L('Timber Beam', 'Деревянная балка'), desc: L('Light 3m beam.', 'Лёгкая балка 3 м.'), shape: box(3, 0.24, 0.24), visual: 'beam_wood', material: 'wood', breakSpeed: 12, health: 80, debris: { count: 4, kind: 'wood' }, disintegrable: true }),
  prop('construction', { id: 'beam_metal', buildPart: true, name: L('Steel Girder', 'Стальная балка'), desc: L('Strong 3m girder.', 'Прочная балка 3 м.'), shape: box(3, 0.24, 0.24), visual: 'beam_metal', material: 'metal', disintegrable: true }),
  prop('construction', { id: 'floor_panel', buildPart: true, name: L('Floor Panel', 'Панель пола'), desc: L('2×2m deck plate.', 'Настил 2×2 м.'), shape: box(2, 0.12, 2), visual: 'floor_panel', material: 'metal', disintegrable: true }),
  prop('construction', { id: 'wall_panel', buildPart: true, name: L('Wall Panel', 'Стеновая панель'), desc: L('2×2.5m wall section.', 'Секция стены 2×2,5 м.'), shape: box(2, 2.5, 0.14), visual: 'wall_panel', material: 'concrete', disintegrable: true }),
  prop('construction', { id: 'ramp', buildPart: true, name: L('Ramp', 'Рампа'), desc: L('2×1×3m wedge. Launch things.', 'Клин 2×1×3 м. Запускайте вещи.'), shape: { type: 'wedge', size: [2, 1, 3] }, visual: 'ramp', material: 'metal', disintegrable: true }),
  prop('construction', { id: 'platform', buildPart: true, name: L('Platform', 'Платформа'), desc: L('Thick 3×3m slab.', 'Толстая плита 3×3 м.'), shape: box(3, 0.3, 3), visual: 'platform', material: 'metal', disintegrable: true }),
  prop('construction', { id: 'pillar', buildPart: true, name: L('Pillar', 'Колонна'), desc: L('3m round support.', 'Круглая опора 3 м.'), shape: { type: 'cylinder', r: 0.22, h: 3 }, visual: 'pillar', material: 'concrete', disintegrable: true }),
  prop('construction', { id: 'door_hinged', buildPart: true, name: L('Door Leaf', 'Дверное полотно'), desc: L('Connect with a Hinge link and it swings.', 'Соедините шарниром, и дверь будет открываться.'), shape: box(1.1, 2.2, 0.1), visual: 'door_leaf', material: 'wood', breakSpeed: 11, health: 60, debris: { count: 5, kind: 'wood' }, disintegrable: true }),
  prop('construction', { id: 'window', buildPart: true, name: L('Window Frame', 'Оконная рама'), desc: L('Framed glass. Shatters into shards.', 'Стекло в раме. Разлетается на осколки.'), shape: box(2, 1.5, 0.12), visual: 'window', material: 'glass', breakSpeed: 4, health: 15, debris: { count: 10, kind: 'glass' }, disintegrable: true }),
  prop('construction', { id: 'pipe', buildPart: true, name: L('Pipe Section', 'Секция трубы'), desc: L('2.5m steel pipe.', 'Стальная труба 2,5 м.'), shape: { type: 'cylinder', r: 0.14, h: 2.5 }, visual: 'pipe', material: 'metal', disintegrable: true }),

  // ───────── Mechanical
  prop('mechanical', { id: 'button', buildPart: true, name: L('Button', 'Кнопка'), desc: L('Press E. Sends a one-second pulse.', 'Нажмите E. Подаёт импульс на секунду.'), shape: box(0.6, 0.2, 0.6), visual: 'button', material: 'metal', body: 'fixed', behavior: 'button', signal: { out: true } }),
  prop('mechanical', { id: 'lever', buildPart: true, name: L('Lever', 'Рычаг'), desc: L('Press E to toggle on and off.', 'Нажмите E, чтобы переключить.'), shape: box(0.5, 0.6, 0.5), visual: 'lever', material: 'metal', body: 'fixed', behavior: 'lever', signal: { out: true } }),
  prop('mechanical', { id: 'pressure_plate', buildPart: true, name: L('Pressure Plate', 'Нажимная плита'), desc: L('Outputs power while anything stands on it.', 'Подаёт сигнал, пока на ней что-то стоит.'), shape: box(1.6, 0.1, 1.6), visual: 'plate', material: 'metal', body: 'fixed', behavior: 'plate', signal: { out: true } }),
  prop('mechanical', { id: 'timer', buildPart: true, name: L('Timed Trigger', 'Таймер'), desc: L('Pulses every 3 seconds. Wire an input to enable it.', 'Импульс каждые 3 секунды. Можно включать по проводу.'), shape: box(0.5, 0.5, 0.5), visual: 'timer', material: 'metal', body: 'fixed', behavior: 'timer', params: { period: 3, duty: 1 }, signal: { in: true, out: true } }),
  prop('mechanical', { id: 'inverter', buildPart: true, name: L('Inverter', 'Инвертор'), desc: L('Output is on while its input is off.', 'Выход включён, пока вход выключен.'), shape: box(0.4, 0.3, 0.4), visual: 'inverter', material: 'metal', body: 'fixed', behavior: 'inverter', signal: { in: true, out: true } }),
  prop('mechanical', { id: 'motor', buildPart: true, name: L('Motor Hub', 'Мотор'), desc: L('Spins its rotor while powered. Weld parts to the rotor.', 'Вращает ротор под напряжением. Приварите к ротору детали.'), shape: box(0.8, 0.4, 0.8), visual: 'motor', material: 'metal', body: 'fixed', behavior: 'motor', params: { speed: 2.5, torque: 8000 }, signal: { in: true } }),
  prop('mechanical', { id: 'fan', buildPart: true, name: L('Fan', 'Вентилятор'), desc: L('Blows objects along its axis while powered.', 'Сдувает предметы вдоль своей оси.'), shape: box(1.4, 0.3, 1.4), visual: 'fan', material: 'metal', body: 'fixed', behavior: 'fan', params: { force: 26, range: 8 }, signal: { in: true } }),
  prop('mechanical', { id: 'spring_pad', buildPart: true, name: L('Spring Pad', 'Пружинная платформа'), desc: L('Launches whatever lands on it. Wire to fire on signal only.', 'Подбрасывает всё, что на неё попало. Может срабатывать по сигналу.'), shape: box(1.4, 0.3, 1.4), visual: 'spring_pad', material: 'metal', body: 'fixed', behavior: 'spring_pad', params: { speed: 13 }, signal: { in: true } }),
  prop('mechanical', { id: 'door_powered', buildPart: true, name: L('Sliding Door', 'Раздвижная дверь'), desc: L('Opens with power, or with E if nothing is wired.', 'Открывается по сигналу или по E, если нет провода.'), shape: box(2.4, 2.8, 0.3), visual: 'door_powered', material: 'metal', body: 'kinematic', behavior: 'door', signal: { in: true } }),
  prop('mechanical', { id: 'moving_platform', buildPart: true, name: L('Lift Platform', 'Подъёмник'), desc: L('Rises 3m and returns. Wire it to run only with power.', 'Поднимается на 3 м и опускается. Можно управлять сигналом.'), shape: box(2.4, 0.25, 2.4), visual: 'lift', material: 'metal', body: 'kinematic', behavior: 'lift', params: { travel: 3, speed: 1.4 }, signal: { in: true } }),
  prop('mechanical', { id: 'lamp', buildPart: true, name: L('Signal Lamp', 'Сигнальная лампа'), desc: L('Lights up with power. Good for debugging.', 'Светится под напряжением. Удобно для отладки.'), shape: box(0.4, 0.4, 0.4), visual: 'lamp', material: 'metal', body: 'fixed', behavior: 'lamp', signal: { in: true } }),

  // ───────── Vehicles
  { id: 'buggy', category: 'vehicles', kind: 'vehicle', name: L('Lab Buggy', 'Лабораторный багги'), desc: L('Raycast-suspension buggy. E to enter, R to reset.', 'Багги на лучевой подвеске. E — сесть, R — перевернуть.'), shape: box(1.5, 0.5, 2.6), visual: 'buggy', material: 'metal', body: 'dynamic', behavior: 'vehicle' },

  // ───────── NPCs
  { id: 'npc_technician', category: 'npcs', kind: 'npc', name: L('Technician', 'Техник'), desc: L('Friendly. Wanders the lab and flees danger. Press E to talk.', 'Дружелюбный. Гуляет по лаборатории, убегает от опасности. E — поговорить.'), shape: { type: 'capsule', r: 0.32, h: 1.8 }, visual: 'npc_technician', material: 'rubber', body: 'dynamic', behavior: 'npc', params: { archetype: 'technician' } },
  { id: 'npc_creature', category: 'npcs', kind: 'npc', name: L('Glorp', 'Глорп'), desc: L('Passive lab critter. Hops about and scatters from fast movement.', 'Мирное лабораторное существо. Прыгает и разбегается от быстрых движений.'), shape: { type: 'capsule', r: 0.32, h: 0.8 }, visual: 'npc_creature', material: 'rubber', body: 'dynamic', behavior: 'npc', params: { archetype: 'creature' } },
  { id: 'npc_guard', category: 'npcs', kind: 'npc', name: L('Patrol Guard', 'Патрульный'), desc: L('Patrols waypoints, investigates noise, fights rogue bots. Shoots if provoked.', 'Патрулирует, проверяет шум, сражается с роботами. Отвечает на атаку.'), shape: { type: 'capsule', r: 0.34, h: 1.85 }, visual: 'npc_guard', material: 'rubber', body: 'dynamic', behavior: 'npc', params: { archetype: 'guard' } },
  { id: 'npc_robot', category: 'npcs', kind: 'npc', name: L('Rogue Robot', 'Робот-бунтарь'), desc: L('Hunts you, shoots energy bolts, loses you when sight is broken.', 'Охотится на вас, стреляет зарядами, теряет след без прямой видимости.'), shape: { type: 'capsule', r: 0.36, h: 1.7 }, visual: 'npc_robot', material: 'metal', body: 'dynamic', behavior: 'npc', params: { archetype: 'robot' } },
  { id: 'npc_heavy', category: 'npcs', kind: 'npc', name: L('Heavy Training Bot', 'Тяжёлый учебный бот'), desc: L('Slow, armoured, and slams the ground with a physical shockwave.', 'Медленный, бронированный, бьёт по земле ударной волной.'), shape: { type: 'capsule', r: 0.72, h: 2.6 }, visual: 'npc_heavy', material: 'heavy', body: 'dynamic', behavior: 'npc', params: { archetype: 'heavy' } },

  // ───────── Tools and weapons: selecting them equips the hotbar slot
  tool('tools', 'tool_manipulator', 'manipulator', L('Physics Manipulator', 'Физический манипулятор'), L('Grab, carry, rotate, pin and throw objects.', 'Хватать, носить, вращать, закреплять и бросать предметы.')),
  tool('tools', 'tool_spawner', 'spawner', L('Object Spawner', 'Спавнер объектов'), L('Places the selected item with a preview.', 'Ставит выбранный предмет с предпросмотром.')),
  tool('tools', 'tool_construction', 'construction', L('Construction Tool', 'Строительный инструмент'), L('Place, move, rotate, scale, copy, link and wire parts.', 'Ставить, двигать, вращать, масштабировать, копировать, соединять детали.')),
  tool('tools', 'tool_remover', 'remover', L('Removal Tool', 'Удаление'), L('Removes objects. Undoable.', 'Удаляет объекты. Можно отменить.')),
  tool('tools', 'tool_inspector', 'inspector', L('Inspection Tool', 'Инспектор'), L('Shows physical properties and swaps materials.', 'Показывает физические свойства и меняет материал.')),
  tool('tools', 'tool_paint', 'paint', L('Paint Tool', 'Краска'), L('Recolours any object.', 'Перекрашивает любой объект.')),
  tool('weapons', 'wpn_blaster', 'blaster', L('Energy Blaster', 'Энергобластер'), L('Fast hitscan bolts. Overheats.', 'Быстрые мгновенные выстрелы. Перегревается.')),
  tool('weapons', 'wpn_impulse', 'impulse', L('Impulse Cannon', 'Импульсная пушка'), L('Hold to charge a cone-shaped physics shockwave.', 'Зажмите, чтобы зарядить конусную ударную волну.')),
  tool('weapons', 'wpn_freeze', 'freeze', L('Freeze Ray', 'Замораживающий луч'), L('Locks a target in place for several seconds.', 'Обездвиживает цель на несколько секунд.')),
  tool('weapons', 'wpn_bouncer', 'bouncer', L('Bouncer', 'Прыгун'), L('Fires physical balls that ricochet. Alt-fire pops them.', 'Стреляет прыгучими шарами. Альт. огонь их взрывает.')),
  tool('weapons', 'wpn_disintegrator', 'disintegrator', L('Disintegrator', 'Дезинтегратор'), L('Hold on a designated prop to dissolve it.', 'Удерживайте на подходящем предмете, чтобы растворить его.')),
  tool('weapons', 'wpn_gravity', 'gravity', L('Gravity Tool', 'Гравитатор'), L('Flips a target’s gravity. Alt-fire drops a gravity well.', 'Переворачивает гравитацию цели. Альт. огонь создаёт гравитационный колодец.')),

  // ───────── Effects
  prop('effects', { id: 'fx_smoke', name: L('Smoke Emitter', 'Дымогенератор'), desc: L('A small plume of grey smoke.', 'Небольшой столб дыма.'), shape: box(0.4, 0.2, 0.4), visual: 'emitter', material: 'metal', body: 'fixed', behavior: 'emitter', params: { kind: 'smoke' } }),
  prop('effects', { id: 'fx_sparks', name: L('Spark Emitter', 'Генератор искр'), desc: L('Intermittent bursts of sparks.', 'Периодические снопы искр.'), shape: box(0.4, 0.2, 0.4), visual: 'emitter', material: 'metal', color: 0xffb000, body: 'fixed', behavior: 'emitter', params: { kind: 'sparks' } }),
  { id: 'fx_blast', category: 'effects', kind: 'effect', name: L('Blast Charge', 'Заряд'), desc: L('Detonates where you place it. Pushes everything nearby.', 'Взрывается там, где поставлен. Отталкивает всё вокруг.'), shape: { type: 'sphere', r: 0.3 }, visual: 'blast', material: 'metal', body: 'fixed', params: { radius: 7, impulse: 1100, damage: 40 } },

  // ───────── Decorations
  prop('decorations', { id: 'deco_plant', name: L('Lab Fern', 'Лабораторный папоротник'), desc: L('A morale-boosting plant in a pot.', 'Растение в горшке для поднятия духа.'), shape: { type: 'cylinder', r: 0.22, h: 0.9 }, visual: 'plant', material: 'rubber' }),
  prop('decorations', { id: 'deco_terminal', name: L('Terminal', 'Терминал'), desc: L('Glowing workstation.', 'Светящаяся рабочая станция.'), shape: box(0.9, 1.2, 0.5), visual: 'terminal', material: 'metal', body: 'fixed' }),
  prop('decorations', { id: 'deco_shelf', name: L('Storage Rack', 'Стеллаж'), desc: L('Metal shelving unit.', 'Металлический стеллаж.'), shape: box(1.8, 2, 0.5), visual: 'shelf', material: 'metal' }),
  prop('decorations', { id: 'deco_bench', name: L('Workbench', 'Верстак'), desc: L('A sturdy bench with tools on it.', 'Крепкий верстак с инструментами.'), shape: box(1.8, 0.9, 0.8), visual: 'bench', material: 'metal' }),
  prop('decorations', { id: 'deco_lamp', name: L('Floor Lamp', 'Прожектор'), desc: L('Industrial floodlight.', 'Промышленный прожектор.'), shape: { type: 'cylinder', r: 0.2, h: 1.7 }, visual: 'floor_lamp', material: 'metal' }),
  prop('decorations', { id: 'deco_sign', name: L('Hazard Sign', 'Знак опасности'), desc: L('Warns about something. Probably you.', 'Предупреждает о чём-то. Вероятно, о вас.'), shape: box(0.8, 1.3, 0.1), visual: 'sign', material: 'metal' }),
];

function coneHull(r: number, h: number): number[] {
  const pts: number[] = [0, h / 2, 0];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    pts.push(Math.cos(a) * r, -h / 2, Math.sin(a) * r);
  }
  return pts;
}

const registry = new Map<string, ItemDef>(CORE_ITEMS.map((i) => [i.id, i]));

export const catalog = {
  get(id: string): ItemDef | undefined {
    return registry.get(id);
  },
  require(id: string): ItemDef {
    const def = registry.get(id);
    if (!def) throw new Error(`Unknown item "${id}"`);
    return def;
  },
  has(id: string): boolean {
    return registry.has(id);
  },
  list(): ItemDef[] {
    return [...registry.values()];
  },
  add(def: ItemDef): void {
    registry.set(def.id, def);
  },
  remove(id: string): void {
    registry.delete(id);
  },
  removeBySource(source: string): void {
    for (const [id, def] of registry) if (def.source === source) registry.delete(id);
  },
};
