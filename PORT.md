# Port: Unreal Engine with Angelscript

The game moves from Babylon.js + Colyseus to Unreal Engine 5.8 on Hazelight's Angelscript fork
(`github.com/Hazelight/UnrealEngine-Angelscript`, branch `angelscript-master`), for its rendering,
networking and tools, and for script that reloads while the game runs. Nothing more is added to
the web game until the port has caught up with it; it stays in the repo as the reference until then.

Started 15 November 2026.

## Where things live

```
F:\Dev\Unreal\UnrealEngine-Angelscript\   the engine, built from source (not in this repo)
main/unreal/                               the Unreal project, StoreRaid.uproject
  Script/                                  Angelscript: nearly all of the game, reloaded on save
  Source/StoreRaid/                        C++: only what script can't do (prediction, dev server)
  Content/                                 made by import scripts from ../../assets, never in git
  Tools/                                   the dev pipeline: launch, reload, bots, screenshots
```

- **Script first.** Gameplay, levels, generation, rules, UI: Angelscript in `Script/`. C++ only for
  what needs it: extending `UCharacterMovementComponent`'s saved moves (stamina, ladders, pace), the
  dev command server, and anything hot in a profile.
- **Content is generated, as assets are now.** Models (`.glb` through Interchange), surface textures
  and sounds come from the shared `assets/` folder by an editor Python script, and materials are made
  by script too, so `Content/` can be thrown away and rebuilt. Levels are made at runtime from a
  seed, as now, so the project needs almost no hand-made maps.

## The dev pipeline (the reason for the port)

What `pnpm run dev` and Chrome do now, in Unreal, all headless and driven from the terminal:

1. **A dedicated server, headless:** `UnrealEditor-Cmd.exe StoreRaid.uproject -server -nullrhi -as-development-mode`.
   The editor binary runs uncooked, so starting it takes seconds, not a cook.
2. **Script reloads in place:** with `-as-development-mode`, a thread in each process watches
   `Script/` and soft-reloads a saved file within a tenth of a second: function bodies change and
   state stays, players stay connected. A running game (`-game`, `-server`, or PIE) can't do a full
   reload, so a change to a class's `UPROPERTY`s or `UFUNCTION`s logs `Full Reload is required` and
   keeps the old code: the launcher watches the logs for that line and restarts the processes.
3. **C++ restarts:** a change to `Source/` rebuilds the module and restarts the processes, and the
   clients and bots reconnect by themselves (Live Coding for body-only changes, where it holds up).
4. **Bots:** headless clients (`-game -nullrhi`) that join, move and report, like `scripts/bot.ts`;
   and Angelscript's unit and integration tests for the checks in `scripts/*.ts`.
5. **Seeing it:** a client rendering on the GPU off screen (`-RenderOffScreen`) with a small HTTP
   command server in the dev build: run a console command, set the camera, press a key, save a
   screenshot to a file to look at. It does the job of the Chrome MCP tools.

## Running it

