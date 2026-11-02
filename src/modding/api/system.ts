import { ChaosError, isCallable, Table, toDisplay, toPlain, type Value } from '../../chaosscript';
import { readFields, toLoc, type Schema } from '../fields';
import { ScriptedMode } from '../ScriptedMode';
import { fn, type ApiFn } from './types';

export const BUILTIN_SOUNDS = ['click', 'lever', 'uiHover', 'uiClick', 'error', 'success', 'jump', 'land', 'hurt', 'bounce', 'spring', 'door', 'motorOn', 'motorOff', 'grab', 'release', 'throw', 'pin', 'place', 'remove', 'undo', 'blaster', 'tracer', 'impulse', 'charge', 'freeze', 'frozen', 'thaw', 'bouncer', 'pop', 'disintegrate', 'dissolved', 'gravity', 'explode', 'reload', 'empty', 'slam', 'robotShot', 'robotIdle', 'npcAlert', 'npcHurt', 'npcDie', 'npcTalk', 'creature', 'breakWood', 'breakStone', 'breakMetal', 'glass'];

const PANEL_FIELDS: Schema = {
  id: { type: 'string', required: true, doc: 'Your name for this panel. Showing the same id again updates it.' },
  title: { type: 'loc', doc: 'Heading.' },
  lines: { type: 'locs', doc: 'Text lines, up to 12.' },
};

const MENU_FIELDS: Schema = {
  title: { type: 'loc', required: true, doc: 'Heading.' },
  text: { type: 'loc', doc: 'Paragraph under the heading.' },
  buttons: { type: 'table', required: true, doc: 'List of {label="...", on_click=function() end, close=true}. close=false keeps the menu open. Up to 12.' },
};

const BUTTON_FIELDS: Schema = {
  label: { type: 'loc', required: true, doc: 'Button text.' },
  on_click: { type: 'function', required: true, doc: 'on_click().' },
};

const FINISH_FIELDS: Schema = {
  win: { type: 'boolean', required: true, doc: 'Won or lost, which sets the colour.' },
  title: { type: 'loc', required: true, doc: 'Heading of the result screen.' },
  detail: { type: 'loc', doc: 'Text under the heading.' },
  can_continue: { type: 'boolean', default: 'false', doc: 'Offers a Keep playing button.' },
};

const text = (a: Value[]) => a.map((v) => toDisplay(v)).join(' ');

