"""
Log farmhouse: a long two-room West Norwegian laftehus, abandoned since the 1960s: notched logs
on a dry fieldstone foundation, the partition's log heads through both long walls, a turf roof
sagging at the ridge with a slab chimney, an open porch (sval) under the eaves, small white
multi-pane windows, some broken, one boarded. The front faces -y. Helpers in village_logs.py.
"""

import math
import random

from mathutils import Matrix

import village_logs as v

OUT = "models/village/log-farmhouse.glb"
ORIGIN = "bottom"
TRIS = 30000
SMOOTH_ANGLE = 50
AO = 2048
AO_DISTANCE = 0.35

FOUND = 0.5  # top of the foundation
HX, HY = 4.85, 2.3  # wall centre lines
RT, RV = 0.12, 0.165  # a log's half thickness and half height
PITCH = 0.26
COURSES = 10
HEAD = 0.3
SLOPE = math.tan(math.radians(27))
EAVE = HY + RT + 0.45
VERGE = HX + HEAD + 0.17
PARTITION = -0.6
DOOR_X = 0.95
PORCH = (0.1, 1.8, -3.38)  # x0, x1, front y


def long_opening(k0, k1):
    """z range of courses k0..k1 of the long walls."""
    return FOUND + PITCH * k0, FOUND + PITCH * (k1 + 1)


def gable_opening(k0, k1):
    return FOUND + PITCH * (k0 + 0.5), FOUND + PITCH * (k1 + 1.5)


