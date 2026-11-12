"""
Stone wall: a dry-stone field wall of rounded granite fieldstones in two faces leaning in to a
course of mossy through-stones, small stones chinked between. A 4 m segment that tiles along x.
"""

import random

import lib
import village_props as vp

OUT = "models/village/stone-wall.glb"
ORIGIN = "bottom"
TRIS = 4300
AO = 1024
AO_DISTANCE = 0.2
SMOOTH_ANGLE = 48

LENGTH = 4.0
# The caps stand a little proud of this: about 0.99 m to the top of the highest.
HEIGHT = 0.99


def build():
    rng = random.Random(1907)
    stones = vp.stone_material("stones", 2048, moss=0.85, lichen=0.75)
    vp.dry_wall(stones, stones, rng, -LENGTH / 2, LENGTH / 2, height=HEIGHT)
    vp.wrap_x(LENGTH / 2)
    vp.clip_ground()
    vp.report("stone-wall")
