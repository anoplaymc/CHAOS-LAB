# Creating tools

`register.tool` adds a hotbar slot after the built-in tools, and an entry in the spawn menu's Tools tab. Field reference: [register.tool](CHAOSSCRIPT_API.md#registertool).

The first 12 slots have number keys. Later ones, where mod tools go, are selected with the mouse wheel, the **Q** menu or the spawn menu.

## A complete tool

```lua
local power = 10

register.tool{
  id = "launcher",
  name = {en = "Launcher", ru = "Пускатель"},
  desc = "LMB throws what you aim at upward. RMB changes the power.",
  view_base = "impulse",
  hints = {{"LMB", "Launch"}, {"RMB", "Change power"}},
  on_primary = function()
    local hit = physics.aim(40)
    if hit and hit.entity then
      entity.apply_impulse(hit.entity, {x = 0, y = entity.mass(hit.entity) * power, z = 0})
      fx.ring(hit.point, 1.5, 0x66d9ff)
      sound.play("spring", 0.8, hit.point)
    else
      sound.play("error")
    end
  end,
  on_secondary = function()
    power = power % 30 + 10
    sound.play("click")
  end,
  status = function() return "Power: " .. power end,
}
```

## Callbacks

They take no entity, since there's only one player. Use `physics.aim(range)` to get what's under the crosshair: it returns `{point, normal, distance, entity}` or `nil`, and `entity` is `nil` for the map.

| Callback | When |
| --- | --- |
| `on_primary` / `on_primary_up` | Left button down / up |
| `on_secondary` / `on_secondary_up` | Right button down / up |
| `on_reload` | R pressed |
| `on_equip` / `on_unequip` | Selected / put away |
| `on_update(dt)` | Every frame while selected. Keep it short |
| `status()` | Returns a short string for the HUD, 10 times a second |

For a hold-to-use tool, set a flag in `on_primary`, clear it in `on_primary_up` and `on_unequip`, and do the work in `on_update`:

```lua
local holding = false

register.tool{
  id = "hover_beam",
  name = "Hover Beam",
  view_base = "gravity",
  hints = {{"LMB", "Hold to lift"}},
  on_primary = function() holding = true end,
  on_primary_up = function() holding = false end,
  on_unequip = function() holding = false end,
  on_update = function(dt)
    if not holding then return end
    local hit = physics.aim(30)
    if hit and hit.entity then
      entity.apply_impulse(hit.entity, {x = 0, y = entity.mass(hit.entity) * 25 * dt, z = 0})
      fx.beam(player.eye(), hit.point, 0xa080ff, 0.02, 0.05)
    end
  end,
}
```

## Holding it

`view_base` chooses which built-in tool's model is shown: `manipulator`, `spawner`, `construction`, `remover`, `inspector`, `paint`, `blaster`, `impulse`, `freeze`, `bouncer`, `disintegrator` or `gravity`. `view_parts` adds parts or, with no `view_base`, is the whole model. The model is small: about 0.3 units long, with the muzzle toward -z.

## State

Variables in your script are shared, and persist across sessions until the mod reloads. If a tool remembers entities, clear them when needed:

```lua
local marked = {}
events.on("entity_removed", function(e) marked[e.id] = nil end)
events.on("session_end", function() marked = {} end)
```

## Modes

A mode with a `tools` list locks everything else, including mod tools, unless it lists them by full id. The Editor mode allows only the build tools.

For things that shoot, see [WEAPON_CREATION.md](WEAPON_CREATION.md). See Super Tools in [EXAMPLE_MODS.md](EXAMPLE_MODS.md) for working examples.
