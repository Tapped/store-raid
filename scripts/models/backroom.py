"""
Shared by the back-of-house models (racking, pallets, office and staff rooms, plant): worn
materials and the parts they're made of. Not a model itself: it has no build().

Materials follow the wear method in Saltline's METHOD.md, part 2: a base with broad mottling,
damage that clusters (chips to primer, then bare steel and rust), dirt that gathers low and in
creases, edge wear found by the Bevel node, and dust on faces that look up. They read the part a
point belongs to through mesh attributes that tag() writes:

  local   the point, in meters from the middle of its part (box-local coordinates)
  half    the part's half size, in meters
  seed    a number from 0 to 1 for the part, to vary it from its neighbours

so one baked cardboard material can tape, label and print every box in a stack differently.
"""

import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

import lib

# ---------------------------------------------------------------------------------------------
# Tagging parts


def tag(obj, half, seed, centre=(0, 0, 0)):
    """Write the local, half and seed attributes on every vertex of obj (mesh data coordinates)."""
    mesh = obj.data
    centre = Vector(centre)
    local = mesh.attributes.new("local", "FLOAT_VECTOR", "POINT")
    halves = mesh.attributes.new("half", "FLOAT_VECTOR", "POINT")
    seeds = mesh.attributes.new("seed", "FLOAT", "POINT")
    for i, v in enumerate(mesh.vertices):
        local.data[i].vector = v.co - centre
        halves.data[i].vector = half
        seeds.data[i].value = seed
    return obj


def place(obj, at=(0, 0, 0), rot=(0, 0, 0)):
    """Move and turn an object built around the origin; join() applies it."""
    obj.location = at
    obj.rotation_euler = Euler(rot)
    return obj


def part(name, size, at, mat, seed=0.0, rot=(0, 0, 0), bevel=0.0, segments=1):
    """A box tagged as its own part, built at the origin, then moved to `at` and turned by `rot`."""
    obj = lib.box(name, size, (0, 0, 0), mat, bevel=bevel, segments=segments)
    tag(obj, [s / 2 for s in size], seed)
    return place(obj, at, rot)


def profile(name, points, length, at, axis, mat, seed=0.0):
    """
    A straight length of a section: `points` outline it as (u, v) in meters, extruded `length`
    along `axis`, centred on `at`. Along x, (u, v) are (y, z); along y, (x, z); along z, (x, y).
    """
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((u, v, -length / 2)) for u, v in points])
    top = bmesh.ops.extrude_face_region(bm, geom=[face])["geom"]
    bmesh.ops.translate(
        bm, vec=(0, 0, length), verts=[g for g in top if isinstance(g, bmesh.types.BMVert)]
    )
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    turn = {
        "x": Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))),
        "y": Matrix(((1, 0, 0), (0, 0, 1), (0, 1, 0))),
        "z": Matrix.Identity(3),
    }[axis].to_4x4()
    bmesh.ops.transform(bm, matrix=turn, verts=bm.verts)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    lo = Vector(min(v.co[i] for v in mesh.vertices) for i in range(3))
    hi = Vector(max(v.co[i] for v in mesh.vertices) for i in range(3))
    tag(obj, (hi - lo) / 2, seed, (lo + hi) / 2)
    place(obj, at)
    return lib.assign(obj, mat)


