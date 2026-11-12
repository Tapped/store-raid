// Layers the outdoor ground surfaces share: stones, strands (grass blades, needles, twigs, roots),
// fallen leaves, moss, lichen and damp earth. Each scatters its elements on a periodic grid of
// `cells` × `cells` across one repeat, a few to a cell, and looks at the 3 × 3 cells round the
// texel, so elements reach at most one cell from their own: keep sizes and lengths ≤ 1 cell. Where
// elements overlap the highest wins, so they pile on each other and the cavity AO finds the
// contact shadows between them. Heights are millimetres; pass the tile in millimetres.

// The `k`th random number of element `n` in cell (x, y).
fn rnd(x: i32, y: i32, n: i32, k: i32, seed: i32) -> f32 {
  return hash(x, y, seed + n * 1013 + k * 7919);
}

// Turns (x, y) by -a: into a frame whose x runs along angle a.
fn toFrame(d: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(d.x * c + d.y * s, -d.x * s + d.y * c);
}

// ---------------------------------------------------------------------------------------------
// Stones: domes with irregular outlines, part buried, packed by overlapping.

struct Stones {
  cells: f32,
  // Candidates per cell, and the chance each is there.
  count: i32,
  fill: f32,
  // Smallest and largest radius, in cells (≤ 1), and how much commoner small ones are (1 even).
  size: vec2f,
  bias: f32,
  // How far they stretch (0 round, 0.5 twice as long as wide), and how lumpy the outline is.
  elong: f32,
  lobes: f32,
  // Profile: 2 a smooth dome, higher a flatter top with steeper sides.
  sharp: f32,
  // Dome height as a share of the radius, and how much of it may be buried (0 to 1, random).
  height: f32,
  sink: f32,
  // Random height between stones as a share of the radius, so where they overlap one rests on
  // another whole, its round outline kept, instead of both cut along a seam.
  stack: f32,
  seed: i32,
}

fn stoneLayer(cells: f32, seed: i32) -> Stones {
  return Stones(cells, 1, 1.0, vec2f(0.5, 0.8), 1.0, 0.25, 0.12, 2.5, 0.55, 0.4, 0.0, seed);
}

struct Stone {
  // Height above the bed in mm, 0 where there's none.
  h: f32,
  // The top stone's own number, 0 to 1 (and a second), or -1 where there's none.
  id: f32,
  id2: f32,
  // 0 at its middle, 1 at its rim.
  rho: f32,
  // Its radius in mm.
  r: f32,
  // Where in it, in its own frame, -1 to 1 along its length.
  local: vec2f,
  // Its middle on the texture (unwrapped next to the texel).
  at: vec2f,
}

fn stoneField(u: f32, v: f32, p: Stones, tileMm: f32) -> Stone {
  var best = Stone(0.0, -1.0, 0.0, 1.0, 0.0, vec2f(0.0), vec2f(0.0));
  let x = u * p.cells;
  let y = v * p.cells;
  let ix = i32(floor(x));
  let iy = i32(floor(y));
  let n = i32(p.cells);
  let cellMm = tileMm / p.cells;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cx = ix + i;
      let cy = iy + j;
      let wx = wrap(cx, n);
      let wy = wrap(cy, n);
      for (var e = 0; e < p.count; e++) {
        if (rnd(wx, wy, e, 0, p.seed) > p.fill) {
          continue;
        }
        let r = mix(p.size.x, p.size.y, pow(rnd(wx, wy, e, 1, p.seed), p.bias));
        let d = vec2f(
          f32(cx) + rnd(wx, wy, e, 2, p.seed) - x,
          f32(cy) + rnd(wx, wy, e, 3, p.seed) - y,
        );
        if (dot(d, d) > r * r * 1.8) {
          continue;
        }
        let a = rnd(wx, wy, e, 4, p.seed) * TAU;
        let el = p.elong * rnd(wx, wy, e, 5, p.seed);
        var l = toFrame(-d, a) / r;
        l = vec2f(l.x / (1.0 + el), l.y / (1.0 - el * 0.4));
        let th = atan2(l.y, l.x);
        let ph = rnd(wx, wy, e, 6, p.seed) * TAU;
        let wob = 1.0 + p.lobes * (0.6 * cos(2.0 * th + ph) + 0.4 * cos(3.0 * th + ph * 2.3) +
          0.25 * cos(5.0 * th + ph * 4.1));
        let rho = length(l) / wob;
        if (rho >= 1.0) {
          continue;
        }
        let rMm = r * cellMm;
        let hh = rMm * p.height * (0.7 + 0.6 * rnd(wx, wy, e, 7, p.seed));
        let prof = sqrt(max(0.0, 1.0 - pow(rho, p.sharp)));
        let h = hh * (prof - p.sink * rnd(wx, wy, e, 8, p.seed)) +
          rMm * p.stack * rnd(wx, wy, e, 11, p.seed);
        if (h > best.h) {
          best = Stone(h, rnd(wx, wy, e, 9, p.seed), rnd(wx, wy, e, 10, p.seed), rho, rMm, l,
            vec2f(x + d.x, y + d.y) / p.cells);
        }
      }
    }
  }
  return best;
}

