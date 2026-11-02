# Instructions for AI coding agents

## Project

CHAOS LAB is a browser-based 3D physics sandbox (TypeScript, Three.js, Rapier, React, Vite) with a modding platform. `DEVELOPMENT_LOG.md` records what has been verified.

## Commands

On NixOS, prefix with `nix-shell --run '...'`, or find Node through it first.

| Command | Purpose |
| --- | --- |
| `npx tsc --noEmit` | Type check |
| `npx vitest run` | Unit and simulation tests, with real physics and no browser |
| `npm run build` | Production build |
| `npx playwright test` | Browser tests. Needs an X display: `Xvfb :78 -screen 0 1280x800x24 +extension GLX &`, then `DISPLAY=:78` |
| `npm run mod -- <new\|validate\|test\|info\|list\|api\|pack\|docs>` | Mod toolkit. It needs no browser |

Run the type check, tests and build after changes. A green build isn't proof that a change works in the game.

## Layout

| Path | Contents |
| --- | --- |
| `src/chaosscript/` | The language. Imports nothing from the game |
| `src/modding/` | Mod loader, host, API (`api/`), CLI, doc generator |
| `src/game/content/` | The content registry, and core content added through it |
| `src/game/`, `src/rendering/`, `src/ui/` | The game |
| `mods/` | Mods bundled with the game. They load exactly as any other mod |
| `mods/examples/` | Small reference mods for reading and testing. Not part of the game |
| `.claude/skills/chaosscript-developer/` | Claude Code skill for mod work |
| `templates/` | Starting points for `npm run mod -- new` |
| `docs/` | Language, API and how-to documentation |

## Mandatory rule for game mods

For any task that creates or changes a game mod, you must:

1. Read the ChaosScript instructions: [docs/AI_MODDING_GUIDE.md](docs/AI_MODDING_GUIDE.md) and [docs/CHAOSSCRIPT_LANGUAGE.md](docs/CHAOSSCRIPT_LANGUAGE.md).
2. Study the API the task needs: [docs/CHAOSSCRIPT_API.md](docs/CHAOSSCRIPT_API.md), or `npm run mod -- api <word>`.
3. Look at suitable working examples: [docs/MODDING_EXAMPLES.md](docs/MODDING_EXAMPLES.md).
4. Write the game logic in ChaosScript.
5. Use the existing Mod API.
6. Check syntax and permissions: `npm run mod -- validate <mod>`.
7. Run the mod's tests: `npm run mod -- test <mod>`.
8. Fix what they find.
9. Confirm the mod loads through the real loader: `npm run mod -- info <mod>`.

**Never use JavaScript or TypeScript for a mod's game logic.** They are only for developing the engine, editor, loader, API and tools. The whole process is [docs/MODDING_WORKFLOW.md](docs/MODDING_WORKFLOW.md).

If the API can't do what's needed, don't fake it. Work out which engine extension is required, and follow *Extending the engine* in the workflow.

## Changing the API or the engine

Whenever you change ChaosScript, the Mod API, the NPC API, physics or the item system, check whether the docs need updating. *Keeping the docs true* in [docs/MODDING_WORKFLOW.md](docs/MODDING_WORKFLOW.md) has the checklist. Tests fail on most drift, but not on all of it.

- A new API function is one entry in `src/modding/api/`: its signature, permission, docs, example and implementation together. The example must run on its own against a real game, because a test runs them all.
- Then run `npm run mod -- docs`. `docs/CHAOSSCRIPT_API.md` is generated, so never edit it by hand. A test fails if it's stale.
- `docs/*.md` are checked: every ` ```lua ` block runs as a real mod, and every `namespace.function` mentioned must exist. Use ` ```text ` for fragments.
- Don't weaken the sandbox for convenience. No file system, network, system command or JavaScript global may reach a mod. New abilities go through an API entry with a permission.
- Scripts must never receive a JavaScript object. Pass plain values, and entity ids rather than entities.
- New content goes through `src/game/content/registry.ts`, as data in `coreExpansion.ts`, rather than into `Game`.
- Keep the first 12 tool slots and existing content ids stable: saves and players depend on them.
- If you bump `API_VERSION`, update the manifest docs and keep old mods working within the same major version.

## Testing notes

- `headlessGame()` in `src/tests/helpers.ts` gives a real game with real Rapier. `game.advance(seconds)` runs fixed steps.
- Content registries are module-level. A test that installs a mod must uninstall it, or dispose the game, which unloads all mods.
- Software GL in Xvfb runs at about 13 FPS, so frame rates there say nothing about real hardware, and clicks can be lost while spawn menu icons render.
