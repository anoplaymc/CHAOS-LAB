import { safePath } from './manifest';
import type { ModBundle } from './ModManager';
import { extractZipEntry, readZipIndex, ZipError, ZIP_LIMITS, type ZipEntry } from './zip';

export interface ImportProgress { stage: 'read' | 'check' | 'unpack'; done: number; total: number }

export interface ReadOptions {
  signal?: AbortSignal;
  onProgress?: (p: ImportProgress) => void;
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
/** Same as a .chaosmod.json bundle. */
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
/** mod.json may be at the top, in one folder, as in a release, or in two, as in GitHub's ZIP of a repository. */
const MAX_MANIFEST_DEPTH = 2;

const isJunk = (p: string) => p.startsWith('__MACOSX/') || p.split('/').some((s) => s.startsWith('.'));

function base64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Turns a ZIP into a mod bundle, without installing anything. Only the folder holding mod.json is read, and from it
 * only scripts and images: the same data the game's other ways of installing take, so nothing in an archive can run
 * except as ChaosScript in the mod's sandbox. The paths of every file are checked, wanted or not.
 */
export async function readModZip(file: Blob, opts: ReadOptions = {}): Promise<ModBundle> {
  const { signal, onProgress } = opts;
  if (file.size > ZIP_LIMITS.archiveBytes) throw new ZipError(`This archive is too large (limit ${ZIP_LIMITS.archiveBytes / 1024 / 1024} MB).`);
  onProgress?.({ stage: 'read', done: 0, total: 1 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  onProgress?.({ stage: 'check', done: 0, total: 1 });
  const entries = readZipIndex(bytes);
  const files = entries.filter((e) => !e.isDir);

  const manifests = files.filter((e) => !isJunk(e.path) && (e.path === 'mod.json' || e.path.endsWith('/mod.json')));
  if (manifests.length === 0) throw new ZipError('This archive has no mod.json, so it is not a mod.');
  if (manifests.length > 1) throw new ZipError(`This archive holds more than one mod: ${manifests.slice(0, 4).map((m) => m.path).join(', ')}. Import them one at a time.`);
  const manifest = manifests[0]!;
  const prefix = manifest.path.slice(0, -'mod.json'.length);
  if (prefix.split('/').length - 1 > MAX_MANIFEST_DEPTH) throw new ZipError(`mod.json is too deep in this archive, at "${manifest.path}". It should be at the top, or in the mod's own folder.`);

  const wanted: { entry: ZipEntry; rel: string }[] = [];
  for (const e of files) {
    if (!e.path.startsWith(prefix) || e === manifest || isJunk(e.path)) continue;
    const rel = e.path.slice(prefix.length);
    const ext = rel.split('.').pop()!.toLowerCase();
    if (ext !== 'chaos' && !IMAGE_TYPES[ext]) continue;
    if (!safePath(rel)) throw new ZipError(`Refused: "${rel}" isn't an allowed file name. Use letters, digits, "_", "-", "." and "/".`);
    wanted.push({ entry: e, rel });
  }

  const bundle: ModBundle = { origin: 'local', manifest: '', files: {}, assets: {} };
  const total = wanted.length + 1;
  const text = new TextDecoder('utf-8', { fatal: true });
  const asText = (data: Uint8Array, path: string): string => {
    try {
      return text.decode(data);
    } catch {
      throw new ZipError(`"${path}" is not valid text.`);
    }
  };
  bundle.manifest = asText(await extractZipEntry(bytes, manifest, signal), manifest.path);
  let done = 1;
  let used = bundle.manifest.length;
  for (const { entry, rel } of wanted) {
    onProgress?.({ stage: 'unpack', done, total });
    const data = await extractZipEntry(bytes, entry, signal);
    const ext = rel.split('.').pop()!.toLowerCase();
    if (ext === 'chaos') {
      bundle.files[rel] = asText(data, rel);
      used += data.length;
    } else {
      bundle.assets![rel] = `data:${IMAGE_TYPES[ext]};base64,${base64(data)}`;
      used += bundle.assets![rel]!.length;
    }
    if (used > MAX_BUNDLE_BYTES) throw new ZipError(`This mod is too large (limit ${MAX_BUNDLE_BYTES / 1024 / 1024} MB of scripts and images).`);
    done++;
  }
  onProgress?.({ stage: 'unpack', done: total, total });
  return bundle;
}
