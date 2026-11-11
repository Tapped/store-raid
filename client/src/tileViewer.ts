import {
  type AbstractMesh,
  type ArcRotateCamera,
  Color3,
  DynamicTexture,
  FreeCamera,
  Matrix,
  Mesh,
  MeshBuilder,
  Plane,
  PointerEventTypes,
  type Ray,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { type Cell, generate } from "../../shared/generate";
import {
  type Floor,
  GENERATED_SIZE,
  type Ladder,
  type Level,
  type LevelBox,
  PLAYGROUND_GRID,
} from "../../shared/level";
import {
  CELL,
  checkTiles,
  composeTiles,
  type Edge,
  fits,
  fitsAbove,
  OFFSET,
  OPPOSITE,
  type ParsedGrid,
  parseTiles,
  type Screen,
  SIDES,
  STOREY,
  socket,
  type Tile,
  type TileGrid,
  tileChar,
} from "../../shared/tiles";
import { addCameraEffects, createEngine, surfaceMaterial } from "./graphics";
import { addPlayground, type Playground } from "./playground";
import { createWorld, type World } from "./scene";
import { CATALOGUE } from "./tileCatalogue";

/**
 * The tile viewer, at /tiles.html in dev: tiles built just as a level builds them (shared/tiles.ts),
 * drawn by the game's own code, with no server. Look at a generated level by seed, every tile on its
 * own, the playground, or a grid written by hand; cut storeys away, show what collides, click a cell
 * to see its sockets and neighbours, and fly through at eye height to see it as a player would.
 */

type SourceKind = "generated" | "catalogue" | "playground" | "custom";

/** One grid in the view, where it stands, and what it's made of. */
interface Piece {
  name: string;
  grid: TileGrid;
  parsed: ParsedGrid;
  entrance?: Cell;
}

interface Source {
  kind: SourceKind;
  title: string;
  pieces: Piece[];
  note?: string;
}

interface Selection {
  piece: number;
  storey: number;
  col: number;
  row: number;
}

const EYE = 1.6;
const SLAB = 0.25;
const CUSTOM_KEY = "tile-viewer-custom";
const BOX_COLORS: Record<LevelBox["kind"] | "floor" | "ladder", string> = {
  wall: "#ff6b5b",
  partition: "#f2f2f2",
  shelf: "#5b8cff",
  rail: "#ffd84d",
  pit: "#c77dff",
  stairs: "#ff9f40",
  furniture: "#4dd8ff",
  scenery: "#ffffff",
  floor: "#5bd16b",
  ladder: "#b6ff4d",
};
const TILE_COLORS: Record<Tile["kind"], [string, string]> = {
  floor: ["#a39d90", "#111"],
  tv: ["#6fa8dc", "#111"],
  solid: ["#4a4a4a", "#ddd"],
  pit: ["#161616", "#bbb"],
  bridge: ["#a0784c", "#111"],
  stairs: ["#e0a040", "#111"],
  ladder: ["#7cc26b", "#111"],
  open: ["#1d2026", "#666"],
  well: ["#2f5378", "#cde"],
  shaft: ["#46305a", "#dcd"],
};

const canvas = document.getElementById("view") as HTMLCanvasElement;
const panel = document.getElementById("panel") as HTMLDivElement;
const help = document.getElementById("help") as HTMLDivElement;
help.textContent =
  "Drag: orbit · Right-drag: pan · Wheel: zoom · Click: select a cell · Tab: fly (WASD, E/Q up and down) · [ ]: seed · PgUp/PgDn: cut storeys";

const engine = await createEngine(canvas);
addEventListener("resize", () => engine.resize());

// What's shown, kept in the address so a reload shows the same.
const params = new URLSearchParams(location.search);
const view = {
  kind: (params.get("source") as SourceKind | null) ?? "generated",
  seed: Number(params.get("seed") ?? 1),
  roof: params.get("roof") === "1",
  boxes: params.get("boxes") === "1",
  labels: params.get("labels") !== "0",
  /** The highest storey shown, or undefined for all of them. */
  cut: params.has("cut") ? Number(params.get("cut")) : undefined,
  light: 1,
};

let source: Source | undefined;
let world: World | undefined;
let hall: Playground | undefined;
let level: Level | undefined;
let roofMeshes: AbstractMesh[] = [];
let boxOverlay: Mesh[] = [];
let labels: Mesh[] = [];
let highlight: Mesh | undefined;
let fly: FreeCamera | undefined;
let selection: Selection | undefined;
let error = "";

// ---- The panel ----

panel.innerHTML = `
  <h1>Tile viewer</h1>
  <div class="row">
    <select id="kind">
      <option value="generated">Generated level</option>
      <option value="catalogue">Every tile</option>
      <option value="playground">The playground</option>
      <option value="custom">Written by hand</option>
    </select>
  </div>
  <div class="row" id="seed-row">
    seed <input id="seed" type="number" min="0" step="1" />
    <button id="prev" title="[">◀</button><button id="next" title="]">▶</button>
    <button id="random">Random</button>
  </div>
  <div id="note" class="muted"></div>
  <div id="error" class="error"></div>
  <h2>View</h2>
  <div class="row">
    <label><input id="roof" type="checkbox" /> Roof</label>
    <label><input id="boxes" type="checkbox" /> Collision boxes</label>
    <label><input id="labels" type="checkbox" /> Labels</label>
  </div>
  <div class="row">
    Storeys up to <select id="cut"></select>
    <button id="fly">Fly (Tab)</button>
  </div>
  <div class="row">
    Light <input id="light" type="range" min="0" max="1" step="0.05" />
  </div>
  <h2>Cell</h2>
  <div id="info" class="info muted">Click a cell, here or in the view.</div>
  <h2>Map</h2>
  <div id="maps" class="maps"></div>
  <h2>As text</h2>
  <div class="row">
    <button id="edit">Edit this grid</button>
    <button id="apply">Build it</button>
  </div>
  <textarea id="text" spellcheck="false"></textarea>
  <div class="muted">
    One string per row, north first, a list of rows per storey, deepest first. F floor, T tv,
    # solid, P pit, | = bridge, ^ &gt; v &lt; stairs, n e s w ladder, . open. Drawn storeys put
    + corners between cells, - | walls and d doorways.
  </div>
`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const kindSelect = $<HTMLSelectElement>("kind");
const seedInput = $<HTMLInputElement>("seed");
const textArea = $<HTMLTextAreaElement>("text");
const cutSelect = $<HTMLSelectElement>("cut");

kindSelect.value = view.kind;
seedInput.value = String(view.seed);
$<HTMLInputElement>("roof").checked = view.roof;
$<HTMLInputElement>("boxes").checked = view.boxes;
$<HTMLInputElement>("labels").checked = view.labels;
$<HTMLInputElement>("light").value = String(view.light);
textArea.value = loadCustom();

kindSelect.addEventListener("change", () => {
  view.kind = kindSelect.value as SourceKind;
  selection = undefined;
  rebuild(true);
});
seedInput.addEventListener("change", () => setSeed(Number(seedInput.value)));
$("prev").addEventListener("click", () => setSeed(view.seed - 1));
$("next").addEventListener("click", () => setSeed(view.seed + 1));
$("random").addEventListener("click", () => setSeed(Math.floor(Math.random() * 100000)));
$("roof").addEventListener("change", (event) => {
  view.roof = (event.target as HTMLInputElement).checked;
  applyView();
});
$("boxes").addEventListener("change", (event) => {
  view.boxes = (event.target as HTMLInputElement).checked;
  applyView();
});
$("labels").addEventListener("change", (event) => {
  view.labels = (event.target as HTMLInputElement).checked;
  applyView();
});
cutSelect.addEventListener("change", () => {
  view.cut = cutSelect.value === "" ? undefined : Number(cutSelect.value);
  applyView();
});
$("light").addEventListener("input", (event) => {
  view.light = Number((event.target as HTMLInputElement).value);
  hall?.setLight(view.light);
});
$("fly").addEventListener("click", () => toggleFly());
$("edit").addEventListener("click", () => {
  const piece = source?.pieces[selection?.piece ?? 0];
  if (!piece) return;
  const { basements, storeys } = piece.grid;
  textArea.value = JSON.stringify({ basements: basements ?? 0, storeys }, null, 2);
});
$("apply").addEventListener("click", () => {
  localStorage.setItem(CUSTOM_KEY, textArea.value);
  view.kind = "custom";
  kindSelect.value = "custom";
  selection = undefined;
  rebuild(true);
});

function setSeed(seed: number) {
  view.seed = Math.max(0, Math.floor(seed) || 0);
  seedInput.value = String(view.seed);
  view.kind = "generated";
  kindSelect.value = "generated";
  rebuild(false);
}

function loadCustom(): string {
  try {
    const kept = localStorage.getItem(CUSTOM_KEY);
    if (kept) return kept;
  } catch {}
  const { basements, storeys } = PLAYGROUND_GRID;
  return JSON.stringify({ basements, storeys }, null, 2);
}

addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest("input, textarea, select")) return;
  if (event.code === "Tab") {
    event.preventDefault();
    toggleFly();
  } else if (event.code === "BracketLeft") setSeed(view.seed - 1);
  else if (event.code === "BracketRight") setSeed(view.seed + 1);
  else if (event.code === "PageUp" || event.code === "PageDown") {
    event.preventDefault();
    const options = [...cutSelect.options].map((option) => option.value);
    const at = options.indexOf(cutSelect.value);
    // The options go from all storeys down to the deepest.
    const next = event.code === "PageUp" ? at - 1 : at + 1;
    if (next < 0 || next >= options.length) return;
    cutSelect.value = options[next];
    cutSelect.dispatchEvent(new Event("change"));
  }
});

