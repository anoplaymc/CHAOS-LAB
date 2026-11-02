import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Game, type UiState } from '../game/core/Game';
import { Hud, QuickMenu } from '../ui/Hud';
import { CleanupPanel, MainMenu, PauseMenu, ResultScreen } from '../ui/Menus';
import { DebugConsole, ModMenuOverlay } from '../ui/ModsUi';
import { SpawnMenu } from '../ui/SpawnMenu';

export function useUi<T>(game: Game, select: (s: UiState) => T): T {
  return useSyncExternalStore(game.ui.subscribe, () => select(game.ui.get()));
}

declare global {
  interface Window { __chaos?: Game }
}

const params = new URLSearchParams(location.search);
const automation = params.has('automation');
/** Exposes the game for reading from a test driver while keeping real pointer lock, including in production builds. */
const inspect = params.has('inspect');

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let g: Game | null = null;
    let cancelled = false;
    (async () => {
      await Game.init();
      if (cancelled) return;
      g = new Game();
      g.attachCanvas(canvasRef.current!, { automation });
      await g.restorePacks();
      await g.restoreMods();
      if (cancelled) return;
      // In development, saving a file under mods/ reloads that mod in the running game.
      if (import.meta.hot) {
        const live = g;
        import.meta.hot.on('chaos:mod-changed', (d: { id: string }) => { void live.mods.reload(d.id); });
      }
      if (import.meta.env.DEV || automation || inspect) window.__chaos = g;
      setGame(g);
    })().catch((e: unknown) => {
      console.error('[CHAOS LAB] startup failed', e);
      setFatal(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
      g?.dispose();
      delete window.__chaos;
    };
  }, []);

  // Ctrl+W can't be intercepted, so crouching with Ctrl could close the tab. Ask before leaving a live session.
  useEffect(() => {
    if (!game) return;
    const guard = (e: BeforeUnloadEvent) => {
      if (game.ui.get().screen === 'playing' && !automation) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [game]);

  return (
    <div className="app">
      <div className="stage">
        <canvas ref={canvasRef} className="stage-canvas" data-testid="game-canvas" />
      </div>
      {fatal && (
        <div className="fatal" role="alert">
          <h1>Could not start the 3D renderer</h1>
          <p>{fatal}</p>
          <p>CHAOS LAB needs WebGL2. Check that hardware acceleration is enabled in your browser.</p>
        </div>
      )}
      {game && <Screens game={game} />}
    </div>
  );
}

function Screens({ game }: { game: Game }) {
  const screen = useUi(game, (s) => s.screen);
  const paused = useUi(game, (s) => s.paused);
  const overlay = useUi(game, (s) => s.overlay);
  const sessionId = useUi(game, (s) => s.sessionId);
  if (screen === 'menu') {
    return (
      <>
        <MainMenu game={game} />
        {overlay === 'console' && <DebugConsole game={game} />}
      </>
    );
  }
  return (
    <>
      <Hud game={game} />
      {overlay === 'spawn' && <SpawnMenu game={game} />}
      {overlay === 'quick' && <QuickMenu game={game} />}
      {overlay === 'mod' && <ModMenuOverlay game={game} />}
      {overlay === 'cleanup' && <div className="modal-backdrop"><CleanupPanel game={game} onBack={() => game.setOverlay(null)} /></div>}
      {paused && <PauseMenu key={sessionId} game={game} />}
      <ResultScreen game={game} />
      {overlay === 'console' && <DebugConsole game={game} />}
    </>
  );
}
