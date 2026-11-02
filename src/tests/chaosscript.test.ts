import { describe, expect, it } from 'vitest';
import { ChaosError, ChaosLimitError, ChaosSyntaxError, installStdlib, Interpreter, lint, NativeFunction, parse, STD_GLOBALS, STD_NAMESPACES, Table, type Limits, type Value } from '../chaosscript';

function vmFor(limits: Partial<Limits> = {}) {
  const out: string[] = [];
  const vm = new Interpreter(limits);
  installStdlib(vm, (s) => out.push(s));
  return { vm, out };
}

/** Runs source and returns what it printed. */
function run(src: string, limits: Partial<Limits> = {}): string[] {
  const { vm, out } = vmFor(limits);
  vm.run(parse(src, 'test.chaos'));
  return out;
}

function failure(src: string, limits: Partial<Limits> = {}): ChaosError {
  try {
    run(src, limits);
  } catch (e) {
    expect(e).toBeInstanceOf(ChaosError);
    return e as ChaosError;
  }
  throw new Error('expected the script to fail');
}

const lintOf = (src: string) => lint([parse(src, 'a.chaos')], { globals: STD_GLOBALS, namespaces: STD_NAMESPACES });

describe('ChaosScript language', () => {
  it('has the basic types and arithmetic', () => {
    expect(run(`print(1 + 2 * 3, (1 + 2) * 3, 2 ^ 3 ^ 2, 7 % 3, -7 % 3, 10 / 4, 0xff, 1e3)`)).toEqual(['7 9 512 1 2 2.5 255 1000']);
    expect(run(`print(type(nil), type(true), type(1), type("s"), type({}), type(print), type(function() end))`)).toEqual(['nil boolean number string table function function']);
    expect(run(`print("a" .. "b" .. 1, #"abc", not nil, not 0, 1 == 1, "1" == 1, 1 ~= 2, 1 != 2)`)).toEqual(['ab1 3 true false true false true true']);
    expect(run(`print(nil or "d", false and 1, 0 and "zero is true", 1 < 2, "a" < "b")`)).toEqual(['d false zero is true true true']);
    expect(run(`print("tab\\there", 'q"uote', "\\x41", [[long
string]])`)).toEqual(['tab\there q"uote A long\nstring']);
  });

  it('scopes variables and closures per iteration', () => {
    expect(run(`
      local x = 1
      do local x = 2; print(x) end
      print(x)
      local fs = {}
      for i = 1, 3 do fs[i] = function() return i end end
      print(fs[1](), fs[2](), fs[3]())
      local function counter()
        local n = 0
        return function() n = n + 1; return n end
      end
      local c = counter(); c(); print(c())
    `)).toEqual(['2', '1', '1 2 3', '2']);
  });

  it('has all loop forms, break and continue', () => {
    expect(run(`
      local s = ""
      for i = 1, 5 do if i == 2 then continue end if i == 4 then break end s = s .. i end
      print(s)
      s = ""
      for i = 10, 1, -3 do s = s .. i .. " " end
      print(s)
      local n = 0
      while true do n = n + 1; if n > 2 then break end end
      print(n)
      repeat local done = true; n = n + 1 until done
      print(n)
    `)).toEqual(['13', '10 7 4 1 ', '3', '4']);
  });

  it('handles if, elseif, else and recursion', () => {
    expect(run(`
      local function fib(n) if n < 2 then return n else return fib(n - 1) + fib(n - 2) end end
      local function kind(n) if n < 0 then return "neg" elseif n == 0 then return "zero" else return "pos" end end
      print(fib(15), kind(-1), kind(0), kind(1))
    `)).toEqual(['610 neg zero pos']);
  });

  it('has tables, lists, pairs in insertion order, and methods', () => {
    expect(run(`
      local t = { 10, 20, x = 1, ["y z"] = 2, [true] = 3 }
      print(#t, t[1], t.x, t["y z"], t[true], t.none)
      local keys = {}
      for k, v in pairs(t) do table.insert(keys, tostring(k)) end
      print(table.concat(keys, ","))
      local obj = { name = "bot" }
      function obj.hi(self, w) return self.name .. " says " .. w end
      print(obj:hi("yo"), ("abc"):upper(), #t)
      t[3] = 30; print(#t); t[3] = nil; print(#t)
      for i, v in ipairs({ "a", "b" }) do print(i, v) end
      for k in pairs({ only = 1 }) do print(k) end
    `)).toEqual(['2 10 1 2 3 nil', '1,2,x,y z,true', 'bot says yo ABC 2', '3', '2', '1 a', '2 b', 'only']);
  });

  it('allows changing a table during its own loop', () => {
    expect(run(`local t = {a=1,b=2,c=3}; for k in pairs(t) do t[k] = nil; t[k .. k] = 1 end print(table.count(t))`)).toEqual(['3']);
  });

  it('has a standard library', () => {
    expect(run(`print(math.floor(1.7), math.ceil(1.2), math.abs(-2), math.max(1, 2), math.min(1, 2), math.clamp(5, 0, 3), math.lerp(0, 10, 0.5), math.round(1.5))`)).toEqual(['1 2 2 2 1 3 5 2']);
    expect(run(`print(string.sub("hello", 2, 3), string.sub("hello", -2), string.find("hello", "ll"), string.upper("a"), string.rep("ab", 2), string.trim("  x "), string.replace("a-b-c", "-", "+"))`)).toEqual(['el lo 3 A abab x a+b+c']);
    expect(run(`print(string.format("%s %d %.2f %%", "x", 3.9, 1.005), tonumber("12"), tonumber("x"), tostring(1.5))`)).toEqual(['x 3 1.00 % 12 nil 1.5']);
    expect(run(`local t = {3,1,2}; table.sort(t); print(table.concat(t, ",")); table.sort(t, function(a,b) return a > b end); print(table.concat(t, ",")); print(table.remove(t), #t); table.insert(t, 1, 9); print(t[1], table.contains(t, 9), table.count({a=1,2}))`)).toEqual(['1,2,3', '3,2,1', '1 2', '9 true 2']);
    expect(run(`local p = string.split("a,b", ","); print(#p, p[2], tostring({1,x=2}))`)).toEqual(['2 b {1, x=2}']);
    expect(run(`local n = math.random(1, 3); print(n >= 1 and n <= 3, math.random() < 1)`)).toEqual(['true true']);
  });

  it('makes random numbers per seed', () => {
    const roll = (seed: number) => {
      const out: string[] = [];
      const vm = new Interpreter();
      installStdlib(vm, (s) => out.push(s), seed);
      vm.run(parse('print(math.random(1, 1000000))', 'a'));
      return out[0];
    };
    expect(roll(5)).toBe(roll(5));
    expect(roll(5)).not.toBe(roll(6));
  });

  it('shares globals between files but not file locals', () => {
    const { vm, out } = vmFor();
    vm.run(parse('local secret = 1; global shared = 2; function helper() return shared + secret end', 'a.chaos'));
    vm.run(parse('print(shared, helper()); print(pcall(function() return secret end).ok)', 'b.chaos'));
    expect(out).toEqual(['2 3', 'false']);
  });

  it('catches errors with pcall and lets scripts raise them', () => {
    expect(run(`
      local r = pcall(function() error("boom") end); print(r.ok, r.error)
      local g = pcall(function(a, b) return a + b end, 1, 2); print(g.ok, g.value)
      print(pcall(assert, false, "nope").error)
    `)).toEqual(['false boom', 'true 3', 'nope']);
  });
});

