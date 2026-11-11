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
client/src/round.ts        roundLines(): the overlay at the top in a game: the phase, the clock, loot and quota, who we watch
client/src/tired.ts        TiredEffect: the screen closes in, drains of colour and heaves with breaths as stamina runs out
client/src/tuning.ts       the registry of tunables: tunables() turns a module's constants into live settings; addSetting()
client/src/tuningPanel.ts  the tuning panel, `__game.tune()`: every registered setting as a slider or checkbox
client/src/hands.ts        FirstPersonHands: the player's own gloved hands at the camera: resting, reaching, holding, carrying
client/src/players.ts      PlayerView: animated character (capsule if the model is missing) + billboard name tag
client/src/items.ts        ItemView: a phone, flashlight, TV, box or sofa, drawn where the server says: models/props/<kind>.glb, else boxes
client/src/props.ts        addProps(): scenery models, drawn only, with no collision
client/src/playground.ts   addPlayground(): the playground hall: roof, beams, lights on the dimmer, and CONCEPTS on show
client/src/terrain.ts      addTerrain(): a level's floors, planks, stairs, ladders, railings and pits; worldBox() for seamless tiling
client/src/tileViewer.ts   the tile viewer at /tiles.html: generated levels, every tile and hand-written grids, drawn by the game's code, to inspect
client/src/tileCatalogue.ts every tile in a small grid of its own, for the tile viewer
client/src/tick.ts         TickView: the large tick, walked in code: leg IK, a tetrapod gait, questing front legs
client/src/audio.ts        sound on Web Audio, heard from the active camera: OneShots (varied one-shots) and Loop, placed or heard straight
client/src/occlusion.ts    how many walls' worth lie between two points, and how muffled that makes a sound
client/src/store.ts        addShelves(): stocked shelving over the shelf collision boxes; storeSurface(): textured walls and floor
client/src/harbour.ts      addHarbour(): the harbour around the store, as instanced scenery with no collision
client/src/paving.ts       addPavingVariation(): world-space brightness and damp patches on harbour paving
client/src/variation.ts    addSurfaceVariation(): breaks up tiled textures: hex tiling, shuffled brick courses or tiles, world-space drift and grime
client/src/surfaces.ts     surface(scene, name, { tint }): the surface library as cached PBR materials: tint, cut-outs, variation
client/src/surfaceTable.ts SURFACES: every library surface's tile size in meters, texture size, tint and variation
client/src/surfaceViewer.ts the surface viewer at /surfaces.html: each surface on a floor and walls, by flashlight or grazing light
client/src/lamps.ts        addStreetLamps(): glowing lamp faces, and lamp light summed in every PBR shader (not scene lights)
client/src/scene.ts        world, lights and fog, first-person camera, lobby camera
client/src/screens.ts     addScreens(): the TVs of `tv` tiles, showing static and droning a loop
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
scripts/harbour.ts         the harbour's ground and what's in the way, from its model, into shared/harbour.json (`pnpm run harbour`)
scripts/unity-import/      prefabs from a Unity .unitypackage → textured .glb in assets/, through Blender
scripts/models/            models made in code: one Python script per model, built in Blender (`pnpm run model`)
scripts/surfaces/          the surface library's baker: periodic noise, one recipe per surface (`pnpm run surface`)
scripts/image.ts           images from Nano Banana Pro (Gemini) into assets/ (`pnpm run image`, see the `image` skill)
```

## How the game works

- The **server is authoritative**. Clients send inputs (`MoveInput`) through the input buffer; the
  server runs `stepMover` for each at 30 Hz and syncs state. Each client **predicts its own
  player** with the same step and **interpolates everyone else**, so `shared/movement.ts` must stay
  a pure function of `(state, input, dt)`: no clocks, randomness or other state.
- **Mechanics** (`shared/mechanics.ts`): the numbers players move by, walk and run speed, stamina,
  gravity and the rest, are a `Mechanics` value that `stepMover` and `paceAt` are given, never read
  from constants. The room owns them in `state.mechanics`; the client predicts with the synced
  values, so changing them doesn't rubber-band. The constants in `shared/constants.ts` are the
  defaults. In dev, the `tune` message changes them for the room, held to `MECHANICS_RANGE`.
  Client code that depends on one (as the tired effect does on `runAgain`) reads the room's.
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
- **Flashlights:** F (Y on a controller; `light` message) switches the flashlights in the player's
  hands on, or off if any is on; `Item.on` syncs it, and a dropped one stays on. Each is a
  `SpotLight` from its lens at +x. The player's own is held up and aimed where they look
  (`POSES.aim` in `client/src/hands.ts`); everyone else's points the way its holder looks, as an
  item with `front` in `ITEM_KINDS` is carried. Surfaces take `MAX_LIGHTS` lights, chosen by
  `LIGHT_PRIORITY` (`client/src/scene.ts`): the sky and sun, then our own, then others'.
- Lasting state goes through `server/src/persist.ts`, keyed by player name, never `sessionId`.
- **Modes** (`shared/modes.ts`, `state.mode`): `?mode=playground` or `?mode=game`, else the
  level's own: the playground level is playground, the store and generated levels are game. Each
  level and mode has its own rooms, so clients and bots always send the mode they resolved with
  `modeFor()`; the harbour level is playground by default too. The **playground** has no rounds,
  nobody dies (falling respawns), the lights are on the dimmer and players come back where they left. A **game** runs rounds in `state.phase`:
  `lobby` (everyone in the truck, R / X to ready; all ready starts a short countdown), `raid`
  (`RAID_TIME` to dawn; ends when everyone alive stands in the truck and has pressed R / X to leave,
  or at dawn), `results` (cleared if `state.loot` reached `state.quota`, then the next lobby). Both
  the raid starting and the lobby put every item back and everyone in the truck. Its lights stay at
  `GAME_LIGHT`, and the dimmer does nothing.
- **Roles** (`Player.role`): only those `playing` are in the building, move and have a physics
  body. Falling in a raid makes a player `dead`, being outside the truck at dawn `lost`, and joining
  during a raid `waiting`. They all spectate until the next round: the camera looks through the
  eyes of someone still playing, E / Q (RB / LB) step through them, and that player's character is
  hidden on their screen.
- **The truck** is the level's `dock` for now. Loot is whatever's in it, even still in someone's
  hands; `ITEM_KINDS[kind].value` is what each sells for.

## Running

This is a solo, local project. Start everything with **`pnpm run dev`** (requires Node ≥ 22.12):

- Game: `http://127.0.0.1:5173/`. The game server listens on `127.0.0.1:2567`, and the browser
  reaches it through Vite's proxy at `/ws`.
