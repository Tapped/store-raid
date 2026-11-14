import {
  ArcRotateCamera,
  type AssetContainer,
  Color3,
  CubeTexture,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  LoadAssetContainerAsync,
  type Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  SpotLight,
  Texture,
  Vector3,
} from "@babylonjs/core";
import { EYE_HEIGHT } from "../../shared/constants";
import { assetUrl } from "./assets";
import {
  addCameraEffects,
  configureShadows,
  createEngine,
  gradePicture,
  surfaceMaterial,
} from "./graphics";
import { loadModel } from "./propAtlas";

/**
 * The model viewer, at /models.html in dev: one model from assets/models on its own, through the
 * game's pipeline and grade, to turn round and walk into without finding it in a level. Lit evenly
 * with a sun and shadows (studio), or as the game is, by a flashlight in the dark. A grid of
 * 1 m squares and a figure 1.8 m tall give its size. It loads the model again whenever the file is
 * written, so a `pnpm run model` shows up by itself. Everything shown is in the address:
 * ?model=props/boiler&light=studio|flash&grid=&person=&wire=&spin=&merge=&ambient=&power=.
 */

interface Listed {
  /** Under assets/models, without .glb: "props/boiler". */
  path: string;
  size: number;
  modified: number;
}

const canvas = document.getElementById("view") as HTMLCanvasElement;
const panel = document.getElementById("panel") as HTMLDivElement;
const engine = await createEngine(canvas);
addEventListener("resize", () => engine.resize());

