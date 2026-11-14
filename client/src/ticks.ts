import { Vector3 } from "@babylonjs/core";
import { LATCH_AHEAD, LATCH_HEIGHT, type TickState } from "../../shared/ticks";
import type { LocalPlayer } from "./localPlayer";
import type { World } from "./scene";
import { type TickPose, TickView } from "./tick";
import { tunables } from "./tuning";

/**
 * The room's ticks, drawn where the server says (server/src/ticks.ts moves them): walking, waiting
 * on a perch, in the air with their legs curled, on their back when pulled off, and clinging to a
 * player's face. One on us fills the view, belly to the camera.
 */

const FACE = tunables("Feel/Tick on your face", {
  ahead: { value: 0.42, min: 0.2, max: 1, hint: "Meters in front of the eyes" },
  down: { value: 0.1, min: -0.3, max: 0.5, hint: "Meters below them" },
  shake: { value: 0.012, min: 0, max: 0.05, hint: "How far it jerks about, meters" },
});

/** A tick on its back lies this high, on its shield. */
const ON_BACK = 0.34;

interface Shown {
  view: TickView;
  state: TickState;
  clock: number;
}

const shown = new Map<string, Shown>();

/** Once a frame: every tick in the room, where it is and how it holds itself. */
export function syncTicks(world: World, player: LocalPlayer | undefined, dt: number) {
  const session = player?.session;
  const ticks = session?.room.state.ticks;
  for (const [id, { view }] of shown) {
    if (ticks?.has(id)) continue;
    view.dispose();
    shown.delete(id);
  }
  if (!session || !ticks) return;
  // Through whose eyes we look: our own, or those of whoever we watch.
  const eyes = player.watched() ?? session.sessionId;
  const camera = world.scene.activeCamera;

  for (const [id, tick] of ticks) {
    let entry = shown.get(id);
    if (!entry) {
      entry = {
        view: new TickView(world.scene, world.shadows, id),
        state: tick.state as TickState,
        clock: Math.random() * 10,
      };
      shown.set(id, entry);
    }
    const { view } = entry;
    const state = tick.state as TickState;
    // It hisses as it leaps or drops, and as a light finds it.
    if (
      state !== entry.state &&
      (state === "airborne" || state === "wary" || state === "fleeing")
    ) {
      if (entry.state !== "latched") view.hissNow();
    }
    entry.state = state;
    entry.clock += dt;

    let x = session.predict.value(tick, "x");
    let y = session.predict.value(tick, "y");
    let z = session.predict.value(tick, "z");
    let yaw = tick.yaw;
    const pose: TickPose = {};
    view.root.rotation.x = 0;
    view.root.rotation.z = 0;

    const victim = state === "latched" ? session.room.state.players.get(tick.victim) : undefined;
    if (victim && tick.victim === eyes && camera) {
      // On our face: in front of the camera wherever it looks, upright, its belly towards us.
      const forward = camera.getDirection(Vector3.Forward());
      const up = camera.getDirection(Vector3.Up());
      const jerk = (speed: number) => FACE.shake * Math.sin(entry.clock * speed);
      const at = camera.position
        .add(forward.scale(FACE.ahead))
        .add(up.scale(-FACE.down + jerk(23)))
        .add(camera.getDirection(Vector3.Right()).scale(jerk(17)));
      x = at.x;
      y = at.y;
      z = at.z;
      yaw = Math.atan2(forward.x, forward.z) + Math.PI;
      // Turned half round from the camera, so pitching with it is the other way about its own x.
      view.root.rotation.x = -Math.PI / 2 + Math.asin(Math.max(-1, Math.min(1, forward.y)));
      pose.loose = true;
    } else if (victim) {
      // On someone else's: the same place the server keeps it, standing on end.
      x = session.predict.value(victim, "x") + Math.sin(victim.yaw) * LATCH_AHEAD;
      y = session.predict.value(victim, "y") + LATCH_HEIGHT;
      z = session.predict.value(victim, "z") + Math.cos(victim.yaw) * LATCH_AHEAD;
      yaw = victim.yaw + Math.PI;
      view.root.rotation.x = -Math.PI / 2;
      pose.loose = true;
    } else if (state === "stunned") {
      view.root.rotation.z = Math.PI;
      y += ON_BACK;
      pose.loose = true;
    } else if (state === "airborne") {
      pose.loose = true;
    } else if (state === "wary") {
      pose.rear = true;
    } else if (state === "perched") {
      pose.still = true;
    }
    pose.y = y;
    view.update(x, z, yaw, dt, pose);
  }
}

/** The tick on a player, if one is. */
export function tickOn(player: LocalPlayer | undefined): boolean {
  const session = player?.session;
  if (!session) return false;
  for (const tick of session.room.state.ticks.values()) {
    if (tick.victim === session.sessionId) return true;
  }
  return false;
}
