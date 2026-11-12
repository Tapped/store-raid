"""
Stave church: a small abandoned stave church after Borgund, tarred near-black: shingled roofs in
tiers up to a ridge turret and spire, dragon heads on the top gables and crosses on the lower ones,
a gallery with its arcade round the ground storey, a carved west portal with the door ajar, all on
a low fieldstone footing. The front is the west end. Shared parts are in village_boards.py.
"""

import math

from mathutils import Vector, noise

import lib
import village_boards as vb
from village_boards import UP, Wall, box_walls, flat, gable

OUT = "models/village/stave-church.glb"
ORIGIN = "bottom"
TRIS = 60000
AO = 0  # occlusion is ray-cast per face corner instead (village_boards.Builder)

FOOT = 0.42  # top of the stone footing
FLOOR = FOOT + 0.16  # the gallery's floor, on the sill
# The gallery: its outer wall, eave, the top of its roof where it meets the aisle walls, overhang.
GX, GY0, GY1 = 4.05, -6.45, 2.85
PLATE = 2.3  # top of the gallery's wall plate
GT, GO = 4.3, 0.2
# The eave, low as on Borgund: the roof's plane rests on the plate.
GE = (PLATE - GO * GT / (GX + GO - 3.0)) / (1 - GO / (GX + GO - 3.0))
RAIL, SPRING, ARCH_TOP = 1.0, 1.62, 2.08  # the arcade: rail, where the arches spring, their board
# The aisle storey, the clerestory (the tall middle) and its roof.
AX, AY0, AY1, AZ = 3.0, -5.25, 1.7, 5.3
CX, CY0, CY1, CZ = 2.0, -4.3, 0.7, 8.4
PITCH = math.radians(64)
RIDGE = CZ + CX * math.tan(PITCH)
AISLE_SLOPE = math.tan(math.radians(55))
T0 = RIDGE + 0.45  # top of the turret's shaft
AISLE_TOP = AZ + (AX - CX) * AISLE_SLOPE  # where the aisle roof meets the clerestory
TY = -1.8  # the ridge turret's centre
# The chancel and its apse.
HX, HY0, HY1, HZ = 1.6, 1.7, 5.25, 4.3
HPITCH = math.tan(math.radians(52))
HRIDGE = HZ + HX * HPITCH
APSE_R = 1.25
# The west porch.
PX, PY = 1.15, -7.2

SHINGLE = 0.115  # course exposure


def build():
    m = {
        "wood": vb.wood("wood", 3, 4096, silvering=0.05, weather=(-0.45, -0.85, 0.0), floor=0.0),
        "carve": vb.wood("carving", 5, 2048, silvering=0.15, carve=True, lichen=0.2),
        "shingle": vb.shingles("shingles", 7, 4096, width=0.11, moss=0.65, moss_top=4.6),
        "stone": vb.stone("stone", 9, 2048, moss=0.6),
    }
    for kind in ("tar-edge", "step", "under", "inside", "joint", "iron", "bare"):
        m[kind] = vb.plain(kind)
    b = vb.Builder("church", m, seed=21)

    footing(b)
    gallery(b)
    aisle_and_clerestory(b)
    roofs(b)
    turret(b)
    chancel(b)
    porch_and_portal(b)
    b.finish(deform=warp, ao=1.5)
    dragons(m)


def warp(p):
    """Nothing hand-built is straight: a gentle waver, more higher up, and a sag in the ridge."""
    k = min(1.0, 0.25 + p.z / 8)
    q = p + noise.noise_vector(p * 0.35 + Vector((3.1, 7.7, 1.3))) * (0.025 * k)
    if p.z > CZ:
        along = (p.y - (CY0 + CY1) / 2) / 2.9
        q.z -= 0.06 * max(0.0, 1 - along * along) * min(1.0, (p.z - CZ) / (RIDGE - CZ))
    return q


