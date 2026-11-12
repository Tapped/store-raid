"""
Well: a ring of mossy fieldstones round a dark shaft, half covered by loose planks, a windlass
between two posts with its iron crank and a rope down to a bucket, under a little board roof.
"""

import math
import random

import bmesh
from mathutils import Matrix, Vector

import lib
import village_props as vp

OUT = "models/village/well.glb"
# The shaft goes 0.6 m below the ground: the origin stays at ground level, the ring's centre.
ORIGIN = "model"
TRIS = 7000
AO = 2048
AO_DISTANCE = 0.25
SMOOTH_ANGLE = 55

R_OUT = 0.74
R_IN = 0.44
RING_H = 0.62


def flipped(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def build():
    rng = random.Random(1874)
    stones = vp.stone_material("stones", 2048, moss=0.8, lichen=0.6)
    wood = vp.wood("timber", 2048, tone="silver", moss=0.45, lichen=0.6)
    iron = vp.rust("iron", 512)
    dark = lib.material("shaft", (0.012, 0.011, 0.01), roughness=0.9)
    water = lib.material("water", (0.004, 0.005, 0.006), roughness=0.05)

    # The stone ring: two courses, the upper set half a stone round, and a ring of flatter
    # capstones on top.
    rm = (R_OUT + R_IN) / 2
    for course, (z0, h, count, off) in enumerate(((0.0, 0.3, 10, 0.0), (0.27, 0.24, 11, 0.5))):
        for i in range(count):
            a = 2 * math.pi * (i + off + rng.uniform(-0.1, 0.1)) / count
            L = 2 * math.pi * rm / count + 0.06
            hh = h * rng.uniform(0.9, 1.15)
            p = (rm * math.cos(a), rm * math.sin(a), z0 + hh / 2)
            vp.stone("stone", (L, R_OUT - R_IN + rng.uniform(-0.02, 0.06), hh + 0.02), p, stones,
                     rng.random(), cuts=2, roundness=rng.uniform(0.4, 0.7), lump=0.12,
                     turn=a + math.pi / 2 + rng.uniform(-0.1, 0.1),
                     tilt=(rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08)), facets=rng.randint(1, 2))
    for i in range(8):
        a = 2 * math.pi * (i + 0.25) / 8 + rng.uniform(-0.05, 0.05)
        L = 2 * math.pi * rm / 8 + 0.05
        p = (rm * math.cos(a), rm * math.sin(a), 0.5 + 0.07)
        vp.stone("cap", (L, R_OUT - R_IN + 0.08, 0.13), p, stones, rng.random(), cuts=2,
                 roundness=0.55, lump=0.1, turn=a + math.pi / 2, tilt=(rng.uniform(-0.06, 0.06), 0),
                 facets=1, flat=0.4)
    # The dark shaft inside, and black water far down.
    flipped(lib.lathe("shaft", [(-0.6, R_IN + 0.02), (0.6, R_IN - 0.02)], (0, 0, 0.0), mat=dark, sides=16))
    lib.cylinder("water", R_IN, 0.01, (0, 0, -0.55), mat=water, sides=16)

    # The cover: planks over half the mouth, one knocked askew.
    top = 0.66
    for i, x in enumerate((-0.36, -0.18, 0.0)):
        sec, _ = vp.rect_section(0.17, 0.03, rng, chamfer=0.006)
        a, b = Vector((x, -R_OUT + 0.06, top)), Vector((x, R_OUT - 0.06, top))
        if i == 2:
            a, b = Vector((0.08, -R_OUT + 0.15, top + 0.02)), Vector((0.24, R_OUT - 0.22, top + 0.03))
        vp.timber("cover", sec, a, b, wood, rng.random(), stations=3, rough=0.04, chamfer=0.006,
                  twist=rng.uniform(-0.05, 0.05))
    for y in (-0.42, 0.42):
        sec, _ = vp.rect_section(0.06, 0.04, rng, chamfer=0.006)
        vp.timber("batten", sec, (-0.46, y, top + 0.035), (0.08, y, top + 0.035), wood, rng.random(),
                  stations=2, chamfer=0.006)

    # The windlass: two posts, a roller with rope wound on it and an iron crank.
    PX = R_OUT - 0.04
    for sx in (-1, 1):
        sec, _ = vp.rect_section(0.1, 0.1, rng, chamfer=0.015, wane=0.03)
        vp.timber("post", sec, (sx * PX, 0, 0), (sx * PX, rng.uniform(-0.02, 0.02), 1.92), wood,
                  rng.random(), stations=4, rough=0.05, chamfer=0.012, up=(1, 0, 0))
    RZ = 1.2
    vp.timber("roller", vp.round_section(0.075, 10, rng), (-PX + 0.05, 0, RZ), (PX - 0.05, 0, RZ),
              wood, rng.random(), stations=4, rough=0.04, chamfer=0.01, up=(0, 0, 1))
    rope = lib.material("rope", (0.06, 0.05, 0.035), roughness=0.95)
    pts = []
    for i in range(46):
        a = i * 0.55
        pts.append((-0.25 + i * 0.008, 0.087 * math.cos(a), RZ + 0.087 * math.sin(a)))
    vp.rod("rope", pts, 0.012, rope, rng.random(), sides=5, rough=0.1)
    # The rope down into the well, a bucket on its end hanging just below the cover.
    end = pts[-1]
    vp.rod("rope", [end, (end[0] + 0.02, 0.09, RZ - 0.2), (end[0] + 0.03, 0.09, 0.95)], 0.011, rope,
           rng.random(), sides=5, rough=0.1)
    bx = end[0] + 0.03
    bucket = lib.lathe("bucket", [(0.0, 0.0), (0.0, 0.11), (0.25, 0.13), (0.25, 0.115), (0.03, 0.1),
                                  (0.03, 0.0)], (bx, 0.09, 0.7), mat=wood, sides=12)
    vp.tag_all(bucket, rng.random(), vp.SPLIT)
    for z in (0.74, 0.9):
        lib.lathe("hoop", [(0.0, 0.124 + (z - 0.7) * 0.07), (0.02, 0.125 + (z - 0.7) * 0.07)],
                  (bx, 0.09, z - 0.01), mat=iron, sides=12)
    vp.rod("bail", [(bx - 0.13, 0.09, 0.93), (bx - 0.07, 0.09, 1.0), (bx, 0.09, 1.02),
                    (bx + 0.07, 0.09, 1.0), (bx + 0.13, 0.09, 0.93)], 0.006, iron, rng.random(), sides=4)
    # The crank: through the right post, an arm down and a wooden grip.
    cx = PX + 0.07
    vp.rod("crank", [(PX - 0.06, 0, RZ), (cx, 0, RZ), (cx + 0.01, 0, RZ - 0.3),
                     (cx + 0.14, 0, RZ - 0.3)], 0.014, iron, rng.random(), sides=6, rough=0.05)
    vp.rod("grip", [(cx + 0.04, 0, RZ - 0.3), (cx + 0.15, 0, RZ - 0.3)], 0.022, wood, rng.random(),
           sides=6)

    # The roof: a ridge on the posts, two slopes of boards, one board slipped.
    RIDGE = 2.08
    sec, _ = vp.rect_section(0.08, 0.1, rng, chamfer=0.01)
    vp.timber("ridge", sec, (-PX - 0.06, 0, 1.97), (PX + 0.06, 0, 1.97), wood, rng.random(), stations=3)
    for sy in (-1, 1):
        for i in range(4):
            y0 = sy * 0.03
            y1 = sy * 0.76
            x = -0.6 + i * 0.4
            if sy == 1 and i == 3:
                x += 0.06
            a = Vector((x + 0.0, y0, RIDGE - 0.03))
            b = Vector((x, y1, 1.62))
            sec, _ = vp.rect_section(0.39, 0.025, rng, chamfer=0.006)
            vp.timber("roof", sec, a, b, wood, rng.random(), up=(0, -sy * 0.5, 1), stations=3,
                      rough=0.03, chamfer=0.006, bend=(0, 0, -0.02), ragged=(0, 0.03))
        vp.timber("purlin", vp.rect_section(0.06, 0.06, rng, chamfer=0.008)[0],
                  (-PX - 0.06, sy * 0.5, 1.74), (PX + 0.06, sy * 0.5, 1.74), wood, rng.random(), stations=3)
    vp.clip_ground(-0.6)
    vp.report("well")
