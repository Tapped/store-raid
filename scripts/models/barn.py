"""
Barn (lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¥ve): a big falu-red board barn on a tall dry-stone byre storey, white corner boards and
barge boards peeling, a slate roof sagging in the ridge with a hole, boards missing so the dark
inside shows, a hay hatch in each gable. On the back, an earth-and-stone ramp (lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¥vebru) climbs to
a timber bridge and the double doors under their wall dormer. Shared parts are in village_boards.py.
"""

import math

from mathutils import Vector, noise

import village_boards as vb
from village_boards import UP, Wall, box_walls, flat, gable

OUT = "models/village/barn.glb"
ATLAS = 4096  # its bakes are seen up close: the default 2048 would lose most of them
ORIGIN = "bottom"
TRIS = 40000
AO = 0  # occlusion is ray-cast per face corner instead (village_boards.Builder)

# The byre's stone walls, the timber barn on them (inset), its eave and roof.
SX, SY0, SY1, BZ = 7.2, -4.0, 2.9, 2.4
WX, WY0, WY1 = 7.0, -3.85, 2.75
SILL = BZ + 0.22  # the barn's floor, on the sill logs
EAVE = 5.2
PITCH = math.radians(44)
YC = (WY0 + WY1) / 2
HALF = (WY1 - WY0) / 2
RIDGE = EAVE + HALF * math.tan(PITCH)
OVER, GOVER = 0.5, 0.35  # eave and gable overhangs
SAG = 0.32  # how far the ridge has sunk in the middle
# The back doors, under a wall dormer; the bridge and the ramp up to them.
DOOR_W, DOOR_TOP = 1.42, 5.5
KVIST = 1.9
RAMP_Y0, RAMP_Y1, RAMP_X0, RAMP_X1 = 3.0, 5.0, 1.6, 7.6
LAND_X0, LAND_Y0 = -1.9, 3.7

FALU = (0.08, 0.028, 0.02)
WHITE = (0.3, 0.29, 0.26)


def build():
    m = {
        "red": vb.wood("red", 31, 4096, paint=FALU, peel=0.55, silvering=0.7,
                       weather=(0.5, -0.85, 0.0), lichen=0.3),
        "trim": vb.wood("trim", 32, 2048, paint=WHITE, peel=0.45, peel_scale=6.0, silvering=0.7, lichen=0.3),
        "timber": vb.wood("timber", 33, 2048, silvering=0.55, lichen=0.5),
        "slate": vb.slates("slate", 34, 4096, width=0.3, moss=0.45, moss_top=7.0),
        "stone": vb.stone("stone", 35, 4096, moss=0.5, lichen=0.35),
        "turf": vb.turf("ramp", 36, 2048),
    }
    for kind in ("red-edge", "white-edge", "grey-edge", "slate-edge", "under", "inside", "joint",
                 "iron", "glass"):
        m[kind] = vb.plain(kind)
    b = vb.Builder("barn", m, seed=37)
    byre(b)
    walls(b)
    roof(b)
    back(b)
    ramp(b)
    b.finish(deform=warp, ao=1.2)


def warp(p):
    """The ridge sunk in the middle, and nothing quite straight."""
    q = p + noise.noise_vector(p * 0.3 + Vector((1.7, 4.2, 9.1))) * (0.02 * min(1.0, 0.3 + p.z / 6))
    if p.z > EAVE - 0.6 and abs(p.x) < WX + GOVER + 0.2:
        k = min(1.0, max(0.0, (p.z - EAVE + 0.6) / (RIDGE - EAVE + 0.6)))
        q.z -= SAG * math.sin(math.pi * (p.x + WX + GOVER) / (2 * (WX + GOVER))) * k
    return q


