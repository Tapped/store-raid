"""
Hay cart: a two-wheeled farm cart with spoked wooden wheels on iron tyres, a plank bed with
slatted hay racks along its sides, its shafts resting on the ground in front; once painted falu
red, now mostly grey wood, a spoke snapped and a rack rail broken.
"""

import math
import random

from mathutils import Matrix, Vector

import village_props as vp

OUT = "models/village/hay-cart.glb"
ORIGIN = "bottom"
TRIS = 8000
AO = 2048
AO_DISTANCE = 0.2
SMOOTH_ANGLE = 45

WHEEL_R = 0.6
AXLE_Y = 0.42
TRACK = 0.66  # wheel centre from the middle
BEAM_X = 0.47
BED = (-0.6, 1.58)  # the bed along y
TIP_Y = -1.98  # shaft tips, on the ground
RED = (0.085, 0.03, 0.021)


def build():
    rng = random.Random(1961)
    wood = vp.wood("cart", 2048, tone="silver", moss=0.35, lichen=0.55, paint=RED, cover=0.56)
    iron = vp.rust("iron", 1024)

    # The frame is built level, its beams at height FZ, then tipped forward about the axle until
    # the shaft tips touch the ground.
    FZ = WHEEL_R + 0.1
    frame = []

    def keep(fn):
        frame.extend(vp.made(fn))

    def beams():
        for sx in (-1, 1):
            sec, _ = vp.rect_section(0.075, 0.1, rng, chamfer=0.012, wane=0.02)
            vp.timber("beam", sec, (sx * BEAM_X, BED[1], FZ), (sx * 0.31, TIP_Y + 0.02, FZ + 0.02), wood,
                      rng.random(), stations=9, bend=(sx * 0.03, 0, 0.05), taper=0.75, rough=0.05,
                      chamfer=0.012, wobble=0.008)
        # Cross bars under the bed, and the axle block.
        for y in (BED[0] + 0.06, 0.55, BED[1] - 0.06):
            sec, _ = vp.rect_section(0.07, 0.07, rng, chamfer=0.01)
            vp.timber("bar", sec, (-BEAM_X - 0.06, y, FZ - 0.085), (BEAM_X + 0.06, y, FZ - 0.085), wood,
                      rng.random(), stations=3, chamfer=0.01, rough=0.04)
        sec, _ = vp.rect_section(0.1, 0.11, rng, chamfer=0.012)
        vp.timber("axle", sec, (-TRACK + 0.12, AXLE_Y, WHEEL_R + 0.0), (TRACK - 0.12, AXLE_Y, WHEEL_R), wood,
                  rng.random(), stations=3, chamfer=0.012, rough=0.03)
        for sx in (-1, 1):
            # The axle block is held up to the beams by blocks.
            vp.timber("block", vp.rect_section(0.08, 0.08, rng, chamfer=0.01)[0],
                      (sx * BEAM_X, AXLE_Y, WHEEL_R + 0.05), (sx * BEAM_X, AXLE_Y, FZ - 0.04), wood,
                      rng.random(), stations=2, up=(0, 1, 0), chamfer=0.008)

    def bed():
        y = BED[0]
        while y < BED[1] - 0.05:
            w = rng.uniform(0.14, 0.2)
            yc = y + w / 2
            y += w + rng.uniform(0.008, 0.02)
            if abs(yc - 0.9) < 0.1:
                continue  # a plank gone
            sec, _ = vp.rect_section(w, 0.024, rng, chamfer=0.005)
            x0, x1 = -BEAM_X - 0.07, BEAM_X + 0.07
            if abs(yc - 1.15) < 0.1:
                x1 = rng.uniform(0.0, 0.2)  # snapped off
            vp.timber("plank", sec, (x0, yc, FZ + 0.062), (x1, yc, FZ + 0.062), wood, rng.random(),
                      stations=3, rough=0.04, chamfer=0.005, twist=rng.uniform(-0.04, 0.04),
                      ragged=(0, 0.04 if x1 < 0.3 else 0))

    def racks():
        for sx in (-1, 1):
            ys = [BED[0] + 0.05, -0.05, 0.5, 1.0, BED[1] - 0.05]
            tops = []
            for i, y in enumerate(ys):
                foot = Vector((sx * (BEAM_X + 0.02), y, FZ + 0.03))
                top = Vector((sx * (BEAM_X + 0.12), y + rng.uniform(-0.02, 0.02), FZ + 0.46))
                tops.append(top)
                if sx == 1 and i == 3:
                    continue  # this stave is gone
                vp.timber("stave", vp.round_section(0.022, 6, rng), foot, top, wood, rng.random(),
                          stations=3, rough=0.08, chamfer=0.006, taper=0.85)
            sec = vp.round_section(0.03, 7, rng)
            a = tops[0] + Vector((0, -0.12, 0.02))
            b = tops[-1] + Vector((0, 0.06, 0.02))
            if sx == 1:
                # Broken where the stave went: half lies on the bed.
                mid = tops[2].lerp(tops[3], 0.6) + Vector((0, 0, 0.02))
                vp.timber("rail", sec, a, mid, wood, rng.random(), stations=5, rough=0.07, ragged=(0, 0.05))
                vp.timber("rail", sec, Vector((0.2, 1.05, FZ + 0.1)), b + Vector((0, 0, -0.01)), wood,
                          rng.random(), stations=4, rough=0.07, ragged=(0.05, 0))
            else:
                vp.timber("rail", sec, a, b, wood, rng.random(), stations=6, rough=0.07,
                          bend=(0, 0, -0.03))
            # A middle rail too, lower down.
            if sx == -1:
                vp.timber("rail", vp.round_section(0.022, 6, rng), tops[0].lerp(
                    Vector((sx * (BEAM_X + 0.02), ys[0], FZ + 0.03)), 0.5),
                    tops[-1].lerp(Vector((sx * (BEAM_X + 0.02), ys[-1], FZ + 0.03)), 0.5), wood,
                    rng.random(), stations=5, rough=0.07)

    keep(beams)
    keep(bed)
    keep(racks)
    # Tip the frame about the axle until the shaft tips reach the ground.
    pivot = Vector((0, AXLE_Y, WHEEL_R))
    tip = Vector((0, TIP_Y, FZ + 0.02 - 0.05))
    d = tip - pivot
    want_z = 0.05 - pivot.z
    ang = math.pi - math.asin(max(-1, min(1, want_z / d.length))) - math.atan2(d.z, d.y)
    m = Matrix.Translation(pivot) @ Matrix.Rotation(ang, 4, "X") @ Matrix.Translation(-pivot)
    vp.transform(frame, m)

    for sx in (-1, 1):
        vp.wheel("wheel", (sx * TRACK, AXLE_Y, WHEEL_R), WHEEL_R, wood, iron, rng,
                 broken=(4,) if sx == 1 else (), dish=0.0, hub_len=0.22)
        # Iron axle stubs into the hubs.
        import lib
        lib.cylinder("stub", 0.03, 0.2, (sx * (TRACK - 0.08), AXLE_Y, WHEEL_R), axis="x", mat=iron,
                     sides=8)
    vp.clip_ground()
    vp.report("hay-cart")
