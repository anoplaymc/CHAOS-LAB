import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Game } from '../game/core/Game';
import { main, readFolder } from '../modding/cli';
import { readModZip } from '../modding/modImport';
import { extractZipEntry, readZipIndex, ZipError, ZIP_LIMITS } from '../modding/zip';
import { writeZip, type ZipInput } from '../modding/zipWrite';

const manifest = (o: Record<string, unknown> = {}) => JSON.stringify({ id: 'zip_mod', name: 'Zip Mod', version: '2.1.0', author: 'Tester', description: 'From a ZIP.', api_version: '1.0', permissions: ['ui'], scripts: ['main.chaos'], ...o });
const SCRIPT = 'global loaded_from_zip = true';
const asBlob = (b: Uint8Array) => new Blob([b.slice()]);
const read = (inputs: ZipInput[]) => readModZip(asBlob(writeZip(inputs)));
const good = (prefix = '', o: Record<string, unknown> = {}): ZipInput[] => [{ path: `${prefix}mod.json`, data: manifest(o) }, { path: `${prefix}main.chaos`, data: SCRIPT }];

async function refused(inputs: ZipInput[], message: RegExp): Promise<void> {
  await expect(read(inputs)).rejects.toThrow(message);
  await expect(read(inputs)).rejects.toBeInstanceOf(ZipError);
}

describe('the archive itself', () => {
  it('reads what it wrote, stored or compressed', async () => {
    const z = writeZip([{ path: 'a.txt', data: 'hello hello hello hello' }, { path: 'b.txt', data: 'stored', store: true }, { path: 'dir/' }]);
    const entries = readZipIndex(z);
    expect(entries.map((e) => [e.path, e.isDir])).toEqual([['a.txt', false], ['b.txt', false], ['dir/', true]]);
    expect(new TextDecoder().decode(await extractZipEntry(z, entries[0]!))).toBe('hello hello hello hello');
    expect(new TextDecoder().decode(await extractZipEntry(z, entries[1]!))).toBe('stored');
  });

  it.each([
    ['../evil.chaos', /climbs out/],
    ['mod/../../evil.chaos', /climbs out/],
    ['a/..', /climbs out/],
    ['/etc/passwd', /absolute path/],
    ['C:/Windows/evil.chaos', /drive letter/],
    ['mod\\..\\evil.chaos', /backslash/],
    ['a//b.chaos', /malformed/],
    ['./a.chaos', /malformed/],
    ['a\u0000.chaos', /control characters/],
  ])('refuses the path %s, even outside the mod', async (path, message) => {
    await refused([...good('m/'), { path, data: 'x' }], message);
  });

  it('refuses links, encryption, duplicates and unknown compression', async () => {
    await refused([...good(), { path: 'link', data: '/etc/passwd', mode: 0o120777 }], /symbolic link/);
    await refused([...good(), { path: 'e.chaos', data: 'x', flags: 1 }], /encrypted/);
    await refused([...good(), { path: 'MAIN.chaos', data: 'x' }], /more than once/);
    await refused([...good(), { path: 'x.chaos', data: 'abc', method: 12 }], /compression method/);
  });

  it('refuses archives over the limits, before unpacking them', async () => {
    const many: ZipInput[] = Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => ({ path: `f${i}.txt`, data: 'x', store: true }));
    await refused(many, /too many files/);
    await refused([...good(), { path: 'big.chaos', data: 'x', declaredSize: ZIP_LIMITS.entryBytes + 1 }], /too large/);
    const bulky: ZipInput[] = Array.from({ length: 9 }, (_, i) => ({ path: `b${i}.bin`, data: 'x', declaredSize: 4 * 1024 * 1024 }));
    await refused(bulky, /too much data/);
    await expect(readModZip(new Blob([new Uint8Array(ZIP_LIMITS.archiveBytes + 1)]))).rejects.toThrow(/too large/);
  });

  it('holds a file to the size it declared, so a zip bomb stops at once', async () => {
    const bomb = new Uint8Array(4 * 1024 * 1024);
    await refused([{ path: 'mod.json', data: manifest() }, { path: 'main.chaos', data: bomb, declaredSize: 100 }], /more than it declares/);
  });

  it('notices damage and misdirection', async () => {
    await refused([{ path: 'mod.json', data: manifest() }, { path: 'main.chaos', data: SCRIPT, crc: 12345 }], /checksum/);
    await refused([{ path: 'mod.json', data: manifest() }, { path: 'main.chaos', data: SCRIPT, localPath: '../main.chaos' }], /different name/);
    await expect(readModZip(new Blob(['this is not a zip at all, not even slightly']))).rejects.toThrow(/not a ZIP/);
    await expect(readModZip(new Blob([]))).rejects.toThrow(/not a ZIP/);
    const z = writeZip(good());
    await expect(readModZip(asBlob(z.subarray(0, z.length - 30)))).rejects.toThrow(/not a ZIP|damaged/);
    const cut = z.slice();
    cut.fill(0xff, 40, 80);
    await expect(readModZip(asBlob(cut))).rejects.toBeInstanceOf(ZipError);
  });

  it('can be cancelled', async () => {
    const c = new AbortController();
    const seen: string[] = [];
    const running = readModZip(asBlob(writeZip(good())), { signal: c.signal, onProgress: (p) => { seen.push(p.stage); c.abort(); } });
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toContain('read');
  });
});

