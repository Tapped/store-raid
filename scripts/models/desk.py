"""
Desk: a shipping clerk's desk, melamine on a steel pedestal and panel end, with a monitor (dark),
keyboard and mouse, trays of manifests, a clipboard, a mug, an angled desk lamp and the monitor's
cable down the back.
"""

import math
import random

import backroom as br
import lib

TRIS = 3000
AO = 1024
AO_DISTANCE = 0.2

W, H, D = 1.6, 1.2, 0.8
TOP = 0.74
FRONT, BACK = -D / 2, D / 2


def build():
    rng = random.Random(61)
    top = br.laminate("laminate", (0.24, 0.22, 0.19))
    steel = br.paint("steel", (0.12, 0.125, 0.13), wear=0.8, gloss=0.4, salt=0.2)
    plastic = br.plastic("plastic", (0.03, 0.03, 0.032), gloss=0.4)
    keyboard = br.keys()
    paper = br.paper()
    screen = lib.material("screen", (0.004, 0.004, 0.005), roughness=0.16)
    trays = br.plastic("trays", (0.012, 0.012, 0.013), gloss=0.35)
    ceramic = br.plastic("mug", (0.25, 0.05, 0.02), gloss=0.2)
    lamp = br.paint("lamp", (0.02, 0.022, 0.025), wear=0.8, gloss=0.3, salt=0.1)
    cable = lib.material("cable", (0.01, 0.01, 0.01), roughness=0.5)

    # The top, a drawer pedestal under the left and a panel end on the right, and a modesty panel.
    br.part("top", (W, D, 0.025), (0, 0, TOP - 0.0125), top, 0.2, bevel=0.003)
    ped_w = 0.42
    px = -W / 2 + 0.02 + ped_w / 2
    br.part("pedestal", (ped_w, D - 0.1, TOP - 0.025 - 0.02), (px, 0.03, (TOP - 0.025) / 2 + 0.01),
            steel, 0.3, bevel=0.004)
    z = TOP - 0.03
    for h in (0.12, 0.12, 0.42):
        br.part("drawer", (ped_w - 0.02, 0.018, h - 0.008), (px, FRONT + 0.08 - 0.009, z - h / 2), steel,
                rng.random(), bevel=0.003)
        lib.box("drawer-pull", (0.12, 0.02, 0.014), (px, FRONT + 0.06 - 0.01, z - 0.03), plastic,
                bevel=0.003)
        z -= h
    br.part("plinth", (ped_w - 0.04, D - 0.14, 0.02), (px, 0.03, 0.01), plastic, 0.4)
    br.part("end", (0.025, D - 0.04, TOP - 0.025), (W / 2 - 0.0325, 0, (TOP - 0.025) / 2), top, 0.6,
            bevel=0.003)
    br.part("modesty", (W - ped_w - 0.1, 0.018, 0.4), (px + ped_w / 2 + (W - ped_w - 0.1) / 2 + 0.02,
                                                       BACK - 0.08, TOP - 0.025 - 0.2), top, 0.8)

    # The monitor, a little turned, its screen dark.
    mx, my = -0.05, 0.17
    turn = -0.12
    parts = [
        lib.box("monitor-base", (0.24, 0.18, 0.014), (0, 0.0, 0.007), plastic, bevel=0.005),
        lib.box("monitor-neck", (0.05, 0.03, 0.22), (0, 0.05, 0.12), plastic, bevel=0.006),
        lib.box("monitor", (0.56, 0.04, 0.34), (0, 0.02, 0.3), plastic, bevel=0.008),
        lib.box("monitor-back", (0.3, 0.04, 0.2), (0, 0.05, 0.29), plastic, bevel=0.015),
        lib.box("screen", (0.535, 0.002, 0.305), (0, -0.0005, 0.307), screen),
    ]
    for o in parts:
        o.location = (mx, my, TOP)
        o.rotation_euler = (0, 0, turn)
    # The monitor's top: TOP + 0.47 = 1.21; the cable from its back down behind the desk.
    lib.tube("monitor-cable", [(mx + 0.01, my + 0.08, TOP + 0.2), (mx + 0.02, my + 0.16, TOP + 0.08),
                               (mx + 0.03, BACK - 0.02, TOP + 0.01), (mx + 0.05, BACK - 0.012, TOP - 0.1),
                               (mx + 0.1, BACK - 0.015, 0.3), (mx + 0.16, BACK - 0.03, 0.006)],
             [0.004] * 6, mat=cable, sides=5)

    # Keyboard and mouse.
    br.part("keyboard", (0.44, 0.14, 0.022), (-0.06, -0.17, TOP + 0.011), keyboard, 0.3,
            rot=(0.04, 0, 0.03), bevel=0.004)
    mouse = lib.ellipsoid("mouse", (0.032, 0.055, 0.018), (0, 0, 0), plastic, segments=10, rings=6,
                          deform=lambda q: lib.Vector((q.x * 0.032, q.y * 0.055, max(q.z, -0.05) * 0.018 * (1.15 - 0.3 * q.y))))
    br.tag(mouse, (0.032, 0.055, 0.02), 0.5)
    br.place(mouse, (0.29, -0.16, TOP + 0.002), (0, 0, -0.2))
    lib.tube("mouse-cable", [(0.28, -0.1, TOP + 0.006), (0.25, 0.02, TOP + 0.004), (0.12, 0.12, TOP + 0.004),
                             (0.05, 0.2, TOP + 0.004)], [0.0025] * 4, mat=cable, sides=4)

    # Two stacked letter trays of manifests on the left, and a clipboard.
    for k in range(2):
        tray((-0.6, 0.1, TOP + k * 0.075), trays, paper, rng, fill=0.03 + 0.02 * k)
    br.part("clipboard", (0.23, 0.32, 0.004), (-0.42, -0.22, TOP + 0.002), plastic, 0.7, rot=(0, 0, 0.25))
    br.part("sheets", (0.21, 0.297, 0.006), (-0.42, -0.225, TOP + 0.007), paper, 0.3, rot=(0, 0, 0.25))
    lib.box("clip", (0.08, 0.03, 0.012), (-0.455, -0.084, TOP + 0.012),
            lamp).rotation_euler = (0, 0, 0.25)
    br.part("sheets", (0.21, 0.297, 0.002), (0.45, -0.05, TOP + 0.001), paper, 0.6, rot=(0, 0, -0.4))

    mug((0.28, 0.1, TOP), ceramic)
    desk_lamp((0.62, 0.22, TOP), lamp, cable)
    br.bounds_report("desk")


