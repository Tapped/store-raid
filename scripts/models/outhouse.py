"""
Outhouse (utedo): a plank privy painted falu red long ago, peeling to grey wood, a heart cut in
its door, the door hanging ajar on strap hinges, a board roof falling to the back, the whole thing
leaning on its corner stones. The door faces -y.
"""

import math
import random

from mathutils import Matrix, Vector

import village_logs as v

OUT = "models/village/outhouse.glb"
ORIGIN = "bottom"
TRIS = 5000
SMOOTH_ANGLE = 50
AO = 1024
AO_DISTANCE = 0.2

H = 0.54  # half the body's width and depth, to the boards' centre
BASE = 0.16
LEAN = (math.radians(-1.6), math.radians(3.2))  # round x, round y


def under(y):
    """The roof boards' underside over y."""
    return 2.08 - y * 0.24


def build():
    rng = random.Random(51)
    walls = v.timber("walls", 1024, "z", seed=51, kind="board", dark=0.3, board=0.18,
                     paint=v.FALU, peel=0.7, floor=0.0, lichen=0.6)
    frame = v.timber("frame", 512, "y", seed=52, kind="board", dark=0.7, board=0.25)
    stone = v.stone_mat("stone", 512, seed=53)
    iron = v.iron_mat()
    dark = v.plain("dark", (0.005, 0.004, 0.0035), 0.95)

    # The corner stones stay level; everything else leans.
    stones = v.Part("stones")
    for sx in (-1, 1):
        for sy in (-1, 1):
            v.stone(stones, stone, (sx * H, sy * H, 0.08), (0.28, 0.26, 0.18), rng, cuts=1, ground=0.0, flat_top=0.5)
    # A flat stone before the door, half sunk.
    v.stone(stones, stone, (0.05, -H - 0.12, 0.035), (0.5, 0.26, 0.09), rng, cuts=1, ground=0.0, flat_top=0.6, round_=0.4)
    stones.finish()

    def body():
        part = v.Part("body")
        bt = 0.022
        # Sills and posts.
        for sy in (-1, 1):
            v.cuboid(part, frame, Matrix.Translation((0, sy * (H - 0.05), BASE + 0.05)), (2 * H + 0.06, 0.09, 0.1))
        for sx in (-1, 1):
            v.cuboid(part, frame, Matrix.Translation((sx * (H - 0.05), 0, BASE + 0.05)), (0.09, 2 * H - 0.2, 0.1))
            for sy in (-1, 1):
                y = sy * (H - 0.05)
                top = under(y) - 0.03
                v.cuboid(part, frame, Matrix.Translation((sx * (H - 0.05), y, (BASE + top) / 2)), (0.08, 0.08, top - BASE))
        # Side and back boards, tops cut to the roof.
        n = 6
        for sx in (-1, 1):
            for i in range(n):
                y0 = -H - 0.01 + (2 * H + 0.02) * i / n
                y1 = y0 + (2 * H + 0.02) / n - 0.008
                x = sx * (H + bt / 2)
                if sx > 0 and i == 2:
                    # The board with the diamond cut in it, to let the air through.
                    top = under(y1) - 0.005
                    zc = (BASE - 0.02 + top) / 2
                    m = Matrix.Translation((x, (y0 + y1) / 2, zc)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
                    v.holed_board(part, walls, m, y1 - y0, top - BASE + 0.02, bt,
                                  [(0.0, 1.72 - zc - 0.07), (0.05, 1.72 - zc), (0.0, 1.72 - zc + 0.07), (-0.05, 1.72 - zc)])
                    continue
                v.sloped_board(part, walls, x - bt / 2, x + bt / 2, y0, y1, BASE - 0.02 + rng.uniform(0, 0.02),
                               lambda xx, y: under(y) - 0.005)
        for i in range(n):
            x0 = -H - bt + (2 * H + 2 * bt) * i / n
            x1 = x0 + (2 * H + 2 * bt) / n - 0.008
            if i == 4:
                x1 -= 0.03  # shrunk, a gap
            v.sloped_board(part, walls, x0, x1, H, H + bt, BASE - 0.02 + rng.uniform(0, 0.02),
                           lambda xx, y: under(H) - 0.005 - (0.18 if i == 1 else 0.0))
        # The front: a board each side of the door, one over it.
        dw = 0.66
        fy = -H - bt / 2
        for sx in (-1, 1):
            xa, xb = sx * (dw / 2 + 0.005), sx * (H + bt)
            v.sloped_board(part, walls, min(xa, xb), max(xa, xb), fy - bt / 2, fy + bt / 2, BASE - 0.02,
                           lambda xx, y: under(-H) + 0.01)
        door_top = 1.92
        v.cuboid(part, walls, Matrix.Translation((0, fy, (door_top + 0.03 + under(-H) + 0.01) / 2)),
                 (dw + 0.02, bt, under(-H) + 0.01 - door_top - 0.03))
        # Inside: dark, and the seat with its hole.
        v.cuboid(part, dark, Matrix.Translation((0, 0.02, 1.0)), (2 * H - 0.12, 2 * H - 0.14, 1.6), skip=("-y",))
        v.cuboid(part, frame, Matrix.Translation((0, H - 0.3, BASE + 0.25)), (2 * H - 0.12, 0.02, 0.4))
        v.holed_board(part, frame, Matrix.Translation((0, H - 0.2, BASE + 0.45)) @ Matrix.Rotation(-math.pi / 2, 4, "X"),
                      2 * H - 0.12, 0.42, 0.025, [(0.11 * math.cos(a), 0.13 * math.sin(a)) for a in [2 * math.pi * k / 12 for k in range(12)]])
        # Roof: boards falling to the back, cover boards over the gaps, a fascia at the front.
        nb = 5
        span = 2 * H + 0.2
        for i in range(nb):
            x = -span / 2 + span * (i + 0.5) / nb
            pa = Vector((x, -H - 0.15, under(-H - 0.15) + 0.012))
            pb = Vector((x, H + 0.12, under(H + 0.12) + 0.012))
            v.beam(part, frame, pa, pb, span / nb - 0.035, 0.025)
            if i < nb - 1:
                xc = -span / 2 + span * (i + 1) / nb
                v.beam(part, frame, pa + Vector((xc - x, 0, 0.025)), pb + Vector((xc - x, 0, 0.025)), 0.08, 0.022)
        v.beam(part, frame, (-span / 2 - 0.01, -H - 0.165, under(-H - 0.15) - 0.03), (span / 2 + 0.01, -H - 0.165, under(-H - 0.15) - 0.03), 0.025, 0.12, up=(0, 0, 1))
        part.finish(bevel=0.005)
        # The door: three boards, a heart in the middle one, a Z brace, ajar.
        dpart = v.Part("door")
        hinge = Vector((-dw / 2, fy - bt, 0))
        dm = Matrix.Translation(hinge) @ Matrix.Rotation(0.2, 4, "Z") @ Matrix.Translation(-hinge)
        dh = door_top - BASE - 0.04
        bw = dw / 3
        z0 = BASE + 0.02
        for k in range(3):
            x = -dw / 2 + bw * (k + 0.5)
            m = dm @ Matrix.Translation((x, fy - bt, z0 + dh / 2))
            if k == 1:
                v.holed_board(dpart, walls, m, bw - 0.006, dh, bt, v.heart(0.11, (0.0, dh / 2 - 0.3), 18))
            else:
                v.cuboid(dpart, walls, m, (bw - 0.006, bt, dh - rng.uniform(0, 0.015)))
        for z in (z0 + 0.22, z0 + dh - 0.22):
            v.cuboid(dpart, walls, dm @ Matrix.Translation((0, fy - bt * 2, z)), (dw - 0.06, 0.022, 0.1))
        a = Vector((dw / 2 - 0.09, fy - bt * 2, z0 + 0.27))
        b = Vector((-dw / 2 + 0.09, fy - bt * 2, z0 + dh - 0.27))
        mm, ln = v.frame_between(a, b, up=(0, -1, 0))
        v.cuboid(dpart, walls, dm @ mm, (ln - 0.05, 0.09, 0.022))
        for z in (z0 + 0.22, z0 + dh - 0.22):
            v.cuboid(dpart, iron, dm @ Matrix.Translation((-dw / 2 + 0.17, fy - bt * 2 - 0.014, z)), (0.34, 0.005, 0.035))
        v.cuboid(dpart, frame, dm @ Matrix.Translation((dw / 2 - 0.08, fy - bt * 2 - 0.02, z0 + dh * 0.55)), (0.04, 0.03, 0.1))
        dpart.finish(bevel=0.004)

    _, objs = v.made(body)
    pivot = Vector((0, 0, BASE))
    lean = (Matrix.Translation(pivot) @ Matrix.Rotation(LEAN[1], 4, "Y") @ Matrix.Rotation(LEAN[0], 4, "X")
            @ Matrix.Translation(-pivot))
    v.place(objs, lean)
