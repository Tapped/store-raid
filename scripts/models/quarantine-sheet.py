"""
Quarantine sheet: heavy polythene sheeting taped over a doorway 1.4 m wide and 2.2 m high, as
customs sealed Warehouse 7's quarantine: hung from a batten, taped down both sides with yellow and
black hazard tape, slit down the middle where someone went through, the flaps hanging apart at
the foot, a strip of tape across it torn and dangling, and a printed notice taped to one flap.
Not solid: players push through it. Origin on the floor in the middle of the opening, as the
door frame's; the side it faces is the side the notice is on.
"""

import math

import lib
from cargo import sweep

ORIGIN = "model"
TRIS = 3000
AO = 512
AO_DISTANCE = 0.05

OPEN_W, OPEN_H = 1.4, 2.2  # the doorway it covers (door-frame.py)
GAP = 0.22  # how far apart the flaps hang at the floor


def build():
    sheet = sheet_material()
    tape = tape_material()
    batten = lib.material("batten", (0.12, 0.09, 0.05), roughness=0.8)
    paper = notice_material()
    ink = lib.material("ink", (0.01, 0.01, 0.01), roughness=0.6)
    red = lib.material("notice-red", (0.25, 0.012, 0.01), roughness=0.6)

    lib.box("batten", (OPEN_W + 0.06, 0.04, 0.05), (0, -0.03, OPEN_H - 0.025), batten)
    # Two flaps, each from a side to the slit, hanging in soft folds, drawn apart at the foot.
    zs = [0.02 + i * (OPEN_H - 0.06) / 10 for i in range(11)]
    for s in (-1, 1):
        def flap(u, _d, z, s=s):
            parted = (GAP / 2) * (1 - z / OPEN_H) ** 2
            x = s * (OPEN_W / 2 - u * (OPEN_W / 2 - parted))
            fold = 0.025 * math.sin(u * 9 + s) * (0.4 + 0.6 * (1 - z / OPEN_H))
            return (x, -0.06 + fold - 0.03 * u * (1 - z / OPEN_H), z)

        section = [(i / 12, 0) for i in range(13)]
        sweep("flap", section, zs, flap, sheet)
        # Hazard tape down the side, holding it to the wall.
        lib.box("tape-side", (0.06, 0.004, OPEN_H - 0.05),
                (s * (OPEN_W / 2 - 0.025), -0.068, OPEN_H / 2), tape)
    lib.box("tape-top", (OPEN_W + 0.08, 0.004, 0.06), (0, -0.054, OPEN_H - 0.06), tape)
    # A strip across at chest height, cut through at the slit: one end hangs down.
    lib.box("tape-across", (OPEN_W / 2 - 0.03, 0.004, 0.06), (-OPEN_W / 4 - 0.015, -0.09, 1.3),
            tape)
    lib.box("tape-hanging", (0.06, 0.004, 0.62), (0.05, -0.095, 0.98), tape)
    lib.box("tape-across", (0.5, 0.004, 0.06), (OPEN_W / 2 - 0.27, -0.09, 1.3), tape)
    # The notice on the left flap.
    nx, nz = -0.36, 1.62
    lib.box("notice", (0.42, 0.003, 0.3), (nx, -0.1, nz), paper)
    lib.box("notice-band", (0.42, 0.004, 0.07), (nx, -0.102, nz + 0.115), red)
    lib.text("notice-title", "KARANTENE", 0.05, (nx, -0.104, nz + 0.115), mat=paper)
    lib.text("notice-line", "QUARANTINE", 0.04, (nx, -0.104, nz + 0.03), mat=ink)
    lib.text("notice-line", "INGEN ADGANG", 0.032, (nx, -0.104, nz - 0.03), mat=ink)
    lib.text("notice-line", "TOLLETATEN", 0.022, (nx, -0.104, nz - 0.1), mat=ink)


def sheet_material():
    """Milky polythene, creased and grubby where hands pushed through, darker at the foot."""
    mat, n = lib.procedural("sheet", 1024)
    x, _, z = n.xyz()
    crease = n.noise(7, 4, vector=lib._stretched(n, 1, 1, 0.15))
    base = n.mix(crease, (0.42, 0.43, 0.42), (0.55, 0.56, 0.54))
    hands = n.math("MULTIPLY", lib.smoothstep(n, n.math("ABSOLUTE", x), 0.35, 0.05),
                   n.math("MULTIPLY", lib.smoothstep(n, z, 0.7, 1.1), lib.smoothstep(n, z, 1.7, 1.3)))
    foot = n.math("SUBTRACT", 1, n.math("MULTIPLY", z, 3))
    grime = n.math("MAXIMUM", n.math("MULTIPLY", hands, 0.7), foot)
    grime = n.math("MULTIPLY", n.math("MAXIMUM", grime, 0.0), n.noise(4, 3))
    color = n.mix(grime, base, (0.12, 0.11, 0.09))
    n.out(**{"Base Color": color, "Roughness": 0.35,
             "Normal": n.bump(crease, distance=0.004)})
    return mat


def tape_material():
    """Hazard tape: yellow and black diagonal stripes, a little scuffed."""
    mat, n = lib.procedural("tape", 512)
    x, _, z = n.xyz()
    stripes = n.stripes(n.math("ADD", x, z), 0.1, 0.5)
    color = n.mix(stripes, (0.6, 0.42, 0.01), (0.012, 0.012, 0.01))
    n.out(**{"Base Color": color, "Roughness": 0.4})
    return mat


def notice_material():
    """White paper, a little yellowed."""
    return lib.material("paper", (0.62, 0.6, 0.53), roughness=0.85)
