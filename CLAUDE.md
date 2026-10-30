# Friday Fun

A multiplayer browser game with splitscreen and controllers.

## Stack

- **Client:** Babylon.js 9 + TypeScript, bundled by Vite 8 (`client/`)
- **Server:** Colyseus 0.18, authoritative, fixed 30 Hz tick (`server/`)
- **Shared:** simulation code both sides run: constants, level, collision, movement (`shared/`)
- Node ≥ 22. Lint/format: Biome. No physics engine (yet).

## Layout

```
client/src/main.ts         render loop: devices → local players → views → panes
client/src/input.ts        Device: controllers (Gamepad API) and the two keyboard halves
client/src/localPlayer.ts  LocalPlayer: one device + camera + connection
client/src/splitscreen.ts  panes(count): the screen layout for 1–4 players
client/src/players.ts      PlayerView: capsule + billboard name tag
client/src/scene.ts        world, player camera
client/src/graphics.ts     quality tier (Windows high, others standard; `?quality=` overrides), per-camera effects
client/src/net.ts          Colyseus client, joinGame(), waitForServer()
client/src/assets.ts       assetUrl(), loadModel() with placeholder fallback
server/src/rooms/          GameRoom (simulation) + schema.ts (synced state + input)
server/src/persist.ts      load()/save(): state that survives server restarts
scripts/bot.ts             headless player
```

## How the game works

- The **server is authoritative**. Clients send inputs (`MoveInput`) through the input buffer; the
  server runs `stepMover` for each at 30 Hz and syncs state. Each client **predicts its own
  player** with the same step and **interpolates everyone else**, so `shared/movement.ts` must stay
  a pure function of `(state, input, dt)`: no clocks, randomness or other state.
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

Your dev servers already run as services, so **don't start `npm run dev` yourself.** They reload on
file changes (Vite HMR for the client, `tsx watch` for the server; players rejoin by themselves).

- Your preview: `$PREVIEW_URL` in `~/.config/game.env`. Always give the user that exact URL.
- The merged game: `/game/` next to it.
- Upload page for files on the user's computer: `/upload/` on the same host. Files from the web:
  `curl -fLo /srv/assets/<dir>/<name> <url>`.
- Logs: `journalctl --user -u game-client -f` / `journalctl --user -u game-server -f`
- Restart (e.g. after `npm install`): `systemctl --user restart game-client game-server`
- Console (dev only): `window.__game` → `{ locals, views, world, engine }`.
- Controllers need a secure page (HTTPS or localhost), and a button press before they show up.

## Debugging

You can't see the browser, so check your work from the terminal:

- **Your own Vite, no password:** `http://127.0.0.1:$PORT/<you>/` (`$PORT` from
  `~/.config/game.env`). `curl -s http://127.0.0.1:$PORT/<you>/src/main.ts` returns an HTML error
  page if the file doesn't compile.
- **Bot players:** `npx tsx scripts/bot.ts [name] [seconds]` joins your game server, walks in a
  square and prints every player's position each second.
- **Merges:** `cat /srv/merge-status/<you>` shows your last merge result.

## Shipping

- `npm run check` must pass. `npm run format` fixes formatting.
- Ship with **`/ship`** (or `ship` in the terminal): rebases on main, runs the check, pushes to
  `<you>/main`; the merge bot merges it into main. Never push to `main` yourself.
- Ship every commit as soon as it works.

## Assets

Shared assets (models, textures, audio) live in **`/srv/assets`** on the server, not in git, and
are served at `/assets/...`; `/srv/assets/manifest.json` lists them.

- `loadModel(scene, "models/props/crate.glb", placeholder)` shows the placeholder until the file
  exists, so use the final path from day one.
- Folders: `models/{characters,props,level}`, `textures/`, `audio/{sfx,music}`, `ui/`. Lowercase
  kebab-case. `.glb` from Blender: Y-up, transforms applied, meters.
- Anything bundled with the client uses `import.meta.env.BASE_URL`, never a bare `/` path.
