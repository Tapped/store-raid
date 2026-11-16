/**
 * Checks a game's round in the playground with two players, as GameRoom.ts ran it: the lobby seats
 * everyone in the truck, where they stand up and sit down again; all ready starts the raid, which
 * stands them up and puts the hatch down; loot carried into the truck counts; everyone in the truck
 * wanting to go ends the raid, and the results show the haul and the crew; then the next lobby puts it
 * all back. In a second raid the bot falls into the pit and watches the client, and dawn ends it; in a
 * third it's outside the truck at dawn and left behind.
 * The overlay says each of these. Exits non-zero if any of that doesn't happen.
 *
 * Needs a server, a client and a bot running (`pnpm run ue dev 1 1`):
 * `pnpm run ue check round [bot] [client]`. It makes the room a game and the playground again at the end.
 */
import { exec, inTruck, items, overlay, room, truckPoint, wait, walk, where } from "./dev";

const bot = process.argv[2] ?? "bot";
const client = process.argv[3] ?? "client";
const xz = (p: [number, number, number]): [number, number] => [p[0], p[2]];
const behind = xz(truckPoint(0, -6.4));
const inside = xz(truckPoint(0, -1.5));

let problems = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems++;
}

async function until(done: () => Promise<boolean>, seconds: number): Promise<boolean> {
  for (let t = 0; t < seconds * 10; t++) {
    if (await done()) return true;
    await wait(100);
  }
  return done();
}

const phase = async () => (await room("server")).phase;
const lines = async (who: string) => (await overlay(who)).lines.join(" | ");

// The lobby: everyone seated in the truck.
for (const who of [bot, client]) await exec(who, "sr.goal");
await exec("server", "sr.mode game");
await wait(1500);
{
  const [b, c] = [await where(bot), await where(client)];
  check(
    b.seat >= 0 && c.seat >= 0 && b.seat !== c.seat,
    `both sit in the truck (seats ${b.seat}, ${c.seat})`,
  );
  check(inTruck(b) && inTruck(c), "in its cargo space");
  const r = await room("server");
  check(
    r.phase === "lobby" && r.quota === 420 && r.light === 0.35,
    `a game's lobby, quota $420, lights dimmed (${r.phase}, ${r.quota}, ${r.light})`,
  );
  const said = await lines(client);
  check(
    said === "In the truck · quota $420 · 0 of 2 ready | R / X when you're ready",
    `the overlay says so (${said})`,
  );
}

// Standing up and sitting down again, across the truck.
{
  const was = (await where(bot)).seat;
  await exec(bot, "sr.stand");
  await wait(500);
  check((await where(bot)).seat === -1, "sr.stand gets the bot up");
  await exec(bot, "sr.grab");
  await wait(800);
  const now = await where(bot);
  check(
    now.seat >= 0 && now.seat !== was,
    `grab facing a free seat sits down on it (${was} to ${now.seat})`,
  );
}

// Ready: the raid starts.
await exec(bot, "sr.ready");
await wait(500);
check((await lines(client)).includes("1 of 2 ready"), `one ready (${await lines(client)})`);
await exec(client, "sr.ready");
await wait(500);
check(
  (await lines(client)).startsWith("The raid starts in"),
  `the countdown (${await lines(client)})`,
);
check(await until(async () => (await phase()) === "raid", 5), "everyone ready starts the raid");
await wait(500);
{
  const [b, c] = [await where(bot), await where(client)];
  check(b.seat === -1 && c.seat === -1, "and stands everyone up");
  check(
    /^Dawn in (10:00|9:5\d) · Loot \$0 of \$420/.test(await lines(client)),
    `the overlay counts down to dawn (${await lines(client)})`,
  );
}
check(await until(async () => (await room("server")).hatch === 1, 4), "the hatch comes down");

// Loot: a phone from the west wall into the truck.
check(await walk(bot, behind), "the bot walks down the ramp");
await walk(bot, [-10, -10]);
check(await walk(bot, [-12.9, -8.8]), "and over to the phones");
await exec(bot, "sr.face 270");
await wait(500);
await exec(bot, "sr.grab");
await wait(500);
check((await where(bot)).right === "phone", "it takes one");
await walk(bot, [-10, -10]);
await walk(bot, behind);
check(await walk(bot, inside), "and carries it up into the truck");
await exec(bot, "sr.drop");
await wait(1000);
{
  const r = await room("server");
  check(r.loot === 40, `the phone in the truck is $40 of loot (${r.loot})`);
  check(
    (await lines(client)).includes("Loot $40 of $420"),
    `the overlay says so (${await lines(client)})`,
  );
}