describe('ChaosScript errors', () => {
  it('reports syntax errors with the line and a useful message', () => {
    const cases: [string, number, RegExp][] = [
      ['if x then\nprint(1)\n', 3, /Missing "end" for the if statement opened on line 1/],
      ['local = 1', 1, /Expected a name after "local"/],
      ['print("x', 1, /Unclosed string/],
      ['x += 1', 1, /no \+=/],
      ['if a && b then end', 1, /Use "and"/],
      ['local t = {1, 2\nprint(t)', 2, /Expected "," or "}" in the table opened on line 1/],
      ['for i in do end', 1, /Unexpected "do"/],
      ['function f(a, a) end', 1, /Duplicate parameter/],
      ['return 1\nprint(2)', 2, /last statement/],
      ['x', 1, /Expected "=" or a function call/],
      ['local a, b = 1, 2, 3', 1, /More values than names/],
      ['return 1, 2', 1, /returns one value/],
    ];
    for (const [src, line, re] of cases) {
      const e = failure(src);
      expect(e, src).toBeInstanceOf(ChaosSyntaxError);
      expect(e.message, src).toMatch(re);
      expect(e.line, src).toBe(line);
    }
  });

  it('reports runtime errors with the line and what went wrong', () => {
    const cases: [string, number, RegExp][] = [
      ['\n\nlocal t = nil\nprint(t.x)', 4, /Attempt to index nil \(variable "t", looking for "x"\)/],
      ['undefined_thing = 1', 1, /Cannot assign to unknown variable "undefined_thing"/],
      ['print(nope)', 1, /Unknown variable "nope"/],
      ['local count = 1\nprint(coutn)', 2, /Did you mean "count"/],
      ['local t = {}\nt.foo()', 2, /Attempt to call nil \(field "t.foo"\)/],
      ['local x = {} + 1', 1, /Attempt to apply "\+" to table and number/],
      ['print("a" .. {})', 1, /Attempt to join string and table/],
      ['print(1 < "2")', 1, /Attempt to apply "<" to number and string/],
      ['math.pi = 3', 1, /read-only/],
      ['print(math.floor("x"))', 1, /math.floor: argument 1 must be a number/],
      ['local t = {}\nt[nil] = 1', 2, /key cannot be nil/],
      ['for i = 1, 2, 0 do end', 1, /step of 0/],
      ['for k in 5 do end', 1, /needs pairs/],
    ];
    for (const [src, line, re] of cases) {
      const e = failure(src);
      expect(e.message, src).toMatch(re);
      expect(e.line, src).toBe(line);
      expect(e.file, src).toBe('test.chaos');
    }
  });

  it('records a call stack', () => {
    const e = failure('local function inner()\n  error("deep")\nend\nlocal function outer()\n  inner()\nend\nouter()');
    expect(e.format()).toContain('test.chaos:2: deep');
    expect(e.trace.map((f) => f.fn)).toEqual(['inner', 'outer']);
  });
});