// ---- What's shown ----

function pieceOf(name: string, grid: TileGrid, entrance?: Cell): Piece {
  return { name, grid, parsed: parseTiles(grid), entrance };
}

/** A grid's size in cells. */
function sizeOf(grid: TileGrid) {
  const parsed = parseTiles(grid);
  return { cols: parsed.cols, rows: parsed.rows };
}

function makeSource(): Source {
  switch (view.kind) {
    case "generated": {
      const generated = generate({ ...GENERATED_SIZE, seed: view.seed });
      const { cols, rows } = GENERATED_SIZE;
      const grid = { ...generated.grid, x: (-cols * CELL) / 2, z: (-rows * CELL) / 2 };
      return {
        kind: "generated",
        title: `generated-${view.seed}`,
        pieces: [pieceOf(`generated-${view.seed}`, grid, generated.entrance)],
        note: `${cols} × ${rows} cells, ${GENERATED_SIZE.storeys} storeys · took ${generated.attempts} ${generated.attempts === 1 ? "try" : "tries"} · in the game: ?level=generated-${view.seed}`,
      };
    }
    case "playground":
      return {
        kind: "playground",
        title: "playground",
        pieces: [pieceOf("playground", PLAYGROUND_GRID)],
        note: "The playground's tiles, without its hall around them.",
      };
    case "catalogue": {
      // In rows, the first to the north, with room between them for labels.
      const perRow = 5;
      const pitch = 3 * CELL + 2 * CELL;
      const rowsOf = Math.ceil(CATALOGUE.length / perRow);
      const pieces = CATALOGUE.map((sample, i) => {
        const { cols, rows } = sizeOf(sample.grid);
        const x = (i % perRow) * pitch - ((perRow - 1) * pitch) / 2 - (cols * CELL) / 2;
        const z = ((rowsOf - 1) / 2 - Math.floor(i / perRow)) * pitch - (rows * CELL) / 2;
        return pieceOf(sample.name, { ...sample.grid, x, z });
      });
      return {
        kind: "catalogue",
        title: "catalogue",
        pieces,
        note: "Every tile, each in a grid of its own (client/src/tileCatalogue.ts).",
      };
    }
    case "custom": {
      const written = JSON.parse(textArea.value) as Partial<TileGrid>;
      if (!Array.isArray(written.storeys)) throw new Error("It needs a list of storeys.");
      const grid = { x: 0, z: 0, basements: written.basements ?? 0, storeys: written.storeys };
      const { cols, rows } = sizeOf(grid);
      const placed = { ...grid, x: (-cols * CELL) / 2, z: (-rows * CELL) / 2 };
      return { kind: "custom", title: "custom", pieces: [pieceOf("written by hand", placed)] };
    }
  }
}

