"""
Fire extinguisher: a red 6 kg extinguisher hung on a wall bracket, valve, gauge and hose with its
horn clipped at the side, and a red sign above it pointing down. Origin on the wall, at the middle
of the bottom; its back is flat on the wall.
"""

import math

import lib

ORIGIN = "model"
TRIS = 700
SMOOTH_ANGLE = 50
AO_DISTANCE = 0.04

PLATE = 0.006  # the bracket's back plate
R = 0.08  # the cylinder's radius
CY = -PLATE - 0.029 - R  # the cylinder's axis
SHOULDER = 0.44
TOP = 0.52  # the top of the neck
SIGN = (0.3, 0.15, 0.6)  # width, height, bottom


def build():
    red = body_paint()
    lib.lathe(
        "cylinder",
        [(0.0, 0.0), (0.0, R - 0.01), (0.012, R), (SHOULDER, R), (SHOULDER + 0.04, R - 0.02),
         (SHOULDER + 0.07, 0.026), (TOP, 0.02), (TOP, 0.0)],
        at=(0, CY, 0), mat=red, sides=14,
    )

    # The valve: a black head, the carrying handle under the squeeze lever, a pin, the gauge.
    black = lib.material("valve", (0.02, 0.02, 0.022), roughness=0.45)
    brass = lib.material("brass", (0.4, 0.26, 0.08), roughness=0.35, metallic=1)
    lib.box("head", (0.034, 0.05, 0.05), (0, CY, TOP + 0.022), black, bevel=0.005, segments=1)
    lib.box("handle", (0.03, 0.12, 0.01), (0, CY - 0.045, TOP + 0.03), black)
    lever = lib.box("lever", (0.028, 0.12, 0.01), (0, CY - 0.045, TOP + 0.058), black)
    for v in lever.data.vertices:  # tipped up towards its free end
        v.co.z += (CY - v.co.y) * 0.18
    lib.cylinder("pin", 0.003, 0.05, (0, CY - 0.012, TOP + 0.043), axis="x", mat=brass, sides=6)
    gauge_y = CY - 0.03
    lib.cylinder("gauge", 0.018, 0.012, (0.0, gauge_y - 0.006, TOP + 0.02 - 0.0), axis="y",
                 mat=brass, sides=10)
    lib.cylinder("dial", 0.015, 0.002, (0.0, gauge_y - 0.012, TOP + 0.02), axis="y",
                 mat=dial_material(), sides=10)

    # The hose, out of the head's side and down to the horn, clipped to the cylinder's side.
    hose = [(0.02, CY, TOP + 0.015), (0.06, CY - 0.01, TOP), (0.1, CY - 0.02, 0.46),
            (0.11, CY - 0.03, 0.38), (0.1, CY - 0.035, 0.3), (0.092, CY - 0.03, 0.24)]
    lib.tube("hose", hose, [0.009] * len(hose), mat=black, sides=6)
    lib.lathe("horn", [(0.24, 0.009), (0.16, 0.014), (0.1, 0.03), (0.1, 0.0)],
              at=(0.092, CY - 0.03, 0), mat=black, sides=10)

    # The bracket: a plate on the wall, a strap round the cylinder, a hook under its shoulder.
    steel = lib.material("bracket", (0.12, 0.12, 0.12), roughness=0.5, metallic=0.9)
    lib.box("plate", (0.05, PLATE, 0.32), (0, -PLATE / 2, 0.27), steel, bevel=0.002, segments=1)
    lib.box("hook", (0.05, 0.045, 0.012), (0, -PLATE - 0.02, SHOULDER + 0.02), steel)
    strap = [(R * 0.98 * math.cos(a), CY + R * 0.98 * math.sin(a) + 0.0, 0.2)
             for a in (math.radians(d) for d in range(90, -271, -45))]
    strap = [(x * 1.04, y + (y - CY) * 0.04, z) for x, y, z in strap]
    lib.tube("strap", strap, [0.004] * len(strap), mat=steel, sides=4)

    sign()


