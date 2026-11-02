import type { FnBody } from './ast';

export type Key = boolean | number | string | Table | ScriptFunction | NativeFunction;
export type Value = null | boolean | number | string | Table | ScriptFunction | NativeFunction | Iter;

export class Env {
  vars = new Map<string, Value>();
  constructor(readonly parent: Env | null) {}
}

export class ScriptFunction {
  constructor(readonly body: FnBody, readonly env: Env, readonly file: string) {}
}

export type NativeImpl = (args: Value[]) => Value | void;

export class NativeFunction {
  constructor(readonly name: string, readonly impl: NativeImpl) {}
}

/** What pairs and ipairs produce. A snapshot, so a loop can safely change the table it walks. */
export class Iter {
  constructor(readonly entries: [Value, Value][]) {}
}

export class Table {
  private map = new Map<Key, Value>();
  private border = 0;
  /** API namespaces can't be changed by scripts. */
  locked = false;

  get(k: Value): Value {
    if (k === null) return null;
    const v = this.map.get(k as Key);
    return v === undefined ? null : v;
  }

  /** Returns true when this added a new key. */
  set(k: Key, v: Value): boolean {
    if (v === null) {
      if (this.map.delete(k) && typeof k === 'number' && k <= this.border && k >= 1) {
        if (Number.isInteger(k)) this.border = k - 1;
      }
      return false;
    }
    const added = !this.map.has(k);
    this.map.set(k, v);
    if (typeof k === 'number' && k === this.border + 1) {
      let n = k;
      while (this.map.has(n + 1)) n++;
      this.border = n;
    }
    return added;
  }

  get length(): number { return this.border; }
  get size(): number { return this.map.size; }
  entries(): IterableIterator<[Key, Value]> { return this.map.entries(); }
  keys(): IterableIterator<Key> { return this.map.keys(); }
  values(): IterableIterator<Value> { return this.map.values(); }

  /** Array part as a list, 1 to length. */
  list(): Value[] {
    const out: Value[] = [];
    for (let i = 1; i <= this.border; i++) out.push(this.map.get(i)!);
    return out;
  }

  /** Replaces the array part. For insert, remove and sort. */
  setList(values: Value[]): void {
    for (let i = 1; i <= this.border; i++) this.map.delete(i);
    this.border = 0;
    values.forEach((v, i) => { if (v !== null) this.set(i + 1, v); });
  }
}

export function typeName(v: Value): string {
  if (v === null) return 'nil';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (v instanceof Table) return 'table';
  if (v instanceof Iter) return 'iterator';
  return 'function';
}

export function isCallable(v: Value): v is ScriptFunction | NativeFunction {
  return v instanceof ScriptFunction || v instanceof NativeFunction;
}

export function numToString(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  if (Number.isNaN(n)) return 'nan';
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  return String(Number(n.toPrecision(14)));
}

export function toDisplay(v: Value, depth = 0): string {
  if (v === null) return 'nil';
  if (typeof v === 'number') return numToString(v);
  if (typeof v === 'string') return depth > 0 ? JSON.stringify(v) : v;
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Table) {
    if (depth >= 3) return '{...}';
    const parts: string[] = [];
    let n = 0;
    for (const [k, x] of v.entries()) {
      if (n++ >= 24) {
        parts.push('...');
        break;
      }
      const isIndex = typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= v.length;
      parts.push(isIndex ? toDisplay(x, depth + 1) : `${typeof k === 'string' ? k : `[${toDisplay(k as Value, depth + 1)}]`}=${toDisplay(x, depth + 1)}`);
    }
    return `{${parts.join(', ')}}`;
  }
  if (v instanceof ScriptFunction) return `function ${v.body.name}`;
  if (v instanceof NativeFunction) return `function ${v.name}`;
  return 'iterator';
}

export type Plain = null | boolean | number | string | Plain[] | { [k: string]: Plain };

/**
 * Script value to plain data, for the API layer. The result has no prototype chain to reach, and functions and cycles are refused.
 * A table is a list only when every key is 1 to n.
 */
export function toPlain(v: Value, where = 'value', depth = 0): Plain {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`${where}: can't store a non-finite number.`);
    return v;
  }
  if (!(v instanceof Table)) throw new Error(`${where}: a ${typeName(v)} can't be converted to data.`);
  if (depth > 32) throw new Error(`${where}: table is nested too deeply, or contains itself.`);
  if (v.size > 0 && v.size === v.length) return v.list().map((x, i) => toPlain(x, `${where}[${i + 1}]`, depth + 1));
  const out = Object.create(null) as { [k: string]: Plain };
  for (const [k, x] of v.entries()) {
    if (typeof k !== 'string' && typeof k !== 'number') throw new Error(`${where}: only string and number keys can be converted to data.`);
    out[String(k)] = toPlain(x, `${where}.${String(k)}`, depth + 1);
  }
  return out;
}

/** Plain data to a fresh script value. */
export function fromPlain(v: unknown, depth = 0): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
  if (depth > 32 || typeof v !== 'object') return null;
  const t = new Table();
  if (Array.isArray(v)) {
    v.forEach((x, i) => {
      const c = fromPlain(x, depth + 1);
      if (c !== null) t.set(i + 1, c);
    });
    return t;
  }
  for (const k of Object.keys(v as object)) {
    const c = fromPlain((v as Record<string, unknown>)[k], depth + 1);
    if (c !== null) t.set(k, c);
  }
  return t;
}