def mesh_object(name, verts, faces, mat, seed=0.0):
    """An object from vertex and face lists, tagged as one part."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    lo = Vector(min(v[i] for v in verts) for i in range(3))
    hi = Vector(max(v[i] for v in verts) for i in range(3))
    tag(obj, (hi - lo) / 2, seed, (lo + hi) / 2)
    return lib.assign(obj, mat)


def bounds_report(model):
    """Print the size of everything built so far, to compare with the catalogue."""
    bpy.context.view_layer.update()
    pts = []
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            m = o.matrix_world
            pts += [m @ Vector(c) for c in o.bound_box]
    lo = Vector(min(p[i] for p in pts) for i in range(3))
    hi = Vector(max(p[i] for p in pts) for i in range(3))
    print("MODEL", model, "built", [round(v, 3) for v in lo], "to", [round(v, 3) for v in hi])


# ---------------------------------------------------------------------------------------------
# Shader helpers on lib.Nodes


def attr(n, name):
    return n.add("ShaderNodeAttribute", attribute_name=name, attribute_type="GEOMETRY")


def split(n, vector):
    node = n.add("ShaderNodeSeparateXYZ", {"Vector": vector})
    return node.outputs["X"], node.outputs["Y"], node.outputs["Z"]


def vm(n, op, a, b=None, out="Vector"):
    node = n.add("ShaderNodeVectorMath", operation=op)
    n.set(node.inputs[0], a)
    if b is not None:
        n.set(node.inputs[1], b)
    return node.outputs[out]


def smooth(n, v, lo, hi):
    """0 below lo, 1 above hi, smoothly between (lo < hi)."""
    node = n.add("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
    n.set(node.inputs["Value"], v)
    n.set(node.inputs["From Min"], lo)
    n.set(node.inputs["From Max"], hi)
    return node.outputs["Result"]


def inv(n, v):
    return n.math("SUBTRACT", 1.0, v)


def mul(n, *vs):
    out = vs[0]
    for v in vs[1:]:
        out = n.math("MULTIPLY", out, v)
    return out


def add(n, *vs):
    out = vs[0]
    for v in vs[1:]:
        out = n.math("ADD", out, v)
    return out


def clamp01(n, v):
    return n.math("ADD", v, 0.0, clamp=True)


def bump(n, height, distance, normal=None, strength=1.0):
    node = n.add("ShaderNodeBump", {"Height": height, "Strength": strength, "Distance": distance})
    if normal is not None:
        n.set(node.inputs["Normal"], normal)
    return node.outputs["Normal"]


def normal_z(n):
    geo = n.add("ShaderNodeNewGeometry")
    return split(n, geo.outputs["Normal"])[2]


def edges(n, radius=0.006):
    """About 1 on convex edges and corners, 0 on flat faces and in inside corners."""
    bev = n.add("ShaderNodeBevel", {"Radius": radius}, samples=8)
    geo = n.add("ShaderNodeNewGeometry")
    d = vm(n, "DOT_PRODUCT", bev.outputs["Normal"], geo.outputs["Normal"], out="Value")
    edge = smooth(n, inv(n, d), 0.015, 0.12)
    ao = n.add("ShaderNodeAmbientOcclusion", {"Distance": radius * 3}, only_local=True, samples=8)
    return mul(n, edge, smooth(n, ao.outputs["AO"], 0.75, 0.95))


def cavity(n, distance=0.03):
    """About 1 in creases and inside corners, where dirt gathers."""
    ao = n.add("ShaderNodeAmbientOcclusion", {"Distance": distance}, only_local=True, samples=8)
    return inv(n, smooth(n, ao.outputs["AO"], 0.35, 0.95))


def seeded(n, scale=(23.1, 41.7, 17.3)):
    """The point in meters, shifted by its part's seed, so like parts don't share a pattern."""
    s = attr(n, "seed").outputs["Fac"]
    return vm(n, "ADD", n.coord(), vm(n, "MULTIPLY", n.vec(s, s, s), scale))


def tint(c, k):
    return tuple(min(1.0, v * k) for v in c)


# ---------------------------------------------------------------------------------------------
# Materials

PRIMER = (0.11, 0.105, 0.095)
OXIDE = (0.16, 0.045, 0.02)
STEEL = (0.22, 0.22, 0.23)
RUST = (0.13, 0.045, 0.015)
DIRT = (0.035, 0.028, 0.02)
DUST = (0.2, 0.185, 0.165)
SALT = (0.42, 0.41, 0.38)


def paint(name, color, size=1024, wear=1.0, rust=1.0, gloss=0.42, dust=1.0, grime=1.0,
          primer=PRIMER, floor=0.0, detail=None, chalky=0.35, salt=0.6):
    """
    Painted steel fifteen years on: mottled, chipped in clusters and along edges to primer, bare
    steel and rust, scuffed near the floor (`floor` is where the floor is, in model z), grimy low
    and in creases, dusty on top. `detail(n, p)` may add holes, slots or panel lines: it returns
    (dark, height): where it darkens to a hole and how it moves the surface (0 to 1, 1 the face).
    """
    mat, n = lib.procedural(name, size)
    p = seeded(n)
    x, y, z = split(n, p)
    _, _, wz = n.xyz()
    nz = normal_z(n)

    mottle = n.noise(2.5, detail=3, vector=p)
    base = n.mix(mottle, tint(color, 0.82), tint(color, 1.12))
    # Chalking: paint fades and lightens in broad patches.
    chalk = smooth(n, n.noise(0.9, detail=2, vector=p), 0.55, 0.8)
    base = n.mix(mul(n, chalk, chalky), base, tint(color, 1.5))

    edge = edges(n)
    crease = cavity(n)
    low = inv(n, smooth(n, n.math("SUBTRACT", wz, floor), 0.0, 0.45))
    cluster = smooth(n, n.noise(1.4, detail=3, vector=p), 0.52, 0.74)
    damage = add(n, mul(n, cluster, 0.55), mul(n, edge, 0.75), mul(n, low, cluster, 0.4))
    chipn = n.noise(18, detail=8, roughness=0.62, vector=p)
    field = add(n, chipn, mul(n, damage, 0.42 * wear))
    to_primer = smooth(n, field, 0.8, 0.815)
    to_steel = smooth(n, field, 0.87, 0.885)
    rusty = mul(n, to_steel, smooth(n, n.noise(30, detail=4, vector=p), 0.42, 0.6), rust)
    # Fine scratches, mostly sideways, where damage clusters.
    sv = vm(n, "MULTIPLY", p, (2.0, 2.0, 70.0))
    scratch = mul(
        n, inv(n, smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(1.0, 2, vector=sv), 0.5)),
                         0.0, 0.012)),
        smooth(n, add(n, cluster, mul(n, low, 0.5)), 0.3, 0.8), wear,
    )

    color_ = n.mix(to_primer, base, primer)
    color_ = n.mix(n.math("MAXIMUM", to_steel, mul(n, scratch, 0.6)), color_, STEEL)
    color_ = n.mix(rusty, color_, RUST)
    # Rust weeps down from chips.
    streak = smooth(n, n.noise(1.0, 3, vector=vm(n, "MULTIPLY", p, (60.0, 60.0, 1.5))), 0.55, 0.78)
    color_ = n.mix(mul(n, streak, cluster, 0.35 * rust), color_, RUST)

    dirt = clamp01(n, add(n, mul(n, low, 0.6), mul(n, crease, 0.7), mul(n, streak, 0.25)))
    dirt = mul(n, dirt, grime, smooth(n, n.noise(6, 3, vector=p), 0.25, 0.7))
    color_ = n.mix(mul(n, dirt, 0.75), color_, DIRT)
    up = smooth(n, nz, 0.55, 0.9)
    dusty = mul(n, up, smooth(n, n.noise(7, 4, vector=p), 0.2, 0.75), dust)
    color_ = n.mix(mul(n, dusty, 0.8), color_, DUST)
    # Harbour air: a white salt bloom low down and round rust.
    salty = mul(n, smooth(n, n.noise(6, 6, vector=p), 0.58, 0.72),
                clamp01(n, add(n, low, mul(n, rusty, 2.0), mul(n, crease, 0.5))), salt)
    color_ = n.mix(mul(n, salty, 0.55), color_, SALT)

    rough = add(n, gloss, mul(n, n.math("SUBTRACT", mottle, 0.5), 0.12), mul(n, chalk, 0.15))
    rough = n.lerp(to_primer, rough, 0.72)
    rough = n.lerp(to_steel, rough, 0.38)
    rough = n.lerp(rusty, rough, 0.9)
    rough = n.lerp(dirt, rough, 0.85)
    rough = n.lerp(dusty, rough, 0.95)
    rough = n.lerp(salty, rough, 0.9)

    height = add(n, 1.0, mul(n, to_primer, -0.5), mul(n, to_steel, -0.3), mul(n, scratch, -0.3),
                 mul(n, rusty, n.noise(90, 3, vector=p), -0.5))
    if detail is not None:
        dark, dh = detail(n, p)
        color_ = n.mix(dark, color_, (0.008, 0.008, 0.008))
        rough = n.lerp(dark, rough, 0.8)
        height = mul(n, height, dh)
    dents = bump(n, n.noise(2.2, 3, vector=p), 0.004, strength=0.6)
    normal = bump(n, height, 0.0012, dents)
    n.out(**{"Base Color": color_, "Roughness": rough, "Normal": normal})
    return mat


def galvanised(name="galvanised", size=512, floor=0.0):
    """Hot-dip galvanised steel: spangle cells of different gloss, white rust, grime low."""
    mat, n = lib.procedural(name, size)
    p = seeded(n)
    _, _, wz = n.xyz()
    vor = n.add("ShaderNodeTexVoronoi", {"Vector": p, "Scale": 28.0})
    cell = split(n, vor.outputs["Color"])[0]
    base = n.mix(cell, (0.22, 0.225, 0.23), (0.32, 0.33, 0.34))
    white = smooth(n, n.noise(9, 5, vector=p), 0.62, 0.72)
    base = n.mix(mul(n, white, 0.6), base, (0.4, 0.4, 0.38))
    low = inv(n, smooth(n, n.math("SUBTRACT", wz, floor), 0.0, 0.3))
    dirt = mul(n, add(n, low, cavity(n)), smooth(n, n.noise(5, 3, vector=p), 0.3, 0.7))
    base = n.mix(mul(n, dirt, 0.7), base, DIRT)
    up = mul(n, smooth(n, normal_z(n), 0.6, 0.9), smooth(n, n.noise(8, 3, vector=p), 0.3, 0.7))
    base = n.mix(mul(n, up, 0.7), base, DUST)
    rough = add(n, 0.3, mul(n, cell, 0.28))
    rough = n.lerp(white, rough, 0.8)
    rough = n.lerp(n.math("MAXIMUM", dirt, up), rough, 0.9)
    n.out(**{"Base Color": base, "Roughness": rough,
             "Normal": bump(n, add(n, cell, mul(n, white, 0.5)), 0.0004)})
    return mat


def cardboard(name="cardboard", size=2048, dust=1.0):
    """
    Corrugated boxes, each varied by its part's seed: kraft of different shades or white board,
    brown tape over the flaps, a shipping label on most, printed panels and hand holes on some,
    scuffed edges, a water stain now and then, dirty at the bottom and dusty on top.
    """
    mat, n = lib.procedural(name, size)
    L = attr(n, "local").outputs["Vector"]
    H = attr(n, "half").outputs["Vector"]
    s = attr(n, "seed").outputs["Fac"]
    lx, ly, lz = split(n, L)
    hx, hy, hz = split(n, H)
    ax, ay, az = (n.math("ABSOLUTE", v) for v in (lx, ly, lz))
    p = seeded(n)

    def frac(k):
        return n.math("FRACT", n.math("MULTIPLY", s, k))

    def near(a, h, d):
        return n.math("GREATER_THAN", a, n.math("SUBTRACT", h, d))

    on_top = n.math("GREATER_THAN", lz, n.math("SUBTRACT", hz, 0.003))
    on_bottom = n.math("LESS_THAN", lz, n.math("SUBTRACT", 0.003, hz))
    on_y = near(ay, hy, 0.003)
    on_x = near(ax, hx, 0.003)
    rim = add(n, near(ax, hx, 0.014), near(ay, hy, 0.014), near(az, hz, 0.014))
    edge = smooth(n, rim, 1.5, 1.7)

    white = n.math("GREATER_THAN", s, 0.84)
    kraft = n.mix(frac(7.31), (0.24, 0.135, 0.058), (0.4, 0.25, 0.11))
    # Recycled board, greyer and darker, on some.
    kraft = n.mix(n.math("GREATER_THAN", frac(19.3), 0.72), kraft, (0.15, 0.11, 0.075))
    board = n.mix(white, kraft, (0.5, 0.48, 0.44))
    blotch = n.noise(4, 3, vector=p)
    board = n.mix(mul(n, blotch, 0.35), board, (0.17, 0.1, 0.045))
    fibre = n.noise(320, 2, vector=p)
    board = n.mix(mul(n, fibre, 0.25), board, (0.12, 0.07, 0.03))

    # Tape along the flap seam over the top and bottom, folding 6 cm down the ends.
    taped = n.math("GREATER_THAN", frac(3.17), 0.12)
    strip = n.math("LESS_THAN", ax, 0.024)
    ends = mul(n, on_y, n.math("GREATER_THAN", az, n.math("SUBTRACT", hz, 0.06)))
    tape = mul(n, taped, strip, n.math("MAXIMUM", n.math("MAXIMUM", on_top, on_bottom), ends))
    seam = mul(n, on_top, n.math("LESS_THAN", ax, 0.0015), inv(n, tape))

    # A shipping label on the y faces, left or right of the middle.
    has_label = n.math("GREATER_THAN", frac(5.71), 0.3)
    ox = mul(n, n.math("SUBTRACT", frac(13.3), 0.5), n.math("MAXIMUM", n.math("SUBTRACT", hx, 0.09), 0.0))
    lu = n.math("SUBTRACT", lx, ox)
    oz = mul(n, n.math("SUBTRACT", frac(17.9), 0.6), n.math("MAXIMUM", n.math("SUBTRACT", hz, 0.08), 0.0))
    lv = n.math("SUBTRACT", lz, oz)
    label = mul(n, has_label, on_y, n.math("LESS_THAN", n.math("ABSOLUTE", lu), 0.055),
                n.math("LESS_THAN", n.math("ABSOLUTE", lv), 0.038))
    bars = mul(n, n.math("LESS_THAN", lv, -0.008), n.math("GREATER_THAN", lv, -0.03),
               n.math("LESS_THAN", n.math("ABSOLUTE", lu), 0.045),
               n.math("GREATER_THAN", n.noise(1.0, 0, vector=n.vec(n.math("MULTIPLY", lu, 160))), 0.5))
    lines = mul(n, n.math("GREATER_THAN", lv, 0.0), n.math("LESS_THAN", lv, 0.03),
                n.math("LESS_THAN", n.math("ABSOLUTE", n.math("ADD", lu, 0.008)), 0.04),
                n.stripes(lv, 0.008, 0.45),
                n.math("GREATER_THAN", n.noise(1.0, 0, vector=n.vec(n.math("MULTIPLY", lu, 60), lv)), 0.4))
    ink_label = mul(n, label, n.math("MAXIMUM", bars, lines))

    # Printed panels on the x faces: a block of brand colour and lines of text.
    printed = n.math("GREATER_THAN", frac(2.33), 0.45)
    pv = n.math("DIVIDE", lz, hz)
    panel = mul(n, printed, on_x, n.math("LESS_THAN", n.math("ABSOLUTE", n.math("DIVIDE", ly, hy)), 0.7),
                n.math("GREATER_THAN", pv, 0.15), n.math("LESS_THAN", pv, 0.6))
    words = mul(n, panel, n.stripes(lz, 0.035, 0.55),
                n.math("GREATER_THAN", n.noise(1.0, 0, vector=n.vec(n.math("MULTIPLY", ly, 25), lz, s)), 0.42))
    bar = mul(n, printed, on_x, n.math("GREATER_THAN", pv, -0.55), n.math("LESS_THAN", pv, -0.4))
    ink_color = n.mix(frac(11.7), (0.12, 0.012, 0.01), (0.01, 0.03, 0.12))
    ink = n.math("MAXIMUM", words, bar)

    # Hand holes high on the x faces of big boxes.
    holes = mul(n, n.math("GREATER_THAN", hz, 0.13), n.math("GREATER_THAN", frac(4.9), 0.5), on_x,
                n.math("LESS_THAN", ay, 0.05),
                n.math("LESS_THAN", n.math("ABSOLUTE", n.math("SUBTRACT", lz, n.math("SUBTRACT", hz, 0.09))), 0.016))

    scuff = mul(n, edge, smooth(n, n.noise(26, 6, vector=p), 0.45, 0.6))
    stain_n = n.noise(2.2, 2, vector=p)
    stain = mul(n, n.math("GREATER_THAN", frac(9.1), 0.75),
                inv(n, smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", stain_n, 0.58)), 0.0, 0.012)))
    stain_in = mul(n, n.math("GREATER_THAN", frac(9.1), 0.75), smooth(n, stain_n, 0.58, 0.6))
    low = inv(n, smooth(n, n.math("ADD", lz, hz), 0.0, 0.05))
    _, _, wz = n.xyz()
    floor_dirt = inv(n, smooth(n, wz, 0.0, 0.25))
    up = smooth(n, normal_z(n), 0.6, 0.9)
    dusty = mul(n, up, smooth(n, n.noise(6, 4, vector=p), 0.15, 0.7), dust)

    c = board
    c = n.mix(mul(n, stain_in, 0.3), c, (0.12, 0.07, 0.03))
    c = n.mix(mul(n, stain, 0.6), c, (0.07, 0.04, 0.02))
    c = n.mix(mul(n, ink, 0.92), c, ink_color)
    c = n.mix(seam, c, (0.04, 0.025, 0.012))
    c = n.mix(tape, c, (0.28, 0.15, 0.045))
    c = n.mix(label, c, (0.62, 0.61, 0.57))
    c = n.mix(ink_label, c, (0.025, 0.025, 0.025))
    c = n.mix(holes, c, (0.015, 0.01, 0.006))
    c = n.mix(mul(n, scuff, 0.7), c, (0.48, 0.36, 0.22))
    c = n.mix(mul(n, n.math("MAXIMUM", low, floor_dirt), 0.55), c, DIRT)
    c = n.mix(mul(n, dusty, 0.75), c, DUST)

    rough = add(n, 0.84, mul(n, fibre, 0.1))
    rough = n.lerp(mul(n, ink, 0.7), rough, 0.6)
    rough = n.lerp(tape, rough, 0.28)
    rough = n.lerp(label, rough, 0.55)
    rough = n.lerp(dusty, rough, 0.95)
    height = add(n, mul(n, fibre, 0.15), mul(n, tape, 0.25), mul(n, label, 0.15), mul(n, holes, -1.0),
                 mul(n, scuff, -0.35), mul(n, seam, -0.3))
    crush = bump(n, n.noise(3.5, 3, vector=p), 0.004, strength=0.5)
    n.out(**{"Base Color": c, "Roughness": rough, "Normal": bump(n, height, 0.0015, crush)})
    return mat


def stretch_wrap(name="wrap", size=1024):
    """
    Stretch film over kraft boxes: glossy, milky where it's wound thicker, banded where turns
    overlap, wrinkled sideways, dusty on top.
    """
    mat, n = lib.procedural(name, size)
    p = seeded(n)
    x, y, z = split(n, p)
    band = n.noise(1.0, 2, vector=n.vec(n.math("MULTIPLY", z, 3.5), 0.37, 0))
    layers = smooth(n, band, 0.35, 0.7)
    overlap = inv(n, smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(1.0, 1, vector=n.vec(
        n.math("MULTIPLY", z, 5.0), n.math("MULTIPLY", add(n, x, y), 0.4), 2.0)), 0.5)), 0.0, 0.025))
    wrinkle = n.noise(1.0, 4, roughness=0.6, vector=vm(n, "MULTIPLY", p, (4.0, 4.0, 55.0)))
    fine = n.noise(1.0, 3, vector=vm(n, "MULTIPLY", p, (12.0, 12.0, 180.0)))
    seam = attr(n, "seam").outputs["Fac"]
    gap = smooth(n, seam, 0.55, 0.95)
    under = n.mix(n.noise(3, 2, vector=p), (0.2, 0.115, 0.05), (0.3, 0.18, 0.08))
    under = n.mix(gap, under, (0.025, 0.016, 0.008))
    milk = add(n, 0.12, mul(n, layers, 0.18), mul(n, overlap, 0.22), mul(n, gap, 0.1))
    c = n.mix(milk, under, (0.45, 0.45, 0.47))
    up = smooth(n, normal_z(n), 0.6, 0.9)
    dusty = mul(n, up, smooth(n, n.noise(6, 3, vector=p), 0.2, 0.7))
    c = n.mix(mul(n, dusty, 0.6), c, DUST)
    rough = add(n, 0.1, mul(n, wrinkle, 0.18), mul(n, layers, 0.1), mul(n, overlap, 0.08))
    rough = n.lerp(dusty, rough, 0.85)
    h = add(n, mul(n, wrinkle, 0.7), mul(n, fine, 0.3), mul(n, overlap, 0.4))
    n.out(**{"Base Color": c, "Roughness": rough, "Normal": bump(n, h, 0.0012)})
    return mat


def wood(name="pallet-wood", size=1024):
    """
    Rough-sawn pallet timber, grain along each board's length (from its part's half size), boards
    of different ages from fresh pine to weathered grey, dirty and scuffed at the edges.
    """
    mat, n = lib.procedural(name, size)
    L = attr(n, "local").outputs["Vector"]
    H = attr(n, "half").outputs["Vector"]
    s = attr(n, "seed").outputs["Fac"]
    hx, hy, hz = split(n, H)
    longest = n.math("MAXIMUM", n.math("MAXIMUM", hx, hy), hz)
    # Across the grain, coordinates are stretched by how much shorter that side is than the length.
    stretch = vm(n, "DIVIDE", n.vec(longest, longest, longest), vm(n, "MAXIMUM", H, (0.01, 0.01, 0.01)))
    stretch = vm(n, "MINIMUM", stretch, (14.0, 14.0, 14.0))
    q = vm(n, "ADD", vm(n, "MULTIPLY", L, stretch), n.vec(mul(n, s, 31.0), mul(n, s, 17.0), 0))
    grain = n.noise(3.0, 6, roughness=0.6, vector=q)
    rings = n.math("FRACT", n.math("MULTIPLY", grain, 9.0))
    age = n.math("FRACT", n.math("MULTIPLY", s, 5.3))
    fresh = n.mix(rings, (0.32, 0.19, 0.08), (0.24, 0.13, 0.05))
    grey = n.mix(rings, (0.15, 0.13, 0.11), (0.1, 0.085, 0.07))
    c = n.mix(age, fresh, grey)
    knots = smooth(n, n.noise(1.0, 2, vector=vm(n, "MULTIPLY", q, (0.6, 0.6, 0.6))), 0.72, 0.76)
    c = n.mix(mul(n, knots, 0.7), c, (0.06, 0.035, 0.018))
    edge = edges(n, 0.004)
    p = seeded(n)
    scuff = mul(n, edge, smooth(n, n.noise(20, 5, vector=p), 0.4, 0.6))
    c = n.mix(mul(n, scuff, 0.5), c, (0.38, 0.26, 0.15))
    _, _, wz = n.xyz()
    dirt = clamp01(n, add(n, mul(n, cavity(n, 0.04), 0.8), inv(n, smooth(n, wz, 0.0, 0.08))))
    dirt = mul(n, dirt, smooth(n, n.noise(5, 3, vector=p), 0.2, 0.7))
    c = n.mix(mul(n, dirt, 0.8), c, DIRT)
    up = mul(n, smooth(n, normal_z(n), 0.6, 0.9), smooth(n, n.noise(7, 3, vector=p), 0.3, 0.8))
    c = n.mix(mul(n, up, 0.5), c, DUST)
    rough = add(n, 0.8, mul(n, grain, 0.15))
    rough = n.lerp(dirt, rough, 0.9)
    h = add(n, mul(n, grain, 0.6), mul(n, n.noise(1.0, 2, vector=vm(n, "MULTIPLY", q, (30.0, 30.0, 30.0))), 0.4),
            mul(n, knots, -0.4), mul(n, scuff, -0.3))
    n.out(**{"Base Color": c, "Roughness": rough, "Normal": bump(n, h, 0.002)})
    return mat


def chipboard(name="chipboard", size=1024, color=(0.27, 0.19, 0.11)):
    """Particle board: flakes of wood pressed together, stained, scuffed and dusty."""
    mat, n = lib.procedural(name, size)
    p = seeded(n)
    flakes = n.add("ShaderNodeTexVoronoi", {"Vector": p, "Scale": 140.0})
    fl = split(n, flakes.outputs["Color"])[0]
    flakes2 = n.add("ShaderNodeTexVoronoi", {"Vector": p, "Scale": 47.0})
    fl2 = split(n, flakes2.outputs["Color"])[1]
    c = n.mix(add(n, mul(n, fl, 0.6), mul(n, fl2, 0.4)), tint(color, 0.6), tint(color, 1.3))
    stain = smooth(n, n.noise(2.0, 3, vector=p), 0.55, 0.75)
    c = n.mix(mul(n, stain, 0.5), c, (0.06, 0.04, 0.025))
    ring = inv(n, smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(1.6, 2, vector=p), 0.62)), 0.0, 0.01))
    c = n.mix(mul(n, ring, 0.5), c, (0.07, 0.045, 0.025))
    edge = edges(n, 0.004)
    c = n.mix(mul(n, edge, 0.5), c, (0.4, 0.3, 0.19))
    up = mul(n, smooth(n, normal_z(n), 0.6, 0.9), smooth(n, n.noise(5, 3, vector=p), 0.15, 0.7))
    c = n.mix(mul(n, up, 0.7), c, DUST)
    rough = add(n, 0.78, mul(n, fl, 0.12))
    rough = n.lerp(up, rough, 0.95)
    n.out(**{"Base Color": c, "Roughness": rough,
             "Normal": bump(n, add(n, mul(n, fl, 0.5), mul(n, fl2, 0.5)), 0.0006)})
    return mat


def plastic(name, color, size=512, gloss=0.45):
    """Moulded plastic: faintly mottled, scratched and scuffed to a duller grey, dusty on top."""
    mat, n = lib.procedural(name, size)
    p = seeded(n)
    c = n.mix(n.noise(4, 2, vector=p), tint(color, 0.85), tint(color, 1.1))
    edge = edges(n, 0.006)
    scuff = mul(n, add(n, edge, mul(n, smooth(n, n.noise(3, 3, vector=p), 0.6, 0.75), 0.5)),
                smooth(n, n.noise(30, 4, vector=p), 0.4, 0.6))
    c = n.mix(mul(n, scuff, 0.6), c, tint(color, 1.6))
    dirt = mul(n, cavity(n), 0.8)
    c = n.mix(dirt, c, DIRT)
    up = mul(n, smooth(n, normal_z(n), 0.6, 0.9), smooth(n, n.noise(6, 3, vector=p), 0.2, 0.7))
    c = n.mix(mul(n, up, 0.7), c, DUST)
    sv = vm(n, "MULTIPLY", p, (60.0, 60.0, 3.0))
    scratch = inv(n, smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(1.0, 2, vector=sv), 0.5)), 0.0, 0.01))
    rough = add(n, gloss, mul(n, scuff, 0.3), mul(n, scratch, 0.2))
    rough = n.lerp(n.math("MAXIMUM", up, dirt), rough, 0.9)
    n.out(**{"Base Color": c, "Roughness": rough,
             "Normal": bump(n, add(n, n.noise(80, 2, vector=p), mul(n, scratch, -0.5)), 0.0005)})
    return mat


def paper(name="paper", size=512):
    """A printed sheet: off-white, with a barcode and lines of text, read off its part's faces."""
    mat, n = lib.procedural(name, size)
    L = attr(n, "local").outputs["Vector"]
    H = attr(n, "half").outputs["Vector"]
    lx, ly, lz = split(n, L)
    hx, hy, _ = split(n, H)
    # Across the sheet: whichever of x and y it's wide in.
    u = n.math("DIVIDE", add(n, lx, ly), add(n, hx, hy))
    v = n.math("DIVIDE", lz, split(n, H)[2])
    bars = mul(n, n.math("LESS_THAN", v, -0.2), n.math("GREATER_THAN", v, -0.8),
               n.math("LESS_THAN", n.math("ABSOLUTE", u), 0.8),
               n.math("GREATER_THAN", n.noise(1.0, 0, vector=n.vec(n.math("MULTIPLY", u, 40))), 0.5))
    lines = mul(n, n.math("GREATER_THAN", v, 0.0), n.math("LESS_THAN", v, 0.85),
                n.math("LESS_THAN", n.math("ABSOLUTE", u), 0.85), n.stripes(v, 0.14, 0.5),
                n.math("GREATER_THAN", n.noise(1.0, 0, vector=n.vec(n.math("MULTIPLY", u, 9), v)), 0.38))
    p = seeded(n)
    c = n.mix(n.noise(8, 2, vector=p), (0.55, 0.54, 0.5), (0.66, 0.65, 0.6))
    c = n.mix(n.math("MAXIMUM", bars, lines), c, (0.02, 0.02, 0.02))
    dirt = smooth(n, n.noise(4, 3, vector=p), 0.6, 0.8)
    c = n.mix(mul(n, dirt, 0.5), c, (0.25, 0.2, 0.13))
    n.out(**{"Base Color": c, "Roughness": 0.7, "Normal": bump(n, n.noise(30, 2, vector=p), 0.0008)})
    return mat


