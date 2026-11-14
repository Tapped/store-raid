import type { ItemKind } from "../../shared/constants";
import { inside, itemValue, type Phase, type Role } from "../../shared/modes";
import type { GameConnection } from "./net";

type State = GameConnection["state"];

const STYLE = `
#results {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, rgb(0 0 0 / 0.35), rgb(0 0 0 / 0.75));
  color: #e9e6df; font-family: system-ui, sans-serif; pointer-events: none;
  animation: results-in 0.5s ease-out;
}
@keyframes results-in { from { opacity: 0; } to { opacity: 1; } }
#results .sheet {
  width: min(440px, 86vw); padding: 26px 30px 22px; border-radius: 4px;
  background: rgb(14 16 20 / 0.92); border-top: 3px solid var(--mark);
  box-shadow: 0 18px 60px rgb(0 0 0 / 0.6);
}
#results.cleared { --mark: #d9a441; }
#results.failed { --mark: #b5483c; }
#results h1 {
  margin: 0; font-size: 34px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--mark);
}
#results .sum { margin: 6px 0 14px; font-size: 15px; color: #b9b5ab; }
#results .sum b { color: #e9e6df; font-variant-numeric: tabular-nums; }
#results .bar { position: relative; height: 8px; background: #2a2d33; border-radius: 2px; }
#results .bar i { display: block; height: 100%; background: var(--mark); border-radius: 2px; }
#results .bar u {
  position: absolute; top: -4px; bottom: -4px; width: 2px; background: #e9e6df;
}
#results .scale {
  display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: #85827a;
  letter-spacing: 0.06em; text-transform: uppercase;
}
#results h2 {
  margin: 20px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.12em;
  text-transform: uppercase; color: #85827a;
}
#results ul { margin: 0; padding: 0; list-style: none; font-size: 14px; }
#results li {
  display: flex; justify-content: space-between; gap: 16px; padding: 3px 0;
  border-bottom: 1px solid rgb(255 255 255 / 0.06); font-variant-numeric: tabular-nums;
}
#results li span:last-child { color: #b9b5ab; }
#results li.out span:first-child { color: #85827a; text-decoration: line-through; }
#results li.out span:last-child { color: #b5483c; }
#results .none { font-size: 14px; color: #85827a; }
#results .next { margin-top: 18px; font-size: 13px; color: #85827a; text-align: right; }
`;

const money = (value: number) => `$${Math.round(value)}`;

/** What became of each of the crew. */
const FATE: Record<Role, string> = {
  playing: "Made it",
  dead: "Dead",
  lost: "Left behind",
  waiting: "Sat it out",
};

const NAMES: Partial<Record<ItemKind, [string, string]>> = {
  tv: ["TV", "TVs"],
};

function named(kind: ItemKind, count: number): string {
  const [one, many] = NAMES[kind] ?? [kind[0].toUpperCase() + kind.slice(1), ""];
  const name = count === 1 ? one : many || `${one}${one.endsWith("x") ? "es" : "s"}`;
  return count === 1 ? name : `${count} ${name}`;
}

let panel: HTMLDivElement | undefined;
let shown = "";

/**
 * The results of a round, over the picture while a game's `results` phase lasts: whether the quota
 * was met, what the truck (the level's `dock`) holds, and what became of the crew. Call it every
 * frame with the room's state, or nothing when there is no room.
 */
export function showResults(state: State | undefined, dock: Parameters<typeof inside>[0]): void {
  if (state?.mode !== "game" || (state.phase as Phase) !== "results") {
    panel?.remove();
    panel = undefined;
    shown = "";
    return;
  }
  // The loot in the truck, by kind, dearest first: as the server counts it, whatever is in there,
  // even still in someone's hands.
  const haul = new Map<ItemKind, number>();
  for (const item of state.items.values()) {
    const kind = item.kind as ItemKind;
    if (itemValue(kind) > 0 && inside(dock, item.x, item.z)) {
      haul.set(kind, (haul.get(kind) ?? 0) + 1);
    }
  }
  const loot = [...haul].sort(
    ([a, n], [b, m]) => itemValue(b) * m - itemValue(a) * n || a.localeCompare(b),
  );
  const crew = [...state.players.values()].map((p) => ({ name: p.name, role: p.role as Role }));
  const seconds = Math.ceil(state.timeLeft);
  const key = JSON.stringify([state.cleared, state.loot, state.quota, loot, crew, seconds]);
  if (key === shown) return;
  shown = key;

  if (!panel) {
    if (!document.getElementById("results-style")) {
      const style = document.createElement("style");
      style.id = "results-style";
      style.textContent = STYLE;
      document.head.append(style);
    }
    panel = document.createElement("div");
    panel.id = "results";
    document.body.append(panel);
  }
  panel.className = state.cleared ? "cleared" : "failed";
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
    className = "",
  ): HTMLElementTagNameMap[K] => {
    const made = document.createElement(tag);
    made.textContent = text;
    if (className) made.className = className;
    return made;
  };
  const row = (left: string, right: string, className = "") => {
    const li = element("li", "", className);
    li.append(element("span", left), element("span", right));
    return li;
  };

  const sheet = element("div", "", "sheet");
  sheet.append(element("h1", state.cleared ? "Cleared" : "Failed"));
  const sum = element("p", "", "sum");
  const short = state.quota - state.loot;
  sum.append(
    "The truck left with ",
    element("b", money(state.loot)),
    state.cleared ? `, ${money(-short)} over the quota.` : `, ${money(short)} short of the quota.`,
  );
  sheet.append(sum);

  // The loot against the quota: the bar runs to whichever is greater.
  const full = Math.max(state.quota, state.loot, 1);
  const bar = element("div", "", "bar");
  const fill = element("i");
  fill.style.width = `${(state.loot / full) * 100}%`;
  const mark = element("u");
  mark.style.left = `calc(${(state.quota / full) * 100}% - 1px)`;
  bar.append(fill, mark);
  const scale = element("div", "", "scale");
  scale.append(element("span", "Loot"), element("span", `Quota ${money(state.quota)}`));
  sheet.append(bar, scale);

  sheet.append(element("h2", "In the truck"));
  if (loot.length === 0) sheet.append(element("p", "Nothing.", "none"));
  else {
    const list = element("ul");
    for (const [kind, count] of loot) {
      list.append(row(named(kind, count), money(itemValue(kind) * count)));
    }
    sheet.append(list);
  }

  sheet.append(element("h2", "The crew"));
  const list = element("ul");
  for (const { name, role } of crew) {
    list.append(row(name, FATE[role], role === "dead" || role === "lost" ? "out" : ""));
  }
  sheet.append(list);
  sheet.append(element("p", `Next round in ${seconds}`, "next"));
  panel.replaceChildren(sheet);
}
