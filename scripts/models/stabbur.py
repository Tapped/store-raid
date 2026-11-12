"""
Stabbur: the farm's raised storehouse, notched logs on wooden posts standing on stacked stones, the
board-clad loft jutting out over the storey below on cantilevered logs, carved corner posts, a
carved doorframe with scrolls round an arched head, a stone step set apart from the door so mice
can't climb in, and a turf roof with crossed vergeboards. The door faces -y.
"""

import math
import random

from mathutils import Matrix, Vector

import lib
import village_logs as v

OUT = "models/village/stabbur.glb"
ORIGIN = "bottom"
TRIS = 30000
SMOOTH_ANGLE = 50
AO = 2048
AO_DISTANCE = 0.3

POST_TOP = 0.92  # top of the wooden posts on the stone pillars
HX = HY = 1.65  # log walls' centre lines
RT, RV, PITCH = 0.11, 0.155, 0.25
COURSES = 8
HEAD = 0.25
UX = UY = 2.05  # the loft's frame centre lines
SILL_Z = 3.34
PLATE_Z = 4.62
SLOPE = math.tan(math.radians(28))
EAVE = UY + 0.5
VERGE = UX + 0.4
DOOR = (0.0, 0.76)  # x, width


def build():
    rng = random.Random(21)
    grass = v.grass_mats()
    m = {
        "-y": v.timber("logs-front", 2048, "x", seed=21, dark=0.62, z0=POST_TOP, pitch=PITCH, floor=0.0),
        "y": v.timber("logs-back", 2048, "x", seed=22, dark=0.22, z0=POST_TOP, pitch=PITCH, floor=0.0, lichen=0.8),
        "x": v.timber("logs-gable", 2048, "y", seed=23, dark=0.65, dark_axis=("x", -2, 2),
                      z0=POST_TOP + PITCH / 2, pitch=PITCH, floor=0.0),
        "inner": v.plain("inside-wood", (0.03, 0.022, 0.015), 0.9),
    }
    cladding = v.timber("cladding", 2048, "z", seed=24, kind="board", dark=0.42, board=0.2, moss=0.3)
    posts = v.timber("posts", 1024, "z", seed=25, kind="board", dark=0.5, board=0.3, moss=0.4, cracks=0.8)
    boards = v.timber("boards", 2048, "y", seed=26, dark=0.55, kind="board", moss=0.7)
    stone = v.stone_mat("stone", 1024, seed=27, lichen=0.8)
    turf = v.turf_mat("turf", 2048, seed=28)
    bark = v.bark_mat("bark", 512, seed=29)
    iron = v.iron_mat()
    dark = v.plain("dark", (0.004, 0.0035, 0.003), 0.95)

    part = v.Part("body")
    # Pillars: stacked stones with a wooden post on each, under the sill logs.
    for x in (-HX, 0.0, HX):
        for y in (-HY, HY):
            # Two or three rough stones stacked, the biggest at the bottom.
            z = 0.0
            top = rng.uniform(0.38, 0.46)
            sizes = [rng.uniform(0.55, 0.7)]
            hs = [rng.uniform(0.16, 0.24)]
            while z + hs[-1] < top - 0.08:
                z += hs[-1] * 0.85
                sizes.append(sizes[-1] * rng.uniform(0.75, 0.9))
                hs.append(min(rng.uniform(0.1, 0.18), top - z + 0.03))
            z = 0.0
            for sz, hh in zip(sizes, hs):
                v.stone(part, stone, (x + rng.uniform(-0.03, 0.03), y + rng.uniform(-0.03, 0.03), z + hh / 2),
                        (sz, sz * rng.uniform(0.85, 1.0), hh * 1.15), rng, cuts=1, ground=0.0,
                        flat_top=0.4, round_=0.55, rough=0.2)
                z += hh * 0.85
            top = z + 0.03
            ph = POST_TOP - top - 0.08
            v.cuboid(part, posts, Matrix.Translation((x, y, top + 0.08 + ph / 2)) @ Matrix.Rotation(rng.uniform(-0.1, 0.1), 4, "Z"),
                     (0.26, 0.26, ph), jitter=0.012, rng=rng)
            # The flat stone over the post that rats can't get past.
            v.stone(part, stone, (x, y, POST_TOP - 0.02), (0.42, 0.42, 0.06), rng, cuts=1, flat_top=0.6, round_=0.3)
    # Log walls; the long walls' top logs and the gables' carry the loft.
    lo, hi = POST_TOP + PITCH, POST_TOP + PITCH * 7
    openings = [("-y", DOOR[0] - DOOR[1] / 2 - 0.1, DOOR[0] + DOOR[1] / 2 + 0.1, lo, hi)]
    top = v.log_walls(part, m, HX, HY, POST_TOP + 0.04, COURSES, PITCH, RT, RV, HEAD, rng,
                      openings=openings, plate=UY + 0.15 - HX - HEAD)
    # Floor, dark, under the door and seen from underneath.
    v.cuboid(part, m["inner"], Matrix.Translation((0, 0, POST_TOP + 0.12)), (2 * HX - 0.15, 2 * HY - 0.15, 0.06))
    # Cantilevered logs across the house, standing out under the loft.
    zc = top + 0.11
    for x in (-HX, -0.6, 0.6, HX):
        # Over the gables they sit right on the top course, deeper, closing the gap.
        if abs(x) == HX:
            v.log(part, m["x"], (x, -UY - 0.17, zc - 0.06), (x, UY + 0.17, zc - 0.06), 0.11, 0.18, rng)
        else:
            v.log(part, m["x"], (x, -UY - 0.17, zc), (x, UY + 0.17, zc), 0.1, 0.12, rng)
    # The loft's sill frame.
    for s in (-1, 1):
        v.log(part, m["-y" if s < 0 else "y"], (-UX - 0.16, s * UY, SILL_Z), (UX + 0.16, s * UY, SILL_Z), 0.1, 0.12, rng,
              shape=3.4, chamfer=(0.015, 0.015))
        v.log(part, m["x"], (s * UX, -UY - 0.12, SILL_Z + 0.03), (s * UX, UY + 0.12, SILL_Z + 0.03), 0.1, 0.12, rng,
              shape=3.4, chamfer=(0.015, 0.015))
        v.log(part, m["-y" if s < 0 else "y"], (-UX - 0.14, s * UY, PLATE_Z), (UX + 0.14, s * UY, PLATE_Z), 0.09, 0.1, rng,
              shape=3.4, chamfer=(0.015, 0.015))
        v.log(part, m["x"], (s * UX, -UY - 0.1, PLATE_Z + 0.02), (s * UX, UY + 0.1, PLATE_Z + 0.02), 0.09, 0.1, rng,
              shape=3.4, chamfer=(0.015, 0.015))
    # Loft floor boards, seen from below where the loft juts out, and its inside, dark.
    n_fb = 22
    for i in range(n_fb):
        x = -UX - 0.08 + (2 * UX + 0.16) * (i + 0.5) / n_fb
        v.cuboid(part, boards, Matrix.Translation((x, 0, top + 0.245)),
                 ((2 * UX + 0.16) / n_fb - 0.008, 2 * UY + 0.16, 0.035), skip=("+z",))
    v.cuboid(part, m["inner"], Matrix.Translation((0, 0, SILL_Z + 0.1)), (2 * UX - 0.1, 2 * UY - 0.1, 0.05))
    v.cuboid(part, dark, Matrix.Translation((0, 0, (SILL_Z + PLATE_Z) / 2)), (2 * UX - 0.4, 2 * UY - 0.4, PLATE_Z - SILL_Z - 0.2))

    ridge = PLATE_Z + 0.1 + UY * SLOPE + 0.035
    # Gable triangles of logs over the loft, a vent hole in each.
    for s in (-1, 1):
        v.gable_logs(part, m["x"], s * UX, PLATE_Z + 0.21, ridge - 0.035, SLOPE, 0.19, 0.075, 0.105, rng,
                     gaps=[(-0.22, 0.22, PLATE_Z + 0.55, PLATE_Z + 0.95)])
        v.cuboid(part, dark, Matrix.Translation((s * (UX - 0.1), 0, PLATE_Z + 0.75)), (0.02, 0.5, 0.45))
    part.finish()

    loft(rng, cladding, posts, dark)
    door(rng, posts, iron, stone, dark)

    v.turf_roof(
        {"boards": boards, "purlin": m["y"], "turf": turf, "bark": bark, "inner": m["inner"], "grass": grass},
        rng, -VERGE, VERGE, EAVE, SLOPE, ridge, sag=0.05, turf=0.18, inside=(UX, UY),
        purlins=[(0.0, 0.12), (-1.0, 0.1), (1.0, 0.1)], cross=0.4,
    )


