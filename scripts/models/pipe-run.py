"""
Pipe run: 4 m of three pipes on strut trapezes under the ceiling: a fat one lagged in banded
canvas, a red sprinkler main with grooved couplings and a pendant head, and a thin copper line.
Open-ended along x, so runs join end to end. Hangs from its origin, on the ceiling at the middle.
"""

import math

import bmesh

import lib

ORIGIN = "model"
TRIS = 1500
AO_DISTANCE = 0.08

LENGTH = 4.0
HALF_D = 0.175  # half the strut's length, across y
BAR = 0.041
STRUT_TOP = -0.25 + BAR
HANGERS = (-1.0, 1.0)

LAG_R, LAG_Y = 0.07, -0.085
RED_R, RED_Y = 0.03, 0.035
CU_R, CU_Y = 0.011, 0.12
BANDS = (-1.5, -0.5, 0.5, 1.5)
COUPLINGS = (-LENGTH / 2 + 0.02, 0.0, LENGTH / 2 - 0.02)
SPRINKLER = 0.55


def z_on_strut(r):
    return STRUT_TOP + r


def pipe(name, r, x0, x1, y, z, mat, sides, caps=(True, True)):
    """
    A pipe along x from x0 to x1, closed only at the ends `caps` says. Pipes are split into lengths
    so each gets its own island in the texture, not one 4 m sliver; the joins need no caps.
    """
    bm = bmesh.new()
    rings = [
        [bm.verts.new((x, y + r * math.cos(a), z + r * math.sin(a)))
         for a in (2 * math.pi * (i + 0.5) / sides for i in range(sides))]
        for x in (x0, x1)
    ]
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    for ring, cap in zip(rings, caps):
        if cap:
            bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib.assign(lib._mesh_object(name, bm), mat)


def lengths(cuts):
    """(x0, x1, caps) for each length of a pipe cut at `cuts`, capped only at the run's ends."""
    xs = [-LENGTH / 2, *cuts, LENGTH / 2]
    return [(a, b, (a == xs[0], b == xs[-1])) for a, b in zip(xs, xs[1:])]


def build():
    galv = lib.material("galvanised", (0.5, 0.5, 0.5), metallic=0.6)
    galv["bake"] = 512
    n = lib.Nodes(galv)
    n.out(**lib.galvanised(n, tone=0.5, dirt=0.8, dust=1.0, white_rust=0.35, bump=0.003))
    dark = lib.material("bolt", (0.06, 0.055, 0.05), roughness=0.55, metallic=1)
    band = lib.material("band", (0.45, 0.45, 0.44), roughness=0.4, metallic=1)

    # The lagged pipe, its bands, and the red and copper pipes beside it.
    lag_z = z_on_strut(LAG_R)
    lag = lagging(lag_z)
    for x0, x1, caps in lengths((-1.0, 0.0, 1.0)):
        pipe("lagging", LAG_R, x0, x1, LAG_Y, lag_z, lag, 16, caps)
    for x in BANDS:
        pipe("band", LAG_R + 0.003, x - 0.0125, x + 0.0125, LAG_Y, lag_z, band, 16, (False, False))
    red_z = z_on_strut(RED_R)
    red = red_paint()
    for x0, x1, caps in lengths((0.0,)):
        pipe("sprinkler", RED_R, x0, x1, RED_Y, red_z, red, 12, caps)
    for x in COUPLINGS:
        lib.cylinder("coupling", RED_R + 0.008, 0.04, (x, RED_Y, red_z), axis="x", mat=red,
                     sides=12, bevel=0.003)
    cu_z = z_on_strut(CU_R)
    cu = copper()
    for x0, x1, caps in lengths((0.0,)):
        pipe("copper", CU_R, x0, x1, CU_Y, cu_z, cu, 8, caps)

    # A pendant sprinkler head under the main: a tee, the head's brass frame, a red bulb and the
    # deflector.
    brass = lib.material("brass", (0.35, 0.22, 0.07), roughness=0.4, metallic=1)
    bottom = red_z - RED_R + 0.006  # the head's deflector stops at the run's lowest point
    lib.cylinder("tee", RED_R * 0.55, 0.03, (SPRINKLER, RED_Y, bottom - 0.005), mat=red, sides=8)
    lib.cylinder("boss", 0.009, 0.01, (SPRINKLER, RED_Y, bottom - 0.025), mat=brass, sides=6)
    for dy in (-0.007, 0.007):
        lib.box("arm", (0.003, 0.003, 0.016), (SPRINKLER, RED_Y + dy, bottom - 0.038), brass)
    bulb = lib.material("bulb", (0.5, 0.02, 0.01), roughness=0.1)
    lib.cylinder("bulb", 0.0025, 0.012, (SPRINKLER, RED_Y, bottom - 0.037), mat=bulb, sides=6)
    lib.cylinder("deflector", 0.016, 0.002, (SPRINKLER, RED_Y, bottom - 0.047), mat=brass,
                 sides=10)

    # Strut trapezes on threaded rods, a U-bolt over each small pipe, a saddle under the lagging.
    channel = [
        (-BAR / 2, 0), (BAR / 2, 0), (BAR / 2, -BAR), (0.01, -BAR), (0.01, -BAR + 0.006),
        (BAR / 2 - 0.003, -BAR + 0.006), (BAR / 2 - 0.003, -0.003), (-BAR / 2 + 0.003, -0.003),
        (-BAR / 2 + 0.003, -BAR + 0.006), (-0.01, -BAR + 0.006), (-0.01, -BAR), (-BAR / 2, -BAR),
    ]
    rod = lib.material("rod", (0.12, 0.1, 0.08), roughness=0.6, metallic=1)
    for x in HANGERS:
        lib.shape("strut", [(x + u, STRUT_TOP + v) for u, v in channel], depth=2 * HALF_D,
                  mat=galv, facing="-y")
        for y in (-1, 1):
            ry = y * (HALF_D - 0.012)
            lib.cylinder("rod", 0.005, 0.247, (x, ry, -0.1255), mat=rod, sides=6)
            lib.cylinder("nut", 0.009, 0.007, (x, ry, STRUT_TOP + 0.0035), mat=dark, sides=6)
        for r, y, z in ((RED_R, RED_Y, red_z), (CU_R, CU_Y, cu_z)):
            w = r + 0.004
            arc = [(x, y - w, STRUT_TOP - 0.01)] + [
                (x, y - w * math.cos(a), z + w * math.sin(a))
                for a in (math.radians(d) for d in (0, 45, 90, 135, 180))
            ] + [(x, y + w, STRUT_TOP - 0.01)]
            lib.tube("ubolt", arc, [0.003] * len(arc), mat=dark, sides=4)
        lib.box("saddle", (0.1, 0.06, 0.02), (x, LAG_Y, STRUT_TOP + 0.006), galv, bevel=0.003,
                segments=1)


