import type { Block, Chunk, Expr, Stmt } from './ast';
import { ChaosError, ChaosLimitError, closest, type TraceFrame } from './errors';
import { Env, isCallable, Iter, NativeFunction, numToString, ScriptFunction, Table, typeName, type Key, type NativeImpl, type Value } from './values';

export interface Limits {
  /** Statements, calls and loop iterations per entry from the host. */
  fuel: number;
  callDepth: number;
  tableSize: number;
  stringLength: number;
  /** New table keys per entry from the host. */
  allocations: number;
  /** Cells reachable from the script's roots. Checked by measureHeap. */
  heapCells: number;
}

export const DEFAULT_LIMITS: Limits = { fuel: 200_000, callDepth: 120, tableSize: 200_000, stringLength: 1 << 20, allocations: 400_000, heapCells: 1_000_000 };

const NORMAL = 0;
const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;
type Signal = 0 | 1 | 2 | 3;

export class Interpreter {
  readonly globals = new Env(null);
  limits: Limits;
  /** Fuel left for the current entry. */
  fuel = 0;
  /** Fuel spent since the host last reset this. Lets a host share a budget between entries. */
  spent = 0;
  private allocations = 0;
  private depth = 0;
  private entries = 0;
  private frames: TraceFrame[] = [];
  private file = '';
  private line = 0;
  private ret: Value = null;
  /** Extra values the host keeps alive, such as callbacks. They count toward the heap. */
  roots: Value[] = [];