def byre(b):
    """The byre storey: dry stone, a door, small windows, a dung hatch, rough lintels."""
    walls_ = box_walls(-SX, SX, SY0, SY1)
    openings = {
        # side: [(kind, centre s, bottom z, width, height)]
        "-y": [("door", SX - 2.6, 0.0, 1.0, 1.9), ("window", SX + 0.8, 1.15, 0.62, 0.5),
               ("window", SX + 4.3, 1.15, 0.62, 0.5), ("hatch", SX - 5.6, 0.35, 0.6, 0.45)],
        "y": [("window", SX + 4.5, 1.15, 0.62, 0.5), ("window", SX + 0.6, 1.15, 0.62, 0.5)],
        "x": [("window", (SY1 - SY0) / 2, 1.15, 0.62, 0.5)],
        "-x": [("window", (SY1 - SY0) / 2 - 1.2, 1.15, 0.62, 0.5),
               ("door", (SY1 - SY0) / 2 + 1.0, 0.0, 0.95, 1.8)],
    }
    for side, (wall, length) in walls_.items():
        ops = openings[side]
        holes = [(s - w / 2 - 0.05, s + w / 2 + 0.05, z - 0.1, z + h + 0.2) for _, s, z, w, h in ops]
        vb.stone_wall(b, wall, -0.06, length + 0.06, 0.0, BZ, "stone", "joint", size=(0.68, 0.42),
                      relief=0.08, batter=0.025, holes=holes)
        for kind, s, z, w, h in ops:
            if kind == "window":
                vb.small_window(b, wall, s, z, w, h, "timber", "grey-edge", "glass",
                                broken=(1,) if side != "x" else (0, 3), lintel="stone", d=-0.06)
            else:
                opening(b, wall, s, z, w, h, kind)
    # Corner stones, big and squared, laid long each way in turn.
    for sx in (-1, 1):
        for sy in (-1, 1):
            z = 0.0
            i = 0
            while z < BZ - 0.1:
                h = min(0.42 + 0.08 * ((i * 7) % 3), BZ - z)
                lx, ly = (0.75, 0.45) if i % 2 == 0 else (0.45, 0.75)
                cx = sx * (SX + 0.06) - sx * lx / 2
                cy = (SY1 if sy > 0 else SY0) + sy * 0.06 - sy * ly / 2
                vb.rough_block(b, (cx - lx / 2, cy - ly / 2, z + 0.01), (cx + lx / 2, cy + ly / 2, z + h - 0.01),
                               "stone", 0.035)
                z += h
                i += 1
    # The stone wall's top, under the sill logs.
    b.face([(-SX - 0.06, SY0 - 0.06, BZ), (SX + 0.06, SY0 - 0.06, BZ), (SX + 0.06, SY1 + 0.06, BZ),
            (-SX - 0.06, SY1 + 0.06, BZ)], "joint", UP)


def opening(b, wall, s, z, w, h, kind):
    """A door or dung hatch in the stone: a timber frame, a lintel log, a plank door."""
    for sx in (-1, 1):
        b.beam(wall.at(s + sx * (w / 2 + 0.06), z, 0.02), wall.at(s + sx * (w / 2 + 0.06), z + h + 0.02, 0.02),
               0.12, 0.14, "timber", up=wall.out, ends="grey-edge", jitter=0.008)
    b.beam(wall.at(s - w / 2 - 0.3, z + h + 0.1, 0.03), wall.at(s + w / 2 + 0.3, z + h + 0.1, 0.03),
           0.18, 0.2, "timber", up=UP, ends="grey-edge", jitter=0.01)
    leaf_top = flat(z + h)
    if kind == "door":
        # Closed, a board short at the bottom.
        vb.board_wall(b, wall, s - w / 2, s + w / 2, z + 0.03, leaf_top, "timber", "grey-edge",
                      width=(0.16, 0.24), gap=0.006, depth=0.04, inside=None, ragged=0.0,
                      broken={1: 0.25}, tag=0.1)
        for zz in (z + 0.3, z + h - 0.3):
            b.beam(wall.at(s - w / 2 + 0.05, zz, 0.02), wall.at(s + w / 2 - 0.05, zz, 0.02), 0.03, 0.12,
                   "timber", up=UP, ends="grey-edge")
            b.beam(wall.at(s - w / 2 + 0.02, zz, 0.035), wall.at(s - w / 2 + 0.35, zz, 0.035), 0.008, 0.05,
                   "iron", up=UP)
    else:
        vb.board_wall(b, wall, s - w / 2, s + w / 2, z + 0.02, leaf_top, "timber", "grey-edge",
                      width=(0.14, 0.2), gap=0.01, depth=0.035, inside=None, ragged=0.0, missing={1},
                      tag=0.2)