- Both reload on file changes (Vite HMR for the client, `tsx watch` for the server; players rejoin
  by themselves). Logs go to that terminal, and Ctrl+C stops both.
- `PORT`, `SERVER_PORT` and `BASE` environment variables override the defaults.
- **Levels** are in `shared/level.ts`. The playground is the default: a brick hall with each item
  kind, a dock, a pit with a plank across, stairs and ladders up two storeys and down to a
  basement, and a dimmer for the lights, to try things out in. The store is at `http://127.0.0.1:5173/?level=store`.
  The **harbour** (`?level=harbour`) is the store with the harbour around it to walk on: players
  start on the street between the warehouses, the store's lot is a jump down from the quay, and the
  water drowns. The harbour model draws it; `pnpm run harbour` works out its floors (`ground`) and
  boxes (`scenery`) from that model into `shared/harbour.json`, which is in git: run it again when
  the harbour changes. Lookups in big levels go through a grid (`near()` in `shared/spatial.ts`).
  New models go on show in the playground through `CONCEPTS` in `client/src/playground.ts`. Each level has its own
  rooms; bots join the playground unless `LEVEL` says otherwise.
- **Tiles** (`shared/tiles.ts`): the playground is a grid of 4 m cells on storeys 3 m apart,
  written as characters (`F` floor, `T` a TV showing static, `#` solid, `P` pit, `|`/`=` plank bridge, `^>v<` stairs and
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
- **Stairs slow walkers down:** `paceAt()` in `shared/movement.ts` gives the share of flat speed
  kept and the effort for going one way from a point, with speed along the slope and climbing
  dearer (`UPHILL`). Anything that walks the level, enemies included, should move at its pace.
- **Running** (Shift, or click the left stick) takes stamina; running out leaves a player winded
  until it's back to `RUN_AGAIN`. Both are in `MoverState`, so they're predicted like position.
- Console (dev only): `window.__game` → `{ player(), views, items, world, engine, tune }`.
- **Tunables:** values worth tuning by ear and eye go through `tunables()` in `client/src/tuning.ts`
  instead of bare constants: `const STEPS = tunables("Sound/Footsteps", { own: { value: 0.21, min:
  0, max: 1, hint } })`, then read `STEPS.own` where it's used, so changes apply live. Values that
  must be pushed into something, like a Babylon pipeline, go through its `onChange`; ones kept
  elsewhere, like the room's mechanics, through `addSetting({ get, set, ... })`. The group is
  `"Section/Group"` in the panel. Register new features' feel, sound and look settings this way.
- Controllers need a secure page (HTTPS or localhost), and a button press before they show up.
  Holding both sticks down for a second reloads the page.

## Debugging

You can't see the browser, so check your work from the terminal, with `pnpm run dev` running:

- **Compile errors:** `curl -s http://127.0.0.1:5173/src/main.ts` returns an HTML error page if the
  file doesn't compile.
- **Bot players:** `pnpm exec tsx scripts/bot.ts [name] [seconds]` joins your game server, walks in a
  square and prints every player's position each second (`LEVEL=` and `MODE=` choose the room).
- **Rounds:** start a second server with a short raid, `SERVER_PORT=2601 RAID_TIME=12 pnpm exec tsx
  server/src/index.ts`, and point bots at it, rather than waiting ten minutes for dawn.
- **Surface viewer:** `http://127.0.0.1:5173/surfaces.html` shows the surface library on a floor and
  a corner of walls, through the game's pipeline, lit by the flashlight or a light low across them
  (L), with tint pickers; `?engine=webgl` for WebGL and `window.__surfaces.show({ floor, wall })`.
- **Tile viewer:** `http://127.0.0.1:5173/tiles.html` draws tiles without a server, built and
  drawn by the game's own code: a generated level by seed (`?source=generated&seed=7`, `[`/`]` step
  through seeds), every tile on its own (`?source=catalogue`), the playground's grid, or one written
  by hand in its text box. Cut storeys away, show collision boxes, click a cell for its sockets,
  edges and neighbours, and Tab to fly through at eye height. `window.__tiles` in the console.
