"""
Workbench: a steel-framed bench with a scarred hardwood top, a blue engineer's vice on the front
corner, a pegboard of spanners, hammers, screwdrivers and a saw, and clutter on top and below.
"""

import math
import random

import backroom as br
import lib
from mathutils import Vector

TRIS = 3500
AO = 1024
AO_DISTANCE = 0.25

W, D, H = 1.8, 0.75, 1.5
TOP = 0.9  # height of the work surface
FRONT, BACK = -D / 2, D / 2


def build():
    rng = random.Random(41)
    frame = br.paint("frame", (0.02, 0.045, 0.032), wear=1.3, gloss=0.4)
    top = br.butcher_block()
    board = br.pegboard()
    vice_paint = br.paint("vice", (0.015, 0.05, 0.17), wear=1.8, gloss=0.35, primer=br.OXIDE)
    chrome = lib.material("chrome", (0.3, 0.3, 0.31), roughness=0.42, metallic=1.0)
    dark = lib.material("blacked", (0.02, 0.02, 0.022), roughness=0.5, metallic=0.6)
    red = lib.material("handle-red", (0.25, 0.012, 0.008), roughness=0.4)
    yellow = lib.material("handle-yellow", (0.45, 0.25, 0.005), roughness=0.4)
    wood_handle = lib.material("handle-wood", (0.25, 0.13, 0.05), roughness=0.6)
    tins = br.tin_label()
    card = br.cardboard(size=512)
    toolbox = br.paint("toolbox", (0.3, 0.018, 0.008), wear=1.6, gloss=0.35)
    cloth = br.rubber("rag", (0.22, 0.17, 0.12))

    # The frame: square-tube legs, the back two running up to carry the board.
    t = 0.05
    x_leg, y_leg = W / 2 - t / 2 - 0.02, (FRONT + 0.04 + t / 2, BACK - t / 2)
    for sx in (-1, 1):
        x = sx * x_leg
        br.part("leg", (t, t, TOP - 0.05), (x, y_leg[0], (TOP - 0.05) / 2), frame, rng.random(),
                bevel=0.003)
        br.part("post", (t, t, H), (x, y_leg[1], H / 2), frame, rng.random(), bevel=0.003)
        br.part("rail", (0.04, y_leg[1] - y_leg[0], 0.04), (x, (y_leg[0] + y_leg[1]) / 2, 0.15),
                frame, rng.random())
        br.part("rail", (0.04, y_leg[1] - y_leg[0], 0.06), (x, (y_leg[0] + y_leg[1]) / 2, TOP - 0.08),
                frame, rng.random())
        br.part("foot", (0.08, 0.08, 0.008), (x, y_leg[0], 0.004), frame)
        br.part("foot", (0.08, 0.08, 0.008), (x, y_leg[1], 0.004), frame)
    span = 2 * x_leg - t
    br.part("rail", (span, 0.04, 0.08), (0, y_leg[0] - 0.005, TOP - 0.09), frame, rng.random())
    br.part("rail", (span, 0.04, 0.04), (0, y_leg[1], 0.15), frame, rng.random())
    br.part("shelf", (span, y_leg[1] - y_leg[0] - t, 0.02), (0, (y_leg[0] + y_leg[1]) / 2, 0.18),
            frame, rng.random())

    # The top, overhanging the frame at the front, and the board behind it.
    depth = BACK - t - FRONT - 0.03
    br.part("top", (W, depth, 0.05), (0, FRONT + 0.03 + depth / 2, TOP - 0.025), top, 0.3,
            bevel=0.004)
    board_y = BACK - t - 0.009 + 0.004
    br.part("board", (2 * x_leg - t, 0.018, H - TOP - 0.06), (0, board_y, (TOP + H - 0.06) / 2 + 0.01),
            board, 0.5)
    br.part("cap", (W - 0.04, 0.12, 0.025), (0, BACK - 0.06, H - 0.0125), frame, rng.random())
    face = board_y - 0.009

    vice((-0.62, FRONT + 0.07, TOP), vice_paint, dark, chrome, rng)

    # Tools on the board, each on its peg.
    def peg(x, z):
        lib.cylinder("peg", 0.003, 0.03, (x, face - 0.015, z), axis="y", mat=chrome, sides=6)

    for i, (x, length) in enumerate(((-0.72, 0.17), (-0.66, 0.2), (-0.59, 0.23), (-0.51, 0.26))):
        zt = 1.4
        peg(x, zt + 0.004)
        spanner((x, face - 0.012, zt), length, chrome)
    for i, x in enumerate((-0.3, -0.25, -0.2, -0.15, -0.1)):
        peg(x, 1.37)
        handle = (red, yellow)[i % 2]
        zt = 1.36
        lib.cylinder("screwdriver", 0.013, 0.1, (x, face - 0.022, zt - 0.05), mat=handle, sides=8)
        lib.cylinder("shaft", 0.003, 0.08 + 0.02 * (i % 3), (x, face - 0.022, zt - 0.14 - 0.01 * (i % 3)),
                     mat=chrome, sides=6)
    peg(0.08, 1.4)
    lib.cylinder("hammer", 0.013, 0.3, (0.08, face - 0.025, 1.25), mat=wood_handle, sides=8)
    lib.box("hammer-head", (0.11, 0.028, 0.03), (0.08, face - 0.025, 1.41), dark, bevel=0.003)
    peg(0.22, 1.42)
    lib.cylinder("mallet", 0.012, 0.26, (0.22, face - 0.025, 1.28), mat=wood_handle, sides=8)
    lib.cylinder("mallet-head", 0.03, 0.1, (0.22, face - 0.03, 1.425), axis="x", mat=red, sides=10)
    # A hand saw hanging by its handle.
    peg(0.5, 1.42)
    lib.shape("saw", [(-0.03, 0.06), (0.32, 0.03), (0.32, -0.02), (-0.03, -0.05)], (0.38, face - 0.004, 1.2),
              depth=0.002, mat=chrome, facing="-y")
    lib.box("saw-handle", (0.11, 0.022, 0.1), (0.5, face - 0.012, 1.38), wood_handle, bevel=0.01)
    peg(0.74, 1.38)
    lib.box("square", (0.02, 0.004, 0.25), (0.7, face - 0.004, 1.25), chrome)
    lib.box("square", (0.15, 0.004, 0.02), (0.765, face - 0.004, 1.135), chrome)

    # Clutter on the top.
    oil_can((0.28, 0.0, TOP), chrome, rng)
    br.tin((0.55, 0.12, TOP), tins, 0.37, 0.07, 0.11)
    br.tin((0.72, 0.15, TOP), tins, 0.81, 0.085, 0.19)
    spanner((0.0, -0.12, TOP + 0.003), 0.22, chrome, flat=True, turn=0.5)
    rag((0.05, 0.08, TOP), cloth)
    br.part("box", (0.3, 0.22, 0.14), (-0.25, 0.14, TOP + 0.07), card, 0.41, rot=(0, 0, 0.08),
            bevel=0.003)

    # Below: a toolbox and a carton on the shelf.
    z = 0.19
    br.part("toolbox", (0.5, 0.22, 0.2), (-0.45, -0.02, z + 0.1), toolbox, 0.2, rot=(0, 0, 0.04),
            bevel=0.006)
    lib.cylinder("toolbox-handle", 0.012, 0.3, (-0.45, -0.02, z + 0.225), axis="x", mat=dark, sides=6)
    br.part("box", (0.45, 0.4, 0.3), (0.4, 0.02, z + 0.15), card, 0.74, rot=(0, 0, -0.06),
            bevel=0.004)
    br.bounds_report("workbench")


