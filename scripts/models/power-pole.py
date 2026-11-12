"""
Power pole: a creosoted timber pole with a crossarm, iron braces and porcelain insulators,
leaning, one insulator broken and a snapped wire hanging down it.
"""

import math
import random

from mathutils import Matrix, Vector

import lib
import village_props as vp

OUT = "models/village/power-pole.glb"
ORIGIN = "bottom"
TRIS = 3000
AO = 1024
AO_DISTANCE = 0.2
SMOOTH_ANGLE = 50

HEIGHT = 7.95
LEAN = math.radians(1.8)  # towards +y, along the crossarm


def insulator(at, mat, pin_mat, broken=False):
    prof = [(0.0, 0.018), (0.012, 0.05), (0.02, 0.04), (0.035, 0.045), (0.045, 0.034),
            (0.065, 0.038), (0.08, 0.028), (0.1, 0.022), (0.11, 0.0)]
    if broken:
        prof = prof[:5] + [(0.05, 0.02), (0.052, 0.0)]
    objs = [lib.lathe("insulator", prof, at, mat=mat, sides=12)]
    objs.append(lib.cylinder("pin", 0.009, 0.12, (at[0], at[1], at[2] - 0.05), mat=pin_mat, sides=6))
    return objs


def build():
    rng = random.Random(1949)
    wood = vp.wood("pole", 2048, tone="dark", moss=0.35, lichen=0.55, rings=60, rot=0.3, ground=0.6)
    iron = vp.rust("iron", 512)
    porcelain = lib.material("porcelain", (0.42, 0.4, 0.35), roughness=0.22)

    top = Vector((0.0, HEIGHT * math.sin(LEAN), HEIGHT * math.cos(LEAN)))
    vp.timber("pole", vp.round_section(0.135, 12, rng, oval=0.04), (0, 0, 0), top, wood, rng.random(),
              stations=8, taper=0.72, rough=0.03, wobble=0.03, chamfer=0.015, up=(1, 0, 0))

    def on_pole(z):
        return Vector((0, z * math.tan(LEAN), z))

    # The crossarm, bolted through the pole, held by two flat iron braces.
    za = HEIGHT - 0.45
    c = on_pole(za) + Vector((-0.12, 0, 0))
    d = Vector((0, math.cos(LEAN), -math.sin(LEAN)))
    up = Vector((0, math.sin(LEAN), math.cos(LEAN)))
    sec, _ = vp.rect_section(0.09, 0.11, rng, chamfer=0.012)
    vp.timber("arm", sec, c - d * 0.86, c + d * 0.86, wood, rng.random(), stations=4, chamfer=0.012,
              up=up, rough=0.03)
    for s in (-1, 1):
        brace_top = c + d * s * 0.55 + Vector((-0.0, 0, -0.06))
        foot = on_pole(za - 0.55) + Vector((-0.13, 0, 0))
        vp.timber("brace", vp.rect_section(0.04, 0.008, rng, chamfer=0.002)[0], brace_top, foot, iron,
                  rng.random(), up=(-1, 0, 0), stations=2, chamfer=0.003)
    lib.cylinder("bolt", 0.012, 0.3, (c.x + 0.05, c.y, c.z), axis="x", mat=iron, sides=6)

    # Insulators: three on the arm, one broken; a cap on the pole top.
    tops = []
    for s, broken in ((-0.74, False), (-0.28, True), (0.74, False)):
        p = c + d * s + up * 0.105
        insulator(p, porcelain, iron, broken)
        tops.append(p + up * 0.09)
    cap = lib.lathe("cap", [(0.0, 0.11), (0.04, 0.115), (0.06, 0.0)], top - up * 0.03, mat=iron, sides=12)

    # The snapped wire: from the far insulator, a loop round it, then hanging down by the pole.
    p = tops[2]
    pts = [p + Vector((0.0, 0.03, -0.02)), p + Vector((0.02, 0.07, -0.25)), p + Vector((0.03, 0.1, -0.8)),
           p + Vector((0.04, 0.11, -1.6)), p + Vector((0.05, 0.08, -2.5)), p + Vector((0.07, 0.03, -3.3)),
           p + Vector((0.09, 0.06, -3.7))]
    vp.rod("wire", pts, 0.005, iron, rng.random(), sides=4, rough=0.0)
    # And a stub of the other wire, cut off short.
    p = tops[0]
    vp.rod("wire", [p, p + Vector((0.02, -0.14, -0.03)), p + Vector((0.03, -0.24, -0.1))], 0.005, iron,
           rng.random(), sides=4, rough=0.0)
    # Iron steps up the lower pole for the lineman.
    for i, z in enumerate((2.2, 2.65, 3.1, 3.55)):
        s = 1 if i % 2 else -1
        p = on_pole(z)
        lib.cylinder("step", 0.011, 0.16, (p.x + s * 0.1, p.y, p.z), axis="x", mat=iron, sides=6)
    vp.report("power-pole")
