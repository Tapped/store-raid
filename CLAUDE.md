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
client/src/main.ts         render loop: input → player → views and items; join, leave and the player name
client/src/input.ts        Device: the keyboard and mouse, controllers (Gamepad API), and `input`, all of them at once
client/src/localPlayer.ts  LocalPlayer: the player at this screen: device + first-person camera + connection
client/src/hands.ts        FirstPersonHands: the player's own gloved hands at the camera: resting, reaching, holding, carrying
client/src/players.ts      PlayerView: animated character (capsule if the model is missing) + billboard name tag
client/src/items.ts        ItemView: a phone, TV, box or sofa, drawn where the server says: models/props/<kind>.glb, else boxes
client/src/props.ts        addProps(): scenery models, drawn only, with no collision
client/src/playground.ts   addPlayground(): the playground hall: roof, beams, lights on the dimmer, and CONCEPTS on show
client/src/terrain.ts      addTerrain(): a level's floors, planks, stairs, ladders, railings and pits; worldBox() for seamless tiling
client/src/tick.ts         TickView: the large tick, walked in code: leg IK, a tetrapod gait, questing front legs
client/src/store.ts        addShelves(): stocked shelving over the shelf collision boxes; storeSurface(): textured walls and floor
client/src/harbour.ts      addHarbour(): the harbour around the store, as instanced scenery with no collision
client/src/paving.ts       addPavingVariation(): world-space brightness and damp patches on harbour paving
client/src/lamps.ts        addStreetLamps(): glowing lamp faces, and lamp light summed in every PBR shader (not scene lights)
client/src/scene.ts        world, lights and fog, first-person camera, lobby camera
client/src/sky.ts          addSky(): overcast sky dome, painted at startup; HORIZON, the colour fog fades to
client/src/graphics.ts     engine (WebGPU, else WebGL2), one pipeline of TAA with MSAA, contact SSAO, bloom and sharpen, all in half floats (`?quality=high` for finer shadows and SSAO), `surfaceMaterial()` for PBR, `gradePicture()` for the colour look, `drawInstances()` for static copies, camera effects
client/src/reload.ts       production builds reload when a served .game-build file changes; nothing writes that file locally
client/src/net.ts          Colyseus client, joinGame(), waitForServer()
client/src/assets.ts       assetUrl(), loadModel() with placeholder fallback
server/src/rooms/          GameRoom (simulation) + schema.ts (synced state + input)
server/src/physics.ts      PhysicsWorld: Havok bodies for one room
server/src/persist.ts      load()/save(): state that survives server restarts
scripts/bot.ts             headless player
scripts/hands.ts           bots check the hands in the store: phones, a TV and a two-person sofa, and report what worked
scripts/playground.ts      a bot checks the playground: dimmer, stairs up and down, ladders, railing, plank and the pit
scripts/generate.ts        draws a generated level from a seed, or checks how many seeds go
scripts/unity-import/      prefabs from a Unity .unitypackage → textured .glb in assets/, through Blender
scripts/models/            models made in code: one Python script per model, built in Blender (`pnpm run model`)
scripts/image.ts           images from Nano Banana Pro (Gemini) into assets/ (`pnpm run image`, see the `image` skill)
```

## How the game works

- The **server is authoritative**. Clients send inputs (`MoveInput`) through the input buffer; the
  server runs `stepMover` for each at 30 Hz and syncs state. Each client **predicts its own
  player** with the same step and **interpolates everyone else**, so `shared/movement.ts` must stay
  a pure function of `(state, input, dt)`: no clocks, randomness or other state.
- **Physics runs on the server only** (`PhysicsWorld`, Havok). Clients interpolate the poses it
  syncs and never run it; player movement stays in `stepMover`, not in physics. Players are
  kinematic: they shove objects, objects don't stop them.
- **The game is online only, with one player per screen.** Each page has one `LocalPlayer`, with
  its own connection, and its camera is `scene.activeCamera` (the lobby camera before joining).
- **The game is first person.** The camera sits at `EYE_HEIGHT` in the player, who isn't drawn on
  their own screen. Clicking captures the mouse to look around (Esc lets it go); the right stick
  looks too. Where the player looks around y, their yaw, goes to the server with every
  input: it keeps carried things in front of them, decides what they can grab, and turns their
  character on everyone else's screen.
  Features like proximity voice and the witch depend on every player having their own screen. For
  UI, use billboards in the scene (see `PlayerView`) or a DOM overlay.
- **The player's name** comes from `?name=`, else one is made up on the first visit and kept in
  `localStorage`. Tabs in the same browser share it, so give each test player its own `?name=` or
  an isolated browser context.
- **Input goes through `Device`**, never raw keys or gamepads, so every feature works on all of
  them. The keyboard, mouse and every controller all drive the one player, through `input`. New
  action: add it to `Controls`/`Device`, map it for the keyboard and controllers, and combine it in
  `input`.
- `MoveInput` is analog, in world space, whole numbers in ±`MOVE_SCALE`, plus the yaw in
  `YAW_SCALE` units: `LocalPlayer.update` turns stick + where the player looks into it.
- Coordinates: x = right, z = forward, y = up. 1 unit = 1 meter.
- Non-movement actions → a message handler in `GameRoom.messages`, validated on the server.
- **Hands:** each player has `left` and `right`, the id of the item in that hand. A two-handed item
  is in both. `ITEM_KINDS` says how many hands each kind takes and how many people it takes to
  lift. Grab (E, RB; `grab` message) takes the nearest item in front of the player that fits, with
  the right hand if it's free, else the left. Drop (Q, LB; `drop` message) lets go of the last thing
  grabbed. `grabbingHand()`/`droppingHand()` in `shared/constants.ts` decide which hand.
  One-handed items are stepped over rather than shoved, so players can walk up to them.
- Lasting state goes through `server/src/persist.ts`, keyed by player name, never `sessionId`.

## Running

This is a solo, local project. Start everything with **`pnpm run dev`** (requires Node ≥ 22.12):

- Game: `http://127.0.0.1:5173/`. The game server listens on `127.0.0.1:2567`, and the browser
  reaches it through Vite's proxy at `/ws`.
