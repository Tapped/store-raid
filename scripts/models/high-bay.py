"""
High-bay lamp: a spun steel dome under a driver housing on a short stem, a wire guard across its
lens. Hangs from its origin, on the ceiling at the middle of its top. The lens is glow-lens.
"""

import lib

ORIGIN = "model"
TRIS = 400
AO_DISTANCE = 0.08
SIDES = 12
SMOOTH_ANGLE = 50

RIM = 0.225  # the dome's radius at its rim
RIM_Z = -0.362
LENS_Z = -0.35
WIRE = 0.003


def build():
    shell = shell_material()
    lib.cylinder("canopy", 0.05, 0.012, (0, 0, -0.006), mat=shell, sides=6)
    lib.cylinder("stem", 0.014, 0.085, (0, 0, -0.05), mat=shell, sides=6)
    lib.lathe(
        "housing", [(-0.09, 0), (-0.09, 0.076), (-0.096, 0.086), (-0.198, 0.086), (-0.198, 0)],
        mat=shell, sides=SIDES,
    )
    # The dome, out and down to a rolled rim and back up inside: painted out, white within.
    lib.lathe(
        "dome",
        [(-0.195, 0), (-0.2, 0.078), (-0.25, 0.138), (-0.315, 0.199), (RIM_Z, RIM),
         (RIM_Z + 0.006, 0.212), (-0.21, 0)],
        mat=shell, sides=16,
    )
    glow = lib.material(
        "glow-lens", (0.7, 0.68, 0.62), roughness=0.25, emission=(1.0, 0.86, 0.66), strength=3
    )
    lib.lathe("lens", [(LENS_Z, 0), (LENS_Z, 0.204), (LENS_Z + 0.004, 0.204)], mat=glow,
              sides=16)

    # The guard: two wires crossing under the lens, hooked over the rim.
    wire = lib.material("wire", (0.3, 0.3, 0.3), roughness=0.5, metallic=1)
    bottom = -0.4 + WIRE
    arc = [(-RIM, RIM_Z - 0.002), (-0.17, -0.385), (0, bottom), (0.17, -0.385), (RIM, RIM_Z - 0.002)]
    lib.tube("guard", [(u, 0, z) for u, z in arc], [WIRE] * 5, mat=wire, sides=3)
    lib.tube("guard", [(0, u, z) for u, z in arc], [WIRE] * 5, mat=wire, sides=3)


def shell_material():
    """
    Grey-green enamel gone chalky with salt air, a thick felt of dust on top, rust weeping from
    chips at the rim; white enamel inside the dome, yellowed and dimmed by grime.
    """
    mat, n = lib.procedural("shell", 512)
    x, y, _ = n.xyz()
    normal = n.add("ShaderNodeNewGeometry").outputs["Normal"]
    nx, ny, _ = n.xyz(normal)
    outward = n.math("ADD", n.math("MULTIPLY", nx, x), n.math("MULTIPLY", ny, y))
    inside = n.math("LESS_THAN", outward, -0.0005)
    paint = n.mix(inside, (0.035, 0.05, 0.045), (0.42, 0.39, 0.32))
    n.out(**lib.weathered(
        n, paint, rough=0.4, chips=0.7, rust=0.8, dirt=0.8, dust=0.7, edge_wear=0.9, dents=0.6,
        bump=0.003, scale=0.5,
    ))
    return mat
