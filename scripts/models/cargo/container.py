"""A 20 ft ISO container, built from a few parameters: geometry, wear and stencils."""

import math
import random

import bpy
from mathutils import Matrix, Vector

import lib
from cargo import Field, Stencil, corrugation, dent_at, dents, normal, painted_wear, smooth,     stencilled, sweep

# --- The container ------------------------------------------------------------------------------

W, L, H = 2.44, 6.06, 2.59  # x across, y along (doors at -y), z up
CAST = (0.162, 0.178, 0.118)  # a corner casting, x × y × z
SIDE_PITCH, SIDE_DEPTH = 0.278, 0.036
ROOF_PITCH, ROOF_DEPTH = 0.226, 0.02
RAIL_TOP, RAIL_BOTTOM = 2.47, 0.168  # the side wall runs between the rails
POCKETS = (-1.03, 1.03)  # forklift pockets, centred along y
POCKET = (0.36, 0.115)
DOOR_Y = -L / 2 + 0.078  # the face of the closed doors' frames
POST_REAR = 0.115  # how wide the rear corner posts show beside the doors
SILL, HEADER = 0.205, 2.37  # the door opening's bottom and top
BARS = (0.3, 0.84)  # locking bars, meters out from the middle on each door


def container(seed, paint, code, logo=None, wear=0.5, rust=0.5, chalk=0.3, n_dents=4,
              ink=(0.6, 0.6, 0.57), size_type="22G1", painted_out=False, reefer=False,
              open_doors=False, breach=None):
    """
    A 20 ft ISO container, doors shut, its doors at -y. `code` is the owner code, serial and check
    digit; `logo` an owner's name painted big along both sides, or `painted_out` a block of fresher
    paint where a sold container's old name was. wear, rust and chalk go 0 to 1.

    `reefer`: a refrigerated container, finer ribs, its blind end the refrigeration unit.
    `open_doors`: both doors swung open a quarter turn, standing straight back from the hinges (so
    within its width, 1.1 m behind it), showing the dark inside and broken cargo.
    `breach`: (y, z) of a hole torn low in the +x side, as by forklift tines, with the wall round
    it pushed in.
    """
    side_pitch, side_depth = (0.12, 0.014) if reefer else (SIDE_PITCH, SIDE_DEPTH)
    rng = random.Random(seed)
    lines = [("MAX.GROSS  30,480 KG", 0.034, False), ("                 67,200 LB", 0.034, False),
             ("TARE           2,220 KG", 0.034, False), ("                   4,890 LB", 0.034, False),
             ("NET          28,260 KG", 0.034, False), ("                 62,310 LB", 0.034, False),
             ("CU.CAP.     33.2 CU.M", 0.034, False), ("               1,172 CU.FT", 0.034, False)]
    blocks = {"code": [(f"{code[0]} {code[1]} {code[2]}", 0.105, True), (size_type, 0.105, False)],
              "weights": lines}
    if logo:
        blocks["logo"] = [(logo, 0.42, False)]
    stencil = Stencil(f"container-{seed}", blocks)
    mats = {
        "body": body_material(seed, paint, stencil, logo, wear, rust, chalk, ink, painted_out),
        "roof": roof_material(seed, paint, wear, rust, chalk),
        "doors": door_material(seed, paint, stencil, wear, rust, chalk, ink),
        "hardware": hardware_material(seed, paint, wear, rust),
        "seal": lib.material("seal", (0.012, 0.012, 0.012), roughness=0.8),
        "hole": lib.material("hole", (0.006, 0.005, 0.005), roughness=0.9),
    }
    if reefer:
        mats["unit"] = unit_material(seed, wear)
        mats["display"] = lib.material("glow-display", (0.02, 0.1, 0.06),
                                       emission=(0.25, 1.0, 0.55), strength=3.0)
        mats["cable"] = lib.material("cable", (0.02, 0.02, 0.02), roughness=0.6)
    if open_doors:
        mats["inside"] = lib.material("inside", (0.03, 0.028, 0.025), roughness=0.85)
        mats["floor"] = lib.material("floor", (0.06, 0.035, 0.018), roughness=0.8)
        mats["wood"] = crate_wood(seed)
    body = mats["body"]

    # Side walls, corrugated along y, dented.
    y0, y1 = -L / 2 + POST_REAR + 0.045, L / 2 - 0.13
    flats = (0.031, 0.029) if reefer else (0.072, 0.068)
    section = corrugation(y0, y1, side_pitch, side_depth, *flats, phase=0.02)
    zs = [RAIL_BOTTOM - 0.01, 0.75, 1.3, 1.85, RAIL_TOP + 0.01]
    if breach:
        zs = sorted(set(zs + [breach[1] + dz for dz in (-0.45, -0.25, 0.0, 0.25, 0.45)]))
    for side in (-1, 1):
        dl = dents(rng, n_dents, (y0 + 0.4, y1 - 0.4), (0.4, 2.2), (0.25, 0.6), (0.006, 0.026))
        if breach and side > 0:
            dl.append((breach[0], breach[1], 0.75, 0.16))

        def wall(y, d, z, side=side, dl=dl):
            return Vector((side * (W / 2 - 0.006 - d - dent_at(dl, y, z)), y, z))

        sweep("side", section, zs, wall, body, out=(side, 0, 0))

    # The front (blind) end wall, corrugated across x, or a reefer's refrigeration unit.
    x0, x1 = -W / 2 + 0.13, W / 2 - 0.13
    if reefer:
        reefer_unit(mats)
    else:
        section = corrugation(x0, x1, SIDE_PITCH, SIDE_DEPTH, 0.072, 0.068, phase=0.035)
        dl = dents(rng, 2, (x0 + 0.3, x1 - 0.3), (0.5, 2.0), (0.25, 0.45), (0.004, 0.015))
        sweep("end", section, [0.15, 0.9, 1.7, H - 0.11],
              lambda x, d, z: Vector((x, L / 2 - 0.006 - d - dent_at(dl, x, z), z)), body,
              out=(0, 1, 0))

    # The roof, shallow corrugation across the width, a hair below the castings.
    ry0, ry1 = -L / 2 + 0.1, L / 2 - 0.07
    section = corrugation(ry0, ry1, ROOF_PITCH, ROOF_DEPTH, 0.06, 0.06)
    sweep("roof", section, [-W / 2 + 0.06, W / 2 - 0.06],
          lambda y, d, x: Vector((x, y, H - 0.012 - d)), mats["roof"], out=(0, 0, 1))

    frame(body, mats)
    doors(mats, open_doors)
    if open_doors:
        interior(mats, rng)
    if breach:
        torn(mats, breach)


