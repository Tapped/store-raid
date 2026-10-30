import { Engine } from "@babylonjs/core";
import { MAX_LOCAL_PLAYERS } from "../../shared/constants";
import { quality } from "./graphics";
import { attachMouse, type Device, listDevices } from "./input";
import { LocalPlayer } from "./localPlayer";
import { PlayerView } from "./players";
import { createWorld } from "./scene";
import { panes } from "./splitscreen";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;

const engine = new Engine(canvas, true, undefined, quality === "high");
const world = createWorld(engine);
attachMouse(canvas);
addEventListener("resize", () => engine.resize());

const locals: LocalPlayer[] = [];
const views = new Map<string, PlayerView>();
const labels: HTMLDivElement[] = [];

/** Seats are P1–P4; a new player takes the lowest free one. */
function freeName(): string {
  for (let seat = 1; ; seat++) {
    if (!locals.some((local) => local.name === `P${seat}`)) return `P${seat}`;
  }
}

function join(device: Device) {
  locals.push(new LocalPlayer(world, device, freeName()));
  locals.sort((a, b) => a.name.localeCompare(b.name));
}

function leave(local: LocalPlayer) {
  local.leave();
  locals.splice(locals.indexOf(local), 1);
}

function pollDevices() {
  for (const device of listDevices()) {
    const local = locals.find((l) => l.device === device);
    // Always ask, so a press made while seated or full isn't saved up for later.
    const joinPressed = device.joinPressed();
    const leavePressed = device.leavePressed();
    if (local && leavePressed) leave(local);
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

// Debug handle for the browser console and automated smoke tests (dev builds only).
if (import.meta.env.DEV) Object.assign(window, { __game: { locals, views, world, engine } });

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  pollDevices();
  for (const local of locals) local.update(dt);
  world.lobbyCamera.alpha += dt * 0.1;
  syncViews();
  layoutPanes();
  world.scene.render();
});