describe('finding the mod in an archive', () => {
  it.each([
    ['at the top', ''],
    ['in its own folder, as in a release', 'zip_mod/'],
    ['in a repository\'s folder, as in GitHub\'s ZIP', 'CHAOS-OVERDRIVE-main/zip_mod/'],
  ])('%s', async (_, prefix) => {
    const b = await read([...good(prefix), { path: `${prefix}README.md`, data: '# hi' }, { path: `${prefix}assets/a.png`, data: 'png' }]);
    expect(JSON.parse(b.manifest).id).toBe('zip_mod');
    expect(Object.keys(b.files)).toEqual(['main.chaos']);
    expect(b.assets!['assets/a.png']).toBe(`data:image/png;base64,${btoa('png')}`);
  });

  it('takes only that folder, and only scripts and images', async () => {
    const b = await read([
      ...good('repo/m/'),
      { path: 'repo/README.md', data: '# docs' },
      { path: 'repo/docs/shot.png', data: 'outside' },
      { path: 'repo/examples/x.chaos', data: 'error("outside")' },
      { path: 'repo/m/run.js', data: 'alert(1)' },
      { path: 'repo/m/page.html', data: '<script>' },
    ]);
    expect(Object.keys(b.files)).toEqual(['main.chaos']);
    expect(Object.keys(b.assets!)).toEqual([]);
    expect(JSON.stringify(b)).not.toContain('alert(1)');
  });

  it('ignores macOS junk when looking for it', async () => {
    const b = await read([...good('m/'), { path: '__MACOSX/m/mod.json', data: 'junk' }, { path: 'm/.hidden/mod.json', data: 'junk' }]);
    expect(JSON.parse(b.manifest).id).toBe('zip_mod');
  });

  it('refuses no mod, two mods, a buried one and a script with an unsafe name', async () => {
    await refused([{ path: 'readme.txt', data: 'x' }], /no mod\.json/);
    await refused([...good('a/'), ...good('b/')], /more than one mod/);
    await refused(good('a/b/c/'), /too deep/);
    await refused([...good('m/'), { path: 'm/bad name.chaos', data: 'x' }], /allowed file name/);
  });
});

