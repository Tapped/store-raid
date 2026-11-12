"""
Rock outcrop: 8 m of grey bedrock breaking through turf, a slabby mass with fracture faces and
ledges stepping down, moss on the tops, dead grass where the ground runs up onto it.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/rock-outcrop.glb"
ORIGIN = "bottom"
TRIS = 4000
SMOOTH_ANGLE = 50
AO = 1024
AO_DISTANCE = 0.8


def build():
    vn.outcrop((8.0, 6.0, 3.5), seed=41)
