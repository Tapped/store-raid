"""
Exit sign: a lit box on a wall plate, its green face showing a white figure running for a door,
an arrow before it. The face's material is glow-sign and the pictogram's glow-sign-figure.
Origin on the wall, at the middle of the sign's bottom; its back is flat on the wall.
"""

import math

import lib

ORIGIN = "model"
TRIS = 500
AO_DISTANCE = 0.03

W, H, D = 0.4, 0.2, 0.06
PLATE = 0.012  # the wall plate's thickness; the box stands on it
FACE = (0.35, 0.15)  # the lit face, inside the box's rim
FACE_Y = -D + 0.004  # the face sits a little back in the rim

# The pictogram, in meters on the face from its middle: the runner's joints, the door and arrow.
HEAD = ((0.022, 0.044), 0.012)
LIMBS = [  # (points, stroke width)
    ([(0.01, 0.03), (-0.008, -0.008)], 0.02),  # torso
    ([(0.008, 0.024), (0.03, 0.008), (0.048, 0.018)], 0.01),  # front arm
    ([(0.006, 0.024), (-0.014, 0.01), (-0.034, 0.0)], 0.01),  # back arm
    ([(-0.004, -0.01), (0.022, -0.028), (0.016, -0.058)], 0.013),  # front leg
    ([(-0.01, -0.01), (-0.026, -0.036), (-0.052, -0.04)], 0.013),  # back leg
]
DOOR = (0.075, 0.13, -0.06, 0.06)  # left, right, bottom, top
ARROW = [(-0.155, -0.012), (-0.105, -0.012), (-0.105, -0.034), (-0.068, 0), (-0.105, 0.034),
         (-0.105, 0.012), (-0.155, 0.012)]


def stroke(a, b, width):
    """A bar from a to b, `width` across, run on half its width past each end so joints close."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    px, py = -uy * width / 2, ux * width / 2
    ex, ey = ux * width / 2, uy * width / 2
    a = (a[0] - ex, a[1] - ey)
    b = (b[0] + ex, b[1] + ey)
    return [(a[0] + px, a[1] + py), (a[0] - px, a[1] - py), (b[0] - px, b[1] - py),
            (b[0] + px, b[1] + py)]


def build():
    housing = housing_material()
    lib.box("plate", (W - 0.06, PLATE, H - 0.05), (0, -PLATE / 2, H / 2), housing, bevel=0.003,
            segments=1)
    depth = FACE_Y + PLATE  # negative: the box from the plate out to the face
    lib.box("box", (W, -depth, H), (0, -PLATE + depth / 2, H / 2), housing, bevel=0.008,
            segments=1)
    # The rim round the face, standing out past it.
    rim_x, rim_z = (W - FACE[0]) / 2, (H - FACE[1]) / 2
    rim_d = FACE_Y + D
    for x in (-1, 1):
        lib.box("rim", (rim_x, rim_d, H), (x * (W - rim_x) / 2, -D + rim_d / 2, H / 2), housing,
                bevel=0.003, segments=1)
    for z in (rim_z / 2, H - rim_z / 2):
        lib.box("rim", (FACE[0], rim_d, rim_z), (0, -D + rim_d / 2, z), housing)

    green = lib.material("glow-sign", (0.004, 0.1, 0.025), roughness=0.3,
                         emission=(0.0, 0.45, 0.1), strength=2.0)
    lib.box("face", (FACE[0], 0.002, FACE[1]), (0, FACE_Y - 0.001, H / 2), green)
    white = lib.material("glow-sign-figure", (0.8, 0.85, 0.8), roughness=0.3,
                         emission=(0.85, 1.0, 0.9), strength=1.6)
    lift = [FACE_Y - 0.0023]

    def draw(points, name="figure"):
        # Each a hair proud of the last, so where they overlap none shades the other in the AO.
        lift[0] -= 0.00012
        lib.shape(name, points, (0, lift[0], H / 2), depth=0.0006, mat=white)

    (hx, hy), r = HEAD
    draw([(hx + r * math.cos(a), hy + r * math.sin(a)) for a in
          (2 * math.pi * i / 10 for i in range(10))], "head")
    for points, width in LIMBS:
        for a, b in zip(points, points[1:]):
            draw(stroke(a, b, width))
    left, right, bottom, top = DOOR
    t = 0.008
    draw(stroke((left, bottom + t / 2), (left, top - t / 2), t), "door")
    draw(stroke((right, bottom + t / 2), (right, top - t / 2), t), "door")
    draw(stroke((left + t / 2, top), (right - t / 2, top), t), "door")
    draw(stroke((left + t / 2, bottom), (right - t / 2, bottom), t), "door")
    draw(ARROW, "arrow")

    # Two screws through the box's front corners, and a test button.
    dark = lib.material("screw", (0.05, 0.05, 0.05), roughness=0.5, metallic=1)
    for x in (-W / 2 + 0.012, W / 2 - 0.012):
        lib.cylinder("screw", 0.004, 0.002, (x, -D + 0.0005, H - 0.012), axis="y", mat=dark,
                     sides=6)
    red = lib.material("button", (0.25, 0.01, 0.005), roughness=0.4)
    lib.cylinder("test", 0.005, 0.003, (W / 2 - 0.02, -D + 0.0005, 0.012), axis="y", mat=red,
                 sides=8)


def housing_material():
    """Cream polycarbonate, yellowed and grimy, the top furred with dust, the rim knocked."""
    mat, n = lib.procedural("housing", 512)
    n.out(**lib.weathered(
        n, (0.36, 0.33, 0.25), rough=0.45, chips=0.15, rust=0.0, dirt=0.8, dust=1.0,
        edge_wear=0.3, dents=0.3, bare=(0.45, 0.43, 0.38), primer=(0.3, 0.28, 0.22), bump=0.0015,
        scale=1.0,
    ))
    return mat
