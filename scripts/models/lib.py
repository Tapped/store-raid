"""
Helpers for model scripts, run inside Blender by build.py.

A model script defines build(), which makes objects in the empty scene with these helpers or plain
bpy. build.py then joins them into one mesh, smooths it, bakes procedural materials into textures,
moves the origin and exports it. Conventions, in Blender's axes:

- Meters. x is right, y is back, z is up: the model's front faces -y, as in Blender's front view.
  In the game that front faces +z.
- Objects are made at their final size in their mesh data, with no object scale.
- Procedural materials (procedural()) see the coordinates the script built in, through
  Nodes.coord(), so patterns can be placed in meters.

Optional constants in a model script:

  ITEM = "tv"            a game item: its size comes from ITEM_KINDS, and the model must match it
  OUT = "models/props/x.glb"   under assets/; default models/props/<name>.glb
  ORIGIN = "bottom"      "bottom" (centre of the base) or "center"; items default to "center"
  TRIS = 3000            triangle budget, warned about when over
  SMOOTH_ANGLE = 35      faces meeting at less than this many degrees are shaded smooth
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# Item sizes from shared/constants.ts, as game (width, height, depth); build.py fills this in.
ITEMS = {}


def item_size(kind):
    """An item's size in Blender axes: (x, y, z) = (width, depth, height)."""
    w, h, d = ITEMS[kind]
    return w, d, h


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _mesh_object(name, bm):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return _link(bpy.data.objects.new(name, mesh))


def _bevel(obj, width, segments):
    if width > 0:
        m = obj.modifiers.new("bevel", "BEVEL")
        m.width = width
        m.segments = segments
        m.limit_method = "ANGLE"
        m.use_clamp_overlap = True
    return obj


def box(name, size, at=(0, 0, 0), mat=None, bevel=0.0, segments=2):
    """A box of size (x, y, z) centred on `at`, with rounded edges if bevel > 0."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1, calc_uvs=True)
    bmesh.ops.transform(bm, matrix=Matrix.Diagonal((*size, 1)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    return assign(_bevel(_mesh_object(name, bm), bevel, segments), mat)


def cylinder(name, radius, depth, at=(0, 0, 0), axis="z", mat=None, sides=24, bevel=0.0):
    """A cylinder along `axis` ("x", "y" or "z"), centred on `at`."""
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=sides, radius1=radius, radius2=radius, depth=depth,
        calc_uvs=True,
    )
    turn = {"x": Matrix.Rotation(math.pi / 2, 4, "Y"), "y": Matrix.Rotation(math.pi / 2, 4, "X")}
    if axis in turn:
        bmesh.ops.transform(bm, matrix=turn[axis], verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    return assign(_bevel(_mesh_object(name, bm), bevel, 1), mat)


def text(name, body, size, at=(0, 0, 0), depth=0.001, mat=None, facing="-y"):
    """Raised letters centred on `at`, readable from `facing` ("-y" is the front, "y" the back)."""
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = size
    curve.extrude = depth / 2
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.resolution_u = 3
    obj = _link(bpy.data.objects.new(name, curve))
    obj.rotation_euler = (math.pi / 2, 0, math.pi if facing == "y" else 0)
    obj.location = at
    return assign(obj, mat)


def assign(obj, mat):
    if mat is not None:
        obj.data.materials.append(mat)
    return obj


def material(name, color, roughness=0.5, metallic=0.0, emission=None, strength=1.0):
    """A plain material: `color` and `emission` are linear RGB."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def procedural(name, size=512):
    """A material to build from shader nodes, baked into size × size textures when exported."""
    mat = material(name, (0.5, 0.5, 0.5))
    mat["bake"] = size
    return mat, Nodes(mat)


