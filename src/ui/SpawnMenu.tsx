import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_NAMES } from '../data/i18n';
import { catalog, CATEGORIES, type Category, type ItemDef } from '../data/items';
import type { Game } from '../game/core/Game';
import { Thumbnails } from '../rendering/Thumbnails';

type Tab = Category | 'favorites' | 'recent';

/** Kept across menu openings: icons are slow to make on the first visit and free afterwards. */
const thumbs = new Thumbnails();

function Thumb({ def, large }: { def: ItemDef; large?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const now = thumbs.get(def, (u) => { if (alive) setUrl(u); });
    setUrl(now);
    return () => { alive = false; };
  }, [def]);
  return <div className={`thumb ${large ? 'large' : ''}`}>{url ? <img src={url} alt="" draggable={false} /> : <span>{def.name.en.slice(0, 1)}</span>}</div>;
}

export function SpawnMenu({ game }: { game: Game }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('props');
  const [selected, setSelected] = useState<ItemDef | null>(null);
  const [, bump] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const t = game.t.bind(game);
  const lang = game.settings.language;
  const inv = game.inventory;
  const usable = (d: ItemDef) => d.kind !== 'tool' || game.tools.tools.some((x) => x.id === d.toolId);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = catalog.list().filter(usable);
    if (q) return all.filter((d) => d.name.en.toLowerCase().includes(q) || d.name.ru.toLowerCase().includes(q) || d.desc[lang].toLowerCase().includes(q) || d.id.includes(q));
    if (tab === 'favorites') return all.filter((d) => inv.favorites.has(d.id));
    if (tab === 'recent') return inv.recent.map((id) => all.find((d) => d.id === id)).filter((d): d is ItemDef => !!d);
    return all.filter((d) => d.category === tab);
    // `bump` re-renders after favourites change, and the memo must follow it.
  }, [query, tab, lang, inv.favorites.size, inv.recent.length]);

  const spawn = (d: ItemDef) => {
    game.audio.play('uiClick');
    game.spawnAtCrosshair(d.id);
    bump((n) => n + 1);
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const buttons = [...(grid.current?.querySelectorAll<HTMLButtonElement>('button.item') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || !buttons.length) return;
    const cols = Math.max(1, buttons.filter((b) => b.offsetTop === buttons[0]!.offsetTop).length);
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (move) {
      e.preventDefault();
      const next = buttons[i + move];
      if (next) next.focus();
      else if (e.key === 'ArrowUp') document.querySelector<HTMLInputElement>('[data-testid=spawn-search]')?.focus();
    }
    if (e.key === 'Enter' && items[i]) {
      e.preventDefault();
      setSelected(items[i]!);
      spawn(items[i]!);
    }
  };

  const empty = query ? t('spawn.empty') : tab === 'favorites' ? t('spawn.emptyFav') : tab === 'recent' ? t('spawn.emptyRecent') : t('spawn.empty');
  const tabButton = (id: Tab, label: string) => (
    <button key={id} className={`cat ${id === tab && !query ? 'on' : ''}`} data-testid={`cat-${id}`} onClick={() => { game.audio.play('uiClick'); setTab(id); setQuery(''); }}>{label}</button>
  );

  return (
    <div className="modal-backdrop spawn-backdrop" data-testid="spawn-menu">
      <div className="panel spawn">
        <header>
          <h2>{t('spawn.title')}</h2>
          <input autoFocus className="search" data-testid="spawn-search" placeholder={t('spawn.search')} value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                grid.current?.querySelector<HTMLButtonElement>('button.item')?.focus();
              }
              if (e.key === 'Enter' && items[0]) {
                setSelected(items[0]);
                spawn(items[0]);
              }
            }} />
          <button className="btn" data-testid="spawn-close" onClick={() => game.setOverlay(null)}>{t('spawn.close')}</button>
        </header>
        <div className="cats">
          {tabButton('favorites', `★ ${t('spawn.favorites')}`)}
          {tabButton('recent', t('spawn.recent'))}
          {CATEGORIES.map((c) => tabButton(c, CATEGORY_NAMES[c]?.[lang === 'ru' ? 1 : 0] ?? c))}
        </div>
        <div className="spawn-body">
          <div className="grid" ref={grid} onKeyDown={onGridKey}>
            {items.length === 0 && <p className="empty" data-testid="spawn-empty">{empty}</p>}
            {items.map((d) => (
              <button key={d.id} className={`item ${selected?.id === d.id ? 'on' : ''}`} data-testid={`spawn-${d.id}`}
                onClick={() => { game.audio.play('uiHover'); setSelected(d); }}
                onDoubleClick={() => spawn(d)}>
                <Thumb def={d} />
                <b>{inv.favorites.has(d.id) ? '★ ' : ''}{d.name[lang]}</b>
              </button>
            ))}
          </div>
          <aside className="detail">
            {selected ? (
              <>
                <Thumb def={selected} large />
                <h3>{selected.name[lang]}</h3>
                <p>{selected.desc[lang]}</p>
                {selected.kind === 'tool' ? (
                  <button className="btn primary" data-testid="spawn-now" onClick={() => spawn(selected)}>{t('spawn.equip')}</button>
                ) : (
                  <>
                    <button className="btn primary" data-testid="spawn-now" onClick={() => spawn(selected)}>{t('spawn.spawnNow')}</button>
                    {selected.kind !== 'effect' && (
                      <button className="btn" data-testid="spawn-place" onClick={() => { game.inventory.touch(selected.id); game.selectForPlacement(selected.id); game.setOverlay(null); }}>{t('spawn.placeTool')}</button>
                    )}
                  </>
                )}
                <button className="btn" data-testid="spawn-fav" onClick={() => { inv.toggleFavorite(selected.id); bump((n) => n + 1); }}>
                  {inv.favorites.has(selected.id) ? t('spawn.unfav') : t('spawn.fav')}
                </button>
              </>
            ) : <p className="hint">{t('spawn.selectHint')}</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}
