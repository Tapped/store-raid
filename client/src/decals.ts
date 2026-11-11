import { Color3, DynamicTexture, Mesh, PBRMaterial, Texture, VertexData } from "@babylonjs/core";
import { footprint } from "../../shared/furnish";
import type { PropSpawn } from "../../shared/level";
import { PROPS, type PropName } from "../../shared/props";
import { CELL, OFFSET, parseTiles, SIDES, type Side, WALL } from "../../shared/tiles";
import type { World } from "./scene";
import { tunables } from "./tuning";

/**
 * Markings that make a warehouse read as used: yellow lines along the racking and bay numbers
 * stencilled in front of it, hatched keep-clear boxes at doorways, oil stains and tyre scuffs, drips
 * under the pipes, and posters, signs and notices on office, staff room and workshop walls.
 *
 * All of them are quads a hair off their surface, cut from one atlas drawn on a canvas at load, in
 * one mesh of one alpha-blended material, so the lot is one draw call; the interior light reaches
 * them as it does every PBR material. Where they go follows from the level alone, the same on every
 * screen: its rooms, props and the doorways in its grid.
 */

const LOOK = tunables(
  "Look/Decals",
  {
    opacity: { value: 0.8, min: 0, max: 1, hint: "How strongly the markings show" },
    roughness: { value: 0.75, min: 0, max: 1 },
  },
  (values) => {
    if (!material) return;
    material.alpha = values.opacity;
    material.roughness = values.roughness;
  },
);

let material: PBRMaterial | undefined;

/** The atlas: 2048 square, in cells of 256. */
const SIZE = 2048;
const U = 256;
/** Meters off a surface a marking floats. */
const LIFT = 0.006;

/** A region of the atlas, in pixels. */
interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
const cell = (col: number, row: number, cols = 1, rows = 1): Region => ({
  x: col * U,
  y: row * U,
  w: cols * U,
  h: rows * U,
});

const REGIONS = {
  lane: cell(0, 0),
  hatch: cell(1, 0, 2, 1),
  oil: [cell(3, 0), cell(4, 0), cell(5, 0)],
  drip: [cell(6, 0), cell(7, 0)],
  scuff: [cell(0, 1, 2, 1), cell(2, 1, 2, 1)],
  arrow: cell(4, 1),
  posters: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cell(i, 4, 1, 2)),
  signs: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cell(i, 6)),
  notices: [0, 1, 2, 3].map((i) => cell(i * 2, 7, 2, 1)),
};
/** Stencil characters, 128 pixels square, from row 2. */
const CHARS = "ABCDEFGH0123456789-";
const charRegion = (char: string): Region => {
  const i = Math.max(0, CHARS.indexOf(char));
  return { x: (i % 16) * 128, y: 2 * U + Math.floor(i / 16) * 128, w: 128, h: 128 };
};

/** A seeded random number source. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---- The atlas ----

const YELLOW = "#e8b417";
const STENCIL = "#e9e4d4";

/** Wears paint: eats into its alpha with blotchy noise, more at the edges of strokes. */
function wear(
  context: CanvasRenderingContext2D,
  region: Region,
  amount: number,
  next: () => number,
) {
  const image = context.getImageData(region.x, region.y, region.w, region.h);
  const { data, width, height } = image;
  // A few octaves of value noise on small grids.
  const octave = (n: number) => {
    const grid = Float32Array.from({ length: (n + 1) * (n + 1) }, () => next());
    return (x: number, y: number) => {
      const gx = (x / width) * n;
      const gy = (y / height) * n;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;
      const at = (i: number, j: number) => grid[Math.min(n, j) * (n + 1) + Math.min(n, i)];
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
      const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const big = octave(6);
  const mid = octave(17);
  const fine = octave(61);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4 + 3;
      if (data[i] === 0) continue;
      const n = big(x, y) * 0.5 + mid(x, y) * 0.3 + fine(x, y) * 0.2;
      const keep = Math.min(1, Math.max(0, (n - amount * 0.55) * 3.2));
      data[i] = Math.round(data[i] * keep * (0.75 + 0.25 * fine(y, x)));
    }
  }
  context.putImageData(image, region.x, region.y);
}

/** A soft dark blot of overlapping circles: oil, or water stains. */
function blot(
  context: CanvasRenderingContext2D,
  region: Region,
  next: () => number,
  colour: [number, number, number],
  strength: number,
  blobs: number,
) {
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  const r = Math.min(region.w, region.h) / 2;
  for (let i = 0; i < blobs; i++) {
    const a = next() * Math.PI * 2;
    const d = next() ** 1.5 * r * 0.55;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const size = r * (0.12 + next() * 0.35) * (1 - d / r);
    const g = context.createRadialGradient(x, y, 0, x, y, size);
    const [cr, cg, cb] = colour;
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${strength * (0.5 + next() * 0.5)})`);
    g.addColorStop(0.7, `rgba(${cr},${cg},${cb},${strength * 0.35})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    context.fillStyle = g;
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
  }
}

function text(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  weight = "bold",
  align: CanvasTextAlign = "center",
) {
  context.fillStyle = colour;
  context.font = `${weight} ${size}px "Arial Narrow", Arial, Helvetica, sans-serif`;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(value, x, y);
}

