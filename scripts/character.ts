/**
 * Builds the character model from Mixamo downloads: `pnpm run character`. The skinned model,
 * `assets/raw/characters/<CHARACTER>/<file>.fbx`, and every clip in `assets/raw/characters/animations/`
 * (downloaded without skin, named after the animation group it becomes) are converted by Blender in
 * the background into `assets/models/characters/<CHARACTER>.glb`.
 *
 * The model: Blender applies the rig's quarter turn and centimetres, so the hips are a root in
 * meters, y up, facing +z. Its textures are the FBX's diffuse and normal maps at TEXTURE pixels as
 * WebP; it has no gloss or specular, but a rough, non-metallic surface, double-sided.
 *
 * The clips: only bones' rotations and the hips' translation are kept, matched to the model's bones
 * by name after the rig's prefix (`mixamorig1:Hips` drives `mixamorig:Hips`), so clips downloaded
 * for one Mixamo character work on another. The hips' keys are brought into the model's frame and
 * scaled by how much higher the model's hips are than the clip's own character's. The walking
 * clips (IN_PLACE) lose their travel forward, since the game moves the character.
 *
 * Mixamo's seated clips sit with the hips over the origin, and its stand-up ends some 0.45 m
 * forward of it. The clips in SEATED are all shifted by that stand-up's travel, so the stand-up
 * ends with the hips over the origin, like the walk's, and the character sits that far behind where
 * it stands: a player sitting down on a bench stands in front of it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { type Document, type Node as GltfNode, NodeIO } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";
import sharp from "sharp";
import { findBlender } from "./unity-import/blender";

/** Which character to build, from `assets/raw/characters/<name>/`. */
const CHARACTER = "ch35";
const ROOT = resolve(import.meta.dirname, "../..");
const RAW = `${ROOT}/assets/raw/characters`;
const ANIMATIONS = `${RAW}/animations`;
const MODEL = `${ROOT}/assets/models/characters/${CHARACTER}.glb`;
const CACHE = resolve(import.meta.dirname, "../node_modules/.cache/character");
/** Texture size on a side: four textures of this size per material, unpacked on the GPU. */
const TEXTURE = 1024;
const ROUGHNESS = 0.85;

/** Seated clips, shifted back by the travel of the one that stands up (see above). */
const SEATED = ["sit-idle", "sit-idle-2", "sit-to-stand"];
/** Clips that walk forward, kept in place: the game moves the character. */
const IN_PLACE = ["walk", "carry-walk", "carry-stop"];
/** Looping clips, whose last key, the same pose as the first, is dropped so the loop doesn't hitch. */
const LOOPS = ["walk", "carry-walk"];
const STAND_UP = "sit-to-stand";

const SCRIPT = `
import bpy, json, os, sys
job = json.load(open(sys.argv[sys.argv.index("--") + 1]))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=job["model"])
armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = armature
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
textures = {}
for material in bpy.data.materials:
    maps = {}
    for node in material.node_tree.nodes if material.node_tree else []:
        image = getattr(node, "image", None)
        if node.type != "TEX_IMAGE" or not image or not image.packed_file:
            continue
        name = image.filepath.replace("\\\\", "/").split("/")[-1]
        for kind, word in (("color", "Diffuse"), ("normal", "Normal")):
            if word in name:
                out = os.path.join(job["cache"], name)
                open(out, "wb").write(image.packed_file.data)
                maps[kind] = out
    textures[material.name] = maps
json.dump(textures, open(job["textures"], "w"))
bpy.ops.export_scene.gltf(
    filepath=job["out"], export_format="GLB", export_yup=True, export_animations=False,
    export_skins=True, export_materials="EXPORT", export_image_format="NONE")

for clip in job["clips"]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=clip["file"])
    bpy.ops.export_scene.gltf(
        filepath=clip["out"], export_format="GLB", export_yup=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_step=1,
        export_materials="NONE")
`;

interface Job {
  model: string;
  out: string;
  textures: string;
  cache: string;
  clips: { file: string; out: string }[];
}