/** A level of every piece, built as the game builds one, under a roof over the highest storey. */
function levelOf(shown: Source): Level {
  const floors: Floor[] = [];
  const boxes: LevelBox[] = [];
  const ladders: Ladder[] = [];
  const screens: Screen[] = [];
  let top = 1;
  let deepest = 0;
  let extent = 0;
  for (const piece of shown.pieces) {
    const problem = checkTiles(piece.parsed);
    if (problem) throw new Error(`${piece.name}: ${problem}`);
    const built = composeTiles(piece.grid);
    floors.push(...built.floors);
    boxes.push(...built.boxes);
    ladders.push(...built.ladders);
    screens.push(...built.screens);
    const basements = piece.grid.basements ?? 0;
    top = Math.max(top, piece.grid.storeys.length - basements);
    deepest = Math.max(deepest, basements);
    const { x, z } = piece.grid;
    const { cols, rows } = piece.parsed;
    extent = Math.max(extent, Math.abs(x), Math.abs(z), x + cols * CELL, z + rows * CELL);
  }
  return {
    name: `tiles-${shown.title}`,
    size: 2 * extent + 2,
    boxes,
    floors,
    ladders,
    killY: -deepest * STOREY - 4,
    dimmer: undefined,
    dock: undefined,
    entrance: { x: 0, y: 2.6, z: 0 },
    screens,
    items: [],
    spawnPoint: () => ({ x: 0, z: 0 }),
    roof: top * STOREY,
    grid: undefined,
    rooms: [],
    props: [],
    lights: [],
  };
}

