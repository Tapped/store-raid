import { inside, type Phase, type Role } from "../../shared/modes";
import type { GameConnection } from "./net";

type State = GameConnection["state"];
type Player = State["players"] extends Map<string, infer P> ? P : never;

const money = (value: number) => `$${Math.round(value)}`;

/** Seconds as m:ss. */
function clock(seconds: number): string {
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** What happened to us, while we watch. */
const OUT: Record<Exclude<Role, "playing">, string> = {
  dead: "You died",
  lost: "Left behind at dawn",
  waiting: "Waiting for the next round",
};

/**
 * The lines of the round overlay at the top of the screen, for a game: where the round is, the loot
 * against the quota, and what we can do about it. Nothing in the playground, which has no rounds.
 */
export function roundLines(
  state: State,
  self: Player,
  dock: Parameters<typeof inside>[0],
  watched: Player | undefined,
): string[] {
  if (state.mode !== "game") return [];
  const phase = state.phase as Phase;
  const crew = [...state.players.values()].filter((p) => p.role === "playing");
  const loot = `Loot ${money(state.loot)} of ${money(state.quota)}`;
  const lines: string[] = [];

  if (phase === "lobby") {
    const ready = crew.filter((p) => p.ready).length;
    lines.push(
      state.timeLeft > 0
        ? `The raid starts in ${Math.ceil(state.timeLeft)}`
        : `In the truck · quota ${money(state.quota)} · ${ready} of ${crew.length} ready`,
    );
    if (self.role === "playing") {
      lines.push(self.ready ? "Ready · R / X to wait" : "R / X when you're ready");
    }
  } else if (phase === "raid") {
    lines.push(`Dawn in ${clock(state.timeLeft)} · ${loot}`);
    if (self.role === "playing" && inside(dock, self.x, self.z)) {
      const leaving = crew.filter((p) => p.ready).length;
      lines.push(
        self.ready
          ? `Leaving · ${leaving} of ${crew.length} want to go · R / X to stay`
          : "In the truck · R / X to leave",
      );
    }
  } else {
    lines.push(state.cleared ? `Cleared! ${loot}` : `Failed · ${loot}`);
    const lost = [...state.players.values()].filter((p) => p.role === "lost").length;
    const dead = [...state.players.values()].filter((p) => p.role === "dead").length;
    const losses = [dead && `${dead} dead`, lost && `${lost} left behind`].filter(Boolean);
    if (losses.length) lines.push(losses.join(" · "));
    lines.push(`Next round in ${Math.ceil(state.timeLeft)}`);
  }

  if (self.role !== "playing") {
    const out = OUT[self.role as Exclude<Role, "playing">];
    lines.push(watched ? `${out} · watching ${watched.name} · E / Q: next / previous` : `${out}`);
  }
  return lines;
}
