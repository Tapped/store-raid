"""
Fallen log: a 6 m spruce lying in the moss, sunk a little, bark sloughing off silvered wood in
patches, broken branch stubs and splintered ends.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/fallen-log.glb"
ORIGIN = "bottom"
TRIS = 2000
SMOOTH_ANGLE = 60
AO = 1024
AO_DISTANCE = 0.25


def build():
    vn.fallen_log((0.8, 6.0, 0.7), seed=19)