def footing(b):
    """Fieldstone under the gallery, chancel and apse; steps up to the west porch."""
    for side, (wall, length) in box_walls(-GX - 0.06, GX + 0.06, GY0 - 0.06, GY1 + 0.06).items():
        vb.stone_wall(b, wall, -0.05, length + 0.05, 0.0, FOOT, "stone", "joint",
                      size=(0.62, 0.4), relief=0.06)
    for sx in (-1, 1):
        x = sx * (HX + 0.06)
        wall = Wall((x, GY1 if sx > 0 else HY1), (sx, 0, 0))
        vb.stone_wall(b, wall, 0, HY1 - GY1, 0.0, FOOT, "stone", "joint", size=(0.62, 0.4),
                      relief=0.05)
    for p0, p1, out in apse_segments(APSE_R + 0.06):
        wall = Wall(p0, out)
        vb.stone_wall(b, wall, -0.02, (p1 - p0).length + 0.02, 0.0, FOOT, "stone", "joint",
                      size=(0.5, 0.4), relief=0.05)
    # Steps and the porch floor: big flat slabs.
    vb.rough_block(b, (-1.3, PY - 0.75, -0.05), (1.3, PY - 0.3, 0.2), "stone", 0.03)
    vb.rough_block(b, (-PX - 0.05, PY - 0.32, -0.05), (PX + 0.05, GY0 + 0.1, FOOT), "stone", 0.025)


def apse_segments(r, n=8):
    """The apse's half polygon round the chancel's east end: (start, end, outward normal)."""
    out = []
    centre = Vector((0, HY1, 0))
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        p0 = centre + Vector((math.cos(a0), math.sin(a0), 0)) * r
        p1 = centre + Vector((math.cos(a1), math.sin(a1), 0)) * r
        mid = (a0 + a1) / 2
        out.append((p0, p1, Vector((math.cos(mid), math.sin(mid), 0))))
    return out


def gallery(b):
    """The svalgang: sill, low board wall, rail, arcade of colonnettes and arches, wall plate."""
    walls = box_walls(-GX, GX, GY0, GY1)
    for side, (wall, length) in walls.items():
        # Where the gallery is open (the west entrance) or gives way to the chancel.
        skip = []
        if side == "-y":
            skip = [(GX - 0.8, GX + 0.8)]
        elif side in ("x", "-x"):
            c = TY - GY0 if side == "x" else GY1 - TY
            skip = [(c - 0.7, c + 0.7)]
        else:
            skip = [(GX - HX - 0.03, GX + HX + 0.03)]
        # The beams run past the corners, crossing like notched logs.
        for z0, z1, w, d, ext in ((FOOT, FLOOR, 0.2, -0.07, 0.14), (RAIL, RAIL + 0.1, 0.2, -0.06, 0.1),
                                  (ARCH_TOP, PLATE, 0.22, -0.08, 0.16)):
            runs = [(-ext, length + ext)]
            if side == "y":
                runs = [(-ext, skip[0][0] + 0.05), (skip[0][1] - 0.05, length + ext)]
            elif z0 == RAIL:
                runs = [(-ext, skip[0][0]), (skip[0][1], length + ext)]
            for sa, sb in runs:
                b.beam(wall.at(sa, (z0 + z1) / 2, d), wall.at(sb, (z0 + z1) / 2, d), w, z1 - z0,
                       "wood", ends="tar-edge", jitter=0.01, piece=b.piece(0.2))
        # Posts at the corners, the openings and every couple of meters between.
        posts = {0.0, length}
        for sa, sb in skip:
            posts |= {sa, sb}
        edges = sorted(posts)
        for sa, sb in zip(edges, edges[1:]):
            if any(sa >= k0 - 1e-6 and sb <= k1 + 1e-6 for k0, k1 in skip):
                continue
            n = max(1, round((sb - sa) / 2.4))
            posts |= {sa + (sb - sa) * i / n for i in range(1, n)}
        posts = sorted(posts)
        for s in posts:
            if side == "y" and skip[0][0] + 0.01 < s < skip[0][1] - 0.01:
                continue
            b.beam(wall.at(s, FLOOR, -0.08), wall.at(s, ARCH_TOP + 0.01, -0.08), 0.2, 0.2, "wood",
                   up=wall.out, ends="tar-edge", jitter=0.006, piece=b.piece(0.25))
            # A bracket at the top of each post.
            b.beam(wall.at(s, ARCH_TOP - 0.13, -0.04), wall.at(s, ARCH_TOP, -0.04), 0.26, 0.13, "wood",
                   up=wall.out, ends="tar-edge", piece=b.piece(0.2))
        for sa, sb in zip(posts, posts[1:]):
            if any(sa >= k0 - 1e-6 and sb <= k1 + 1e-6 for k0, k1 in skip):
                if side != "y":
                    # An entrance: an arch board over the opening.
                    r = (sb - sa - 0.2) / 2
                    vb.arch_board(b, wall, sa + 0.1, sb - 0.1, ARCH_TOP - r - 0.04, ARCH_TOP + 0.01, 1, "wood",
                                  "tar-edge", depth=0.05, d=-0.01, segs=12)
                continue
            bay(b, wall, sa + 0.1, sb - 0.1)
    # The gallery's floor, seen through the arcade.
    for side, (wall, length) in walls.items():
        inner = box_walls(-AX, AX, AY0, AY1)[side][0]
        o0, o1 = wall.at(0, FLOOR, -0.03), wall.at(length, FLOOR, -0.03)
        i_len = box_walls(-AX, AX, AY0, AY1)[side][1]
        i0, i1 = inner.at(0, FLOOR), inner.at(i_len, FLOOR)
        b.face([o0, o1, i1, i0], "wood", UP, b.piece(0.3), tuple(wall.along))


