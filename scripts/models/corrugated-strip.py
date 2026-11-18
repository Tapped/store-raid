"""
Corrugated strip: one corrugation of corrugated-sheet.py, 76.2 mm wide, for the port's building to
fill what's left of a wall's cladding past its last whole sheet. Its origin, like the sheet's, is at
its left edge, on the wall at the foot.
"""

import importlib

sheet = importlib.import_module("corrugated-sheet")

OUT = "models/level/corrugated-strip.glb"
ORIGIN = "model"
TRIS = 40
AO = 0
SMOOTH_ANGLE = 80


def build():
    sheet.sheet("strip", 1)