def _turned(make, pivot, matrix):
    """Make some objects with `make()`, then transform them by `matrix` about the point `pivot`."""
    before = set(bpy.data.objects)
    make()
    whole = Matrix.Translation(Vector(pivot)) @ matrix @ Matrix.Translation(-Vector(pivot))
    for obj in set(bpy.data.objects) - before:
        if obj.type == "MESH":
            obj.data.transform(whole)
            obj.data.update()


def _spin(angle):
    """A turn round z, as seen from above: anticlockwise for a positive angle."""
    return Matrix.Rotation(angle, 4, "Z")


def reefer_unit(mats):
    """
    The refrigeration unit filling a reefer's blind end (+y), set in its frame: a condenser grille
    with a fan behind a guard below, access panels and the controller above, whose display glows,
    and the power cable coiled on its hook.
    """
    unit, hole, hw = mats["unit"], mats["hole"], mats["hardware"]
    face = L / 2 - 0.08  # set back in the end frame, so nothing stands out past the castings
    x0, x1 = -W / 2 + 0.13, W / 2 - 0.13
    width = x1 - x0
    # The unit's back, recessed: the dark machinery behind everything.
    lib.box("unit-back", (width, 0.02, H - 0.26), (0, face - 0.2, H / 2), hole)
    # A frame round it, flush with the end, and a rail between the grille and the panels.
    for z, h in ((0.18, 0.06), (H - 0.14, 0.06), (1.12, 0.07)):
        lib.box("unit-rail", (width, 0.2, h), (0, face - 0.1, z), unit, bevel=0.004, segments=1)
    # Below: the condenser grille's louvres on the left, the fan's round guard on the right.
    grille = width * 0.52
    for k in range(17):
        lib.box("louvre", (grille, 0.05, 0.012), (x0 + grille / 2, face - 0.04, 0.26 + k * 0.05),
                unit)
    lib.box("grille-side", (0.05, 0.2, 0.9), (x0 + grille + 0.025, face - 0.1, 0.67), unit)
    fx, fz = x0 + grille + 0.05 + (width - grille - 0.05) / 2, 0.66
    lib.cylinder("fan-ring", 0.4, 0.06, (fx, face - 0.03, fz), axis="y", mat=unit, sides=32,
                 bevel=0.01)
    lib.cylinder("fan-dark", 0.36, 0.062, (fx, face - 0.035, fz), axis="y", mat=hole, sides=32)
    for a in range(5):
        _turned(lambda: lib.box("fan-blade", (0.07, 0.012, 0.3), (fx, face - 0.09, fz + 0.18), hw),
                (fx, 0, fz), Matrix.Rotation(a * math.tau / 5 + 0.3, 4, "Y"))
    for k in range(-3, 4):
        lib.box("guard", (0.74, 0.012, 0.01), (fx, face - 0.002, fz + k * 0.1), hw)
    lib.cylinder("hub", 0.07, 0.08, (fx, face - 0.06, fz), axis="y", mat=hw, sides=16)
    # Above: two access panels with handles and bolts, and the controller beside them.
    for x in (x0 + 0.38, x0 + 1.04):
        lib.box("panel", (0.6, 0.03, 1.02), (x, face - 0.02, 1.72), unit, bevel=0.01, segments=2)
        lib.box("handle", (0.14, 0.03, 0.025), (x, face + 0.005, 1.5), hw, bevel=0.006,
                segments=1)
        for dx in (-0.26, 0.26):
            for dz in (-0.46, 0.46):
                lib.cylinder("bolt", 0.012, 0.015, (x + dx, face - 0.004, 1.72 + dz), axis="y",
                             mat=hw, sides=6)
    cx = x1 - 0.27
    lib.box("controller", (0.42, 0.12, 0.5), (cx, face - 0.02, 1.62), unit, bevel=0.012,
            segments=2)
    lib.box("display", (0.18, 0.01, 0.07), (cx, face + 0.042, 1.72), mats["display"])
    for k in range(4):
        lib.box("key", (0.035, 0.012, 0.03), (cx - 0.075 + k * 0.05, face + 0.042, 1.6), hw)
    lib.box("data-plate", (0.24, 0.004, 0.15), (cx, face + 0.042, 1.45), hw)
    # The power cable, coiled round a hook above the controller.
    hook_z = 2.12
    lib.box("hook", (0.05, 0.07, 0.03), (cx, face + 0.02, hook_z + 0.13), hw)
    for k in range(3):
        r = 0.13 + k * 0.012
        points = [(cx + r * math.sin(a) * 0.9, face + 0.035 + k * 0.012, hook_z - r * math.cos(a))
                  for a in [i * math.tau / 16 for i in range(17)]]
        lib.tube("cable", points, [0.016] * len(points), mats["cable"], sides=6)


