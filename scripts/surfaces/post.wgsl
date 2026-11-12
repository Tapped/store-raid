// After a recipe has filled every texel: the cavity blur, normals from the height, the bytes of the
// three textures, each row's summed colour, and the contact sheet. Prefixed with lib/noise.wgsl.

struct Post {
  size: u32,
  // Box blur radius in texels, for the cavity.
  radius: i32,
  cavity: u32,
  cavityRadius: f32,
  cavityStrength: f32,
  // Millimetres per texel.
  mm: f32,
  tintable: u32,
  cutout: u32,
  tintR: f32,
  tintG: f32,
  tintB: f32,
  crop: u32,
  off: u32,
}

@group(0) @binding(0) var<uniform> post: Post;
// r, g, b, tint
@group(0) @binding(1) var<storage, read> colour: array<vec4f>;
// height (mm), ao, rough, metal
@group(0) @binding(2) var<storage, read> surface: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> blurA: array<f32>;
@group(0) @binding(4) var<storage, read_write> blurB: array<f32>;
// The normal, and the ambient occlusion with the cavity in.
@group(0) @binding(5) var<storage, read_write> normals: array<vec4f>;
// The colour as it will look, with the tint in.
@group(0) @binding(6) var<storage, read_write> albedo: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> baseBytes: array<u32>;
@group(0) @binding(8) var<storage, read_write> normalBytes: array<u32>;
@group(0) @binding(9) var<storage, read_write> ormBytes: array<u32>;
@group(0) @binding(10) var<storage, read_write> rowSums: array<vec4f>;
@group(0) @binding(11) var<storage, read_write> sheet: array<u32>;

const SHEET_W = 2048u;
const SHEET_H = 1536u;

fn texel(x: i32, y: i32) -> u32 {
  let n = i32(post.size);
  return u32(wrap(y, n) * n + wrap(x, n));
}

fn boxBlur(id: vec3u, horizontal: bool, src: u32) -> f32 {
  let x = i32(id.x);
  let y = i32(id.y);
  var sum = 0.0;
  for (var k = -post.radius; k <= post.radius; k++) {
    var i: u32;
    if (horizontal) {
      i = texel(x + k, y);
    } else {
      i = texel(x, y + k);
    }
    if (src == 0u) {
      sum += surface[i].x;
    } else if (src == 1u) {
      sum += blurA[i];
    } else {
      sum += blurB[i];
    }
  }
  return sum / f32(2 * post.radius + 1);
}

// The blur is a box, across and down, twice: first, down, across, down.
@compute @workgroup_size(8, 8)
fn blurFirst(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= post.size || id.y >= post.size) {
    return;
  }
  blurA[texel(i32(id.x), i32(id.y))] = boxBlur(id, true, 0u);
}

@compute @workgroup_size(8, 8)
fn blurDown(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= post.size || id.y >= post.size) {
    return;
  }
  blurB[texel(i32(id.x), i32(id.y))] = boxBlur(id, false, 1u);
}

@compute @workgroup_size(8, 8)
fn blurAcross(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= post.size || id.y >= post.size) {
    return;
  }
  blurA[texel(i32(id.x), i32(id.y))] = boxBlur(id, true, 2u);
}

fn byte(x: f32) -> u32 {
  return u32(clamp(roundUp(x * 255.0), 0.0, 255.0));
}

fn pack(r: u32, g: u32, b: u32, a: u32) -> u32 {
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}

fn heightAt(x: i32, y: i32) -> f32 {
  return surface[texel(x, y)].x;
}

@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= post.size || id.y >= post.size) {
    return;
  }
  let x = i32(id.x);
  let y = i32(id.y);
  let i = texel(x, y);
  let c = colour[i];
  let s = surface[i];

  // Hollows darken: how far a texel lies below the blurred height around it.
  var ao = s.y;
  if (post.cavity != 0u) {
    let depth = max(0.0, blurB[i] - s.x);
    ao *= 1.0 - clamp((depth / post.cavityRadius) * post.cavityStrength * 4.0, 0.0, 0.85);
  }

  // Normals by a 3×3 Sobel of the height, in millimetres per millimetre: real depth over real
  // size. Rows run down the image, v up it.
  let dx = heightAt(x + 1, y - 1) + 2.0 * heightAt(x + 1, y) + heightAt(x + 1, y + 1) -
    heightAt(x - 1, y - 1) - 2.0 * heightAt(x - 1, y) - heightAt(x - 1, y + 1);
  let dy = heightAt(x - 1, y - 1) + 2.0 * heightAt(x, y - 1) + heightAt(x + 1, y - 1) -
    heightAt(x - 1, y + 1) - 2.0 * heightAt(x, y + 1) - heightAt(x + 1, y + 1);
  let n = normalize(vec3f(-dx / (8.0 * post.mm), -dy / (8.0 * post.mm), 1.0));
  normals[i] = vec4f(n, ao);

  // Cut-out surfaces show their holes dark; tintable ones show the tint where the bake lets it.
  let tint = vec3f(post.tintR, post.tintG, post.tintB);
  var al: vec3f;
  if (post.cutout != 0u) {
    al = select(vec3f(0.01), c.rgb, c.a > 0.5);
  } else {
    al = saturate(c.rgb + tint * c.a);
  }
  albedo[i] = vec4f(al, 0.0);

  // Tintable surfaces keep the tint amount in alpha; cut-out ones their coverage.
  var alpha = 255u;
  if (post.tintable != 0u) {
    alpha = byte(saturate(c.a));
  }
  baseBytes[i] = pack(byte(srgb(c.r)), byte(srgb(c.g)), byte(srgb(c.b)), alpha);
  let nb = n * 0.5 + 0.5;
  normalBytes[i] = pack(byte(nb.x), byte(nb.y), byte(nb.z), 255u);
  ormBytes[i] = pack(byte(saturate(ao)), byte(clamp(s.z, 0.03, 1.0)), byte(saturate(s.w)), 255u);
}

