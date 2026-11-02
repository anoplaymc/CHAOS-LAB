# Finding an example

All of these are real mods, tested by `src/tests/modtools.test.ts` and `src/tests/examplemods.test.ts`. The small ones in `mods/examples/` aren't part of the game: copy from them freely. Try one with `npm run mod -- test mods/examples/npc_patrol`.

| To do this | Read |
| --- | --- |
| NPC type, patrol route, event reaction, talking | `mods/examples/npc_patrol/main.chaos` |
| Scripted tool, data-only weapon | `mods/examples/tool_and_weapon/main.chaos` |
| Prop with a model, E prompt, per-object data, wires | `mods/examples/interactive_item/main.chaos` |
| Game events, custom events, timers | `mods/examples/event_reactions/main.chaos` |
| Impulses, raycasts, gravity scale, custom material | `mods/examples/physics_forces/main.chaos` |
| HUD panel, Mod Menu button, dialog | `mods/examples/ui_panels/main.chaos` |
| Player-changeable settings | `mods/examples/settings_menu/main.chaos` |
| A large panel with sliders, a bound key, temporary overrides undone on unload | `mods/examples/sandbox_panel/main.chaos` |
| Starting points for each kind of mod | `templates/` |
| Several NPC types, a scripted attack, healing others | `mods/robot_pack/main.chaos` |
| Furniture, a texture from assets | `mods/furniture_pack/main.chaos` |
| Vehicles with custom wheel layouts, a custom sound | `mods/vehicle_pack/main.chaos` |
| A complete guard: territory, noticing enemies, reactions, settings, behaviour tests | `mods/security_robots/main.chaos` |
| A hold-to-use tool, remembering entities | `mods/super_tools/main.chaos` |
| Map, game mode, dependencies, several files | `mods/chaos_playground/` |

## Small recipes

### Run something a few seconds after the session starts

```lua
events.on("session_start", function(e)
  timer.after(3, function() log.info("three seconds in") end)
end)
```

### Find the nearest NPC of an enemy type

```lua
local function nearest(position, radius, def)
  local found = entity.find_near(position, radius, {def = def})
  return found[1]   -- find_near returns nearest first, or an empty list
end

events.on("session_start", function(e)
  log.info("nearest robot:", nearest(player.position(), 50, "npc_robot"))
end)
```

### Do something when the player enters an area

```lua
local inside = false
events.on("session_start", function(e)
  inside = false
  timer.every(0.25, function()
    local now = vec.dist(player.position(), {x = 0, y = 1, z = 25}) < 5
    if now and not inside then log.info("entered") end
    inside = now
  end)
end)
```

### Check line of sight between two points

```lua
local function can_see(from, to)
  local gap = vec.sub(to, from)
  local hit = physics.raycast(from, gap, vec.length(gap))
  return hit == nil
end

events.on("session_start", function(e)
  log.info(can_see(player.eye(), {x = 0, y = 2, z = 25}))
end)
```

The ray stops at the first solid thing, including an entity at the far end, so aim just short of a target when checking one.
