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
`sr.where` (this player, as `key value` pairs), `sr.players`, `sr.items` and `sr.room`. A process
started with `-bot` walks a small round until given a goal. `pnpm run ue check <name>` runs a check
in `Tools/checks/` against running players: `playground` (a bot; the port of
`scripts/playground.ts`) and `items` (a bot and a client; hands, the flashlight, the sofa).

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
3. **The round.** Modes, phases, the truck with its hatch and seats, roles and spectating, loot and
   quota, the overlay and results (UMG from script).
4. **The warehouse.** `generate.ts`, `furnish.ts`, `props.ts`, `levelCheck.ts` in script; the building
   drawn by room kind, dressing, fittings and their light.
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
