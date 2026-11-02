import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { catalog } from '../data/items';
import { Game } from '../game/core/Game';
import { ALL_API } from './api';
import { BUILTIN_SOUNDS } from './api/system';
import { NS_ORDER } from './api/types';
import { generateApiDoc } from './docs';
import { EVENT_NAMES } from './events';
import { typeLabel } from './fields';
import { signature } from './ModHost';
import { bundleToText, examineBundle, type ModBundle } from './ModManager';
import { analyzeMod, type QualityReport } from './quality';
import { writeZip, type ZipInput } from './zipWrite';

const ROOT = process.cwd();
const MODS = join(ROOT, 'mods');
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Reads a mod folder from disk, exactly as the dev server does. */
export function readFolder(dir: string): ModBundle {
  const manifestPath = join(dir, 'mod.json');
  if (!existsSync(manifestPath)) throw new Error(`No mod.json in ${dir}`);
  const b: ModBundle = { origin: 'local', manifest: readFileSync(manifestPath, 'utf8'), files: {}, assets: {} };
  for (const p of walk(dir)) {
    const rel = relative(dir, p).split(sep).join('/');
    const ext = rel.split('.').pop()!.toLowerCase();
    if (ext === 'chaos') b.files[rel] = readFileSync(p, 'utf8');
    else if (IMAGE_TYPES[ext]) b.assets![rel] = `data:${IMAGE_TYPES[ext]};base64,${readFileSync(p).toString('base64')}`;
  }
  return b;
}

function target(arg: string | undefined): string {
  if (!arg) throw new Error('Name a mod folder, such as mods/my_mod');
  const direct = resolve(arg);
  if (existsSync(join(direct, 'mod.json'))) return direct;
  const inMods = join(MODS, arg);
  if (existsSync(join(inMods, 'mod.json'))) return inMods;
  throw new Error(`No mod found at ${arg}`);
}

const dependenciesFor = (bundle: ModBundle): ModBundle[] => {
  // Dependencies come from the mods/ folder, read fresh.
  const out: ModBundle[] = [];
  const seen = new Set<string>();
  const add = (b: ModBundle) => {
    const raw = JSON.parse(b.manifest) as { dependencies?: (string | { id: string })[] };
    for (const d of raw.dependencies ?? []) {
      const id = typeof d === 'string' ? d : d.id;
      const dir = join(MODS, id);
      if (seen.has(id) || !existsSync(join(dir, 'mod.json'))) continue;
      seen.add(id);
      const dep = readFolder(dir);
      add(dep);
      out.push(dep);
    }
  };
  add(bundle);
  return out;
};

/** A real game, with no session yet: the main menu, which is the state mods load in when the game starts. */
async function bootGame(): Promise<Game> {
  await Game.init();
  const game = new Game();
  game.input.virtualLock = true;
  game.mods.echoErrors = false;
  return game;
}

const location = (d: { file: string; line: number }) => (d.line > 1 || d.file !== 'mod.json' ? `${d.file}:${d.line}` : d.file);

/** Everything that doesn't need running the mod. Returns the static report, or null if there are errors. */
function staticChecks(b: ModBundle): QualityReport | null {
  const x = examineBundle(b);
  let errors = x.errors.length;
  for (const w of x.warnings) console.log(`  warning: ${w}`);
  for (const e of x.errors) console.log(`  error: ${e}`);
  if (!x.manifest) return null;
  // Files that exist but won't run are nearly always a forgotten manifest entry.
  for (const p of Object.keys(b.files)) if (!x.manifest.scripts.includes(p)) console.log(`  warning: ${p} isn't listed in "scripts" in mod.json, so it never runs.`);
  for (const p of Object.keys(b.assets ?? {})) if (!x.manifest.assets.includes(p)) console.log(`  warning: ${p} isn't listed in "assets" in mod.json, so it can't be used.`);
  if (errors) return null;
  const q = analyzeMod(x.chunks, x.manifest);
  for (const d of q.diagnostics) {
    console.log(`  ${d.severity}: ${location(d)}: ${d.message}`);
    if (d.severity === 'error') errors++;
  }
  return errors ? null : q;
}

