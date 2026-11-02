# Modding guide

A mod is a folder with a manifest and some ChaosScript. This guide takes you from nothing to a working mod. For the full reference, see [CHAOSSCRIPT_API.md](CHAOSSCRIPT_API.md).

## Your first mod

From the project root (on NixOS, run `nix-shell` first):

```sh
npm run mod -- new my_first_mod
npm run dev
```

Open the URL Vite prints. Then open **Mods** in the menu: *my_first_mod* is listed as running. Start a game, press **G**, and search for "My Box".

Now open `mods/my_first_mod/main.chaos` in any editor, change something, and save. In development mode the game reloads the mod straight away, and objects you placed stay where they are.

## Mod layout

```text
mods/my_first_mod/
  mod.json          the manifest: see MOD_MANIFEST_SPEC.md
  main.chaos        scripts, run in the order the manifest lists them
  assets/           optional images
```

## How a mod runs

1. **Loading.** The game checks the manifest and scripts, then runs each script from top to bottom, once. This is the only time `register.*` works.
2. **Running.** After that your code only runs when something calls it: an event, a timer, or a callback such as `on_interact`.
3. **Sessions.** A session is one play of a map. `session_start` fires at the start and `session_end` at the end. Timers and panels end with the session, while event handlers stay.
4. **Unloading.** Disabling a mod removes everything it registered and every entity of those types.

```lua
-- Top level: runs when the mod loads, usually from the main menu. There's no world yet.
register.prop{
  id = "beacon",
  name = "Beacon",
  shape = {type = "cylinder", r = 0.2, h = 1},
  material = "metal",
  color = 0xff4030,
}

events.on("session_start", function(e)
  -- Now there's a world.
  entity.spawn("beacon", {x = 2, y = 1, z = 25})
  timer.every(5, function()
    log.info("player at", player.position().x)
  end)
end)
```

## Common tasks

| To do this | Read |
| --- | --- |
| Add an object | [ENTITY_CREATION.md](ENTITY_CREATION.md) |
| Add an NPC | [NPC_CREATION.md](NPC_CREATION.md) |
| Add a tool | [TOOL_CREATION.md](TOOL_CREATION.md) |
| Add a weapon | [WEAPON_CREATION.md](WEAPON_CREATION.md) |
| Add a vehicle | [VEHICLE_CREATION.md](VEHICLE_CREATION.md) |
| See complete mods | [EXAMPLE_MODS.md](EXAMPLE_MODS.md) |
| Find out why something doesn't work | [MODDING_TROUBLESHOOTING.md](MODDING_TROUBLESHOOTING.md) |

## Maps and modes

```lua
register.map{
  id = "yard",
  name = "Small Yard",
  spawn = {x = 0, y = 0, z = 10},
  blocks = {
    {pos = {0, -0.5, 0}, size = {40, 1, 40}, material = "concrete"},
    {pos = {0, 1, -20}, size = {40, 3, 1}, material = "wall_light"},
  },
  props = {
    {id = "crate_wood", pos = {0, 0.52, 0}},
  },
  sky = "dusk",
}

local points = 0
register.mode{
  id = "hunt",
  name = "Crate Hunt",
  desc = "Break a crate.",
  map = "yard",
  on_start = function() points = 0 end,
  on_tick = function(dt)
    if points >= 1 then
      mode.finish{ win = true, title = "Found it" }
    end
  end,
  hud = function() return {title = "Crate Hunt", lines = {"Points: " .. points}} end,
}

events.on("entity_broken", function(e)
  if mode.is_mine() then points = points + 1 end
end)
```

Maps appear in the map menu and modes in the Modes menu. A block's `pos` is its centre and the top of the floor above is where `spawn` should stand.

## User interface

```lua
ui.toast("Hello", "success")
ui.show_panel{ id = "status", title = "Reactor", lines = {"Core: stable"} }
ui.add_button{ label = "Vent reactor", on_click = function() ui.toast("Venting") end }
```

`ui.add_button` adds to the Mod Menu, which opens with **M**. `ui.open_menu` shows a dialog. Text can be translated by writing `{en = "Hello", ru = "Привет"}`.

## Saving data

```lua
local visits = storage.get("visits", 0) + 1
storage.set("visits", visits)
log.info("You've loaded this mod", visits, "times")
```

`storage` lasts between sessions and reloads. For data on one object, use `entity.set_data`: a scripted prop keeps it in saved games.

## Sharing with other mods

Declare dependencies in the manifest, then use their content by full id: `entity.spawn("furniture_pack:armchair", position)`. To talk to each other at runtime, mods send events. Listeners get a copy of the data:

```lua
events.on("my_mod:alarm", function(e) log.info("alarm level", e.level) end)
events.emit("my_mod:alarm", {level = 3})
```

Check for an optional dependency with `mod.is_loaded("robot_pack")`.

## Permissions

A mod declares what it needs in the manifest. Calling something without permission is an error telling you which one to add. The mod manager shows players what each mod has asked for.

## Tools

| Tool | Use |
| --- | --- |
| `npm run mod -- new <id> [template]` | Create a mod. Templates: starter, prop, npc, tool, weapon, vehicle, mode |
| `npm run mod -- validate <mod>` | Check it and load it in a real game, with no browser |
| `npm run mod -- test <mod> [seconds]` | Also spawn and use everything it registers |
| `npm run mod -- info <mod>` | Show what it declares, whether it loads, and what it registers |
| `npm run mod -- api [word]` | Search the API from the command line |
| `npm run mod -- pack <mod>` | Create `dist-mods/<id>.chaosmod.json` to share |
| `npm run mod -- zip <mod>` | Create `dist-mods/<id>-<version>.zip` and its SHA-256, for Import Mod |
| `npm run mod -- list` | List mods and reference examples |
| **Mods** menu | Enable, disable, reload, edit, see errors, import a ZIP, install from a file or folder |
| **`** key | Debug console: logs, commands (`help`), and live ChaosScript |

## Sharing a mod

`npm run mod -- zip mods/my_mod` makes a ZIP. Players install it with **Mods > Import Mod**, which shows the mod's name, version, author, permissions and dependencies first, and changes nothing until they choose **Install**. It accepts a ZIP with `mod.json` at the top, in the mod's folder, or inside a GitHub repository's ZIP, as long as the archive holds one mod. A mod that says `"enabled_by_default": false` arrives turned off.

`npm run mod -- pack mods/my_mod` makes a `.chaosmod.json` file for **Mods > Install file**, and **Install folder** takes a mod's folder. There is no online workshop yet: mods are shared as files.

A mod installed this way lives in the browser's storage. Editing a bundled mod in the game makes a local copy, and *Discard edits* goes back to the original.
