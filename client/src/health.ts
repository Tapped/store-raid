import { MAX_HEALTH } from "../../shared/ticks";
import { tunables } from "./tuning";

/**
 * Our health on screen, as a DOM overlay: a bar in the corner once any is gone, the edges of the
 * screen going red as it runs out, pulsing while a tick is on us, and what to do about that.
 */

const HURT = tunables("Feel/Hurt", {
  edge: { value: 0.55, min: 0, max: 1, hint: "How red the screen's edges are with no health left" },
  latched: { value: 0.45, min: 0, max: 1, hint: "How red they are with a tick on, at least" },
  pulse: { value: 0.25, min: 0, max: 1, hint: "How much that throbs" },
});

interface Overlay {
  edges: HTMLDivElement;
  bar: HTMLDivElement;
  fill: HTMLDivElement;
  prompt: HTMLDivElement;
}

let overlay: Overlay | undefined;
let clock = 0;

function create(): Overlay {
  const make = (css: string) => {
    const div = document.createElement("div");
    div.style.cssText = `position:fixed;pointer-events:none;${css}`;
    document.body.appendChild(div);
    return div;
  };
  const edges = make(
    "inset:0;opacity:0;background:radial-gradient(ellipse at center,rgba(90,0,0,0) 35%,rgba(110,0,0,0.9) 100%)",
  );
  const bar = make(
    "left:24px;bottom:56px;width:180px;height:8px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.25);border-radius:2px",
  );
  const fill = document.createElement("div");
  fill.style.cssText = "height:100%;background:#b3261e;border-radius:1px";
  bar.appendChild(fill);
  const prompt = make(
    "left:50%;top:62%;transform:translateX(-50%);padding:6px 12px;font:600 16px system-ui,sans-serif;color:#fff;background:rgba(60,0,0,0.6);border-radius:4px;text-shadow:0 1px 2px #000",
  );
  return { edges, bar, fill, prompt };
}

/**
 * Once a frame. `health` is undefined when we aren't in the building; `handFree` is whether we
 * could pull a tick off right now.
 */
export function showHealth(
  health: number | undefined,
  latched: boolean,
  handFree: boolean,
  dt: number,
) {
  overlay ??= create();
  const { edges, bar, fill, prompt } = overlay;
  clock += dt;
  if (health === undefined) {
    edges.style.opacity = "0";
    bar.style.display = "none";
    prompt.style.display = "none";
    return;
  }
  const gone = 1 - Math.max(0, Math.min(1, health / MAX_HEALTH));
  let red = gone * gone * HURT.edge;
  if (latched) red = Math.max(red, HURT.latched) + HURT.pulse * (0.5 + 0.5 * Math.sin(clock * 9));
  edges.style.opacity = String(Math.min(1, red));
  bar.style.display = gone > 0 || latched ? "" : "none";
  fill.style.width = `${(1 - gone) * 100}%`;
  prompt.style.display = latched ? "" : "none";
  const text = handFree
    ? "A tick is on you · pull it off: E · RB"
    : "A tick is on you · free a hand: Q · LB, then pull it off: E · RB";
  if (latched && prompt.textContent !== text) prompt.textContent = text;
}