// Each row's colour summed, for the average.
@compute @workgroup_size(64)
fn sumRows(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= post.size) {
    return;
  }
  var sum = vec3f(0.0);
  for (var x = 0u; x < post.size; x++) {
    sum += albedo[id.x * post.size + x].rgb;
  }
  rowSums[id.x] = vec4f(sum, 0.0);
}

// The surface lit by a warm light low from the left, as sRGB bytes.
fn lit(i: u32) -> vec3f {
  let n = normals[i].xyz;
  let ao = normals[i].w;
  let s = surface[i];
  let rough = clamp(s.z, 0.03, 1.0);
  let metal = s.w;
  let l = normalize(vec3f(-0.62, 0.42, 0.42));
  let light = vec3f(1.0, 0.82, 0.62) * 2.4;
  let ndl = max(0.0, dot(n, l));
  let half = normalize(l + vec3f(0.0, 0.0, 1.0));
  let ndh = max(0.0, dot(n, half));
  let alpha = rough * rough;
  let a2 = alpha * alpha;
  let d = ndh * ndh * (a2 - 1.0) + 1.0;
  let ggx = a2 / (PI * d * d);
  let spec = min(ggx * 0.25, 40.0) * ndl;
  let al = albedo[i].rgb;
  let f0 = 0.04 * (1.0 - metal) + al * metal;
  let diffuse = al * (1.0 - metal) * (ndl * light + 0.05 * ao);
  let v = diffuse * ao + spec * f0 * light * ao;
  return floor(srgb3(v / (1.0 + v)) * 255.0 + 0.5);
}

// One of the contact sheet's pictures of texel i, as bytes 0 to 255.
fn picture(kind: u32, i: u32) -> vec3f {
  switch kind {
    case 0u: {
      return trunc(srgb3(albedo[i].rgb) * 255.0);
    }
    case 1u: {
      return trunc((normals[i].xyz * 0.5 + 0.5) * 255.0);
    }
    case 2u: {
      let r = surface[i].z * 255.0;
      let m = surface[i].w;
      return clamp(trunc(vec3f(r, r, r * (1.0 - m) + 255.0 * m * 0.6)), vec3f(0.0), vec3f(255.0));
    }
    case 3u: {
      return vec3f(trunc(clamp(normals[i].w, 0.0, 1.0) * 255.0));
    }
    default: {
      return lit(i);
    }
  }
}

// A picture box-filtered down to 512 across.
fn shrunk(kind: u32, x: u32, y: u32) -> vec3f {
  let size = post.size;
  let step = f32(size) / 512.0;
  let k = max(1u, u32(floor(step)));
  var acc = vec3f(0.0);
  for (var j = 0u; j < k; j++) {
    for (var i = 0u; i < k; i++) {
      let sx = (u32(floor(f32(x) * step)) + i) % size;
      let sy = (u32(floor(f32(y) * step)) + j) % size;
      acc += picture(kind, sy * size + sx);
    }
  }
  return trunc(acc / f32(k * k));
}

// The contact sheet: colour, normal, roughness and occlusion along the top; below, the lit surface
// tiled 2×2, and a crop of it at full size.
@compute @workgroup_size(8, 8)
fn contactSheet(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= SHEET_W || id.y >= SHEET_H) {
    return;
  }
  var c = vec3f(0.0);
  if (id.y < 512u) {
    c = shrunk(id.x / 512u, id.x % 512u, id.y);
  } else if (id.x < 1024u) {
    c = shrunk(4u, id.x % 512u, (id.y - 512u) % 512u);
  } else {
    let lx = id.x - 1024u;
    let ly = id.y - 512u;
    if (lx < post.crop && ly < post.crop) {
      c = lit((post.off + ly) * post.size + post.off + lx);
    }
  }
  sheet[id.y * SHEET_W + id.x] = pack(u32(c.r), u32(c.g), u32(c.b), 255u);
}
