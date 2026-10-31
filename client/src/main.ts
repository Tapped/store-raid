import { type ItemKind, MAX_LOCAL_PLAYERS } from "../../shared/constants";
import { createEngine } from "./graphics";
import { addHarbour } from "./harbour";
import { attachMouse, type Device, listDevices } from "./input";
import { ItemView } from "./items";
import { LocalPlayer } from "./localPlayer";
import { PlayerView } from "./players";
import { addProps } from "./props";
import { reloadOnNewBuild } from "./reload";
import { createWorld } from "./scene";
import { panes } from "./splitscreen";
import { addShelves } from "./store";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;

const engine = await createEngine(canvas);
const world = createWorld(engine);
void addProps(world);
void addShelves(world);
void addHarbour(world.scene);
attachMouse(canvas);
addEventListener("resize", () => engine.resize());

const locals: LocalPlayer[] = [];
const views = new Map<string, PlayerView>();
const items = new Map<string, ItemView>();
const labels: HTMLDivElement[] = [];

const SEATS_KEY = "seats";
/** Device id → seat, for players coming back from a reload. Controllers return on their next press. */
const savedSeats = new Map<string, string>(JSON.parse(sessionStorage.getItem(SEATS_KEY) ?? "[]"));
sessionStorage.removeItem(SEATS_KEY);

/** Seats are P1–P4; a new player takes the lowest free one. */
function freeName(): string {
  const saved = [...savedSeats.values()];
  for (let seat = 1; ; seat++) {
    const name = `P${seat}`;
    if (!locals.some((local) => local.name === name) && !saved.includes(name)) return name;
  }
}

function join(device: Device, name = freeName()) {
  locals.push(new LocalPlayer(world, device, name));
  locals.sort((a, b) => a.name.localeCompare(b.name));
}

function leave(local: LocalPlayer) {
  local.leave();
  locals.splice(locals.indexOf(local), 1);
}

function pollDevices() {
  for (const device of listDevices()) {
    if (device.reloadHeld()) location.reload();
    const local = locals.find((l) => l.device === device);
    // Always ask, so a press made while seated or full isn't saved up for later.
    const joinPressed = device.joinPressed();
    const leavePressed = device.leavePressed();
    if (device.grabPressed()) local?.grabOrDrop();
    const seat = savedSeats.get(device.id);
    if (seat) {
      savedSeats.delete(device.id);
      join(device, seat);
    } else if (local && leavePressed) leave(local);
    else if (!local && joinPressed && locals.length < MAX_LOCAL_PLAYERS) join(device);
  }
}

/**
 * Everyone in the room, once: each connection sees the same players, so take local players from
 * their own prediction and the rest from whichever connection is first.
 */
function syncViews(dt: number) {
  const seen = new Map<
    string,
    { name: string; color: string; x: number; z: number; carrying: boolean }
  >();
  for (const { session } of locals) {
    if (!session) continue;
    const { self, predict, sessionId } = session;
    seen.set(sessionId, {
      name: self.name,
      color: self.color,
      x: predict.value(self, "x"),
      z: predict.value(self, "z"),
      carrying: self.carrying !== "",
    });
  }
  for (const { session } of locals) {
    if (!session) continue;
    for (const [sessionId, player] of session.room.state.players) {
      if (seen.has(sessionId)) continue;
      seen.set(sessionId, {
        name: player.name,
        color: player.color,
        x: session.predict.value(player, "x"),
        z: session.predict.value(player, "z"),
        carrying: player.carrying !== "",
      });
    }
  }

  for (const [sessionId, view] of views) {
    if (seen.has(sessionId)) continue;
    view.dispose();
    views.delete(sessionId);
  }
  for (const [sessionId, player] of seen) {
    let view = views.get(sessionId);
    if (!view) {
      view = new PlayerView(world, player.name, player.color);
      views.set(sessionId, view);
    }
    view.update(player.x, player.z, player.carrying, dt);
  }
}

/** Every item, as the first connection sees it: they all see the same room. */
function syncItems() {
  const session = locals.find((local) => local.session)?.session;
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

/** Give every local player their part of the screen, and a label on top of it. */
function layoutPanes() {
  const layout = panes(locals.length);
  for (const [i, local] of locals.entries()) {
    const pane = layout[i];
    local.camera.viewport.x = pane.x;
    local.camera.viewport.y = pane.y;
    local.camera.viewport.width = pane.width;
    local.camera.viewport.height = pane.height;

    let label = labels[i];
    if (!label) {
      label = document.createElement("div");
      label.className = "pane";
      label.append(document.createElement("span"));
      document.body.append(label);
      labels[i] = label;
    }
    label.style.display = "";
    label.style.left = `${pane.x * 100}%`;
    label.style.bottom = `${pane.y * 100}%`;
    label.style.width = `${pane.width * 100}%`;
    label.style.height = `${pane.height * 100}%`;
    const unplugged = local.device.connected() ? "" : " · controller disconnected";
    (label.firstChild as HTMLElement).textContent =
      `${local.name} · ${local.device.label}${unplugged}${local.status ? ` · ${local.status}` : ""}`;
  }
  for (let i = locals.length; i < labels.length; i++) labels[i].style.display = "none";

  world.scene.activeCameras = locals.length
    ? locals.map((local) => local.camera)
    : [world.lobbyCamera];

  hint.style.display = locals.length < MAX_LOCAL_PLAYERS ? "" : "none";
  hint.textContent =
    "Join: A or Start on a controller · Space (WASD) · Enter (arrows) | Grab/drop: X · F · Right Shift";
}

if (import.meta.env.PROD) reloadOnNewBuild();

// Chrome can keep a page we navigated away from alive in its back/forward cache, sockets included,
// which would leave our players standing in the room. So hang up, and rejoin if we're brought back.
addEventListener("pagehide", () => {
  const seats = locals.map((local) => [local.device.id, local.name]);
  sessionStorage.setItem(SEATS_KEY, JSON.stringify(seats));
  for (const local of locals) void local.session?.room.leave();
});
addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});

// Debug handle for the browser console and automated smoke tests (dev builds only).
if (import.meta.env.DEV) Object.assign(window, { __game: { locals, views, items, world, engine } });

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  pollDevices();
  for (const local of locals) local.update(dt);
  world.lobbyCamera.alpha += dt * 0.1;
  syncViews(dt);
  syncItems();
  layoutPanes();
  world.scene.render();
});
