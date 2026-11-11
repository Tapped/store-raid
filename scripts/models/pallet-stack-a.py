"""
Pallet stack A: five layers of cartons in stretch wrap on a block pallet, the film torn open at a
front corner, and a packing list on the front.
"""

import math
import random

import backroom as br
from mathutils import Vector

TRIS = 3000
AO = 1024
AO_DISTANCE = 0.3

GRID, BOX = (3, 2, 5), (0.4, 0.5, 0.25)


def build():
    rng = random.Random(3)
    wood = br.wood()
    card = br.cardboard()
    film = br.stretch_wrap()
    z = br.pallet((0, 0, 0), wood, rng, worn=0.4)
    nx, ny, nz = GRID
    bx, by, bz = BOX
    w, d = nx * bx, ny * by
    lo = (-w / 2, -d / 2, z)
    hi = (w / 2, d / 2, z + nz * bz)
    br.boxes(lo, GRID, BOX, card, rng, jitter=0.003, turn=0.006, seeds=(0.0, 0.83), shrink=0.01)

    # The tear: round the front right corner, from the second layer up to the fourth.
    corner = Vector((hi[0], lo[1], 0))
    zc = z + 2.6 * bz

    def tear(p):
        along = (corner.x - p.x) + (p.y - corner.y)
        up = (p.z - zc) / 0.36
        wobble = 0.04 * math.sin(p.x * 41 + p.z * 23) + 0.03 * math.sin(p.y * 37 - p.z * 51)
        return up * up < 1 and along < 0.38 * (1 - up * up) ** 0.5 + wobble

    steps = [0.07 * k for k in range(1, 6)]
    extra = ([hi[0] - s for s in steps], [lo[1] + s for s in steps],
             [zc + s * sign for s in steps for sign in (-1, 1)] + [zc])
    joints = ([lo[0] + i * bx for i in range(1, nx)], [lo[1] + j * by for j in range(1, ny)],
              [z + k * bz for k in range(1, nz)])
    br.wrap(lo, hi, joints, film, rng, tear=tear, extra=extra)

    # A packing list in a pocket on the front, over the film.
    br.part("label", (0.21, 0.002, 0.15), (-0.3, lo[1] - 0.009, z + 3.4 * bz), br.paper(), 0.4)
    br.bounds_report("pallet-stack-a")
