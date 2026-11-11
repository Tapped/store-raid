"""
Wall shelving A: slotted-angle steel shelves along a wall, stocked with rows of parts bins, tins
of paint and grease, cartons and a coiled air hose.
"""

import random

import backroom as br

TRIS = 3500
AO = 1024
AO_DISTANCE = 0.25

LEVELS = (0.1, 0.55, 1.0, 1.45, 1.95)


def build():
    rng = random.Random(21)
    steel = br.paint("shelving", (0.045, 0.055, 0.065), wear=1.2, gloss=0.45,
                     detail=br._angle_holes)
    card = br.cardboard(size=1024)
    bins = br.plastic("bins", (0.01, 0.04, 0.16), gloss=0.4)
    parts = br.bits()
    tins = br.tin_label()
    hose = br.rubber("hose", (0.2, 0.025, 0.008))
    br.shelving(steel, rng, LEVELS)
    y0 = -br.SHELF_D / 2

    # Bottom: cartons pushed to the back, one pulled out and opened.
    br.part("box", (0.46, 0.4, 0.3), (-0.4, 0.02, LEVELS[0] + 0.15), card, 0.15, rot=(0, 0, 0.03),
            bevel=0.004)
    br.part("box", (0.4, 0.36, 0.26), (0.12, 0.04, LEVELS[0] + 0.13), card, 0.62, rot=(0, 0, -0.05),
            bevel=0.004)
    br.part("box", (0.3, 0.4, 0.22), (0.47, -0.02, LEVELS[0] + 0.11), card, 0.88, rot=(0, 0, 0.1),
            bevel=0.004)

    # Two rows of parts bins, small then large.
    for i in range(8):
        br.louvre_bin((-0.5625 + i * 0.1607, y0 + 0.13, LEVELS[1]), bins, parts,
                      rng.random())
    for i in range(6):
        br.louvre_bin((-0.535 + i * 0.214, y0 + 0.16, LEVELS[2]), bins, parts, rng.random(),
                      size=(0.205, 0.3, 0.17))

    # Tins, two of them stacked, and a carton.
    for x, y, r, h in ((-0.52, -0.08, 0.085, 0.19), (-0.32, -0.1, 0.085, 0.19), (-0.4, 0.1, 0.1, 0.24),
                       (-0.12, -0.06, 0.065, 0.14)):
        br.tin((x, y, LEVELS[3]), tins, rng.random(), r, h)
    br.tin((-0.32, -0.1, LEVELS[3] + 0.19), tins, rng.random(), 0.085, 0.19)
    br.part("box", (0.42, 0.34, 0.2), (0.38, 0.02, LEVELS[3] + 0.1), card, 0.4, rot=(0, 0, -0.04),
            bevel=0.004)

    # Top: an air hose coiled flat, and a carton.
    br.coil((-0.3, 0.0, LEVELS[4]), hose, 0.3, radius=0.19, thick=0.016, turns=4)
    br.part("box", (0.36, 0.3, 0.2), (0.35, 0.03, LEVELS[4] + 0.1), card, 0.7, rot=(0, 0, 0.06),
            bevel=0.004)
    br.bounds_report("wall-shelf-a")
