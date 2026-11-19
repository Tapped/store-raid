"""
Tick case: a sealed case of tick stock from container HB-0417, the crew's target. An insulated
rotomoulded transport case, off-white and filthy, with rubber corner bumpers, steel latches front
and back, air vents at the ends (what's inside is alive), a fold-down bar handle at each end for the
two who carry it, the container's number stencilled on and the manifest's lie on a label: the
port's `tick-case` item (Items::Kind in unreal/Script/Level/Constants.as), long side along x.
Origin in the middle.
"""

import lib

ORIGIN = "center"
TRIS = 7000
AO = 512
AO_DISTANCE = 0.06

# The case without its handles and bumpers, x × y × z. With them it measures 1.32 × 0.65 × 0.57,
# the item's size in Constants.as (game width, depth, height): change both together.
W, D, H = 1.2, 0.6, 0.55
LID = 0.16  # how deep the lid is, down from the top
BUMPER = 0.07  # the corner bumpers' size


def build():
    shell = case_material()
    rubber = lib.material("rubber", (0.012, 0.012, 0.012), roughness=0.85)
    steel = lib.material("steel", (0.25, 0.25, 0.24), roughness=0.35, metallic=0.9)
    stencil = lib.material("stencil", (0.01, 0.01, 0.01), roughness=0.7)
    label = label_material()
    seal = lib.material("seal", (0.35, 0.02, 0.015), roughness=0.5)

    # The body and its lid, a little apart at the seam, the lid a touch wider.
    seam = H / 2 - LID
    body_h = H - LID - 0.01
    lib.box("body", (W - 0.02, D - 0.02, body_h), (0, 0, -H / 2 + body_h / 2), shell, bevel=0.03, segments=3)
    lib.box("lid", (W, D, LID), (0, 0, H / 2 - LID / 2), shell, bevel=0.035, segments=3)
    # Ribs moulded across the lid, and a rim round the body under the seam.
    for k in range(4):
        x = -0.36 + k * 0.24
        lib.box("rib", (0.05, D - 0.12, 0.018), (x, 0, H / 2 + 0.006), shell, bevel=0.008)
    lib.box("rim", (W + 0.004, D + 0.004, 0.025), (0, 0, seam - 0.03), shell, bevel=0.01)
    # Feet along the bottom.
    for x in (-0.42, 0.42):
        lib.box("skid", (0.1, D - 0.1, 0.02), (x, 0, -H / 2 - 0.0), rubber, bevel=0.006)

    # Rubber bumpers on all eight corners.
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                at = (sx * (W / 2 - BUMPER / 2 + 0.008), sy * (D / 2 - BUMPER / 2 + 0.008),
                      sz * (H / 2 - BUMPER / 2 + 0.004))
                lib.box("bumper", (BUMPER, BUMPER, BUMPER), at, rubber, bevel=0.02, segments=2)

    # Two latches on the front and two on the back, over the seam.
    for sy in (-1, 1):
        y = sy * (D / 2 + 0.008)
        for x in (-0.3, 0.3):
            lib.box("latch-plate", (0.08, 0.012, 0.075), (x, y, seam + 0.0), steel, bevel=0.004)
            lib.box("latch", (0.05, 0.02, 0.05), (x, y + sy * 0.008, seam - 0.006), steel, bevel=0.006)
            lib.box("keeper", (0.06, 0.012, 0.025), (x, y, seam + 0.05), steel, bevel=0.003)
        # A customs seal: red tape over the seam between the latches.
        lib.box("seal", (0.05, 0.004, 0.12), (0, y + sy * 0.001, seam), seal)

    # The ends: a handle in a recess for each carrier, and air vents beside it.
    for sx in (-1, 1):
        x = sx * (W / 2 + 0.002)
        lib.box("recess", (0.006, 0.3, 0.1), (x, 0, seam - 0.1), rubber)
        for sy in (-1, 1):
            lib.box("pivot", (0.03, 0.03, 0.04), (x + sx * 0.01, sy * 0.13, seam - 0.08), steel, bevel=0.005)
        lib.tube("handle", [(x + sx * 0.02, -0.13, seam - 0.08), (x + sx * 0.04, -0.1, seam - 0.15),
                            (x + sx * 0.04, 0.1, seam - 0.15), (x + sx * 0.02, 0.13, seam - 0.08)],
                 [0.014] * 4, steel, sides=8)
        lib.box("grip", (0.04, 0.17, 0.04), (x + sx * 0.04, 0, seam - 0.15), rubber, bevel=0.015)
        for sy in (-1, 1):
            lib.cylinder("vent", 0.04, 0.012, (x + sx * 0.004, sy * 0.2, -0.1), axis="x", mat=steel, sides=16)
            for k in range(3):
                lib.box("vent-slot", (0.004, 0.06, 0.007), (x + sx * 0.011, sy * 0.2, -0.1 - 0.02 + k * 0.02), rubber)

    # The front: the container's number stencilled, and the manifest's label beside it.
    front = -D / 2 - 0.0005
    lib.text("number", "HB-0417", 0.075, (-0.2, front, -0.08), mat=stencil)
    lib.text("number-small", "05 / 12", 0.035, (-0.2, front, -0.17), mat=stencil)
    lib.box("label", (0.3, 0.002, 0.16), (0.3, front - 0.0005, -0.1), label)
    # The back says it too, and the lid from above.
    back = D / 2 + 0.0005
    lib.text("number-back", "HB-0417", 0.075, (0.0, back, -0.1), mat=stencil, facing="y")
    lib.text("top", "THIS WAY UP", 0.024, (0.0, -0.2, H / 2 + 0.0006), mat=stencil, facing="z")


