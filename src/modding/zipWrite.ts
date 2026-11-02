import { deflateRawSync } from 'node:zlib';
import { crc32 } from './zip';

/** Options exist so that tests can build the broken and hostile archives the reader has to refuse. */
export interface ZipInput {
  path: string;
  data?: Uint8Array | string;
  store?: boolean;
  flags?: number;
  /** Unix file mode, such as 0o120777 for a symbolic link. */
  mode?: number;
  method?: number;
  declaredSize?: number;
  /** A different name in the file's own header than in the index. */
  localPath?: string;
  crc?: number;
}

/** Builds a ZIP in memory, for the toolkit and tests. Node only: the game itself only reads them. Timestamps are fixed, so the same files give the same bytes. */
export function writeZip(inputs: ZipInput[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (2026 - 1980) << 9 | (1 << 5) | 1;
  for (const f of inputs) {
    const name = enc.encode(f.path);
    const localName = enc.encode(f.localPath ?? f.path);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data ?? new Uint8Array();
    const isDir = f.path.endsWith('/');
    const store = f.store || isDir || data.length === 0;
    const body = store ? data : new Uint8Array(deflateRawSync(data, { level: 9 }));
    const method = f.method ?? (store ? 0 : 8);
    const crc = f.crc ?? crc32(data);
    const size = f.declaredSize ?? data.length;
    const flags = (f.flags ?? 0) | 0x0800;

    const local = new Uint8Array(30 + localName.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, localName.length, true);
    local.set(localName, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, ((f.mode ?? (isDir ? 0o040755 : 0o100644)) << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, inputs.length, true);
  ev.setUint16(10, inputs.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + dirSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
