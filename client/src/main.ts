import { HANDS, type ItemKind } from "../../shared/constants";
import { createEngine } from "./graphics";
import { POSES } from "./hands";
import { addHarbour } from "./harbour";
import { attachMouse, input } from "./input";
import { ItemView } from "./items";
import { LocalPlayer } from "./localPlayer";
import { PlayerView } from "./players";
import { addProps } from "./props";
import { reloadOnNewBuild } from "./reload";
import { createWorld } from "./scene";
import { addShelves } from "./store";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;
const status = document.getElementById("status") as HTMLDivElement;

const engine = await createEngine(canvas);
const world = createWorld(engine);
void addProps(world);
void addShelves(world);
void addHarbour(world.scene);
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

function pollInput() {
  if (input.reloadHeld()) location.reload();
  // Always ask, so a press made while playing isn't saved up for later.
  const joinPressed = input.joinPressed();
  const leavePressed = input.leavePressed();
  for (const hand of HANDS) if (input.handPressed(hand)) player?.useHand(hand);
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
    const z = session.predict.value(state, "z");
    // The carry pose holds things in both arms; one-handed things just hang at the side.
    const inBothArms = state.left !== "" && state.left === state.right;
    view.update(x, z, state.yaw, inBothArms, dt);
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
    ? "Click to look with the mouse | Left hand: F · LB | Right hand: G · RB | Leave: Esc · Back"
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
  player?.updateHands(dt, items);
  showStatus();
  world.scene.render();
});
