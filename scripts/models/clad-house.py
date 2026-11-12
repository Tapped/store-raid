"""
Clad house: a one-and-a-half-storey farmhouse of about 1900 in ochre West Norwegian lapped
cladding peeling to grey wood, white trim, a slate roof with a brick chimney, tall two-casement
windows (panes broken, one boarded over), a glazed porch with sveitserstil fretwork on the front,
all on a fieldstone cellar footing. Shared parts are in village_boards.py.
"""

import math

from mathutils import Vector, noise

import village_boards as vb
from village_boards import UP, Wall, box_walls, flat, gable

OUT = "models/village/clad-house.glb"
ORIGIN = "bottom"
TRIS = 40000
AO = 0  # occlusion is ray-cast per face corner instead (village_boards.Builder)

# The cellar footing, the clad walls, the eave and roof.
FX, FY0, FY1, FOOT = 4.25, -2.55, 2.6, 0.78
WX, WY0, WY1 = 4.2, -2.5, 2.55
EAVE = 4.25
PITCH = math.radians(45)
YC = (WY0 + WY1) / 2
RIDGE = EAVE + (WY1 - WY0) / 2 * math.tan(PITCH)
OVER, GOVER = 0.4, 0.3
# The glazed porch on the front.
PH, PY = 1.6, -4.1  # half width, front
PTOP = 3.05  # its wall plate
CHIMNEY = (0.9, YC)

OCHRE = (0.17, 0.105, 0.035)
WHITE = (0.44, 0.425, 0.38)
WIN_W, WIN_H, WIN_Z = 0.95, 1.45, 1.55  # windows: width, height, sill


def build():
    m = {
        "clad": vb.wood("cladding", 51, 4096, paint=OCHRE, peel=0.26, silvering=0.7,
                        weather=(-0.6, -0.8, 0.0), lichen=0.25),
        "trim": vb.wood("trim", 52, 2048, paint=WHITE, peel=0.24, peel_scale=6.0, silvering=0.7, lichen=0.2),
        "grey": vb.wood("grey-wood", 53, 1024, silvering=0.75, lichen=0.4),
        "slate": vb.slates("slate", 54, 2048, width=0.28, moss=0.5, moss_top=5.5),
        "stone": vb.stone("stone", 55, 2048, moss=0.5, lichen=0.4),
        "brick": vb.brick("brick", 56, 1024, soot_from=7.0),
    }
    for kind in ("ochre-edge", "white-edge", "grey-edge", "slate-edge", "under", "inside", "joint",
                 "glass", "iron"):
        m[kind] = vb.plain(kind)
    b = vb.Builder("house", m, seed=57)
    footing(b)
    walls(b)
    porch(b)
    roof(b)
    chimney(b)
    b.finish(deform=warp, ao=1.0)


def warp(p):
    """A little out of true, the ridge settled a touch in the middle."""
    q = p + noise.noise_vector(p * 0.4 + Vector((5.1, 2.2, 7.7))) * (0.012 * min(1.0, 0.3 + p.z / 5))
    if p.z > EAVE - 0.3 and abs(p.x) < WX + GOVER + 0.1:
        k = min(1.0, max(0.0, (p.z - EAVE + 0.3) / (RIDGE - EAVE + 0.3)))
        q.z -= 0.07 * math.cos(math.pi * p.x / (2 * (WX + GOVER))) * k
    return q


# Windows on each wall: (centre s, sill z, broken panes, boarded), s along the wall from its left.
WINDOWS = {
    "-y": [(WX - 3.0, WIN_Z, (1, 4), False), (WX + 3.0, WIN_Z, (), False)],
    "y": [(WX - 2.7, WIN_Z, (2,), True), (WX, WIN_Z + 0.25, (0, 1, 3), False),
          (WX + 2.7, WIN_Z, (), False)],
    "x": [((WY1 - WY0) / 2 - 1.25, WIN_Z, (), False), ((WY1 - WY0) / 2 + 1.25, WIN_Z, (5,), False),
          ((WY1 - WY0) / 2, 4.55, (0,), False)],
    "-x": [((WY1 - WY0) / 2 - 1.25, WIN_Z, (2, 3), False), ((WY1 - WY0) / 2 + 1.25, WIN_Z, (), False),
           ((WY1 - WY0) / 2, 4.55, (), False)],
}


