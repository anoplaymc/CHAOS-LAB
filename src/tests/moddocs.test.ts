import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STD_NAMESPACES } from '../chaosscript';
import { Game } from '../game/core/Game';
import { API_NAMESPACES } from '../modding/api';
import { generateApiDoc } from '../modding/docs';
import { parseManifest } from '../modding/manifest';
import type { ModBundle } from '../modding/ModManager';
import { readFolder } from '../modding/cli';

const DOCS = join(process.cwd(), 'docs');
const REQUIRED = ['CHAOSSCRIPT_LANGUAGE', 'CHAOSSCRIPT_API', 'MODDING_GUIDE', 'MOD_MANIFEST_SPEC', 'ENTITY_CREATION', 'NPC_CREATION', 'TOOL_CREATION', 'WEAPON_CREATION', 'VEHICLE_CREATION', 'EXAMPLE_MODS', 'MODDING_TROUBLESHOOTING', 'AI_MODDING_GUIDE'];
const handwritten = () => [...readdirSync(DOCS).filter((f) => f.endsWith('.md') && f !== 'CHAOSSCRIPT_API.md').map((f) => join(DOCS, f)), ...['AGENTS.md', 'CLAUDE.md', '.claude/skills/chaosscript-developer/SKILL.md'].map((f) => join(process.cwd(), f))];
const blocks = (text: string, lang: string) => [...text.matchAll(new RegExp('^```' + lang + '\\n([\\s\\S]*?)^```', 'gm'))].map((m) => m[1]!);

const bundle = (source: string): ModBundle => ({
  origin: 'local',
  manifest: JSON.stringify({ id: 'doc_example', name: 'Doc', description: 'x', version: '1.0.0', author: 'x', api_version: '1.0', permissions: ['content', 'world', 'player', 'effects', 'ui', 'storage', 'rules', 'sandbox'], scripts: ['main.chaos'] }),
  files: { 'main.chaos': source },
});

describe('documentation', () => {
  let game: Game;
  beforeAll(async () => {
    await Game.init();
    game = new Game();
    game.input.virtualLock = true;
    game.startSession();
  });
  afterAll(() => game.dispose());

  it('has every required document', () => {
    for (const d of REQUIRED) expect(existsSync(join(DOCS, `${d}.md`)), d).toBe(true);
    expect(existsSync(join(process.cwd(), 'AGENTS.md'))).toBe(true);
  });

  it('the API reference matches the code', () => {
    expect(readFileSync(join(DOCS, 'CHAOSSCRIPT_API.md'), 'utf8'), 'Run: npm run mod -- docs').toBe(generateApiDoc());
  });

  it('every lua block runs as a real mod', async () => {
    const failures: string[] = [];
    let count = 0;
    for (const file of handwritten()) {
      for (const code of blocks(readFileSync(file, 'utf8'), 'lua')) {
        count++;
        const r = await game.mods.installBundle(bundle(code));
        const state = r.record?.state;
        // A second session runs session_start handlers, with the world there to use.
        if (state === 'loaded') game.startSession();
        const errors = game.mods.logs.filter((l) => l.mod === 'doc_example' && l.level === 'error').map((l) => l.text);
        if (r.errors.length || state !== 'loaded' || errors.length) failures.push(`${file}:\n${code}\n=> ${[...r.errors, ...(r.record?.errors ?? []), ...errors].join('; ')}`);
        await game.mods.uninstall('doc_example');
        game.mods.clearLog();
      }
    }
    expect(failures.join('\n\n')).toBe('');
    expect(count).toBeGreaterThan(20);
  }, 60000);

  it('every manifest example is valid', () => {
    for (const file of handwritten()) {
      for (const code of blocks(readFileSync(file, 'utf8'), 'json')) {
        const r = parseManifest(JSON.parse(code));
        expect(r.errors, file).toEqual([]);
        expect(r.warnings, file).toEqual([]);
      }
    }
  });

  it('never mentions an API function that does not exist', () => {
    // `game` is also the TypeScript object that tests use, which these docs mention by these members.
    const known: Record<string, Set<string>> = { ...API_NAMESPACES, ...STD_NAMESPACES, game: new Set([...API_NAMESPACES.game!, 'mods', 'advance', 'startSession']) };
    const bad: string[] = [];
    const pattern = new RegExp(`(?<![\\w./:-])(${Object.keys(known).join('|')})\\.([A-Za-z_]+)(?![\\w/-]*\\.(?:md|ts|json|chaos))`, 'g');
    for (const file of handwritten()) {
      const text = readFileSync(file, 'utf8').replace(/^```ts\n[\s\S]*?^```/gm, '').replace(/\bmod\.json\b/g, '').replace(/\]\([^)]*\)/g, ']');
      for (const m of text.matchAll(pattern)) {
        if (!known[m[1]!]!.has(m[2]!)) bad.push(`${file}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('links only to files that exist', () => {
    for (const file of handwritten()) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
        const base = file.endsWith('AGENTS.md') || file.endsWith('CLAUDE.md') ? process.cwd() : DOCS;
        expect(existsSync(join(base, m[1]!)), `${file} -> ${m[1]}`).toBe(true);
      }
    }
  });

  it('every template and example mod passes the loader', async () => {
    const dirs = [...readdirSync('templates').map((t) => join('templates', t))];
    for (const dir of dirs) {
      const b = readFolder(dir);
      b.manifest = b.manifest.replaceAll('__MOD_ID__', 'template_test');
      const r = await game.mods.installBundle(b);
      expect(r.errors, dir).toEqual([]);
      expect(r.record!.state, dir).toBe('loaded');
      await game.mods.uninstall('template_test');
    }
  });
});
