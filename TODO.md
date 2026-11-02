# TODO

## Critical bugs
None known.

## Needs a human
These can't be judged by automated tests:
- Game feel: mouse sensitivity, movement, buggy handling, weapon punch.
- Whether the sounds are pleasant. Levels and non-silence are measured, but nobody has listened to them.
- Difficulty balance in Survival. Bots hit hard: one robot took a player from 100 to 28 health in about 9 seconds.
- Real pointer lock on your own desktop session (verified only under Xvfb).
- How the new furniture, robots, vehicles and tools look, feel and handle. Vehicle tuning is checked only for driving at all.

## Planned
- Better NPC models and animation, including ragdolls on death.
- More challenges, and a saved best time or star record per challenge.
- A preview of the part in the Construction HUD.
- Visible connection points for parts that should attach predictably.
- More buildable parts and Workshop support for custom models.
- Multi-level navigation, so NPCs can use stairs and upper floors. Right now the grid is one layer.
- Navigation on the Gravity Playground and pack maps: NPCs there walk directly and avoid ledges.
- Online mod workshop. Only the bundle format and the `ModSource` seam exist.
- Run mods in a Worker, for a real process-level boundary. They run on the main thread, with language-level isolation.
- Custom model and sound files in mods. Mods can use image textures, primitive parts and synthesised sounds only.
- Script hooks on vehicles.
- Territories other than circles, and NPC targeting of the player or of non-NPC entities through `npc.attack`.
- Moving NPC and vehicle physics into the map editor's preview.

## Optional
- Frozen and gravity-flipped states in saves (currently saved as ordinary objects).
- Lever states on map fixtures in saves.
- Code-split the 5 MB bundle (most of it is the embedded physics WASM).
- Gamepad support.
