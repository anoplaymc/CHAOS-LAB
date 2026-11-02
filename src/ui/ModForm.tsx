import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/core/Game';
import type { FormControl, ModForm } from '../modding/form';
import { useUi } from '../app/App';

type Send = ModForm['send'];

function saveText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const Reset = ({ id, send }: { id: string; send: Send }) => (
  <button className="mf-reset" title="Reset" aria-label="Reset" data-testid={`mf-reset-${id}`} onClick={() => send('reset', id, null)}>↺</button>
);

function Slider({ c, send }: { c: Extract<FormControl, { type: 'slider' }>; send: Send }) {
  // The script redraws the panel while it's dragged, so the thumb follows the hand and not the last redraw.
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? c.value;
  return (
    <label className="mf-control mf-slider" title={c.hint}>
      <span className="mf-label">{c.label}<output>{Number(value.toFixed(3))}{c.unit}</output></span>
      <input type="range" data-testid={`mf-${c.id}`} min={c.min} max={c.max} step={c.step} value={value}
        onPointerDown={() => setDraft(c.value)}
        onPointerUp={() => setDraft(null)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (draft !== null) setDraft(v);
          send('control', c.id, v);
        }} />
      {c.hint && <small>{c.hint}</small>}
      {c.reset && <Reset id={c.id} send={send} />}
    </label>
  );
}

/** A text box that keeps what's being typed while the script redraws the panel around it. */
function TextInput({ id, value, placeholder, send, className }: { id: string; value: string; placeholder: string; send: Send; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input className={className ?? 'search'} data-testid={`mf-${id}`} spellCheck={false} placeholder={placeholder} value={draft ?? value}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onChange={(e) => { setDraft(e.target.value); send('control', id, e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && (draft ?? value) !== '') { e.preventDefault(); setDraft(''); send('control', id, ''); } }} />
  );
}

function KeyChooser({ c, send }: { c: Extract<FormControl, { type: 'key' }>; send: Send }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const down = (e: KeyboardEvent) => {
      stop(e);
      if (e.repeat) return;
      // Its keyup is still to come, and an Esc that cancels mustn't then close the panel as well.
      const up = (u: KeyboardEvent) => {
        if (u.code !== e.code) return;
        stop(u);
        window.removeEventListener('keyup', up, true);
      };
      window.addEventListener('keyup', up, true);
      setListening(false);
      if (e.code !== 'Escape') send('control', c.id, e.code);
    };
    // Capturing on window gets there before the game's own key handling.
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [listening, c.id, send]);
  return (
    <div className="mf-control mf-key" title={c.hint}>
      <span className="mf-label">{c.label}</span>
      <button className={`btn small${listening ? ' primary' : ''}`} data-testid={`mf-${c.id}`} onClick={() => setListening(true)}>{listening ? 'Press a key… (Esc cancels)' : c.value || 'Not set'}</button>
      {c.hint && <small>{c.hint}</small>}
    </div>
  );
}

function TextBox({ c, send }: { c: Extract<FormControl, { type: 'textarea' }>; send: Send }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="mf-control mf-wide">
      <span className="mf-label">{c.label}</span>
      <textarea ref={area} className="mod-code mf-text" data-testid={`mf-${c.id}`} rows={c.rows} readOnly={c.readonly} spellCheck={false} value={draft ?? c.value}
        onFocus={() => { if (!c.readonly) setDraft(c.value); }}
        onBlur={() => setDraft(null)}
        onChange={(e) => { setDraft(e.target.value); send('control', c.id, e.target.value); }} />
      {c.readonly && (
        <div className="mf-row">
          <button className="btn small" data-testid={`mf-copy-${c.id}`} onClick={() => { area.current?.select(); void navigator.clipboard?.writeText(c.value).catch(() => undefined); }}>Copy</button>
          {c.filename && <button className="btn small" data-testid={`mf-save-${c.id}`} onClick={() => saveText(c.filename, c.value)}>Save file</button>}
        </div>
      )}
    </div>
  );
}