def bay(b, wall, s0, s1):
    """One bay of the gallery between posts: low board wall, colonnettes, arches."""
    vb.board_wall(b, wall, s0, s1, FLOOR, flat(RAIL), "wood", "tar-edge", width=(0.16, 0.26),
                  gap=0.006, inside=None, tag=0.4, tag_var=0.2, ragged=0.01)
    # Its inside face, seen from within the gallery.
    b.face([wall.at(s0, FLOOR, -0.035), wall.at(s1, FLOOR, -0.035), wall.at(s1, RAIL, -0.035),
            wall.at(s0, RAIL, -0.035)], "under", -wall.out)
    n = max(1, round((s1 - s0) / 0.44))
    bw = (s1 - s0) / n
    r = bw / 2
    spring = SPRING
    vb.arch_board(b, wall, s0, s1, spring, ARCH_TOP + 0.01, n, "wood", "tar-edge", depth=0.045, d=-0.012,
                  segs=8, piece=b.piece(0.3))
    for i in range(1, n):
        s = s0 + bw * i
        p = wall.at(s, RAIL + 0.1, -0.05)
        lib.lathe("colonnette", [(0, 0.055), (0.05, 0.055), (0.08, 0.034), (spring - RAIL - 0.18, 0.032),
                                 (spring - RAIL - 0.14, 0.05), (spring - RAIL - 0.08, 0.06),
                                 (spring - RAIL - 0.08, 0.0)],
                  at=p, mat=b.mats[b.keys["wood"]], sides=6)


