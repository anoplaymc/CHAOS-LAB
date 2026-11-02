import { useEffect, useState } from 'react';
import { catalog } from '../data/items';
import type { Game } from '../game/core/Game';
import { useUi } from '../app/App';
import { ModPanels } from './ModsUi';

export const toolName = (game: Game, id: string) => {
  const key = id === 'freeze' ? 'tool.freeze.name' : id === 'paint' ? 'tool.paint.name' : `tool.${id}`;
  const text = game.t(key);
  if (text !== key) return text;
  return catalog.list().find((d) => d.toolId === id)?.name[game.settings.language] ?? id;
};

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function InspectPanel({ game }: { game: Game }) {
  const i = useUi(game, (s) => s.inspect);
  const t = game.t.bind(game);
  if (!i) return null;
  const rows: [string, string][] = [
    [t('insp.material'), i.material],
    [t('insp.mass'), `${Math.round(i.mass)} kg`],
    [t('insp.friction'), i.friction.toFixed(2)],
    [t('insp.bounce'), i.restitution.toFixed(2)],
    [t('insp.speed'), `${i.speed.toFixed(1)} m/s`],
    [t('insp.scale'), i.scale.toFixed(2)],
    [t('insp.links'), `${i.links} / ${i.wires}`],
  ];
  if (i.health !== null) rows.push([t('insp.health'), `${Math.round(i.health)} / ${i.maxHealth}`]);
  if (i.state) rows.push([t('insp.state'), i.state]);
  return (
    <div className="inspect" data-testid="inspect-panel">
      <h4>{i.name}</h4>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {i.anchored && <span className="tag">{t('insp.anchored')}</span>}
      {i.frozen && <span className="tag ice">{t('insp.frozen')}</span>}
    </div>
  );
}

function ModePanel({ game }: { game: Game }) {
  const m = useUi(game, (s) => s.modeHud);
  if (!m) return null;
  return (
    <div className="mode-panel" data-testid="mode-panel">
      <h4>{m.title}</h4>
      {m.lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

export function QuickMenu({ game }: { game: Game }) {
  const t = game.t.bind(game);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
  const active = game.tools.active.id;
  return (
    <div className="modal-backdrop spawn-backdrop" data-testid="quick-menu" onClick={() => game.setOverlay(null)}>
      <div className="panel quick" onClick={(e) => e.stopPropagation()}>
        <h2>{t('quick.title')}</h2>
        <div className="quick-grid">
          {game.tools.tools.map((tool, i) => (
            <button key={tool.id} disabled={!game.tools.isAllowed(tool)} data-testid={`quick-${tool.id}`} className={`quick-item ${tool.kind} ${tool.id === active ? 'on' : ''}`} onClick={() => { game.tools.select(i); game.setOverlay(null); }}>
              {keys[i] && <kbd>{keys[i]}</kbd>} {toolName(game, tool.id)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Hud({ game }: { game: Game }) {
  const hud = useUi(game, (s) => s.hud);
  const toasts = useUi(game, (s) => s.toasts);
  const dead = useUi(game, (s) => s.dead);
  const needsClick = useUi(game, (s) => s.needsClick);
  const overloaded = useUi(game, (s) => s.overloaded);
  const damagePulse = useUi(game, (s) => s.damagePulse);
  const debug = useUi(game, (s) => s.debug);
  const info = useUi(game, (s) => s.debugInfo);
  const t = game.t.bind(game);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (damagePulse === 0) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 180);
    return () => clearTimeout(id);
  }, [damagePulse]);
  if (!hud) return null;
  const pct = (hud.health / hud.maxHealth) * 100;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
  return (
    <div className="hud" data-testid="hud">
      {flash && <div className="hurt-flash" />}
      {!hud.driving && <div className="crosshair" />}
      {hud.prompt && <div className="prompt" data-testid="prompt">{hud.prompt}</div>}
      <ModePanel game={game} />
      <ModPanels game={game} />
      <InspectPanel game={game} />
      <div className="toasts" data-testid="toasts">
        {toasts.map((x) => <div key={x.id} className={`toast ${x.kind}`}>{x.text}</div>)}
      </div>
      <div className="vitals">
        <span className="label">{t('hud.health')}</span>
        <div className="bar"><div className={`fill ${pct < 30 ? 'low' : ''}`} data-testid="health" style={{ width: `${pct}%` }} /></div>
        {hud.flying && <span className="tag">{t('hud.flying')}</span>}
      </div>
      <div className="toolbox">
        <div className="tool-name" data-testid="tool-name">
          {hud.swatch !== undefined && <span className="swatch" style={{ background: hex(hud.swatch) }} />}
          {toolName(game, hud.toolId)}
        </div>
        {hud.status && <div className="tool-status" data-testid="tool-status">{hud.status}</div>}
        {hud.energy !== null && (
          <div className="bar small"><div className={`fill energy ${hud.overheated ? 'low' : ''}`} style={{ width: `${hud.energy * 100}%` }} /></div>
        )}
        {!!hud.charge && <div className="bar small"><div className="fill charge" style={{ width: `${hud.charge * 100}%` }} /></div>}
        <div className="hints">
          {hud.hints.map(([k, v]) => <span key={k}><kbd>{k}</kbd> {v}</span>)}
          <span><kbd>G</kbd> {t('help.spawn')}</span>
          <span><kbd>Q</kbd> {t('help.quick')}</span>
        </div>
      </div>
      <div className="hotbar">
        {game.tools.tools.map((tool, i) => (
          <div key={tool.id} title={toolName(game, tool.id)} className={`slot ${keys[i] ? '' : 'extra'} ${i === hud.slot ? 'on' : ''} ${tool.kind} ${game.tools.isAllowed(tool) ? '' : 'locked'}`}>
            {keys[i] && <b>{keys[i]}</b>}
          </div>
        ))}
      </div>
      {needsClick && <div className="click-hint">{t('menu.clickToPlay')}</div>}
      {dead && <div className="dead-banner">{t('menu.dead')}</div>}
      {overloaded && <div className="overload" data-testid="overload">{t('hud.overload')}</div>}
      {debug && info && (
        <pre className="debug" data-testid="debug-panel">{`FPS ${info.fps}  frame ${info.frameMs}ms  physics ${info.physicsMs}ms
entities ${info.entities}  bodies ${info.bodies}  npcs ${info.npcs}
particles ${info.particles}  debris ${info.debris}
gravity ${info.gravity.toFixed(2)}  grounded ${info.grounded}
pos ${info.position}`}</pre>
      )}
    </div>
  );
}
