import {
  ArcRotateCamera,
  Color3,
  CubeTexture,
  HemisphericLight,
  type Mesh,
  PBRMaterial,
  Scene,
  SpotLight,
  Vector3,
} from "@babylonjs/core";
import { assetUrl } from "./assets";
import { addCameraEffects, createEngine, gradePicture } from "./graphics";
import { SURFACE_NAMES, SURFACES, type SurfaceName, surface } from "./surfaces";
import { worldBox } from "./terrain";

/**
 * The surface viewer, at /surfaces.html in dev: the surface library on a floor and a corner of
 * walls, through the game's own pipeline and grade, lit as the game is, by a warm flashlight in a
 * dark building, or by a light low across them to show the relief. Everything shown is in the
 * address, so a reload or a screenshot script shows the same: ?floor=&wall=&floorTint=&wallTint=
 * &light=flash|graze&turn=&height=&ambient=.
 */

const canvas = document.getElementById("view") as HTMLCanvasElement;
const panel = document.getElementById("panel") as HTMLDivElement;
const engine = await createEngine(canvas);
addEventListener("resize", () => engine.resize());

const params = new URLSearchParams(location.search);
const pick = (key: string, fallback: SurfaceName): SurfaceName => {
  const name = params.get(key);
  return name && name in SURFACES ? (name as SurfaceName) : fallback;
};
const view = {
  floor: pick("floor", "concrete-floor"),
  wall: pick("wall", "painted-plaster"),
  floorTint: params.get("floorTint") ?? "",
  wallTint: params.get("wallTint") ?? "",
  light: params.get("light") === "graze" ? "graze" : "flash",
  turn: Number(params.get("turn") ?? 0.6),
  height: Number(params.get("height") ?? 0.5),
  ambient: Number(params.get("ambient") ?? 0.06),
  power: Number(params.get("power") ?? 220),
};

const scene = new Scene(engine);
scene.clearColor = new Color3(0.02, 0.02, 0.025).toColor4();
scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(
  assetUrl("textures/environment.env"),
  scene,
);
gradePicture(scene.imageProcessingConfiguration);

const camera = new ArcRotateCamera(
  "camera",
  -Math.PI / 2 - 0.35,
  1.15,
  5.5,
  new Vector3(0, 0.9, 2),
  scene,
);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 0.3;
camera.upperRadiusLimit = 30;
camera.wheelDeltaPercentage = 0.02;
camera.minZ = 0.05;
addCameraEffects(scene, camera);

const hemi = new HemisphericLight("ambient", new Vector3(0.2, 1, -0.3), scene);
hemi.diffuse = new Color3(0.72, 0.76, 0.86);
hemi.groundColor = new Color3(0.12, 0.12, 0.15);

// The game's flashlight beam (client/src/items.ts).
const beam = new SpotLight("beam", Vector3.Zero(), new Vector3(0, 0, 1), 1.07, 2, scene);
beam.diffuse = new Color3(1, 0.92, 0.78);
beam.specular = beam.diffuse;
beam.innerAngle = 0.25;
beam.range = 45;

// A floor, a back wall and a return, so floors, walls and the corner between them all show.
const floor = worldBox("floor", new Vector3(-6, -0.2, -6), new Vector3(6, 0, 6), scene, 1);
const walls = [
  worldBox("back", new Vector3(-6, 0, 4), new Vector3(6, 3, 4.3), scene, 1),
  worldBox("return", new Vector3(-4.3, 0, -2), new Vector3(-4, 3, 4), scene, 1),
];

/** worldBox's texture coordinates, in meters, scaled to a surface's tile. */
function retile(mesh: Mesh, tile: number) {
  const uvs = mesh.metadata?.meters ?? mesh.getVerticesData("uv");
  mesh.metadata = { meters: uvs };
  mesh.setVerticesData(
    "uv",
    (uvs as number[]).map((m) => m / tile),
  );
}

function colour(hex: string): Color3 | undefined {
  return /^#?[0-9a-f]{6}$/i.test(hex)
    ? Color3.FromHexString(hex.startsWith("#") ? hex : `#${hex}`)
    : undefined;
}