def interior(mats, rng):
    """
    The inside, seen through the open doors: plywood floor, dark walls and roof, and cargo that
    broke open: crates at the far end, one knocked over, split boards towards the doors.
    """
    inside, floor, wood = mats["inside"], mats["floor"], mats["wood"]
    z0 = 0.17
    lib.box("floor", (W - 0.1, L - 0.22, 0.03), (0, 0.03, z0), floor)
    for sx in (-1, 1):
        lib.box("lining", (0.02, L - 0.24, H - 0.42), (sx * (W / 2 - 0.06), 0.03, H / 2), inside)
    lib.box("lining-end", (W - 0.12, 0.02, H - 0.42), (0, L / 2 - 0.12, H / 2), inside)
    lib.box("lining-roof", (W - 0.12, L - 0.24, 0.02), (0, 0.03, H - 0.2), inside)
    for x, y, w, d, h, up, turn in (
        (-0.55, 2.3, 1.0, 1.1, 1.0, 0.0, 0.0), (0.55, 2.4, 1.0, 0.9, 1.2, 0.0, 0.05),
        (-0.5, 2.3, 0.8, 0.8, 0.7, 1.0, 0.1), (0.35, 1.05, 1.1, 0.8, 0.75, 0.0, 0.6),
    ):
        _turned(lambda: lib.box("case", (w, d, h), (x, y, z0 + up + h / 2), wood, bevel=0.01,
                                segments=1), (x, y, 0), _spin(turn))
    for k in range(9):
        x, y = rng.uniform(-0.9, 0.9), rng.uniform(-2.4, 0.4)
        length = rng.uniform(0.5, 1.2)
        _turned(lambda: lib.box("board", (0.12, length, 0.02), (x, y, z0 + 0.03 + k * 0.004), wood),
                (x, y, 0), _spin(rng.uniform(0, math.pi)))


