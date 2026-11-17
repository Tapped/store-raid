/**
 * The surface library (`assets/textures/surfaces/<name>-{base,normal,orm}.webp`, baked by
 * `pnpm run surface`) staged for `surfaces.py`: each texture as a PNG Unreal can import, in
 * `unreal/Saved/Import/surfaces/`, and `surfaces.json` with what the material needs from the table in
 * client/src/surfaceTable.ts: each surface's tile in meters, its default tint in sRGB (none if it
 * can't be painted) and whether it's upright. The detail maps (`detail-*`) aren't surfaces to draw
 * with, so they're left out. A PNG is only written again when its WebP is newer.
 */

import { existsSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { SURFACE_NAMES, SURFACES } from "../../../client/src/surfaceTable";
import { ASSETS, STAGED } from "./stage";

export const KINDS = ["base", "normal", "orm"] as const;

export interface StagedSurface {
  name: string;
  tile: number;
  tint: readonly [number, number, number] | null;
  upright: boolean;
  cutout: boolean;
}

/** Stages the surfaces whose name contains one of `filters`, or all of them; returns them. */
export async function stageSurfaces(filters: string[]): Promise<StagedSurface[]> {
  const out = join(STAGED, "surfaces");
  await mkdir(out, { recursive: true });
  const staged: StagedSurface[] = [];
  let written = 0;
  for (const name of SURFACE_NAMES) {
    if (name.startsWith("detail-")) continue;
    if (filters.length && !filters.some((filter) => name.includes(filter))) continue;
    const sources = KINDS.map((kind) => join(ASSETS, "textures/surfaces", `${name}-${kind}.webp`));
    if (!sources.every((source) => existsSync(source))) {
      console.log(`${name}: not baked (pnpm run surface ${name}), left out`);
      continue;
    }
    for (const [index, source] of sources.entries()) {
      const target = join(out, `${name}-${KINDS[index]}.png`);
      if (existsSync(target) && statSync(target).mtimeMs > statSync(source).mtimeMs) continue;
      await sharp(source).png().toFile(target);
      written++;
    }
    const spec = SURFACES[name];
    staged.push({
      name,
      tile: spec.tile,
      tint: spec.tint ?? null,
      upright: spec.upright ?? false,
      cutout: spec.cutout ?? false,
    });
  }
  writeFileSync(join(out, "surfaces.json"), `${JSON.stringify(staged, null, 2)}\n`);
  console.log(`${staged.length} surfaces, ${written} textures staged now`);
  return staged;
}