/** Ids written literally in scripts can only be checked once everything has registered. */
function checkRefs(game: Game, id: string, refs: QualityReport['refs']): number {
  const host = game.mods.get(id)?.host;
  if (!host) return 0;
  let bad = 0;
  const seen = new Set<string>();
  for (const r of refs) {
    const key = `${r.kind}:${r.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let ok = true;
    let hint: string | null = null;
    if (r.kind === 'def') {
      ok = catalog.has(host.resolveDef(r.name));
      if (!ok) hint = host.unknownDef(r.name).message;
    } else if (r.kind === 'sound') {
      ok = r.name.includes(':') || host.sounds.has(`${id}:${r.name}`) || BUILTIN_SOUNDS.includes(r.name);
      if (!ok) hint = `Unknown sound "${r.name}". Available: sound.names().`;
    } else {
      ok = game.tools.tools.some((t) => t.id === r.name || t.id === `${id}:${r.name}`);
      if (!ok) hint = `Unknown tool "${r.name}".`;
    }
    if (!ok) {
      console.log(`  error: ${r.file}:${r.line}: ${hint}`);
      bad++;
    }
  }
  return bad;
}

interface Loaded { game: Game; id: string; refs: QualityReport['refs'] }

/** Static checks, then a real load through the loader from the main menu, then a session. Null means it failed. */
async function loadForCheck(dir: string): Promise<Loaded | null> {
  const bundle = readFolder(dir);
  const q = staticChecks(bundle);
  if (!q) return null;
  const game = await bootGame();
  for (const dep of dependenciesFor(bundle)) await game.mods.installBundle(dep);
  const r = await game.mods.installBundle(bundle);
  const record = r.record;
  if (!record || record.state !== 'loaded') {
    for (const e of [...r.errors, ...(record?.errors ?? [])]) console.log(`  error: ${e}`);
    if (record) console.log(`  the mod is "${record.state}".`);
    game.dispose();
    return null;
  }
  const id = record.id;
  const refProblems = checkRefs(game, id, q.refs);
  const logged = game.mods.logs.filter((l) => l.mod === id && l.level === 'error').length;
  game.startSession();
  game.advance(0.2);
  const fresh = game.mods.logs.filter((l) => l.mod === id && l.level === 'error').slice(logged);
  for (const l of fresh) console.log(`  error: starting a session: ${l.text}`);
  if (refProblems || fresh.length) {
    game.dispose();
    return null;
  }
  return { game, id, refs: q.refs };
}

function printContent(game: Game, id: string): void {
  const c = game.mods.get(id)!.content;
  console.log(`  registered: ${c.items.length} items, ${c.tools.length} tools, ${c.maps.length} maps, ${c.modes.length} modes`);
  for (const x of [...c.items, ...c.maps, ...c.modes]) console.log(`    ${x}`);
}

async function validate(dir: string): Promise<number> {
  console.log(`Checking ${relative(ROOT, dir) || dir}`);
  const l = await loadForCheck(dir);
  if (!l) {
    console.log('FAILED: fix the errors above.');
    return 1;
  }
  for (const e of l.game.mods.logs.filter((x) => x.mod === l.id && x.level !== 'error')) console.log(`  [${e.level}] ${e.text}`);
  printContent(l.game, l.id);
  console.log('OK');
  l.game.dispose();
  return 0;
}

/** Loads the mod, then spawns and uses everything it registered, runs the world, and reloads it, watching for errors. */
async function smokeTest(dir: string, seconds: number): Promise<number> {
  console.log(`Testing ${relative(ROOT, dir) || dir}`);
  const l = await loadForCheck(dir);
  if (!l) {
    console.log('FAILED: fix the errors above.');
    return 1;
  }
  const { game, id } = l;
  const record = game.mods.get(id)!;
  const problems = () => game.mods.logs.filter((x) => x.mod === id && x.level === 'error').map((x) => x.text);
  const checks: [string, () => void | Promise<unknown>][] = [];
  for (const itemId of record.content.items) {
    const def = catalog.get(itemId)!;
    if (def.kind === 'tool') {
      checks.push([`tool ${def.toolId}`, () => {
        game.tools.selectById(def.toolId!);
        const t = game.tools.active;
        t.primaryDown();
        game.advance(0.1);
        t.primaryUp();
        t.secondaryDown();
        t.secondaryUp();
        t.reload();
        t.hud();
        game.tools.select(0);
      }]);
    } else if (def.kind === 'effect') {
      checks.push([`effect ${itemId}`, () => { def.use?.({ x: 0, y: 2, z: 24 }); game.advance(0.2); }]);
    } else {
      checks.push([`${def.kind} ${itemId}`, () => {
        const r = game.entities.spawn(itemId, { position: { x: 0, y: 3, z: 24 } });
        if (!r.ok) throw new Error(`could not spawn: ${r.reason}`);
        game.advance(1);
        if (r.entity.dead) return;
        for (const c of r.entity.components) {
          c.interactHint?.();
          c.onInteract?.();
          c.setSignal?.(true);
          c.setSignal?.(false);
        }
        game.damageEntity(r.entity, 1, { kind: 'player' });
        game.advance(0.5);
        if (!r.entity.dead) game.entities.remove(r.entity);
      }]);
    }
  }
  for (const m of record.content.maps) checks.push([`map ${m}`, () => { game.startSession({ map: m }); game.advance(1); game.startSession(); }]);
  for (const m of record.content.modes) checks.push([`mode ${m}`, () => { game.startSession({ mode: m }); game.advance(3); game.mode?.hud(); game.startSession(); }]);
  checks.push(['Mod Menu buttons', () => { for (const b of game.mods.menuButtons()) if (b.mod === record.manifest!.name) b.run(); game.setOverlay(null); game.ui.set({ modMenu: null }); }]);
  checks.push(['reload', () => game.mods.reload(id)]);
  checks.push([`ran the world for ${seconds} seconds`, () => { game.startSession(); game.advance(seconds); }]);

  let failed = 0;
  for (const [name, run] of checks) {
    const before = problems().length;
    let thrown: string | null = null;
    try {
      await run();
    } catch (e) {
      thrown = e instanceof Error ? e.message : String(e);
    }
    const fresh = problems().slice(before);
    const bad = thrown ? [thrown, ...fresh] : fresh;
    console.log(`  ${bad.length ? 'FAIL' : 'ok  '} ${name}`);
    for (const p of [...new Set(bad)].slice(0, 5)) console.log(`       ${p}`);
    if (bad.length) failed++;
    if (game.player.dead) game.player.respawn();
  }
  const after = game.mods.get(id)!;
  if (after.state !== 'loaded') {
    console.log(`  FAIL the mod is "${after.state}" after its reload: ${after.errors.join(' ')}`);
    failed++;
  }
  if (after.host?.phase === 'faulted') {
    console.log(`  FAIL stopped itself: ${after.host.faultReason}`);
    failed++;
  }
  if (game.ui.get().error) {
    console.log(`  FAIL game error: ${game.ui.get().error}`);
    failed++;
  }
  console.log(failed ? `FAILED: ${failed} of ${checks.length} checks.` : `OK: ${checks.length} checks. This shows nothing crashes, not that the mod behaves as intended.`);
  game.dispose();
  return failed ? 1 : 0;
}

/** Facts about a mod: what it declares, whether it loads, and what it registers. */
async function info(dir: string): Promise<number> {
  const b = readFolder(dir);
  const x = examineBundle(b);
  if (!x.manifest) {
    for (const e of x.errors) console.log(`error: ${e}`);
    return 1;
  }
  const m = x.manifest;
  console.log(`${m.name} (${m.id}) v${m.version}, by ${m.author || 'unknown'}`);
  if (m.description) console.log(m.description);
  console.log(`Folder: ${relative(ROOT, dir)}`);
  console.log(`API version: ${m.api_version}. Hot reload: ${m.hot_reload ? 'yes' : 'no'}. Enabled by default: ${m.enabled_by_default ? 'yes' : 'no'}.`);
  console.log(`Permissions: ${m.permissions.join(', ') || 'none'}`);
  console.log(`Depends on: ${m.dependencies.map((d) => `${d.id} ${d.version}${d.optional ? ' (optional)' : ''}`).join(', ') || 'nothing'}`);
  if (m.conflicts.length) console.log(`Conflicts with: ${m.conflicts.join(', ')}`);
  console.log(`Scripts: ${m.scripts.map((s) => `${s} (${(b.files[s] ?? '').split('\n').length} lines)`).join(', ')}`);
  if (m.assets.length) console.log(`Assets: ${m.assets.join(', ')}`);
  const game = await bootGame();
  for (const dep of dependenciesFor(b)) await game.mods.installBundle(dep);
  const r = await game.mods.installBundle(b);
  const rec = r.record;
  console.log(`Load result: ${rec?.state ?? 'invalid'}`);
  for (const e of [...r.errors, ...(rec?.errors ?? [])]) console.log(`  error: ${e}`);
  if (rec?.state === 'loaded') printContent(game, rec.id);
  const ok = rec?.state === 'loaded';
  game.dispose();
  return ok ? 0 : 1;
}

/** Searches the API by word. With an exact name, also prints the fields and the tested example. */
function apiSearch(word: string | undefined): number {
  if (!word) {
    for (const ns of NS_ORDER) console.log(`${ns}: ${ALL_API.filter((f) => f.ns === ns).map((f) => f.name).join(', ')}`);
    console.log(`\nEvents: ${Object.keys(EVENT_NAMES).join(', ')}\n\nSearch with: npm run mod -- api <word>. An exact name, such as entity.spawn, prints its fields and example.`);
    return 0;
  }
  const q = word.toLowerCase();
  const exact = ALL_API.find((f) => `${f.ns}.${f.name}` === q);
  if (exact) {
    console.log(signature(exact));
    console.log(`Permission: ${exact.perm ?? 'none'}${exact.world ? '. Needs a running session' : ''}${exact.loadOnly ? '. Only while the mod loads' : ''}.`);
    console.log(exact.doc);
    for (const p of exact.params) if (p.doc) console.log(`  ${p.name}: ${p.doc}`);
    for (const [k, f] of Object.entries(exact.fields ?? {})) console.log(`  ${k}${f.required ? ' (required)' : ''}: ${typeLabel(f)}. ${f.doc}`);
    console.log(`\nExample:\n${exact.example}`);
    return 0;
  }
  const hits = ALL_API.filter((f) => `${f.ns}.${f.name} ${f.doc} ${Object.keys(f.fields ?? {}).join(' ')}`.toLowerCase().includes(q));
  for (const f of hits) console.log(`${signature(f)}${f.perm ? ` [${f.perm}]` : ''}\n    ${f.doc}`);
  const events = Object.entries(EVENT_NAMES).filter(([k, v]) => `${k} ${v.doc}`.toLowerCase().includes(q));
  for (const [k, v] of events) console.log(`event "${k}" (fields: ${v.fields})\n    ${v.doc}`);
  if (!hits.length && !events.length) {
    console.log(`Nothing matches "${word}". Run this command with no word to see everything.`);
    return 1;
  }
  return 0;
}

function create(name: string | undefined, template = 'starter'): number {
  if (!name || !/^[a-z][a-z0-9_]{1,47}$/.test(name)) {
    console.log('Usage: npm run mod -- new my_mod [template]\nThe id must be lowercase letters, digits and _, starting with a letter.');
    return 1;
  }
  const from = join(ROOT, 'templates', template);
  if (!existsSync(from)) {
    console.log(`No template "${template}". Available: ${readdirSync(join(ROOT, 'templates')).join(', ')}`);
    return 1;
  }
  const to = join(MODS, name);
  if (existsSync(to)) {
    console.log(`mods/${name} already exists.`);
    return 1;
  }
  cpSync(from, to, { recursive: true });
  const m = join(to, 'mod.json');
  writeFileSync(m, readFileSync(m, 'utf8').replaceAll('__MOD_ID__', name));
  console.log(`Created mods/${name} from the "${template}" template.\nNext: edit mods/${name}/main.chaos, then run: npm run mod -- test mods/${name}`);
  return 0;
}

function pack(dir: string): number {
  const b = readFolder(dir);
  if (!staticChecks(b)) return 1;
  const id = (JSON.parse(b.manifest) as { id: string }).id;
  const out = join(ROOT, 'dist-mods', `${id}.chaosmod.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bundleToText(b));
  console.log(`Wrote ${relative(ROOT, out)}. Install it in the game from Mods > Install file.`);
  return 0;
}

