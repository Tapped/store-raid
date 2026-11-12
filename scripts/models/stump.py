"""
Stump: a snapped spruce stump with root flares running out over the ground, bark sloughing
off silver wood, a rotten hollow top, moss.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/stump.glb"
ORIGIN = "bottom"
TRIS = 1800
SMOOTH_ANGLE = 60
AO = 512
AO_DISTANCE = 0.15


def build():
    vn.stump((0.8, 0.8, 0.6), seed=13)
