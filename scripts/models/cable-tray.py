"""
Cable tray: 4 m of zinc-plated wire basket tray hung on rods and flat bars, a loose bundle of
cables along it. Open along x, so lengths join end to end. Hangs from its origin on the ceiling.
"""

import math

import lib

ORIGIN = "model"
TRIS = 1500
AO_DISTANCE = 0.05
AO = 1024  # long and thin: more texels along it

LENGTH = 4.0
HALF_W = 0.135  # half the basket's width
TOP = -0.035
BOTTOM = -0.088
WIRE = 0.0025
PITCH = 0.2  # between the cross wires
HANGERS = (-1.0, 1.0)

# Cables: (radius, y, colour, sides, wiggle phase). They lie on the basket's floor.
CABLES = [
    (0.012, -0.07, (0.012, 0.012, 0.013), 5, 0.0),
    (0.012, -0.044, (0.06, 0.06, 0.062), 5, 1.3),
    (0.008, -0.022, (0.3, 0.07, 0.008), 4, 2.1),
    (0.008, -0.004, (0.012, 0.012, 0.013), 4, 0.7),
    (0.008, 0.016, (0.3, 0.07, 0.008), 4, 2.9),
    (0.0045, 0.034, (0.06, 0.06, 0.062), 3, 1.9),
    (0.0045, 0.046, (0.18, 0.01, 0.008), 3, 0.4),
    (0.0045, 0.058, (0.012, 0.012, 0.013), 3, 3.4),
]


def build():
    zinc = lib.material("zinc", (0.42, 0.42, 0.4), roughness=0.38, metallic=0.9)
    steel = lib.material("hanger", (0.2, 0.19, 0.18), roughness=0.55, metallic=0.8)

    # The basket: cross wires bent up into a U, and wires along it on the floor and both rims.
    for i in range(int(LENGTH / PITCH)):
        x = -LENGTH / 2 + PITCH / 2 + i * PITCH
        u = [(x, -HALF_W, TOP), (x, -HALF_W, BOTTOM + WIRE), (x, HALF_W, BOTTOM + WIRE),
             (x, HALF_W, TOP)]
        lib.tube("cross", u, [WIRE] * 4, mat=zinc, sides=3)
    for y, z in ((-HALF_W, TOP), (HALF_W, TOP), (-HALF_W, (TOP + BOTTOM) / 2),
                 (HALF_W, (TOP + BOTTOM) / 2), (-0.09, BOTTOM + WIRE), (-0.03, BOTTOM + WIRE),
                 (0.03, BOTTOM + WIRE), (0.09, BOTTOM + WIRE)):
        outward = 0.0 if abs(y) < HALF_W else math.copysign(WIRE, y) * 0.8
        lib.tube("long", [(-LENGTH / 2, y + outward, z), (LENGTH / 2, y + outward, z)],
                 [WIRE, WIRE], mat=zinc, sides=3)

    # Hangers: rods down to a flat bar under the basket.
    for x in HANGERS:
        lib.box("bar", (0.03, 0.3, 0.012), (x, 0, -0.1 + 0.006), steel, bevel=0.002, segments=1)
        for y in (-1, 1):
            lib.cylinder("rod", 0.004, 0.1, (x, y * 0.145, -0.05), mat=steel, sides=6)

    # Cables, each wandering a little across the basket, the same at both ends so they join.
    floor = BOTTOM + 2 * WIRE
    mats = {}
    for r, y, colour, sides, phase in CABLES:
        mat = mats.get(colour)
        if mat is None:
            mat = mats[colour] = lib.material(f"cable{len(mats)}", colour, roughness=0.6)
        points = []
        for k in range(9):
            x = -LENGTH / 2 + k * LENGTH / 8
            t = 2 * math.pi * x / LENGTH
            wy = 0.006 * math.sin(t + phase) + 0.004 * math.sin(2 * t + phase * 2.3)
            # Thin cables ride up over the fat ones here and there.
            lift = max(0.0, math.sin(2 * t + phase)) * (0.012 if r < 0.006 else 0.0)
            points.append((x, y + wy, floor + r + lift))
        lib.tube("cable", points, [r] * len(points), mat=mat, sides=sides)

    # Cable ties round the bundle beside each hanger.
    tie = lib.material("tie", (0.02, 0.02, 0.02), roughness=0.5)
    for x in HANGERS:
        lib.box("tie", (0.005, 0.14, 0.03), (x + 0.08, -0.006, floor + 0.013), tie, bevel=0.004,
                segments=1)
