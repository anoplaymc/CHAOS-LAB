# ChaosScript API

<!-- Generated from src/modding/api. Do not edit: run `npm run mod -- docs`. -->

API version 1.1. Every function below exists, and a test runs every example against a real game. New to modding? Start with [MODDING_GUIDE.md](MODDING_GUIDE.md).

## Conventions

- **Positions and vectors** are tables: `{x=0, y=1, z=0}`. `{0, 1, 0}` is accepted too. The y axis points up, and the player faces -z at yaw 0.
- **Entities** are integer ids. A function given an id that no longer exists returns nil and does nothing.
- **Ids.** A name without `:` looks in your mod first, then in core content. `other_mod:thing` is exact.
- **Text** shown to players can be a string or `{en="...", ru="..."}`.
- **Colours** are `0xRRGGBB` numbers or `"#rrggbb"`.
- **Wrong arguments are errors**, with a message saying what was expected. Unknown fields in a definition table are errors too.
- A square-bracketed parameter in a signature is optional.

## Permissions

Declared in `mod.json`. Functions without a permission are always allowed.

| Permission | Allows |
| --- | --- |
| `content` | Register new props, NPCs, tools, weapons, vehicles, maps, modes, materials, sounds and effects. |
| `world` | Spawn, remove and change entities, give orders to NPCs, cause explosions. |
| `player` | Change the player: health, position, velocity, selected tool. |
| `effects` | Create particles and play sounds. |
| `ui` | Show messages, panels, menus and buttons. |
| `storage` | Save data between sessions (up to 256 KB). |
| `rules` | Change session rules such as gravity and damage. |
| `sandbox` | Override the player's abilities, time, lighting, weapons, NPC behaviour and debug views. All of it is undone when the mod stops. |

## Contents

