import type { ItemKind } from "../../shared/constants";
import { levelNamed } from "../../shared/level";
import { addAmbience } from "./ambience";
import { createEngine } from "./graphics";
import { POSES } from "./hands";
import { addHarbour } from "./harbour";
import { attachMouse, input } from "./input";
import { ItemView } from "./items";
import { LocalPlayer } from "./localPlayer";
import { occludeIn } from "./occlusion";
import { PlayerView } from "./players";
import { addPlayground } from "./playground";
import { addProps } from "./props";
import { reloadOnNewBuild } from "./reload";
import { createWorld } from "./scene";
import { addScreens } from "./screens";
import { addShelves } from "./store";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;
const status = document.getElementById("status") as HTMLDivElement;

const engine = await createEngine(canvas);
// The building to play in: `?level=store` for the store, `?level=generated-<seed>` for a generated
// one, else the playground, the hall to try things out in. Roofed levels are halls like the playground.
const world = createWorld(engine, levelNamed(new URLSearchParams(location.search).get("level")));
const playground = world.level.roof !== undefined ? addPlayground(world) : undefined;
if (!playground) {
  void addProps(world);
  void addShelves(world);
  void addHarbour(world.scene);
}
occludeIn(world.scene, world.level);
void addAmbience(world);
void addScreens(world);
attachMouse(canvas);
addEventListener("resize", () => engine.resize());

let player: LocalPlayer | undefined;
const views = new Map<string, PlayerView>();
const items = new Map<string, ItemView>();

/** Set while playing, so a reload puts the player straight back in. */
const JOINED_KEY = "joined";
const NAME_KEY = "name";

/**
 * The name the server knows this player by, and saves their state under: `?name=` if given, else
 * one made up on the first visit and kept in this browser.
 */
function playerName(): string {
  const asked = new URLSearchParams(location.search).get("name")?.trim();
  if (asked) return asked;
  let name = localStorage.getItem(NAME_KEY);
  if (!name) {
    name = `Player-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(NAME_KEY, name);
  }
  return name;
}

function join() {
  player = new LocalPlayer(world, input, playerName());
  world.scene.activeCamera = player.camera;
  sessionStorage.setItem(JOINED_KEY, "1");
}

function leave() {
  player?.leave();
  player = undefined;
  document.exitPointerLock();
  world.scene.activeCamera = world.lobbyCamera;
  sessionStorage.removeItem(JOINED_KEY);
}

let grabWasHeld = false;

function pollInput() {
  if (input.reloadHeld()) location.reload();
  // Always ask, so a press made while playing isn't saved up for later.
  const joinPressed = input.joinPressed();
  const leavePressed = input.leavePressed();
  if (input.grabPressed()) player?.grab();
  const grabHeld = input.grabHeld();
  if (grabWasHeld && !grabHeld) player?.release();
  grabWasHeld = grabHeld;
  if (input.dropPressed()) player?.drop();
  if (player && leavePressed) leave();
  else if (!player && joinPressed) join();
}

/** Everyone else in the room, interpolated. Our own player is the camera, and isn't drawn. */
function syncViews(dt: number) {
  const session = player?.session;
  const players = session ? session.room.state.players : new Map();
  for (const [sessionId, view] of views) {
    if (players.has(sessionId) && sessionId !== session?.sessionId) continue;
    view.dispose();
    views.delete(sessionId);
  }
  if (!session) return;
  for (const [sessionId, state] of session.room.state.players) {
    if (sessionId === session.sessionId) continue;
    let view = views.get(sessionId);
    if (!view) {
      view = new PlayerView(world, state.name, state.color);
      views.set(sessionId, view);
    }
    const x = session.predict.value(state, "x");
    const y = session.predict.value(state, "y");
    const z = session.predict.value(state, "z");
    // The carry pose holds things in both arms; one-handed things just hang at the side.
    const inBothArms = state.left !== "" && state.left === state.right;
    view.update(x, y, z, state.yaw, inBothArms, state.vy === 0, dt);
  }
}

/** Every item in the room. */
function syncItems() {
  const session = player?.session;
  const state = session?.room.state.items;
  for (const [id, view] of items) {
    if (state?.has(id)) continue;
    view.dispose();
    items.delete(id);
  }
  if (!session || !state) return;
  for (const [id, item] of state) {
    let view = items.get(id);
    if (!view) {
      view = new ItemView(world, id, item.kind as ItemKind);
      items.set(id, view);
    }
    const { predict } = session;
    view.setPose(
      predict.value(item, "x"),
      predict.value(item, "y"),
      predict.value(item, "z"),
      predict.value(item, "qx"),
      predict.value(item, "qy"),
      predict.value(item, "qz"),
      predict.value(item, "qw"),
    );
    view.setDelivered(item.delivered);
  }
}

function showStatus() {
  status.textContent = player?.status ?? "";
  status.style.display = status.textContent ? "" : "none";
  hint.textContent = player
    ? "Click to look with the mouse | Jump: Space · A | Grab: E · RB | Drop: Q · LB | Leave: Esc · Back"
    : "Join: Space or Enter · A or Start on a controller";
}

if (sessionStorage.getItem(JOINED_KEY)) join();
if (import.meta.env.PROD) reloadOnNewBuild();

// Chrome can keep a page we navigated away from alive in its back/forward cache, sockets included,
// which would leave our players standing in the room. So hang up, and rejoin if we're brought back.
addEventListener("pagehide", () => {
  void player?.session?.room.leave();
});
addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});

// Debug handle for the browser console and automated smoke tests (dev builds only).
if (import.meta.env.DEV)
  Object.assign(window, {
    __game: { player: () => player, views, items, world, engine, handPoses: POSES },
  });

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  pollInput();
  player?.update(dt);
  world.lobbyCamera.alpha += dt * 0.1;
  syncViews(dt);
  syncItems();
  const light = player?.session?.room.state.light;
  if (light !== undefined) playground?.setLight(light);
  player?.updateHands(dt, items);
  showStatus();
  world.scene.render();
});
