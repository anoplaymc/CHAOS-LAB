import { ChaosError, ChaosLimitError } from './errors';
import type { Interpreter } from './interpreter';
import { isCallable, Iter, NativeFunction, numToString, Table, toDisplay, typeName, type NativeImpl, type Value } from './values';

/** One documented standard library entry. Docs and the linter read these. */
export interface StdEntry { sig: string; doc: string; impl: (vm: Interpreter, a: Value[], rng: () => number) => Value | void }

const fail = (msg: string): never => {
  throw new ChaosError(msg);
};

const num = (fn: string, a: Value[], i: number): number => {
  const v = a[i];
  if (typeof v !== 'number') fail(`${fn}: argument ${i + 1} must be a number, got ${typeName(v ?? null)}.`);
  return v as number;
};
const str = (fn: string, a: Value[], i: number): string => {
  const v = a[i];
  if (typeof v === 'number') return numToString(v);
  if (typeof v !== 'string') fail(`${fn}: argument ${i + 1} must be a string, got ${typeName(v ?? null)}.`);
  return v as string;
};
const tbl = (fn: string, a: Value[], i: number): Table => {
  const v = a[i];
  if (!(v instanceof Table)) fail(`${fn}: argument ${i + 1} must be a table, got ${typeName(v ?? null)}.`);
  return v as Table;
};
const optNum = (fn: string, a: Value[], i: number, d: number): number => (a[i] === undefined || a[i] === null ? d : num(fn, a, i));

export const BASE_LIB: Record<string, StdEntry> = {
  type: { sig: 'type(v) -> string', doc: 'Name of the type: "nil", "boolean", "number", "string", "table" or "function".', impl: (_, a) => typeName(a[0] ?? null) },
  tostring: { sig: 'tostring(v) -> string', doc: 'Text form of any value. Tables are shown a few levels deep.', impl: (_, a) => toDisplay(a[0] ?? null) },
  tonumber: {
    sig: 'tonumber(v) -> number or nil', doc: 'Converts a string to a number. Returns nil if it cannot.',
    impl: (_, a) => {
      const v = a[0] ?? null;
      if (typeof v === 'number') return v;
      if (typeof v !== 'string' || v.trim() === '') return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    },
  },
  pairs: { sig: 'pairs(t) -> iterator', doc: 'Every key and value of t, in insertion order, for use with for ... in. The loop sees a snapshot.', impl: (vm, a) => { const t = tbl('pairs', a, 0); vm.burn(t.size >> 3); return new Iter([...t.entries()] as [Value, Value][]); } },
  ipairs: { sig: 'ipairs(t) -> iterator', doc: 'Index and value for 1, 2, 3... up to the first nil, for use with for ... in.', impl: (vm, a) => { const t = tbl('ipairs', a, 0); vm.burn(t.length >> 3); return new Iter(t.list().map((v, i) => [i + 1, v] as [Value, Value])); } },
  error: { sig: 'error(message)', doc: 'Raises an error. Stops the current callback unless caught by pcall.', impl: (_, a) => fail(toDisplay(a[0] ?? null)) },
  assert: { sig: 'assert(v, message) -> v', doc: 'Raises an error if v is nil or false, otherwise returns v.', impl: (_, a) => { const v = a[0] ?? null; if (v === null || v === false) fail(a[1] === undefined ? 'Assertion failed.' : toDisplay(a[1])); return v; } },
  pcall: {
    sig: 'pcall(f, arg1, arg2...) -> {ok, value, error}', doc: 'Calls f and catches script errors. The result has ok=true and value, or ok=false and error. Budget and memory limits cannot be caught.',
    impl: (vm, a) => {
      const t = new Table();
      try {
        const v = vm.callValue(a[0] ?? null, a.slice(1), 'pcall');
        t.set('ok', true);
        if (v !== null) t.set('value', v);
      } catch (e) {
        if (e instanceof ChaosLimitError || !(e instanceof ChaosError)) throw e;
        t.set('ok', false);
        t.set('error', e.message);
      }
      return t;
    },
  },
};

