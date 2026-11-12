"""
Grass tuft: a tussock of long dead grass, straw and grey, some blades flopped over, as
alpha-tested cards.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/grass-tuft.glb"
ORIGIN = "bottom"
TRIS = 120
SMOOTH_ANGLE = 80
# Cycles bakes cards as opaque, blackening them: the cards carry their own occlusion instead.
AO = 0


def build():
    vn.grass_tuft((0.8, 0.8, 0.5), seed=23)