# ---------------------------------------------------------------------------------------------
# Parts

PALLET = (1.2, 1.0, 0.144)  # x, y, z: a 1200 × 1000 block pallet, top boards running front to back
BOARD = 0.022
BLOCK = 0.078


def pallet(at, mat, rng, worn=0.0):
    """
    A block pallet on the floor at `at` (middle of its footprint, at the bottom): five top boards
    front to back on three stringer boards, nine blocks and three bottom boards. `worn` is the
    chance of a board knocked crooked or missing.
    """
    x0, y0, z0 = at
    w, d, _ = PALLET
    xs = (-w / 2 + 0.0725, -0.27, 0.0, 0.27, w / 2 - 0.0725)
    widths = (0.145, 0.1, 0.12, 0.1, 0.145)
    rows = (-d / 2 + 0.05, 0.0, d / 2 - 0.05)
    cols = (-w / 2 + 0.0725, 0.0, w / 2 - 0.0725)
    z = z0
    for x, bw in zip(cols, (0.145, 0.145, 0.145)):
        part("bottom", (bw, d, BOARD), (x0 + x, y0, z + BOARD / 2), mat, rng.random(),
             rot=(0, 0, rng.uniform(-0.006, 0.006)))
    z += BOARD
    for x in cols:
        for y in rows:
            part("block", (0.145, 0.1, BLOCK), (x0 + x + rng.uniform(-0.004, 0.004), y0 + y,
                                                 z + BLOCK / 2), mat, rng.random())
    z += BLOCK
    for y in rows:
        part("stringer", (w, 0.1, BOARD), (x0, y0 + y, z + BOARD / 2), mat, rng.random())
    z += BOARD
    for x, bw in zip(xs, widths):
        if rng.random() < worn * 0.3:
            continue
        tilt = rng.uniform(-0.04, 0.04) if rng.random() < worn else rng.uniform(-0.004, 0.004)
        part("deck", (bw, d - rng.uniform(0, 0.01), BOARD),
             (x0 + x + rng.uniform(-0.004, 0.004), y0 + rng.uniform(-0.006, 0.006), z + BOARD / 2),
             mat, rng.random(), rot=(0, 0, tilt))
    return z0 + PALLET[2]


