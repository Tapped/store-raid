"""
Work light: a site floodlight on a telescopic tripod, two halogen heads on a bar, its cable
trailing off across the floor. Customs set them up round container HB-0417; they're out now.
The lamps don't glow. Origin on the floor under the mast; the heads face the front.
"""

import math

import lib

ORIGIN = "model"
TRIS = 3000
AO = 512
AO_DISTANCE = 0.08

MAST = 1.75  # the bar's height
SPREAD = 0.42  # how far out the feet stand from the mast
HEAD = (0.3, 0.14, 0.24)  # a lamp head, x × y × z


def build():
    steel = lib.material("steel", (0.03, 0.03, 0.032), roughness=0.45, metallic=0.6)
    yellow = painted()
    glass = lib.material("glass", (0.25, 0.25, 0.22), roughness=0.15, metallic=0.2)
    reflector = lib.material("reflector", (0.4, 0.4, 0.38), roughness=0.2, metallic=0.9)
    rubber = lib.material("rubber", (0.015, 0.015, 0.015), roughness=0.8)

    # The tripod: three legs from a collar on the mast down to rubber feet.
    collar = 0.62
    for k in range(3):
        a = k * math.tau / 3 + math.pi / 2
        foot = (SPREAD * math.cos(a), SPREAD * math.sin(a), 0.02)
        lib.tube("leg", [(0, 0, collar), foot], [0.014, 0.014], steel, sides=6)
        lib.box("foot", (0.06, 0.06, 0.03), (foot[0], foot[1], 0.015), rubber)
        # A brace from each leg back up to the mast.
        mid = (foot[0] * 0.5, foot[1] * 0.5, collar * 0.5)
        lib.tube("brace", [mid, (0, 0, collar - 0.25)], [0.008, 0.008], steel, sides=5)
    lib.cylinder("collar", 0.03, 0.08, (0, 0, collar), mat=yellow, sides=10)
    # The mast in two sections, the upper one thinner.
    lib.cylinder("mast", 0.022, 0.62, (0, 0, collar + 0.19), mat=yellow, sides=10)
    lib.cylinder("mast-upper", 0.016, MAST - collar - 0.4, (0, 0, (MAST + collar + 0.4) / 2),
                 mat=steel, sides=8)
    lib.cylinder("clamp", 0.028, 0.05, (0, 0, collar + 0.5), mat=rubber, sides=8)
    # The bar across the top with a head at each end, tipped down a little.
    lib.box("bar", (0.75, 0.03, 0.03), (0, 0, MAST), yellow)
    hw, hd, hh = HEAD
    for s in (-1, 1):
        x = s * 0.25
        lib.box("bracket", (0.02, 0.03, 0.18), (x - s * (hw / 2 + 0.01), -0.02, MAST + 0.08), steel)
        lib.box("bracket", (0.02, 0.03, 0.18), (x + s * (hw / 2 + 0.01), -0.02, MAST + 0.08), steel)
        lib.box("head", HEAD, (x, -0.03, MAST + 0.14), yellow, bevel=0.01, segments=2)
        for k in range(5):
            lib.box("fin", (hw - 0.04, 0.012, 0.012), (x, -0.03 + hd / 2 + 0.006, MAST + 0.06 + k * 0.04),
                    yellow)
        lib.box("reflector", (hw - 0.05, 0.01, hh - 0.05), (x, -0.03 - hd / 2 + 0.008, MAST + 0.14),
                reflector)
        lib.box("glass", (hw - 0.04, 0.006, hh - 0.04), (x, -0.03 - hd / 2 - 0.002, MAST + 0.14),
                glass)
        for k in range(3):
            lib.box("guard", (0.008, 0.008, hh - 0.02),
                    (x - hw / 3 + k * hw / 3, -0.03 - hd / 2 - 0.01, MAST + 0.14), steel)
    # The cable: down the mast and away across the floor.
    points = [(0.03, 0.02, MAST - 0.05), (0.03, 0.03, 0.9), (0.06, 0.05, 0.3), (0.15, 0.12, 0.012),
              (0.45, 0.3, 0.012), (0.7, 0.2, 0.012), (0.9, 0.4, 0.012)]
    lib.tube("cable", points, [0.008] * len(points), rubber, sides=6)


def painted():
    """Yellow powder coat, scuffed to bare steel at the edges, dirty."""
    mat, n = lib.procedural("yellow", 512)
    wear = lib.smoothstep(n, n.noise(18, 4), 0.62, 0.7)
    color = n.mix(wear, (0.5, 0.3, 0.01), (0.05, 0.05, 0.05))
    dirt = n.math("MULTIPLY", lib.smoothstep(n, n.noise(4, 3), 0.4, 0.7), 0.6)
    color = n.mix(dirt, color, (0.08, 0.06, 0.03))
    n.out(**{"Base Color": color, "Roughness": n.lerp(wear, 0.5, 0.35)})
    return mat