describe('previewing and installing', () => {
  let game: Game;
  beforeAll(async () => {
    await Game.init();
    game = new Game();
    game.input.virtualLock = true;
    game.startSession();
    await game.mods.installBundle({ origin: 'local', manifest: JSON.stringify({ id: 'base_mod', name: 'Base', version: '1.0.0', author: 'a', description: 'd', api_version: '1.0', scripts: ['m.chaos'] }), files: { 'm.chaos': 'global x = 1' } });
  });
  afterAll(() => game.dispose());

  it('shows the facts, and changes nothing', async () => {
    const b = await read(good());
    const before = game.mods.list().map((r) => r.id);
    const p = game.mods.previewImport(b);
    expect(p.errors).toEqual([]);
    expect(p.manifest).toMatchObject({ name: 'Zip Mod', version: '2.1.0', author: 'Tester', permissions: ['ui'] });
    expect(p.replaces).toBeNull();
    expect(game.mods.list().map((r) => r.id)).toEqual(before);
    expect(game.mods.get('zip_mod')).toBeUndefined();
  });

  it('refuses a mod for a newer API, a bad manifest and a missing or broken script', async () => {
    expect(game.mods.previewImport(await read(good('', { api_version: '1.99' }))).errors.join()).toMatch(/needs API version 1.99/);
    expect(game.mods.previewImport(await read(good('', { api_version: '2.0' }))).errors.join()).toMatch(/needs API version 2.0/);
    expect(game.mods.previewImport(await read(good('', { id: 'BAD ID' }))).errors.join()).toMatch(/id "BAD ID" is invalid/);
    expect(game.mods.previewImport(await read(good('', { permissions: ['network'] }))).errors.join()).toMatch(/unknown permission/);
    expect(game.mods.previewImport(await read([{ path: 'mod.json', data: '{ not json' }])).errors.join()).toMatch(/not valid JSON/);
    expect(game.mods.previewImport(await read([{ path: 'mod.json', data: manifest() }])).errors.join()).toMatch(/file is missing/);
    expect(game.mods.previewImport(await read([{ path: 'mod.json', data: manifest() }, { path: 'main.chaos', data: 'if then' }])).errors.length).toBeGreaterThan(0);
    const r = await game.mods.installBundle(await read(good('', { api_version: '1.99' })), { followManifest: true });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(game.mods.get('zip_mod')).toBeUndefined();
  });

  it('reports dependencies and conflicts', async () => {
    const p = game.mods.previewImport(await read(good('', { dependencies: ['base_mod', { id: 'base_mod2', optional: true }, 'nothing_here', { id: 'base_mod', version: '^9.0.0' }], conflicts: ['base_mod'] })));
    expect(p.dependencies.map((d) => d.status)).toEqual(['ok', 'missing', 'missing', 'wrong_version']);
    expect(p.dependencies[1]!.optional).toBe(true);
    expect(p.conflicts).toEqual(['base_mod']);
  });

  it('says when it would replace another mod', async () => {
    const p = game.mods.previewImport(await read(good('', { id: 'base_mod' })));
    expect(p.replaces).toEqual({ name: 'Base', version: '1.0.0', bundled: false });
  });

  it('installs a mod the way its manifest says, then disables and removes it, leaving others alone', async () => {
    const off = await game.mods.installBundle(await read(good('', { enabled_by_default: false })), { followManifest: true });
    expect(off.record!.state).toBe('disabled');
    expect(off.record!.enabled).toBe(false);
    await game.mods.setEnabled('zip_mod', true);
    expect(game.mods.get('zip_mod')!.state).toBe('loaded');
    expect(game.mods.get('base_mod')!.state).toBe('loaded');
    await game.mods.setEnabled('zip_mod', false);
    expect(game.mods.get('zip_mod')!.state).toBe('disabled');
    await game.mods.uninstall('zip_mod');
    expect(game.mods.get('zip_mod')).toBeUndefined();
    expect(game.mods.get('base_mod')!.state).toBe('loaded');
    const on = await game.mods.installBundle(await read(good()), { followManifest: true });
    expect(on.record!.state).toBe('loaded');
    await game.mods.uninstall('zip_mod');
  });
});

describe('npm run mod -- zip', () => {
  it('makes an archive that imports to exactly the same mod, with one folder at the top', async () => {
    const out = mkdtempSync(join(tmpdir(), 'modzip-'));
    try {
      expect(await main(['zip', 'mods/robot_pack', out])).toBe(0);
      const version = JSON.parse(readFileSync('mods/robot_pack/mod.json', 'utf8')).version as string;
      const path = join(out, `robot_pack-${version}.zip`);
      const bytes = new Uint8Array(readFileSync(path));
      const paths = readZipIndex(bytes).map((e) => e.path);
      expect(new Set(paths.map((p) => p.split('/')[0]))).toEqual(new Set(['robot_pack']));
      expect(paths).toContain('robot_pack/mod.json');
      const b = await readModZip(new Blob([bytes]));
      const source = readFolder('mods/robot_pack');
      expect(b.manifest).toBe(source.manifest);
      expect(b.files).toEqual(source.files);
      expect(readFileSync(`${path}.sha256`, 'utf8')).toMatch(/^[0-9a-f]{64} {2}robot_pack-[\d.]+\.zip\n$/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
