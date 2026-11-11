"""
Wall vent: a louvred steel grille, blades tipped down in a flanged frame over a dark duct mouth,
rust weeping from its blades. Origin on the wall, at the middle of its bottom; back on the wall.
"""

import math

import lib

ORIGIN = "model"
TRIS = 500
AO_DISTANCE = 0.03

W, H, D = 0.6, 0.4, 0.05
FRAME = 0.035  # the frame's width
FLANGE = 0.006  # its thickness on the wall
BLADES = 9
TILT = math.radians(40)


def build():
    paint = grille_paint()
    dark = lib.material("mouth", (0.008, 0.008, 0.008), roughness=0.9)
    # The flange flat on the wall, and the frame's deep sides standing out of it.
    for x in (-1, 1):
        lib.box("flange", (FRAME, FLANGE, H), (x * (W - FRAME) / 2, -FLANGE / 2, H / 2), paint,
                bevel=0.002, segments=1)
        lib.box("side", (0.008, D - FLANGE, H - 2 * FRAME + 0.008),
                (x * (W / 2 - FRAME + 0.004), -FLANGE - (D - FLANGE) / 2, H / 2), paint)
    for z in (FRAME / 2, H - FRAME / 2):
        lib.box("flange", (W - 2 * FRAME, FLANGE, FRAME), (0, -FLANGE / 2, z), paint)
    for z in (FRAME - 0.004, H - FRAME + 0.004):
        lib.box("rail", (W - 2 * FRAME, D - FLANGE, 0.008), (0, -FLANGE - (D - FLANGE) / 2, z),
                paint)
    lib.box("mouth", (W - 2 * FRAME, 0.002, H - 2 * FRAME), (0, -0.001, H / 2), dark)

    # Blades across, tipped down to the front so rain and eyes can't see in.
    inner = H - 2 * FRAME
    pitch = inner / BLADES
    blade_w = pitch / math.cos(TILT) * 0.95
    for i in range(BLADES):
        z = FRAME + pitch * (i + 0.5)
        blade = lib.box("blade", (W - 2 * FRAME - 0.016, blade_w, 0.004),
                        (0, -FLANGE - (D - FLANGE) / 2, z), paint)
        cy = -FLANGE - (D - FLANGE) / 2
        c, s = math.cos(TILT), math.sin(TILT)
        for v in blade.data.vertices:
            dy, dz = v.co.y - cy, v.co.z - z
            v.co.y = cy + dy * c - dz * s
            v.co.z = z + dy * s + dz * c
    screw = lib.material("screw", (0.05, 0.05, 0.05), roughness=0.5, metallic=1)
    for x in (-1, 1):
        for z in (0.06, H - 0.06):
            lib.cylinder("screw", 0.005, 0.003, (x * (W / 2 - FRAME / 2), -FLANGE - 0.0005, z),
                         axis="y", mat=screw, sides=6)


def grille_paint():
    """Grey enamel on steel: salt-chalked, rust running from the blades, grime in every slot."""
    mat, n = lib.procedural("grille", 512)
    n.out(**lib.weathered(n, (0.08, 0.085, 0.085), rough=0.45, chips=0.8, rust=1.0, dirt=0.9,
                          dust=0.9, edge_wear=0.9, dents=0.4, bump=0.002, scale=0.4, seed=8))
    return mat
