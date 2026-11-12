"""
Birch, large: an 11 m downy birch forking into leaders, white bark with black lenticels and
collars, rising branches with hanging tips, fine twigs and a few yellow leaves as alpha-tested
cards. The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/birch-a.glb"
ORIGIN = "bottom"
TRIS = 8000
SMOOTH_ANGLE = 70
# Cycles bakes cards as opaque, blackening them: the cards carry their own occlusion instead.
AO = 0


def build():
    vn.birch(11.0, 5.0, seed=5, bark_size=1024, forks=2, key="birch-a", density=1.4, twigs=2.4)
