"""
Boiler: a plant-room boiler, a lagged cylinder in dented aluminium cladding on a steel base, a
forced-draught burner on its front with a small pilot window glowing orange (glow-pilot), a flue
up from the top, red flow and return pipes with gate valves, a gauge and an expansion vessel.
"""

import math
import random

import backroom as br
import lib

TRIS = 4000
AO = 1024
AO_DISTANCE = 0.3

R, BODY_H, BASE = 0.42, 1.55, 0.12
CY = 0.05  # the body's middle, front to back
FLUE_R = 0.12


def _bands(n, p):
    """Seams between the cladding's sheets and the straps round them."""
    _, _, z = n.xyz()
    seam = n.stripes(n.math("ADD", z, 0.004), 0.3, 0.03)
    return br.mul(n, seam, 0.6), br.inv(n, br.mul(n, seam, 0.8))


def build():
    rng = random.Random(121)
    clad = br.paint("cladding", (0.26, 0.265, 0.27), wear=0.4, rust=0.3, gloss=0.42, chalky=0.05,
                    primer=(0.2, 0.2, 0.2), detail=_bands)
    base = br.paint("base", (0.03, 0.03, 0.032), wear=1.4, gloss=0.4)
    burner = br.paint("burner", (0.015, 0.06, 0.03), wear=1.1, gloss=0.35)
    pipe = br.paint("pipes", (0.24, 0.014, 0.008), wear=1.3, rust=1.4, gloss=0.4)
    flue = br.galvanised("flue")
    lag = br.plastic("lagging", (0.3, 0.28, 0.24), gloss=0.85)
    brass = lib.material("brass", (0.42, 0.28, 0.09), roughness=0.4, metallic=1.0)
    dial = lib.material("dial", (0.6, 0.6, 0.56), roughness=0.4)
    black = lib.material("black", (0.01, 0.01, 0.01), roughness=0.5)
    pilot = lib.material("glow-pilot", (0.8, 0.3, 0.05), emission=(1.0, 0.42, 0.08), strength=5.0)

    # Base frame and the lagged body with its straps.
    br.part("base", (0.9, 0.9, BASE), (0, CY, BASE / 2), base, 0.1, bevel=0.006)
    body = lib.cylinder("body", R, BODY_H, (0, CY, BASE + BODY_H / 2), mat=clad, sides=24, bevel=0.02)
    br.tag(body, (R, R, BODY_H / 2), 0.3, (0, CY, BASE + BODY_H / 2))
    top = BASE + BODY_H
    cap = lib.lathe("cap", [(0, R), (0.05, R - 0.04), (0.1, FLUE_R + 0.05), (0.11, 0)], (0, CY, top),
                    mat=clad, sides=24)
    br.tag(cap, (R, R, 0.06), 0.6, (0, CY, top + 0.05))
    for z in (BASE + 0.3, BASE + 0.9, BASE + 1.45):
        lib.cylinder("strap", R + 0.004, 0.025, (0, CY, z), mat=flue, sides=24)

    # The flue, up to the ceiling, with a draught diverter collar.
    lib.cylinder("flue", FLUE_R, 2.0 - top - 0.1, (0, CY, (top + 0.1 + 2.0) / 2), mat=flue, sides=16)
    lib.cylinder("collar", FLUE_R + 0.03, 0.12, (0, CY, top + 0.25), mat=flue, sides=16, bevel=0.01)

    # The burner on the front: a housing, a motor on top, the pilot window and a gauge.
    by = CY - R - 0.12
    br.part("burner", (0.34, 0.26, 0.32), (0, by + 0.02, 0.62), burner, 0.4, bevel=0.015)
    motor = lib.cylinder("motor", 0.09, 0.2, (0, 0, 0), axis="y", mat=burner, sides=14, bevel=0.01)
    br.tag(motor, (0.09, 0.1, 0.09), 0.7)
    br.place(motor, (0.0, by + 0.03, 0.86))
    lib.box("motor-fins", (0.15, 0.16, 0.02), (0.0, by + 0.03, 0.95), burner)
    face = by + 0.02 - 0.13
    lib.cylinder("pilot-rim", 0.035, 0.02, (0.08, face - 0.008, 0.66), axis="y", mat=brass, sides=14)
    lib.cylinder("pilot", 0.024, 0.006, (0.08, face - 0.018, 0.66), axis="y", mat=pilot, sides=14)
    lib.box("control-box", (0.12, 0.05, 0.14), (-0.09, face - 0.02, 0.6), black, bevel=0.006)
    lib.cylinder("reset", 0.012, 0.015, (-0.09, face - 0.05, 0.63), axis="y", mat=pilot, sides=8)
    gauge((0.0, CY - R - 0.03, 1.3), dial, brass, black)

    # Flow and return: out of the right side, down to the floor and away behind.
    px = R + 0.08
    flow = [(R - 0.05, CY + 0.15, 1.4), (px, CY + 0.15, 1.4), (px + 0.03, CY + 0.15, 1.37),
            (px + 0.03, CY + 0.15, 0.25), (px + 0.03, CY + 0.18, 0.2), (px + 0.03, 0.55, 0.2)]
    ret = [(R - 0.05, CY - 0.15, 0.4), (px, CY - 0.15, 0.4), (px + 0.03, CY - 0.12, 0.4),
           (px + 0.03, 0.2, 0.4), (px + 0.03, 0.55, 0.42)]
    for name, pts, r in (("flow", flow, 0.032), ("return", ret, 0.032)):
        tube = lib.tube(name, pts, [r] * len(pts), mat=pipe, sides=12)
        br.tag(tube, (0.1, 0.3, 0.6), rng.random(), (px, 0.3, 0.8))
    # The flow pipe lagged on its way up.
    lag_tube = lib.tube("lagging", [(px + 0.03, CY + 0.15, 1.2), (px + 0.03, CY + 0.15, 0.5)],
                        [0.05, 0.05], mat=lag, sides=12)
    br.tag(lag_tube, (0.05, 0.05, 0.35), 0.4, (px + 0.03, CY + 0.15, 0.85))
    valve((px + 0.03, CY + 0.15, 1.3), "z", pipe, brass)
    valve((px + 0.03, 0.4, 0.4), "y", pipe, brass)

    # An expansion vessel on a bracket on the left.
    vx = -R - 0.08
    vessel = lib.lathe("vessel", [(0, 0), (0, 0.06), (0.02, 0.1), (0.3, 0.1), (0.32, 0.06), (0.32, 0)],
                       (vx, CY + 0.1, 1.0), mat=pipe, sides=16)
    br.tag(vessel, (0.1, 0.1, 0.16), 0.8, (vx, CY + 0.1, 1.16))
    lib.box("bracket", (0.12, 0.04, 0.04), (vx + 0.06, CY + 0.1, 1.1), base)
    lib.tube("vessel-pipe", [(vx, CY + 0.1, 1.0), (vx, CY + 0.1, 0.9), (-R + 0.05, CY + 0.1, 0.9)],
             [0.012] * 3, mat=pipe, sides=8)
    br.bounds_report("boiler")


