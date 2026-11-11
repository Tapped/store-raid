"""
Pallet racking, one bay, load A: chipboard decks, wrapped and open pallets of boxes, loose stock.
"""

import random

import backroom as br

TRIS = 6000
AO = 1024
AO_DISTANCE = 0.4


def build():
    rng = random.Random(7)
    mats = br.rack_materials()
    mats["chipboard"] = br.chipboard()
    wood = br.wood()
    card = br.cardboard()
    film = br.stretch_wrap()
    crate = br.plastic("tote", (0.012, 0.035, 0.07))
    floor, low, high = br.rack(mats, rng, ["boards", "boards"])
    left, right = br.SLOTS

    # The floor: a wrapped pallet and an open one of big boxes, the top layer one short.
    z = br.pallet((left, 0, floor), wood, rng, worn=0.3)
    br.wrapped_stack((left, 0, z), (3, 2, 3), (0.4, 0.5, 0.21), card, film, rng)
    z = br.pallet((right, 0, floor), wood, rng, worn=0.6)
    br.boxes((right - 0.6, -0.5, z), (2, 2, 2), (0.6, 0.5, 0.29), card, rng, bevel=0.004,
             skip={(1, 0, 1)}, shrink=0.02)

    # The first deck: a short wrapped pallet, and loose stock beside it.
    z = br.pallet((left, 0, low), wood, rng)
    br.wrapped_stack((left, 0, z), (4, 2, 2), (0.3, 0.5, 0.235), card, film, rng)
    br.part("box", (0.5, 0.42, 0.34), (0.32, 0.12, low + 0.17), card, 0.2, rot=(0, 0, 0.05),
            bevel=0.004)
    br.part("box", (0.38, 0.32, 0.24), (0.3, 0.1, low + 0.34 + 0.12), card, 0.9,
            rot=(0, 0, -0.32), bevel=0.004)
    br.part("box", (0.55, 0.36, 0.13), (0.38, -0.3, low + 0.065), card, 0.55, rot=(0, 0, 0.12),
            bevel=0.004)
    br.tote((0.95, 0.05, low), crate, rng, turn=0.06)
    br.boxes((0.7, -0.47, low + 0.002), (2, 1, 1), (0.22, 0.3, 0.16), card, rng, bevel=0.003,
             turn=0.15)

    # The top: a tall wrapped pallet and one of sacks.
    z = br.pallet((left, 0, high), wood, rng)
    br.wrapped_stack((left, 0, z), (3, 2, 3), (0.4, 0.5, 0.2), card, film, rng, top_shrink=0.01)
    z = br.pallet((right, 0, high), wood, rng, worn=0.3)
    br.sacks((right, 0, z), 4, br.sacking(), rng)
    br.bounds_report("pallet-rack-a")
