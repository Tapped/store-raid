import { clamp, fbm, fbm01, hash, mix, smoothstep, value, wrap } from "../noise";
import type { Recipe } from "../recipe";
import { blend, type Colour, hex } from "../recipe";
import { concrete, cover, DIRT, SALT } from "./common";

/**
 * Painted blockwork, a storey to the repeat: 16 courses of 187.5 mm and 8 blocks of 375 mm, in
 * running bond, 10 mm tooled joints. The paint (the tint) follows the block's open texture; knocks
 * chip it back to grey block, worst along arrises and low down where forklifts and pallets go.
 */
const TILE = 3000; // mm
const COURSES = 16;
const BLOCKS = 8;
const JOINT = 5; // half a joint, mm
const BLOCK = hex(0x8e8c86);
const MORTAR = hex(0x7d7b75);

export const concreteBlock: Recipe = {
  cavity: { radius: 5, strength: 0.25 },
  sample(u, v, o) {
    const course = Math.floor(v * COURSES);
    const shift = wrap(course, 2) * 0.5;
    const along = u * BLOCKS + shift;
    const block = Math.floor(along);
    const bx = (along - block) * (TILE / BLOCKS); // mm across the block
    const by = (v * COURSES - course) * (TILE / COURSES); // mm up it
    const toJoint = Math.min(bx, TILE / BLOCKS - bx, by, TILE / COURSES - by);
    const id = hash(wrap(block, BLOCKS), course, 800);

    // The block's open face under the paint: pores and grit, each block a little different.
    concrete(o, u, v, TILE / 1000, 801, BLOCK);
    const pores = value(u, v, 1200, 1200, 802);
    o.h += (pores - 0.5) * 0.25 + (id - 0.5) * 0.6;
    const joint = 1 - smoothstep(JOINT - 1, JOINT + 0.5, toJoint);
    // Tooled joint: a shallow concave groove; a rounded arris on each block.
    const tooled = Math.max(0, 1 - toJoint / JOINT);
    o.h -= joint * (1.5 + tooled * 1.0);
    o.h -= (1 - smoothstep(JOINT, JOINT + 4, toJoint)) * 1.0;
    const substrate: Colour = blend([o.r, o.g, o.b], MORTAR, joint);

    // Paint over all of it: the tint, pooled a touch darker in the joints.
    o.a = (0.93 + pores * 0.07) * (1 - joint * 0.05) * (1 - (id - 0.5) * 0.04);
    o.r = o.g = o.b = 0;
    o.rough = 0.7 + pores * 0.1;

    // Chips back to block: along arrises, mostly low.
    const height = (v * TILE) / 1;
    const low = 1 - smoothstep(300, 1500, height);
    const edge = 1 - smoothstep(JOINT, JOINT + 25, toJoint);
    const knock = fbm01(u, v, 90, 90, 4, 803) + fbm(u, v, 300, 300, 2, 804) * 0.1;
    const threshold = 0.8 - edge * 0.12 - low * 0.06;
    const chip = smoothstep(threshold, threshold + 0.02, knock) * Math.max(edge, low * 0.35);
    if (chip > 0) {
      cover(o, substrate, chip);
      o.h -= chip * 0.3;
      o.rough = mix(o.rough, 0.9, chip);
    }
    // A forklift scrape band at fork height, and grime and salt at the foot.
    const scrape =
      (1 - smoothstep(0, 60, Math.abs(height - 350 - fbm(u, v, 4, 1, 3, 805) * 120))) *
      smoothstep(0.5, 0.8, fbm01(u, v, 12, 2, 4, 806));
    cover(o, blend(DIRT, substrate, 0.5), scrape * 0.6);
    const foot = 1 - smoothstep(0, 450 + fbm(u, v, 10, 2, 4, 807) * 150, height);
    cover(o, DIRT, foot * 0.45);
    cover(o, SALT, foot * smoothstep(0.6, 0.85, fbm01(u, v, 40, 20, 4, 808)) * 0.3);
    // Dirt streaked down from the joints' ledges.
    const streak = smoothstep(0.62, 0.85, fbm01(u, v, 40, 1, 4, 809)) * 0.25;
    cover(o, DIRT, clamp(streak * 0.7 + joint * 0.04));
  },
};