export const SYSTEM_API: ApiFn[] = [
  // ── log ── These take any number of values, so they read their arguments directly.
  fn('log', 'info', { params: [{ name: 'values...', type: 'any', optional: true }], doc: 'Writes to the debug console. Values are joined with spaces.', example: 'log.info("spawned", 3, "crates")', impl: (h, ...a: Value[]) => h.log('info', text(a)) }),
  fn('log', 'warn', { params: [{ name: 'values...', type: 'any', optional: true }], doc: 'Writes a warning.', example: 'log.warn("low on crates")', impl: (h, ...a: Value[]) => h.log('warn', text(a)) }),
  fn('log', 'error', { params: [{ name: 'values...', type: 'any', optional: true }], doc: 'Writes an error, shown in the mod manager. It does not stop the script: use error() for that.', example: 'log.error("something looks wrong")', impl: (h, ...a: Value[]) => h.log('error', text(a)) }),

  // ── mod ──
  fn('mod', 'id', { params: [], returns: 'string', doc: 'This mod\'s id.', example: 'assert(type(mod.id()) == "string")', impl: (h) => h.id }),
  fn('mod', 'version', { params: [], returns: 'string', doc: 'This mod\'s version.', example: 'log.info(mod.version())', impl: (h) => h.manifest.version }),
  fn('mod', 'full_id', { params: [{ name: 'name', type: 'string' }], returns: 'string', doc: 'The namespaced id for one of this mod\'s things.', example: 'assert(mod.full_id("chair") == mod.id() .. ":chair")', impl: (h, n: string) => `${h.id}:${n}` }),
  fn('mod', 'has_permission', { params: [{ name: 'name', type: 'string' }], returns: 'boolean', doc: 'True if the manifest grants this permission.', example: 'log.info(mod.has_permission("world"))', impl: (h, p: string) => h.hasPermission(p) }),
  fn('mod', 'is_loaded', { params: [{ name: 'id', type: 'string' }], returns: 'boolean', doc: 'True if another mod is enabled and working. Useful for optional dependencies.', example: 'log.info(mod.is_loaded("robot_pack"))', impl: (h, id: string) => h.manager.isLoaded(id) }),
  fn('mod', 'list', { params: [], returns: 'list of {id, name, version, state}', doc: 'Every installed mod.', example: 'assert(type(mod.list()) == "table")', impl: (h) => h.manager.list().map((m) => ({ id: m.id, name: m.manifest?.name ?? m.id, version: m.manifest?.version ?? '', state: m.state })) }),

  // ── sound ──
  fn('sound', 'play', { params: [{ name: 'name', type: 'string', doc: 'See sound.names().' }, { name: 'volume', type: 'number', optional: true, doc: '0 to 1. Default 1.' }, { name: 'position', type: 'vec3', optional: true, doc: 'Makes it come from a place in the world.' }], perm: 'effects', doc: 'Plays a sound.', example: 'sound.play("spring", 0.5)', impl: (h, n: string, v: number | null, p: { x: number; y: number; z: number } | null) => {
    const id = h.sounds.has(`${h.id}:${n}`) ? `${h.id}:${n}` : n;
    if (!h.sounds.has(id) && !BUILTIN_SOUNDS.includes(id) && !id.includes(':')) throw new ChaosError(`sound.play: unknown sound "${n}". See sound.names().`);
    h.game.audio.play(id, Math.max(0, Math.min(1, v ?? 1)), p ?? undefined);
  } }),
  fn('sound', 'names', { params: [], returns: 'list of names', doc: 'Built-in sounds and this mod\'s own.', example: 'assert(table.contains(sound.names(), "explode"))', impl: (h) => [...BUILTIN_SOUNDS, ...h.sounds] }),

  // ── ui ──
  fn('ui', 'toast', { params: [{ name: 'text', type: 'any', doc: 'Text or {en=, ru=}.' }, { name: 'kind', type: 'string', optional: true, doc: '"info", "success", "warn" or "error".' }], perm: 'ui', doc: 'A brief message on screen.', example: 'ui.toast("Crate delivered", "success")', impl: (h, t: Value, k: string | null) => {
    if (k !== null && k !== 'info' && k !== 'success' && k !== 'warn' && k !== 'error') throw new ChaosError(`ui.toast: kind must be "info", "success", "warn" or "error", got "${k}".`);
    h.game.toast(toLoc(t, 'ui.toast: text')[h.game.settings.language], (k ?? 'info') as 'info');
  } }),
  fn('ui', 'show_panel', { params: [{ name: 'def', type: 'table' }], perm: 'ui', fields: PANEL_FIELDS, doc: 'A text panel in the corner of the HUD, until hidden. A mod can show up to 4. Removed when the mod unloads, and at the end of the session.', example: 'ui.show_panel{ id = "score", title = "Score", lines = {"Crates: 3"} }\nui.hide_panel("score")', impl: (h, t: Table) => {
    const f = readFields(t, PANEL_FIELDS, 'ui.show_panel');
    h.showPanel(f.id as string, (f.title as { en: string } | undefined) as never, (f.lines as never[] | undefined)?.slice(0, 12) ?? []);
  } }),
  fn('ui', 'hide_panel', { params: [{ name: 'id', type: 'string' }], perm: 'ui', doc: 'Removes a panel.', example: 'ui.hide_panel("score")', impl: (h, id: string) => h.hidePanel(id) }),
  fn('ui', 'open_menu', { params: [{ name: 'def', type: 'table' }], perm: 'ui', world: true, fields: MENU_FIELDS, doc: 'Opens a dialog with buttons and frees the mouse. The world keeps running.', example: 'ui.open_menu{\n  title = "Reactor",\n  text = "Vent the core?",\n  buttons = {\n    {label = "Vent", on_click = function() log.info("venting") end},\n    {label = "Cancel", on_click = function() end},\n  },\n}\nui.close_menu()', impl: (h, t: Table) => {
    const f = readFields(t, MENU_FIELDS, 'ui.open_menu');
    const buttons = (f.buttons as Table).list().slice(0, 12).map((b, i) => {
      const w = `ui.open_menu: buttons[${i + 1}]`;
      if (!(b instanceof Table)) throw new ChaosError(`${w} must be a table.`);
      const click = b.get('on_click');
      if (!isCallable(click)) throw new ChaosError(`${w} needs on_click.`);
      return { label: toLoc(b.get('label'), `${w}: label`), click, close: b.get('close') !== false };
    });
    h.openMenu(f.title as never, f.text as never, buttons);
  } }),
  fn('ui', 'close_menu', { params: [], perm: 'ui', world: true, doc: 'Closes a dialog this mod opened.', example: 'ui.close_menu()', impl: (h) => h.closeMenu() }),
  fn('ui', 'add_button', { params: [{ name: 'def', type: 'table' }], returns: 'button id', perm: 'ui', fields: BUTTON_FIELDS, doc: 'Adds a button to the Mod Menu, which opens with M during play. It stays until the mod unloads.', example: 'local b = ui.add_button{ label = "Say hello", on_click = function() ui.toast("Hello") end }\nui.remove_button(b)', impl: (h, t: Table) => {
    const f = readFields(t, BUTTON_FIELDS, 'ui.add_button');
    return h.addButton(f.label as never, f.on_click as Value);
  } }),
  fn('ui', 'remove_button', { params: [{ name: 'id', type: 'number' }], perm: 'ui', doc: 'Removes a Mod Menu button.', example: 'ui.remove_button(-1)', impl: (h, id: number) => h.removeButton(id) }),

  // ── storage ──
  fn('storage', 'get', { params: [{ name: 'key', type: 'string' }, { name: 'default', type: 'any', optional: true }], returns: 'value', perm: 'storage', doc: 'Reads a saved value, or the default.', example: 'local n = storage.get("visits", 0)\nstorage.set("visits", n + 1)', impl: (h, k: string, d: Value) => h.storageGet(k) ?? d }),
  fn('storage', 'set', { params: [{ name: 'key', type: 'string' }, { name: 'value', type: 'any' }], perm: 'storage', doc: 'Saves a value. nil deletes it. Over the 256 KB limit this is an error and nothing changes.', example: 'storage.set("best", {score=10, name="me"})\nassert(storage.get("best").score == 10)', impl: (h, k: string, v: Value) => h.storageSet(k, v === null ? null : toPlain(v, `storage.set "${k}"`)) }),
  fn('storage', 'delete', { params: [{ name: 'key', type: 'string' }], perm: 'storage', doc: 'Deletes a value.', example: 'storage.delete("best")\nassert(storage.get("best") == nil)', impl: (h, k: string) => h.storageSet(k, null) }),
  fn('storage', 'keys', { params: [], returns: 'list of keys', perm: 'storage', doc: 'All saved keys.', example: 'storage.set("a", 1)\nassert(table.contains(storage.keys(), "a"))\nstorage.delete("a")', impl: (h) => h.storageKeys() }),

  // ── events ──
  fn('events', 'on', { params: [{ name: 'name', type: 'string', doc: 'A built-in event, or a custom one containing ":".' }, { name: 'handler', type: 'function', doc: 'handler(e), where e is a table.' }], returns: 'handler id', doc: 'Subscribes to an event. Handlers stay until events.off or until the mod unloads, across sessions.', example: 'local h = events.on("entity_damaged", function(e) log.info(e.id, e.amount) end)\nevents.off(h)', impl: (h, name: string, f: Value) => h.subscribe(name, f) }),
  fn('events', 'off', { params: [{ name: 'id', type: 'number' }], returns: 'true if it existed', doc: 'Unsubscribes.', example: 'assert(events.off(-1) == false)', impl: (h, id: number) => h.unsubscribe(id) }),
  fn('events', 'emit', { params: [{ name: 'name', type: 'string', doc: 'Must contain ":", such as "my_mod:wave_started".' }, { name: 'data', type: 'any', optional: true, doc: 'Text, numbers, booleans or tables of those. Every listener gets its own copy.' }], doc: 'Sends a custom event to every loaded mod, this one included. Runs immediately.', example: 'local got = nil\nlocal h = events.on("demo:ping", function(e) got = e.n end)\nevents.emit("demo:ping", {n=7})\nassert(got == 7)\nevents.off(h)', impl: (h, name: string, d: Value) => {
    if (!name.includes(':')) throw new ChaosError(`events.emit: custom event "${name}" must contain ":", such as "${h.id}:${name}".`);
    h.manager.emitCustom(name, d === null ? null : toPlain(d, `events.emit "${name}"`));
  } }),

  // ── timer ──
  fn('timer', 'after', { params: [{ name: 'seconds', type: 'number' }, { name: 'f', type: 'function' }], returns: 'timer id', world: true, doc: 'Runs f once, later.', example: 'local t = timer.after(1, function() log.info("later") end)\ntimer.cancel(t)', impl: (h, s: number, f: Value) => h.addTimer(s, 0, f) }),
  fn('timer', 'every', { params: [{ name: 'seconds', type: 'number', doc: 'At least 0.05.' }, { name: 'f', type: 'function' }], returns: 'timer id', world: true, doc: 'Runs f repeatedly. A mod can hold up to 256 timers.', example: 'local n = 0\nlocal t = timer.every(0.5, function() n = n + 1 end)\ntimer.cancel(t)', impl: (h, s: number, f: Value) => h.addTimer(Math.max(0.05, s), Math.max(0.05, s), f) }),
  fn('timer', 'cancel', { params: [{ name: 'id', type: 'number' }], returns: 'true if it existed', doc: 'Cancels a timer.', example: 'assert(timer.cancel(-1) == false)', impl: (h, id: number) => h.cancelTimer(id) }),

  // ── mode ──
  fn('mode', 'finish', { params: [{ name: 'def', type: 'table' }], returns: 'true if this mod\'s mode was running', fields: FINISH_FIELDS, doc: 'Ends a scripted mode with a result screen. It does nothing if another mod\'s mode is running.', example: 'mode.finish{ win = true, title = "You did it", detail = "All crates collected." }', impl: (h, t: Table) => {
    const f = readFields(t, FINISH_FIELDS, 'mode.finish');
    const m = h.game.mode;
    if (!(m instanceof ScriptedMode) || m.host !== h) return false;
    m.finish(f.win as boolean, f.title as never, f.detail as never, f.can_continue === true);
    return true;
  } }),
  fn('mode', 'is_mine', { params: [], returns: 'boolean', doc: 'True if the running mode was registered by this mod.', example: 'assert(type(mode.is_mine()) == "boolean")', impl: (h) => h.game.mode instanceof ScriptedMode && (h.game.mode as ScriptedMode).host === h }),
];
