/**
 * Checks the hands: a bot holds a phone in each hand, can't take a TV with a hand busy, delivers the
 * phones and lifts the TV in both arms. Then two bots carry a sofa to the loading dock, and lift
 * another and walk apart so it falls. Exits non-zero if any of that doesn't happen. Needs your game
 * server running, in a fresh room (SERVER_PORT, else 2567).
 *
 *   pnpm exec tsx scripts/hands.ts
 */
import { ColyseusSDK } from "@colyseus/sdk";
import type server from "../server/src/app";
import type { MoveInput } from "../server/src/rooms/schema";
import { type Hand, MOVE_SCALE, TICK_RATE, YAW_SCALE } from "../shared/constants";

const port = process.env.SERVER_PORT ?? "2567";

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
    // Look where it walks, so what it carries stays in front of it.
    if (distance > 0.15) input.data.yaw = Math.round(Math.atan2(dx, dz) * YAW_SCALE);
    input.send();
    return distance <= 0.15;
  };
  /** Walks a route of waypoints alone. */
  const walkRoute = async (route: [number, number][]) => {
    for (const [x, z] of route) {
      for (let t = 0; !walk(x, z); t++) {
        if (t > TICK_RATE * 30) throw new Error(`${name} never reached ${x}, ${z}`);
        await tick();
      }
    }
  };
  /** Stands still and looks towards a point, for a few ticks so the server sees it. */
  const lookAt = async (x: number, z: number) => {
    for (let t = 0; t < 3; t++) {
      input.data.moveX = 0;
      input.data.moveZ = 0;
      input.data.yaw = Math.round(Math.atan2(x - self().x, z - self().z) * YAW_SCALE);
      input.send();
      await tick();
    }
  };
  const hand = (which: Hand) => room.send("hand", which);
  /** The kind of item in a hand, or "" when it's empty. */
  const holding = (which: Hand) => room.state.items.get(self()[which])?.kind ?? "";
  return { room, self, walk, walkRoute, lookAt, hand, holding };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1000 / TICK_RATE));

const a = await joinBot("hands-a");

const wait = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

/** Height of whatever is in a bot's hand. */
const heightIn = (bot: typeof a, which: Hand) => a.room.state.items.get(bot.self()[which])?.y ?? 0;

// A phone in each hand, from the pair at the front of the aisle at x = 6.
await a.walkRoute([
  [6, 13],
  [6, 9.7],
]);
a.hand("left");
await wait(300);
a.hand("right");
await wait(800);
check(a.holding("left") === "phone", "left hand takes a phone");
check(a.holding("right") === "phone", "right hand takes the other phone");
check(a.self().left !== a.self().right, "they are two different phones");
check(heightIn(a, "left") > 0.5 && heightIn(a, "right") > 0.5, "both phones are lifted");

// To the TV, still holding both.
await a.walkRoute([
  [6, 13],
  [-6, 13],
  [-6, 9.7],
]);
check(a.holding("left") === "phone" && a.holding("right") === "phone", "both phones came along");

// One hand free isn't enough for the TV: grabbing takes the dropped phone back instead.
const dropped = a.room.state.items.get(a.self().right);
a.hand("right");
await wait(800);
check(a.holding("right") === "", "right hand lets go of its phone");
// It fell at the player's side, so look at it first.
if (dropped) await a.lookAt(dropped.x, dropped.z);
a.hand("right");
await wait(300);
check(
  a.holding("right") === "phone",
  "with the left hand busy, the right takes a phone, not the TV",
);

// Deliver the phones.
await a.walkRoute([
  [-6, 13],
  [0, 16],
  [0, 23],
]);
const phones = [a.self().left, a.self().right];
a.hand("left");
a.hand("right");
await wait(1500);
check(
  phones.every((id) => a.room.state.items.get(id)?.delivered),
  "both phones count once dropped on the dock",
);

// The TV, in both arms.
await a.walkRoute([
  [0, 16],
  [-6, 13],
  [-6, 9.7],
]);
a.hand("left");
await wait(800);
check(a.holding("left") === "tv" && a.self().left === a.self().right, "the TV takes both hands");
check(heightIn(a, "left") > 0.8, `the TV is lifted (y ${heightIn(a, "left").toFixed(2)})`);
a.hand("right");
await wait(300);
check(a.self().left === "" && a.self().right === "", "either hand lets go of the TV");

// The sofa needs a second bot.
const b = await joinBot("hands-b");
await walkTogether(
  [
    [-6, 13],
    [0, 14],
  ],
  1.7,
);

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
await Promise.all([a.lookAt(sofa.x, sofa.z), b.lookAt(sofa.x, sofa.z)]);

// One person can't lift it.
a.hand("left");
await wait(500);
check(a.self().left === sofaId && a.self().right === sofaId, "first bot has hold of the sofa");
check(sofa.y < 0.7, `one bot can't lift it (y ${sofa.y.toFixed(2)})`);

b.hand("right");
await wait(800);
check(b.self().left === sofaId && b.self().right === sofaId, "second bot has hold of it too");
check(sofa.y > 0.8, `two bots lift it (y ${sofa.y.toFixed(2)})`);

await walkTogether(
  [
    [0, 0],
    [0, 24],
  ],
  1.7,
);
check(a.self().left === sofaId, "they got it through the aisle without dropping it");
check(sofa.z > 21, `it came along to the dock (z ${sofa.z.toFixed(1)})`);
check(!sofa.delivered, "it isn't delivered while still carried");

a.hand("left");
await wait(1500);
check(sofa.delivered, "dropped on the dock, it counts as delivered");
check(b.self().left === "", "letting go at one end drops it for both");
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
await Promise.all([a.lookAt(other.x, other.z), b.lookAt(other.x, other.z)]);
a.hand("left");
b.hand("left");
await wait(800);
check(other.y > 0.8, `the other sofa is lifted (y ${other.y.toFixed(2)})`);
for (let t = 0; t < TICK_RATE * 1.5; t++) {
  a.walk(-19, -19);
  b.walk(-5, -19);
  await tick();
}
await wait(1000);
check(a.self().left !== otherId && b.self().left !== otherId, "walking apart drops it");
check(other.y < 0.8, `and it falls (y ${other.y.toFixed(2)})`);

await a.room.leave();
await b.room.leave();
process.exit(process.exitCode ?? 0);