def sign():
    """A red sign above: a white extinguisher on the left, an arrow down to it on the right."""
    w, h, z0 = SIGN
    plate = lib.material("sign", (0.32, 0.015, 0.01), roughness=0.45)
    lib.box("sign", (w, 0.003, h), (0, -0.0015, z0 + h / 2), plate)
    white = lib.material("sign-ink", (0.75, 0.74, 0.7), roughness=0.5)
    y = -0.0034
    cx, cz = -0.07, z0 + h / 2
    body = [(-0.016, -0.05), (0.016, -0.05), (0.016, 0.02), (0.01, 0.03), (-0.01, 0.03),
            (-0.016, 0.02)]
    lib.shape("icon", body, (cx, y, cz - 0.005), depth=0.0006, mat=white)
    lib.shape("icon", [(-0.006, 0.03), (0.006, 0.03), (0.006, 0.042), (-0.006, 0.042)],
              (cx, y, cz - 0.005), depth=0.0006, mat=white)
    lib.shape("icon", [(-0.02, 0.04), (0.02, 0.048), (0.02, 0.054), (-0.02, 0.048)],
              (cx, y, cz - 0.005), depth=0.0006, mat=white)
    lib.shape("icon", [(0.006, 0.042), (0.035, 0.03), (0.04, 0.0), (0.033, 0.0), (0.028, 0.026),
                       (0.006, 0.036)], (cx, y, cz - 0.005), depth=0.0006, mat=white)
    lib.shape("arrow", [(-0.012, 0.045), (0.012, 0.045), (0.012, -0.01), (0.03, -0.01),
                        (0.0, -0.05), (-0.03, -0.01), (-0.012, -0.01)],
              (0.07, y, cz), depth=0.0006, mat=white)


def body_paint():
    """Glossy signal red: a cream instruction label round the front, scuffed low, dust on top."""
    mat, n = lib.procedural("body", 512)
    x, y, z = n.xyz()
    front = n.math("LESS_THAN", y, CY - 0.03)
    label = n.math("MULTIPLY", front, n.math("MULTIPLY", n.inside(z, 0.13, 0.36),
                                             n.math("LESS_THAN", n.math("ABSOLUTE", x), 0.06)))
    words = n.noise(1.0, detail=0, vector=n.vec(n.math("MULTIPLY", x, 160),
                                                n.math("FLOOR", n.math("DIVIDE", z, 0.012))))
    lines = n.math("MULTIPLY", n.stripes(z, 0.012, 0.3),
                   n.math("MULTIPLY", n.math("GREATER_THAN", words, 0.4),
                          n.math("LESS_THAN", n.math("ABSOLUTE", x), 0.048)))
    block = n.math("MULTIPLY", n.inside(z, 0.29, 0.34), n.math("LESS_THAN", n.math("ABSOLUTE", x),
                                                                0.045))
    ink = n.math("MAXIMUM", n.math("MULTIPLY", lines, n.inside(z, 0.15, 0.27)), block)
    paint = n.mix(label, (0.32, 0.012, 0.008), (0.5, 0.45, 0.33))
    paint = n.mix(n.math("MULTIPLY", label, ink), paint, (0.05, 0.03, 0.025))
    out = lib.weathered(n, paint, rough=0.22, chips=0.3, rust=0.2, dirt=0.6, dust=1.0,
                        edge_wear=0.5, dents=0.3, bump=0.0015, scale=0.3, seed=4)
    n.out(**out)
    return mat


def dial_material():
    """The gauge's face: white, a green band for charged, red either side, a black needle."""
    mat, n = lib.procedural("dial", 128)
    x, _, z = n.xyz()
    dz = n.math("SUBTRACT", z, TOP + 0.02)
    angle = n.math("ARCTAN2", x, dz)
    r = n.math("SQRT", n.math("ADD", n.math("MULTIPLY", x, x), n.math("MULTIPLY", dz, dz)))
    band = n.inside(r, 0.009, 0.013)
    green = n.math("MULTIPLY", band, n.math("LESS_THAN", n.math("ABSOLUTE", angle), 0.5))
    redb = n.math("MULTIPLY", band, n.math("GREATER_THAN", n.math("ABSOLUTE", angle), 0.5))
    needle = n.math("MULTIPLY", n.math("LESS_THAN", n.math("ABSOLUTE", x), 0.0008),
                    n.inside(dz, -0.002, 0.012))
    color = n.mix(redb, (0.7, 0.7, 0.66), (0.4, 0.02, 0.01))
    color = n.mix(green, color, (0.03, 0.3, 0.05))
    color = n.mix(needle, color, (0.01, 0.01, 0.01))
    n.out(**{"Base Color": color, "Roughness": 0.15})
    return mat
