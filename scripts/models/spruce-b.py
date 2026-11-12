"""
Spruce, small: a 9 m Norway spruce, younger and fuller to the ground than spruce-a, with the same
sagging, upturned branches and hanging branchlets. The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/spruce-b.glb"
ORIGIN = "bottom"
TRIS = 4000
SMOOTH_ANGLE = 70
# Cycles bakes cards as opaque, blackening them: the cards carry their own occlusion instead.
AO = 0


def build():
    vn.spruce(8.4, 3.0, seed=11, bark_size=512, key="spruce-b", density=0.75)
