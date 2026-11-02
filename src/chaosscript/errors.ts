export interface TraceFrame { fn: string; file: string; line: number }

/** A problem in a script. Always carries a location once it reaches the host. */
export class ChaosError extends Error {
  file = '';
  line = 0;
  col = 0;
  trace: TraceFrame[] = [];
  located = false;

  constructor(message: string) {
    super(message);
    this.name = 'ChaosError';
  }

  at(file: string, line: number, col = 0): this {
    this.file = file;
    this.line = line;
    this.col = col;
    this.located = true;
    return this;
  }

  /** `main.chaos:12: attempt to call nil`, followed by the call stack when there is one. */
  format(): string {
    const head = this.file ? `${this.file}:${this.line}: ${this.message}` : this.message;
    if (this.trace.length < 2) return head;
    return `${head}\n${this.trace.slice(0, 8).map((f) => `  in ${f.fn} (${f.file}:${f.line})`).join('\n')}`;
  }
}

export class ChaosSyntaxError extends ChaosError {
  constructor(message: string, file: string, line: number, col: number) {
    super(message);
    this.name = 'ChaosSyntaxError';
    this.at(file, line, col);
  }
}

/** Ran out of fuel, memory or stack. A script can't catch this, so it can't ignore its limits. */
export class ChaosLimitError extends ChaosError {
  constructor(message: string, readonly limit: 'fuel' | 'stack' | 'memory') {
    super(message);
    this.name = 'ChaosLimitError';
  }
}

/** Closest candidate, for "did you mean" hints. */
export function closest(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestD = Math.max(2, Math.floor(name.length / 3)) + 1;
  for (const c of candidates) {
    const d = editDistance(name, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 4) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}
