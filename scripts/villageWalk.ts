/**
 * A bot walks the village from the truck up the track to the church door, and says where it
 * stuck or fell.
 *
 *   pnpm exec tsx scripts/villageWalk.ts [river]
 *
 * `river` walks a second way instead: over the footbridge to the farm across the river, then back
 * through the water.
 *
 * Joins your game server (SERVER_PORT, else 2567) in the village as a playground, so it starts
 * by the truck and can walk off. Steers for one point on the track after another, then up the
 * knoll's ramp and through the churchyard gate, printing where it is every few seconds. It
 * fails if it makes no headway for five seconds, or ever stands lower than the river's bed.
 */
import { ColyseusSDK } from "@colyseus/sdk";
import type server from "../server/src/app";
import type { MoveInput } from "../server/src/rooms/schema";
import { MOVE_SCALE, TICK_RATE } from "../shared/constants";
import { channel, roadX, valleyFloor, village, villageGround } from "../shared/village";

const port = process.env.SERVER_PORT ?? "2567";
const client = new ColyseusSDK<typeof server>(`ws://127.0.0.1:${port}`);
const name = `walker-${Date.now() % 100000}`;
const room = await client.joinOrCreate("game", { name, level: "village", mode: "playground" });
const input = room.input<MoveInput>({ mode: "reliable" });

const river = process.argv[2] === "river";
const route: [number, number][] = [];
const deck = village(1).bridges[0];
for (let z = -110; z < (river ? 4 : 94); z += 8) route.push([roadX(z), z]);
if (river) {
  // Over the bridge into the far farm's yard, then back across through the river.
  const middle = (z: number) => (channel(z).a + channel(z).b) / 2;
  route.push([roadX(4), 4], [deck.minX - 0.5, 4], [deck.maxX + 0.5, 4], [deck.maxX + 6, 9]);
  route.push([deck.maxX + 1, 20], [middle(20), 20.5], [roadX(22) + 6, 22], [roadX(26) + 6, 26]);
} else {
  // Up the track's middle every 8 m, then the ramp, the gate and the church door.
  route.push([0, 96], [0, 104], [0, 110], [-1, 113], [-1, 115.5]);
}

let target = 0;
let best = Number.POSITIVE_INFINITY;
let lastProgress = Date.now();
let lowest = Number.POSITIVE_INFINITY;
let worstGap = 0;
const started = Date.now();
await new Promise((resolve) => setTimeout(resolve, 500));

const done = (ok: boolean, why: string) => {
  clearInterval(stepper);
  console.log(
    `${ok ? "OK" : "FAIL"}: ${why} after ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
  console.log(
    `lowest ${lowest.toFixed(2)} m below the banks, worst gap to drawn ground ${worstGap.toFixed(3)} m`,
  );
  void room.leave().then(() => process.exit(ok ? 0 : 1));
};

let tick = 0;
const stepper = setInterval(() => {
  const me = room.state.players.get(room.sessionId);
  if (!me) return;
  const [tx, tz] = route[target];
  const dx = tx - me.x;
  const dz = tz - me.z;
  const distance = Math.hypot(dx, dz);
  // How far below the banks: in the river, the depth waded.
  lowest = Math.min(lowest, me.y - valleyFloor(me.z));
  // Off the bridge, the feet should be on the drawn ground.
  const onDeck =
    me.x > deck.minX && me.x < deck.maxX && me.z > deck.minZ - 0.3 && me.z < deck.maxZ + 0.3;
  if (me.vy === 0 && !onDeck)
    worstGap = Math.max(worstGap, Math.abs(villageGround(me.x, me.z) - me.y));
  if (me.y < valleyFloor(me.z) - 0.65)
    return done(false, `fell to ${me.y.toFixed(2)} at (${me.x.toFixed(1)}, ${me.z.toFixed(1)})`);
  if (distance < 1) {
    target++;
    best = Number.POSITIVE_INFINITY;
    if (target === route.length) {
      return river
        ? done(lowest < -0.5, `waded back across, ${(-lowest).toFixed(2)} m below the banks`)
        : done(me.y > 6.9, `reached the church door at y ${me.y.toFixed(2)}`);
    }
    return;
  }
  if (distance < best - 0.2) {
    best = distance;
    lastProgress = Date.now();
  } else if (Date.now() - lastProgress > 5000) {
    return done(
      false,
      `stuck at (${me.x.toFixed(1)}, ${me.y.toFixed(2)}, ${me.z.toFixed(1)}) heading for (${tx.toFixed(1)}, ${tz})`,
    );
  }
  input.data.moveX = Math.round((dx / distance) * MOVE_SCALE);
  input.data.moveZ = Math.round((dz / distance) * MOVE_SCALE);
  input.data.yaw = Math.round(Math.atan2(dx, dz) * 10000);
  input.send();
  if (tick++ % (TICK_RATE * 5) === 0)
    console.log(
      `(${me.x.toFixed(1)}, ${me.y.toFixed(2)}, ${me.z.toFixed(1)}) → waypoint ${target}/${route.length}`,
    );
}, 1000 / TICK_RATE);
