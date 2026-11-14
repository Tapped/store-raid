/**
 * Checks the harbour level without a server: the warehouse where it stands, its loading door open,
 * against the rules in shared/levelCheck.ts, and that a mover gets from where players start in the truck, down its
 * ramp, across the lot and in through the loading door, and back up into the truck.
 *
 *   pnpm exec tsx scripts/harbourCheck.ts [seed…]     (default: the harbour's own seed)
 */
import { MOVE_SCALE, TICK_RATE } from "../shared/constants";
import { HARBOUR_SITE } from "../shared/harbourSite";
import { generatedLevel, HARBOUR_SEED, harbourLevel } from "../shared/level";
import { checkLevel } from "../shared/levelCheck";
import { MECHANICS } from "../shared/mechanics";
import { inside } from "../shared/modes";
import { type MoverState, stepMover } from "../shared/movement";

const seeds = process.argv.slice(2).map(Number);
let failed = false;

for (const seed of seeds.length > 0 ? seeds : [HARBOUR_SEED]) {
  const level = harbourLevel(seed);
  // The rules are the building's own, from where players start inside it: without the truck and
  // the harbour round it, which they know nothing of.
  const problems = checkLevel(generatedLevel(seed, { ...HARBOUR_SITE, gate: true }));
  const truck = level.truck;
  if (!truck) throw new Error("The harbour has no truck");

  // Walk: out of the truck to the door, a few meters in, and back.
  const start = truck.spawn(0);
  const state: MoverState = { ...start, vx: 0, vy: 0, vz: 0, stamina: 1, winded: false };
  const walk = (x: number, z: number): boolean => {
    for (let tick = 0; tick < TICK_RATE * 20; tick++) {
      const [dx, dz] = [x - state.x, z - state.z];
      const far = Math.hypot(dx, dz);
      if (far < 0.4) return true;
      const input = { moveX: (dx / far) * MOVE_SCALE, moveZ: (dz / far) * MOVE_SCALE };
      stepMover(state, input, 1 / TICK_RATE, level, MECHANICS);
    }
    return false;
  };
  const door = { x: level.entrance.x, z: level.entrance.z };
  const route: [string, number, number][] = [
    ["the foot of the ramp", truck.rampFoot.x, truck.rampFoot.z + 1],
    ["the loading door", door.x, door.z],
    ["the loading bay", door.x, door.z + 3],
    ["the loading door again", door.x, door.z - 1],
    ["the foot of the ramp again", truck.rampFoot.x, truck.rampFoot.z + 0.5],
    ["the truck", start.x, start.z],
  ];
  for (const [name, x, z] of route) {
    if (walk(x, z)) continue;
    problems.push(
      `can't walk to ${name}: stuck at ${state.x.toFixed(1)}, ${state.y.toFixed(2)}, ${state.z.toFixed(1)}`,
    );
    break;
  }
  if (!inside(truck.dock, state.x, state.z) || Math.abs(state.y - start.y) > 0.05) {
    problems.push(`the walk doesn't end in the truck but at y ${state.y.toFixed(2)}`);
  }

  console.log(
    `${level.name} (seed ${seed}): ${level.items.length} items, ${level.props.length} props, ` +
      `${problems.length === 0 ? "ok" : `${problems.length} problems`}`,
  );
  for (const problem of problems) console.log(`  ${problem}`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
