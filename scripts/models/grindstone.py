"""
Grindstone: a worn sandstone wheel on an iron axle in a wooden trestle frame with a water trough
under it and a seat plank at the other end, an iron crank with a wooden grip.
"""

import math
import random

from mathutils import Vector

import lib
import village_props as vp

OUT = "models/village/grindstone.glb"
ORIGIN = "bottom"
TRIS = 4000
AO = 1024
AO_DISTANCE = 0.15
SMOOTH_ANGLE = 50

L = 1.1
RAIL_Y = 0.15
RAIL_Z = 0.58
WHEEL_X = -0.24
WHEEL_R = 0.34
WHEEL_Z = RAIL_Z + 0.04


def build():
    rng = random.Random(1897)
    wood = vp.wood("frame", 2048, tone="silver", moss=0.35, lichen=0.6)
    sand = vp.stone_material("sandstone", 1024, moss=0.4, lichen=0.5, ground=0.15,
                             tint=(1.25, 0.98, 0.72))
    iron = vp.rust("iron", 512)

    # Side rails and splayed legs.
    for sy in (-1, 1):
        sec, _ = vp.rect_section(0.06, 0.085, rng, chamfer=0.01, wane=0.02)
        vp.timber("rail", sec, (-L / 2, sy * RAIL_Y, RAIL_Z), (L / 2, sy * RAIL_Y, RAIL_Z - 0.02), wood,
                  rng.random(), stations=4, chamfer=0.01, rough=0.04)
        for sx in (-1, 1):
            top = Vector((sx * (L / 2 - 0.1), sy * RAIL_Y, RAIL_Z - 0.03))
            foot = Vector((sx * (L / 2 - 0.02), sy * 0.24, 0.0))
            vp.timber("leg", vp.round_section(0.032, 7, rng), foot, top, wood, rng.random(), stations=3,
                      rough=0.08, chamfer=0.008, taper=0.9)
    # Stretchers between the legs low down.
    for sx in (-1, 1):
        vp.timber("stretcher", vp.round_section(0.025, 6, rng), (sx * (L / 2 - 0.05), -0.2, 0.18),
                  (sx * (L / 2 - 0.05), 0.2, 0.18), wood, rng.random(), stations=3, rough=0.08)
    # The trough under the wheel: four boards and a bottom.
    tz0, tz1 = 0.24, 0.44
    tx0, tx1 = WHEEL_X - 0.3, WHEEL_X + 0.3
    for sy in (-1, 1):
        sec, _ = vp.rect_section(0.2, 0.025, rng, chamfer=0.005)
        vp.timber("trough", sec, (tx0, sy * 0.11, (tz0 + tz1) / 2), (tx1, sy * 0.11, (tz0 + tz1) / 2),
                  wood, rng.random(), up=(0, sy, 0), stations=3, chamfer=0.005)
    for x in (tx0 + 0.012, tx1 - 0.012):
        sec, _ = vp.rect_section(0.2, 0.025, rng, chamfer=0.005)
        vp.timber("trough", sec, (x, -0.12, (tz0 + tz1) / 2), (x, 0.12, (tz0 + tz1) / 2), wood, rng.random(),
                  up=(1, 0, 0), stations=2, chamfer=0.005)
    sec, _ = vp.rect_section(0.24, 0.025, rng, chamfer=0.005)
    vp.timber("trough", sec, (tx0, 0, tz0), (tx1, 0, tz0), wood, rng.random(), stations=3, chamfer=0.005)
    # Trough supports from the rails.
    for x in (tx0 + 0.05, tx1 - 0.05):
        for sy in (-1, 1):
            vp.timber("hanger", vp.rect_section(0.04, 0.025, rng, chamfer=0.004)[0],
                      (x, sy * 0.135, tz0 - 0.01), (x, sy * RAIL_Y, RAIL_Z - 0.04), wood, rng.random(),
                      up=(0, sy, 0), stations=2, chamfer=0.004)

    # The wheel: worn out of round, thinner at the rim where it's been ground away.
    prof = [(-0.045, 0.03), (-0.05, 0.08), (-0.052, WHEEL_R - 0.03), (-0.04, WHEEL_R),
            (0.04, WHEEL_R), (0.052, WHEEL_R - 0.03), (0.05, 0.08), (0.045, 0.03)]
    wheel = lib.lathe("wheel", prof, (WHEEL_X, 0, WHEEL_Z), axis="y", mat=sand, sides=28)
    off = rng.uniform(0, 100)
    for v in wheel.data.vertices:
        d = Vector((v.co.x - WHEEL_X, 0, v.co.z - WHEEL_Z))
        r = d.length
        if r > 0.1:
            a = math.atan2(d.z, d.x)
            k = 1 - 0.035 * (0.5 + 0.5 * math.sin(2 * a + off)) - 0.02 * max(0, math.sin(5 * a + off))
            v.co.x = WHEEL_X + d.x * k
            v.co.z = WHEEL_Z + d.z * k
    vp.tag_all(wheel, rng.random(), vp.STONE)
    # Axle, bearings on the rails, the crank on the near side.
    lib.box("axle", (0.03, 0.42, 0.03), (WHEEL_X, -0.01, WHEEL_Z), mat=iron, bevel=0.004)
    lib.cylinder("hub", 0.06, 0.13, (WHEEL_X, 0, WHEEL_Z), axis="y", mat=iron, sides=10)
    for sy in (-1, 1):
        vp.timber("bearing", vp.rect_section(0.1, 0.05, rng, chamfer=0.008)[0],
                  (WHEEL_X, sy * RAIL_Y, RAIL_Z + 0.04), (WHEEL_X, sy * RAIL_Y, WHEEL_Z + 0.02), wood,
                  rng.random(), up=(1, 0, 0), stations=2, chamfer=0.008)
    ye = -0.22
    vp.rod("crank", [(WHEEL_X, ye + 0.02, WHEEL_Z), (WHEEL_X, ye, WHEEL_Z), (WHEEL_X + 0.03, ye, WHEEL_Z - 0.17),
                     (WHEEL_X + 0.03, ye - 0.06, WHEEL_Z - 0.17)], 0.012, iron, rng.random(), sides=6,
           rough=0.03)
    vp.rod("grip", [(WHEEL_X + 0.03, ye - 0.015, WHEEL_Z - 0.17), (WHEEL_X + 0.03, ye - 0.1, WHEEL_Z - 0.17)],
           0.018, wood, rng.random(), sides=6)
    # The seat plank over the far end.
    sec, _ = vp.rect_section(0.3, 0.035, rng, chamfer=0.008)
    vp.timber("seat", sec, (0.14, 0, RAIL_Z + 0.06), (L / 2 + 0.02, 0, RAIL_Z + 0.055), wood, rng.random(),
              stations=3, chamfer=0.008, rough=0.04)
    vp.clip_ground()
    vp.report("grindstone")
