---
name: chaosscript-developer
description: Creates, changes, tests and debugs CHAOS LAB game mods in ChaosScript. Use for requests such as "create a ChaosScript mod", "add a new NPC mod", "create a weapon mod", "make a vehicle mod", "debug a ChaosScript script", "extend an existing mod", "create a new game mechanic using mods", or the same in other languages ("создай мод", "добавь NPC", "сделай оружие"), and for anything involving .chaos files or the mods/ folder. The user doesn't need to know ChaosScript.
---

# ChaosScript developer

Game logic in a mod is written in ChaosScript, through the Mod API. Never use JavaScript or TypeScript for it: those are for the engine, editor, loader, API and tools.

On NixOS, run commands as `nix-shell --run '<command>'`.

## Reading the docs

Read these first, in this order. Don't write code from memory of Lua.

1. `docs/MODDING_WORKFLOW.md`: the process to follow.
2. `docs/AI_MODDING_GUIDE.md`: the technical steps and rules.
3. `docs/CHAOSSCRIPT_LANGUAGE.md`: especially *Differences from Lua*.
4. `docs/MODDING_EXAMPLES.md`: find working code for what you need, and read it.

## Using the API

Don't guess a name. Everything that exists is listed by the tool:

```sh
npm run mod -- api                # everything
npm run mod -- api patrol         # search by word
npm run mod -- api register.npc   # fields and a tested example
```

`docs/CHAOSSCRIPT_API.md` is the full reference, generated from the code. For how-tos, see `docs/ENTITY_CREATION.md`, `docs/NPC_CREATION.md`, `docs/TOOL_CREATION.md`, `docs/WEAPON_CREATION.md` and `docs/VEHICLE_CREATION.md`.

## Creating and checking a mod

```sh
npm run mod -- new my_mod npc     # templates: starter prop npc tool weapon vehicle mode
npm run mod -- validate my_mod    # structure, manifest, syntax, API use, permissions, real load
npm run mod -- test my_mod 10     # uses everything it registers, reloads it, runs the world
npm run mod -- info my_mod        # what it declares, whether it loads, what it registers
```

Write only under `mods/<id>/`. Problems print as `file:line: message`. Fix them from the top, using `docs/MODDING_TROUBLESHOOTING.md`, and repeat until both commands exit with 0.

`test` shows nothing crashes, not that the mod does what was asked. When behaviour matters, also write a test against the real game: `docs/AI_MODDING_GUIDE.md` has a template.

## Sandbox and permissions

- List exactly the permissions the mod uses in `mod.json`. A permission error means add it, if the mod really needs it.
- Never try to get around a limit or the sandbox. A mod has no file, network, system or JavaScript access, and that won't change for convenience.
- If the API can't do what's needed, don't fake it. Follow *Extending the engine* in `docs/MODDING_WORKFLOW.md`.

## When changing the engine or API

Follow *Keeping the docs true* in `docs/MODDING_WORKFLOW.md`.

## Reporting

Say what you ran and what passed, which behaviour was actually tested, and what only a person playing can judge. Don't claim something works because it compiled.