export const MATH_LIB: Record<string, StdEntry> = {
  floor: { sig: 'math.floor(x)', doc: 'Rounds down.', impl: (_, a) => Math.floor(num('math.floor', a, 0)) },
  ceil: { sig: 'math.ceil(x)', doc: 'Rounds up.', impl: (_, a) => Math.ceil(num('math.ceil', a, 0)) },
  round: { sig: 'math.round(x)', doc: 'Rounds to the nearest integer.', impl: (_, a) => Math.round(num('math.round', a, 0)) },
  abs: { sig: 'math.abs(x)', doc: 'Absolute value.', impl: (_, a) => Math.abs(num('math.abs', a, 0)) },
  sqrt: { sig: 'math.sqrt(x)', doc: 'Square root.', impl: (_, a) => Math.sqrt(num('math.sqrt', a, 0)) },
  sin: { sig: 'math.sin(x)', doc: 'Sine, in radians.', impl: (_, a) => Math.sin(num('math.sin', a, 0)) },
  cos: { sig: 'math.cos(x)', doc: 'Cosine, in radians.', impl: (_, a) => Math.cos(num('math.cos', a, 0)) },
  atan2: { sig: 'math.atan2(y, x)', doc: 'Angle of a vector, in radians.', impl: (_, a) => Math.atan2(num('math.atan2', a, 0), num('math.atan2', a, 1)) },
  min: { sig: 'math.min(a, b)', doc: 'The smaller of two numbers.', impl: (_, a) => Math.min(num('math.min', a, 0), num('math.min', a, 1)) },
  max: { sig: 'math.max(a, b)', doc: 'The larger of two numbers.', impl: (_, a) => Math.max(num('math.max', a, 0), num('math.max', a, 1)) },
  clamp: { sig: 'math.clamp(x, lo, hi)', doc: 'Limits x to the range lo to hi.', impl: (_, a) => Math.min(num('math.clamp', a, 2), Math.max(num('math.clamp', a, 1), num('math.clamp', a, 0))) },
  lerp: { sig: 'math.lerp(a, b, t)', doc: 'Blends from a to b by t.', impl: (_, a) => { const x = num('math.lerp', a, 0); return x + (num('math.lerp', a, 1) - x) * num('math.lerp', a, 2); } },
  random: {
    sig: 'math.random(lo, hi)', doc: 'With no arguments, a float from 0 up to 1. With two, a whole number from lo to hi inclusive.',
    impl: (_, a, rng) => {
      if (a.length === 0 || a[0] === null) return rng();
      const lo = Math.ceil(num('math.random', a, 0));
      const hi = Math.floor(num('math.random', a, 1));
      if (hi < lo) fail('math.random: hi must not be below lo.');
      return lo + Math.floor(rng() * (hi - lo + 1));
    },
  },
};

export const MATH_CONSTANTS: Record<string, number> = { pi: Math.PI, huge: Infinity };