def footing(b):
    """The cellar's fieldstone footing with two small cellar windows, and the porch's base."""
    cellar = {"-y": [(FX - 3.0, 0.3), (FX + 3.0, 0.3)], "y": [(FX - 1.5, 0.3)], "x": [], "-x": []}
    for side, (wall, length) in box_walls(-FX, FX, FY0, FY1).items():
        holes = [(s - 0.33, s + 0.33, z - 0.05, z + 0.38) for s, z in cellar[side]]
        if side == "-y":
            holes.append((FX - PH - 0.05, FX + PH + 0.05, -0.1, FOOT + 0.1))
        vb.stone_wall(b, wall, -0.05, length + 0.05, 0.0, FOOT, "stone", "joint", size=(0.6, 0.38),
                      relief=0.06, holes=holes)
        for s, z in cellar[side]:
            vb.small_window(b, wall, s, z, 0.56, 0.3, "grey", "grey-edge", "glass", panes=(2, 1),
                            broken=(1,), d=-0.04)
    # The porch base and its steps.
    for side, (wall, length) in box_walls(-PH - 0.05, PH + 0.05, PY - 0.05, FY0).items():
        if side == "y":
            continue
        holes = [(length / 2 - 0.65, length / 2 + 0.65, -0.1, FOOT + 0.1)] if side == "-y" else []
        vb.stone_wall(b, wall, -0.04, length + 0.04, 0.0, FOOT, "stone", "joint", size=(0.5, 0.36),
                      relief=0.06, holes=holes)
    for k, (y0, z) in enumerate(((PY - 0.95, 0.26), (PY - 0.62, 0.52), (PY - 0.3, FOOT - 0.02))):
        vb.rough_block(b, (-0.7 + 0.03 * k, y0, -0.05), (0.7 - 0.02 * k, PY + 0.02, z), "stone", 0.02)


def corner_boards(b, wall, length, z0, top):
    for s0, s1 in ((-0.03, 0.13), (length - 0.13, length + 0.03)):
        z1 = min(vb.top_at(top, s0), vb.top_at(top, s1))
        pts = [wall.at(s0, z0, 0.03), wall.at(s1, z0, 0.03), wall.at(s1, z1, 0.03), wall.at(s0, z1, 0.03)]
        b.slab(pts, wall.out, 0.03, "trim", "white-edge", b.piece(0.0), (0, 0, 1),
               roof=[(0, 0.16, 1), (1, 0.16, 1), (1, 0.16, 1), (0, 0.16, 1)])


def walls(b):
    """Lapped ochre cladding round the windows, white corner boards and windows, the gables."""
    for side, (wall, length) in box_walls(-WX, WX, WY0, WY1).items():
        gabled = side in ("x", "-x")
        top = gable(length, EAVE, RIDGE, GOVER + 0.1) if gabled else flat(EAVE)
        holes = [(s - WIN_W / 2, s + WIN_W / 2, z, z + (WIN_H if z < 3 else 1.0))
                 for s, z, _, _ in WINDOWS[side]]
        vb.lap_wall(b, wall, -0.01, length + 0.01, FOOT - 0.02, top, "clad", "ochre-edge", board=0.17,
                    lap=0.03, holes=holes, tag=0.0, tag_var=0.3, sag=0.006)
        corner_boards(b, wall, length, FOOT - 0.04, flat(EAVE - 0.02) if not gabled else flat(EAVE - 0.02))
        # A white board along the foot of the cladding, and one under the gable at eave height.
        b.beam(wall.at(-0.05, FOOT + 0.02, 0.035), wall.at(length + 0.05, FOOT + 0.02, 0.035), 0.04, 0.14,
               "trim", up=UP, ends="white-edge", piece=b.piece(0.0), seg=1.5)
        if gabled:
            b.beam(wall.at(0.0, EAVE - 0.02, 0.05), wall.at(length, EAVE - 0.02, 0.05), 0.06, 0.18, "trim",
                   up=UP, ends="white-edge", piece=b.piece(0.0))
        for s, z, broken, boarded in WINDOWS[side]:
            h = WIN_H if z < 3 else 1.0
            vb.window(b, wall, s, z, WIN_W if z < 3 else 0.8, h, trim="trim", trim_edge="white-edge",
                      glass="glass", broken=broken, boarded="grey" if boarded else None,
                      board_edge="grey-edge", panes=3 if z < 3 else 2, head=z < 3)
    # Darkness inside: the rooms and the loft under the roof.
    b.block((-WX + 0.2, WY0 + 0.2, FOOT), (WX - 0.2, WY1 - 0.2, EAVE - 0.05), "inside")
    for sx in (-1, 1):
        x = sx * (WX - 0.2)
        b.face([(x, WY0 + 0.2, EAVE - 0.05), (x, WY1 - 0.2, EAVE - 0.05), (x, YC, RIDGE - 0.3)], "inside",
               (sx, 0, 0))


