"""
Duct vent: a square four-way ceiling diffuser, nested louvre cones stepping down to a centre plate
under a flanged frame, on a plenum box. Smudged black round its louvres by years of dusty air.
Hangs from its origin, on the ceiling at the middle of its top.
"""

import bmesh

import lib

ORIGIN = "model"
TRIS = 500
AO_DISTANCE = 0.04

HALF = 0.3
PLENUM = 0.25  # the box above, half its size
FRAME_Z = (-0.055, -0.066)
CONES = [(0.27 - 0.05 * k, -0.062 - 0.005 * k) for k in range(4)]  # (outer half size, top z)
SLOPE = (0.035, 0.02)  # each cone runs this far in and down
T = 0.0025  # sheet thickness


def square_ring(bm, loops):
    """A closed ring through square loops of (half size, z), each joined to the next and round."""
    rings = [[bm.verts.new((x * a, y * a, z)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
             for a, z in loops]
    for r0, r1 in zip(rings, rings[1:] + rings[:1]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))


def mesh(name, bm, mat):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib.assign(lib._mesh_object(name, bm), mat)


def build():
    paint = vent_paint()
    dark = lib.material("plenum-inside", (0.012, 0.012, 0.012), roughness=0.8)
    galv = lib.material("plenum", (0.35, 0.35, 0.34), roughness=0.45, metallic=0.7)

    lib.box("plenum", (2 * PLENUM, 2 * PLENUM, 0.056), (0, 0, -0.028), galv)
    lib.box("inside", (2 * 0.272, 2 * 0.272, 0.002), (0, 0, FRAME_Z[0] - 0.002), dark)

    bm = bmesh.new()
    top, bottom = FRAME_Z
    square_ring(bm, [(HALF - 0.004, top), (HALF, top - 0.004), (HALF, bottom + 0.003),
                     (HALF - 0.003, bottom), (0.272, bottom), (0.272, top)])
    mesh("frame", bm, paint)

    run, drop = SLOPE
    for a, z in CONES:
        bm = bmesh.new()
        square_ring(bm, [(a, z), (a - run, z - drop), (a - run, z - drop + T),
                         (a - T, z + T * 0.4)])
        mesh("cone", bm, paint)
    lib.box("plate", (0.16, 0.16, 0.006), (0, 0, -0.097), paint, bevel=0.002, segments=1)
    screw = lib.material("screw", (0.2, 0.2, 0.2), roughness=0.4, metallic=1)
    for x in (-1, 1):
        for y in (-1, 1):
            lib.cylinder("screw", 0.005, 0.002, (x * 0.285, y * 0.285, bottom - 0.001),
                         mat=screw, sides=6)


def vent_paint():
    """White powder coat gone ivory, black smudges blown out along the louvres, dust caught."""
    mat, n = lib.procedural("vent", 512)
    x, y, z = n.xyz()
    # Smudging: dirty air marks the louvres and the frame in a ring round the outlet.
    r = n.math("MAXIMUM", n.math("ABSOLUTE", x), n.math("ABSOLUTE", y))
    smudge = n.math("MULTIPLY", lib.smoothstep(n, n.math("SUBTRACT", 0.31, r), 0.0, 0.12),
                    lib.smoothstep(n, n.noise(9, detail=5), 0.35, 0.75))
    paint = n.mix(n.math("MULTIPLY", smudge, 0.85), (0.4, 0.38, 0.33), (0.04, 0.038, 0.035))
    n.out(**lib.weathered(n, paint, rough=0.4, chips=0.2, rust=0.3, dirt=0.7, dust=0.8,
                          edge_wear=0.4, dents=0.3, bump=0.0015, scale=0.4, seed=6))
    return mat
