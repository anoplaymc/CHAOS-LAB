# Content packs

This page covers JSON content packs, the older data-only format, which still works. For script mods, which can do much more, see [docs/MODDING_GUIDE.md](docs/MODDING_GUIDE.md).

Content packs are JSON files imported from the in-game **Workshop**. The Workshop's *Install sample pack* button installs a working example.

**Packs are data only.** Nothing in a pack is ever executed. Every value is checked and copied into a new object, so unknown fields are dropped, and a `script`, `scripts`, `code`, `main` or `js` field makes the import fail. A failed import changes nothing.

## Manifest

```json
{
  "id": "my-pack",
  "name": "My Pack",
  "version": "1.0.0",
  "author": "You",
  "description": "Optional.",
  "dependencies": ["another-pack"],
  "materials": [],
  "entities": [],
  "maps": []
}
```

`id` uses lowercase letters, digits, `_` and `-`. All ids inside a pack are namespaced automatically: an entity `ball` in `my-pack` becomes `my-pack:ball`. Duplicate ids and missing dependencies are errors.

## Materials

```json
{ "id": "jelly", "name": { "en": "Jelly", "ru": "Желе" }, "friction": 0.3, "restitution": 1, "density": 30, "sound": "gel", "fragility": 0 }
```

| Field | Range |
| --- | --- |
| `friction` | 0 to 2 |
| `restitution` | 0 to 1.2 |
| `density` | 1 to 5000, in game-scale kg per cubic metre |
| `sound` | `wood`, `metal`, `rubber`, `stone`, `glass`, `ice`, `gel` |
| `fragility` | 0 to 5, optional; 0 is unbreakable |

## Entities

```json
{
  "id": "tall_crate",
  "name": { "en": "Tall Crate", "ru": "Высокий ящик" },
  "desc": "Text or a translated object.",
  "category": "props",
  "shape": { "type": "box", "size": [0.8, 2.4, 0.8] },
  "material": "wood",
  "color": 16711680,
  "visual": "crate",
  "body": "dynamic",
  "breakSpeed": 8,
  "health": 60,
  "debris": "wood",
  "behavior": "explosive",
  "params": { "radius": 4, "impulse": 500, "damage": 30 }
}
```

- `shape.type`: `box` or `wedge` with `size`; `sphere` with `r`; `cylinder` or `capsule` with `r` and `h`. Dimensions run 0.05 to 12.
- `category`: `props`, `physics`, `construction`, `mechanical`, `effects` or `decorations`.
- `material`: a built-in id (`rubber`, `metal`, `wood`, `concrete`, `ice`, `gel`, `heavy`, `glass`) or one from this pack.
- `body`: `dynamic` or `fixed`. Signal behaviours are always `fixed`.
- `visual`: a built-in model name, otherwise a mesh is generated from the shape using `color`.
- `breakSpeed`: velocity change in m/s that damages it. Omit for unbreakable.
- `behavior`: `explosive`, `button`, `lever`, `plate`, `timer`, `inverter`, `lamp`, `fan`, `spring_pad` or `emitter`.

## Maps

```json
{
  "id": "arena",
  "name": { "en": "Arena", "ru": "Арена" },
  "spawn": [0, 0, 8],
  "blocks": [{ "pos": [0, -0.5, 0], "size": [30, 1, 30], "material": "concrete" }],
  "props": [{ "id": "crate_wood", "pos": [2, 0.52, 0] }]
}
```

Limits: 2000 blocks and 400 props. `spawn` is where the player's feet start, so make sure there is a block under it.

## Current limits

- `assets` are recorded but not loaded: a pack can't bring its own models, textures or sounds yet.
- No NPC or vehicle definitions, and no navigation on pack maps. Script mods have these.
- There is no online sharing: packs are local files.
- Packs can't run code. Script mods can, in a sandbox.