def boxes(lo, grid, size, mat, rng, gap=0.004, jitter=0.006, turn=0.02, bevel=0.0, skip=(),
          seeds=(0.0, 0.84), shrink=0.0):
    """
    A grid of equal boxes from the corner `lo` (x, y, z of its low corner): grid = (nx, ny, nz),
    size = one box (x, y, z). Each is nudged and turned a little; `skip` holds (i, j, k) cells
    left empty. Seeds come from the range `seeds` (below 0.84 is kraft, above is white board).
    `shrink` makes the top layer's boxes up to that much shorter, so it isn't dead level.
    """
    made = []
    nx, ny, nz = grid
    bx, by, bz = size
    for k in range(nz):
        for j in range(ny):
            for i in range(nx):
                if (i, j, k) in skip:
                    continue
                h = bz - (rng.uniform(0, shrink) if k == nz - 1 else 0.0)
                at = (lo[0] + (i + 0.5) * bx + rng.uniform(-jitter, jitter),
                      lo[1] + (j + 0.5) * by + rng.uniform(-jitter, jitter),
                      lo[2] + k * bz + h / 2)
                made.append(part("box", (bx - gap, by - gap, h - 0.001), at, mat,
                                 rng.uniform(*seeds), rot=(0, 0, rng.uniform(-turn, turn)),
                                 bevel=bevel))
    return made