def torn(mats, breach):
    """The hole the tines tore in the +x side: a ragged dark gap with steel curled at its edges."""
    y, z = breach
    x = W / 2 - 0.006 - SIDE_DEPTH - 0.14
    points = [(-0.34, -0.08), (-0.16, -0.2), (0.07, -0.12), (0.3, -0.2), (0.42, 0.0),
              (0.26, 0.1), (0.1, 0.24), (-0.12, 0.13), (-0.3, 0.19), (-0.4, 0.04)]
    lib.shape("tear", points, (x, y, z), depth=0.03, mat=mats["hole"], facing="x")
    for u, v in points[::2]:
        lib.shape("lip", [(0, 0), (0.07, 0.02), (0.03, 0.06)], (x + 0.005, y - u, z + v),
                  depth=0.004, mat=mats["body"], facing="x")


def frame(body, mats):
    """Corner castings and posts, side rails, the front end's rails, the rear sill and header."""
    hole = mats["hole"]
    cx, cy, cz = CAST
    for sx in (-1, 1):
        for sy in (-1, 1):
            for top in (False, True):
                z = H - cz / 2 if top else cz / 2
                at = (sx * (W / 2 - cx / 2), sy * (L / 2 - cy / 2), z)
                lib.box("casting", CAST, at, body, bevel=0.008, segments=1)
                # Oval holes in the side, the end and the top.
                lib.box("hole", (0.003, 0.064, 0.032), (sx * (W / 2 + 0.0005), at[1], z), hole)
                lib.box("hole", (0.056, 0.003, 0.032), (at[0], sy * (L / 2 + 0.0005), z), hole)
                if top:
                    lib.box("hole", (0.05, 0.11, 0.003), (at[0], at[1], H + 0.0005), hole)
            # Corner posts between the castings.
            pw, pd = (POST_REAR, 0.16) if sy < 0 else (0.13, 0.13)
            lib.box("post", (pw, pd, H - 2 * cz),
                    (sx * (W / 2 - 0.004 - pw / 2), sy * (L / 2 - 0.004 - pd / 2), H / 2), body,
                    bevel=0.004, segments=1)
        # Side rails, with the forklift pockets in the bottom one.
        span = L - 2 * cy
        lib.box("top-rail", (0.06, span, 0.1), (sx * (W / 2 - 0.033), 0, RAIL_TOP + 0.05), body,
                bevel=0.004, segments=1)
        pw, ph = POCKET
        cuts = sorted([-L / 2 + cy, L / 2 - cy] + [p + s * pw / 2 for p in POCKETS for s in (-1, 1)])
        for a, b in zip(cuts[::2], cuts[1::2]):
            lib.box("bottom-rail", (0.05, b - a, RAIL_BOTTOM - 0.012),
                    (sx * (W / 2 - 0.028), (a + b) / 2, (RAIL_BOTTOM + 0.012) / 2), body,
                    bevel=0.003, segments=1)
        for p in POCKETS:
            # Over the pocket the rail goes on; round it a frame; inside, the dark tunnel.
            top_h = RAIL_BOTTOM - 0.012 - ph
            lib.box("pocket-top", (0.06, pw + 0.04, top_h),
                    (sx * (W / 2 - 0.03), p, 0.012 + ph + top_h / 2), body, bevel=0.003,
                    segments=1)
            for s in (-1, 1):
                lib.box("pocket-side", (0.06, 0.02, ph),
                        (sx * (W / 2 - 0.03), p + s * (pw / 2 + 0.01), 0.012 + ph / 2), body)
            lib.box("pocket", (0.004, pw, ph), (sx * (W / 2 - 0.07), p, 0.012 + ph / 2), hole)
    # The front end: top and bottom rails between the castings.
    span = W - 2 * cx
    lib.box("front-top", (span, 0.07, 0.11), (0, L / 2 - 0.036, H - 0.055), body, bevel=0.004,
            segments=1)
    lib.box("front-bottom", (span, 0.07, 0.15), (0, L / 2 - 0.036, 0.087), body, bevel=0.004,
            segments=1)
    # The rear: sill and header round the door opening.
    lib.box("sill", (span, 0.1, SILL - 0.012), (0, -L / 2 + 0.05, (SILL + 0.012) / 2), body,
            bevel=0.004, segments=1)
    lib.box("header", (span, 0.1, H - HEADER), (0, -L / 2 + 0.05, (H + HEADER) / 2), body,
            bevel=0.004, segments=1)


