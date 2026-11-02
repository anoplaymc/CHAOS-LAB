# Creating weapons

`register.weapon` takes the same fields as [`register.tool`](TOOL_CREATION.md) and lists the item under Weapons. The difference that matters is using the shared firing code through `fire`, so a weapon can be just data. Field reference: [register.weapon](CHAOSSCRIPT_API.md#registerweapon).

CHAOS LAB's weapons are fictional sandbox gadgets: energy beams, foam and confetti.

## Firing modes

| `fire` | Does | Fields |
| --- | --- | --- |
| `none` | Nothing by itself. Use `on_primary` | |
| `hitscan` | An instant beam | `range`, `damage`, `impulse`, `chain`, `freeze` |
| `cone` | Several rays at once | Also `pellets`, `spread` |
| `bolt` | A slow energy bolt | `speed`, `damage` |

`cooldown` is the time between shots, and `automatic = true` keeps firing while held. With `energy` set, each shot costs `cost`, and energy returns at `energy_regen` per second. Running out overheats it, and R refills it.

## A data-only weapon

```lua
register.weapon{
  id = "pulse_rifle",
  name = {en = "Pulse Rifle", ru = "Импульсная винтовка"},
  desc = "Quick bursts. Overheats if you hold it down.",
  view_base = "blaster",
  fire = "hitscan",
  automatic = true,
  damage = 8,
  impulse = 60,
  range = 70,
  cooldown = 0.12,
  energy = 100,
  energy_regen = 18,
  cost = 7,
  beam_color = 0x88aaff,
  sound = "blaster",
  hints = {{"LMB", "Fire"}, {"R", "Vent"}},
}
```

## Reacting to hits

`on_hit` runs for each thing hit, with `{point, normal, distance, entity}`. `entity` is `nil` for the map. `on_fire` runs after each shot.

```lua
register.weapon{
  id = "paint_gun",
  name = "Paint Gun",
  view_base = "paint",
  fire = "hitscan",
  cooldown = 0.25,
  range = 40,
  beam_color = 0xff4fa3,
  on_hit = function(hit)
    fx.burst(hit.point, 10, 0xff4fa3, 4)
    if hit.entity then entity.set_tint(hit.entity, 0xff4fa3) end
  end,
  on_fire = function() fx.shake(0.05) end,
}
```

## Effects without damage

`freeze` freezes the target in place for that many seconds. `chain` makes a beam jump to that many nearby targets. A `damage` of 0 with some `impulse` makes a pure pusher.

```lua
register.weapon{
  id = "stun_arc",
  name = "Stun Arc",
  view_base = "disintegrator",
  fire = "hitscan",
  automatic = true,
  chain = 2,
  damage = 3,
  impulse = 20,
  cooldown = 0.15,
  range = 25,
  energy = 100,
  cost = 4,
  beam_color = 0x66d9ff,
  on_hit = function(hit)
    if hit.entity and npc.is_npc(hit.entity) then npc.stun(hit.entity, 0.5) end
  end,
}
```

## A fully scripted weapon

Leave `fire` out and do it all yourself:

```lua
register.weapon{
  id = "mortar",
  name = "Mortar",
  view_base = "impulse",
  on_primary = function()
    local from = player.eye()
    local dir = player.look_dir()
    local shell = entity.spawn("barrel_explosive", vec.add(from, vec.scale(dir, 2)), {velocity = vec.scale(dir, 22)})
    if shell then
      timer.after(1.5, function() entity.damage(shell, 1000) end)
    end
    sound.play("impulse")
  end,
}
```

`timer` calls need a running session, which there always is when a player is firing.

## Damage

Damage to the player counts only with the session's damage rule on. A prop takes damage only if it has `break_speed`. NPCs always can. Weapon hits count as `source = "player"`, which provokes NPCs with `hostility = "provoked"`.

See the Confetti Cannon in `mods/super_tools/main.chaos` for a working example.
