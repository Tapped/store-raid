"""
Door frame: a pressed steel frame, double rebated and mitred, wrapping a doorway through a wall.
The door's long gone: the frame halves of its hinges are left, and the strike plate.
"""

import bmesh
from mathutils import Vector

import lib

ORIGIN = "model"  # on the floor, in the middle of the opening and of the wall
TRIS = 1200
AO_DISTANCE = 0.06

# Meters. The opening, which nothing may reach into, and the wall it goes through.
OPEN_W = 1.4
OPEN_H = 2.2
WALL = 0.2
GAP = 0.002  # the frame's soffit stands back this far, so the strike plate is flush with the opening
FACE = 0.1  # the frame's width, from the opening to the outside of the architrave
DEPTH = 0.26
REBATE = 0.016  # how far the rebates step back from the stop
STOP = 0.075  # half the stop's width
C = 0.003  # the chamfer on every edge that catches light

HINGES = (0.25, 1.05, 1.9)  # heights of the hinges' middles, on the +x jamb
STRIKE = 1.02


def profile():
    """The frame's section as (out from the soffit, y), round the outline, the wall inside it."""
    d = DEPTH / 2
    w = WALL / 2
    front = [
        (FACE, -w), (FACE, -d + C), (FACE - C, -d), (REBATE + C, -d), (REBATE, -d + C),
        (REBATE, -STOP), (C, -STOP), (0, -STOP + C),
    ]
    back = [(o, -y) for o, y in reversed(front)]
    return front + back + [(0.03, w), (0.03, -w)]


