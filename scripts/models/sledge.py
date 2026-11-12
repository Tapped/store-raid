"""
Sledge: a wooden work sledge, two runners turned up at the front and shod with iron, knees
carrying the bunks and side rails, a few deck slats, one of them gone, grey and mossy.
"""

import math
import random

from mathutils import Vector

import village_props as vp

OUT = "models/village/sledge.glb"
ORIGIN = "bottom"
TRIS = 3500
AO = 1024
AO_DISTANCE = 0.15
SMOOTH_ANGLE = 45

HALF_X = 0.37
BACK = 1.18
FRONT_TIP = -1.2


def runner_path(x):
    pts = []
    for y in (BACK, 0.7, 0.2, -0.3, -0.82):
        pts.append(Vector((x, y, 0.045)))
    # Turned up at the front in a curve, the tip curling back a little.
    for i in range(1, 8):
        a = i / 7 * math.pi * 0.62
        r = 0.4
        pts.append(Vector((x, -0.82 - r * math.sin(a), 0.045 + r * (1 - math.cos(a)))))
    return pts


def build():
    rng = random.Random(1937)
    wood = vp.wood("sledge", 2048, tone="silver", moss=0.45, lichen=0.6)
    iron = vp.rust("iron", 512)

    knees_y = (0.95, 0.25, -0.45)
    for sx in (-1, 1):
        x = sx * HALF_X
        pts = runner_path(x)
        vp.rod("runner", pts, 0.045, wood, rng.random(), sides=4, rough=0.06, phase=math.pi / 4,
               radii=[0.046] * 6 + [0.044, 0.042, 0.04, 0.037, 0.034, 0.031])
        shoe = [p + Vector((0, 0, -0.03)) for p in pts[:8]]
        vp.rod("shoe", shoe, 0.03, iron, rng.random(), sides=4, rough=0.0, phase=math.pi / 4,
               squash=0.22)
        for y in knees_y:
            vp.timber("knee", vp.round_section(0.028, 6, rng), (x, y, 0.07), (x + sx * 0.01, y, 0.38), wood,
                      rng.random(), stations=3, rough=0.08, chamfer=0.006, taper=0.9)
        # The side rail over the knees, down to the runner's curl in front.
        tip = pts[-2]
        sec, _ = vp.rect_section(0.05, 0.06, rng, chamfer=0.008, wane=0.015)
        vp.timber("rail", sec, (x, BACK - 0.05, 0.43), (x, -0.74, 0.43), wood, rng.random(), stations=4,
                  chamfer=0.008, rough=0.04)
        vp.rod("brace", [(x, -0.74, 0.43), (x, -0.92, 0.45), tip + Vector((0, 0.02, -0.02))], 0.022, wood,
               rng.random(), sides=5, rough=0.08)
    # Bunks across the knees, the front bar between the curls.
    for y in knees_y:
        sec, _ = vp.rect_section(0.07, 0.065, rng, chamfer=0.01)
        vp.timber("bunk", sec, (-HALF_X - 0.07, y, 0.4), (HALF_X + 0.07, y, 0.4), wood, rng.random(),
                  stations=3, chamfer=0.01, rough=0.04)
    tip = runner_path(0)[-2]
    vp.timber("bar", vp.round_section(0.03, 7, rng), (-HALF_X, tip.y + 0.02, tip.z - 0.02),
              (HALF_X, tip.y + 0.02, tip.z - 0.02), wood, rng.random(), stations=3, rough=0.06)
    # Deck slats along the bunks.
    for i, x in enumerate((-0.27, -0.13, 0.0, 0.14, 0.28)):
        if i == 3:
            continue
        sec, _ = vp.rect_section(0.12, 0.022, rng, chamfer=0.005)
        y1 = -0.66 if i != 1 else rng.uniform(-0.1, 0.1)
        vp.timber("slat", sec, (x, BACK - 0.1, 0.445), (x + rng.uniform(-0.01, 0.01), y1, 0.445), wood,
                  rng.random(), stations=3, chamfer=0.005, rough=0.04, ragged=(0, 0.05 if i == 1 else 0.01))
    vp.clip_ground()
    vp.report("sledge")
