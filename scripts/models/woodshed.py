"""
Woodshed: an open-fronted lean-to of silvered boards, spaced for the wind to dry the wood, on posts
and flat stones, a thin turf roof falling to the back, and inside a stack of split birch, used down
in the middle, a few pieces fallen out in front. The open front faces -y.
"""

import random

from mathutils import Matrix

import village_logs as v

OUT = "models/village/woodshed.glb"
ORIGIN = "bottom"
TRIS = 8100  # about 8k: most of it is the split birch, piece by piece
SMOOTH_ANGLE = 50
AO = 1024
AO_DISTANCE = 0.25

HX, HY = 1.85, 1.3  # posts
FRONT_Z = 2.72  # the roof boards' top at the front
SLOPE = 0.27
VERGE = 1.93
FRONT_Y = -1.42  # the roof's front edge


def build():
    rng = random.Random(41)
    boards = v.timber("boards", 1024, "z", seed=41, kind="board", dark=0.25, board=0.17, floor=0.0, lichen=0.8)
    frame = v.timber("frame", 512, "x", seed=42, kind="log", dark=0.55, z0=0, pitch=1.0)
    roofboards = v.timber("roof-boards", 512, "y", seed=43, kind="board", dark=0.7)
    wood = v.timber("birch-wood", 1024, "y", seed=44, kind="board", dark=0.05, board=0.11, lichen=0.4, moss=0.3,
                    cracks=1.0, ends=((0.1, 0.085, 0.065), (0.17, 0.15, 0.12)))
    backing = v.plain("stack-back", (0.03, 0.025, 0.019), 0.9)
    bark = birch_bark()
    stone = v.stone_mat("stone", 512, seed=45)
    turf = v.turf_mat("turf", 1024, seed=46)
    rbark = v.bark_mat("bark", 256, seed=47)
    dark = v.plain("dark", (0.006, 0.005, 0.004), 0.95)
    grass = v.grass_mats()

    def under(x, y):
        return FRONT_Z - 0.03 - (y - FRONT_Y) * SLOPE

    part = v.Part("shed")
    # Posts on flat stones, sills and the beams the roof rests on.
    for x in (-HX, 0.0, HX):
        for y in (-HY, HY):
            if x == 0.0 and y < 0:
                continue
            v.stone(part, stone, (x, y, 0.07), (0.32, 0.3, 0.16), rng, cuts=1, ground=0.0, flat_top=0.5)
            top = under(x, y) - 0.1
            v.cuboid(part, frame, Matrix.Translation((x, y, (0.14 + top) / 2)) @ Matrix.Rotation(rng.uniform(-0.04, 0.04), 4, "Z"),
                     (0.12, 0.12, top - 0.14), jitter=0.008, rng=rng)
    for y in (-HY, HY):
        z = under(0, y) - 0.1 + 0.05
        v.log(part, frame, (-HX - 0.12, y, z), (HX + 0.12, y, z), 0.06, 0.07, rng, shape=3.5, sides=8)
    for x in (-HX, HX):
        v.log(part, frame, (x, -HY - 0.05, 0.2), (x, HY + 0.05, 0.2), 0.06, 0.06, rng, shape=3.5, sides=8)
    v.log(part, frame, (-HX, HY, 0.2), (HX, HY, 0.2), 0.06, 0.06, rng, shape=3.5, sides=8)
    # Back and side walls: boards with gaps between, tops cut to the roof.
    gapw = 0.035
    bw = 0.17
    n = int(2 * HX / (bw + gapw))
    for i in range(n):
        x0 = -HX + 0.06 + i * (2 * HX - 0.12) / n
        if i == 5:
            continue
        v.sloped_board(part, boards, x0, x0 + bw * rng.uniform(0.85, 1.05), HY + 0.06, HY + 0.085, 0.15 + rng.uniform(0, 0.03),
                       lambda x, y: under(x, HY) - 0.08)
    for sx in (-1, 1):
        n = int(2 * HY / (bw + gapw))
        for i in range(n):
            y0 = -HY + 0.06 + i * (2 * HY - 0.12) / n
            y1 = y0 + bw * rng.uniform(0.85, 1.05)
            h_cut = 0.0 if not (sx > 0 and i == 1) else 0.9  # one broken short
            x = sx * (HX + 0.07)
            v.sloped_board(part, boards, x - 0.0125, x + 0.0125, y0, y1, 0.15 + rng.uniform(0, 0.03),
                           lambda xx, y, h=h_cut: under(xx, y) - 0.08 - h)
    # Floor of old boards, gone grey.
    for i in range(14):
        x = -HX + (2 * HX) * (i + 0.5) / 14
        v.cuboid(part, roofboards, Matrix.Translation((x, 0, 0.27)), (2 * HX / 14 - 0.01, 2 * HY, 0.03), jitter=0.004, rng=rng)
    woodstack(part, wood, bark, backing, rng)
    part.finish()

    _, made = v.made(
        v.turf_roof,
        {"boards": roofboards, "purlin": frame, "turf": turf, "bark": rbark, "grass": grass},
        rng, -VERGE, VERGE, -2 * FRONT_Y, SLOPE, FRONT_Z, sag=0.04, turf=0.1, sides=(1,),
        purlins=[], verge_w=0.2, hooks=0.6, turf_log=0.05, grass=0.6, board_w=0.22,
    )
    v.place(made, Matrix.Translation((0, FRONT_Y, 0)))


