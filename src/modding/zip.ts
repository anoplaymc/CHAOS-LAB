/**
 * A small, strict ZIP reader for mod archives. Nothing here touches a disk. An archive is hostile until proven
 * otherwise, so anything unusual fails the whole archive rather than being skipped: its index is checked before any
 * of it is decompressed, and decompression is held to the sizes the index declares.
 */

export const ZIP_LIMITS = {
  archiveBytes: 16 * 1024 * 1024,
  entries: 512,
  entryBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  pathLength: 400,
};

export class ZipError extends Error {}

export interface ZipEntry {
  path: string;
  isDir: boolean;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  headerOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Why a path can't be accepted, or null. Everything that could lead outside the mod's own folder is refused. */
export function unsafeZipPath(path: string): string | null {
  if (path.length === 0) return 'an empty name';
  if (path.length > ZIP_LIMITS.pathLength) return 'a name that is too long';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'control characters in its name';
  if (path.includes('\\')) return 'a backslash in its name';
  if (path.startsWith('/')) return 'an absolute path';
  if (/^[A-Za-z]:/.test(path)) return 'a drive letter';
  const parts = path.replace(/\/$/, '').split('/');
  if (parts.some((p) => p === '..')) return 'a path that climbs out of the archive';
  if (parts.some((p) => p === '.' || p === '')) return 'a malformed path';
  return null;
}

function findEnd(view: DataView): number {
  const last = view.byteLength - 22;
  const first = Math.max(0, last - 0xffff);
  for (let i = last; i >= first; i--) {
    if (view.getUint32(i, true) === EOCD && i + 22 + view.getUint16(i + 20, true) === view.byteLength) return i;
  }
  throw new ZipError('This is not a ZIP archive, or it is damaged.');
}

/** Reads and checks the archive's index. Nothing is decompressed yet. */
export function readZipIndex(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length > ZIP_LIMITS.archiveBytes) throw new ZipError(`This archive is too large (limit ${ZIP_LIMITS.archiveBytes / 1024 / 1024} MB).`);
  if (bytes.length < 22) throw new ZipError('This is not a ZIP archive, or it is damaged.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(view);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new ZipError('Archives split across several files are not supported.');
  const count = view.getUint16(end + 10, true);
  const dirSize = view.getUint32(end + 12, true);
  const dirStart = view.getUint32(end + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirStart === 0xffffffff) throw new ZipError('ZIP64 archives are not supported.');
  if (count > ZIP_LIMITS.entries) throw new ZipError(`This archive has too many files: ${count} (limit ${ZIP_LIMITS.entries}).`);
  if (dirStart + dirSize > end) throw new ZipError('This ZIP archive is damaged: its index is out of bounds.');

  const names = new TextDecoder('utf-8', { fatal: true });
  const seen = new Set<string>();
  const out: ZipEntry[] = [];
  let at = dirStart;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL) throw new ZipError('This ZIP archive is damaged: its index is unreadable.');
    const madeBy = view.getUint16(at + 4, true) >>> 8;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const external = view.getUint32(at + 38, true);
    const headerOffset = view.getUint32(at + 42, true);
    if (at + 46 + nameLen > end) throw new ZipError('This ZIP archive is damaged: a file name is out of bounds.');
    let path: string;
    try {
      path = names.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    } catch {
      throw new ZipError('This archive has a file name that is not valid text.');
    }
    at += 46 + nameLen + extraLen + commentLen;

    const unsafe = unsafeZipPath(path);
    if (unsafe) throw new ZipError(`Refused: "${path.slice(0, 80)}" has ${unsafe}.`);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new ZipError(`Refused: "${path}" appears more than once.`);
    seen.add(key);
    if (madeBy === 3 && ((external >>> 16) & S_IFMT) === S_IFLNK) throw new ZipError(`Refused: "${path}" is a symbolic link.`);
    if (flags & 1) throw new ZipError(`Refused: "${path}" is encrypted.`);
    const isDir = path.endsWith('/');
    if (!isDir && method !== 0 && method !== 8) throw new ZipError(`"${path}" uses a compression method that isn't supported.`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || headerOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported.');
    if (size > ZIP_LIMITS.entryBytes) throw new ZipError(`"${path}" is too large (limit ${ZIP_LIMITS.entryBytes / 1024 / 1024} MB per file).`);
    total += size;
    if (total > ZIP_LIMITS.totalBytes) throw new ZipError(`This archive unpacks to too much data (limit ${ZIP_LIMITS.totalBytes / 1024 / 1024} MB).`);
    out.push({ path, isDir, method, compressedSize, size, crc, headerOffset });
  }
  if (at !== dirStart + dirSize) throw new ZipError('This ZIP archive is damaged: its index has the wrong size.');
  return out;
}

const aborted = () => new DOMException('The import was cancelled.', 'AbortError');

/** Unpacks one file, holding it to its declared size and checksum whatever the data really expands to. */
export async function extractZipEntry(bytes: Uint8Array, entry: ZipEntry, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw aborted();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = entry.headerOffset;
  if (h + 30 > bytes.length || view.getUint32(h, true) !== LOCAL) throw new ZipError(`This ZIP archive is damaged: "${entry.path}" can't be found.`);
  const nameLen = view.getUint16(h + 26, true);
  const extraLen = view.getUint16(h + 28, true);
  const start = h + 30 + nameLen + extraLen;
  const stop = start + entry.compressedSize;
  if (stop > bytes.length) throw new ZipError(`This ZIP archive is damaged: "${entry.path}" is cut short.`);
  // Tools can disagree on which name counts, so an archive showing two different ones isn't trusted at all.
  if (new TextDecoder().decode(bytes.subarray(h + 30, h + 30 + nameLen)) !== entry.path) throw new ZipError(`Refused: "${entry.path}" has a different name inside the archive.`);
  const raw = bytes.subarray(start, stop);
  let data: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw new ZipError(`This ZIP archive is damaged: "${entry.path}" has the wrong size.`);
    data = raw;
  } else {
    data = await inflate(raw, entry, signal);
  }
  if (data.length !== entry.size) throw new ZipError(`This ZIP archive is damaged: "${entry.path}" has the wrong size.`);
  if (crc32(data) !== entry.crc) throw new ZipError(`This ZIP archive is damaged: "${entry.path}" fails its checksum.`);
  return data;
}

async function inflate(raw: Uint8Array, entry: ZipEntry, signal?: AbortSignal): Promise<Uint8Array> {
  const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const out = new Uint8Array(entry.size);
  let n = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw aborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > entry.size) throw new ZipError(`Refused: "${entry.path}" unpacks to more than it declares.`);
      out.set(value, n);
      n += value.length;
    }
  } catch (e) {
    if (e instanceof ZipError || (e instanceof DOMException && e.name === 'AbortError')) throw e;
    throw new ZipError(`This ZIP archive is damaged: "${entry.path}" can't be unpacked.`);
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return out.subarray(0, n);
}
