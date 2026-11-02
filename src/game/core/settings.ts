export interface Settings {
  sensitivity: number;
  invertY: boolean;
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  quality: 'low' | 'medium' | 'high';
  shadows: boolean;
  antialias: boolean;
  bloom: boolean;
  fov: number;
  renderScale: number;
  cameraMotion: boolean;
  language: 'en' | 'ru';
  showControlsHint: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  sfxVolume: 0.85,
  ambienceVolume: 0.5,
  quality: 'medium',
  shadows: true,
  antialias: true,
  bloom: true,
  fov: 78,
  renderScale: 1,
  cameraMotion: true,
  language: 'en',
  showControlsHint: true,
};

const KEY = 'chaoslab.settings.v1';

/** Tolerates junk in storage: every field is type-checked and range-clamped independently. */
export function sanitizeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  const num = (k: keyof Settings, lo: number, hi: number) => {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) (s[k] as number) = Math.min(hi, Math.max(lo, v));
  };
  const bool = (k: keyof Settings) => {
    if (typeof r[k] === 'boolean') (s[k] as boolean) = r[k] as boolean;
  };
  num('sensitivity', 0.1, 4);
  num('masterVolume', 0, 1);
  num('sfxVolume', 0, 1);
  num('ambienceVolume', 0, 1);
  num('fov', 55, 110);
  num('renderScale', 0.4, 1);
  bool('invertY');
  bool('shadows');
  bool('antialias');
  bool('bloom');
  bool('cameraMotion');
  bool('showControlsHint');
  if (r.quality === 'low' || r.quality === 'medium' || r.quality === 'high') s.quality = r.quality;
  if (r.language === 'en' || r.language === 'ru') s.language = r.language;
  return s;
}

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

function defaultStorage(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: KV | null = defaultStorage()): Settings {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, storage: KV | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage may be full or blocked; settings then simply last for this session.
  }
}
