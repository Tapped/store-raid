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
  ORIGIN = "bottom"      "bottom" (centre of the base), "center", or "model" (where the script built
                         it); items default to "center"
  TRIS = 3000            triangle budget, warned about when over
  ATLAS = 4096           scenery only (props and village models): the most pixels on a side of the
                         atlases its parts are merged over, default 2048; 0 leaves its parts apart
  SMOOTH_ANGLE = 35      faces meeting at less than this many degrees are shaded smooth
  AO = 512               baked ambient occlusion texture size; 0 bakes none
  AO_DISTANCE = 0.3      meters a crease can be across and still darken

A model that moves declares bones with bone() and binds parts to them with bind(), or passes
bone= to jointed(); build.py then adds the armature and exports the mesh skinned to it. Weights are
rigid, one bone per vertex except where segments of a limb meet: shells and machines, not skin.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# Item sizes from shared/constants.ts, as game (width, height, depth); build.py fills this in.
ITEMS = {}

# Bones declared by the script, in order: (name, head, tail, parent name or None).
BONES = []


def item_size(kind):
    """An item's size in Blender axes: (x, y, z) = (width, depth, height)."""
    w, h, d = ITEMS[kind]
    return w, d, h


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    BONES.clear()


def cycles(scene=None):
    """
    Switch the scene to Cycles, on the GPU when Blender finds one (OptiX, CUDA, HIP, oneAPI or
    Metal), else the CPU. Returns what it runs on. Factory settings start without a GPU chosen,
    so every run looks again.
    """
    scene = scene or bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue  # not built into this Blender
        prefs.refresh_devices()
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            return f"{kind}: {', '.join(d.name for d in gpus)}"
    prefs.compute_device_type = "NONE"
    scene.cycles.device = "CPU"
    return "CPU"


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


_TURNS = {"-y": 0, "x": math.pi / 2, "y": math.pi, "-x": -math.pi / 2}


def _facing(facing):
    """Turns a flat thing drawn in x (right) and y (up), facing +z, to face `facing`."""
    if facing == "z":
        return Matrix.Identity(4)
    if facing not in _TURNS:
        raise ValueError(f'facing must be "-y", "y", "x", "-x" or "z", not {facing!r}')
    return Matrix.Rotation(_TURNS[facing], 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")


def text(name, body, size, at=(0, 0, 0), depth=0.001, mat=None, facing="-y"):
    """
    Raised letters centred on `at`, readable from `facing`: "-y" (the front), "y", "x", "-x" or
    "z" (from above, top of the letters towards +y).
    """
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = size
    curve.extrude = depth / 2
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.resolution_u = 3
    obj = _link(bpy.data.objects.new(name, curve))
    obj.matrix_world = Matrix.Translation(Vector(at)) @ _facing(facing)
    return assign(obj, mat)


def shape(name, points, at=(0, 0, 0), depth=0.001, mat=None, facing="-y"):
    """
    A flat outline, raised `depth` meters, such as an arrow or a sign. `points` go round it as
    (right, up) in meters from `at`, as seen from `facing` (see text()).
    """
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((u, v, -depth / 2)) for u, v in points])
    top = bmesh.ops.extrude_face_region(bm, geom=[face])["geom"]
    bmesh.ops.translate(
        bm, vec=(0, 0, depth), verts=[g for g in top if isinstance(g, bmesh.types.BMVert)]
    )
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(at)) @ _facing(facing), verts=bm.verts)
    return assign(_mesh_object(name, bm), mat)


