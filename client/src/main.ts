import { MAX_LOCAL_PLAYERS } from "../../shared/constants";
import { CrateView } from "./crates";
import { createEngine } from "./graphics";
import { attachMouse, type Device, listDevices } from "./input";
import { LocalPlayer } from "./localPlayer";
import { PlayerView } from "./players";
import { reloadOnNewBuild } from "./reload";
import { createWorld } from "./scene";
import { panes } from "./splitscreen";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;

const engine = await createEngine(canvas);
const world = createWorld(engine);
attachMouse(canvas);
addEventListener("resize", () => engine.resize());

const locals: LocalPlayer[] = [];
const views = new Map<string, PlayerView>();
const crates = new Map<string, CrateView>();
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
function syncViews() {
  const seen = new Map<string, { name: string; color: string; x: number; z: number }>();
  for (const { session } of locals) {
    if (!session) continue;
    const { self, predict, sessionId } = session;
    seen.set(sessionId, {
      name: self.name,
      color: self.color,
      x: predict.value(self, "x"),
      z: predict.value(self, "z"),
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
    view.setPosition(player.x, player.z);
  }
}

/** Every crate, as the first connection sees it: they all see the same room. */
function syncCrates() {
  const session = locals.find((local) => local.session)?.session;
  const state = session?.room.state.crates;
  for (const [id, view] of crates) {
    if (state?.has(id)) continue;
    view.dispose();
    crates.delete(id);
  }
  if (!session || !state) return;
  for (const [id, crate] of state) {
    let view = crates.get(id);
    if (!view) {
      view = new CrateView(world, id);
      crates.set(id, view);
    }
    const { predict } = session;
    view.setPose(
      predict.value(crate, "x"),
      predict.value(crate, "y"),
      predict.value(crate, "z"),
      predict.value(crate, "qx"),
      predict.value(crate, "qy"),
      predict.value(crate, "qz"),
      predict.value(crate, "qw"),
    );
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
  hint.textContent = "Join: A or Start on a controller · Space (WASD) · Enter (arrows)";
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
if (import.meta.env.DEV)
  Object.assign(window, { __game: { locals, views, crates, world, engine } });

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  pollDevices();
  for (const local of locals) local.update(dt);
  world.lobbyCamera.alpha += dt * 0.1;
  syncViews();
  syncCrates();
  layoutPanes();
  world.scene.render();
});