  constructor(limits: Partial<Limits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  // ── Host interface ──
  define(name: string, v: Value): void {
    this.globals.vars.set(name, v);
  }

  native(name: string, impl: NativeImpl): NativeFunction {
    return new NativeFunction(name, impl);
  }

  /** Runs a whole file. `local`s at its top level stay private to it. */
  run(chunk: Chunk, fuel = this.limits.fuel * 10): void {
    this.enter(fuel, () => {
      this.file = chunk.file;
      const env = new Env(this.globals);
      this.execList(chunk.body.stmts, env);
      return null;
    });
  }

  /** Calls a script function from the host. Throws ChaosError or ChaosLimitError, always with a location. */
  call(fn: Value, args: Value[] = [], fuel = this.limits.fuel): Value {
    return this.enter(fuel, () => this.callValue(fn, args, 'callback'));
  }

  private enter(fuel: number, body: () => Value): Value {
    // A native can call back into a script: the inner entry shares the outer budget rather than getting a fresh one.
    const outer = this.entries > 0;
    const saved = { file: this.file, line: this.line };
    const start = outer ? this.fuel : fuel;
    if (!outer) {
      this.fuel = fuel;
      this.allocations = 0;
      this.depth = 0;
      this.frames.length = 0;
    }
    this.entries++;
    try {
      return body();
    } catch (e) {
      throw this.locate(e);
    } finally {
      this.entries--;
      if (!outer) this.spent += Math.max(0, start - this.fuel);
      this.file = saved.file;
      this.line = saved.line;
    }
  }

  private locate(e: unknown): ChaosError {
    let err: ChaosError;
    if (e instanceof ChaosError) err = e;
    else if (e instanceof RangeError) err = new ChaosLimitError('Stack overflow: recursion is too deep.', 'stack');
    else err = new ChaosError(e instanceof Error ? e.message : String(e));
    if (!err.located) {
      err.at(this.file, this.line);
      err.trace = [...this.frames].reverse();
    }
    return err;
  }

  /** Counts cells reachable from globals and roots: table entries, closure variables and long strings. */
  measureHeap(): number {
    const seen = new Set<object>();
    const stack: Value[] = [...this.roots];
    let cells = 0;
    const env = (e: Env | null) => {
      for (let cur = e; cur && !seen.has(cur); cur = cur.parent) {
        seen.add(cur);
        cells += cur.vars.size;
        for (const v of cur.vars.values()) stack.push(v);
      }
    };
    env(this.globals);
    while (stack.length) {
      const v = stack.pop()!;
      if (typeof v === 'string') cells += v.length >> 5;
      if (v === null || typeof v !== 'object' || seen.has(v)) continue;
      seen.add(v);
      if (v instanceof Table) {
        cells += v.size;
        for (const [k, x] of v.entries()) {
          if (typeof k === 'object') stack.push(k);
          stack.push(x);
        }
      } else if (v instanceof ScriptFunction) {
        env(v.env);
      }
    }
    return cells;
  }

  /** Raises an error at the current script position. */
  error(msg: string): never {
    throw new ChaosError(msg);
  }

  burn(n: number): void {
    this.fuel -= n;
    if (this.fuel < 0) this.outOfFuel();
  }

  /** Adds a key through the same checks as a script assignment. */
  tableSet(t: Table, k: Value, v: Value): void {
    if (t.locked) throw new ChaosError('This table is read-only.');
    if (k === null) throw new ChaosError('A table key cannot be nil.');
    if (k !== k) throw new ChaosError('A table key cannot be NaN.');
    if (k instanceof Iter) throw new ChaosError('An iterator cannot be a table key.');
    if (t.set(k as Key, v)) {
      if (t.size > this.limits.tableSize) throw new ChaosLimitError(`Table is too large (limit ${this.limits.tableSize} entries).`, 'memory');
      if (++this.allocations > this.limits.allocations) throw new ChaosLimitError('Too many table entries created in one call.', 'memory');
    }
  }

  checkString(s: string): string {
    if (s.length > this.limits.stringLength) throw new ChaosLimitError(`String is too long (limit ${this.limits.stringLength} characters).`, 'memory');
    return s;
  }

  callValue(fn: Value, args: Value[], label: string): Value {
    if (fn instanceof NativeFunction) {
      const r = fn.impl(args);
      return r === undefined ? null : r;
    }
    if (!(fn instanceof ScriptFunction)) throw new ChaosError(`Attempt to call ${typeName(fn)} (${label}).`);
    this.burn(1);
    if (this.depth >= this.limits.callDepth) throw new ChaosLimitError(`Stack overflow: more than ${this.limits.callDepth} nested calls.`, 'stack');
    const env = new Env(fn.env);
    const params = fn.body.params;
    for (let i = 0; i < params.length; i++) {
      const a = args[i];
      env.vars.set(params[i]!, a === undefined ? null : a);
    }
    const file = this.file;
    const line = this.line;
    this.frames.push({ fn: fn.body.name, file: fn.file, line });
    this.depth++;
    this.file = fn.file;
    const sig = this.execList(fn.body.body.stmts, env);
    this.depth--;
    this.frames.pop();
    this.file = file;
    this.line = line;
    if (sig === RETURN) {
      const r = this.ret;
      this.ret = null;
      return r;
    }
    return null;
  }

  // ── Statements ──
  private outOfFuel(): never {
    throw new ChaosLimitError('Script took too long: it ran out of its instruction budget. Check for an endless loop.', 'fuel');
  }

  private execBlock(b: Block, env: Env): Signal {
    return this.execList(b.stmts, b.scoped ? new Env(env) : env);
  }

  private execList(stmts: Stmt[], env: Env): Signal {
    for (let i = 0; i < stmts.length; i++) {
      const sig = this.exec(stmts[i]!, env);
      if (sig !== NORMAL) return sig;
    }
    return NORMAL;
  }

  private exec(s: Stmt, env: Env): Signal {
    if (--this.fuel < 0) this.outOfFuel();
    this.line = s.line;
    switch (s.t) {
      case 'local': {
        const vals = s.values.map((e) => this.eval(e, env));
        for (let i = 0; i < s.names.length; i++) {
          const v = vals[i];
          env.vars.set(s.names[i]!, v === undefined ? null : v);
        }
        return NORMAL;
      }
      case 'global':
        this.globals.vars.set(s.name, s.value ? this.eval(s.value, env) : null);
        return NORMAL;
      case 'assign':
        this.assign(s.target, this.eval(s.value, env), env);
        return NORMAL;
      case 'expr':
        this.eval(s.e, env);
        return NORMAL;
      case 'if': {
        for (const arm of s.arms) {
          const c = this.eval(arm.cond, env);
          if (c !== null && c !== false) return this.execBlock(arm.body, env);
        }
        return s.other ? this.execBlock(s.other, env) : NORMAL;
      }
      case 'while': {
        for (;;) {
          this.line = s.line;
          const c = this.eval(s.cond, env);
          if (c === null || c === false) return NORMAL;
          if (--this.fuel < 0) this.outOfFuel();
          const sig = this.execBlock(s.body, env);
          if (sig === BREAK) return NORMAL;
          if (sig === RETURN) return RETURN;
        }
      }
      case 'repeat': {
        for (;;) {
          if (--this.fuel < 0) this.outOfFuel();
          // The condition can see the body's locals, as in Lua.
          const inner = new Env(env);
          const sig = this.execList(s.body.stmts, inner);
          if (sig === BREAK) return NORMAL;
          if (sig === RETURN) return RETURN;
          const c = this.eval(s.cond, inner);
          if (c !== null && c !== false) return NORMAL;
        }
      }
      case 'fornum': {
        const from = this.eval(s.from, env);
        const to = this.eval(s.to, env);
        const step = s.step ? this.eval(s.step, env) : 1;
        if (typeof from !== 'number' || typeof to !== 'number' || typeof step !== 'number') throw new ChaosError('A numeric for needs numbers for its start, end and step.');
        if (step === 0) throw new ChaosError('A numeric for cannot have a step of 0.');
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          if (--this.fuel < 0) this.outOfFuel();
          const inner = new Env(env);
          inner.vars.set(s.name, i);
          const sig = this.execList(s.body.stmts, inner);
          if (sig === BREAK) return NORMAL;
          if (sig === RETURN) return RETURN;
        }
        return NORMAL;
      }
      case 'forin': {
        const it = this.eval(s.iter, env);
        let entries: [Value, Value][];
        if (it instanceof Iter) entries = it.entries;
        else if (it instanceof Table) entries = [...it.entries()] as [Value, Value][];
        else throw new ChaosError(`A for ... in loop needs pairs(t), ipairs(t) or a table, got ${typeName(it)}.`);
        for (const [k, v] of entries) {
          if (--this.fuel < 0) this.outOfFuel();
          const inner = new Env(env);
          inner.vars.set(s.key, k);
          if (s.value) inner.vars.set(s.value, v);
          const sig = this.execList(s.body.stmts, inner);
          if (sig === BREAK) return NORMAL;
          if (sig === RETURN) return RETURN;
        }
        return NORMAL;
      }
      case 'localfn': {
        // Declared first, so the function can call itself.
        env.vars.set(s.name, null);
        env.vars.set(s.name, new ScriptFunction(s.fn, env, this.file));
        return NORMAL;
      }
      case 'globalfn': {
        const fn = new ScriptFunction(s.fn, env, this.file);
        if (s.path.length === 1) {
          // A bare name reassigns a visible local of that name, otherwise it is a mod-wide function.
          const holder = this.findEnv(s.path[0]!, env);
          (holder ?? this.globals).vars.set(s.path[0]!, fn);
          return NORMAL;
        }
        let obj = this.lookup(s.path[0]!, env);
        for (let i = 1; i < s.path.length - 1; i++) {
          if (!(obj instanceof Table)) throw new ChaosError(`Cannot define ${s.fn.name}: ${s.path.slice(0, i).join('.')} is not a table.`);
          obj = obj.get(s.path[i]!);
        }
        if (!(obj instanceof Table)) throw new ChaosError(`Cannot define ${s.fn.name}: ${s.path.slice(0, -1).join('.')} is not a table.`);
        this.tableSet(obj, s.path[s.path.length - 1]!, fn);
        return NORMAL;
      }
      case 'do':
        return this.execBlock(s.body, env);
      case 'return':
        this.ret = s.value ? this.eval(s.value, env) : null;
        return RETURN;
      case 'break':
        return BREAK;
      case 'continue':
        return CONTINUE;
    }
  }