/** The storeys a source has, from the highest down. */
function storeysOf(shown: Source): number[] {
  let top = 0;
  let bottom = 0;
  for (const piece of shown.pieces) {
    const basements = piece.grid.basements ?? 0;
    top = Math.max(top, piece.grid.storeys.length - basements - 1);
    bottom = Math.min(bottom, -basements);
  }
  const storeys: number[] = [];
  for (let storey = top; storey >= bottom; storey--) storeys.push(storey);
  return storeys;
}

/** Build the scene again for what's asked, keeping the camera where it was if it's the same kind. */
function rebuild(reframe: boolean) {
  let next: Source;
  let built: Level;
  try {
    next = makeSource();
    built = levelOf(next);
    error = "";
  } catch (problem) {
    error = String(problem instanceof Error ? problem.message : problem);
    showPanel();
    return;
  }
  const camera = saveCamera();
  source = next;
  level = built;
  fly = undefined;
  highlight = undefined;
  world?.scene.dispose();
  world = createWorld(engine, built);
  const { scene } = world;
  const before = new Set(scene.meshes);
  hall = built.boxes.length > 0 ? addPlayground(world) : undefined;
  roofMeshes = scene.meshes.filter((mesh) => !before.has(mesh));
  hall?.setLight(view.light);
  addFurniture(world, built);
  boxOverlay = addBoxOverlay(world, built);
  labels = addLabels(world, next);

  const orbit = world.lobbyCamera;
  orbit.attachControl();
  orbit.wheelDeltaPercentage = 0.02;
  orbit.panningSensibility = 60;
  orbit.lowerRadiusLimit = 1;
  orbit.upperRadiusLimit = 600;
  orbit.minZ = 0.05;
  orbit.maxZ = 2000;
  orbit.inertia = 0.6;
  if (reframe || !camera) frame(orbit, built);
  else restoreCamera(orbit, camera);
  scene.onPointerObservable.add((info) => {
    if (info.type === PointerEventTypes.POINTERDOWN) canvas.focus();
    if (info.type !== PointerEventTypes.POINTERTAP || info.event.button !== 0) return;
    pick();
  });

  // The storeys to cut down to.
  const storeys = storeysOf(next);
  cutSelect.innerHTML = `<option value="">all</option>${storeys
    .map((storey) => `<option value="${storey}">${storey}</option>`)
    .join("")}`;
  if (view.cut !== undefined && !storeys.includes(view.cut)) view.cut = undefined;
  cutSelect.value = view.cut === undefined ? "" : String(view.cut);
  if (selection && !source.pieces[selection.piece]) selection = undefined;
  applyView();
}

interface SavedCamera {
  alpha: number;
  beta: number;
  radius: number;
  target: Vector3;
  fly?: { position: Vector3; rotation: Vector3 };
}

function saveCamera(): SavedCamera | undefined {
  if (!world) return undefined;
  const orbit = world.lobbyCamera;
  const flying = fly && world.scene.activeCamera === fly ? fly : undefined;
  return {
    alpha: orbit.alpha,
    beta: orbit.beta,
    radius: orbit.radius,
    target: orbit.target.clone(),
    fly: flying && { position: flying.position.clone(), rotation: flying.rotation.clone() },
  };
}

function restoreCamera(orbit: ArcRotateCamera, saved: SavedCamera) {
  // setTarget keeps the camera where it is, so it goes first.
  orbit.setTarget(saved.target);
  orbit.alpha = saved.alpha;
  orbit.beta = saved.beta;
  orbit.radius = saved.radius;
  if (saved.fly) {
    toggleFly();
    fly?.position.copyFrom(saved.fly.position);
    fly?.rotation.copyFrom(saved.fly.rotation);
  }
}

/** Look at the whole of it from the south, above. */
function frame(orbit: ArcRotateCamera, shown: Level) {
  orbit.setTarget(new Vector3(0, 0, 0));
  orbit.alpha = -Math.PI / 2;
  orbit.beta = 0.85;
  orbit.radius = Math.max(12, shown.size * 0.9);
}

/** The highest height drawn, with storeys cut away, or undefined if nothing is. */
function cutHeight(): number | undefined {
  if (view.cut === undefined) return undefined;
  // Just under the slab of the storey above, so the walls show up to the ceiling.
  return (view.cut + 1) * STOREY - SLAB - 0.01;
}