def valve(at, axis, body_mat, brass):
    """A gate valve on a pipe running along `axis`, its handwheel standing out to the front."""
    x, y, z = at
    lib.cylinder("valve-body", 0.05, 0.11, at, axis=axis, mat=brass, sides=10)
    lib.cylinder("bonnet", 0.022, 0.1, (x, y - 0.08, z), axis="y", mat=brass, sides=8)
    ring = [(x + 0.07 * math.cos(a), y - 0.13, z + 0.07 * math.sin(a))
            for a in (2 * math.pi * i / 12 for i in range(13))]
    lib.tube("handwheel", ring, [0.008] * 13, mat=body_mat, sides=6)
    for a in (0, math.pi / 2):
        lib.box("spoke", (0.14 * abs(math.cos(a)) + 0.01, 0.01, 0.14 * abs(math.sin(a)) + 0.01),
                (x, y - 0.13, z), body_mat)


def gauge(at, dial, brass, black):
    """A round pressure gauge on a stem, facing front."""
    x, y, z = at
    lib.tube("gauge-stem", [(x, y + 0.03, z - 0.08), (x, y - 0.02, z - 0.08), (x, y - 0.02, z - 0.05)],
             [0.006] * 3, mat=brass, sides=6)
    lib.cylinder("gauge-case", 0.055, 0.03, (x, y - 0.03, z), axis="y", mat=brass, sides=16)
    lib.cylinder("gauge-face", 0.048, 0.002, (x, y - 0.046, z), axis="y", mat=dial, sides=16)
    needle = lib.box("needle", (0.004, 0.001, 0.04), (0, 0, 0.015), black)
    needle.location = (x, y - 0.048, z)
    needle.rotation_euler = (0, math.radians(-40), 0)
