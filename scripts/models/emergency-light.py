"""
Emergency light: an oval bulkhead fitting, a ribbed lens dome on a cast base, a steel cage over
it. The lens's material is glow-lens. Origin on the wall, at the middle of the bottom of the base.
"""

import math

import lib

ORIGIN = "model"
TRIS = 500
AO_DISTANCE = 0.03

W, H, D = 0.35, 0.14, 0.1
BASE = 0.04  # the base's depth off the wall
CZ = H / 2
LENS = (0.15, 0.045, 0.054)  # the lens dome's half sizes: across, out from the base, up
BAR = 0.0035
CLEAR = 0.0095  # the cage's bars stand this far off the lens


def lens_y(x, z, extra=0.0):
    """How far out (towards -y) the lens's surface is at (x, z), plus `extra`; the base if outside."""
    a, d, c = LENS
    t = 1 - (x / (a + extra)) ** 2 - ((z - CZ) / (c + extra)) ** 2
    return -BASE - (d + extra) * math.sqrt(max(t, 0.0))


def build():
    body = body_material()
    lib.box("base", (W, BASE, H), (0, -BASE / 2, CZ), body, bevel=0.016, segments=1)

    # The lens: a dome turned round y, stretched oval.
    a, d, c = LENS
    profile = [(-BASE + 0.002, 1.0), (-BASE - d * 0.45, 0.9), (-BASE - d * 0.8, 0.62),
               (-BASE - d * 0.97, 0.3), (-BASE - d, 0.0)]
    lens = lib.lathe("lens", profile, axis="y", mat=lens_material(), sides=14)
    for v in lens.data.vertices:
        v.co.x *= a
        v.co.z = CZ + v.co.z * c

    # The cage: three bars along the dome, over a ring round its foot, and a plate where they meet
    # at each end.
    for dz in (-0.03, 0.0, 0.03):
        z = CZ + dz
        reach = (a + CLEAR) * math.sqrt(1 - (dz / (c + CLEAR)) ** 2)
        xs = [reach * t for t in (-1, -0.85, -0.55, 0, 0.55, 0.85, 1)]
        bar = [(x, lens_y(x, z, CLEAR) if abs(x) < reach * 0.999 else -BASE - 0.002, z)
               for x in xs]
        lib.tube("bar", bar, [BAR] * len(bar), mat=body, sides=4)
    ring = [((a + CLEAR) * math.cos(t), -BASE - 0.004, CZ + (c + CLEAR) * math.sin(t))
            for t in (2 * math.pi * i / 14 for i in range(15))]
    lib.tube("ring", ring, [BAR] * len(ring), mat=body, sides=4)

    # A green charge LED on the base, and two screws.
    led = lib.material("glow-led", (0.02, 0.2, 0.03), roughness=0.3, emission=(0.1, 1.0, 0.15),
                       strength=3)
    lib.box("led", (0.006, 0.003, 0.006), (W / 2 - 0.022, -BASE - 0.001, 0.02), led)
    dark = lib.material("screw", (0.05, 0.05, 0.05), roughness=0.5, metallic=1)
    for x in (-W / 2 + 0.02, W / 2 - 0.02):
        lib.cylinder("screw", 0.004, 0.003, (x, -BASE - 0.0005, CZ), axis="y", mat=dark, sides=6)


def lens_material():
    """Prismatic polycarbonate: ribs across it, gone faintly yellow, dust dulling the top."""
    mat, n = lib.procedural("glow-lens", 256)
    bsdf = n.bsdf
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.9, 0.75, 1)
    bsdf.inputs["Emission Strength"].default_value = 2.5
    x = n.xyz()[0]
    ribs = n.math("ABSOLUTE", n.math("SUBTRACT", n.math("FRACT", n.math("DIVIDE", x, 0.006)), 0.5))
    dust = n.math("MULTIPLY", lib.smoothstep(n, lib.facing_up(n), 0.2, 0.8),
                  n.noise(40, detail=3))
    color = n.mix(n.math("MULTIPLY", ribs, 0.4), (0.62, 0.6, 0.5), (0.75, 0.73, 0.64))
    color = n.mix(dust, color, (0.3, 0.28, 0.24))
    n.out(**{"Base Color": color, "Roughness": n.lerp(dust, 0.2, 0.8),
             "Normal": n.bump(ribs, distance=0.0015)})
    return mat


def body_material():
    """Dark grey powder-coated alloy, salt-pitted, grimy in the cage's corners, dusty on top."""
    mat, n = lib.procedural("body", 512)
    n.out(**lib.weathered(n, (0.06, 0.065, 0.065), rough=0.55, chips=0.5, rust=0.4, dirt=0.8,
                          dust=1.0, edge_wear=0.8, dents=0.3, bump=0.0015, scale=0.4, seed=5))
    return mat
