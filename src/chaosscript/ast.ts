export interface Pos { line: number; col: number }

export type Expr = Pos & (
  | { t: 'nil' }
  | { t: 'bool'; v: boolean }
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; name: string }
  | { t: 'member'; obj: Expr; name: string }
  | { t: 'index'; obj: Expr; key: Expr }
  | { t: 'call'; fn: Expr; args: Expr[] }
  | { t: 'method'; obj: Expr; name: string; args: Expr[] }
  | { t: 'fn'; fn: FnBody }
  | { t: 'table'; items: TableItem[] }
  | { t: 'un'; op: 'not' | '-' | '#'; e: Expr }
  | { t: 'bin'; op: BinOp; a: Expr; b: Expr }
  | { t: 'and'; a: Expr; b: Expr }
  | { t: 'or'; a: Expr; b: Expr }
);

export type BinOp = '+' | '-' | '*' | '/' | '%' | '^' | '..' | '==' | '~=' | '<' | '<=' | '>' | '>=';

export type TableItem = { k: 'pos'; v: Expr } | { k: 'name'; name: string; v: Expr } | { k: 'expr'; key: Expr; v: Expr };

export interface FnBody extends Pos {
  name: string;
  params: string[];
  body: Block;
}

export interface Block {
  stmts: Stmt[];
  /** Blocks without declarations don't need a scope of their own. */
  scoped: boolean;
}

export type Stmt = Pos & (
  | { t: 'local'; names: string[]; values: Expr[] }
  | { t: 'global'; name: string; value: Expr | null }
  | { t: 'assign'; target: Expr; value: Expr }
  | { t: 'expr'; e: Expr }
  | { t: 'if'; arms: { cond: Expr; body: Block }[]; other: Block | null }
  | { t: 'while'; cond: Expr; body: Block }
  | { t: 'repeat'; body: Block; cond: Expr }
  | { t: 'fornum'; name: string; from: Expr; to: Expr; step: Expr | null; body: Block }
  | { t: 'forin'; key: string; value: string | null; iter: Expr; body: Block }
  | { t: 'localfn'; name: string; fn: FnBody }
  | { t: 'globalfn'; path: string[]; fn: FnBody }
  | { t: 'do'; body: Block }
  | { t: 'return'; value: Expr | null }
  | { t: 'break' }
  | { t: 'continue' }
);

export interface Chunk {
  file: string;
  body: Block;
}
