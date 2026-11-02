import type { BinOp, Block, Chunk, Expr, FnBody, Pos, Stmt, TableItem } from './ast';
import { ChaosSyntaxError } from './errors';
import { tokenize, type Token } from './lexer';

const MAX_DEPTH = 160;
const BINARY: Record<string, [number, number]> = {
  or: [1, 1], and: [2, 2],
  '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
  '..': [5, 4], '+': [6, 6], '-': [6, 6], '*': [7, 7], '/': [7, 7], '%': [7, 7], '^': [10, 9],
};
const UNARY_PRIORITY = 8;

class Parser {
  private i = 0;
  private depth = 0;
  private tokens: Token[];

  constructor(src: string, private file: string) {
    this.tokens = tokenize(src, file);
  }

  private get tok(): Token { return this.tokens[this.i]!; }
  private peek(n = 1): Token { return this.tokens[Math.min(this.i + n, this.tokens.length - 1)]!; }
  private pos(): Pos { return { line: this.tok.line, col: this.tok.col }; }
  private next(): Token { return this.tokens[this.i++]!; }
  private is(text: string): boolean {
    const t = this.tok;
    return (t.type === 'op' || t.type === 'kw') && t.text === text;
  }
  private accept(text: string): boolean {
    if (!this.is(text)) return false;
    this.i++;
    return true;
  }
  private fail(msg: string, t: Token = this.tok): never {
    throw new ChaosSyntaxError(msg, this.file, t.line, t.col);
  }
  private show(t: Token): string { return t.type === 'eof' ? 'end of file' : t.type === 'str' ? 'a string' : `"${t.text}"`; }
  private expect(text: string, context: string): Token {
    if (!this.is(text)) this.fail(`Expected "${text}" ${context}, found ${this.show(this.tok)}.`);
    return this.next();
  }
  private ident(context: string): string {
    if (this.tok.type !== 'id') {
      this.fail(`Expected a name ${context}, found ${this.show(this.tok)}${this.tok.type === 'kw' ? ' (a reserved word)' : ''}.`);
    }
    return this.next().text;
  }
  private enter(): void {
    if (++this.depth > MAX_DEPTH) this.fail('Code is nested too deeply.');
  }

  chunk(): Chunk {
    const body = this.block(() => this.tok.type === 'eof', 'file');
    return { file: this.file, body };
  }

  private block(done: () => boolean, what: string, opened?: Token): Block {
    const stmts: Stmt[] = [];
    this.enter();
    while (!done()) {
      if (this.tok.type === 'eof') {
        const where = opened ? ` opened on line ${opened.line}` : '';
        this.fail(`Missing "end" for the ${what}${where}.`);
      }
      const s = this.statement();
      stmts.push(s);
      if (s.t === 'return') {
        this.accept(';');
        if (!done()) this.fail('"return" must be the last statement in its block.');
        break;
      }
    }
    this.depth--;
    return { stmts, scoped: stmts.some((s) => s.t === 'local' || s.t === 'localfn') };
  }

  private untilEnd(what: string, opened: Token): Block {
    const b = this.block(() => this.is('end'), what, opened);
    this.next();
    return b;
  }

  private statement(): Stmt {
    const p = this.pos();
    const t = this.tok;
    if (t.type === 'op' && t.text === ';') {
      this.next();
      return { ...p, t: 'do', body: { stmts: [], scoped: false } };
    }
    if (t.type === 'kw') {
      switch (t.text) {
        case 'local': return this.localStmt(p);
        case 'global': return this.globalStmt(p);
        case 'function': return this.functionStmt(p);
        case 'if': return this.ifStmt(p);
        case 'while': {
          const open = this.next();
          const cond = this.expr();
          this.expect('do', 'after the while condition');
          return { ...p, t: 'while', cond, body: this.untilEnd('while loop', open) };
        }
        case 'repeat': {
          const open = this.next();
          const body = this.block(() => this.is('until'), 'repeat loop (it ends with "until")', open);
          this.next();
          return { ...p, t: 'repeat', body, cond: this.expr() };
        }
        case 'for': return this.forStmt(p);
        case 'do': {
          const open = this.next();
          return { ...p, t: 'do', body: this.untilEnd('do block', open) };
        }
        case 'return': {
          this.next();
          const none = this.tok.type === 'eof' || this.is('end') || this.is('else') || this.is('elseif') || this.is('until') || this.is(';');
          const value = none ? null : this.expr();
          if (this.is(',')) this.fail('A function returns one value. Return a table to give back several.');
          return { ...p, t: 'return', value };
        }
        case 'break':
          this.next();
          return { ...p, t: 'break' };
        case 'continue':
          this.next();
          return { ...p, t: 'continue' };
        default:
          break;
      }
    }
    const e = this.suffixed();
    if (this.is(',')) this.fail('Assigning to several variables at once is not supported. Use one assignment per line.');
    if (this.accept('=')) {
      if (e.t !== 'id' && e.t !== 'member' && e.t !== 'index') this.fail('Can only assign to a variable or a table field.');
      return { ...p, t: 'assign', target: e, value: this.expr() };
    }
    if (e.t !== 'call' && e.t !== 'method') {
      this.fail(`Expected "=" or a function call after ${e.t === 'id' ? `"${e.name}"` : 'this expression'}, found ${this.show(this.tok)}.`);
    }
    return { ...p, t: 'expr', e };
  }