def wrap(lo, hi, joints, mat, rng, below=0.06, lip=0.05, dip=0.007, tear=None, extra=((), (), ())):
    """
    Stretch film round a stack whose boxes fill lo..hi (x, y, z corners): a loft of rings round
    its sides, sunk into the gaps between boxes at `joints` = (xs, ys, zs), carried `below` down
    over the pallet and folded `lip` in over the top edge. `tear(p)` returns True for points
    where the film is torn away; `extra` adds rows (xs, ys, zs) of points that don't sink, to
    shape a tear.
    """
    m = 0.006
    SEAM = 0.014  # noqa: N806 - half the width of the line a gap between boxes makes
    x0, y0, z0 = lo[0] - m, lo[1] - m, lo[2]
    x1, y1, z1 = hi[0] + m, hi[1] + m, hi[2]
    jx, jy, jz = (set(round(v, 5) for v in j) for j in joints)
    c = 0.014  # corners rounded off this far

    def side(a, b, fixed, along, out, js, ex):
        """Points from a to b along one axis, the other coordinate fixed, outward normal out."""
        lo_, hi_ = min(a, b) + c, max(a, b) - c
        flanks = [t + f for t in js for f in (-SEAM, SEAM)]
        ts = sorted({round(t, 5) for t in (lo_, hi_, *js, *ex, *flanks) if lo_ <= t <= hi_},
                    reverse=b < a)
        pts = []
        for t in ts:
            p = (t, fixed) if along == "x" else (fixed, t)
            pts.append((p, out, round(t, 5) in (jx if along == "x" else jy)))
        return pts

    ring = []
    ring += side(x0, x1, y0, "x", (0, -1), jx, extra[0])
    ring += [((x1 - c * 0.3, y0 + c * 0.3), (1, -1), False)]
    ring += side(y0, y1, x1, "y", (1, 0), jy, extra[1])
    ring += [((x1 - c * 0.3, y1 - c * 0.3), (1, 1), False)]
    ring += side(x1, x0, y1, "x", (0, 1), jx, extra[0])
    ring += [((x0 + c * 0.3, y1 - c * 0.3), (-1, 1), False)]
    ring += side(y1, y0, x0, "y", (-1, 0), jy, extra[1])
    ring += [((x0 + c * 0.3, y0 + c * 0.3), (-1, -1), False)]

    zflanks = [z + f for z in jz for f in (-SEAM, SEAM)]
    zs = sorted({round(z, 5) for z in (z0 - below, z0, *jz, *zflanks, *extra[2], z1 - 0.004)
                 if z0 - below <= z <= z1 - 0.004})
    levels = [(z, round(z, 5) in jz, 0.0) for z in zs] + [(z1 + 0.003, False, lip)]
    verts, seams = [], []
    for z, zjoint, inset in levels:
        row = []
        for (px, py), (ox, oy), xjoint in ring:
            sink = (dip if xjoint else 0) + (dip if zjoint else 0)
            if z < z0:
                sink = 0.0
            puff = rng.uniform(-0.0015, 0.0025) if 0 < inset or z0 < z < z1 else 0
            o = puff - sink - inset
            row.append(Vector((px + ox * o, py + oy * o, z)))
            seams.append(1.0 if (xjoint and z0 <= z) or zjoint else 0.0)
        verts.append(row)
    n = len(ring)
    flat, faces, torn = [], [], set()
    for row in verts:
        flat += row
    for r in range(len(verts) - 1):
        for i in range(n):
            a, b = r * n + i, r * n + (i + 1) % n
            quad = (a, b, b + n, a + n)
            if tear is not None:
                mid = sum((flat[q] for q in quad), Vector()) / 4
                if tear(mid):
                    torn.update(quad)
                    continue
            faces.append(quad)
    used = sorted({i for f in faces for i in f})
    # Rag the torn edge: its points move about in the film's plane, and roll a little outward.
    for i in sorted(torn.intersection(used)):
        _, (ox, oy), _ = ring[i % n]
        tangent = Vector((-oy, ox, 0)).normalized()
        flat[i] += tangent * rng.uniform(-0.028, 0.028) + Vector((0, 0, rng.uniform(-0.025, 0.025)))
        flat[i] += Vector((ox, oy, 0)).normalized() * 0.004
        seams[i] = 0.6
    remap = {old: new for new, old in enumerate(used)}
    obj = mesh_object("wrap", [flat[i] for i in used], [tuple(remap[i] for i in f) for f in faces],
                      mat, rng.random())
    # The gaps between boxes show through the film as dark lines.
    seam = obj.data.attributes.new("seam", "FLOAT", "POINT")
    for new, old in enumerate(used):
        seam.data[new].value = seams[old]
    return obj


def wrapped_stack(at, grid, size, card, film, rng, top_shrink=0.0):
    """
    Boxes in stretch film on a pallet top at `at` (middle of the footprint, on the deck): only the
    top layer is modelled as boxes, the rest is a block the film hides.
    """
    nx, ny, nz = grid
    bx, by, bz = size
    w, d = nx * bx, ny * by
    lo = (at[0] - w / 2, at[1] - d / 2, at[2])
    hi = (at[0] + w / 2, at[1] + d / 2, at[2] + nz * bz)
    if nz > 1:
        hidden = bpy.data.materials.get("hidden") or lib.material("hidden", (0.12, 0.07, 0.03), 0.9)
        lib.box("fill", (w - 0.01, d - 0.01, (nz - 1) * bz),
                (at[0], at[1], at[2] + (nz - 1) * bz / 2), hidden)
    boxes((lo[0], lo[1], at[2] + (nz - 1) * bz), (nx, ny, 1), size, card, rng, jitter=0.002,
          turn=0.004, seeds=(0.0, 0.83), shrink=top_shrink)
    joints = ([lo[0] + i * bx for i in range(1, nx)], [lo[1] + j * by for j in range(1, ny)],
              [at[2] + k * bz for k in range(1, nz)])
    return wrap(lo, hi, joints, film, rng)


# ---------------------------------------------------------------------------------------------
# Pallet racking: one bay, the frames at both ends, so bays stand end to end in a run.

RACK_W, RACK_H, RACK_D = 2.7, 2.6, 1.1
UPRIGHT_W, UPRIGHT_D = 0.09, 0.07  # across the aisle face, and front to back
FRAME_Y = 0.45  # the uprights' faces to the aisles
BEAM_TOPS = (1.0, 1.8)
BEAM_H, BEAM_D, STEP = 0.1, 0.05, 0.015
BAY = RACK_W / 2 - UPRIGHT_W  # the inside faces of the uprights, either side of the middle
SLOTS = (-0.63, 0.63)  # pallet places, middle of each


def _upright_holes(n, p):
    """Two columns of slots in the aisle face and teardrops up the sides of each upright."""
    L = attr(n, "local").outputs["Vector"]
    H = attr(n, "half").outputs["Vector"]
    lx, ly, _ = split(n, L)
    tall = n.math("GREATER_THAN", split(n, H)[2], 1.0)
    _, _, z = n.xyz()
    geo = n.add("ShaderNodeNewGeometry")
    gx, gy, _ = split(n, geo.outputs["Normal"])
    phase = n.math("FRACT", n.math("DIVIDE", z, 0.05))
    column = n.math("ABSOLUTE", n.math("SUBTRACT", n.math("ABSOLUTE", lx), 0.022))
    face = mul(n, smooth(n, n.math("ABSOLUTE", gy), 0.8, 0.9), n.math("LESS_THAN", column, 0.005),
               n.math("GREATER_THAN", phase, 0.25), n.math("LESS_THAN", phase, 0.65))
    width = add(n, 0.0025, mul(n, smooth(n, phase, 0.1, 0.5), 0.0055))
    drop = mul(n, smooth(n, n.math("ABSOLUTE", gx), 0.8, 0.9),
               n.math("LESS_THAN", n.math("ABSOLUTE", ly), width),
               n.math("GREATER_THAN", phase, 0.1), n.math("LESS_THAN", phase, 0.62))
    hole = mul(n, tall, n.math("MAXIMUM", face, drop))
    return hole, inv(n, hole)


def _chevrons(n, p):
    x, y, z = n.xyz()
    return mul(n, n.stripes(add(n, x, y, z), 0.1, 0.5), 0.97), 1.0


def rack_materials():
    return {
        "upright": paint("upright", (0.012, 0.04, 0.15), detail=_upright_holes, gloss=0.4),
        "beam": paint("beam", (0.34, 0.036, 0.002), gloss=0.36, primer=OXIDE, chalky=0.12),
        "guard": paint("guard", (0.42, 0.26, 0.006), wear=2.2, gloss=0.5, detail=_chevrons),
        "galv": galvanised(),
    }