// A stone's colour from a palette of rock: greys, brown-greys, a rusty one, a dark one, a pale
// quartz, picked and varied by its id.
fn rockColour(id: f32, id2: f32) -> vec3f {
  var c: vec3f;
  let pick = id * 8.0;
  if (pick < 2.2) {
    c = hex(0x6f6d68);
  } else if (pick < 3.6) {
    c = hex(0x5a5751);
  } else if (pick < 4.7) {
    c = hex(0x7a7266);
  } else if (pick < 5.5) {
    c = hex(0x46423d);
  } else if (pick < 6.2) {
    c = hex(0x6e5844);
  } else if (pick < 7.0) {
    c = hex(0x5d6162);
  } else if (pick < 7.6) {
    c = hex(0x837c70);
  } else {
    c = hex(0x9a958a);
  }
  return c * (0.8 + 0.4 * id2);
}

// ---------------------------------------------------------------------------------------------
// Strands: grass blades, needles, twigs. Each is a curved, tapering stroke from its root, lying
// the way a smooth field, a tussock it falls out of and its own spread turn it.

struct Strands {
  cells: f32,
  count: i32,
  fill: f32,
  // Shortest and longest, in cells (≤ 1); half the width at the root, in cells.
  len: vec2f,
  width: f32,
  // 0 even width (needles, twigs), 1 to a point (blades).
  taper: f32,
  // How far they curve sideways, as a share of the length.
  bend: f32,
  // The way they lie, radians, ± a random spread.
  angle: f32,
  spread: f32,
  // How far a smooth field turns them (radians), and its cells per repeat.
  flow: f32,
  flowFreq: f32,
  // Tussocks (voronoi cells per repeat, 0 for none) they fall outward from, how much, the swirl
  // added to the outward way (radians), and how high a tussock's middle stands, mm.
  tuft: f32,
  radial: f32,
  swirl: f32,
  mound: f32,
  // Cross-section: 0 a folded blade with a ridge, 1 round. Height at the middle in mm.
  round: f32,
  thick: f32,
  // How much higher the root lies than the tip, mm (grass laid over), and random height between
  // strands, mm, which decides which lies on top.
  rise: f32,
  layers: f32,
  seed: i32,
}

fn strandLayer(cells: f32, seed: i32) -> Strands {
  return Strands(
    cells, 8, 1.0, vec2f(0.5, 1.0), 0.01, 1.0, 0.15, 0.0, PI, 0.0, 4.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 2.0, seed,
  );
}

struct Strand {
  h: f32,
  // The top strand's number, 0 to 1, or -1 where there's none.
  id: f32,
  id2: f32,
  // How far along it, root 0 to tip 1, and across it, -1 to 1.
  t: f32,
  s: f32,
  // Its root on the texture (unwrapped next to the texel).
  at: vec2f,
}

