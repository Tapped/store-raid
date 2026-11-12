"""
Boulder, large: a 3.5 m glacial boulder of grey gneiss, ice-rounded with two fresh fracture
faces, thick moss on top, lichen on the flanks.
The builder is in village_nature.py.
"""

import village_nature as vn

OUT = "models/village/boulder-a.glb"
ORIGIN = "bottom"
TRIS = 2200
SMOOTH_ANGLE = 50
AO = 1024
AO_DISTANCE = 0.4


def build():
    mat = vn.rock_material(1024)
    vn.rock("boulder-a", (3.5, 3.0, 2.4), seed=31, mat=mat, tris=2100, planes=11, rounding=0.35, fractures=2)
