"""
Vending machine: a dark snack machine, its window glazed over rows of crisps and bars backlit by
a glowing panel (glow-window), a payment panel with a lit display and card reader (glow-panel),
a push flap below and sides branded DOCKSIDE SNAX.
"""

import random

import backroom as br
import lib

TRIS = 3500
AO = 1024
AO_DISTANCE = 0.25

W, H, D = 0.95, 1.85, 0.85
FRONT, BACK = -D / 2, D / 2
WIN = (-0.435, 0.175, 0.56, 1.72)  # the window: x from, x to, z from, z to
CAVITY = -0.06  # how far back the window's inside goes
ROWS = 6


def _brand(n, base):
    """The sides: a sweep of red and a band of yellow on the dark paint."""
    _, y, z = n.xyz()
    geo = n.add("ShaderNodeNewGeometry")
    side = br.smooth(n, n.math("ABSOLUTE", br.split(n, geo.outputs["Normal"])[0]), 0.8, 0.9)
    sweep = n.math("ADD", z, n.math("MULTIPLY", y, 0.6))
    red = br.mul(n, side, br.inside_band(n, sweep, 1.0, 0.32))
    yellow = br.mul(n, side, br.inside_band(n, sweep, 1.4, 0.04))
    c = n.mix(red, base, (0.3, 0.012, 0.008))
    return n.mix(yellow, c, (0.5, 0.3, 0.004))


def snacks(name="snacks", size=512):
    """Crisp packets and bars: bright foil in a colour picked by seed, a printed band, crinkled."""
    mat, n = lib.procedural(name, size)
    L = br.attr(n, "local").outputs["Vector"]
    H_ = br.attr(n, "half").outputs["Vector"]
    s = br.attr(n, "seed").outputs["Fac"]
    lx, _, lz = br.split(n, L)
    v = n.math("DIVIDE", lz, br.split(n, H_)[2])
    p = br.seeded(n)
    hue = n.math("FRACT", n.math("MULTIPLY", s, 5.3))
    c = n.mix(br.smooth(n, hue, 0.2, 0.21), (0.35, 0.02, 0.01), (0.45, 0.3, 0.01))
    c = n.mix(br.smooth(n, hue, 0.4, 0.41), c, (0.02, 0.15, 0.03))
    c = n.mix(br.smooth(n, hue, 0.6, 0.61), c, (0.02, 0.05, 0.25))
    c = n.mix(br.smooth(n, hue, 0.8, 0.81), c, (0.3, 0.1, 0.01))
    band = br.inside_band(n, v, 0.15, 0.22)
    c = n.mix(band, c, (0.6, 0.58, 0.5))
    logo = br.mul(n, band, n.math("GREATER_THAN", n.noise(1.0, 0, vector=n.vec(
        n.math("MULTIPLY", lx, 70), n.math("MULTIPLY", v, 4), s)), 0.5))
    c = n.mix(logo, c, (0.03, 0.02, 0.02))
    crinkle = n.noise(60, 4, vector=p)
    n.out(**{"Base Color": c, "Roughness": n.lerp(crinkle, 0.15, 0.4),
             "Normal": br.bump(n, crinkle, 0.0015)})
    return mat


