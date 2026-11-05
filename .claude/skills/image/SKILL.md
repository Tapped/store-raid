---
name: image
description: Generate or edit an image with Nano Banana Pro (Gemini 3 Pro Image) and save it into the shared assets/ folder - textures, decals, signs, posters, product labels, UI art, sky or backdrop images, concept art. Use when the user asks to generate, draw, paint or make an image or texture, or to change an existing one.
---

# Generating images

`scripts/image.ts` calls the Gemini API and writes the result into the shared `assets/` folder
(next to `main/`, not in git). Run it from the checkout:

```
pnpm run image -- "<prompt>" <path in assets/> [--ref file]... [--aspect 16:9] [--size 1K|2K|4K] [--resize 1024[x512]] [--force]
```

- The output's extension picks the format. Use `.webp` for anything the game loads, `.png` for a
  source image you'll edit further.
- `--ref` passes an existing image to edit or to follow for its style (a path in `assets/` or
  anywhere). Repeat it for several references.
- It won't overwrite a file unless you pass `--force`. Generating costs money, so don't loop it
  without a reason. One image per idea, then look at it.
- The key is `GEMINI_API_KEY`, from the environment or a git-ignored `.env` in the checkout (or in
  `main/`, which worktrees fall back to; see `.env.example`). If it's missing, ask the user to add
  it. Never print the key, read `.env` aloud, or put it in a tracked file.

## Workflow

1. Choose the path by the asset folder conventions in `CLAUDE.md`: `textures/...`, `ui/...`,
   lowercase kebab-case. Try ideas in `textures/drafts/` first.
2. Write a specific prompt (see below) and run the script.
3. **Look at the result with the Read tool** before using it. If it's wrong, rewrite the prompt, or
   pass the result back with `--ref` and say what to change. That usually works better than
   starting over.
4. Wire it into the game (`assetUrl()`, `surfaceMaterial()` in `client/src/graphics.ts`, or a baked
   model's material) and check it in the browser with the `mcp__chrome__*` tools, because the
   game's lighting and colour grading change how it looks.
5. Tell the user to run `pnpm run assets:backup`, or run it yourself if they asked you to.

## Prompts for game textures

- Say what the image is for: "a seamless tileable texture of ..., flat, orthographic, top-down,
  even diffuse lighting, no shadows, no perspective, fills the whole frame". The PBR pipeline adds
  the lighting, so baked-in highlights and shadows look wrong in the game.
- The model can't guarantee that a texture tiles. Check the edges, and if they show, ask it to fix
  them with the result as `--ref`, or make a non-repeating texture (decals, labels, posters).
- Textures: `--aspect 1:1 --resize 1024` (or 512) gives power-of-two sizes. Signs and posters: use
  the real aspect of the surface.
- It renders text well: put the exact words in quotes in the prompt. The game is set in a megastore
  at night (see `PLAN.md`), so for store branding make up names. Don't copy real brands or logos.
- It only makes colour images. Normal, roughness and other maps have to come from somewhere else,
  such as a Blender bake (`scripts/models/`) or derived in code.
