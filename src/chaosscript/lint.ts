import type { Block, Chunk, Expr, FnBody, Stmt } from './ast';
import { closest } from './errors';

export interface Diagnostic { severity: 'error' | 'warning'; file: string; line: number; col: number; message: string }

export interface LintContext {
  /** Names visible everywhere: standard library and API namespaces. */
  globals: Set<string>;
  /** namespace -> known field names, for catching entity.spwan before it runs. */
  namespaces: Record<string, Set<string>>;
}

/** Names declared with `global`, or `function name()` at any depth, in all of a mod's files. */
function collectGlobals(chunks: Chunk[]): Set<string> {
  const out = new Set<string>();
  const block = (b: Block, scope: Set<string>[]): void => {
    const inner = b.scoped ? [...scope, new Set<string>()] : scope;
    for (const s of b.stmts) stmt(s, inner);
  };
  const fn = (f: FnBody, scope: Set<string>[]) => block(f.body, [...scope, new Set(f.params)]);
  const expr = (e: Expr | null, scope: Set<string>[]): void => {
    if (!e) return;
    switch (e.t) {
      case 'fn': fn(e.fn, scope); break;
      case 'member': expr(e.obj, scope); break;
      case 'index': expr(e.obj, scope); expr(e.key, scope); break;
      case 'call': expr(e.fn, scope); e.args.forEach((a) => expr(a, scope)); break;
      case 'method': expr(e.obj, scope); e.args.forEach((a) => expr(a, scope)); break;
      case 'table': e.items.forEach((i) => { if (i.k === 'expr') expr(i.key, scope); expr(i.v, scope); }); break;
      case 'un': expr(e.e, scope); break;
      case 'bin': case 'and': case 'or': expr(e.a, scope); expr(e.b, scope); break;
      default: break;
    }
  };
  const stmt = (s: Stmt, scope: Set<string>[]): void => {
    switch (s.t) {
      case 'global': out.add(s.name); expr(s.value, scope); break;
      case 'globalfn':
        if (s.path.length === 1 && !scope.some((x) => x.has(s.path[0]!))) out.add(s.path[0]!);
        fn(s.fn, scope);
        break;
      case 'local': s.names.forEach((n) => scope[scope.length - 1]?.add(n)); s.values.forEach((v) => expr(v, scope)); break;
      case 'localfn': scope[scope.length - 1]?.add(s.name); fn(s.fn, scope); break;
      case 'assign': expr(s.target, scope); expr(s.value, scope); break;
      case 'expr': expr(s.e, scope); break;
      case 'if': s.arms.forEach((a) => { expr(a.cond, scope); block(a.body, scope); }); if (s.other) block(s.other, scope); break;
      case 'while': expr(s.cond, scope); block(s.body, scope); break;
      case 'repeat': block(s.body, scope); expr(s.cond, scope); break;
      case 'fornum': expr(s.from, scope); expr(s.to, scope); expr(s.step, scope); block(s.body, [...scope, new Set([s.name])]); break;
      case 'forin': expr(s.iter, scope); block(s.body, [...scope, new Set(s.value ? [s.key, s.value] : [s.key])]); break;
      case 'do': block(s.body, scope); break;
      case 'return': expr(s.value, scope); break;
      default: break;
    }
  };
  for (const c of chunks) block(c.body, [new Set()]);
  return out;
}