- **Tuning panel:** `__game.tune()` in the browser console opens and closes a panel of every
  registered tunable: sound, rendering, feel, controls and the room's mechanics. Keys typed in it
  don't reach the game. In dev, what it changes is kept in that browser's localStorage until reset,
  and mechanics are sent to the room again on every join. `__game.tune.changes()` (or the panel's
  Copy changes) lists what differs from the code, as `Group › key: default → now`: to bake one in,
  change the `value` (or the constant) in the code. Mechanics are the room's, so tuning them in the
  playground changes them for everyone there: try them in a level of your own, like
  `?level=generated-1`.

## Testing in a browser

- Drive Chrome with the `mcp__chrome__*` tools (`new_page`, then `take_screenshot`,
  `list_console_messages`, `evaluate_script`), pointed at the checkout's dev server. Use
  `isolatedContext` to give each player its own page, and a `?name=` per player.
- The tools connect to `127.0.0.1:9222`. If nothing listens there, start Chrome **headless and
  muted**, with its own profile in the scratchpad. Headless, so input on the user's desktop can't
  steer the test player; muted, because the game's sound otherwise plays out of the user's
  speakers:
  `"/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" --headless=new --mute-audio --remote-debugging-port=9222 --user-data-dir=<scratchpad>/chrome --no-first-run about:blank`.
  If one is already running without `--mute-audio`, stop it and start this one.
- Close every page you opened when you're done (`close_page`), and leave none of the game open
  behind you: a page left open keeps a player in the room and keeps making sound.
- It renders on the GPU, not in software: WebGPU on the RTX 4070 SUPER and WebGL through
  ANGLE/D3D11, at 60 fps. To check, in `evaluate_script`: `(await navigator.gpu.requestAdapter()).info`
  says `nvidia` and `isFallbackAdapter: false`. `__game.engine.getFps()` reads low for a few
  seconds after a page loads.
- Keys can be pressed from a script with `dispatchEvent(new KeyboardEvent("keydown", { code }))`
  and a matching `keyup`; set `__game.player().camera.rotation` to look around.

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

- **Models made in code** (the `make-model` skill has the workflow): `scripts/models/<name>.py` builds a model with the helpers in
  `scripts/models/lib.py`, whose docstring has the conventions (front faces Blender's -y, meters,
  `ITEM`, `OUT`, `ORIGIN`, `TRIS`, `AO`). `pnpm run model <name>` runs it in Blender in the
  background, bakes its `procedural()` materials into textures and its ambient occlusion onto a
  second UV set (Cycles, on the GPU if there is one), writes the `.glb` to `assets/` with WebP
  textures, checks it against `ITEM_KINDS` and its triangle budget, and renders
  `node_modules/.cache/models/<name>/preview.png` from four sides. Look at the preview, then at the
  model in the game, whose lighting differs. Screen-space AO only adds contact shadows between
  things, so a model's own creases come from its bake. The scripts are in git and the models aren't, so run
  `pnpm run assets:backup` after building.
- **Surfaces made in code:** `scripts/surfaces/recipes/<name>.ts` is a function of uv giving colour,
  tint amount, height in mm, AO, roughness and metalness, from the periodic noise in
  `scripts/surfaces/noise.ts`, so bakes tile. Its tile size and texture size are in
  `client/src/surfaceTable.ts`. `pnpm run surface <name…|all>` bakes
  `assets/textures/surfaces/<name>-{base,normal,orm}.webp` on worker threads (`--draft 512` for a quick
  look) and a contact sheet in `node_modules/.cache/surfaces/<name>/preview.png`: look at it, then at the
  surface in the surface viewer. Meshes using `surface()` need UVs in meters ÷ `SURFACES[name].tile`,
  as `worldBox(…, SURFACES[name].tile)` makes; `upright` ones are a storey tall, v 0 on the floor.
- `loadModel(scene, "models/props/crate.glb", placeholder)` shows the placeholder until the file
  exists, so use the final path from day one. Vite answers a missing asset with `200` and its HTML
  page, so check the content type, not only the status, when testing a URL with curl.
- Folders: `models/{characters,props,level}`, `textures/`, `audio/{sfx,music}`, `ui/`. Lowercase
  kebab-case. `.glb` from Blender: Y-up, transforms applied, meters.
- Anything bundled with the client uses `import.meta.env.BASE_URL`, never a bare `/` path.
