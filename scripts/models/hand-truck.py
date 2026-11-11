"""
Hand truck: a red tubular sack truck standing on its toe plate, two pneumatic wheels behind,
looped handles at the top, chipped and scraped from years on the quay.
"""

import math
import random

import backroom as br
import lib

TRIS = 1800
AO = 1024
AO_DISTANCE = 0.15
SMOOTH_ANGLE = 45

WHEEL_R = 0.13
AXLE_Y = 0.115
FRAME_X = 0.17


def build():
    rng = random.Random(141)
    frame = br.paint("frame", (0.3, 0.018, 0.008), wear=1.8, rust=1.2, gloss=0.35, primer=br.OXIDE)
    steel = br.galvanised("toe-plate")
    rubber = br.rubber("tyre", (0.02, 0.02, 0.021))
    hub = lib.material("hub", (0.3, 0.3, 0.3), roughness=0.4, metallic=1.0)
    grip = lib.material("grip", (0.015, 0.015, 0.015), roughness=0.75)

    r = 0.014
    # Two uprights, leaning a little back, joined at the top in a loop.
    foot_y, top_y = 0.02, 0.07
    for sx in (-1, 1):
        x = sx * FRAME_X
        pts = [(x, foot_y, 0.03), (x, foot_y + 0.02, 0.4), (x, top_y, 1.05), (x * 0.95, top_y + 0.02, 1.13),
               (x * 0.7, top_y + 0.03, 1.17)]
        t = lib.tube("upright", pts, [r] * len(pts), mat=frame, sides=8)
        br.tag(t, (0.02, 0.05, 0.6), rng.random(), (x, 0.05, 0.6))
        # The handles' grips.
        g = lib.tube("grip", [(x * 0.95, top_y + 0.02, 1.13), (x * 0.4, top_y + 0.032, 1.18)],
                     [r + 0.004] * 2, mat=grip, sides=8)
    lib.tube("top-bar", [(-FRAME_X * 0.7, top_y + 0.03, 1.17), (FRAME_X * 0.7, top_y + 0.03, 1.17)],
             [r, r], mat=frame, sides=8)
    for z in (0.35, 0.65, 0.9):
        y = foot_y + 0.02 + (top_y - foot_y - 0.02) * (z - 0.4) / 0.65
        b = lib.tube("cross-bar", [(-FRAME_X, y + 0.005, z), (FRAME_X, y + 0.005, z)], [0.01, 0.01],
                     mat=frame, sides=8)
        br.tag(b, (FRAME_X, 0.01, 0.01), rng.random(), (0, y, z))

    # The toe plate, folded up at the back where it's welded on.
    br.part("toe", (0.36, 0.28, 0.008), (0, -0.28 / 2 + 0.02, 0.004), steel, 0.3, bevel=0.002)
    br.part("toe-lip", (0.36, 0.008, 0.06), (0, 0.02, 0.03), steel, 0.6)
    for sx in (-1, 1):
        br.part("gusset", (0.008, 0.08, 0.05), (sx * 0.15, -0.02, 0.03), frame, rng.random())

    # The axle on two brackets, and the wheels.
    lib.cylinder("axle", 0.01, 0.46, (0, AXLE_Y, WHEEL_R), axis="x", mat=hub, sides=8)
    for sx in (-1, 1):
        lib.tube("axle-bracket", [(sx * FRAME_X, foot_y + 0.01, 0.2), (sx * FRAME_X, AXLE_Y, WHEEL_R)],
                 [0.012, 0.012], mat=frame, sides=6)
        x = sx * 0.21
        tyre = lib.lathe("tyre", [(-0.03, 0.06), (-0.032, 0.1), (-0.022, 0.125), (0.0, WHEEL_R),
                                  (0.022, 0.125), (0.032, 0.1), (0.03, 0.06)], (x, AXLE_Y, WHEEL_R),
                         axis="x", mat=rubber, sides=20)
        br.tag(tyre, (0.03, WHEEL_R, WHEEL_R), rng.random(), (x, AXLE_Y, WHEEL_R))
        lib.cylinder("hub", 0.06, 0.05, (x, AXLE_Y, WHEEL_R), axis="x", mat=hub, sides=12)
        lib.cylinder("hub-cap", 0.025, 0.06, (x, AXLE_Y, WHEEL_R), axis="x", mat=frame, sides=8)
    br.bounds_report("hand-truck")
