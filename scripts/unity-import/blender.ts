/**
 * Converts model files to glTF with Blender, run in the background. Blender keeps one level of
 * detail, drops collision meshes and extra UV sets, applies every transform and joins the meshes
 * into one. Materials are exported by name only: textures are added afterwards (see gltf.ts).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

export interface Job {
  name: string;
  /** A model file Blender can import, with its extension. */
  file: string;
  lod: number;
}

export interface Converted {
  /** The level of detail kept: the one asked for, else the nearest the model has. */
  lod: number;
  polys: number;
  /** Size in meters, Blender axes (x, y, z up). */
  dims: [number, number, number];
  /** Material names, in slot order. */
  slots: (string | null)[];
}

const SCRIPT = String.raw`
import bpy, json, os, re, sys

jobs_file, out_dir = sys.argv[sys.argv.index("--") + 1:]
result = {}
for job in json.load(open(jobs_file)):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.fbx(filepath=job["file"])
    except Exception as e:
        print("UNITY-IMPORT FAILED", job["name"], e)
        continue
    # Unparent everything first, so removing a parent never moves what it held.
    for o in bpy.data.objects:
        o.select_set(True)
    if bpy.data.objects:
        bpy.context.view_layer.objects.active = bpy.data.objects[0]
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    meshes = [o for o in bpy.data.objects
              if o.type == "MESH" and not re.search(r"Hull|UCX|Collision|Collider", o.name)]
    lods = {}
    for o in meshes:
        m = re.search(r"_LOD(\d+)$", o.name)
        if m:
            lods.setdefault(int(m.group(1)), []).append(o)
    if lods:
        lod = min(lods, key=lambda n: (abs(n - job["lod"]), n))
        keep = lods[lod]
    else:
        lod, keep = 0, meshes
    if not keep:
        print("UNITY-IMPORT FAILED", job["name"], "no meshes")
        continue
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in keep:
        o.select_set(True)
        while len(o.data.uv_layers) > 1:
            o.data.uv_layers.remove(o.data.uv_layers[-1])
    bpy.context.view_layer.objects.active = keep[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(keep) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = job["name"]
    result[job["name"]] = {
        "lod": lod,
        "polys": len(o.data.polygons),
        "dims": [round(v, 3) for v in o.dimensions],
        "slots": [s.material.name if s.material else None for s in o.material_slots],
    }
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out_dir, job["name"] + ".glb"), export_format="GLB",
        export_yup=True, export_apply=True, export_tangents=True, export_materials="EXPORT",
        export_image_format="NONE", export_animations=False)
json.dump(result, open(os.path.join(out_dir, "converted.json"), "w"))
`;

/** BLENDER if set, else the newest Blender in its default Windows folder, else `blender`. */
export function findBlender(): string {
  if (process.env.BLENDER) return process.env.BLENDER;
  const root = "C:/Program Files/Blender Foundation";
  if (existsSync(root)) {
    const version = (s: string) => s.match(/\d+/g)?.map(Number) ?? [];
    const newest = readdirSync(root)
      .filter((d) => existsSync(`${root}/${d}/blender.exe`))
      .sort((a, b) => {
        const [va, vb] = [version(a), version(b)];
        for (let i = 0; i < Math.max(va.length, vb.length); i++) {
          if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
        }
        return 0;
      })[0];
    if (newest) return `${root}/${newest}/blender.exe`;
  }
  return "blender";
}

/** Converts each job to `<dir>/<name>.glb`. */
export function convert(blender: string, jobs: Job[], dir: string): Record<string, Converted> {
  writeFileSync(`${dir}/convert.py`, SCRIPT);
  writeFileSync(`${dir}/jobs.json`, JSON.stringify(jobs));
  const log = execFileSync(
    blender,
    [
      "-b",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      `${dir}/convert.py`,
      "--",
      `${dir}/jobs.json`,
      dir,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  for (const line of log.split("\n")) {
    if (line.startsWith("UNITY-IMPORT")) console.warn(line.replace("UNITY-IMPORT ", ""));
  }
  return JSON.parse(readFileSync(`${dir}/converted.json`, "utf8"));
}
