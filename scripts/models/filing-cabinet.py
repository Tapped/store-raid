"""
Filing cabinet: a four-drawer steel cabinet in office putty, dented and scuffed, with recessed
handles, card holders, a lock at the top and the second drawer left out a little.
"""

import random

import backroom as br
import lib

TRIS = 1500
AO = 1024
AO_DISTANCE = 0.2

W, H, D = 0.47, 1.32, 0.62
PLINTH = 0.05
PULLED = 0.03  # how far the second drawer sticks out


def build():
    rng = random.Random(91)
    steel = br.paint("cabinet", (0.2, 0.18, 0.14), wear=1.2, gloss=0.4, salt=0.3)
    chrome = lib.material("chrome", (0.5, 0.5, 0.5), roughness=0.3, metallic=1.0)
    dark = lib.material("shadow", (0.01, 0.01, 0.01), roughness=0.8)
    paper = br.paper()
    front = -D / 2 + PULLED + 0.035
    body_d = D / 2 - front
    yc = front + body_d / 2
    br.part("body", (W, body_d, H - PLINTH), (0, yc, PLINTH + (H - PLINTH) / 2), steel, 0.2, bevel=0.005)
    lib.box("plinth", (W - 0.03, body_d - 0.03, PLINTH), (0, yc + 0.01, PLINTH / 2), dark)
    lib.cylinder("lock", 0.011, 0.012, (W / 2 - 0.06, front - 0.006, H - 0.04), axis="y", mat=chrome,
                 sides=10)
    dh = (H - PLINTH - 0.04) / 4
    for i in range(4):
        zc = H - 0.06 - dh * (i + 0.5)
        out = PULLED if i == 1 else 0.0
        y = front - 0.009 - out
        br.part("drawer", (W - 0.02, 0.018, dh - 0.012), (0, y, zc), steel, rng.random(), bevel=0.004)
        if out:
            for sx in (-1, 1):
                lib.box("drawer-side", (0.008, out + 0.01, dh - 0.05), (sx * (W / 2 - 0.02), front + (-out) / 2, zc), steel)
            lib.box("files", (W - 0.06, 0.004, 0.02), (0, front - out / 2, zc + dh / 2 - 0.02), paper)
        lib.box("handle-recess", (0.16, 0.006, 0.035), (0, y - 0.007, zc + 0.03), dark)
        lib.box("handle", (0.17, 0.02, 0.012), (0, y - 0.016, zc + 0.045), chrome, bevel=0.004)
        lib.box("card-holder", (0.09, 0.004, 0.04), (0, y - 0.011, zc + 0.1), chrome, bevel=0.001)
        br.part("card", (0.08, 0.002, 0.03), (0, y - 0.0135, zc + 0.1), paper, rng.random())
    br.bounds_report("filing-cabinet")
