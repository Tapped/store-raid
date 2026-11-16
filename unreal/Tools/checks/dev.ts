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
  };
}
