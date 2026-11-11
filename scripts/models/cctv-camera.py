"""
CCTV camera: a bullet camera under a sunshield, on a bracket arm from a ceiling plate, looking
forward (-y) and down. A small red status LED glows (glow-led). Hangs from its origin.
"""

import math

import bpy
from mathutils import Matrix, Vector

import lib

ORIGIN = "model"
TRIS = 500
SMOOTH_ANGLE = 50
AO_DISTANCE = 0.03

PLATE = 0.075  # the ceiling plate's radius: the camera's widest part
PIVOT = Vector((0, 0.06, -0.098))  # where the housing tilts on the arm
TILT = math.radians(18)
R = 0.044  # the housing's radius
BACK, FRONT = 0.09, -0.19  # the housing's ends along y, before it tilts, from the pivot's y


def tilt(obj):
    """Turn obj's mesh down about the pivot, nose first."""
    m = (Matrix.Translation(PIVOT) @ Matrix.Rotation(-TILT, 4, "X")
         @ Matrix.Translation(-PIVOT))
    obj.data.transform(m)
    return obj


def build():
    shell = shell_material()
    lib.cylinder("plate", PLATE, 0.012, (0, PIVOT.y, -0.006), mat=shell, sides=12)
    lib.cylinder("arm", 0.014, 0.08, (0, PIVOT.y, -0.052), mat=shell, sides=8)
    lib.cylinder("knuckle", 0.02, 0.036, (0, PIVOT.y, PIVOT.z + 0.012), axis="x", mat=shell,
                 sides=8)

    cz = PIVOT.z - R + 0.006
    y0 = PIVOT.y
    tilt(lib.lathe(
        "housing",
        [(y0 + BACK, 0.0), (y0 + BACK, R - 0.012), (y0 + BACK - 0.008, R), (y0 + FRONT + 0.02, R),
         (y0 + FRONT, R - 0.004), (y0 + FRONT, R - 0.012), (y0 + FRONT + 0.004, R - 0.016),
         (y0 + FRONT + 0.004, 0.0)],
        at=(0, 0, cz), axis="y", mat=shell, sides=16,
    ))
    glass = lib.material("lens", (0.005, 0.005, 0.006), roughness=0.05)
    tilt(lib.cylinder("lens", R - 0.016, 0.003, (0, y0 + FRONT + 0.004, cz), axis="y", mat=glass,
                      sides=12))
    led = lib.material("glow-led", (0.2, 0.01, 0.005), emission=(1, 0.05, 0.02), strength=4)
    tilt(lib.box("led", (0.004, 0.003, 0.004), (0.018, y0 + FRONT + 0.0015, cz - 0.016), led))
    # The sunshield, a hood over the housing reaching past its nose.
    shield = lib.box("shield", (2 * R + 0.014, BACK - FRONT + 0.02, 0.004),
                     (0, y0 + (BACK + FRONT) / 2 - 0.02, cz + R + 0.004), shell, bevel=0.0015,
                     segments=1)
    for v in shield.data.vertices:  # curled down at the sides
        v.co.z -= (abs(v.co.x) / (R + 0.007)) ** 4 * 0.022
    tilt(shield)
    tilt(lib.tube("cable", [(0, y0 + BACK - 0.004, cz), (0, y0 + BACK + 0.01, cz - 0.004),
                            (0, y0 + BACK + 0.012, cz - 0.02)], [0.005] * 3,
                  mat=lib.material("cable", (0.015, 0.015, 0.015), roughness=0.6), sides=5))
    centre_on_y()


def centre_on_y():
    """Slide everything along y so the camera's footprint is centred on its origin."""
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    ys = [(o.matrix_world @ Vector(c)).y for o in objs for c in o.bound_box]
    mid = (min(ys) + max(ys)) / 2
    for o in objs:
        o.data.transform(Matrix.Translation((0, -mid, 0)))
        o.data.update()


def shell_material():
    """Off-white ABS gone yellow, grimy in creases, a fur of dust on top, sea air pitting it."""
    mat, n = lib.procedural("shell", 512)
    n.out(**lib.weathered(n, (0.4, 0.38, 0.32), rough=0.4, chips=0.15, rust=0.0, dirt=0.9,
                          dust=1.0, edge_wear=0.3, dents=0.2, bare=(0.45, 0.43, 0.38),
                          primer=(0.32, 0.3, 0.25), bump=0.001, scale=1.0, seed=9))
    return mat
