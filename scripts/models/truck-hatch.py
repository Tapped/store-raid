"""
The truck's hatch: the piece that closes the back of its cargo box and folds down into the ramp.
truck.py has its shape and measures; the game hinges it on the truck (client/src/truck.ts). Its
origin is the hinge: it lies flat behind it, deck up.
"""

import truck

OUT = "models/level/truck-hatch.glb"
ORIGIN = "model"
TRIS = 2500
ATLAS = 2048
AO = 1024
AO_DISTANCE = 0.2


def build():
    truck.hatch()
