"""
Hay rack (hesje): four round posts with wires strung between them, propped at the ends, a wire
snapped and hanging, a few rags of sixty-year-old grey hay still caught on the wires.
"""

import random

from mathutils import Vector

import village_props as vp

OUT = "models/village/hay-rack.glb"
ORIGIN = "bottom"
TRIS = 3200
AO = 1024
AO_DISTANCE = 0.15
SMOOTH_ANGLE = 50

LENGTH = 6.0
HEIGHT = 1.9
WIRES = (0.42, 0.68, 0.94, 1.2, 1.46, 1.72)


def build():
    rng = random.Random(1923)
    wood = vp.wood("posts", 2048, tone="silver", moss=0.4, lichen=0.65)
    iron = vp.rust("wire", 512, scale=0.3)
    straw = vp.hay("hay", 1024)

    xs = [-LENGTH / 2 + 0.09, -0.96, 0.96, LENGTH / 2 - 0.09]
    tops = []
    for x in xs:
        x += rng.uniform(-0.03, 0.03)
        top = Vector((x + rng.uniform(-0.06, 0.06), rng.uniform(-0.05, 0.05), HEIGHT - rng.uniform(0, 0.08)))
        foot = Vector((x, 0, 0))
        tops.append((foot, top))
        vp.timber("post", vp.round_section(rng.uniform(0.055, 0.068), 8, rng), foot, top, wood,
                  rng.random(), stations=5, taper=0.8, rough=0.07, wobble=0.02, chamfer=0.012,
                  ragged=(0, 0.04), up=(1, 0, 0))
    # Props at the ends, to stand in the wind.
    for i in (0, 3):
        foot, top = tops[i]
        at = foot.lerp(top, 0.68)
        for sy in (-1, 1):
            vp.timber("prop", vp.round_section(0.04, 7, rng),
                      (at.x + rng.uniform(-0.05, 0.05), sy * 0.22, 0.0),
                      at + Vector((0, sy * 0.05, 0)), wood, rng.random(), stations=4, rough=0.07,
                      chamfer=0.01, taper=0.85, wobble=0.015)

    def post_at(i, z, side):
        foot, top = tops[i]
        p = foot.lerp(top, z / top.z)
        return p + Vector((0, side * 0.066, 0))

    hay_spots = []
    for span in range(3):
        for w, z in enumerate(WIRES):
            side = 1 if w % 2 else -1
            a, b = post_at(span, z, side), post_at(span + 1, z, side)
            sag = rng.uniform(0.02, 0.05)
            if span == 1 and w == 3:
                # Snapped: each half hangs from its post.
                for p0, p1 in ((a, b), (b, a)):
                    d = p1 - p0
                    pts = [p0 + d * (t * 0.35) + Vector((0, rng.uniform(-0.01, 0.01), -t * t * (z - 0.05)))
                           for t in (0, 0.25, 0.5, 0.75, 1.0)]
                    vp.rod("wire", pts, 0.0045, iron, rng.random(), sides=4, rough=0.0)
                continue
            pts = [a.lerp(b, t) + Vector((0, 0, -sag * 4 * t * (1 - t)))
                   for t in (0, 0.2, 0.4, 0.6, 0.8, 1)]
            vp.rod("wire", pts, 0.0045, iron, rng.random(), sides=4, rough=0.0)
            if (span, w) in ((0, 2), (0, 4), (1, 1), (2, 3), (2, 5), (1, 5)):
                t = rng.uniform(0.25, 0.75)
                hay_spots.append(a.lerp(b, t) + Vector((0, 0, -sag * 4 * t * (1 - t))))

    # Rags of hay: matted lumps draped over the wire, and loose wisps hanging below.
    for p in hay_spots:
        hx, hz = rng.uniform(0.07, 0.14), rng.uniform(0.16, 0.3)
        lump = vp.blob("hay", (hx, rng.uniform(0.025, 0.035), hz), p + Vector((0, 0, -hz * 0.85)),
                       straw, rng.random(), kind=vp.HAY, segments=10, rings=7, lump=0.35, flat=0.0)
        # Pinched where it hangs over the wire, wider and ragged towards the bottom.
        for v in lump.data.vertices:
            rel = (v.co.z - p.z) / (2 * hz)
            k = 0.35 + 0.65 * min(1.0, -rel * 1.6)
            v.co.x = p.x + (v.co.x - p.x) * k * (1 + 0.3 * rng.uniform(-1, 1) * max(0, -rel - 0.6))
            v.co.y = p.y + (v.co.y - p.y) * (0.6 + 0.6 * min(1.0, -rel * 2))
            if rel < -0.75:
                v.co.z -= rng.uniform(0, 0.08)
        for _ in range(rng.randint(6, 10)):
            start = p + Vector((rng.uniform(-hx, hx) * 0.9, rng.uniform(-0.02, 0.02), -rng.uniform(0.0, hz * 1.4)))
            length = rng.uniform(0.15, 0.45)
            curl = Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.05, 0.05), 0))
            pts = [start + Vector((0, 0, -length * t)) + curl * t * t for t in (0, 0.33, 0.66, 1.0)]
            vp.rod("wisp", pts, 0.01, straw, rng.random(), sides=3, kind=vp.HAY, rough=0.3,
                   radii=[0.011, 0.009, 0.007, 0.003])
    vp.clip_ground()
    vp.report("hay-rack")
