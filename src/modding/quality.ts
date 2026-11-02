import { closest, type Block, type Chunk, type Diagnostic, type Expr, type FnBody, type Stmt } from '../chaosscript';
import { ALL_API } from './api';
import type { ApiFn } from './api/types';
import { EVENT_NAMES } from './events';
import type { Manifest } from './manifest';

/** An id written literally in a script. It can only be checked once everything has registered. */
export interface LiteralRef { kind: 'def' | 'sound' | 'tool'; name: string; file: string; line: number }

export interface QualityReport { diagnostics: Diagnostic[]; refs: LiteralRef[] }

const BY_NAME = new Map(ALL_API.map((f) => [`${f.ns}.${f.name}`, f]));
const NAMESPACES = new Set(ALL_API.map((f) => f.ns));

/** Index of the argument that a schema describes: every API function with fields has one table parameter. */
function schemaArg(f: ApiFn): number {
  return f.params.findIndex((p) => p.type === 'table');
}

/**
 * Static checks that go beyond syntax: whether the manifest grants what a script calls, and whether calls written
 * out literally match the API. They read the same entries the game runs, so they can't drift from it.
 */
export function analyzeMod(chunks: Chunk[], manifest: Manifest): QualityReport {
  const diagnostics: Diagnostic[] = [];
  const refs: LiteralRef[] = [];
  const used = new Set<string>();

  for (const chunk of chunks) {
    const report = (severity: Diagnostic['severity'], p: { line: number; col: number }, message: string) => diagnostics.push({ severity, file: chunk.file, line: p.line, col: p.col, message });

    /** The API function an expression names, unless a local variable hides the namespace. */
    const apiOf = (e: Expr, scope: Set<string>[]): ApiFn | undefined => {
      if (e.t !== 'member' || e.obj.t !== 'id' || !NAMESPACES.has(e.obj.name)) return undefined;
      const ns = e.obj.name;
      if (scope.some((s) => s.has(ns))) return undefined;
      return BY_NAME.get(`${ns}.${e.name}`);
    };

    const checkCall = (f: ApiFn, args: Expr[], at: Expr, depth: number) => {
      const label = `${f.ns}.${f.name}`;
      if (f.loadOnly && depth > 0) report('error', at, `${label} is inside a function, but it can only be called while the mod loads. Move it to the top level of the script.`);
      if (!f.params[0]?.name.endsWith('...')) {
        if (args.length > f.params.length) report('error', at, `${label} takes at most ${f.params.length} arguments, got ${args.length}.`);
        f.params.forEach((p, i) => {
          if (!p.optional && p.type !== 'any' && i >= args.length) report('error', at, `${label} is missing argument ${i + 1}, "${p.name}".`);
        });
      }
      if (f.fields) {
        const arg = args[schemaArg(f)];
        if (arg?.t === 'table') {
          const given = new Set<string>();
          for (const item of arg.items) {
            if (item.k !== 'name') continue;
            given.add(item.name);
            if (!Object.prototype.hasOwnProperty.call(f.fields, item.name)) {
              const hint = closest(item.name, Object.keys(f.fields));
              report('error', item.v, `${label}: unknown field "${item.name}".${hint ? ` Did you mean "${hint}"?` : ''}`);
            }
          }
          const open = arg.items.some((i) => i.k !== 'name');
          if (!open) {
            for (const [k, field] of Object.entries(f.fields)) {
              if (field.required && !given.has(k)) report('error', at, `${label}: field "${k}" is required.`);
            }
          }
        }
      }
      const first = args[0];
      if (first?.t === 'str') {
        if (label === 'events.on' && !first.v.includes(':') && !(first.v in EVENT_NAMES)) {
          const hint = closest(first.v, Object.keys(EVENT_NAMES));
          report('error', first, `Unknown event "${first.v}".${hint ? ` Did you mean "${hint}"?` : ''} Custom events contain ":".`);
        }
        if (label === 'events.emit' && !first.v.includes(':')) report('error', first, `Custom event "${first.v}" must contain ":", such as "${manifest.id}:${first.v}".`);
        if (label === 'entity.spawn') refs.push({ kind: 'def', name: first.v, file: chunk.file, line: first.line });
        if (label === 'sound.play') refs.push({ kind: 'sound', name: first.v, file: chunk.file, line: first.line });
        if (label === 'player.select_tool') refs.push({ kind: 'tool', name: first.v, file: chunk.file, line: first.line });
      }
    };

    const fn = (b: FnBody, scope: Set<string>[]) => block(b.body, [...scope, new Set(b.params)], 1);

    const expr = (e: Expr | null, scope: Set<string>[], depth: number): void => {
      if (!e) return;
      switch (e.t) {
        case 'member': {
          const f = apiOf(e, scope);
          if (f?.perm) {
            used.add(f.perm);
            if (!manifest.permissions.includes(f.perm)) report('error', e, `${f.ns}.${f.name} needs the "${f.perm}" permission, which mod.json doesn't list. Add "${f.perm}" to "permissions".`);
          }
          expr(e.obj, scope, depth);
          break;
        }
        case 'index': expr(e.obj, scope, depth); expr(e.key, scope, depth); break;
        case 'call': {
          const f = apiOf(e.fn, scope);
          if (f) checkCall(f, e.args, e.fn, depth);
          expr(e.fn, scope, depth);
          e.args.forEach((a) => expr(a, scope, depth));
          break;
        }
        case 'method': expr(e.obj, scope, depth); e.args.forEach((a) => expr(a, scope, depth)); break;
        case 'fn': fn(e.fn, scope); break;
        case 'table': e.items.forEach((i) => { if (i.k === 'expr') expr(i.key, scope, depth); expr(i.v, scope, depth); }); break;
        case 'un': expr(e.e, scope, depth); break;
        case 'bin': case 'and': case 'or': expr(e.a, scope, depth); expr(e.b, scope, depth); break;
        default: break;
      }
    };

    const block = (b: Block, scope: Set<string>[], depth: number): void => {
      const inner = [...scope, new Set<string>()];
      for (const s of b.stmts) stmt(s, inner, depth);
    };

    const stmt = (s: Stmt, scope: Set<string>[], depth: number): void => {
      const top = scope[scope.length - 1]!;
      switch (s.t) {
        case 'local': s.values.forEach((v) => expr(v, scope, depth)); s.names.forEach((n) => top.add(n)); break;
        case 'global': expr(s.value, scope, depth); break;
        case 'assign': expr(s.target, scope, depth); expr(s.value, scope, depth); break;
        case 'expr': expr(s.e, scope, depth); break;
        case 'if': s.arms.forEach((a) => { expr(a.cond, scope, depth); block(a.body, scope, depth); }); if (s.other) block(s.other, scope, depth); break;
        case 'while': expr(s.cond, scope, depth); block(s.body, scope, depth); break;
        case 'repeat': {
          const inner = [...scope, new Set<string>()];
          for (const x of s.body.stmts) stmt(x, inner, depth);
          expr(s.cond, inner, depth);
          break;
        }
        case 'fornum': expr(s.from, scope, depth); expr(s.to, scope, depth); expr(s.step, scope, depth); block(s.body, [...scope, new Set([s.name])], depth); break;
        case 'forin': expr(s.iter, scope, depth); block(s.body, [...scope, new Set(s.value ? [s.key, s.value] : [s.key])], depth); break;
        case 'localfn': top.add(s.name); fn(s.fn, scope); break;
        case 'globalfn': fn(s.fn, scope); break;
        case 'do': block(s.body, scope, depth); break;
        case 'return': expr(s.value, scope, depth); break;
        default: break;
      }
    };

    block(chunk.body, [], 0);
  }

  for (const p of manifest.permissions) {
    if (!used.has(p)) diagnostics.push({ severity: 'warning', file: 'mod.json', line: 1, col: 1, message: `Permission "${p}" is declared but no script appears to use it. Remove it unless a call is made indirectly.` });
  }
  return { diagnostics, refs };
}