/** Show what the checkboxes ask, cut the storeys, and update the panel and address. */
function applyView() {
  if (!world) return;
  const cut = cutHeight();
  world.scene.clipPlane = cut === undefined ? null : new Plane(0, 1, 0, -cut);
  for (const mesh of roofMeshes) {
    // The strip lights and beams go with the roof, but the panel never shows the roof under a cut.
    mesh.setEnabled(view.roof && cut === undefined);
  }
  for (const mesh of boxOverlay) mesh.setEnabled(view.boxes);
  for (const mesh of labels) mesh.setEnabled(view.labels);
  showHighlight();
  showPanel();
  const address = new URLSearchParams();
  address.set("source", view.kind);
  if (view.kind === "generated") address.set("seed", String(view.seed));
  if (view.roof) address.set("roof", "1");
  if (view.boxes) address.set("boxes", "1");
  if (!view.labels) address.set("labels", "0");
  if (view.cut !== undefined) address.set("cut", String(view.cut));
  history.replaceState(null, "", `?${address}`);
}

// ---- Drawn on top of the level ----

/** TV cabinets and anything else in the way that the game draws with a model, as plain boxes. */
function addFurniture({ scene, shadows }: World, shown: Level) {
  const material = surfaceMaterial("furniture", scene, new Color3(0.16, 0.14, 0.13), {
    roughness: 0.6,
  });
  for (const [i, box] of shown.boxes.entries()) {
    if (box.kind !== "furniture") continue;
    const mesh = MeshBuilder.CreateBox(
      `furniture${i}`,
      { width: box.maxX - box.minX, height: box.height, depth: box.maxZ - box.minZ },
      scene,
    );
    mesh.position.set((box.minX + box.maxX) / 2, box.y + box.height / 2, (box.minZ + box.maxZ) / 2);
    mesh.material = material;
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
  }
}

/** Every box players collide with, floors and where ladders climb, in wireframe by kind. */
function addBoxOverlay({ scene }: World, shown: Level): Mesh[] {
  const groups = new Map<string, Mesh[]>();
  const add = (kind: string, minY: number, maxY: number, box: LevelBox | Floor | Ladder) => {
    const mesh = MeshBuilder.CreateBox(
      kind,
      {
        width: Math.max(0.01, box.maxX - box.minX),
        height: Math.max(0.01, maxY - minY),
        depth: Math.max(0.01, box.maxZ - box.minZ),
      },
      scene,
    );
    mesh.position.set((box.minX + box.maxX) / 2, (minY + maxY) / 2, (box.minZ + box.maxZ) / 2);
    groups.set(kind, [...(groups.get(kind) ?? []), mesh]);
  };
  for (const box of shown.boxes) add(box.kind, box.y, box.y + box.height, box);
  for (const floor of shown.floors) {
    add("floor", floor.y - floor.thickness, floor.y + (floor.rise?.height ?? 0), floor);
  }
  for (const ladder of shown.ladders) add("ladder", ladder.y, ladder.top, ladder);
  const merged: Mesh[] = [];
  for (const [kind, meshes] of groups) {
    const mesh = Mesh.MergeMeshes(meshes, true, true);
    if (!mesh) continue;
    const material = new StandardMaterial(`overlay-${kind}`, scene);
    material.wireframe = true;
    material.disableLighting = true;
    material.emissiveColor = Color3.FromHexString(BOX_COLORS[kind as keyof typeof BOX_COLORS]);
    mesh.material = material;
    mesh.isPickable = false;
    merged.push(mesh);
  }
  return merged;
}

const labelMaterials = new Map<string, StandardMaterial>();

/** A flat label facing the camera, `height` meters high. */
function label(world: World, text: string, at: Vector3, height: number, color: string): Mesh {
  const { scene } = world;
  const font = 44;
  const width = Math.ceil(text.length * font * 0.58 + font);
  const key = `${text}|${color}`;
  let material = labelMaterials.get(key);
  if (!material || material.getScene() !== scene) {
    const texture = new DynamicTexture(`label-${text}`, { width, height: 64 }, scene);
    texture.hasAlpha = true;
    const context = texture.getContext();
    context.fillStyle = "rgba(0, 0, 0, 0.55)";
    context.fillRect(0, 0, width, 64);
    texture.drawText(text, null, 46, `bold ${font}px system-ui, sans-serif`, color, null);
    material = new StandardMaterial(`label-${text}`, scene);
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.useAlphaFromDiffuseTexture = true;
    labelMaterials.set(key, material);
  }
  const plane = MeshBuilder.CreatePlane(
    `label-${text}`,
    { width: (height * width) / 64, height },
    scene,
  );
  plane.position.copyFrom(at);
  plane.billboardMode = TransformNode.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  plane.material = material;
  return plane;
}

/** What a tile is, in a few words. */
function describe(tile: Tile | undefined): string {
  if (!tile) return "outside";
  switch (tile.kind) {
    case "stairs":
    case "ladder":
      return `${tile.kind} up ${tile.up}`;
    case "bridge":
      return `bridge along ${tile.along}`;
    case "well":
      return `well from ${tile.from}`;
    default:
      return tile.kind;
  }
}

