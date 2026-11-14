---
name: make-model
description: Make or change a 3D model in code - props, loot items, scenery, creatures and enemies - as a Python script in scripts/models/ built in Blender with `pnpm run model`. Use when the user asks to model, build or make a 3D model of something, or to change how an existing model looks.
---

# Making models

Models are Python scripts in `scripts/models/`, one per model, built in Blender in the background
with `pnpm run model <name>`. Read these first. This skill doesn't repeat them:

- The **Assets** section of `CLAUDE.md`: the build command, the preview, `loadModel()` and backing up.
- The docstring at the top of `scripts/models/lib.py`: axes (front faces -y), meters, and the
  constants `ITEM`, `OUT`, `ORIGIN`, `TRIS`, `SMOOTH_ANGLE`, `AO`, `AO_DISTANCE`.
- An existing script like the one you're making: `box.py` (an item, procedural cardboard, printed
  text), `tv.py` (a hard-surface item), `tick.py` (an organic creature).

## Workflow

1. **Get a reference.** For anything with a designed look (creatures, characters, hero props), make
   one with the `image` skill before you model: first a concept in `assets/concept/<name>.png`, then
   an orthographic sheet from it (`--ref` the concept and ask for top, side and front views on a
   flat background, with flat lighting and no perspective). Read the sheet's proportions off it:
   length against width and height, where limbs attach, how thick they are. Simple props (crates,
   shelves) don't need one.
2. **Size it.** Items take their size from `ITEM_KINDS` through `lib.item_size()`. For anything else,
   decide the real size in meters and keep the main proportions as constants at the top of the
   script, as `tick.py` does with `CENTER` and `HALF`.
3. **Build it from lib helpers.** `box`, `cylinder`, `text` and `shape` cover hard surfaces.
   `ellipsoid` (with `deform` for eggs, bulges and grooves), `tube` and `jointed` cover organic
   shapes. If you write a new general shape, add it to `lib.py` with a docstring rather than
   keeping it in the model.
4. **Shade it.** Use `lib.procedural()` materials, whose coordinates are the model's meters, so
   grooves and plates in the shader can line up with the same constants as the geometry. Use
   `lib.material()` for small plain parts.
5. **Draft and look.** Iterate with `pnpm run model <name> --draft` and Read
   `node_modules/.cache/models/<name>/preview.png`. A draft renders the live scene with its
   procedural materials unbaked and writes nothing else, in about 5–15 s. A full build bakes,
   which takes minutes for a big model. Compare the draft with the reference side by side and list
   what's off, then fix the biggest things first. Two or three rounds is normal.
   - `--ref concept/<name>-sheet.png` puts the reference on the sheet beside the views.
   - `--focus <material>` or `--focus=x,y,z,r` (meters, in the script's axes) frames a close-up of
     one part. `--views front,top` renders only those views (also side, three-quarter, back, left,
     rear, below). Fewer views render faster.
   - The first build starts a Blender that stays in the background for 15 minutes, so later
     builds skip its startup. After editing `build.py`, stop it with `pnpm run model --stop`; every
     other module is reloaded for each job.
   - A draft has no baked occlusion: the studio light's shadows stand in. Seams, texture resolution
     and the baked occlusion only show in a full build.
5b. **Build it once for real.** Run `pnpm run model <name>` when the draft looks right, and look at
   its preview for bake problems. To check a model in the game sooner, `--quick` bakes textures at
   a quarter of the size in a fraction of the time. Always build it again without `--quick` before
   you finish.
6. **Check it in the game** with the `mcp__chrome__*` tools. Put it on show in the playground
   (`CONCEPTS` in `client/src/playground.ts`, at `?level=playground`) to see it in even light, then
   in the store, which is dark, graded and fogged, so a model that reads in the preview can
   disappear or look flat there.
7. Commit the script and tell the user to run `pnpm run assets:backup` (the .glb isn't in git).

## Lessons so far

- **Colours:** base colours want to be darker and more saturated than you'd guess. Linear values
  around 0.05 to 0.2 read as natural materials. Above 0.3 looks chalky and grey in the preview.
- **Bump:** surface detail needs `bump(distance=...)` of several millimeters before it shows at
  game distance. Big shapes (grooves, plate edges, panel seams) belong in the geometry as well as
  the shader, or the silhouette stays smooth.
- **Thickness:** limbs and handles drawn at their "real" thinness look spindly and spider-like.
  Make them thicker than the reference suggests.
- **Organic models:** raise `SMOOTH_ANGLE` (60 to 70) so tubes and blobs shade smooth, and lower
  `AO_DISTANCE` to roughly the size of the creases you want darkened.
- **Rings where you shape:** put `ellipsoid(poles=...)` along the axis you'll pinch or groove, and
  give it enough rings that every groove spans two or three of them.
- **Budget:** set `TRIS`. A prop is a few thousand triangles. A creature that several of can be on
  screen at once should stay around 10k.
- **Animation:** a model that moves declares bones with `lib.bone()`, binds each part with
  `lib.bind()`, and gives limbs a chain with `jointed(..., bone=...)`; `build.py` then exports it
  skinned (rigid weights). `tick.py` is the example, and `client/src/tick.ts` moves its bones in
  code. Put each limb's joints in one plane through its root so the game can bend it in 2D.
