"""
Wooden shipping crates: boards with gaps round a dark inside, battens and braces, skids, a lid
that can sit askew, steel corner caps and straps, nail heads, and stencilled marks.
"""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

import lib
from cargo import Field, Stencil, normal, smooth

T, BT = 0.02, 0.022  # board and batten thickness
SKID_H = 0.09
BATTEN = 0.09  # batten width

INK = (0.016, 0.015, 0.014)
RED = (0.22, 0.018, 0.014)


def made(fn, *args, **kw):
    """Runs fn and returns what it returns and every object it added to the scene."""
    before = set(bpy.context.scene.objects)
    result = fn(*args, **kw)
    return result, [o for o in bpy.context.scene.objects if o not in before]


def move(objs, m):
    """Moves objects by the matrix m (a crate set askew on a stack)."""
    for o in objs:
        o.matrix_world = m @ o.matrix_world


def turn_about(angle, shift, pivot):
    """A turn of `angle` round z through `pivot`, then a shift."""
    p = Vector(pivot)
    return (Matrix.Translation(p + Vector(shift)) @ Matrix.Rotation(angle, 4, "Z")
            @ Matrix.Translation(-p))


def disc(name, radius, at, facing, mat, sides=6):
    """A flat disc facing "x", "-x", "y", "-y" or "z": nail heads, rivets."""
    axis = {"x": (1, 0, 0), "-x": (-1, 0, 0), "y": (0, 1, 0), "-y": (0, -1, 0), "z": (0, 0, 1)}
    nrm = Vector(axis[facing])
    t = Vector((0, 0, 1)) if facing != "z" else Vector((1, 0, 0))
    b = nrm.cross(t)
    bm = bmesh.new()
    verts = [bm.verts.new(Vector(at) + radius * (t * math.cos(a) + b * math.sin(a)))
             for a in (2 * math.pi * k / sides for k in range(sides))]
    face = bm.faces.new(verts)
    bm.normal_update()
    if face.normal.dot(nrm) < 0:
        face.normal_flip()
    return lib.assign(lib._mesh_object(name, bm), mat)


def boards(span, plank, gap):
    """Board centres and width filling `span` with boards about `plank` wide, `gap` apart."""
    count = max(1, round((span + gap) / (plank + gap)))
    bw = (span + gap) / count - gap
    return [(-span / 2 + bw / 2 + i * (bw + gap)) for i in range(count)], bw