def rack(mats, rng, levels):
    """
    The frames and beams of one bay. `levels` has one entry per beam level, from the bottom:
    "boards" (chipboard decking, mats["chipboard"]), "bars" (galvanised pallet supports) or None
    (beams alone). Returns the height a load stands on at each level, the floor first.
    """
    blue, orange, yellow, galv = mats["upright"], mats["beam"], mats["guard"], mats["galv"]
    t = 0.004
    hw, d = UPRIGHT_W / 2, UPRIGHT_D
    c_section = [(-hw, 0), (hw, 0), (hw, d), (0.028, d), (0.028, d - t), (hw - t, d - t),
                 (hw - t, t), (-hw + t, t), (-hw + t, d - t), (-0.028, d - t), (-0.028, d),
                 (-hw, d)]
    # The guard is wider than the upright, so it sits inboard of it, inside the bay's width.
    g, gw, front = 0.006, 0.07, RACK_D / 2
    u_guard = [(-gw, front), (gw, front), (gw, FRAME_Y - 0.03), (gw - g, FRAME_Y - 0.03),
               (gw - g, front - g), (-gw + g, front - g), (-gw + g, FRAME_Y - 0.03),
               (-gw, FRAME_Y - 0.03)]
    guard_x = RACK_W / 2 - gw
    for sx in (-1, 1):
        xc = sx * (RACK_W / 2 - hw)
        for sy in (-1, 1):
            # A C section, its web to the aisle and its lips to the other upright of the frame.
            pts = [(xc + u, sy * (FRAME_Y - tt)) for u, tt in c_section]
            profile("upright", pts, RACK_H - 0.008, (0, 0, RACK_H / 2 + 0.004), "z", blue,
                    rng.random())
            yc = sy * (FRAME_Y - d / 2)
            part("baseplate", (0.12, 0.12, 0.008), (sx * (RACK_W / 2 - 0.06), yc, 0.004), galv, rng.random())
            for bx in (-0.045, 0.045):
                part("anchor", (0.018, 0.018, 0.012), (sx * (RACK_W / 2 - 0.06) + bx * 0.8, yc + sy * 0.035, 0.012), galv)
            # A column guard round the foot of the upright, standing off its face.
            pts = [(sx * guard_x + a, sy * b) for a, b in u_guard]
            profile("guard", pts, 0.4, (0, 0, 0.2), "z", yellow, rng.random())
        # Bracing between the two uprights of the frame, on the lips' side.
        span = 2 * (FRAME_Y - d)
        braces = [0.12, 0.62, 1.12, 1.62, 2.12, 2.5]
        for z in (braces[0], braces[-1]):
            part("brace", (0.03, span, 0.025), (xc, 0, z), blue, rng.random())
        for i, (za, zb) in enumerate(zip(braces, braces[1:])):
            length = math.hypot(span, zb - za)
            angle = math.atan2(zb - za, span) * (1 if i % 2 == 0 else -1)
            part("brace", (0.03, length, 0.022), (xc, 0, (za + zb) / 2), blue, rng.random(),
                 rot=(angle, 0, 0))

    tops = [0.0]
    inner = FRAME_Y - BEAM_D - STEP
    for top, kind in zip(BEAM_TOPS, levels):
        for sy in (-1, 1):
            y0, y1 = sy * FRAME_Y, sy * (FRAME_Y - BEAM_D)
            ys = y1 - sy * STEP
            zb, zt = top - BEAM_H, top
            pts = [(y0, zb), (y1, zb), (y1, zt - STEP), (ys, zt - STEP), (ys, zt), (y0, zt)]
            profile("beam", pts, 2 * BAY - 0.012, (0, 0, 0), "x", orange, rng.random())
            for sx in (-1, 1):
                part("connector", (0.006, BEAM_D - 0.004, 0.2),
                     (sx * (BAY - 0.003), (y0 + y1) / 2, top - 0.1), orange, rng.random())
        if kind == "boards":
            pw = (2 * BAY - 0.022) / 3
            for i in range(3):
                part("deck", (pw - 0.004, 2 * inner - 0.004, 0.016),
                     (-BAY + 0.011 + (i + 0.5) * pw, 0, top - STEP + 0.009),
                     mats["chipboard"], rng.random(), rot=(0, 0, rng.uniform(-0.004, 0.004)))
            tops.append(top + 0.002)
        elif kind == "bars":
            for x in (-1.0, -0.26, 0.26, 1.0):
                part("bar", (0.04, 2 * inner - 0.004, 0.03), (x, 0, top - 0.015), galv,
                     rng.random())
            tops.append(top)
        else:
            tops.append(top)
    return tops


def tote(at, mat, rng, size=(0.6, 0.4, 0.22), turn=0.0):
    """An open plastic crate with a rim, standing at `at` (middle of its footprint, its bottom)."""
    w, d, h = size
    t = 0.008
    iw, idp = w - 0.02, d - 0.02
    pieces = [
        ((iw, idp, t), (0, 0, t / 2)),
        ((t, idp, h), (-iw / 2 + t / 2, 0, h / 2)),
        ((t, idp, h), (iw / 2 - t / 2, 0, h / 2)),
        ((iw, t, h), (0, -idp / 2 + t / 2, h / 2)),
        ((iw, t, h), (0, idp / 2 - t / 2, h / 2)),
        ((w, 0.018, 0.02), (0, -d / 2 + 0.009, h - 0.01)),
        ((w, 0.018, 0.02), (0, d / 2 - 0.009, h - 0.01)),
        ((0.018, d - 0.036, 0.02), (-w / 2 + 0.009, 0, h - 0.01)),
        ((0.018, d - 0.036, 0.02), (w / 2 - 0.009, 0, h - 0.01)),
    ]
    c, s = math.cos(turn), math.sin(turn)
    x, y, z = at
    seed = rng.random()
    return [
        part("tote", size_, (x + ox * c - oy * s, y + ox * s + oy * c, z + oz), mat, seed,
             rot=(0, 0, turn))
        for size_, (ox, oy, oz) in pieces
    ]


# ---------------------------------------------------------------------------------------------
# Harbour cargo


def sacking(name="sack", size=1024):
    """
    Woven polypropylene sacks: off-white or tan by seed, a fine weave, a printed panel on top,
    stitched ends, dirty and dusty with spilt powder.
    """
    mat, n = lib.procedural(name, size)
    L = attr(n, "local").outputs["Vector"]
    H = attr(n, "half").outputs["Vector"]
    s = attr(n, "seed").outputs["Fac"]
    lx, ly, lz = split(n, L)
    hx, hy, hz = split(n, H)
    p = seeded(n)
    u = n.math("DIVIDE", lx, hx)
    v = n.math("DIVIDE", ly, hy)
    cloth = n.mix(n.math("FRACT", n.math("MULTIPLY", s, 7.7)), (0.4, 0.38, 0.33), (0.32, 0.24, 0.14))
    weave = n.math("MULTIPLY", n.stripes(lx, 0.004, 0.5), n.stripes(ly, 0.004, 0.5))
    on_top = n.math("GREATER_THAN", lz, 0.0)
    panel = mul(n, on_top, n.math("LESS_THAN", n.math("ABSOLUTE", u), 0.6),
                n.math("LESS_THAN", n.math("ABSOLUTE", v), 0.55))
    letters = mul(n, panel, n.math("GREATER_THAN", n.math("ABSOLUTE", v), 0.12),
                  n.math("GREATER_THAN", n.noise(1.0, 0, vector=n.vec(n.math("MULTIPLY", u, 9),
                                                                       n.math("MULTIPLY", v, 3), s)), 0.45))
    band = mul(n, panel, n.math("LESS_THAN", n.math("ABSOLUTE", v), 0.1))
    ink = n.mix(n.math("FRACT", n.math("MULTIPLY", s, 3.3)), (0.12, 0.01, 0.008), (0.01, 0.04, 0.1))
    stitch = mul(n, smooth(n, n.math("ABSOLUTE", u), 0.86, 0.88),
                 inv(n, smooth(n, n.math("ABSOLUTE", u), 0.92, 0.94)))
    c = n.mix(mul(n, n.noise(5, 3, vector=p), 0.35), cloth, (0.17, 0.14, 0.1))
    c = n.mix(n.math("MAXIMUM", letters, band), c, ink)
    c = n.mix(mul(n, stitch, 0.5), c, (0.1, 0.09, 0.07))
    dirt = mul(n, add(n, cavity(n, 0.05), inv(n, smooth(n, lz, n.math("MULTIPLY", hz, -0.7), 0.0))),
               smooth(n, n.noise(4, 3, vector=p), 0.25, 0.75))
    c = n.mix(mul(n, clamp01(n, dirt), 0.7), c, DIRT)
    powder = mul(n, smooth(n, normal_z(n), 0.5, 0.9), smooth(n, n.noise(3, 4, vector=p), 0.5, 0.7))
    c = n.mix(mul(n, powder, 0.6), c, (0.5, 0.48, 0.44))
    rough = add(n, 0.62, mul(n, weave, 0.12))
    rough = n.lerp(powder, rough, 0.95)
    n.out(**{"Base Color": c, "Roughness": rough,
             "Normal": bump(n, add(n, mul(n, weave, 0.5), mul(n, stitch, 0.5)), 0.0006,
                            bump(n, n.noise(6, 4, vector=p), 0.006, strength=0.6))})
    return mat


def sack(at, size, mat, seed, turn=0.0):
    """A filled sack lying flat, `size` = (x, y, z) at its fullest, `at` the middle of its bottom."""
    hx, hy, hz = (v / 2 for v in size)

    def pillow(q):
        x = math.copysign(abs(q.x) ** 0.32, q.x)
        y = math.copysign(abs(q.y) ** 0.32, q.y)
        # Thinner towards the stitched ends.
        squash = 1 - 0.4 * abs(x) ** 5 - 0.15 * abs(y) ** 6
        return Vector((x * hx, y * hy, q.z * hz * squash))

    obj = lib.ellipsoid("sack", (hx, hy, hz), (0, 0, 0), mat, segments=10, rings=5, deform=pillow)
    tag(obj, (hx, hy, hz), seed)
    return place(obj, (at[0], at[1], at[2] + hz * 0.96), (0, 0, turn))


def sacks(at, layers, mat, rng, size=(0.58, 0.38, 0.12)):
    """Sacks on a pallet top at `at`, in layers of five laid alternately, as dock hands stack them."""
    sx, sy, sz = size
    for k in range(layers):
        z = at[2] + k * sz * 0.86
        spots = ([(-0.31, -0.3, 0), (0.31, -0.3, 0), (-0.4, 0.2, 1), (0.0, 0.2, 1), (0.4, 0.2, 1)]
                 if k % 2 == 0 else
                 [(-0.31, 0.3, 0), (0.31, 0.3, 0), (-0.4, -0.2, 1), (0.0, -0.2, 1), (0.4, -0.2, 1)])
        for x, y, turned in spots:
            if k == layers - 1 and rng.random() < 0.2:
                continue
            sack((at[0] + x + rng.uniform(-0.02, 0.02), at[1] + y + rng.uniform(-0.02, 0.02), z),
                 size, mat, rng.random(), (math.pi / 2 if turned else 0) + rng.uniform(-0.08, 0.08))


