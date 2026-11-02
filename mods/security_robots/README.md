# Security Robots

Adds the **Guard Robot** (Робот-охранник), a robot that looks after a piece of the map for you. Find it in the spawn menu under NPCs.

## What it does

**Patrols a territory.** Where you place a robot becomes the centre of its territory, a circle. It walks a route of six points inside that circle, pulled in from any walls. It won't leave to chase or investigate, and comes back if pushed out.

To choose a different place, stand there and either press **E** on a robot and pick *Set territory here*, or use *All territories to my position* in the settings to move every robot. *Show territory* draws its route for a few seconds, and a ring out to the radius.

**Spots hostile NPCs.** Four times a second, it looks for enemies with a clear line of sight within 26 metres. An enemy within its reach (territory radius + 18 metres of weapon range) raises the alarm once. The robot says what it saw, and other robots in radio range come over. The robot shoots with a tracer until the enemy is destroyed. An enemy further away than its reach is left alone.

**Reacts to events.**

| Event | What happens |
| --- | --- |
| An explosion | Robots in radio range that can reach it go to look |
| An NPC hurts the player | Robots in radio range that can reach the player go to them, unless robots are the ones shooting |
| A robot is hit by an NPC or an explosion | It raises the alarm and others come to help |
| A robot is destroyed, not by you | The alarm is raised where it fell |
| The player dies | Robots forgive the player, if the player had provoked them |
| You shoot a robot | It shoots back, if that setting is on |

The alarm ends 8 seconds after the last hostile was in sight.

## Settings

Open the Mod Menu with **M** and press *Security Robots settings*. Settings are kept between sessions, and changes apply at once to the robots already placed.

| Setting | Choices | Default |
| --- | --- | --- |
| Territory radius | 6, 10, 15 or 20 m | 10 m |
| Radio range: how far from an event robots respond | 15, 30 or 60 m | 30 m |
| Damage per shot | 4, 8 or 14 | 8 |
| React to explosions | on, off | on |
| Defend the player | on, off | on |
| Shoot back at the player | on, off | on |
| Voice messages: its lines and the all-clear message | on, off | on |
| Status panel: robots, status and hostiles destroyed | on, off | on |

*Reset to defaults* puts them all back. Changing the radius rebuilds every robot's route.

## Limits

- **Who counts as hostile:** any NPC of the `rogue` faction, which covers the Rogue Robot, Heavy Training Bot, Scout Bot and rogue NPCs from other mods. Any other NPC counts once it has hurt the player, if "defend player" is on. An NPC of another faction that hurts only other NPCs isn't noticed.
- **A territory is a circle.** The game has no other shape.
- **More than 70 metres from the player,** a robot stops walking its patrol until the player returns, as all NPCs do. It still fights.
- **Maps with several floors:** navigation is a single layer, so robots don't use stairs.
- **All robots share one radius.** The centre is per robot, and is kept in saved games.

## For other mods

```text
events.on("security_robots:alarm", function(e) ... end)      -- e.reason, e.position, e.responders
events.on("security_robots:all_clear", function(e) ... end)  -- e.neutralized
```

`e.reason` is `explosion`, `player_attacked`, `under_fire`, `robot_down`, or `hostile_<id>`.

The full id of the robot is `security_robots:guard_bot`, for `entity.spawn`.

## Files

| File | Contents |
| --- | --- |
| `mod.json` | The manifest. Permissions: `content`, `world`, `effects`, `ui`, `storage` |
| `main.chaos` | All of the mod's logic |

Behaviour tests are in `src/tests/securityrobots.test.ts`, because the loader ignores anything but scripts and assets in a mod folder and these need the real game: `npx vitest run src/tests/securityrobots.test.ts`.
