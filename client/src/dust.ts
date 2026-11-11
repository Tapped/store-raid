import {
  BoundingInfo,
  Constants,
  DynamicTexture,
  MeshBuilder,
  SpotLight,
  StandardMaterial,
  Texture,
  Vector3,
} from "@babylonjs/core";
import type { InteriorLighting } from "./interiorLight";
import type { World } from "./scene";
import { tunables } from "./tuning";

/**
 * Dust: sparse motes drifting in the air round the camera, catching the light: the interior light
 * where they are (read from the bake) and any flashlight beam they're in, so they only show in a
 * lit room or a torch beam and vanish in the dark. Dust scatters light forwards, so they glow
 * rather than take light on a face. Thin instances of one small quad, added onto the picture,
 * turned to face the camera each frame, in a box round it that they wrap through; each one's
 * brightness is its instance colour.
 */

const DUST = tunables("Look/Dust", {
  motes: {
    value: 260,
    min: 0,
    max: 800,
    step: 10,
    hint: "How many drift round the camera (on the next load)",
  },
  size: { value: 0.02, min: 0.002, max: 0.06, step: 0.001, hint: "Meters across a mote" },
  room: { value: 0.5, min: 0, max: 1, step: 0.01, hint: "How much a lit room's light they catch" },
  beam: { value: 0.5, min: 0, max: 3, step: 0.01, hint: "How much a flashlight beam's they catch" },
  reach: { value: 4, min: 1, max: 10, hint: "Meters from the camera they drift in" },
  drift: { value: 0.05, min: 0, max: 0.5, hint: "Meters a second they wander" },
});

