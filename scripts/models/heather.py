"""
Heather: a low dome of woody heather with dead flower spikes, as alpha-tested cards.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/heather.glb"
ORIGIN = "bottom"
TRIS = 140
SMOOTH_ANGLE = 80
# Cycles bakes cards as opaque, blackening them: the cards carry their own occlusion instead.
AO = 0


def build():
    vn.heather((1.0, 1.0, 0.35), seed=29)
