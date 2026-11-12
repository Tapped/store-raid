"""
Field gate (grind): a braced plank gate between two round posts, hanging open a little; its top
hinge is gone, so it has dropped onto its far corner. Silver-grey wood, forged iron gone to rust.
"""

import math
import random

from mathutils import Matrix

import lib
import village_props as vp

OUT = "models/village/field-gate.glb"
ORIGIN = "bottom"
TRIS = 3200
AO = 1024
AO_DISTANCE = 0.15
SMOOTH_ANGLE = 45

WIDTH = 3.0
GATE_W = 2.56
OPEN = math.radians(5)
DROOP = math.radians(2.6)


def build():
    rng = random.Random(1888)
    wood = vp.wood("gate", 2048, tone="silver", moss=0.35, lichen=0.65)
    iron = vp.rust("iron", 512)

    posts = []
    for sx, r in ((-1, 0.088), (1, 0.08)):
        x = sx * (WIDTH / 2 - r - 0.01)
        top = (x + rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02), 1.3 - rng.uniform(0.0, 0.03))
        vp.timber("post", vp.round_section(r, 9, rng), (x, 0, 0), top, wood, rng.random(),
                  stations=5, taper=0.88, rough=0.06, chamfer=0.015, ragged=(0, 0.05), up=(1, 0, 0))
        posts.append(x)
    hinge_x = posts[0] + 0.115

    # The gate, built with its hinge edge on x = 0, then swung and dropped.
    gate = []

    def board(name, w, t, a, b, **kw):
        sec, _ = vp.rect_section(w, t, rng, chamfer=0.006, jitter=0.002)
        stations = kw.pop("stations", 4)
        gate.append(vp.timber(name, sec, a, b, wood, rng.random(), stations=stations,
                              rough=0.04, chamfer=0.008, **kw))

    W = GATE_W
    for x in (0.05, W / 2, W - 0.05):
        board("stile", 0.1, 0.045, (x, 0, 0.1), (x, 0, 1.17), up=(0, -1, 0), stations=3)
    rails = (0.2, 0.42, 0.64, 0.86, 1.08)
    for i, z in enumerate(rails):
        a, b = (-0.02, -0.036, z), (W + 0.02, -0.036, z)
        if i == 2:
            b = (rng.uniform(1.7, 1.9), -0.036, z - 0.01)
            board("rail", 0.11, 0.024, a, b, ragged=(0, 0.06), up=(0, -1, 0))
            # The broken-off end, hanging from its nail at the far stile.
            board("rail", 0.11, 0.024, (W - 0.05, -0.04, z), (W - 0.48, -0.045, z - 0.3),
                  ragged=(0.0, 0.05), up=(0, -1, 0), stations=3)
            continue
        board("rail", 0.11 + rng.uniform(-0.01, 0.01), 0.024, a, b, up=(0, -1, 0),
              twist=rng.uniform(-0.03, 0.03))
    for x0, x1 in ((0.1, W / 2 - 0.08), (W / 2 + 0.08, W - 0.1)):
        board("brace", 0.1, 0.03, (x0, 0.012, rails[0]), (x1, 0.012, rails[-1]), up=(0, -1, 0),
              stations=3)
    # The bottom strap hinge, still there; the top one's gone.
    gate.append(vp.timber("strap", vp.rect_section(0.045, 0.007, rng, chamfer=0.002)[0],
                          (-0.03, -0.052, rails[0]), (0.55, -0.052, rails[0]), iron, rng.random(),
                          stations=3, up=(0, -1, 0), chamfer=0.003, taper=0.6))
    for x in (0.12, 0.3, 0.46):
        gate.append(lib.cylinder("bolt", 0.009, 0.01, (x, -0.057, rails[0]), axis="y", mat=iron, sides=6))

    m = (Matrix.Translation((hinge_x, 0, 0)) @ Matrix.Rotation(-OPEN, 4, "Z")
         @ Matrix.Translation((0, 0, rails[0])) @ Matrix.Rotation(DROOP, 4, "Y")
         @ Matrix.Translation((0, 0, -rails[0])))
    vp.transform(gate, m)

    # Pintles in the hinge post, the top one empty; the latch hook on the far post.
    for z in (rails[0], rails[-1]):
        lib.cylinder("pintle", 0.012, 0.12, (posts[0] + 0.07, -0.02, z), axis="x", mat=iron, sides=6)
        lib.cylinder("pin", 0.011, 0.06, (posts[0] + 0.12, -0.02, z + 0.02), axis="z", mat=iron, sides=6)
    vp.rod("hook", [(posts[1] - 0.06, -0.01, 0.95), (posts[1] - 0.2, -0.01, 0.95),
                    (posts[1] - 0.24, -0.01, 0.91)], 0.008, iron, rng.random(), sides=5, rough=0.0)
    vp.clip_ground()
    vp.report("field-gate")
