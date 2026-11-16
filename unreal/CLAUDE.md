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

**Gameplay code**

- In `ChoosePlayerStart`, the joining player isn't in `PlayerArray` yet, so pick a spawn point by
  what's free (`FreeSpawnPoint()`), not by their place in the room.
- The engine's character movement stops at physics bodies, but players should shove items and
  never be stopped by them. So the player's capsule ignores `PhysicsBody`, and a second capsule
  (`Shover`) blocks only physics bodies and pushes them. Keep that split when adding things players
  bump into.
- A character's capsule rests about 2 cm above the floor: `sr.where` reports `y 0.02` standing on
  the ground, so checks compare heights within a tolerance.

**Checks**

- Every check shares one room on the running server, so a check starts with `sr.respawn` and
  `sr.reset` (every item back) rather than assuming a fresh room. The room's light on the dimmer
  carries over too.
- Bots stop within 0.15 m of a goal, so stand them where the thing to grab is clearly nearest, not
  at the edge of reach.
- The small round a `-bot` walks has to stay clear of railings near the spawn points: it gives up
  on a corner after 5 s.