  private localStmt(p: Pos): Stmt {
    this.next();
    if (this.accept('function')) {
      const name = this.ident('after "local function"');
      return { ...p, t: 'localfn', name, fn: this.fnBody(name, p) };
    }
    const names = [this.ident('after "local"')];
    while (this.accept(',')) names.push(this.ident('after ","'));
    const values: Expr[] = [];
    if (this.accept('=')) {
      values.push(this.expr());
      while (this.accept(',')) values.push(this.expr());
    }
    if (values.length > names.length) this.fail('More values than names in this "local".');
    return { ...p, t: 'local', names, values };
  }

  private globalStmt(p: Pos): Stmt {
    this.next();
    const name = this.ident('after "global"');
    return { ...p, t: 'global', name, value: this.accept('=') ? this.expr() : null };
  }

  private functionStmt(p: Pos): Stmt {
    this.next();
    const path = [this.ident('after "function"')];
    while (this.accept('.')) path.push(this.ident('after "."'));
    if (this.is(':')) this.fail('Write function t.name(self, ...) instead of function t:name(...).');
    return { ...p, t: 'globalfn', path, fn: this.fnBody(path.join('.'), p) };
  }

  private ifStmt(p: Pos): Stmt {
    const open = this.next();
    const arms: { cond: Expr; body: Block }[] = [];
    const armEnd = () => this.is('end') || this.is('else') || this.is('elseif');
    const cond = this.expr();
    this.expect('then', 'after the if condition');
    arms.push({ cond, body: this.block(armEnd, 'if statement', open) });
    let other: Block | null = null;
    while (this.accept('elseif')) {
      const c = this.expr();
      this.expect('then', 'after the elseif condition');
      arms.push({ cond: c, body: this.block(armEnd, 'if statement', open) });
    }
    if (this.accept('else')) other = this.block(() => this.is('end'), 'if statement', open);
    this.expect('end', 'to close the if statement');
    return { ...p, t: 'if', arms, other };
  }

  private forStmt(p: Pos): Stmt {
    const open = this.next();
    const first = this.ident('after "for"');
    if (this.accept('=')) {
      const from = this.expr();
      this.expect(',', 'between the start and end of a numeric for');
      const to = this.expr();
      const step = this.accept(',') ? this.expr() : null;
      this.expect('do', 'after the numeric for');
      return { ...p, t: 'fornum', name: first, from, to, step, body: this.untilEnd('for loop', open) };
    }
    const value = this.accept(',') ? this.ident('after ","') : null;
    this.expect('in', 'in a for loop: "for k, v in pairs(t) do" or "for i = 1, 10 do"');
    const iter = this.expr();
    this.expect('do', 'after the for ... in expression');
    return { ...p, t: 'forin', key: first, value, iter, body: this.untilEnd('for loop', open) };
  }

  private fnBody(name: string, p: Pos): FnBody {
    const open = this.expect('(', 'to start the parameter list');
    const params: string[] = [];
    if (!this.is(')')) {
      do {
        const n = this.ident('for a parameter');
        if (params.includes(n)) this.fail(`Duplicate parameter "${n}".`);
        params.push(n);
      } while (this.accept(','));
    }
    this.expect(')', 'to close the parameter list');
    this.enter();
    const body = this.untilEnd(`function "${name}"`, open);
    this.depth--;
    return { ...p, name, params, body };
  }