- [log](#log): info, warn, error
- [mod](#mod): id, version, full_id, has_permission, is_loaded, list, logs, status, api
- [register](#register): material, prop, npc, tool, weapon, vehicle, map, mode, sound, effect
- [game](#game): time, in_session, map, current_mode, language, gravity, set_gravity, set_damage, set_aggression, explode, shockwave, noise, items, materials, item_info
- [entity](#entity): spawn, remove, exists, def, kind, position, set_position, set_yaw, velocity, set_velocity, apply_impulse, mass, health, max_health, set_health, damage, set_gravity_scale, set_damping, set_anchored, is_anchored, freeze, scale, set_scale, set_tint, material, set_material, find_near, list, set_data, get_data, set_signal
- [npc](#npc): is_npc, state, order, faction, is_enemy, enemies_in_sight, target, can_see_target, attack, set_territory, set_attack_damage, is_provoked, set_provoked, go_to, follow, guard, patrol, use, tinker, stop, say, stun, alert, scare, all
- [vehicle](#vehicle): is_vehicle, speed, is_driven, enter, exit
- [player](#player): position, feet, eye, look_dir, velocity, health, max_health, set_health, damage, teleport, launch, respawn, is_dead, is_flying, is_driving, is_grounded, tool, select_tool
- [physics](#physics): raycast, aim, overlap_sphere
- [vec](#vec): new, add, sub, scale, length, dist, normalize, dot, cross
- [fx](#fx): burst, puff, beam, ring, flash, explosion, shake
- [sound](#sound): play, names
- [ui](#ui): toast, show_panel, hide_panel, open_menu, close_menu, add_button, remove_button, open_panel, update_panel, close_panel, panel_open
- [storage](#storage): get, set, delete, keys
- [events](#events): on, off, emit
- [timer](#timer): after, every, cancel
- [mode](#mode): finish, is_mine
- [sandbox](#sandbox): set_god, set_player_tuning, set_flight, set_rule_gravity, set_rule_damage, set_rule_aggression, set_air_control, set_infinite_energy, refill_energy, set_weapon_tuning, set_unlock_tools, tools, set_time_scale, set_world_frozen, world_frozen, set_blast_scale, set_environment, environment, set_overlay, set_highlight, perf, track_spawn, is_tracked, remember_entity, restore_entity, set_mass, set_invulnerable, is_invulnerable, npc_info, npc_set_ai, npc_set_stance, npc_set_tuning, vehicle_info, vehicle_set_tuning, vehicle_upright, active, revert_all
- [input](#input): bind, unbind
- [json](#json): encode, decode
- [Events](#events), [Model parts](#model-parts), [Standard library](#standard-library)

## log

Write to the debug console. `print` does the same as `log.info`.

### `log.info`

`log.info([values...])`

Writes to the debug console. Values are joined with spaces.

```lua
log.info("spawned", 3, "crates")
```

### `log.warn`

`log.warn([values...])`

Writes a warning.

```lua
log.warn("low on crates")
```

### `log.error`

`log.error([values...])`

Writes an error, shown in the mod manager. It does not stop the script: use error() for that.

```lua
log.error("something looks wrong")
```

## mod

Information about this mod and others.

### `mod.id`

`mod.id() -> string`

This mod's id.

```lua
assert(type(mod.id()) == "string")
```

### `mod.version`

`mod.version() -> string`

This mod's version.

```lua
log.info(mod.version())
```

### `mod.full_id`

`mod.full_id(name) -> string`

The namespaced id for one of this mod's things.

```lua
assert(mod.full_id("chair") == mod.id() .. ":chair")
```

### `mod.has_permission`

`mod.has_permission(name) -> boolean`

True if the manifest grants this permission.

```lua
log.info(mod.has_permission("world"))
```

### `mod.is_loaded`

`mod.is_loaded(id) -> boolean`

True if another mod is enabled and working. Useful for optional dependencies.

```lua
log.info(mod.is_loaded("robot_pack"))
```

### `mod.list`

`mod.list() -> list of {id, name, version, state}`

Every installed mod.

```lua
assert(type(mod.list()) == "table")
```

### `mod.logs`

`mod.logs([limit], [level]) -> list of {mod, level, text, time}`

The log of every mod, as shown in the debug console.

Permission: `sandbox`.

- `limit`: Most recent entries to return, up to 200. Default 50.
- `level`: "info", "warn" or "error". Default all.

```lua
log.info("hello")
assert(#mod.logs(5) > 0)
```

### `mod.status`

`mod.status() -> {phase, errors, timers, handlers, keys, storage_bytes, heap_cells}`

How this mod's script is doing.

```lua
assert(mod.status().phase ~= nil)
```

### `mod.api`

`mod.api([word]) -> list of {name, signature, doc, permission}`

The API functions that exist.

- `word`: Only functions whose name or description contains this.

```lua
assert(#mod.api("sandbox.set_god") == 1)
```

## register

Add content. These can only be called while the mod is loading, which means at the top level of a script.

### `register.material`

`register.material(def) -> full id`

Adds a physics material.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `name` | text or {en=, ru=} | required | Shown in menus. |
| `friction` | number, 0 to 2 | required | Grip. |
| `restitution` | number, 0 to 1.2 | required | Bounce. |
| `density` | number, 1 to 5000 | required | Weight per cubic metre. |
| `sound` | "wood" \| "metal" \| "rubber" \| "stone" \| "glass" \| "ice" \| "gel" | "wood" | Impact sound. |
| `fragility` | number, 0 to 5 | 1 | Multiplies impact damage. 0 is unbreakable. |
| `tint` | colour (0xRRGGBB or "#rrggbb") | 0xc9c5b8 | Colour when the Inspector applies this material. |

```lua
local id = register.material{ id = "jelly", name = "Jelly", friction = 0.3, restitution = 1, density = 30, sound = "gel" }
assert(table.contains(game.materials(), id))
```

### `register.prop`

`register.prop(def) -> full id`

Adds a physical object to the spawn menu.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `name` | text or {en=, ru=} | required | Shown in menus. |
| `desc` | text or {en=, ru=} |  | Shown in the spawn menu. |
| `category` | "props" \| "physics" \| "construction" \| "mechanical" \| "effects" \| "decorations" | "props" | Spawn menu tab. |
| `shape` | shape | required | Collision shape: {type="box", size={x, y, z}}, {type="wedge", size={x, y, z}}, {type="sphere", r=}, {type="cylinder", r=, h=} or {type="capsule", r=, h=}. Dimensions are 0.05 to 12. |
| `material` | string | "wood" | Physics material: a built-in id (rubber, metal, wood, concrete, ice, gel, heavy, glass) or one this mod registered. |
| `color` | colour (0xRRGGBB or "#rrggbb") |  | Colour of the mesh generated from the shape, used when there is no model. |
| `visual` | string |  | A built-in model name such as "crate", "barrel" or "bench". Optional. |
| `model` | list of model parts |  | A model built from primitive parts. See "Model parts" at the end of this document. |
| `body` | "dynamic" \| "fixed" | "dynamic" | dynamic falls and can be thrown. fixed stays where it is placed. |
| `break_speed` | number, 0.5 to 100 |  | Impact speed in m/s that starts to damage it. Without this it is unbreakable. |
| `health` | number, 1 to 100000 | 50 if breakable | Health. |
| `debris` | "wood" \| "glass" \| "metal" \| "stone" \| "ice" |  | What it shatters into when it breaks. |
| `debris_count` | number, 0 to 24 | 5 | How many chips. |
| `disintegrable` | boolean | true | Whether the Disintegrator can dissolve it. |
| `build_part` | boolean | false | Also list it in the Construction tool. |
| `behavior` | "explosive" \| "button" \| "lever" \| "plate" \| "timer" \| "inverter" \| "lamp" \| "fan" \| "spring_pad" \| "emitter" \| "delay" \| "latch" \| "conveyor" \| "magnet" \| "thruster" \| "dispenser" \| "teleporter" \| "alarm" |  | A built-in behaviour. See ENTITY_CREATION.md for each one's params. |
| `params` | table |  | Numbers and text for the behaviour, such as {radius=4, impulse=500, damage=30}. |
| `signal` | "in" \| "out" \| "both" |  | Wire ports. Use with on_signal and entity.set_signal. |
| `on_spawn` | function |  | on_spawn(id). Runs once, on its first physics step. |
| `on_tick` | function |  | on_tick(id, dt). Runs repeatedly. See tick_rate. |
| `tick_rate` | number, 0.05 to 60 | 0.1 | Seconds between on_tick calls. |
| `on_damage` | function |  | on_damage(id, amount, source_kind). source_kind is "player", "npc", "impact", "explosion" or "other". |
| `on_interact` | function |  | on_interact(id). The player pressed E on it. |
| `prompt` | text or {en=, ru=} |  | Text of the E prompt. |
| `on_break` | function |  | on_break(id). Health reached zero, just before it is removed. |
| `on_remove` | function |  | on_remove(id). It is being removed for any reason. |
| `on_signal` | function |  | on_signal(id, on). A wire into it changed. |

```lua
local id = register.prop{
  id = "stool",
  name = "Stool",
  shape = {type="cylinder", r=0.3, h=0.6},
  material = "wood",
  model = {
    {shape="cylinder", r=0.3, h=0.08, pos={0, 0.26, 0}, color=0x8a5a2a},
    {shape="cylinder", r=0.05, h=0.5, pos={0, -0.05, 0}, material="steel"},
  },
  break_speed = 9,
  debris = "wood",
  on_interact = function(self) log.info("sat on", self); return true end,
  prompt = "Sit",
}
local e = entity.spawn(id, {x=0, y=30, z=0})
assert(entity.def(e) == id)
entity.remove(e)
```

### `register.npc`

`register.npc(def) -> full id`

Adds an NPC type, and its entry in the spawn menu.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `name` | text or {en=, ru=} | required | Shown in menus. |
| `desc` | text or {en=, ru=} |  | Shown in the spawn menu. |
| `height` | number, 0.4 to 8 | from model base | Total height in metres. The model is scaled to match. |
| `radius` | number, 0.15 to 2 | 0.35 | Body radius. |
| `model` | table |  | Appearance: {base="robot", color=0xff0000, accent=0x333333, parts={...}}. base is "technician", "guard", "robot", "heavy", "creature" or "humanoid". parts use attach to follow a joint. |
| `material` | string | "rubber" | Physics material. |
| `health` | number, 1 to 100000 | 100 | Health. |
| `walk_speed` | number, 0 to 30 | 2 | Speed in m/s when calm. |
| `run_speed` | number, 0 to 40 | 4.5 | Speed in m/s when chasing or fleeing. |
| `sight` | number, 0 to 200 | 20 | How far it can see a target. |
| `hearing` | number, 0 to 200 | 12 | How far it hears noise. |
| `attack` | "none" \| "bolt" \| "tracer" \| "slam" \| "script" | "none" | How it fights. "script" calls on_attack instead. |
| `attack_range` | number, 0 to 200 | 12 | Starts attacking within this distance. |
| `attack_cooldown` | number, 0.05 to 60 | 1 | Seconds between attacks. |
| `attack_damage` | number, 0 to 1000 | 10 | Damage per attack. |
| `faction` | "lab" \| "rogue" \| "neutral" | "neutral" | lab and rogue fight each other on sight. |
| `hostility` | "never" \| "provoked" \| "always" | "never" | When it attacks the player. provoked means after being hurt by the player. |
| `flees_when_hurt` | boolean | false | Runs when damaged. |
| `skittish` | boolean | false | Runs from anything fast nearby. |
| `memory` | number, 0 to 120 | 4 | Seconds it keeps chasing after losing sight. |
| `hops` | boolean | false | Moves in hops. |
| `voice` | "human" \| "creature" \| "robot" \| "silent" | "human" | Which family of sounds it makes. |
| `behavior` | "wander" \| "stand" \| "patrol" \| "follow" \| "guard" \| "tinker" | "wander" | What it does when not fighting. Change it at runtime with the npc functions. |
| `guard_radius` | number, 1 to 100 | 9 | For behavior="guard". It guards the place it spawned. |
| `follow_distance` | number, 1 to 40 | 3.5 | For behavior="follow". |
| `personality` | "brave" \| "cowardly" \| "curious" \| "lazy" \| "hyper" \| "relentless" |  | A preset that adjusts the numbers above. See NPC_CREATION.md. |
| `on_explosion` | "ignore" \| "investigate" \| "flee" |  | What it does when an explosion happens nearby. |
| `lines` | list of text |  | Lines it says when the player presses E. |
| `prompt` | text or {en=, ru=} |  | Text of the E prompt. |
| `on_spawn` | function |  | on_spawn(id). Runs on its first physics step. |
| `on_think` | function |  | on_think(id, dt). Runs 4 times a second while alive. |
| `on_damage` | function |  | on_damage(id, amount, source_kind, attacker). attacker is the entity responsible, or nil. |
| `on_interact` | function |  | on_interact(id). Return false to fall through to lines. |
| `on_death` | function |  | on_death(id, by_player). |
| `on_attack` | function |  | on_attack(id, target_position, target_entity). For attack="script". target_entity is nil when the target is the player. |

```lua
local id = register.npc{
  id = "drone",
  name = "Patrol Drone",
  height = 1.2,
  model = {base="robot", color=0x3388ff},
  health = 40,
  walk_speed = 3,
  attack = "bolt",
  attack_damage = 5,
  faction = "rogue",
  hostility = "always",
  behavior = "guard",
  on_think = function(self, dt) end,
  on_death = function(self, by_player) log.info("drone down") end,
}
local e = entity.spawn(id, {x=0, y=30, z=0})
assert(npc.is_npc(e))
entity.remove(e)
```

### `register.tool`

`register.tool(def) -> full id (also the tool id)`

Adds a tool: a hotbar slot after the built-in ones, and an entry in the Tools tab of the spawn menu.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `name` | text or {en=, ru=} | required | Shown in menus. |
| `desc` | text or {en=, ru=} |  | Shown in the spawn menu. |
| `fire` | "none" \| "hitscan" \| "bolt" \| "cone" | "none" | What the primary button does by itself. Leave as none to do it all in on_primary. |
| `energy` | number, 1 to 10000 |  | Energy capacity. Without this there is no energy bar. |
| `energy_regen` | number, 0 to 10000 | energy / 6 | Energy per second. |
| `cost` | number, 0 to 10000 | 10 | Energy per shot. |
| `cooldown` | number, 0 to 60 | 0.25 | Seconds between shots. |
| `automatic` | boolean | false | Keeps firing while held. |
| `damage` | number, 0 to 10000 | 0 | Per hit. |
| `range` | number, 0 to 500 | 60 | Metres, for hitscan and cone. |
| `impulse` | number, 0 to 100000 | 0 | Push per hit. |
| `pellets` | number, 1 to 32 | 6 | Rays per shot, for cone. |
| `spread` | number, 0 to 1 | 0.08 | Cone width. |
| `speed` | number, 1 to 200 | 28 | m/s, for bolt. |
| `beam_color` | colour (0xRRGGBB or "#rrggbb") | 0xffb000 | Beam and impact colour. |
| `sound` | string | "blaster" | Sound per shot. See sound.names(). |
| `freeze` | number, 0 to 60 |  | Seconds a hit target stays frozen. |
| `chain` | number, 0 to 8 | 0 | The beam jumps to this many nearby targets. |
| `view_base` | string | "manipulator" | Which built-in tool's model to hold: manipulator, spawner, construction, remover, inspector, paint, blaster, impulse, freeze, bouncer, disintegrator or gravity. |
| `view_parts` | list of model parts |  | Extra parts on the held model. The whole model is about 0.3 units long, so use small sizes. |
| `hints` | table |  | Control hints for the HUD: {{"LMB", "Fire"}, {"R", "Vent"}}. |
| `on_primary` | function |  | on_primary(). Left button pressed. |
| `on_primary_up` | function |  | on_primary_up(). Left button released. |
| `on_secondary` | function |  | on_secondary(). Right button pressed. |
| `on_secondary_up` | function |  | on_secondary_up(). Right button released. |
| `on_reload` | function |  | on_reload(). R pressed. |
| `on_equip` | function |  | on_equip(). Selected. |
| `on_unequip` | function |  | on_unequip(). Put away. |
| `on_update` | function |  | on_update(dt). Every frame while selected. Keep it short. |
| `on_fire` | function |  | on_fire(). After each shot. |
| `on_hit` | function |  | on_hit(hit). For each thing hit. hit has point, normal, distance and entity. |
| `status` | function |  | status() returns short text for the HUD. |

```lua
local id = register.tool{
  id = "poker",
  name = "Poker",
  view_base = "inspector",
  hints = {{"LMB", "Poke"}},
  on_primary = function()
    local hit = physics.aim(20)
    if hit and hit.entity then
      entity.apply_impulse(hit.entity, {x=0, y=200, z=0})
    end
  end,
  status = function() return "ready" end,
}
assert(player.select_tool(id))
assert(player.tool() == id)
player.select_tool("manipulator")
```

### `register.weapon`

`register.weapon(def) -> full id (also the tool id)`

Adds a weapon. It is the same as a tool, listed under Weapons and with a coral hotbar slot.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `name` | text or {en=, ru=} | required | Shown in menus. |
| `desc` | text or {en=, ru=} |  | Shown in the spawn menu. |
| `fire` | "none" \| "hitscan" \| "bolt" \| "cone" | "none" | What the primary button does by itself. Leave as none to do it all in on_primary. |
| `energy` | number, 1 to 10000 |  | Energy capacity. Without this there is no energy bar. |
| `energy_regen` | number, 0 to 10000 | energy / 6 | Energy per second. |
| `cost` | number, 0 to 10000 | 10 | Energy per shot. |
| `cooldown` | number, 0 to 60 | 0.25 | Seconds between shots. |
| `automatic` | boolean | false | Keeps firing while held. |
| `damage` | number, 0 to 10000 | 0 | Per hit. |
| `range` | number, 0 to 500 | 60 | Metres, for hitscan and cone. |
| `impulse` | number, 0 to 100000 | 0 | Push per hit. |
| `pellets` | number, 1 to 32 | 6 | Rays per shot, for cone. |
| `spread` | number, 0 to 1 | 0.08 | Cone width. |
| `speed` | number, 1 to 200 | 28 | m/s, for bolt. |
| `beam_color` | colour (0xRRGGBB or "#rrggbb") | 0xffb000 | Beam and impact colour. |
| `sound` | string | "blaster" | Sound per shot. See sound.names(). |
| `freeze` | number, 0 to 60 |  | Seconds a hit target stays frozen. |
| `chain` | number, 0 to 8 | 0 | The beam jumps to this many nearby targets. |
| `view_base` | string | "manipulator" | Which built-in tool's model to hold: manipulator, spawner, construction, remover, inspector, paint, blaster, impulse, freeze, bouncer, disintegrator or gravity. |
| `view_parts` | list of model parts |  | Extra parts on the held model. The whole model is about 0.3 units long, so use small sizes. |
| `hints` | table |  | Control hints for the HUD: {{"LMB", "Fire"}, {"R", "Vent"}}. |
| `on_primary` | function |  | on_primary(). Left button pressed. |
| `on_primary_up` | function |  | on_primary_up(). Left button released. |
| `on_secondary` | function |  | on_secondary(). Right button pressed. |
| `on_secondary_up` | function |  | on_secondary_up(). Right button released. |
| `on_reload` | function |  | on_reload(). R pressed. |
| `on_equip` | function |  | on_equip(). Selected. |
| `on_unequip` | function |  | on_unequip(). Put away. |
| `on_update` | function |  | on_update(dt). Every frame while selected. Keep it short. |
| `on_fire` | function |  | on_fire(). After each shot. |
| `on_hit` | function |  | on_hit(hit). For each thing hit. hit has point, normal, distance and entity. |
| `status` | function |  | status() returns short text for the HUD. |

```lua
local id = register.weapon{
  id = "pop_gun",
  name = "Pop Gun",
  fire = "hitscan",
  damage = 6,
  impulse = 80,
  cooldown = 0.3,
  energy = 100,
  cost = 10,
  beam_color = 0x19e0c4,
  view_base = "blaster",
  on_hit = function(hit) fx.ring(hit.point, 1, 0x19e0c4) end,
}
assert(player.select_tool(id))
player.select_tool("manipulator")
```

### `register.vehicle`

`register.vehicle(def) -> full id`

Adds a drivable vehicle: a chassis on raycast suspension. The player gets in with E.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `name` | text or {en=, ru=} | required | Shown in menus. |
| `desc` | text or {en=, ru=} |  | Shown in the spawn menu. |
| `size` | {x, y, z} numbers | required | Chassis collision box: width, height, length. The nose points to -Z. |
| `model` | list of model parts |  | Chassis model from parts. |
| `visual` | string |  | A built-in model, such as "buggy". |
| `color` | colour (0xRRGGBB or "#rrggbb") |  | Colour of a plain box chassis, used when there is no model. |
| `material` | string | "metal" | Physics material of the chassis. |
| `wheels` | list of positions |  | Wheel mounts relative to the centre, 2 to 8 of them. Those with negative z steer. Default: four, from size. |
| `wheel_radius` | number, 0.1 to 2 | 0.36 | Wheel radius. |
| `suspension` | number, 0.05 to 2 | 0.38 | Suspension rest length. |
| `engine` | number, 0 to 20000 | 1050 | Force per driven wheel. |
| `top_speed` | number, 1 to 80 | 26 | m/s. |
| `steer` | number, 0.05 to 1.2 | 0.62 | Maximum steering angle in radians. |
| `grip` | number, 0.1 to 12 | 2.6 | Tyre grip. |
| `stiffness` | number, 1 to 200 | 26 | Suspension stiffness. |
| `density` | number, 10 to 2000 | 150 | Chassis density, which sets its weight. |
| `wheel_color` | colour (0xRRGGBB or "#rrggbb") |  | Tyre colour. |

```lua
local id = register.vehicle{
  id = "cart",
  name = "Cart",
  size = {x=1.2, y=0.4, z=2},
  color = 0x19e0c4,
  engine = 700,
  top_speed = 14,
}
local e = entity.spawn(id, {x=0, y=30, z=0})
assert(vehicle.is_vehicle(e))
entity.remove(e)
```

### `register.map`

`register.map(def) -> full id`

Adds a map to the map menu.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `name` | text or {en=, ru=} | required | Shown in menus. |
| `desc` | text or {en=, ru=} |  | Shown in the spawn menu. |
| `spawn` | position | required | Where the player's feet start. Put a block under it. |
| `blocks` | table | required | List of solid boxes: {pos={x,y,z}, size={x,y,z}, material="concrete"}. Up to 2000. Materials: floor_tile, floor_dark, concrete, concrete_dark, asphalt, hazard, wall_light, wall_dark, wall_teal, corrugated, corrugated_teal, container_red, container_blue, container_amber, platform_candy, platform_mint, wood, steel, steel_dark. |
| `props` | table |  | List of things to place: {id="crate_wood", pos={x,y,z}, yaw=0}. Up to 400. |
| `lights` | table |  | List of ceiling lights: {pos={x,y,z}, color=0xffffff, intensity=40, range=20}. Up to 16. |
| `patrols` | table |  | List of routes (lists of positions) that guards with behavior="patrol" walk. |
| `zones` | table |  | List of volumes: {type="lowg", min=, max=, gravity=0.3} or {type="pad", min=, max=, speed=14}. |
| `sky` | "day" \| "dusk" \| "night" \| "cloud" | "day" | Sky and light preset. |
| `ambience` | "indoor" \| "outdoor" \| "sky" | "outdoor" | Background sound. |
| `nav` | boolean | true | Build a navigation grid over the blocks, so NPCs can path around walls. |
| `kill_y` | number | -40 | Below this height the player respawns and objects are removed. |

```lua
local id = register.map{
  id = "pad",
  name = "Test Pad",
  spawn = {x=0, y=0, z=6},
  blocks = {{pos={0, -0.5, 0}, size={30, 1, 30}, material="concrete"}},
  props = {{id="crate_wood", pos={0, 0.52, 0}}},
  sky = "dusk",
}
log.info("registered", id)
```

### `register.mode`

`register.mode(def) -> full id`

Adds a game mode to the Modes menu.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `name` | text or {en=, ru=} | required | Shown in menus. |
| `desc` | text or {en=, ru=} |  | Shown in the spawn menu. |
| `map` | string | "test_facility" | Default map id. A name without ":" looks in this mod first. |
| `tools` | list of strings |  | Allowed tool ids. Default: all. |
| `use_map_props` | boolean | true | Whether the map's own props appear. |
| `gravity` | number, -20 to 40 |  | Session gravity. |
| `damage` | boolean |  | Whether the player takes damage. |
| `aggression` | "passive" \| "normal" \| "high" |  | NPC aggression. |
| `flight` | boolean |  | Whether flight is allowed. |
| `respawn` | boolean |  | Whether the player may respawn on demand. |
| `on_start` | function |  | on_start(). The session has begun. |
| `on_tick` | function |  | on_tick(dt). Every physics step, 60 times a second. Keep it short. |
| `on_end` | function |  | on_end(). The session is ending. |
| `hud` | function |  | hud() returns {title="...", lines={"...", "..."}} for the corner panel, 10 times a second. |

```lua
local score = 0
local id = register.mode{
  id = "collector",
  name = "Collector",
  desc = "Touch ten crates.",
  map = "test_facility",
  gravity = 6,
  on_start = function() score = 0 end,
  on_tick = function(dt) end,
  hud = function() return {title="Collector", lines={"Score: " .. score}} end,
}
log.info("registered", id)
```

### `register.sound`

`register.sound(def) -> full id`

Adds a sound built from synthesised tones. Play it with sound.play.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `layers` | table | required | List of tones played together: {freq=440, dur=0.2, vol=0.3, wave="sine", slide=880, delay=0}. wave is sine, square, sawtooth or triangle. Add noise=true for a burst of filtered noise. Up to 8. |

```lua
local id = register.sound{
  id = "ding",
  layers = {
    {freq=880, dur=0.2, vol=0.2, wave="sine"},
    {freq=1320, dur=0.15, vol=0.1, wave="triangle", delay=0.05},
  },
}
sound.play(id)
```

### `register.effect`

`register.effect(def) -> full id`

Adds a one-shot entry to the spawn menu. Using it runs a function at the crosshair, and nothing is left behind.

Permission: `content`. Only while the mod is loading.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Lowercase name, unique in this mod. The full id becomes `your_mod:name`. |
| `name` | text or {en=, ru=} | required | Shown in menus. |
| `desc` | text or {en=, ru=} |  | Shown in the spawn menu. |
| `category` | "effects" \| "props" \| "physics" | "effects" | Spawn menu tab. |
| `color` | colour (0xRRGGBB or "#rrggbb") | 0xffb000 | Icon colour. |
| `on_use` | function | required | on_use(position). The player placed it from the spawn menu. |

```lua
local id = register.effect{
  id = "party",
  name = "Party Popper",
  on_use = function(pos) fx.burst(pos, 60, 0xff4fa3, 8) end,
}
log.info("registered", id)
```

## game

The session and the world as a whole.

### `game.time`

`game.time() -> number`

Seconds of play since the session started.

```lua
assert(game.time() >= 0)
```

### `game.in_session`

`game.in_session() -> boolean`

True while a world exists. It is false in the main menu.

```lua
log.info("in a session:", game.in_session())
```

### `game.map`

`game.map() -> string`

Id of the current map, as last started.

```lua
log.info("map:", game.map())
```

### `game.current_mode`

`game.current_mode() -> string`

Id of the current game mode, as last started.

```lua
log.info("mode:", game.current_mode())
```

### `game.language`

`game.language() -> "en" or "ru"`

The player's language setting.

```lua
assert(game.language() == "en" or game.language() == "ru")
```

### `game.gravity`

`game.gravity() -> number`

Session gravity in m/s². The default is 9.81.

```lua
assert(game.gravity() > 0)
```

### `game.set_gravity`

`game.set_gravity(g)`

Changes gravity for this session.

Permission: `rules`. Needs a running session.

- `g`: -20 to 40. Negative pulls upward.

```lua
game.set_gravity(4)
assert(game.gravity() == 4)
game.set_gravity(9.81)
```

### `game.set_damage`

`game.set_damage(enabled)`

Turns player damage on or off for this session.

Permission: `rules`. Needs a running session.

```lua
game.set_damage(false)
game.set_damage(true)
```

### `game.set_aggression`

`game.set_aggression(level)`

How readily NPCs attack, for this session.

Permission: `rules`. Needs a running session.

- `level`: "passive", "normal" or "high".

```lua
game.set_aggression("passive")
game.set_aggression("normal")
```

### `game.explode`

`game.explode(position, radius, [impulse], [damage])`

A real explosion: fire, sound, push and damage, which also alerts NPCs. Happens at the end of the current step.

Permission: `world`. Needs a running session.

- `radius`: Metres, 0.5 to 20.
- `impulse`: Push strength, up to 5000. Default 900.
- `damage`: Up to 500. Default 40.

```lua
game.explode({x=0, y=30, z=0}, 3, 200, 0)
```

### `game.shockwave`

`game.shockwave(position, radius, [impulse], [damage])`

A blast without fire: a ring and a push. Limits as for game.explode.

Permission: `world`. Needs a running session.

```lua
game.shockwave({x=0, y=30, z=0}, 3, 300, 0)
```

### `game.noise`

`game.noise(position, radius)`

A sound NPCs can hear and come to investigate.

Permission: `world`. Needs a running session.

```lua
game.noise({x=0, y=1, z=0}, 20)
```

### `game.items`

`game.items([category]) -> list of {id, name, kind, category, source}`

Everything in the spawn catalog, including other mods' content. Name is in the player's language.

```lua
local all = game.items("props")
assert(#all > 0)
log.info(all[1].id, all[1].name)
```

### `game.materials`

`game.materials() -> list of ids`

Every physics material id.

```lua
assert(table.contains(game.materials(), "wood"))
```

### `game.item_info`

`game.item_info(id) -> table, or nil if there is no such item`

Details of one catalog item, for showing to the player.

```lua
assert(game.item_info("crate_wood").material == "wood")
assert(game.item_info("nothing") == nil)
```

## entity

Everything in the world that is not the map itself. An entity is an integer id. Any function given an id that no longer exists returns nil and does nothing.

### `entity.spawn`

`entity.spawn(def, position, [options]) -> id, or nil if the limit is reached`

Creates an entity. Returns nil when the session's entity limit or the mod's spawn rate limit (60 per second) is hit. An unknown definition is an error.

Permission: `world`. Needs a running session.

- `def`: Definition id. A name without ":" looks in this mod first, then core.
- `options`: scale, yaw, velocity, material, tint, anchored

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scale` | number, 0.25 to 3 | 1 | Size multiplier. |
| `yaw` | number | 0 | Rotation around the vertical axis, in radians. |
| `velocity` | position |  | Starting velocity. |
| `material` | string |  | A material id to use instead of the default. |
| `tint` | colour (0xRRGGBB or "#rrggbb") |  | Paint colour. |
| `anchored` | boolean | false | Fixed in place. |

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0}, {yaw=0.5, scale=1.5})
assert(entity.exists(id))
entity.remove(id)
```

### `entity.remove`

`entity.remove(id) -> true if removed`

Removes an entity. Map fixtures can't be removed.

Permission: `world`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.remove(id))
assert(not entity.exists(id))
```

### `entity.exists`

`entity.exists(id) -> boolean`

True if this id is a live entity.

```lua
assert(entity.exists(-1) == false)
```

### `entity.def`

`entity.def(id) -> string`

The definition id, such as "crate_wood" or "my_mod:chair".

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.def(id) == "crate_wood")
entity.remove(id)
```

### `entity.kind`

`entity.kind(id) -> "prop", "npc" or "vehicle"`

What sort of entity it is.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.kind(id) == "prop")
entity.remove(id)
```

### `entity.position`

`entity.position(id) -> position`

Where its centre is.

```lua
local id = entity.spawn("crate_wood", {x=2, y=30, z=0})
assert(entity.position(id).x == 2)
entity.remove(id)
```

### `entity.set_position`

`entity.set_position(id, position)`

Moves it instantly and stops its motion.

Permission: `world`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_position(id, {x=1, y=31, z=1})
entity.remove(id)
```

### `entity.set_yaw`

`entity.set_yaw(id, yaw)`

Sets its rotation around the vertical axis, in radians, and stops its motion.

Permission: `world`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_yaw(id, 1.57)
entity.remove(id)
```

### `entity.velocity`

`entity.velocity(id) -> position-shaped velocity`

Linear velocity in m/s.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.velocity(id).y == 0)
entity.remove(id)
```

### `entity.set_velocity`

`entity.set_velocity(id, velocity)`

Sets linear velocity, each axis limited to ±200. Does nothing to anchored or fixed things.

Permission: `world`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_velocity(id, {x=0, y=5, z=0})
assert(entity.velocity(id).y == 5)
entity.remove(id)
```

### `entity.apply_impulse`

`entity.apply_impulse(id, impulse)`

Pushes it, each axis limited to ±200000.

Permission: `world`.

- `impulse`: Force × time. Divide by entity.mass for a change in velocity.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.apply_impulse(id, {x=0, y=100, z=0})
assert(entity.velocity(id).y > 0)
entity.remove(id)
```

### `entity.mass`

`entity.mass(id) -> number`

Mass in game kilograms.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.mass(id) > 0)
entity.remove(id)
```

### `entity.health`

`entity.health(id) -> number`

Current health. Things without break_speed ignore damage.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.health(id) == 60)
entity.remove(id)
```

### `entity.max_health`

`entity.max_health(id) -> number`

Full health.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.max_health(id) == 60)
entity.remove(id)
```

### `entity.set_health`

`entity.set_health(id, health)`

Sets health, from 1 up to its maximum. Use entity.damage to kill or break it.

Permission: `world`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_health(id, 10)
assert(entity.health(id) == 10)
entity.remove(id)
```

### `entity.damage`

`entity.damage(id, amount, [attacker])`

Damages it the normal way, which can break it or kill it. Source is "other", or "npc" with an attacker.

Permission: `world`.

- `attacker`: The NPC doing it. Its target then reports source "npc" and reacts to it.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.damage(id, 5)
assert(entity.health(id) == 55)
entity.remove(id)
```

### `entity.set_gravity_scale`

`entity.set_gravity_scale(id, scale)`

Gravity multiplier for this object.

Permission: `world`.

- `scale`: -5 to 5. 1 is normal, 0 floats, negative rises.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_gravity_scale(id, 0)
entity.remove(id)
```

### `entity.set_damping`

`entity.set_damping(id, linear, [angular])`

Air resistance for this object. Higher slows it faster.

Permission: `world`.

- `linear`: 0 to 20
- `angular`: 0 to 20

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_damping(id, 2, 2)
entity.remove(id)
```

### `entity.set_anchored`

`entity.set_anchored(id, anchored)`

Fixes a dynamic object in place, or releases it.

Permission: `world`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_anchored(id, true)
assert(entity.is_anchored(id))
entity.remove(id)
```

### `entity.is_anchored`

`entity.is_anchored(id) -> boolean`

True if fixed in place by anchoring.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(not entity.is_anchored(id))
entity.remove(id)
```

### `entity.freeze`

`entity.freeze(id, seconds)`

Freezes a dynamic thing in place, with the ice effect.

Permission: `world`.

- `seconds`: Up to 60.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.freeze(id, 2)
entity.remove(id)
```

### `entity.scale`

`entity.scale(id) -> number`

Size multiplier.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.scale(id) == 1)
entity.remove(id)
```

### `entity.set_scale`

`entity.set_scale(id, scale)`

Resizes it, including its collision shape.

Permission: `world`.

- `scale`: 0.25 to 3

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_scale(id, 2)
assert(entity.scale(id) == 2)
entity.remove(id)
```

### `entity.set_tint`

`entity.set_tint(id, [color])`

Paints it.

Permission: `world`.

- `color`: nil restores the original look.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_tint(id, 0xff8800)
entity.set_tint(id, nil)
entity.remove(id)
```

### `entity.material`

`entity.material(id) -> string`

Its physics material id.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.material(id) == "wood")
entity.remove(id)
```

### `entity.set_material`

`entity.set_material(id, material)`

Changes its friction, bounce, weight and impact sound to those of another material.

Permission: `world`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_material(id, "ice")
assert(entity.material(id) == "ice")
entity.remove(id)
```

### `entity.find_near`

`entity.find_near(position, radius, [filter]) -> list of ids, nearest first`

Entities whose centres are within the radius. Returns at most 256.

Needs a running session.

- `filter`: kind, def or category

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `kind` | "prop" \| "npc" \| "vehicle" |  | Only this kind of entity. |
| `def` | string |  | Only this definition id. |
| `category` | string |  | Only this spawn menu category. |

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
local near = entity.find_near({x=0, y=30, z=0}, 2, {kind="prop"})
assert(table.contains(near, id))
entity.remove(id)
```

### `entity.list`

`entity.list([filter]) -> list of ids`

All live entities, up to 1000.

Needs a running session.

- `filter`: kind, def or category

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `kind` | "prop" \| "npc" \| "vehicle" |  | Only this kind of entity. |
| `def` | string |  | Only this definition id. |
| `category` | string |  | Only this spawn menu category. |

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(table.contains(entity.list({def="crate_wood"}), id))
entity.remove(id)
```

### `entity.set_data`

`entity.set_data(id, key, value)`

Stores a value on this entity. Scripted props and NPCs keep it in saved games.

Permission: `world`.

- `value`: Text, number, boolean, or a table of those. nil deletes.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
entity.set_data(id, "owner", "me")
assert(entity.get_data(id, "owner") == "me")
entity.remove(id)
```

### `entity.get_data`

`entity.get_data(id, key) -> value or nil`

Reads a value set with entity.set_data. Other mods' values are visible too.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(entity.get_data(id, "nothing") == nil)
entity.remove(id)
```

### `entity.set_signal`

`entity.set_signal(id, on)`

Sets the wire output of a scripted prop registered with signal="out" or "both".

Permission: `world`.

```lua
local id = entity.spawn("button", {x=0, y=30, z=0})
entity.set_signal(id, true)
entity.remove(id)
```

## npc

Give orders to NPCs and query them.

### `npc.is_npc`

`npc.is_npc(id) -> boolean`

True if this entity is an NPC.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
assert(npc.is_npc(id))
entity.remove(id)
```

### `npc.state`

`npc.state(id) -> "idle", "patrol", "investigate", "chase", "attack", "flee", "stunned" or "dead"`

What its brain is doing.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
assert(npc.state(id) == "idle")
entity.remove(id)
```

### `npc.order`

`npc.order(id) -> "none", "go_to", "follow", "guard", "patrol", "use" or "tinker"`

What it has been told to do when not fighting.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
npc.follow(id)
assert(npc.order(id) == "follow")
entity.remove(id)
```

### `npc.faction`

`npc.faction(id) -> "lab", "rogue" or "neutral"`

Which side it is on.

```lua
local id = entity.spawn("npc_robot", {x=0, y=30, z=0})
assert(npc.faction(id) == "rogue")
entity.remove(id)
```

### `npc.is_enemy`

`npc.is_enemy(a, b) -> boolean`

True if these two NPCs fight each other on sight: one "lab" and one "rogue".

```lua
local a = entity.spawn("npc_guard", {x=0, y=30, z=0})
local b = entity.spawn("npc_robot", {x=3, y=30, z=0})
assert(npc.is_enemy(a, b))
entity.remove(a)
entity.remove(b)
```

### `npc.enemies_in_sight`

`npc.enemies_in_sight(id) -> list of ids, nearest first`

Living enemy NPCs within its sight range and with a clear line to it. Checks at most the 16 nearest.

```lua
local a = entity.spawn("npc_guard", {x=0, y=30, z=0})
local b = entity.spawn("npc_robot", {x=3, y=30, z=0})
assert(npc.enemies_in_sight(a)[1] == b)
entity.remove(a)
entity.remove(b)
```

### `npc.target`

`npc.target(id) -> an entity id, "player", or nil`

Who it has chosen to fight right now, which it re-decides a few times a second. Only NPCs with an attack ever have one.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
assert(npc.target(id) == nil)
entity.remove(id)
```

### `npc.can_see_target`

`npc.can_see_target(id) -> boolean`

True if it has a target and a clear line to it.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
assert(not npc.can_see_target(id))
entity.remove(id)
```

### `npc.attack`

`npc.attack(id, [target]) -> true if the order was given`

Makes it fight that NPC until it dies or the order is cleared, even outside its usual enemies. It needs an attack. A guard order or a territory still limits how far it goes.

Permission: `world`.

- `target`: Another NPC, of any faction. nil clears it.

```lua
local a = entity.spawn("npc_guard", {x=0, y=30, z=0})
local b = entity.spawn("npc_technician", {x=3, y=30, z=0})
assert(npc.attack(a, b))
assert(not npc.is_enemy(a, b))
npc.attack(a, nil)
entity.remove(a)
entity.remove(b)
```

### `npc.set_territory`

`npc.set_territory(id, [position], [radius])`

A place it stays in whatever its order. It only fights what comes within radius + its attack range of the centre, won't walk out to investigate, and returns if pushed out. Kept in saved games.

Permission: `world`.

- `position`: Centre. nil removes the territory.
- `radius`: Default 10.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
npc.set_territory(id, {x=0, y=0, z=0}, 8)
npc.patrol(id, {{x=-5, y=0, z=0}, {x=5, y=0, z=0}})
npc.set_territory(id, nil)
entity.remove(id)
```

### `npc.set_attack_damage`

`npc.set_attack_damage(id, [damage])`

Damage per attack for this one NPC, for bolt, tracer and slam attacks. Kept in saved games.

Permission: `world`.

- `damage`: Up to 1000. nil goes back to the type's value.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
npc.set_attack_damage(id, 20)
entity.remove(id)
```

### `npc.is_provoked`

`npc.is_provoked(id) -> boolean`

True if the player has hurt it, for hostility="provoked".

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
assert(not npc.is_provoked(id))
entity.remove(id)
```

### `npc.set_provoked`

`npc.set_provoked(id, provoked)`

Makes a hostility="provoked" NPC treat the player as an enemy, or forgive them.

Permission: `world`.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
npc.set_provoked(id, true)
assert(npc.is_provoked(id))
entity.remove(id)
```

### `npc.go_to`

`npc.go_to(id, position)`

Walks there, then stays. Uses the map's navigation grid when it has one.

Permission: `world`.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
npc.go_to(id, {x=3, y=0, z=3})
entity.remove(id)
```

### `npc.follow`

`npc.follow(id, [target], [distance])`

Keeps following until given another order.

Permission: `world`.

- `target`: An entity id. Default: the player.
- `distance`: How close to stay. Default 3.5.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
npc.follow(id, nil, 2)
entity.remove(id)
```

### `npc.guard`

`npc.guard(id, position, [radius])`

Stays near a point and only fights enemies that come near it.

Permission: `world`.

- `radius`: Default 9.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
npc.guard(id, {x=0, y=0, z=0}, 6)
assert(npc.order(id) == "guard")
entity.remove(id)
```

### `npc.patrol`

`npc.patrol(id, route, [loop])`

Walks a route in order, without stopping between points. A point it can't reach is skipped after a couple of seconds.

Permission: `world`.

- `route`: A list of positions.
- `loop`: Default true.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
npc.patrol(id, {{x=0, y=0, z=0}, {x=5, y=0, z=0}})
entity.remove(id)
```

### `npc.use`

`npc.use(id, target)`

Walks to something and uses it, as if pressing E: buttons, levers, doors. Gives a light prop a shove instead.

Permission: `world`.

- `target`: What to go and use.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
local b = entity.spawn("button", {x=4, y=30, z=0})
npc.use(id, b)
assert(npc.order(id) == "use")
entity.remove(id)
entity.remove(b)
```

### `npc.tinker`

`npc.tinker(id, [radius])`

Wanders over to nearby objects and fiddles with them, indefinitely.

Permission: `world`.

- `radius`: Default 14.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
npc.tinker(id, 10)
entity.remove(id)
```

### `npc.stop`

`npc.stop(id)`

Clears its order, so it goes back to wandering.

Permission: `world`.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
npc.follow(id)
npc.stop(id)
assert(npc.order(id) == "none")
entity.remove(id)
```

### `npc.say`

`npc.say(id, text)`

Shows a line of dialogue with its name.

Permission: `world`.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
npc.say(id, "Hello!")
entity.remove(id)
```

### `npc.stun`

`npc.stun(id, seconds)`

Stops it acting for a while.

Permission: `world`.

- `seconds`: Up to 30.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
npc.stun(id, 1)
entity.remove(id)
```

### `npc.alert`

`npc.alert(id, position)`

Sends a fighter to investigate a place, whatever its hearing range.

Permission: `world`.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
npc.alert(id, {x=1, y=0, z=1})
entity.remove(id)
```

### `npc.scare`

`npc.scare(id, from, [seconds])`

Makes it run away from a point.

Permission: `world`.

- `seconds`: Default 3.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
npc.scare(id, {x=0, y=30, z=2})
entity.remove(id)
```

### `npc.all`

`npc.all() -> list of ids`

Every NPC that is alive.

Needs a running session.

```lua
local id = entity.spawn("npc_technician", {x=0, y=30, z=0})
assert(table.contains(npc.all(), id))
entity.remove(id)
```

## vehicle

Vehicles.

### `vehicle.is_vehicle`

`vehicle.is_vehicle(id) -> boolean`

True if this entity can be driven.

```lua
local id = entity.spawn("buggy", {x=0, y=30, z=0})
assert(vehicle.is_vehicle(id))
entity.remove(id)
```

### `vehicle.speed`

`vehicle.speed(id) -> number`

Speed in m/s.

```lua
local id = entity.spawn("buggy", {x=0, y=30, z=0})
assert(vehicle.speed(id) == 0)
entity.remove(id)
```

### `vehicle.is_driven`

`vehicle.is_driven(id) -> boolean`

True if the player is driving this one.

```lua
local id = entity.spawn("buggy", {x=0, y=30, z=0})
assert(not vehicle.is_driven(id))
entity.remove(id)
```

### `vehicle.enter`

`vehicle.enter(id) -> true if the player got in`

Puts the player in the driver's seat.

Permission: `player`.

```lua
local id = entity.spawn("buggy", {x=0, y=30, z=0})
assert(vehicle.enter(id))
vehicle.exit()
entity.remove(id)
```

### `vehicle.exit`

`vehicle.exit()`

Takes the player out of any vehicle.

Permission: `player`. Needs a running session.

```lua
vehicle.exit()
```

## player

The player.

### `player.position`

`player.position() -> position`

The centre of the player's body.

Needs a running session.

```lua
assert(player.position().y ~= nil)
```

### `player.feet`

`player.feet() -> position`

The soles of the player's feet.

Needs a running session.

```lua
assert(player.feet().y < player.position().y)
```

### `player.eye`

`player.eye() -> position`

Where the camera is, when on foot.

Needs a running session.

```lua
assert(player.eye().y > player.position().y)
```

### `player.look_dir`

`player.look_dir() -> unit vector`

The direction the player faces.

Needs a running session.

```lua
local d = player.look_dir()
assert(math.abs(vec.length(d) - 1) < 0.01)
```

### `player.velocity`

`player.velocity() -> vector`

Velocity in m/s.

Needs a running session.

```lua
assert(player.velocity().x ~= nil)
```

### `player.health`

`player.health() -> number`

Current health.

Needs a running session.

```lua
assert(player.health() > 0)
```

### `player.max_health`

`player.max_health() -> number`

Full health.

Needs a running session.

```lua
assert(player.max_health() >= player.health())
```

### `player.set_health`

`player.set_health(health)`

Sets health, from 1 up to full. Use player.damage to hurt the player.

Permission: `player`. Needs a running session.

```lua
player.set_health(50)
assert(player.health() == 50)
player.set_health(100)
```

### `player.damage`

`player.damage(amount)`

Hurts the player the normal way, which can kill. Respects the session's damage rule.

Permission: `player`. Needs a running session.

```lua
player.damage(1)
player.set_health(100)
```

### `player.teleport`

`player.teleport(position, [yaw])`

Moves the player's body centre there instantly.

Permission: `player`. Needs a running session.

- `yaw`: Direction to face, in radians.

```lua
local p = player.position()
player.teleport({x=p.x, y=p.y, z=p.z}, 0)
```

### `player.launch`

`player.launch(velocity)`

Throws the player. Each axis is limited to ±100.

Permission: `player`. Needs a running session.

```lua
player.launch({x=0, y=2, z=0})
assert(not player.is_grounded())
```

### `player.respawn`

`player.respawn()`

Back to the map's spawn point, at full health.

Permission: `player`. Needs a running session.

```lua
player.respawn()
```

### `player.is_dead`

`player.is_dead() -> boolean`

True while waiting to respawn.

Needs a running session.

```lua
assert(player.is_dead() == false)
```

### `player.is_flying`

`player.is_flying() -> boolean`

True in flight mode.

Needs a running session.

```lua
assert(player.is_flying() == false)
```

### `player.is_driving`

`player.is_driving() -> boolean`

True in a vehicle.

Needs a running session.

```lua
assert(player.is_driving() == false)
```

### `player.is_grounded`

`player.is_grounded() -> boolean`

True when standing on something.

Needs a running session.

```lua
log.info("grounded:", player.is_grounded())
```

### `player.tool`

`player.tool() -> string`

Id of the selected tool, such as "blaster" or "my_mod:hammer".

Needs a running session.

```lua
assert(type(player.tool()) == "string")
```

### `player.select_tool`

`player.select_tool(id) -> true if selected`

Switches the selected tool.

Permission: `player`. Needs a running session.

- `id`: A tool id. A name without ":" looks in this mod first.

```lua
assert(player.select_tool("blaster"))
assert(player.tool() == "blaster")
player.select_tool("manipulator")
```

## physics

Queries against the physical world.

### `physics.raycast`

`physics.raycast(origin, direction, range) -> {point, normal, distance, entity} or nil`

The first solid thing along a line. entity is an id, or nil for the map.

Needs a running session.

- `direction`: Normalised for you.
- `range`: Up to 500.

```lua
local r = physics.raycast({x=0, y=50, z=0}, {x=0, y=-1, z=0}, 500)
if r then log.info(r.distance, r.entity) end
```

### `physics.aim`

`physics.aim([range]) -> {point, normal, distance, entity} or nil`

What is under the crosshair. This is the usual way for a tool to pick its target.

Needs a running session.

- `range`: Default 100.

```lua
local r = physics.aim(50)
if r and r.entity then log.info(entity.def(r.entity)) end
```

### `physics.overlap_sphere`

`physics.overlap_sphere(position, radius) -> list of ids`

Entities whose collision shapes touch a sphere. More exact than entity.find_near, which only checks centres.

Needs a running session.

- `radius`: Up to 50.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
log.info(#physics.overlap_sphere({x=0, y=30, z=0}, 2))
entity.remove(id)
```

## vec

Helpers for positions, which are tables like `{x=0, y=1, z=0}`.

### `vec.new`

`vec.new(x, y, z) -> position`

Makes a position.

```lua
assert(vec.new(1, 2, 3).y == 2)
```

### `vec.add`

`vec.add(a, b) -> position`

a + b.

```lua
assert(vec.add({x=1, y=0, z=0}, {x=1, y=1, z=0}).x == 2)
```

### `vec.sub`

`vec.sub(a, b) -> position`

a - b.

```lua
assert(vec.sub({x=1, y=0, z=0}, {x=1, y=1, z=0}).y == -1)
```

### `vec.scale`

`vec.scale(v, s) -> position`

v × s.

```lua
assert(vec.scale({x=1, y=2, z=3}, 2).z == 6)
```

### `vec.length`

`vec.length(v) -> number`

Length.

```lua
assert(vec.length({x=3, y=4, z=0}) == 5)
```

### `vec.dist`

`vec.dist(a, b) -> number`

Distance between two points.

```lua
assert(vec.dist({x=0, y=0, z=0}, {x=0, y=2, z=0}) == 2)
```

### `vec.normalize`

`vec.normalize(v) -> position`

Same direction with length 1, or zero for a zero vector.

```lua
assert(vec.normalize({x=0, y=9, z=0}).y == 1)
```

### `vec.dot`

`vec.dot(a, b) -> number`

Dot product.

```lua
assert(vec.dot({x=1, y=0, z=0}, {x=0, y=1, z=0}) == 0)
```

### `vec.cross`

`vec.cross(a, b) -> position`

Cross product.

```lua
assert(vec.cross({x=1, y=0, z=0}, {x=0, y=1, z=0}).z == 1)
```

## fx

Visual effects. They are visual only and push nothing.

### `fx.burst`

`fx.burst(position, count, color, [speed], [size], [life])`

Sparks flying out from a point.

Permission: `effects`. Needs a running session.

- `count`: Up to 200.
- `speed`: Default 6.
- `size`: Default 0.1.
- `life`: Seconds. Default 0.5.

```lua
fx.burst({x=0, y=2, z=0}, 20, 0xffb000, 5)
```

### `fx.puff`

`fx.puff(position, count, color, [size], [life])`

A soft rising cloud.

Permission: `effects`. Needs a running session.

- `count`: Up to 60.
- `size`: Default 0.5.
- `life`: Seconds. Default 1.

```lua
fx.puff({x=0, y=2, z=0}, 5, 0x888888)
```

### `fx.beam`

`fx.beam(from, to, color, [width], [life])`

A straight glowing line.

Permission: `effects`. Needs a running session.

- `width`: Default 0.03.
- `life`: Seconds. Default 0.1.

```lua
fx.beam({x=0, y=2, z=0}, {x=3, y=2, z=0}, 0x66d9ff)
```

### `fx.ring`

`fx.ring(position, radius, color)`

An expanding ring.

Permission: `effects`. Needs a running session.

```lua
fx.ring({x=0, y=1, z=0}, 3, 0x19e0c4)
```

### `fx.flash`

`fx.flash(position, color, [brightness])`

A brief light.

Permission: `effects`. Needs a running session.

- `brightness`: Default 40.

```lua
fx.flash({x=0, y=2, z=0}, 0xffffff)
```

### `fx.explosion`

`fx.explosion(position, radius)`

The look of an explosion, with no push or damage. See game.explode for the real one.

Permission: `effects`. Needs a running session.

```lua
fx.explosion({x=0, y=30, z=0}, 3)
```

### `fx.shake`

`fx.shake(amount)`

Shakes the camera.

Permission: `effects`. Needs a running session.

- `amount`: 0 to 2.

```lua
fx.shake(0.3)
```

## sound

Sound effects.

### `sound.play`

`sound.play(name, [volume], [position])`

Plays a sound.

Permission: `effects`.

- `name`: See sound.names().
- `volume`: 0 to 1. Default 1.
- `position`: Makes it come from a place in the world.

```lua
sound.play("spring", 0.5)
```

### `sound.names`

`sound.names() -> list of names`

Built-in sounds and this mod's own.

```lua
assert(table.contains(sound.names(), "explode"))
```

## ui

Messages, panels and menus.

### `ui.toast`

`ui.toast(text, [kind])`

A brief message on screen.

Permission: `ui`.

- `text`: Text or {en=, ru=}.
- `kind`: "info", "success", "warn" or "error".

```lua
ui.toast("Crate delivered", "success")
```

### `ui.show_panel`

`ui.show_panel(def)`

A text panel in the corner of the HUD, until hidden. A mod can show up to 4. Removed when the mod unloads, and at the end of the session.

Permission: `ui`.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Your name for this panel. Showing the same id again updates it. |
| `title` | text or {en=, ru=} |  | Heading. |
| `lines` | list of text |  | Text lines, up to 12. |

```lua
ui.show_panel{ id = "score", title = "Score", lines = {"Crates: 3"} }
ui.hide_panel("score")
```

### `ui.hide_panel`

`ui.hide_panel(id)`

Removes a panel.

Permission: `ui`.

```lua
ui.hide_panel("score")
```

### `ui.open_menu`

`ui.open_menu(def)`

Opens a dialog with buttons and frees the mouse. The world keeps running.

Permission: `ui`. Needs a running session.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title` | text or {en=, ru=} | required | Heading. |
| `text` | text or {en=, ru=} |  | Paragraph under the heading. |
| `buttons` | table | required | List of {label="...", on_click=function() end, close=true}. close=false keeps the menu open. Up to 12. |

```lua
ui.open_menu{
  title = "Reactor",
  text = "Vent the core?",
  buttons = {
    {label = "Vent", on_click = function() log.info("venting") end},
    {label = "Cancel", on_click = function() end},
  },
}
ui.close_menu()
```

### `ui.close_menu`

`ui.close_menu()`

Closes a dialog this mod opened.

Permission: `ui`. Needs a running session.

```lua
ui.close_menu()
```

### `ui.add_button`

`ui.add_button(def) -> button id`

Adds a button to the Mod Menu, which opens with M during play. It stays until the mod unloads.

Permission: `ui`.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `label` | text or {en=, ru=} | required | Button text. |
| `on_click` | function | required | on_click(). |

```lua
local b = ui.add_button{ label = "Say hello", on_click = function() ui.toast("Hello") end }
ui.remove_button(b)
```

### `ui.remove_button`

`ui.remove_button(id)`

Removes a Mod Menu button.

Permission: `ui`.

```lua
ui.remove_button(-1)
```

### `ui.open_panel`

`ui.open_panel(view, on_event)`

Opens a large panel with sections of toggles, sliders, lists, buttons, text boxes and key choosers, and frees the mouse. It's plain data that the game draws. The world keeps running.

Permission: `ui`. Needs a running session.

- `view`: What to show. See ui.update_panel.
- `on_event`: on_event(e), with e.type "control", "nav", "reset" or "chip", e.id and e.value.

```lua
ui.open_panel({ title = "Lab", sections = { { title = "Power", controls = { { type = "toggle", id = "on", label = "On", value = true } } } } }, function(e) log.info(e.type, e.id, e.value) end)
assert(ui.panel_open())
ui.close_panel()
```

### `ui.update_panel`

`ui.update_panel(view)`

Replaces what an open panel shows. Fields being edited keep their place. Limit: 1500 controls.

Permission: `ui`. Needs a running session.

- `view`: title, subtitle, scale, nav (list of {id, label, badge}), active, search ({id, value, placeholder}), chips (list of {id, label}), sections (list of {title, note, controls}), footer (a list of controls), and confirm ({text, yes, no}). A control has a type: text (text, style), toggle, slider (min, max, step, unit), select (options as {value, label}), button (style, disabled), input (placeholder), textarea (rows, readonly, filename), key, or unavailable (reason). Most have id, label, hint and value, and a reset=true adds a reset button.

```lua
ui.open_panel({ title = "Lab" }, function(e) end)
ui.update_panel({ title = "Lab 2" })
ui.close_panel()
```

### `ui.close_panel`

`ui.close_panel()`

Closes this mod's panel.

Permission: `ui`. Needs a running session.

```lua
ui.close_panel()
```

### `ui.panel_open`

`ui.panel_open() -> boolean`

True while this mod's panel is on screen. Esc closes it without telling the mod.

```lua
assert(ui.panel_open() == false)
```

## storage

Data kept between sessions and reloads. Values are text, numbers, booleans and tables of those. The limit is 256 KB per mod.

### `storage.get`

`storage.get(key, [default]) -> value`

Reads a saved value, or the default.

Permission: `storage`.

```lua
local n = storage.get("visits", 0)
storage.set("visits", n + 1)
```

### `storage.set`

`storage.set(key, value)`

Saves a value. nil deletes it. Over the 256 KB limit this is an error and nothing changes.

Permission: `storage`.

```lua
storage.set("best", {score=10, name="me"})
assert(storage.get("best").score == 10)
```

### `storage.delete`

`storage.delete(key)`

Deletes a value.

Permission: `storage`.

```lua
storage.delete("best")
assert(storage.get("best") == nil)
```

### `storage.keys`

`storage.keys() -> list of keys`

All saved keys.

Permission: `storage`.

```lua
storage.set("a", 1)
assert(table.contains(storage.keys(), "a"))
storage.delete("a")
```

## events

Run code when something happens. See the event table at the end of this document.

### `events.on`

`events.on(name, handler) -> handler id`

Subscribes to an event. Handlers stay until events.off or until the mod unloads, across sessions.

- `name`: A built-in event, or a custom one containing ":".
- `handler`: handler(e), where e is a table.

```lua
local h = events.on("entity_damaged", function(e) log.info(e.id, e.amount) end)
events.off(h)
```

### `events.off`

`events.off(id) -> true if it existed`

Unsubscribes.

```lua
assert(events.off(-1) == false)
```

### `events.emit`

`events.emit(name, [data])`

Sends a custom event to every loaded mod, this one included. Runs immediately.

- `name`: Must contain ":", such as "my_mod:wave_started".
- `data`: Text, numbers, booleans or tables of those. Every listener gets its own copy.

```lua
local got = nil
local h = events.on("demo:ping", function(e) got = e.n end)
events.emit("demo:ping", {n=7})
assert(got == 7)
events.off(h)
```

## timer

Run code later. Timers run on game time, so they stop while paused, and they are cancelled when the session ends.

### `timer.after`

`timer.after(seconds, f) -> timer id`

Runs f once, later.

Needs a running session.

```lua
local t = timer.after(1, function() log.info("later") end)
timer.cancel(t)
```

### `timer.every`

`timer.every(seconds, f) -> timer id`

Runs f repeatedly. A mod can hold up to 256 timers.

Needs a running session.

- `seconds`: At least 0.05.

```lua
local n = 0
local t = timer.every(0.5, function() n = n + 1 end)
timer.cancel(t)
```

### `timer.cancel`

`timer.cancel(id) -> true if it existed`

Cancels a timer.

```lua
assert(timer.cancel(-1) == false)
```

## mode

For scripted game modes.

### `mode.finish`

`mode.finish(def) -> true if this mod's mode was running`

Ends a scripted mode with a result screen. It does nothing if another mod's mode is running.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `win` | boolean | required | Won or lost, which sets the colour. |
| `title` | text or {en=, ru=} | required | Heading of the result screen. |
| `detail` | text or {en=, ru=} |  | Text under the heading. |
| `can_continue` | boolean | false | Offers a Keep playing button. |

```lua
mode.finish{ win = true, title = "You did it", detail = "All crates collected." }
```

### `mode.is_mine`

`mode.is_mine() -> boolean`

True if the running mode was registered by this mod.

```lua
assert(type(mode.is_mine()) == "boolean")
```

## sandbox

Temporary overrides for sandbox and test tools. Every one of them is undone when the mod stops, is disabled or faults, and when the session ends, so a mod applies them again from `session_start`. Passing nil to a setter restores the original value.

### `sandbox.set_god`

`sandbox.set_god(on)`

God mode: no damage, full health, and blasts don't throw the player.

Permission: `sandbox`. Needs a running session.

```lua
sandbox.set_god(true)
player.damage(50)
assert(player.health() == player.max_health())
sandbox.set_god(false)
```

### `sandbox.set_player_tuning`

`sandbox.set_player_tuning(tuning)`

Scales how the player moves.

Permission: `sandbox`. Needs a running session.

- `tuning`: Fields to change. A field set to -1 goes back to normal, and a field left out stays as it is.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `speed` | number, -1 to 10 |  | Walking speed multiplier, at least 0.1. |
| `jump` | number, -1 to 25 |  | Jump height multiplier. |
| `gravity` | number, -1 to 5 |  | Multiplier on the gravity the player feels. |
| `fly_speed` | number, -1 to 10 |  | Flight speed multiplier, at least 0.1. |

```lua
sandbox.set_player_tuning{ speed = 2, jump = 4 }
sandbox.set_player_tuning{ speed = -1, jump = -1 }
```

### `sandbox.set_flight`

`sandbox.set_flight(on, [noclip]) -> true if it changed`

Turns flight on or off, whatever the game mode allows. It can't change while driving or dead.

Permission: `sandbox`. Needs a running session.

- `noclip`: true passes through everything. false, the default, stops at walls.

```lua
assert(sandbox.set_flight(true, false))
assert(player.is_flying())
sandbox.set_flight(false)
```

### `sandbox.set_rule_gravity`

`sandbox.set_rule_gravity([g])`

Changes world gravity, keeping the session's real value for saved games.

Permission: `sandbox`. Needs a running session.

- `g`: -20 to 40. nil restores it.

```lua
sandbox.set_rule_gravity(3)
assert(game.gravity() == 3)
sandbox.set_rule_gravity(nil)
assert(game.gravity() == 9.81)
```

### `sandbox.set_rule_damage`

`sandbox.set_rule_damage([enabled])`

Turns player damage on or off, keeping the session's real value for saved games.

Permission: `sandbox`. Needs a running session.

- `enabled`: nil restores it.

```lua
sandbox.set_rule_damage(false)
sandbox.set_rule_damage(nil)
```

### `sandbox.set_rule_aggression`

`sandbox.set_rule_aggression([level])`

How readily NPCs attack, keeping the session's real value for saved games.

Permission: `sandbox`. Needs a running session.

- `level`: "passive", "normal", "high", or nil to restore it.

```lua
sandbox.set_rule_aggression("passive")
sandbox.set_rule_aggression(nil)
```

### `sandbox.set_air_control`

`sandbox.set_air_control([amount])`

How much the player can steer in the air.

Permission: `sandbox`. Needs a running session.

- `amount`: 0 to 5. nil restores it.

```lua
sandbox.set_air_control(2)
sandbox.set_air_control(nil)
```

### `sandbox.set_infinite_energy`

`sandbox.set_infinite_energy(on)`

Keeps every energy bar full.

Permission: `sandbox`. Needs a running session.

```lua
sandbox.set_infinite_energy(true)
sandbox.set_infinite_energy(false)
```

### `sandbox.refill_energy`

`sandbox.refill_energy()`

Fills every tool's energy bar once.

Permission: `sandbox`. Needs a running session.

```lua
sandbox.refill_energy()
```

### `sandbox.set_weapon_tuning`

`sandbox.set_weapon_tuning(tuning)`

Scales the player's weapons.

Permission: `sandbox`. Needs a running session.

- `tuning`: Fields to change. A field left out stays as it is, and 1 is normal.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `damage` | number, 0 to 100 |  | Multiplier on damage the player deals with weapons. |
| `impulse` | number, 0 to 20 |  | Multiplier on how hard the player's shots push. |
| `fire_rate` | number, 0.1 to 10 |  | How quickly weapons cool down and recharge. |

```lua
sandbox.set_weapon_tuning{ damage = 3, fire_rate = 2 }
sandbox.set_weapon_tuning{ damage = 1, fire_rate = 1 }
```

### `sandbox.set_unlock_tools`

`sandbox.set_unlock_tools(on)`

Lets the player use every tool in a mode that limits them.

Permission: `sandbox`. Needs a running session.

```lua
sandbox.set_unlock_tools(true)
sandbox.set_unlock_tools(false)
```

### `sandbox.tools`

`sandbox.tools() -> list of {id, kind, slot, allowed, name}`

Every tool in the hotbar, in order. Reading it needs no permission.

Needs a running session.

```lua
assert(#sandbox.tools() >= 12)
```

### `sandbox.set_time_scale`

`sandbox.set_time_scale([scale])`

Slows or speeds up the simulation, player included. Frames still run at most 5 steps, so it can't run away.

Permission: `sandbox`. Needs a running session.

- `scale`: 0.1 to 3. nil restores normal speed.

```lua
sandbox.set_time_scale(0.5)
sandbox.set_time_scale(nil)
```

### `sandbox.set_world_frozen`

`sandbox.set_world_frozen(on)`

Holds every physics object and NPC still, keeping its motion for when it ends. The player can still move. Debris and shots already fired carry on.

Permission: `sandbox`. Needs a running session.

```lua
sandbox.set_world_frozen(true)
assert(sandbox.world_frozen())
sandbox.set_world_frozen(false)
```

### `sandbox.world_frozen`

`sandbox.world_frozen() -> boolean`

True while the world is held still.

```lua
assert(sandbox.world_frozen() == false)
```

### `sandbox.set_blast_scale`

`sandbox.set_blast_scale([scale])`

Multiplies the push of every explosion and shockwave.

Permission: `sandbox`. Needs a running session.

- `scale`: 0 to 10. nil restores it.

```lua
sandbox.set_blast_scale(2)
sandbox.set_blast_scale(nil)
```

### `sandbox.set_environment`

`sandbox.set_environment([changes])`

Changes the sky, sun, ambient light, fog and time of day.

Permission: `sandbox`. Needs a running session.

- `changes`: Fields to change. A field left out stays as it is. nil puts the map's light back.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sun` | number, 0 to 5 |  | Sunlight multiplier. |
| `ambient` | number, 0 to 5 |  | Ambient light multiplier. |
| `fog` | number, 0 to 30 |  | Fog density multiplier. |
| `preset` | "map" \| "day" \| "dusk" \| "night" \| "cloud" |  | Sky and lighting to use. "map" is the map's own. |
| `hour` | number, -1 to 24 |  | Time of day, which moves the sun and blends the sky. Use -1 to go back to the map's fixed light. |

```lua
sandbox.set_environment{ hour = 21, fog = 3 }
assert(sandbox.environment().hour == 21)
sandbox.set_environment(nil)
```

### `sandbox.environment`

`sandbox.environment() -> {sun, ambient, fog, preset, hour}`

The current changes to the light. preset and hour are nil when unchanged.

```lua
assert(sandbox.environment().sun == 1)
```

### `sandbox.set_overlay`

`sandbox.set_overlay(name, on)`

A debug view drawn in the world: physics colliders, NPC sight and hearing rings, NPC movement, NPC state labels, or a box around highlighted entities.

Permission: `sandbox`. Needs a running session.

- `name`: "colliders", "npc_radius", "npc_direction", "npc_labels", "highlight".

```lua
sandbox.set_overlay("colliders", true)
sandbox.set_overlay("colliders", false)
```

### `sandbox.set_highlight`

`sandbox.set_highlight(ids)`

Which entities the "highlight" overlay marks.

Permission: `sandbox`. Needs a running session.

- `ids`: A list of entity ids. An empty list clears it.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
sandbox.set_highlight({id})
sandbox.set_overlay("highlight", true)
sandbox.set_overlay("highlight", false)
sandbox.set_highlight({})
entity.remove(id)
```

### `sandbox.perf`

`sandbox.perf() -> {fps, frame_ms, physics_ms, entities, bodies, npcs, particles, debris}`

Live performance numbers, as on the F3 panel.

Needs a running session.

```lua
assert(sandbox.perf().bodies > 0)
```

### `sandbox.track_spawn`

`sandbox.track_spawn(id)`

Marks an entity as this mod's, so it's removed when the mod stops.

Permission: `sandbox`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
sandbox.track_spawn(id)
assert(sandbox.is_tracked(id))
entity.remove(id)
```

### `sandbox.is_tracked`

`sandbox.is_tracked(id) -> boolean`

True if a mod marked this entity with sandbox.track_spawn.

```lua
assert(sandbox.is_tracked(-1) == false)
```

### `sandbox.remember_entity`

`sandbox.remember_entity(id)`

Remembers its scale, material, paint, anchoring, gravity scale and damping, to restore with sandbox.restore_entity or when the mod stops. Only the first call counts until it's restored.

Permission: `sandbox`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
sandbox.remember_entity(id)
entity.set_scale(id, 2)
sandbox.restore_entity(id)
assert(entity.scale(id) == 1)
entity.remove(id)
```

### `sandbox.restore_entity`

`sandbox.restore_entity(id) -> true if there was something to restore`

Puts back what sandbox.remember_entity and sandbox.set_mass recorded.

Permission: `sandbox`.

```lua
assert(sandbox.restore_entity(-1) == false)
```

### `sandbox.set_mass`

`sandbox.set_mass(id, kg)`

Changes its mass. sandbox.restore_entity puts it back.

Permission: `sandbox`.

- `kg`: 0.1 to 20000.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
sandbox.set_mass(id, 500)
assert(math.abs(entity.mass(id) - 500) < 1)
sandbox.restore_entity(id)
entity.remove(id)
```

### `sandbox.set_invulnerable`

`sandbox.set_invulnerable(id, on)`

Makes one entity ignore all damage.

Permission: `sandbox`.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
sandbox.set_invulnerable(id, true)
entity.damage(id, 5)
assert(entity.health(id) == 60)
sandbox.set_invulnerable(id, false)
entity.remove(id)
```

### `sandbox.is_invulnerable`

`sandbox.is_invulnerable(id) -> boolean`

True if it ignores damage.

```lua
local id = entity.spawn("crate_wood", {x=0, y=30, z=0})
assert(not sandbox.is_invulnerable(id))
entity.remove(id)
```

### `sandbox.npc_info`

`sandbox.npc_info(id) -> table, or nil if not an NPC`

What an NPC is like and what it's doing: type numbers, stance, faction, state, order, target, and its current multipliers.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
assert(sandbox.npc_info(id).faction == "lab")
entity.remove(id)
```

### `sandbox.npc_set_ai`

`sandbox.npc_set_ai(id, on)`

Stops or resumes an NPC's thinking. It can still be pushed around.

Permission: `sandbox`.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
sandbox.npc_set_ai(id, false)
assert(sandbox.npc_info(id).ai == false)
sandbox.npc_set_ai(id, true)
entity.remove(id)
```

### `sandbox.npc_set_stance`

`sandbox.npc_set_stance(id, [stance])`

Changes which side one NPC is on.

Permission: `sandbox`.

- `stance`: "friendly" joins the lab, "neutral" fights nobody, "hostile" hunts the player and joins the rogues. nil is its type's own. An NPC without an attack can't fight whatever its stance.

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
sandbox.npc_set_stance(id, "hostile")
assert(sandbox.npc_info(id).hostile_to_player)
sandbox.npc_set_stance(id, nil)
entity.remove(id)
```

### `sandbox.npc_set_tuning`

`sandbox.npc_set_tuning(id, tuning)`

Scales one NPC's speed and detection ranges.

Permission: `sandbox`.

- `tuning`: Fields to change. A field left out stays as it is, and 1 is normal.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `speed` | number, 0 to 5 |  | Movement speed multiplier. |
| `sight` | number, 0 to 10 |  | Sight range multiplier. |
| `hearing` | number, 0 to 10 |  | Hearing range multiplier. |

```lua
local id = entity.spawn("npc_guard", {x=0, y=30, z=0})
sandbox.npc_set_tuning(id, { speed = 2, sight = 3 })
assert(sandbox.npc_info(id).speed_scale == 2)
entity.remove(id)
```

### `sandbox.vehicle_info`

`sandbox.vehicle_info(id) -> table, or nil if not a vehicle`

A vehicle's numbers and its current multipliers.

```lua
local id = entity.spawn("buggy", {x=0, y=30, z=0})
assert(sandbox.vehicle_info(id).top_speed > 0)
entity.remove(id)
```

### `sandbox.vehicle_set_tuning`

`sandbox.vehicle_set_tuning(id, tuning)`

Scales one vehicle's engine, top speed and grip.

Permission: `sandbox`.

- `tuning`: Fields to change. A field left out stays as it is, and 1 is normal.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `engine` | number, 0.1 to 10 |  | Engine force multiplier, which is its acceleration. |
| `top_speed` | number, 0.1 to 10 |  | Top speed multiplier. |
| `grip` | number, 0.1 to 10 |  | Tyre grip multiplier. |

```lua
local id = entity.spawn("buggy", {x=0, y=30, z=0})
sandbox.vehicle_set_tuning(id, { engine = 2 })
assert(sandbox.vehicle_info(id).engine_scale == 2)
entity.remove(id)
```

### `sandbox.vehicle_upright`

`sandbox.vehicle_upright(id)`

Lifts a vehicle and sets it back on its wheels, as R does when driving.

Permission: `sandbox`.

```lua
local id = entity.spawn("buggy", {x=0, y=30, z=0})
sandbox.vehicle_upright(id)
entity.remove(id)
```

### `sandbox.active`

`sandbox.active() -> list of strings`

Names of the overrides this mod has in place.

```lua
sandbox.set_god(true)
assert(table.contains(sandbox.active(), "player:god"))
sandbox.set_god(false)
```

### `sandbox.revert_all`

`sandbox.revert_all([remove_spawned])`

Undoes every override this mod has in place, as if it had stopped.

Permission: `sandbox`.

- `remove_spawned`: Also removes what sandbox.track_spawn marked. Default false.

```lua
sandbox.set_god(true)
sandbox.revert_all()
assert(#sandbox.active() == 0)
```

## input

Keys a mod can bind. The game's own keys and the browser's F5, F11 and F12 can't be taken.

### `input.bind`

`input.bind(code, f) -> binding id`

Runs f when the key is pressed during play. An unknown or reserved key is an error. Ends when the mod unloads.

Permission: `ui`.

- `code`: A key code such as "F6" or "KeyO".

```lua
local b = input.bind("F9", function() log.info("pressed") end)
assert(input.unbind(b))
```

### `input.unbind`

`input.unbind(id) -> true if it existed`

Removes a binding.

Permission: `ui`.

```lua
assert(input.unbind(-1) == false)
```

## json

Convert plain data to and from JSON text.

### `json.encode`

`json.encode(value) -> text`

Turns plain data into JSON text.

- `value`: Text, numbers, booleans and tables of those.

```lua
assert(json.encode({a=1}) == "{\"a\":1}")
```

### `json.decode`

`json.decode(text) -> value, or nil if it isn't valid JSON`

Reads JSON text into plain data.

- `text`: At most 256 KB.

```lua
assert(json.decode("{\"a\":1}").a == 1)
assert(json.decode("not json") == nil)
```

## Events

Subscribe with `events.on(name, function(e) ... end)`. `e` is a table with these fields.

| Event | Fields of `e` | When |
| --- | --- | --- |
| `tick` | dt | Every physics step, 60 times a second. Keep it short, or use timer.every. |
| `session_start` | map, mode | A world has been built and play is starting. Also fires after a restart. |
| `session_end` | (none) | The world is about to be torn down. Timers are cancelled and panels removed. |
| `entity_spawned` | id, def | An entity appeared during play. Map props placed while a session starts don't fire this. |
| `entity_removed` | id, def | An entity is gone, for any reason. Its id is already invalid. |
| `entity_damaged` | id, def, amount, source, attacker | source is "player", "npc", "impact", "explosion" or "other". attacker is the entity responsible, if an entity was, and is absent otherwise. |
| `entity_broken` | id, def | A breakable prop's health reached zero, just before removal. |
| `entity_used` | id, def | The player pressed E on it. |
| `npc_killed` | id, def, by_player | An NPC died. Its id still works during the handler. by_player is also true for an explosion with no entity behind it, such as a barrel. |
| `player_damaged` | amount, source, attacker | The player took damage. attacker is the entity responsible, if an entity was. source is "npc", "explosion", "impact", "fall", "blast", "player", "other", or "mod:<id>" from player.damage. |
| `player_died` | (none) | The player died. |
| `explosion` | position, radius | An explosion happened, from any cause. |
| `tool_selected` | id | The player switched tools. |

Custom events have names containing `:`, are sent with `events.emit`, and reach every loaded mod.

## Model parts

A `model` or `view_parts` field is a list of primitive parts, each a table with these fields.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `shape` | "box" \| "rbox" \| "sphere" \| "cylinder" \| "cone" \| "torus" | required | The primitive. rbox is a box with rounded edges. |
| `size` | {x, y, z} numbers |  | box and rbox: width, height, depth. |
| `r` | number, 0.001 to 24 |  | Radius of a sphere, cylinder, cone or torus. |
| `h` | number, 0.001 to 24 |  | Height of a cylinder or cone. |
| `r_top` | number, 0.001 to 24 |  | Top radius of a cylinder, when it differs from r. |
| `tube` | number, 0.001 to 12 |  | Tube radius of a torus. |
| `pos` | {x, y, z} numbers | {0, 0, 0} | Position relative to the object centre. |
| `rot` | {x, y, z} numbers | {0, 0, 0} | Rotation in radians. |
| `color` | colour (0xRRGGBB or "#rrggbb") |  | Colour, when no material is given. |
| `material` | "steel" \| "steel_dark" \| "blackened" \| "rubber" \| "wood" \| "crate" \| "hazard" \| "concrete" \| "wall_dark" \| "wall_light" \| "floor_tile" \| "ice" \| "screen" \| "paint_white" \| "paint_amber" \| "paint_coral" \| "paint_teal" \| "glow_amber" \| "glow_coral" \| "glow_teal" \| "glow_violet" \| "glow_white" |  | A library material. Takes priority over color. |
| `texture` | string |  | Image from the manifest's assets, wrapped around this part. |
| `attach` | "root" \| "torso" \| "head" \| "arm_l" \| "arm_r" \| "leg_l" \| "leg_r" | "root" | NPC models only: which joint it moves with. |

## Standard library

### Basics

| Function | Meaning |
| --- | --- |
| `type(v) -> string` | Name of the type: "nil", "boolean", "number", "string", "table" or "function". |
| `tostring(v) -> string` | Text form of any value. Tables are shown a few levels deep. |
| `tonumber(v) -> number or nil` | Converts a string to a number. Returns nil if it cannot. |
| `pairs(t) -> iterator` | Every key and value of t, in insertion order, for use with for ... in. The loop sees a snapshot. |
| `ipairs(t) -> iterator` | Index and value for 1, 2, 3... up to the first nil, for use with for ... in. |
| `error(message)` | Raises an error. Stops the current callback unless caught by pcall. |
| `assert(v, message) -> v` | Raises an error if v is nil or false, otherwise returns v. |
| `pcall(f, arg1, arg2...) -> {ok, value, error}` | Calls f and catches script errors. The result has ok=true and value, or ok=false and error. Budget and memory limits cannot be caught. |
| `print(a, b...)` | Same as log.info. |

### math

| Function | Meaning |
| --- | --- |
| `math.floor(x)` | Rounds down. |
| `math.ceil(x)` | Rounds up. |
| `math.round(x)` | Rounds to the nearest integer. |
| `math.abs(x)` | Absolute value. |
| `math.sqrt(x)` | Square root. |
| `math.sin(x)` | Sine, in radians. |
| `math.cos(x)` | Cosine, in radians. |
| `math.atan2(y, x)` | Angle of a vector, in radians. |
| `math.min(a, b)` | The smaller of two numbers. |
| `math.max(a, b)` | The larger of two numbers. |
| `math.clamp(x, lo, hi)` | Limits x to the range lo to hi. |
| `math.lerp(a, b, t)` | Blends from a to b by t. |
| `math.random(lo, hi)` | With no arguments, a float from 0 up to 1. With two, a whole number from lo to hi inclusive. |

Constants: `math.pi`, `math.huge`.

### string

| Function | Meaning |
| --- | --- |
| `string.len(s)` | Number of characters. Same as #s. |
| `string.upper(s)` | Upper case. |
| `string.lower(s)` | Lower case. |
| `string.trim(s)` | Removes whitespace at both ends. |
| `string.sub(s, from, to)` | Part of a string, 1-based and inclusive. Negative positions count from the end. |
| `string.find(s, text, from)` | Position of plain text, or nil. There are no patterns. |
| `string.starts_with(s, prefix)` | True if s begins with prefix. |
| `string.ends_with(s, suffix)` | True if s ends with suffix. |
| `string.replace(s, from, to)` | Replaces every occurrence of plain text. |
| `string.rep(s, n)` | Repeats s n times. |
| `string.split(s, sep)` | Splits into a list on plain text. |
| `string.format(fmt, a, b...)` | Fills %s (any value), %d (whole number), %f or %.2f (decimal) and %% (a percent sign). |

### table

| Function | Meaning |
| --- | --- |
| `table.insert(t, value) or table.insert(t, pos, value)` | Adds to the end, or at a position, moving later items up. |
| `table.remove(t, pos) -> value` | Removes and returns the item at a position, or the last item, moving later items down. |
| `table.concat(t, sep)` | Joins a list of strings and numbers. |
| `table.sort(t, less)` | Sorts a list in place. less(a, b) is optional and returns true if a comes first. |
| `table.keys(t)` | A list of the keys. |
| `table.values(t)` | A list of the values. |
| `table.contains(t, v)` | True if v is one of the values. |
| `table.copy(t)` | A shallow copy. |
| `table.count(t)` | Number of keys of any kind. #t only counts the list part. |