def cut(obj, point, normal):
    """Throw away the part of obj's mesh on the side of the plane that `normal` points to."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=point, plane_no=normal, clear_outer=True)
    bm.to_mesh(obj.data)
    bm.free()


def build():
    paint = frame_paint()
    steel = lib.material("steel", (0.36, 0.35, 0.33), roughness=0.42, metallic=1)
    dark = lib.material("hole", (0.01, 0.01, 0.01), roughness=0.8)

    soffit_x = OPEN_W / 2 + GAP
    soffit_z = OPEN_H + GAP
    prof = profile()
    height = soffit_z + FACE
    for side in (-1, 1):
        jamb = lib.shape(
            "jamb", [(side * (soffit_x + o), y) for o, y in prof], at=(0, 0, height / 2),
            depth=height, mat=paint, facing="z",
        )
        # Mitred where it meets the head.
        cut(jamb, Vector((side * soffit_x, 0, soffit_z)), Vector((-side, 0, 1)))
    head = lib.shape(
        "head", [(y, soffit_z + o) for o, y in prof], depth=2 * (soffit_x + FACE), mat=paint,
        facing="x",
    )
    for side in (-1, 1):
        cut(head, Vector((side * soffit_x, 0, soffit_z)), Vector((side, 0, -1)))

    # The frame halves of three hinges in the front rebate of the +x jamb: a leaf screwed to the
    # rebate's face and the knuckle, with its pin, standing proud of the corner.
    x = soffit_x + REBATE
    for z in HINGES:
        lib.box("leaf", (0.003, 0.034, 0.1), (x - 0.0015, -DEPTH / 2 + 0.02, z), steel)
        lib.cylinder("knuckle", 0.0065, 0.1, (x - 0.0045, -DEPTH / 2 + 0.0062, z), mat=steel,
                     sides=8, bevel=0.0015)
        lib.cylinder("pin", 0.003, 0.11, (x - 0.0045, -DEPTH / 2 + 0.0062, z), mat=steel, sides=6)
        for dz in (-0.03, 0.03):
            lib.cylinder("screw", 0.0035, 0.002, (x - 0.0035, -DEPTH / 2 + 0.024, z + dz), axis="x",
                         mat=dark, sides=6)

    # The strike plate on the stop of the -x jamb, flush with the opening, its latch hole dark.
    face = -OPEN_W / 2 - 0.0004
    lib.box("strike", (GAP - 0.0004, 0.032, 0.12), (face - (GAP - 0.0004) / 2, 0, STRIKE), steel,
            bevel=0.0006, segments=1)
    lib.box("latch", (0.0003, 0.014, 0.026), (face + 0.00015, 0, STRIKE), dark)
    for dz in (-0.045, 0.045):
        lib.cylinder("screw", 0.0035, 0.0003, (face + 0.00015, 0, STRIKE + dz), axis="x",
                     mat=dark, sides=6)

    # Fixing screws through the architrave, both faces, filled and painted over long ago.
    for side in (-1, 1):
        for z in (0.3, 1.1, 1.9):
            for face in (-1, 1):
                lib.cylinder(
                    "fixing", 0.005, 0.002,
                    (side * (soffit_x + 0.06), face * DEPTH / 2, z), axis="y", mat=paint, sides=6,
                )


def frame_paint():
    """
    Grey-green enamel on steel: kicked and scraped at the foot, down to primer and rust there and
    along the edges, grubby where hands push past at shoulder height, dusty on the head.
    """
    mat, n = lib.procedural("frame", 1024)
    x, y, z = n.xyz()
    # The foot: below 0.4 m, kicked and scuffed by trolleys, worst at the corners.
    foot = lib.smoothstep(n, n.math("SUBTRACT", 0.42, z), 0.0, 0.25)
    scrape = lib.smoothstep(n, n.noise(1.0, detail=4, vector=n.vec(n.math("MULTIPLY", z, 30), 0, 0)),
                            0.55, 0.7)
    kicks = n.math(
        "MULTIPLY", foot,
        lib.smoothstep(n, n.math("ADD", n.noise(14, detail=6, roughness=0.65),
                                 n.math("MULTIPLY", scrape, 0.2)), 0.54, 0.6),
    )
    # Salt and mop water rot the foot: rust creeps up a few centimetres from the floor.
    creep = n.math("ADD", 0.03, n.math("MULTIPLY", n.noise(9, detail=4), 0.14))
    rot = lib.smoothstep(n, n.math("SUBTRACT", creep, z), 0.0, 0.02)
    rusted = n.math("MULTIPLY", kicks, lib.smoothstep(n, n.noise(40, detail=3), 0.45, 0.6))
    # Hands: a darker, shinier band where people grab the frame going through.
    hands = n.math(
        "MULTIPLY",
        lib.smoothstep(n, n.math("SUBTRACT", 0.35, n.math("ABSOLUTE", n.math("SUBTRACT", z, 1.25))),
                       0.0, 0.25),
        lib.smoothstep(n, n.noise(6, detail=3), 0.45, 0.7),
    )
    paint = (0.06, 0.08, 0.07)
    paint = n.mix(n.math("MULTIPLY", hands, 0.5), paint, (0.035, 0.04, 0.035))
    paint = n.mix(kicks, paint, (0.26, 0.25, 0.23))
    paint = n.mix(rusted, paint, (0.13, 0.05, 0.018))
    paint = n.mix(rot, paint, n.mix(n.noise(60, detail=3), (0.07, 0.025, 0.01), (0.16, 0.06, 0.02)))
    relief = n.math("MULTIPLY", n.math("SUBTRACT", 0.0, kicks), 0.4)
    relief = n.math("ADD", relief, n.math("MULTIPLY", rot, n.math("MULTIPLY", n.noise(80, detail=4), 0.5)))
    relief = n.math("ADD", relief, n.math("MULTIPLY", foot, n.math("MULTIPLY", n.noise(9, detail=2), 0.6)))
    out = lib.weathered(
        n, paint, rough=0.4, chips=0.6, rust=0.6, dirt=0.7, dust=0.7, edge_wear=0.8, floor=0.0,
        height=relief, bump=0.004,
    )
    out["Roughness"] = n.lerp(n.math("MULTIPLY", hands, 0.6), out["Roughness"], 0.25)
    out["Roughness"] = n.lerp(kicks, out["Roughness"], 0.5)
    out["Roughness"] = n.lerp(rot, out["Roughness"], 0.93)
    n.out(**out)
    return mat

