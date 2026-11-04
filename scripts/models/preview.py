"""
Run by index.ts inside Blender: renders a finished .glb from four sides, under a studio light, as
front.png, side.png, three-quarter.png and back.png. Arguments after --: the .glb, the folder.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

glb, out_dir = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
scene = bpy.context.scene

corners = [
    o.matrix_world @ Vector(c) for o in scene.objects if o.type == "MESH" for c in o.bound_box
]
lo = Vector(min(c[i] for c in corners) for i in range(3))
hi = Vector(max(c[i] for c in corners) for i in range(3))
centre = (lo + hi) / 2
size = hi - lo
radius = size.length / 2

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
camera.data.clip_start = radius / 100
camera.data.clip_end = radius * 100

scene.render.engine = "BLENDER_EEVEE"
scene.eevee.taa_render_samples = 32
scene.render.resolution_x = scene.render.resolution_y = 640
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"

# Name, direction from the model to the camera, orthographic or not.
VIEWS = [
    ("front", (0, -1, 0), True),
    ("side", (1, 0, 0), True),
    ("three-quarter", (0.8, -1, 0.6), False),
    ("back", (-0.8, 1, 0.5), False),
]
for name, direction, ortho in VIEWS:
    d = Vector(direction).normalized()
    cam = camera.data
    if ortho:
        cam.type = "ORTHO"
        across = size.y if abs(d.x) > 0.5 else size.x
        cam.ortho_scale = max(across, size.z) * 1.12
        distance = radius * 4
    else:
        cam.type = "PERSP"
        cam.lens = 50
        distance = radius / math.sin(cam.angle / 2) * 1.02
    camera.location = centre + d * distance
    camera.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out_dir, f"{name}.png")
    bpy.ops.render.render(write_still=True)
