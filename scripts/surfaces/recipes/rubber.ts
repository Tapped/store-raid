import { fbm, fbm01, mix, scratches, smoothstep, value } from "../noise";
import type { Recipe } from "../recipe";
import { hex } from "../recipe";
import { cover, DIRT, setColour } from "./common";

/** Black rubber: moulded stipple, dust settled in it, polished where it's walked or driven on. */
const RUBBER = hex(0x1c1c1c);
const DUST = hex(0x6c6862);

export const rubber: Recipe = {
  cavity: { radius: 2, strength: 0.8 },
  sample(u, v, o) {
    const stipple = value(u, v, 500, 500, 1201);
    const broad = fbm(u, v, 4, 4, 4, 1202);
    setColour(o, RUBBER, 0.9 + stipple * 0.15 + broad * 0.08);
    o.h = stipple * 0.12 + broad * 0.2;
    o.rough = 0.75 + stipple * 0.1;
    // Polished wear: smooth, slightly darker and glossier.
    const worn = smoothstep(0.45, 0.75, fbm01(u, v, 3, 3, 5, 1203));
    o.h *= 1 - worn * 0.7;
    o.rough = mix(o.rough, 0.45, worn);
    // Dust settled in the stipple where it isn't worn.
    const dust = (1 - stipple) * (1 - worn) * smoothstep(0.4, 0.8, fbm01(u, v, 20, 20, 4, 1204));
    cover(o, DUST, dust * 0.25);
    o.rough = mix(o.rough, 0.95, dust);
    cover(o, DIRT, smoothstep(0.5, 0.85, fbm01(u, v, 10, 10, 4, 1205)) * 0.2);
    // Cuts and scuffs, grey.
    const s = scratches(u, v, 5, 1, 1206, 0.06, 0.001, 0, Math.PI);
    cover(o, DUST, s * 0.4);
    o.h -= s * 0.2;
  },
};
