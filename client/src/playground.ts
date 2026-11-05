import {
  Color3,
  DynamicTexture,
  type HemisphericLight,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { loadContainer } from "./assets";
import { surfaceMaterial } from "./graphics";
import type { World } from "./scene";

/**
 * Things to look at, standing along the east wall: models made for the game but not in it yet.
 * Drawn only, with no collision. Add a line here to put a new one out.
 */
const CONCEPTS: { model: string; label: string; x: number; z: number; turn?: number }[] = [
  { model: "models/characters/tick.glb", label: "Large tick", x: 9.5, z: -4, turn: -Math.PI / 2 },
];

/** Steel I-beams across the hall under the roof, this far apart. */
const BEAM_SPACING = 3;
const BEAM_DEPTH = 0.4;
const FLANGE = 0.2;

/**
 * The playground's hall: a roof on steel beams over the brick walls from shared/level.ts, even
 * light, and the concepts on show. Its items and dock come from the level like any other.
 */
export async function addPlayground(world: World): Promise<void> {
  const { scene, level } = world;
  const roof = level.roof ?? 6;
  const walls = level.boxes;
  const minX = Math.min(...walls.map((b) => b.minX));
  const maxX = Math.max(...walls.map((b) => b.maxX));
  const minZ = Math.min(...walls.map((b) => b.minZ));
  const maxZ = Math.max(...walls.map((b) => b.maxZ));

  // Indoors: bright, even light from the roof lights, and no fog to speak of.
  const hemi = scene.getLightByName("hemi") as HemisphericLight | null;
  if (hemi) {
    hemi.intensity = 0.75;
    hemi.diffuse = new Color3(1, 0.95, 0.85);
    // Light off the floor, so the roof and beams aren't black.
    hemi.groundColor = new Color3(0.55, 0.52, 0.48);
  }
  scene.fogDensity = 0.0005;
  scene.environmentIntensity = 0.5;

  // The roof is not a shadow caster: the sun stands in for the roof lights.
  const panels = surfaceMaterial("roof", scene, new Color3(0.55, 0.56, 0.57), {
    roughness: 0.7,
    metallic: 0.1,
  });
  const slab = MeshBuilder.CreateBox(
    "roof",
    { width: maxX - minX, depth: maxZ - minZ, height: 0.15 },
    scene,
  );
  slab.position.set((minX + maxX) / 2, roof + 0.075, (minZ + maxZ) / 2);
  slab.material = panels;

  const steel = surfaceMaterial("steel", scene, new Color3(0.3, 0.33, 0.37), {
    roughness: 0.5,
    metallic: 0.4,
  });
  const beams: Mesh[] = [];
  const width = maxX - minX;
  for (let z = minZ + BEAM_SPACING / 2; z < maxZ; z += BEAM_SPACING) {
    // Top flange, web, bottom flange.
    for (const [w, h, d, y] of [
      [width, 0.03, FLANGE, roof - 0.015],
      [width, BEAM_DEPTH - 0.06, 0.02, roof - BEAM_DEPTH / 2],
      [width, 0.03, FLANGE, roof - BEAM_DEPTH + 0.015],
    ]) {
      const part = MeshBuilder.CreateBox("beam", { width: w, height: h, depth: d }, scene);
      part.position.set((minX + maxX) / 2, y, z);
      beams.push(part);
    }
  }
  // Merged into one draw: dozens of boxes that never move.
  const steelwork = Mesh.MergeMeshes(beams, true);
  if (steelwork) {
    steelwork.material = steel;
    steelwork.receiveShadows = true;
  }

  // Strip lights between the beams: they only glow, the hemispheric light does the lighting.
  const glow = new StandardMaterial("roof-light", scene);
  glow.disableLighting = true;
  glow.emissiveColor = new Color3(1, 0.93, 0.8);
  const strips: Mesh[] = [];
  for (let z = minZ + BEAM_SPACING; z < maxZ - BEAM_SPACING / 2; z += BEAM_SPACING) {
    for (const x of [-width / 4, width / 4]) {
      const strip = MeshBuilder.CreateBox(
        "roof-light",
        { width: 3, height: 0.05, depth: 0.25 },
        scene,
      );
      strip.position.set((minX + maxX) / 2 + x, roof - 0.05, z);
      strips.push(strip);
    }
  }
  const lights = Mesh.MergeMeshes(strips, true);
  if (lights) lights.material = glow;

  for (const concept of CONCEPTS) await addConcept(world, concept);
}

async function addConcept(world: World, concept: (typeof CONCEPTS)[number]) {
  const { scene } = world;
  const holder = new TransformNode(`concept-${concept.label}`, scene);
  holder.position.set(concept.x, 0, concept.z);
  holder.rotation.y = concept.turn ?? 0;

  // A label above it, readable from anywhere.
  const tag = MeshBuilder.CreatePlane(`${concept.label}-tag`, { width: 1.6, height: 0.3 }, scene);
  tag.parent = holder;
  tag.position.y = 1.4;
  tag.billboardMode = TransformNode.BILLBOARDMODE_ALL;
  tag.isPickable = false;
  const texture = new DynamicTexture(`${concept.label}-text`, { width: 512, height: 96 }, scene);
  texture.hasAlpha = true;
  texture.drawText(
    concept.label,
    null,
    66,
    "bold 54px system-ui, sans-serif",
    "#f2e6c8",
    "transparent",
  );
  const material = new StandardMaterial(`${concept.label}-tagmat`, scene);
  material.diffuseTexture = texture;
  material.emissiveColor = Color3.White();
  material.disableLighting = true;
  material.useAlphaFromDiffuseTexture = true;
  tag.material = material;

  const container = await loadContainer(scene, concept.model);
  if (!container) return;
  // A glTF root carries its own handedness transform, so move and turn the holder instead.
  for (const root of container.instantiateModelsToScene().rootNodes) root.parent = holder;
  for (const mesh of holder.getChildMeshes()) {
    if (mesh === tag) continue;
    mesh.receiveShadows = true;
    world.shadows.addShadowCaster(mesh);
  }
}
