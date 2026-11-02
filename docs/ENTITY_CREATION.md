# Creating entities

`register.prop` adds a physical object to the spawn menu. Field reference: [register.prop](CHAOSSCRIPT_API.md#registerprop).

## A simple prop

```lua
register.prop{
  id = "tall_crate",
  name = {en = "Tall Crate", ru = "Высокий ящик"},
  desc = "Tips over easily.",
  category = "props",
  shape = {type = "box", size = {0.8, 2.4, 0.8}},
  material = "wood",
  visual = "crate",
  break_speed = 8,
  health = 60,
  debris = "wood",
}
```

`shape` is the collision shape, centred on the object:

| Shape | Fields |
| --- | --- |
| `{type="box", size={x, y, z}}` | Full width, height and depth |
| `{type="wedge", size={x, y, z}}` | A ramp, with its tall end toward +z |
| `{type="sphere", r=}` | Radius |
| `{type="cylinder", r=, h=}` | Radius and full height, upright |
| `{type="capsule", r=, h=}` | Radius and full height, upright |

Mass comes from volume and material. Built-in materials: `rubber`, `metal`, `wood`, `concrete`, `ice`, `gel`, `heavy`, `glass`.

## Looks

Without a model, a plain mesh is made from the shape in `color`. `visual` picks a built-in model, such as `crate`, `crate_metal`, `barrel`, `bench`, `shelf`, `pallet`, `tire`, `ball`, `lamp` or `button`. `model` builds one from parts:

```lua
register.prop{
  id = "side_table",
  name = "Side Table",
  shape = {type = "box", size = {0.6, 0.6, 0.6}},
  material = "wood",
  model = {
    {shape = "box", size = {0.6, 0.05, 0.6}, pos = {0, 0.27, 0}, color = 0x8a5a2a},
    {shape = "cylinder", r = 0.04, h = 0.55, pos = {0, -0.02, 0}, material = "steel"},
    {shape = "sphere", r = 0.06, pos = {0, 0.34, 0}, material = "glow_amber"},
  },
}
```

Part fields: [Model parts](CHAOSSCRIPT_API.md#model-parts). Positions are relative to the centre. Make the shape fit the model, since the shape is what collides.

**Which way is the front?** A placed object takes the player's yaw, so its local +z faces whoever placed it. Put the front of furniture at +z. The Furniture Pack's wardrobe is an example.

## Textures

List an image in the manifest's `assets`, then name it on a part:

```text
{ shape = "box", size = {1, 1.4, 0.05}, texture = "assets/poster.png" }
```

## Materials of your own

```lua
register.material{ id = "foam", name = "Foam", friction = 0.9, restitution = 0.5, density = 15, sound = "rubber", fragility = 0 }

register.prop{ id = "foam_block", name = "Foam Block", shape = {type = "box", size = {1, 1, 1}}, material = "foam", color = 0xffee88 }
```

## Scripted behaviour

```lua
register.prop{
  id = "counter",
  name = "Counter",
  shape = {type = "box", size = {0.5, 0.5, 0.5}},
  material = "metal",
  color = 0x19e0c4,
  prompt = "E  Count",
  tick_rate = 1,
  on_spawn = function(self) entity.set_data(self, "n", 0) end,
  on_interact = function(self)
    local n = (entity.get_data(self, "n") or 0) + 1
    entity.set_data(self, "n", n)
    ui.toast("Count: " .. n)
    return true
  end,
  on_tick = function(self, dt)
    fx.puff(entity.position(self), 1, 0x19e0c4, 0.2, 0.5)
  end,
}
```

All callbacks receive the entity id first. `entity.set_data` values are kept per object, and in saved games for scripted props. `on_spawn` also runs when a saved game is loaded, so check for existing data before overwriting it if that matters.

## Built-in behaviours

`behavior` reuses a mechanism from the game, configured through `params`. Most are fixed in place.

| `behavior` | `params` | Does |
| --- | --- | --- |
| `explosive` | `radius`, `impulse`, `damage` | Explodes when broken. Needs `break_speed` |
| `button` | | E sends a one-second pulse on its wire |
| `lever` | | E toggles its wire output |
| `plate` | | Output on while something stands on it. Sized for a 1.6 m plate |
| `timer` | `period`, `duty` | Pulses repeatedly |
| `inverter` | | Output is the opposite of its input |
| `delay` | `delay` | Output follows input after that many seconds |
| `latch` | | Each input pulse, or E, flips the output |
| `lamp` | | Lights up with `visual = "lamp"` when powered |
| `fan` | `force`, `range` | Blows along its local up axis. E or a wire switches it |
| `spring_pad` | `speed` | Launches what lands on it |
| `conveyor` | `speed` | Carries things along -z. Needs a box shape |
| `magnet` | `range`, `force` | Pulls metal things |
| `thruster` | `force` | Dynamic. Pushes itself along its up axis |
| `dispenser` | `dispense`, `cooldown`, `reach` | E or a wire spawns an item in front of it |
| `teleporter` | `channel` | Sends what touches it to the nearest pad with the same channel |
| `alarm` | `radius` | E or a wire draws NPCs in that radius |
| `emitter` | `kind`, `color` | Particles. `kind` is `smoke`, `sparks`, `fountain` or `firework` |

```lua
register.prop{
  id = "crate_chute",
  name = "Crate Chute",
  shape = {type = "box", size = {1, 1, 1}},
  material = "metal",
  behavior = "dispenser",
  params = {dispense = "crate_metal", cooldown = 2, reach = 1},
  color = 0xd9822b,
}
```

## Wires

Players connect wires with the Construction tool. A scripted prop can have ports of its own, with `signal = "in"`, `"out"` or `"both"`:

```lua
register.prop{
  id = "and_then_some",
  name = "Logic Box",
  shape = {type = "box", size = {0.5, 0.3, 0.5}},
  material = "metal",
  body = "fixed",
  signal = "both",
  on_signal = function(self, on)
    entity.set_signal(self, not on)
  end,
}
```

## Spawning from a script

```lua
events.on("session_start", function(e)
  local id = entity.spawn("crate_wood", {x = 0, y = 2, z = 25}, {yaw = 0.5, scale = 1.5, tint = 0xff8800})
  if id then
    entity.apply_impulse(id, {x = 0, y = entity.mass(id) * 4, z = 0})
  end
end)
```

`entity.spawn` returns `nil` at the entity limit, which the player can reach, or at 60 spawns per second per mod. Always check it.

## One-shot items

`register.effect` adds a spawn menu entry that runs a function at the crosshair and leaves nothing behind. See [register.effect](CHAOSSCRIPT_API.md#registereffect).

## Not available to mods

Doors, lifts and motors with rotors are core only, because they depend on specific models and joints.
