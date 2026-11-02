import { ChaosError, type Plain } from '../chaosscript';

/** Rich mod panels are plain data drawn by the game, so a script never gets near the DOM. All text is shown as text. */
export interface FormOption { value: string; label: string }

export type FormControl =
  | { type: 'text'; text: string; style: 'normal' | 'muted' | 'good' | 'warn' | 'bad' | 'mono' }
  | { type: 'toggle'; id: string; label: string; hint: string; value: boolean; reset: boolean }
  | { type: 'slider'; id: string; label: string; hint: string; value: number; min: number; max: number; step: number; unit: string; reset: boolean }
  | { type: 'select'; id: string; label: string; hint: string; value: string; options: FormOption[]; reset: boolean }
  | { type: 'button'; id: string; label: string; hint: string; style: 'normal' | 'primary' | 'danger'; disabled: boolean }
  | { type: 'input'; id: string; label: string; hint: string; value: string; placeholder: string }
  | { type: 'textarea'; id: string; label: string; value: string; rows: number; readonly: boolean; filename: string }
  | { type: 'key'; id: string; label: string; hint: string; value: string }
  | { type: 'unavailable'; label: string; reason: string };

export interface FormSection { title: string; note: string; controls: FormControl[] }

export interface ModForm {
  owner: string;
  title: string;
  subtitle: string;
  scale: number;
  nav: { id: string; label: string; badge: string }[];
  active: string;
  search: { id: string; value: string; placeholder: string } | null;
  chips: { id: string; label: string }[];
  sections: FormSection[];
  footer: FormControl[];
  confirm: { text: string; yes: string; no: string } | null;
  /** Reports something the player did to the script. */
  send: (type: 'control' | 'nav' | 'reset' | 'chip', id: string, value: boolean | number | string | null) => void;
}

const MAX_CONTROLS = 1500;
const MAX_TEXT = 300;
const MAX_LONG_TEXT = 200_000;

const isObj = (v: Plain | undefined): v is { [k: string]: Plain } => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: Plain | undefined, max = MAX_TEXT): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');
const num = (v: Plain | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const list = (v: Plain | undefined): Plain[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(v: Plain | undefined, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);

function needId(c: { [k: string]: Plain }): string {
  const id = str(c.id, 120);
  if (!id) throw new ChaosError(`ui panel: a "${str(c.type)}" control needs an id.`);
  return id;
}

function parseControl(c: Plain): FormControl {
  if (!isObj(c)) throw new ChaosError('ui panel: each control must be a table.');
  const label = str(c.label);
  const hint = str(c.hint);
  switch (c.type) {
    case 'text': return { type: 'text', text: str(c.text, MAX_LONG_TEXT), style: oneOf(c.style, ['normal', 'muted', 'good', 'warn', 'bad', 'mono'] as const, 'normal') };
    case 'toggle': return { type: 'toggle', id: needId(c), label, hint, value: c.value === true, reset: c.reset === true };
    case 'slider': {
      const min = num(c.min, 0);
      const max = Math.max(min, num(c.max, 1));
      return { type: 'slider', id: needId(c), label, hint, min, max, step: Math.max(1e-4, num(c.step, 0.1)), value: Math.min(max, Math.max(min, num(c.value, min))), unit: str(c.unit, 12), reset: c.reset === true };
    }
    case 'select': {
      const options = list(c.options).slice(0, 400).map((o) => (isObj(o) ? { value: str(o.value, 120), label: str(o.label) || str(o.value, 120) } : { value: str(o, 120), label: str(o, 120) }));
      return { type: 'select', id: needId(c), label, hint, value: str(c.value, 120), options, reset: c.reset === true };
    }
    case 'button': return { type: 'button', id: needId(c), label, hint, style: oneOf(c.style, ['normal', 'primary', 'danger'] as const, 'normal'), disabled: c.disabled === true };
    case 'input': return { type: 'input', id: needId(c), label, hint, value: str(c.value, 400), placeholder: str(c.placeholder) };
    case 'textarea': return { type: 'textarea', id: needId(c), label, value: str(c.value, MAX_LONG_TEXT), rows: Math.max(2, Math.min(30, num(c.rows, 8))), readonly: c.readonly === true, filename: str(c.filename, 80).replace(/[^A-Za-z0-9_.-]/g, '_') };
    case 'key': return { type: 'key', id: needId(c), label, hint, value: str(c.value, 24) };
    case 'unavailable': return { type: 'unavailable', label, reason: str(c.reason, 600) };
    default: throw new ChaosError(`ui panel: unknown control type "${str(c.type)}". Use text, toggle, slider, select, button, input, textarea, key or unavailable.`);
  }
}

/** Checks a script's view and copies only known fields, with every length limited. */
export function parseForm(owner: string, raw: Plain, send: ModForm['send']): ModForm {
  if (!isObj(raw)) throw new ChaosError('ui panel: the view must be a table.');
  let count = 0;
  const controls = (v: Plain | undefined): FormControl[] => {
    const out = list(v).map(parseControl);
    count += out.length;
    if (count > MAX_CONTROLS) throw new ChaosError(`ui panel: more than ${MAX_CONTROLS} controls.`);
    return out;
  };
  const search = isObj(raw.search) ? { id: needId(raw.search), value: str(raw.search.value, 200), placeholder: str(raw.search.placeholder) } : null;
  const confirm = isObj(raw.confirm) ? { text: str(raw.confirm.text, 800), yes: str(raw.confirm.yes, 120), no: str(raw.confirm.no, 120) } : null;
  return {
    owner,
    title: str(raw.title),
    subtitle: str(raw.subtitle),
    scale: Math.min(1.6, Math.max(0.6, num(raw.scale, 1))),
    nav: list(raw.nav).slice(0, 32).map((n) => (isObj(n) ? { id: str(n.id, 120), label: str(n.label), badge: str(n.badge, 12) } : { id: str(n, 120), label: str(n), badge: '' })),
    active: str(raw.active, 120),
    search,
    chips: list(raw.chips).slice(0, 64).map((n) => (isObj(n) ? { id: str(n.id, 120), label: str(n.label) } : { id: str(n, 120), label: str(n) })),
    sections: list(raw.sections).slice(0, 64).map((s) => (isObj(s) ? { title: str(s.title), note: str(s.note, 800), controls: controls(s.controls) } : { title: '', note: '', controls: [] })),
    footer: controls(raw.footer),
    confirm,
    send,
  };
}
