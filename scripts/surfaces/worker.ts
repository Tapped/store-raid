import { workerData } from "node:worker_threads";
import type { Texel } from "./recipe";
import { RECIPES } from "./recipes";

/** Bakes rows `start` to `end` of one surface into the shared buffer, 8 floats a texel. */
const { name, size, start, end, buffer } = workerData as {
  name: keyof typeof RECIPES;
  size: number;
  start: number;
  end: number;
  buffer: SharedArrayBuffer;
};

const recipe = RECIPES[name];
recipe.setup?.();
const out = new Float32Array(buffer);
const o: Texel = { r: 0, g: 0, b: 0, a: 0, h: 0, ao: 1, rough: 0.5, metal: 0 };
for (let row = start; row < end; row++) {
  // Row 0 is the top of the image, which the engine shows at v = 1.
  const v = 1 - (row + 0.5) / size;
  for (let x = 0; x < size; x++) {
    o.r = o.g = o.b = 0;
    o.a = 0;
    o.h = 0;
    o.ao = 1;
    o.rough = 0.5;
    o.metal = 0;
    recipe.sample((x + 0.5) / size, v, o);
    const i = (row * size + x) * 8;
    out[i] = o.r;
    out[i + 1] = o.g;
    out[i + 2] = o.b;
    out[i + 3] = o.a;
    out[i + 4] = o.h;
    out[i + 5] = o.ao;
    out[i + 6] = o.rough;
    out[i + 7] = o.metal;
  }
}
