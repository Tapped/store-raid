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
import { TickView } from "./tick";

/**
 * Things to look at, standing along the east wall: models made for the game but not in it yet.
 * Drawn only, with no collision. Add a line here to put a new one out. A creature with `wander`
 * walks about within that many meters of its place instead of standing still.
 */
const CONCEPTS: {
  model: string;
  label: string;
  x: number;
  z: number;
  turn?: number;
  wander?: number;
}[] = [
  {
    model: "models/characters/tick.glb",
    label: "Large tick",
    x: 11.5,
    z: -8,
    turn: -Math.PI / 2,
    wander: 2,
  },
];

/** How bright the hall is with the dimmer fully up. */
const HEMI = 0.75;
const ENVIRONMENT = 0.5;
const SUN = 0.8;
const STRIP_GLOW = new Color3(1, 0.93, 0.8);

/** What the playground lets the rest of the page change. */
export interface Playground {
  /** Light the hall as the dimmer says, from 0 (off) to 1. */
  setLight(brightness: number): void;
}

/** Steel I-beams across the hall under the roof, this far apart. */
const BEAM_SPACING = 3;
const BEAM_DEPTH = 0.4;
const FLANGE = 0.2;

/**
 * The playground's hall: a roof on steel beams over the brick walls from shared/level.ts, even
 * light on a dimmer, and the concepts on show. Its items and dock come from the level like any other.
 */
export function addPlayground(world: World): Playground {
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
    hemi.intensity = HEMI;
    hemi.diffuse = new Color3(1, 0.95, 0.85);
    // Light off the floor, so the roof and beams aren't black.
    hemi.groundColor = new Color3(0.55, 0.52, 0.48);
  }
  scene.fogDensity = 0.0005;
  scene.environmentIntensity = ENVIRONMENT;
  const sun = scene.getLightByName("sun");

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
  glow.emissiveColor = STRIP_GLOW.clone();
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

  for (const concept of CONCEPTS) void addConcept(world, concept);

  const showDimmer = addDimmer(world);
  let shown = 1;
  return {
    setLight(brightness) {
      if (brightness === shown) return;
      shown = brightness;
      // Squared, so the dim end, where the testing happens, gets most of the dimmer's travel.
      const light = brightness * brightness;
      if (hemi) hemi.intensity = HEMI * light;
      if (sun) sun.intensity = SUN * light;
      scene.environmentIntensity = ENVIRONMENT * light;
      glow.emissiveColor = STRIP_GLOW.scale(light);
      showDimmer(brightness);
    },
  };
}

/**
 * The dimmer on the wall, from the level: a plate with a knob, a faint glow to find it by in the
 * dark, and a sign saying how bright it's set. Returns what updates the sign.
 */
function addDimmer(world: World): (brightness: number) => void {
  const { scene, level } = world;
  const place = level.dimmer;
  if (!place) return () => {};
  const holder = new TransformNode("dimmer", scene);
  holder.position.set(place.x, place.y, place.z);
  holder.rotation.y = place.turn;

  const plate = MeshBuilder.CreateBox(
    "dimmer-plate",
    { width: 0.12, height: 0.12, depth: 0.02 },
    scene,
  );
  plate.parent = holder;
  plate.position.z = 0.01;
  plate.material = surfaceMaterial("dimmer-plate", scene, new Color3(0.9, 0.88, 0.84), {
    roughness: 0.4,
  });
  const knob = MeshBuilder.CreateCylinder("dimmer-knob", { diameter: 0.05, height: 0.025 }, scene);
  knob.parent = holder;
  knob.rotation.x = Math.PI / 2;
  knob.position.z = 0.03;
  const glowing = new StandardMaterial("dimmer-glow", scene);
  glowing.disableLighting = true;
  glowing.emissiveColor = new Color3(1, 0.55, 0.15);
  knob.material = glowing;

  const sign = MeshBuilder.CreatePlane("dimmer-sign", { width: 0.5, height: 0.125 }, scene);
  sign.parent = holder;
  sign.position.set(0, 0.17, 0.005);
  // Planes face -z; turn it to face out of the wall.
  sign.rotation.y = Math.PI;
  const text = new DynamicTexture("dimmer-text", { width: 512, height: 128 }, scene);
  text.hasAlpha = true;
  const material = new StandardMaterial("dimmer-sign", scene);
  material.diffuseTexture = text;
  material.emissiveColor = new Color3(0.8, 0.8, 0.8);
  material.disableLighting = true;
  material.useAlphaFromDiffuseTexture = true;
  sign.material = material;

  const show = (brightness: number) => {
    text.getContext().clearRect(0, 0, 512, 128);
    text.drawText(
      `Lights ${Math.round(brightness * 100)}% · hold E`,
      null,
      84,
      "bold 52px system-ui, sans-serif",
      "#f2e6c8",
      "transparent",
    );
  };
  show(1);
  return show;
}

async function addConcept(world: World, concept: (typeof CONCEPTS)[number]) {
  const { scene } = world;
  if (concept.wander) {
    addWanderer(world, concept, concept.wander);
    return;
  }
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

/** Tick walking speed, m/s, and turning speed, radians a second. */
const WANDER_SPEED = 0.45;
const WANDER_TURN = 1.8;

/**
 * A tick walking from one random spot to the next within `radius` of its place, turning to face
 * each before it sets off and pausing at each, long enough to start questing.
 */
function addWanderer(world: World, concept: (typeof CONCEPTS)[number], radius: number) {
  const tick = new TickView(world.scene, world.shadows, `concept-${concept.label}`);
  let x = concept.x;
  let z = concept.z;
  let yaw = concept.turn ?? 0;
  let speed = 0;
  let goal = { x, z };
  let pause = 2;
  world.scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(world.scene.getEngine().getDeltaTime() / 1000, 0.1);
    const dx = goal.x - x;
    const dz = goal.z - z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.05) {
      speed = 0;
      pause -= dt;
      if (pause <= 0) {
        const a = Math.random() * Math.PI * 2;
        const r = radius * Math.sqrt(Math.random());
        goal = { x: concept.x + Math.cos(a) * r, z: concept.z + Math.sin(a) * r };
        pause = 1.5 + Math.random() * 3;
      }
    } else {
      const want = Math.atan2(dx, dz);
      const off = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
      yaw += Math.sign(off) * Math.min(Math.abs(off), WANDER_TURN * dt);
      // Turn on the spot first, then walk, slowing down on arrival.
      const target = Math.abs(off) < 0.4 ? Math.min(WANDER_SPEED, distance * 1.5) : 0;
      speed += (target - speed) * Math.min(1, dt * 3);
      const stepped = Math.min(distance, speed * dt);
      x += Math.sin(yaw) * stepped;
      z += Math.cos(yaw) * stepped;
    }
    tick.update(x, z, yaw, dt);
  });
}