// The way a strand rooted at (ru, rv) lies, and how high its root stands on its tussock.
fn strandLie(ru: f32, rv: f32, p: Strands, own: f32) -> vec2f {
  var a = p.angle + (own - 0.5) * 2.0 * p.spread;
  if (p.flow > 0.0) {
    a += fbm(ru, rv, p.flowFreq, p.flowFreq, 3, p.seed + 50) * p.flow;
  }
  var lift = 0.0;
  if (p.tuft > 0.0) {
    let c = voronoi(ru, rv, p.tuft, p.tuft, p.seed + 60, 0.85);
    let out = atan2(rv - c.v, ru - c.u) + p.swirl * (c.id - 0.3);
    let d = c.f1;
    // Near the middle they stand up and go any way; further out they fall outward.
    let w = p.radial * smoothstep(0.05, 0.35, d);
    let da = out - a;
    a += atan2(sin(da), cos(da)) * w;
    lift = p.mound * (1.0 - smoothstep(0.0, 0.7, d)) * (0.6 + 0.8 * c.id);
  }
  return vec2f(a, lift);
}

// How far a strand rooted at `at` is from its tussock's middle, in tussock cells (0 at the middle,
// about 0.5 at the edge), for thinning strands out between tussocks.
fn tuftDistance(at: vec2f, p: Strands) -> f32 {
  return voronoi(at.x, at.y, p.tuft, p.tuft, p.seed + 60, 0.85).f1;
}

fn strandField(u: f32, v: f32, p: Strands) -> Strand {
  var best = Strand(-1e9, -1.0, 0.0, 0.0, 0.0, vec2f(0.0));
  let x = u * p.cells;
  let y = v * p.cells;
  let ix = i32(floor(x));
  let iy = i32(floor(y));
  let n = i32(p.cells);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cx = ix + i;
      let cy = iy + j;
      let wx = wrap(cx, n);
      let wy = wrap(cy, n);
      for (var e = 0; e < p.count; e++) {
        if (rnd(wx, wy, e, 0, p.seed) > p.fill) {
          continue;
        }
        let rx = f32(cx) + rnd(wx, wy, e, 1, p.seed);
        let ry = f32(cy) + rnd(wx, wy, e, 2, p.seed);
        let len = mix(p.len.x, p.len.y, rnd(wx, wy, e, 3, p.seed));
        let d = vec2f(x - rx, y - ry);
        if (dot(d, d) > len * len * 1.1) {
          continue;
        }
        let lie = strandLie(rx / p.cells, ry / p.cells, p, rnd(wx, wy, e, 4, p.seed));
        let l = toFrame(d, lie.x);
        let t = l.x / len;
        if (t < 0.0 || t > 1.0) {
          continue;
        }
        let bend = p.bend * (rnd(wx, wy, e, 5, p.seed) - 0.5) * 2.0 * len;
        let off = bend * t * t;
        let w = p.width * (0.6 + 0.8 * rnd(wx, wy, e, 6, p.seed)) *
          mix(1.0, pow(1.0 - t, 0.6), p.taper) * min(1.0, t * len / (p.width * 1.5) + 0.5);
        let s = (l.y - off) / max(w, 1e-6);
        if (abs(s) >= 1.0) {
          continue;
        }
        let prof = mix(1.0 - abs(s) * 0.7, sqrt(1.0 - s * s), p.round);
        let base = rnd(wx, wy, e, 7, p.seed) * p.layers + lie.y + p.rise * (1.0 - t);
        let h = base + prof * p.thick * mix(1.0, 1.0 - t * 0.5, p.taper);
        if (h > best.h) {
          best = Strand(h, rnd(wx, wy, e, 8, p.seed), rnd(wx, wy, e, 9, p.seed), t, s,
            vec2f(rx, ry) / p.cells);
        }
      }
    }
  }
  return best;
}

