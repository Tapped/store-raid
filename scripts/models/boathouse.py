"""
Boathouse (naust): tarred vertical boards with cover strips on low dry-stone side and back walls,
a steep slate roof with ridge boards and crossed vergeboards, wide double doors in the front gable
facing the water, the left leaf hanging off its top hinge, open, its bottom dragging. The doors
face -y.
"""

import math
import random

from mathutils import Matrix, Vector

import village_logs as v

OUT = "models/village/boathouse.glb"
ORIGIN = "bottom"
TRIS = 30000
SMOOTH_ANGLE = 50
AO = 2048
AO_DISTANCE = 0.35

WX = 2.1  # board walls' centre lines, x
YF, YB = -4.2, 4.2  # front and back walls
STONE_H = 1.2
SILL_Z = STONE_H + 0.06
PLATE_Z = 2.42
SLOPE = math.tan(math.radians(35))
EAVE = WX + 0.36
VERGE = 4.5
DOOR_W, DOOR_H = 3.0, 2.3


def build():
    rng = random.Random(31)
    cladding = v.timber("cladding", 2048, "z", seed=31, kind="board", dark=0.88, board=0.22,
                        floor=0.0, lichen=0.3, moss=0.5)
    frame = v.timber("frame", 1024, "y", seed=32, kind="log", dark=0.7, z0=0, pitch=1.0, moss=0.6)
    doors = v.timber("doors", 1024, "z", seed=33, kind="board", dark=0.45, board=0.25, floor=0.0,
                     lichen=0.7)
    roofboards = v.timber("roof-boards", 1024, "x", seed=34, kind="board", dark=0.8)
    stone = v.stone_mat("stone", 2048, seed=35, lichen=0.75, moss=0.6)
    slate = v.stone_mat("slate", 2048, seed=36, kind="slate", lichen=0.45, moss=0.55)
    iron = v.iron_mat()
    dark = v.plain("dark", (0.004, 0.0035, 0.003), 0.95)
    inner = v.plain("inside-wood", (0.03, 0.022, 0.015), 0.9)

    part = v.Part("walls")
    # Dry-stone walls along both sides and the back; the stones only face outwards.
    v.drystone_wall(part, stone, (-WX, YF - 0.1), (-WX, YB + 0.3), STONE_H, 0.52, rng, core=dark, faces=(1,))
    v.drystone_wall(part, stone, (WX, YF - 0.1), (WX, YB + 0.3), STONE_H, 0.52, rng, core=dark, faces=(-1,))
    v.drystone_wall(part, stone, (-WX - 0.3, YB), (WX + 0.3, YB), STONE_H, 0.52, rng, core=dark, faces=(1,))
    # Big corner stones at the front ends of the side walls.
    for sx in (-1, 1):
        v.stone(part, stone, (sx * (WX + 0.05), YF - 0.05, 0.38), (0.7, 0.6, 0.78), rng, cuts=2, ground=0.0, flat_top=0.3)
    # Dark inside.
    v.cuboid(part, dark, Matrix.Translation((0, 0.1, 1.2)), (2 * WX - 0.25, YB - YF - 0.4, 2.4), skip=("-y", "-z"))
    v.cuboid(part, dark, Matrix.Translation((0, 0.1, 0.01)), (2 * WX - 0.25, YB - YF - 0.4, 0.02))

    # Frame: sills on the walls, posts at the front, plates and tie beams.
    for sx in (-1, 1):
        v.log(part, frame, (sx * WX, YF - 0.12, SILL_Z), (sx * WX, YB + 0.1, SILL_Z), 0.1, 0.08, rng, shape=3.5)
        v.log(part, frame, (sx * WX, YF - 0.16, PLATE_Z), (sx * WX, YB + 0.16, PLATE_Z), 0.1, 0.1, rng, shape=3.5)
        v.cuboid(part, cladding, Matrix.Translation((sx * WX, YF, PLATE_Z / 2)), (0.16, 0.16, PLATE_Z), jitter=0.01, rng=rng)
        v.cuboid(part, cladding, Matrix.Translation((sx * (DOOR_W / 2 + 0.07), YF - 0.02, (DOOR_H + 0.1) / 2)), (0.14, 0.14, DOOR_H + 0.1), jitter=0.008, rng=rng)
    v.log(part, frame, (-WX - 0.1, YB, SILL_Z), (WX + 0.1, YB, SILL_Z), 0.08, 0.08, rng, shape=3.5)
    for y in (YF + 0.1, 0.0, YB - 0.1):
        v.log(part, frame, (-WX - 0.12, y, PLATE_Z + 0.12), (WX + 0.12, y, PLATE_Z + 0.12), 0.09, 0.1, rng, shape=3.0)
    v.cuboid(part, cladding, Matrix.Translation((0, YF - 0.02, DOOR_H + 0.1)), (DOOR_W + 0.5, 0.15, 0.16))
    part.finish()

    ridge = PLATE_Z + 0.12 + WX * SLOPE + 0.03

    def under(x, y):
        return ridge - 0.03 - abs(x) * SLOPE - 0.01

    # Boards with cover strips.
    walls = v.Part("cladding")
    bw = 0.24
    for sx in (-1, 1):
        n = round((YB - YF) / bw)
        for i in range(n):
            y = YF + (YB - YF) * (i + 0.5) / n
            m = v.turn(v.FACINGS["x" if sx > 0 else "-x"], (sx * (WX + 0.11), y, 0))
            h0 = SILL_Z - 0.12 + rng.uniform(-0.02, 0.02)
            h1 = PLATE_Z + 0.2
            v.cuboid(walls, cladding, m @ Matrix.Translation((0, 0, (h0 + h1) / 2)), (bw - 0.02, 0.025, h1 - h0), skip=("+y",), jitter=0.004, rng=rng)
            v.cuboid(walls, cladding, m @ Matrix.Translation((bw / 2 * sx * 0 + bw / 2, -0.024, (h0 + h1) / 2)), (0.07, 0.022, h1 - h0 - 0.03), skip=("+y",))
    # Gables: boards cut to the roof's slope; the front's round the door, the back's on the stones.
    for y, sy, z0, gap in ((YF - 0.1, -1, 0.02, True), (YB + 0.11, 1, SILL_Z - 0.1, False)):
        n = round(2 * (WX + 0.12) / bw)
        for i in range(n):
            x0 = -WX - 0.12 + 2 * (WX + 0.12) * i / n
            x1 = x0 + bw - 0.02
            lo = z0
            xc = (x0 + x1) / 2
            if gap and abs(xc) < DOOR_W / 2 + 0.12:
                lo = DOOR_H + 0.18
            if sy > 0 and i == 7:
                continue  # a board gone at the back
            v.sloped_board(walls, cladding, x0, x1, y - 0.0125, y + 0.0125, lo,
                           lambda x, yy: under(x, yy) - 0.02, skip=("+y",) if sy < 0 else ("-y",))
            if i < n - 1:
                v.sloped_board(walls, cladding, x1 - 0.025, x1 + 0.045, y + sy * 0.024 - 0.011, y + sy * 0.024 + 0.011, lo + 0.02,
                               lambda x, yy: under(x, yy) - 0.05, skip=("+y",) if sy < 0 else ("-y",))
    walls.finish()

    # The roof, built with its ridge along x and turned to run front to back.
    _, made = v.made(
        v.slate_roof,
        {"boards": roofboards, "purlin": frame, "slate": slate, "inner": inner},
        rng, -VERGE, VERGE, EAVE, SLOPE, ridge, inside=(YB, WX),
        purlins=[(0.0, 0.12), (-1.1, 0.1), (1.1, 0.1)], cross=0.4,
    )
    v.place(made, Matrix.Rotation(math.pi / 2, 4, "Z"))

    # The doors: the right leaf shut, the left hanging off its top hinge, open, dragging.
    dmats = {"door": doors, "iron": iron}
    fm = v.wall_frame("-y", WX, -YF + 0.1, DOOR_W / 4)
    v.plank_door(fm, dmats, DOOR_W / 2 - 0.02, DOOR_H - 0.06, 0.06, -0.02, rng, boards=6, brace="z", hinge_side=1)
    fm = v.wall_frame("-y", WX, -YF + 0.1, -DOOR_W / 4)
    _, leaf = v.made(v.plank_door, fm, dmats, DOOR_W / 2 - 0.02, DOOR_H - 0.06, 0.2, -0.02, rng,
                     boards=6, brace="z", hinge_side=-1, ajar=0.8, missing=(3,))
    hinge = Vector((-DOOR_W / 2, YF - 0.12, DOOR_H - 0.1))
    normal = Matrix.Rotation(0.8, 3, "Z") @ Vector((0, -1, 0))
    sag = Matrix.Translation(hinge) @ Matrix.Rotation(math.radians(-7), 4, normal) @ Matrix.Translation(-hinge)
    v.place(leaf, sag)
