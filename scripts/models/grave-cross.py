"""
Grave cross: a wrought-iron grave cross with trefoil ends, a ring round the crossing and scrolls
in its corners, rusted through, leaning in a stone socket sunk in the turf.
"""

import math
import random

from mathutils import Matrix, Vector

import lib
import village_props as vp

OUT = "models/village/grave-cross.glb"
ORIGIN = "bottom"
TRIS = 2400
AO = 1024
AO_DISTANCE = 0.08
SMOOTH_ANGLE = 45

H = 1.08
ARM_Z = 0.8
ARM = 0.28  # half the crossbar


def build():
    rng = random.Random(1911)
    iron = vp.rust("iron", 1024, scale=0.4)
    stones = vp.stone_material("stone", 512, moss=0.9, lichen=0.8, ground=0.15)

    cross = []
    bar, _ = vp.rect_section(0.034, 0.014, rng, chamfer=0.003, jitter=0.0008)
    cross.append(vp.timber("upright", bar, (0, 0, 0.02), (0, 0, H - 0.05), iron, rng.random(),
                           up=(0, -1, 0), stations=5, rough=0.06, chamfer=0.003, wobble=0.004))
    cross.append(vp.timber("arm", bar, (-ARM + 0.04, 0, ARM_Z), (ARM - 0.04, 0, ARM_Z), iron, rng.random(),
                           up=(0, -1, 0), stations=4, rough=0.06, chamfer=0.003, wobble=0.003))
    # Trefoil ends: three knobs on each of the top and the arms.
    for end, d in (((0, 0, H - 0.05), Vector((0, 0, 1))), ((-ARM + 0.04, 0, ARM_Z), Vector((-1, 0, 0))),
                   ((ARM - 0.04, 0, ARM_Z), Vector((1, 0, 0)))):
        e = Vector(end)
        side = Vector((0, 0, 1)) if abs(d.z) < 0.5 else Vector((1, 0, 0))
        for p, r in ((e + d * 0.032, 0.022), (e + d * 0.008 + side * 0.026, 0.019),
                     (e + d * 0.008 - side * 0.026, 0.019)):
            cross.append(lib.ellipsoid("knob", (r, 0.011, r), p, mat=iron, segments=10, rings=6, poles="y"))
    # The ring round the crossing.
    cross.append(vp.ring("ring", (0, 0, ARM_Z), 0.115, 0.011, 0.011, iron, rng.random(), axis="y",
                         segments=28, rough=0.05))
    # Scrolls in the four corners, curling in from the ring.
    for sx in (-1, 1):
        for sz in (-1, 1):
            pts = []
            for i in range(12):
                t = i / 11
                a = math.pi / 4 + t * 2.6 * math.pi
                r = 0.042 * (1 - 0.75 * t)
                c = Vector((sx * 0.052, 0, ARM_Z + sz * 0.052))
                pts.append(c + Vector((sx * r * math.cos(a) * 0.9, 0, sz * r * math.sin(a))))
            cross.append(vp.rod("scroll", pts, 0.0055, iron, rng.random(), sides=4, rough=0.05,
                                phase=math.pi / 4, squash=1.8))
    # A little oval plate where a name was, rusted blank.
    cross.append(lib.ellipsoid("plate", (0.05, 0.006, 0.035), (0, -0.012, ARM_Z), mat=iron, segments=14,
                               rings=6, poles="y"))
    # Leaning: to the side and a little back, in a stone socket.
    m = Matrix.Rotation(math.radians(6.5), 4, "Y") @ Matrix.Rotation(math.radians(-4), 4, "X")
    for o in cross:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(m)
    vp.stone("socket", (0.24, 0.17, 0.13), (0.01, 0.0, 0.04), stones, rng.random(), cuts=2,
             roundness=0.55, lump=0.12, turn=0.3, facets=1)
    vp.clip_ground()
    vp.report("grave-cross")