// Four random numbers in [0, 1) at once, 8 bits each: cheap, for elements there are thousands of.
fn rnd4(x: i32, y: i32, n: i32, seed: i32) -> vec4f {
  let b = hashBits(x, y, seed + n * 1013);
  return vec4f(
    f32(b & 255u),
    f32((b >> 8u) & 255u),
    f32((b >> 16u) & 255u),
    f32(b >> 24u),
  ) / 256.0 + 0.5 / 256.0;
}

// ---------------------------------------------------------------------------------------------
// Tussocks: grass grown in clumps, a clump to a cell, its blades rooted round the middle and
// falling outward, all leaning the way a slow field pushes them and curling one way, so clumps lie
// over in swirls. Much cheaper than strands for dense grass: the clump is worked out once a cell.

struct Tussocks {
  cells: f32,
  // Blades per clump, and the chance a cell has a clump.
  count: i32,
  fill: f32,
  // Blade length in cells (spread + length ≤ 1.2), and half the width at the root, in cells.
  len: vec2f,
  width: f32,
  // How far from the middle blades are rooted, in cells (≤ 0.25).
  spread: f32,
  // 0 every blade falls straight outward, 1 all lie the way of the field; its cells per repeat.
  lean: f32,
  flowFreq: f32,
  // How far blades curl, as a share of their length, one way per clump.
  swirl: f32,
  // How high a clump's middle stands, mm; blades fall from it to the ground at their tips.
  mound: f32,
  // Blade height across its middle, mm; random height between blades, mm.
  thick: f32,
  layers: f32,
  // How much clumps grow and shrink over the repeat, in big slow patches (0 to 1).
  vary: f32,
  seed: i32,
}

struct Blade {
  h: f32,
  // -1 where there's none.
  id: f32,
  id2: f32,
  t: f32,
  s: f32,
  // How high the blade lies in its clump, 0 on the ground to 1 on top.
  up: f32,
  // The clump's own number, 0 to 1.
  clump: f32,
}