def carved_post(x, y, z0, z1, mat, k=1.0):
    """A square post with a turned profile: base, a swelling, collars and a neck under the head."""
    h = z1 - z0
    r = 0.13 * k  # lathe radius, so faces 0.09 across from the axis
    prof = [
        (0.0, r), (0.12, r), (0.14, r * 0.85), (0.2, r * 0.85), (0.24, r * 1.05), (0.42, r * 1.12),
        (0.62, r * 0.9), (0.66, r * 0.78), (0.7, r * 0.95), (0.73, r * 0.95), (0.76, r * 0.72),
        (0.86, r * 0.82), (0.9, r * 1.08), (0.94, r * 1.08), (0.97, r * 0.9), (1.0, r * 1.0),
    ]
    obj = lib.lathe("post", [(z0 + t * h, rr) for t, rr in prof], mat=mat, sides=4)
    obj.matrix_world = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.pi / 4, 4, "Z")
    return obj


def loft(rng, cladding, posts, dark):
    """Vertical boards round the loft between its sill and plate, carved posts at the corners and
    between, an open hatch in the front with a rail."""
    part = v.Part("loft")
    z0, z1 = SILL_Z + 0.1, PLATE_Z - 0.08
    out = UY + 0.115
    for wall in ("-y", "y", "-x", "x"):
        mtx = v.wall_frame(wall, UX + 0.115, UY + 0.115)
        span = 2 * UX
        n = 20
        bw = span / n
        for i in range(n):
            u = -span / 2 + bw * (i + 0.5)
            if wall == "-y" and 0.35 < u < 1.55:
                # The hatch: boards only below it.
                h = 0.45
                v.cuboid(part, cladding, mtx @ Matrix.Translation((u, -0.012, z0 + h / 2)), (bw - 0.008, 0.024, h), jitter=0.003, rng=rng)
                continue
            if wall == "y" and i in (6, 13):
                continue  # boards gone
            h = z1 - z0 - rng.uniform(0, 0.03)
            v.cuboid(part, cladding, mtx @ Matrix.Translation((u + rng.uniform(-0.004, 0.004), -0.012, z0 + h / 2)), (bw - 0.006, 0.024, h), jitter=0.003, rng=rng)
            # Cover strips over the joints, every other one.
            if i % 2 == 1 and i < n - 1:
                v.cuboid(part, cladding, mtx @ Matrix.Translation((u + bw / 2, -0.032, z0 + h / 2)), (0.05, 0.018, h - 0.02))
    # Dark behind the missing boards and the hatch.
    for wall, u, w, zz, hh in (("-y", 0.95, 1.3, z0 + 0.82, 0.75), ("y", 0.0, 4.0, (z0 + z1) / 2, z1 - z0)):
        mtx = v.wall_frame(wall, UX, UY)
        v.cuboid(part, dark, mtx @ Matrix.Translation((v.wall_u(wall, u), 0.09, zz)), (w, 0.02, hh))
    # The hatch's rail and frame.
    mtx = v.wall_frame("-y", UX + 0.115, UY + 0.115)
    v.cuboid(part, posts, mtx @ Matrix.Translation((0.95, -0.03, z0 + 0.47)), (1.3, 0.07, 0.06))
    v.cuboid(part, posts, mtx @ Matrix.Translation((0.95, -0.02, z1 - 0.04)), (1.3, 0.05, 0.08))
    part.finish()
    # Carved posts.
    for x, y in ((-UX, -UY), (UX, -UY), (-UX, UY), (UX, UY)):
        carved_post(x + math.copysign(0.07, x), y + math.copysign(0.07, y), SILL_Z + 0.08, PLATE_Z - 0.05, posts, 1.15)
    for x in (-0.95, 0.3, 1.6):
        carved_post(x, -out - 0.03, SILL_Z + 0.08, PLATE_Z - 0.05, posts)
    for x in (-0.7, 0.7):
        carved_post(x, out + 0.03, SILL_Z + 0.08, PLATE_Z - 0.05, posts, 0.9)
    for y in (-0.7, 0.7):
        for s in (-1, 1):
            carved_post(s * (out + 0.03), y, SILL_Z + 0.08, PLATE_Z - 0.05, posts, 0.9)