def vice(at, paint, dark, chrome, rng):
    """An engineer's vice bolted on at `at` (front edge of the bench, on the top), jaws open."""
    x, y, z = at
    br.part("vice-base", (0.16, 0.2, 0.025), (x, y + 0.11, z + 0.0125), paint, rng.random(), bevel=0.004)
    br.part("vice-body", (0.1, 0.2, 0.08), (x, y + 0.11, z + 0.065), paint, rng.random(), bevel=0.008)
    br.part("vice-jaw", (0.17, 0.05, 0.1), (x, y + 0.025, z + 0.1), paint, rng.random(), bevel=0.008)
    br.part("vice-jaw", (0.17, 0.045, 0.1), (x, y - 0.025 - 0.0225 + 0.02, z + 0.1), paint,
            rng.random(), bevel=0.008)
    lib.box("jaw-plate", (0.15, 0.006, 0.045), (x, y - 0.0005, z + 0.125), dark)
    lib.box("jaw-plate", (0.15, 0.006, 0.045), (x, y - 0.0145, z + 0.125), dark)
    lib.box("slide", (0.06, 0.18, 0.04), (x, y + 0.06, z + 0.045), dark)
    lib.cylinder("screw", 0.011, 0.04, (x, y - 0.045, z + 0.08), axis="y", mat=chrome, sides=8)
    lib.cylinder("tommy-bar", 0.007, 0.24, (x + 0.03, y - 0.062, z + 0.08), axis="x", mat=chrome, sides=6)
    for ex in (-0.09, 0.15):
        lib.cylinder("knob", 0.012, 0.015, (x + ex, y - 0.062, z + 0.08), axis="x", mat=chrome, sides=8)