def doors(mats, open_doors=False):
    """
    Two door leaves with horizontal corrugation, locking bars, cams, handles and hinges; open, each
    swung a quarter turn out round its hinges, with its inside face showing.
    """
    x_out = W / 2 - POST_REAR - 0.004
    z0, z1 = SILL + 0.004, HEADER - 0.004
    for s in (-1, 1):
        if open_doors:
            hinge = (s * (x_out + 0.05), DOOR_Y - 0.016, 0)
            _turned(lambda s=s: _leaf(mats, s, x_out, z0, z1, True), hinge, _spin(s * math.pi / 2))
        else:
            _leaf(mats, s, x_out, z0, z1, False)
    # The CSC plate on the left door.
    if not open_doors:
        lib.box("csc", (0.2, 0.004, 0.12), (-0.62, DOOR_Y - 0.001, 1.45), mats["doors"],
                bevel=0.002)


def _leaf(mats, s, x_out, z0, z1, backed):
    """One door leaf, shut, on side `s`; `backed` gives it a flat inside face, for when it's open."""
    door, hw, seal = mats["doors"], mats["hardware"], mats["seal"]
    xi, xo = s * 0.006, s * x_out
    xm = (xi + xo) / 2
    lw = abs(xo - xi)
    # The leaf's frame: stiles and rails.
    for x in (xi + s * 0.035, xo - s * 0.035):
        lib.box("stile", (0.07, 0.045, z1 - z0), (x, DOOR_Y + 0.0225, (z0 + z1) / 2), door,
                bevel=0.003, segments=1)
    for z in (z0 + 0.06, z1 - 0.06):
        lib.box("rail", (lw - 0.14, 0.045, 0.12), (xm, DOOR_Y + 0.0225, z), door, bevel=0.003,
                segments=1)
    # The panel: corrugated in z, set back in the frame.
    section = corrugation(z0 + 0.12, z1 - 0.12, 0.44, 0.03, 0.17, 0.15, phase=0.06)
    lo, hi = sorted((xi + s * 0.07, xo - s * 0.07))
    sweep("panel", section, [lo, hi], lambda z, d, x: Vector((x, DOOR_Y + 0.008 + d, z)), door,
          out=(0, -1, 0))
    # The rubber seal, showing at the leaf's edges.
    lib.box("seal", (0.008, 0.03, z1 - z0), (xi - s * 0.002, DOOR_Y + 0.03, (z0 + z1) / 2), seal)
    lib.box("seal", (0.01, 0.03, z1 - z0), (xo + s * 0.006, DOOR_Y + 0.03, (z0 + z1) / 2), seal)
    # Hinges on the outer edge.
    for z in (0.45, 1.05, 1.65, 2.2):
        lib.box("hinge", (0.09, 0.03, 0.09), (xo + s * 0.01, DOOR_Y - 0.012, z), hw)
        lib.cylinder("pin", 0.016, 0.13, (xo + s * 0.05, DOOR_Y - 0.016, z), mat=hw, sides=6)
    # Locking bars.
    by = DOOR_Y - 0.03
    for k, bx in enumerate(BARS):
        x = s * bx
        lib.cylinder("bar", 0.019, HEADER - SILL + 0.1, (x, by, (SILL + HEADER) / 2), mat=hw,
                     sides=8)
        for z, up in ((SILL - 0.03, False), (HEADER + 0.03, True)):
            lib.box("cam", (0.05, 0.05, 0.06), (x, by, z), hw)
            lib.box("keeper", (0.1, 0.06, 0.08), (x, by + 0.01, z + (0.06 if up else -0.05)), hw)
        for z in (0.75, 1.85):
            lib.box("guide", (0.07, 0.05, 0.04), (x, by + 0.008, z), hw)
        # The handle, folded flat towards the hinges, caught in its retainer.
        hz = 1.08 + 0.05 * k
        reach = 0.3 if k == 0 else 0.2
        lib.box("hub", (0.06, 0.05, 0.08), (x, by - 0.01, hz), hw)
        lib.box("handle", (reach, 0.03, 0.035), (x + s * reach / 2, by - 0.035, hz), hw,
                bevel=0.006, segments=1)
        lib.box("retainer", (0.04, 0.035, 0.07), (x + s * (reach - 0.02), by - 0.004, hz), hw)
    if backed:
        lib.box("leaf-back", (lw - 0.04, 0.012, z1 - z0 - 0.04),
                (xm, DOOR_Y + 0.046, (z0 + z1) / 2), door)


