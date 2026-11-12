"""
Spruce, large: a 14 m Norway spruce of the western valleys, whorled branches that sag and turn up
at the tips, curtains of hanging branchlets as alpha-tested cards, bare dead twigs low on the trunk.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/spruce-a.glb"
ORIGIN = "bottom"
TRIS = 8000
SMOOTH_ANGLE = 70
# Cycles bakes cards as opaque, blackening them: the cards carry their own occlusion instead.
AO = 0


def build():
    vn.spruce(14.0, 4.0, seed=3, bark_size=1024, key="spruce-a")
