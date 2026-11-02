import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Game } from '../game/core/Game';
import { PERMISSION_INFO } from '../modding/manifest';
import { readModZip, type ImportProgress } from '../modding/modImport';
import { bundleToText, type ImportPreview, type LogEntry, type ModBundle, type ModRecord, type ModState } from '../modding/ModManager';
import { useUi } from '../app/App';

function useMods(game: Game): number {
  return useSyncExternalStore(game.mods.subscribe, () => game.mods.rev);
}

function useLogs(game: Game): readonly LogEntry[] {
  const [, bump] = useState(0);
  useEffect(() => game.mods.subscribeLog(() => bump((n) => n + 1)), [game]);
  return game.mods.logs;
}

const STATE_CLASS: Record<ModState, string> = { loaded: 'ok', disabled: 'off', invalid: 'bad', blocked: 'warn', failed: 'bad', faulted: 'bad' };

function save(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stateOf(r: ModRecord): ModState {
  return r.host?.phase === 'faulted' ? 'faulted' : r.state;
}

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(f);
  });
}

function ModRow({ game, r, onEdit, onReport }: { game: Game; r: ModRecord; onEdit: () => void; onReport: (text: string | null) => void }) {
  const t = game.t.bind(game);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const m = r.manifest;
  const state = stateOf(r);
  const problems = r.host?.faultReason ? [r.host.faultReason] : r.errors;
  const counts = r.content;
  const hasLocal = r.origin === 'local';
  const recent = game.mods.logs.filter((l) => l.mod === r.id && l.level === 'error').slice(-5);
  return (
    <div className="row mod-row" data-testid={`mod-${r.id}`} data-state={state}>
      <span>
        <b>{m?.name ?? r.id}</b> <small>v{m?.version ?? '?'}{m?.author ? ` · ${m.author}` : ''} · {t(`mods.origin.${r.origin}`)}</small>
        <span className={`mod-state ${STATE_CLASS[state]}`} data-testid={`mod-state-${r.id}`}>{t(`mods.state.${state}`)}</span>
        <br />
        {m?.description && <small>{m.description}</small>}
        {state === 'loaded' && <small className="mod-counts"> · {t('mods.counts', { i: counts.items.length, t: counts.tools.length, m: counts.maps.length, g: counts.modes.length })}</small>}
        {problems.map((e, i) => <small key={i} className="err-text mod-error" data-testid={`mod-error-${r.id}`}><br />{e}</small>)}
        {open && m && (
          <small className="mod-details">
            <br />{t('mods.id')}: {r.id} · API {m.api_version}
            {m.dependencies.length > 0 && <><br />{t('mods.needs')}: {m.dependencies.map((d) => `${d.id} ${d.version}${d.optional ? ` (${t('mods.optional')})` : ''}`).join(', ')}</>}
            {m.conflicts.length > 0 && <><br />{t('mods.conflicts')}: {m.conflicts.join(', ')}</>}
            <br />{t('mods.permissions')}: {m.permissions.length ? m.permissions.join(', ') : t('mods.none')}
            {m.permissions.map((p) => <span key={p}><br />– {p}: {PERMISSION_INFO[p]}</span>)}
            {r.warnings.map((w, i) => <span key={i} className="warn-text"><br />{w}</span>)}
            {recent.map((l) => <span key={l.n} className="err-text"><br />{l.text}</span>)}
          </small>
        )}
      </span>
      <div className="mod-actions">
        <label className="check"><input type="checkbox" data-testid={`mod-toggle-${r.id}`} checked={r.enabled} disabled={!m} onChange={(e) => void game.mods.setEnabled(r.id, e.target.checked)} /> {t('work.enabled')}</label>
        <button className="btn small" data-testid={`mod-reload-${r.id}`} disabled={!m || m.hot_reload === false} onClick={() => {
          onReport(null);
          void game.mods.reload(r.id).then((x) => onReport(x && x.state === 'loaded' ? t('mods.reloaded', { name: m?.name ?? r.id }) : null));
        }}>{t('mods.reload')}</button>
        <button className="btn small" data-testid={`mod-edit-${r.id}`} onClick={onEdit}>{t('mods.edit')}</button>
        <button className="btn small" data-testid={`mod-more-${r.id}`} onClick={() => setOpen(!open)}>{open ? t('mods.less') : t('mods.more')}</button>
        <button className="btn small" onClick={() => save(`${r.id}.chaosmod.json`, bundleToText(r.bundle))}>{t('mods.export')}</button>
        {hasLocal && (confirm
          ? <button className="btn small danger" data-testid={`mod-remove-yes-${r.id}`} onClick={() => void game.mods.uninstall(r.id)}>{t(r.overridesBuiltin ? 'mods.resetSure' : 'mods.removeSure')}</button>
          : <button className="btn small" data-testid={`mod-remove-${r.id}`} onClick={() => setConfirm(true)}>{t(r.overridesBuiltin ? 'mods.reset' : 'mods.remove')}</button>)}
      </div>
    </div>
  );
}