/** Paper: off-white, a little uneven, with a shadowed edge. */
function paper(context: CanvasRenderingContext2D, r: Region, inset: number, tone = "#ece6d6") {
  context.fillStyle = "rgba(0,0,0,0.35)";
  context.fillRect(r.x + inset + 3, r.y + inset + 4, r.w - 2 * inset, r.h - 2 * inset);
  context.fillStyle = tone;
  context.fillRect(r.x + inset, r.y + inset, r.w - 2 * inset, r.h - 2 * inset);
}

function circleSign(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  fill: string,
  ring: string | undefined,
) {
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  if (ring) {
    context.lineWidth = radius * 0.18;
    context.strokeStyle = ring;
    context.stroke();
  }
}

function triangleSign(context: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  context.beginPath();
  context.moveTo(cx, cy - size * 0.55);
  context.lineTo(cx + size * 0.6, cy + size * 0.45);
  context.lineTo(cx - size * 0.6, cy + size * 0.45);
  context.closePath();
  context.fillStyle = "#f2c200";
  context.fill();
  context.lineWidth = size * 0.07;
  context.strokeStyle = "#151515";
  context.lineJoin = "round";
  context.stroke();
}

/** Scribbled lines of writing, as on a notice. */
function scribble(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  lines: number,
  next: () => number,
  colour = "rgba(30,30,40,0.75)",
) {
  context.strokeStyle = colour;
  context.lineWidth = 2;
  for (let i = 0; i < lines; i++) {
    const length = w * (0.5 + next() * 0.5);
    context.beginPath();
    context.moveTo(x, y + i * 12);
    for (let t = 0; t < length; t += 6) {
      context.lineTo(x + t, y + i * 12 + (next() - 0.5) * 3);
    }
    context.stroke();
  }
}

function drawAtlas(context: CanvasRenderingContext2D) {
  const next = random(9173);
  context.clearRect(0, 0, SIZE, SIZE);

  // A lane line: a yellow stripe the whole cell, worn.
  const lane = REGIONS.lane;
  context.fillStyle = YELLOW;
  context.fillRect(lane.x + 2, lane.y + 2, lane.w - 4, lane.h - 4);
  wear(context, lane, 0.55, next);

  // Keep clear: a frame and diagonal stripes, worn.
  const hatch = REGIONS.hatch;
  context.save();
  context.beginPath();
  context.rect(hatch.x + 6, hatch.y + 6, hatch.w - 12, hatch.h - 12);
  context.clip();
  context.strokeStyle = YELLOW;
  context.lineWidth = 22;
  context.strokeRect(hatch.x + 16, hatch.y + 16, hatch.w - 32, hatch.h - 32);
  context.lineWidth = 20;
  for (let t = -hatch.h; t < hatch.w; t += 56) {
    context.beginPath();
    context.moveTo(hatch.x + t, hatch.y + hatch.h);
    context.lineTo(hatch.x + t + hatch.h, hatch.y);
    context.stroke();
  }
  context.restore();
  wear(context, hatch, 0.75, next);

  // Oil: dark and slightly brown; drips: grey water stains with rings.
  for (const region of REGIONS.oil) blot(context, region, next, [12, 9, 6], 0.75, 26);
  for (const region of REGIONS.drip) {
    blot(context, region, next, [20, 20, 18], 0.5, 9);
    context.strokeStyle = "rgba(25,22,18,0.35)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(region.x + region.w / 2, region.y + region.h / 2, region.w * 0.3, 0, Math.PI * 2);
    context.stroke();
  }

  // Tyre scuffs: a pair of soft dark arcs, rubbed in unevenly.
  for (const region of REGIONS.scuff) {
    const bend = (next() - 0.5) * 0.8;
    context.save();
    context.beginPath();
    context.rect(region.x, region.y, region.w, region.h);
    context.clip();
    context.filter = "blur(4px)";
    context.lineCap = "round";
    for (const offset of [-0.17, 0.17]) {
      for (let s = 0; s < 9; s++) {
        context.strokeStyle = `rgba(8,8,8,${0.08 + next() * 0.16})`;
        context.lineWidth = 14 + next() * 18;
        context.beginPath();
        const y0 = region.y + region.h * (0.5 + offset) + (next() - 0.5) * 8;
        const from = region.x + 16 + next() * 60;
        const to = region.x + region.w - 16 - next() * 60;
        context.moveTo(from, y0);
        context.quadraticCurveTo(
          region.x + region.w / 2,
          y0 + bend * region.h,
          to,
          y0 + (next() - 0.5) * 16,
        );
        context.stroke();
      }
    }
    context.restore();
    wear(context, region, 0.15, next);
  }

  // An arrow, as painted along a forklift route.
  const arrow = REGIONS.arrow;
  context.fillStyle = STENCIL;
  context.beginPath();
  const ax = arrow.x + arrow.w / 2;
  context.moveTo(ax, arrow.y + 20);
  context.lineTo(ax + 90, arrow.y + 120);
  context.lineTo(ax + 35, arrow.y + 120);
  context.lineTo(ax + 35, arrow.y + 236);
  context.lineTo(ax - 35, arrow.y + 236);
  context.lineTo(ax - 35, arrow.y + 120);
  context.lineTo(ax - 90, arrow.y + 120);
  context.closePath();
  context.fill();
  wear(context, arrow, 0.5, next);

  // Stencil characters for bay numbers.
  for (const char of CHARS) {
    const r = charRegion(char);
    text(context, char, r.x + r.w / 2, r.y + r.h / 2 + 4, 118, STENCIL, "900");
  }
  wear(context, { x: 0, y: 2 * U, w: SIZE, h: U }, 0.45, next);

  drawPosters(context, next);
}

