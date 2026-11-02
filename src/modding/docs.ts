import { BASE_LIB, MATH_CONSTANTS, MATH_LIB, STRING_LIB, TABLE_LIB } from '../chaosscript';
import { ALL_API } from './api';
import { NS_DOCS, NS_ORDER, type ApiFn } from './api/types';
import { EVENT_NAMES } from './events';
import { MODEL_PART_FIELDS, typeLabel, type Schema } from './fields';
import { API_VERSION, PERMISSION_INFO } from './manifest';
import { signature } from './ModHost';

const escape = (s: string) => s.replace(/\|/g, '\\|');

function fieldTable(s: Schema): string {
  const rows = Object.entries(s).map(([k, f]) => `| \`${k}\` | ${escape(typeLabel(f))} | ${f.required ? 'required' : escape(f.default ?? '')} | ${escape(f.doc)} |`);
  return `| Field | Type | Default | Meaning |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;
}

function entry(f: ApiFn): string {
  const lines = [`### \`${f.ns}.${f.name}\``, '', `\`${signature(f)}\``, '', f.doc, ''];
  const notes: string[] = [];
  if (f.perm) notes.push(`Permission: \`${f.perm}\`.`);
  if (f.world) notes.push('Needs a running session.');
  if (f.loadOnly) notes.push('Only while the mod is loading.');
  if (notes.length) lines.push(notes.join(' '), '');
  const documented = f.params.filter((p) => p.doc);
  if (documented.length) {
    for (const p of documented) lines.push(`- \`${p.name}\`: ${p.doc}`);
    lines.push('');
  }
  if (f.fields) lines.push(fieldTable(f.fields));
  lines.push('```lua', f.example, '```', '');
  return lines.join('\n');
}

function stdSection(title: string, lib: Record<string, { sig: string; doc: string }>): string {
  return [`### ${title}`, '', '| Function | Meaning |', '| --- | --- |', ...Object.values(lib).map((e) => `| \`${escape(e.sig)}\` | ${escape(e.doc)} |`), ''].join('\n');
}

/** CHAOSSCRIPT_API.md, from the same entries the game runs. A test checks the file on disk matches this. */
export function generateApiDoc(): string {
  const out: string[] = [
    '# ChaosScript API',
    '',
    '<!-- Generated from src/modding/api. Do not edit: run `npm run mod -- docs`. -->',
    '',
    `API version ${API_VERSION}. Every function below exists, and a test runs every example against a real game. New to modding? Start with [MODDING_GUIDE.md](MODDING_GUIDE.md).`,
    '',
    '## Conventions',
    '',
    '- **Positions and vectors** are tables: `{x=0, y=1, z=0}`. `{0, 1, 0}` is accepted too. The y axis points up, and the player faces -z at yaw 0.',
    '- **Entities** are integer ids. A function given an id that no longer exists returns nil and does nothing.',
    '- **Ids.** A name without `:` looks in your mod first, then in core content. `other_mod:thing` is exact.',
    '- **Text** shown to players can be a string or `{en="...", ru="..."}`.',
    '- **Colours** are `0xRRGGBB` numbers or `"#rrggbb"`.',
    '- **Wrong arguments are errors**, with a message saying what was expected. Unknown fields in a definition table are errors too.',
    '- A square-bracketed parameter in a signature is optional.',
    '',
    '## Permissions',
    '',
    'Declared in `mod.json`. Functions without a permission are always allowed.',
    '',
    '| Permission | Allows |',
    '| --- | --- |',
    ...Object.entries(PERMISSION_INFO).map(([k, v]) => `| \`${k}\` | ${v} |`),
    '',
    '## Contents',
    '',
    ...NS_ORDER.map((ns) => `- [${ns}](#${ns}): ${ALL_API.filter((f) => f.ns === ns).map((f) => f.name).join(', ')}`),
    '- [Events](#events), [Model parts](#model-parts), [Standard library](#standard-library)',
    '',
  ];
  for (const ns of NS_ORDER) {
    out.push(`## ${ns}`, '', NS_DOCS[ns] ?? '', '');
    for (const f of ALL_API.filter((x) => x.ns === ns)) out.push(entry(f));
  }
  out.push('## Events', '', 'Subscribe with `events.on(name, function(e) ... end)`. `e` is a table with these fields.', '', '| Event | Fields of `e` | When |', '| --- | --- | --- |');
  for (const [k, v] of Object.entries(EVENT_NAMES)) out.push(`| \`${k}\` | ${v.fields} | ${escape(v.doc)} |`);
  out.push('', 'Custom events have names containing `:`, are sent with `events.emit`, and reach every loaded mod.', '');
  out.push('## Model parts', '', 'A `model` or `view_parts` field is a list of primitive parts, each a table with these fields.', '', fieldTable(MODEL_PART_FIELDS));
  out.push('## Standard library', '', stdSection('Basics', { ...BASE_LIB, print: { sig: 'print(a, b...)', doc: 'Same as log.info.' } }), stdSection('math', MATH_LIB), `Constants: ${Object.keys(MATH_CONSTANTS).map((k) => `\`math.${k}\``).join(', ')}.`, '', stdSection('string', STRING_LIB), stdSection('table', TABLE_LIB));
  return out.join('\n');
}
