# CHAOS LAB

A browser-based 3D physics sandbox: spawn things, build things, wire them together, and see what happens.
Built with TypeScript, Three.js, Rapier 3D and React. It runs entirely locally: no accounts, server or runtime downloads.

## Run it

Needs Node 20 or newer and a desktop browser with WebGL2.

```sh
npm install
npm run dev        # open the URL Vite prints
```

On NixOS, run `nix-shell` first to get Node.

## Mods

CHAOS LAB has its own scripting language, ChaosScript. Six example mods are in `mods/` and enabled by default: open **Mods** in the menu. To make your own, start with [docs/MODDING_GUIDE.md](docs/MODDING_GUIDE.md):

```sh
npm run mod -- new my_mod
npm run dev
```

You can also ask Claude Code for a mod in plain words: it follows [docs/MODDING_WORKFLOW.md](docs/MODDING_WORKFLOW.md), and you don't need to know ChaosScript. Instructions for agents are in [AGENTS.md](AGENTS.md).

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Type-check and production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run test` | Unit and simulation tests (real Rapier, no browser) |
| `npm run test:e2e` | Browser tests in Playwright's Firefox (`npx playwright install firefox` first, except in `nix-shell`). Needs an X display, even in `nix-shell` |
| `npm run mod` | Mod toolkit: new, validate, test, pack, list, docs |

## Controls

| Key | Action |
| --- | --- |
| WASD, mouse | Move, look |
| Space, Shift, C or Ctrl | Jump, sprint, crouch |
| E | Interact, enter or leave a vehicle |
| F | Toggle flight (Space up, C down, Shift fast) |
| G / Q | Spawn menu / tool menu |
| 1-9, 0, -, =, wheel | Select tool |
| LMB, RMB | Primary and alternate action of the current tool |
| R | Reload or vent; rotate a held object; clear paint |
| T | Pin or unpin the aimed object |
| Z / Y | Undo / redo |
| B, N, V, H | Grid snap, angle snap, surface align, place anchored |
| [ ] | Previous or next construction part |
| K | Respawn |
| Delete | Remove the aimed or inspected object |
| Esc | Pause and release the mouse |
| F3 / F4 | Performance panel / AI and wire debug view |

Prefer **C** for crouching: Ctrl+W closes the browser tab and no page can block it. The game asks before leaving a live session as a safety net.

## What's in the game

- **Tools:** Physics Manipulator, Object Spawner, Construction Tool (place, move, rotate, scale, duplicate, weld, hinge, spring, rope, wire), Removal Tool, Inspection Tool, Paint Tool.
- **Weapons:** Energy Blaster, Impulse Cannon, Freeze Ray, Bouncer, Disintegrator, Gravity Tool.
- **Maps:** Test Facility, Industrial Yard, Gravity Playground, plus the Proving Ground used by challenges.
- **Modes:** Sandbox (autosaves each minute), Survival (8 waves, 3 lives), Contraption Challenge (4 puzzles), Physics Playground, and a Map Editor.
- **NPCs:** Technician, Glorp, Patrol Guard, Rogue Robot, Heavy Training Bot. Guards and rogue bots also fight each other.
- **Vehicle:** a raycast-suspension buggy.
- **Saves:** IndexedDB slots, with export and import as validated JSON.
- **Workshop:** data-only content packs. See [MODDING.md](MODDING.md).
- **Languages:** English and Russian.

## Known limitations

See [TODO.md](TODO.md) and [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md), which also list exactly what has and hasn't been tested.

All art and sound is generated in code, so there are no third-party assets to attribute.