export const STRING_LIB: Record<string, StdEntry> = {
  len: { sig: 'string.len(s)', doc: 'Number of characters. Same as #s.', impl: (_, a) => str('string.len', a, 0).length },
  upper: { sig: 'string.upper(s)', doc: 'Upper case.', impl: (_, a) => str('string.upper', a, 0).toUpperCase() },
  lower: { sig: 'string.lower(s)', doc: 'Lower case.', impl: (_, a) => str('string.lower', a, 0).toLowerCase() },
  trim: { sig: 'string.trim(s)', doc: 'Removes whitespace at both ends.', impl: (_, a) => str('string.trim', a, 0).trim() },
  sub: {
    sig: 'string.sub(s, from, to)', doc: 'Part of a string, 1-based and inclusive. Negative positions count from the end.',
    impl: (_, a) => {
      const s = str('string.sub', a, 0);
      let from = optNum('string.sub', a, 1, 1);
      let to = optNum('string.sub', a, 2, -1);
      if (from < 0) from = Math.max(1, s.length + from + 1);
      if (to < 0) to = s.length + to + 1;
      return s.slice(Math.max(0, from - 1), Math.max(0, to));
    },
  },
  find: { sig: 'string.find(s, text, from)', doc: 'Position of plain text, or nil. There are no patterns.', impl: (_, a) => { const i = str('string.find', a, 0).indexOf(str('string.find', a, 1), optNum('string.find', a, 2, 1) - 1); return i < 0 ? null : i + 1; } },
  starts_with: { sig: 'string.starts_with(s, prefix)', doc: 'True if s begins with prefix.', impl: (_, a) => str('string.starts_with', a, 0).startsWith(str('string.starts_with', a, 1)) },
  ends_with: { sig: 'string.ends_with(s, suffix)', doc: 'True if s ends with suffix.', impl: (_, a) => str('string.ends_with', a, 0).endsWith(str('string.ends_with', a, 1)) },
  replace: {
    sig: 'string.replace(s, from, to)', doc: 'Replaces every occurrence of plain text.',
    impl: (vm, a) => {
      const s = str('string.replace', a, 0);
      const from = str('string.replace', a, 1);
      if (from === '') fail('string.replace: the text to replace cannot be empty.');
      vm.burn(s.length >> 4);
      const to = str('string.replace', a, 2);
      const parts = s.split(from);
      // Checked before joining, so a huge result is refused without being built.
      if (s.length + (parts.length - 1) * to.length > vm.limits.stringLength) throw new ChaosLimitError('string.replace: result is too long.', 'memory');
      return parts.join(to);
    },
  },
  rep: {
    sig: 'string.rep(s, n)', doc: 'Repeats s n times.',
    impl: (vm, a) => {
      const s = str('string.rep', a, 0);
      const n = Math.max(0, Math.floor(num('string.rep', a, 1)));
      if (s.length * n > vm.limits.stringLength) throw new ChaosLimitError('string.rep: result is too long.', 'memory');
      vm.burn((s.length * n) >> 4);
      return s.repeat(n);
    },
  },
  split: {
    sig: 'string.split(s, sep)', doc: 'Splits into a list on plain text.',
    impl: (vm, a) => {
      const sep = str('string.split', a, 1);
      if (sep === '') fail('string.split: the separator cannot be empty.');
      const t = new Table();
      str('string.split', a, 0).split(sep).forEach((p, i) => vm.tableSet(t, i + 1, p));
      return t;
    },
  },
  format: {
    sig: 'string.format(fmt, a, b...)', doc: 'Fills %s (any value), %d (whole number), %f or %.2f (decimal) and %% (a percent sign).',
    impl: (vm, a) => {
      let i = 1;
      const out = str('string.format', a, 0).replace(/%(?:(\.\d+)?f|[sd%])/g, (m, prec: string | undefined) => {
        if (m === '%%') return '%';
        if (i >= a.length) fail(`string.format: no value for ${m}.`);
        const v = a[i++]!;
        if (m === '%s') return toDisplay(v);
        if (typeof v !== 'number') fail(`string.format: ${m} needs a number, got ${typeName(v)}.`);
        const n = v as number;
        if (m === '%d') return String(Math.trunc(n));
        return n.toFixed(prec ? Math.min(20, Number(prec.slice(1))) : 6);
      });
      return vm.checkString(out);
    },
  },
};