/** The name over each piece, and over each cell that isn't plain floor, rock or air. */
function addLabels(shownWorld: World, shown: Source): Mesh[] {
  const made: Mesh[] = [];
  for (const piece of shown.pieces) {
    const { parsed, grid } = piece;
    const top = (grid.storeys.length - (grid.basements ?? 0)) * STOREY;
    if (shown.pieces.length > 1) {
      const middle = new Vector3(
        grid.x + (parsed.cols * CELL) / 2,
        top + 0.8,
        grid.z + (parsed.rows * CELL) / 2,
      );
      made.push(label(shownWorld, piece.name, middle, 0.9, "#ffe9a8"));
    }
    for (
      let storey = -parsed.basements;
      storey < parsed.tiles.length - parsed.basements;
      storey++
    ) {
      for (let row = 0; row < parsed.rows; row++) {
        for (let col = 0; col < parsed.cols; col++) {
          const tile = parsed.tile(storey, col, row);
          const entrance =
            piece.entrance?.storey === storey &&
            piece.entrance.col === col &&
            piece.entrance.row === row;
          if (!entrance && (!tile || ["floor", "solid", "open"].includes(tile.kind))) continue;
          const text = entrance ? "entrance" : describe(tile);
          const at = new Vector3(
            grid.x + (col + 0.5) * CELL,
            storey * STOREY + (tile?.kind === "well" || tile?.kind === "shaft" ? 1.8 : 0.9),
            grid.z + (row + 0.5) * CELL,
          );
          made.push(label(shownWorld, text, at, 0.32, entrance ? "#9be59b" : "#ffffff"));
        }
      }
    }
  }
  return made;
}

/** A see-through box round the selected cell, from its floor to the next. */
function showHighlight() {
  if (!world) return;
  highlight?.dispose();
  highlight = undefined;
  const piece = selection && source?.pieces[selection.piece];
  if (!selection || !piece) return;
  const box = MeshBuilder.CreateBox(
    "selected",
    { width: CELL - 0.04, height: STOREY - 0.04, depth: CELL - 0.04 },
    world.scene,
  );
  box.position.set(
    piece.grid.x + (selection.col + 0.5) * CELL,
    selection.storey * STOREY + STOREY / 2,
    piece.grid.z + (selection.row + 0.5) * CELL,
  );
  const material = new StandardMaterial("selected", world.scene);
  material.disableLighting = true;
  material.emissiveColor = new Color3(1, 0.88, 0.3);
  material.alpha = 0.12;
  box.material = material;
  box.isPickable = false;
  box.enableEdgesRendering();
  box.edgesWidth = 3;
  box.edgesColor = new Color3(1, 0.88, 0.3).toColor4(1);
  highlight = box;
}

// ---- Picking a cell ----

/** Where a ray first meets a box between two heights, and the face it meets. */
function hitBox(
  ray: Ray,
  min: [number, number, number],
  max: [number, number, number],
): { t: number; normal: Vector3 } | undefined {
  const origin = [ray.origin.x, ray.origin.y, ray.origin.z];
  const direction = [ray.direction.x, ray.direction.y, ray.direction.z];
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]) < 1e-9) {
      if (origin[i] < min[i] || origin[i] > max[i]) return undefined;
      continue;
    }
    let t1 = (min[i] - origin[i]) / direction[i];
    let t2 = (max[i] - origin[i]) / direction[i];
    let faceSign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      faceSign = 1;
    }
    if (t1 > near) {
      near = t1;
      axis = i;
      sign = faceSign;
    }
    far = Math.min(far, t2);
    if (near > far) return undefined;
  }
  if (axis < 0) return undefined;
  const normal = Vector3.Zero();
  normal.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
  return { t: near, normal };
}

/**
 * The cell under the pointer: the space just in front of the first surface it's over, below any cut,
 * so a floor picks the cell above it and a wall the cell it's seen from. Stairs pick themselves.
 */