def _setup(name, seed, size):
    mat, n = lib.procedural(name, size)
    return mat, n, Field(n, seed)


def body_material(seed, paint, stencil, logo, wear, rust, chalk, ink, painted_out=False):
    """Walls, posts, rails and castings, with the owner code on the sides and the end."""
    mat, n, f = _setup("body", seed, 2048)
    nx, ny, _ = normal(n)
    ax, ay = n.math("ABSOLUTE", f.x), n.math("ABSOLUTE", f.y)
    # Valleys of the corrugation: how far in from the outer flats.
    side = n.math("MULTIPLY", smooth(n, n.math("ABSOLUTE", nx), 0.5, 0.8),
                  n.inside(ay, 0, L / 2 - 0.16))
    end = n.math("MULTIPLY", smooth(n, ny, 0.5, 0.8), n.inside(ax, 0, W / 2 - 0.14))
    in_side = n.math("DIVIDE", n.math("SUBTRACT", W / 2 - 0.006, ax), SIDE_DEPTH)
    in_end = n.math("DIVIDE", n.math("SUBTRACT", L / 2 - 0.006, f.y), SIDE_DEPTH)
    recess = n.math("ADD", n.math("MULTIPLY", side, in_side), n.math("MULTIPLY", end, in_end))
    recess = n.math("MINIMUM", n.math("MAXIMUM", recess, 0.0), 1.0)
    # Near the frame and the castings, where knocks land.
    near_x = smooth(n, ax, W / 2 - 0.25, W / 2)
    near_y = smooth(n, ay, L / 2 - 0.3, L / 2)
    near_z = n.math("MAXIMUM", smooth(n, f.z, 0.35, 0.0), smooth(n, f.z, H - 0.25, H))
    edge = n.math("MAXIMUM", n.math("MULTIPLY", near_x, near_y),
                  n.math("MULTIPLY", n.math("MAXIMUM", near_x, near_y), near_z))
    color, rough, height = painted_wear(n, f, paint, wear, rust, chalk, top=RAIL_TOP, recess=recess,
                                        edge=edge)

    # Stencils: the code near the door end of each side and on the end, the logo along the sides.
    on_px = n.math("MULTIPLY", smooth(n, nx, 0.5, 0.8), n.math("GREATER_THAN", f.x, W / 2 - 0.06))
    on_nx = n.math("MULTIPLY", smooth(n, nx, -0.5, -0.8), n.math("LESS_THAN", f.x, -W / 2 + 0.06))
    on_end = n.math("MULTIPLY", smooth(n, ny, 0.5, 0.8), n.math("GREATER_THAN", f.y, L / 2 - 0.06))
    neg_y = n.math("MULTIPLY", f.y, -1)
    neg_x = n.math("MULTIPLY", f.x, -1)
    cw, ch = stencil.width("code"), stencil.height("code")
    z_code = RAIL_TOP - 0.1 - ch
    paint_mask = 0.0
    for mask in (
        stencil.mask(n, "code", f.y, f.z, -L / 2 + 0.45, z_code, on_px),
        stencil.mask(n, "code", neg_y, f.z, L / 2 - 0.45 - cw, z_code, on_nx),
        stencil.mask(n, "code", neg_x, f.z, -cw / 2, z_code, on_end),
    ):
        paint_mask = n.math("MAXIMUM", paint_mask, mask)
    if logo:
        lw, lh = stencil.width("logo"), stencil.height("logo")
        for h, where in ((f.y, on_px), (neg_y, on_nx)):
            paint_mask = n.math("MAXIMUM", paint_mask,
                                stencil.mask(n, "logo", h, f.z, -lw / 2, 1.3 - lh / 2, where))
    if painted_out:
        # Rollered over, a shade off, with the old letters' ghost showing through.
        block = n.math("MULTIPLY", n.math("MAXIMUM", on_px, on_nx),
                       n.math("MULTIPLY", n.inside(f.y, -1.9, 1.7), n.inside(f.z, 0.85, 1.75)))
        edge = smooth(n, f.noise(9, 4), 0.3, 0.5)
        block = n.math("MULTIPLY", block, n.lerp(edge, 0.85, 1.0))
        color = n.mix(block, color, [c * 0.78 + 0.004 for c in paint])
        rough = n.lerp(block, rough, 0.45)
    color, rough = stencilled(n, f, color, rough, paint_mask, ink, wear)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0018)})
    return mat


