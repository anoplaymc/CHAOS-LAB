# Mod development workflow

The standard process for turning a request into a working mod. The person asking doesn't need to know ChaosScript, so don't ask them to write or read it.

On NixOS, run commands as `nix-shell --run '<command>'`.

## From request to report

1. **Understand the request.** What should the player see and be able to do? Choose sensible defaults for details that were left open, and mention them in your report.
2. **List the game abilities it needs.** For example: a new NPC type, a patrol, noticing enemies, reacting to an explosion, a setting the player can change.
3. **Find the API for each one.** Use `npm run mod -- api <word>` and [CHAOSSCRIPT_API.md](CHAOSSCRIPT_API.md). Look at [MODDING_EXAMPLES.md](MODDING_EXAMPLES.md) for code that already works.
4. **Check that the API is enough.** If something is missing, stop and see [Extending the engine](#extending-the-engine). Never fake it, for example with a toast saying something happened when it didn't.
5. **Create the structure.** `npm run mod -- new <id> [template]`.
6. **Write the ChaosScript.** Read *Differences from Lua* in [CHAOSSCRIPT_LANGUAGE.md](CHAOSSCRIPT_LANGUAGE.md) first.
7. **Write the manifest.** `new` leaves placeholders, so set the name, description and author, and list exactly the permissions used. See [MOD_MANIFEST_SPEC.md](MOD_MANIFEST_SPEC.md).
8. **Check it.** `npm run mod -- validate <id>`.
9. **Fix the errors**, from the top, and check again. [MODDING_TROUBLESHOOTING.md](MODDING_TROUBLESHOOTING.md) explains each message.
10. **Run the tests.** `npm run mod -- test <id> 10`. This shows nothing crashes. For behaviour that matters, also write a test against the real game, as in [AI_MODDING_GUIDE.md](AI_MODDING_GUIDE.md), that checks the thing actually happens. To check a test can fail, break the mod briefly and see that it does.
11. **Install it or prepare it for installing.** A mod in `mods/<id>/` is part of the game at the next `npm run dev` or `npm run build`. `npm run mod -- pack <id>` makes a file to share. Confirm with `npm run mod -- info <id>`.
12. **Report what was really checked.** Say which commands passed and what behaviour was tested. Name what wasn't, such as how it looks, feels and sounds, which only a person playing can judge.

## Extending the engine

If the API can't do it:

1. Name the missing ability exactly, and why existing functions can't produce it.
2. If you weren't asked to change the engine, tell the person what extension is needed, and offer what the mod can do without it.
3. If you are extending it, add one entry to `src/modding/api/`. Give it a permission if it changes anything, and validate its arguments. Scripts only ever receive plain values and entity ids.
4. Follow the checklist below.

Never give a mod file, network, system command or JavaScript access, and never weaken a limit in [CHAOSSCRIPT_LANGUAGE.md](CHAOSSCRIPT_LANGUAGE.md), for convenience.

## Keeping the docs true

Whenever you change ChaosScript, the Mod API, the NPC API, physics or the item system:

- [ ] New or changed function: edit its entry in `src/modding/api/`, including a self-contained `example`, then run `npm run mod -- docs`.
- [ ] New language feature or changed limit: update [CHAOSSCRIPT_LANGUAGE.md](CHAOSSCRIPT_LANGUAGE.md).
- [ ] New NPC behaviour, personality, or built-in prop behaviour: update [NPC_CREATION.md](NPC_CREATION.md) or [ENTITY_CREATION.md](ENTITY_CREATION.md).
- [ ] New command: update `USAGE` and `COMMANDS` in `src/modding/cli.ts`, [AI_MODDING_GUIDE.md](AI_MODDING_GUIDE.md) and the skill.
- [ ] Add an example to `mods/examples/` if it's a new kind of ability, and list it in [MODDING_EXAMPLES.md](MODDING_EXAMPLES.md).
- [ ] Add a test of the behaviour in `src/tests/`.
- [ ] Update `.claude/skills/chaosscript-developer/SKILL.md` if the process changed.
- [ ] Run `npx vitest run`, then `npm run mod -- docs --check`.

What tests catch by themselves: a stale API reference, an API example or documented `lua` block that fails, a mention of a function that doesn't exist, a broken link, a command in the docs that doesn't exist, and an example mod that stops working. What they don't catch: prose that describes behaviour wrongly. That part is on you.