/** A ZIP for Import Mod: one folder named after the mod, so that unpacking it by hand also gives the right shape. */
function zipCommand(dir: string, out: string | undefined): number {
  const b = readFolder(dir);
  const x = examineBundle(b);
  for (const e of x.errors) console.log(`  error: ${e}`);
  if (!x.manifest) return 1;
  if (x.errors.length) return 1;
  const m = x.manifest;
  const keep = (rel: string) => !rel.split('/').some((p) => p.startsWith('.')) && (rel === 'mod.json' || /\.(chaos|md|png|jpe?g|webp)$/i.test(rel) || /^(LICENSE|NOTICE)(\.\w+)?$/.test(rel));
  const files = walk(dir).map((p) => relative(dir, p).split(sep).join('/')).filter(keep).sort();
  const entries: ZipInput[] = files.map((rel) => ({ path: `${m.id}/${rel}`, data: new Uint8Array(readFileSync(join(dir, rel))) }));
  const zip = writeZip(entries);
  const folder = resolve(out ?? join(ROOT, 'dist-mods'));
  mkdirSync(folder, { recursive: true });
  const name = `${m.id}-${m.version}.zip`;
  const path = join(folder, name);
  writeFileSync(path, zip);
  const hash = createHash('sha256').update(zip).digest('hex');
  writeFileSync(`${path}.sha256`, `${hash}  ${name}\n`);
  console.log(`Wrote ${relative(ROOT, path)}: ${files.length} files, ${zip.length} bytes.\nSHA-256 ${hash}`);
  return 0;
}