def ellipsoid(name, half, at=(0, 0, 0), mat=None, segments=24, rings=16, poles="z", deform=None):
    """
    A smooth blob: a sphere `half` = (x, y, z) half sizes across, centred on `at`. `poles` is the
    axis its rings run around: put it along the length of a long body, so there are rings where
    you shape it. `deform(p)` can move each point instead of the plain scale: it gets the point on
    a unit sphere and returns it in meters from `at`, e.g. to make an egg or pinch in grooves.
    """
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1)
    turn = {"x": Matrix.Rotation(math.pi / 2, 3, "Y"), "y": Matrix.Rotation(math.pi / 2, 3, "X")}
    if poles in turn:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=turn[poles])
    at, half = Vector(at), Vector(half)
    for v in bm.verts:
        p = deform(v.co.copy()) if deform else v.co * half
        v.co = Vector(p) + at
    return assign(_mesh_object(name, bm), mat)


def tube(name, points, radii, mat=None, sides=8, weights=None):
    """
    A tube through `points` (in meters), `radii[i]` thick at each, closed at both ends: tentacles,
    pipes, cables, horns. A radius near 0 at the end makes a point, such as a claw or a barb.
    `weights[i]`, if given, is {bone: weight} for the ring at point i; each end cap goes with its ring.
    """
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    rings = []
    normal = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if normal is None:
            normal = t.cross(Vector((0, 0, 1)))
            if normal.length < 1e-4:
                normal = t.cross(Vector((1, 0, 0)))
        # Carry the ring's orientation along the tube, so it doesn't twist.
        normal = (normal - t * normal.dot(t)).normalized()
        binormal = t.cross(normal)
        rings.append([
            bm.verts.new(p + radii[i] * (math.cos(a) * normal + math.sin(a) * binormal))
            for a in (2 * math.pi * s / sides for s in range(sides))
        ])
    for a, b in zip(rings, rings[1:]):
        for s in range(sides):
            bm.faces.new((a[s], a[(s + 1) % sides], b[(s + 1) % sides], b[s]))
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        tip = bm.verts.new(sum((v.co for v in ring), Vector()) / sides)
        for s in range(sides):
            face = (ring[s], ring[(s + 1) % sides], tip)
            bm.faces.new(face[::-1] if flip else face)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Vertex indices: the rings in order, then the two cap tips.
    ring_of = [i for i in range(len(pts)) for _ in range(sides)] + [0, len(pts) - 1]
    obj = assign(_mesh_object(name, bm), mat)
    if weights:
        for index, ring in enumerate(ring_of):
            for bone_name, weight in weights[ring].items():
                _group(obj, bone_name).add([index], weight, "REPLACE")
    return obj


def lathe(name, profile, at=(0, 0, 0), axis="z", mat=None, sides=24):
    """
    A turned shape, like a bottle, a knob or a torch: `profile` is (along, radius) pairs in meters,
    in order along its outline, turned round `axis` through `at`. The outline may double back (a
    lip folding in round a lens); each end with a radius above 0 is closed flat.
    """
    bm = bmesh.new()
    turn = {
        "x": Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))),
        "y": Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0))),
        "z": Matrix.Identity(3),
    }[axis]
    at = Vector(at)
    rings = [
        [
            bm.verts.new(at + turn @ Vector((r * math.cos(a), r * math.sin(a), t)))
            for a in (2 * math.pi * s / sides for s in range(sides))
        ]
        for t, r in profile
    ]
    for a, b in zip(rings, rings[1:]):
        for s in range(sides):
            bm.faces.new((a[s], a[(s + 1) % sides], b[(s + 1) % sides], b[s]))
    for ring, (_, r) in ((rings[0], profile[0]), (rings[-1], profile[-1])):
        if r > 1e-6:
            bm.faces.new(ring)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return assign(_mesh_object(name, bm), mat)


