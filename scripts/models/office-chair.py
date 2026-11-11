"""
Office chair: a worn task chair on a five-star base with castors, a gas lift, a padded seat split
at the front edge to the foam, a reclined back on a steel spine and two armrests.
"""

import math
import random

import backroom as br
import lib
from mathutils import Vector

TRIS = 2800
AO = 1024
AO_DISTANCE = 0.15
SMOOTH_ANGLE = 50

SEAT_Z = 0.47


def fabric(name="fabric", size=1024):
    """Dark woven upholstery: pilled, polished shiny where people sat, stained, split at the front."""
    mat, n = lib.procedural(name, size)
    p = br.seeded(n)
    x, y, z = n.xyz()
    weave = n.math("MULTIPLY", n.stripes(x, 0.003, 0.5), n.stripes(n.math("ADD", y, z), 0.003, 0.5))
    c = n.mix(n.noise(5, 3, vector=p), (0.018, 0.022, 0.035), (0.03, 0.035, 0.05))
    pill = br.smooth(n, n.noise(120, 2, vector=p), 0.62, 0.7)
    c = n.mix(br.mul(n, pill, 0.5), c, (0.06, 0.06, 0.07))
    stain = br.smooth(n, n.noise(3, 3, vector=p), 0.62, 0.7)
    c = n.mix(br.mul(n, stain, 0.6), c, (0.04, 0.03, 0.015))
    # The split: a ragged hole at the front of the seat showing yellow foam.
    split = br.mul(n, br.inside_band(n, z, SEAT_Z + 0.06, 0.05), n.math("LESS_THAN", y, -0.15),
                   br.inside_band(n, x, 0.08, 0.06),
                   n.math("GREATER_THAN", n.noise(14, 4, vector=p), 0.45))
    c = n.mix(split, c, (0.45, 0.32, 0.06))
    up = br.smooth(n, br.normal_z(n), 0.6, 0.9)
    worn = br.mul(n, up, br.smooth(n, n.noise(2, 2, vector=p), 0.4, 0.7))
    rough = n.lerp(worn, 0.85, 0.6)
    rough = n.lerp(split, rough, 0.95)
    n.out(**{"Base Color": c, "Roughness": rough,
             "Normal": br.bump(n, br.add(n, br.mul(n, weave, 0.4), br.mul(n, split, -1.0)), 0.0012)})
    return mat


def cushion(name, half, at, mat, rot=(0, 0, 0), power=0.35):
    """A rounded box of foam under fabric."""
    hx, hy, hz = half

    def shape(q):
        return Vector((math.copysign(abs(q.x) ** power, q.x) * hx,
                       math.copysign(abs(q.y) ** power, q.y) * hy,
                       math.copysign(abs(q.z) ** 0.6, q.z) * hz))

    obj = lib.ellipsoid(name, half, (0, 0, 0), mat, segments=16, rings=10, deform=shape)
    br.tag(obj, half, 0.5)
    return br.place(obj, at, rot)


def build():
    rng = random.Random(101)
    cloth = fabric()
    plastic = br.plastic("plastic", (0.015, 0.015, 0.017), gloss=0.45)
    chrome = lib.material("chrome", (0.5, 0.5, 0.5), roughness=0.3, metallic=1.0)
    steel = br.paint("steel", (0.02, 0.02, 0.022), wear=1.0, gloss=0.35, salt=0.2)

    # The base: five legs out to castors.
    for k in range(5):
        a = math.radians(90 + 72 * k + 8)
        r = 0.27
        leg = lib.box("leg", (0.26, 0.045, 0.035), (0.13 + 0.02, 0, 0), plastic, bevel=0.008, segments=1)
        leg.location = (0, 0, 0.085)
        leg.rotation_euler = (0, math.radians(-5), a)
        cx, cy = r * math.cos(a), r * math.sin(a)
        wheel = lib.cylinder("castor", 0.025, 0.03, (0, 0, 0), axis="x", mat=plastic, sides=10)
        wheel.location = (cx, cy, 0.025)
        wheel.rotation_euler = (0, 0, a + 0.6)
        lib.box("castor-hood", (0.03, 0.045, 0.02), (cx, cy, 0.055), plastic, bevel=0.006)
    lib.cylinder("hub", 0.04, 0.05, (0, 0, 0.09), mat=plastic, sides=12)
    lib.cylinder("gas-lift", 0.024, 0.32, (0, 0, 0.26), mat=chrome, sides=12)
    lib.cylinder("shroud", 0.032, 0.15, (0, 0, 0.17), mat=plastic, sides=12)
    lib.box("mechanism", (0.2, 0.22, 0.05), (0, 0.0, SEAT_Z - 0.06), steel, bevel=0.006)
    lib.cylinder("lever", 0.006, 0.12, (0.15, -0.04, SEAT_Z - 0.06), axis="x", mat=steel, sides=6)

    # Seat, spine and back.
    cushion("seat", (0.24, 0.23, 0.045), (0, -0.02, SEAT_Z), cloth)
    br.place(lib.box("spine", (0.06, 0.03, 0.34), (0, 0, 0), steel, bevel=0.006),
             (0, 0.25, SEAT_Z + 0.12), (math.radians(-6), 0, 0))
    lib.box("spine-arm", (0.06, 0.2, 0.025), (0, 0.15, SEAT_Z - 0.05), steel, bevel=0.006)
    cushion("back", (0.22, 0.04, 0.22), (0, 0.255, 0.77), cloth, rot=(math.radians(-10), 0, 0))
    br.place(lib.box("back-shell", (0.4, 0.015, 0.38), (0, 0, 0), plastic, bevel=0.01),
             (0, 0.293, 0.77), (math.radians(-10), 0, 0))

    # Armrests.
    for sx in (-1, 1):
        x = sx * 0.265
        lib.box("arm-post", (0.03, 0.05, 0.22), (x, 0.03, SEAT_Z + 0.06), plastic, bevel=0.008)
        lib.box("arm-bracket", (0.06, 0.04, 0.02), (x - sx * 0.03, 0.03, SEAT_Z - 0.05), steel)
        lib.box("arm-pad", (0.06, 0.24, 0.03), (x, 0.0, SEAT_Z + 0.18), plastic, bevel=0.012)
    br.bounds_report("office-chair")