def wood_material(name, seed, size, pitch, z0, grain="planks", stencil=None, marks=(),
                  weather=0.5):
    """
    Sawn softwood boards, weathered: grain along each board, a tone of its own for each board
    (`pitch` meters apart from z0 on the walls, across y on lids), knots, grey on top and on some
    boards, dirt low, water stains. `grain`: "planks" run along x (y on faces looking along x),
    "battens" run up. `marks` = [(block, ink, [(face, h0, v0)...])], face "-y", "y", "x" or "-x":
    stencils painted after the crate was built, so over boards and battens alike.
    """
    mat, n = lib.procedural(name, size)
    f = Field(n, seed)
    nx, ny, nz = normal(n)
    on_x = smooth(n, n.math("ABSOLUTE", nx), 0.5, 0.7)
    on_top = smooth(n, n.math("ABSOLUTE", nz), 0.5, 0.7)

    if grain == "battens":
        along = f.noise(2.5, 4, stretch=(28, 28, 1))
        fine = f.noise(14, 3, stretch=(40, 40, 1))
        board = n.math("FLOOR", n.math("DIVIDE", n.math("ADD", f.x, f.y), 0.37))
        board = n.math("ADD", board, n.math("FLOOR", n.math("DIVIDE", f.z, 0.5)))
    else:
        along = n.lerp(on_x, f.noise(2.5, 4, stretch=(1, 28, 28)), f.noise(2.5, 4, stretch=(28, 1, 28)))
        fine = n.lerp(on_x, f.noise(14, 3, stretch=(1, 40, 40)), f.noise(14, 3, stretch=(40, 1, 40)))
        wall = n.math("FLOOR", n.math("DIVIDE", n.math("SUBTRACT", f.z, z0), pitch))
        lid = n.math("ADD", n.math("FLOOR", n.math("DIVIDE", f.y, pitch)), 31)
        board = n.lerp(on_top, wall, lid)
    board = n.math("ADD", board, n.math("MULTIPLY", on_x, 17))
    board = n.math("ADD", board, n.math("MULTIPLY", n.math("GREATER_THAN", n.math("ADD", nx, ny), 0), 5))
    tone = n.noise(1.0, detail=0, vector=n.vec(n.math("MULTIPLY", board, 7.31), seed * 3.7, 2.2))
    tone2 = n.noise(1.0, detail=0, vector=n.vec(n.math("MULTIPLY", board, 3.13), seed * 1.9, 8.1))

    fresh = n.mix(tone, (0.11, 0.062, 0.027), (0.2, 0.118, 0.05))
    color = n.mix(n.math("MULTIPLY", smooth(n, tone2, 0.4, 0.75), 0.8), fresh, (0.085, 0.074, 0.058))  # some greyed
    rings = smooth(n, n.math("MULTIPLY", along, fine), 0.18, 0.32)
    color = n.mix(n.math("MULTIPLY", rings, 0.45), color, (0.065, 0.038, 0.017))
    knot = smooth(n, f.noise(6, 2, stretch=(1, 3, 3) if grain == "planks" else (3, 3, 1)), 0.74, 0.78)
    color = n.mix(n.math("MULTIPLY", knot, 0.85), color, (0.045, 0.024, 0.011))
    rough = n.lerp(rings, 0.74, 0.88)
    height = n.math("ADD", n.math("MULTIPLY", rings, 0.6), n.math("MULTIPLY", knot, -0.4))
    height = n.math("ADD", height, n.math("MULTIPLY", f.noise(80, 3), 0.3))

    # Weather: grey on top, dirt round the bottom, water stains with dark rims.
    grey = n.math("MULTIPLY", n.math("MAXIMUM", on_top, 0.2),
                  n.math("MULTIPLY", f.noise(1.5, 4), weather * 1.6))
    color = n.mix(n.math("MINIMUM", grey, 0.7), color, (0.095, 0.09, 0.08))
    low = n.math("MULTIPLY", smooth(n, f.z, 0.35, 0.0), smooth(n, f.noise(3, 5), 0.3, 0.7))
    color = n.mix(n.math("MULTIPLY", low, 0.8), color, (0.028, 0.022, 0.016))
    wet = f.noise(1.1, 5)
    stain = n.math("MULTIPLY", smooth(n, wet, 0.6, 0.66), 0.5)
    rim = n.math("MULTIPLY", smooth(n, wet, 0.59, 0.6), smooth(n, wet, 0.615, 0.6))
    color = n.mix(stain, color, (0.065, 0.045, 0.028))
    color = n.mix(n.math("MULTIPLY", rim, 0.25), color, (0.04, 0.028, 0.016))
    rough = n.lerp(n.math("MAXIMUM", low, stain), rough, 0.93)

    if stencil:
        faces = {
            "-y": (smooth(n, ny, -0.5, -0.8), f.x),
            "y": (smooth(n, ny, 0.5, 0.8), n.math("MULTIPLY", f.x, -1)),
            "x": (smooth(n, nx, 0.5, 0.8), f.y),
            "-x": (smooth(n, nx, -0.5, -0.8), n.math("MULTIPLY", f.y, -1)),
        }
        # Stencil ink soaks into the grain: patchy, pale where the board is rough.
        soak = n.lerp(smooth(n, f.noise(20, 4), 0.25, 0.6), 0.7, 1.0)
        soak = n.math("MULTIPLY", soak, n.math("SUBTRACT", 1, n.math("MULTIPLY", rings, 0.25)))
        for block, ink, places in marks:
            m = 0.0
            for face, h0, v0 in places:
                where, h = faces[face]
                m = n.math("MAXIMUM", m, stencil.mask(n, block, h, f.z, h0, v0, where))
            color = n.mix(n.math("MULTIPLY", m, soak), color, ink)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0012)})
    return mat


def strap_material(name, seed, size=512):
    """Galvanised strap steel: dull spangle, white rust, brown rust at the edges."""
    mat, n = lib.procedural(name, size)
    f = Field(n, seed)
    spangle = f.noise(60, 2)
    color = n.mix(spangle, (0.17, 0.17, 0.17), (0.26, 0.26, 0.25))
    white = smooth(n, f.noise(9, 5), 0.55, 0.7)
    color = n.mix(n.math("MULTIPLY", white, 0.6), color, (0.36, 0.36, 0.33))
    rusty = smooth(n, f.noise(6, 6, 0.6), 0.6, 0.68)
    color = n.mix(rusty, color, (0.11, 0.045, 0.018))
    rough = n.lerp(rusty, n.lerp(white, n.lerp(spangle, 0.35, 0.5), 0.75), 0.9)
    n.out(**{"Base Color": color, "Roughness": rough,
             "Normal": n.bump(n.math("MULTIPLY", rusty, 0.6), distance=0.0008)})
    mat.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.5
    return mat