// Leaving: everyone in the truck wants to go.
await exec(bot, "sr.ready");
await wait(500);
check(
  (await lines(bot)).includes("Leaving · 1 of 2 want to go"),
  `the bot wants to leave (${await lines(bot)})`,
);
await exec(client, "sr.ready");
check(
  await until(async () => (await phase()) === "results", 3),
  "everyone wanting to go ends the raid",
);
{
  const r = await room("server");
  check(!r.cleared && r.loot === 40, `short of the quota, it failed (${r.loot} of ${r.quota})`);
  // The client hears of the results a moment after the server.
  await until(async () => (await overlay(client)).results.length > 0, 2);
  const shown = (await overlay(client)).results;
  check(shown[0] === "FAILED", `the results say so (${shown.join(" | ")})`);
  check(
    shown.includes("Phone: $40") &&
      shown.includes("bot: Made it") &&
      shown.includes("client: Made it"),
    "with the haul and the crew",
  );
}

// The next lobby puts it all back.
check(
  await until(async () => (await phase()) === "lobby", 12),
  "the results give way to the next lobby",
);
await wait(1000);
{
  const [b, c] = [await where(bot), await where(client)];
  const r = await room("server");
  check(b.seat >= 0 && c.seat >= 0 && r.hatch === 0, "seated again, shut in");
  const phones = (await items("server")).filter((i) => i.kind === "phone");
  check(
    r.loot === 0 && phones.every((p) => p.x < -13),
    `every item back where it started (loot ${r.loot})`,
  );
}

// A second raid: the bot falls into the pit and watches the client; dawn ends it.
await exec(bot, "sr.ready");
await exec(client, "sr.ready");
check(await until(async () => (await phase()) === "raid", 6), "a second raid starts");
await until(async () => (await room("server")).hatch === 1, 4);
await walk(bot, behind);
await walk(bot, [3, -8.6]);
await walk(bot, [10, -8.6]);
await walk(bot, [10, -4.5]);
await walk(bot, [10, 2]);
await exec(bot, "sr.goal 14 2");
check(
  await until(async () => (await where(bot)).role === "dead", 6),
  "falling into the pit in a raid is death",
);
await wait(500);
{
  const b = await where(bot);
  const o = await overlay(bot);
  check(!b.inside, "the dead have no character");
  check(o.watching === "client", `and watch the client (${o.watching})`);
  check(
    o.lines.at(-1) === "You died · watching client · E / Q: next / previous",
    `the overlay says so (${o.lines.at(-1)})`,
  );
  check((await lines(client)).startsWith("Dawn in"), "the client plays on");
}
await exec("server", "sr.clock 1");
check(await until(async () => (await phase()) === "results", 3), "dawn ends the raid");
{
  const shown = (await overlay(client)).results;
  check(
    shown.includes("bot: Dead") && shown.includes("client: Made it"),
    `the crew's fates (${shown.join(" | ")})`,
  );
}
check(await until(async () => (await phase()) === "lobby", 12), "and the next lobby");
await wait(1000);
check((await where(bot)).inside && (await where(bot)).role === "playing", "brings the bot back in");

// A third: the bot is outside the truck at dawn, and is left behind.
await exec(bot, "sr.ready");
await exec(client, "sr.ready");
check(await until(async () => (await phase()) === "raid", 6), "a third raid starts");
await until(async () => (await room("server")).hatch === 1, 4);
await walk(bot, behind);
await exec("server", "sr.clock 1");
check(
  await until(async () => (await where(bot)).role === "lost", 3),
  "outside the truck at dawn, the bot is left behind",
);
await until(async () => (await overlay(client)).results.length > 0, 2);
{
  const shown = (await overlay(client)).results;
  check(
    shown.includes("bot: Left behind") && shown.includes("client: Made it"),
    `the results say so (${shown.join(" | ")})`,
  );
}

await exec("server", "sr.mode playground");
if (problems) {
  console.error(`${problems} problems`);
  process.exit(1);
}
console.log("The round works");