def jointed(name, joints, radii, mat=None, sides=8, bone=None, parent=None):
    """
    A jointed limb through `joints`, segment i `radii[i]` thick, swelling a little in the middle
    of each segment and pinched at the joints, so the segments read as separate pieces of shell:
    insect and spider legs, antennae, robot arms. The last segment tapers to a point.

    With `bone`, the limb gets a bone per segment, "<bone>.0" onwards from joints[i] to
    joints[i + 1], each the child of the one before and the first the child of `parent`, plus a
    "<bone>.tip" at the last joint that moves nothing but tells the game where the limb ends.
    """
    points, widths, weights = [], [], []
    names = [f"{bone}.{i}" for i in range(len(joints) - 1)]
    for i, (a, b) in enumerate(zip(joints, joints[1:])):
        a, b = Vector(a), Vector(b)
        r = radii[i]
        if i == 0:
            points.append(a)
            widths.append(r * 0.9)
            weights.append({names[0]: 1.0})
        for t, k in ((0.18, 1.0), (0.55, 1.08), (0.85, 0.95)):
            points.append(a.lerp(b, t))
            widths.append(r * k)
            weights.append({names[i]: 1.0})
        points.append(b)
        widths.append(min(r, radii[i + 1] if i + 1 < len(radii) else r * 0.4) * 0.75)
        # The pinch at a joint bends with both segments.
        last = i + 1 == len(names)
        weights.append({names[i]: 1.0} if last else {names[i]: 0.5, names[i + 1]: 0.5})
    if bone is None:
        return tube(name, points, widths, mat, sides)
    for i, n in enumerate(names):
        BONES.append((n, Vector(joints[i]), Vector(joints[i + 1]), names[i - 1] if i else parent))
    end = Vector(joints[-1])
    BONES.append((f"{bone}.tip", end, end + (end - Vector(joints[-2])).normalized() * 0.01, names[-1]))
    return tube(name, points, widths, mat, sides, weights)


def bone(name, head, tail, parent=None):
    """Declare a bone from `head` to `tail` (meters), the child of bone `parent`. Returns its name."""
    BONES.append((name, Vector(head), Vector(tail), parent))
    return name


def bind(obj, bone_name):
    """Make the whole of `obj` move with one bone."""
    _group(obj, bone_name).add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    return obj


def _group(obj, name):
    return obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)


def rig(obj, offset):
    """
    Build the armature from BONES, moved by `offset` as place_origin() moved the mesh, and skin obj
    to it through the vertex groups that bind() and jointed() made, one per bone.
    """
    data = bpy.data.armatures.new("rig")
    arm = _link(bpy.data.objects.new("rig", data))
    _select(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, head, tail, parent in BONES:
        eb = data.edit_bones.new(name)
        eb.head, eb.tail = head + offset, tail + offset
        if parent is not None:
            eb.parent = data.edit_bones[parent]
        eb.use_deform = not name.endswith(".tip")
    bpy.ops.object.mode_set(mode="OBJECT")
    unbound = {g.name for g in obj.vertex_groups} - {b[0] for b in BONES}
    if unbound:
        raise ValueError(f"vertex groups without a bone: {sorted(unbound)}")
    loose = sum(1 for v in obj.data.vertices if not v.groups)
    if loose:
        raise ValueError(f"{loose} vertices are bound to no bone: bind() every part")
    obj.parent = arm
    obj.modifiers.new("rig", "ARMATURE").object = arm
    return arm


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

    def vec(self, x=0.0, y=0.0, z=0.0):
        """A vector from three numbers or sockets."""
        return self.add("ShaderNodeCombineXYZ", {"X": x, "Y": y, "Z": z}).outputs["Vector"]

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


def _unwrap(margin):
    """
    Lay out the selected faces in the texture, none overlapping. Smart projection alone stacks
    parts that face the same way on top of each other, like letters on the face behind them.
    """
    # With UV sync selection, on by default, packing works around every other face's UVs too.
    bpy.context.scene.tool_settings.use_uv_select_sync = False
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)


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
    _unwrap(0.004)
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

    cycles(scene)
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
    # Named, or the exporter can't tell which UV layout to use once bake_ao adds a second.
    uv = n.add("ShaderNodeUVMap", uv_map=obj.data.uv_layers[0].name).outputs["UV"]
    base = n.add("ShaderNodeTexImage", {"Vector": uv}, image=images["base"])
    rough = n.add("ShaderNodeTexImage", {"Vector": uv}, image=images["rough"])
    normal = n.add("ShaderNodeTexImage", {"Vector": uv}, image=images["normal"])
    normal_map_uv = obj.data.uv_layers[0].name
    green = n.add("ShaderNodeSeparateColor", {"Color": rough.outputs["Color"]})
    normal_map = n.add(
        "ShaderNodeNormalMap", {"Color": normal.outputs["Color"]}, uv_map=normal_map_uv
    )
    n.out(**{
        "Base Color": base.outputs["Color"],
        "Roughness": green.outputs["Green"],
        "Normal": normal_map.outputs["Normal"],
    })
    del mat["bake"]