DRUM_R, DRUM_H = 0.293, 0.88


def drum(at, mat, steel, seed, turn=0.0):
    """A 200-litre steel drum standing at `at`, with two rolling hoops and bungs in its lid."""
    r, h = DRUM_R, DRUM_H
    i = r - 0.008
    prof = [(0, 0.0), (0, r - 0.02), (0.006, r), (0.03, r), (0.036, i), (0.285, i), (0.293, r + 0.004),
            (0.301, i), (0.579, i), (0.587, r + 0.004), (0.595, i), (0.845, i), (0.851, r),
            (h, r), (h, r - 0.01), (h - 0.016, r - 0.016), (h - 0.016, 0)]
    obj = lib.lathe("drum", prof, (0, 0, 0), mat=mat, sides=14)
    tag(obj, (r, r, h / 2), seed, (0, 0, h / 2))
    place(obj, at, (0, 0, turn))
    c, s = math.cos(turn), math.sin(turn)
    for bx, rad in ((0.17, 0.03), (-0.19, 0.02)):
        cap = lib.cylinder("bung", rad, 0.012, (0, 0, 0), mat=steel, sides=8)
        tag(cap, (rad, rad, 0.006), seed)
        place(cap, (at[0] + bx * c, at[1] + bx * s, at[2] + h - 0.012))
    return obj


def crate(at, size, mat, rng, ink=None):
    """
    A wooden shipping crate on two skids at `at` (middle of its footprint, its bottom): boarded
    panels framed by battens along every edge and a brace up the middle of the long sides.
    """
    w, d, h = size
    x, y, z = at
    sk = 0.08
    for sy in (-1, 1):
        part("skid", (w, 0.09, sk), (x, y + sy * (d / 2 - 0.12), z + sk / 2), mat, rng.random())
    z0 = z + sk
    b, t = 0.075, 0.022  # batten width and how far it stands proud
    part("panels", (w - 2 * t, d - 2 * t, h - 2 * t), (x, y, z0 + h / 2), mat, rng.random())
    zc = z0 + h / 2
    for sy in (-1, 1):
        for sz in (-1, 1):
            part("batten", (w, b, b), (x, y + sy * (d / 2 - b / 2), zc + sz * (h / 2 - b / 2)), mat,
                 rng.random())
    for sx in (-1, 1):
        for sz in (-1, 1):
            part("batten", (b, d - 2 * b, b), (x + sx * (w / 2 - b / 2), y, zc + sz * (h / 2 - b / 2)),
                 mat, rng.random())
        for sy in (-1, 1):
            part("batten", (b, b, h - 2 * b), (x + sx * (w / 2 - b / 2), y + sy * (d / 2 - b / 2), zc),
                 mat, rng.random())
    for sy in (-1, 1):
        part("brace", (b, t, h - 2 * b), (x, y + sy * (d / 2 - t / 2), zc), mat, rng.random())
    if ink is not None:
        lib.text("stencil", "THIS WAY UP", 0.05, (x - w / 4, y - d / 2 + t - 0.0005, zc + 0.12),
                 depth=0.0005, mat=ink)
        lib.text("stencil", "NSS-0417", 0.045, (x - w / 4, y - d / 2 + t - 0.0005, zc - 0.1),
                 depth=0.0005, mat=ink)


# ---------------------------------------------------------------------------------------------
# Steel shelving along a wall, and what's kept on it


def _angle_holes(n, p):
    """Slotted angle: a column of slots up the middle of each flange of the uprights."""
    L = attr(n, "local").outputs["Vector"]
    H = attr(n, "half").outputs["Vector"]
    lx, ly, _ = split(n, L)
    tall = n.math("GREATER_THAN", split(n, H)[2], 0.8)
    _, _, z = n.xyz()
    geo = n.add("ShaderNodeNewGeometry")
    gx, gy, _ = split(n, geo.outputs["Normal"])
    phase = n.math("FRACT", n.math("DIVIDE", z, 0.038))
    window = mul(n, n.math("GREATER_THAN", phase, 0.15), n.math("LESS_THAN", phase, 0.72))
    on_y = mul(n, smooth(n, n.math("ABSOLUTE", gy), 0.8, 0.9), n.math("LESS_THAN", n.math("ABSOLUTE", lx), 0.0045))
    on_x = mul(n, smooth(n, n.math("ABSOLUTE", gx), 0.8, 0.9), n.math("LESS_THAN", n.math("ABSOLUTE", ly), 0.0045))
    hole = mul(n, tall, window, n.math("MAXIMUM", on_x, on_y))
    return hole, inv(n, hole)


SHELF_W, SHELF_H, SHELF_D = 1.33, 2.2, 0.5


def shelving(mat, rng, levels):
    """
    A bay of slotted-angle shelving: four angle uprights, steel shelves with turned-down lips at
    the heights in `levels` (the top of each), and crossed straps across the back.
    """
    a, t = 0.04, 0.004
    hx, hy = SHELF_W / 2 - a / 2, SHELF_D / 2 - a / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            # The angle's corner at the outside corner of the bay.
            cx, cy = sx * SHELF_W / 2, sy * SHELF_D / 2
            pts = [(0, 0), (-sx * a, 0), (-sx * a, -sy * t), (-sx * t, -sy * t), (-sx * t, -sy * a),
                   (0, -sy * a)]
            profile("upright", [(cx + u, cy + v) for u, v in pts], SHELF_H, (0, 0, SHELF_H / 2), "z",
                    mat, rng.random())
            part("foot", (0.05, 0.05, 0.006), (cx - sx * 0.025, cy - sy * 0.025, 0.003), mat)
    w, d, lip = SHELF_W - 2 * t - 0.002, SHELF_D - 2 * t - 0.002, 0.032
    for z in levels:
        seed = rng.random()
        part("shelf", (w, d, 0.003), (0, 0, z - 0.0015), mat, seed)
        for sy in (-1, 1):
            part("lip", (w, 0.003, lip), (0, sy * (d / 2 - 0.0015), z - lip / 2), mat, seed)
        for sx in (-1, 1):
            part("lip", (0.003, d - 0.006, lip), (sx * (w / 2 - 0.0015), 0, z - lip / 2), mat, seed)
    # Crossed straps across the back, between the lowest and highest shelf.

    z0, z1 = levels[0], levels[-1]
    span = 2 * hx
    length = math.hypot(span, z1 - z0)
    angle = math.atan2(z1 - z0, span)
    for k, sign in enumerate((1, -1)):
        part("strap", (length, 0.002, 0.03), (0, SHELF_D / 2 - 0.004 - 0.003 * k, (z0 + z1) / 2), mat,
             rng.random(), rot=(0, -sign * angle, 0))


def louvre_bin(at, mat, contents, seed, size=(0.15, 0.24, 0.125)):
    """
    A plastic parts bin, open at the front over a lowered lip, with a label slot, standing at
    `at` (middle of its footprint, its bottom), its front to -y, part filled.
    """
    w, d, h = size
    x, y, z = at
    t = 0.004
    front = 0.07
    side = [(-d / 2, 0), (d / 2, 0), (d / 2, h), (-d / 2 + 0.06, h), (-d / 2, front)]
    for sx in (-1, 1):
        profile("bin", [(y + u, z + v) for u, v in side], t, (x + sx * (w / 2 - t / 2), 0, 0), "x", mat,
                seed)
    part("bin", (w - 2 * t, d, t), (x, y, z + t / 2), mat, seed)
    part("bin", (w - 2 * t, t, h), (x, y + d / 2 - t / 2, z + h / 2), mat, seed)
    part("bin", (w - 2 * t, t * 1.5, front), (x, y - d / 2 + t, z + front / 2), mat, seed)
    part("label", (w * 0.6, 0.002, 0.025), (x, y - d / 2 - 0.001 + t * 0.2, z + front - 0.02),
         bpy.data.materials.get("paper") or paper(), seed)
    if contents is not None:
        fill = 0.03 + seed * 0.05
        part("parts", (w - 2 * t - 0.002, d - 0.03, fill), (x, y + 0.012, z + t + fill / 2),
             contents, seed)


def bits(name="bits", size=512):
    """A heap of small metal parts, bolts and washers, seen as a lumpy, glinting surface."""
    mat, n = lib.procedural(name, size)
    p = seeded(n)
    cells = n.add("ShaderNodeTexVoronoi", {"Vector": p, "Scale": 90.0})
    d = cells.outputs["Distance"]
    tone = split(n, cells.outputs["Color"])[0]
    c = n.mix(tone, (0.05, 0.05, 0.05), (0.25, 0.24, 0.22))
    c = n.mix(smooth(n, n.noise(10, 3, vector=p), 0.6, 0.75), c, RUST)
    n.out(**{"Base Color": c, "Roughness": add(n, 0.3, mul(n, tone, 0.4)),
             "Normal": bump(n, inv(n, d), 0.006, strength=0.8)})
    return mat