class Nodes:
    """Shorthand for building a material's shader nodes. Inputs take a socket or a value."""

    def __init__(self, mat):
        self.tree = mat.node_tree
        self.bsdf = self.tree.nodes["Principled BSDF"]

    def add(self, kind, inputs=None, **props):
        node = self.tree.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        for k, v in (inputs or {}).items():
            self.set(node.inputs[k], v)
        return node

    def set(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.tree.links.new(value, socket)
        elif isinstance(value, (tuple, list)) and len(value) == 3 and socket.type == "RGBA":
            socket.default_value = (*value, 1)
        else:
            socket.default_value = value

    def out(self, **inputs):
        """Connect the Principled BSDF's inputs, e.g. out(**{"Base Color": c, "Roughness": r})."""
        for k, v in inputs.items():
            self.set(self.bsdf.inputs[k], v)

    def coord(self):
        """Position in meters, in the coordinates the model was built in."""
        return self.add("ShaderNodeTexCoord").outputs["Object"]

    def xyz(self, vector=None):
        node = self.add("ShaderNodeSeparateXYZ", {"Vector": vector or self.coord()})
        return node.outputs["X"], node.outputs["Y"], node.outputs["Z"]

    def math(self, op, a, b=0.0, clamp=False):
        node = self.add("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(node.inputs[0], a)
        self.set(node.inputs[1], b)
        return node.outputs[0]

    def noise(self, scale, detail=4.0, roughness=0.5, vector=None):
        """Noise from 0 to 1, about 0.5 on average, with features 1/scale meters across."""
        node = self.add(
            "ShaderNodeTexNoise",
            {"Vector": vector or self.coord(), "Scale": scale, "Detail": detail,
             "Roughness": roughness},
        )
        return node.outputs["Fac"]

    def mix(self, fac, a, b):
        """Colour a where fac is 0, b where it's 1."""
        node = self.add("ShaderNodeMix", data_type="RGBA")
        self.set(node.inputs["Factor"], fac)
        self.set(node.inputs["A"], a)
        self.set(node.inputs["B"], b)
        return node.outputs["Result"]

    def lerp(self, fac, a, b):
        """Number a where fac is 0, b where it's 1."""
        node = self.add("ShaderNodeMix", data_type="FLOAT")
        self.set(node.inputs["Factor"], fac)
        self.set(node.inputs["A"], a)
        self.set(node.inputs["B"], b)
        return node.outputs["Result"]

    def inside(self, value, lo, hi):
        """1 where lo <= value < hi, else 0."""
        return self.math(
            "MULTIPLY", self.math("GREATER_THAN", value, lo), self.math("LESS_THAN", value, hi)
        )

    def region(self, lo, hi, vector=None):
        """1 inside the box from lo to hi, (x, y, z) in meters; None leaves an axis open."""
        result = 1.0
        for axis, a, b in zip(self.xyz(vector), lo, hi):
            if a is None:
                continue
            result = self.math("MULTIPLY", result, self.inside(axis, a, b))
        return result

    def stripes(self, value, period, duty=0.5):
        """1 for the first `duty` of every `period` meters of value, else 0."""
        phase = self.math("FRACT", self.math("DIVIDE", value, period))
        return self.math("LESS_THAN", phase, duty)

    def bump(self, height, strength=1.0, distance=0.002):
        """A normal from a height of 0 to 1, `distance` meters at full height."""
        node = self.add(
            "ShaderNodeBump", {"Height": height, "Strength": strength, "Distance": distance}
        )
        return node.outputs["Normal"]


# Called by build.py once build() has run.


def _select(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join(name, smooth_angle):
    """Every object as one mesh at the world origin, modifiers applied and smoothed by angle."""
    objs = [o for o in bpy.context.scene.objects if o.type in {"MESH", "FONT", "CURVE"}]
    if not objs:
        raise RuntimeError("build() made no meshes")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = name
    for o in list(bpy.context.scene.objects):
        if o is not obj:
            bpy.data.objects.remove(o)
    _select(obj)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle), keep_sharp_edges=True)
    while len(obj.data.uv_layers) > 1:
        obj.data.uv_layers.remove(obj.data.uv_layers[-1])
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name="UVMap")
    return obj


