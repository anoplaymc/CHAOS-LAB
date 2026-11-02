import { useEffect, useRef, useState } from 'react';
import { CATEGORY_NAMES } from '../data/i18n';
import { CATEGORIES, type Category } from '../data/items';
import { MAPS, type Game } from '../game/core/Game';
import type { Settings } from '../game/core/settings';
import type { InstalledPack } from '../game/mods/PackManager';
import { CHALLENGES } from '../game/modes/modes';
import { parseSaveText, type SaveFile } from '../game/save/schema';
import type { SaveSummary } from '../game/save/SaveStore';
import { useUi } from '../app/App';
import { MODE_INFO } from '../game/content/registry';
import { MapArt } from './MapArt';
import { ModManagerPanel } from './ModsUi';

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const sound = (game: Game) => game.audio.play('uiClick');

export function SettingsPanel({ game, onBack }: { game: Game; onBack: () => void }) {
  const s = useUi(game, (u) => u.settings);
  const t = game.t.bind(game);
  const set = (p: Partial<Settings>) => game.applySettings(p);
  const slider = (key: keyof Settings, label: string, min: number, max: number, step: number) => (
    <label className="setting">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={s[key] as number} onChange={(e) => set({ [key]: Number(e.target.value) })} />
      <output>{(s[key] as number).toFixed(step < 1 ? 2 : 0)}</output>
    </label>
  );
  const check = (key: keyof Settings, label: string) => (
    <label className="setting">
      <span>{label}</span>
      <input type="checkbox" checked={s[key] as boolean} onChange={(e) => set({ [key]: e.target.checked })} />
    </label>
  );
  return (
    <div className="panel settings" data-testid="settings">
      <h2>{t('menu.settings')}</h2>
      {slider('sensitivity', t('set.sensitivity'), 0.1, 4, 0.05)}
      {check('invertY', t('set.invertY'))}
      {slider('fov', t('set.fov'), 55, 110, 1)}
      {check('cameraMotion', t('set.motion'))}
      {slider('masterVolume', t('set.master'), 0, 1, 0.01)}
      {slider('sfxVolume', t('set.sfx'), 0, 1, 0.01)}
      {slider('ambienceVolume', t('set.ambience'), 0, 1, 0.01)}
      <label className="setting">
        <span>{t('set.quality')}</span>
        <select value={s.quality} onChange={(e) => set({ quality: e.target.value as Settings['quality'] })}>
          <option value="low">{t('set.q.low')}</option>
          <option value="medium">{t('set.q.medium')}</option>
          <option value="high">{t('set.q.high')}</option>
        </select>
      </label>
      {check('shadows', t('set.shadows'))}
      {check('antialias', t('set.antialias'))}
      {check('bloom', t('set.bloom'))}
      {slider('renderScale', t('set.scale'), 0.4, 1, 0.05)}
      <label className="setting">
        <span>{t('set.language')}</span>
        <select data-testid="language" value={s.language} onChange={(e) => set({ language: e.target.value as Settings['language'] })}>
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </select>
      </label>
      <button className="btn" onClick={onBack}>{t('menu.back')}</button>
    </div>
  );
}

function MapCards({ game, selected, onSelect, only }: { game: Game; selected: string; onSelect: (id: string) => void; only?: string[] }) {
  const lang = game.settings.language;
  const maps = Object.values(MAPS).filter((m) => (only ? only.includes(m.id) : m.id !== 'proving_ground'));
  return (
    <div className="map-grid">
      {maps.map((m) => (
        <button key={m.id} className={`map-card ${selected === m.id ? 'on' : ''}`} data-testid={`map-${m.id}`} onClick={() => { sound(game); onSelect(m.id); }}>
          <MapArt id={m.id} />
          <b>{m.name[lang]}</b>
          <small>{m.desc[lang]}</small>
        </button>
      ))}
    </div>
  );
}

