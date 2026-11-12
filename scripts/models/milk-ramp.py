"""
Milk ramp (melkerampe): the roadside plank platform on four hewn posts where the farms left
their churns for the dairy lorry, two dented milk churns still standing on it.
"""

import math
import random

from mathutils import Matrix, Vector

import lib
import village_props as vp

OUT = "models/village/milk-ramp.glb"
ORIGIN = "bottom"
TRIS = 5000
AO = 1024
AO_DISTANCE = 0.2
SMOOTH_ANGLE = 50

W, D = 2.0, 1.4
DECK = 0.86


def churn(name, at, mat, iron, rng, tilt=(0.0, 0.0), turn=0.0):
    """A milk churn: body, shoulder, neck and lid, two handles, dented."""
    prof = [(0.0, 0.0), (0.0, 0.155), (0.02, 0.165), (0.36, 0.165), (0.4, 0.15), (0.46, 0.1),
            (0.53, 0.095), (0.54, 0.112), (0.56, 0.112), (0.57, 0.0)]
    body = lib.lathe(name, prof, (0, 0, 0), mat=mat, sides=20)
    dents = [(rng.uniform(0, 2 * math.pi), rng.uniform(0.08, 0.38), rng.uniform(0.04, 0.09),
              rng.uniform(0.008, 0.02)) for _ in range(5)]
    for v in body.data.vertices:
        r = math.hypot(v.co.x, v.co.y)
        if r < 0.05:
            continue
        a = math.atan2(v.co.y, v.co.x)
        push = 0.0
        for da, dz, rad, depth in dents:
            d = math.hypot((((a - da + math.pi) % (2 * math.pi)) - math.pi) * r, v.co.z - dz)
            if d < rad:
                push += depth * (1 - (d / rad) ** 2) ** 2
        k = (r - push) / r
        v.co.x *= k
        v.co.y *= k
    objs = [body]
    for sx in (-1, 1):
        objs.append(vp.rod("handle", [(sx * 0.1, -0.03, 0.47), (sx * 0.15, -0.025, 0.5),
                                      (sx * 0.15, 0.025, 0.5), (sx * 0.1, 0.03, 0.47)], 0.008, iron,
                           rng.random(), sides=5, rough=0.0))
    m = (Matrix.Translation(at) @ Matrix.Rotation(turn, 4, "Z") @ Matrix.Rotation(tilt[0], 4, "X")
         @ Matrix.Rotation(tilt[1], 4, "Y"))
    vp.transform(objs, m)
    return objs


def build():
    rng = random.Random(1958)
    wood = vp.wood("ramp", 2048, tone="silver", moss=0.45, lichen=0.6)
    tin = vp.tinned("churns", 1024)
    iron = vp.rust("iron", 512)

    # Four hewn posts, the front left one settled and leaning.
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (W / 2 - 0.1), sy * (D / 2 - 0.1)
            sec, _ = vp.rect_section(0.12, 0.12, rng, chamfer=0.015, wane=0.03)
            lean = (0.04, -0.02) if (sx, sy) == (-1, -1) else (rng.uniform(-0.015, 0.015), rng.uniform(-0.015, 0.015))
            vp.timber("post", sec, (x, y, 0), (x + lean[0], y + lean[1], DECK - 0.08), wood, rng.random(),
                      stations=3, rough=0.05, chamfer=0.012, up=(1, 0, 0))
    # Bearers along x under the deck, and diagonal braces on the front and the sides.
    for sy in (-1, 1):
        sec, _ = vp.rect_section(0.1, 0.12, rng, chamfer=0.012)
        vp.timber("bearer", sec, (-W / 2 + 0.02, sy * (D / 2 - 0.1), DECK - 0.1),
                  (W / 2 - 0.02, sy * (D / 2 - 0.1), DECK - 0.1), wood, rng.random(), stations=3,
                  chamfer=0.012)
    sec, _ = vp.rect_section(0.1, 0.03, rng, chamfer=0.006)
    vp.timber("brace", sec, (-W / 2 + 0.12, -D / 2 + 0.03, 0.12), (W / 2 - 0.12, -D / 2 + 0.03, DECK - 0.2),
              wood, rng.random(), up=(0, -1, 0), stations=3, chamfer=0.006)
    for sx in (-1, 1):
        vp.timber("brace", sec, (sx * (W / 2 - 0.03), -D / 2 + 0.12, DECK - 0.2),
                  (sx * (W / 2 - 0.03), D / 2 - 0.12, 0.14), wood, rng.random(), up=(sx, 0, 0),
                  stations=3, chamfer=0.006)
    # The deck: planks across, one gone, one split and sagging.
    x = -W / 2
    i = 0
    while x < W / 2 - 0.05:
        w = rng.uniform(0.15, 0.2)
        xc = x + w / 2
        x += w + rng.uniform(0.006, 0.015)
        i += 1
        if i == 7:
            continue
        sec, _ = vp.rect_section(w, 0.032, rng, chamfer=0.006)
        bend = (0, 0, -0.025) if i == 4 else (0, 0, 0)
        vp.timber("deck", sec, (xc, -D / 2, DECK - 0.024), (xc + rng.uniform(-0.01, 0.01), D / 2, DECK - 0.024),
                  wood, rng.random(), stations=4, rough=0.04, chamfer=0.006, bend=bend,
                  twist=rng.uniform(-0.04, 0.04), ragged=(0.02, 0.02))
    # The churns.
    churn("churn", (-0.45, 0.12, DECK + 0.008), tin, iron, rng, turn=0.3)
    churn("churn", (0.4, -0.18, DECK + 0.008), tin, iron, rng, tilt=(0.03, 0.05), turn=1.4)
    vp.clip_ground()
    vp.report("milk-ramp")
