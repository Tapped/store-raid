"""
Boulder, small: a 1 m stone, a broken block worn round at the edges, mossed on top.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/boulder-c.glb"
ORIGIN = "bottom"
TRIS = 700
SMOOTH_ANGLE = 50
AO = 1024
AO_DISTANCE = 0.4


def build():
    mat = vn.rock_material(512)
    vn.rock("boulder-c", (1.0, 0.9, 0.6), seed=7, mat=mat, tris=600, planes=8, rounding=0.25, fractures=2)
