"""
Birch, small: a 7 m downy birch on a single leaning stem, white bark, fine twigs and a few yellow
leaves as alpha-tested cards. The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/birch-b.glb"
ORIGIN = "bottom"
TRIS = 4000
SMOOTH_ANGLE = 70
# Cycles bakes cards as opaque, blackening them: the cards carry their own occlusion instead.
AO = 0


def build():
    vn.birch(7.0, 4.0, seed=21, bark_size=512, forks=1, lean=0.05, key="birch-b", density=1.25,
             leaves=0.35, twigs=2.2)