function list(): number {
  const show = (root: string, label: string) => {
    if (!existsSync(root)) return;
    console.log(label);
    for (const name of readdirSync(root).sort()) {
      const path = join(root, name, 'mod.json');
      if (!existsSync(path)) continue;
      try {
        const m = JSON.parse(readFileSync(path, 'utf8')) as { id: string; version: string; name: string; description?: string };
        console.log(`  ${relative(ROOT, join(root, name))}: ${m.id} ${m.version}: ${m.name}`);
      } catch {
        console.log(`  ${relative(ROOT, join(root, name))}: mod.json can't be read`);
      }
    }
  };
  show(MODS, 'Mods in the game:');
  show(join(MODS, 'examples'), 'Reference examples, not part of the game:');
  return 0;
}

const USAGE = `CHAOS LAB mod toolkit

  npm run mod -- new <id> [template]   Create mods/<id> from templates/ (starter, prop, npc, tool, weapon, vehicle, mode)
  npm run mod -- validate <mod>        Check structure, manifest, syntax, API names, permissions and dependencies, then load it for real
  npm run mod -- test <mod> [seconds]  Validate, then spawn and use everything it registers, reload it, and run the world
  npm run mod -- info <mod>            Show what a mod declares, whether it loads, and what it registers
  npm run mod -- list                  List mods and reference examples
  npm run mod -- api [word]            Search the API. An exact name, such as entity.spawn, prints its fields and example
  npm run mod -- pack <mod>            Write dist-mods/<id>.chaosmod.json, installable from the game
  npm run mod -- zip <mod> [folder]    Create <id>-<version>.zip and its SHA-256, for Import Mod in the Mods screen
  npm run mod -- docs [--check]        Regenerate docs/CHAOSSCRIPT_API.md, or fail if it's out of date

  <mod> is a name in mods/ (my_mod) or a path (mods/examples/npc_patrol). Exit code 0 means success.
`;