`pnpm run ue` (`unreal/Tools/ue.ts`, whose header lists every command): `dev [clients] [bots]` runs a
headless server with off-screen clients and bots, restarting them for C++ changes, script changes a
running game can't take in place, or after one stops (script that doesn't compile at startup exits);
`window [name]` joins in a window on the desktop. Every process has a dev port for `exec`, `shot` and
`ping`. Console commands for bots and checks, in `Script/Player/StoreRaidPlayerController.as`:
`sr.move`, `sr.look`, `sr.face <yaw> [pitch]`, `sr.run`, `sr.jump`, `sr.goal <x> <z>` (walk to a
point), `sr.grab`, `sr.release`, `sr.drop`, `sr.light`, `sr.respawn`, `sr.reset` (every item back),
`sr.where` (this player, as `key value` pairs), `sr.eye <x> <y> <z> <bearing> [pitch]` (look from any point on
that machine, for screenshots; `sr.eye off`), `sr.players`, `sr.items` and `sr.room`; for the
round, `sr.ready`, `sr.stand` and `sr.overlay` (what this screen's overlay and results say), and on
the server `sr.mode playground|game`, `sr.clock <seconds>` (what's left of the phase) and
`sr.raidtime <seconds>`. A process started with `-bot` walks a small round until given a goal.
`pnpm run ue check <name>` runs a check in `Tools/checks/` against running players: `playground` (a
bot; the port of `scripts/playground.ts`), `items` (a bot and a client; hands, the flashlight, the
sofa), `hatch` (the port of `scripts/hatch.ts`) and `round` (a bot and a client: seats, ready, loot,
leaving, results, death and watching, dawn). The last two make the room a game and put it back.
`ticks` (a client and a bot, on `UE_LEVEL=generated-2`, `dev 1 1`) has a perched tick made wary by
the player's beam, settle, and drop on them; the bot's beam make it let go and flee; a beam send a
hunting one fleeing; then a tick hunt, latch on and drain the player, be pulled off, and drain them
to death. Without the bot it leaves out the other player's beam. For ticks there are `sr.ticks`
(every tick and everyone's health), and on the server `sr.sic [meters] [name]` (a tick on the floor
in front of a player, hunting), `sr.perch <x> <y> <z>` (a tick perched at a point, as if on racking)
and `sr.health <amount> [name]`.

**Levels and modes:** the server's room is in the playground unless `UE_LEVEL=generated-<seed>`
(`-level=` on its command line), a generated warehouse. It's a game or the playground as
`UE_MODE=game` or `UE_MODE=playground` says (`-mode=`), else as the level's own: generated levels are
games. `pnpm run ue exec server sr.mode game` switches a running one; `UE_RAID_TIME=<seconds>`
shortens raids. The port's playground has the crew's truck, which the web game's doesn't, parked along the
south wall (`Playground::TruckPlace()`), so the round can be played before the harbour is ported.

**Models:** `pnpm run ue import [filter…]` brings models from `../assets/models` into `Content/`, all
of them or those whose path (`props/tv`, `village/`) contains a filter, in about 2½ minutes for all 117.
It only imports what changed: a model whose mesh in `Content/` is newer than its staged file and than
`import.py` is skipped, so changing the import script imports everything again; `--force` does too.
`Tools/import/stage.ts` first writes each as a glTF Interchange can read, in `Saved/Import/models/`:
the textures, KTX2 (UASTC, decoded with Babylon's decoder from `node_modules`) or WebP, become PNG.
Then `Tools/import/import.py` runs in a headless editor: each model goes to
`/Game/Models/<folder>/<name>/`, its mesh named `<name>` beside its materials (Interchange's glTF
material instances) and textures. A static model's nodes are combined into one static mesh with
Nanite; a skinned one is a skeletal mesh with its skeleton and clips. Models are turned at import to
face north (Unreal's +X) with their right east (+Y), as `World::ToWorld` has the game's axes, so
script places them with the game's yaw. In script, `Models::Mesh("level/truck")` (or `Skinned()`)
loads one, and `sr.model <name> <x> <y> <z> [yaw]` puts one down on that machine to look at
(`sr.model clear`). The game must be stopped to import: its processes keep the packages they loaded open.

**Surfaces:** `pnpm run ue surfaces [filter…]` brings the surface library (`../assets/textures/surfaces`,
baked by `pnpm run surface`) into `Content/Surfaces/<name>/`: its three textures and `MI_<name>`, an
instance of `M_Surface` with the surface's tile and paint from `client/src/surfaceTable.ts`, in about
20 seconds for all of them. Run it again after baking a surface.

## Order

Each step ends playable, with the web game as the reference for how it should behave.

0. ✅ **Engine and pipeline.** Build the fork. A project with a C++ module and `Script/`, a headless
   server that reloads script, a bot that joins it, an off-screen client that takes screenshots.
1. ✅ **The playground, walking.** `shared/tiles.ts` and the playground grid in script; the hall built
   from modular pieces (instanced static meshes, so Lumen and Nanite work); a first-person character
   on a predicted movement component: walk, run and stamina, jump, step up and down, stairs' pace,
   ladders, falling and respawn. Two players see each other through a dedicated server.
   Done but for the look: the hall is the engine's cubes, lit by lamps under the roof, until models
   are imported. `check playground` passes all of `scripts/playground.ts`.
2. **Hands and items.** Grab and drop, one- and two-handed, two-person carrying, physics items on the
   server (Chaos instead of Havok, replicated), flashlights, first-person hands.
   Done but for the first-person hands, and items are boxes of their size until models are imported:
   `Script/Items/` (`Hands.as` is GameRoom's grab, drop and carry), the dimmer, and `check items`.
   Players' own capsules pass through items and a second capsule, the shover, pushes loose
   two-handed ones, as players were kinematic bodies in Havok.
3. ✅ **The round.** Modes, phases, the truck with its hatch and seats, roles and spectating, loot and
   quota, the overlay and results (UMG from script).
   Done in the playground, with the truck in it: `Script/Game/` (`Modes.as`, the player state with
   role, ready and seat), `Level/Truck.as` (`parkTruck()`) and `TruckActor.as`, the round in
   `StoreRaidGameMode.as`, `UI/Overlay.as`. Those out of the building have no character and watch
   someone who has. Getting up takes `SITTING.standUpTime` and sitting down eases the eye in, a
   player put back in the truck is rested, and a seated player's capsule is narrower, so one getting
   up doesn't start inside the one beside them. Still to come: the seated character's clips (the
   stand-in sits as a short cylinder) and the overlay's look beyond plain text.
4. **The warehouse.** `generate.ts`, `furnish.ts`, `props.ts`, `levelCheck.ts` in script; the building
   drawn by room kind, dressing, fittings and their light.
   So far, making the level, as the web game makes it on every seed tried: `generate.ts` is
   `Level/Generate.as` (seeds 1 to 200), `props.ts` `Props.as`, `furnish.ts` `Reach.as` (the
   building, links, targets and flood fills) and `Furnish.as`, and `generatedLevel()` `Warehouse.as`
   (seeds 1 to 20). `Generate_Test.as` and `Furnish_Test.as` check them against the web game's own,
   in `Tools/fixtures/` (seeds 1 to 30 and 1 to 3), written by `pnpm exec tsx
   unreal/Tools/dumpGenerated.ts [count] [furnished count]`: more seeds for a wider check, and the
   port's own go to `Saved/`, to diff. A level takes about 1.6 s in the test editor, interpreted.
   `levelCheck.ts` is `LevelCheck.as`: `LevelCheck_Test.as` holds seeds 1 to 3 to every rule and
   spoils one to see it caught.
   Playable: `Level/Levels.as` is the `Level` type and `levelNamed()`, for the playground and
   `generated-<seed>`; the game state builds the one the server names on every machine (`LevelName`,
   replicated), and the game mode takes spawns, the kill height and the dimmer from it. Unlike the
   web game's, a warehouse has the crew's truck, backed up to its open loading door on a fenced patch
   of yard. Its props are drawn (`PropsActor.as`: an instanced mesh per model, boxes for the ones not
   imported yet). Its fittings are lit by `Level/Fittings.as`, as the web game's bake spread their light:
   tubes and bulbs send a third as much up as down, an even point light hung 0.35 m below them and a
   spot light facing down, so the ceiling over them isn't burnt white; the high-bays' spots alone cast
   shadows. Flickering fittings stutter, die, try their starter or buzz as in the web game, on each
   screen's own dice, and their models are drawn on their own with `M_Glow` (made by `pnpm run ue
   surfaces`), whose glow dims with the light. `sr.lamps` lights the lamps again on one machine.
   The building is drawn by room kind (`Level/Building.as`, a first cut of `client/src/building.ts`):
   each face of a wall, floor and ceiling takes the finish of the room it faces (kick band, lower coat,
   dado band, upper coat, cladding; floor; slab, deck or ceiling tiles), in the livery from the seed,
   the web game's finishes and liveries number for number. Faces are thin boxes on the level's boxes,
   an instanced mesh per surface with each instance's paint in its custom data, over collision boxes
   that are hidden. `pnpm run ue surfaces` brings the surface library in (`Tools/import/surfaces.ts`
   and `surfaces.py`): its textures, and `M_Surface`, a material made by script that projects them
   from the world, so faces need no texture coordinates, with an instance a surface.
   Exposure is fixed (`Level/Look.as`, an unbound post-process volume), not the engine's eye
   adaptation: -3 stops matches the web game's brightness under the same fittings, seen side by side
   from the same spot (`sr.exposure <stops>` tries another on one machine). `sr.building` draws the
   building again on one machine, to see a change to `Building.as` once script has reloaded.
   Stairs, railings, ladders, pit edges, planks, arch and gate trims, thresholds, lane lines,
   pilasters, beams and ceiling trims are drawn as the web game draws them. So is the wear the web
   game bakes into vertex colours (dirt rising from the floor, dark corners, scuffs, damp, oil,
   mottling), which `M_Surface` works out per pixel from what each face's custom data says about
   where it is (`FWear`). Cladding has its corrugations in the geometry: sheets and single
   corrugations made by `pnpm run model corrugated-sheet` and `corrugated-strip`, laid over the flat
   face in line with the texture's. Where wall boxes overlap in a plane, only one face is drawn there. Still to come: how fast it builds (2 s on the server, 6 on a client).
5. **Ticks and health.** Moved on the server as server/src/ticks.ts moves them, number for number:
   `Script/Ticks/`, `TickRules.as` (shared/ticks.ts: the numbers, perches, the beam), `TickNest.as`
   (perch, drop, hunt, leap, latch, drain, flee from beams and fittings' light, stunned when pulled
   off) and `Tick.as` (each one, replicated, and drawn: on our face, belly to us, filling the view).
   The level questions they ask, standing room, sliding along boxes, lines of sight and the A* way
   across the floor, are C++ (`Source/StoreRaid/StoreRaidTerrain`), over the level's own floors and
   boxes, as a search looks at thousands of cells. Health is on the player state; a tick takes it,
   and at none in a raid the player is dead. There's no health bar: how close to death the player
   we look through is shows as their view going (`UI/Dying.as`, the post-process `M_Dying` made by
   `pnpm run ue surfaces`), closing in red-black from the edges, draining of colour and darkening,
   throbbing with a heartbeat that quickens; a tick on them brings it on at once, and the overlay says
   how to get it off. Grab pulls one off before anything else. `check ticks` passes. Its legs are
   walked in code as client/src/tick.ts walks them (`TickLegs.as`, on a poseable mesh): the tetrapod
   gait, FABRIK in each leg's plane, questing front legs when it stands, rearing when wary, legs
   curled and scrabbling in the air, on its back or on a face. `sr.tickdemo <x> <y> <z> [radius]
   [speed] [yaw] [state]` puts one on a single machine, walking a circle or standing, to look at, and
   `sr.torch [candela]` carries a light with the `sr.eye` camera to see it in the dark. `check ticks`
   checks beams too. Still to come: hissing and tapping (with sound).
6. **The harbour and the yard, then the village.** Environments, sky and fog, ground.
7. **Sound, the tuning panel, the rest.** Then the web game is deleted.

Much of the client goes away rather than being ported: the render pipeline, lighting in shaders,
visibility, KTX2, atlasing and fog are the engine's job now.

## Decisions

- **Movement:** `ACharacter` with a `UCharacterMovementComponent` subclass in C++ for what must be
  predicted (stamina, winded, ladders, the pace on stairs), not a port of `stepMover`. The engine's
  prediction, correction and smoothing replace ours. Mechanics stay tunable and owned by the server.
- **Physics:** Chaos on the server, items replicated with the engine's physics replication.
- **Native, not the browser.** Players run a build; the web version goes when the port catches up.
- **Nanite on imported meshes:** the import script builds every model from `assets/` with Nanite
  enabled (the level's pieces, props and scenery), so dense meshes and many instances cost little.
- **Asset import:** built before step 3, so the round starts with the real truck, hatch and props
  (`pnpm run ue import`). Materials are Interchange's glTF ones for now, given the usage flags
  the game draws them with (instanced static meshes and Nanite, or skeletal meshes) at import; materials of our own, made
  by script, and the surface library's textures come when the building is drawn (step 4).
- **The building's surfaces are projected from the world** (`M_Surface`), not mapped by UVs as the
  web game's part builder did: faces are boxes of any size, and a surface shows at its real size on
  each, which costs nothing per face. The normal map goes into the world by the same projection.
