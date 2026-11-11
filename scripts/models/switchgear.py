"""
Switchgear: a row of three grey steel cabinets on a plinth, louvred, with rotary isolators,
analogue meters, rows of breakers behind a window, warning labels, and indicator lamps that glow
red, green and amber (glow-lamps-red, glow-lamps-green, glow-lamps-amber).
"""

import random

import backroom as br
import lib

TRIS = 3500
AO = 1024
AO_DISTANCE = 0.2

W, H, D = 1.6, 2.0, 0.5
PLINTH = 0.1
CAB = W / 3
FRONT = -D / 2 + 0.075  # door faces; handles and isolators stand proud of them


def _louvres(n, p):
    """Vent louvres low and high on each door."""
    L = br.attr(n, "local").outputs["Vector"]
    H_ = br.attr(n, "half").outputs["Vector"]
    lx, _, lz = br.split(n, L)
    hx, _, hz = br.split(n, H_)
    door = n.math("GREATER_THAN", hz, 0.8)
    geo = n.add("ShaderNodeNewGeometry")
    face = br.smooth(n, n.math("ABSOLUTE", br.split(n, geo.outputs["Normal"])[1]), 0.8, 0.9)
    across = n.math("LESS_THAN", n.math("ABSOLUTE", lx), n.math("MULTIPLY", hx, 0.6))
    band = n.math("MAXIMUM",
                  br.inside_band(n, lz, n.math("SUBTRACT", hz, 0.12), 0.06),
                  br.inside_band(n, lz, n.math("SUBTRACT", 0.14, hz), 0.06))
    hole = br.mul(n, door, face, across, band, n.stripes(lz, 0.016, 0.45))
    return br.mul(n, hole, 0.9), br.inv(n, hole)


def warning(name="warning", size=256):
    """A yellow warning label with a black border and a black lightning triangle."""
    mat, n = lib.procedural(name, size)
    L = br.attr(n, "local").outputs["Vector"]
    H_ = br.attr(n, "half").outputs["Vector"]
    lx, _, lz = br.split(n, L)
    hx, _, hz = br.split(n, H_)
    u = n.math("DIVIDE", lx, hx)
    v = n.math("DIVIDE", lz, hz)
    border = n.math("GREATER_THAN", n.math("MAXIMUM", n.math("ABSOLUTE", u), n.math("ABSOLUTE", v)), 0.86)
    # A triangle in the upper part: |u| < (0.9 - v) * 0.6, between v = -0.1 and 0.85.
    tri = br.mul(n, n.math("GREATER_THAN", v, 0.0), n.math("LESS_THAN", v, 0.8),
                 n.math("LESS_THAN", n.math("ABSOLUTE", u), n.math("MULTIPLY", n.math("SUBTRACT", 0.8, v), 0.55)))
    inner = br.mul(n, n.math("GREATER_THAN", v, 0.12), n.math("LESS_THAN", v, 0.62),
                   n.math("LESS_THAN", n.math("ABSOLUTE", u), n.math("MULTIPLY", n.math("SUBTRACT", 0.62, v), 0.42)))
    ring = br.mul(n, tri, br.inv(n, inner))
    text = br.mul(n, n.math("LESS_THAN", v, -0.25), n.math("GREATER_THAN", v, -0.7),
                  n.math("LESS_THAN", n.math("ABSOLUTE", u), 0.7), n.stripes(v, 0.25, 0.55),
                  n.math("GREATER_THAN", n.noise(1.0, 0, vector=n.vec(n.math("MULTIPLY", u, 8), v)), 0.4))
    c = n.mix(n.math("MAXIMUM", n.math("MAXIMUM", border, ring), text), (0.5, 0.33, 0.005), (0.015, 0.015, 0.015))
    p = br.seeded(n)
    c = n.mix(br.mul(n, br.smooth(n, n.noise(6, 3, vector=p), 0.55, 0.8), 0.6), c, (0.15, 0.12, 0.06))
    n.out(**{"Base Color": c, "Roughness": 0.5})
    return mat


