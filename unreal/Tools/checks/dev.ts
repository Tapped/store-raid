/**
 * Talking to a running process's dev server from a check: console commands, and where its player
 * is. The dev ports are ue.ts's: the server 8700, clients 8711 on, the window 8721, bots 8731 on.
 */

export function devPortOf(who: string): number {
  if (who === "window") return 8721;
  const match = /^(server|client|bot)(\d*)$/.exec(who);
  if (!match) throw new Error(`who is server, client, client2…, bot, bot2…, window: not ${who}`);
  const index = match[2] ? Number(match[2]) - 1 : 0;
  return match[1] === "server" ? 8700 : match[1] === "client" ? 8711 + index : 8731 + index;
}

/** Runs a console command in a process and returns what it printed and logged. */
export async function exec(who: string, command: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${devPortOf(who)}/exec`, {
    method: "POST",
    body: command,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${who}: "${command}" was not handled`);
  return text;
}

/** What sr.where says of a process's own player: feet in game meters (x east, y up, z north). */
export interface Where {
  x: number;
  y: number;
  z: number;
  speed: number;
  stamina: number;
  winded: boolean;
  running: boolean;
  climbing: boolean;
  falling: boolean;
  goal: boolean;
  /** The kind of item in each hand, or "-". */
  left: string;
  right: string;
  /** Who they are this round, whether they're ready, and the truck's seat they sit on (-1 standing). */
  role: string;
  ready: boolean;
  seat: number;
  /** Where they look, in degrees: 0 north, 90 east. */
  yaw: number;
  /** False while they have no character: out of the building, watching. */
  inside: boolean;
}

export async function where(who: string): Promise<Where> {
  const text = await exec(who, "sr.where");
  const line = text.split("\n").find((l) => l.includes("StoreRaid where:"));
  if (!line) throw new Error(`${who} has no player yet: ${text.trim()}`);
  const words = line
    .slice(line.indexOf("StoreRaid where:") + 16)
    .trim()
    .split(/\s+/);
  const values: Record<string, string> = {};
  for (let i = 0; i + 1 < words.length; i += 2) values[words[i]] = words[i + 1];
  const flag = (key: string) => values[key] === "true";
  if (words[0] === "none") {
    const role = words[words.indexOf("role") + 1];
    const none = { x: NaN, y: NaN, z: NaN, speed: 0, stamina: 0, yaw: 0 };
    return {
      ...none,
      winded: false,
      running: false,
      climbing: false,
      falling: false,
      goal: false,
      left: "-",
      right: "-",
      role,
      ready: false,
      seat: -1,
      inside: false,
    };
  }
  return {
    x: Number(values.x),
    y: Number(values.y),
    z: Number(values.z),
    speed: Number(values.speed),
    stamina: Number(values.stamina),
    winded: flag("winded"),
    running: flag("running"),
    climbing: flag("climbing"),
    falling: flag("falling"),
    goal: flag("goal"),
    left: values.left,
    right: values.right,
    role: values.role,
    ready: flag("ready"),
    seat: Number(values.seat),
    yaw: Number(values.yaw),
    inside: true,
  };
}

/** How bright the room's lamps are, 0 to 1, as a process knows it. */
export async function light(who: string): Promise<number> {
  const text = await exec(who, "sr.room");
  const match = /StoreRaid room: light ([\d.]+)/.exec(text);
  if (!match) throw new Error(`${who} has no room yet: ${text.trim()}`);
  return Number(match[1]);
}

/** What sr.items says of every item: its kind, where it is, who holds it and whether it's on. */
export interface ItemState {
  name: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  held: string[];
  on: boolean;
}