function drawPosters(context: CanvasRenderingContext2D, next: () => number) {
  const [p0, p1, p2, p3, p4, p5, p6, p7] = REGIONS.posters;
  const cx = (r: Region) => r.x + r.w / 2;

  // Days without an accident.
  paper(context, p0, 8, "#f4f1e8");
  context.fillStyle = "#1d5f2e";
  context.fillRect(p0.x + 8, p0.y + 8, p0.w - 16, 90);
  text(context, "SAFETY", cx(p0), p0.y + 38, 40, "#fff");
  text(context, "FIRST", cx(p0), p0.y + 76, 34, "#fff");
  context.fillStyle = "#111";
  context.fillRect(p0.x + 40, p0.y + 140, p0.w - 80, 120);
  text(context, "214", cx(p0), p0.y + 202, 92, "#f3d23a", "900");
  text(context, "DAYS WITHOUT A", cx(p0), p0.y + 300, 22, "#222");
  text(context, "LOST-TIME INCIDENT", cx(p0), p0.y + 328, 22, "#222");
  text(context, "OSTKAI FREIGHT", cx(p0), p0.y + 470, 18, "#555");

  // Hi-vis must be worn.
  paper(context, p1, 8, "#f7f7f4");
  circleSign(context, cx(p1), p1.y + 150, 92, "#1a5aa8", undefined);
  context.fillStyle = "#fff";
  context.beginPath();
  context.moveTo(cx(p1) - 50, p1.y + 95);
  context.lineTo(cx(p1) + 50, p1.y + 95);
  context.lineTo(cx(p1) + 40, p1.y + 215);
  context.lineTo(cx(p1) - 40, p1.y + 215);
  context.closePath();
  context.fill();
  context.fillStyle = "#1a5aa8";
  context.fillRect(cx(p1) - 46, p1.y + 140, 92, 14);
  context.fillRect(cx(p1) - 44, p1.y + 175, 88, 14);
  context.fillStyle = "#1a5aa8";
  context.fillRect(p1.x + 8, p1.y + 290, p1.w - 16, 180);
  text(context, "HI-VIS", cx(p1), p1.y + 335, 46, "#fff", "900");
  text(context, "MUST BE WORN", cx(p1), p1.y + 390, 26, "#fff");
  text(context, "BEYOND THIS POINT", cx(p1), p1.y + 425, 22, "#fff");

  // No smoking.
  paper(context, p2, 8, "#fbfbf8");
  circleSign(context, cx(p2), p2.y + 170, 100, "#fbfbf8", "#c8161d");
  context.fillStyle = "#222";
  context.fillRect(cx(p2) - 70, p2.y + 160, 120, 22);
  context.fillStyle = "#d77a2c";
  context.fillRect(cx(p2) + 50, p2.y + 160, 18, 22);
  context.strokeStyle = "#c8161d";
  context.lineWidth = 18;
  context.beginPath();
  context.moveTo(cx(p2) - 70, p2.y + 100);
  context.lineTo(cx(p2) + 70, p2.y + 240);
  context.stroke();
  text(context, "NO SMOKING", cx(p2), p2.y + 340, 36, "#c8161d", "900");
  text(context, "ANYWHERE ON SITE", cx(p2), p2.y + 384, 20, "#333");

  // Forklifts operate here.
  paper(context, p3, 8, "#f6e9a8");
  triangleSign(context, cx(p3), p3.y + 160, 190);
  context.fillStyle = "#151515";
  context.fillRect(cx(p3) - 40, p3.y + 160, 60, 40);
  context.fillRect(cx(p3) + 20, p3.y + 120, 8, 80);
  context.fillRect(cx(p3) + 28, p3.y + 190, 30, 8);
  context.beginPath();
  context.arc(cx(p3) - 25, p3.y + 208, 12, 0, Math.PI * 2);
  context.arc(cx(p3) + 10, p3.y + 208, 12, 0, Math.PI * 2);
  context.fill();
  text(context, "CAUTION", cx(p3), p3.y + 320, 40, "#151515", "900");
  text(context, "FORKLIFT TRUCKS", cx(p3), p3.y + 368, 24, "#151515");
  text(context, "OPERATE IN THIS AREA", cx(p3), p3.y + 398, 20, "#151515");

  // A rota.
  paper(context, p4, 10);
  text(context, "NIGHT SHIFT ROTA", cx(p4), p4.y + 40, 24, "#222");
  text(context, "Ostkai Freight · Shed 4", cx(p4), p4.y + 68, 16, "#555", "normal");
  context.strokeStyle = "rgba(40,40,40,0.6)";
  context.lineWidth = 1.5;
  for (let row = 0; row < 14; row++) {
    const y = p4.y + 95 + row * 26;
    context.beginPath();
    context.moveTo(p4.x + 20, y);
    context.lineTo(p4.x + p4.w - 20, y);
    context.stroke();
    scribble(context, p4.x + 26, y + 13, 90, 1, next, "rgba(20,30,90,0.7)");
    if (next() < 0.6) scribble(context, p4.x + 140, y + 13, 70, 1, next, "rgba(20,30,90,0.7)");
  }

  // Lift with your legs.
  paper(context, p5, 8, "#eef3f6");
  context.fillStyle = "#1c6b8a";
  context.fillRect(p5.x + 8, p5.y + 8, p5.w - 16, 70);
  text(context, "LIFT SAFELY", cx(p5), p5.y + 44, 32, "#fff", "900");
  context.strokeStyle = "#1a1a1a";
  context.lineWidth = 12;
  context.lineCap = "round";
  context.beginPath();
  context.arc(cx(p5), p5.y + 130, 20, 0, Math.PI * 2);
  context.moveTo(cx(p5), p5.y + 150);
  context.lineTo(cx(p5) - 5, p5.y + 230);
  context.lineTo(cx(p5) + 35, p5.y + 270);
  context.lineTo(cx(p5) + 5, p5.y + 330);
  context.moveTo(cx(p5) - 5, p5.y + 230);
  context.lineTo(cx(p5) - 40, p5.y + 280);
  context.lineTo(cx(p5) - 30, p5.y + 330);
  context.moveTo(cx(p5), p5.y + 175);
  context.lineTo(cx(p5) + 40, p5.y + 240);
  context.stroke();
  context.fillStyle = "#a6763c";
  context.fillRect(cx(p5) + 30, p5.y + 225, 70, 55);
  text(context, "BEND YOUR KNEES", cx(p5), p5.y + 390, 22, "#1a1a1a");
  text(context, "KEEP THE LOAD CLOSE", cx(p5), p5.y + 420, 20, "#1a1a1a");

  // Fire assembly point.
  paper(context, p6, 8, "#0f8a43");
  context.fillStyle = "#fff";
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    context.beginPath();
    context.arc(cx(p6) + Math.cos(a) * 55, p6.y + 170 + Math.sin(a) * 55, 18, 0, Math.PI * 2);
    context.fill();
  }
  text(context, "FIRE", cx(p6), p6.y + 320, 46, "#fff", "900");
  text(context, "ASSEMBLY", cx(p6), p6.y + 370, 34, "#fff", "900");
  text(context, "POINT B", cx(p6), p6.y + 414, 28, "#fff");

  // A calendar.
  paper(context, p7, 8, "#f5f2ea");
  context.fillStyle = "#28465f";
  context.fillRect(p7.x + 8, p7.y + 8, p7.w - 16, 190);
  context.fillStyle = "#5f86a3";
  context.beginPath();
  context.moveTo(p7.x + 8, p7.y + 160);
  for (let x = 0; x <= p7.w - 16; x += 16) {
    context.lineTo(p7.x + 8 + x, p7.y + 150 + Math.sin(x * 0.05) * 10);
  }
  context.lineTo(p7.x + p7.w - 8, p7.y + 198);
  context.lineTo(p7.x + 8, p7.y + 198);
  context.fill();
  text(context, "HARBOUR LINES 2026", cx(p7), p7.y + 50, 20, "#fff");
  text(context, "NOVEMBER", cx(p7), p7.y + 225, 22, "#222");
  context.strokeStyle = "rgba(40,40,40,0.5)";
  context.lineWidth = 1;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 7; col++) {
      const x = p7.x + 22 + col * 30;
      const y = p7.y + 250 + row * 42;
      context.strokeRect(x, y, 28, 40);
      if (next() < 0.25) scribble(context, x + 3, y + 20, 20, 1, next, "rgba(170,20,20,0.7)");
    }
  }

  // Small square signs.
  const [s0, s1, s2, s3, s4, s5, s6, s7] = REGIONS.signs;
  const square = (r: Region, bg: string) => {
    context.fillStyle = "rgba(0,0,0,0.35)";
    context.fillRect(r.x + 14, r.y + 16, r.w - 24, r.h - 24);
    context.fillStyle = bg;
    context.fillRect(r.x + 10, r.y + 10, r.w - 20, r.h - 20);
  };
  square(s0, "#f2c200");
  triangleSign(context, cx(s0), s0.y + 105, 130);
  text(context, "!", cx(s0), s0.y + 118, 80, "#151515", "900");
  text(context, "DANGER", cx(s0), s0.y + 210, 30, "#151515", "900");
  square(s1, "#1a5aa8");
  circleSign(context, cx(s1), s1.y + 105, 70, "#fff", undefined);
  text(context, "EAR", cx(s1), s1.y + 95, 30, "#1a5aa8", "900");
  text(context, "DEFENDERS", cx(s1), s1.y + 210, 24, "#fff");
  square(s2, "#c8161d");
  text(context, "FIRE", cx(s2), s2.y + 90, 44, "#fff", "900");
  text(context, "DOOR", cx(s2), s2.y + 140, 44, "#fff", "900");
  text(context, "KEEP SHUT", cx(s2), s2.y + 200, 26, "#fff");
  square(s3, "#0f8a43");
  text(context, "FIRST", cx(s3), s3.y + 70, 36, "#fff", "900");
  text(context, "AID", cx(s3), s3.y + 115, 36, "#fff", "900");
  context.fillStyle = "#fff";
  context.fillRect(cx(s3) - 14, s3.y + 145, 28, 76);
  context.fillRect(cx(s3) - 38, s3.y + 169, 76, 28);
  square(s4, "#f4f1e8");
  text(context, "STAFF", cx(s4), s4.y + 90, 40, "#222", "900");
  text(context, "ONLY", cx(s4), s4.y + 140, 40, "#222", "900");
  context.fillStyle = "#c8161d";
  context.fillRect(s4.x + 10, s4.y + 190, s4.w - 20, 36);
  square(s5, "#f2c200");
  context.fillStyle = "#151515";
  for (let i = -4; i < 6; i++) {
    context.save();
    context.beginPath();
    context.rect(s5.x + 10, s5.y + 10, s5.w - 20, 40);
    context.clip();
    context.fillRect(s5.x + 10 + i * 40, s5.y + 10, 20, 40);
    context.restore();
  }
  text(context, "MIND", cx(s5), s5.y + 120, 44, "#151515", "900");
  text(context, "THE STEP", cx(s5), s5.y + 175, 36, "#151515", "900");
  square(s6, "#e8e8e8");
  text(context, "BAY", cx(s6), s6.y + 70, 34, "#333", "900");
  text(context, "7", cx(s6), s6.y + 160, 120, "#c8161d", "900");
  square(s7, "#1d1d1d");
  text(context, "HIGH", cx(s7), s7.y + 80, 40, "#f2c200", "900");
  text(context, "VOLTAGE", cx(s7), s7.y + 130, 34, "#f2c200", "900");
  context.fillStyle = "#f2c200";
  context.beginPath();
  context.moveTo(cx(s7) + 10, s7.y + 160);
  context.lineTo(cx(s7) - 20, s7.y + 200);
  context.lineTo(cx(s7), s7.y + 200);
  context.lineTo(cx(s7) - 12, s7.y + 235);
  context.lineTo(cx(s7) + 24, s7.y + 190);
  context.lineTo(cx(s7) + 4, s7.y + 190);
  context.closePath();
  context.fill();

  // Notices: sheets pinned up together.
  for (const r of REGIONS.notices) {
    const sheets = 2 + Math.floor(next() * 3);
    for (let i = 0; i < sheets; i++) {
      const w = 110 + next() * 60;
      const h = 150 + next() * 60;
      const x = r.x + 20 + next() * (r.w - w - 40);
      const y = r.y + 15 + next() * (r.h - h - 30);
      context.save();
      context.translate(x + w / 2, y + h / 2);
      context.rotate((next() - 0.5) * 0.12);
      const tone = ["#efe9da", "#f2efa4", "#dfe9f0", "#f4dcdc"][Math.floor(next() * 4)];
      context.fillStyle = "rgba(0,0,0,0.3)";
      context.fillRect(-w / 2 + 3, -h / 2 + 4, w, h);
      context.fillStyle = tone;
      context.fillRect(-w / 2, -h / 2, w, h);
      text(
        context,
        ["NOTICE", "MEMO", "REMINDER", "LOST"][Math.floor(next() * 4)],
        0,
        -h / 2 + 22,
        18,
        "#222",
      );
      scribble(context, -w / 2 + 12, -h / 2 + 46, w - 24, Math.floor((h - 60) / 12), next);
      context.fillStyle = ["#c8161d", "#1a5aa8", "#e0b000"][Math.floor(next() * 3)];
      context.beginPath();
      context.arc(0, -h / 2 + 6, 5, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }
}

// ---- Placing them ----

/** The quads, built up as they're placed. */
class Quads {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  /**
   * A quad at a centre, `right` and `up` its half extents as vectors, facing `normal`, showing an
   * atlas region (top of the region at `up`).
   */
  add(
    centre: [number, number, number],
    right: [number, number, number],
    up: [number, number, number],
    normal: [number, number, number],
    region: Region,
  ) {
    const base = this.positions.length / 3;
    const [cx, cy, cz] = centre;
    const corners: [number, number, number][] = [
      [-1, 1, 0],
      [1, 1, 0],
      [1, -1, 0],
      [-1, -1, 0],
    ];
    // A texel in from the region's edges, so neighbours don't bleed in.
    const u0 = (region.x + 1) / SIZE;
    const u1 = (region.x + region.w - 1) / SIZE;
    const v0 = (region.y + 1) / SIZE;
    const v1 = (region.y + region.h - 1) / SIZE;
    for (const [sx, sy] of corners) {
      this.positions.push(
        cx + right[0] * sx + up[0] * sy,
        cy + right[1] * sx + up[1] * sy,
        cz + right[2] * sx + up[2] * sy,
      );
      this.normals.push(...normal);
      this.uvs.push(sx < 0 ? u0 : u1, sy > 0 ? v0 : v1);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A quad flat on the floor, `along` the way its top points (x, z), so wide and long. */
  floor(
    x: number,
    y: number,
    z: number,
    along: [number, number],
    width: number,
    length: number,
    region: Region,
  ) {
    const [ux, uz] = along;
    // Right of the way it points, seen from above.
    const rx = uz;
    const rz = -ux;
    this.add(
      [x, y + LIFT, z],
      [(rx * width) / 2, 0, (rz * width) / 2],
      [(ux * length) / 2, 0, (uz * length) / 2],
      [0, 1, 0],
      region,
    );
  }

  /** A quad on a wall whose face looks along `out` (x, z), its middle at a height. */
  wall(
    x: number,
    y: number,
    z: number,
    out: [number, number],
    width: number,
    height: number,
    region: Region,
  ) {
    const [nx, nz] = out;
    // Right, for someone facing the wall.
    const rx = -nz;
    const rz = nx;
    this.add(
      [x + nx * LIFT, y, z + nz * LIFT],
      [(rx * width) / 2, 0, (rz * width) / 2],
      [0, height / 2, 0],
      [nx, 0, nz],
      region,
    );
  }
}

const FLOOR_PAINT = new Set(["hall", "stock", "cage", "workshop", "entrance", "corridor", "plant"]);

/** Paints a tiled level's markings, if it has rooms; returns the mesh, or undefined. */
export function addDecals(world: World): Mesh | undefined {
  const { scene, level } = world;
  const grid = level.grid;
  if (!grid || level.rooms.length === 0) return undefined;
  const parsed = parseTiles(grid);
  const quads = new Quads();
  const next = random(hashString(level.name));
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];

  const cellAt = (x: number, z: number) => ({
    col: Math.floor((x - grid.x) / CELL),
    row: Math.floor((z - grid.z) / CELL),
  });
  /** The room whose floor a point is on, on a storey, or undefined over a hole, stairs or a wall. */
  const roomAt = (storey: number, x: number, z: number) => {
    const { col, row } = cellAt(x, z);
    const tile = parsed.tile(storey, col, row);
    if (tile?.kind !== "floor" && tile?.kind !== "tv") return undefined;
    return level.rooms.find(
      (room) => room.storey === storey && room.cells.some((c) => c.col === col && c.row === row),
    );
  };
  /** Solid floor props and what blocks, by storey, to keep stains out from under them. */
  const blockers = level.boxes.filter((b) => b.kind === "furniture" || b.kind === "shelf");
  const free = (y: number, x: number, z: number, margin: number) =>
    !blockers.some(
      (b) =>
        b.y <= y + 0.1 &&
        b.y + b.height > y + 0.1 &&
        x > b.minX - margin &&
        x < b.maxX + margin &&
        z > b.minZ - margin &&
        z < b.maxZ + margin,
    );
  const storeyOf = (spawn: PropSpawn) => level.rooms[spawn.room]?.storey;

  // Racking: a lane line along the front of each bay, and its bay number before it.
  const racks = level.props.filter((p) => p.model.startsWith("pallet-rack"));
  const lines = new Map<string, PropSpawn[]>();
  for (const rack of racks) {
    const fx = Math.round(Math.sin(rack.turn));
    const fz = Math.round(Math.cos(rack.turn));
    const across = fx !== 0 ? rack.x : rack.z;
    const key = `${rack.room}:${fx},${fz}:${across.toFixed(1)}`;
    const line = lines.get(key) ?? [];
    line.push(rack);
    lines.set(key, line);
  }
  const letters = new Map<number, number>();
  for (const line of lines.values()) {
    const first = line[0];
    const room = level.rooms[first.room];
    if (!room) continue;
    const letter = letters.get(room.id) ?? 0;
    letters.set(room.id, letter + 1);
    const fx = Math.round(Math.sin(first.turn));
    const fz = Math.round(Math.cos(first.turn));
    const [width, , depth] = PROPS[first.model as PropName].size;
    line.sort((a, b) => (fx !== 0 ? a.z - b.z : a.x - b.x));
    for (const [n, rack] of line.entries()) {
      const out = depth / 2 + 0.22;
      const x = rack.x + fx * out;
      const z = rack.z + fz * out;
      if (!roomAt(room.storey, x, z)) continue;
      // Three lengths of line across the bay's front.
      const along: [number, number] = [fz, -fx];
      for (const k of [-1, 0, 1]) {
        const at = (k * width) / 3;
        quads.floor(
          x + along[0] * at,
          room.y,
          z + along[1] * at,
          along,
          0.1,
          width / 3 + 0.01,
          REGIONS.lane,
        );
      }
      // The bay number, read from the aisle: its top towards the rack.
      const label = `${CHARS[letter % 8]}${String(n + 1).padStart(2, "0")}`;
      const lx = rack.x + fx * (out + 0.45);
      const lz = rack.z + fz * (out + 0.45);
      if (!roomAt(room.storey, lx, lz)) continue;
      const size = 0.32;
      for (const [i, char] of [...label].entries()) {
        const shift = (i - (label.length - 1) / 2) * size * 0.78;
        // Right, for someone in the aisle facing the rack.
        quads.floor(
          lx - fz * shift,
          room.y,
          lz + fx * shift,
          [-fx, -fz],
          size,
          size,
          charRegion(char),
        );
      }
    }
  }

  // Keep-clear boxes either side of doorways, in rooms with painted floors.
  const hatched: [number, number, number][] = [];
  for (const room of level.rooms) {
    if (!FLOOR_PAINT.has(room.kind)) continue;
    for (const { col, row } of room.cells) {
      const tile = parsed.tile(room.storey, col, row);
      if (tile?.kind !== "floor") continue;
      for (const side of SIDES) {
        const edge = parsed.edge(room.storey, col, row, side);
        // Doorways only: arches are wide ways through, not doors to keep clear.
        if (edge !== "door") continue;
        const [dx, dz] = OFFSET[side];
        const middleX = grid.x + (col + 0.5) * CELL;
        const middleZ = grid.z + (row + 0.5) * CELL;
        const wide = 1.8;
        const deep = 1.1;
        const inset = CELL / 2 - WALL / 2 - deep / 2 - 0.08;
        const x = middleX + dx * inset;
        const z = middleZ + dz * inset;
        if (!free(room.y, x, z, 0)) continue;
        // Nor where one is already, at a corner with doors on two sides.
        if (hatched.some(([hx, hz, hy]) => hy === room.y && Math.hypot(hx - x, hz - z) < 1.6))
          continue;
        hatched.push([x, z, room.y]);
        // Its long side along the wall: its top away from the doorway.
        quads.floor(x, room.y, z, [-dx, -dz], wide, deep, REGIONS.hatch);
      }
    }
  }

  // Oil by the trucks, and scattered about where they work; tyre scuffs in the halls.
  const trucks = level.props.filter((p) => /forklift|pallet-truck|hand-truck/.test(p.model));
  const stain = (storey: number, x: number, z: number, size: number) => {
    const room = roomAt(storey, x, z);
    if (!room || !FLOOR_PAINT.has(room.kind) || !free(room.y, x, z, 0.1)) return false;
    const a = next() * Math.PI * 2;
    quads.floor(x, room.y, z, [Math.sin(a), Math.cos(a)], size, size, pick(REGIONS.oil));
    return true;
  };
  for (const truck of trucks) {
    const storey = storeyOf(truck);
    if (storey === undefined) continue;
    const count = truck.model === "forklift" ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const a = next() * Math.PI * 2;
      const d = 0.6 + next() * 1.6;
      stain(storey, truck.x + Math.cos(a) * d, truck.z + Math.sin(a) * d, 0.5 + next() * 0.9);
    }
  }
  for (const room of level.rooms) {
    if (!["hall", "entrance", "workshop", "stock", "plant"].includes(room.kind)) continue;
    const { bounds } = room;
    const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
    const spot = () => [
      bounds.minX + 0.5 + next() * (bounds.maxX - bounds.minX - 1),
      bounds.minZ + 0.5 + next() * (bounds.maxZ - bounds.minZ - 1),
    ];
    for (let i = 0; i < area / 45; i++) {
      const [x, z] = spot();
      stain(room.storey, x, z, 0.4 + next() * 1.1);
    }
    if (room.kind !== "hall" && room.kind !== "entrance") continue;
    const alongX = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ;
    for (let i = 0; i < area / 50; i++) {
      const [x, z] = spot();
      if (roomAt(room.storey, x, z) !== room || !free(room.y, x, z, 0.4)) continue;
      const a = (alongX ? Math.PI / 2 : 0) + (next() - 0.5) * 0.6 + (next() < 0.5 ? Math.PI : 0);
      quads.floor(
        x,
        room.y,
        z,
        [Math.sin(a), Math.cos(a)],
        0.9,
        2.4 + next() * 1.6,
        pick(REGIONS.scuff),
      );
    }
    // An arrow or two down the middle of the way through.
    for (let i = 0; i < area / 160; i++) {
      const [x, z] = spot();
      if (roomAt(room.storey, x, z) !== room || !free(room.y, x, z, 0.8)) continue;
      const a = (alongX ? Math.PI / 2 : 0) + (next() < 0.5 ? Math.PI : 0);
      quads.floor(x, room.y, z, [Math.sin(a), Math.cos(a)], 0.7, 0.9, REGIONS.arrow);
    }
  }

  // Drips under the pipes.
  for (const pipe of level.props.filter((p) => p.model === "pipe-run")) {
    const storey = storeyOf(pipe);
    if (storey === undefined) continue;
    const ax = Math.cos(pipe.turn);
    const az = -Math.sin(pipe.turn);
    for (let i = 0; i < 2; i++) {
      if (next() < 0.35) continue;
      const t = (next() - 0.5) * 3.4;
      const x = pipe.x + ax * t;
      const z = pipe.z + az * t;
      const room = roomAt(storey, x, z);
      if (!room || !free(room.y, x, z, 0)) continue;
      quads.floor(
        x,
        room.y,
        z,
        [ax, az],
        0.5 + next() * 0.4,
        0.5 + next() * 0.4,
        pick(REGIONS.drip),
      );
    }
  }

  // Posters, signs and notices on the walls.
  const wallProps = level.props.filter((p) => PROPS[p.model as PropName]?.mount === "wall");
  const tall = level.props.filter((p) => {
    const kind = PROPS[p.model as PropName];
    return kind?.mount === "floor" && kind.size[1] > 1.0;
  });
  const hangOn = (
    room: (typeof level.rooms)[number],
    count: number,
    choose: () => { region: Region; w: number; h: number },
  ) => {
    const walls: { col: number; row: number; side: Side }[] = [];
    for (const { col, row } of room.cells) {
      if (parsed.tile(room.storey, col, row)?.kind !== "floor") continue;
      for (const side of SIDES) {
        if (parsed.edge(room.storey, col, row, side) === "wall") walls.push({ col, row, side });
      }
    }
    for (
      let placed = 0, tries = 0;
      placed < count && tries < count * 12 && walls.length > 0;
      tries++
    ) {
      const { col, row, side } = pick(walls);
      const { region, w, h } = choose();
      const [dx, dz] = OFFSET[side];
      const along = (next() - 0.5) * (CELL - w - 0.6);
      const face = CELL / 2 - WALL / 2;
      const middleX = grid.x + (col + 0.5) * CELL;
      const middleZ = grid.z + (row + 0.5) * CELL;
      const x = middleX + dx * face + (dz !== 0 ? along : 0);
      const z = middleZ + dz * face + (dx !== 0 ? along : 0);
      const y = room.y + 1.45 + (next() - 0.5) * 0.2;
      // Not over anything on the wall, nor behind anything tall in front of it.
      const clash = wallProps.some(
        (p) =>
          Math.hypot(p.x - x, p.z - z) < w / 2 + 0.5 &&
          Math.abs(p.y - y) < 1.2 &&
          storeyOf(p) === room.storey,
      );
      const hidden = tall.some((p) => {
        if (storeyOf(p) !== room.storey) return false;
        const box = footprint(p.model as PropName, p.x, p.z, p.turn);
        const fx = x - dx * 0.3;
        const fz = z - dz * 0.3;
        return (
          fx > box.minX - w / 2 &&
          fx < box.maxX + w / 2 &&
          fz > box.minZ - 0.3 &&
          fz < box.maxZ + 0.3
        );
      });
      if (clash || hidden) continue;
      wallProps.push({ model: "poster", x, y, z, turn: 0, room: room.id } as PropSpawn);
      quads.wall(x, y, z, [-dx, -dz], w, h, region);
      placed++;
    }
  };
  const poster = () => ({ region: pick(REGIONS.posters), w: 0.42, h: 0.84 });
  const sign = () => ({ region: pick(REGIONS.signs), w: 0.3, h: 0.3 });
  const notice = () => ({ region: pick(REGIONS.notices), w: 0.9, h: 0.45 });
  for (const room of level.rooms) {
    const cells = room.cells.length;
    switch (room.kind) {
      case "office":
        hangOn(room, 1 + Math.round(cells / 4), () =>
          next() < 0.5 ? poster() : next() < 0.5 ? notice() : sign(),
        );
        break;
      case "staff":
        hangOn(room, 2 + Math.round(cells / 5), () => (next() < 0.55 ? notice() : poster()));
        break;
      case "workshop":
      case "plant":
        hangOn(room, 1 + Math.round(cells / 5), () => (next() < 0.6 ? sign() : poster()));
        break;
      case "hall":
      case "stock":
      case "entrance":
        hangOn(room, Math.max(1, Math.round(cells / 25)), () => (next() < 0.5 ? sign() : poster()));
        break;
    }
  }

  if (quads.indices.length === 0) return undefined;
  const atlas = new DynamicTexture(
    "decal-atlas",
    { width: SIZE, height: SIZE },
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  drawAtlas(atlas.getContext() as unknown as CanvasRenderingContext2D);
  atlas.update(false, false, true);
  atlas.hasAlpha = true;
  atlas.anisotropicFilteringLevel = 8;
  atlas.wrapU = Texture.CLAMP_ADDRESSMODE;
  atlas.wrapV = Texture.CLAMP_ADDRESSMODE;

  material = new PBRMaterial("decals", scene);
  material.albedoTexture = atlas;
  material.albedoColor = Color3.White();
  material.useAlphaFromAlbedoTexture = true;
  material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  material.alpha = LOOK.opacity;
  material.metallic = 0;
  material.roughness = LOOK.roughness;
  material.backFaceCulling = false;
  material.zOffset = -2;
  material.disableDepthWrite = true;

  const mesh = new Mesh("decals", scene);
  const data = new VertexData();
  data.positions = quads.positions;
  data.normals = quads.normals;
  data.uvs = quads.uvs;
  data.indices =
    quads.positions.length / 3 > 65535 ? Uint32Array.from(quads.indices) : quads.indices;
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

/** For the console: the atlas, to look at. */
export function decalAtlasUrl(mesh: Mesh): string | undefined {
  const texture = (mesh.material as PBRMaterial | null)?.albedoTexture as
    | DynamicTexture
    | undefined;
  return (texture?.getContext().canvas as HTMLCanvasElement | undefined)?.toDataURL?.();
}