def tray(at, mat, paper, rng, fill=0.03):
    """A plastic letter tray holding a stack of paper, `at` the middle of its bottom."""
    x, y, z = at
    w, d, h, t = 0.26, 0.35, 0.065, 0.004
    br.part("tray", (w, d, t), (x, y, z + t / 2), mat, rng.random())
    for sx in (-1, 1):
        br.part("tray", (t, d, h), (x + sx * (w / 2 - t / 2), y, z + h / 2), mat, rng.random())
    br.part("tray", (w, t, h), (x, y + d / 2 - t / 2, z + h / 2), mat, rng.random())
    br.part("tray", (w, t, h * 0.5), (x, y - d / 2 + t / 2, z + h * 0.25), mat, rng.random())
    br.part("manifests", (0.215, 0.3, fill), (x + rng.uniform(-0.005, 0.005), y + 0.01, z + t + fill / 2),
            paper, rng.random(), rot=(0, 0, rng.uniform(-0.04, 0.04)))


def mug(at, mat):
    """A mug with a handle."""
    x, y, z = at
    r, h = 0.042, 0.095
    lib.lathe("mug", [(0, 0), (0, r - 0.004), (0.004, r), (h, r), (h, r - 0.005), (0.012, r - 0.005),
                      (0.012, 0)], (x, y, z), mat=mat, sides=14)
    lib.tube("mug-handle", [(x + r - 0.004, y, z + 0.075), (x + r + 0.022, y, z + 0.07),
                            (x + r + 0.026, y, z + 0.045), (x + r + 0.02, y, z + 0.022),
                            (x + r - 0.004, y, z + 0.02)], [0.006] * 5, mat=mat, sides=6)


def desk_lamp(at, mat, cable):
    """An angle-poise lamp: a heavy base, two arms with springs, a conical shade looking down."""
    x, y, z = at
    lib.cylinder("lamp-base", 0.075, 0.03, (x, y, z + 0.015), mat=mat, sides=14, bevel=0.006)
    elbow = (x - 0.08, y - 0.05, z + 0.36)
    head = (x - 0.3, y - 0.12, z + 0.42)
    lib.tube("lamp-arm", [(x, y, z + 0.03), elbow], [0.007, 0.007], mat=mat, sides=6)
    lib.tube("lamp-arm", [(x + 0.012, y, z + 0.03), (elbow[0] + 0.012, elbow[1], elbow[2])],
             [0.004, 0.004], mat=mat, sides=5)
    lib.tube("lamp-arm", [elbow, head], [0.006, 0.006], mat=mat, sides=6)
    lib.cylinder("lamp-joint", 0.014, 0.03, elbow, axis="x", mat=mat, sides=8)
    shade = lib.lathe("lamp-shade", [(0.0, 0.025), (0.04, 0.03), (0.11, 0.075), (0.112, 0.073),
                                     (0.04, 0.026), (0.0, 0.0)], (0, 0, 0), mat=mat, sides=14)
    shade.location = head
    shade.rotation_euler = (math.radians(150), 0, math.radians(-30))
    lib.tube("lamp-cable", [(x + 0.06, y + 0.03, z + 0.01), (x + 0.12, y + 0.1, z + 0.004),
                            (x + 0.1, BACK - 0.02, z + 0.004), (x + 0.11, BACK - 0.012, z - 0.2)],
             [0.0025] * 4, mat=cable, sides=4)