def porch(b):
    """The glazed porch: panelled below, small panes above, a door, a fretwork gable roof."""
    walls_ = box_walls(-PH, PH, PY, WY0)
    sill_z = 1.7
    for side, (wall, length) in walls_.items():
        if side == "y":
            continue
        door = side == "-y"
        # Panelling below the glazing: upright boards between a bottom rail and a sill rail.
        holes = [(length / 2 - 0.47, length / 2 + 0.47, 0, 9)] if door else []
        vb.board_wall(b, wall, 0, length, FOOT + 0.02, flat(sill_z), "trim", "white-edge",
                      width=(0.1, 0.12), gap=0.004, depth=0.022, holes=holes, inside="inside", ragged=0.0,
                      jitter=0.003, tag=0.0, tag_var=0.2)
        for z0, z1, d in ((FOOT, FOOT + 0.12, 0.03), (sill_z - 0.02, sill_z + 0.06, 0.05),
                          (PTOP - 0.15, PTOP, 0.03)):
            runs = [(0, length)] if not door or z0 > 2 else [(0, length / 2 - 0.47), (length / 2 + 0.47, length)]
            for a, c in runs:
                b.beam(wall.at(a, (z0 + z1) / 2, d - 0.02), wall.at(c, (z0 + z1) / 2, d - 0.02), 0.09,
                       z1 - z0, "trim", up=UP, ends="white-edge", piece=b.piece(0.0))
        # Corner posts and mullions, with panes between.
        posts = [0.0, length]
        if door:
            posts += [length / 2 - 0.5, length / 2 + 0.5]
        n = 3 if side == "-y" else 3
        for k in range(1, n):
            s = length * k / n
            if not door or abs(s - length / 2) > 0.6:
                posts.append(s)
        posts = sorted(posts)
        for s in posts:
            b.beam(wall.at(s, FOOT, -0.02), wall.at(s, PTOP, -0.02), 0.1, 0.1, "trim", up=wall.out,
                   ends="white-edge", piece=b.piece(0.0))
        for a, c in zip(posts, posts[1:]):
            if door and abs((a + c) / 2 - length / 2) < 0.3:
                continue
            glaze(b, wall, a + 0.05, c - 0.05, sill_z + 0.06, PTOP - 0.15)
        if door:
            porch_door(b, wall, length / 2)
    b.block((-PH + 0.1, PY + 0.1, FOOT), (PH - 0.1, WY0, PTOP - 0.1), "inside")
    b.face([(-PH, PY, FOOT + 0.01), (PH, PY, FOOT + 0.01), (PH, WY0, FOOT + 0.01), (-PH, WY0, FOOT + 0.01)],
           "grey", UP)
    # The porch roof: a gable on its front with fretwork barge boards and a finial.
    kw = roof_kw(seg=0.6)
    apex = vb.cross_gable(b, (0, WY0), (0, -1, 0), PH, PTOP, PITCH, 1.0, kw, wood="trim",
                          edge="white-edge", front=WY0 - PY + 0.02, z_wall=PTOP - 0.02,
                          barge_w=0.05, wall_kw={"width": (0.09, 0.12), "gap": 0.004, "tag": 0.0})
    gw = Wall((-PH, PY - 0.04), (0, -1, 0))
    over = 0.25
    for sgn in (-1, 1):
        lo = (PH + sgn * (PH + over), PTOP - over * math.tan(PITCH) - 0.02)
        hi = (PH, apex + 0.02)
        p0, p1 = (lo, hi) if sgn < 0 else (hi, lo)
        vb.scalloped(b, gw, p0, p1, 0.2, "trim", "white-edge", d=0.03, piece=b.piece(0.0))
    # A sunburst of slats in the gable, and a turned finial and pendant at the apex.
    centre = (PH, PTOP + 0.05)
    for k in range(7):
        a = math.radians(20 + 140 * k / 6)
        r = 0.55 if k % 2 else 0.75
        tip = (centre[0] + math.cos(a) * r, centre[1] + math.sin(a) * r)
        b.beam(gw.at(centre[0], centre[1], 0.02), gw.at(tip[0], tip[1], 0.02), 0.025, 0.05, "trim",
               up=gw.out, ends="white-edge", taper=0.6, piece=b.piece(0.0))
    b.beam(gw.at(PH, apex - 0.6, 0.05), gw.at(PH, apex + 0.45, 0.05), 0.07, 0.07, "trim", up=gw.out,
           ends="white-edge", piece=b.piece(0.0))
    b.beam(gw.at(PH, apex + 0.45, 0.05), gw.at(PH, apex + 0.62, 0.05), 0.07, 0.07, "trim", up=gw.out,
           ends="white-edge", taper=0.1, piece=b.piece(0.0))
    b.beam(gw.at(PH - 0.9, PTOP + 0.02, 0.035), gw.at(PH + 0.9, PTOP + 0.02, 0.035), 0.06, 0.12, "trim",
           up=UP, ends="white-edge")


