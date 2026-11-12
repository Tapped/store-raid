"""
Woodpile: split birch stacked between two stakes, white bark on the round sides and grey end
grain to the front, a chopping block beside it with an axe left in it.
"""

import math
import random

from mathutils import Matrix, Vector

import lib
import village_props as vp

OUT = "models/village/woodpile.glb"
ORIGIN = "bottom"
TRIS = 5500
AO = 1024
AO_DISTANCE = 0.12
SMOOTH_ANGLE = 50

WIDTH = 2.4
STACK_Y = 0.15
LOG_L = 0.5


def build():
    rng = random.Random(1966)
    birch = vp.wood("birch", 2048, tone="birch", bark="birch", moss=0.3, lichen=0.4, rings=160,
                    rot=0.6, end_dark=0.8)
    iron = vp.rust("iron", 512)

    half = WIDTH / 2 - 0.08
    for sx in (-1, 1):
        x = sx * half
        vp.timber("stake", vp.round_section(0.04, 7, rng), (x - sx * 0.02, STACK_Y, 0),
                  (x + sx * 0.05, STACK_Y + rng.uniform(-0.03, 0.03), 1.3), birch, rng.random(),
                  stations=4, taper=0.85, rough=0.08, chamfer=0.01, ragged=(0, 0.04), up=(1, 0, 0))

    # Split logs laid ends to the front, each settling on whatever is under it, the top ragged
    # and lower at the ends.
    inner = half - 0.05
    cell = 0.01
    N = int(2 * inner / cell)
    sky = [0.0] * N
    for _ in range(14):
        x = -inner + rng.uniform(0, 0.04)
        while x < inner - 0.04:
            r = rng.uniform(0.065, 0.1)
            kind = rng.random()
            span = math.pi if kind < 0.4 else (math.pi * 0.62 if kind < 0.8 else math.pi / 2)
            rr = r * (1.0 if kind < 0.4 else (1.15 if kind < 0.8 else 1.3))
            # Laid bark up or bark down, as they come off the pile, a little askew.
            mid = (math.pi / 2 if rng.random() < 0.6 else -math.pi / 2) + rng.uniform(-0.35, 0.35)
            if kind >= 0.4 and rng.random() < 0.3:
                mid += math.pi / 2 * rng.choice((-1, 1))
            sec = vp.split_section(rr, mid - span / 2, mid + span / 2, rng, arc=3 if span > 1.2 else 2,
                                   rough=0.1)
            us = [p[0] for p in sec]
            vs = [p[1] for p in sec]
            w, h = max(us) - min(us), max(vs) - min(vs)
            centre = ((max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2)
            cx = x + w / 2
            i0 = max(0, int((x + inner) / cell))
            i1 = min(N, max(i0 + 1, int((x + w + inner) / cell)))
            x += w * rng.uniform(0.96, 1.02)
            # Rests on the highest point under its middle half, sinking a little into the gaps.
            q0, q1 = i0 + (i1 - i0) // 4, i1 - (i1 - i0) // 4
            bottom = max(sky[q0:max(q1, q0 + 1)]) - h * 0.12
            top_limit = 1.24 - 0.22 * (abs(cx) / inner) ** 3
            if bottom + h > top_limit + rng.uniform(-0.06, 0.04):
                continue
            L = LOG_L + rng.uniform(-0.05, 0.05)
            y0 = STACK_Y - L / 2 + rng.uniform(-0.04, 0.04)
            cz = bottom + h * 0.5
            vp.timber("log", sec, (cx, y0, cz),
                      (cx + rng.uniform(-0.015, 0.015), y0 + L, cz + rng.uniform(-0.015, 0.015)),
                      birch, rng.random(), up=(0, 0, 1), stations=2, rough=0.06, chamfer=0.0,
                      wobble=0.0, ragged=(0.015, 0.015), centre=centre)
            for i in range(i0, i1):
                sky[i] = max(sky[i], bottom + h)

    # The chopping block, and the axe in it.
    bx, by = 0.72, -0.2
    vp.timber("block", vp.round_section(0.2, 12, rng, oval=0.06), (bx, by, 0.0), (bx, by, 0.46),
              birch, rng.random(), stations=3, rough=0.05, chamfer=0.015, up=(1, 0, 0),
              ragged=(0, 0.02))
    axe = []
    head = lib.shape("axe-head", [(-0.02, -0.03), (0.05, -0.025), (0.11, -0.07), (0.12, 0.06),
                                  (0.05, 0.025), (-0.02, 0.03), (-0.05, 0.02), (-0.05, -0.02)],
                     depth=0.022, mat=iron, facing="-y")
    axe.append(head)
    axe.append(vp.rod("helve", [(-0.04, 0, 0), (-0.3, 0, 0.01), (-0.55, 0, -0.02), (-0.68, 0, 0.01)],
                      0.017, birch, rng.random(), sides=6, rough=0.05,
                      radii=[0.018, 0.016, 0.015, 0.02]))
    # Blade down into the block's top, the helve rising up and out.
    m = (Matrix.Translation((bx + 0.02, by + 0.03, 0.47)) @ Matrix.Rotation(0.6, 4, "Z")
         @ Matrix.Rotation(math.radians(-55), 4, "Y") @ Matrix.Translation((-0.1, 0, 0)))
    for o in axe:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(m)
    # A few split pieces on the ground by the block.
    for i in range(4):
        r = rng.uniform(0.05, 0.08)
        a0 = rng.uniform(0, 6.28)
        sec = vp.split_section(r, a0, a0 + math.pi * 0.6, rng, arc=2)
        p = Vector((bx + rng.uniform(-0.5, -0.25), by + rng.uniform(-0.06, 0.08), r * 0.5))
        d = Vector((math.cos(i * 1.7), math.sin(i * 1.7) * 0.4, 0)) * 0.18
        vp.timber("piece", sec, p - d, p + d, birch, rng.random(), stations=2, chamfer=0.0, rough=0.08,
                  ragged=(0.01, 0.01))
    vp.clip_ground()
    vp.report("woodpile")
