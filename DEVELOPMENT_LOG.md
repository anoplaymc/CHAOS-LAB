# CHAOS LAB development log

## Checkpoint 1: integrated and verified core (2026-11-01)

Verified in Firefox 157 (Playwright's build) with real mouse and keyboard events and real pointer lock, rendering
through Mesa llvmpipe (software GL) in Xvfb. No GPU was used, so frame rates here say nothing about real hardware.

### Verified working
- TypeScript strict compile and production build. Production bundle runs with 0 console errors.
- Main menu, pause menu (Esc through real pointer lock), resume, restart, quit.
- 3D scene, shadows, materials, signage in the Test Facility.
- Mouse look, WASD, sprint, jump, crouch, flight, respawn; walls, slopes, ramp and stairs.
- Spawn menu; props fall, collide, stack and sleep.
- Physics Manipulator: grab, hold without oscillation, throw, mass limit, cannot pull through walls.
- Removal tool and all six weapons, with their distinct effects.
- Breakable props, debris budget and expiry, explosive chain reaction.
- All five NPC archetypes, AI states, line-of-sight, navigation, damage and death; guards fight rogue robots.
- Buggy: enter, drive, steer, brake, reverse, reset, exit.
- Signals: plate to motor and door, typed ports, loop rejection. Weld and rope links.
- Entity limits, blocked placement refusal, restart without leaks.

### Real bugs found by this testing
- Applying impulses inside a Rapier query callback poisoned the world permanently (first explosion killed the game).
  `PhysicsWorld.overlap` now collects first and visits after the query.
- Velocity clipping compared requested to actual movement, so slopes read as blocked and speed collapsed.
  Now uses the controller's contact normals.
- Nav grid was built before the first physics step: queries saw nothing, zero walkable cells, NPCs walked straight
  lines while tests still passed. Tests now assert the grid and paths.
- Doorway unwalkable in nav (rays started inside the wall above it).
- Ramp blocked by a barrier; stairs built facing the wrong way.
- Sun target leaked one scene object per restart. Opaque black explosion smoke. Robot went idle rather than
  searching when its target left sight range.

### Known warnings
- Firefox logs "lazy initialization" warnings from three.js' PMREM generator. Harmless, performance-only.

## Checkpoint 2: the remaining systems (2026-11-01)

Added on top of the verified core: save and load, undo, Construction, Spawner, Inspector and Paint tools, two more maps
plus the challenge hall, four modes and the map editor, the Workshop, full menus, spawn menu with thumbnails, Russian.

### Test results, all executed on this date
| Layer | Result |
| --- | --- |
| `npm run build` (strict tsc + Vite) | Passes |
| `npm run test` (real Rapier, no browser) | 146 passed, 1 skipped (the opt-in benchmark). Repeated 3 times with the same result |
| `npm run test:e2e` (Firefox 157, llvmpipe) | 9 passed |
| Real input, real pointer lock (Firefox 157, Xvfb, scratch script) | 17 of 17 checks |
| System drive, real input (scratch script) | All pass except one scenario, below |
| System Firefox 158.0.1 on the real NVIDIA GPU, headless, driven through geckodriver | Loads and runs with no runtime errors |

### Frame rate on the real GPU (system Firefox, reported as "GeForce GTX 980, or similar")
| Scene | FPS |
| --- | --- |
| Test Facility, default settings | 60 |
| Test Facility with 300 more steel crates falling | 58 |
| Gravity Playground | 60 |
| Industrial Yard | 60 |
| Industrial Yard with 24 robots and heavies fighting | 58.7 |
| Test Facility, Quality High | 60 |

Software rendering (llvmpipe, low settings) gives about 13 FPS, and the low-frame-rate banner appears. That is accurate.

### Physics cost per frame (Node, awake messy pile; `BENCH=1 npx vitest run src/tests/bench.test.ts`)
| Steel crates | While piling up, average / worst | Settled |
| --- | --- | --- |
| 100 | 0.8 / 12 ms | 0.1 ms |
| 400 | 2.4 / 10 ms | 0.2 ms |
| 800 | 5.1 / 19 ms | 0.35 ms |
| 1500 | 9.6 / 28 ms | 0.7 ms |

800 awake crates is about where worst-case frames pass the 16.7 ms budget. The default limit is 400 entities, adjustable to 800.
This measures physics only, and 1500 was not tried with rendering on the GPU.

### Real bugs found in this round
- The Move tool could teleport a challenge payload straight to the goal. Payloads are now locked.
- The Power Up door was narrower than its doorway, so the puzzle could be skipped.
- Going Up could not be solved as designed: the crate jammed on the lift's lip. The lift now sits in a recessed bay.
- Gravity Playground stepping stones were too high to reach, and low gravity didn't raise jumps. Both fixed and proved by a bot
  that climbs to the summit using only movement.
- Sliding doors dragged anyone touching them, because Rapier's controller carries characters on kinematic bodies. My own
  platform carry was also doubling up with this, which made riders slip.
- Jump and gel footstep sounds were effectively silent. Found by measuring rendered output offline.

### Not verified
- Nobody has played it by hand, so game feel, difficulty and how the sounds actually sound are unjudged.
- Real pointer lock was only exercised under Xvfb, not in a desktop session on the real GPU. The GPU runs were headless.
- `S reverses` in the scratch system drive still fails when the buggy has already spun into something and has no room. The unit
  test covers reversing in open space and passes, so this looks like the scenario, not the car.
- Only Firefox was tested today. Chromium and WebKit have not been run since the toolchain was set up.

### Known warnings
Firefox logs harmless "lazy initialization" warnings from three.js' environment-map generator.

### Next concrete tasks
See TODO.md.

## Checkpoint 3: bug fixes and production verification (2026-11-02)

No new features. Earlier browser checks ran against the dev server, so this round drove the real `dist` bundle: Firefox 157,
llvmpipe in Xvfb, xdotool input through the X server, real pointer lock. `?inspect` exposes the game to the test driver for
reading only and doesn't switch to the virtual pointer lock that `?automation` uses.

### Results
| Layer | Result |
| --- | --- |
| `npm run build` | Passes |
| `npm run test` | 157 passed, 1 skipped (the opt-in benchmark) |
| `npm run test:e2e` (dev server, automation mode) | 9 passed |
| Real input on `dist`: movement, ramp, stairs, explosions, grabbing, flight, pause, 30 restarts, 6 quit and play cycles (scratch script) | 38 of 38 |
| Real input on `dist`: spawn menu, NPCs, death, buggy, maps and modes (scratch script) | 27 of 27 |
| Same drive at default graphics, subset: restart effects, wall clipping, spawn menu, buggy, Industrial Yard | 11 of 11 |

Scene, geometry, texture and body counts were identical after 30 restarts.

### Real bugs found and fixed
- The Test Facility floor had two pits. The south wall's opening was wider than the door frame, leaving alcoves at x = 3.5 to 7 on
  both sides of the door with no floor. Walking in dropped the player out of the world. This was the rare soak test failure.
  A new flood-fill test walks every reachable cell of the map.
- A fireball stayed frozen on screen after a restart. `ParticleSystem.clear` never told the GPU, and `update` skips an empty system.
  Points of size 0 also still draw one pixel, so cleared particles are now transparent too.
- Tools poked through walls the player stood against. The view model is now half the size at half the distance, which looks the same.
  Effects still start from where the muzzle appears.
- Getting out of a buggy parked against a wall put the player on the roof. Exit now tries each side and refuses one behind a wall.

### Test problems fixed, not game bugs
- The restart census failed in 20 to 50% of runs when a pooled mesh was added. Bolts, the likely source, are capped at 40 and now counted separately.
  This wasn't proven directly, but the failure didn't return in 3 full test runs (or 6 earlier ones with the same change).
- The previous session's "quit threw" and the failures after it came from its click helper ignoring Xvfb's 1.034 pixel ratio, which
  placed clicks about 19 px too high. Quit works.

### Checked from the earlier notes
Already fixed in the code, and confirmed in play: the explosion that locked the physics world, the sun target leak, the rising stairs,
the ramp approach beside the NPC barrier, and the oversized view model.

### Known warnings
- "WebGL context was lost" when the spawn menu opens is deliberate: `Thumbnails` releases its own small context. The game's context isn't affected.
- The three.js "lazy initialization" warnings described above.

### Not verified
- Still nobody has played it by hand on a real GPU with real pointer lock. Game feel and sound remain unjudged.
- Software rendering runs at about 13 FPS, so timing-sensitive feel can't be judged from these runs.
- Chromium and WebKit were not run.

## Checkpoint 4: restart and explosion verification (2026-11-02)

No new features. The numbers under Checkpoint 3 are superseded by these.

### Do explosion effects survive a restart?
Yes before the fix: a genuine game bug, not a test artifact. Restoring the old `ParticleSystem.clear` at runtime brings the frozen
fireball back (41,122 changed pixels at low settings, 102,338 at default). With the current code nothing fire-shaped remains.

Total changed pixels can't detect the 1-pixel speck variant, because the counts overlap with noise: camera height shifts by a
sub-pixel amount between restarts, which redraws door edges in clean restarts too. Sorting pixels outside the clean-restart regions by
shape does separate them: current code shows at most 1 isolated dot, the speck bug 17 to 90. This measure was chosen after seeing the
data and ran on saved images, so treat it as analysis. The in-page check that dead particles are transparent is the regression guard.

### More bugs found and fixed
- Turning flight off near a ceiling put the player on the roof (7 of 24 drops). `unstuck` only searched upward. It now takes the nearest
  fit, searching at most 1.5 m down, which can't reach under a floor.
- Debris geometry grew across restarts (140 to 165 over 60 cycles) because every chip size stayed in the shared cache. Chips now scale one
  shared box.

### Harness faults, not game bugs
- `lands`: a fixed 1.5 s wait was shorter than some falls. All 24 of 24 repeated drops landed, at times matching free fall.
- Gravity Playground "stale smoke": its `fx_smoke` fixture is emitting new particles.

### Results on the final bundle
| Check | Result |
| --- | --- |
| `npx tsc --noEmit`, `npm run build` | Pass |
| `npx vitest run`, 5 runs | 160 passed, 1 skipped, every run |
| `npx playwright test` | 9 passed |
| Movement and interaction drive, 3 runs | 38 of 38, every run |
| Spawn menu, NPCs, buggy, maps and modes drive, 3 runs | 27 of 27, every run |
| Restart and explosion soak, low settings, 60 cycles | Counts identical after warm-up, 14.3 FPS start and end |
| Same soak at default graphics, 25 cycles | Counts identical after warm-up, 9.4 to 9.1 FPS |
| 12 restarts under fire on each of 4 other sessions | Clean |

Three in four soak cycles create their mess by script (spawning and `explode`). Every fourth uses a real blaster shot. Pause, restart and
quit always use real input.

## Checkpoint 5: restart outlier and landing probes (2026-11-02)

No new features. The results under Checkpoint 4 are superseded by the runs recorded here.

### The 904-pixel restart outlier
Not left over from explosions. It was z-fighting in the Test Facility doorway, also seen in clean restarts:
- The hazard frame's inner faces shared a plane with the ends of the spawn room walls, for 15 cm.
- The doorway floor shared a plane with the chamber floor for 50 cm and the spawn room floor for 50 cm.

The frame now stands 2 cm proud of the walls, which narrows the doorway from 6 m to 5.96 m. The floors meet edge to edge at z = 20 and z = 21.

40 clean and 40 post-explosion restarts, 3 runs on `dist`, low settings, compared with the first clean shot:
| Bundle | Worst changed pixels, clean / post-explosion | Door-edge strips, of 80 shots |
| --- | --- | --- |
| Before | 1271 / 2258 | Left 15, right 5, in 15 shots |
| Frame fixed and first floor overlap removed | 1376 / 1376 | 0 |
| Final | 108 / 108 | 0 |

The remaining differences are specks of a few pixels, with the same pattern in both groups. On the before bundle, the higher strip counts
after explosions were not significant (right 4 vs 1 of 40, p = 0.36; left 9 vs 6 of 40, p = 0.57). Why a given shot flips was not established:
identical camera positions gave both results, which is what z-fighting's numerical sensitivity allows but doesn't prove. Removing the overlaps
did remove the strips.

### The three unexpected landing heights
Not a bug. In all three runs the player touched down on a drum (`barrel`, radius 0.38 m, top at 1.10 m). Feet rest 0.03 m above a surface, so a flat
landing reads 1.13 m, and the capsule's rounded base reads lower when it catches the rim: 1.08 m at 0.57 m from the axis, as the geometry predicts.
Horizontal speed from flight then carried the player off the drum to the floor (0.03 m) within about 0.5 s. A fourth run on the final bundle did the
same, landing at 1.10 m.

### Results on the final bundle
| Check | Result |
| --- | --- |
| `npx tsc --noEmit`, `npm run build` | Pass |
| `npx vitest run`, 3 runs | 160 passed, 1 skipped, every run |
| `npx playwright test` | 9 passed |
| Movement and interaction drive | 38 of 38 |
| Spawn menu, NPCs, buggy, maps and modes drive | 27 of 27 |

`npx playwright test` needs an X display even in `nix-shell`: with `DISPLAY` unset all 9 tests fail because Firefox can't create a WebGL context.


## Checkpoint 6: ChaosScript and the modding platform (2026-11-02)

Design: `docs/MODDING_ARCHITECTURE.md`. Added the ChaosScript language, the mod API, loader, in-game manager and console, a CLI toolkit, five example mods, an NPC framework, more core content, and documentation.

### Results on the final bundle
| Check | Result |
| --- | --- |
| `npx tsc --noEmit`, `npm run build` | Pass |
| `npx vitest run` | 275 passed, 1 skipped. 3 earlier runs of 273 also passed, before the database upgrade fix and its 2 tests |
| `npx playwright test` (dev server, automation mode) | 16 passed |
| Real input on `dist`: movement, ramp, stairs, explosions, 30 restarts, quit (scratch script) | 38 of 38. Counts identical after restarts |
| Real input on `dist`: spawn menu, NPCs, buggy, maps and modes (scratch script) | 27 of 27 |
| Real input on `dist`: mods menu, mod prop, NPC, tool, weapon, M, console, reload, Chaos Hour (scratch script) | 20 of 20 |
| All 7 templates through `npm run mod -- test` | Pass |

Tests also run every API example and every `lua` block in `docs/` as real mods against a real game.

### Real bugs found by this testing
- A scripted mode's `on_start` ran before the session counted as started, so it couldn't touch the world. `on_end` had the same problem.
- A guard's leash ignored attack range, so a stationary turret never fired at anything.
- A mod's handlers missed events it sent while still loading.
- A blocked mod could be reported as invalid, from a stale error.
- The enable checkboxes, including the Workshop's, bounced until an async save finished.
- `string.replace` and `table.concat` built oversized strings before checking the limit.
- Super Tools used `return a, b`, which the language forbids. The loader caught it, so the rule stands and the mod changed.
- The hotbar ran into the control hints once there were more than 12 tools. Extra slots are now narrow.
- Furniture faced away from the player when placed.
- Raising the database version for mod storage could hang a new tab at startup while an old tab stayed open. It now falls back to memory for that session.

### Not verified
- Nobody has played it by hand, so how mods look, feel and sound is unjudged.
- A cold AI agent has not actually built a mod from the docs. Docs are checked for accuracy, not sufficiency.
- Isolation is language-level on the main thread, and tests attack it from scripts. It has had no independent security review.
- Long play sessions with many mods, and frame rate on a real GPU with mods loaded.
- Chromium and WebKit.

## Checkpoint 7: AI mod development system (2026-11-02)

No game features removed. Added `CLAUDE.md`, a mandatory mod rule in `AGENTS.md`, the `chaosscript-developer` skill, `docs/MODDING_WORKFLOW.md`, `docs/MODDING_EXAMPLES.md`, `docs/README.md`, `mods/examples/`, `src/modding/quality.ts`, and `info` and `api` commands. `validate` now loads from the main menu state, as the game does. It used to load inside a session, which passed mods that fail at real startup.

### Cold tests
Two new Claude sessions got only the Security Robots request, with no names, commands or mention of the docs. Each was independently re-verified afterwards.

| Run | Outcome | What it exposed |
| --- | --- | --- |
| 1 | Loaded, 19 behaviour tests of its own. Hostile detection only through workarounds. Archived, not kept | No API for faction, target, territory or per-NPC damage. Stuck detection fooled by jitter. NPC orders and data missing from saves. Wrong or missing docs |
| 2, after fixing those | Loaded, 18 behaviour tests of its own, using the new API from the docs. Kept as `mods/security_robots` | Rogue-only targets. Orders lost on hot reload. One test failing about 1 run in 6, which the agent saw once and couldn't name |

Independent re-runs named that flake: a real race in the mod, where an enemy killed before the robot's next look was never counted. Fixed, with a deterministic test. Run 2 was not repeated after the additions it prompted (`npc.attack`, `attacker`, state kept on reload).

### Found only by real input
A Mod Menu button that opens a dialog closed it again immediately, so no such settings menu could open with M. Unit tests and both agents had called the handlers directly. Fixed, with a browser test.

### Final results
See the session report: all suites passed on the final code. One real-input check, E on the Repair Bot, failed once before the dialog fix and then passed 3 of 3 with no related change. Its cause wasn't established.

### Not verified
- The cold agents worked with this log, the test suite and engine source available, and read engine source when docs weren't enough. Neither wrote anything in `src/` except a test.
- Security Robots hasn't been played by hand. Real E and M presses are covered by a scratch drive, which isn't in the repo's test suite.
