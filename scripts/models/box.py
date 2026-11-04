"""
Box item: a big taped cardboard box, scuffed at the edges, with a shipping label and printing.
"""

import lib

ITEM = "box"
TRIS = 4000

ARROW = [(-0.016, 0), (0.016, 0), (0.016, 0.09), (0.042, 0.09), (0, 0.15), (-0.042, 0.09),
         (-0.016, 0.09)]


def build():
    w, d, h = lib.item_size("box")
    lib.box("box", (w, d, h), mat=cardboard(w, d, h), bevel=0.006)

    # Printed in ink, a hair proud of the cardboard.
    ink = lib.material("ink", (0.018, 0.014, 0.012), roughness=0.9)
    lift = 0.0003
    for facing, at in (("-y", -d / 2 - lift), ("y", d / 2 + lift)):
        # Across the face from the viewer's point of view, which is -x on the back.
        flip = 1 if facing == "-y" else -1
        lib.text("up", "THIS SIDE UP", 0.055, (0, at, 0.12), depth=0.0006, mat=ink, facing=facing)
        for u in (-0.07, 0.07):
            lib.shape("arrow", ARROW, (flip * u, at, 0.17), depth=0.0006, mat=ink, facing=facing)
    lib.text(
        "care", "HANDLE WITH CARE", 0.05, (-w / 2 - lift, 0, 0.3), depth=0.0006, mat=ink,
        facing="-x",
    )
    lib.text(
        "brand", "NIGHT SHIFT SUPPLY CO.", 0.04, (-w / 2 - lift, 0, -0.32), depth=0.0006, mat=ink,
        facing="-x",
    )


def cardboard(w, d, h):
    """Kraft board with blotches and fibres, scuffed edges, tape over the flaps and a label."""
    mat, n = lib.procedural("cardboard", 1024)
    x, y, z = n.xyz()
    ax, ay, az = (n.math("ABSOLUTE", v) for v in (x, y, z))

    # Edges: where two of the coordinates are near the outside, roughed up by noise.
    near = [n.math("GREATER_THAN", a, s / 2 - 0.012) for a, s in ((ax, w), (ay, d), (az, h))]
    edge = n.math("GREATER_THAN", n.math("ADD", n.math("ADD", near[0], near[1]), near[2]), 1.5)
    scuff = n.math("MULTIPLY", edge, n.math("GREATER_THAN", n.noise(12, detail=6), 0.56))

    # Tape over the seam of the top and bottom flaps, and down the front and back.
    strip = n.math("LESS_THAN", ax, 0.036)
    caps = n.math("GREATER_THAN", az, h / 2 - 0.003)
    ends = n.math(
        "MULTIPLY", n.math("GREATER_THAN", ay, d / 2 - 0.003), n.math("GREATER_THAN", az, h / 2 - 0.17)
    )
    tape = n.math("MULTIPLY", strip, n.math("MAXIMUM", caps, ends))

    # A shipping label on the +x side, with a barcode and lines of print.
    side = (w / 2 - 0.003, w)
    label = n.region((side[0], -0.16, -0.06), (side[1], 0.12, 0.14))
    barcode = n.math(
        "MULTIPLY",
        n.region((side[0], -0.13, -0.04), (side[1], 0.06, 0.02)),
        n.math("GREATER_THAN", n.noise(140, detail=0, vector=n.vec(y)), 0.5),
    )
    lines = n.math(
        "MULTIPLY",
        n.region((side[0], -0.13, 0.04), (side[1], 0.09, 0.12)),
        n.math(
            "MULTIPLY",
            n.stripes(z, 0.016, 0.4),
            n.math("GREATER_THAN", n.noise(60, detail=0, vector=n.vec(y, z)), 0.4),
        ),
    )
    printed = n.math("MAXIMUM", barcode, lines)

    blotch = n.noise(3, detail=3)
    fibre = n.noise(350, detail=2)
    kraft = n.mix(blotch, (0.33, 0.19, 0.085), (0.43, 0.26, 0.12))
    kraft = n.mix(n.math("MULTIPLY", fibre, 0.35), kraft, (0.2, 0.12, 0.05))
    color = n.mix(n.math("MULTIPLY", scuff, 0.7), kraft, (0.55, 0.43, 0.3))
    color = n.mix(tape, color, (0.3, 0.17, 0.06))
    color = n.mix(label, color, (0.78, 0.77, 0.74))
    color = n.mix(n.math("MULTIPLY", label, printed), color, (0.03, 0.03, 0.03))

    rough = n.lerp(tape, n.lerp(scuff, 0.82, 0.95), 0.35)
    rough = n.lerp(label, rough, 0.6)
    height = n.math("ADD", n.math("MULTIPLY", fibre, 0.3), n.math("MULTIPLY", tape, 0.4))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0008)})
    return mat
