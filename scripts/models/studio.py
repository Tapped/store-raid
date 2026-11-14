"""
The preview's studio: renders whatever meshes are in the scene from a few sides, under a studio
light, one PNG per view, for index.ts to lay out as a contact sheet. pipeline.py uses it on a
finished .glb, and on the live scene for a draft, whose procedural materials Cycles renders as they
are, unbaked.
"""

import math
import os
import re

import bpy
from mathutils import Vector

import lib

# Name: direction from the subject to the camera, orthographic or not.
VIEWS = {
    "front": ((0, -1, 0), True),
    "side": ((1, 0, 0), True),
    "three-quarter": ((0.8, -1, 0.6), False),
    "back": ((-0.8, 1, 0.5), False),
    "left": ((-1, 0, 0), True),
    "rear": ((0, 1, 0), True),
    "top": ((0, 0, 1), True),
    "below": ((0.3, -0.5, -1), False),
}
DEFAULT_VIEWS = ["front", "side", "three-quarter", "back"]
TILE = 640


def occlusion_into_colour():
    """
    Blender's renderer ignores glTF occlusion, which the game darkens most light with, so multiply
    it into the colour of every material imported from a .glb.
    """
    for mat in bpy.data.materials:
        tree = mat.node_tree
        if tree is None:
            continue
        group = next(
            (n for n in tree.nodes if n.type == "GROUP" and "Occlusion" in n.inputs
             and n.inputs["Occlusion"].is_linked),
            None,
        )
        bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if group is None or bsdf is None:
            continue
        base = bsdf.inputs["Base Color"]
        mix = tree.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1
        if base.is_linked:
            tree.links.new(base.links[0].from_socket, mix.inputs["A"])
        else:
            mix.inputs["A"].default_value = base.default_value
        tree.links.new(group.inputs["Occlusion"].links[0].from_socket, mix.inputs["B"])
        tree.links.new(mix.outputs["Result"], base)


def _meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def _bounds(points):
    lo = Vector(min(p[i] for p in points) for i in range(3))
    hi = Vector(max(p[i] for p in points) for i in range(3))
    return lo, hi


def focus_box(spec, offset):
    """
    The box a close-up frames. `spec` is "x,y,z" or "x,y,z,r" (meters in the script's own axes, a
    box r across each way, default 0.5) or the name of a material (exact, else the only one whose
    name contains it), whose faces it frames. `offset` is how far place_origin moved the mesh.
    """
    numbers = re.fullmatch(r"\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(?:,\s*([\d.]+))?\s*", spec)
    if numbers:
        x, y, z, r = numbers.groups()
        centre = Vector((float(x), float(y), float(z))) + Vector(offset)
        half = Vector([float(r or 0.5)] * 3)
        return centre - half, centre + half
    names = sorted({s.material.name for o in _meshes() for s in o.material_slots if s.material})
    match = [n for n in names if n == spec] or [n for n in names if spec.lower() in n.lower()]
    if len(match) != 1:
        found = "several match" if match else "none matches"
        raise ValueError(f"--focus {spec!r}: {found}. Materials: {', '.join(names) or 'none'}")
    points = []
    for o in _meshes():
        slots = {i for i, s in enumerate(o.material_slots) if s.material and s.material.name == match[0]}
        verts = o.data.vertices
        for p in o.data.polygons:
            if p.material_index in slots:
                points.extend(o.matrix_world @ verts[v].co for v in p.vertices)
    return _bounds(points)


def render(out_dir, views=None, focus=None, samples=32):
    """Render each view to <out_dir>/<view>.png, framing the whole model or the `focus` box."""
    views = views or DEFAULT_VIEWS
    unknown = [v for v in views if v not in VIEWS]
    if unknown:
        raise ValueError(f"no view {', '.join(unknown)}: the views are {', '.join(VIEWS)}")
    scene = bpy.context.scene
    corners = [o.matrix_world @ Vector(c) for o in _meshes() for c in o.bound_box]
    if not corners:
        raise RuntimeError("nothing to render")
    lo, hi = _bounds(corners)
    model_radius = (hi - lo).length / 2
    # A ceiling fitting hangs from its origin and is seen from below, so look up at its back.
    hanging = abs(hi.z) < 0.005 and lo.z < -0.01
    if focus is not None:
        lo, hi = focus
    centre = (lo + hi) / 2
    size = hi - lo
    radius = max(size.length / 2, 0.01)

    world = bpy.data.worlds.new("studio")
    scene.world = world
    world.use_nodes = True
    env = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(
        os.path.join(bpy.utils.system_resource("DATAFILES", path="studiolights/world"), "studio.exr")
    )
    world.node_tree.links.new(env.outputs["Color"], world.node_tree.nodes["Background"].inputs["Color"])

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.5
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)

    camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera

    # Cycles, not EEVEE: EEVEE's shadows leak light in jagged teeth across faces turned from the sun.
    print("MODEL preview renders on", lib.cycles(scene))
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    # Alpha-tested foliage stacks many cards: with the default 8 bounces the deepest turn black.
    scene.cycles.transparent_max_bounces = 64
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"

    os.makedirs(out_dir, exist_ok=True)
    for name in views:
        direction, ortho = VIEWS[name]
        if name == "back" and hanging:
            direction = (-0.8, 1, -0.6)
        d = Vector(direction).normalized()
        cam = camera.data
        rotation = (-d).to_track_quat("-Z", "Y")
        if ortho:
            cam.type = "ORTHO"
            # As wide as the subject's box seen from this side, with a margin.
            right, up = rotation @ Vector((1, 0, 0)), rotation @ Vector((0, 1, 0))
            box = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
            across = max(max(abs((c - centre).dot(right)) for c in box),
                         max(abs((c - centre).dot(up)) for c in box)) * 2
            cam.ortho_scale = max(across, 0.01) * 1.12
            # From outside the whole model, so nothing of it is cut away.
            distance = max(radius, model_radius) * 4
        else:
            cam.type = "PERSP"
            cam.lens = 50
            distance = radius / math.sin(cam.angle / 2) * 1.02
        cam.clip_start = min(radius, model_radius) / 100
        cam.clip_end = (distance + model_radius) * 4
        camera.location = centre + d * distance
        camera.rotation_euler = rotation.to_euler()
        scene.render.filepath = os.path.join(out_dir, f"{name}.png")
        bpy.ops.render.render(write_still=True)
