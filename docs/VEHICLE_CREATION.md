# Creating vehicles

`register.vehicle` adds a drivable vehicle. The player gets in with E, drives with WASD, brakes with Space, resets with R, and gets out with E. Field reference: [register.vehicle](CHAOSSCRIPT_API.md#registervehicle).

Vehicles use raycast suspension. The chassis is one rigid box and the wheels are visual, with rays holding the body up.

## A complete vehicle

```lua
register.vehicle{
  id = "rover",
  name = {en = "Rover", ru = "Вездеход"},
  desc = "Six wheels and not much of a top speed.",
  size = {x = 1.6, y = 0.5, z = 3},
  material = "metal",
  model = {
    {shape = "rbox", size = {1.6, 0.4, 3}, color = 0xd9b02b},
    {shape = "rbox", size = {1.2, 0.5, 1.2}, pos = {0, 0.4, -0.3}, material = "blackened"},
  },
  wheels = {
    {x = -0.9, y = -0.2, z = -1.1}, {x = 0.9, y = -0.2, z = -1.1},
    {x = -0.9, y = -0.2, z = 0.1}, {x = 0.9, y = -0.2, z = 0.1},
    {x = -0.9, y = -0.2, z = 1.1}, {x = 0.9, y = -0.2, z = 1.1},
  },
  wheel_radius = 0.42,
  suspension = 0.45,
  engine = 1300,
  top_speed = 15,
  steer = 0.5,
  grip = 3,
  wheel_color = 0x222222,
}
```

## Layout

The nose points to **-z**. `size` is the chassis collision box: width, height, length. `wheels` are mounts relative to the centre, from 2 to 8 of them. Wheels with negative z steer, and take 60% of the engine force. Without `wheels`, you get four placed from `size`.

The wheel touches the ground at about `y - suspension - wheel_radius` below the centre, so raise the mounts or lengthen the suspension for more clearance.

## Tuning

| Field | Default | Effect |
| --- | --- | --- |
| `engine` | 1050 | Force per wheel. Heavier vehicles need more |
| `top_speed` | 26 | Above this in m/s, the engine stops pushing |
| `steer` | 0.62 | Maximum steering angle in radians. It narrows with speed |
| `grip` | 2.6 | Tyre friction. Too low slides, too high can flip it |
| `stiffness` | 26 | Suspension spring |
| `suspension` | 0.38 | Suspension length |
| `density` | 150 | Chassis density. Mass is this times the box volume |

Start from the buggy's defaults and change one thing at a time. If a heavy vehicle barely moves, raise `engine` roughly in proportion to mass. If it sinks onto its belly, raise `stiffness` or lower `density`.

## From a script

```lua
events.on("session_start", function(e)
  local v = entity.spawn("buggy", {x = 0, y = 1.5, z = 26})
  if v then
    log.info(vehicle.is_vehicle(v), vehicle.speed(v), vehicle.is_driven(v))
  end
end)
```

`vehicle.enter(id)` and `vehicle.exit()` move the player, and need the `player` permission.

## Limits

The session has a vehicle limit, 6 by default. `register.vehicle` has no script callbacks of its own. To react to driving, check `vehicle.is_driven` from a timer or a `tick` handler. Wheels are visual and rays can't climb a wall, so big steps stop a vehicle.

See the Vehicle Pack in [EXAMPLE_MODS.md](EXAMPLE_MODS.md) for a monster truck and a three-wheeler.