export const COMMANDS = ['new', 'validate', 'test', 'info', 'list', 'api', 'pack', 'zip', 'docs'];

export async function main(args: string[]): Promise<number> {
  const [cmd, a, b] = args;
  try {
    switch (cmd) {
      case 'new': return create(a, b);
      case 'validate': return await validate(target(a));
      case 'test': return await smokeTest(target(a), Number(b ?? 5));
      case 'info': return await info(target(a));
      case 'list': return list();
      case 'api': return apiSearch(a);
      case 'pack': return pack(target(a));
      case 'zip': return zipCommand(target(a), b);
      case 'docs': {
        const path = join(ROOT, 'docs', 'CHAOSSCRIPT_API.md');
        if (a === '--check') {
          const same = existsSync(path) && readFileSync(path, 'utf8') === generateApiDoc();
          console.log(same ? 'docs/CHAOSSCRIPT_API.md is up to date.' : 'docs/CHAOSSCRIPT_API.md is out of date. Run: npm run mod -- docs');
          return same ? 0 : 1;
        }
        writeFileSync(path, generateApiDoc());
        console.log('Wrote docs/CHAOSSCRIPT_API.md');
        return 0;
      }
      default:
        console.log(USAGE);
        return cmd ? 1 : 0;
    }
  } catch (e) {
    console.log(`Error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
