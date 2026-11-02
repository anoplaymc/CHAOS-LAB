# Example mods

This is a tour of the complete mods. To find an example by what you need to do, see [MODDING_EXAMPLES.md](MODDING_EXAMPLES.md).

Six complete mods live in `mods/`. They load through the same loader as any other mod, and you can edit them in the game. Tests run each one: `src/tests/examplemods.test.ts`.

| Mod | Shows | Permissions |
| --- | --- | --- |
| `robot_pack` | NPCs, hooks, scripted attacks | content, world, effects, ui |
| `furniture_pack` | Props from parts, a custom material, per-object data, a texture | content, world, effects |
| `vehicle_pack` | Custom vehicles, a custom sound, a Mod Menu button | content, effects, ui |
| `super_tools` | Scripted tools, a data weapon, a prop used by a tool | content, world, effects |
| `security_robots` | A territory, noticing enemies, event reactions, settings. Written by a Claude session from the documentation alone | content, world, effects, ui, storage |
| `chaos_playground` | A map, a game mode, dependencies, timers, custom events, storage | content, world, effects, ui, storage, rules |

## Robot Pack

`mods/robot_pack/main.chaos`

- **Skirmisher**: a fast rogue, all data, using the `hyper` personality.
- **Sentry Turret**: `behavior = "guard"` with a tiny radius, so it holds its spot. `on_think` sweeps a beam while idle.
- **Kamikaze Drone**: `attack = "script"`. `on_attack` kills itself, and `on_death` explodes.
- **Repair Bot**: `on_interact` toggles following. `on_think` heals nearby NPCs with `entity.find_near`.
- **Deploy Rogue Squad**: `register.effect` placing three robots at the crosshair.

## Furniture Pack

`mods/furniture_pack/main.chaos`

- A local helper function builds model tables: scripts can generate parts however they like.
- **Armchair** uses the mod's own `cushion` material.
- **Desk Lamp** keeps its state in `entity.set_data`, so it survives saving, and uses `on_tick`.
- **Safety Poster** uses `assets/poster.png`, declared in `mod.json`.

## Vehicle Pack

`mods/vehicle_pack/main.chaos`

- **Monster Truck**: large wheels, soft suspension and a high engine force.
- **Lab Trike**: three wheels. One has negative z, so that's the one that steers.
- `register.sound` makes a horn from two tones, and `ui.add_button` puts it in the Mod Menu (**M**).

## Super Tools

`mods/super_tools/main.chaos`

- **Levitator**: RMB/LMB tool that remembers which entities it changed, and cleans up on `entity_removed` and `session_end`.
- **Stacker**: uses `status` to show its setting.
- **Vortex Gun**: a hold-to-use tool with `on_update`.
- **Confetti Cannon**: a `register.weapon` using `fire = "cone"` and `on_hit`.
- **Pad Placer** and **Bounce Pad**: a tool spawning a prop from the same mod, using `behavior = "spring_pad"`.

## Chaos Playground

`mods/chaos_playground/arena.chaos`, `main.chaos`

- Two files in a set order. The first registers the map and the button, and the second the mode.
- **Required dependency** on `furniture_pack`: chairs from it appear on the map by full id. Disable it and this mod shows as Blocked.
- **Optional dependency** on `robot_pack`: the raid disaster checks `mod.is_loaded`.
- **Disasters** are functions in a table, so adding one is adding a function. Timers space them out.
- **Big Red Button** sends a custom event, which `main.chaos` listens for.
- **Chaos Hour** is a `register.mode` with `on_start`, `on_tick`, `hud`, `mode.finish` and a limited tool list. It keeps the best score in `storage`.

Start it from **Modes > Chaos Hour**.

## Security Robots

`mods/security_robots/main.chaos`, and its `README.md`. A guard robot patrols a territory set where it's placed, or moved with E. It raises the alarm about enemies, reacts to explosions and to the player being attacked, and calls other robots in range. Its settings are in the Mod Menu (**M**), kept in `storage`. Other mods can listen for `security_robots:alarm` and `security_robots:all_clear`. Behaviour tests: `src/tests/securityrobots.test.ts`.

## Templates

`templates/` has a minimal starting point for each kind of mod: `starter`, `prop`, `npc`, `tool`, `weapon`, `vehicle`, `mode`. Create one with `npm run mod -- new my_mod npc`.
