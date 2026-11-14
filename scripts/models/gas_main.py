"""
Shared by the gas main's pieces (gas-pipe, gas-pipe-corner, gas-pipe-valve): a fat steel main in
chipped yellow paint, 0.54 m across, with bolted flanges, on saddle stands. Not a model itself: it
has no build().

The pieces run along x with the pipe's axis AXIS above the floor, and end in a flange whose face is
the piece's end, so pieces put end to end make a bolted joint. Their origin is on the floor.
"""

import math

import backroom as br
import lib

AXIS = 0.9  # the pipe's axis above the floor
R = 0.27  # the pipe's radius
BORE = 0.25
FLANGE_R = 0.36
FLANGE_T = 0.045
BOLT_R = 0.326  # the bolt circle
BOLTS = 12
END = 0.3  # the length of pipe that comes with a flange (pipe_end)
SIDES = 24


def materials():
    """(paint, stand, bolt, wheel): the main's yellow, the stands' black, rusty bolts, red enamel."""
    paint = br.paint("main", (0.3, 0.17, 0.014), wear=2.3, rust=2.0, gloss=0.5, chalky=0.3, grime=1.4)
    stand = br.paint("stand", (0.035, 0.037, 0.04), size=512, wear=1.3, rust=1.2, gloss=0.5)
    bolt = lib.material("bolt", (0.075, 0.04, 0.025), roughness=0.75, metallic=0.7)
    wheel = br.paint("wheel", (0.3, 0.012, 0.008), size=512, wear=1.2, rust=1.0, gloss=0.38)
    return paint, stand, bolt, wheel


def _tag(obj, seed):
    return br.tag(obj, (0.3, 0.3, 0.3), seed)


def _point(axis, t, u, v):
    """A point `t` along `axis` and (u, v) across it."""
    return {"x": (t, u, v), "y": (u, t, v), "z": (u, v, t)}[axis]


def _add(a, b):
    return tuple(p + q for p, q in zip(a, b))


def bolts(at, axis, out, mat, count=BOLTS, circle=BOLT_R, size=0.022, first=0.5):
    """
    Nuts on their studs round a flange: `at` is the middle of the flange's face that they sit on,
    `out` (1 or -1) the way that face looks along `axis`.
    """
    for i in range(count):
        a = 2 * math.pi * (i + first) / count
        u, v = circle * math.cos(a), circle * math.sin(a)
        lib.cylinder("nut", size, size, _add(at, _point(axis, out * size / 2, u, v)), axis=axis,
                     mat=mat, sides=6)
        lib.cylinder("stud", size * 0.5, size * 0.8,
                     _add(at, _point(axis, out * size * 1.3, u, v)), axis=axis, mat=mat, sides=6)


def pipe_end(face, axis, out, paint, bolt, seed=0.0):
    """
    The last END of a pipe along `axis` and its flange, whose face is at `face` looking `out` (1 or
    -1): a weld bead where it meets the pipe, a hub, the flange with its nuts behind, and the bore.
    """
    f, t = FLANGE_R, FLANGE_T
    profile = [
        (-END, R - 0.01), (-END, R + 0.007), (-END + 0.022, R + 0.007), (-END + 0.03, R),
        (-t - 0.05, R), (-t, R + 0.03), (-t, f - 0.004), (-t + 0.004, f), (-0.004, f),
        (0, f - 0.004), (0, BORE), (-0.28, BORE),
    ]
    _tag(lib.lathe("pipe-end", [(out * a, r) for a, r in profile], face, axis=axis, mat=paint,
                   sides=SIDES, caps=(False, True)), seed)
    bolts(_add(face, _point(axis, -out * t, 0, 0)), axis, -out, bolt)


def bead(at, axis, paint, r=R):
    """A weld bead round a pipe of radius `r`, where two lengths meet."""
    profile = [(-0.014, r - 0.01), (-0.011, r + 0.006), (0.011, r + 0.006), (0.014, r - 0.01)]
    return lib.lathe("weld", profile, at, axis=axis, mat=paint, sides=SIDES, caps=(False, False))


def _band(name, x0, x1, r0, r1, a0, a1, mat, steps=10):
    """A plate bent round the x axis at height AXIS: from radius r0 to r1, angle a0 to a1 (degrees)."""
    verts, faces = [], []
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        c, s = math.cos(a), math.sin(a)
        verts += [(x0, r0 * c, AXIS + r0 * s), (x1, r0 * c, AXIS + r0 * s),
                  (x0, r1 * c, AXIS + r1 * s), (x1, r1 * c, AXIS + r1 * s)]
    for i in range(steps):
        k = 4 * i
        faces += [(k + 2, k + 3, k + 7, k + 6), (k, k + 4, k + 5, k + 1),
                  (k, k + 2, k + 6, k + 4), (k + 1, k + 5, k + 7, k + 3)]
    e = 4 * steps
    faces += [(0, 1, 3, 2), (e, e + 2, e + 3, e + 1)]
    obj = br.mesh_object(name, verts, faces, mat)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def stand(x, stand_mat, bolt, r=R, seed=0.0):
    """
    A saddle stand under the pipe at `x`: a base plate bolted to the floor, a web and a rib up to
    a cradle the pipe lies in, and a strap over the top.
    """
    w = 0.16  # along the pipe
    br.part("base-plate", (w + 0.06, 0.56, 0.016), (x, 0, 0.008), stand_mat, seed, bevel=0.003)
    rs = r + 0.012
    arc = [(rs * math.cos(a), AXIS + rs * math.sin(a))
           for a in (math.radians(d) for d in range(325, 214, -10))]
    outline = [(-0.23, 0.016), (0.23, 0.016), *arc]
    for dx in (-w / 2 + 0.006, w / 2 - 0.006):
        _tag(lib.shape("web", outline, (x + dx, 0, 0), depth=0.012, mat=stand_mat, facing="x"),
             seed + 0.1)
    rib_top = AXIS - rs
    br.part("rib", (w - 0.02, 0.012, rib_top - 0.016), (x, 0, (rib_top + 0.016) / 2), stand_mat,
            seed + 0.2)
    _tag(_band("cradle", x - w / 2 - 0.02, x + w / 2 + 0.02, r + 0.001, r + 0.013, 205, 335,
               stand_mat), seed + 0.3)
    _tag(_band("strap", x - 0.03, x + 0.03, r + 0.001, r + 0.008, -25, 205, stand_mat, steps=16),
         seed + 0.4)
    for sy in (-1, 1):
        # The strap's lugs, bolted down to the cradle's ears.
        a = math.radians(-25 if sy > 0 else 205)
        ly, lz = (r + 0.03) * math.cos(a), AXIS + (r + 0.03) * math.sin(a)
        br.part("lug", (0.07, 0.07, 0.012), (x, ly, lz), stand_mat, seed + 0.5)
        lib.cylinder("lug-nut", 0.014, 0.022, (x, ly, lz + 0.012), mat=bolt, sides=6)
        for sx in (-1, 1):
            lib.cylinder("anchor", 0.015, 0.02, (x + sx * 0.075, sy * 0.24, 0.024), mat=bolt,
                         sides=6)


def pipe(x0, x1, paint, seed=0.0):
    """A plain length of the pipe along x, between two pipe_end()s or beads."""
    return _tag(lib.tube("pipe", [(x0, 0, AXIS), (x1, 0, AXIS)], [R, R], mat=paint, sides=SIDES),
                seed)