function pick() {
  if (!world || !level || !source) return;
  const camera = world.scene.activeCamera;
  if (!camera) return;
  const ray = world.scene.createPickingRay(
    world.scene.pointerX,
    world.scene.pointerY,
    Matrix.Identity(),
    camera,
  );
  const cut = cutHeight() ?? Number.POSITIVE_INFINITY;
  let best: { t: number; normal: Vector3; stairs?: Floor } | undefined;
  const consider = (minY: number, maxY: number, box: LevelBox | Floor, stairs?: Floor) => {
    const top = Math.min(maxY, cut);
    if (minY >= top) return;
    const hit = hitBox(ray, [box.minX, minY, box.minZ], [box.maxX, top, box.maxZ]);
    if (hit && (!best || hit.t < best.t)) best = { ...hit, stairs };
  };
  for (const box of level.boxes) {
    if (box.kind === "stairs") continue;
    consider(box.y, box.y + box.height, box);
  }
  for (const floor of level.floors) {
    const stairs = floor.kind === "stairs" ? floor : undefined;
    consider(floor.y - floor.thickness, floor.y + (floor.rise?.height ?? 0), floor, stairs);
  }
  const found = best as { t: number; normal: Vector3; stairs?: Floor } | undefined;
  if (!found) return;
  const point = ray.origin.add(ray.direction.scale(found.t));
  const inside = found.stairs
    ? new Vector3(
        point.x - found.normal.x * 0.05,
        found.stairs.y + 0.05,
        point.z - found.normal.z * 0.05,
      )
    : point.add(found.normal.scale(0.05));
  select(cellAt(inside));
}

function cellAt(point: Vector3): Selection | undefined {
  if (!source) return undefined;
  for (const [index, piece] of source.pieces.entries()) {
    const col = Math.floor((point.x - piece.grid.x) / CELL);
    const row = Math.floor((point.z - piece.grid.z) / CELL);
    const storey = Math.floor(point.y / STOREY);
    if (col < 0 || row < 0 || col >= piece.parsed.cols || row >= piece.parsed.rows) continue;
    if (storey < -piece.parsed.basements) continue;
    return { piece: index, storey, col, row };
  }
  return undefined;
}

function select(next: Selection | undefined) {
  selection = next;
  showHighlight();
  showPanel();
}

// ---- Flying ----

/** Between orbiting and flying at eye height, from the selected cell or what the orbit looks at. */
function toggleFly() {
  if (!world) return;
  const { scene } = world;
  const orbit = world.lobbyCamera;
  if (fly && scene.activeCamera === fly) {
    fly.detachControl();
    const forward = fly.getDirection(Vector3.Forward());
    orbit.setTarget(fly.position.add(forward.scale(4)));
    orbit.radius = 4;
    orbit.alpha = Math.atan2(-forward.z, -forward.x);
    orbit.beta = 1.2;
    scene.activeCamera = orbit;
    orbit.attachControl();
    return;
  }
  if (!fly) {
    fly = new FreeCamera("fly", Vector3.Zero(), scene);
    fly.fov = 1.1;
    fly.minZ = 0.05;
    fly.speed = 0.18;
    fly.inertia = 0.7;
    fly.angularSensibility = 1500;
    fly.keysUp = [87];
    fly.keysDown = [83];
    fly.keysLeft = [65];
    fly.keysRight = [68];
    fly.keysUpward = [69];
    fly.keysDownward = [81];
    addCameraEffects(scene, fly);
  }
  const piece = selection && source?.pieces[selection.piece];
  const start =
    selection && piece
      ? new Vector3(
          piece.grid.x + (selection.col + 0.5) * CELL,
          selection.storey * STOREY + EYE,
          piece.grid.z + (selection.row + 0.5) * CELL,
        )
      : new Vector3(
          orbit.target.x,
          Math.floor(orbit.target.y / STOREY) * STOREY + EYE,
          orbit.target.z,
        );
  const look = orbit.target.subtract(orbit.position);
  look.y = 0;
  fly.position.copyFrom(start);
  fly.setTarget(start.add(look.lengthSquared() > 0 ? look.normalize() : Vector3.Forward()));
  orbit.detachControl();
  scene.activeCamera = fly;
  fly.attachControl(true);
  canvas.focus();
}

// ---- The panel's cell, map and errors ----

function showPanel() {
  $("seed-row").style.display = view.kind === "generated" ? "" : "none";
  $("note").textContent = source?.note ?? "";
  $("error").textContent = error;
  $("fly").textContent = fly && world?.scene.activeCamera === fly ? "Orbit (Tab)" : "Fly (Tab)";
  showInfo();
  showMaps();
}

function mark(ok: boolean) {
  return ok ? `<span class="good">✓</span>` : `<span class="bad">✗</span>`;
}

/** Whether the edge between two tiles is all right, as composeTiles and the generator see it. */
function edgeOk(mine: Tile, theirs: Tile | undefined, side: (typeof SIDES)[number], edge: Edge) {
  const a = socket(mine, side);
  const mustLeadOn = ["plank", "stairs-foot", "arrival"];
  const passable = ["floor", "plank", "stairs-foot", "arrival"];
  if (edge === "wall" && mustLeadOn.includes(a)) return false;
  if (edge === "door" && !passable.includes(a)) return false;
  if (!theirs || edge === "wall") return true;
  return fits(a, socket(theirs, OPPOSITE[side]));
}