async function listModels(): Promise<Listed[]> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}models.json`, { cache: "no-store" });
    return (await response.json()) as Listed[];
  } catch {
    return [];
  }
}
let listing = await listModels();

const params = new URLSearchParams(location.search);
const flag = (key: string, fallback: boolean) =>
  params.has(key) ? params.get(key) !== "0" && params.get(key) !== "false" : fallback;
const view = {
  model: params.get("model") ?? listing[0]?.path ?? "",
  light: params.get("light") === "flash" ? "flash" : "studio",
  grid: flag("grid", true),
  person: flag("person", true),
  wire: flag("wire", false),
  spin: flag("spin", false),
  /** Merge the parts into one mesh over atlases, as scenery is loaded (propAtlas.ts). */
  merge: flag("merge", true),
  ambient: Number(params.get("ambient") ?? 0.06),
  power: Number(params.get("power") ?? 220),
};
let filter = "";

const scene = new Scene(engine);
scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(
  assetUrl("textures/environment.env"),
  scene,
);
gradePicture(scene.imageProcessingConfiguration);

const camera = new ArcRotateCamera("camera", -Math.PI / 2 - 0.7, 1.25, 6, Vector3.Zero(), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 0.01;
camera.upperRadiusLimit = 200;
camera.wheelDeltaPercentage = 0.02;
camera.minZ = 0.05;
camera.maxZ = 400;
addCameraEffects(scene, camera);

const hemi = new HemisphericLight("ambient", new Vector3(0.2, 1, -0.3), scene);
hemi.groundColor = new Color3(0.14, 0.14, 0.15);

const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.45).normalize(), scene);
sun.diffuse = new Color3(1, 0.96, 0.9);
const shadows = new ShadowGenerator(2048, sun);
configureShadows(shadows);

// The game's flashlight beam (client/src/items.ts), at the camera.
const beam = new SpotLight("beam", Vector3.Zero(), new Vector3(0, 0, 1), 1.07, 2, scene);
beam.diffuse = new Color3(1, 0.92, 0.78);
beam.specular = beam.diffuse;
beam.innerAngle = 0.25;
beam.range = 45;
beam.parent = camera;
beam.position.set(0.2, -0.25, 0);

/** The floor: 1 m squares, a heavier line every 5 m. */
const CELLS = 5;
const ground = MeshBuilder.CreateGround("ground", { width: 200, height: 200 }, scene);
{
  const size = 640;
  const texture = new DynamicTexture("grid", { width: size, height: size }, scene, true);
  const context = texture.getContext();
  context.fillStyle = "#4b4c4e";
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < CELLS; i++) {
    const at = (i * size) / CELLS;
    context.fillStyle = i === 0 ? "#2c2d2f" : "#3d3e40";
    const width = i === 0 ? 6 : 3;
    context.fillRect(at - width / 2, 0, width, size);
    context.fillRect(0, at - width / 2, size, width);
    if (i === 0) {
      context.fillRect(size - width / 2, 0, width, size);
      context.fillRect(0, size - width / 2, size, width);
    }
  }
  texture.update();
  texture.uScale = 200 / CELLS;
  texture.vScale = 200 / CELLS;
  texture.anisotropicFilteringLevel = 16;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  const material = surfaceMaterial("ground", scene, new Color3(1, 1, 1), { roughness: 0.9 });
  material.albedoTexture = texture;
  ground.material = material;
  ground.receiveShadows = true;
}

// What's behind it all. Ambient occlusion blackens whatever has no depth, so the bare clear colour
// can't be it: a dome far out, in a colour of its own, can.
const backdrop = MeshBuilder.CreateSphere("backdrop", { diameter: 380, segments: 12 }, scene);
const backdropMaterial = surfaceMaterial("backdrop", scene, new Color3(0, 0, 0));
backdropMaterial.unlit = true;
backdropMaterial.backFaceCulling = false;
backdrop.material = backdropMaterial;
backdrop.isPickable = false;

/** Someone 1.8 m tall, standing beside the model. */
const person = MeshBuilder.CreateCapsule("person", { height: 1.8, radius: 0.2 }, scene);
person.material = surfaceMaterial("person", scene, new Color3(0.75, 0.42, 0.2), { roughness: 0.7 });
shadows.addShadowCaster(person);

let shown: { container: AssetContainer; path: string; modified: number } | undefined;
let bounds = { min: new Vector3(-0.5, 0, -0.5), max: new Vector3(0.5, 1, 0.5) };
let stats = "";
let loading = 0;
/** The file last loaded, or tried: its path and when it was written. */
let tried = "";

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** What the model weighs: its size, triangles, draw calls, and its textures in video memory. */
function measure(container: AssetContainer, listed: Listed | undefined): string {
  const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
  const triangles = meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
  const size = bounds.max.subtract(bounds.min);
  const materials = new Set(meshes.map((mesh) => mesh.material).filter((m) => m));
  const textures = new Set([...materials].flatMap((m) => m?.getActiveTextures() ?? []));
  let memory = 0;
  const lines: string[] = [];
  for (const texture of textures) {
    const { width, height } = texture.getSize();
    // Compressed formats are the GPU's own numbers, far above Babylon's plain ones.
    const compressed = (texture.getInternalTexture()?.format ?? 0) > 1000;
    const bytes = (width * height * (compressed ? 1 : 4) * 4) / 3;
    memory += bytes;
    lines.push(`  ${width}×${height} ${compressed ? "BC7" : "unpacked"} ${megabytes(bytes)}`);
  }
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  const skeletons = container.skeletons.length
    ? `\n${container.skeletons.reduce((sum, s) => sum + s.bones.length, 0)} bones`
    : "";
  return [
    `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m (x, up, z)`,
    `${Math.round(triangles).toLocaleString("en")} triangles`,
    `${meshes.length} draw call${meshes.length === 1 ? "" : "s"}, ${materials.size} material${materials.size === 1 ? "" : "s"}${skeletons}`,
    `${textures.size} textures, ${megabytes(memory)} of video memory`,
    ...[...counts].map(([line, count]) => (count > 1 ? `${line} ×${count}` : line)),
    listed ? `file ${megabytes(listed.size)}` : "",
  ]
    .filter((line) => line)
    .join("\n");
}

/** Turns the camera to take in the whole model. */
function frame() {
  const centre = bounds.min.add(bounds.max).scale(0.5);
  const radius = bounds.max.subtract(bounds.min).length() / 2;
  camera.setTarget(centre);
  camera.radius = Math.max(0.3, radius * 2.4);
  camera.panningSensibility = 1000 / Math.max(0.3, radius);
}

/** Stands the camera at eye height in the middle of the model, to look round from inside. */
function eye() {
  const centre = bounds.min.add(bounds.max).scale(0.5);
  camera.setTarget(new Vector3(centre.x, bounds.min.y + EYE_HEIGHT, centre.z));
  camera.radius = 0.01;
  camera.beta = Math.PI / 2;
}

/** Loads the model in `view.model`; `keepCamera` when it's the same one, built again. */
async function load(keepCamera = false) {
  const turn = ++loading;
  const listed = listing.find((m) => m.path === view.model);
  if (!listed) {
    stats = view.model ? `No model at models/${view.model}.glb` : "No models in assets/models";
    renderPanel();
    return;
  }
  tried = `${listed.path}@${listed.modified}`;
  stats = "Loading…";
  renderPanel();
  const path = `models/${listed.path}.glb?v=${listed.modified}`;
  let container: AssetContainer | undefined;
  try {
    container = view.merge
      ? await loadModel(scene, path)
      : await LoadAssetContainerAsync(assetUrl(path), scene, { pluginExtension: ".glb" });
  } catch (err) {
    console.warn(`Could not load ${path}`, err);
  }
  if (turn !== loading) {
    container?.dispose();
    return;
  }
  shown?.container.dispose();
  shown = undefined;
  if (!container) {
    stats = `Could not load models/${listed.path}.glb`;
    renderPanel();
    return;
  }
  container.addAllToScene();
  shown = { container, path: listed.path, modified: listed.modified };
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = min.scale(-1);
  for (const mesh of container.meshes) {
    if (mesh.getTotalVertices() === 0) continue;
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo({ applySkeleton: true });
    const box = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, box.minimumWorld);
    max = Vector3.Maximize(max, box.maximumWorld);
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
  }
  if (min.x <= max.x) bounds = { min, max };
  stats = measure(container, listed);
  ground.position.y = bounds.min.y;
  person.position.set(bounds.max.x + 0.7, bounds.min.y + 0.9, (bounds.min.z + bounds.max.z) / 2);
  if (!keepCamera) frame();
  apply();
}

function apply() {
  const studio = view.light === "studio";
  backdropMaterial.albedoColor = studio
    ? new Color3(0.16, 0.165, 0.175)
    : new Color3(0.004, 0.004, 0.005);
  scene.clearColor = backdropMaterial.albedoColor.toColor4();
  hemi.diffuse = studio ? new Color3(1, 1, 1) : new Color3(0.72, 0.76, 0.86);
  hemi.intensity = studio ? 0.6 : view.ambient;
  scene.environmentIntensity = studio ? 0.7 : view.ambient * 1.5;
  sun.intensity = studio ? 3 : 0;
  sun.setEnabled(studio);
  beam.intensity = view.power;
  beam.setEnabled(!studio);
  ground.setEnabled(view.grid);
  person.setEnabled(view.person);
  for (const material of shown?.container.materials ?? []) material.wireframe = view.wire;
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(view)) {
    if (value !== "") out.set(key, typeof value === "boolean" ? String(Number(value)) : `${value}`);
  }
  history.replaceState(null, "", `?${out}`.replaceAll("%2F", "/"));
  renderPanel();
}

function renderList(list: HTMLDivElement) {
  list.replaceChildren();
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  let folder = "";
  for (const model of listing) {
    if (!words.every((word) => model.path.toLowerCase().includes(word))) continue;
    const slash = model.path.lastIndexOf("/");
    const inFolder = model.path.slice(0, Math.max(0, slash));
    if (inFolder !== folder) {
      folder = inFolder;
      const head = document.createElement("div");
      head.className = "folder";
      head.textContent = folder;
      list.append(head);
    }
    const row = document.createElement("div");
    row.className = model.path === view.model ? "model shown" : "model";
    row.textContent = model.path.slice(slash + 1);
    row.onclick = () => {
      view.model = model.path;
      void load();
    };
    list.append(row);
  }
}

function renderPanel() {
  const scrolled = panel.querySelector("#list")?.scrollTop ?? 0;
  panel.replaceChildren();
  const heading = (text: string, tag = "h2") => {
    const h = document.createElement(tag);
    h.textContent = text;
    panel.append(h);
  };
  const row = (label?: string, tag = "div") => {
    const div = document.createElement(tag);
    div.className = "row";
    if (label) div.innerHTML = `<span>${label}</span>`;
    panel.append(div);
    return div;
  };
  heading("Models", "h1");
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Filter";
  search.value = filter;
  row().append(search);
  const list = document.createElement("div");
  list.id = "list";
  panel.append(list);
  renderList(list);
  list.scrollTop = scrolled;
  search.oninput = () => {
    filter = search.value;
    renderList(list);
  };

  heading(view.model || "Nothing shown");
  const about = document.createElement("div");
  about.id = "stats";
  about.textContent = stats;
  panel.append(about);

  heading("View");
  const buttons = row();
  for (const [text, act] of [
    ["Frame (F)", frame],
    ["Eye height (E)", eye],
  ] as const) {
    const button = document.createElement("button");
    button.textContent = text;
    button.onclick = act;
    buttons.append(button);
  }
  const check = (label: string, key: "grid" | "person" | "wire" | "spin" | "merge") => {
    const line = row(undefined, "label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = view[key];
    input.onchange = () => {
      view[key] = input.checked;
      if (key === "merge") void load(true);
      else apply();
    };
    line.append(input, label);
  };
  check("Floor, in 1 m squares (G)", "grid");
  check("A person, 1.8 m (P)", "person");
  check("Wireframe (W)", "wire");
  check("Turn slowly (T)", "spin");
  check("Parts merged, as scenery loads", "merge");

  heading("Light");
  const toggle = document.createElement("button");
  toggle.textContent = view.light === "studio" ? "Studio (L)" : "Flashlight (L)";
  toggle.onclick = switchLight;
  row().append(toggle);
  const slider = (label: string, key: "ambient" | "power", min: number, max: number) => {
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
    row(label).append(input);
  };
  if (view.light === "flash") {
    slider("Power", "power", 0, 800);
    slider("Ambient", "ambient", 0, 1);
  }
}

function switchLight() {
  view.light = view.light === "studio" ? "flash" : "studio";
  apply();
}

addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
  const toggles = { KeyG: "grid", KeyP: "person", KeyW: "wire", KeyT: "spin" } as const;
  if (e.code === "KeyL") switchLight();
  else if (e.code === "KeyF") frame();
  else if (e.code === "KeyE") eye();
  else if (e.code in toggles) {
    const key = toggles[e.code as keyof typeof toggles];
    view[key] = !view[key];
    apply();
  }
});

// A model built again is shown again, from where the camera is; new ones join the list.
setInterval(async () => {
  const next = await listModels();
  if (!next.length) return;
  const changed = next.map((m) => m.path).join() !== listing.map((m) => m.path).join();
  listing = next;
  const current = next.find((m) => m.path === view.model);
  if (current && tried !== `${current.path}@${current.modified}`) {
    void load(shown?.path === current.path);
  } else if (changed) renderPanel();
}, 2000);

apply();
await load();
engine.runRenderLoop(() => {
  if (view.spin) camera.alpha += engine.getDeltaTime() * 0.0003;
  scene.render();
});

/** For scripts and the console: change what's shown, as the panel does. */
(window as unknown as { __models: unknown }).__models = {
  scene,
  engine,
  camera,
  view,
  frame,
  eye,
  stats: () => stats,
  bounds: () => bounds,
  async show(changes: Partial<typeof view>) {
    const reload = "model" in changes || "merge" in changes;
    Object.assign(view, changes);
    if (reload) await load();
    else apply();
  },
  meshes: (): Mesh[] => (shown?.container.meshes ?? []) as Mesh[],
};
