"""
Wall shelving B: slotted-angle steel shelves along a wall, stocked with crates of fittings, a
coil of mooring rope, a row of tins, big parts bins, cartons and a coiled yellow hose.
"""

import random

import backroom as br

TRIS = 3500
AO = 1024
AO_DISTANCE = 0.25

LEVELS = (0.1, 0.55, 1.0, 1.45, 1.95)


def build():
    rng = random.Random(33)
    steel = br.paint("shelving", (0.045, 0.055, 0.065), wear=1.4, gloss=0.45,
                     detail=br._angle_holes)
    card = br.cardboard(size=1024)
    crates = br.plastic("crates", (0.06, 0.065, 0.065), gloss=0.5)
    bins = br.plastic("bins", (0.16, 0.03, 0.008), gloss=0.4)
    parts = br.bits()
    tins = br.tin_label()
    rope = br.rubber("rope", (0.2, 0.14, 0.07))
    hose = br.rubber("hose", (0.3, 0.2, 0.005))
    br.shelving(steel, rng, LEVELS)
    y0 = -br.SHELF_D / 2

    # Bottom: two grey crates of fittings.
    for x, turn in ((-0.31, 0.02), (0.31, -0.03)):
        br.tote((x, 0.0, LEVELS[0]), crates, rng, size=(0.6, 0.4, 0.24), turn=turn)
        br.part("parts", (0.56, 0.36, 0.05), (x, 0.0, LEVELS[0] + 0.15), parts, rng.random(),
                rot=(0, 0, turn))

    # A coil of mooring rope, and flat cartons stacked beside it.
    br.coil((-0.36, 0.0, LEVELS[1]), rope, 0.6, radius=0.2, thick=0.024, turns=3.2, per_turn=12)
    for k, (w, d, h) in enumerate(((0.5, 0.38, 0.12), (0.46, 0.36, 0.12), (0.4, 0.3, 0.1))):
        br.part("box", (w, d, h), (0.32 + k * 0.01, 0.02, LEVELS[1] + 0.12 * k + h / 2), card,
                rng.random(), rot=(0, 0, rng.uniform(-0.08, 0.08)), bevel=0.004)

    # A row of tins.
    for i, (r, h) in enumerate(((0.085, 0.19), (0.085, 0.19), (0.1, 0.24), (0.065, 0.14),
                                (0.085, 0.19), (0.065, 0.14))):
        br.tin((-0.53 + i * 0.205, -0.05 + 0.08 * (i % 2), LEVELS[2]), tins, rng.random(), r, h)

    # Big parts bins, and a carton.
    for i in range(3):
        br.louvre_bin((-0.535 + i * 0.214, y0 + 0.16, LEVELS[3]), bins, parts, rng.random(),
                      size=(0.205, 0.3, 0.17))
    br.part("box", (0.5, 0.4, 0.3), (0.36, 0.02, LEVELS[3] + 0.15), card, 0.27, rot=(0, 0, 0.04),
            bevel=0.004)

    # Top: a yellow hose coiled flat, and cartons.
    br.coil((0.3, 0.0, LEVELS[4]), hose, 0.2, radius=0.2, thick=0.016, turns=4)
    br.part("box", (0.4, 0.36, 0.22), (-0.35, 0.02, LEVELS[4] + 0.11), card, 0.83, rot=(0, 0, -0.05),
            bevel=0.004)
    br.bounds_report("wall-shelf-b")