def materials(seed, stencil, marks, plank_size=2048, plank_pitch=0.15, z0=SKID_H, suffix="",
              shared=None):
    """
    The crate materials: boards and battens (with the stencils), and from `shared` (or new) the
    steel, inside and nails. `suffix` keeps more crates' boards apart in one model.
    """
    shared = shared or {}
    return {
        "planks": wood_material("planks" + suffix, seed, plank_size, plank_pitch, z0, "planks",
                                stencil, marks),
        "battens": wood_material("battens" + suffix, seed + 7, plank_size // 2, plank_pitch, z0,
                                 "battens", stencil, marks),
        "steel": shared.get("steel") or strap_material("steel", seed),
        "inside": shared.get("inside") or lib.material("inside", (0.012, 0.009, 0.006), roughness=0.95),
        "nail": shared.get("nail") or lib.material("nail", (0.05, 0.035, 0.025), roughness=0.6,
                                                   metallic=0.6),
    }


def crate(outer, mats, plank=0.14, gap=0.012, skids=3, lid_off=None, brace=True, seed=0,
          caps=True):
    """
    A crate filling `outer` = (w, d, h) to the outside of its battens, cleats and straps, its base
    on the origin: horizontal boards round the sides with gaps (dark inside), battens framing every
    face and a diagonal brace across the big ones, a boarded lid with two cleats and two steel
    straps over it, steel corner caps, nail heads. `lid_off` = (dx, dy, turn) knocks the lid askew.
    Returns the objects it made.
    """
    rng = random.Random(seed)
    w, d, h = outer[0] - 2 * BT, outer[1] - 2 * BT, outer[2] - BT - 0.0015
    _, body = made(_body, w, d, h, plank, gap, skids, brace, mats, rng, caps)
    _, lid = made(_lid, w, d, h, plank, gap, mats, rng, caps)
    if lid_off:
        dx, dy, turn = lid_off
        move(lid, turn_about(turn, (dx, dy, 0.004), (0, 0, h)))
    return body + lid


def _body(w, d, h, plank, gap, skids, brace, mats, rng, caps):
    pl, ba, steel, inside, nail = (mats[k] for k in ("planks", "battens", "steel", "inside", "nail"))
    for i in range(skids):
        y = -d / 2 + 0.05 + i * (d - 0.1) / max(1, skids - 1)
        lib.box("skid", (w + 2 * BT, 0.09, SKID_H), (0, y, SKID_H / 2), pl, bevel=0.004, segments=1)
    wall_h = h - SKID_H - T  # the lid's boards sit on the walls
    z0, z1 = SKID_H, SKID_H + wall_h
    lib.box("inside", (w - 2 * T - 0.002, d - 2 * T - 0.002, wall_h - 0.004),
            (0, 0, SKID_H + wall_h / 2), inside)
    zs, bw = boards(wall_h, plank, gap)
    zc = (z0 + z1) / 2
    for z in zs:
        dz = rng.uniform(-0.002, 0.002)
        for sy in (-1, 1):
            lib.box("board", (w, T, bw), (0, sy * (d / 2 - T / 2), zc + z + dz), pl)
        for sx in (-1, 1):
            lib.box("board", (T, d - 2 * T, bw), (sx * (w / 2 - T / 2), 0, zc + z + dz), pl)

    # The front and back battens cover the side battens' ends at the corners.
    for face, fw in (("y", w + 2 * BT), ("x", d)):
        for s in (-1, 1):
            out = (d / 2 if face == "y" else w / 2) + BT / 2

            def at(u, z, face=face, s=s, out=out):
                return (u, s * out, z) if face == "y" else (s * out, u, z)

            def size(su, sz, face=face):
                return (su, BT, sz) if face == "y" else (BT, su, sz)

            for u in (-fw / 2 + BATTEN / 2, fw / 2 - BATTEN / 2):
                lib.box("batten", size(BATTEN, wall_h), at(u, zc), ba, bevel=0.003, segments=1)
            for z in (z0 + BATTEN / 2, z1 - BATTEN / 2):
                lib.box("batten", size(fw - 2 * BATTEN, BATTEN), at(0, z), ba, bevel=0.003,
                        segments=1)
            # Long faces are split into bays by upright battens, each bay braced.
            n_bays = max(1, round((fw - BATTEN) / max(wall_h * 1.4, 0.8)))
            bay = (fw - BATTEN) / n_bays
            for k in range(1, n_bays):
                lib.box("batten", size(BATTEN, wall_h - 2 * BATTEN),
                        at(-fw / 2 + BATTEN / 2 + k * bay, zc), ba, bevel=0.003, segments=1)
            if brace and bay > 0.6 and wall_h > 0.5:
                for k in range(n_bays):
                    dx, dz = bay - BATTEN, wall_h - 2 * BATTEN
                    ang = math.atan2(dz, dx) * s * (1 if k % 2 == 0 else -1)
                    b = lib.box("brace", (math.hypot(dx, dz) - BATTEN * 1.15, BT, BATTEN * 0.85), (0, 0, 0),
                                ba, bevel=0.003, segments=1)
                    rot = (Matrix.Rotation(ang, 4, "Y") if face == "y"
                           else Matrix.Rotation(-ang, 4, "X") @ Matrix.Rotation(math.pi / 2, 4, "Z"))
                    u = -fw / 2 + BATTEN / 2 + (k + 0.5) * bay
                    b.matrix_world = Matrix.Translation(at(u, zc)) @ rot
            # Nails through the corner battens into each board.
            surface = (d / 2 if face == "y" else w / 2) + BT + 0.0004
            for u in (-fw / 2 + BATTEN / 2, fw / 2 - BATTEN / 2):
                for z in zs:
                    for k in (-1, 1):
                        p = list(at(u + k * 0.022, zc + z))
                        if face == "y":
                            p[1] = s * surface
                        else:
                            p[0] = s * surface
                        disc("nail", 0.0055, p, ("-" if s < 0 else "") + face, nail)
    if caps:
        # Steel corner caps round the bottom of each upright edge.
        for sx in (-1, 1):
            for sy in (-1, 1):
                z = z0 + 0.065
                lib.box("cap", (0.11, 0.003, 0.13), (sx * (w / 2 + BT - 0.055), sy * (d / 2 + BT + 0.0015), z), steel)
                lib.box("cap", (0.003, 0.11, 0.13), (sx * (w / 2 + BT + 0.0015), sy * (d / 2 + BT - 0.055), z), steel)