def scroll(centre, size, turns, sign, y, start=0.0):
    """Points of a spiral scroll in the xz plane at depth y, winding in to `centre`."""
    pts = []
    steps = int(turns * 14)
    for i in range(steps + 1):
        t = i / steps
        a = start + sign * t * turns * 2 * math.pi
        r = size * (1 - 0.82 * t)
        pts.append((centre[0] + r * math.cos(a), y, centre[1] + r * math.sin(a)))
    return pts


def door(rng, posts, iron, stone, dark):
    """The carved doorframe with its arched head, the plank door and lock, the step apart."""
    x, w = DOOR
    lo, hi = POST_TOP + 0.04 + PITCH, POST_TOP + 0.04 + PITCH * 7
    fy = -HY - RT - 0.035  # the frame's face
    part = v.Part("door")
    bw = 0.2
    for s in (-1, 1):
        v.cuboid(part, posts, Matrix.Translation((x + s * (w / 2 + bw / 2), fy + 0.02, (lo + hi) / 2 + 0.05)), (bw, 0.07, hi - lo + 0.3))
    v.cuboid(part, posts, Matrix.Translation((x, fy + 0.02, hi + 0.12)), (w + 2 * bw + 0.06, 0.07, 0.24))
    # Threshold.
    v.cuboid(part, posts, Matrix.Translation((x, fy + 0.05, lo - 0.06)), (w + 2 * bw + 0.1, 0.16, 0.12))
    # Lining through the wall.
    for s in (-1, 1):
        v.cuboid(part, posts, Matrix.Translation((x + s * (w / 2 + 0.03), -HY, (lo + hi) / 2)), (0.06, 2 * RT, hi - lo))
    v.cuboid(part, dark, Matrix.Translation((x, -HY + 0.3, (lo + hi) / 2)), (w + 0.2, 0.02, hi - lo + 0.2))
    part.finish()
    # The arched head: a board with a round-topped opening.
    arch_lo = hi - 0.3
    pts = [(-w / 2, arch_lo - 0.02), (-w / 2, -0.0)]
    pts = [(-w / 2 - 0.02, 0.0)]
    for i in range(13):
        a = math.pi - math.pi * i / 12
        pts.append((w / 2 * math.cos(a), 0.12 + 0.17 * math.sin(a) - 0.0))
    pts += [(w / 2 + 0.02, 0.0), (w / 2 + 0.02, 0.32), (-w / 2 - 0.02, 0.32)]
    lib.shape("arch", pts, at=(x, fy - 0.02, arch_lo - 0.02), depth=0.05, mat=posts)
    # Scrolls carved on the frame: chains of spirals up each side and two over the head.
    sy = fy - 0.016
    for s in (-1, 1):
        cx = x + s * (w / 2 + bw / 2)
        zs = [lo + 0.25 + k * 0.36 for k in range(int((hi - lo) / 0.36))]
        stem = [(cx + s * 0.055 * (1 if k % 2 else -1), sy, z) for k, z in enumerate(zs)]
        for k, z in enumerate(zs):
            side = 1 if k % 2 else -1
            pts = scroll((cx + side * 0.02, z + 0.03), 0.075, 1.4, side * s, sy, start=math.pi if side > 0 else 0)
            lib.tube("scroll", pts, [0.017 * (1 - 0.5 * i / len(pts)) for i in range(len(pts))], posts, sides=6)
        lib.tube("stem", [(cx, sy, lo + 0.05)] + stem + [(cx, sy, hi + 0.1)], [0.018] * (len(stem) + 2), posts, sides=6)
    for s in (-1, 1):
        pts = scroll((x + s * 0.24, hi + 0.12), 0.095, 1.6, -s, sy, start=0 if s > 0 else math.pi)
        lib.tube("scroll", pts, [0.017 * (1 - 0.5 * i / len(pts)) for i in range(len(pts))], posts, sides=6)
    # The door, shut, a lock plate and a hasp.
    fm = v.wall_frame("-y", HX, HY, x)
    v.plank_door(fm, {"door": posts, "iron": iron}, w, arch_lo - lo + 0.12, lo, -RT + 0.03, rng,
                 boards=4, brace=None, hinge_side=-1)
    lock = v.Part("lock")
    v.cuboid(lock, iron, Matrix.Translation((x + w / 2 - 0.1, -HY - RT + 0.02, lo + 0.75)), (0.12, 0.01, 0.2))
    v.cuboid(lock, iron, Matrix.Translation((x + w / 2 - 0.1, -HY - RT + 0.01, lo + 0.71)), (0.02, 0.012, 0.05))
    lock.finish()
    # The step, a gap in front of the door: a slab on two stones, a lower stone before it.
    steps = v.Part("steps")
    sy0 = -HY - RT - 0.62
    z = 0.0
    for size, hh in ((0.78, 0.24), (0.66, 0.2), (0.6, 0.16)):
        v.stone(steps, stone, (x + rng.uniform(-0.04, 0.04), sy0 + rng.uniform(-0.03, 0.03), z + hh / 2),
                (size, size * 0.62, hh * 1.15), rng, cuts=1, ground=0.0, flat_top=0.4, round_=0.55, rough=0.2)
        z += hh * 0.9
    v.stone(steps, stone, (x, sy0, 0.66), (0.95, 0.56, 0.13), rng, cuts=2, flat_top=0.6, round_=0.3, rough=0.08)
    v.stone(steps, stone, (x + 0.05, sy0 - 0.52, 0.17), (0.8, 0.42, 0.36), rng, cuts=2, ground=0.0, flat_top=0.5)
    steps.finish()