def corner_boards(b, wall, length, z0, z1):
    for s0, s1 in ((-0.02, 0.15), (length - 0.15, length + 0.02)):
        pts = [wall.at(s0, z0, 0.02), wall.at(s1, z0, 0.02), wall.at(s1, z1, 0.02), wall.at(s0, z1, 0.02)]
        b.slab(pts, wall.out, 0.03, "trim", "white-edge", b.piece(0.0), (0, 0, 1),
               roof=[(0, 0.17, 1.0), (1, 0.17, 1.0), (1, 0.17, 1.0), (0, 0.17, 1.0)])


def walls(b):
    """The red board walls on their sill logs, white corner boards, the gables and hay hatches."""
    walls_ = box_walls(-WX, WX, WY0, WY1)
    for side, (wall, length) in walls_.items():
        # Sill logs round the stone's top, crossing at the corners.
        b.beam(wall.at(-0.25, BZ + 0.11, -0.02), wall.at(length + 0.25, BZ + 0.11, -0.02), 0.3, 0.22,
               "timber", up=UP, ends="grey-edge", jitter=0.015)
        top = gable(length, EAVE, RIDGE, GOVER + 0.1) if side in ("x", "-x") else flat(EAVE)
        holes, missing, broken = [], (), None
        if side == "-y":
            missing, broken = {9, 31, 32}, {15: 0.45, 16: 0.3, 44: 0.35}
            holes = [(WX - 0.4, WX + 0.4, 3.4, 4.2)]
        elif side == "y":
            holes = [(WX - DOOR_W, WX + DOOR_W, SILL - 0.1, 99.0)]
            missing, broken = {38}, {5: 0.3}
        elif side == "x":
            holes = [(length / 2 - 0.55, length / 2 + 0.55, 6.0, 7.15)]
            missing = {3}
        else:
            holes = [(length / 2 - 0.55, length / 2 + 0.55, 6.0, 7.15)]
            broken = {2: 0.5, 3: 0.2}
        vb.board_wall(b, wall, 0, length, SILL - 0.06, top, "red", "red-edge", width=(0.17, 0.3),
                      gap=0.014, depth=0.026, holes=holes, missing=missing, broken=broken, tag=0.0,
                      tag_var=0.3)
        corner_boards(b, wall, length, SILL - 0.08, EAVE if side in ("-y", "y") else EAVE - 0.1)
        if side == "-y":
            hatch(b, wall, WX, 3.4, 0.8, 0.8, 0.0)
        if side in ("x", "-x"):
            hatch(b, wall, length / 2, 6.0, 1.1, 1.15, math.radians(-115) if side == "x" else 0.0)
            # A white board under the gable, at eave height.
            b.beam(wall.at(0.1, EAVE - 0.05, 0.03), wall.at(length - 0.1, EAVE - 0.05, 0.03), 0.04, 0.16,
                   "trim", up=UP, ends="white-edge")
    # Darkness inside, seen through gaps and holes.
    b.block((-WX + 0.06, WY0 + 0.06, SILL), (WX - 0.06, WY1 - 0.06, EAVE), "inside")
    for sx in (-1, 1):
        x = sx * (WX - 0.06)
        b.face([(x, WY0 + 0.06, EAVE), (x, WY1 - 0.06, EAVE), (x, YC, RIDGE - 0.15)], "inside", (sx, 0, 0))


