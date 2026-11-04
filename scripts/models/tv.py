"""
TV item: flat panel with a thin bezel and a baked back housing with vents and a label.
"""

import lib

ITEM = "tv"
TRIS = 3000


def build():
    w, d, h = lib.item_size("tv")
    front = -d / 2
    panel = 0.05
    bezel, chin = 0.012, 0.03

    frame = lib.material("frame", (0.03, 0.03, 0.033), roughness=0.45)
    # Not mirror-like: the game's reflections band and blotch on a glossy black screen.
    screen = lib.material("screen", (0.004, 0.004, 0.005), roughness=0.2)
    silver = lib.material("logo", (0.6, 0.6, 0.62), roughness=0.3, metallic=1)
    black = lib.material("port", (0.005, 0.005, 0.005), roughness=0.7)
    led = lib.material("led", (0.2, 0.0, 0.0), emission=(1, 0.05, 0.02), strength=4)

    lib.box("panel", (w, panel, h), (0, front + panel / 2, 0), frame, bevel=0.006)
    screen_h = h - bezel - chin
    lib.box(
        "screen",
        (w - 2 * bezel, 0.002, screen_h),
        (0, front - 0.0005, -h / 2 + chin + screen_h / 2),
        screen,
    )
    lib.text("logo", "NOVA", 0.016, (0, front - 0.0005, -h / 2 + chin / 2), mat=silver)
    lib.box("led", (0.004, 0.002, 0.002), (w / 2 - 0.06, front - 0.0005, -h / 2 + chin / 2), led)

    # The back housing, out to the back of the item's box.
    back = d / 2
    housing = (0.9, back - front - panel + 0.01, 0.5)
    lib.box(
        "housing",
        housing,
        (0, back - housing[1] / 2, 0.02),
        back_material(back),
        bevel=0.035,
        segments=3,
    )
    for x in (-0.1, 0.1):
        for z in (-0.08, 0.12):
            lib.cylinder("vesa", 0.006, 0.002, (x, back, z), axis="y", mat=black, sides=12)
    for i in range(3):
        lib.box("port", (0.016, 0.003, 0.007), (-0.3 + i * 0.03, back, -0.15), black)


def back_material(back):
    """Dark speckled plastic, with rows of vent slots near the top and a printed label."""
    mat, n = lib.procedural("back", 1024)
    on_back = (back - 0.005, back + 1)
    x, _, z = n.xyz()

    vents = n.region((-0.38, on_back[0], 0.12), (0.38, on_back[1], 0.24))
    slots = n.math(
        "MULTIPLY",
        n.stripes(z, 0.014, 0.45),
        n.stripes(n.math("ADD", x, 0.38), 0.095, 0.85),
    )
    slot = n.math("MULTIPLY", vents, slots)

    label = n.region((0.18, on_back[0], -0.17), (0.33, on_back[1], -0.08))
    lines = n.math(
        "MULTIPLY",
        n.region((0.195, on_back[0], -0.155), (0.31, on_back[1], -0.095)),
        n.math(
            "MULTIPLY",
            n.stripes(z, 0.01, 0.35),
            n.math("GREATER_THAN", n.noise(90, detail=0), 0.42),
        ),
    )

    speckle = n.noise(400, detail=2)
    plastic = n.mix(speckle, (0.022, 0.022, 0.024), (0.04, 0.04, 0.043))
    color = n.mix(slot, plastic, (0.004, 0.004, 0.004))
    color = n.mix(label, color, (0.72, 0.72, 0.7))
    color = n.mix(n.math("MULTIPLY", label, lines), color, (0.12, 0.12, 0.12))
    rough = n.lerp(label, n.lerp(speckle, 0.4, 0.55), 0.75)
    n.out(**{
        "Base Color": color,
        "Roughness": rough,
        "Normal": n.bump(n.math("SUBTRACT", 1, slot), distance=0.003),
    })
    return mat