/** Text editor for one mod's files. Saving writes a local copy and reloads, so a mistake shows up immediately. */
function ModEditor({ game, id, onBack }: { game: Game; id: string; onBack: () => void }) {
  const t = game.t.bind(game);
  useMods(game);
  const r = game.mods.get(id);
  const files = r ? [...Object.keys(r.bundle.files), 'mod.json'] : [];
  const [path, setPath] = useState(files[0] ?? 'mod.json');
  const read = (p: string) => (r ? (p === 'mod.json' ? r.bundle.manifest : r.bundle.files[p] ?? '') : '');
  const [text, setText] = useState(() => read(path));
  const [saved, setSaved] = useState<string | null>(null);
  if (!r) return null;
  const state = stateOf(r);
  const problems = r.host?.faultReason ? [r.host.faultReason] : r.errors;
  return (
    <div className="panel wide mod-editor" data-testid="mod-editor">
      <h2>{r.manifest?.name ?? id}</h2>
      <div className="save-new">
        <select className="search" data-testid="mod-file" value={path} onChange={(e) => { setPath(e.target.value); setText(read(e.target.value)); setSaved(null); }}>
          {files.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button className="btn primary" data-testid="mod-save" onClick={() => {
          setSaved(null);
          void game.mods.editFile(id, path, text).then((x) => { if (x?.state === 'loaded') setSaved(t('mods.savedOk')); });
        }}>{t('mods.saveReload')}</button>
      </div>
      <p className="hint">{t('mods.editHelp')}</p>
      {saved && <p className="ok" data-testid="mod-editor-ok">{saved}</p>}
      {problems.length > 0 && <div className="error" role="alert" data-testid="mod-editor-errors"><b>{t(`mods.state.${state}`)}</b><ul>{problems.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      <textarea className="mod-code" data-testid="mod-code" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="actions"><button className="btn" data-testid="mod-editor-back" onClick={onBack}>{t('menu.back')}</button></div>
    </div>
  );
}

type ImportStep =
  | { at: 'reading'; progress: ImportProgress | null }
  | { at: 'preview'; bundle: ModBundle; preview: ImportPreview }
  | { at: 'installing' }
  | { at: 'done'; record: ModRecord | undefined; errors: string[] }
  | { at: 'failed'; message: string };

/** Import Mod: reads a ZIP, shows what it would install, and changes nothing until the player says so. */
function ModImportDialog({ game, file, onClose }: { game: Game; file: File; onClose: () => void }) {
  const t = game.t.bind(game);
  const [step, setStep] = useState<ImportStep>({ at: 'reading', progress: null });
  const [agreed, setAgreed] = useState(false);
  const cancel = useRef<AbortController | null>(null);

  useEffect(() => {
    const control = new AbortController();
    cancel.current = control;
    void readModZip(file, { signal: control.signal, onProgress: (progress) => { if (!control.signal.aborted) setStep({ at: 'reading', progress }); } })
      .then((bundle) => { if (!control.signal.aborted) setStep({ at: 'preview', bundle, preview: game.mods.previewImport(bundle) }); })
      .catch((e: unknown) => { if (!control.signal.aborted) setStep({ at: 'failed', message: e instanceof Error ? e.message : String(e) }); });
    return () => control.abort();
  }, [file, game]);

  const install = (bundle: ModBundle) => {
    setStep({ at: 'installing' });
    void game.mods.installBundle(bundle, { followManifest: true })
      .then((r) => setStep({ at: 'done', record: r.record, errors: [...r.errors, ...(r.record?.errors ?? [])] }))
      .catch((e: unknown) => setStep({ at: 'failed', message: e instanceof Error ? e.message : String(e) }));
  };

  let body: React.ReactNode = null;
  if (step.at === 'reading') {
    const p = step.progress;
    body = (
      <>
        <p data-testid="mod-import-stage">{t(`mods.import.${p?.stage ?? 'read'}`)} {file.name}</p>
        <progress data-testid="mod-import-progress" className="mod-import-bar" max={p?.total ?? 1} value={p?.done ?? 0} />
        <div className="actions"><button className="btn" data-testid="mod-import-cancel" onClick={() => { cancel.current?.abort(); onClose(); }}>{t('mods.import.cancel')}</button></div>
      </>
    );
  } else if (step.at === 'preview') {
    const { preview: x, bundle } = step;
    const m = x.manifest;
    const blocked = x.errors.length > 0 || !m;
    const needsAgreement = !blocked && !!x.replaces;
    body = (
      <div data-testid="mod-import-preview">
        {m && (
          <dl className="mod-import-facts">
            <dt>{t('mods.import.name')}</dt><dd data-testid="mod-import-name">{m.name}</dd>
            <dt>{t('mods.id')}</dt><dd>{m.id}</dd>
            <dt>{t('mods.import.version')}</dt><dd data-testid="mod-import-version">{m.version}</dd>
            <dt>{t('mods.import.author')}</dt><dd data-testid="mod-import-author">{m.author || t('mods.none')}</dd>
            <dt>API</dt><dd>{m.api_version}</dd>
          </dl>
        )}
        {m?.description && <p className="hint">{m.description}</p>}
        {m && (
          <div data-testid="mod-import-permissions">
            <b>{t('mods.permissions')}</b>
            {m.permissions.length === 0 && <p className="hint">{t('mods.none')}</p>}
            <ul className="mod-import-list">{m.permissions.map((p) => <li key={p}><b>{p}</b>: {PERMISSION_INFO[p]}</li>)}</ul>
          </div>
        )}
        {x.dependencies.length > 0 && (
          <div data-testid="mod-import-deps">
            <b>{t('mods.needs')}</b>
            <ul className="mod-import-list">{x.dependencies.map((d) => <li key={d.id} className={d.status === 'ok' ? '' : d.optional ? 'warn-text' : 'err-text'}>{d.id} {d.version}{d.optional ? ` (${t('mods.optional')})` : ''}: {t(`mods.import.dep.${d.status}`)}</li>)}</ul>
          </div>
        )}
        {x.conflicts.length > 0 && <div className="warnbox" data-testid="mod-import-conflicts">{t('mods.import.conflicts', { list: x.conflicts.join(', ') })}</div>}
        {x.warnings.length > 0 && <div className="warnbox"><b>{t('work.warnings')}</b><ul>{x.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
        {x.errors.length > 0 && <div className="error" role="alert" data-testid="mod-import-error"><b>{t('mods.import.refused')}</b><ul>{x.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        {needsAgreement && (
          <label className="check warnbox" data-testid="mod-import-replaces">
            <input type="checkbox" data-testid="mod-import-agree" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            {t(x.replaces!.bundled ? 'mods.import.replaceBundled' : 'mods.import.replaceInstalled', { name: x.replaces!.name, version: x.replaces!.version })}
          </label>
        )}
        <div className="actions">
          <button className="btn" data-testid="mod-import-cancel" onClick={onClose}>{t('mods.import.cancel')}</button>
          <button className="btn primary" data-testid="mod-import-install" disabled={blocked || (needsAgreement && !agreed)} onClick={() => install(bundle)}>{t(needsAgreement ? 'mods.import.replace' : 'mods.import.install')}</button>
        </div>
      </div>
    );
  } else if (step.at === 'installing') {
    body = <p data-testid="mod-import-stage">{t('mods.import.installing')}</p>;
  } else if (step.at === 'done') {
    const r = step.record;
    body = (
      <>
        {r && step.errors.length === 0 && <p className="ok" data-testid="mod-import-done">{t(r.enabled ? 'mods.import.doneOn' : 'mods.import.doneOff', { name: r.manifest?.name ?? r.id })}</p>}
        {step.errors.length > 0 && <div className="error" role="alert" data-testid="mod-import-error"><ul>{step.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        <div className="actions"><button className="btn primary" data-testid="mod-import-close" onClick={onClose}>{t('spawn.close')}</button></div>
      </>
    );
  } else {
    body = (
      <>
        <div className="error" role="alert" data-testid="mod-import-error"><b>{t('mods.import.refused')}</b><br />{step.message}</div>
        <div className="actions"><button className="btn primary" data-testid="mod-import-close" onClick={onClose}>{t('spawn.close')}</button></div>
      </>
    );
  }
  return (
    <div className="modal-backdrop" data-testid="mod-import-dialog">
      <div className="panel mod-import">
        <h2>{t('mods.import.title')}</h2>
        {body}
      </div>
    </div>
  );
}

export function ModManagerPanel({ game, onBack }: { game: Game; onBack: () => void }) {
  const t = game.t.bind(game);
  useMods(game);
  useUi(game, (s) => s.settings.language);
  const [editing, setEditing] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [importing, setImporting] = useState<File | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const zip = useRef<HTMLInputElement>(null);
  const list = game.mods.list();

  const report = (r: { record?: ModRecord; errors: string[]; warnings: string[] }) => {
    setErrors(r.errors);
    setWarnings(r.warnings);
    setDone(r.record ? t('work.installed', { name: r.record.manifest?.name ?? r.record.id }) : null);
  };
  const importFolder = async (files: FileList) => {
    const items = await Promise.all([...files].map(async (f) => {
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      if (/\.(png|jpe?g|webp)$/i.test(path)) return { path, dataUrl: await readAsDataUrl(f) };
      if (/(\.chaos|mod\.json)$/.test(path)) return { path, text: await f.text() };
      return { path };
    }));
    report(await game.mods.installFiles(items));
  };

  if (editing) return <ModEditor game={game} id={editing} onBack={() => setEditing(null)} />;
  return (
    <div className="panel wide mods" data-testid="mod-manager">
      <h2>{t('mods.title')}</h2>
      <p className="hint">{t('mods.help')}</p>
      {done && <p className="ok" data-testid="mods-ok">{done}</p>}
      {errors.length > 0 && <div className="error" role="alert" data-testid="mods-errors"><b>{t('work.failed')}</b><ul>{errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      {warnings.length > 0 && <div className="warnbox"><b>{t('work.warnings')}</b><ul>{warnings.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      <div className="row-list">
        {list.length === 0 && <p className="empty">{t('mods.empty')}</p>}
        {list.map((r) => <ModRow key={r.id} game={game} r={r} onEdit={() => setEditing(r.id)} onReport={setDone} />)}
      </div>
      <div className="actions">
        <button className="btn" data-testid="mods-back" onClick={onBack}>{t('menu.back')}</button>
        <button className="btn" data-testid="mods-reload-all" onClick={() => void game.mods.reloadAll()}>{t('mods.reloadAll')}</button>
        <button className="btn" data-testid="mods-import" onClick={() => zip.current?.click()}>{t('mods.import.button')}</button>
        <button className="btn" onClick={() => file.current?.click()}>{t('mods.installFile')}</button>
        <button className="btn" onClick={() => folder.current?.click()}>{t('mods.installFolder')}</button>
        <button className="btn" data-testid="mods-console" onClick={() => game.ui.set({ overlay: 'console' })}>{t('mods.console')}</button>
        <input ref={zip} data-testid="mod-import-input" type="file" accept=".zip,application/zip" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setImporting(f);
          e.target.value = '';
        }} />
        <input ref={file} data-testid="mod-file-input" type="file" accept=".json,application/json" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then((text) => game.mods.installText(text)).then(report);
          e.target.value = '';
        }} />
        <input ref={(el) => { folder.current = el; el?.setAttribute('webkitdirectory', ''); }} data-testid="mod-folder-input" type="file" multiple hidden onChange={(e) => {
          if (e.target.files?.length) void importFolder(e.target.files);
          e.target.value = '';
        }} />
      </div>
      {importing && <ModImportDialog key={`${importing.name}/${importing.lastModified}`} game={game} file={importing} onClose={() => setImporting(null)} />}
    </div>
  );
}

/** Text panels mods put on the HUD. */
export function ModPanels({ game }: { game: Game }) {
  const panels = useUi(game, (s) => s.modPanels);
  const lang = useUi(game, (s) => s.settings.language);
  if (!panels.length) return null;
  return (
    <div className="mod-panels" data-testid="mod-panels">
      {panels.map((p) => (
        <div key={p.key} className="mod-panel" data-testid={`mod-panel-${p.key}`}>
          {p.title && <h4>{p.title[lang]}</h4>}
          {p.lines.map((l, i) => <div key={i}>{l[lang]}</div>)}
        </div>
      ))}
    </div>
  );
}

/** A mod's own dialog, or with none open, the Mod Menu of buttons mods have added. */
export function ModMenuOverlay({ game }: { game: Game }) {
  const t = game.t.bind(game);
  const menu = useUi(game, (s) => s.modMenu);
  const lang = useUi(game, (s) => s.settings.language);
  useMods(game);
  const close = () => {
    game.ui.set({ modMenu: null });
    game.setOverlay(null);
  };
  /** Runs a button, then closes, unless the button itself opened another dialog. */
  const press = (run: () => void, closes: boolean) => {
    const before = game.ui.get().modMenu;
    run();
    if (closes && game.ui.get().modMenu === before && game.ui.get().overlay === 'mod') close();
  };
  if (menu) {
    return (
      <div className="modal-backdrop" data-testid="mod-dialog">
        <div className="panel pause">
          <h2>{menu.title[lang]}</h2>
          {menu.text && <p>{menu.text[lang]}</p>}
          {menu.buttons.map((b, i) => (
            <button key={i} className="btn" data-testid={`mod-dialog-${i}`} onClick={() => press(b.run, b.close)}>{b.label[lang]}</button>
          ))}
        </div>
      </div>
    );
  }
  const buttons = game.mods.menuButtons();
  return (
    <div className="modal-backdrop" data-testid="mod-menu">
      <div className="panel pause">
        <h2>{t('mods.menu')}</h2>
        {buttons.length === 0 && <p className="empty">{t('mods.menuEmpty')}</p>}
        {buttons.map((b) => (
          <button key={`${b.mod}/${b.id}`} className="btn" data-testid={`mod-button-${b.id}`} onClick={() => press(b.run, true)}>{b.label[lang]} <small>· {b.mod}</small></button>
        ))}
        <button className="btn" data-testid="mod-menu-close" onClick={close}>{t('spawn.close')}</button>
      </div>
    </div>
  );
}

const CONSOLE_HELP = ['mods: list installed mods', 'reload <id>: reload a mod', 'enable <id> / disable <id>', 'filter <id>: show one mod (filter alone shows all)', 'clear: empty the log', 'anything else runs as ChaosScript, such as: player.position()'];

/** Log view and ChaosScript prompt. Opens with ` from anywhere, including the main menu. */
export function DebugConsole({ game }: { game: Game }) {
  const logs = useLogs(game);
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [replies, setReplies] = useState<LogEntry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const body = useRef<HTMLDivElement>(null);
  const counter = useRef(1e9);
  const t = game.t.bind(game);
  const say = (text: string, level: LogEntry['level'] = 'info') => setReplies((r) => [...r.slice(-200), { n: counter.current++, time: game.time, mod: 'console', level, text }]);
  const close = () => {
    if (game.ui.get().screen === 'playing' && !game.ui.get().paused) game.setOverlay(null);
    else game.ui.set({ overlay: null });
  };
  const run = (line: string) => {
    say(`> ${line}`);
    const [cmd, arg] = line.trim().split(/\s+/);
    switch (cmd) {
      case 'help': CONSOLE_HELP.forEach((l) => say(l)); return;
      case 'clear': game.mods.clearLog(); setReplies([]); return;
      case 'mods': game.mods.list().forEach((r) => say(`${r.id} v${r.manifest?.version ?? '?'}: ${stateOf(r)}${r.errors[0] ? `: ${r.errors[0]}` : ''}`)); return;
      case 'filter': setFilter(arg ?? null); return;
      case 'reload':
      case 'enable':
      case 'disable': {
        if (!arg) break;
        if (!game.mods.get(arg)) { say(`No mod "${arg}". Try: mods`, 'error'); return; }
        void (cmd === 'reload' ? game.mods.reload(arg) : game.mods.setEnabled(arg, cmd === 'enable')).then(() => say(`${arg}: ${stateOf(game.mods.get(arg)!)}`));
        return;
      }
      default: break;
    }
    const r = game.mods.evaluate(line);
    say(r.text, r.ok ? 'info' : 'error');
  };
  const shown = [...logs.filter((l) => !filter || l.mod === filter), ...replies].slice(-300);
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [shown.length]);
  return (
    <div className="console" data-testid="console">
      <header>
        <b>{t('mods.console')}</b>{filter && <small> · {filter}</small>}
        <small> · {t('mods.consoleHint')}</small>
        <button className="btn small" data-testid="console-close" onClick={close}>{t('spawn.close')}</button>
      </header>
      <div className="console-log" ref={body} data-testid="console-log">
        {shown.map((l) => (
          <div key={l.n} className={`log ${l.level}`}><span className="log-mod">{l.mod}</span>{l.text}</div>
        ))}
      </div>
      <input autoFocus className="console-input" data-testid="console-input" spellCheck={false} value={input} placeholder={t('mods.consolePrompt')}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.code === 'Backquote') {
            e.preventDefault();
            close();
          } else if (e.key === 'Enter' && input.trim()) {
            run(input);
            setHistory((h) => [input, ...h.slice(0, 49)]);
            setCursor(-1);
            setInput('');
          } else if (e.key === 'ArrowUp' && history.length) {
            e.preventDefault();
            const next = Math.min(history.length - 1, cursor + 1);
            setCursor(next);
            setInput(history[next]!);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = cursor - 1;
            setCursor(Math.max(-1, next));
            setInput(next >= 0 ? history[next]! : '');
          } else if (e.key === 'Escape') {
            setInput('');
          }
        }} />
    </div>
  );
}