def roof_material(seed, paint, wear, rust, chalk):
    """The roof: the most weather, standing water stains and rust patches in the valleys."""
    mat, n, f = _setup("roof", seed + 1, 1024)
    recess = smooth(n, f.z, H - 0.012, H - 0.012 - ROOF_DEPTH)
    color, rough, height = painted_wear(n, f, paint, min(1, wear + 0.2), min(1, rust + 0.25),
                                        min(1, chalk + 0.3), top=H + 1, recess=recess)
    pond = n.math("MULTIPLY", smooth(n, f.noise(0.9, 3), 0.55, 0.7), recess)
    color = n.mix(n.math("MULTIPLY", pond, 0.6), color, (0.1, 0.045, 0.02))
    rough = n.lerp(pond, rough, 0.9)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0018)})
    return mat


def door_material(seed, paint, stencil, wear, rust, chalk, ink):
    """The doors: code and size type on the right, the weight table on the left, the CSC plate."""
    mat, n, f = _setup("doors", seed + 2, 1024)
    _, ny, _ = normal(n)
    near = n.math("MAXIMUM", smooth(n, n.math("ABSOLUTE", f.x), 0.9, 1.1),
                  n.math("MAXIMUM", smooth(n, f.z, 0.5, SILL), smooth(n, f.z, HEADER - 0.15, HEADER)))
    color, rough, height = painted_wear(n, f, paint, wear, rust, chalk, top=HEADER, edge=near)
    front = smooth(n, ny, -0.5, -0.8)
    ch = stencil.height("code")
    m = n.math("MAXIMUM",
               stencil.mask(n, "code", f.x, f.z, 0.17, HEADER - 0.22 - ch, front),
               stencil.mask(n, "weights", f.x, f.z, -0.98, HEADER - 0.24 - stencil.height("weights"),
                            front))
    color, rough = stencilled(n, f, color, rough, m, ink, wear)
    # The CSC plate: dull aluminium, lines of stamped text.
    plate = n.math("MULTIPLY", n.region((-0.72, None, 1.39), (-0.52, None, 1.51)),
                   n.math("LESS_THAN", f.y, DOOR_Y - 0.002))
    lines = n.math("MULTIPLY", n.stripes(f.z, 0.011, 0.45),
                   n.math("GREATER_THAN", f.noise(120, 0, stretch=(1, 1, 0.2)), 0.42))
    lines = n.math("MULTIPLY", lines, n.region((-0.7, None, 1.4), (-0.54, None, 1.49)))
    alu = n.mix(f.noise(40, 3), (0.32, 0.32, 0.3), (0.42, 0.42, 0.4))
    alu = n.mix(n.math("MULTIPLY", lines, 0.7), alu, (0.08, 0.08, 0.08))
    color = n.mix(plate, color, alu)
    rough = n.lerp(plate, rough, 0.5)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0018)})
    return mat


