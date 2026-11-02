import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { lint, parse } from '../chaosscript';
import { Game } from '../game/core/Game';
import { COMMANDS, main } from '../modding/cli';
import { lintContext } from '../modding/ModHost';
import { parseManifest } from '../modding/manifest';
import { analyzeMod } from '../modding/quality';

/** Runs the real CLI entry point and captures what it prints. */
async function cli(...args: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
  try {
    return { code: await main(args), out: lines.join('\n') };
  } finally {
    spy.mockRestore();
  }
}

const temp: string[] = [];
function mod(script: string, manifest: Record<string, unknown> = {}, extra: Record<string, string> = {}): string {
  mkdirSync(join(process.cwd(), 'test-results'), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), 'test-results', 'cli-mod-'));
  temp.push(dir);
  writeFileSync(join(dir, 'mod.json'), JSON.stringify({ id: 'cli_test', name: 'CLI', description: 'x', version: '1.0.0', author: 'x', api_version: '1.0', permissions: [], scripts: ['main.chaos'], ...manifest }));
  writeFileSync(join(dir, 'main.chaos'), script);
  for (const [k, v] of Object.entries(extra)) writeFileSync(join(dir, k), v);
  return dir;
}

beforeAll(() => Game.init());
afterEach(() => {
  for (const d of temp.splice(0)) rmSync(d, { recursive: true, force: true });
});