def aisle_and_clerestory(b):
    """The aisle storey's board walls, the clerestory above with its gables, the dark inside."""
    for side, (wall, length) in box_walls(-AX, AX, AY0, AY1).items():
        holes = [(AX - 0.98, AX + 0.98, 0.4, 3.5)] if side == "-y" else []
        vb.board_wall(b, wall, 0, length, FLOOR - 0.02, flat(AZ + 0.05), "wood", "tar-edge",
                      width=(0.2, 0.32), gap=0.008, holes=holes, tag=-0.05, tag_var=0.25)
    for side, (wall, length) in box_walls(-CX, CX, CY0, CY1).items():
        top = gable(length, CZ, RIDGE, 0.5) if side in ("-y", "y") else flat(CZ)
        vb.board_wall(b, wall, 0, length, AISLE_TOP - 0.35, top, "wood", "tar-edge",
                      width=(0.2, 0.32), gap=0.008, tag=-0.35, tag_var=0.2)
        # Small round windows high up: dark holes in a ring.
        if side in ("x", "-x"):
            for s in (length * 0.25, length * 0.75):
                p = wall.at(s, CZ - 0.8, 0.012)
                lib.cylinder("glugg", 0.13, 0.03, p, axis="x", mat=b.mats[b.keys["inside"]], sides=10)
                lib.cylinder("ring", 0.17, 0.02, wall.at(s, CZ - 0.8, 0.0), axis="x",
                             mat=b.mats[b.keys["wood"]], sides=10)
    # Darkness inside, behind the door.
    b.block((-AX + 0.06, AY0 + 0.8, FLOOR - 0.1), (AX - 0.06, AY1 - 0.06, AZ - 0.1), "inside")
    # The vestibule behind the portal, so you can't see through its sides.
    x0, x1, y0, y1, z0, z1 = -1.0, 1.0, AY0 - 0.01, AY0 + 0.82, FLOOR - 0.02, 3.4
    for pts, out in (
        ([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], (1, 0, 0)),
        ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (-1, 0, 0)),
        ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, -1)),
        ([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], (0, 0, 1)),
    ):
        b.face(pts, "inside", out)


def roof_kw(**extra):
    kw = dict(course=SHINGLE, lift=0.022, mat="shingle", step="step", under="under", seg=0.75,
              bare="bare")
    kw.update(extra)
    return kw


def hip_boards(b, corners, w=0.16):
    for lo, hi in corners:
        lo, hi = Vector(lo), Vector(hi)
        ax = (hi - lo).normalized()
        b.beam(lo - ax * 0.05 + UP * 0.03, hi + UP * 0.03, w, 0.05, "wood", up=UP,
               ends="tar-edge", piece=b.piece(-0.3))


def roofs(b):
    """The gallery's and the aisle's skirts round four sides, and the clerestory's steep roof."""
    gx, gy0, gy1 = GX + GO, GY0 - GO, GY1 + GO
    corners = vb.hip_ring(b, (-gx, gx, gy0, gy1, GE), (-AX, AX, AY0, AY1, GT),
                          holes={"x": [(0.3, 0.38, 0.35, 0.5)], "-y": [(0.12, 0.17, 0.2, 0.33)],
                                 "y": [(0.7, 0.76, 0.4, 0.55)]},
                          **roof_kw())
    hip_boards(b, corners)
    # Gables over the north and south entrances, and on the aisle roof over the west, north and
    # south: the stack of gables a stave church is known by.
    for sx in (-1, 1):
        vb.cross_gable(b, (sx * GX, TY), (sx, 0, 0), 0.82, PLATE, math.radians(50), 1.0, roof_kw(),
                       wood="wood", edge="tar-edge", z_wall=PLATE - 0.05, cross_size=0.6)
    for base, out in (((0, AY0), (0, -1, 0)), ((AX, TY), (1, 0, 0)), ((-AX, TY), (-1, 0, 0))):
        vb.cross_gable(b, base, out, 0.95, AZ, math.radians(55), 1.1, roof_kw(), wood="wood",
                       edge="tar-edge", z_wall=AZ - 0.15, cross_size=0.65)
    # Eave boards along the gallery's eaves.
    for side, (wall, length) in box_walls(-gx, gx, gy0, gy1).items():
        b.beam(wall.at(-0.05, GE - 0.06, -0.01), wall.at(length + 0.05, GE - 0.06, -0.01), 0.04,
               0.14, "wood", up=UP, ends="tar-edge", piece=b.piece(-0.1))
    ax = AX + 0.35
    az = AZ - 0.35 * AISLE_SLOPE
    corners = vb.hip_ring(b, (-ax, ax, AY0 - 0.35, AY1 + 0.35, az), (-CX, CX, CY0, CY1, AISLE_TOP),
                          holes={"-x": [(0.55, 0.62, 0.3, 0.45)]}, **roof_kw())
    hip_boards(b, corners)
    for side, (wall, length) in box_walls(-ax, ax, AY0 - 0.35, AY1 + 0.35).items():
        b.beam(wall.at(-0.05, az - 0.06, -0.01), wall.at(length + 0.05, az - 0.06, -0.01), 0.04,
               0.14, "wood", up=UP, ends="tar-edge", piece=b.piece(-0.2))
    # The clerestory's roof, ridge along y.
    xe = CX + 0.35
    ze = CZ - 0.35 * math.tan(PITCH)
    y0, y1 = CY0 - 0.35, CY1 + 0.35
    vb.roof_face(b, (-xe, y1, ze), (-xe, y0, ze), (0, y1, RIDGE), (0, y0, RIDGE),
                 holes=[(0.6, 0.68, 0.45, 0.6)], **roof_kw())
    vb.roof_face(b, (xe, y0, ze), (xe, y1, ze), (0, y0, RIDGE), (0, y1, RIDGE), **roof_kw())
    # Ridge beam and a comb of pickets along it.
    b.beam((0, y0 - 0.1, RIDGE + 0.04), (0, y1 + 0.1, RIDGE + 0.04), 0.12, 0.12, "wood",
           ends="tar-edge", piece=b.piece(-0.3), seg=0.6)
    y = y0 + 0.1
    while y < y1 - 0.05:
        if abs(y - TY) > 0.8:
            b.beam((0, y, RIDGE + 0.08), (0, y, RIDGE + 0.36), 0.035, 0.05, "wood", up=(0, 1, 0),
                   ends="tar-edge", taper=0.6, piece=b.piece(-0.3))
        y += 0.2
    # Barge boards that cross at the apex and run on into the dragons.
    for y, sgn in ((y0 - 0.03, -1), (y1 + 0.03, 1)):
        for sx in (-1, 1):
            lo = Vector((sx * (xe + 0.05), y, ze - 0.05))
            top = Vector((0, y, RIDGE + 0.06))
            ax_ = (top - lo).normalized()
            b.beam(lo, top + ax_ * 0.45, 0.06, 0.34, "wood", up=Vector((0, 1, 0)).cross(ax_),
                   ends="tar-edge", piece=b.piece(-0.3))