function NewGame({ game, initialMode, onBack }: { game: Game; initialMode: string; onBack: () => void }) {
  const t = game.t.bind(game);
  const [mode, setMode] = useState(initialMode);
  const defaults: Record<string, string> = { sandbox: 'test_facility', survival: 'industrial_yard', playground: 'gravity_playground', editor: 'test_facility' };
  const [map, setMap] = useState(defaults[initialMode] ?? 'test_facility');
  const [challenge, setChallenge] = useState(0);
  const [layouts, setLayouts] = useState<SaveSummary[]>([]);
  useEffect(() => { void game.saves.list('layout').then(setLayouts); }, [game]);
  const modes = ['sandbox', 'survival', 'contraption', 'playground', 'editor', ...MODE_INFO.keys()];
  const scripted = MODE_INFO.get(mode);
  const lang = game.settings.language;
  const start = () => {
    game.audio.unlock();
    if (scripted) game.startSession({ mode });
    else if (mode === 'contraption') game.startSession({ mode, challenge });
    else game.startSession({ mode, map });
  };
  const openLayout = async (slot: string, asEditor: boolean) => {
    const l = await game.saves.read('layout', slot);
    if (!l) return;
    game.audio.unlock();
    game.startSession({ map: l.map, layout: l, mode: asEditor ? 'editor' : 'sandbox' });
  };
  return (
    <div className="panel wide" data-testid="new-game">
      <h2>{t('menu.modes')}</h2>
      <div className="mode-tabs">
        {modes.map((m) => (
          <button key={m} className={`mode-tab ${mode === m ? 'on' : ''}`} data-testid={`mode-${m}`} onClick={() => {
            sound(game);
            setMode(m);
            if (defaults[m]) setMap(defaults[m]!);
          }}>
            <b>{MODE_INFO.get(m)?.name[lang] ?? t(`mode.${m}`)}</b>
            <small>{MODE_INFO.get(m)?.desc[lang] ?? t(`mode.${m}.desc`)}</small>
          </button>
        ))}
      </div>
      {mode === 'contraption' ? (
        <div className="map-grid">
          {CHALLENGES.map((c, i) => (
            <button key={c.id} className={`map-card ${challenge === i ? 'on' : ''}`} data-testid={`challenge-${c.id}`} onClick={() => { sound(game); setChallenge(i); }}>
              <b>{i + 1}. {t(`challenge.${c.id}.name`)}</b>
              <small>{t(`challenge.${c.id}.goal`)}</small>
              <small className="meta">{t('challenge.parts', { n: 0, max: c.budget })}</small>
            </button>
          ))}
        </div>
      ) : scripted ? null : (
        <>
          <h3>{t('menu.choose')}</h3>
          <MapCards game={game} selected={map} onSelect={setMap} />
        </>
      )}
      {(mode === 'sandbox' || mode === 'editor') && layouts.length > 0 && (
        <>
          <h3>{t('editor.layouts')}</h3>
          <div className="row-list">
            {layouts.filter((l) => !l.corrupt).map((l) => (
              <div key={l.slot} className="row">
                <span>{l.name} <small>{MAPS[l.map]?.name[game.settings.language] ?? l.map} · {t('save.objects', { n: l.count })}</small></span>
                <button className="btn small" onClick={() => void openLayout(l.slot, mode === 'editor')}>{t('save.load')}</button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="actions">
        <button className="btn" onClick={onBack}>{t('menu.back')}</button>
        <button className="btn primary" data-testid="start-game" onClick={start}>{t('menu.start')}</button>
      </div>
    </div>
  );
}

export function SavesPanel({ game, onBack, inGame }: { game: Game; onBack: () => void; inGame: boolean }) {
  const t = game.t.bind(game);
  const [list, setList] = useState<SaveSummary[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => game.saves.list('scene').then(setList);
  useEffect(() => { void refresh(); }, []);

  const save = async () => {
    const n = name.trim() || new Date().toLocaleString();
    try {
      await game.saveScene(`slot:${n}`, n);
      game.toast(t('save.saved', { name: n }), 'success');
      setName('');
      setError(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const load = async (slot: string) => {
    const s = await game.saves.read('scene', slot);
    if (!s) {
      setError(t('save.corrupt'));
      return;
    }
    game.audio.unlock();
    game.loadSave(s);
  };
  const exportSave = async (slot: string, label: string) => {
    const s = await game.saves.read('scene', slot);
    if (s) download(`${label.replace(/[^\w-]+/g, '_')}.chaoslab.json`, JSON.stringify(s, null, 1));
  };
  const importFile = async (f: File) => {
    setError(null);
    const r = parseSaveText(await f.text());
    if (!r.ok) {
      setError(t('save.importFailed', { why: r.errors.join(' ') }));
      return;
    }
    const value: SaveFile = r.value;
    await game.saves.write(`slot:${value.name}`, value);
    game.toast(t('save.saved', { name: value.name }), 'success');
    await refresh();
  };
  return (
    <div className="panel wide saves" data-testid="saves">
      <h2>{t('menu.saves')}</h2>
      {inGame && (
        <div className="save-new">
          <input className="search" data-testid="save-name" placeholder={t('save.name')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
          <button className="btn primary" data-testid="save-new" onClick={() => void save()}>{t('save.new')}</button>
        </div>
      )}
      {!game.saves.db.durable && <p className="error">{t('save.memoryOnly')}</p>}
      {error && <p className="error" role="alert" data-testid="save-error">{error}</p>}
      <div className="row-list">
        {list.length === 0 && <p className="empty">{t('save.none')}</p>}
        {list.map((s) => (
          <div key={s.slot} className="row" data-testid="save-row">
            <span>{s.corrupt ? t('save.corrupt') : s.name} <small>{MAPS[s.map]?.name[game.settings.language] ?? s.map} · {t('save.objects', { n: s.count })} · {s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}</small></span>
            {!s.corrupt && <button className="btn small" data-testid="save-load" onClick={() => void load(s.slot)}>{t('save.load')}</button>}
            {!s.corrupt && <button className="btn small" onClick={() => void exportSave(s.slot, s.name)}>{t('save.export')}</button>}
            {confirm === s.slot
              ? <button className="btn small danger" onClick={() => { setConfirm(null); void game.saves.remove('scene', s.slot).then(refresh); }}>{t('save.confirmDelete')}</button>
              : <button className="btn small" onClick={() => setConfirm(s.slot)}>{t('save.delete')}</button>}
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="btn" onClick={onBack}>{t('menu.back')}</button>
        <button className="btn" onClick={() => file.current?.click()}>{t('save.import')}</button>
        <input ref={file} data-testid="save-file" type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}

const SAMPLE_PACK = {
  id: 'sample-toys',
  name: 'Sample Toys',
  version: '1.0.0',
  author: 'CHAOS LAB',
  description: 'A tiny example: a new material, three props and a small map.',
  materials: [{ id: 'jelly', name: { en: 'Jelly', ru: 'Желе' }, friction: 0.3, restitution: 1, density: 30, sound: 'gel', fragility: 0, tint: 0x66ff99 }],
  entities: [
    { id: 'jelly_ball', name: { en: 'Jelly Ball', ru: 'Желейный мяч' }, desc: { en: 'Made of the pack\'s own material.', ru: 'Из материала этого набора.' }, category: 'physics', shape: { type: 'sphere', r: 0.6 }, material: 'jelly', color: 0x66ff99 },
    { id: 'tall_crate', name: { en: 'Tall Crate', ru: 'Высокий ящик' }, category: 'props', shape: { type: 'box', size: [0.8, 2.4, 0.8] }, visual: 'crate', material: 'wood', breakSpeed: 8, health: 60, debris: 'wood' },
    { id: 'mini_bomb', name: { en: 'Mini Bomb', ru: 'Мини-бомба' }, desc: { en: 'A small data-defined explosive.', ru: 'Небольшая бомба, заданная данными.' }, category: 'physics', shape: { type: 'cylinder', r: 0.25, h: 0.5 }, material: 'metal', color: 0xff5a44, breakSpeed: 6, health: 10, behavior: 'explosive', params: { radius: 4, impulse: 500, damage: 30 } },
  ],
  maps: [{
    id: 'tiny_arena',
    name: { en: 'Tiny Arena (pack)', ru: 'Малая арена (набор)' },
    desc: { en: 'A map defined entirely as data.', ru: 'Карта, полностью заданная данными.' },
    spawn: [0, 0, 8],
    blocks: [
      { pos: [0, -0.5, 0], size: [30, 1, 30], material: 'platform_mint' },
      { pos: [0, 1.5, -10], size: [10, 3, 1], material: 'container_red' },
      { pos: [-8, 0.5, 0], size: [4, 1, 4], material: 'platform_candy' },
    ],
    props: [{ id: 'crate_wood', pos: [2, 0.52, 0] }, { id: 'crate_wood', pos: [3.2, 0.52, 0] }],
  }],
};

export function Workshop({ game, onBack }: { game: Game; onBack: () => void }) {
  const t = game.t.bind(game);
  const [packs, setPacks] = useState<InstalledPack[]>(() => game.packs.list());
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => {
    setPacks([...game.packs.list()]);
    for (const tool of game.tools.tools) (tool as { refreshParts?: () => void }).refreshParts?.();
  };
  const importText = async (text: string) => {
    setDone(null);
    const r = await game.packs.importText(text);
    setErrors(r.errors);
    setWarnings(r.warnings);
    if (r.pack) setDone(t('work.installed', { name: r.pack.name }));
    refresh();
  };
  return (
    <div className="panel wide" data-testid="workshop">
      <h2>{t('work.title')}</h2>
      <p className="hint">{t('work.help')}</p>
      {done && <p className="ok" data-testid="workshop-ok">{done}</p>}
      {errors.length > 0 && (
        <div className="error" role="alert" data-testid="workshop-errors">
          <b>{t('work.failed')}</b>
          <ul>{errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="warnbox"><b>{t('work.warnings')}</b><ul>{warnings.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul></div>
      )}
      <div className="row-list">
        {packs.length === 0 && <p className="empty">{t('work.none')}</p>}
        {packs.map((p) => (
          <div key={p.pack.id} className="row" data-testid={`pack-${p.pack.id}`}>
            <span>
              {p.pack.name} <small>v{p.pack.version}{p.pack.author ? ` · ${p.pack.author}` : ''}</small><br />
              <small>{t('work.items', { e: p.pack.entities.length, m: p.pack.materials.length, p: p.pack.maps.length })}{p.pack.description ? ` · ${p.pack.description}` : ''}</small>
              {p.problem && <small className="err-text"> · {p.problem}</small>}
            </span>
            <label className="check"><input type="checkbox" data-testid={`pack-toggle-${p.pack.id}`} checked={p.enabled} onChange={(e) => { const done = game.packs.setEnabled(p.pack.id, e.target.checked); refresh(); void done.then(refresh); }} /> {t('work.enabled')}</label>
            <button className="btn small" onClick={() => void game.packs.remove(p.pack.id).then(refresh)}>{t('work.remove')}</button>
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="btn" onClick={onBack}>{t('menu.back')}</button>
        <button className="btn" data-testid="install-sample" onClick={() => void importText(JSON.stringify(SAMPLE_PACK))}>{t('work.sample')}</button>
        <button className="btn" onClick={() => file.current?.click()}>{t('work.import')}</button>
        <input ref={file} data-testid="pack-file" type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(importText); e.target.value = ''; }} />
      </div>
    </div>
  );
}

function ControlsPanel({ game, onBack }: { game: Game; onBack: () => void }) {
  const t = game.t.bind(game);
  const rows = [['WASD', 'help.move'], ['Space', 'help.jump'], ['Shift', 'help.sprint'], ['C / Ctrl', 'help.crouch'], ['E', 'help.interact'], ['F', 'help.flight'], ['G', 'help.spawn'], ['Q', 'help.quick'], ['1-0 - =', 'help.tools'], ['T', 'help.pin'], ['R', 'help.reload'], ['Z / Y', 'build.undo'], ['B N V H', 'help.snap'], ['K', 'help.respawn'], ['Del', 'help.delete'], ['M', 'help.modMenu'], ['`', 'help.console'], ['F3', 'help.debug'], ['F4', 'help.aiDebug'], ['Esc', 'help.pause']] as const;
  return (
    <div className="panel controls" data-testid="controls">
      <h2>{t('menu.controls')}</h2>
      <dl>{rows.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{t(v)}</dd></div>)}</dl>
      <p className="note">{t('help.ctrlWarn')}</p>
      <button className="btn" onClick={onBack}>{t('menu.back')}</button>
    </div>
  );
}

export function MainMenu({ game }: { game: Game }) {
  const [page, setPage] = useState<'main' | 'new' | 'maps' | 'saves' | 'mods' | 'workshop' | 'settings' | 'controls' | 'quit'>('main');
  const [modeInit, setModeInit] = useState('sandbox');
  const [map, setMap] = useState('test_facility');
  useUi(game, (u) => u.settings.language);
  const t = game.t.bind(game);
  const back = () => setPage('main');
  const go = (p: typeof page) => { sound(game); setPage(p); };
  return (
    <div className={`menu ${page !== 'main' ? 'sub' : ''}`} data-testid="main-menu">
      <div className="menu-brand">
        <h1 className="logo">CHAOS<span>LAB</span></h1>
        {page === 'main' && <p className="tagline">{t('menu.tagline')}</p>}
      </div>
      {page === 'main' && (
        <nav className="menu-list">
          <button className="btn primary" data-testid="play" onClick={() => { game.audio.unlock(); game.startSession(); }}>{t('menu.play')}</button>
          <button className="btn" data-testid="menu-sandbox" onClick={() => { setModeInit('sandbox'); go('new'); }}>{t('menu.sandbox')}</button>
          <button className="btn" data-testid="menu-modes" onClick={() => { setModeInit('survival'); go('new'); }}>{t('menu.modes')}</button>
          <button className="btn" data-testid="menu-maps" onClick={() => go('maps')}>{t('menu.maps')}</button>
          <button className="btn" data-testid="menu-saves" onClick={() => go('saves')}>{t('menu.saves')}</button>
          <button className="btn" data-testid="menu-mods" onClick={() => go('mods')}>{t('mods.title')}</button>
          <button className="btn" data-testid="menu-workshop" onClick={() => go('workshop')}>{t('menu.workshop')}</button>
          <button className="btn" data-testid="menu-settings" onClick={() => go('settings')}>{t('menu.settings')}</button>
          <button className="btn" onClick={() => go('controls')}>{t('menu.controls')}</button>
          <button className="btn" onClick={() => go('quit')}>{t('menu.about')}</button>
        </nav>
      )}
      {page === 'new' && <NewGame game={game} initialMode={modeInit} onBack={back} />}
      {page === 'maps' && (
        <div className="panel wide">
          <h2>{t('menu.maps')}</h2>
          <MapCards game={game} selected={map} onSelect={setMap} />
          <div className="actions">
            <button className="btn" onClick={back}>{t('menu.back')}</button>
            <button className="btn primary" data-testid="start-map" onClick={() => { game.audio.unlock(); game.startSession({ map, mode: 'sandbox' }); }}>{t('menu.start')}</button>
          </div>
        </div>
      )}
      {page === 'saves' && <SavesPanel game={game} onBack={back} inGame={false} />}
      {page === 'mods' && <ModManagerPanel game={game} onBack={back} />}
      {page === 'workshop' && <Workshop game={game} onBack={back} />}
      {page === 'settings' && <SettingsPanel game={game} onBack={back} />}
      {page === 'controls' && <ControlsPanel game={game} onBack={back} />}
      {page === 'quit' && (
        <div className="panel"><p>{t('menu.quit.browser')}</p><button className="btn" onClick={back}>{t('menu.back')}</button></div>
      )}
    </div>
  );
}

function SessionPanel({ game, onBack }: { game: Game; onBack: () => void }) {
  const t = game.t.bind(game);
  const [, tick] = useState(0);
  const r = game.rules;
  const update = () => tick((n) => n + 1);
  return (
    <div className="panel settings" data-testid="session-panel">
      <h2>{t('menu.session')}</h2>
      <label className="setting">
        <span>{t('rules.gravity')}</span>
        <input data-testid="rule-gravity" type="range" min={-10} max={25} step={0.1} value={r.gravity} onChange={(e) => { game.setGravity(Number(e.target.value)); update(); }} />
        <output>{r.gravity.toFixed(1)}</output>
      </label>
      <button className="btn small" onClick={() => { game.setGravity(9.81); update(); }}>{t('rules.resetGravity')}</button>
      <label className="setting">
        <span>{t('rules.damage')}</span>
        <input type="checkbox" checked={r.damage} onChange={(e) => { r.damage = e.target.checked; update(); }} />
      </label>
      <label className="setting">
        <span>{t('rules.aggression')}</span>
        <select value={r.aggression} onChange={(e) => { r.aggression = e.target.value as typeof r.aggression; update(); }}>
          {(['passive', 'normal', 'high'] as const).map((a) => <option key={a} value={a}>{t(`rules.${a}`)}</option>)}
        </select>
      </label>
      <label className="setting">
        <span>{t('rules.limit')}</span>
        <input type="range" min={50} max={800} step={10} value={r.limits.total} onChange={(e) => { r.limits.total = Number(e.target.value); update(); }} />
        <output>{r.limits.total}</output>
      </label>
      <button className="btn" onClick={onBack}>{t('menu.back')}</button>
    </div>
  );
}

export function CleanupPanel({ game, onBack }: { game: Game; onBack: () => void }) {
  const t = game.t.bind(game);
  const lang = game.settings.language === 'ru' ? 1 : 0;
  const [counts, setCounts] = useState(() => game.countByCategory());
  const [picked, setPicked] = useState<Set<Category>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const selected = [...picked].reduce((sum, c) => sum + (counts[c] ?? 0), 0);
  const cats = CATEGORIES.filter((c) => counts[c]);
  return (
    <div className="panel settings" data-testid="cleanup">
      <h2>{t('clean.title')}</h2>
      <p className="hint">{t('clean.help')}</p>
      {cats.map((c) => (
        <label key={c} className="setting">
          <span>{CATEGORY_NAMES[c]?.[lang] ?? c}</span>
          <input type="checkbox" data-testid={`clean-${c}`} checked={picked.has(c)} onChange={(e) => {
            const next = new Set(picked);
            if (e.target.checked) next.add(c); else next.delete(c);
            setPicked(next);
            setConfirm(false);
          }} />
          <output>{counts[c]}</output>
        </label>
      ))}
      {confirm ? (
        <>
          <p className="note" data-testid="clean-question">{t('clean.confirm', { n: selected })}</p>
          <button className="btn danger" data-testid="clean-yes" onClick={() => {
            const n = game.cleanup([...picked]);
            game.toast(t('clean.done', { n }), 'success');
            setCounts(game.countByCategory());
            setPicked(new Set());
            setConfirm(false);
          }}>{t('clean.yes')}</button>
          <button className="btn" onClick={() => setConfirm(false)}>{t('clean.no')}</button>
        </>
      ) : (
        <button className="btn" data-testid="clean-go" disabled={selected === 0} onClick={() => setConfirm(true)}>{t('clean.go')}</button>
      )}
      <button className="btn" onClick={onBack}>{t('menu.back')}</button>
    </div>
  );
}

export function PauseMenu({ game }: { game: Game }) {
  const [page, setPage] = useState<'main' | 'settings' | 'controls' | 'saves' | 'session' | 'cleanup' | 'mods'>('main');
  const [layoutName, setLayoutName] = useState('');
  const t = game.t.bind(game);
  const mode = game.session.mode;
  const editor = mode === 'editor';
  const back = () => setPage('main');
  const saveLayout = async () => {
    const n = layoutName.trim() || `${game.session.map} ${new Date().toLocaleTimeString()}`;
    await game.saveScene(`layout:${n}`, n, 'layout');
    game.toast(t('editor.saved'), 'success');
    setLayoutName('');
  };
  const testPlay = async () => {
    const n = `__editor_test`;
    const data = await game.saveScene(`layout:${n}`, game.t('editor.test'), 'layout');
    await game.saves.remove('layout', `layout:${n}`);
    game.startSession({ map: data.map, layout: data, mode: 'sandbox' });
  };
  return (
    <div className="modal-backdrop" data-testid="pause-menu">
      {page === 'main' && (
        <div className="panel pause">
          <h2>{t('menu.paused')}</h2>
          <button className="btn primary" data-testid="resume" onClick={() => game.resume()}>{t('menu.resume')}</button>
          {editor && (
            <>
              <input className="search" data-testid="layout-name" placeholder={t('save.name')} value={layoutName} onChange={(e) => setLayoutName(e.target.value)} />
              <button className="btn" data-testid="save-layout" onClick={() => void saveLayout()}>{t('editor.saveLayout')}</button>
              <button className="btn" data-testid="test-layout" onClick={() => void testPlay()}>{t('editor.test')}</button>
            </>
          )}
          {!editor && game.rules.manualRespawn && <button className="btn" data-testid="pause-respawn" onClick={() => { game.player.respawn(); game.resume(); }}>{t('menu.respawn')}</button>}
          <button className="btn" data-testid="restart" onClick={() => game.restart()}>{t('menu.restart')}</button>
          {(mode === 'sandbox') && <button className="btn" data-testid="pause-saves" onClick={() => setPage('saves')}>{t('menu.saveLoad')}</button>}
          {(mode === 'sandbox') && <button className="btn" data-testid="pause-session" onClick={() => setPage('session')}>{t('menu.session')}</button>}
          {(mode === 'sandbox' || editor) && <button className="btn" data-testid="pause-cleanup" onClick={() => setPage('cleanup')}>{t('menu.cleanup')}</button>}
          <button className="btn" data-testid="pause-mods" onClick={() => setPage('mods')}>{t('mods.title')}</button>
          <button className="btn" onClick={() => setPage('controls')}>{t('menu.controls')}</button>
          <button className="btn" onClick={() => setPage('settings')}>{t('menu.settings')}</button>
          <button className="btn" data-testid="quit" onClick={() => game.quitToMenu()}>{t('menu.quit')}</button>
        </div>
      )}
      {page === 'settings' && <SettingsPanel game={game} onBack={back} />}
      {page === 'controls' && <ControlsPanel game={game} onBack={back} />}
      {page === 'saves' && <SavesPanel game={game} onBack={back} inGame />}
      {page === 'mods' && <ModManagerPanel game={game} onBack={back} />}
      {page === 'session' && <SessionPanel game={game} onBack={back} />}
      {page === 'cleanup' && <CleanupPanel game={game} onBack={back} />}
    </div>
  );
}

export function ResultScreen({ game }: { game: Game }) {
  const hud = useUi(game, (s) => s.modeHud);
  const t = game.t.bind(game);
  const r = hud?.result;
  if (!r || r.canContinue === false) return null;
  const s = game.session;
  return (
    <div className="modal-backdrop" data-testid="mode-result">
      <div className={`panel pause result ${r.win ? 'win' : 'lose'}`}>
        <h2>{r.title}</h2>
        <p>{r.detail}</p>
        {r.next && <button className="btn primary" data-testid="result-next" onClick={() => game.startSession({ mode: s.mode, challenge: s.challenge + 1 })}>{t('menu.next')}</button>}
        {r.canContinue && <button className="btn primary" data-testid="result-continue" onClick={() => game.continueAfterResult()}>{t('menu.keepPlaying')}</button>}
        <button className={`btn ${!r.next && !r.canContinue ? 'primary' : ''}`} data-testid="result-restart" onClick={() => game.restart()}>{t('menu.tryAgain')}</button>
        <button className="btn" data-testid="result-quit" onClick={() => game.quitToMenu()}>{t('menu.quit')}</button>
      </div>
    </div>
  );
}
