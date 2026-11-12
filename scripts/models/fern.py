"""
Fern: a dead fern gone brown, fronds rising from the crown and arching over, curling at the
edges, as alpha-tested cards.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/fern.glb"
ORIGIN = "bottom"
TRIS = 300
SMOOTH_ANGLE = 80
# Cycles bakes cards as opaque, blackening them: the cards carry their own occlusion instead.
AO = 0


def build():
    vn.fern((0.9, 0.9, 0.6), seed=37)
