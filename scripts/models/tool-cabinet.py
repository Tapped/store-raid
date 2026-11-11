"""
Tool cabinet: a red roller cabinet on castors, seven drawers with full-width pulls, one pulled
open on a tray of sockets and spanners, a rubber mat on top and a push handle on the side.
"""

import random

import backroom as br
import lib

TRIS = 2500
AO = 1024
AO_DISTANCE = 0.2

W, H, D = 0.7, 1.0, 0.46
CASTOR = 0.1
BACK = D / 2
BODY_D = 0.33
BODY_W = 0.62
FRONT = BACK - BODY_D
DRAWERS = (0.07, 0.07, 0.08, 0.1, 0.12, 0.15, 0.2)  # heights, top to bottom
OPEN = 2  # which drawer is out
PULL_OUT = 0.09


def build():
    rng = random.Random(51)
    red = br.paint("cabinet", (0.3, 0.012, 0.006), wear=1.3, gloss=0.28, primer=br.OXIDE)
    alu = lib.material("aluminium", (0.45, 0.45, 0.46), roughness=0.38, metallic=1.0)
    chrome = lib.material("chrome", (0.55, 0.55, 0.56), roughness=0.3, metallic=1.0)
    black = lib.material("black-rubber", (0.015, 0.015, 0.016), roughness=0.85)
    foam = br.plastic("foam", (0.012, 0.012, 0.014), gloss=0.85)
    x0 = -W / 2 + BODY_W / 2  # the body sits to one side, the push handle on the other

    # Castors: a fork, a wheel and a plate under each corner.
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = x0 + sx * (BODY_W / 2 - 0.06), (FRONT + BACK) / 2 + sy * (BODY_D / 2 - 0.06)
            lib.box("castor-plate", (0.07, 0.07, 0.006), (x, y, CASTOR - 0.003), chrome)
            lib.box("castor-fork", (0.04, 0.05, 0.05), (x, y, CASTOR - 0.03), chrome, bevel=0.004)
            lib.cylinder("castor-wheel", 0.038, 0.026, (x, y + 0.012, 0.038), axis="x", mat=black,
                         sides=12)

    # The body: sides, back and top as one shell, and the drawers' fronts in its face.
    zb, zt = CASTOR, H - 0.04
    br.part("body", (BODY_W, BODY_D, zt - zb), (x0, (FRONT + BACK) / 2, (zb + zt) / 2), red, 0.2,
            bevel=0.006)
    br.part("mat", (BODY_W - 0.01, BODY_D - 0.01, 0.006), (x0, (FRONT + BACK) / 2, zt + 0.003),
            foam, 0.7)
    br.part("lid-rim", (BODY_W, BODY_D, 0.034), (x0, (FRONT + BACK) / 2, zt + 0.017), red, 0.4,
            bevel=0.004)
    br.part("lid-well", (BODY_W - 0.04, BODY_D - 0.04, 0.03), (x0, (FRONT + BACK) / 2, zt + 0.021),
            foam, 0.3)
    z = zt - 0.02
    for i, h in enumerate(DRAWERS):
        out = PULL_OUT if i == OPEN else 0.0
        zc = z - h / 2
        y = FRONT - 0.008 - out
        br.part("drawer", (BODY_W - 0.04, 0.016, h - 0.008), (x0, y, zc), red, rng.random(),
                bevel=0.003)
        lib.box("pull", (BODY_W - 0.08, 0.018, 0.016), (x0, y - 0.017, zc + h / 2 - 0.02), alu,
                bevel=0.004)
        if out:
            # The drawer's sides and floor, out of the cabinet, and what's in it.
            iw = BODY_W - 0.06
            for sx in (-1, 1):
                br.part("drawer-side", (0.006, out + 0.02, h - 0.02), (x0 + sx * iw / 2, y + 0.008 + (out + 0.02) / 2, zc),
                        red, rng.random())
            br.part("tray", (iw, out + 0.02, 0.01), (x0, y + 0.008 + (out + 0.02) / 2, zc - h / 2 + 0.015),
                    foam, rng.random())
            lib.box("dark", (iw - 0.01, 0.04, h - 0.02), (x0, FRONT + 0.02, zc), black)
            for k in range(9):
                r = 0.008 + 0.0015 * k
                lib.cylinder("socket", r, 0.035, (x0 - 0.24 + k * 0.045, y + 0.05, zc - h / 2 + 0.02 + r),
                             axis="y", mat=chrome, sides=8)
        z -= h

    # A push handle on the free side.
    hx = x0 + BODY_W / 2 + 0.06
    for zz in (0.55, 0.85):
        lib.cylinder("handle-arm", 0.01, 0.07, (hx - 0.035, (FRONT + BACK) / 2, zz), axis="x", mat=chrome,
                     sides=8)
    lib.cylinder("handle", 0.014, 0.4, (hx - 0.012, (FRONT + BACK) / 2, 0.7), mat=chrome, sides=10)
    br.bounds_report("tool-cabinet")
