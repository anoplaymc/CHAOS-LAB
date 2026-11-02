import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const MODS = join(import.meta.dirname, 'mods');
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function readMods(): unknown[] {
  const bundles: unknown[] = [];
  for (const id of readdirSync(MODS)) {
    const root = join(MODS, id);
    if (!statSync(root).isDirectory()) continue;
    const bundle = { manifest: '', files: {} as Record<string, string>, assets: {} as Record<string, string> };
    for (const p of walk(root)) {
      const rel = relative(root, p).split(sep).join('/');
      const ext = rel.split('.').pop()!.toLowerCase();
      if (rel === 'mod.json') bundle.manifest = readFileSync(p, 'utf8');
      else if (ext === 'chaos') bundle.files[rel] = readFileSync(p, 'utf8');
      else if (IMAGE_TYPES[ext]) bundle.assets[rel] = `data:${IMAGE_TYPES[ext]};base64,${readFileSync(p).toString('base64')}`;
    }
    if (bundle.manifest) bundles.push(bundle);
  }
  return bundles;
}

/** Development only: serves mods/ straight from disk, and tells the game when a file there changes. */
function chaosMods(): Plugin {
  return {
    name: 'chaos-mods',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__chaos_mods', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(readMods()));
      });
    },
    handleHotUpdate({ file, server }) {
      const rel = relative(MODS, file);
      if (rel.startsWith('..')) return undefined;
      const id = rel.split(sep)[0]!;
      server.ws.send({ type: 'custom', event: 'chaos:mod-changed', data: { id } });
      // The game reloads just this mod. Without this, Vite would reload the whole page.
      return [];
    },
  };
}

export default defineConfig({
  plugins: [react(), chaosMods()],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
