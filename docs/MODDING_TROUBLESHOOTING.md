# Modding troubleshooting

## Where to look

1. `npm run mod -- test mods/my_mod` finds most problems with no browser.
2. **Mods** menu: the state of each mod and why. *Details* shows recent errors.
3. **`** opens the debug console, with every mod's log. `filter my_mod` narrows it down, and you can try API calls live.

## The command line says

`npm run mod -- validate` prints each problem as `file:line: message`.

| Message | Fix |
| --- | --- |
| `... needs the "world" permission, which mod.json doesn't list` | Add it to `permissions` |
| `Permission "ui" is declared but no script appears to use it` | A warning. Remove it, unless you call it through a variable |
| `... is inside a function, but it can only be called while the mod loads` | Move `register.*` to the top level |
| `register.prop: unknown field "colour"` | Use the suggestion. `npm run mod -- api register.prop` lists the fields |
| `... is missing argument 1` | `npm run mod -- api <name>` shows the signature |
| `Unknown event "x"` | `npm run mod -- api` lists the events. Custom ones contain `:` |
| `Unknown definition "x"` | A literal id in `entity.spawn` that nothing registers |
| `x isn't listed in "scripts" in mod.json, so it never runs` | List it, or delete the file |
| `error: starting a session: ...` | A `session_start` handler failed. The message gives its line |
| `needs a running session` while loading | World calls at the top level fail when the game starts from the menu. Move them into a callback |

## The mod manager says

| State | Meaning | What to do |
| --- | --- | --- |
| Invalid | The manifest or a script has a mistake. Nothing ran | Read the errors, which give file and line |
| Blocked | A dependency or conflict | Read the reason. Enable or install what it names |
| Failed to load | A script raised an error at the top level | The error gives the line. Everything it registered was removed |
| Stopped after errors | It kept failing while running, or hit its limits | Check the console for the first error, fix it, reload |

## Common error messages

| Message | Cause | Fix |
| --- | --- | --- |
| `Reading unknown variable "x"` | A typo, or a local from another block or file | Declare it, or use `global` to share between files |
| `Assigning to unknown variable "x"` | Assigning without declaring | `local x = ...` or `global x = ...` |
| `"entity" has no "spwan"` | A misspelt API name | Use the suggestion. See [CHAOSSCRIPT_API.md](CHAOSSCRIPT_API.md) |
| `A function returns one value` | `return a, b` | Return a table: `return {a = a, b = b}` |
| `Missing "end" for the if statement opened on line 4` | An unclosed block | Add `end` |
| `... needs the "world" permission` | The manifest doesn't ask for it | Add it to `permissions` in `mod.json` |
| `... needs a running session` | A world function called at the top level, from the menu | Move it into `events.on("session_start", ...)` |
| `... can only be called while the mod is loading` | `register.*` inside a callback | Move it to the top level |
| `unknown field "colour"` | A typo in a definition table | Use the suggestion |
| `Unknown definition "x"` | A wrong id | Check `game.items()` in the console. Other mods' items need their full id |
| `Attempt to index nil (variable "t", looking for "x")` | `t` is nil | Usually a function returned nil, such as `physics.aim` or `entity.spawn`. Check first |
| `Attempt to call nil (field "t.foo")` | That field doesn't exist | Check the name |
| `Attempt to join string and table` | `..` with a non-string | Wrap it in `tostring()` |
| `Script took too long` | An endless or very long loop | Do less per call. Spread work across a timer |
| `Stack overflow` | Recursion without an end | Check the base case |

## It loads but nothing happens

- **Not in the spawn menu.** Check the tab: `category` for props, NPCs under NPCs, tools under Tools. Search by name.
- **A callback never fires.** `on_interact` needs the player aiming within about 3 metres. `events.on` names are checked, but make sure `session_start` handlers exist before the session starts: a mod enabled during a session only sees the next one.
- **`entity.spawn` returned nil.** The entity limit or the spawn rate limit, or NPC or vehicle limit. Always check for nil.
- **A timer stopped.** Timers end with the session. Start them from `session_start`.
- **An old id stopped working.** Entity ids don't last between sessions, so don't keep them in `storage`.
- **A function does nothing.** Given a removed entity, API functions return `nil` and do nothing, on purpose. `entity.exists(id)` tells you.

## Physics and looks

- **It falls through the floor or explodes apart.** It spawned inside something. Spawn higher and let it fall.
- **The collision doesn't match what you see.** `shape` collides, `model` is only visual. Make them agree.
- **A model is in the wrong place.** Part positions are relative to the object's centre, not its base.
- **A prop faces the wrong way when placed.** The front of a prop is +z.
- **A vehicle sits on its belly or won't move.** See the tuning advice in [VEHICLE_CREATION.md](VEHICLE_CREATION.md).
- **NPCs walk into walls on a mod map.** Check `nav` isn't off and that the map isn't over 40,000 square metres. The grid can't see props or upper floors.

## Performance

- `tick` runs 60 times a second, so prefer `timer.every(0.2, ...)` or `on_tick` with a `tick_rate`.
- `entity.find_near` and `entity.list` walk every entity: don't call them per-object per-tick.
- Particles are capped, and past that new ones replace old ones.

## Editing and reloading

- **In `npm run dev`**, saving a file under `mods/` reloads that mod. Adding a new mod folder reloads the page.
- **In a production build** (`npm run preview`), the files were bundled at build time. Rebuild, or use the in-game editor, or install from a folder.
- **An in-game edit doesn't show in my files.** It's a local copy in the browser's storage, and it takes priority over the files. Use *Discard edits*, or *Export* to get it out.
- **State after a reload.** Objects are new entities with new ids, so ids you kept in script variables are stale. Their `entity.set_data` values, and an NPC's order and territory, carry over. `on_spawn` runs again.
- **Entities disappeared after a reload.** Objects are recreated at their old positions if their definition still exists under the same id. If you renamed it, they're gone, and a warning says how many.
- **`hot_reload` is false.** Reload from the main menu.

## Saved games

A scene saved with a mod's objects needs that mod to bring them back. Without it, the game warns about missing items and loads the rest.
