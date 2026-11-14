import {
  Color3,
  LoadAssetContainerAsync,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  type Scene,
} from "@babylonjs/core";
import { assetUrl } from "./assets";
import { drawInstances } from "./graphics";
import { addStreetLamps } from "./lamps";
import { addPavingVariation } from "./paving";

const MODEL = "models/level/harbour.glb";
const LAYOUT = "models/level/harbour.json";
const WATER_SIZE = 1500;
const PAVING = ["M_TileConcrete", "M_Road", "M_Ground"];
/** How high the street is where the first street light stands. */
const LAMP_GROUND = 0.6;

interface Layout {
  water: { x: number; y: number; z: number }[];
  /** Per model: 16 numbers per copy, Unity's world matrices, in meters around the store. */
  placements: Record<string, number[]>;
}

/**
 * Unity's matrices apply after Unity's own flip of x, but a glTF mesh here sits under a root that
 * flips x last. Conjugating by that flip gives the matrix to use under the root.
 */
function underGltfRoot(matrices: number[]): Float32Array {
  const out = Float32Array.from(matrices);
  for (let i = 0; i < out.length; i += 16) {
    for (const k of [1, 2, 3, 4, 8, 12]) out[i + k] = -out[i + k];
  }
  return out;
}

/** The copies that don't lie within a building's footprint, a meter in from its walls. */
function outside(
  matrices: number[],
  site: { x: number; z: number; width: number; depth: number },
): number[] {
  const kept: number[] = [];
  for (let i = 0; i < matrices.length; i += 16) {
    const [x, z] = [matrices[i + 12], matrices[i + 14]];
    const within =
      x > site.x + 1 &&
      x < site.x + site.width - 1 &&
      z > site.z + 1 &&
      z < site.z + site.depth - 1;
    if (!within) kept.push(...matrices.slice(i, i + 16));
  }
  return kept;
}

/**
 * The harbour around the store, as scenery with no collision or shadows. Each model is one mesh
 * drawn many times, so thousands of copies stay cheap. If the files are missing, it's left out.
 * With a `site`, the paving under the building that stands there is left out too; `lamps` are
 * more street lights, where a level wants them.
 */
export async function addHarbour(
  scene: Scene,
  site?: { x: number; z: number; width: number; depth: number },
  lamps: { x: number; y: number; z: number }[] = [],
): Promise<void> {
  const response = await fetch(assetUrl(LAYOUT));
  if (!response.headers.get("content-type")?.includes("json")) return;
  const layout = (await response.json()) as Layout;
  const container = await LoadAssetContainerAsync(assetUrl(MODEL), scene);
  container.addAllToScene();
  // More street lights where a level asks: copies of the first, moved. The model's origin is a
  // little under the ground it stands on.
  const lights = layout.placements.SM_StreetLight;
  if (lights && lights.length >= 16) {
    const sink = lights[13] - LAMP_GROUND;
    for (const lamp of lamps) {
      const copy = lights.slice(0, 16);
      [copy[12], copy[13], copy[14]] = [lamp.x, lamp.y + sink, lamp.z];
      lights.push(...copy);
    }
  }

  for (const mesh of container.meshes) {
    if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) continue;
    const model = (mesh.parent?.name === "__root__" ? mesh.name : mesh.parent?.name)?.replace(
      /_primitive\d+$/,
      "",
    );
    const matrices = model ? layout.placements[model] : undefined;
    if (!matrices) {
      mesh.setEnabled(false);
      continue;
    }
    // Paving under a building would lie as a lid over its stairwells and pits.
    const kept = model === "SM_Ground" && site ? outside(matrices, site) : matrices;
    drawInstances(mesh, underGltfRoot(kept));
    mesh.isPickable = false;
  }
  const streetLights = layout.placements.SM_StreetLight;
  if (streetLights) addStreetLamps(scene, underGltfRoot(streetLights));

  for (const material of container.materials) {
    if (material instanceof PBRMaterial && PAVING.includes(material.name)) {
      material.albedoColor = new Color3(0.45, 0.45, 0.47); // dark like wet asphalt, as in the store
      addPavingVariation(material);
    }
    material.freeze();
  }

  for (const { x, y, z } of layout.water) {
    const water = MeshBuilder.CreateGround(
      "water",
      { width: WATER_SIZE, height: WATER_SIZE },
      scene,
    );
    water.position.set(x, y, z);
    const material = new PBRMaterial("waterMat", scene);
    material.albedoColor = new Color3(0.05, 0.13, 0.17);
    material.metallic = 0;
    material.roughness = 0.15;
    water.material = material;
    water.isPickable = false;
  }
}
