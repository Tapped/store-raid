"""
Pallet racking, one bay, load B: steel drums and a crate on the floor, an empty level, wrapped
cartons and a stack of empty pallets on top.
"""

import random

import backroom as br
import lib

TRIS = 6000
AO = 1024
AO_DISTANCE = 0.4


def build():
    rng = random.Random(11)
    mats = br.rack_materials()
    wood = br.wood()
    card = br.cardboard()
    film = br.stretch_wrap()
    drum = br.paint("drum", (0.012, 0.045, 0.17), wear=1.6, rust=1.4, gloss=0.35, primer=br.OXIDE)
    ink = lib.material("stencil", (0.015, 0.014, 0.013), roughness=0.85)
    floor, low, high = br.rack(mats, rng, ["bars", "bars"])
    left, right = br.SLOTS

    # The floor: three drums, one tucked behind the other two, and a crate on skids.
    for x, y, turn in ((left - 0.3, -0.25, 0.4), (left + 0.3, -0.25, 2.1), (left, 0.26, 4.0)):
        br.drum((x, y, floor), drum, mats["galv"], rng.random(), turn)
    br.crate((right, -0.02, floor), (1.1, 0.9, 0.5), wood, rng, ink)

    # The first level stands empty but for a carton pushed to the back.
    br.part("box", (0.46, 0.36, 0.3), (-0.95, 0.22, low + 0.15), card, 0.31, rot=(0, 0, 0.07),
            bevel=0.004)

    # The top: wrapped cartons, and empty pallets stacked askew.
    z = br.pallet((left, 0, high), wood, rng, worn=0.3)
    br.wrapped_stack((left, 0, z), (3, 2, 2), (0.4, 0.5, 0.3), card, film, rng)
    z = high
    for i in range(4):
        z = br.pallet((right + rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02), z), wood, rng,
                      worn=0.5)
    br.bounds_report("pallet-rack-b")