def case_material():
    """Off-white rotomoulded plastic, dimpled, grimy low down and in the creases, scuffed."""
    mat, n = lib.procedural("case", 1024)
    _, _, z = n.xyz()
    dimple = n.noise(140, detail=2)
    base = n.mix(n.noise(9, 3), (0.26, 0.26, 0.23), (0.19, 0.185, 0.16))
    low = lib.smoothstep(n, n.math("SUBTRACT", 0.0, z), 0.05, 0.27)
    grime = n.math("MULTIPLY", low, lib.smoothstep(n, n.noise(6, 4), 0.35, 0.65))
    color = n.mix(n.math("MULTIPLY", grime, 0.85), base, (0.07, 0.06, 0.045))
    crease = lib.crevices(n, 0.04)
    color = n.mix(n.math("MULTIPLY", crease, 0.6), color, (0.05, 0.045, 0.035))
    scuff = lib.smoothstep(n, n.noise(55, 3), 0.68, 0.74)
    color = n.mix(n.math("MULTIPLY", scuff, 0.5), color, (0.12, 0.12, 0.115))
    n.out(**{"Base Color": color, "Roughness": n.lerp(grime, 0.55, 0.8),
             "Normal": n.bump(dimple, distance=0.0015)})
    return mat


def label_material():
    """The manifest's label: yellow, a black band, rows of print, a hazard diamond; peeling."""
    mat, n = lib.procedural("label", 512)
    x, _, z = n.xyz()
    band = n.region((0.15, -1, -0.04), (0.45, 1, -0.0))
    rows = n.math(
        "MULTIPLY",
        n.region((0.17, -1, -0.165), (0.38, 1, -0.06)),
        n.math("MULTIPLY", n.stripes(z, 0.016, 0.45), n.math("GREATER_THAN", n.noise(70, detail=0), 0.4)),
    )
    diamond = n.math(
        "LESS_THAN",
        n.math("ADD", n.math("ABSOLUTE", n.math("SUBTRACT", x, 0.415)), n.math("ABSOLUTE", n.math("SUBTRACT", z, -0.12))),
        0.028,
    )
    ink = n.math("MAXIMUM", n.math("MAXIMUM", band, rows), diamond)
    paper = n.mix(n.noise(30, 3), (0.5, 0.35, 0.02), (0.35, 0.24, 0.02))
    color = n.mix(ink, paper, (0.01, 0.01, 0.01))
    torn = lib.smoothstep(n, n.noise(12, 3), 0.7, 0.75)
    color = n.mix(torn, color, (0.3, 0.3, 0.27))
    n.out(**{"Base Color": color, "Roughness": 0.6})
    return mat