def build():
    rng = random.Random(7)
    grass = v.grass_mats()
    m = {
        "-y": v.timber("logs-front", 2048, "x", seed=1, dark=0.78, z0=FOUND, pitch=PITCH, floor=0.0),
        "y": v.timber("logs-back", 2048, "x", seed=2, dark=0.18, z0=FOUND, pitch=PITCH, floor=0.0,
                      lichen=0.8),
        "x": v.timber("logs-gable", 2048, "y", seed=3, dark=0.72, dark_axis=("x", -5, 5),
                      z0=FOUND + PITCH / 2, pitch=PITCH, floor=0.0),
        "inner": v.plain("inside-wood", (0.03, 0.022, 0.015), 0.9),
    }
    boards = v.timber("boards", 2048, "y", seed=4, dark=0.6, kind="board", moss=0.7)
    porch = v.timber("porch", 1024, "z", seed=5, kind="board", dark=0.3, paint=v.FALU, peel=0.55,
                     floor=0.0)
    door = v.timber("door", 1024, "z", seed=6, kind="board", dark=0.55, board=0.17, floor=0.6)
    trim = v.timber("trim", 1024, "z", seed=8, kind="board", dark=0.2, paint=v.TRIM, peel=0.5,
                    lichen=0.3, moss=0.3)
    stone = v.stone_mat("stone", 2048, seed=9)
    turf = v.turf_mat("turf", 2048, seed=10)
    bark = v.bark_mat("bark", 512, seed=11)
    iron = v.iron_mat()
    glass = v.plain("glass", (0.012, 0.013, 0.014), 0.12)
    dark = v.plain("dark", (0.004, 0.0035, 0.003), 0.95)

    # Foundation, walls and the gable logs up to the roof.
    part = v.Part("walls")
    v.fieldstones(part, stone, dark, HX, HY, FOUND, 0.44, rng)
    ridge = FOUND + PITCH * (COURSES - 0.5) + RV * 0.85 + HY * SLOPE + 0.035
    openings = [
        ("-y", DOOR_X - 0.45, DOOR_X + 0.45, *long_opening(1, 7)),
        ("-y", -3.1 - 0.42, -3.1 + 0.42, *long_opening(4, 6)),
        ("-y", 3.2 - 0.42, 3.2 + 0.42, *long_opening(4, 6)),
        ("y", -2.4 - 0.42, -2.4 + 0.42, *long_opening(4, 6)),
        ("y", 2.8 - 0.42, 2.8 + 0.42, *long_opening(4, 6)),
        ("-x", 0.4 - 0.34, 0.4 + 0.34, *gable_opening(4, 6)),
        ("x", -0.31, 0.31, FOUND + PITCH * 10.5, FOUND + PITCH * 12.5),
    ]
    top = v.log_walls(part, m, HX, HY, FOUND, COURSES, PITCH, RT, RV, HEAD, rng,
                      openings=openings, partitions=[PARTITION], gable=(ridge - 0.035, SLOPE),
                      plate=0.12)
    # Floor and loft floor, dark, seen through the windows and the door.
    v.cuboid(part, m["inner"], Matrix.Translation((0, 0, FOUND + 0.1)), (2 * HX - 0.2, 2 * HY - 0.2, 0.06))
    v.cuboid(part, m["inner"], Matrix.Translation((0, 0, top - 0.3)), (2 * HX - 0.2, 2 * HY - 0.2, 0.06))
    v.cuboid(part, m["inner"], Matrix.Translation((PARTITION, 0, (FOUND + top) / 2)), (0.2, 2 * HY - 0.2, top - FOUND))
    # The slab chimney, up through the ridge.
    v.slab_stack(part, stone, dark, PARTITION, 0.15, ridge - 0.5, 5.47, 0.62, 0.56, rng)
    part.finish()

    v.turf_roof(
        {"boards": boards, "purlin": m["y"], "turf": turf, "bark": bark, "inner": m["inner"],
         "grass": grass},
        rng, -VERGE, VERGE, EAVE, SLOPE, ridge, sag=0.1, turf=0.2, inside=(HX, HY),
        purlins=[(0.0, 0.13), (-1.2, 0.11), (1.2, 0.11)], board_w=0.25,
    )

    # Windows.
    wmats = {"trim": trim, "glass": glass, "dark": dark, "boards": boards, "iron": iron}
    for wall, u, (lo, hi), w, cols, rows, broken, boarded in (
        ("-y", -3.1, long_opening(4, 6), 0.84, 2, 3, {1, 4}, False),
        ("-y", 3.2, long_opening(4, 6), 0.84, 2, 3, {2}, False),
        ("y", -2.4, long_opening(4, 6), 0.84, 2, 3, "all", True),
        ("y", 2.8, long_opening(4, 6), 0.84, 2, 3, {0, 3, 5}, False),
        ("-x", 0.4, gable_opening(4, 6), 0.68, 2, 3, set(), False),
        ("x", 0.0, (FOUND + PITCH * 10.5, FOUND + PITCH * 12.5), 0.62, 2, 2, {1}, False),
    ):
        fm = v.wall_frame(wall, HX, HY, u)
        v.window(fm, wmats, w, hi - lo, lo, 2 * RT, rng, cols=cols, rows=rows, broken=broken,
                 boarded=boarded)

    # The door, ajar, inside the porch; a threshold log stays below it.
    lo, hi = long_opening(1, 7)
    fm = v.wall_frame("-y", HX, HY, DOOR_X)
    v.plank_door(fm, {"door": door, "iron": iron, "lining": door}, 0.86, hi - lo - 0.02, lo + 0.01,
                 -0.02, rng, boards=5, ajar=0.55, brace="ledges", lining=2 * RT)
    build_porch(rng, porch, door, boards, stone, dark, turf, bark, grass)