def build():
    rng = random.Random(81)
    body = br.paint("cabinet", (0.014, 0.015, 0.02), wear=1.0, gloss=0.3, decal=_brand, salt=0.25)
    trim = lib.material("trim", (0.35, 0.35, 0.36), roughness=0.35, metallic=1.0)
    black = lib.material("black", (0.008, 0.008, 0.009), roughness=0.55)
    glass = lib.material("glass", (0.05, 0.055, 0.06), roughness=0.05)
    glass.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.18
    glass.surface_render_method = "BLENDED"
    window = lib.material("glow-window", (0.55, 0.57, 0.6), emission=(0.85, 0.9, 1.0), strength=2.5)
    panel = lib.material("glow-panel", (0.05, 0.25, 0.3), emission=(0.15, 0.75, 1.0), strength=3.0)
    ink = lib.material("brand-ink", (0.6, 0.58, 0.52), roughness=0.5)
    keys = br.plastic("keys", (0.2, 0.2, 0.21), gloss=0.3)
    packets = snacks()
    flap = br.plastic("flap", (0.012, 0.012, 0.014), gloss=0.35)

    x0, x1, z0, z1 = WIN
    # The cabinet, one rounded box with the window's hollow cut out of its front.
    deep = CAVITY - FRONT
    yc = (FRONT + CAVITY) / 2
    cabinet = br.part("cabinet", (W, D, H - 0.03), (0, 0, 0.03 + (H - 0.03) / 2), body, 0.1, bevel=0.01)
    cutter = lib.box("cutter", (x1 - x0, deep + 0.02, z1 - z0), ((x0 + x1) / 2, yc - 0.01, (z0 + z1) / 2), body)
    br.cut(cabinet, cutter)
    for sx in (-1, 1):
        for sy in (-1, 1):
            lib.box("foot", (0.06, 0.06, 0.03), (sx * 0.4, sy * 0.35, 0.015), black)

    # The window: a backlit panel, rows of snacks on trays, glass in a bright trim.
    lib.box("backlight", (x1 - x0, 0.01, z1 - z0), ((x0 + x1) / 2, CAVITY - 0.005, (z0 + z1) / 2), window)
    for sx, x in ((-1, x0), (1, x1)):
        lib.box("cavity-side", (0.004, deep, z1 - z0), (x - sx * 0.002, yc, (z0 + z1) / 2), black)
    lib.box("cavity-floor", (x1 - x0, deep, 0.004), ((x0 + x1) / 2, yc, z0 + 0.002), black)
    lib.box("cavity-top", (x1 - x0, deep, 0.004), ((x0 + x1) / 2, yc, z1 - 0.002), black)
    row_h = (z1 - z0) / ROWS
    cols = 5
    col_w = (x1 - x0) / cols
    for r in range(ROWS):
        zr = z0 + r * row_h + 0.01
        lib.box("tray", (x1 - x0 - 0.01, deep - 0.04, 0.006), ((x0 + x1) / 2, yc + 0.01, zr), trim)
        lib.box("tray-lip", (x1 - x0 - 0.01, 0.006, 0.03), ((x0 + x1) / 2, FRONT + 0.06, zr + 0.012), black)
        tall = row_h * (0.62 + 0.25 * rng.random())
        for c in range(cols):
            if rng.random() < 0.12:
                continue  # sold out
            seed = rng.random()
            pw = col_w * (0.7 + 0.15 * rng.random())
            for k in range(2):
                br.part("packet", (pw, 0.025, tall - 0.01 * k), (x0 + (c + 0.5) * col_w,
                                                                   FRONT + 0.09 + k * 0.07, zr + 0.003 + tall / 2),
                        packets, seed, rot=(-0.12 - 0.05 * rng.random(), 0, rng.uniform(-0.06, 0.06)))
    gy = FRONT + 0.012
    lib.box("glass", (x1 - x0, 0.006, z1 - z0), ((x0 + x1) / 2, gy, (z0 + z1) / 2), glass)
    t = 0.02
    for x in (x0, x1):
        lib.box("trim", (t, 0.012, z1 - z0 + 2 * t), (x, FRONT + 0.004, (z0 + z1) / 2), trim, bevel=0.003)
    for z in (z0, z1):
        lib.box("trim", (x1 - x0, 0.012, t), ((x0 + x1) / 2, FRONT + 0.004, z), trim, bevel=0.003)

    # The payment panel.
    px = (x1 + W / 2) / 2
    face = FRONT
    lib.box("panel", (0.2, 0.012, 0.62), (px, face + 0.004, 1.22), black, bevel=0.004)
    lib.box("display", (0.15, 0.004, 0.05), (px, face - 0.002, 1.45), panel)
    for r in range(4):
        for c in range(3):
            lib.box("key", (0.034, 0.012, 0.026), (px - 0.045 + c * 0.045, face - 0.004, 1.34 - r * 0.04),
                    keys, bevel=0.002, segments=1)
    lib.box("card-reader", (0.1, 0.02, 0.07), (px, face - 0.008, 1.06), black, bevel=0.006)
    lib.box("card-light", (0.06, 0.004, 0.008), (px, face - 0.019, 1.08), panel)
    lib.box("coin-slot", (0.012, 0.006, 0.04), (px, face - 0.003, 0.98), trim)
    lib.box("coin-return", (0.08, 0.02, 0.06), (px, face - 0.004, 0.85), trim, bevel=0.006)

    # The delivery flap, pushed in a little.
    fx = (x0 + x1) / 2
    lib.box("bay", (0.5, 0.02, 0.22), (fx, face + 0.002, 0.3), black)
    br.part("flap", (0.48, 0.012, 0.2), (fx, face - 0.004, 0.3), flap, 0.3, rot=(0.05, 0, 0), bevel=0.004)

    # The brand down both sides.
    for sx, facing in ((1, "x"), (-1, "-x")):
        br.lettering("brand", "DOCKSIDE SNAX", 0.07, (sx * (W / 2 + 0.0004), 0.0, 1.55), ink,
                     facing=facing)
    br.bounds_report("vending-machine")