def bake_all(obj, work, model):
    """Bake every procedural material on obj into textures. Returns their names and sizes."""
    baked = []
    for i, slot in enumerate(obj.material_slots):
        mat = slot.material
        if mat is not None and "bake" in mat:
            size = int(mat["bake"])
            _bake(obj, i, size, work, model)
            baked.append({"material": mat.name, "size": size})
    return baked


def _bake(obj, index, size, work, model):
    mat = obj.material_slots[index].material
    scene = bpy.context.scene

    # Its faces get their own UV layout, filling the texture.
    _select(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")
    obj.active_material_index = index
    bpy.ops.object.material_slot_select()
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Baked on a copy holding only those faces, so other materials need no image.
    tmp = obj.copy()
    tmp.data = obj.data.copy()
    _link(tmp)
    bm = bmesh.new()
    bm.from_mesh(tmp.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != index], context="FACES")
    for f in bm.faces:
        f.material_index = 0
    bm.to_mesh(tmp.data)
    bm.free()
    tmp.data.materials.clear()
    tmp.data.materials.append(mat)
    _select(tmp)

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.render.bake.margin = max(2, size // 128)
    tree = mat.node_tree
    target = tree.nodes.new("ShaderNodeTexImage")
    tree.nodes.active = target
    images = {}
    for kind, bake_type, data in (
        ("base", "DIFFUSE", False),
        ("rough", "ROUGHNESS", True),
        ("normal", "NORMAL", True),
    ):
        image = bpy.data.images.new(f"{model}-{mat.name}-{kind}", size, size, is_data=data)
        target.image = image
        bpy.ops.object.bake(
            type=bake_type,
            pass_filter={"COLOR"} if bake_type == "DIFFUSE" else set(),
            normal_space="TANGENT",
            use_clear=True,
        )
        image.filepath_raw = f"{work}/{image.name}.png"
        image.file_format = "PNG"
        image.save()
        images[kind] = image
    bpy.data.objects.remove(tmp)

    # The material becomes the textures, keeping its plain metallic and emission.
    bsdf = tree.nodes["Principled BSDF"]
    keep = {
        k: bsdf.inputs[k].default_value[:] if hasattr(bsdf.inputs[k].default_value, "__len__")
        else bsdf.inputs[k].default_value
        for k in ("Metallic", "Emission Color", "Emission Strength")
    }
    tree.nodes.clear()
    n = Nodes.__new__(Nodes)
    n.tree = tree
    out = n.add("ShaderNodeOutputMaterial")
    n.bsdf = n.add("ShaderNodeBsdfPrincipled")
    tree.links.new(n.bsdf.outputs["BSDF"], out.inputs["Surface"])
    for k, v in keep.items():
        n.bsdf.inputs[k].default_value = v
    base = n.add("ShaderNodeTexImage", image=images["base"])
    rough = n.add("ShaderNodeTexImage", image=images["rough"])
    normal = n.add("ShaderNodeTexImage", image=images["normal"])
    green = n.add("ShaderNodeSeparateColor", {"Color": rough.outputs["Color"]})
    normal_map = n.add("ShaderNodeNormalMap", {"Color": normal.outputs["Color"]})
    n.out(**{
        "Base Color": base.outputs["Color"],
        "Roughness": green.outputs["Green"],
        "Normal": normal_map.outputs["Normal"],
    })
    del mat["bake"]


def place_origin(obj, origin):
    """Move the mesh so the origin is at the centre of its base, or of its bounds."""
    corners = [Vector(c) for c in obj.bound_box]
    lo = Vector(min(c[i] for c in corners) for i in range(3))
    hi = Vector(max(c[i] for c in corners) for i in range(3))
    centre = (lo + hi) / 2
    if origin == "bottom":
        centre.z = lo.z
    elif origin != "center":
        raise ValueError(f'ORIGIN must be "bottom" or "center", not {origin!r}')
    obj.data.transform(Matrix.Translation(-centre))
    return [round(v, 4) for v in hi - lo]


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)