  private findEnv(name: string, env: Env): Env | null {
    for (let e: Env | null = env; e; e = e.parent) if (e.vars.has(name)) return e;
    return null;
  }

  private lookup(name: string, env: Env): Value {
    for (let e: Env | null = env; e; e = e.parent) {
      const v = e.vars.get(name);
      if (v !== undefined) return v;
    }
    const names = new Set<string>();
    for (let e: Env | null = env; e; e = e.parent) for (const k of e.vars.keys()) names.add(k);
    const hint = closest(name, names);
    throw new ChaosError(`Unknown variable "${name}".${hint ? ` Did you mean "${hint}"?` : ''}`);
  }

  private assign(target: Expr, v: Value, env: Env): void {
    if (target.t === 'id') {
      const holder = this.findEnv(target.name, env);
      if (!holder) throw new ChaosError(`Cannot assign to unknown variable "${target.name}". Declare it first with "local ${target.name} = ..." or "global ${target.name} = ...".`);
      holder.vars.set(target.name, v);
      return;
    }
    if (target.t === 'member') {
      const o = this.eval(target.obj, env);
      if (!(o instanceof Table)) throw new ChaosError(`Attempt to set field "${target.name}" on ${typeName(o)} (${describe(target.obj)}).`);
      this.tableSet(o, target.name, v);
      return;
    }
    if (target.t === 'index') {
      const o = this.eval(target.obj, env);
      if (!(o instanceof Table)) throw new ChaosError(`Attempt to index ${typeName(o)} (${describe(target.obj)}).`);
      this.tableSet(o, this.eval(target.key, env), v);
    }
  }

