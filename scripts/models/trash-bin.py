"""
Trash bin: a dented galvanised dustbin with ribbed sides, two drop handles and a lid knocked
askew on top of a black bin bag that spills over the rim.
"""

import math
import random

import backroom as br
import lib

TRIS = 1500
AO = 1024
AO_DISTANCE = 0.15
SMOOTH_ANGLE = 50

R_BOT, R_TOP, BODY_H = 0.185, 0.205, 0.6


def build():
    rng = random.Random(151)
    galv = br.galvanised("bin")
    bag = br.plastic("bag", (0.008, 0.008, 0.009), gloss=0.25)

    # The body: tapering, with two pressed ribs and a rolled rim.
    prof = [(0.0, 0.0), (0.0, R_BOT - 0.01), (0.012, R_BOT)]
    for z0 in (0.18, 0.4):
        k = z0 / BODY_H
        rr = R_BOT + (R_TOP - R_BOT) * k
        prof += [(z0 - 0.02, rr), (z0, rr + 0.01), (z0 + 0.02, rr)]
    prof += [(BODY_H - 0.01, R_TOP), (BODY_H, R_TOP + 0.008), (BODY_H + 0.006, R_TOP + 0.004),
             (BODY_H + 0.004, R_TOP - 0.004), (0.03, R_BOT - 0.006), (0.03, 0.0)]
    body = lib.lathe("bin", prof, (0, 0, 0), mat=galv, sides=24)
    # Dents: push a few points of the body in.
    for v in body.data.vertices:
        for cx, cz, depth in ((0.7, 0.3, 0.015), (-2.2, 0.5, 0.01)):
            a = math.atan2(v.co.y, v.co.x)
            d = math.hypot((a - cx) * 0.2, v.co.z - cz)
            if d < 0.08 and v.co.length > 0.1:
                k = (1 - d / 0.08) * depth
                v.co.x -= math.cos(a) * k
                v.co.y -= math.sin(a) * k
    br.tag(body, (R_TOP, R_TOP, BODY_H / 2), 0.3, (0, 0, BODY_H / 2))

    # Drop handles on both sides.
    for sx in (-1, 1):
        x = sx * (R_TOP - 0.005)
        lib.box("handle-lug", (0.02, 0.04, 0.03), (x, 0, BODY_H - 0.07), galv)
        loop = [(x + sx * 0.012, -0.05, BODY_H - 0.075), (x + sx * 0.02, -0.05, BODY_H - 0.11),
                (x + sx * 0.022, 0, BODY_H - 0.12), (x + sx * 0.02, 0.05, BODY_H - 0.11),
                (x + sx * 0.012, 0.05, BODY_H - 0.075)]
        lib.tube("handle", loop, [0.006] * 5, mat=galv, sides=6)

    # The bag over the rim, then the lid, tipped.
    def bag_shape(q):
        lump = 1 + 0.12 * math.sin(q.x * 7 + q.y * 3) + 0.1 * math.sin(q.y * 9 - q.z * 4)
        return lib.Vector((q.x * (R_TOP + 0.012) * lump, q.y * (R_TOP + 0.012) * lump,
                           max(q.z, 0.0) * 0.07 * lump - 0.01))

    sack = lib.ellipsoid("bag", (R_TOP, R_TOP, 0.07), (0, 0, 0), bag, segments=16, rings=8, deform=bag_shape)
    br.tag(sack, (R_TOP, R_TOP, 0.05), 0.5)
    br.place(sack, (0, 0, BODY_H - 0.02))
    lid = lib.lathe("lid", [(0.0, R_TOP + 0.014), (0.012, R_TOP + 0.014), (0.02, R_TOP - 0.01),
                            (0.05, 0.12), (0.065, 0.0)], (0, 0, 0), mat=galv, sides=24)
    br.tag(lid, (R_TOP, R_TOP, 0.035), 0.7, (0, 0, 0.035))
    knob = lib.box("lid-handle", (0.1, 0.02, 0.02), (0, 0, 0.075), galv, bevel=0.006)
    for o in (lid, knob):
        br.place(o, (0.01, 0.015, BODY_H + 0.03), (0.12, 0.05, 0.3))
    br.bounds_report("trash-bin")