def build_porch(rng, paint, posts, boards, stone, dark, turf, bark, grass):
    """The open porch under the front eaves: plank floor on stones, posts, a boarded parapet on
    the right, a turf lean-to roof, a stone step."""
    x0, x1, yf = PORCH
    yb = -HY - RT
    floor_z = FOUND + 0.12
    part = v.Part("porch")
    # Stones under the floor and the step.
    for x in (x0 + 0.12, x1 - 0.12):
        v.stone(part, stone, (x, yf + 0.08, 0.13), (0.4, 0.36, 0.3), rng, ground=0.0, flat_top=0.4)
    v.stone(part, stone, ((x0 + 1.0) / 2 + 0.1, yf - 0.22, 0.14), (0.95, 0.42, 0.3), rng, cuts=2, ground=0.0, flat_top=0.5)
    # Joists and floor planks running out from the wall.
    for x in (x0 + 0.08, (x0 + x1) / 2, x1 - 0.08):
        v.cuboid(part, boards, Matrix.Translation((x, (yb + yf) / 2, floor_z - 0.1)), (0.12, yb - yf, 0.14))
    n = 9
    bw = (x1 - x0) / n
    for i in range(n):
        x = x0 + bw * (i + 0.5)
        sag = rng.uniform(0, 0.012)
        v.beam(part, posts, (x, yb, floor_z - 0.016 - sag), (x, yf - 0.03, floor_z - 0.016 - sag * 2), bw - 0.01, 0.032)
    # Posts and the beam under the roof.
    roof_z = 2.92
    slope = 0.375
    beam_z = roof_z - (yb - yf + 0.05) * slope - 0.035 - 0.07
    for x in (x0 + 0.065, x1 - 0.065):
        v.cuboid(part, posts, Matrix.Translation((x, yf + 0.065, (floor_z + beam_z) / 2)), (0.13, 0.13, beam_z - floor_z), jitter=0.008, rng=rng)
        v.cuboid(part, posts, Matrix.Translation((x, (yb + yf) / 2, beam_z - 0.05)), (0.1, yb - yf, 0.12))
    v.cuboid(part, posts, Matrix.Translation(((x0 + x1) / 2, yf + 0.065, beam_z)), (x1 - x0 + 0.2, 0.14, 0.14))
    # Parapet: rails and vertical boards on the right side and the right of the front.
    rail_z = floor_z + 1.0
    for (ax, ay), (bx, by) in (((x1 - 0.06, yb), (x1 - 0.06, yf + 0.13)), ((x0 + 0.95, yf + 0.06), (x1 - 0.13, yf + 0.06))):
        for z in (floor_z + 0.12, rail_z):
            v.beam(part, posts, (ax, ay, z), (bx, by, z), 0.07, 0.08)
        v.beam(part, posts, (ax, ay, rail_z + 0.06), (bx, by, rail_z + 0.06), 0.13, 0.035)
    objs = []
    import lib
    span_side = yb - (yf + 0.13)
    nb = 7
    for i in range(nb):
        if i == 4:
            continue  # a board gone
        y = yf + 0.13 + span_side * (i + 0.5) / nb
        h = rail_z - floor_z + 0.02 - rng.uniform(0, 0.06)
        b = lib.box("board", (0.024, span_side / nb - 0.012, h), (x1 - 0.015, y, floor_z + h / 2), paint, bevel=0.003, segments=1)
        b.matrix_world = Matrix.Translation((x1 - 0.015, y, floor_z)) @ Matrix.Rotation(rng.uniform(-0.02, 0.02), 4, "Y") @ Matrix.Translation((-(x1 - 0.015), -y, -floor_z))
        objs.append(b)
    span_front = (x1 - 0.13) - (x0 + 0.95)
    nf = 5
    for i in range(nf):
        x = x0 + 0.95 + span_front * (i + 0.5) / nf
        h = rail_z - floor_z + 0.02 - rng.uniform(0, 0.06)
        objs.append(lib.box("board", (span_front / nf - 0.012, 0.024, h), (x, yf + 0.015, floor_z + h / 2), paint, bevel=0.003, segments=1))
    # The left side: boards full height against the weather.
    span_side = yb - yf
    nb = 7
    for i in range(nb):
        y = yf + span_side * (i + 0.5) / nb
        h = beam_z - floor_z - 0.02
        if i == 2:
            h *= 0.55  # broken off
        objs.append(lib.box("board", (0.024, span_side / nb - 0.01, h), (x0 - 0.0, y, floor_z + h / 2), paint, bevel=0.003, segments=1))
    part.finish()

    # The lean-to turf roof, from under the main eaves out over the porch.
    _, made = v.made(
        v.turf_roof,
        {"boards": boards, "purlin": posts, "turf": turf, "bark": bark, "grass": grass},
        rng, x0 - 0.18, x1 + 0.18, (yb - yf) + 0.18, slope, roof_z, sag=0.02, turf=0.09,
        sides=(1,), purlins=[], verge_w=0.22, hooks=0.55, turf_log=0.05, grass=0.8,
    )
    v.place(made, Matrix.Translation((0, yb, 0)) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Translation((-(x0 + x1) / 2 * 0, 0, 0)))
    # Rotating by pi flips x: move it back over the porch.
    v.place(made, Matrix.Translation((x0 + x1, 0, 0)))
