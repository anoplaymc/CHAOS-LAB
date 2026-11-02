import type { ModBundle, ModSource } from './ModManager';

// mods/examples/ holds reference mods for reading and testing, and isn't part of the game.
const manifests = import.meta.glob<string>('/mods/*/mod.json', { query: '?raw', import: 'default', eager: true });
const scripts = import.meta.glob<string>(['/mods/*/**/*.chaos', '!/mods/examples/**'], { query: '?raw', import: 'default', eager: true });
const images = import.meta.glob<string>(['/mods/*/assets/**/*.{png,jpg,jpeg,webp}', '!/mods/examples/**'], { query: '?inline', import: 'default', eager: true });

/** The mods in the repository's mods/ folder, bundled at build time. They load exactly as an installed mod does. */
export class BuiltinSource implements ModSource {
  readonly origin = 'builtin' as const;

  async list(): Promise<ModBundle[]> {
    return Object.entries(manifests).map(([path, manifest]) => {
      const root = path.slice(0, -'mod.json'.length);
      const pick = (all: Record<string, string>) => Object.fromEntries(Object.entries(all).filter(([p]) => p.startsWith(root)).map(([p, v]) => [p.slice(root.length), v]));
      return { origin: 'builtin', manifest, files: pick(scripts), assets: pick(images) };
    });
  }
}

/** The same folder read live through the Vite dev server, so a save shows up without a rebuild. */
export class DevServerSource implements ModSource {
  readonly origin = 'dev' as const;

  async list(): Promise<ModBundle[]> {
    const res = await fetch('/__chaos_mods');
    if (!res.ok) return [];
    return ((await res.json()) as Omit<ModBundle, 'origin'>[]).map((b) => ({ ...b, origin: 'dev' }));
  }
}

export function defaultModSources(): ModSource[] {
  const out: ModSource[] = [new BuiltinSource()];
  if (import.meta.env.DEV && typeof fetch !== 'undefined' && typeof window !== 'undefined') out.push(new DevServerSource());
  return out;
}