export async function items(who: string): Promise<ItemState[]> {
  const text = await exec(who, "sr.items");
  return text
    .split("\n")
    .filter((line) => line.includes("StoreRaid item:"))
    .map((line) => {
      const [name, ...words] = line
        .slice(line.indexOf("StoreRaid item:") + 15)
        .trim()
        .split(/\s+/);
      const values: Record<string, string> = {};
      for (let i = 0; i + 1 < words.length; i += 2) values[words[i]] = words[i + 1];
      return {
        name,
        kind: values.kind,
        x: Number(values.x),
        y: Number(values.y),
        z: Number(values.z),
        held: values.held === "-" ? [] : values.held.split(","),
        on: values.on === "true",
      };
    });
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What sr.room says: the lamps, what the room is for, a game's round, the loot and the hatch. */
export interface Room {
  light: number;
  mode: string;
  phase: string;
  time: number;
  loot: number;
  quota: number;
  cleared: boolean;
  hatch: number;
}

export async function room(who: string): Promise<Room> {
  const text = await exec(who, "sr.room");
  const line = text.split("\n").find((l) => l.includes("StoreRaid room:"));
  if (!line) throw new Error(`${who} has no room yet: ${text.trim()}`);
  const words = line
    .slice(line.indexOf("StoreRaid room:") + 15)
    .trim()
    .split(/\s+/);
  const values: Record<string, string> = {};
  for (let i = 0; i + 1 < words.length; i += 2) values[words[i]] = words[i + 1];
  return {
    light: Number(values.light),
    mode: values.mode,
    phase: values.phase,
    time: Number(values.time),
    loot: Number(values.loot),
    quota: Number(values.quota),
    cleared: values.cleared === "true",
    hatch: Number(values.hatch),
  };
}

/** What a process's overlay says, a line each, and its results while they show. */
export async function overlay(
  who: string,
): Promise<{ lines: string[]; results: string[]; watching?: string }> {
  const text = (await exec(who, "sr.overlay")).split("\n");
  const after = (marker: string) =>
    text
      .filter((l) => l.includes(marker))
      .map((l) => l.slice(l.indexOf(marker) + marker.length).trim());
  return {
    lines: after("StoreRaid overlay:"),
    results: after("StoreRaid results:"),
    watching: after("StoreRaid watching:")[0],
  };
}

/**
 * Walks a player to a point, by sr.goal, for up to `seconds`: true if they got within 0.45 m of it.
 * One that's stopped short (by a wall, a shut hatch) gives up once it hasn't moved for a second.
 */
export async function walk(who: string, [x, z]: [number, number], seconds = 20): Promise<boolean> {
  await exec(who, `sr.goal ${x} ${z}`);
  let last = await where(who);
  let still = 0;
  for (let t = 0; t < seconds * 10; t++) {
    await wait(100);
    const p = await where(who);
    if (!p.goal) break;
    still = Math.hypot(p.x - last.x, p.z - last.z) < 0.01 ? still + 1 : 0;
    last = p;
    if (still >= 10) break;
  }
  await exec(who, "sr.goal");
  await wait(300);
  const p = await where(who);
  const short = Math.hypot(x - p.x, z - p.z);
  if (short > 0.45) {
    console.log(
      `  ${who} stopped ${short.toFixed(2)} m short, at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`,
    );
  }
  return short <= 0.45;
}

/**
 * A point of the playground's truck, in its own space (x across, z towards the cab, y up from the
 * ground), in the level: it's parked at TRUCK with its cab east (Playground::TruckPlace).
 */
export function truckPoint(x: number, z: number, y = 0): [number, number, number] {
  return [TRUCK.x + z, y, TRUCK.z - x];
}

/** Where the playground's truck stands, its cab east: Playground::TruckPlace. */
export const TRUCK = { x: 10.5, z: -10.6 };

/** Whether a point is in the playground's truck's cargo space: x -3.07..3.03 and z ±1.19 of its own. */
export function inTruck(p: { x: number; z: number }): boolean {
  const [x, z] = [p.x - TRUCK.x, p.z - TRUCK.z];
  return x > -3.07 && x < 3.03 && Math.abs(z) < 1.19;
}