function apply() {
  const floorSpec = SURFACES[view.floor];
  const wallSpec = SURFACES[view.wall];
  retile(floor, floorSpec.tile);
  floor.material = surface(scene, view.floor, { tint: colour(view.floorTint) });
  for (const wall of walls) {
    retile(wall, wallSpec.tile);
    wall.material = surface(scene, view.wall, { tint: colour(view.wallTint) });
  }
  hemi.intensity = view.ambient;
  scene.environmentIntensity = view.ambient * 1.5;
  beam.intensity = view.power;
  if (view.light === "flash") {
    beam.parent = camera;
    beam.position.set(0.2, -0.25, 0);
    beam.direction.set(0, 0, 1);
  } else {
    // Low across the floor and towards the back wall, from `turn` radians round the corner.
    beam.parent = null;
    const at = new Vector3(Math.sin(view.turn) * 5, view.height, 4 - Math.cos(view.turn) * 5);
    beam.position.copyFrom(at);
    beam.direction.copyFrom(new Vector3(0, 0.6, 4).subtract(at).normalize());
  }
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(view)) if (value !== "") out.set(key, String(value));
  history.replaceState(null, "", `?${out}`);
  renderPanel();
}

scene.onNewMaterialAddedObservable.add((material) => {
  if (material instanceof PBRMaterial) queueMicrotask(() => (material.maxSimultaneousLights = 4));
});

function renderPanel() {
  panel.replaceChildren();
  const add = (html: string) => {
    const div = document.createElement("div");
    div.innerHTML = html;
    panel.append(...div.childNodes);
  };
  add(`<h1>Surfaces</h1>`);
  for (const which of ["floor", "wall"] as const) {
    const name = view[which];
    const spec = SURFACES[name];
    add(`<h2>${which}</h2>`);
    const row = document.createElement("div");
    row.className = "row";
    const select = document.createElement("select");
    for (const n of SURFACE_NAMES)
      select.add(new Option(`${n} (${SURFACES[n].tile} m)`, n, false, n === name));
    select.onchange = () => {
      view[which] = select.value as SurfaceName;
      view[`${which}Tint`] = "";
      apply();
    };
    row.append(select);
    panel.append(row);
    add(`<div class="about">${spec.about}</div>`);
    if (spec.tint) {
      const tintRow = document.createElement("div");
      tintRow.className = "row";
      tintRow.innerHTML = "<span>Tint</span>";
      const input = document.createElement("input");
      input.type = "color";
      input.value =
        colour(view[`${which}Tint`])?.toHexString() ?? new Color3(...spec.tint).toHexString();
      input.oninput = () => {
        view[`${which}Tint`] = input.value.slice(1);
        apply();
      };
      tintRow.append(input);
      panel.append(tintRow);
    }
  }
  add(`<h2>Light</h2>`);
  const lightRow = document.createElement("div");
  lightRow.className = "row";
  const toggle = document.createElement("button");
  toggle.textContent = view.light === "flash" ? "Flashlight (L)" : "Grazing (L)";
  toggle.onclick = () => switchLight();
  lightRow.append(toggle);
  panel.append(lightRow);
  const slider = (
    label: string,
    key: "turn" | "height" | "ambient" | "power",
    min: number,
    max: number,
  ) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${label}</span>`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String((max - min) / 200);
    input.value = String(view[key]);
    input.oninput = () => {
      view[key] = Number(input.value);
      apply();
    };
    row.append(input);
    panel.append(row);
  };
  slider("Power", "power", 0, 800);
  if (view.light === "graze") {
    slider("Turn", "turn", -1.5, 1.5);
    slider("Height", "height", 0.05, 2.5);
  }
  slider("Ambient", "ambient", 0, 1);
}

function switchLight() {
  view.light = view.light === "flash" ? "graze" : "flash";
  apply();
}

addEventListener("keydown", (e) => {
  if (e.code === "KeyL" && !(e.target instanceof HTMLInputElement)) switchLight();
});

apply();
engine.runRenderLoop(() => scene.render());

/** For scripts and the console: change what's shown, as the panel does. */
(window as unknown as { __surfaces: unknown }).__surfaces = {
  scene,
  engine,
  camera,
  beam,
  view,
  show(changes: Partial<typeof view>) {
    Object.assign(view, changes);
    apply();
  },
};