def lagging(cz):
    """
    Canvas-wrapped insulation painted pale grey, in metre sections with butt joints and an
    overlapped seam along the top; sagged and grubby, black with dust on top, stained below.
    """
    mat, n = lib.procedural("lagging", 1024)
    x, y, z = n.xyz()
    joint = n.math("LESS_THAN", n.math("ABSOLUTE", n.math("SUBTRACT", n.math("FRACT", n.math(
        "ADD", x, 0.5)), 0.5)), 0.004)
    angle = n.math("ARCTAN2", n.math("SUBTRACT", z, cz), n.math("SUBTRACT", y, LAG_Y))
    seam = lib.smoothstep(n, n.math("SUBTRACT", 0.04, n.math("ABSOLUTE", n.math("SUBTRACT", angle,
                                                                                   1.2))), 0, 0.01)
    weave = n.math("MULTIPLY", n.stripes(n.math("ADD", x, y), 0.004), n.stripes(
        n.math("SUBTRACT", x, z), 0.004))
    stain = lib.smoothstep(n, n.noise(3, detail=4), 0.55, 0.75)
    below = lib.smoothstep(n, n.math("SUBTRACT", cz - 0.02, z), 0, 0.05)
    canvas = n.mix(n.math("MULTIPLY", weave, 0.3), (0.3, 0.29, 0.26), (0.24, 0.23, 0.2))
    canvas = n.mix(n.math("MULTIPLY", n.math("MULTIPLY", stain, below), 0.8), canvas,
                   (0.16, 0.11, 0.06))
    canvas = n.mix(joint, canvas, (0.06, 0.055, 0.05))
    height = n.math("ADD", n.math("MULTIPLY", weave, 0.15),
                    n.math("SUBTRACT", n.math("MULTIPLY", seam, 0.5), n.math("MULTIPLY", joint, 0.8)))
    out = lib.weathered(n, canvas, rough=0.85, chips=0.0, rust=0.0, dirt=0.8, dust=1.0,
                        edge_wear=0.0, dents=1.5, height=height, bump=0.004, scale=1.5)
    out["Roughness"] = n.math("MAXIMUM", out["Roughness"], 0.75)
    n.out(**out)
    return mat


def red_paint():
    """Signal red enamel on steel, dulled with grime, chipped to rust at the couplings."""
    mat, n = lib.procedural("red", 1024)
    n.out(**lib.weathered(n, (0.3, 0.012, 0.008), rough=0.38, chips=0.6, rust=0.8, dirt=0.8,
                          dust=1.0, edge_wear=0.9, dents=0.4, bump=0.002, scale=0.5, seed=3))
    return mat


def copper():
    """Copper gone brown, with green verdigris in streaks from the salt air."""
    mat, n = lib.procedural("copper", 512)
    n.bsdf.inputs["Metallic"].default_value = 0.7
    streak = lib.smoothstep(n, n.noise(4, detail=5), 0.55, 0.7)
    tarnish = n.noise(30, detail=3)
    color = n.mix(tarnish, (0.2, 0.07, 0.03), (0.32, 0.13, 0.06))
    color = n.mix(streak, color, (0.08, 0.22, 0.15))
    rough = n.lerp(streak, n.lerp(tarnish, 0.3, 0.5), 0.85)
    n.out(**{"Base Color": color, "Roughness": rough,
             "Normal": n.bump(n.math("MULTIPLY", streak, 0.5), distance=0.001)})
    return mat
