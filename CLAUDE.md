# Friday Fun

An online multiplayer browser game: one player per screen, on keyboard or controller. `PLAN.md` has
the roadmap for the game, Night shift at the megastore.

## Stack

- **Client:** Babylon.js 9 + TypeScript, bundled by Vite 8 (`client/`)
- **Server:** Colyseus 0.18, authoritative, fixed 30 Hz tick (`server/`)
- **Shared:** simulation code both sides run: constants, level, collision, movement (`shared/`)
- Node ≥ 22. Lint/format: Biome. Physics: Havok, on the server only.

## Layout

```
client/src/main.ts         render loop: devices → local players → views → panes
client/src/input.ts        Device: controllers (Gamepad API) and the keyboard (still split in two halves)
client/src/localPlayer.ts  LocalPlayer: one device + camera + connection
client/src/splitscreen.ts  panes(count): leftover screen layout for 1–4 players, to be removed
client/src/players.ts      PlayerView: capsule + billboard name tag
client/src/items.ts        ItemView: a box or sofa, drawn where the server says
client/src/scene.ts        world, player camera
client/src/graphics.ts     engine (WebGPU, else WebGL2), quality tier (balanced; `?quality=high` for all effects), `surfaceMaterial()` for PBR, camera effects
client/src/reload.ts       production builds reload when a served .game-build file changes; nothing writes that file locally
client/src/net.ts          Colyseus client, joinGame(), waitForServer()
client/src/assets.ts       assetUrl(), loadModel() with placeholder fallback
server/src/rooms/          GameRoom (simulation) + schema.ts (synced state + input)
server/src/physics.ts      PhysicsWorld: Havok bodies for one room
server/src/persist.ts      load()/save(): state that survives server restarts
scripts/bot.ts             headless player
scripts/carry.ts           two bots carry a sofa to the dock, and report what worked
```

## How the game works

- The **server is authoritative**. Clients send inputs (`MoveInput`) through the input buffer; the
  server runs `stepMover` for each at 30 Hz and syncs state. Each client **predicts its own
  player** with the same step and **interpolates everyone else**, so `shared/movement.ts` must stay
  a pure function of `(state, input, dt)`: no clocks, randomness or other state.
- **Physics runs on the server only** (`PhysicsWorld`, Havok). Clients interpolate the poses it
  syncs and never run it; player movement stays in `stepMover`, not in physics. Players are
  kinematic: they shove objects, objects don't stop them.
- **The game is online only, with one player per screen.** New features don't need to work in
  splitscreen, and shouldn't add to it. Players each have their own screen and connection, which
  features like proximity voice depend on.
- **The client still contains the old splitscreen code,** until someone removes it: `locals` can
  hold up to four `LocalPlayer`s, each with its own room connection and a camera in
  `scene.activeCameras`, laid out by `layoutPanes`. Per-player logic still belongs in `LocalPlayer`,
  not in globals. Use the player's own camera rather than `scene.activeCamera`, which assumes there's only
  one. For UI, use billboards in the scene (see `PlayerView`) or a DOM overlay.
- **Input goes through `Device`**, never raw keys or gamepads, so every feature works on all of
  them. New action: add it to `Controls`/`Device` and map it for the keyboard and controllers.
- `MoveInput` is analog, in world space, whole numbers in ±`MOVE_SCALE`: `LocalPlayer.update` turns
  stick + camera angle into it.
- Coordinates: x = right, z = forward, y = up. 1 unit = 1 meter.
- Non-movement actions → a message handler in `GameRoom.messages`, validated on the server.
- Lasting state goes through `server/src/persist.ts`, keyed by player name, never `sessionId`.

## Running

This is a solo, local project. Start everything with **`pnpm run dev`** (requires Node ≥ 22.12):

- Game: `http://127.0.0.1:5173/`. The game server listens on `127.0.0.1:2567`, and the browser
  reaches it through Vite's proxy at `/ws`.
- Both reload on file changes (Vite HMR for the client, `tsx watch` for the server; players rejoin
  by themselves). Logs go to that terminal, and Ctrl+C stops both.
- `PORT`, `SERVER_PORT` and `BASE` environment variables override the defaults.
- Console (dev only): `window.__game` → `{ locals, views, world, engine }`.
- Controllers need a secure page (HTTPS or localhost), and a button press before they show up.
  Holding both sticks down for a second reloads the page.

## Debugging

You can't see the browser, so check your work from the terminal, with `pnpm run dev` running:

- **Compile errors:** `curl -s http://127.0.0.1:5173/src/main.ts` returns an HTML error page if the
  file doesn't compile.
- **Bot players:** `pnpm exec tsx scripts/bot.ts [name] [seconds]` joins your game server, walks in a
  square and prints every player's position each second.

## Committing

- `pnpm run check` must pass. `pnpm run format` fixes formatting.
- Work and commit on `main`. There is no merge bot or ship step.
- The `night-coding-vm` remote is the old server. Don't push to it.
- `.gitattributes` keeps every text file LF, which Biome requires, including on Windows.

## Assets

Assets (models, textures, audio) live in **`public/assets/`**, not in git, and are served at
`/assets/...` in dev and copied into builds. A fresh clone doesn't have them, so copy them in by
hand. `public/assets/manifest.json` is a snapshot from the old server: nothing regenerates it.

- `loadModel(scene, "models/props/crate.glb", placeholder)` shows the placeholder until the file
  exists, so use the final path from day one. Vite answers a missing asset with `200` and its HTML
  page, so check the content type, not only the status, when testing a URL with curl.
- Folders: `models/{characters,props,level}`, `textures/`, `audio/{sfx,music}`, `ui/`. Lowercase
  kebab-case. `.glb` from Blender: Y-up, transforms applied, meters.
- Anything bundled with the client uses `import.meta.env.BASE_URL`, never a bare `/` path.