def hatch(b, wall, s, z, w, h, angle):
    """A hatch in a wall: a white frame round it and a red board leaf, swung open by `angle`."""
    for s0, s1, z0, z1 in ((s - w / 2 - 0.1, s - w / 2, z - 0.1, z + h + 0.1),
                           (s + w / 2, s + w / 2 + 0.1, z - 0.1, z + h + 0.1),
                           (s - w / 2, s + w / 2, z + h, z + h + 0.1), (s - w / 2, s + w / 2, z - 0.1, z)):
        pts = [wall.at(s0, z0, 0.025), wall.at(s1, z0, 0.025), wall.at(s1, z1, 0.025), wall.at(s0, z1, 0.025)]
        b.slab(pts, wall.out, 0.035, "trim", "white-edge", b.piece(0.1), (0, 0, 1))
    hinge = wall.at(s - w / 2, 0, 0.04)
    leaf, forward = vb.door_leaf(b, hinge, wall.along, wall.out, angle, w, z + 0.01,
                                 flat(z + h - 0.01), "red", "red-edge", width=(0.18, 0.26),
                                 gap=0.005, depth=0.035, tag=0.15)
    for zz in (z + 0.15, z + h - 0.15):
        s_h, s_e = (0.0, w * 0.7) if forward else (w, w * 0.3)
        b.beam(leaf.at(s_h, zz, 0.012), leaf.at(s_e, zz, 0.012), 0.01, 0.05, "iron", up=UP)


def roof_kw(**extra):
    kw = dict(course=0.22, lift=0.015, mat="slate", step="slate-edge", under="under", seg=0.8,
              deck=0.034, curl=0.5)
    kw.update(extra)
    return kw


def in_kvist(p):
    """Inside the wall dormer's roof, where the main roof is hidden and cut away."""
    return (WY1 - p.y) + abs(p.x) < KVIST - 0.05 and p.y > WY1 - KVIST


def roof(b):
    """The slate roof with its laths and rafters, a hole, the ridge boards and barge boards."""
    xe = WX + GOVER
    ze = EAVE - OVER * math.tan(PITCH)
    y0, y1 = WY0 - OVER, WY1 + OVER
    front = ((-xe, y0, ze), (xe, y0, ze), (-xe, YC, RIDGE), (xe, YC, RIDGE))
    backf = ((xe, y1, ze), (-xe, y1, ze), (xe, YC, RIDGE), (-xe, YC, RIDGE))
    vb.roof_face(b, *front, holes=[(0.73, 0.81, 0.38, 0.62)], **roof_kw())
    vb.roof_face(b, *backf, cut=in_kvist, **roof_kw())
    vb.roof_frame(b, *front, "timber", "grey-edge", tail=0.0)
    vb.roof_frame(b, *backf, "timber", "grey-edge", tail=0.0,
                  skip=lambda p: abs(p.x) < KVIST + 0.1)
    # Ridge boards in an upside-down V.
    for sy in (-1, 1):
        nrm = Vector((0, sy * math.sin(PITCH), math.cos(PITCH)))
        down = Vector((0, sy * math.cos(PITCH), -math.sin(PITCH)))
        c = Vector((0, YC, RIDGE)) + nrm * 0.035 + down * 0.1
        b.beam(c - Vector((xe + 0.05, 0, 0)), c + Vector((xe + 0.05, 0, 0)), 0.22, 0.035, "timber",
               up=nrm, ends="grey-edge", jitter=0.004, seg=0.8)
    # White barge boards on the gables, eave boards along the sides.
    for sx in (-1, 1):
        x = sx * (xe + 0.03)
        for y in (y0 - 0.02, y1 + 0.02):
            vb.barge(b, (x, y, ze - 0.06), (x, YC, RIDGE + 0.06), (sx, 0, 0), 0.05, 0.26, "trim",
                     "white-edge", ext=0.05, piece=b.piece(0.0))
    b.beam((-xe, y0 - 0.02, ze - 0.06), (xe, y0 - 0.02, ze - 0.06), 0.04, 0.16, "timber", up=UP,
           ends="grey-edge", seg=0.8)
    for x0, x1 in ((-xe, -KVIST - 0.25), (KVIST + 0.25, xe)):
        b.beam((x0, y1 + 0.02, ze - 0.06), (x1, y1 + 0.02, ze - 0.06), 0.04, 0.16, "timber", up=UP,
               ends="grey-edge", seg=0.8)


