import { ChaosSyntaxError } from './errors';

export type TokenType = 'num' | 'str' | 'id' | 'kw' | 'op' | 'eof';

export interface Token {
  type: TokenType;
  text: string;
  value?: number | string;
  line: number;
  col: number;
}

export const KEYWORDS = new Set(['and', 'break', 'continue', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'global', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);

const OPS3 = ['...'];
const OPS2 = ['==', '~=', '!=', '<=', '>=', '..', '+=', '-=', '*=', '/=', '&&', '||'];
const OPS1 = '+-*/%^#<>=(){}[];:,.';

export const MAX_SOURCE_BYTES = 512 * 1024;

export function tokenize(src: string, file: string): Token[] {
  if (src.length > MAX_SOURCE_BYTES) throw new ChaosSyntaxError(`Script is too large (limit ${MAX_SOURCE_BYTES / 1024} KB).`, file, 1, 1);
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const fail = (msg: string): never => {
    throw new ChaosSyntaxError(msg, file, line, i - lineStart + 1);
  };

  const longBracket = (): string | null => {
    if (src[i] !== '[' || src[i + 1] !== '[') return null;
    i += 2;
    const startLine = line;
    const end = src.indexOf(']]', i);
    if (end < 0) {
      line = startLine;
      return fail('Unclosed [[ long string or comment.');
    }
    let text = src.slice(i, end);
    for (let k = i; k < end; k++) {
      if (src[k] === '\n') {
        line++;
        lineStart = k + 1;
      }
    }
    i = end + 2;
    if (text[0] === '\n') text = text.slice(1);
    return text;
  };

  while (i < src.length) {
    const c = src[i]!;
    if (c === '\n') {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '-' && src[i + 1] === '-') {
      i += 2;
      if (longBracket() !== null) continue;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    const col = i - lineStart + 1;
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1]! >= '0' && src[i + 1]! <= '9')) {
      const m = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(src.slice(i, i + 64));
      const text = m![0];
      i += text.length;
      if (/[A-Za-z_]/.test(src[i] ?? '')) fail(`Malformed number near "${text}${src[i]}".`);
      out.push({ type: 'num', text, value: Number(text), line, col });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      const text = src.slice(start, i);
      out.push({ type: KEYWORDS.has(text) ? 'kw' : 'id', text, line, col });
      continue;
    }
    if (c === '"' || c === "'") {
      const startLine = line;
      i++;
      let s = '';
      for (;;) {
        if (i >= src.length || src[i] === '\n') {
          line = startLine;
          fail(`Unclosed string: missing ${c}.`);
        }
        const d = src[i++]!;
        if (d === c) break;
        if (d !== '\\') {
          s += d;
          continue;
        }
        const e = src[i++];
        if (e === 'n') s += '\n';
        else if (e === 't') s += '\t';
        else if (e === 'r') s += '\r';
        else if (e === '\\' || e === '"' || e === "'") s += e;
        else if (e === 'x') {
          const h = src.slice(i, i + 2);
          if (!/^[0-9a-fA-F]{2}$/.test(h)) fail('\\x needs two hex digits.');
          s += String.fromCharCode(parseInt(h, 16));
          i += 2;
        } else fail(`Unknown escape \\${e ?? ''} in string.`);
      }
      out.push({ type: 'str', text: s, value: s, line, col });
      continue;
    }
    if (c === '[' && src[i + 1] === '[') {
      const startLine = line;
      const s = longBracket()!;
      out.push({ type: 'str', text: s, value: s, line: startLine, col });
      continue;
    }
    const three = src.slice(i, i + 3);
    if (OPS3.includes(three)) fail('Varargs (...) are not part of ChaosScript. Pass a table instead.');
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) {
      i += 2;
      if (two === '+=' || two === '-=' || two === '*=' || two === '/=') fail(`ChaosScript has no ${two}. Write x = x ${two[0]} y.`);
      if (two === '&&') fail('Use "and" instead of &&.');
      if (two === '||') fail('Use "or" instead of ||.');
      out.push({ type: 'op', text: two === '!=' ? '~=' : two, line, col });
      continue;
    }
    if (OPS1.includes(c)) {
      i++;
      out.push({ type: 'op', text: c, line, col });
      continue;
    }
    fail(`Unexpected character "${c}".`);
  }
  out.push({ type: 'eof', text: '<end of file>', line, col: i - lineStart + 1 });
  return out;
}