function showInfo() {
  const info = $("info");
  const piece = selection && source?.pieces[selection.piece];
  if (!selection || !piece) {
    info.className = "info muted";
    info.textContent = "Click a cell, here or in the view.";
    return;
  }
  info.className = "info";
  const { storey, col, row } = selection;
  const grid = piece.parsed;
  const tile = grid.tile(storey, col, row);
  if (!tile) {
    info.textContent = "Outside the grid.";
    return;
  }
  const below = grid.tile(storey - 1, col, row);
  const above = grid.tile(storey + 1, col, row);
  const sides = SIDES.map((side) => {
    const [dx, dz] = OFFSET[side];
    const next = grid.tile(storey, col + dx, row + dz);
    const edge = grid.edge(storey, col, row, side);
    return `<tr><td>${side}</td><td>${edge === "none" ? "" : edge}</td><td>${socket(tile, side)}</td><td>${
      next
        ? `${describe(next)} <span class="muted">${socket(next, OPPOSITE[side])}</span>`
        : "outside"
    }</td><td>${mark(edgeOk(tile, next, side, edge))}</td></tr>`;
  }).join("");
  info.innerHTML = `
    <div><b>${describe(tile)}</b> <span class="muted">"${tileChar(tile)}" · ${piece.name}</span></div>
    <div class="muted">storey ${storey}, column ${col}, row ${row} · x ${piece.grid.x + col * CELL}…${piece.grid.x + (col + 1) * CELL}, z ${piece.grid.z + row * CELL}…${piece.grid.z + (row + 1) * CELL}</div>
    <table>
      <tr class="muted"><td></td><td>edge</td><td>socket</td><td>next to it</td><td></td></tr>
      ${sides}
      <tr><td>above</td><td></td><td></td><td>${describe(above ?? { kind: "open" })}</td><td>${mark(fitsAbove(tile, above ?? { kind: "open" }))}</td></tr>
      <tr><td>below</td><td></td><td></td><td>${below ? describe(below) : "nothing"}</td><td>${mark(fitsAbove(below, tile))}</td></tr>
    </table>`;
}

/** Each storey of the selected piece as a map, the highest first, with its walls and doorways. */
function showMaps() {
  const maps = $("maps");
  maps.innerHTML = "";
  const index = selection?.piece ?? 0;
  const piece = source?.pieces[index];
  if (!piece) return;
  const grid = piece.parsed;
  const border = (edge: Edge) =>
    edge === "wall" ? "3px solid #f2f2f2" : edge === "door" ? "3px dashed #ff6b5b" : "";
  for (let storey = grid.tiles.length - grid.basements - 1; storey >= -grid.basements; storey--) {
    const title = document.createElement("div");
    title.className = "muted";
    title.textContent = `${piece.name} · storey ${storey}${storey < 0 ? " (basement)" : storey === 0 ? " (ground)" : ""}`;
    maps.append(title);
    const map = document.createElement("div");
    map.className = "map";
    map.style.gridTemplateColumns = `repeat(${grid.cols}, 22px)`;
    for (let row = grid.rows - 1; row >= 0; row--) {
      for (let col = 0; col < grid.cols; col++) {
        const tile = grid.tile(storey, col, row) as Tile;
        const cell = document.createElement("div");
        cell.className = "cell";
        const [background, color] = TILE_COLORS[tile.kind];
        cell.style.background = background;
        cell.style.color = color;
        cell.textContent =
          tile.kind === "well" ? "w" : tile.kind === "shaft" ? "s" : tileChar(tile);
        cell.title = `${describe(tile)} · column ${col}, row ${row}`;
        for (const side of SIDES) {
          const style = border(grid.edge(storey, col, row, side));
          if (!style) continue;
          const property = { n: "borderTop", e: "borderRight", s: "borderBottom", w: "borderLeft" }[
            side
          ];
          cell.style[property as "borderTop"] = style;
        }
        const here = selection;
        if (
          here &&
          here.piece === index &&
          here.storey === storey &&
          here.col === col &&
          here.row === row
        ) {
          cell.classList.add("selected");
        }
        if (
          piece.entrance?.storey === storey &&
          piece.entrance.col === col &&
          piece.entrance.row === row
        ) {
          cell.classList.add("entrance");
        }
        cell.addEventListener("click", () => select({ piece: index, storey, col, row }));
        map.append(cell);
      }
    }
    maps.append(map);
  }
}

rebuild(true);
engine.runRenderLoop(() => world?.scene.render());

// For the console and automated checks, as `__game` is in the game.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __tiles: {
      engine,
      world: () => world,
      level: () => level,
      source: () => source,
      select,
      view,
      rebuild,
    },
  });
}