function convert(job: Job) {
  writeFileSync(`${CACHE}/convert.py`, SCRIPT);
  writeFileSync(`${CACHE}/job.json`, JSON.stringify(job));
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
      `${CACHE}/job.json`,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

type Quat = [number, number, number, number];
type Vec = [number, number, number];

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

function rotate(q: Quat, v: Vec): Vec {
  const [x, y, z] = multiply(multiply(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [x, y, z];
}

/** A bone's name without the rig's prefix: `mixamorig1:Hips` → `Hips`. */
const bone = (name: string) => name.slice(name.lastIndexOf(":") + 1);

/** One clip's keys in the model's frame: rotations per bone, and the hips' translation. */
interface Clip {
  times: Float32Array<ArrayBuffer>;
  rotations: Map<string, Float32Array<ArrayBuffer>>;
  hips: Float32Array<ArrayBuffer>;
  /** The height of the hips of the character the clip was made for, at rest. */
  rest: number;
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
  const hipsNode = doc
    .getRoot()
    .listNodes()
    .find((n) => bone(n.getName()) === "Hips");
  if (!hipsNode) throw new Error("no hips in the clip");
  const rest = rotate(turn, hipsNode.getTranslation() as Vec)[1] * scale;
  let times: Float32Array<ArrayBuffer> | undefined;
  let hips: Float32Array<ArrayBuffer> | undefined;
  const rotations = new Map<string, Float32Array<ArrayBuffer>>();
  for (const channel of animation.listChannels()) {
    const name = bone(channel.getTargetNode()?.getName() ?? "");
    const sampler = channel.getSampler();
    if (!sampler) continue;
    const input = Float32Array.from(sampler.getInput()?.getArray() ?? []);
    const output = Float32Array.from(sampler.getOutput()?.getArray() ?? []);
    times ??= input;
    if (channel.getTargetPath() === "rotation") {
      if (name === "Hips") {
        for (let i = 0; i < output.length; i += 4) {
          output.set(multiply(turn, Array.from(output.subarray(i, i + 4)) as Quat), i);
        }
      }
      rotations.set(name, output);
    } else if (channel.getTargetPath() === "translation" && name === "Hips") {
      for (let i = 0; i < output.length; i += 3) {
        const v = rotate(turn, [output[i], output[i + 1], output[i + 2]]);
        output.set([v[0] * scale, v[1] * scale, v[2] * scale], i);
      }
      hips = output;
    }
  }
  if (!times || !hips) throw new Error("no hips' keys in the clip");
  return { times, rotations, hips, rest };
}

/** The model's own: the rig's root at the scene's, and the FBX's textures, smaller, as WebP. */
async function finishModel(
  model: Document,
  textures: Record<string, { color?: string; normal?: string }>,
) {
  const root = model.getRoot();
  const scene = root.listScenes()[0];
  const armature = scene.listChildren().find((n) => n.getName() === "Armature");
  if (armature) {
    const identity =
      armature.getTranslation().every((v) => Math.abs(v) < 1e-5) &&
      armature.getScale().every((v) => Math.abs(v - 1) < 1e-5) &&
      Math.abs(armature.getRotation()[3]) > 1 - 1e-5;
    if (!identity) throw new Error("the rig still has a transform of its own");
    for (const child of armature.listChildren()) scene.addChild(child);
    armature.dispose();
  }

  const webp = async (file: string, kind: "color" | "normal", name: string) => {
    const image = sharp(file).resize(TEXTURE, TEXTURE, { fit: "fill" });
    const stats = kind === "color" ? await sharp(file).stats() : undefined;
    const alpha = stats && stats.channels.length === 4 && stats.channels[3].min < 128;
    const data = await (kind === "color" && !alpha ? image.removeAlpha() : image)
      .webp({ quality: kind === "normal" ? 85 : 80 })
      .toBuffer();
    return {
      texture: model.createTexture(name).setMimeType("image/webp").setImage(data),
      alpha: Boolean(alpha),
    };
  };
  for (const material of root.listMaterials()) {
    const maps = textures[material.getName()];
    if (!maps?.color) throw new Error(`no diffuse map for ${material.getName()}`);
    const color = await webp(maps.color, "color", `${basename(maps.color, ".png")}`);
    material
      .setBaseColorTexture(color.texture)
      .setBaseColorFactor([1, 1, 1, 1])
      .setRoughnessFactor(ROUGHNESS)
      .setMetallicFactor(0)
      .setDoubleSided(true)
      .setAlphaMode(color.alpha ? "MASK" : "OPAQUE");
    if (maps.normal) {
      material.setNormalTexture(
        (await webp(maps.normal, "normal", basename(maps.normal, ".png"))).texture,
      );
    }
    console.log(`  ${material.getName()}${color.alpha ? ", cut out" : ""}`);
  }
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const dir = `${RAW}/${CHARACTER}`;
  const fbx = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".fbx"))
    : [];
  if (fbx.length !== 1) throw new Error(`expected one .fbx in ${dir}, found ${fbx.length}`);
  const names = readdirSync(ANIMATIONS)
    .filter((f) => f.toLowerCase().endsWith(".fbx"))
    .map((f) => f.slice(0, -4));
  console.log(`Converting ${CHARACTER} and ${names.length} clips in Blender…`);
  const job: Job = {
    model: `${dir}/${fbx[0]}`,
    out: `${CACHE}/${CHARACTER}.glb`,
    textures: `${CACHE}/textures.json`,
    cache: CACHE,
    clips: names.map((name) => ({
      file: `${ANIMATIONS}/${name}.fbx`,
      out: `${CACHE}/clip-${name}.glb`,
    })),
  };
  convert(job);

  const io = new NodeIO();
  const model = await io.read(job.out);
  await finishModel(model, JSON.parse(readFileSync(job.textures, "utf8")));
  const root = model.getRoot();
  const buffer = root.listBuffers()[0];
  const nodes = new Map(root.listNodes().map((n) => [bone(n.getName()), n]));
  const hipsNode = nodes.get("Hips");
  if (!hipsNode) throw new Error("no hips in the model");
  const height = hipsNode.getTranslation()[1];

  const clips = new Map<string, Clip>();
  for (const name of names) clips.set(name, readClip(await io.read(`${CACHE}/clip-${name}.glb`)));
  for (const [name, clip] of clips) {
    const ratio = height / clip.rest;
    for (let i = 0; i < clip.hips.length; i++) clip.hips[i] *= ratio;
    if (IN_PLACE.includes(name)) {
      for (let i = 2; i < clip.hips.length; i += 3) clip.hips[i] = 0;
    }
    if (LOOPS.includes(name)) {
      const keys = clip.times.length - 1;
      clip.times = clip.times.slice(0, keys);
      clip.hips = clip.hips.slice(0, keys * 3);
      for (const [bone, values] of clip.rotations)
        clip.rotations.set(bone, values.slice(0, keys * 4));
    }
  }

  // How far the stand-up travels over the ground, to shift the seated clips back by.
  const up = clips.get(STAND_UP)?.hips;
  const shift = up ? [up[up.length - 3] - up[0], up[up.length - 1] - up[2]] : [0, 0];

  for (const [name, clip] of clips) {
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
    for (const [name, values] of clip.rotations) {
      const node = nodes.get(name);
      if (node) add(node, "rotation", values);
      else skipped++;
    }
    const seconds = clip.times[clip.times.length - 1];
    console.log(
      `  ${name}: ${seconds.toFixed(2)} s, ${clip.rotations.size - skipped} bones` +
        (skipped ? `, ${skipped} not in the model` : ""),
    );
  }
  await model.transform(prune());
  await io.write(MODEL, model);
  console.log(
    `Wrote ${MODEL}: hips ${height.toFixed(2)} m up, seated clips shifted ${shift[1].toFixed(2)} m back.`,
  );
  console.log("Run pnpm run assets:backup to keep it.");
}

await main();