def tin_label(name="tins", size=512):
    """
    Tinplate cans with a printed label round the middle in a colour picked by seed, paint run
    down from the rim, rust spots, dust on the lid.
    """
    mat, n = lib.procedural(name, size)
    L = attr(n, "local").outputs["Vector"]
    H = attr(n, "half").outputs["Vector"]
    s = attr(n, "seed").outputs["Fac"]
    lx, ly, lz = split(n, L)
    v = n.math("DIVIDE", lz, split(n, H)[2])
    p = seeded(n)
    hue = n.math("FRACT", n.math("MULTIPLY", s, 4.7))
    ink = n.mix(smooth(n, hue, 0.3, 0.32), (0.25, 0.02, 0.01), (0.02, 0.1, 0.03))
    ink = n.mix(smooth(n, hue, 0.6, 0.62), ink, (0.4, 0.25, 0.01))
    ink = n.mix(smooth(n, hue, 0.85, 0.87), ink, (0.01, 0.03, 0.12))
    label = n.math("LESS_THAN", n.math("ABSOLUTE", n.math("SUBTRACT", v, -0.1)), 0.6)
    angle = n.math("ARCTAN2", ly, lx)
    words = mul(n, label, n.math("LESS_THAN", n.math("ABSOLUTE", n.math("SUBTRACT", v, 0.05)), 0.18),
                n.math("GREATER_THAN", n.noise(1.0, 0, vector=n.vec(n.math("MULTIPLY", angle, 6),
                                                                     n.math("MULTIPLY", v, 8))), 0.5))
    panel = mul(n, label, n.math("LESS_THAN", n.math("ABSOLUTE", n.math("SUBTRACT", v, -0.45)), 0.1))
    metal = n.mix(n.noise(6, 3, vector=p), (0.2, 0.2, 0.2), (0.3, 0.3, 0.29))
    c = n.mix(label, metal, ink)
    c = n.mix(n.math("MAXIMUM", words, panel), c, (0.6, 0.58, 0.52))
    # Runs of the tin's own colour down from the rim.
    reach = mul(n, n.noise(1.0, 1, vector=n.vec(n.math("MULTIPLY", angle, 9), s)), 0.9)
    run = mul(n, smooth(n, n.noise(1.0, 2, vector=n.vec(n.math("MULTIPLY", angle, 5), s)), 0.62, 0.66),
              n.math("GREATER_THAN", v, reach))
    c = n.mix(run, c, ink)
    rusty = smooth(n, n.noise(18, 6, vector=p), 0.66, 0.74)
    c = n.mix(rusty, c, RUST)
    up = mul(n, smooth(n, normal_z(n), 0.6, 0.9), smooth(n, n.noise(8, 3, vector=p), 0.2, 0.7))
    c = n.mix(mul(n, up, 0.8), c, DUST)
    rough = n.lerp(label, 0.32, 0.55)
    rough = n.lerp(n.math("MAXIMUM", rusty, up), rough, 0.9)
    n.out(**{"Base Color": c, "Roughness": rough,
             "Normal": bump(n, add(n, mul(n, rusty, -0.5), mul(n, run, 0.4)), 0.001,
                            bump(n, n.noise(4, 2, vector=p), 0.003, strength=0.5))})
    return mat


def tin(at, mat, seed, r=0.085, h=0.19, lid=None):
    """A round paint or grease tin with a rolled rim and a lid, standing at `at`."""
    prof = [(0, 0.0), (0, r - 0.004), (0.004, r), (h - 0.006, r), (h - 0.002, r + 0.002), (h, r - 0.002),
            (h - 0.004, r - 0.012), (h - 0.004, 0)]
    obj = lib.lathe("tin", prof, (0, 0, 0), mat=mat, sides=12)
    tag(obj, (r, r, h / 2), seed, (0, 0, h / 2))
    place(obj, at, (0, 0, seed * 6.28))
    return obj


def coil(at, mat, seed, radius=0.17, thick=0.014, turns=3.5, rise=None, sides=6, per_turn=14):
    """A hose or rope lying coiled flat at `at` (centre of the coil, on the surface)."""
    rise = rise if rise is not None else thick * 1.7
    pts, radii = [], []
    count = int(turns * per_turn)
    for i in range(count + 1):
        a = 2 * math.pi * i / per_turn + seed * 6
        r = radius - 0.006 * (i / per_turn) + 0.004 * math.sin(i * 1.7)
        z = thick + rise * (i / count) * (turns / 2 if turns > 2 else 1) * 0.5
        pts.append((at[0] + r * math.cos(a), at[1] + r * math.sin(a), at[2] + z))
        radii.append(thick)
    obj = lib.tube("coil", pts, radii, mat=mat, sides=sides)
    lo = Vector(min(p[i] for p in pts) for i in range(3))
    hi = Vector(max(p[i] for p in pts) for i in range(3))
    tag(obj, (hi - lo) / 2 + Vector((thick, thick, thick)), seed, (lo + hi) / 2)
    return obj


def rubber(name, color, size=512):
    """Rubber or PVC hose: matte, faintly ribbed along its length, scuffed pale, dusty on top."""
    mat, n = lib.procedural(name, size)
    p = seeded(n)
    c = n.mix(n.noise(5, 3, vector=p), tint(color, 0.8), tint(color, 1.15))
    scuff = smooth(n, n.noise(14, 5, vector=p), 0.62, 0.75)
    c = n.mix(mul(n, scuff, 0.6), c, tint(color, 2.0))
    up = mul(n, smooth(n, normal_z(n), 0.6, 0.9), smooth(n, n.noise(6, 3, vector=p), 0.3, 0.7))
    c = n.mix(mul(n, up, 0.6), c, DUST)
    c = n.mix(mul(n, cavity(n, 0.02), 0.7), c, DIRT)
    n.out(**{"Base Color": c, "Roughness": add(n, 0.62, mul(n, scuff, 0.2)),
             "Normal": bump(n, n.noise(40, 3, vector=p), 0.0008)})
    return mat


# ---------------------------------------------------------------------------------------------
# Workshop


def pegboard(name="pegboard", size=1024):
    """Hardboard drilled on a 25 mm grid, darkened by hands and oil where tools hang."""
    mat, n = lib.procedural(name, size)
    x, y, z = n.xyz()
    p = seeded(n)
    pitch = 0.025
    gx = n.math("SUBTRACT", n.math("FRACT", n.math("DIVIDE", x, pitch)), 0.5)
    gz = n.math("SUBTRACT", n.math("FRACT", n.math("DIVIDE", z, pitch)), 0.5)
    r = n.math("SQRT", add(n, mul(n, gx, gx), mul(n, gz, gz)))
    geo = n.add("ShaderNodeNewGeometry")
    face = smooth(n, n.math("ABSOLUTE", split(n, geo.outputs["Normal"])[1]), 0.8, 0.9)
    hole = mul(n, face, inv(n, smooth(n, r, 0.2, 0.26)))
    c = n.mix(n.noise(3, 3, vector=p), (0.15, 0.09, 0.045), (0.21, 0.13, 0.065))
    grime = smooth(n, n.noise(2.5, 4, vector=p), 0.5, 0.75)
    c = n.mix(mul(n, grime, 0.6), c, DIRT)
    c = n.mix(hole, c, (0.006, 0.005, 0.004))
    rough = n.lerp(grime, 0.7, 0.5)
    n.out(**{"Base Color": c, "Roughness": rough, "Normal": bump(n, inv(n, hole), 0.002)})
    return mat


def butcher_block(name="benchtop", size=1024):
    """
    A laminated hardwood bench top after years of work: strips of beech, gouges and saw cuts,
    black oil stains and rings, paint spots, worn pale along the front edge.
    """
    mat, n = lib.procedural(name, size)
    x, y, z = n.xyz()
    p = seeded(n)
    strip = n.math("FLOOR", n.math("DIVIDE", y, 0.045))
    tone = n.math("FRACT", n.math("MULTIPLY", n.math("SIN", n.math("MULTIPLY", strip, 12.9898)), 43758.5))
    q = n.vec(n.math("MULTIPLY", x, 2.0), n.math("MULTIPLY", y, 60.0), n.math("ADD", n.math("MULTIPLY", z, 60.0), strip))
    grain = n.noise(1.0, 5, roughness=0.6, vector=q)
    c = n.mix(tone, (0.3, 0.17, 0.08), (0.42, 0.25, 0.12))
    c = n.mix(mul(n, grain, 0.4), c, (0.16, 0.08, 0.035))
    oil = smooth(n, n.noise(1.6, 4, vector=p), 0.55, 0.7)
    ring = inv(n, smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(3.0, 2, vector=p), 0.6)), 0.0, 0.008))
    c = n.mix(mul(n, oil, 0.85), c, (0.025, 0.02, 0.015))
    c = n.mix(mul(n, ring, 0.6), c, (0.03, 0.02, 0.012))
    cuts = inv(n, smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(1.0, 2, vector=vm(n, "MULTIPLY", p, (6.0, 25.0, 6.0))), 0.5)), 0.0, 0.006))
    c = n.mix(mul(n, cuts, 0.5), c, (0.5, 0.36, 0.2))
    spots = smooth(n, n.noise(25, 2, vector=p), 0.78, 0.8)
    c = n.mix(spots, c, (0.02, 0.12, 0.2))
    edge = edges(n, 0.008)
    c = n.mix(mul(n, edge, 0.6), c, (0.5, 0.35, 0.2))
    rough = add(n, 0.55, mul(n, grain, 0.15))
    rough = n.lerp(oil, rough, 0.3)
    n.out(**{"Base Color": c, "Roughness": rough,
             "Normal": bump(n, add(n, mul(n, grain, 0.4), mul(n, cuts, -1.0)), 0.0015)})
    return mat
