"""
Pallet stack B: three layers of big cartons in stretch wrap on a block pallet, strapped down with
two bands, a shipping label on the front.
"""

import random

import backroom as br

TRIS = 2000
AO = 1024
AO_DISTANCE = 0.3

GRID, BOX = (2, 2, 3), (0.6, 0.5, 0.28)


def build():
    rng = random.Random(5)
    wood = br.wood()
    card = br.cardboard()
    film = br.stretch_wrap()
    band = br.plastic("strap", (0.02, 0.05, 0.16), gloss=0.35)
    z = br.pallet((0, 0, 0), wood, rng, worn=0.2)
    nx, ny, nz = GRID
    bx, by, bz = BOX
    w, d = nx * bx, ny * by
    lo = (-w / 2, -d / 2, z)
    hi = (w / 2, d / 2, z + nz * bz)
    br.boxes(lo, GRID, BOX, card, rng, jitter=0.002, turn=0.004, seeds=(0.0, 0.83))
    joints = ([lo[0] + i * bx for i in range(1, nx)], [lo[1] + j * by for j in range(1, ny)],
              [z + k * bz for k in range(1, nz)])
    br.wrap(lo, hi, joints, film, rng, below=0.07)

    # Two bands over the top and down the front and back, under the pallet's top boards.
    t, bw = 0.0015, 0.016
    top = hi[2] + 0.004
    for x in (-0.33, 0.31):
        br.part("strap", (bw, d + 0.02, t), (x, 0, top + t / 2), band, rng.random())
        for sy in (-1, 1):
            h = top - (z - 0.03)
            br.part("strap", (bw, t, h), (x, sy * (d / 2 + 0.0095), z - 0.03 + h / 2), band,
                    rng.random())

    br.part("label", (0.21, 0.002, 0.15), (0.12, lo[1] - 0.009, z + 2.4 * bz), br.paper(), 0.7)
    br.bounds_report("pallet-stack-b")