export const TABLE_LIB: Record<string, StdEntry> = {
  insert: {
    sig: 'table.insert(t, value) or table.insert(t, pos, value)', doc: 'Adds to the end, or at a position, moving later items up.',
    impl: (vm, a) => {
      const t = tbl('table.insert', a, 0);
      if (a.length >= 3) {
        const pos = num('table.insert', a, 1);
        if (t.locked) fail('This table is read-only.');
        if (!Number.isInteger(pos) || pos < 1 || pos > t.length + 1) fail(`table.insert: position ${pos} is out of range.`);
        vm.burn(t.length >> 3);
        const l = t.list();
        l.splice(pos - 1, 0, a[2] ?? null);
        t.setList(l);
      } else {
        vm.tableSet(t, t.length + 1, a[1] ?? null);
      }
    },
  },
  remove: {
    sig: 'table.remove(t, pos) -> value', doc: 'Removes and returns the item at a position, or the last item, moving later items down.',
    impl: (vm, a) => {
      const t = tbl('table.remove', a, 0);
      if (t.locked) fail('This table is read-only.');
      if (t.length === 0) return null;
      const pos = optNum('table.remove', a, 1, t.length);
      if (!Number.isInteger(pos) || pos < 1 || pos > t.length) return null;
      vm.burn(t.length >> 3);
      const l = t.list();
      const [v] = l.splice(pos - 1, 1);
      t.setList(l);
      return v ?? null;
    },
  },
  concat: {
    sig: 'table.concat(t, sep)', doc: 'Joins a list of strings and numbers.',
    impl: (vm, a) => {
      const t = tbl('table.concat', a, 0);
      vm.burn(t.length >> 2);
      const sep = a[1] === undefined || a[1] === null ? '' : str('table.concat', a, 1);
      const items = t.list().map((v, i) => {
        if (typeof v === 'number') return numToString(v);
        if (typeof v !== 'string') fail(`table.concat: item ${i + 1} is a ${typeName(v)}, not a string or number.`);
        return v as string;
      });
      let total = sep.length * items.length;
      for (const s of items) total += s.length;
      if (total > vm.limits.stringLength) throw new ChaosLimitError('table.concat: result is too long.', 'memory');
      return items.join(sep);
    },
  },
  sort: {
    sig: 'table.sort(t, less)', doc: 'Sorts a list in place. less(a, b) is optional and returns true if a comes first.',
    impl: (vm, a) => {
      const t = tbl('table.sort', a, 0);
      if (t.locked) fail('This table is read-only.');
      const less = a[1] ?? null;
      if (less !== null && !isCallable(less)) fail('table.sort: the second argument must be a function.');
      const l = t.list();
      vm.burn(l.length);
      l.sort((x, y) => {
        vm.burn(1);
        if (less) {
          const lt = (p: Value, q: Value) => { const r = vm.callValue(less, [p, q], 'table.sort'); return r !== null && r !== false; };
          return lt(x, y) ? -1 : lt(y, x) ? 1 : 0;
        }
        if (typeof x === 'number' && typeof y === 'number') return x - y;
        if (typeof x === 'string' && typeof y === 'string') return x < y ? -1 : x > y ? 1 : 0;
        return fail(`table.sort: can't compare ${typeName(x)} with ${typeName(y)} without a function.`);
      });
      t.setList(l);
    },
  },
  keys: { sig: 'table.keys(t)', doc: 'A list of the keys.', impl: (vm, a) => { const r = new Table(); let i = 1; for (const k of tbl('table.keys', a, 0).keys()) vm.tableSet(r, i++, k as Value); return r; } },
  values: { sig: 'table.values(t)', doc: 'A list of the values.', impl: (vm, a) => { const r = new Table(); let i = 1; for (const v of tbl('table.values', a, 0).values()) vm.tableSet(r, i++, v); return r; } },
  contains: { sig: 'table.contains(t, v)', doc: 'True if v is one of the values.', impl: (vm, a) => { const t = tbl('table.contains', a, 0); vm.burn(t.size >> 2); for (const v of t.values()) if (v === (a[1] ?? null)) return true; return false; } },
  copy: { sig: 'table.copy(t)', doc: 'A shallow copy.', impl: (vm, a) => { const r = new Table(); for (const [k, v] of tbl('table.copy', a, 0).entries()) vm.tableSet(r, k as Value, v); return r; } },
  count: { sig: 'table.count(t)', doc: 'Number of keys of any kind. #t only counts the list part.', impl: (_, a) => tbl('table.count', a, 0).size },
};

/** Small seeded generator, so each mod has its own random stream. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lib(vm: Interpreter, name: string, entries: Record<string, StdEntry>, rng: () => number): Table {
  const t = new Table();
  for (const [k, e] of Object.entries(entries)) {
    const impl: NativeImpl = (a) => e.impl(vm, a, rng);
    t.set(k, new NativeFunction(`${name}.${k}`, impl));
  }
  return t;
}

export function installStdlib(vm: Interpreter, print: (text: string) => void, seed = 1): void {
  const rng = makeRng(seed);
  for (const [k, e] of Object.entries(BASE_LIB)) vm.define(k, new NativeFunction(k, (a) => e.impl(vm, a, rng)));
  vm.define('print', new NativeFunction('print', (a) => {
    print(a.map((v) => toDisplay(v)).join(' '));
  }));
  const math = lib(vm, 'math', MATH_LIB, rng);
  for (const [k, v] of Object.entries(MATH_CONSTANTS)) math.set(k, v);
  math.locked = true;
  vm.define('math', math);
  const string = lib(vm, 'string', STRING_LIB, rng);
  string.locked = true;
  vm.define('string', string);
  const table = lib(vm, 'table', TABLE_LIB, rng);
  table.locked = true;
  vm.define('table', table);
}

/** Standard library names, for the linter. */
export const STD_NAMESPACES: Record<string, Set<string>> = {
  math: new Set([...Object.keys(MATH_LIB), ...Object.keys(MATH_CONSTANTS)]),
  string: new Set(Object.keys(STRING_LIB)),
  table: new Set(Object.keys(TABLE_LIB)),
};
export const STD_GLOBALS = new Set([...Object.keys(BASE_LIB), 'print', 'math', 'string', 'table']);
