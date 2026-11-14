"""
What a Blender job does, for build.py, which reloads this and every helper before each job so a
running Blender always builds from the scripts as they are on disk.

A job is a dict from index.ts:

  {"kind": "build", "models": [{"name", "script"}], "items": {...}, "work": dir,
   "draft": bool, "quick": bool, "views": [...] | None, "focus": str | None}
      Builds each model script. A full build bakes its procedural materials and exports
      <work>/<name>/raw.glb, with PNG textures that index.ts compresses. A draft bakes and exports
      nothing: it renders the live scene, its materials unbaked, into <work>/<name>/views. A quick
      build bakes at a quarter of the size with fewer samples, to check a model in the game soon.

  {"kind": "preview", "models": [{"name", "glb", "offset"}], "views", "focus"}
      Renders each finished .glb into the views folder beside it.

Returns {name: result} for index.ts.
"""

import importlib.util
import os
import time
import traceback

import bpy

import lib
import studio


def run(job):
    if job["kind"] == "preview":
        return {m["name"]: _guard(m["name"], lambda m=m: _preview(job, m)) for m in job["models"]}
    lib.ITEMS = job["items"]
    lib.QUICK = bool(job.get("quick"))
    return {m["name"]: _guard(m["name"], lambda m=m: _build(job, m)) for m in job["models"]}


def _guard(name, fn):
    try:
        return fn()
    except Exception:
        for line in traceback.format_exc().splitlines():
            print("MODEL", name, line)
        return {"error": True}


def _preview(job, model):
    lib.reset()
    bpy.ops.import_scene.gltf(filepath=model["glb"])
    studio.occlusion_into_colour()
    focus = studio.focus_box(job["focus"], model.get("offset") or (0, 0, 0)) if job.get("focus") else None
    studio.render(os.path.join(os.path.dirname(model["glb"]), "views"), job.get("views"), focus)
    return {}


class Clock:
    """Prints how long each step of a model took, to see where a build spends its time."""

    def __init__(self, name):
        self.name, self.last, self.steps = name, time.perf_counter(), []

    def step(self, what):
        now = time.perf_counter()
        self.steps.append(f"{what} {now - self.last:.1f} s")
        self.last = now

    def report(self):
        print("MODEL", self.name, "took:", ", ".join(self.steps))


def _build(job, model):
    name = model["name"]
    clock = Clock(name)
    out_dir = os.path.join(job["work"], name)
    os.makedirs(out_dir, exist_ok=True)
    lib.reset()
    spec = importlib.util.spec_from_file_location(f"model_{name}", model["script"])
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    item = getattr(mod, "ITEM", None)
    if item is not None and item not in lib.ITEMS:
        raise ValueError(f"ITEM {item!r} is not in ITEM_KINDS")
    mod.build()
    obj = lib.join(name, getattr(mod, "SMOOTH_ANGLE", 35))
    clock.step("build")
    draft = bool(job.get("draft"))
    baked = [] if draft else lib.bake_all(obj, out_dir, name)
    if baked:
        clock.step("bake")
    ao = 0 if draft else getattr(mod, "AO", 512)
    if ao:
        ao = lib.bake_ao(obj, ao, getattr(mod, "AO_DISTANCE", 0.3), out_dir)
        clock.step("occlusion")
    tris = lib.triangles(obj)
    origin = getattr(mod, "ORIGIN", "center" if item else "bottom")
    dims, offset = lib.place_origin(obj, origin)
    result = {
        "out": getattr(mod, "OUT", f"models/props/{name}.glb"),
        "item": item,
        "tris": tris,
        "budget": getattr(mod, "TRIS", None),
        "dims": dims,
        "offset": list(offset),
        "bounds": _gltf_bounds(obj),
        "materials": [s.material.name for s in obj.material_slots if s.material],
        "baked": baked,
        "ao": bool(ao),
        "draft": draft,
        "quick": lib.QUICK,
    }
    if draft:
        focus = studio.focus_box(job["focus"], offset) if job.get("focus") else None
        studio.render(os.path.join(out_dir, "views"), job.get("views"), focus)
        clock.step("preview")
        clock.report()
        return result
    if lib.BONES:
        lib.rig(obj, offset)
    # Applying modifiers leaves the armature's alone, so the mesh exports skinned in its rest pose.
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out_dir, "raw.glb"), export_format="GLB", export_yup=True,
        export_apply=True, export_tangents=True, export_materials="EXPORT",
        export_image_format="AUTO", export_animations=False, export_extras=False,
        export_skins=bool(lib.BONES), export_def_bones=False,
    )
    clock.step("export")
    clock.report()
    return result


def _gltf_bounds(obj):
    """The mesh's bounds in glTF axes (x, y up, z toward the front), as [min, max]."""
    xs, ys, zs = zip(*(v.co for v in obj.data.vertices))
    return [[min(xs), min(zs), -max(ys)], [max(xs), max(zs), -min(ys)]]
