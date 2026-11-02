import type { Category, ItemDef, ShapeDef } from '../../data/items';
import type { Loc } from '../../data/materials';
import '../entities/mechanics';
import { SCALE_MAX, SCALE_MIN } from '../entities/EntityManager';
import type { Entity } from '../entities/Entity';
import type { NpcProfile } from '../npcs/NpcBrain';
import { DataTool, type DataToolSpec } from '../weapons/DataTool';
import { dataViewModel, MODELS } from '../weapons/ViewModel';
import { registerItem, registerNpcType, registerToolType } from './registry';
import type { ModelPart, VehicleSpec } from './types';

/**
 * Core content added through the registry mods use, as plain data. Adding an item here needs no change to any
 * game class. This file is imported once, for its effect, by Game.ts.
 */
const L = (en: string, ru: string): Loc => ({ en, ru });
const box = (x: number, y: number, z: number): ShapeDef => ({ type: 'box', size: [x, y, z] });
const P = (shape: ModelPart['shape'], rest: Omit<ModelPart, 'shape'>): ModelPart => ({ shape, ...rest });
const B = (x: number, y: number, z: number, px: number, py: number, pz: number, color: number): ModelPart => P('box', { size: [x, y, z], pos: [px, py, pz], color });
const M = (x: number, y: number, z: number, px: number, py: number, pz: number, material: string): ModelPart => P('box', { size: [x, y, z], pos: [px, py, pz], material });

type PropInit = Partial<ItemDef> & Pick<ItemDef, 'id' | 'name' | 'desc' | 'shape' | 'material'>;
// A placed prop takes the player's yaw, so its local +z faces them: that is the front of a piece of furniture.
const prop = (category: Category, p: PropInit): ItemDef => ({ category, kind: 'prop', body: 'dynamic', visual: `core:${p.id}`, disintegrable: true, ...p });

const WOOD = 0x8a5a2a;
const DARK = 0x3a2a1c;
const CLOTH = 0x35586a;
const METAL = 0x7c8890;

