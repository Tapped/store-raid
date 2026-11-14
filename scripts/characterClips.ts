/**
 * Adds Mixamo animations to the character model: `pnpm run clips`. Each `.fbx` in CLIPS (from
 * `raw/characters/ch17/`, downloaded without skin) is converted by Blender in the background and
 * merged into `assets/models/characters/ch17.glb` as an animation group of its own name, replacing
 * one already there. The model, its skin and its other clips stay as they are.
 *
 * Only bones' rotations and the hips' translation are kept, as in the clips already there. Blender
 * exports the rig under an `Armature` node (a quarter turn about x, centimetres), so the hips' keys
 * are brought into the model's frame, where the hips are a root in meters, y up, facing +z.
 *
 * Mixamo's seated clips sit with the hips over the origin, and its stand-up ends 0.45 m forward
 * of it. The clips in SEATED are all shifted by that stand-up's travel, so the stand-up ends with
 * the hips over the origin, like the walk's, and the character sits that far behind where it
 * stands: a player sitting down on a bench stands in front of it.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Document, type Node as GltfNode, NodeIO } from "@gltf-transform/core";
import { findBlender } from "./unity-import/blender";

const ROOT = resolve(import.meta.dirname, "../..");
const RAW = `${ROOT}/raw/characters/ch17`;
const MODEL = `${ROOT}/assets/models/characters/ch17.glb`;
const CACHE = resolve(import.meta.dirname, "../node_modules/.cache/clips");
const HIPS = "mixamorig1:Hips";

/** The animation group's name in the model, and the Mixamo file it comes from. */
const CLIPS: Record<string, string> = {
  "sit-idle": "Sitting Idle.fbx",
  "sit-idle-2": "Sitting.fbx",
  "sit-to-stand": "Sit To Stand.fbx",
};
/** Seated clips, shifted back by the travel of the one that stands up (see above). */
const SEATED = ["sit-idle", "sit-idle-2", "sit-to-stand"];
const STAND_UP = "sit-to-stand";

const SCRIPT = `
import bpy, json, sys
jobs_file = sys.argv[sys.argv.index("--") + 1]
for job in json.load(open(jobs_file)):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=job["file"])
    bpy.ops.export_scene.gltf(
        filepath=job["out"], export_format="GLB", export_yup=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_step=1,
        export_materials="NONE")
`;