def turret(b):
    """The ridge turret: a board shaft, a skirt roof, the belfry with its openings, the spire."""
    h = 0.6
    base = RIDGE - 1.0
    for side, (wall, length) in box_walls(-h, h, TY - h, TY + h).items():
        vb.board_wall(b, wall, 0, length, base, flat(T0), "wood", "tar-edge", width=(0.12, 0.18),
                      gap=0.006, tag=-0.3)
    corners = vb.hip_ring(b, (-1.0, 1.0, TY - 1.0, TY + 1.0, T0 - 0.15),
                          (-0.45, 0.45, TY - 0.45, TY + 0.45, T0 + 0.5), **roof_kw(seg=0.6))
    hip_boards(b, corners, 0.1)
    bh = 0.45
    z1 = T0 + 0.35  # the belfry's foot
    # A dark core, so the belfry's openings don't show the sky through its far side.
    b.block((-0.28, TY - 0.28, z1), (0.28, TY + 0.28, z1 + 0.98), "inside")
    for side, (wall, length) in box_walls(-bh, bh, TY - bh, TY + bh).items():
        hole = (0.2, length - 0.2, z1 + 0.25, z1 + 0.8)
        vb.board_wall(b, wall, 0, length, z1, flat(z1 + 1.0), "wood", "tar-edge",
                      width=(0.1, 0.15), gap=0.005, holes=[hole], tag=-0.3)
        vb.arch_board(b, wall, 0.2, length - 0.2, z1 + 0.55, z1 + 1.0, 1, "wood", "tar-edge",
                      depth=0.03, d=0.005, segs=8)
        for s in (0.2, length - 0.2):
            b.beam(wall.at(s, z1 + 0.2, -0.01), wall.at(s, z1 + 0.82, -0.01), 0.06, 0.06, "wood",
                   up=wall.out, ends="tar-edge")
        # Louvre boards in the opening.
        for z in (z1 + 0.32, z1 + 0.46, z1 + 0.6):
            b.beam(wall.at(0.2, z, -0.1), wall.at(length - 0.2, z, -0.1), 0.02, 0.12, "wood",
                   up=wall.out + UP, ends="tar-edge", piece=b.piece(-0.2))
    # Spire: four faces to a point, then a finial and a little cross.
    s = 0.66
    z0, apex = z1 + 0.92, 16.72
    pts = [(-s, TY - s), (s, TY - s), (s, TY + s), (-s, TY + s)]
    for i in range(4):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % 4]
        vb.roof_face(b, (x0, y0, z0), (x1, y1, z0), (0, TY, apex), (0, TY, apex),
                     **roof_kw(seg=0.5, course=0.1))
    hip_boards(b, [((x, y, z0), (0, TY, apex)) for x, y in pts], 0.08)
    lib.lathe("finial", [(0, 0.05), (0.15, 0.04), (0.2, 0.08), (0.28, 0.08), (0.34, 0.03),
                         (0.36, 0.0)], at=(0, TY, apex - 0.05), mat=b.mats[b.keys["wood"]], sides=8)
    lib.cylinder("rod", 0.012, 0.32, (0, TY, apex + 0.46), mat=b.mats[b.keys["iron"]], sides=6)
    vb.cross(b, (0, TY, apex + 0.42), (0, -1, 0), 0.32, "iron", "iron", thick=0.02)