def back(b):
    """The double doors under their wall dormer, one leaf ajar."""
    kw = roof_kw()
    vb.cross_gable(b, (0, WY1), (0, 1, 0), KVIST, EAVE, PITCH, KVIST + 0.4, kw, wood="red",
                   edge="red-edge", front=0.0, z_wall=EAVE - 0.05, barge_w=0.24, barge_mat="trim",
                   barge_edge="white-edge", tag=0.0,
                   wall_kw={"holes": [(KVIST - DOOR_W, KVIST + DOOR_W, 0.0, DOOR_TOP)],
                            "width": (0.17, 0.28), "gap": 0.012})
    wall = Wall((WX, WY1), (0, 1, 0))
    # The door frame: white posts and head.
    for x in (-DOOR_W - 0.06, DOOR_W + 0.06):
        b.beam((x, WY1 + 0.04, SILL - 0.05), (x, WY1 + 0.04, DOOR_TOP + 0.12), 0.12, 0.08, "trim",
               up=(0, 1, 0), ends="white-edge", piece=b.piece(0.0))
    b.beam((-DOOR_W - 0.15, WY1 + 0.04, DOOR_TOP + 0.06), (DOOR_W + 0.15, WY1 + 0.04, DOOR_TOP + 0.06), 0.08,
           0.14, "trim", up=UP, ends="white-edge", piece=b.piece(0.0))
    # Leaves: the left shut, the right swung out over the bridge.
    for hx, d, angle in ((-DOOR_W, (1, 0, 0), 0.0), (DOOR_W, (-1, 0, 0), math.radians(-38))):
        hinge = Vector((hx, WY1 + 0.06, 0))
        leaf, forward = vb.door_leaf(b, hinge, d, (0, 1, 0), angle, DOOR_W - 0.01, SILL + 0.02,
                                     flat(DOOR_TOP - 0.02), "red", "red-edge", width=(0.18, 0.27),
                                     gap=0.004, depth=0.045, tag=0.1)
        # A white Z of battens on its face.
        s0, s1 = (0.0, DOOR_W - 0.01) if forward else (DOOR_W - 0.01, 0.0)
        for zz in (SILL + 0.35, DOOR_TOP - 0.35):
            b.beam(leaf.at(min(s0, s1) + 0.06, zz, 0.025), leaf.at(max(s0, s1) - 0.06, zz, 0.025), 0.035,
                   0.16, "trim", up=UP, ends="white-edge", piece=b.piece(0.1))
        b.beam(leaf.at(s0 + (0.1 if forward else -0.1), SILL + 0.45, 0.025),
               leaf.at(s1 - (0.1 if forward else -0.1), DOOR_TOP - 0.45, 0.025), 0.03, 0.15, "trim",
               up=leaf.out, ends="white-edge", piece=b.piece(0.1))
        b.face([leaf.at(0, SILL + 0.02, -0.05), leaf.at(DOOR_W - 0.01, SILL + 0.02, -0.05),
                leaf.at(DOOR_W - 0.01, DOOR_TOP - 0.02, -0.05), leaf.at(0, DOOR_TOP - 0.02, -0.05)],
               "under", -leaf.out)
    # Inside the doors: a dark threshold and floor.
    b.face([(-DOOR_W, WY1 - 0.06, SILL), (DOOR_W, WY1 - 0.06, SILL), (DOOR_W, WY1 + 0.05, SILL),
            (-DOOR_W, WY1 + 0.05, SILL)], "timber", UP)


