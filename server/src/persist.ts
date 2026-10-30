import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * State that survives server restarts (the dev server restarts on every save).
 * One JSON file of key → value: `$GAME_DATA_DIR/store.json` if set, else `.data/store.json`
 * (gitignored).
 *
 *   const scores = load("scores", {} as Record<string, number>);   // once, e.g. in onCreate
 *   scores[name] = (scores[name] ?? 0) + 1;
 *   save("scores", scores);                                         // after every change
 *
 * Saves are written a moment later (and on shutdown), atomically. Store plain JSON data, keyed
 * by something stable such as the player's name — never a sessionId (new on every reconnect).
 * The code keeps changing, so `load` keeps only what still matches the default's shape.
 */
const DIR = process.env.GAME_DATA_DIR || join(import.meta.dirname, "../../.data");
const FILE = join(DIR, "store.json");
const WRITE_DELAY_MS = 2000;

const data: Record<string, unknown> = read();
let timer: NodeJS.Timeout | undefined;

/** The stored value for `key`, filled in from `fallback` (see `conform`); `fallback` if none. */
export function load<T>(key: string, fallback: T): T {
  if (!(key in data)) return fallback;
  return conform(data[key], fallback) as T;
}

/** Stores `value` under `key`; written to disk within a couple of seconds. */
export function save(key: string, value: unknown): void {
  data[key] = value;
  timer ??= setTimeout(flush, WRITE_DELAY_MS).unref();
}

/** Writes now (also runs on exit, which Colyseus reaches on SIGTERM after closing the rooms). */
export function flush(): void {
  clearTimeout(timer);
  timer = undefined;
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${FILE}.tmp`, JSON.stringify(data));
    renameSync(`${FILE}.tmp`, FILE);
  } catch (err) {
    console.error(`persist: could not write ${FILE}:`, err);
  }
}
process.on("exit", flush);

function read(): Record<string, unknown> {
  if (!existsSync(FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    if (isPlainObject(parsed)) return parsed;
    throw new Error("not a JSON object");
  } catch (err) {
    // Never crash the game over old data: keep the file for a human, start empty.
    const aside = `${FILE}.broken-${Date.now()}`;
    console.error(`persist: ${FILE} unreadable (${err}); moved to ${aside}`);
    renameSync(FILE, aside);
    return {};
  }
}

/**
 * `stored` where it fits the shape of `fallback`, else `fallback`: objects keep the fallback's
 * keys (each conformed) plus any extra stored keys; arrays and primitives must match in type.
 * An empty-object fallback (`{}` used as a map) takes the stored object as is.
 */
function conform(stored: unknown, fallback: unknown): unknown {
  if (isPlainObject(fallback)) {
    if (!isPlainObject(stored)) return fallback;
    const out: Record<string, unknown> = { ...stored };
    for (const [k, v] of Object.entries(fallback)) out[k] = k in stored ? conform(stored[k], v) : v;
    return out;
  }
  if (Array.isArray(fallback)) return Array.isArray(stored) ? stored : fallback;
  if (fallback === null || fallback === undefined) return stored;
  return typeof stored === typeof fallback ? stored : fallback;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
