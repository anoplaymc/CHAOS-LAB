# Creating NPCs

`register.npc` adds a type of character, and its spawn menu entry. Field reference: [register.npc](CHAOSSCRIPT_API.md#registernpc).

An NPC has three layers:

1. **Numbers** decide how it perceives and moves: speeds, sight, hearing, health.
2. **The brain** picks a state: idle, patrol, investigate, chase, attack, flee, stunned or dead. You don't write this.
3. **Orders and hooks** are yours. An order says what to do when not fighting. Hooks run your code.

## A complete NPC

```lua
register.npc{
  id = "warden",
  name = {en = "Warden", ru = "Смотритель"},
  desc = "Guards one spot and tells you about it.",
  height = 1.9,
  model = {
    base = "guard",
    color = 0x7a2a2a,
    accent = 0x201010,
    parts = {
      {shape = "cone", r = 0.2, h = 0.3, pos = {0, 0.35, 0}, color = 0xffb000, attach = "head"},
    },
  },
  material = "rubber",
  health = 150,
  walk_speed = 1.8,
  run_speed = 4,
  sight = 22,
  hearing = 16,
  attack = "tracer",
  attack_range = 16,
  attack_cooldown = 0.9,
  attack_damage = 8,
  faction = "lab",
  hostility = "provoked",
  behavior = "guard",
  guard_radius = 8,
  personality = "brave",
  lines = {"Move along.", {en = "Nothing to see here.", ru = "Тут не на что смотреть."}},
  on_death = function(self, by_player)
    fx.explosion(entity.position(self), 2)
  end,
}
```

## Appearance

`model.base` is one of `technician`, `guard`, `robot`, `heavy`, `creature` or `humanoid`. `robot`, `heavy`, `creature` and `humanoid` take `color`, and all but `creature` take `accent` where they use it. `height` scales the model and collision capsule together. `parts` add primitives, and `attach` makes one move with `head`, `torso`, `arm_l`, `arm_r`, `leg_l` or `leg_r`.

## Fighting

| `attack` | Does |
| --- | --- |
| `none` | Never fights. It won't chase anything |
| `tracer` | Instant shot at `attack_range` |
| `bolt` | A slow energy bolt that can be dodged |
| `slam` | A shockwave around itself. Use a short range |
| `script` | Calls `on_attack(self, target_position, target_entity)` every `attack_cooldown` |

`faction`: `lab` and `rogue` fight on sight. `neutral` fights neither. `hostility` decides the player: `never`, `provoked` (after the player hurts it) or `always`.

## Behaviour profiles

`behavior` is what it does when not fighting:

| `behavior` | Does |
| --- | --- |
| `wander` | Walks to random nearby places. The default |
| `stand` | Stays at its spawn point |
| `patrol` | Walks the map's `patrols` routes, or wanders if there are none |
| `follow` | Follows the player at `follow_distance` |
| `guard` | Stays within `guard_radius` of its spawn. It fights what comes within `guard_radius + attack_range`, and ignores anything further |
| `tinker` | Walks over to nearby objects and uses them: presses buttons, shoves light props |

## Orders at runtime

Orders replace the behaviour until changed. Each takes the NPC's entity id.

```lua
events.on("session_start", function(e)
  local a = entity.spawn("npc_technician", {x = -3, y = 1, z = 26})
  local b = entity.spawn("npc_guard", {x = 3, y = 1, z = 26})
  local lever = entity.spawn("lever", {x = 0, y = 0.3, z = 24})
  if not (a and b and lever) then return end

  npc.go_to(a, {x = 0, y = 0, z = 30})
  npc.use(a, lever)                       -- walks over and pulls it, then the order ends
  npc.patrol(b, {{x = -4, y = 0, z = 28}, {x = 4, y = 0, z = 28}})
  npc.follow(a)                           -- the player, by default
  npc.guard(b, {x = 0, y = 0, z = 25}, 6)
  npc.tinker(a, 10)
  npc.stop(a)                             -- back to wandering
  log.info(npc.state(a), npc.order(a))
end)
```

There's also `npc.say`, `npc.stun`, `npc.alert` (go and look at a place), `npc.scare` (run from a place) and `npc.all`.

Fighting takes priority over orders: a guard that sees an enemy chases it, then goes back to its order.

## Territory

`npc.guard` keeps an NPC near one point. To have it do something else in an area, such as patrol, give it a territory as well. It holds whatever the order is: the NPC only fights what comes within `radius + attack_range` of the centre, won't walk out to investigate noise or a lost target, and returns if pushed out. `npc.alert` is an explicit instruction and still goes anywhere.

```lua
register.npc{
  id = "yard_guard",
  name = "Yard Guard",
  model = {base = "guard"},
  faction = "lab",
  attack = "tracer",
  on_spawn = function(self)
    local p = entity.position(self)
    npc.set_territory(self, p, 12)
    npc.patrol(self, {
      {x = p.x - 8, y = p.y, z = p.z},
      {x = p.x + 8, y = p.y, z = p.z},
    })
  end,
}
```

## Noticing enemies

The brain finds and fights enemies by itself. To know about it, ask from `on_think`:

```lua
register.npc{
  id = "lookout",
  name = "Lookout",
  model = {base = "robot"},
  faction = "lab",
  attack = "bolt",
  on_think = function(self, dt)
    local seen = npc.enemies_in_sight(self)      -- lab against rogue, sight range, clear line
    if seen[1] then log.info("I see", entity.def(seen[1])) end
    local t = npc.target(self)                   -- an id, "player" or nil
    if t and t ~= "player" then log.info("fighting", t, npc.can_see_target(self)) end
  end,
}
```

To fight something outside the usual factions, such as an NPC that hurt the player, use `npc.attack`. `entity_damaged` and `player_damaged` say who did it through `attacker`, and `on_damage` receives it as a fourth argument.

`npc.faction` and `npc.is_enemy` answer questions about any NPC. Numbers can vary per NPC with `npc.set_attack_damage`, and `npc.set_provoked` makes one angry at the player, or forgive them.

## Far from the player

To save time, an NPC more than 70 metres from the player stops steering unless it's chasing or attacking, and thinks once a second. A patrol there pauses until the player comes back. `on_think` keeps running.

## Saved games

Saved with each NPC: its order, territory, attack damage override, provoked state and `entity.set_data` values. Reloading a mod keeps all of these too, because it recreates objects the same way. `on_spawn` runs again after loading and after a reload, so set up only what's missing: check `entity.get_data` first if your `on_spawn` shouldn't overwrite a loaded order.

## Personalities

`personality` is a preset applied once when the type is registered, on top of your numbers.

| Personality | Effect |
| --- | --- |
| `brave` | Never flees. Goes to look at explosions |
| `cowardly` | Flees when hurt and from anything fast. Faster running, shorter memory |
| `curious` | Hears and sees further. Goes to look at explosions |
| `lazy` | Slower, with poorer senses. Ignores explosions |
| `hyper` | Much faster, and attacks more often |
| `relentless` | Long memory, better sight, never flees, ignores explosions |

## Responding to events

`on_explosion` sets the reaction directly: `ignore`, `investigate` or `flee`. For anything else, use a hook or an event:

```lua
register.npc{
  id = "watchman",
  name = "Watchman",
  model = {base = "humanoid", color = 0x445566},
  faction = "lab",
  attack = "tracer",
  on_think = function(self, dt)
    -- Runs 4 times a second while alive. Keep it short.
    if player.health() < 30 and vec.dist(entity.position(self), player.position()) < 20 then
      npc.follow(self)
    end
  end,
  on_damage = function(self, amount, source)
    if source == "player" then npc.say(self, "Hey!") end
  end,
  on_interact = function(self)
    npc.say(self, "All quiet.")
    return true
  end,
  prompt = "E  Talk",
}

events.on("explosion", function(e)
  for _, id in ipairs(entity.find_near(e.position, 15, {def = "watchman"})) do
    npc.alert(id, e.position)
  end
end)
```

`on_interact` returning `false` falls through to `lines`.

## A scripted attack

```lua
register.npc{
  id = "lobber",
  name = "Lobber",
  model = {base = "robot", color = 0x88aa33},
  faction = "rogue",
  hostility = "always",
  attack = "script",
  attack_range = 14,
  attack_cooldown = 2,
  on_attack = function(self, target, target_entity)
    local from = vec.add(entity.position(self), {x = 0, y = 1.2, z = 0})
    local id = entity.spawn("barrel_explosive", from, {velocity = vec.scale(vec.normalize(vec.sub(target, from)), 12)})
    if id then entity.damage(id, 1) end
  end,
}
```

## Navigation

On maps with a navigation grid (the Test Facility and Industrial Yard, and mod maps unless `nav = false`), NPCs path around walls. An NPC that makes no progress for about a second and a half gives up on a patrol point and moves on. The grid is a single layer, so they don't use stairs or upper floors. Without a grid they walk straight and stop at ledges.

## Limits

The session has an NPC limit, 32 by default. `entity.spawn` returns `nil` above it.

See the Robot Pack in [EXAMPLE_MODS.md](EXAMPLE_MODS.md) for working examples.
