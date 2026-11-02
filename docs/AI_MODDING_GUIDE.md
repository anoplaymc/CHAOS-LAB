# AI modding guide

For AI coding agents creating CHAOS LAB mods. It gives the technical steps, and [MODDING_WORKFLOW.md](MODDING_WORKFLOW.md) gives the whole process from request to report. Follow it in order. Don't guess API names: everything that exists is in [CHAOSSCRIPT_API.md](CHAOSSCRIPT_API.md), which is generated from the code that runs.

## Environment

- Run commands from the project root.
- On NixOS, use `nix-shell --run '<command>'`, or the commands won't find Node.
- The toolkit needs no browser or display. Browser tests do: see [Testing in a browser](#testing-in-a-browser).

## 1. Inspect

Read in this order, stopping when you know enough:

1. `docs/CHAOSSCRIPT_LANGUAGE.md`, especially *Differences from Lua*. ChaosScript looks like Lua but has one return value, and undeclared names are errors.
2. The how-to for your kind of content: `ENTITY_CREATION`, `NPC_CREATION`, `TOOL_CREATION`, `WEAPON_CREATION` or `VEHICLE_CREATION`.
3. The relevant section of `docs/CHAOSSCRIPT_API.md`. Search it rather than reading all of it.
4. The closest example: [MODDING_EXAMPLES.md](MODDING_EXAMPLES.md) finds one by what you need.

To search the API from the command line:

```sh
npm run mod -- api patrol
npm run mod -- api entity.spawn
```

A word lists every match. An exact name also prints its fields and tested example. With no word it lists everything.

To see what content exists, read `src/data/items.ts` and `src/game/content/coreExpansion.ts`, or run `game.items("props")` in the debug console.

Write only under `mods/<your_mod>/`. A mod never needs a change to `src/`. If the API can't do what you need, follow *Extending the engine* in [MODDING_WORKFLOW.md](MODDING_WORKFLOW.md): say what's missing, and don't fake it.

## 2. Create

```sh
npm run mod -- new my_mod npc
```

Templates: `starter`, `prop`, `npc`, `tool`, `weapon`, `vehicle`, `mode`. This creates `mods/my_mod/mod.json` and `main.chaos`. Then edit `mod.json`: set the name, description and author, and list exactly the permissions you use.

## 3. Rules that prevent most mistakes

- `register.*` goes at the top level of a script, and nowhere else.
- Anything touching the world goes in a callback: `events.on("session_start", ...)`, a timer, or a hook.
- Don't write the mod prefix in `id`. `id = "chair"` becomes `my_mod:chair`. Inside your mod, `"chair"` finds it.
- `entity.spawn` and `physics.aim` can return `nil`. Check before using the result.
- A function returns one value. Return a table for more.
- Declare every variable with `local`, or `global` for sharing between files.
- `math.min` and `math.max` take exactly two numbers. `string` functions use plain text, not patterns.
- Keep `tick` and `on_update` short. Prefer `timer.every`.
- Things can happen between two of your checks. An enemy can die before `on_think` next runs, so handle an event for something you never saw.
- Part positions are relative to the object's centre, and the front of a prop is +z. The nose of a vehicle is -z.

## 4. Validate

```sh
npm run mod -- validate mods/my_mod
```

It checks, in order:

- **Structure:** scripts and assets exist, and no script sits unlisted.
- **Manifest:** required fields, version, API compatibility.
- **Syntax and names:** parse errors, unknown variables, misspelt API names.
- **Calls:** argument counts, unknown or missing fields in definition tables, unknown event names, `register.*` inside a function.
- **Permissions:** an API call the manifest doesn't allow is an error, and a permission nothing uses is a warning.
- **A real load**, from the main menu state, exactly as when the game starts. Dependencies come from `mods/`.
- **Ids written in scripts:** `entity.spawn("x")`, `sound.play("x")`, `player.select_tool("x")`.
- **A real session start**, which runs `session_start` handlers.

Problems print as `file:line: message`. The exit code is 0 only if everything passed. Static checks can't see through a variable, such as `local e = entity`, but the checks at runtime still apply.

Fix errors from the top: later errors are often caused by earlier ones.

## 5. Test

```sh
npm run mod -- test mods/my_mod 10
```

On top of validation, this spawns every item, uses, wires and damages it, clicks every tool, starts every map and mode, presses its Mod Menu buttons, reloads the mod, and runs the world for the given seconds, reporting any script error. Exit code 0 means every check passed.

This proves nothing crashes, not that the behaviour is right. For that, write a test against the real game, modelled on `src/tests/examplemods.test.ts`:

```ts
import { expect, it } from 'vitest';
import { Game } from '../game/core/Game';
import { readFolder } from '../modding/cli';

it('my mod works', async () => {
  await Game.init();
  const game = new Game();
  game.input.virtualLock = true;
  game.startSession();
  const r = await game.mods.installBundle(readFolder('mods/my_mod'));
  expect(r.errors).toEqual([]);
  expect(r.record!.state).toBe('loaded');
  expect(game.entities.spawn('my_mod:thing', { position: { x: 0, y: 2, z: 25 } }).ok).toBe(true);
  game.advance(2);   // simulated seconds, deterministic and fast
  expect(game.mods.logs.filter((l) => l.level === 'error')).toEqual([]);
  game.dispose();
});
```

Put it in `src/tests/`: it's the one thing about a mod that lives outside its folder. Run it with `npx vitest run src/tests/your.test.ts`. `console.log` output doesn't appear there, so assert on values or read `game.mods.logs`. `game.startSession({ map: 'industrial_yard' })` picks a map. `proving_ground` has no floor of its own, because challenges build one.

The Test Facility's spawn room is roughly x from -7 to 7 and z from 21 to 35, with the floor at y = 0. The player starts at (0, 0, 29), so that room is a good place to spawn test objects.

## Testing in a browser

Only if you need to see it, or to check input and UI. Firefox needs an X display for WebGL:

```sh
Xvfb :78 -screen 0 1280x800x24 +extension GLX &
DISPLAY=:78 npx playwright test e2e/mods.spec.ts
```

`e2e/mods.spec.ts` shows driving the mod manager, the spawn menu and the console. With `?automation` in the URL, the page exposes the game as `window.__chaos`.

## 6. Debug

Errors carry a file, line and call stack. In a test or the CLI, read `game.mods.logs`. In the game, press **`** and try calls live:

```text
mods
reload my_mod
filter my_mod
game.items("npcs")
entity.spawn("my_mod:thing", vec.add(player.position(), {x=0, y=2, z=-3}))
```

[MODDING_TROUBLESHOOTING.md](MODDING_TROUBLESHOOTING.md) maps each error message to its cause. Use `log.info` freely.

## 7. Package

```sh
npm run mod -- pack mods/my_mod
```

Writes `dist-mods/my_mod.chaosmod.json`.

A mod in `mods/<id>/` is already installed for development: `npm run dev` loads it, and the next `npm run build` bundles it, enabled unless its manifest says `"enabled_by_default": false`. A mod in `mods/examples/` isn't part of the game. Other files in a mod's folder, such as `README.md`, are ignored by the loader.

## Checklist before saying it's done

- [ ] `npm run mod -- validate mods/my_mod` passes.
- [ ] `npm run mod -- test mods/my_mod` passes.
- [ ] `mod.json` lists only the permissions used, with a real description.
- [ ] `npx vitest run` still passes, if you changed anything else.
- [ ] You've said what you tested, and what only a person can judge: how it looks, feels and sounds.