def build():
    rng = random.Random(131)
    steel = br.paint("cabinets", (0.11, 0.115, 0.11), wear=0.9, gloss=0.4, detail=_louvres, salt=0.5)
    plinth = br.paint("plinth", (0.02, 0.02, 0.022), wear=1.4, gloss=0.4)
    black = lib.material("black", (0.012, 0.012, 0.013), roughness=0.45)
    red = lib.material("isolator-red", (0.3, 0.015, 0.01), roughness=0.4)
    yellow = lib.material("isolator-yellow", (0.5, 0.32, 0.005), roughness=0.45)
    chrome = lib.material("chrome", (0.5, 0.5, 0.5), roughness=0.3, metallic=1.0)
    glass = lib.material("meter-glass", (0.55, 0.55, 0.52), roughness=0.25)
    breakers = br.plastic("breakers", (0.35, 0.34, 0.31), gloss=0.5)
    labels = warning()
    lamps = {
        "red": lib.material("glow-lamps-red", (0.5, 0.03, 0.02), emission=(1.0, 0.06, 0.03), strength=4.0),
        "green": lib.material("glow-lamps-green", (0.03, 0.4, 0.06), emission=(0.08, 1.0, 0.15), strength=4.0),
        "amber": lib.material("glow-lamps-amber", (0.5, 0.25, 0.01), emission=(1.0, 0.5, 0.05), strength=4.0),
    }

    br.part("plinth", (W, D - 0.04, PLINTH), (0, 0.02, PLINTH / 2), plinth, 0.1, bevel=0.004)
    body_d = D / 2 - FRONT
    for i in range(3):
        xc = -W / 2 + CAB * (i + 0.5)
        br.part("cabinet", (CAB - 0.004, body_d, H - PLINTH), (xc, (FRONT + D / 2) / 2, (H + PLINTH) / 2),
                steel, rng.random(), bevel=0.006)
        dw, dh = CAB - 0.04, H - PLINTH - 0.04
        br.part("door", (dw, 0.015, dh), (xc, FRONT - 0.0075, PLINTH + 0.02 + dh / 2), steel, rng.random(),
                bevel=0.004)
        face = FRONT - 0.015
        # A handle and lock on the right of each door.
        lib.box("handle", (0.03, 0.03, 0.14), (xc + dw / 2 - 0.05, face - 0.015, 1.15), black, bevel=0.006)
        lib.cylinder("lock", 0.012, 0.012, (xc + dw / 2 - 0.05, face - 0.006, 1.28), axis="y", mat=chrome,
                     sides=8)
        br.part("warning", (0.12, 0.002, 0.1), (xc, face - 0.001, 1.72), labels, rng.random())
        if i == 0:
            # The incomer: a big rotary isolator and three meters.
            lib.box("isolator-plate", (0.16, 0.012, 0.16), (xc, face - 0.006, 1.2), yellow, bevel=0.004)
            lib.cylinder("isolator-hub", 0.04, 0.03, (xc, face - 0.025, 1.2), axis="y", mat=red, sides=12)
            br.place(lib.box("isolator-handle", (0.03, 0.03, 0.16), (0, 0, 0), red, bevel=0.008),
                     (xc, face - 0.045, 1.2), (0, 0.6, 0))
            for k in range(3):
                mx = xc - 0.14 + k * 0.14
                lib.box("meter", (0.1, 0.03, 0.1), (mx, face - 0.015, 1.5), black, bevel=0.004)
                lib.box("meter-face", (0.085, 0.002, 0.07), (mx, face - 0.031, 1.505), glass)
                br.place(lib.box("meter-needle", (0.002, 0.001, 0.05), (0, 0, 0.02), black),
                         (mx, face - 0.033, 1.48), (0, rng.uniform(-0.6, 0.6), 0))
        else:
            # Outgoing ways: rows of breakers behind a window.
            lib.box("window-frame", (0.38, 0.014, 0.5), (xc, face - 0.007, 1.3), black, bevel=0.004)
            lib.box("window-back", (0.35, 0.004, 0.47), (xc, face - 0.012, 1.3), black)
            for r in range(3):
                for k in range(8):
                    lib.box("breaker", (0.034, 0.02, 0.07), (xc - 0.14 + k * 0.04, face - 0.02, 1.15 + r * 0.15),
                            breakers)
                    up = rng.random() > 0.12
                    lib.box("toggle", (0.012, 0.012, 0.02), (xc - 0.14 + k * 0.04, face - 0.033,
                                                            1.15 + r * 0.15 + (0.012 if up else -0.012)), black)
        # Indicator lamps along the top of each door.
        for k, colour in enumerate(("green", "red", "amber") if i != 1 else ("green", "green", "amber")):
            lx = xc - 0.08 + k * 0.08
            lib.cylinder("lamp-bezel", 0.018, 0.02, (lx, face - 0.01, 1.85), axis="y", mat=chrome, sides=10)
            lib.cylinder("lamp", 0.013, 0.01, (lx, face - 0.022, 1.85), axis="y", mat=lamps[colour], sides=10)
    br.bounds_report("switchgear")
