// Painted blockwork, a storey to the repeat: 16 courses of 187.5 mm and 8 blocks of 375 mm, in
// running bond, 10 mm tooled joints. The paint (the tint) follows the block's open texture; knocks
// chip it back to grey block, worst along arrises and low down where forklifts and pallets go.

const CAVITY = vec2f(5.0, 0.25);
const TILE = 3000.0; // mm
const COURSES = 16.0;
const BLOCKS = 8.0;
const JOINT = 5.0; // half a joint, mm
const BLOCK = hex(0x8e8c86);
const MORTAR = hex(0x7d7b75);

fn sample(u: f32, v: f32, o: ptr<function, Texel>) {
  let course = floor(v * COURSES);
  let shift = f32(wrap(i32(course), 2)) * 0.5;
  let along = u * BLOCKS + shift;
  let block = floor(along);
  let bx = (along - block) * (TILE / BLOCKS); // mm across the block
  let by = (v * COURSES - course) * (TILE / COURSES); // mm up it
  let toJoint = min(min(bx, TILE / BLOCKS - bx), min(by, TILE / COURSES - by));
  let id = hash(wrap(i32(block), i32(BLOCKS)), i32(course), 800);

  // The block's open face under the paint: pores and grit, each block a little different.
  concrete(o, u, v, TILE / 1000.0, 801, BLOCK);
  let pores = value(u, v, 1200.0, 1200.0, 802);
  o.h += (pores - 0.5) * 0.25 + (id - 0.5) * 0.6;
  let joint = 1.0 - smoothstep(JOINT - 1.0, JOINT + 0.5, toJoint);
  // Tooled joint: a shallow concave groove; a rounded arris on each block.
  let tooled = max(0.0, 1.0 - toJoint / JOINT);
  o.h -= joint * (1.5 + tooled * 1.0);
  o.h -= (1.0 - smoothstep(JOINT, JOINT + 4.0, toJoint)) * 1.0;
  let substrate = blend(o.col, MORTAR, joint);

  // Paint over all of it: the tint, pooled a touch darker in the joints.
  o.a = (0.93 + pores * 0.07) * (1.0 - joint * 0.05) * (1.0 - (id - 0.5) * 0.04);
  o.col = vec3f(0.0);
  o.rough = 0.7 + pores * 0.1;

  // Chips back to block: along arrises, mostly low.
  let height = v * TILE;
  let low = 1.0 - smoothstep(300.0, 1500.0, height);
  let edge = 1.0 - smoothstep(JOINT, JOINT + 25.0, toJoint);
  let knock = fbm01(u, v, 90.0, 90.0, 4, 803) + fbm(u, v, 300.0, 300.0, 2, 804) * 0.1;
  let threshold = 0.8 - edge * 0.12 - low * 0.06;
  let chip = smoothstep(threshold, threshold + 0.02, knock) * max(edge, low * 0.35);
  if (chip > 0.0) {
    cover(o, substrate, chip);
    o.h -= chip * 0.3;
    o.rough = mix(o.rough, 0.9, chip);
  }
  // A forklift scrape band at fork height, and grime and salt at the foot.
  let scrape = (1.0 - smoothstep(0.0, 60.0, abs(height - 350.0 - fbm(u, v, 4.0, 1.0, 3, 805) * 120.0))) *
    smoothstep(0.5, 0.8, fbm01(u, v, 12.0, 2.0, 4, 806));
  cover(o, blend(DIRT, substrate, 0.5), scrape * 0.6);
  let foot = 1.0 - smoothstep(0.0, 450.0 + fbm(u, v, 10.0, 2.0, 4, 807) * 150.0, height);
  cover(o, DIRT, foot * 0.45);
  cover(o, SALT, foot * smoothstep(0.6, 0.85, fbm01(u, v, 40.0, 20.0, 4, 808)) * 0.3);
  // Dirt streaked down from the joints' ledges.
  let streak = smoothstep(0.62, 0.85, fbm01(u, v, 40.0, 1.0, 4, 809)) * 0.25;
  cover(o, DIRT, saturate(streak * 0.7 + joint * 0.04));
}
