"""
Gas pipe valve: a gate valve on the gas main, 1 m between its flange faces (x ±0.5), the pipe's
axis 0.9 m up. A fat body on a saddle stand, a bolted bonnet, a yoke and a red handwheel flat on
top at 1.64 m, the stem standing 0.1 m through it. Its origin is on the floor under its middle.
"""

import math

import gas_main as g
import lib

ORIGIN = "model"
TRIS = 4800
AO = 1024
AO_DISTANCE = 0.25

HALF = 0.5
BODY_R = g.R + 0.06
NECK_R = 0.2
BONNET = 0.4  # the bonnet's flange above the axis
BONNET_R = 0.275
YOKE = 0.66
WHEEL = 0.74
WHEEL_R = 0.27


def build():
    paint, stand, bolt, red = g.materials()
    z = g.AXIS
    g.pipe_end((-HALF, 0, z), "x", -1, paint, bolt, 0.15)
    g.pipe_end((HALF, 0, z), "x", 1, paint, bolt, 0.65)

    # The body between the two ends, and its neck up to the bonnet's flange.
    b = HALF - g.END
    body = [(-b - 0.004, g.R - 0.01), (-b - 0.004, g.R + 0.025), (-b + 0.04, BODY_R),
            (b - 0.04, BODY_R), (b + 0.004, g.R + 0.025), (b + 0.004, g.R - 0.01)]
    g._tag(lib.lathe("body", body, (0, 0, z), axis="x", mat=paint, sides=g.SIDES,
                     caps=(False, False)), 0.4)
    r = BONNET_R
    neck = [
        (0.18, NECK_R), (BONNET - 0.035, NECK_R), (BONNET - 0.035, r), (BONNET - 0.003, r),
        (BONNET - 0.003, r - 0.008), (BONNET + 0.003, r - 0.008), (BONNET + 0.003, r),
        (BONNET + 0.035, r), (BONNET + 0.035, 0.15), (BONNET + 0.1, 0.12), (BONNET + 0.16, 0.075),
        (BONNET + 0.2, 0.075),
    ]
    g._tag(lib.lathe("bonnet", neck, (0, 0, z), mat=paint, sides=g.SIDES, caps=(False, True)), 0.9)
    for out, at in ((1, BONNET + 0.035), (-1, BONNET - 0.035)):
        g.bolts((0, 0, z + at), "z", out, bolt, count=8, circle=0.237, size=0.02)

    # The yoke: two arms from the bonnet's flange up to a bridge the stem's nut turns in.
    top = z + YOKE
    for sx in (-1, 1):
        g._tag(lib.box("yoke-arm", (0.04, 0.06, YOKE - BONNET - 0.035),
                       (sx * 0.19, 0, z + (YOKE + BONNET + 0.035) / 2), paint, bevel=0.006,
                       segments=1), 0.3 + 0.2 * sx)
    g._tag(lib.box("yoke-bridge", (0.42, 0.08, 0.04), (0, 0, top), paint, bevel=0.008, segments=1),
           0.55)
    lib.cylinder("stem", 0.024, WHEEL + 0.1 - BONNET - 0.2, (0, 0, z + (WHEEL + 0.1 + BONNET + 0.2) / 2),
                 mat=bolt, sides=10)
    lib.cylinder("gland", 0.05, 0.03, (0, 0, z + BONNET + 0.215), mat=bolt, sides=6)

    # The handwheel: a rim on four spokes, and the nut that holds it.
    wz = z + WHEEL
    ring = [(WHEEL_R * math.cos(a), WHEEL_R * math.sin(a), wz)
            for a in (2 * math.pi * i / 20 for i in range(21))]
    g._tag(lib.tube("handwheel", ring, [0.021] * 21, mat=red, sides=8), 0.5)
    for turn in (0, math.pi / 2):
        spoke = lib.box("spoke", (2 * WHEEL_R, 0.038, 0.018), (0, 0, 0), red, bevel=0.004,
                        segments=1)
        g._tag(spoke, 0.2)
        spoke.location = (0, 0, wz)
        spoke.rotation_euler = (0, 0, turn + math.pi / 4)
    g._tag(lib.cylinder("hub", 0.06, 0.05, (0, 0, wz), mat=red, sides=12, bevel=0.005), 0.7)
    lib.cylinder("wheel-nut", 0.034, 0.024, (0, 0, wz + 0.035), mat=bolt, sides=6)

    g.stand(0, stand, bolt, r=BODY_R, seed=0.35)