def chancel(b):
    """The chancel east of the nave, its steep roof, the apse with its round tower roof."""
    walls = box_walls(-HX, HX, HY0, HY1)
    for side, (wall, length) in walls.items():
        if side == "-y":
            continue
        top = gable(length, HZ, HRIDGE, 0.4) if side == "y" else flat(HZ + 0.05)
        vb.board_wall(b, wall, 0, length, FOOT, top, "wood", "tar-edge", width=(0.2, 0.32),
                      gap=0.008, tag=-0.1, tag_var=0.25,
                      broken={3: 0.35, 4: 0.22} if side == "x" else None)
    xe = HX + 0.3
    ze = HZ - 0.3 * HPITCH
    y0, y1 = HY0 - 0.6, HY1 + 0.3
    vb.roof_face(b, (-xe, y1, ze), (-xe, y0, ze), (0, y1, HRIDGE), (0, y0, HRIDGE), **roof_kw())
    vb.roof_face(b, (xe, y0, ze), (xe, y1, ze), (0, y0, HRIDGE), (0, y1, HRIDGE),
                 holes=[(0.55, 0.68, 0.3, 0.45)], **roof_kw())
    b.beam((0, y0, HRIDGE + 0.04), (0, y1 + 0.08, HRIDGE + 0.04), 0.11, 0.1, "wood", ends="tar-edge")
    for sx in (-1, 1):
        lo = Vector((sx * (xe + 0.04), y1 + 0.03, ze - 0.05))
        top = Vector((0, y1 + 0.03, HRIDGE + 0.05))
        ax_ = (top - lo).normalized()
        b.beam(lo, top + ax_ * 0.12, 0.05, 0.26, "wood", up=Vector((0, -1, 0)).cross(ax_),
               ends="tar-edge", piece=b.piece(-0.3))
    vb.cross(b, (0, y1 + 0.05, HRIDGE + 0.1), (0, 1, 0), 0.75, "wood", "tar-edge", thick=0.06)

    # The apse: board walls round a half polygon, a half cone roof, a round tower roof on top.
    apse_top = 3.5
    for p0, p1, out in apse_segments(APSE_R):
        wall = Wall(p0, out)
        vb.board_wall(b, wall, 0, (p1 - p0).length, FOOT, flat(apse_top), "wood", "tar-edge",
                      width=(0.16, 0.24), gap=0.006, tag=-0.1, inside=None)
    b.face([Vector((x, HY1 + 0.02, z)) for x, z in ((-APSE_R, FOOT), (APSE_R, FOOT),
                                                     (APSE_R, apse_top), (-APSE_R, apse_top))],
           "inside", (0, 1, 0))
    apex = Vector((0, HY1, 5.3))
    re = APSE_R + 0.3
    ze = apse_top - 0.3 * 1.1
    for p0, p1, out in apse_segments(re):
        vb.roof_face(b, (p0.x, p0.y, ze), (p1.x, p1.y, ze), apex, apex, **roof_kw(seg=0.6))
    tower = Vector((0, HY1 + 0.45, 0))
    lib.lathe("apse-tower", [(4.7, 0.36), (5.6, 0.36), (5.62, 0.42), (5.66, 0.0)],
              at=tower, mat=b.mats[b.keys["wood"]], sides=10)
    for i in range(8):
        a0, a1 = 2 * math.pi * i / 8, 2 * math.pi * (i + 1) / 8
        r = 0.5
        e0 = tower + Vector((math.cos(a1) * r, math.sin(a1) * r, 5.55))
        e1 = tower + Vector((math.cos(a0) * r, math.sin(a0) * r, 5.55))
        vb.roof_face(b, e0, e1, tower + UP * 6.55, tower + UP * 6.55,
                     **roof_kw(seg=0.4, course=0.09))
    lib.cylinder("rod", 0.012, 0.3, tower + UP * 6.65, mat=b.mats[b.keys["iron"]], sides=6)
    vb.cross(b, tower + UP * 6.62, (0, 1, 0), 0.26, "iron", "iron", thick=0.02)


