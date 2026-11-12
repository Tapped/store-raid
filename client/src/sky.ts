import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
} from "@babylonjs/core";

const WIDTH = 1024;
const HEIGHT = 512;

/** A sky's colours as they should look, in sRGB, 0–255: its clouds, and the haze at the horizon. */
export interface SkyColours {
  cloudDark: readonly [number, number, number];
  cloudLight: readonly [number, number, number];
  haze: readonly [number, number, number];
}

/** The harbour's: a heavy overcast dusk. */
export const HARBOUR_SKY: SkyColours = {
  cloudDark: [56, 62, 74],
  cloudLight: [158, 164, 175],
  haze: [132, 140, 152],
};

/** Where a sky fades into the distance. The fog uses it too, so the land melts into the sky. */
export function horizonOf(sky: SkyColours): Color3 {
  return new Color3(sky.haze[0] / 255, sky.haze[1] / 255, sky.haze[2] / 255);
}

/** The harbour's horizon. */
export const HORIZON = horizonOf(HARBOUR_SKY);

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * fx;
  const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * fx;
  return top + (bottom - top) * fy;
}

function clouds(x: number, y: number): number {
  let sum = 0;
  let amplitude = 0.5;
  for (let octave = 0; octave < 5; octave++) {
    sum += amplitude * noise(x + octave * 17, y + octave * 31);
    x *= 2.03;
    y *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * A heavy overcast sky around the camera, painted once at startup. Clouds are sampled on a flat
 * plane overhead, which gives them perspective towards the horizon and no seam or pinched pole.
 */
export function addSky(scene: Scene, sky: SkyColours = HARBOUR_SKY): void {
  const { cloudDark, cloudLight, haze } = sky;
  const texture = new DynamicTexture("sky", { width: WIDTH, height: HEIGHT }, scene, true);
  const context = texture.getContext() as CanvasRenderingContext2D;
  const image = context.createImageData(WIDTH, HEIGHT);

  for (let row = 0; row < HEIGHT; row++) {
    const elevation = ((row + 0.5) / HEIGHT - 0.5) * Math.PI; // the sphere's UVs put row 0 at the top
    const up = Math.sin(elevation);
    const out = Math.cos(elevation);
    const scale = 1.4 / (Math.max(up, 0) + 0.12);
    for (let column = 0; column < WIDTH; column++) {
      const azimuth = ((column + 0.5) / WIDTH) * Math.PI * 2;
      const x = Math.cos(azimuth) * out * scale;
      const z = Math.sin(azimuth) * out * scale;
      const cover = clamp01((clouds(x * 1.5, z * 1.8) - 0.32) / 0.36);
      const misty = clamp01(1 - up / 0.22);
      const fade = up <= 0 ? 1 : misty * misty;
      const pixel = (row * WIDTH + column) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const cloud = cloudDark[channel] + (cloudLight[channel] - cloudDark[channel]) * cover;
        image.data[pixel + channel] = cloud + (haze[channel] - cloud) * fade;
      }
      image.data[pixel + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  texture.update();

  const material = new StandardMaterial("skyMat", scene);
  material.disableLighting = true;
  material.emissiveTexture = texture;
  material.backFaceCulling = false;
  material.freeze();

  const dome = MeshBuilder.CreateSphere(
    "sky",
    { diameter: 5000, segments: 32, sideOrientation: Mesh.BACKSIDE },
    scene,
  );
  dome.material = material;
  dome.infiniteDistance = true;
  dome.applyFog = false;
  dome.isPickable = false;
}
