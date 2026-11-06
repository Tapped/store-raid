import { ColyseusSDK } from "@colyseus/sdk";
import type server from "../../server/src/app";
import type { Mode } from "../../shared/modes";

/**
 * The game server sits under `${BASE}ws` on the page's own origin; the Vite proxy forwards it.
 */
function createClient() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return new ColyseusSDK<typeof server>(
    `${scheme}://${location.host}${import.meta.env.BASE_URL}ws`,
  );
}

/** Whether the game server answers. */
export async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}ws/__healthcheck`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Resolves once the server is back (it restarts on every save in dev). */
export async function waitForServer(intervalMs = 1000): Promise<void> {
  while (!(await serverUp())) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

const client = createClient();
let joins: Promise<unknown> = Promise.resolve();

/**
 * Join the shared room for this level and mode. One at a time: players pressing join in the same
 * instant must not each create a room of their own.
 */
export function joinGame(name: string, level: string, mode: Mode) {
  const join = joins.then(() => client.joinOrCreate("game", { name, level, mode }));
  joins = join.catch(() => {});
  return join;
}
export type GameConnection = Awaited<ReturnType<typeof joinGame>>;
