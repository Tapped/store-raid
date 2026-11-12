"""
Stone wall: a dry-stone field wall of rounded granite fieldstones in two faces leaning in to a
course of mossy through-stones, small stones chinked between. A 4 m segment that tiles along x.
"""

import random

import lib
import village_props as vp

OUT = "models/village/stone-wall.glb"
ORIGIN = "bottom"
TRIS = 3600
AO = 1024
AO_DISTANCE = 0.2
SMOOTH_ANGLE = 70

LENGTH = 4.0


def build():
    rng = random.Random(1907)
    stones = vp.stone_material("stones", 2048, moss=0.7, lichen=0.7)
    earth = lib.material("core", (0.018, 0.016, 0.012), roughness=0.95)
    vp.dry_wall(stones, earth, rng, -LENGTH / 2, LENGTH / 2)
    vp.wrap_x(LENGTH / 2)
    vp.clip_ground()
    vp.report("stone-wall")