def spanner(at, length, mat, flat=False, turn=0.0):
    """An open-ended spanner hanging from its top ring at `at`, or lying flat on a surface."""
    x, y, z = at
    w = 0.012 + length * 0.04
    r = w * 1.15
    objs = [
        lib.box("spanner", (w, 0.004, length - 2 * r), (0, 0, -length / 2), mat),
        lib.cylinder("spanner-ring", r, 0.005, (0, 0, -r), axis="y", mat=mat, sides=10),
        lib.cylinder("spanner-head", r * 1.1, 0.005, (0, 0, -length + r), axis="y", mat=mat, sides=10),
    ]
    for o in objs:
        if flat:
            o.rotation_euler = (math.pi / 2, 0, turn)
            o.location = (x - math.sin(turn) * length / 2, y + math.cos(turn) * length / 2, z)
        else:
            o.location = (x, y, z)
    return objs


def oil_can(at, mat, rng):
    """A pump oil can: a squat body, a domed top and a long thin spout."""
    x, y, z = at
    prof = [(0, 0.0), (0, 0.055), (0.004, 0.06), (0.05, 0.06), (0.07, 0.04), (0.085, 0.012), (0.09, 0.01),
            (0.09, 0)]
    can = lib.lathe("oil-can", prof, (x, y, z), mat=mat, sides=12)
    lib.tube("spout", [(x, y, z + 0.09), (x + 0.03, y - 0.01, z + 0.14), (x + 0.1, y - 0.03, z + 0.2)],
             [0.007, 0.005, 0.003], mat=mat, sides=6)
    return can


def rag(at, mat):
    """A crumpled shop rag."""
    def crumple(q):
        k = 1 + 0.25 * math.sin(q.x * 9 + q.y * 5) + 0.2 * math.sin(q.y * 11 - q.x * 3)
        return Vector((q.x * 0.11 * k, q.y * 0.08 * k, max(q.z, -0.2) * 0.025 * k))

    obj = lib.ellipsoid("rag", (0.11, 0.08, 0.025), (0, 0, 0), mat, segments=10, rings=6,
                        deform=crumple)
    br.tag(obj, (0.12, 0.09, 0.03), 0.6)
    return br.place(obj, (at[0], at[1], at[2] + 0.004), (0, 0, 0.7))