const analyze = (src: string, permissions: string[] = []) => {
  const m = parseManifest({ id: 'aa', name: 'a', version: '1.0.0', api_version: '1.0', scripts: ['a.chaos'], permissions }).manifest!;
  return analyzeMod([parse(src, 'a.chaos')], m);
};
const errors = (src: string, p: string[] = []) => analyze(src, p).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}: ${d.message}`);

describe('static quality checks', () => {
  it('compares calls with the manifest\'s permissions', () => {
    expect(errors('events.on("tick", function(e)\n  entity.remove(1)\nend)')[0]).toMatch(/^2: entity.remove needs the "world" permission/);
    expect(errors('events.on("tick", function(e) entity.remove(1) end)', ['world'])).toEqual([]);
    expect(errors('log.info(entity.exists(1))')).toEqual([]);
    expect(analyze('log.info("x")', ['world']).diagnostics[0]!.message).toMatch(/"world" is declared but no script/);
  });

  it('checks literal calls against the API', () => {
    expect(errors('register.prop{ id = "a", name = "b", shap = {type="sphere", r=1} }', ['content']).join()).toMatch(/unknown field "shap". Did you mean "shape"/);
    expect(errors('register.prop{ id = "a", name = "b" }', ['content']).join()).toMatch(/field "shape" is required/);
    expect(errors('vec.new(1, 2)').join()).toMatch(/missing argument 3/);
    expect(errors('vec.new(1, 2, 3, 4)').join()).toMatch(/at most 3/);
    expect(errors('events.on("entity_damagd", function(e) end)').join()).toMatch(/Did you mean "entity_damaged"/);
    expect(errors('events.on("my:event", function(e) end)')).toEqual([]);
    expect(errors('events.emit("plain")').join()).toMatch(/must contain ":"/);
    expect(errors('events.on("tick", function(e) register.sound{ id = "s", layers = {} } end)', ['content']).join()).toMatch(/inside a function/);
  });

  it('is not fooled by a local with a namespace\'s name', () => {
    expect(errors('local entity = {remove = function() end}\nentity.remove(1)')).toEqual([]);
    expect(errors('for _, npc in ipairs({}) do npc.stop(1) end')).toEqual([]);
    expect(errors('local function f(player) return player.teleport end')).toEqual([]);
  });

  it('collects literal ids for checking after the load', () => {
    expect(analyze('entity.spawn("thing", {x=0,y=0,z=0})', ['world']).refs).toEqual([{ kind: 'def', name: 'thing', file: 'a.chaos', line: 1 }]);
  });
});

describe('the mod command line', () => {
  it('knows every command it documents', async () => {
    expect((await cli()).out).toContain('new <id>');
    for (const c of COMMANDS) expect((await cli()).out, c).toContain(`-- ${c}`);
    expect((await cli('nonsense')).code).toBe(1);
  });

  it('validates a good mod through the real loader', async () => {
    const r = await cli('validate', mod('register.prop{ id = "ball", name = "B", shape = {type="sphere", r=0.4} }', { permissions: ['content'] }));
    expect(r.out).toContain('cli_test:ball');
    expect(r.code).toBe(0);
  });

  const failing: [string, string, Record<string, unknown>, RegExp][] = [
    ['syntax', 'register.prop{ id =', {}, /main.chaos:1:/],
    ['misspelt API', 'entity.spwan(1)', { permissions: ['world'] }, /main.chaos:1: "entity" has no "spwan"/],
    ['missing permission', 'events.on("tick", function(e)\n  fx.shake(1)\nend)', {}, /main.chaos:2: fx.shake needs the "effects" permission/],
    ['unknown field', 'register.prop{ id = "a", name = "b", shape = {type="sphere", r=1}, colour = 1 }', { permissions: ['content'] }, /Did you mean "color"/],
    // Only caught by loading the way the game does: from the menu, with no world yet.
    ['world call at the top level', 'entity.spawn("crate_wood", {x=0,y=1,z=25})', { permissions: ['world'] }, /needs a running session/],
    ['error while loading', 'log.info("start")\nerror("boom")', {}, /main.chaos:2: boom/],
    ['bad manifest', 'log.info("x")', { version: '1' }, /must look like 1.0.0/],
    ['incompatible API', 'log.info("x")', { api_version: '9.0' }, /needs API version 9.0/],
    ['missing script', 'log.info("x")', { scripts: ['nope.chaos'] }, /nope.chaos.*missing/],
    ['missing dependency', 'log.info("x")', { dependencies: ['not_there'] }, /Needs "not_there", which isn't installed/],
    ['unknown literal id', 'events.on("session_start", function(e)\n  entity.spawn("craet_wood", {x=0,y=1,z=25})\nend)', { permissions: ['world'] }, /main.chaos:2: Unknown definition "craet_wood". Did you mean "crate_wood"/],
    ['failing session_start', 'events.on("session_start", function(e)\n  error("no")\nend)', {}, /starting a session: .*main.chaos:2: no/],
  ];
  for (const [name, src, manifest, re] of failing) {
    it(`fails with a useful message: ${name}`, async () => {
      const r = await cli('validate', mod(src, manifest));
      expect(r.out).toMatch(re);
      expect(r.code).toBe(1);
    });
  }

  it('warns about a script nobody listed', async () => {
    const r = await cli('validate', mod('log.info("x")', {}, { 'other.chaos': 'log.info("y")' }));
    expect(r.out).toMatch(/other.chaos isn't listed/);
    expect(r.code).toBe(0);
  });

  it('test finds errors that only happen when things are used', async () => {
    const src = 'register.prop{ id = "p", name = "P", shape = {type="sphere", r=0.4}, on_interact = function(id)\n  error("use failed")\nend }';
    const r = await cli('test', mod(src, { permissions: ['content'] }), '1');
    expect(r.out).toMatch(/FAIL prop cli_test:p/);
    expect(r.out).toMatch(/main.chaos:2: use failed/);
    expect(r.code).toBe(1);
    const tool = 'register.tool{ id = "t", name = "T", on_primary = function() error("click failed") end }';
    expect((await cli('test', mod(tool, { permissions: ['content'] }), '1')).out).toMatch(/click failed/);
    const button = 'ui.add_button{ label = "B", on_click = function() error("button failed") end }';
    expect((await cli('test', mod(button, { permissions: ['ui'] }), '1')).out).toMatch(/button failed/);
  });

  it('info describes a mod and its load result', async () => {
    const r = await cli('info', 'furniture_pack');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Furniture Pack (furniture_pack) v1.0.0');
    expect(r.out).toContain('Permissions: content, world, effects');
    expect(r.out).toContain('Load result: loaded');
    expect(r.out).toContain('furniture_pack:poster');
    expect((await cli('info', 'chaos_playground')).out).toContain('robot_pack ^1.0.0 (optional)');
    expect((await cli('info', 'no_such_mod')).code).toBe(1);
  });

  it('list shows mods and examples', async () => {
    const r = await cli('list');
    expect(r.out).toContain('robot_pack 1.0.0');
    expect(r.out).toContain('mods/examples/npc_patrol');
  });

  it('api searches and explains', async () => {
    expect((await cli('api')).out).toContain('entity: spawn');
    const s = await cli('api', 'patrol');
    expect(s.out).toContain('npc.patrol');
    const x = await cli('api', 'npc.patrol');
    expect(x.out).toContain('Permission: world');
    expect(x.out).toContain('Example:');
    expect((await cli('api', 'explosion')).out).toContain('event "explosion"');
    expect((await cli('api', 'qqqqq')).code).toBe(1);
  });

  it('new creates a mod that passes, and refuses bad names', async () => {
    const dir = join(process.cwd(), 'mods', 'zz_cli_new');
    try {
      expect((await cli('new', 'zz_cli_new', 'tool')).code).toBe(0);
      expect((await cli('test', 'zz_cli_new', '1')).code).toBe(0);
      expect((await cli('new', 'zz_cli_new')).out).toContain('already exists');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect((await cli('new', 'Bad Name')).code).toBe(1);
    expect((await cli('new', 'zz_x', 'no_template')).out).toContain('Available');
  });

  it('docs --check agrees with the file', async () => {
    expect((await cli('docs', '--check')).code).toBe(0);
  });
});

describe('reference examples', () => {
  const dirs = readdirSync('mods/examples').map((d) => join('mods/examples', d));

  it('exist for each kind of ability', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(7);
  });

  for (const dir of dirs) {
    it(`${dir} passes every check with no warnings`, async () => {
      const r = await cli('test', dir, '2');
      expect(r.out).not.toMatch(/warning:/);
      expect(r.code, r.out).toBe(0);
    });
  }

  it('are not bundled into the game', async () => {
    const { BuiltinSource } = await import('../modding/sources');
    const all = await new BuiltinSource().list();
    expect(all.every((b) => !Object.values(b.files).some((t) => t.includes('example_')) && !(JSON.parse(b.manifest) as { id: string }).id.startsWith('example_'))).toBe(true);
  });

  it('are all listed in the examples guide', () => {
    const guide = readFileSync('docs/MODDING_EXAMPLES.md', 'utf8');
    for (const d of dirs) expect(guide, d).toContain(d);
  });

  it('every included mod declares what it uses and nothing more', async () => {
    for (const id of readdirSync('mods').filter((n) => existsSync(join('mods', n, 'mod.json')))) {
      const r = await cli('validate', id);
      expect(r.code, r.out).toBe(0);
      expect(r.out, id).not.toMatch(/warning:/);
    }
  }, 60000);
});

describe('instructions stay true', () => {
  const instructionFiles = () => ['AGENTS.md', 'CLAUDE.md', '.claude/skills/chaosscript-developer/SKILL.md', ...readdirSync('docs').map((f) => join('docs', f))];

  it('AGENTS.md and CLAUDE.md carry the mandatory rule', () => {
    const agents = readFileSync('AGENTS.md', 'utf8');
    expect(agents).toMatch(/Never use JavaScript or TypeScript for a mod's game logic/);
    for (const step of ['Read the ChaosScript instructions', 'Study the API', 'working examples', 'Write the game logic in ChaosScript', 'existing Mod API', 'syntax and permissions', "mod's tests", 'Fix what they find', 'real loader']) expect(agents, step).toContain(step);
    const claude = readFileSync('CLAUDE.md', 'utf8');
    expect(claude).toContain('@AGENTS.md');
    expect(claude).toMatch(/never for a mod's game logic/);
  });

  it('the skill has the frontmatter Claude Code needs', () => {
    const text = readFileSync('.claude/skills/chaosscript-developer/SKILL.md', 'utf8');
    const m = /^---\nname: ([a-z-]+)\ndescription: (.+)\n---\n/.exec(text);
    expect(m?.[1]).toBe('chaosscript-developer');
    for (const phrase of ['ChaosScript mod', 'NPC mod', 'weapon mod', 'vehicle mod', 'debug', 'extend an existing mod', 'game mechanic']) expect(m?.[2], phrase).toContain(phrase);
  });

  it('only mentions commands, files and templates that exist', () => {
    for (const f of instructionFiles()) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/npm run mod -- ([a-z-]+)(?: [a-z_<>/.\[\]-]+)?/g)) expect(COMMANDS, `${f}: ${m[0]}`).toContain(m[1]);
      // Names like my_mod are placeholders in instructions.
      for (const m of text.matchAll(/`((?:docs|mods|templates|src|\.claude)\/[\w./-]+\.(?:md|chaos|json|ts))`/g)) if (!/\/(my_\w+|your_\w+)\b/.test(m[1]!)) expect(existsSync(m[1]!), `${f}: ${m[1]}`).toBe(true);
      for (const m of text.matchAll(/\b(docs\/[A-Z_]+\.md)\b/g)) expect(existsSync(m[1]!), `${f}: ${m[1]}`).toBe(true);
    }
  });

  it('the skill\'s lint context covers the same names as the API', () => {
    expect(lint([parse('print(entity.spawn, npc.patrol)', 'a')], lintContext())).toEqual([]);
  });
});
