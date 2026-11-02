export type Loc = { en: string; ru: string };
export type ImpactSound = 'wood' | 'metal' | 'rubber' | 'stone' | 'glass' | 'ice' | 'gel';

export interface PhysMaterial {
  id: string;
  name: Loc;
  friction: number;
  restitution: number;
  /** Game-scale density, kg per cubic metre. Tuned so a 1m crate is throwable. */
  density: number;
  frictionRule?: 'min' | 'max' | 'average';
  restitutionRule?: 'min' | 'max' | 'average';
  linearDamping?: number;
  angularDamping?: number;
  sound: ImpactSound;
  /** Multiplies damage taken from impacts. */
  fragility: number;
  /** Tint applied when an object is re-assigned to this material with the inspector. */
  tint: number;
  source?: string;
}

export const CORE_MATERIALS: PhysMaterial[] = [
  { id: 'rubber', name: { en: 'Rubber', ru: 'Резина' }, friction: 1.1, restitution: 0.72, density: 110, restitutionRule: 'max', sound: 'rubber', fragility: 0.2, tint: 0x2d3136 },
  { id: 'metal', name: { en: 'Metal', ru: 'Металл' }, friction: 0.42, restitution: 0.18, density: 420, sound: 'metal', fragility: 0.3, tint: 0x8a97a0 },
  { id: 'wood', name: { en: 'Wood', ru: 'Дерево' }, friction: 0.62, restitution: 0.12, density: 62, sound: 'wood', fragility: 1, tint: 0xb98a52 },
  { id: 'concrete', name: { en: 'Concrete', ru: 'Бетон' }, friction: 0.85, restitution: 0.04, density: 240, sound: 'stone', fragility: 0.5, tint: 0x8f8f88 },
  { id: 'ice', name: { en: 'Ice', ru: 'Лёд' }, friction: 0.015, restitution: 0.08, density: 90, frictionRule: 'min', sound: 'ice', fragility: 1.2, tint: 0x9fdcf2 },
  { id: 'gel', name: { en: 'Bouncy Gel', ru: 'Упругий гель' }, friction: 0.5, restitution: 0.96, density: 45, restitutionRule: 'max', angularDamping: 0.3, sound: 'gel', fragility: 0, tint: 0xff4fa3 },
  { id: 'heavy', name: { en: 'Heavy Industrial', ru: 'Тяжёлый сплав' }, friction: 0.7, restitution: 0.02, density: 1450, sound: 'metal', fragility: 0.05, tint: 0x4b5157 },
  { id: 'glass', name: { en: 'Glass', ru: 'Стекло' }, friction: 0.3, restitution: 0.1, density: 130, sound: 'glass', fragility: 2.5, tint: 0xbfe8ee },
];

const registry = new Map<string, PhysMaterial>(CORE_MATERIALS.map((m) => [m.id, m]));

export const materials = {
  get(id: string): PhysMaterial {
    return registry.get(id) ?? registry.get('metal')!;
  },
  has(id: string): boolean {
    return registry.has(id);
  },
  list(): PhysMaterial[] {
    return [...registry.values()];
  },
  add(m: PhysMaterial): void {
    registry.set(m.id, m);
  },
  remove(id: string): void {
    registry.delete(id);
  },
  removeBySource(source: string): void {
    for (const [id, m] of registry) if (m.source === source) registry.delete(id);
  },
};
