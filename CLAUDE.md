# Friday Fun

A multiplayer browser game with splitscreen and controllers.

## Stack

- **Client:** Babylon.js 9 + TypeScript, bundled by Vite 8 (`client/`)
- **Server:** Colyseus 0.18, authoritative, fixed 30 Hz tick (`server/`)
- **Shared:** simulation code both sides run: constants, level, collision, movement (`shared/`)
- Node ≥ 22. Lint/format: Biome. Physics: Havok, on the server only.

## Layout

```
client/src/main.ts         render loop: devices → local players → views → panes
client/src/input.ts        Device: controllers (Gamepad API) and the two keyboard halves
client/src/localPlayer.ts  LocalPlayer: one device + camera + connection
client/src/splitscreen.ts  panes(count): the screen layout for 1–4 players
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
- **Each person on the screen has their own room connection** (`LocalPlayer`). The server doesn't
  know about splitscreen; several screens can play in the same room. Per-person logic belongs in
  `LocalPlayer`, not in globals, and anything that addresses "the player" must say which one.
- **All players share one Babylon scene** and each has a camera with its own viewport
  (`scene.activeCameras`). Don't use screen-space UI linked to meshes (`linkWithMesh`) or
  `scene.activeCamera`: they assume one camera. Use billboards in the scene (see `PlayerView`), or
  a DOM overlay per pane (see `layoutPanes`).
- **Input goes through `Device`**, never raw keys or gamepads, so every feature works on all of
  them. New action: add it to `Controls`/`Device` and map it for keyboards and controllers.
- `MoveInput` is analog, in world space, whole numbers in ±`MOVE_SCALE`: `LocalPlayer.update` turns
  stick + camera angle into it.
- Coordinates: x = right, z = forward, y = up. 1 unit = 1 meter.
- Non-movement actions → a message handler in `GameRoom.messages`, validated on the server.
- Lasting state goes through `server/src/persist.ts`, keyed by player name, never `sessionId`.

## Running

This is a solo, local project. Start everything with **`npm run dev`** (requires Node ≥ 22.12):

- Game: `http://127.0.0.1:5173/`. The game server listens on `127.0.0.1:2567`, and the browser
  reaches it through Vite's proxy at `/ws`.
- Both reload on file changes (Vite HMR for the client, `tsx watch` for the server; players rejoin
  by themselves). Logs go to that terminal, and Ctrl+C stops both.
- `PORT`, `SERVER_PORT` and `BASE` environment variables override the defaults.
- Console (dev only): `window.__game` → `{ locals, views, world, engine }`.
- Controllers need a secure page (HTTPS or localhost), and a button press before they show up.
  Holding both sticks down for a second reloads the page.

## Debugging

You can't see the browser, so check your work from the terminal, with `npm run dev` running:

- **Compile errors:** `curl -s http://127.0.0.1:5173/src/main.ts` returns an HTML error page if the
  file doesn't compile.
- **Bot players:** `npx tsx scripts/bot.ts [name] [seconds]` joins your game server, walks in a
  square and prints every player's position each second.

## Committing

- `npm run check` must pass. `npm run format` fixes formatting.
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
