"""
Run by index.ts inside Blender: builds each model script and exports it as <work>/<name>/raw.glb,
with PNG textures that index.ts compresses. Arguments after --: the job file.
"""

import importlib.util
import json
import os
import sys
import traceback

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
lib.ITEMS = job["items"]
work = job["work"]
result = {}

for model in job["models"]:
    name = model["name"]
    out_dir = os.path.join(work, name)
    os.makedirs(out_dir, exist_ok=True)
    try:
        lib.reset()
        spec = importlib.util.spec_from_file_location(f"model_{name}", model["script"])
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        item = getattr(mod, "ITEM", None)
        if item is not None and item not in lib.ITEMS:
            raise ValueError(f"ITEM {item!r} is not in ITEM_KINDS")
        mod.build()
        obj = lib.join(name, getattr(mod, "SMOOTH_ANGLE", 35))
        baked = lib.bake_all(obj, out_dir, name)
        dims = lib.place_origin(obj, getattr(mod, "ORIGIN", "center" if item else "bottom"))
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(out_dir, "raw.glb"), export_format="GLB", export_yup=True,
            export_apply=True, export_tangents=True, export_materials="EXPORT",
            export_image_format="AUTO", export_animations=False, export_extras=False,
        )
        result[name] = {
            "out": getattr(mod, "OUT", f"models/props/{name}.glb"),
            "item": item,
            "tris": lib.triangles(obj),
            "budget": getattr(mod, "TRIS", None),
            "dims": dims,
            "materials": [s.material.name for s in obj.material_slots if s.material],
            "baked": baked,
        }
    except Exception:
        for line in traceback.format_exc().splitlines():
            print("MODEL", name, line)
        result[name] = {"error": True}

json.dump(result, open(os.path.join(work, "built.json"), "w"))
