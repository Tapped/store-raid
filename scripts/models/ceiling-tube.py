"""
Ceiling tube: a fluorescent batten, a white enamelled steel trough with one tube under a wire guard.
Hangs from its origin, on the ceiling at the middle of its top. The tube's material is glow-tube.
"""

import lib

ORIGIN = "model"
TRIS = 300
AO_DISTANCE = 0.05

# Meters: the fitting along x, across y, hanging down from z = 0.
LENGTH = 1.25
HALF = 0.07  # half its width, at the trough's lip
TOP = 0.045  # half the width of the trough's back on the ceiling
LIP = 0.052  # how far down the trough's sides reach
SHEET = 0.004
TUBE = 0.013  # the tube's radius
TUBE_Z = -0.059
TUBE_LENGTH = 1.19
GUARD = -0.09  # the guard's lowest wire, at its middle
WIRE = 0.0025


def build():
    body = enamel()
    lib.shape(
        "trough",
        [
            (-TOP, 0), (TOP, 0), (HALF, -LIP + 0.006), (HALF, -LIP), (HALF - SHEET, -LIP),
            (HALF - SHEET, -LIP + 0.006), (TOP - SHEET * 0.6, -SHEET),
            (-TOP + SHEET * 0.6, -SHEET), (-HALF + SHEET, -LIP + 0.006), (-HALF + SHEET, -LIP),
            (-HALF, -LIP), (-HALF, -LIP + 0.006),
        ],
        depth=LENGTH - 2 * SHEET, mat=body, facing="x",
    )
    # End plates close the trough, and lampholders hang inside them, holding the tube.
    for side in (-1, 1):
        lib.shape(
            "end", [(-TOP, 0), (TOP, 0), (HALF, -LIP), (-HALF, -LIP)],
            at=(side * (LENGTH - SHEET) / 2, 0, 0), depth=SHEET, mat=body, facing="x",
        )
        lib.box(
            "holder", (0.028, 0.036, 0.05),
            (side * (TUBE_LENGTH / 2 + 0.012), 0, TUBE_Z + 0.012), body,
        )
    glow = lib.material(
        "glow-tube", (0.8, 0.8, 0.77), roughness=0.3, emission=(1.0, 0.95, 0.86), strength=3
    )
    lib.cylinder("tube", TUBE, TUBE_LENGTH, (0, 0, TUBE_Z), axis="x", mat=glow, sides=8)

    # The guard: hoops from lip to lip under the tube, joined by two wires along the bottom.
    wire = lib.material("wire", (0.42, 0.42, 0.43), roughness=0.38, metallic=1)
    edge = HALF - SHEET / 2
    bottom = GUARD + WIRE
    for x in (-0.45, 0, 0.45):
        hoop = [
            (x, -edge, -LIP + 0.002), (x, -0.05, bottom + 0.019), (x, -0.022, bottom),
            (x, 0.022, bottom), (x, 0.05, bottom + 0.019), (x, edge, -LIP + 0.002),
        ]
        lib.tube("hoop", hoop, [WIRE] * len(hoop), mat=wire, sides=4)
    for y in (-0.022, 0.022):
        rail = [(-0.5, y, bottom + WIRE * 1.6), (0.5, y, bottom + WIRE * 1.6)]
        lib.tube("rail", rail, [WIRE] * 2, mat=wire, sides=4)


def enamel():
    """White stove enamel gone ivory, dusty and fly-specked, chipped a little at the lip."""
    mat, n = lib.procedural("enamel", 512)
    specks = lib.smoothstep(n, n.noise(260, detail=1), 0.72, 0.8)
    paint = n.mix(n.math("MULTIPLY", specks, 0.6), (0.4, 0.38, 0.33), (0.08, 0.07, 0.05))
    n.out(**lib.weathered(
        n, paint, rough=0.32, chips=0.25, rust=0.3, dirt=0.6, dust=0.8, edge_wear=0.5,
        dents=1.0, bump=0.003, scale=0.6,
    ))
    return mat