def porch_and_portal(b):
    """The west porch on its posts with gable and cross, the carved portal, the door ajar."""
    front = Wall((-PX, PY), (0, -1, 0))
    for sx in (-1, 1):
        x = sx * (PX - 0.12)
        b.beam((x, PY + 0.08, FOOT), (x, PY + 0.08, 2.32), 0.2, 0.2, "wood", ends="tar-edge",
               jitter=0.006, piece=b.piece(0.2))
        b.beam((x, PY - 0.05, 2.25), (x, GY0 + 0.05, 2.25), 0.16, 0.2, "wood", ends="tar-edge",
               piece=b.piece(0.1))
        # Low side walls of the porch.
        side = Wall((x + sx * 0.1, GY0 if sx < 0 else PY + 0.15), (sx, 0, 0))
        vb.board_wall(b, side, 0, GY0 - PY - 0.15, FOOT + 0.02, flat(1.1), "wood", "tar-edge",
                      width=(0.16, 0.24), gap=0.006, inside=None, tag=0.4)
        b.beam(side.at(-0.05, 1.15, -0.05), side.at(GY0 - PY - 0.1, 1.15, -0.05), 0.14, 0.1, "wood",
               ends="tar-edge", piece=b.piece(0.3))
    b.beam((-PX - 0.1, PY + 0.02, 2.4), (PX + 0.1, PY + 0.02, 2.4), 0.18, 0.2, "wood", ends="tar-edge",
           piece=b.piece(0.1))
    span = 2 * PX - 0.24
    r = (span - 0.2) / 2
    vb.arch_board(b, front, 0.22, 2 * PX - 0.22, 2.3 - r - 0.03, 2.32, 1, "wood", "tar-edge",
                  depth=0.05, d=-0.02, segs=14, piece=b.piece(0.1))
    # The porch's gable: boards, barge boards, a cross on the apex.
    vb.cross_gable(b, (0, GY0), (0, -1, 0), PX, 2.5, math.radians(50), 1.0, roof_kw(),
                   wood="wood", edge="tar-edge", front=GY0 - PY - 0.02, z_wall=2.48,
                   cross_size=0.75, barge_w=0.28)

    # The carved portal in the aisle's west wall.
    wall = Wall((-AX, AY0), (0, -1, 0))
    sc = AX
    hw, spring, rad = 0.5, 2.3, 0.5
    z0, shoulder, apex_z = FLOOR - 0.02, 2.95, 3.45
    arc = [(sc + rad * math.cos(a), spring + rad * math.sin(a))
           for a in (math.pi - math.pi / 2 * k / 8 for k in range(9))]
    left = [(sc - 0.95, z0), (sc - hw, z0)] + arc + [(sc, apex_z), (sc - 0.95, shoulder)]
    right = [(2 * sc - s, z) for s, z in left][::-1]
    for poly in (left, right):
        b.slab([wall.at(s, z, 0.1) for s, z in poly], wall.out, 0.13, "carve", "tar-edge",
               b.piece(0.0), (0, 0, 1))
    # Colonnettes with capitals either side, a lintel roll, the threshold.
    for sgn in (-1, 1):
        p = wall.at(sc + sgn * 0.68, z0, 0.16)
        lib.lathe("portal-column", [(0, 0.08), (0.1, 0.08), (0.14, 0.055), (1.55, 0.05), (1.6, 0.075),
                                    (1.72, 0.09), (1.75, 0.0)],
                  at=p, mat=b.mats[b.keys["carve"]], sides=8)
    b.beam(wall.at(sc - 0.9, z0 + 0.04, 0.05), wall.at(sc + 0.9, z0 + 0.04, 0.05), 0.3, 0.08,
           "wood", ends="tar-edge", piece=b.piece(0.3))
    # A little gabled hood over the portal.
    for sgn in (-1, 1):
        lo = wall.at(sc + sgn * 1.05, shoulder - 0.08, 0.18)
        top = wall.at(sc, apex_z + 0.1, 0.18)
        b.beam(lo, top, 0.16, 0.06, "wood", up=wall.out, ends="tar-edge", piece=b.piece(-0.2))

    # The door, ajar: boards under a round head, iron straps, a ring.
    angle = math.radians(34)
    hinge = Vector((-hw + 0.02, AY0 - 0.0, 0))
    d = Vector((math.cos(angle), math.sin(angle), 0))
    door = Wall(hinge, d.cross(UP))
    dw = 2 * hw - 0.04
    head = [(-0.01, spring)] + [(dw / 2 + (rad - 0.02) * math.cos(a), spring + (rad - 0.02) * math.sin(a))
                                for a in (math.pi - math.pi * k / 12 for k in range(13))] + [(dw + 0.01, spring)]
    vb.board_wall(b, door, 0, dw, z0 + 0.02, head, "wood", "tar-edge", width=(0.2, 0.28), gap=0.003,
                  depth=0.05, inside=None, ragged=0.0, jitter=0.002, lean=0.0, tag=-0.25)
    for z in (z0 + 0.35, 1.45, 2.3):
        b.beam(door.at(-0.02, z, 0.01), door.at(dw * 0.78, z, 0.01), 0.008, 0.06, "iron", up=door.out)
        lib.tube("strap-curl", [door.at(dw * 0.78, z, 0.012), door.at(dw * 0.85, z + 0.06, 0.012),
                                door.at(dw * 0.8, z + 0.12, 0.012), door.at(dw * 0.74, z + 0.08, 0.012)],
                 [0.012, 0.011, 0.009, 0.006], b.mats[b.keys["iron"]], sides=5)
    ring = [door.at(dw * 0.82 + 0.07 * math.cos(a), 1.2 + 0.07 * math.sin(a), 0.03)
            for a in (2 * math.pi * k / 10 for k in range(11))]
    lib.tube("ring", ring, [0.009] * 11, b.mats[b.keys["iron"]], sides=5)


def dragons(m):
    """Dragon heads on the crossed barge boards of the clerestory's two gables."""
    xe = CX + 0.35
    ze = CZ - 0.35 * math.tan(PITCH)
    for y, fy in ((CY0 - 0.38, -1), (CY1 + 0.38, 1)):
        for sx in (-1, 1):
            lo = Vector((sx * xe, y, ze))
            top = Vector((0, y, RIDGE + 0.06))
            end = top + (top - lo).normalized() * 0.4
            vb.dragon(end - Vector((0, 0, 0.08)), (sx * 0.4, fy, 0), m["wood"], scale=1.7,
                      lean=0.0)