def birch_bark():
    """Birch bark on firewood left sixty years: grey-white, black lenticels and scars, moss."""
    import lib
    from cargo import Field, smooth
    mat, n = lib.procedural("birch-bark", 1024)
    f = Field(n, 48)
    color = n.mix(f.noise(2, 4), (0.2, 0.195, 0.18), (0.36, 0.35, 0.33))
    dash = smooth(n, f.noise(5, 3, stretch=(14, 1, 14)), 0.66, 0.7)
    color = n.mix(dash, color, (0.02, 0.018, 0.016))
    scar = smooth(n, f.noise(1.5, 4), 0.66, 0.72)
    color = n.mix(scar, color, (0.03, 0.025, 0.02))
    peel = smooth(n, f.noise(3, 5), 0.68, 0.72)
    color = n.mix(peel, color, (0.11, 0.06, 0.03))
    moss = smooth(n, f.noise(2.5, 4), 0.62, 0.7)
    color = n.mix(n.math("MULTIPLY", moss, 0.7), color, v.MOSS)
    color = n.mix(n.math("MULTIPLY", lib.crevices(n, 0.03), 0.7), color, (0.01, 0.009, 0.008))
    h = n.math("ADD", n.math("MULTIPLY", dash, -0.5), n.math("MULTIPLY", f.noise(30, 3), 0.3))
    n.out(**{"Base Color": color, "Roughness": 0.75, "Normal": n.bump(h, distance=0.002)})
    return mat


def woodstack(part, wood, bark, backing, rng):
    """Split birch stacked against the back wall, ends out, two pieces deep, used down in the
    middle of the front row so the back row's ends show there; a few pieces fallen out."""
    length = 0.36
    x0, x1 = -HX + 0.12, HX - 0.12
    y_front = HY - 0.05 - 2 * length
    base = 0.3
    full = 1.55
    cols = []
    x = x0
    while x < x1 - 0.06:
        r = rng.uniform(0.085, 0.105)
        t = (x - x0) / (x1 - x0)
        dip = max(0.0, 1 - abs(t - 0.45) / 0.28)
        cols.append((x + r, r, full - 0.85 * dip + rng.uniform(-0.06, 0.04)))
        x += r * 1.5

    def column(cx, r, y, z_from, z_to):
        z = z_from + r
        while z < z_to:
            rr = r * rng.uniform(0.88, 1.08)
            spin = rng.choice((0.0, 1.57, 3.14, -1.57)) + rng.uniform(-0.5, 0.5)
            v.split_piece(part, wood, bark, (cx + rng.uniform(-0.01, 0.01), y + rng.uniform(-0.025, 0.025), z),
                          length, rr, rng, turn_=spin)
            z += rr * 1.15

    for cx, r, h in cols:
        column(cx, r, y_front + length / 2, base, base + h)
        if h < full - 0.15:
            column(cx, r, y_front + 1.5 * length, base + h - 0.12, base + full)
    # Behind the front row's gaps: dark wood, as deep stacks look.
    low = min(h for _, _, h in cols)
    v.cuboid(part, backing, Matrix.Translation(((x0 + x1) / 2, y_front + length * 0.9, base + low / 2)), (x1 - x0, 0.02, low))
    v.cuboid(part, backing, Matrix.Translation(((x0 + x1) / 2, y_front + length * 1.95, base + full / 2)), (x1 - x0, 0.02, full))
    for _ in range(3):
        x = rng.uniform(-1.2, 1.2)
        y = rng.uniform(-1.35, y_front - 0.1)
        z = 0.33 if y > -HY else 0.05
        v.split_piece(part, wood, bark, (x, y, z), length, rng.uniform(0.075, 0.09), rng, axis="x",
                      turn_=rng.uniform(0, 6.28))