fn tussocks(u: f32, v: f32, p: Tussocks) -> Blade {
  var best = Blade(-1e9, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let x = u * p.cells;
  let y = v * p.cells;
  let ix = i32(floor(x));
  let iy = i32(floor(y));
  let n = i32(p.cells);
  let reach = p.spread + p.len.y * 1.15;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cx = ix + i;
      let cy = iy + j;
      let wx = wrap(cx, n);
      let wy = wrap(cy, n);
      let k = rnd4(wx, wy, 0, p.seed);
      if (k.x > p.fill) {
        continue;
      }
      let c = vec2f(f32(cx) + 0.2 + 0.6 * k.y, f32(cy) + 0.2 + 0.6 * k.z);
      let toC = vec2f(x, y) - c;
      let slow = gradient(c.x / p.cells, c.y / p.cells, 3.0, 3.0, p.seed + 9);
      let size = (0.65 + 0.5 * k.w) * (1.0 + p.vary * slow);
      if (dot(toC, toC) > reach * reach * size * size) {
        continue;
      }
      let k2 = rnd4(wx, wy, 1, p.seed);
      let flow = gradient(c.x / p.cells, c.y / p.cells, p.flowFreq, p.flowFreq, p.seed + 5) * TAU +
        k2.x;
      let curl = p.swirl * select(-1.0, 1.0, k2.y < 0.5) * (0.5 + k2.z);
      let mound = p.mound * size;
      for (var e = 0; e < p.count; e++) {
        let r = rnd4(wx, wy, e + 2, p.seed);
        // Roots in a disc round the middle, denser towards it.
        let ra = r.x * TAU;
        let rr = sqrt(r.y) * p.spread * size;
        let root = c + vec2f(cos(ra), sin(ra)) * rr;
        let len = mix(p.len.x, p.len.y, r.z) * size;
        let d = vec2f(x, y) - root;
        if (dot(d, d) > len * len * 1.05) {
          continue;
        }
        // Outward from the middle, leaning with the field, each blade more or less.
        let r3 = rnd4(wx, wy, e + 2, p.seed + 151);
        let out = ra + (r.w - 0.5) * 1.4;
        let da = flow - out;
        let a = out + atan2(sin(da), cos(da)) * saturate(p.lean * (0.55 + 0.7 * r3.x));
        let l = toFrame(d, a);
        let t = l.x / len;
        if (t < 0.0 || t > 1.0) {
          continue;
        }
        let r2 = rnd4(wx, wy, e + 2, p.seed + 77);
        let off = curl * (0.6 + 0.8 * r2.x) * len * t * t;
        let w = p.width * (0.7 + 0.6 * r2.y) * pow(1.0 - t, 0.5) *
          min(1.0, t * len / (p.width * 2.0) + 0.4);
        let s = (l.y - off) / max(w, 1e-6);
        if (abs(s) >= 1.0) {
          continue;
        }
        // Folded along the middle, so each blade has a ridge to catch the light.
        let prof = 1.0 - abs(s) * 0.75;
        // Each blade rises out of the clump, then falls to the ground at its tip.
        let fall = pow(1.0 - t, 1.6) * smoothstep(-0.02, 0.18, t) *
          (1.0 - rr / (p.spread * size + 1e-4) * 0.5) * (0.6 + 0.4 * r3.y);
        let lay = r2.z * p.layers;
        let h = mound * fall * (0.5 + 0.5 * r2.w) + lay + prof * p.thick * (1.0 - t * 0.5);
        if (h > best.h) {
          let up = saturate((h - lay * 0.5) / (mound + p.layers + 1e-4));
          best = Blade(h, r2.w, r.z, t, s, up, k.w);
        }
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Fallen birch leaves: ovate with a pointed tip and a toothed edge, a stalk, a midrib and veins,
// curled up at the edges or along the midrib.

struct Leaves {
  cells: f32,
  count: i32,
  fill: f32,
  // Length in cells (≤ 0.9), and width as a share of it.
  size: vec2f,
  width: f32,
  // Curl in mm at the edges (negative cups down), and random height between leaves, mm.
  curl: f32,
  layers: f32,
  seed: i32,
}

struct Leaf {
  h: f32,
  // -1 where there's none.
  id: f32,
  id2: f32,
  t: f32,
  s: f32,
  // 1 at the edge, 0 inside; the vein pattern, 0 to 1.
  rim: f32,
  vein: f32,
  // Its middle on the texture (unwrapped next to the texel).
  at: vec2f,
}

fn leafLitter(u: f32, v: f32, p: Leaves, tileMm: f32) -> Leaf {
  var best = Leaf(-1e9, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, vec2f(0.0));
  let x = u * p.cells;
  let y = v * p.cells;
  let ix = i32(floor(x));
  let iy = i32(floor(y));
  let n = i32(p.cells);
  let cellMm = tileMm / p.cells;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let cx = ix + i;
      let cy = iy + j;
      let wx = wrap(cx, n);
      let wy = wrap(cy, n);
      for (var e = 0; e < p.count; e++) {
        if (rnd(wx, wy, e, 0, p.seed) > p.fill) {
          continue;
        }
        let len = mix(p.size.x, p.size.y, rnd(wx, wy, e, 1, p.seed));
        // The leaf's middle, and its base half a length back from it.
        let d = vec2f(
          x - f32(cx) - rnd(wx, wy, e, 2, p.seed),
          y - f32(cy) - rnd(wx, wy, e, 3, p.seed),
        );
        if (dot(d, d) > len * len * 0.36) {
          continue;
        }
        let a = rnd(wx, wy, e, 4, p.seed) * TAU;
        let at = vec2f(x - d.x, y - d.y) / p.cells;
        let l = toFrame(d, a) / len + vec2f(0.45, 0.0);
        let t = l.x / 0.9;
        let wide = p.width * (0.85 + 0.3 * rnd(wx, wy, e, 5, p.seed));
        // The stalk.
        if (t < 0.0) {
          if (t > -0.18 && abs(l.y) < 0.012) {
            let h = rnd(wx, wy, e, 7, p.seed) * p.layers + 0.25;
            if (h > best.h) {
              best = Leaf(h, rnd(wx, wy, e, 8, p.seed), rnd(wx, wy, e, 9, p.seed), t, 0.0, 1.0, 0.0, at);
            }
          }
          continue;
        }
        if (t > 1.0) {
          continue;
        }
        // Birch: broad near the base, drawn out to a point; double-toothed edge.
        var w = wide * 0.6 * pow(sin(PI * pow(t, 0.8)), 0.7) * (1.0 - 0.35 * t);
        let teeth = abs(sin(t * 34.0 + a)) * 0.6 + abs(sin(t * 17.0 + a)) * 0.4;
        w *= 1.0 - 0.07 * teeth * smoothstep(0.05, 0.25, t);
        let s = l.y / max(w, 1e-4);
        if (abs(s) >= 1.0) {
          continue;
        }
        let curlK = p.curl * (rnd(wx, wy, e, 6, p.seed) * 1.6 - 0.3);
        // Veins: the midrib and six or so pairs running out towards the tip.
        let mid = 1.0 - smoothstep(0.0, 0.07, abs(s));
        let vp = (t - abs(s) * 0.35) * 8.0;
        let side = (1.0 - smoothstep(0.0, 0.12, abs(fract(vp) - 0.5) * 2.0 - 0.88)) *
          smoothstep(0.08, 0.2, abs(s));
        let vein = max(mid, side * 0.8);
        let lenMm = len * cellMm;
        let tilt = (rnd(wx, wy, e, 10, p.seed) - 0.5) * 0.06 * lenMm * (t - 0.5);
        let h = rnd(wx, wy, e, 7, p.seed) * p.layers + 0.3 + curlK * s * s + tilt - mid * 0.18 -
          side * 0.08 + 0.15 * (1.0 - abs(s));
        if (h > best.h) {
          let rim = smoothstep(0.75, 1.0, abs(s));
          best = Leaf(h, rnd(wx, wy, e, 8, p.seed), rnd(wx, wy, e, 9, p.seed), t, s, rim, vein, at);
        }
      }
    }
  }
  return best;
}

// A fallen birch leaf's colour: most yellow to ochre, some orange or rotting brown, a few still
// green-yellow; darker veins, browner edges and spots of rot.
fn birchLeafColour(lf: Leaf, u: f32, v: f32) -> vec3f {
  var c: vec3f;
  let k = lf.id;
  if (k < 0.45) {
    c = blend(hex(0xb89a2e), hex(0xc4a233), lf.id2);
  } else if (k < 0.65) {
    c = blend(hex(0xa8822a), hex(0xb07a26), lf.id2);
  } else if (k < 0.85) {
    c = blend(hex(0x6b4a28), hex(0x7d5a2c), lf.id2);
  } else {
    c = blend(hex(0x8e8a34), hex(0xa09030), lf.id2);
  }
  c *= 0.75 + 0.25 * lf.id2;
  // Brown creeping in from the edge and in spots.
  let spots = smoothstep(0.62, 0.78, value(u, v, 700.0, 700.0, i32(lf.id * 9000.0)));
  c = blend(c, hex(0x5a3e22), saturate(lf.rim * 0.5 + spots * 0.6) * (0.4 + 0.6 * lf.id2));
  c *= 1.0 - lf.vein * 0.3;
  // Curled leaves catch the light on one half more than the other.
  c *= 0.9 + 0.12 * sign(lf.s) * (lf.id2 - 0.5) * 2.0;
  return c;
}

// ---------------------------------------------------------------------------------------------
// Moss: a cushion of tiny sprigs. Returns the height in mm and a shade around 1.

fn mossBed(u: f32, v: f32, tile: f32, seed: i32) -> vec2f {
  let f = per(tile, 380.0);
  let c = voronoi(u, v, f, f, seed, 1.0);
  let sprig = 1.0 - smoothstep(0.0, 0.7, c.f1);
  let f2 = per(tile, 140.0);
  let c2 = voronoi(u, v, f2, f2, seed + 1, 1.0);
  let tuft = 1.0 - smoothstep(0.1, 0.9, c2.f1);
  let cushion = fbm01(u, v, per(tile, 14.0), per(tile, 14.0), 3, seed + 2);
  let h = sprig * 0.8 + tuft * 1.5 + cushion * 4.0;
  let k = 0.7 + 0.35 * sprig + 0.15 * c.id + 0.15 * c2.id;
  return vec2f(h, k);
}

// Moss colours from shadowed dark green to the paler, yellower tips.
fn mossColour(k: f32, w: f32) -> vec3f {
  let g = blend(hex(0x2f3a1c), hex(0x47552b), saturate(k));
  return blend(g, hex(0x6b6e2c), saturate(w));
}

// ---------------------------------------------------------------------------------------------
// Lichen: crust rosettes with lobed edges that spread from a centre and grow into each other,
// cracked into small plates. Returns cover 0 to 1, the patch's id (pick the colour by it) and the
// crack pattern, 0 to 1.

fn lichenCrust(u: f32, v: f32, tile: f32, seed: i32, amount: f32) -> vec3f {
  let f = per(tile, 7.0);
  let wu = u + fbm(u, v, per(tile, 30.0), per(tile, 30.0), 3, seed + 1) * 0.25 / f;
  let wv = v + fbm(u, v, per(tile, 30.0), per(tile, 30.0), 3, seed + 2) * 0.25 / f;
  let c = voronoi(wu, wv, f, f, seed, 1.0);
  // Only some cells have a rosette, more the more lichen; sizes vary a lot.
  let cid = i32(c.id * 65536.0);
  let here = step(hash(cid, 2, seed + 3), amount);
  let r = (0.08 + 0.4 * pow(hash(cid, 1, seed + 3), 1.5)) * here;
  // Lobed margin: bumps round the rosette, and a little fine fray.
  let ang = atan2(wv - c.v, wu - c.u);
  let lobes = 0.06 * sin(ang * (9.0 + floor(c.id * 6.0)) + c.id * 40.0) * smoothstep(0.0, 0.2, r);
  let fray = fbm(u, v, per(tile, 120.0), per(tile, 120.0), 2, seed + 4) * 0.01;
  let cover = 1.0 - smoothstep(r - 0.02, r + 0.005, c.f1 + lobes * r + fray);
  let fc = per(tile, 260.0);
  let plates = voronoiEdges(u, v, fc, fc, seed + 5, 1.0);
  let cracks = 1.0 - smoothstep(0.02, 0.1, plates.edge);
  return vec3f(cover, c.id, cracks);
}

// ---------------------------------------------------------------------------------------------
// Damp earth between things: crumbly, dark, with fine grit. Returns height mm and shade.

fn earthBed(u: f32, v: f32, tile: f32, seed: i32) -> vec2f {
  let crumb = voronoi(u, v, per(tile, 160.0), per(tile, 160.0), seed, 1.0);
  let lump = 1.0 - smoothstep(0.1, 0.8, crumb.f1);
  let grit = value(u, v, per(tile, 700.0), per(tile, 700.0), seed + 1);
  let broad = fbm(u, v, per(tile, 6.0), per(tile, 6.0), 4, seed + 2);
  let h = lump * 0.8 + grit * 0.25 + broad * 2.0;
  let k = 0.8 + 0.25 * lump * crumb.id + 0.15 * grit;
  return vec2f(h, k);
}

const EARTH = hex(0x2e261e);
const DEAD_GRASS = hex(0x8a7a45);
const DEAD_GRASS_DARK = hex(0x7a6f3f);
const MOSS = hex(0x47552b);
const LITTER = hex(0x6b4a28);
