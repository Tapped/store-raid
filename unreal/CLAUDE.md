# The Unreal port

The game on Unreal Engine with Angelscript. `../PORT.md` has the plan, what's done, and how to run
it (`pnpm run ue`, the `sr.*` console commands, the checks in `Tools/checks/`). Run `pnpm` from the
checkout, not from here.

## Hiccups

What has tripped up work here before:

**Angelscript**

- A global `const` can't use a constant from another file in its initializer ("may not be
  initialized yet"). Write the number, with the sum in a comment (`KILL_Y` in `Playground.as`).
- A local with the same name as a method hides that method: `FItemKindInfo Info = Info();` fails.
- There's no `GameState` member on the game mode: use `Gameplay::GetGameState()`, and
  `Gameplay::GetGameMode()`.
- `TeleportTo` isn't bound: use `SetActorLocation(Location, false, Hit, true)`, with the last
  argument as the teleport.
- Dividing ints warns about truncation: use `Math::IntegerDivisionTrunc(A, B)`.
- `GameState.PlayerArray` holds `TObjectPtr`s script can't take from it: go through
  `Gameplay::GetNumPlayerStates()` and `Gameplay::GetPlayerState(Index)` (`AStoreRaidGameState.Players()`).
- Not every engine RPC is callable: `AController::ClientSetRotation` isn't, so the controller has its
  own `ClientFace`.
- A member named like a namespace hides it inside the class (`Truck` the actor and `Truck::Park`):
  name them apart.
- UMG from script: subclass `UUserWidget`, `CreateWidget` it, build the tree with
  `ConstructWidget(UTextBlock)` (a type is a value; `::StaticClass()` is deprecated) and
  `SetRootWidget` before `AddToViewport` (`UI/Overlay.as`).
- A running game only soft-reloads: changing function bodies applies in milliseconds, but a new
  `UPROPERTY` or `UFUNCTION` logs `Full Reload is required`, and `pnpm run ue dev` restarts every
  process (about 15 s).

**Running it**

- Script that doesn't compile at startup makes Angelscript open a window to wait for a fix, which
  crashes a process without Slate (the server, bots). `ue.ts` passes `-as-exit-on-error`, so it
  exits instead, and `dev` starts everything again on the next save of a script.
- Static lighting is off (`r.AllowStaticLighting=False`): levels are built at runtime, so every
  light is movable and Lumen lights everything.
- A killed client stays in the server's room until its connection times out: a second `client`
  in `sr.players` after a restart is that one.
- If you send `dev`'s output to a file and restart it into the same file, the file can pick up NUL
  bytes and grep calls it binary: `tr -d '\000' < file | grep -a ...`.

- Two `dev` launchers at once share the game port and the dev ports: `exec` and `shot` reach
  whichever process bound the port first, maybe another session's. Check for running
  `UnrealEditor-Cmd.exe` processes before starting one.
- Stopping a `dev` launcher means killing its process tree (`taskkill /PID <node> /T /F`, or the
  `sh.exe` above it). Killing only the editors leaves `ue.ts` running, and it starts them again on
  the next script save. `dev` stops by itself when a process it was started under exits (it logs
  them at startup), but stopping a Claude Code background task kills none of them: its `sh.exe` is
  already orphaned, so kill the tree.

**Importing models**

- Interchange reads neither KTX2 (`KHR_texture_basisu`) nor WebP textures, which every model in
  `assets/` has: `Tools/import/stage.ts` turns them into PNG first.
- Deleting an asset folder in the editor and importing into it again in the same session leaves
  the old objects in memory, and the import skips making them (a mesh with no materials). So
  `ue.ts` removes the folders from disk before the editor starts.
- A running game keeps the packages it loaded open (`EBUSY`): stop it before importing.
- Interchange turns glTF's (x, y, z) into Unreal's (x, z, y), so the import turns models a
  quarter back (`import_offset_rotation`) to face Unreal's +X.

**Gameplay code**

- In `ChoosePlayerStart`, the joining player isn't in `PlayerArray` yet, so pick a spawn point by
  what's free (`FreeSpawnPoint()`), not by their place in the room.
- The engine's character movement stops at physics bodies, but players should shove items and
  never be stopped by them. So the player's capsule ignores `PhysicsBody`, and a second capsule
  (`Shover`) blocks only physics bodies and pushes them. Keep that split when adding things players
  bump into.
- Anything players stand on that every machine builds for itself (not replicated) must be Static:
  the character movement treats a movable floor as a moving base, the server's corrections then name
  it, the client can't resolve it ("could not resolve the new relative movement base actor, ignoring
  server correction") and drifts apart from the server for good. The truck's solids are instances on
  static instanced meshes for this; only its drawn parts move.
- Only those playing have a character: the dead, lost and waiting have a player state and a
  controller but no pawn. Round state that outlives the pawn (role, ready, seat) is on
  `AStoreRaidPlayerState`, which calls `ForceNetUpdate()` on every change, as the engine sends
  player states only now and then.
- A character's capsule rests about 2 cm above the floor: `sr.where` reports `y 0.02` standing on
  the ground, so checks compare heights within a tolerance.

**Checks**

- Every check shares one room on the running server, so a check starts with `sr.respawn` and
  `sr.reset` (every item back) rather than assuming a fresh room. The room's light on the dimmer
  carries over too.
- Bots stop within 0.15 m of a goal, so stand them where the thing to grab is clearly nearest, not
  at the edge of reach.
- The small round a `-bot` walks has to stay clear of railings near the spawn points: it gives up
  on a corner after 5 s. It also gets a seated bot up: `sr.goal` (with nothing) stops it, before
  anything that seats players.
- Replicated round state reaches clients a moment after the server has it: wait for a client's
  overlay or results to change rather than reading them right after the server's phase moves on.