def bake_ao(obj, size, distance, work):
    """
    Bake how much of the sky each point of the model sees, rays reaching `distance` meters, into
    <work>/ao.png on a second UV layout, "AO", of the whole model. It's the model's own shading,
    so it moves with it; index.ts makes it the glTF occlusion texture of every material.
    """
    mesh = obj.data
    # By name: adding a layer can move the others, leaving a reference to one dangling.
    main = mesh.uv_layers.active.name
    ao = mesh.uv_layers.new(name="AO")
    mesh.uv_layers.active = ao
    _select(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    _unwrap(0.02)
    bpy.ops.object.mode_set(mode="OBJECT")

    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake")
    scene.world.light_settings.distance = distance
    print("MODEL", obj.name, "bakes ambient occlusion on", cycles(scene))
    scene.cycles.samples = 128
    scene.render.bake.margin = max(2, size // 128)

    # Unused texels stay white, unoccluded, so filtering never bleeds darkness into an island.
    image = bpy.data.images.new("ao", size, size, is_data=True)
    image.generated_color = (1, 1, 1, 1)
    targets = []
    for slot in obj.material_slots:
        tree = slot.material.node_tree
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        tree.nodes.active = node
        targets.append((tree, node))
    bpy.ops.object.bake(type="AO", use_clear=False)
    image.filepath_raw = f"{work}/ao.png"
    image.file_format = "PNG"
    image.save()
    for tree, node in targets:
        tree.nodes.remove(node)
    mesh.uv_layers.active = mesh.uv_layers[main]
    mesh.uv_layers[main].active_render = True


def place_origin(obj, origin):
    """
    Move the mesh so the origin is at the centre of its base or of its bounds, or leave it where
    the script built it ("model"), e.g. at a wrist or a hinge the game turns it around. Returns the
    size, and how far the mesh moved, which the bones must move too.
    """
    corners = [Vector(c) for c in obj.bound_box]
    lo = Vector(min(c[i] for c in corners) for i in range(3))
    hi = Vector(max(c[i] for c in corners) for i in range(3))
    centre = (lo + hi) / 2
    if origin == "bottom":
        centre.z = lo.z
    elif origin == "model":
        centre = Vector()
    elif origin != "center":
        raise ValueError(f'ORIGIN must be "bottom", "center" or "model", not {origin!r}')
    obj.data.transform(Matrix.Translation(-centre))
    return [round(v, 4) for v in hi - lo], -centre


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)



# Weathering: wear in layers for procedural() materials, after Saltline's METHOD.md, Part 2.
# Added for the building's fittings; each helper takes the material's Nodes.


def smoothstep(n, value, lo, hi):
    """0 below lo, 1 above hi, a smooth ramp between."""
    return n.add(
        "ShaderNodeMapRange", {"Value": value, "From Min": lo, "From Max": hi},
        interpolation_type="SMOOTHSTEP", clamp=True,
    ).outputs["Result"]


def shade(n, color, value):
    """`color` with its brightness multiplied by `value` (a number or a socket)."""
    return n.add(
        "ShaderNodeHueSaturation", {"Color": color, "Value": value, "Hue": 0.5, "Saturation": 1.0}
    ).outputs["Color"]


def edges(n, radius=0.004):
    """
    About 1 on the model's edges and corners, 0 on flat faces: where the Bevel node's rounded
    normal leaves the true one. Cycles only, which the bake is. Concave edges count too.
    """
    bevel = n.add("ShaderNodeBevel", {"Radius": radius}, samples=8).outputs["Normal"]
    geo = n.add("ShaderNodeNewGeometry").outputs["Normal"]
    dot = n.add("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    n.set(dot.inputs[0], bevel)
    n.set(dot.inputs[1], geo)
    return smoothstep(n, n.math("SUBTRACT", 1, dot.outputs["Value"]), 0.02, 0.2)


def crevices(n, distance=0.05):
    """About 1 deep in creases and corners `distance` meters across, 0 in the open (baked AO)."""
    ao = n.add("ShaderNodeAmbientOcclusion", {"Distance": distance}, samples=16, only_local=True)
    return n.math("SUBTRACT", 1, ao.outputs["AO"])


def facing_up(n):
    """The surface normal's up component: 1 on top faces, -1 underneath."""
    return n.xyz(n.add("ShaderNodeNewGeometry").outputs["Normal"])[2]


def _offset(n, dx=0.0, dy=0.0, dz=0.0):
    node = n.add("ShaderNodeVectorMath", operation="ADD")
    n.set(node.inputs[0], n.coord())
    node.inputs[1].default_value = (dx, dy, dz)
    return node.outputs["Vector"]


def _stretched(n, sx, sy, sz):
    node = n.add("ShaderNodeVectorMath", operation="MULTIPLY")
    n.set(node.inputs[0], n.coord())
    node.inputs[1].default_value = (sx, sy, sz)
    return node.outputs["Vector"]


def weathered(
    n, paint, *, rough=0.42, chips=0.5, rust=0.5, dirt=0.5, dust=0.5, edge_wear=0.5,
    dents=1.0, floor=None, bare=(0.3, 0.29, 0.28), primer=(0.2, 0.17, 0.12), height=None,
    bump=0.004, scale=1.0, seed=0.0,
):
    """
    Fifteen years of wear on painted metal (or plastic), as the outputs for n.out(**...):

    - the paint (a colour or a socket, so labels can be mixed into it first) varies in shade and
      roughness over the surface, with a fine orange peel and broad dents (`dents`);
    - chips cluster in a few patches and on edges (`chips`, `edge_wear`): primer round each one,
      bright steel in it, rust in the biggest (`rust`), and rust runs weeping down from them;
    - dirt gathers in creases, in vertical wash streaks and, given `floor` (z in meters), low down
      within half a meter of the floor (`dirt`);
    - dust lies on faces turned up (`dust`).

    `height` (a socket, 0 to 1) adds the model's own relief, such as seams, to the bump, which is
    `bump` meters deep at full height. `scale` stretches every pattern, `seed` moves them.
    """
    s = scale
    co = _offset(n, seed * 7.1, seed * 3.3, seed * 1.7)
    z = n.xyz()[2]

    macro = n.noise(2.5 / s, detail=3, vector=co)
    color = shade(n, paint, n.math("ADD", 0.85, n.math("MULTIPLY", macro, 0.3)))
    # Chalking: faded, a little lighter and greyer in broad patches.
    chalk = n.math("MULTIPLY", smoothstep(n, n.noise(1.2 / s, detail=2, vector=co), 0.5, 0.75), 0.35)
    color = n.mix(chalk, color, shade(n, n.mix(0.5, paint, (0.3, 0.3, 0.3)), 1.1))

    # Chips: flakes where noise peaks, more of them inside a few clustered patches and on edges.
    cluster = smoothstep(n, n.noise(1.6 / s, detail=4, vector=co), 0.48, 0.7)

    def flakes(dz=0.0):
        v = _offset(n, seed * 7.1, seed * 3.3, seed * 1.7 + dz) if dz else co
        return n.noise(22 / s, detail=6, roughness=0.62, vector=v)

    gate = n.math("SUBTRACT", 0.8, n.math("MULTIPLY", cluster, 0.44 * chips))
    over = n.math("SUBTRACT", flakes(), gate)
    edge = n.math(
        "MULTIPLY", edges(n),
        n.math("MULTIPLY", smoothstep(n, n.noise(45 / s, detail=4, vector=co), 0.45, 0.6),
               edge_wear),
    )
    chip = n.math("MAXIMUM", smoothstep(n, over, 0.0, 0.015), edge)
    halo = smoothstep(n, over, -0.03, -0.012)
    core = n.math("MINIMUM", n.math("MULTIPLY", smoothstep(n, over, 0.05, 0.07), rust * 2), 1.0)

    # Streaks stay a real size on small models, or they read as wood grain.
    ws = max(s, 0.8)
    # Rust runs: chips a little higher up weep down in streaks.
    streak = smoothstep(
        n, n.noise(1.0, detail=3, vector=_stretched(n, 90 / ws, 90 / ws, 1.5 / ws)), 0.5, 0.72
    )
    run = 0.0
    for i in range(1, 5):
        above = smoothstep(n, n.math("SUBTRACT", flakes(i * 0.025 * s), gate), 0.04, 0.08)
        run = n.math("MAXIMUM", run, n.math("MULTIPLY", above, 1 - i / 5))
    run = n.math("MULTIPLY", n.math("MULTIPLY", run, streak), rust)

    # Dirt: creases, vertical wash streaks, and low down.
    wash = smoothstep(
        n, n.noise(1.0, detail=4, vector=_stretched(n, 40 / ws, 40 / ws, 2 / ws)), 0.45, 0.75
    )
    grime = n.math("ADD", n.math("MULTIPLY", crevices(n), 1.4), n.math("MULTIPLY", wash, 0.35))
    if floor is not None:
        grime = n.math("ADD", grime, smoothstep(n, n.math("SUBTRACT", floor + 0.5, z), 0.0, 0.5))
    grime = n.math("MULTIPLY", n.math("MINIMUM", grime, 1.0), dirt)
    dust_mask = n.math(
        "MULTIPLY",
        smoothstep(n, facing_up(n), 0.45, 0.9),
        n.math(
            "MULTIPLY", n.math("ADD", 0.45, n.math("MULTIPLY", n.noise(25 / s, vector=co), 0.8)),
            dust,
        ),
    )

    rusty = n.mix(n.noise(120 / s, detail=3, vector=co), (0.11, 0.035, 0.012), (0.2, 0.075, 0.025))
    color = n.mix(n.math("MULTIPLY", grime, 0.75), color, (0.03, 0.027, 0.022))
    color = n.mix(n.math("MULTIPLY", halo, 0.8), color, primer)
    color = n.mix(chip, color, bare)
    color = n.mix(core, color, rusty)
    color = n.mix(n.math("MULTIPLY", run, 0.75), color, (0.12, 0.045, 0.015))
    color = n.mix(n.math("MINIMUM", dust_mask, 0.85), color, (0.2, 0.19, 0.17))

    r = n.math("ADD", rough, n.math("MULTIPLY", n.math("SUBTRACT", macro, 0.5), 0.2))
    r = n.math("ADD", r, n.math("MULTIPLY", chalk, 0.4))
    r = n.lerp(n.math("MULTIPLY", grime, 0.8), r, 0.85)
    r = n.lerp(halo, r, 0.75)
    r = n.lerp(chip, r, 0.32)
    r = n.lerp(core, r, 0.92)
    r = n.lerp(run, r, 0.85)
    r = n.lerp(dust_mask, r, 0.95)

    peel = n.noise(300 / s, detail=2, vector=co)
    dent = n.noise(7 / s, detail=3, vector=co)
    h = n.math("ADD", n.math("MULTIPLY", peel, 0.06), n.math("MULTIPLY", dent, 1.2 * dents))
    h = n.math("SUBTRACT", h, n.math("MULTIPLY", chip, 0.25))
    h = n.math("SUBTRACT", h, n.math("MULTIPLY", halo, 0.08))
    h = n.math("ADD", h, n.math("MULTIPLY", core, 0.12))
    if height is not None:
        h = n.math("ADD", h, height)
    return {"Base Color": color, "Roughness": r, "Normal": n.bump(h, distance=bump)}


def galvanised(
    n, *, tone=0.45, dirt=0.5, dust=0.5, white_rust=0.4, dents=1.0, floor=None, height=None,
    bump=0.004, scale=1.0,
):
    """
    Galvanised steel, as the outputs for n.out(**...): a spangle of zinc crystals that differ in
    shine, dull white rust in patches, dirt in creases and streaks, dust on top. Give the material
    a metallic of about 0.8 (lib.material's, set with n.bsdf): baking keeps only a plain metallic.
    """
    s = scale
    vor = n.add("ShaderNodeTexVoronoi", {"Vector": n.coord(), "Scale": 30 / s, "Randomness": 1.0})
    warp = n.add("ShaderNodeTexVoronoi", {"Vector": n.coord(), "Scale": 75 / s, "Randomness": 1.0})
    cell = n.xyz(vor.outputs["Color"])[0]
    fine = n.xyz(warp.outputs["Color"])[1]
    spangle = n.math("ADD", n.math("MULTIPLY", cell, 0.7), n.math("MULTIPLY", fine, 0.3))
    macro = n.noise(2 / s, detail=3)
    base = shade(
        n, (tone, tone, tone * 1.02),
        n.math("ADD", 0.8, n.math("ADD", n.math("MULTIPLY", spangle, 0.25),
                                  n.math("MULTIPLY", macro, 0.15))),
    )
    whites = n.math("MULTIPLY", smoothstep(n, n.noise(3 / s, detail=5), 0.58, 0.72), white_rust)
    wash = smoothstep(
        n, n.noise(1.0, detail=4, vector=_stretched(n, 40 / s, 40 / s, 2 / s)), 0.45, 0.75
    )
    grime = n.math("ADD", n.math("MULTIPLY", crevices(n), 1.4), n.math("MULTIPLY", wash, 0.4))
    if floor is not None:
        z = n.xyz()[2]
        grime = n.math("ADD", grime, smoothstep(n, n.math("SUBTRACT", floor + 0.5, z), 0.0, 0.5))
    grime = n.math("MULTIPLY", n.math("MINIMUM", grime, 1.0), dirt)
    dust_mask = n.math(
        "MULTIPLY", smoothstep(n, facing_up(n), 0.45, 0.9),
        n.math("MULTIPLY", n.math("ADD", 0.45, n.math("MULTIPLY", n.noise(25 / s), 0.8)), dust),
    )
    color = n.mix(whites, base, (0.55, 0.55, 0.52))
    color = n.mix(n.math("MULTIPLY", grime, 0.7), color, (0.05, 0.045, 0.04))
    color = n.mix(n.math("MINIMUM", dust_mask, 0.85), color, (0.2, 0.19, 0.17))
    r = n.math("ADD", 0.3, n.math("MULTIPLY", spangle, 0.28))
    r = n.lerp(whites, r, 0.8)
    r = n.lerp(grime, r, 0.75)
    r = n.lerp(dust_mask, r, 0.95)
    h = n.math("MULTIPLY", n.noise(7 / s, detail=3), 1.2 * dents)
    h = n.math("ADD", h, n.math("MULTIPLY", whites, 0.1))
    h = n.math("ADD", h, n.math("MULTIPLY", spangle, 0.03))
    if height is not None:
        h = n.math("ADD", h, height)
    return {"Base Color": color, "Roughness": r, "Normal": n.bump(h, distance=bump)}