function Control({ c, send }: { c: FormControl; send: Send }) {
  switch (c.type) {
    case 'text': return <p className={`mf-textline ${c.style}`}>{c.text}</p>;
    case 'toggle':
      return (
        <label className={`mf-control mf-toggle${c.value ? ' on' : ''}`} title={c.hint}>
          <input type="checkbox" data-testid={`mf-${c.id}`} checked={c.value} onChange={(e) => send('control', c.id, e.target.checked)} />
          <span className="mf-switch" aria-hidden="true" />
          <span className="mf-label">{c.label}</span>
          {c.hint && <small>{c.hint}</small>}
          {c.reset && <Reset id={c.id} send={send} />}
        </label>
      );
    case 'slider': return <Slider c={c} send={send} />;
    case 'select':
      return (
        <label className="mf-control mf-select" title={c.hint}>
          <span className="mf-label">{c.label}</span>
          <select className="search" data-testid={`mf-${c.id}`} value={c.value} onChange={(e) => send('control', c.id, e.target.value)}>
            {!c.options.some((o) => o.value === c.value) && <option value={c.value}>—</option>}
            {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {c.hint && <small>{c.hint}</small>}
          {c.reset && <Reset id={c.id} send={send} />}
        </label>
      );
    case 'button':
      return <button className={`btn mf-button ${c.style === 'normal' ? '' : c.style}`} title={c.hint} disabled={c.disabled} data-testid={`mf-${c.id}`} onClick={() => send('control', c.id, true)}>{c.label}</button>;
    case 'input':
      return (
        <label className="mf-control" title={c.hint}>
          <span className="mf-label">{c.label}</span>
          <TextInput id={c.id} value={c.value} placeholder={c.placeholder} send={send} />
          {c.hint && <small>{c.hint}</small>}
        </label>
      );
    case 'textarea': return <TextBox c={c} send={send} />;
    case 'key': return <KeyChooser c={c} send={send} />;
    case 'unavailable':
      return (
        <div className="mf-control mf-unavailable">
          <span className="mf-label">{c.label} <span className="mf-tag">UNAVAILABLE</span></span>
          <small>{c.reason}</small>
        </div>
      );
  }
}

const keyOf = (c: FormControl, i: number) => ('id' in c ? c.id : `${c.type}-${i}`);

/** A mod's large panel. It only ever draws data, as text, and reports what the player does to that mod's script. */
export function ModFormOverlay({ game }: { game: Game }) {
  const form = useUi(game, (s) => s.modForm);
  if (!form) return null;
  const { send } = form;
  return (
    <div className="modal-backdrop mf-backdrop" data-testid="mod-form">
      <div className="mf-window" style={{ transform: `translate(-50%, -50%) scale(${form.scale})`, width: `min(1180px, ${96 / form.scale}vw)`, height: `${92 / form.scale}vh` }}>
        <header className="mf-header">
          <div>
            <h2 data-testid="mf-title">{form.title}</h2>
            <small data-testid="mf-subtitle">{form.subtitle}</small>
          </div>
          {form.search && <TextInput id={form.search.id} value={form.search.value} placeholder={form.search.placeholder} send={send} className="search mf-search" />}
          <button className="btn small" data-testid="mf-close" onClick={() => game.setOverlay(null)}>✕</button>
        </header>
        {form.chips.length > 0 && (
          <div className="mf-chips" data-testid="mf-chips">
            {form.chips.map((c) => <button key={c.id} className="mf-chip" title="Click to reset" data-testid={`mf-chip-${c.id}`} onClick={() => send('chip', c.id, null)}>{c.label} ✕</button>)}
          </div>
        )}
        {form.confirm && (
          <div className="mf-confirm" role="alert" data-testid="mf-confirm">
            <span>{form.confirm.text}</span>
            <button className="btn small danger" data-testid="mf-confirm-yes" onClick={() => send('control', form.confirm!.yes, true)}>Confirm</button>
            <button className="btn small" data-testid="mf-confirm-no" onClick={() => send('control', form.confirm!.no, true)}>Cancel</button>
          </div>
        )}
        <div className="mf-body">
          <nav className="mf-nav">
            {form.nav.map((n) => (
              <button key={n.id} className={`mf-tab${n.id === form.active ? ' on' : ''}`} data-testid={`mf-nav-${n.id}`} onClick={() => send('nav', n.id, null)}>
                <span>{n.label}</span>{n.badge && <em>{n.badge}</em>}
              </button>
            ))}
          </nav>
          <main className="mf-main" data-testid="mf-main">
            {form.sections.map((s, i) => (
              <section key={`${s.title}-${i}`} className="mf-section">
                {s.title && <h3>{s.title}</h3>}
                {s.note && <p className="hint">{s.note}</p>}
                <div className="mf-grid">
                  {s.controls.map((c, j) => <Control key={keyOf(c, j)} c={c} send={send} />)}
                </div>
              </section>
            ))}
          </main>
        </div>
        {form.footer.length > 0 && <footer className="mf-footer">{form.footer.map((c, j) => <Control key={keyOf(c, j)} c={c} send={send} />)}</footer>}
      </div>
    </div>
  );
}