  expr(limit = 0): Expr {
    this.enter();
    const p = this.pos();
    let left: Expr;
    if (this.is('not') || this.is('-') || this.is('#')) {
      const op = this.next().text as 'not' | '-' | '#';
      left = { ...p, t: 'un', op, e: this.expr(UNARY_PRIORITY) };
    } else {
      left = this.simple();
    }
    for (;;) {
      const t = this.tok;
      if (t.type !== 'op' && t.type !== 'kw') break;
      const pri = BINARY[t.text];
      if (!pri || pri[0] <= limit) break;
      this.next();
      const right = this.expr(pri[1]);
      const at: Pos = { line: t.line, col: t.col };
      if (t.text === 'and') left = { ...at, t: 'and', a: left, b: right };
      else if (t.text === 'or') left = { ...at, t: 'or', a: left, b: right };
      else left = { ...at, t: 'bin', op: t.text as BinOp, a: left, b: right };
    }
    this.depth--;
    return left;
  }

  private simple(): Expr {
    const t = this.tok;
    const p = this.pos();
    switch (t.type) {
      case 'num':
        this.next();
        return { ...p, t: 'num', v: t.value as number };
      case 'str':
        this.next();
        return { ...p, t: 'str', v: t.value as string };
      case 'kw':
        if (t.text === 'nil') { this.next(); return { ...p, t: 'nil' }; }
        if (t.text === 'true') { this.next(); return { ...p, t: 'bool', v: true }; }
        if (t.text === 'false') { this.next(); return { ...p, t: 'bool', v: false }; }
        if (t.text === 'function') {
          this.next();
          return { ...p, t: 'fn', fn: this.fnBody('anonymous function', p) };
        }
        break;
      case 'op':
        if (t.text === '{') return this.table();
        break;
      default:
        break;
    }
    return this.suffixed();
  }

  private suffixed(): Expr {
    const p = this.pos();
    let e: Expr;
    if (this.tok.type === 'id') {
      e = { ...p, t: 'id', name: this.next().text };
    } else if (this.accept('(')) {
      e = this.expr();
      this.expect(')', 'to close the parenthesis');
    } else {
      this.fail(`Unexpected ${this.show(this.tok)}. Expected an expression.`);
    }
    for (;;) {
      const at = this.pos();
      if (this.accept('.')) {
        e = { ...at, t: 'member', obj: e, name: this.ident('after "."') };
      } else if (this.accept('[')) {
        const key = this.expr();
        this.expect(']', 'to close the index');
        e = { ...at, t: 'index', obj: e, key };
      } else if (this.accept(':')) {
        const name = this.ident('after ":"');
        e = { ...at, t: 'method', obj: e, name, args: this.callArgs() };
      } else if (this.is('(') || this.is('{') || this.tok.type === 'str') {
        e = { ...at, t: 'call', fn: e, args: this.callArgs() };
      } else {
        return e;
      }
    }
  }

  private callArgs(): Expr[] {
    if (this.is('{')) return [this.table()];
    if (this.tok.type === 'str') {
      const p = this.pos();
      const v = this.next().value as string;
      return [{ ...p, t: 'str', v }];
    }
    this.expect('(', 'to start the call arguments');
    const args: Expr[] = [];
    if (!this.is(')')) {
      do args.push(this.expr()); while (this.accept(','));
    }
    this.expect(')', 'to close the call arguments');
    return args;
  }

  private table(): Expr {
    const p = this.pos();
    const open = this.next();
    this.enter();
    const items: TableItem[] = [];
    while (!this.is('}')) {
      if (this.tok.type === 'eof') this.fail(`Missing "}" for the table opened on line ${open.line}.`);
      if (this.tok.type === 'id' && this.peek().type === 'op' && this.peek().text === '=') {
        const name = this.next().text;
        this.next();
        items.push({ k: 'name', name, v: this.expr() });
      } else if (this.accept('[')) {
        const key = this.expr();
        this.expect(']', 'to close the table key');
        this.expect('=', 'after the table key');
        items.push({ k: 'expr', key, v: this.expr() });
      } else {
        items.push({ k: 'pos', v: this.expr() });
      }
      if (!this.accept(',') && !this.accept(';') && !this.is('}')) {
        this.fail(`Expected "," or "}" in the table opened on line ${open.line}, found ${this.show(this.tok)}.`);
      }
    }
    this.next();
    this.depth--;
    return { ...p, t: 'table', items };
  }
}

export function parse(src: string, file: string): Chunk {
  return new Parser(src, file).chunk();
}