- Both reload on file changes (Vite HMR for the client, `tsx watch` for the server; players rejoin
  by themselves). Logs go to that terminal, and Ctrl+C stops both.
- `PORT`, `SERVER_PORT` and `BASE` environment variables override the defaults.
- **Levels** are in `shared/level.ts`. The playground is the default: a brick hall with each item
  kind, a dock, a pit with a plank across, stairs and ladders up two storeys and down to a
  basement, and a dimmer for the lights, to try things out in. The store is at `http://127.0.0.1:5173/?level=store`. New models go on show
  in the playground through `CONCEPTS` in `client/src/playground.ts`. Each level has its own
  rooms; bots join the playground unless `LEVEL` says otherwise.
- **Tiles** (`shared/tiles.ts`): the playground is a grid of 4 m cells on storeys 3 m apart,
  written as characters (`F` floor, `#` solid, `P` pit, `|`/`=` plank bridge, `^>v<` stairs and
  `nesw` ladders, both up towards that side, `.` open air). Storeys below ground are basements,
  dug out of `#`; stairs going down are stairs on the storey below. Open air above stairs or a
  ladder is its well, and under a pit a shaft: the parser works out which. Rooms are walls on the
  edges between cells, drawn in a storey written with `+` corners, `-`/`|` walls and `d`
  doorways. `checkTiles` checks sockets side by side (`fits`) and stacked (`fitsAbove`), and
  `composeTiles` turns a grid into floors, boxes and ladders.
- **Generated levels** (`shared/generate.ts`, `?level=generated-<seed>`): a layout layer splits
  each storey into rooms (some open air above the ground), joins them with doorways and puts a way
  up from every storey; then wave function collapse picks every tile; then whatever can't be
  reached from the entrance is filled in or taken away. Pure and seeded, so server and clients
  build the same level. `pnpm exec tsx scripts/generate.ts [seed]` draws one, `--many 200` checks
  many. New kinds of room should be tiles, or room types in the layout layer; props will be a
  third layer.
- **Height:** players stand on `floors` (flat, or ramps for stairs), step up `STEP_UP`, follow
  the floor down `STEP_DOWN`, and fall under `GRAVITY`; boxes only block where they overlap in
  height. On a ladder, walking into it climbs and backing away climbs down. Falling below the
  level's `killY` respawns a player, and puts an item back where it started.
- Console (dev only): `window.__game` → `{ player(), views, items, world, engine }`.
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
- `.gitattributes` keeps every text file LF, which Biome requires, including on Windows.

## Assets

Assets (models, textures, audio) are never stored in git. One copy lives in **`assets/`** next to
the `main/` checkout, and every checkout shares it:

```
store-raid/
  assets/      shared by all checkouts, not in git
  main/        the main checkout, which holds .git
  worktrees/   linked worktrees, one folder per branch
```

`client/vite.config.ts` links each checkout's `public/assets` to that folder when Vite starts, so
they're served at `/assets/...` in dev and copied into builds. A fresh clone gets `assets/` from
the Google Drive backup with `pnpm run assets:restore -- --yes`.

- **Backup:** `pnpm run assets:backup` makes `gdrive:store-raid` match `assets/`, through rclone
  (`scripts/assets.ts`). Run it after adding or changing assets. Anything it overwrites or deletes
  on Drive moves to `store-raid-old/<time>/`, and a restore moves local files to `assets-old/`.
- `pnpm run assets:restore` alone only previews. The rclone remote `gdrive` (scope `drive.file`)
  lives in the user's rclone config, not the repo. `assets/manifest.json` is a snapshot from the old server: nothing regenerates it.

- **Models made in code** (the `model` skill has the workflow): `scripts/models/<name>.py` builds a model with the helpers in
  `scripts/models/lib.py`, whose docstring has the conventions (front faces Blender's -y, meters,
  `ITEM`, `OUT`, `ORIGIN`, `TRIS`, `AO`). `pnpm run model <name>` runs it in Blender in the
  background, bakes its `procedural()` materials into textures and its ambient occlusion onto a
  second UV set (Cycles, on the GPU if there is one), writes the `.glb` to `assets/` with WebP
  textures, checks it against `ITEM_KINDS` and its triangle budget, and renders
  `node_modules/.cache/models/<name>/preview.png` from four sides. Look at the preview, then at the
  model in the game, whose lighting differs. Screen-space AO only adds contact shadows between
  things, so a model's own creases come from its bake. The scripts are in git and the models aren't, so run
  `pnpm run assets:backup` after building.
- `loadModel(scene, "models/props/crate.glb", placeholder)` shows the placeholder until the file
  exists, so use the final path from day one. Vite answers a missing asset with `200` and its HTML
  page, so check the content type, not only the status, when testing a URL with curl.
- Folders: `models/{characters,props,level}`, `textures/`, `audio/{sfx,music}`, `ui/`. Lowercase
  kebab-case. `.glb` from Blender: Y-up, transforms applied, meters.
- Anything bundled with the client uses `import.meta.env.BASE_URL`, never a bare `/` path.
