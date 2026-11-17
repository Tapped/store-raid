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
`sr.where` (this player, as `key value` pairs), `sr.players`, `sr.items` and `sr.room`; for the
round, `sr.ready`, `sr.stand` and `sr.overlay` (what this screen's overlay and results say), and on
the server `sr.mode playground|game`, `sr.clock <seconds>` (what's left of the phase) and
`sr.raidtime <seconds>`. A process started with `-bot` walks a small round until given a goal.
`pnpm run ue check <name>` runs a check in `Tools/checks/` against running players: `playground` (a
bot; the port of `scripts/playground.ts`), `items` (a bot and a client; hands, the flashlight, the
sofa), `hatch` (the port of `scripts/hatch.ts`) and `round` (a bot and a client: seats, ready, loot,
leaving, results, death and watching, dawn). The last two make the room a game and put it back.

**Modes:** the server's room is the playground unless `UE_MODE=game` (`-mode=game` on its command
line), or `pnpm run ue exec server sr.mode game` on a running one; `UE_RAID_TIME=<seconds>` shortens
raids. The port's playground has the crew's truck, which the web game's doesn't, parked along the
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
   Still to come: `levelCheck.ts`, and drawing it all.
5. **Ticks and health.**
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
  (`pnpm run ue import`). Materials are Interchange's glTF ones for now; materials of our own, made
  by script, and the surface library's textures come when the building is drawn (step 4).
