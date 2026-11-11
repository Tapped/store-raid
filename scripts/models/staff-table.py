"""
Staff table: a canteen table in the dockers' room, a ringed and chipped laminate top on four
steel legs, with a mug and a paper cup left on it and a folded newspaper.
"""

import random

import backroom as br
import lib

TRIS = 1500
AO = 1024
AO_DISTANCE = 0.2

W, H, D = 1.4, 0.75, 0.8


def build():
    rng = random.Random(111)
    top = br.laminate("laminate", (0.12, 0.13, 0.12))
    steel = br.paint("legs", (0.03, 0.03, 0.033), wear=1.2, gloss=0.35)
    edge = br.plastic("edging", (0.02, 0.02, 0.022), gloss=0.5)
    mug_mat = br.plastic("mug", (0.4, 0.38, 0.33), gloss=0.2)
    cup = br.paper("cup")
    news = br.paper("newspaper")
    rubber = lib.material("rubber", (0.01, 0.01, 0.01), roughness=0.85)

    t = 0.028
    br.part("top", (W - 0.006, D - 0.006, t - 0.004), (0, 0, H - t / 2), top, 0.3)
    # A soft plastic edge round the top, the sort that gets picked at.
    for sy in (-1, 1):
        br.part("edging", (W, 0.006, t), (0, sy * (D / 2 - 0.003), H - t / 2), edge, rng.random(), bevel=0.002)
    for sx in (-1, 1):
        br.part("edging", (0.006, D - 0.012, t), (sx * (W / 2 - 0.003), 0, H - t / 2), edge, rng.random(),
                bevel=0.002)
    # The frame under the top, and four square legs on rubber feet.
    for sy in (-1, 1):
        br.part("apron", (W - 0.14, 0.02, 0.06), (0, sy * (D / 2 - 0.08), H - t - 0.03), steel, rng.random())
    for sx in (-1, 1):
        br.part("apron", (0.02, D - 0.16, 0.06), (sx * (W / 2 - 0.08), 0, H - t - 0.03), steel, rng.random())
        for sy in (-1, 1):
            x, y = sx * (W / 2 - 0.08), sy * (D / 2 - 0.08)
            br.part("leg", (0.04, 0.04, H - t - 0.012), (x, y, 0.012 + (H - t - 0.012) / 2), steel,
                    rng.random(), bevel=0.003)
            lib.box("foot", (0.044, 0.044, 0.012), (x, y, 0.006), rubber, bevel=0.003)

    # A mug and a paper cup, and a newspaper folded open.
    z = H
    r, h = 0.042, 0.095
    lib.lathe("mug", [(0, 0), (0, r - 0.004), (0.004, r), (h, r), (h, r - 0.005), (0.012, r - 0.005),
                      (0.012, 0)], (-0.35, -0.12, z), mat=mug_mat, sides=14)
    lib.tube("mug-handle", [(-0.35 + r - 0.004, -0.12, z + 0.075), (-0.35 + r + 0.022, -0.12, z + 0.07),
                            (-0.35 + r + 0.026, -0.12, z + 0.045), (-0.35 + r + 0.02, -0.12, z + 0.022),
                            (-0.35 + r - 0.004, -0.12, z + 0.02)], [0.006] * 5, mat=mug_mat, sides=6)
    paper_cup = lib.lathe("cup", [(0, 0), (0, 0.026), (0.11, 0.04), (0.112, 0.042), (0.112, 0.036),
                                  (0.02, 0.024), (0.02, 0)], (0, 0, 0), mat=cup, sides=14)
    br.tag(paper_cup, (0.04, 0.04, 0.056), 0.2, (0, 0, 0.056))
    br.place(paper_cup, (0.25, 0.15, z))
    br.part("newspaper", (0.29, 0.38, 0.006), (0.05, -0.05, z + 0.003), news, 0.8, rot=(0, 0, 0.35))
    br.part("newspaper", (0.29, 0.38, 0.004), (0.11, -0.07, z + 0.008), news, 0.1, rot=(0, 0, 0.5))
    br.bounds_report("staff-table")
