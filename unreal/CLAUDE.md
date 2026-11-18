# The Unreal port

The game on Unreal Engine with Angelscript. `../PORT.md` has the plan, what's done, and how to run
it (`pnpm run ue`, the `sr.*` console commands, the checks in `Tools/checks/`). Run `pnpm` from the
checkout, not from here.

## Hiccups

What has tripped up work here before:

**Angelscript**

- A global `const` can't use a constant from another file in its initializer ("may not be
  initialized yet"). Write the number, with the sum in a comment (`KILL_Y` in `Playground.as`).
- Containers can't be nested (`TMap<int, TArray<int>>` doesn't compile): wrap the inner one in a
  struct (`FIndices` in `Building.as`) and change it through `FindOrAdd`, which gives a reference.
- A local with the same name as a method hides that method: `FItemKindInfo Info = Info();` fails.
- There's no `GameState` member on the game mode: use `Gameplay::GetGameState()`, and
  `Gameplay::GetGameMode()`.
- `TeleportTo` isn't bound: use `SetActorLocation(Location, false, Hit, true)`, with the last
  argument as the teleport.
- Dividing ints warns about truncation: use `Math::IntegerDivisionTrunc(A, B)`.
- `>>>` on a `uint` of 2^31 or more doesn't shift in zeros as JS's does. Bit-exact ports of TS
  integer maths (the generator's mulberry32, `FRandom` in `Level/Generate.as`) work in `int64`
  masked to 32 bits, with `Math.imul` taken in halves (`Generate::Imul`).
- `FString.IsNumeric()` takes a sign alone (`"-"`) as a number: test for digits when reading the
  number a name ends in (`Building::SeedOf`).
- `FString`'s `<` and `==` ignore case. To sort strings as JS does, compare with
  `Compare(Other, ESearchCase::CaseSensitive)`.
- Unit tests (`pnpm run ue test`) print only that an assert failed, not its message: write what a
  test made to a file in `Saved/` to diff, as `Generate_Test.as` does.
- `GameState.PlayerArray` holds `TObjectPtr`s script can't take from it: go through
  `Gameplay::GetNumPlayerStates()` and `Gameplay::GetPlayerState(Index)` (`AStoreRaidGameState.Players()`).
- Not every engine RPC is callable: `AController::ClientSetRotation` isn't, so the controller has its
  own `ClientBrought`.
- A member named like a namespace hides it inside the class (`Truck` the actor and `Truck::Park`):
  name them apart.
- UMG from script: subclass `UUserWidget`, `CreateWidget` it, build the tree with
  `ConstructWidget(UTextBlock)` (a type is a value; `::StaticClass()` is deprecated) and
  `SetRootWidget` before `AddToViewport` (`UI/Overlay.as`).
- Changing the function behind an `FConsoleCommand` in a running game can leave the command
  unhandled until the processes restart (`sr.sic` was, after a soft reload): if a command a check
  sends answers nothing, restart `dev` before chasing it.
- A running game only soft-reloads: changing function bodies applies in milliseconds, but a new
  `UPROPERTY` or `UFUNCTION` logs `Full Reload is required`, and `pnpm run ue dev` restarts every
  process (about 15 s).

- `EMode` is the room's mode (playground or game): furnishing's ways of getting about are `EMover`.
- There are no mutable globals, even in a namespace: keep a setting on an actor or object.
- Script stops any one run of code that takes over `EditorMaximumScriptExecutionTime` ("took too
  long to execute. Potentially an infinite loop?") in the editor binary, which every process here
  is. Building a generated level takes a couple of seconds, so `Config/DefaultEngine.ini` raises it
  to 10.

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
- Interchange makes materials without the usage flags the game needs, and a material missing one
  draws as the engine's grey grid (the client logs `missing usage flag`): `import.py` sets them.
  `sr.materials <model>` lists a model's materials and their textures.
- Interchange turns glTF's (x, y, z) into Unreal's (x, z, y), so the import turns models a
  quarter back (`import_offset_rotation`) to face Unreal's +X. Not skinned ones: the offset turns
  their skeleton but not their vertices, so posed bones move the mesh a quarter turn off. They come in
  facing +Y, and script turns the component a quarter back (`ATick.Model`).

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
- Pawns block pawns, and the engine can't free two capsules that start inside each other: neither
  moves. The truck's seats are 0.56 m apart, closer than two players, so a seated player's capsule
  is narrower (`ShowSeated`), set on every machine from the replicated seat.
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
- Getting up from a seat keeps a player still for 1.4 s (`rising` in `sr.where`): `walk()` waits
  it out, but a check that moves a seated player by hand has to as well.
- Replicated round state reaches clients a moment after the server has it: wait for a client's
  overlay or results to change rather than reading them right after the server's phase moves on.
