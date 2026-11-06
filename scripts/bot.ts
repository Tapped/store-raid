/**
 * Headless bot player, for testing server logic and multiplayer without a browser.
 *
 *   pnpm exec tsx scripts/bot.ts [name] [seconds]     (defaults: bot, 10)
 *
 * Joins your game server (SERVER_PORT, else 2567) in the playground (LEVEL=store for the store),
 * walks in a square and prints every player's position once a second. Run several at once for
 * several players. JUMP=1 holds jump the whole time, so it hops as it goes.
 */
import { ColyseusSDK } from "@colyseus/sdk";
import type server from "../server/src/app";
import type { MoveInput } from "../server/src/rooms/schema";
import { MOVE_SCALE, TICK_RATE } from "../shared/constants";

const name = process.argv[2] ?? "bot";
const seconds = Number(process.argv[3] ?? 10);
const port = process.env.SERVER_PORT ?? "2567";

const client = new ColyseusSDK<typeof server>(`ws://127.0.0.1:${port}`);
const room = await client.joinOrCreate("game", { name, level: process.env.LEVEL ?? "playground" });
const input = room.input<MoveInput>({ mode: "reliable" });
room.onLeave((code) => console.log(`left (code ${code})`));
console.log(`${name} joined as ${room.sessionId} on port ${port}`);

// One input per server tick, like the browser client: 1 s each of +z, +x, -z, -x.
const square: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
let tick = 0;
const stepper = setInterval(() => {
  const [moveX, moveZ] = square[Math.floor(tick++ / TICK_RATE) % square.length];
  input.data.moveX = moveX * MOVE_SCALE;
  input.data.moveZ = moveZ * MOVE_SCALE;
  input.data.jump = process.env.JUMP === "1";
  input.send();
}, 1000 / TICK_RATE);

const printer = setInterval(() => {
  const players = [...room.state.players.entries()].map(
    ([id, p]) =>
      `${p.name}${id === room.sessionId ? "*" : ""}(${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)})`,
  );
  console.log(players.join("  "));
}, 1000);

setTimeout(async () => {
  clearInterval(stepper);
  clearInterval(printer);
  await room.leave();
  process.exit(0);
}, seconds * 1000);
