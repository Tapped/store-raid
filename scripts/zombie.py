"""
Puts the zombie together from its two Meshy models, run in Blender by `pnpm run zombie`
(scripts/zombie.ts), which passes the folder they're in and the .glb to write after `--`.

Meshy makes each model about 1.9 units tall, whatever it is, so the headless body and the head (a
bust with a ragged neck) come at the same height. The body is scaled so its neck stump stands
STUMP_TOP m off the ground, with its feet on the ground and its middle over the origin; the head so
it's HEAD_HEIGHT m from the bottom of its neck to its crown, which puts its neck as wide as the
stump's top. Its neck goes SINK m down into the stump, centred on it, leaning forward by LEAN.

Both face Blender's -y (the game's +z, as glTF has it). They're joined into one mesh with a
material each, origin on the ground under its middle, textures at TEXTURE pixels on a side.
"""

import glob
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

STUMP_TOP = 1.52
HEAD_HEIGHT = 0.34
SINK = 0.12
LEAN = math.radians(8)
TEXTURE = 2048

args = sys.argv[sys.argv.index("--") + 1 :]
RAW, OUT = args[0], args[1]


def load(pattern):
    """The one mesh of the .glb in RAW whose name has this in it, its transform applied."""
    (path,) = glob.glob(os.path.join(RAW, f"*{pattern}*.glb"))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    (mesh,) = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    mesh.name = pattern.lower()
    mesh.data.transform(mesh.matrix_world)
    mesh.matrix_world = Matrix.Identity(4)
    return mesh


def points(mesh):
    return [v.co for v in mesh.data.vertices]


def span(pts, low, high):
    """The bounding box in x and y of the points from height low to high: its centre and size."""
    s = [p for p in pts if low <= p.z <= high]
    lo = Vector((min(p.x for p in s), min(p.y for p in s)))
    hi = Vector((max(p.x for p in s), max(p.y for p in s)))
    return (lo + hi) / 2, hi - lo


def place(mesh, matrix):
    mesh.data.transform(matrix)


bpy.ops.wm.read_factory_settings(use_empty=True)
body = load("Body")
head = load("Head")

# The body: feet on the ground, the stump's top at STUMP_TOP, centred over the origin.
pts = points(body)
bottom, top = min(p.z for p in pts), max(p.z for p in pts)
scale = STUMP_TOP / (top - bottom)
middle, _ = span(pts, bottom, top)
place(body, Matrix.Scale(scale, 4) @ Matrix.Translation((-middle.x, -middle.y, -bottom)))
pts = points(body)
stump, stump_size = span(pts, STUMP_TOP - 0.03, STUMP_TOP)

# The head: HEAD_HEIGHT from neck to crown, the neck's middle on the stump's, leaning forward.
pts = points(head)
bottom, top = min(p.z for p in pts), max(p.z for p in pts)
height = top - bottom
neck, _ = span(pts, bottom + 0.1 * height, bottom + 0.2 * height)
scale = HEAD_HEIGHT / height
place(
    head,
    Matrix.Translation((stump.x, stump.y, STUMP_TOP - SINK))
    @ Matrix.Rotation(-LEAN, 4, "X")
    @ Matrix.Scale(scale, 4)
    @ Matrix.Translation((-neck.x, -neck.y, -bottom)),
)
pts = points(head)
low = min(p.z for p in pts)
_, neck_size = span(pts, low + 0.15 * HEAD_HEIGHT, low + 0.25 * HEAD_HEIGHT)
print(f"zombie: stump {stump_size.x:.3f} x {stump_size.y:.3f} m, neck {neck_size.x:.3f} x {neck_size.y:.3f} m")
print(f"zombie: {max(p.z for p in pts):.3f} m tall")

for image in bpy.data.images:
    if image.size[0] > TEXTURE:
        image.scale(TEXTURE, TEXTURE)

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
head.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = "zombie"
for material in body.data.materials:
    material.name = "zombie-" + ("head" if material.name.endswith(".001") else "body")

if "--preview" in args:
    # Renders it from the front and the side next to OUT, to look at, and writes nothing else.
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 900
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 3
    scene.world = world
    camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    camera.data.type = "ORTHO"
    scene.collection.objects.link(camera)
    scene.camera = camera
    for name, frame, at, turn in [
        ("front", 2.0, (0, -5, 0.95), (math.pi / 2, 0, 0)),
        ("side", 2.0, (5, 0, 0.95), (math.pi / 2, 0, math.pi / 2)),
        ("neck", 0.6, (3.5, -3.5, 1.5), (math.pi / 2, 0, math.pi / 4)),
    ]:
        camera.data.ortho_scale = frame
        camera.location = at
        camera.rotation_euler = turn
        scene.render.filepath = f"{OUT}-{name}.png"
        bpy.ops.render.render(write_still=True)
    sys.exit(0)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format="GLB", export_yup=True)
print(f"zombie: wrote {OUT}")