def glaze(b, wall, s0, s1, z0, z1):
    """Small panes between two posts: a grid of glazing bars, a few panes gone."""
    rng = b.rng
    nx = max(1, round((s1 - s0) / 0.3))
    nz = 3
    pw, ph = (s1 - s0) / nx, (z1 - z0) / nz
    for i in range(1, nx):
        s = s0 + pw * i
        b.beam(wall.at(s, z0, -0.03), wall.at(s, z1, -0.03), 0.025, 0.04, "trim", up=wall.out,
               ends="white-edge")
    for k in range(1, nz):
        z = z0 + ph * k
        b.beam(wall.at(s0, z, -0.03), wall.at(s1, z, -0.03), 0.04, 0.025, "trim", up=UP, ends="white-edge")
    for i in range(nx):
        for k in range(nz):
            if rng.random() < 0.22:
                continue
            a, c = s0 + pw * i, s0 + pw * (i + 1)
            za, zc = z0 + ph * k, z0 + ph * (k + 1)
            b.face([wall.at(a, za, -0.04), wall.at(c, za, -0.04), wall.at(c, zc, -0.04), wall.at(a, zc, -0.04)],
                   "glass", wall.out)


def porch_door(b, wall, s):
    """The porch's glazed door, standing a little open."""
    w, z0, z1 = 0.9, FOOT + 0.02, 2.75
    hinge = wall.at(s - w / 2 - 0.02, 0, -0.02)
    leaf, forward = vb.door_leaf(b, hinge, wall.along, wall.out, math.radians(-28), w, z0, flat(1.65), "trim",
                                 "white-edge", width=(0.11, 0.13), gap=0.003, depth=0.04, tag=0.1)
    sa, sb = (0.0, w) if forward else (w, 0.0)
    lo, hi = min(sa, sb), max(sa, sb)
    for a, c, za, zc in ((lo, lo + 0.1, 1.65, z1), (hi - 0.1, hi, 1.65, z1), (lo, hi, z1 - 0.1, z1),
                         (lo, hi, 1.62, 1.72)):
        b.slab([leaf.at(a, za, 0.0), leaf.at(c, za, 0.0), leaf.at(c, zc, 0.0), leaf.at(a, zc, 0.0)], leaf.out,
               0.045, "trim", "white-edge", b.piece(0.0))
    b.face([leaf.at(lo + 0.1, 1.72, -0.02), leaf.at(hi - 0.1, 1.72, -0.02), leaf.at(hi - 0.1, z1 - 0.1, -0.02),
            leaf.at(lo + 0.1, z1 - 0.1, -0.02)], "glass", leaf.out)
    knob = leaf.at(hi - 0.08 if forward else lo + 0.08, 1.1, 0.03)
    b.beam(knob, knob + leaf.out * 0.06, 0.03, 0.03, "iron")
    # The frame round the doorway.
    b.beam(wall.at(s - w / 2 - 0.08, z1 + 0.06, 0.0), wall.at(s + w / 2 + 0.08, z1 + 0.06, 0.0), 0.1, 0.12,
           "trim", up=UP, ends="white-edge")


def roof_kw(**extra):
    kw = dict(course=0.2, lift=0.014, mat="slate", step="slate-edge", under="under", seg=0.7, deck=0.034,
              curl=0.5)
    kw.update(extra)
    return kw


