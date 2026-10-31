import { Mesh, PBRMaterial, type Scene, Texture } from "@babylonjs/core";
import { LEVEL_BOXES } from "../../shared/level";
import { assetUrl, loadContainer } from "./assets";
import type { World } from "./scene";

const BAY_LENGTH = 2;
const SHELF_DECKS = [0.335, 0.875, 1.415, 1.955];
const BOX_SCALE = 0.42;
const BOX_SPACING = 0.6;
const BOX_ROW = 0.3; // how far boxes sit from the middle of a shelf
const BOX_CHANCE = 0.75;

/** PBR surface from the store's textures, repeating `tiles` times across the mesh's UVs. */
export function storeSurface(
  name: "floor" | "wall" | "dock",
  scene: Scene,
  tiles: [number, number] = [1, 1],
): PBRMaterial {
  const texture = (kind: string, sRGB: boolean) => {
    const t = new Texture(assetUrl(`textures/store/${name}-${kind}.webp`), scene, {
      gammaSpace: sRGB,
    });
    [t.uScale, t.vScale] = tiles;
    return t;
  };
  const material = new PBRMaterial(`${name}Surface`, scene);
  material.albedoTexture = texture("base", true);
  material.bumpTexture = texture("normal", false);
  material.metallicTexture = texture("orm", false);
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  material.useAmbientOcclusionFromMetallicTextureRed = true;
  material.useRoughnessFromMetallicTextureAlpha = false;
  material.metallic = 1;
  material.roughness = 1;
  return material;
}

/** A matrix for a mesh under a glTF root, which flips x. */
function placed(x: number, y: number, z: number, scale = 1, turn = 0): number[] {
  const c = Math.cos(turn) * scale;
  const s = Math.sin(turn) * scale;
  return [c, 0, s, 0, 0, scale, 0, 0, -s, 0, c, 0, -x, y, z, 1];
}

/** Same stock every time and on every screen, without a stored list. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

async function drawCopies(world: World, model: string, matrices: number[], shadows: boolean) {
  const container = await loadContainer(world.scene, `models/props/${model}.glb`);
  if (!container) return false;
  container.addAllToScene();
  const buffer = Float32Array.from(matrices);
  for (const mesh of container.meshes) {
    if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) continue;
    mesh.thinInstanceSetBuffer("matrix", buffer, 16, true);
    mesh.thinInstanceRefreshBoundingInfo();
    mesh.receiveShadows = true;
    if (shadows) world.shadows.addShadowCaster(mesh);
  }
  return true;
}

/** Replace the plain shelf boxes with stocked shelving, once the models have loaded. */
export async function addShelves(world: World): Promise<void> {
  const shelves = LEVEL_BOXES.filter((box) => box.kind === "shelf");
  const bays: number[] = [];
  const boxes: number[] = [];
  const next = random(7);
  for (const shelf of shelves) {
    const x = (shelf.minX + shelf.maxX) / 2;
    const count = Math.round((shelf.maxZ - shelf.minZ) / BAY_LENGTH);
    for (let i = 0; i < count; i++) bays.push(...placed(x, 0, shelf.minZ + (i + 0.5) * BAY_LENGTH));
    for (const y of SHELF_DECKS) {
      for (const side of [-1, 1]) {
        for (let z = shelf.minZ + BOX_SPACING / 2; z < shelf.maxZ; z += BOX_SPACING) {
          if (next() > BOX_CHANCE) continue;
          const turn = Math.PI / 2 + (next() - 0.5) * 0.3;
          boxes.push(...placed(x + side * BOX_ROW, y, z, BOX_SCALE, turn));
        }
      }
    }
  }
  if (!(await drawCopies(world, "shelf-bay", bays, true))) return;
  for (const mesh of world.plainShelves) mesh.dispose();
  await drawCopies(world, "shelf-box", boxes, false);
}