/** Static checks over a whole mod: unknown variables, assigning without declaring, and misspelt API calls. */
export function lint(chunks: Chunk[], ctx: LintContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  const modGlobals = collectGlobals(chunks);
  for (const chunk of chunks) {
    const report = (severity: Diagnostic['severity'], p: { line: number; col: number }, message: string) => out.push({ severity, file: chunk.file, line: p.line, col: p.col, message });
    const known = (name: string, scope: Set<string>[]) => scope.some((s) => s.has(name)) || ctx.globals.has(name) || modGlobals.has(name);
    const visible = (scope: Set<string>[]) => {
      const all = new Set<string>([...ctx.globals, ...modGlobals]);
      for (const s of scope) for (const n of s) all.add(n);
      return all;
    };
    const unknownVar = (name: string, p: { line: number; col: number }, scope: Set<string>[], verb: string) => {
      const hint = closest(name, visible(scope));
      report('error', p, `${verb} unknown variable "${name}".${hint ? ` Did you mean "${hint}"?` : ''}`);
    };
    const block = (b: Block, scope: Set<string>[]): void => {
      const inner = [...scope, new Set<string>()];
      for (const s of b.stmts) stmt(s, inner);
    };
    const fn = (f: FnBody, scope: Set<string>[]) => block(f.body, [...scope, new Set(f.params)]);
    const expr = (e: Expr | null, scope: Set<string>[]): void => {
      if (!e) return;
      switch (e.t) {
        case 'id':
          if (!known(e.name, scope)) unknownVar(e.name, e, scope, 'Reading');
          break;
        case 'fn': fn(e.fn, scope); break;
        case 'member': {
          const ns = e.obj.t === 'id' && !scope.some((s) => s.has((e.obj as { name: string }).name)) ? ctx.namespaces[e.obj.name] : undefined;
          if (ns && !ns.has(e.name)) {
            const hint = closest(e.name, ns);
            report('error', e, `"${(e.obj as { name: string }).name}" has no "${e.name}".${hint ? ` Did you mean "${hint}"?` : ''}`);
          }
          expr(e.obj, scope);
          break;
        }
        case 'index': expr(e.obj, scope); expr(e.key, scope); break;
        case 'call': expr(e.fn, scope); e.args.forEach((a) => expr(a, scope)); break;
        case 'method': expr(e.obj, scope); e.args.forEach((a) => expr(a, scope)); break;
        case 'table': e.items.forEach((i) => { if (i.k === 'expr') expr(i.key, scope); expr(i.v, scope); }); break;
        case 'un': expr(e.e, scope); break;
        case 'bin': case 'and': case 'or': expr(e.a, scope); expr(e.b, scope); break;
        default: break;
      }
    };
    const stmt = (s: Stmt, scope: Set<string>[]): void => {
      const top = scope[scope.length - 1]!;
      switch (s.t) {
        case 'local':
          s.values.forEach((v) => expr(v, scope));
          s.names.forEach((n) => top.add(n));
          break;
        case 'global': expr(s.value, scope); break;
        case 'assign':
          if (s.target.t === 'id') {
            if (!known(s.target.name, scope)) unknownVar(s.target.name, s.target, scope, 'Assigning to');
          } else {
            expr(s.target, scope);
          }
          expr(s.value, scope);
          break;
        case 'expr': expr(s.e, scope); break;
        case 'if':
          s.arms.forEach((a) => { expr(a.cond, scope); block(a.body, scope); });
          if (s.other) block(s.other, scope);
          break;
        case 'while': expr(s.cond, scope); block(s.body, scope); break;
        case 'repeat': {
          // The until condition can see the body's locals.
          const inner = [...scope, new Set<string>()];
          for (const x of s.body.stmts) stmt(x, inner);
          expr(s.cond, inner);
          break;
        }
        case 'fornum':
          expr(s.from, scope); expr(s.to, scope); expr(s.step, scope);
          block(s.body, [...scope, new Set([s.name])]);
          break;
        case 'forin':
          expr(s.iter, scope);
          block(s.body, [...scope, new Set(s.value ? [s.key, s.value] : [s.key])]);
          break;
        case 'localfn': top.add(s.name); fn(s.fn, scope); break;
        case 'globalfn':
          if (s.path.length > 1 && !known(s.path[0]!, scope)) unknownVar(s.path[0]!, s, scope, 'Defining a function on');
          fn(s.fn, scope);
          break;
        case 'do': block(s.body, scope); break;
        case 'return': expr(s.value, scope); break;
        default: break;
      }
    };
    block(chunk.body, []);
  }
  return out;
}
