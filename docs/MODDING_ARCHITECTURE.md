# Modding architecture

The technical design behind ChaosScript and the mod system. For how to write a mod, start at [MODDING_GUIDE.md](MODDING_GUIDE.md).

## Layers

```
mods/<id>/mod.json + *.chaos          Mods: data and script, never TypeScript
        │
src/modding/ModManager                Discovery, dependencies, enable/disable, reload, errors
src/modding/ModHost                   One per loaded mod: its interpreter, permissions, limits, callbacks
src/modding/api/*                     The documented API. Each function is one spec entry
        │  (plain values only)
src/game/content/registry             Registration, shared by core content and mods
        │
Game, EntityManager, NpcComponent…    The game. It knows nothing about ChaosScript

src/chaosscript/                      The language: lexer, parser, linter, interpreter, stdlib.
                                      Imports nothing from the game, so it can be tested alone.
```

## Decisions

**Temporary overrides are recorded by the game.** A stopped or faulted script can't clean up after itself, so `src/modding/SandboxControl` keeps a ledger: each `sandbox.*` change records how to undo it and which mod made it. The ledger is released when that mod unloads or faults and when the session ends. The defaults change nothing, so a game with no such mod behaves as before. Saves store a rule's real value, not its override.

**Rich panels are data.** `ui.open_panel` sends a table that `src/modding/form` checks and copies, field by field, and `src/ui/ModForm` draws as text. A script gets one handler for everything done in the panel, so redrawing doesn't create new callbacks to keep alive.

**Tree-walking interpreter on the main thread.** NPC thinking, tool clicks and damage hooks have to answer within a physics step, so they can't wait on a Worker. Isolation therefore comes from the interpreter:

- Script values are `nil`, booleans, numbers, strings, `Table`s and functions. A table is a `Map`, so no script key can reach a JavaScript property or prototype.
- No JavaScript object crosses the boundary. Arguments and results are converted by the API layer, and entities are integer ids.
- Each mod gets its own interpreter. Mods share nothing except content ids and events, whose data is deep-copied.

This is language-level isolation in the same thread rather than an OS or Worker boundary. It stops scripts reaching the game by design, but a bug in the interpreter itself would not be contained by anything else.

**Execution limits are enforced by the interpreter.** Every statement, call and loop iteration spends fuel. Running out aborts that call and can't be caught by `pcall`. There are also limits on call depth, table size, string length and retained heap. Repeated failures put the mod into a `faulted` state where its callbacks stop running and the game carries on.

**The API is one table.** Each function in `src/modding/api/` is a spec entry holding its signature, permission, description, example and implementation. Argument checking, permission checks, `docs/CHAOSSCRIPT_API.md` and the linter's list of known names all come from it. A test runs every example against a real game and fails if the generated document is stale, so the docs can't describe an API that doesn't exist.

**Registration only happens while a mod loads.** A `register.*` call after loading is an error. All content from a mod is recorded under its id, so a failed load or an unload removes exactly what it added.

**Ids are namespaced.** `register.prop{ id = "chair" }` in `furniture_pack` creates `furniture_pack:chair`. Core content has no prefix. A mod can't overwrite core content or another mod's content.

**Core content uses the same registry.** `src/data/expansion*.ts` adds its items, NPC types, vehicles and tools through the same functions mods reach. The 12 original tool slots and existing content ids don't change.

## Lifecycle

```
discovered → validated → (dependencies resolved, topological order) → loading → loaded
                 │                         │                             │          │
              invalid                 blocked                         failed      faulted
```

- A failed load rolls back everything the mod registered. Dependents become `blocked`.
- Reloading a mod removes its entities, content and callbacks, re-reads its files, runs them, and respawns its entities at their old positions if their definitions still exist. Mods that depend on it reload too.
- If unloading removes the current session's map or mode, the game returns to the menu. Reloading restarts the session instead.

## Where mods come from

`ModSource` is the seam for future distribution:

| Source | What it is |
| --- | --- |
| `builtin` | `mods/` in the repo, bundled at build time |
| `dev` | `mods/` read live from disk through the Vite dev server, with automatic reload on save |
| `local` | Installed from a folder or a `.chaosmod.json` bundle, stored in IndexedDB, editable in the game |

An online workshop would be another source that delivers the same bundle format. No online service exists.

## Integration points in the game

Each is deliberately small:

- `Game`: owns a `ModManager`, calls it from the fixed step and session start and end, and emits a few more events.
- `EntityManager` / `attachBehaviors`: `ItemDef.script` attaches a `ScriptComponent`. Behaviours are registered by name.
- `NpcComponent`: orders (`follow`, `guard`, `patrol`, `go_to`) and scripted hooks on top of the existing brain.
- `VehicleComponent`: tuning comes from a spec, with the buggy's values as the default.
- `ToolManager`: tools can be added and removed at runtime after the original 12.
- `props.ts`, `npcModels.ts`, `ViewModel.ts`: models can be data, as lists of primitive parts.

## AI development system

`CLAUDE.md`, `AGENTS.md`, the `chaosscript-developer` skill and `docs/MODDING_WORKFLOW.md` make up the instructions. `src/modding/quality.ts` adds static checks from the same API entries, and `src/modding/cli.ts` runs them, then a real load from the main menu state. `mods/examples/` holds reference mods outside the game. Tests keep the docs, commands and skill true to the code.

## Stages

1. Architecture: this document.
2. ChaosScript lexer, parser, interpreter, standard library, linter.
3. Mod API, content registry, entity registration.
4. Mod loader.
5. First example mods.
6. NPC framework and content expansion.
7. Mod manager, debug console, panels.
8. Documentation and automated mod tests.

After each: type check, unit tests, production build, and a real mod load.