def _lid(w, d, h, plank, gap, mats, rng, caps):
    pl, ba, steel, nail = mats["planks"], mats["battens"], mats["steel"], mats["nail"]
    ys, bw = boards(d + 2 * BT, plank, gap * 0.5)
    for y in ys:
        lib.box("lid", (w + 2 * BT, bw, T), (0, y + rng.uniform(-0.002, 0.002), h - T / 2), pl,
                bevel=0.002, segments=1)
    for x in (-w / 2 + 0.11, w / 2 - 0.11):
        lib.box("cleat", (BATTEN, d + 2 * BT - 0.02, BT), (x, 0, h + BT / 2), ba, bevel=0.003,
                segments=1)
        for y in ys:
            disc("nail", 0.0055, (x + rng.uniform(-0.02, 0.02), y, h + BT + 0.0004), "z", nail)
    # Two steel straps over the lid and down both faces.
    for x in (-w / 4, w / 4):
        lib.box("strap", (0.032, d + 2 * BT + 0.004, 0.0015), (x, 0, h + BT + 0.0008), steel)
        for sy in (-1, 1):
            lib.box("strap", (0.032, 0.0015, 0.16), (x, sy * (d / 2 + BT + 0.0011), h + BT - 0.08), steel)
    if caps:
        for sx in (-1, 1):
            for sy in (-1, 1):
                lib.box("cap", (0.1, 0.1, 0.003),
                        (sx * (w / 2 + BT - 0.05), sy * (d / 2 + BT - 0.05), h + BT + 0.0015), steel)


def consignment(seed, consignee, place, case, po, gross):
    """A stencil sheet with the usual crate marks for one consignment."""
    return Stencil(f"crate-{seed}", {
        "up": [("@up", 0.16, False), ("THIS WAY UP", 0.04, False)],
        "fragile": [("FRAGILE", 0.075, False), ("HANDLE WITH CARE", 0.032, False)],
        "consign": [(consignee, 0.05, False), (place, 0.036, False),
                    (f"CASE {case}      PO {po}", 0.03, False),
                    (f"GROSS {gross} KG", 0.03, False)],
        "mark": [(po.split("-")[0] + "/" + case.replace(" ", ""), 0.1, False)],
        "keep": [("KEEP DRY", 0.05, False)],
    })