const legs = (w: number, d: number, h: number, y: number, color: number, t = 0.07): ModelPart[] => {
  const out: ModelPart[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(B(t, h, t, (sx * (w - t)) / 2, y, (sz * (d - t)) / 2, color));
  return out;
};

const FURNITURE: ItemDef[] = [
  prop('props', { id: 'chair', name: L('Lab Chair', 'Лабораторный стул'), desc: L('Sturdy, until it isn\'t.', 'Прочный. Пока не сломается.'), shape: box(0.55, 1, 0.55), material: 'wood', breakSpeed: 9, health: 30, debris: { count: 5, kind: 'wood' },
    model: [B(0.55, 0.06, 0.55, 0, -0.04, 0, WOOD), B(0.55, 0.5, 0.05, 0, 0.24, -0.25, WOOD), ...legs(0.55, 0.55, 0.46, -0.27, DARK)] }),
  prop('props', { id: 'table', name: L('Table', 'Стол'), desc: L('Flat on top. Good for stacking things to knock over.', 'Плоский сверху. Удобно ставить вещи, чтобы потом их ронять.'), shape: box(1.8, 0.8, 0.9), material: 'wood', breakSpeed: 11, health: 70, debris: { count: 7, kind: 'wood' },
    model: [B(1.8, 0.08, 0.9, 0, 0.36, 0, WOOD), ...legs(1.8, 0.9, 0.72, -0.04, DARK, 0.09)] }),
  prop('props', { id: 'stool', name: L('Stool', 'Табурет'), desc: L('Three legs, no opinions.', 'Три ножки, никаких мнений.'), shape: { type: 'cylinder', r: 0.24, h: 0.6 }, material: 'wood', breakSpeed: 8, health: 20, debris: { count: 4, kind: 'wood' },
    model: [P('cylinder', { r: 0.24, h: 0.06, pos: [0, 0.27, 0], color: WOOD }), P('cylinder', { r: 0.05, h: 0.54, pos: [0, -0.03, 0], material: 'steel' }), P('torus', { r: 0.14, tube: 0.015, pos: [0, -0.18, 0], rot: [Math.PI / 2, 0, 0], material: 'steel' })] }),
  prop('props', { id: 'sofa', name: L('Break Room Sofa', 'Диван из комнаты отдыха'), desc: L('Heavier than it looks. Soft landing.', 'Тяжелее, чем кажется. Мягкая посадка.'), shape: box(2, 0.85, 0.85), material: 'rubber',
    model: [B(2, 0.3, 0.85, 0, -0.25, 0, CLOTH), B(2, 0.5, 0.2, 0, 0.17, -0.32, CLOTH), B(0.2, 0.28, 0.85, -0.9, 0.04, 0, 0x2a4655), B(0.2, 0.28, 0.85, 0.9, 0.04, 0, 0x2a4655)] }),
  prop('props', { id: 'bookshelf', name: L('Bookshelf', 'Книжный шкаф'), desc: L('Tips over beautifully.', 'Красиво падает.'), shape: box(1.2, 2, 0.35), material: 'wood', breakSpeed: 10, health: 60, debris: { count: 8, kind: 'wood' },
    model: [B(1.2, 2, 0.04, 0, 0, -0.155, DARK), B(0.05, 2, 0.35, -0.575, 0, 0, WOOD), B(0.05, 2, 0.35, 0.575, 0, 0, WOOD), ...[-0.95, -0.35, 0.3, 0.97].map((y) => B(1.1, 0.05, 0.33, 0, y, 0, WOOD)), B(0.6, 0.4, 0.2, -0.2, -0.13, 0, 0xc0392b), B(0.3, 0.44, 0.22, 0.3, -0.11, 0, 0x2980b9), B(0.8, 0.36, 0.2, 0, 0.5, 0, 0x27ae60)] }),
  prop('props', { id: 'locker', name: L('Locker', 'Шкафчик'), desc: L('Empty. Probably.', 'Пусто. Наверное.'), shape: box(0.6, 1.9, 0.55), material: 'metal',
    model: [B(0.6, 1.9, 0.55, 0, 0, 0, METAL), B(0.02, 1.8, 0.01, 0, 0, 0.28, 0x3a4248), B(0.04, 0.15, 0.03, 0.2, 0.05, 0.29, 0x20262a), B(0.3, 0.03, 0.01, 0, 0.8, 0.28, 0x3a4248)] }),
  prop('props', { id: 'cabinet', name: L('Filing Cabinet', 'Картотека'), desc: L('Contains forms about the forms.', 'Содержит формы о формах.'), shape: box(0.5, 1.3, 0.6), material: 'metal',
    model: [B(0.5, 1.3, 0.6, 0, 0, 0, 0x8b9299), ...[-0.42, 0, 0.42].flatMap((y) => [B(0.44, 0.36, 0.01, 0, y, 0.305, 0x9ca3aa), B(0.14, 0.03, 0.03, 0, y, 0.32, 0x30363a)])] }),
  prop('props', { id: 'desk', name: L('Desk', 'Письменный стол'), desc: L('Somebody\'s whole career.', 'Чья-то целая карьера.'), shape: box(1.6, 0.8, 0.75), material: 'wood', breakSpeed: 11, health: 60, debris: { count: 6, kind: 'wood' },
    model: [B(1.6, 0.06, 0.75, 0, 0.37, 0, WOOD), B(0.45, 0.74, 0.7, -0.55, -0.03, 0, DARK), B(0.06, 0.74, 0.7, 0.75, -0.03, 0, DARK), P('rbox', { size: [0.5, 0.32, 0.03], pos: [0.1, 0.58, -0.1], material: 'screen' })] }),
  prop('props', { id: 'whiteboard', name: L('Whiteboard', 'Маркерная доска'), desc: L('The plan. Don\'t erase it.', 'План. Не стирать.'), shape: box(1.8, 1.4, 0.12), material: 'metal', breakSpeed: 8, health: 25, debris: { count: 5, kind: 'metal' },
    model: [B(1.8, 1.4, 0.04, 0, 0, 0, 0xe8e6dc), B(1.84, 0.05, 0.08, 0, -0.7, 0, METAL), B(1.84, 0.05, 0.08, 0, 0.7, 0, METAL), B(0.8, 0.02, 0.01, -0.2, 0.2, 0.025, 0xc0392b), B(0.5, 0.02, 0.01, 0.2, 0, 0.025, 0x2980b9)] }),
  prop('props', { id: 'trash_can', name: L('Trash Can', 'Мусорное ведро'), desc: L('Makes an excellent sound.', 'Издаёт отличный звук.'), shape: { type: 'cylinder', r: 0.28, h: 0.7 }, material: 'metal', model: [P('cylinder', { r: 0.25, r_top: 0.28, h: 0.7, color: METAL })] }),
  prop('physics', { id: 'crate_long', name: L('Long Crate', 'Длинный ящик'), desc: L('Awkward to carry, satisfying to throw.', 'Неудобно нести, приятно бросать.'), shape: box(2.2, 0.6, 0.6), visual: 'crate', material: 'wood', breakSpeed: 9, health: 70, debris: { count: 8, kind: 'wood' } }),
  prop('physics', { id: 'ball_beach', name: L('Beach Ball', 'Пляжный мяч'), desc: L('Almost weightless.', 'Почти невесомый.'), shape: { type: 'sphere', r: 0.55 }, material: 'gel', model: [P('sphere', { r: 0.55, color: 0xff5a44 }), P('torus', { r: 0.55, tube: 0.02, rot: [Math.PI / 2, 0, 0], color: 0xffffff }), P('torus', { r: 0.55, tube: 0.02, color: 0xffb000 })] }),
];

const BEAM = 0x8f979c;
const CONSTRUCTION: ItemDef[] = [
  prop('construction', { id: 'truss', buildPart: true, name: L('Truss', 'Ферма'), desc: L('Light lattice girder, 3m.', 'Лёгкая решётчатая балка, 3 м.'), shape: box(3, 0.5, 0.5), material: 'metal',
    model: [...[-1, 1].flatMap((s) => [B(3, 0.05, 0.05, 0, s * 0.22, 0.22, BEAM), B(3, 0.05, 0.05, 0, s * 0.22, -0.22, BEAM)]), ...[-1.2, -0.6, 0, 0.6, 1.2].map((x) => B(0.05, 0.5, 0.5, x, 0, 0, 0x6c747a))] }),
  prop('construction', { id: 'half_wall', buildPart: true, name: L('Half Wall', 'Полустена'), desc: L('2×1.2m, waist high.', '2×1,2 м, по пояс.'), shape: box(2, 1.2, 0.2), visual: 'wall_panel', material: 'concrete' }),
  prop('construction', { id: 'stair_block', buildPart: true, name: L('Stair Block', 'Лестничный блок'), desc: L('A walkable slope, 1m high.', 'Наклон, по которому можно идти, высотой 1 м.'), shape: { type: 'wedge', size: [1.6, 1, 2] }, visual: 'ramp', material: 'concrete' }),
  prop('construction', { id: 'plate_thin', buildPart: true, name: L('Thin Plate', 'Тонкая пластина'), desc: L('1×1m and light. Good for skinning contraptions.', '1×1 м и лёгкая. Удобно обшивать конструкции.'), shape: box(1, 0.05, 1), material: 'metal', model: [B(1, 0.05, 1, 0, 0, 0, 0x9ba4a9)] }),
  prop('construction', { id: 'corner_post', buildPart: true, name: L('Corner Post', 'Угловая стойка'), desc: L('Square 2m post.', 'Квадратная стойка, 2 м.'), shape: box(0.3, 2, 0.3), material: 'metal', model: [B(0.3, 2, 0.3, 0, 0, 0, 0x5c6468)] }),
  prop('construction', { id: 'lintel', buildPart: true, name: L('Lintel', 'Перемычка'), desc: L('A short heavy beam for spanning a gap.', 'Короткая тяжёлая балка, чтобы перекрыть проём.'), shape: box(2.4, 0.3, 0.3), material: 'metal',
    model: [B(2.4, 0.3, 0.3, 0, 0, 0, 0x5c6468)] }),
];

const MECHANICAL: ItemDef[] = [
  prop('mechanical', { id: 'delay_gate', buildPart: true, body: 'fixed', name: L('Delay Gate', 'Линия задержки'), desc: L('Output follows input one second later.', 'Выход повторяет вход через секунду.'), shape: box(0.4, 0.3, 0.4), material: 'metal', behavior: 'delay', params: { delay: 1 }, signal: { in: true, out: true }, disintegrable: false, model: [M(0.4, 0.3, 0.4, 0, 0, 0, 'steel_dark'), P('cylinder', { r: 0.1, h: 0.04, pos: [0, 0.17, 0], material: 'glow_teal' })] }),
  prop('mechanical', { id: 'latch_gate', buildPart: true, body: 'fixed', name: L('Latch', 'Защёлка'), desc: L('Each pulse flips the output. E works too.', 'Каждый импульс переключает выход. E тоже работает.'), shape: box(0.4, 0.3, 0.4), material: 'metal', behavior: 'latch', signal: { in: true, out: true }, disintegrable: false, model: [M(0.4, 0.3, 0.4, 0, 0, 0, 'steel_dark'), P('cylinder', { r: 0.1, h: 0.04, pos: [0, 0.17, 0], material: 'glow_amber' })] }),
  prop('mechanical', { id: 'conveyor', buildPart: true, body: 'fixed', name: L('Conveyor', 'Конвейер'), desc: L('Carries things along its length. E or a wire stops it.', 'Везёт предметы вдоль себя. E или провод останавливает.'), shape: box(1.6, 0.2, 3), material: 'rubber', behavior: 'conveyor', params: { speed: 3 }, signal: { in: true }, disintegrable: false, model: [B(1.6, 0.2, 3, 0, 0, 0, 0x22282c), ...[-1.2, -0.6, 0, 0.6, 1.2].map((z) => M(1.5, 0.01, 0.06, 0, 0.105, z, 'paint_amber'))] }),
  prop('mechanical', { id: 'magnet', buildPart: true, body: 'fixed', name: L('Electromagnet', 'Электромагнит'), desc: L('Pulls metal things nearby while powered.', 'Притягивает металлические предметы рядом, пока включён.'), shape: box(1, 0.4, 1), material: 'metal', behavior: 'magnet', params: { range: 9, force: 34 }, signal: { in: true }, disintegrable: false, model: [M(1, 0.4, 1, 0, 0, 0, 'steel_dark'), P('torus', { r: 0.36, tube: 0.05, pos: [0, 0.2, 0], rot: [Math.PI / 2, 0, 0], material: 'paint_coral' })] }),
  prop('mechanical', { id: 'thruster', buildPart: true, name: L('Thruster', 'Двигатель'), desc: L('Weld it on and press E, or wire it. Pushes along its top.', 'Приварите и нажмите E либо подайте сигнал. Толкает в сторону верха.'), shape: { type: 'cylinder', r: 0.25, h: 0.7 }, material: 'metal', behavior: 'thruster', params: { force: 1600 }, signal: { in: true }, model: [P('cylinder', { r: 0.25, h: 0.5, pos: [0, 0.1, 0], material: 'steel_dark' }), P('cylinder', { r: 0.14, r_top: 0.25, h: 0.2, pos: [0, -0.25, 0], material: 'paint_coral' })] }),
  prop('mechanical', { id: 'dispenser', buildPart: true, body: 'fixed', name: L('Crate Dispenser', 'Раздатчик ящиков'), desc: L('E or a wire pops out a small crate.', 'E или провод выдаёт маленький ящик.'), shape: box(1, 1.2, 1), material: 'metal', behavior: 'dispenser', params: { dispense: 'crate_small', cooldown: 1, reach: 1 }, signal: { in: true }, disintegrable: false, model: [M(1, 1.2, 1, 0, 0, 0, 'paint_teal'), M(0.6, 0.5, 0.02, 0, 0.1, 0.51, 'blackened')] }),
  prop('mechanical', { id: 'teleporter', body: 'fixed', name: L('Teleporter Pad', 'Телепорт'), desc: L('Place two. Whatever touches one comes out of the other.', 'Поставьте два. Всё, что коснётся одного, выйдет из другого.'), shape: box(1.5, 0.2, 1.5), material: 'metal', behavior: 'teleporter', params: { channel: 'a' }, disintegrable: false, model: [M(1.5, 0.2, 1.5, 0, 0, 0, 'steel_dark'), P('torus', { r: 0.5, tube: 0.05, pos: [0, 0.12, 0], rot: [Math.PI / 2, 0, 0], material: 'glow_violet' })] }),
  prop('mechanical', { id: 'alarm_bell', buildPart: true, body: 'fixed', name: L('Alarm Bell', 'Сигнал тревоги'), desc: L('E or a wire rings it. Every NPC nearby comes to look.', 'E или провод включает его. Все NPC рядом придут посмотреть.'), shape: box(0.5, 0.5, 0.5), material: 'metal', behavior: 'alarm', params: { radius: 40 }, signal: { in: true }, disintegrable: false, model: [M(0.5, 0.15, 0.5, 0, -0.17, 0, 'steel_dark'), P('sphere', { r: 0.22, pos: [0, 0.05, 0], material: 'paint_coral' })] }),
];

const EFFECTS: ItemDef[] = [
  prop('effects', { id: 'fx_fountain', body: 'fixed', name: L('Water Fountain', 'Фонтан'), desc: L('A plume of blue droplets.', 'Струя синих капель.'), shape: box(0.4, 0.2, 0.4), visual: 'emitter', material: 'metal', behavior: 'emitter', params: { kind: 'fountain', color: 0x66d9ff }, disintegrable: false }),
  prop('effects', { id: 'fx_firework', body: 'fixed', name: L('Firework Launcher', 'Фейерверк'), desc: L('Bursts overhead every couple of seconds.', 'Взрывается над головой каждые пару секунд.'), shape: box(0.4, 0.2, 0.4), visual: 'emitter', material: 'metal', behavior: 'emitter', params: { kind: 'firework' }, disintegrable: false }),
  prop('effects', { id: 'fx_steam', body: 'fixed', name: L('Steam Vent', 'Паровой клапан'), desc: L('White steam rising from the floor.', 'Белый пар поднимается от пола.'), shape: box(0.4, 0.2, 0.4), visual: 'emitter', material: 'metal', behavior: 'emitter', params: { kind: 'smoke', color: 0xe8ecec }, disintegrable: false }),
  { id: 'fx_shockwave', category: 'effects', kind: 'effect', name: L('Shockwave Charge', 'Заряд ударной волны'), desc: L('A hard push with no fire and no damage.', 'Сильный толчок без огня и урона.'), shape: { type: 'sphere', r: 0.3 }, visual: 'blast', material: 'metal', body: 'fixed', params: { radius: 8, impulse: 1400, damage: 0 } },
];

const LINES = {
  courier: [L('Right behind you.', 'Прямо за вами.'), L('Where to next?', 'Куда дальше?'), L('I don\'t get paid for this.', 'Мне за это не платят.')],
  janitor: [L('Who keeps leaving these here?', 'Кто всё время это здесь оставляет?'), L('Mind the wet floor.', 'Осторожно, мокрый пол.'), L('I just cleaned that.', 'Я только что это убрал.')],
  medic: [L('Try not to bleed on anything.', 'Постарайтесь ни на что не накапать.'), L('You look terrible. Come here.', 'Выглядите ужасно. Идите сюда.')],
};

const NPCS: { item: Pick<ItemDef, 'id' | 'name' | 'desc' | 'shape' | 'material'>; profile: Omit<NpcProfile, 'id'> }[] = [
  {
    item: { id: 'npc_courier', name: L('Courier', 'Курьер'), desc: L('Friendly. Follows you around and runs from trouble. Press E to talk.', 'Дружелюбный. Ходит за вами и убегает от неприятностей. E — поговорить.'), shape: { type: 'capsule', r: 0.32, h: 1.8 }, material: 'rubber' },
    profile: { health: 60, walkSpeed: 3.2, runSpeed: 5.5, sight: 14, hearing: 12, attackRange: 0, attackCooldown: 1, attackDamage: 0, attack: 'none', faction: 'lab', hostility: 'never', fleesWhenHurt: true, skittish: false, memory: 2, hops: false, behavior: 'follow', personality: 'cowardly', lines: LINES.courier, speaker: L('Courier', 'Курьер'), model: { base: 'humanoid', color: 0xd9822b, accent: 0x3a2a1c } },
  },
  {
    item: { id: 'npc_sentry', name: L('Sentry', 'Часовой'), desc: L('Guards the place it was put and ignores everything further away. Shoots if provoked.', 'Охраняет место, где его поставили, и не обращает внимания на то, что дальше. Отвечает на атаку.'), shape: { type: 'capsule', r: 0.34, h: 1.85 }, material: 'rubber' },
    profile: { health: 130, walkSpeed: 1.6, runSpeed: 3.6, sight: 18, hearing: 14, attackRange: 14, attackCooldown: 0.9, attackDamage: 8, attack: 'tracer', faction: 'lab', hostility: 'provoked', fleesWhenHurt: false, skittish: false, memory: 3, hops: false, behavior: 'guard', guardRadius: 7, personality: 'brave', model: { base: 'guard', color: 0x4a4f2a, accent: 0x20241a } },
  },
  {
    item: { id: 'npc_janitor', name: L('Janitor', 'Уборщик'), desc: L('Wanders over to whatever is lying around and gives it a shove. Presses buttons too.', 'Подходит ко всему, что лежит без дела, и толкает это. Нажимает кнопки.'), shape: { type: 'capsule', r: 0.32, h: 1.75 }, material: 'rubber' },
    profile: { health: 70, walkSpeed: 1.5, runSpeed: 4, sight: 10, hearing: 10, attackRange: 0, attackCooldown: 1, attackDamage: 0, attack: 'none', faction: 'lab', hostility: 'never', fleesWhenHurt: true, skittish: false, memory: 2, hops: false, behavior: 'tinker', personality: 'lazy', lines: LINES.janitor, speaker: L('Janitor', 'Уборщик'), model: { base: 'humanoid', color: 0x4a7a5a, accent: 0x223328 } },
  },
  {
    item: { id: 'npc_scout_bot', name: L('Scout Bot', 'Бот-разведчик'), desc: L('Fast and fragile. Comes running at the first noise.', 'Быстрый и хрупкий. Прибегает на первый же шум.'), shape: { type: 'capsule', r: 0.3, h: 1.3 }, material: 'metal' },
    profile: { health: 35, walkSpeed: 3, runSpeed: 7, sight: 30, hearing: 26, attackRange: 12, attackCooldown: 0.7, attackDamage: 5, attack: 'bolt', faction: 'rogue', hostility: 'always', fleesWhenHurt: false, skittish: false, memory: 6, hops: false, voice: 'robot', personality: 'curious', onExplosion: 'investigate', model: { base: 'robot', color: 0x3a8a9a, accent: 0x20282c, scale: 0.765 } },
  },
  {
    item: { id: 'npc_critter_blue', name: L('Skrit', 'Скрит'), desc: L('A nervous relative of the Glorp. Bolts at explosions.', 'Нервный родственник Глорпа. Удирает от взрывов.'), shape: { type: 'capsule', r: 0.26, h: 0.64 }, material: 'rubber' },
    profile: { health: 15, walkSpeed: 2.4, runSpeed: 7, sight: 10, hearing: 14, attackRange: 0, attackCooldown: 1, attackDamage: 0, attack: 'none', faction: 'neutral', hostility: 'never', fleesWhenHurt: true, skittish: true, memory: 1, hops: true, voice: 'creature', onExplosion: 'flee', model: { base: 'creature', color: 0x5a8ad6, scale: 0.8 } },
  },
];

const buggyWheels = (w: number, y: number, f: number, r: number): [number, number, number][] => [[-w, y, -f], [w, y, -f], [-w, y, r], [w, y, r]];
const VEHICLES: { id: string; name: Loc; desc: Loc; size: [number, number, number]; model: ModelPart[]; spec: VehicleSpec }[] = [
  {
    id: 'kart', name: L('Go-Kart', 'Карт'), desc: L('Small, twitchy and quick off the line.', 'Маленький, резвый и быстро разгоняется.'), size: [1.2, 0.4, 1.9],
    model: [B(1.2, 0.2, 1.9, 0, -0.08, 0, 0xc0392b), M(0.5, 0.4, 0.5, 0, 0.18, 0.25, 'blackened'), P('torus', { r: 0.14, tube: 0.02, pos: [0, 0.32, -0.15], rot: [0.7, 0, 0], material: 'rubber' }), M(1, 0.06, 0.2, 0, 0.05, -0.9, 'paint_white')],
    spec: { wheels: buggyWheels(0.62, -0.1, 0.7, 0.7), wheelRadius: 0.26, rest: 0.26, engine: 620, topSpeed: 22, steer: 0.72, grip: 3.2, stiffness: 34, density: 150 },
  },
  {
    id: 'truck', name: L('Heavy Truck', 'Тяжёлый грузовик'), desc: L('Slow to start and very hard to stop. Pushes everything aside.', 'Медленно трогается, очень трудно остановить. Отодвигает всё на пути.'), size: [2.1, 1, 4.2],
    model: [B(2.1, 0.5, 4.2, 0, -0.1, 0, 0x3a4a5a), B(2, 1.1, 1.4, 0, 0.6, -1.3, 0xd9822b), M(1.7, 0.5, 0.05, 0, 0.75, -2, 'screen'), M(2, 0.4, 2.6, 0, 0.35, 0.7, 'steel_dark')],
    spec: { wheels: [[-1, -0.3, -1.4], [1, -0.3, -1.4], [-1, -0.3, 0.6], [1, -0.3, 0.6], [-1, -0.3, 1.5], [1, -0.3, 1.5]], wheelRadius: 0.5, rest: 0.45, engine: 3200, topSpeed: 17, steer: 0.48, grip: 3, stiffness: 30, density: 170 },
  },
];

interface CoreTool { spec: DataToolSpec; name: Loc; desc: Loc; base: string; parts?: ModelPart[] }

const aimedEntity = (g: Parameters<NonNullable<DataToolSpec['onPrimary']>>[0], range = 40): Entity | null => {
  const hit = g.aimHit(range);
  const e = hit?.owner as Entity | undefined;
  return e?.def ? e : null;
};

const TOOLS: CoreTool[] = [
  {
    name: L('Cloner', 'Клонер'), desc: L('LMB copies what you aim at. It appears just above the original.', 'ЛКМ копирует то, на что вы смотрите. Копия появляется над оригиналом.'), base: 'spawner',
    spec: {
      id: 'cloner', kind: 'tool', hints: [['LMB', L('Clone', 'Клонировать')]],
      onPrimary(g) {
        const e = aimedEntity(g);
        if (!e || e.fixture || e.def.kind === 'npc' && g.npcs.length >= g.rules.limits.npcs) { g.audio.play('error'); return; }
        const p = e.position;
        const s = e.def.shape;
        const up = (s.type === 'box' || s.type === 'wedge' ? s.size[1] : s.type === 'sphere' ? s.r * 2 : s.type === 'convex' ? 1 : s.h) * e.scale + 0.1;
        const r = g.trySpawn(e.def.id, { position: { x: p.x, y: p.y + up, z: p.z }, rotation: e.rotation, scale: e.scale, material: e.materialId, tint: e.tint });
        if (r.ok) { g.audio.play('place', 0.8, p); g.fx.ring(p, 1.2, 0x19e0c4, 0.3); }
      },
    },
  },
  {
    name: L('Anchor Tool', 'Якорь'), desc: L('LMB pins an object where it is. LMB again releases it.', 'ЛКМ закрепляет объект на месте. Повторное ЛКМ отпускает.'), base: 'construction',
    spec: {
      id: 'anchor', kind: 'tool', hints: [['LMB', L('Anchor / release', 'Закрепить / отпустить')]],
      onPrimary(g) {
        const e = aimedEntity(g);
        if (!e || e.def.body !== 'dynamic' || e.def.kind !== 'prop' || e.fixture || e.locked) { g.audio.play('error'); return; }
        g.entities.setAnchored(e, !e.anchored);
        g.audio.play('pin', 0.8, e.position);
        g.fx.ring(e.position, 1, e.anchored ? 0xffb000 : 0x66d9ff, 0.3);
      },
    },
  },
  {
    name: L('Resizer', 'Масштабатор'), desc: L('LMB grows what you aim at, RMB shrinks it.', 'ЛКМ увеличивает объект, ПКМ уменьшает.'), base: 'inspector',
    spec: {
      id: 'resizer', kind: 'tool', hints: [['LMB', L('Grow', 'Увеличить')], ['RMB', L('Shrink', 'Уменьшить')]],
      onPrimary(g) { resize(g, 1.25); },
      onSecondary(g) { resize(g, 0.8); },
    },
  },
  {
    name: L('Foam Launcher', 'Пеномёт'), desc: L('Fires quick-setting foam that freezes its target in place. Does no harm.', 'Стреляет быстрозастывающей пеной, обездвиживающей цель. Безвредно.'), base: 'freeze',
    spec: { id: 'foam', kind: 'weapon', fire: 'hitscan', energy: 100, energyRegen: 16, cost: 25, cooldown: 0.6, range: 35, impulse: 30, freeze: 4, color: 0xe8ecec, sound: 'freeze', hints: [['LMB', L('Fire', 'Огонь')], ['R', L('Refill', 'Заправить')]] },
  },
  {
    name: L('Scattergun', 'Дробовик'), desc: L('A wide spray of short-range energy pellets. Pushes hard up close.', 'Широкий сноп энергетических зарядов малой дальности. Сильно толкает вблизи.'), base: 'impulse',
    spec: { id: 'scatter', kind: 'weapon', fire: 'cone', energy: 100, energyRegen: 18, cost: 22, cooldown: 0.75, range: 20, damage: 6, impulse: 90, pellets: 8, spread: 0.09, color: 0xff9a40, sound: 'impulse', hints: [['LMB', L('Fire', 'Огонь')], ['R', L('Vent', 'Сбросить')]] },
  },
  {
    name: L('Tesla Coil Gun', 'Катушка Теслы'), desc: L('A held arc that jumps to up to three more targets.', 'Удерживаемая дуга, которая перескакивает ещё на три цели.'), base: 'disintegrator',
    spec: { id: 'tesla', kind: 'weapon', fire: 'hitscan', automatic: true, energy: 100, energyRegen: 14, cost: 5, cooldown: 0.12, range: 22, damage: 6, impulse: 25, chain: 3, color: 0x88aaff, sound: 'tracer', hints: [['LMB', L('Hold to arc', 'Удерживать')], ['R', L('Vent', 'Сбросить')]] },
  },
];

function resize(g: Parameters<NonNullable<DataToolSpec['onPrimary']>>[0], k: number): void {
  const e = aimedEntity(g);
  if (!e || e.fixture || e.locked || e.def.kind !== 'prop') { g.audio.play('error'); return; }
  const next = Math.max(SCALE_MIN, Math.min(SCALE_MAX, e.scale * k));
  if (next === e.scale) { g.audio.play('empty'); return; }
  g.entities.setScale(e, next);
  g.audio.play('click', 0.7, e.position);
}

function install(): void {
  for (const d of [...FURNITURE, ...CONSTRUCTION, ...MECHANICAL, ...EFFECTS]) registerItem(d);
  for (const n of NPCS) {
    const archetype = n.item.id;
    registerNpcType({ ...n.profile, id: archetype });
    registerItem({ ...n.item, category: 'npcs', kind: 'npc', visual: archetype, body: 'dynamic', behavior: 'npc', params: { archetype } });
  }
  for (const v of VEHICLES) {
    registerItem({ id: v.id, category: 'vehicles', kind: 'vehicle', name: v.name, desc: v.desc, shape: { type: 'box', size: v.size }, visual: `core:${v.id}`, model: v.model, material: 'metal', body: 'dynamic', behavior: 'vehicle', vehicle: v.spec });
  }
  for (const t of TOOLS) {
    MODELS[t.spec.id] = dataViewModel(t.base, t.parts);
    registerToolType({ id: t.spec.id, create: (g) => new DataTool(g, t.spec) });
    registerItem({ id: `${t.spec.kind === 'tool' ? 'tool' : 'wpn'}_${t.spec.id}`, category: t.spec.kind === 'tool' ? 'tools' : 'weapons', kind: 'tool', toolId: t.spec.id, name: t.name, desc: t.desc, shape: box(0.5, 0.3, 0.8), visual: `tool:${t.spec.id}`, material: 'metal', body: 'fixed' });
  }
}

install();
