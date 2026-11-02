import { Game } from '../game/core/Game';

/** A real game with real Rapier physics and no browser: rendering and audio are simply absent. */
export async function headlessGame(): Promise<Game> {
  await Game.init();
  const game = new Game();
  game.input.virtualLock = true;
  game.startSession();
  return game;
}

export const spawn = (game: Game, id: string, x: number, y: number, z: number) => {
  const r = game.entities.spawn(id, { position: { x, y, z } });
  if (!r.ok) throw new Error(`spawn ${id} failed: ${r.reason}`);
  return r.entity;
};
