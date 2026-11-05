"""
First-person hand: the player's right hand in a work glove, with the jacket sleeve behind it.

Fingers point forward (-y), the thumb is on top and the palm faces in (+x), as a right hand reaching
forward is seen from behind. The origin is the wrist, for the game to turn the hand around; the
game mirrors it for the left hand. hand-grip.py builds the same hand with its fingers closed.
"""

import math

import lib
from mathutils import Matrix, Vector

OUT = "models/characters/hand.glb"
ORIGIN = "model"
TRIS = 6000
SMOOTH_ANGLE = 70
AO_DISTANCE = 0.03

# How far each finger joint bends towards the palm, in degrees: knuckle, middle, tip.
CURL = (14, 18, 12)
THUMB_CURL = (8, 10)

PALM = Vector((0.034, 0.1, 0.088))  # thickness (x), length (y), width (z)
# Fingers from the index (top, beside the thumb) down to the little finger: where they leave the
# palm (height on it), and the length of each of their three bones.
FINGERS = [
    (0.031, (0.045, 0.027, 0.022)),
    (0.010, (0.05, 0.031, 0.023)),
    (-0.011, (0.047, 0.029, 0.022)),
    (-0.031, (0.037, 0.022, 0.019)),
]
FINGER_RADIUS = 0.0115


def build(curl=CURL, thumb_curl=THUMB_CURL):
    glove = lib.procedural("glove", 512)
    leather = lib.procedural("glove-palm", 512)
    sleeve = lib.procedural("sleeve", 512)
    shade_glove(*glove, (0.045, 0.047, 0.05))
    shade_glove(*leather, (0.2, 0.13, 0.075))
    shade_sleeve(*sleeve)

    # The back of the hand in grey fabric, the palm in tan leather a little proud of it.
    lib.ellipsoid("back", PALM / 2, (-0.002, -0.06, 0), glove[0], 20, 14, "y", deform=boxy(PALM / 2))
    pad = Vector((0.008, 0.046, 0.04))
    lib.ellipsoid("palm", pad, (0.01, -0.063, -0.002), leather[0], 16, 12, "y", deform=boxy(pad))
    for i, (z, bones) in enumerate(FINGERS):
        finger(f"finger{i}", Vector((0.003, -0.105, z)), bones, curl, glove[0], leather[0])
    thumb(thumb_curl, glove[0], leather[0])

    # Wrist, cuff and sleeve, going back out of view.
    lib.tube("wrist", [(0, -0.03, 0), (0, 0.03, 0)], [0.033, 0.031], glove[0], sides=14)
    lib.tube("cuff", [(0, 0.02, 0), (0, 0.06, 0)], [0.04, 0.04], sleeve[0], sides=16)
    lib.tube(
        "sleeve", [(0, 0.055, 0), (0, 0.15, 0.002), (0, 0.35, 0.01), (0, 0.6, 0.02)],
        [0.047, 0.05, 0.055, 0.06],
        sleeve[0], sides=16,
    )


def boxy(half):
    """An ellipsoid deform that squares it off, like a palm, keeping the edges round."""

    def deform(u):
        return Vector(math.copysign(abs(c) ** 0.55, c) * h for c, h in zip(u, half))

    return deform


def bend(direction, degrees):
    """Turn a finger's direction towards the palm (+x) by `degrees`."""
    return Matrix.Rotation(math.radians(degrees), 3, "Z") @ direction


def finger(name, base, bones, curl, glove, leather):
    """A finger from `base`, bending towards the palm at each joint, with a leather fingertip."""
    joints = [base]
    direction = Vector((0, -1, 0))
    for length, degrees in zip(bones, curl):
        direction = bend(direction, degrees)
        joints.append(joints[-1] + direction * length)
    r = FINGER_RADIUS
    lib.jointed(name, joints, [r, r * 0.93, r * 0.85], glove, sides=8)
    tip = joints[-1] - direction * bones[-1] * 0.45
    lib.ellipsoid(f"{name}-tip", (r * 0.85,) * 3, tip + Vector((0.003, 0, 0)), leather, 8, 6)


def thumb(curl, glove, leather):
    """Out from the palm's top edge, forward and in over the palm."""
    base = Vector((0.012, -0.03, 0.032))
    direction = Vector((0.45, -0.8, 0.28)).normalized()
    joints = [base, base + direction * 0.04]
    for length, degrees in zip((0.034, 0.027), curl):
        # Closing wraps it in over the palm and down towards the fingers.
        turn = math.sin(math.radians(degrees))
        direction = (direction + Vector((0.45, -0.1, -0.6)) * turn).normalized()
        joints.append(joints[-1] + direction * length)
    lib.jointed("thumb", joints, [0.016, 0.0125, 0.011], glove, sides=8)
    lib.ellipsoid("thumb-tip", (0.0095,) * 3, joints[-1] - direction * 0.012, leather, 8, 6)


def shade_glove(mat, n, color):
    """Woven work-glove fabric, or worn leather: fine weave, scuffs and a little dirt."""
    weave = n.noise(900, detail=1)
    wear = n.noise(60, detail=4)
    dark = tuple(c * 0.6 for c in color)
    light = tuple(min(1.0, c * 1.5) for c in color)
    base = n.mix(wear, dark, light)
    base = n.mix(n.math("MULTIPLY", weave, 0.4), base, dark)
    rough = n.lerp(wear, 0.75, 0.9)
    n.out(**{"Base Color": base, "Roughness": rough,
             "Normal": n.bump(n.math("ADD", weave, n.math("MULTIPLY", wear, 0.3)), distance=0.0006)})


def shade_sleeve(mat, n):
    """Dark navy work-jacket canvas with a ribbed cuff."""
    _, y, _ = n.xyz()
    cuff = n.math("LESS_THAN", y, 0.06)
    rib = n.math("MULTIPLY", cuff, n.stripes(n.math("ARCTAN2", *n.xyz()[0::2]), 0.12, 0.5))
    weave = n.noise(500, detail=1)
    folds = n.noise(14, detail=3)
    canvas = n.mix(folds, (0.018, 0.024, 0.038), (0.035, 0.045, 0.07))
    canvas = n.mix(cuff, canvas, (0.02, 0.022, 0.03))
    height = n.math("ADD", n.math("MULTIPLY", weave, 0.3), n.math("ADD", folds, rib))
    n.out(**{"Base Color": canvas, "Roughness": 0.85, "Normal": n.bump(height, distance=0.001)})