def roof(b):
    """Slate on laths and rafters, rafter feet under the eaves, fretwork barge boards, finials."""
    xe = WX + GOVER
    ze = EAVE - OVER * math.tan(PITCH)
    y0, y1 = WY0 - OVER, WY1 + OVER
    front = ((-xe, y0, ze), (xe, y0, ze), (-xe, YC, RIDGE), (xe, YC, RIDGE))
    backf = ((xe, y1, ze), (-xe, y1, ze), (xe, YC, RIDGE), (-xe, YC, RIDGE))
    cx, cy = CHIMNEY
    chim = lambda p: abs(p.x - cx) < 0.26 and abs(p.y - cy) < 0.26  # noqa: E731
    vb.roof_face(b, *front, holes=[(0.15, 0.2, 0.55, 0.68)], cut=chim, **roof_kw())
    vb.roof_face(b, *backf, cut=chim, **roof_kw())
    vb.roof_frame(b, *front, "grey", "grey-edge", rafters=0.8)
    vb.roof_frame(b, *backf, "grey", "grey-edge", rafters=0.8)
    for sy in (-1, 1):
        nrm = Vector((0, sy * math.sin(PITCH), math.cos(PITCH)))
        down = Vector((0, sy * math.cos(PITCH), -math.sin(PITCH)))
        c = Vector((0, YC, RIDGE)) + nrm * 0.03 + down * 0.09
        b.beam(c - Vector((xe + 0.04, 0, 0)), c + Vector((xe + 0.04, 0, 0)), 0.2, 0.03, "grey", up=nrm,
               ends="grey-edge", seg=0.7)
    # Fretwork barge boards and a finial on each gable.
    for sx in (-1, 1):
        x = sx * (xe + 0.03)
        gw = Wall((x, WY0 if sx > 0 else WY1), (sx, 0, 0))
        length = WY1 - WY0
        lo_s, hi_s = -OVER - 0.02, length + OVER + 0.02
        lo_z = ze - 0.03
        mid = length / 2
        vb.scalloped(b, gw, (lo_s, lo_z), (mid, RIDGE + 0.04), 0.24, "trim", "white-edge", piece=b.piece(0.0))
        vb.scalloped(b, gw, (mid, RIDGE + 0.04), (hi_s, lo_z), 0.24, "trim", "white-edge", piece=b.piece(0.0))
        b.beam(gw.at(mid, RIDGE - 0.55, 0.04), gw.at(mid, RIDGE + 0.4, 0.04), 0.07, 0.07, "trim", up=gw.out,
               ends="white-edge", piece=b.piece(0.0))
        b.beam(gw.at(mid, RIDGE + 0.4, 0.04), gw.at(mid, RIDGE + 0.58, 0.04), 0.07, 0.07, "trim", up=gw.out,
               ends="white-edge", taper=0.1, piece=b.piece(0.0))
        # Brackets under the gable's overhang at the eaves.
        for s in (0.15, length - 0.15):
            b.beam(gw.at(s, EAVE - 0.6, -0.27), gw.at(s, EAVE - 0.05, 0.0), 0.07, 0.09, "trim",
                   up=gw.along, ends="white-edge", piece=b.piece(0.0))
    # Fascia boards along the eaves (the front one stops at the porch).
    for x0, x1 in ((-xe, -PH - 0.3), (PH + 0.3, xe)):
        b.beam((x0, y0 - 0.02, ze - 0.05), (x1, y0 - 0.02, ze - 0.05), 0.03, 0.15, "trim", up=UP,
               ends="white-edge", seg=0.8)
    b.beam((-xe, y1 + 0.02, ze - 0.05), (xe, y1 + 0.02, ze - 0.05), 0.03, 0.15, "trim", up=UP,
           ends="white-edge", seg=0.8)


def chimney(b):
    """A brick chimney through the ridge, a stone cap, soot."""
    cx, cy = CHIMNEY
    h = 0.27
    b.block((cx - h, cy - h, RIDGE - 1.0), (cx + h, cy + h, 7.38), "brick", jitter=0.004)
    b.block((cx - h - 0.04, cy - h - 0.04, 7.0), (cx + h + 0.04, cy + h + 0.04, 7.08), "brick")
    b.block((cx - h - 0.07, cy - h - 0.07, 7.38), (cx + h + 0.07, cy + h + 0.07, 7.46), "stone", jitter=0.008)
    b.face([(cx - 0.13, cy - 0.13, 7.465), (cx + 0.13, cy - 0.13, 7.465), (cx + 0.13, cy + 0.13, 7.465),
            (cx - 0.13, cy + 0.13, 7.465)], "inside", UP)
