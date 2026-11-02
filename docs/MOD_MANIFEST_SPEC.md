# Mod manifest

Every mod has a `mod.json` at the top of its folder.

```json
{
  "id": "my_mod",
  "name": "My Mod",
  "description": "What it adds, in a sentence or two.",
  "version": "1.2.0",
  "author": "You",
  "api_version": "1.0",
  "dependencies": [
    "furniture_pack",
    { "id": "robot_pack", "version": "^1.0.0" },
    { "id": "vehicle_pack", "version": ">=1.0.0 <2.0.0", "optional": true }
  ],
  "conflicts": ["some_other_mod"],
  "permissions": ["content", "world", "effects", "ui", "storage"],
  "scripts": ["helpers.chaos", "main.chaos"],
  "assets": ["assets/poster.png"],
  "hot_reload": true,
  "enabled_by_default": true
}
```

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Unique id: a lowercase letter, then lowercase letters, digits or `_`, 2 to 48 characters. It prefixes everything the mod registers. |
| `name` | Yes | Display name, up to 80 characters. |
| `version` | Yes | `major.minor.patch`, such as `1.2.0`. |
| `api_version` | Yes | The API version it was written for, such as `"1.0"`. This game provides 1.0. A mod loads if the major number is equal and its minor number isn't higher than the game's. |
| `scripts` | Yes | `.chaos` files to run, in order. At least one. Paths are relative and stay inside the mod. |
| `author` | No | A warning if missing. |
| `description` | No | Up to 600 characters. A warning if missing. |
| `dependencies` | No | Mods needed first. See below. |
| `conflicts` | No | Mods this one can't run with. |
| `permissions` | No | What it may do. See below. Default: nothing beyond the always-allowed functions. |
| `assets` | No | `.png`, `.jpg` or `.webp` images, up to about 1.5 MB each. |
| `hot_reload` | No | Default `true`. With `false` it can only be reloaded from the main menu, not during a session. |
| `enabled_by_default` | No | Default `true`. Whether it starts enabled when first found. |

An unknown field is a warning, with a suggestion if it looks like a typo.

## Dependencies

Each entry is an id, or an object with `id`, `version` and `optional`. Version ranges:

| Range | Matches |
| --- | --- |
| `*` | Anything. The default |
| `1.2.3` | Exactly that |
| `^1.2.3` | 1.2.3 or above, same major |
| `~1.2.3` | 1.2.3 or above, same major and minor |
| `>=1.0.0 <2.0.0` | All terms must match. `>`, `>=`, `<` and `<=` are available |

Dependencies load first, whatever order mods were installed in. If one is missing, disabled, the wrong version or fails to load, the mod shows as **Blocked** with the reason, unless it's `optional`. Cycles are reported as blocked too. Reloading a mod also reloads the mods that depend on it.

An optional dependency affects load order if present. Check with `mod.is_loaded("id")`.

## Conflicts

If two enabled mods conflict, declared by either side, the one whose id sorts first runs and the other is **Blocked**. Registered ids can't clash, because each mod has its own namespace.

If two sources provide the same mod id, the later one wins: installed copies over the development folder, which is over the bundled copy.

## Permissions

| Permission | Allows |
| --- | --- |
| `content` | `register.*` |
| `world` | Spawn, remove and change entities, NPC orders, explosions |
| `player` | Change the player's health, position, velocity and selected tool, and vehicle entry |
| `effects` | `fx.*`, `sound.play` |
| `ui` | `ui.*` |
| `storage` | `storage.*` |
| `rules` | `game.set_gravity`, `game.set_damage`, `game.set_aggression` |

Reading the world, `log`, `events`, `timer`, `vec` and `physics` queries are always allowed. [CHAOSSCRIPT_API.md](CHAOSSCRIPT_API.md) gives the permission of each function.

## States in the mod manager

| State | Meaning |
| --- | --- |
| Running | Loaded and working |
| Disabled | Turned off |
| Invalid | The manifest or scripts have errors, so nothing ran |
| Blocked | A dependency or conflict stops it. The reason is shown |
| Failed to load | A script raised an error while loading. Everything it registered was removed |
| Stopped after errors | It kept failing while running, so its scripts no longer run. Reload to try again |

## Bundles

`npm run mod -- pack` writes `dist-mods/<id>.chaosmod.json`, up to 8 MB: a JSON object with `format` (`"chaosmod-1"`), `manifest` (the text of `mod.json`), `files` (script text by path) and `assets` (data URLs by path). A future workshop would deliver this same format.