def hardware_material(seed, paint, wear, rust):
    """Locking bars, cams, handles and hinges: painted, rubbed bright and rusty where handled."""
    mat, n, f = _setup("hardware", seed + 3, 512)
    color, rough, height = painted_wear(n, f, [c * 0.9 for c in paint], min(1, wear + 0.35),
                                        min(1, rust + 0.2), 0.2, top=HEADER + 0.2, salt=0.2)
    rub = n.math("MULTIPLY", smooth(n, f.z, 0.9, 1.05), smooth(n, f.z, 1.3, 1.15))
    rub = n.math("MULTIPLY", rub, smooth(n, f.noise(25, 3), 0.45, 0.6))
    color = n.mix(rub, color, (0.22, 0.2, 0.18))
    rough = n.lerp(rub, rough, 0.4)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0015)})
    return mat


def unit_material(seed, wear):
    """A reefer unit's panels: painted aluminium, grubby round the handles, fan and controller."""
    mat, n, f = _setup("unit", seed + 4, 1024)
    grime = n.math("MULTIPLY", smooth(n, f.noise(6, 4), 0.4, 0.75), 0.6 + 0.4 * wear)
    base = n.mix(f.noise(30, 3), (0.24, 0.25, 0.25), (0.3, 0.31, 0.3))
    color = n.mix(grime, base, (0.07, 0.065, 0.055))
    rough = n.lerp(grime, 0.45, 0.75)
    n.out(**{"Base Color": color, "Roughness": rough, "Metallic": 0.3,
             "Normal": n.bump(f.noise(60, 2), distance=0.0006)})
    return mat


def crate_wood(seed):
    """Rough pale crate boards, grained, dirtied and split."""
    mat, n, f = _setup("wood", seed + 5, 512)
    grain = f.noise(4, 6, stretch=(1, 0.08, 1))
    color = n.mix(grain, (0.16, 0.1, 0.05), (0.27, 0.18, 0.09))
    dirt = smooth(n, f.noise(3, 3), 0.45, 0.7)
    color = n.mix(dirt, color, (0.05, 0.035, 0.02))
    n.out(**{"Base Color": color, "Roughness": 0.85, "Normal": n.bump(grain, distance=0.002)})
    return mat
