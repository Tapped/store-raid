/**
 * Two bots carry a sofa to the loading dock, then lift one and walk apart so it falls. Exits non-zero
 * if any of that doesn't happen. Needs your game server running (SERVER_PORT from ~/.config/game.env).
 *
 *   npx tsx scripts/carry.ts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { ColyseusSDK } from "@colyseus/sdk";
import type server from "../server/src/app";
import type { MoveInput } from "../server/src/rooms/schema";
import { MOVE_SCALE, TICK_RATE } from "../shared/constants";

const env = readFileSync(`${homedir()}/.config/game.env`, "utf8");
const port = /^SERVER_PORT=(\d+)$/m.exec(env)?.[1] ?? "2567";
const client = new ColyseusSDK<typeof server>(`ws://127.0.0.1:${port}`);

async function joinBot(name: string) {
  const room = await client.joinOrCreate("game", { name });
  const input = room.input<MoveInput>({ mode: "reliable" });
  await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  const self = () => {
    const player = room.state.players.get(room.sessionId);
    if (!player) throw new Error(`${name} is missing from the room`);
    return player;
  };
  /** One tick of walking towards a point; true once there. */
  const walk = (x: number, z: number) => {
    const dx = x - self().x;
    const dz = z - self().z;
    const distance = Math.hypot(dx, dz);
    const scale = distance > 0.15 ? MOVE_SCALE / distance : 0;
    input.data.moveX = Math.round(dx * scale);
    input.data.moveZ = Math.round(dz * scale);
    input.send();
    return distance <= 0.15;
  };
  return { room, self, walk };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1000 / TICK_RATE));

const a = await joinBot("carry-a");
const b = await joinBot("carry-b");

/** Both walk their own route of waypoints, each waiting at every point for the other. */
async function walkTogether(route: [number, number][], side: number) {
  for (const [x, z] of route) {
    let done = false;
    for (let t = 0; !done; t++) {
      if (t > TICK_RATE * 30) throw new Error(`Never reached ${x}, ${z}`);
      const arrivedA = a.walk(x - side, z);
      const arrivedB = b.walk(x + side, z);
      done = arrivedA && arrivedB;
      await tick();
    }
  }
}

function findSofa(wanted: (x: number, z: number) => boolean) {
  for (const [id, item] of a.room.state.items) {
    if (item.kind === "sofa" && wanted(item.x, item.z)) return [id, item] as const;
  }
  throw new Error("No sofa where expected");
}

function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

const wait = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// To the sofa in the back of the middle aisle.
await walkTogether(
  [
    [0, 14],
    [0, -13],
    [0, -15],
  ],
  1.7,
);
const [sofaId, sofa] = findSofa((x) => Math.abs(x) < 3);

// One person can't lift it.
a.room.send("grab");
await wait(500);
check(a.self().carrying === sofaId, "first bot has hold of the sofa");
check(sofa.y < 0.7, `one bot can't lift it (y ${sofa.y.toFixed(2)})`);

b.room.send("grab");
await wait(800);
check(b.self().carrying === sofaId, "second bot has hold of it too");
check(sofa.y > 0.8, `two bots lift it (y ${sofa.y.toFixed(2)})`);

await walkTogether(
  [
    [0, 0],
    [0, 24],
  ],
  1.7,
);
check(a.self().carrying === sofaId, "they got it through the aisle without dropping it");
check(sofa.z > 21, `it came along to the dock (z ${sofa.z.toFixed(1)})`);
check(!sofa.delivered, "it isn't delivered while still carried");

a.room.send("drop");
await wait(1500);
check(sofa.delivered, "dropped on the dock, it counts as delivered");
check(b.self().carrying === "", "letting go at one end drops it for both");
console.log(
  `     landed at y ${sofa.y.toFixed(2)}, turned qx ${sofa.qx.toFixed(2)} qz ${sofa.qz.toFixed(2)}`,
);

// Walk apart with the other sofa, in the back corner.
await walkTogether(
  [
    [0, 14],
    [-6, 14],
    [-6, -14],
    [-12, -14],
    [-12, -15],
  ],
  1.7,
);
const [otherId, other] = findSofa((x) => x < -9);
a.room.send("grab");
b.room.send("grab");
await wait(800);
check(other.y > 0.8, `the other sofa is lifted (y ${other.y.toFixed(2)})`);
for (let t = 0; t < TICK_RATE * 1.5; t++) {
  a.walk(-19, -19);
  b.walk(-5, -19);
  await tick();
}
await wait(1000);
check(a.self().carrying !== otherId && b.self().carrying !== otherId, "walking apart drops it");
check(other.y < 0.8, `and it falls (y ${other.y.toFixed(2)})`);

await a.room.leave();
await b.room.leave();
process.exit(process.exitCode ?? 0);
