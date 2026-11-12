"""
Birch, dead: an 8 m dead downy birch snapped off in splinters, grey peeling bark rotting to brown,
broken branches with a few bare twigs, hoof fungus up the trunk. The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/birch-dead.glb"
ORIGIN = "bottom"
TRIS = 3000
SMOOTH_ANGLE = 60
# Cycles bakes cards as opaque, blackening them: the cards carry their own occlusion instead.
AO = 0


def build():
    vn.dead_birch(8.0, 3.0, seed=4, bark_size=1024)
