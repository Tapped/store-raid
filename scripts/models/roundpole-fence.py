"""
Roundpole fence (skigard): pairs of round stakes bound with withies, carrying split spruce rails
laid at a slant, silver-grey with lichen. A straight 4 m segment that tiles end to end along x.
"""

import math
import random

from mathutils import Vector

import village_props as vp

OUT = "models/village/roundpole-fence.glb"
ORIGIN = "bottom"
TRIS = 2800
AO = 1024
AO_DISTANCE = 0.15
SMOOTH_ANGLE = 50

LENGTH = 4.0
HEIGHT = 1.2
PAIRS = 4  # stake pairs per segment, 1 m apart
RAIL_STEP = 0.25  # along x between rail feet
SLANT = math.radians(40)


def build():
    rng = random.Random(4711)
    rails = vp.wood("rails", 2048, tone="silver", moss=0.3, lichen=0.6, rings=120)
    bands = vp.wood("withies", 512, tone="brown", moss=0.0, lichen=0.0, checks=0.0, rot=0.2)

    # Stake pairs, leaning in towards each other, tied together twice by withies.
    stake_x = []
    for i in range(PAIRS):
        x = -LENGTH / 2 + (i + 0.5) * LENGTH / PAIRS + rng.uniform(-0.04, 0.04)
        stake_x.append(x)
        stakes = []
        for side in (-1, 1):
            r = rng.uniform(0.032, 0.042)
            foot = (x + rng.uniform(-0.03, 0.03), side * rng.uniform(0.18, 0.21), 0.0)
            top = (x + rng.uniform(-0.05, 0.05), side * rng.uniform(0.085, 0.095),
                   HEIGHT - rng.uniform(0.0, 0.08))
            stakes.append((Vector(foot), Vector(top), r))
            vp.timber("stake", vp.round_section(r, 7, rng), foot, top, rails, rng.random(),
                      stations=4, taper=0.85, wobble=0.012, rough=0.07, chamfer=0.01,
                      ragged=(0.0, 0.03), up=(1, 0, 0))
        for zb in (rng.uniform(0.38, 0.45), rng.uniform(0.88, 0.95)):
            # A loop of twisted withy round both stakes where they are at this height.
            (fa, ta, ra), (fb, tb, rb) = stakes
            pa = fa.lerp(ta, zb / ta.z)
            pb = fb.lerp(tb, zb / tb.z)
            w = 0.012
            pts = []
            # Round the outside of stake a (y < 0), across, round the outside of stake b.
            for c, rr, a0, da in ((pa, ra * 0.95 + w, 0.0, -1), (pb, rb * 0.95 + w, math.pi, -1)):
                for j in range(4):
                    a = a0 + da * math.pi * j / 3
                    pts.append((c.x + rr * math.cos(a), c.y + rr * math.sin(a),
                                zb + rng.uniform(-0.008, 0.008)))
            pts.append(pts[0])
            vp.rod("withy", pts, w, bands, rng.random(), sides=5, rough=0.3)

    # Rails, split from thin spruce: halves mostly, now and then a quarter of a thicker log, feet on
    # the ground, leaning on the next pairs of stakes. Rail feet every RAIL_STEP; the model tiles.
    count = round(LENGTH / RAIL_STEP)
    step = LENGTH / count
    for i in range(count):
        x0 = -LENGTH / 2 + i * step + rng.uniform(-0.04, 0.04)
        L = rng.uniform(1.7, 1.85)
        ang = SLANT + rng.uniform(-0.05, 0.05)
        if rng.random() < 0.75:
            r = rng.uniform(0.05, 0.065)
            a0 = rng.uniform(0, 2 * math.pi)
            sec = vp.split_section(r, a0, a0 + math.pi * rng.uniform(0.9, 1.05), rng, arc=4)
        else:
            r = rng.uniform(0.075, 0.09)
            a0 = rng.uniform(0, 2 * math.pi)
            sec = vp.split_section(r, a0, a0 + math.pi * rng.uniform(0.45, 0.55), rng, arc=3)
        y0 = rng.uniform(-0.02, 0.02)
        foot = (x0, y0 + rng.uniform(-0.05, 0.05), 0.045)
        top_z = min(HEIGHT - 0.03, 0.045 + L * math.sin(ang))
        run = math.sqrt(max(L * L - (top_z - 0.045) ** 2, 0.1))
        top = (x0 + run, y0 + rng.uniform(-0.015, 0.015), top_z)
        up = (rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))
        vp.timber("rail", sec, foot, top, rails, rng.random(), up=up, stations=5,
                  bend=(0, rng.uniform(-0.02, 0.02), -rng.uniform(0.0, 0.03)), wobble=0.015,
                  rough=0.09, taper=rng.uniform(0.8, 0.95), twist=rng.uniform(-0.4, 0.4),
                  chamfer=0.012, ragged=(0.02, 0.04))
    vp.wrap_x(LENGTH / 2)
    vp.report("roundpole-fence")