/** Adds the dust; for interiors, where there's still air for it to hang in. */
export function addDust(world: World, lighting: InteriorLighting): void {
  const { scene } = world;
  const count = Math.round(DUST.motes);
  if (count === 0) return;

  // A soft round speck.
  const speck = new DynamicTexture("dust-speck", { width: 32, height: 32 }, scene, true);
  const context = speck.getContext() as unknown as CanvasRenderingContext2D;
  const g = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = g;
  context.fillRect(0, 0, 32, 32);
  speck.update(false);
  speck.hasAlpha = true;
  speck.wrapU = Texture.CLAMP_ADDRESSMODE;
  speck.wrapV = Texture.CLAMP_ADDRESSMODE;

  const material = new StandardMaterial("dust", scene);
  material.diffuseTexture = speck;
  material.useAlphaFromDiffuseTexture = true;
  // Its own light: the speck, times the instance colour, which is what the mote catches.
  material.disableLighting = true;
  material.diffuseColor.set(0, 0, 0);
  material.emissiveColor.set(1, 1, 1);
  material.alphaMode = Constants.ALPHA_ADD;
  material.alpha = 0.999;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.fogEnabled = false;

  const quad = MeshBuilder.CreatePlane("dust", { size: 1 }, scene);
  quad.material = material;
  quad.isPickable = false;
  quad.alwaysSelectAsActiveMesh = true;

  // Where each mote is, and the way it wanders, from a fixed seed.
  let state = 7919;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const motes = Array.from({ length: count }, () => ({
    x: next(),
    y: next(),
    z: next(),
    phase: next() * Math.PI * 2,
    speed: 0.5 + next(),
    scale: 0.5 + next(),
  }));
  const matrices = new Float32Array(count * 16);
  const previous = new Float32Array(count * 16);
  quad.thinInstanceSetBuffer("matrix", matrices, 16, false);
  quad.thinInstanceSetBuffer("previousMatrix", previous, 16, false);
  // Always drawn, and its bounds only matter for sorting it among the see-through things: one
  // round the camera would do, but these never change.
  quad.setBoundingInfo(new BoundingInfo(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)));
  quad.doNotSyncBoundingInfo = true;
  const colours = new Float32Array(count * 4);
  quad.thinInstanceSetBuffer("color", colours, 4, false);
  /** How much light each mote catches from the room, read a few at a time. */
  const caught = new Float32Array(count);
  let reading = 0;
  const spot = new Vector3();
  const toMote = new Vector3();

  const right = new Vector3();
  const up = new Vector3();
  const forward = new Vector3();
  let time = 0;
  scene.onBeforeRenderObservable.add(() => {
    const camera = scene.activeCamera;
    if (!camera) return;
    time += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    const view = camera.getViewMatrix();
    // The camera's axes, in the world: the rows of the inverse of its view.
    const m = view.m;
    right.set(m[0], m[4], m[8]);
    up.set(m[1], m[5], m[9]);
    forward.set(m[2], m[6], m[10]);
    const eye = camera.globalPosition;
    const reach = DUST.reach;
    const box = reach * 2;
    // Not as far up and down: a storey's air is lower than it's wide.
    const tall = Math.min(box, 3);
    previous.set(matrices);
    const flashlights = scene.lights.filter(
      (light): light is SpotLight =>
        light instanceof SpotLight && light.isEnabled() && light.intensity > 0,
    );
    const level = lighting.level();
    for (const [i, mote] of motes.entries()) {
      const t = time * mote.speed * DUST.drift;
      // A slow wander, and a slower settling.
      const wx = mote.x * box + Math.sin(t * 1.3 + mote.phase) * 0.6 + t * 0.4;
      const wy = mote.y * tall + Math.sin(t * 0.9 + mote.phase * 2) * 0.4 - t * 0.15;
      const wz = mote.z * box + Math.cos(t * 1.1 + mote.phase) * 0.6;
      const wrap = (v: number, centre: number, half: number) => {
        const local = (((v - centre + half) % (half * 2)) + half * 2) % (half * 2);
        return local - half;
      };
      const dx = wrap(wx, eye.x, reach);
      const dy = wrap(wy, eye.y, tall / 2);
      const dz = wrap(wz, eye.z, reach);
      // Fades in from the edges of the box, and isn't right in the eye.
      const d = Math.max(Math.abs(dx) / reach, Math.abs(dy) / (tall / 2), Math.abs(dz) / reach);
      const near = Math.hypot(dx, dy, dz);
      const s =
        DUST.size *
        mote.scale *
        Math.min(1, (1 - d) * 4) *
        Math.min(1, Math.max(0, near - 0.3) * 2);
      const o = i * 16;
      matrices[o] = right.x * s;
      matrices[o + 1] = right.y * s;
      matrices[o + 2] = right.z * s;
      matrices[o + 3] = 0;
      matrices[o + 4] = up.x * s;
      matrices[o + 5] = up.y * s;
      matrices[o + 6] = up.z * s;
      matrices[o + 7] = 0;
      matrices[o + 8] = forward.x * s;
      matrices[o + 9] = forward.y * s;
      matrices[o + 10] = forward.z * s;
      matrices[o + 11] = 0;
      matrices[o + 12] = eye.x + dx;
      matrices[o + 13] = eye.y + dy;
      matrices[o + 14] = eye.z + dz;
      matrices[o + 15] = 1;

      // What it catches: the room's light, a share at a time; and the beams, every frame.
      const x = eye.x + dx;
      const y = eye.y + dy;
      const z = eye.z + dz;
      if (i % 8 === reading) {
        const found = lighting.probe(x, y, z)?.a;
        caught[i] = found ? 0.2126 * found[0] + 0.7152 * found[1] + 0.0722 * found[2] : 0;
      }
      let light = caught[i] * level * DUST.room;
      for (const flashlight of flashlights) {
        spot.copyFrom(flashlight.getAbsolutePosition());
        toMote.set(x - spot.x, y - spot.y, z - spot.z);
        const distance = toMote.length();
        if (distance > flashlight.range || distance < 0.01) continue;
        const way = flashlight.parent ? flashlight.transformedDirection : flashlight.direction;
        const along = Vector3.Dot(toMote, way) / (distance * way.length());
        const edge = Math.cos(flashlight.angle / 2);
        if (along <= edge) continue;
        const cone = Math.min(1, ((along - edge) / (1 - edge)) * 3);
        light += (DUST.beam * flashlight.intensity * cone) / (1 + distance * distance);
      }
      const c = i * 4;
      colours[c] = light;
      colours[c + 1] = light * 0.96;
      colours[c + 2] = light * 0.9;
      colours[c + 3] = 1;
    }
    reading = (reading + 1) % 8;
    quad.thinInstanceBufferUpdated("color");
    quad.thinInstanceBufferUpdated("matrix");
    quad.thinInstanceBufferUpdated("previousMatrix");
  });
}