describe('ChaosScript sandbox limits', () => {
  it('stops endless loops and recursion, and pcall cannot hide them', () => {
    for (const src of ['while true do end', 'repeat until false', 'for i = 1, math.huge do end', 'local function f() return f() end f()', 'pcall(function() while true do end end)', 'local function f() f() f() end f()']) {
      const e = failure(src, { fuel: 5000 });
      expect(e, src).toBeInstanceOf(ChaosLimitError);
    }
  });

  it('survives a deep recursion without blowing the JavaScript stack', () => {
    const e = failure('local function f(n) return f(n + 1) + 1 end f(1)');
    expect(e).toBeInstanceOf(ChaosLimitError);
    expect((e as ChaosLimitError).limit).toBe('stack');
  });

  it('limits memory', () => {
    expect(failure('local t = {}; for i = 1, 1000000 do t[i] = i end', { fuel: 1e8, tableSize: 1000 })).toBeInstanceOf(ChaosLimitError);
    expect(failure('local t = {}; for i = 1, 1000000 do t[i] = i end', { fuel: 1e8, allocations: 1000 })).toBeInstanceOf(ChaosLimitError);
    expect(failure('local s = "x"; while true do s = s .. s end', { fuel: 1e8 })).toBeInstanceOf(ChaosLimitError);
    expect(failure('print(string.rep("x", 1e12))')).toBeInstanceOf(ChaosLimitError);
    expect(failure('local big = string.rep("a", 100000); local long = string.rep("b", 100000); print(#string.replace(big, "a", long))')).toBeInstanceOf(ChaosLimitError);
    expect(failure('local big = string.rep("a", 100000); local t = {}; for i = 1, 100 do t[i] = big end; print(#table.concat(t))')).toBeInstanceOf(ChaosLimitError);
  });

  it('measures the retained heap, through closures too', () => {
    const { vm } = vmFor();
    const before = vm.measureHeap();
    vm.run(parse('global big = {}; for i = 1, 5000 do big[i] = i end; local hidden = {}; for i = 1, 3000 do hidden[i] = i end; global f = function() return hidden end', 'a'));
    expect(vm.measureHeap() - before).toBeGreaterThan(8000);
  });

  it('cannot reach JavaScript from a script', () => {
    // Every one of these is plain data or an error, never a host object.
    const r = run(`
      local t = {}
      print(t.__proto__, t.constructor, t.toString, t.hasOwnProperty)
      t.__proto__ = { polluted = true }
      print(t.polluted, ({}).polluted)
      print(pcall(function() return ("x").constructor end).ok)
      print(pcall(function() return print.call end).ok)
      print(pcall(function() return globalThis end).ok, pcall(function() return window end).ok, pcall(function() return process end).ok, pcall(function() return require end).ok, pcall(function() return eval end).ok)
    `);
    expect(r).toEqual(['nil nil nil nil', 'nil nil', 'true', 'false', 'false false false false false']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('stays usable after a failure, and each entry gets fresh fuel', () => {
    const { vm, out } = vmFor({ fuel: 1000 });
    vm.run(parse('global spin = function() while true do end end; global ok = function() print("fine") end', 'a'));
    expect(() => vm.call(vm.globals.vars.get('spin')!)).toThrow(ChaosLimitError);
    vm.call(vm.globals.vars.get('ok')!);
    expect(out).toEqual(['fine']);
  });

  it('passes host values safely through natives', () => {
    const { vm, out } = vmFor();
    let seen: Value = null;
    vm.define('host', new NativeFunction('host', (a) => {
      seen = a[0] ?? null;
      const t = new Table();
      t.set('n', 7);
      return t;
    }));
    vm.run(parse('print(host("hi").n)', 'a'));
    expect(seen).toBe('hi');
    expect(out).toEqual(['7']);
  });

  it('runs fast enough for per-tick callbacks', () => {
    const { vm } = vmFor({ fuel: 5e7 });
    vm.run(parse('global work = function() local s = 0; for i = 1, 100000 do s = s + i % 3 end return s end', 'a'));
    const t = performance.now();
    vm.call(vm.globals.vars.get('work')!, [], 5e7);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('ChaosScript linter', () => {
  it('passes correct code', () => {
    expect(lintOf(`
      local a = 1
      global b = 2
      function helper(x) return x + a + b end
      local function self_call(n) if n > 0 then return self_call(n - 1) end end
      for i = 1, 2 do print(i, helper(i)) end
      for k, v in pairs({}) do print(k, v) end
      repeat local done = true until done
      print(math.pi, string.upper("x"), later())
      function later() return 1 end
    `)).toEqual([]);
  });

  it('finds misspelt variables and library calls before running', () => {
    const d = lintOf(`local count = 1\nprint(coutn)\nundeclared = 2\nprint(math.flor(1))\nprint(string.uppr("a"))`);
    expect(d.map((x) => [x.line, x.severity])).toEqual([[2, 'error'], [3, 'error'], [4, 'error'], [5, 'error']]);
    expect(d[0]!.message).toContain('Did you mean "count"');
    expect(d[2]!.message).toContain('Did you mean "floor"');
  });

  it('does not confuse a local with a namespace', () => {
    expect(lintOf('local math = { custom = 1 }; print(math.custom)')).toEqual([]);
  });

  it('respects block scope', () => {
    expect(lintOf('do local inner = 1 end\nprint(inner)')[0]!.line).toBe(2);
  });

  it('sees globals from other files', () => {
    const chunks = [parse('global a = 1\nfunction f() end', 'a.chaos'), parse('print(a, f())', 'b.chaos')];
    expect(lint(chunks, { globals: STD_GLOBALS, namespaces: {} })).toEqual([]);
  });
});