  // ── Expressions ──
  private eval(e: Expr, env: Env): Value {
    switch (e.t) {
      case 'nil': return null;
      case 'bool': return e.v;
      case 'num': return e.v;
      case 'str': return e.v;
      case 'id': return this.lookup(e.name, env);
      case 'fn': return new ScriptFunction(e.fn, env, this.file);
      case 'member': {
        const o = this.eval(e.obj, env);
        return this.index(o, e.name, e.obj);
      }
      case 'index': {
        const o = this.eval(e.obj, env);
        return this.index(o, this.eval(e.key, env), e.obj);
      }
      case 'call': {
        const fn = this.eval(e.fn, env);
        const args = new Array<Value>(e.args.length);
        for (let i = 0; i < e.args.length; i++) args[i] = this.eval(e.args[i]!, env);
        this.line = e.line;
        return this.invoke(fn, args, e.fn);
      }
      case 'method': {
        const o = this.eval(e.obj, env);
        const fn = this.index(o, e.name, e.obj);
        const args = new Array<Value>(e.args.length + 1);
        args[0] = o;
        for (let i = 0; i < e.args.length; i++) args[i + 1] = this.eval(e.args[i]!, env);
        this.line = e.line;
        if (!isCallable(fn)) throw new ChaosError(`Attempt to call ${typeName(fn)} (method "${e.name}" of ${describe(e.obj)}).`);
        return this.callValue(fn, args, e.name);
      }
      case 'table': {
        const t = new Table();
        let n = 1;
        for (const item of e.items) {
          if (item.k === 'pos') {
            const v = this.eval(item.v, env);
            this.tableSet(t, n++, v);
          } else if (item.k === 'name') {
            this.tableSet(t, item.name, this.eval(item.v, env));
          } else {
            const k = this.eval(item.key, env);
            this.tableSet(t, k, this.eval(item.v, env));
          }
        }
        return t;
      }
      case 'and': {
        const a = this.eval(e.a, env);
        return a === null || a === false ? a : this.eval(e.b, env);
      }
      case 'or': {
        const a = this.eval(e.a, env);
        return a === null || a === false ? this.eval(e.b, env) : a;
      }
      case 'un': {
        const v = this.eval(e.e, env);
        if (e.op === 'not') return v === null || v === false;
        if (e.op === '-') {
          if (typeof v !== 'number') throw new ChaosError(`Attempt to negate ${typeName(v)}.`);
          return -v;
        }
        if (typeof v === 'string') return v.length;
        if (v instanceof Table) return v.length;
        throw new ChaosError(`Attempt to get the length of ${typeName(v)} (${describe(e.e)}).`);
      }
      case 'bin': {
        const a = this.eval(e.a, env);
        const b = this.eval(e.b, env);
        return this.binary(e.op, a, b, e);
      }
    }
  }

  private invoke(fn: Value, args: Value[], callee: Expr): Value {
    if (!isCallable(fn)) throw new ChaosError(`Attempt to call ${typeName(fn)} (${describe(callee)}).`);
    return this.callValue(fn, args, describe(callee));
  }

  /** Strings answer to the `string` library, so s:upper() works. */
  private index(o: Value, k: Value, source: Expr): Value {
    if (o instanceof Table) return o.get(k);
    if (typeof o === 'string') {
      const lib = this.globals.vars.get('string');
      if (lib instanceof Table) return lib.get(k);
    }
    throw new ChaosError(`Attempt to index ${typeName(o)} (${describe(source)}${typeof k === 'string' ? `, looking for "${k}"` : ''}).`);
  }

  private binary(op: string, a: Value, b: Value, e: Expr & { t: 'bin' }): Value {
    if (op === '==') return a === b;
    if (op === '~=') return a !== b;
    if (op === '..') {
      if ((typeof a === 'string' || typeof a === 'number') && (typeof b === 'string' || typeof b === 'number')) {
        const s = (typeof a === 'number' ? numToString(a) : a) + (typeof b === 'number' ? numToString(b) : b);
        return this.checkString(s);
      }
      throw new ChaosError(`Attempt to join ${typeName(a)} and ${typeName(b)} with ".." (${describe(typeof a === 'string' || typeof a === 'number' ? e.b : e.a)}). Use tostring() for other types.`);
    }
    if (typeof a === 'number' && typeof b === 'number') {
      switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a - Math.floor(a / b) * b;
        case '^': return a ** b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
      }
    }
    if (typeof a === 'string' && typeof b === 'string') {
      switch (op) {
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
      }
    }
    const bad = typeof a === 'number' ? e.b : e.a;
    throw new ChaosError(`Attempt to apply "${op}" to ${typeName(a)} and ${typeName(b)} (${describe(bad)}).`);
  }
}

function describe(e: Expr): string {
  switch (e.t) {
    case 'id': return `variable "${e.name}"`;
    case 'member': return `field "${path(e)}"`;
    case 'index': return `an indexed value of ${describe(e.obj)}`;
    case 'call': return `the result of calling ${describe(e.fn)}`;
    case 'method': return `the result of method "${e.name}"`;
    case 'nil': return 'nil';
    default: return 'this expression';
  }
}

function path(e: Expr): string {
  if (e.t === 'id') return e.name;
  if (e.t === 'member') return `${path(e.obj)}.${e.name}`;
  return '?';
}
