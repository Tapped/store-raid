"""
Boulder, medium: a 2 m glacial boulder, rounder and lower, with one fracture face, moss on
top, lichen on the flanks.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/boulder-b.glb"
ORIGIN = "bottom"
TRIS = 1400
SMOOTH_ANGLE = 50
AO = 1024
AO_DISTANCE = 0.4


def build():
    mat = vn.rock_material(1024)
    vn.rock("boulder-b", (2.0, 1.8, 1.3), seed=17, mat=mat, tris=1300, planes=9, rounding=0.4, fractures=1)