def ramp(b):
    """The lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¥vebru: an earth ramp in dry-stone walls, a landing, and a timber bridge to the doors."""
    slope = (SILL - 0.15) / (RAMP_X1 - RAMP_X0)

    def h(x):
        return min(SILL - 0.15, max(0.04, SILL - 0.15 - (x - RAMP_X0) * slope))

    # The earth top: the landing and the ramp, gently uneven.
    xs = [LAND_X0, -1.0, 0.0, 1.0, RAMP_X0] + [RAMP_X0 + (RAMP_X1 - RAMP_X0) * k / 6 for k in range(1, 7)]
    ys = [RAMP_Y0, (RAMP_Y0 + RAMP_Y1) / 2, RAMP_Y1]
    rows = []
    for x in xs:
        row = []
        for y in ys:
            if x < RAMP_X0 and y < LAND_Y0:
                y = LAND_Y0
            bump = noise.noise(Vector((x * 0.7, y * 0.7, 3.3))) * 0.05
            sag = -0.06 if abs(y - (RAMP_Y0 + RAMP_Y1) / 2) < 0.1 else 0.0
            row.append(b.bm.verts.new(Vector((x, y, h(x) + bump + sag))))
        rows.append(row)
    for r0, r1 in zip(rows, rows[1:]):
        for i in range(len(ys) - 1):
            b.face([r0[i], r1[i], r1[i + 1], r0[i + 1]], "turf", UP)
    # Retaining walls: the outer side in steps following the slope, the landing's end and front.
    outer = Wall((RAMP_X1 + 0.05, RAMP_Y1), (0, 1, 0))  # s runs towards -x
    s = 0.0
    total = RAMP_X1 + 0.05 - LAND_X0
    while s < total - 0.05:
        step = min(1.1, total - s)
        x_hi = RAMP_X1 + 0.05 - (s + step)
        vb.stone_wall(b, outer, s, s + step, 0.0, h(x_hi) + 0.12, "stone", "joint", size=(0.5, 0.32),
                      relief=0.07, batter=0.03)
        s += step
    end = Wall((LAND_X0, RAMP_Y1), (-1, 0, 0))
    vb.stone_wall(b, end, -0.05, RAMP_Y1 - LAND_Y0 + 0.05, 0.0, SILL - 0.03, "stone", "joint",
                  size=(0.5, 0.32), relief=0.07, batter=0.03)
    face = Wall((LAND_X0, LAND_Y0), (0, -1, 0))
    vb.stone_wall(b, face, 0.0, RAMP_X0 - LAND_X0 + 0.3, 0.0, SILL - 0.03, "stone", "joint",
                  size=(0.5, 0.32), relief=0.07, batter=0.03)
    # Kerb stones along the ramp's outer edge.
    x = RAMP_X0
    while x < RAMP_X1 - 0.4:
        z = h(x + 0.3)
        vb.rough_block(b, (x, RAMP_Y1 - 0.35, z - 0.1), (x + 0.55, RAMP_Y1 + 0.02, z + 0.12), "stone", 0.03)
        x += 0.62
    # The bridge: two logs from the landing to the barn, planks across them.
    for bx in (-1.15, 1.15):
        b.beam((bx, WY1 - 0.1, SILL - 0.2), (bx, LAND_Y0 + 0.25, SILL - 0.2), 0.22, 0.22, "timber",
               up=UP, ends="grey-edge", jitter=0.02)
    y = WY1 + 0.08
    i = 0
    while y < LAND_Y0 + 0.2:
        w = 0.2 + 0.05 * ((i * 5) % 3) / 2
        dz = 0.01 * ((i * 3) % 4) / 3
        if i != 3:
            b.slab([(-1.5, y, SILL - 0.05 + dz), (1.5, y, SILL - 0.05 + dz), (1.5, y + w, SILL - 0.05 + dz),
                    (-1.5, y + w, SILL - 0.05 + dz)], UP, 0.045, "timber", "grey-edge", b.piece(0.3),
                   (1, 0, 0), roof=[(0, w, 1.0), (0, w, 1.0), (1, w, 1.0), (1, w, 1.0)])
        y += w + 0.012
        i += 1
