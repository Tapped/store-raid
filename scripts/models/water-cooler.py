"""
Water cooler: a bottled water dispenser, a yellowed plastic cabinet with hot and cold taps over a
drip tray, a blue bottle upside down on top, half empty, and a cup dispenser on the side.
"""

import random

import backroom as br
import lib

TRIS = 1500
AO = 1024
AO_DISTANCE = 0.15
SMOOTH_ANGLE = 45

CAB_W, CAB_D, CAB_H = 0.27, 0.3, 0.76
BOTTLE_R = 0.135


def bottle_plastic(name="bottle", size=512):
    """Blue polycarbonate: glossy, darker below the water line, scuffed."""
    mat, n = lib.procedural(name, size)
    p = br.seeded(n)
    _, _, z = n.xyz()
    water = n.math("LESS_THAN", z, CAB_H + 0.2)
    c = n.mix(water, (0.08, 0.16, 0.3), (0.02, 0.06, 0.16))
    scuff = br.smooth(n, n.noise(20, 4, vector=p), 0.62, 0.72)
    c = n.mix(br.mul(n, scuff, 0.5), c, (0.18, 0.25, 0.35))
    n.out(**{"Base Color": c, "Roughness": n.lerp(scuff, 0.08, 0.35),
             "Normal": br.bump(n, n.noise(6, 2, vector=p), 0.002)})
    return mat


def build():
    rng = random.Random(161)
    shell = br.plastic("cabinet", (0.42, 0.4, 0.34), gloss=0.4)
    grey = br.plastic("grey", (0.06, 0.06, 0.065), gloss=0.45)
    red = lib.material("tap-red", (0.35, 0.02, 0.015), roughness=0.35)
    blue = lib.material("tap-blue", (0.02, 0.05, 0.3), roughness=0.35)
    bottle = bottle_plastic()
    cups = br.plastic("cups", (0.5, 0.5, 0.48), gloss=0.5)

    x0 = -0.035  # the cabinet sits left of middle; the cup tube on its right
    br.part("cabinet", (CAB_W, CAB_D, CAB_H), (x0, 0, CAB_H / 2), shell, 0.2, bevel=0.012)
    front = -CAB_D / 2
    # A recess for the taps, the taps and the drip tray.
    lib.box("recess", (0.2, 0.01, 0.2), (x0, front + 0.004, 0.52), grey)
    for dx, mat in ((-0.05, red), (0.05, blue)):
        lib.box("tap", (0.035, 0.05, 0.04), (x0 + dx, front - 0.022, 0.6), mat, bevel=0.008)
        lib.cylinder("spout", 0.008, 0.03, (x0 + dx, front - 0.035, 0.57), mat=grey, sides=8)
    br.part("drip-tray", (0.18, 0.06, 0.02), (x0, front - 0.02, 0.43), grey, 0.4, bevel=0.004)
    lib.box("grille", (0.2, 0.006, 0.1), (x0, CAB_D / 2 + 0.002, 0.25), grey)
    # The collar and the bottle, neck down.
    lib.cylinder("collar", 0.07, 0.03, (x0, 0, CAB_H + 0.015), mat=grey, sides=16)
    prof = [(0.0, 0.03), (0.04, 0.03), (0.06, 0.09), (0.09, BOTTLE_R), (0.14, BOTTLE_R - 0.004),
            (0.17, BOTTLE_R), (0.24, BOTTLE_R - 0.004), (0.27, BOTTLE_R), (0.31, BOTTLE_R - 0.01),
            (0.33, 0.08), (0.335, 0.0)]
    b = lib.lathe("bottle", prof, (x0, 0, CAB_H + 0.01), mat=bottle, sides=20)
    br.tag(b, (BOTTLE_R, BOTTLE_R, 0.17), 0.5, (x0, 0, CAB_H + 0.18))
    # The cup dispenser: a tube down the right side.
    cx = x0 + CAB_W / 2 + 0.036
    lib.cylinder("cup-tube", 0.032, 0.32, (cx, -0.02, 0.62), mat=cups, sides=12)
    lib.cylinder("cup-mouth", 0.036, 0.02, (cx, -0.02, 0.45), mat=grey, sides=12)
    lib.box("cup-bracket", (0.04, 0.02, 0.05), (cx - 0.03, -0.02, 0.7), grey)
    br.bounds_report("water-cooler")