function convert(jobs: { file: string; out: string }[]) {
  writeFileSync(`${CACHE}/convert.py`, SCRIPT);
  writeFileSync(`${CACHE}/jobs.json`, JSON.stringify(jobs));
  execFileSync(
    findBlender(),
    [
      "-b",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      `${CACHE}/convert.py`,
      "--",
      `${CACHE}/jobs.json`,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

type Quat = [number, number, number, number];

function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function rotate(q: Quat, v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = multiply(multiply(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  void w;
  return [x, y, z];
}

/** One clip's keys in the model's frame: rotations per bone, and the hips' translation. */
interface Clip {
  times: Float32Array<ArrayBuffer>;
  rotations: Map<string, Float32Array<ArrayBuffer>>;
  hips: Float32Array<ArrayBuffer>;
}

function readClip(doc: Document): Clip {
  const animation = doc.getRoot().listAnimations()[0];
  const armature = doc
    .getRoot()
    .listScenes()[0]
    .listChildren()
    .find((n) => n.getName() === "Armature") as GltfNode;
  const turn = armature.getRotation() as Quat;
  const scale = armature.getScale()[0];
  let times: Float32Array<ArrayBuffer> | undefined;
  let hips: Float32Array<ArrayBuffer> | undefined;
  const rotations = new Map<string, Float32Array<ArrayBuffer>>();
  for (const channel of animation.listChannels()) {
    const name = channel.getTargetNode()?.getName() ?? "";
    const sampler = channel.getSampler();
    if (!sampler) continue;
    const input = Float32Array.from(sampler.getInput()?.getArray() ?? []);
    const output = Float32Array.from(sampler.getOutput()?.getArray() ?? []);
    times ??= input;
    if (channel.getTargetPath() === "rotation") {
      if (name === HIPS) {
        for (let i = 0; i < output.length; i += 4) {
          output.set(multiply(turn, Array.from(output.subarray(i, i + 4)) as Quat), i);
        }
      }
      rotations.set(name, output);
    } else if (channel.getTargetPath() === "translation" && name === HIPS) {
      for (let i = 0; i < output.length; i += 3) {
        const v = rotate(turn, [output[i], output[i + 1], output[i + 2]]);
        output.set([v[0] * scale, v[1] * scale, v[2] * scale], i);
      }
      hips = output;
    }
  }
  if (!times || !hips) throw new Error("no hips in the clip");
  return { times, rotations, hips };
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const names = Object.keys(CLIPS);
  for (const name of names) {
    if (!existsSync(`${RAW}/${CLIPS[name]}`)) throw new Error(`missing ${RAW}/${CLIPS[name]}`);
  }
  console.log(`Converting ${names.length} clips in Blender…`);
  convert(names.map((name) => ({ file: `${RAW}/${CLIPS[name]}`, out: `${CACHE}/${name}.glb` })));

  const io = new NodeIO();
  const clips = new Map<string, Clip>();
  for (const name of names) clips.set(name, readClip(await io.read(`${CACHE}/${name}.glb`)));

  // How far the stand-up travels over the ground, to shift the seated clips back by.
  const up = clips.get(STAND_UP)?.hips;
  const shift = up ? [up[up.length - 3] - up[0], up[up.length - 1] - up[2]] : [0, 0];

  const backup = `${CACHE}/ch17-before.glb`;
  copyFileSync(MODEL, backup);
  const model = await io.read(MODEL);
  const root = model.getRoot();
  const buffer = root.listBuffers()[0];
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const hipsNode = nodes.get(HIPS);
  if (!hipsNode) throw new Error(`no ${HIPS} in the model`);

  for (const [name, clip] of clips) {
    for (const old of root.listAnimations().filter((a) => a.getName() === name)) old.dispose();
    if (SEATED.includes(name)) {
      for (let i = 0; i < clip.hips.length; i += 3) {
        clip.hips[i] -= shift[0];
        clip.hips[i + 2] -= shift[1];
      }
    }
    const animation = model.createAnimation(name);
    const input = model.createAccessor().setArray(clip.times).setType("SCALAR").setBuffer(buffer);
    const add = (
      node: GltfNode,
      path: "rotation" | "translation",
      values: Float32Array<ArrayBuffer>,
    ) => {
      const output = model
        .createAccessor()
        .setArray(values)
        .setType(path === "rotation" ? "VEC4" : "VEC3")
        .setBuffer(buffer);
      const sampler = model
        .createAnimationSampler()
        .setInput(input)
        .setOutput(output)
        .setInterpolation("LINEAR");
      animation
        .addSampler(sampler)
        .addChannel(
          model
            .createAnimationChannel()
            .setTargetNode(node)
            .setTargetPath(path)
            .setSampler(sampler),
        );
    };
    add(hipsNode, "translation", clip.hips);
    let skipped = 0;
    for (const [bone, values] of clip.rotations) {
      const node = nodes.get(bone);
      if (node) add(node, "rotation", values);
      else skipped++;
    }
    const seconds = clip.times[clip.times.length - 1];
    console.log(
      `  ${name}: ${seconds.toFixed(2)} s, ${clip.rotations.size - skipped} bones` +
        (skipped ? `, ${skipped} not in the model` : ""),
    );
  }
  await io.write(MODEL, model);
  console.log(
    `Wrote ${MODEL} (seated clips shifted ${shift[1].toFixed(2)} m back; the old one is in ${backup}).`,
  );
  console.log("Run pnpm run assets:backup to keep it.");
}

await main();
