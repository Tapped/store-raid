"""
Large tick: the dog-sized enemy of the first building, from assets/concept/large-tick-sheet.png.

A bloated, humped abdomen of overlapping plates behind a dorsal shield, a small head tucked low
with hooked, barbed mouthparts and palps, eight jointed legs ending in claws, and sparse bristles.

Rigged for client/src/tick.ts, which walks it: "body" at the body's centre, "head" under it, a
"hook.L"/"hook.R" per mouthpart and a chain per palp ("palp.L.0" ...) and per leg ("leg.L0.0" to
"leg.L0.5", front leg 0 to back leg 3), each ending in a ".tip". L and R are the tick's own left and
right: it faces -y, so its left is +x. Each leg's joints lie in one upright plane through its hip.
"""

import math
import random

import lib
from mathutils import Vector

OUT = "models/characters/tick.glb"
TRIS = 12000
SMOOTH_ANGLE = 70
AO_DISTANCE = 0.12

# The body is a humped egg around CENTER: HALF is its half width, half length and half height
# before it's shaped. It's tallest behind the middle, 0.58 m above the ground: ON_BACK in
# client/src/ticks.ts lays it on its back by that.
CENTER = Vector((0, 0, 0.32))
HALF = Vector((0.27, 0.40, 0.2))
# Plates across the abdomen, each lapping over the one behind: the first starts PLATE_START meters
# behind CENTER, each is PLATE long, and the last ends at PLATE_END. STEP is how far a plate's
# back edge stands over the next.
PLATE_START = -0.03
PLATE = 0.08
PLATES = 4
PLATE_END = PLATE_START + PLATES * PLATE
STEP = 0.013
# Plate edges lean: this many meters further back for every meter up.
LEAN = 0.28
# The dorsal shield over the front of the body: its middle along the body, and half its width and
# length, in meters. Measured along the lean, like the plates.
SHIELD = (-0.2, (0.19, 0.2))
# Lines along the abdomen, this far either side of the middle: the middle column stands proud.
COLUMN = 0.105
# Bristles are placed by this, so every build has the same.
SEED = 7


def build():
    body = lib.procedural("tick-body", 1024)
    chitin = lib.procedural("tick-chitin", 512)
    horn = lib.procedural("tick-horn", 256)
    shade_body(*body)
    shade_chitin(*chitin)
    shade_horn(*horn)
    rng = random.Random(SEED)
    lib.bone("body", CENTER, CENTER + Vector((0, -0.12, 0)))
    lib.bind(body_mesh(body[0]), "body")
    body_bristles(horn[0], rng)
    head(chitin[0], horn[0])
    for side in (-1, 1):
        for i, (y, angle, reach, lift) in enumerate(LEGS):
            leg(f"leg.{SIDE[side]}{i}", side, y, angle, reach, lift, chitin[0], horn[0], rng)


# Bone names for each side of the tick: it faces -y, so +x is its left.
SIDE = {-1: "R", 1: "L"}


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def plate_rise(q):
    """How far a plate stands out at q meters along the body: rising to STEP at its back edge."""
    if q <= PLATE_START or q >= PLATE_END:
        return 0.0
    return STEP * (((q - PLATE_START) / PLATE) % 1)


def shield(x, q):
    """1 on the dorsal shield, with a soft edge."""
    cq, (hx, hq) = SHIELD
    r = math.hypot(x / hx, (q - cq) / hq)
    return min(1.0, max(0.0, (1.05 - r) / 0.07))


def body_point(along, a):
    """
    The body's surface, from CENTER: `along` from -1 at the front to 1 at the back, and the angle
    `a` round it, 0 at its left (+x) and a quarter turn at the top.
    """
    t = (along + 1) / 2
    # Blunter at the back than at the front.
    power = 2.0 if along < 0 else 2.6
    r = max(0.0, 1 - abs(along) ** power) ** (1 / power)
    hump = smooth(t / 0.62)
    c, s = math.cos(a), math.sin(a)
    width = HALF.x * (0.8 + 0.28 * smooth(t / 0.5)) * r
    if s > 0:
        height = HALF.z * (0.66 + 0.64 * hump) * r
        z = height * s
    else:
        # Flatter underneath, hanging lower at the back.
        height = HALF.z * (0.68 + 0.22 * hump) * r
        z = -height * abs(s) ** 0.8
    x = width * c
    q = along * HALF.y

    # The nose droops to the head.
    droop = -0.05 * (1 - t) ** 2
    out = 0.0
    upper = smooth((s + 0.5) / 0.6)
    out += plate_rise(q) * upper
    if s > 0:
        on = shield(x, q) * min(1.0, s / 0.3)
        # The shield stands proud, with a boss down its middle and a lobe either side.
        boss = math.exp(-((x / 0.05) ** 2) - ((q + 0.2) / 0.12) ** 2)
        lobes = math.exp(-(((abs(x) - 0.11) / 0.045) ** 2) - ((q + 0.24) / 0.08) ** 2)
        out += on * (0.018 + 0.012 * boss + 0.012 * lobes)
        # Behind it, the middle column of plates stands over the ones beside it.
        behind = smooth((q - SHIELD[0]) / 0.25)
        out += 0.007 * (1 - smooth((abs(x) - COLUMN + 0.02) / 0.04)) * behind * min(1.0, s / 0.3)
    out *= min(1.0, r * 3)
    p = Vector((x + out * c, 0, z + out * s + droop))
    p.y = q + LEAN * p.z
    return p


def body_mesh(mat):
    # Stations along the body: evenly round its curve, and a pair close together at every plate
    # edge, where the surface steps down.
    count = 34
    stations = [-0.997] + [-math.cos(math.pi * i / count) for i in range(1, count)] + [0.997]
    edges = [PLATE_START + PLATE * k for k in range(1, PLATES + 1)]
    stations = [s for s in stations if all(abs(s * HALF.y - e) > 0.013 for e in edges)]
    for e in edges:
        stations += [(e - 0.003) / HALF.y, (e + 0.003) / HALF.y]
    stations.sort()
    around = 44
    rings = [
        [CENTER + body_point(s, 2 * math.pi * i / around) for i in range(around)] for s in stations
    ]
    return lib.loft("body", rings, mat)


def bristle(name, base, direction, length, mat, bone):
    """A stiff hair from `base`, bent a little towards the back, bound to `bone`."""
    direction = Vector(direction).normalized()
    mid = base + direction * (length * 0.55)
    tip = mid + (direction + Vector((0, 0.5, -0.15))).normalized() * (length * 0.45)
    hair = lib.tube(name, [base, mid, tip], [0.0034, 0.0026, 0.0006], mat, sides=3)
    return lib.bind(hair, bone)


def body_bristles(mat, rng):
    for i in range(26):
        along = rng.uniform(-0.75, 0.9)
        a = rng.uniform(0.1, 0.9) * math.pi
        p = body_point(along, a)
        # The surface's normal, from two steps along it.
        du = body_point(along + 0.02, a) - body_point(along - 0.02, a)
        dv = body_point(along, a + 0.05) - body_point(along, a - 0.05)
        normal = dv.cross(du).normalized()
        if normal.dot(p) < 0:
            normal = -normal
        base = CENTER + p - normal * 0.004
        bristle(f"bristle{i}", base, normal + Vector((0, 0.35, 0)), rng.uniform(0.045, 0.085), mat, "body")


# Legs, front to back: where they leave the body (y), which way they point (degrees from +x,
# negative is forward), how far they reach and how high the knee rises.
LEGS = [
    (-0.2, -42, 0.48, 0.19),
    (-0.12, -14, 0.43, 0.15),
    (-0.04, 14, 0.43, 0.14),
    (0.04, 40, 0.46, 0.14),
]

# Each segment of a leg is a piece of shell: swelling out of a joint, slimmer along its length,
# with a collar before the next. The last is the claw, tapering to its point.
SEGMENT = ((0.07, 0.84), (0.3, 1.06), (0.72, 0.9), (0.92, 1.0))
CLAW = ((0.12, 0.95), (0.45, 0.62), (0.8, 0.3))


def leg(name, side, y, angle, reach, lift, mat, horn, rng):
    a = math.radians(angle)
    out = Vector((side * math.cos(a), math.sin(a), 0))
    hip = Vector((side * 0.155, y, 0.21))
    coxa = hip + out * 0.08 + Vector((0, 0, -0.015))
    knee = hip + out * (reach * 0.36) + Vector((0, 0, lift))
    patella = knee + out * 0.07 + Vector((0, 0, -0.015))
    ankle = hip + out * (reach * 0.88) + Vector((0, 0, -0.13))
    foot = hip + out * reach + Vector((0, 0, -0.175))
    claw = foot + out * 0.03 + Vector((0, 0, -0.035))
    joints = [hip, coxa, knee, patella, ankle, foot, claw]
    radii = [0.06, 0.05, 0.041, 0.034, 0.024, 0.015]
    profile = [SEGMENT] * 5 + [CLAW]
    lib.jointed(
        name, joints, radii, mat, sides=8, bone=name, parent="body", profile=profile, pinch=0.62
    )
    # Bristles on the long segments, standing off the leg and raked towards its end.
    across = out.cross(Vector((0, 0, 1)))
    for i in (1, 3):
        along = (joints[i + 1] - joints[i]).normalized()
        up = (Vector((0, 0, 1)) - along * along.z).normalized()
        for k, t in enumerate((0.35, 0.7)):
            off = (up + across * rng.uniform(-0.8, 0.8)).normalized()
            base = joints[i].lerp(joints[i + 1], t) + off * (radii[i] * 0.7)
            hair = lib.tube(
                f"{name}-bristle{i}{k}",
                [base, base + (off + along * 0.7).normalized() * rng.uniform(0.04, 0.065)],
                [0.0034, 0.0006],
                horn,
                sides=3,
            )
            lib.bind(hair, f"{name}.{i}")


def head(chitin, horn):
    # The capitulum: a small shell tucked under the front of the shield, with a brow plate and a
    # collar where it meets the body.
    lib.bone("head", (0, -0.37, 0.27), (0, -0.5, 0.27), parent="body")

    def wedge(u):
        x, y, z = u
        # Wider at the back, flat underneath.
        return Vector((x * 0.1 * (1 + 0.25 * y), y * 0.09, z * (0.06 if z > 0 else 0.045)))

    lib.bind(lib.ellipsoid("head", (1, 1, 1), (0, -0.435, 0.262), chitin, 20, 14, deform=wedge), "head")
    lib.bind(lib.ellipsoid("brow", (0.07, 0.06, 0.028), (0, -0.455, 0.298), chitin, 16, 10), "head")
    lib.bind(lib.ellipsoid("collar", (0.11, 0.045, 0.06), (0, -0.385, 0.268), chitin, 20, 10), "head")

    for side in (-1, 1):
        # Hooked mouthparts, curling down and in, with barbs on the inside.
        hook = [
            (side * 0.036, -0.47, 0.262),
            (side * 0.06, -0.55, 0.255),
            (side * 0.062, -0.615, 0.222),
            (side * 0.042, -0.65, 0.172),
            (side * 0.014, -0.638, 0.128),
        ]
        hook_bone = lib.bone(f"hook.{SIDE[side]}", hook[0], hook[2], parent="head")
        lib.bind(lib.tube(f"hook{side}", hook, [0.027, 0.025, 0.019, 0.011, 0.002], horn), hook_bone)
        for i, (x, y, z) in enumerate(
            ((0.044, -0.535, 0.25), (0.048, -0.575, 0.236), (0.046, -0.612, 0.21), (0.034, -0.638, 0.176))
        ):
            base = Vector((side * x, y, z))
            tip = base + Vector((-side * 0.02, 0.01, -0.016))
            barb = lib.tube(f"barb{side}{i}", [base, tip], [0.0075, 0.0006], horn, sides=5)
            lib.bind(barb, hook_bone)
        # Palps beside them, short and jointed.
        palp = [
            (side * 0.068, -0.47, 0.255),
            (side * 0.098, -0.535, 0.236),
            (side * 0.094, -0.58, 0.196),
            (side * 0.078, -0.598, 0.158),
        ]
        name = f"palp.{SIDE[side]}"
        lib.jointed(
            name, palp, [0.021, 0.018, 0.014], chitin, sides=6, bone=name, parent="head",
            profile=SEGMENT, pinch=0.65,
        )


def shade_body(mat, n):
    """Leathery brown plates, mottled and pitted, dark where they lap; a paler, banded belly."""
    x, y, z = n.xyz()
    zr = n.math("SUBTRACT", z, CENTER.z)
    # Along the body as the plates lean: the geometry's q.
    q = n.math("SUBTRACT", y, n.math("MULTIPLY", zr, LEAN))
    upper = lib.smoothstep(n, zr, -0.09, -0.01)
    top = lib.smoothstep(n, zr, 0.0, 0.04)
    belly = n.math("SUBTRACT", 1.0, lib.smoothstep(n, zr, -0.11, -0.03))

    # Plate edges: a dark line in the step behind each, a worn lip before it.
    phase = n.math("FRACT", n.math("DIVIDE", n.math("SUBTRACT", q, PLATE_START), PLATE))
    step = n.math("MULTIPLY", n.math("LESS_THAN", phase, 0.06), n.inside(q, PLATE_START + PLATE / 2, PLATE_END + PLATE / 2))
    lip = n.math("MULTIPLY", n.math("GREATER_THAN", phase, 0.86), n.inside(q, PLATE_START + PLATE / 2, PLATE_END))

    cq, (hx, hq) = SHIELD
    r = n.math(
        "SQRT",
        n.math(
            "ADD",
            n.math("POWER", n.math("DIVIDE", x, hx), 2.0),
            n.math("POWER", n.math("DIVIDE", n.math("SUBTRACT", q, cq), hq), 2.0),
        ),
    )
    plate = n.math("MULTIPLY", n.math("LESS_THAN", r, 1.0), top)
    rim = n.math("MULTIPLY", n.inside(r, 0.98, 1.05), top)
    # Lines along the abdomen either side of the middle column, behind the shield.
    lines = n.math("LESS_THAN", n.math("ABSOLUTE", n.math("SUBTRACT", n.math("ABSOLUTE", x), COLUMN)), 0.006)
    lines = n.math("MULTIPLY", lines, n.math("MULTIPLY", top, n.math("GREATER_THAN", r, 1.05)))
    lines = n.math("MULTIPLY", lines, n.math("MULTIPLY", n.math("GREATER_THAN", q, cq), 0.55))
    # Bands across the belly.
    bands = n.math("MULTIPLY", n.stripes(y, 0.045, 0.14), belly)
    grooves = n.math("MAXIMUM", n.math("MULTIPLY", n.math("MAXIMUM", step, rim), upper), n.math("MAXIMUM", lines, bands))

    blotch = n.noise(7, detail=4)
    mottle = n.noise(22, detail=3)
    # Wrinkles run across the body.
    wrinkle = n.noise(30, detail=6, roughness=0.65, vector=lib._stretched(n, 0.3, 1, 1))
    pore = n.noise(240, detail=1)
    pits = n.math("GREATER_THAN", n.noise(70, detail=0), 0.7)
    crease = lib.crevices(n, 0.05)

    skin = n.mix(blotch, (0.065, 0.043, 0.028), (0.155, 0.105, 0.066))
    # The shield is darker, harder and mottled.
    scutum = n.mix(lib.smoothstep(n, mottle, 0.4, 0.7), (0.026, 0.017, 0.012), (0.085, 0.045, 0.026))
    skin = n.mix(plate, skin, scutum)
    skin = n.mix(n.math("MULTIPLY", lip, n.math("MULTIPLY", upper, 0.5)), skin, (0.22, 0.16, 0.105))
    # Each plate its own shade, the middle column a little lighter than the ones beside it.
    index = n.math("FLOOR", n.math("DIVIDE", n.math("SUBTRACT", q, PLATE_START), PLATE))
    shade = n.math("FRACT", n.math("MULTIPLY", n.math("ADD", index, 3.0), 0.37))
    skin = lib.shade(n, skin, n.lerp(n.math("MULTIPLY", shade, upper), 1.0, 0.72))
    column = n.math("MULTIPLY", n.math("LESS_THAN", n.math("ABSOLUTE", x), COLUMN), n.math("MULTIPLY", top, n.math("GREATER_THAN", r, 1.05)))
    skin = lib.shade(n, skin, n.lerp(column, 1.0, 1.25))
    pale = n.mix(blotch, (0.13, 0.1, 0.075), (0.2, 0.155, 0.115))
    skin = n.mix(n.math("MULTIPLY", belly, 0.85), skin, pale)
    skin = n.mix(n.math("MULTIPLY", wrinkle, 0.45), skin, (0.035, 0.024, 0.017))
    skin = n.mix(n.math("MULTIPLY", pits, 0.35), skin, (0.03, 0.022, 0.016))
    skin = n.mix(n.math("MULTIPLY", grooves, 0.7), skin, (0.022, 0.015, 0.011))
    skin = n.mix(n.math("MULTIPLY", crease, 0.6), skin, (0.02, 0.014, 0.01))

    # Wet-looking plates, duller wrinkled belly, dry in the grooves.
    rough = n.lerp(wrinkle, 0.36, 0.55)
    rough = n.lerp(plate, rough, n.lerp(mottle, 0.3, 0.44))
    rough = n.lerp(belly, rough, 0.55)
    rough = n.lerp(grooves, rough, 0.7)
    height = n.math("ADD", n.math("MULTIPLY", wrinkle, 0.7), n.math("MULTIPLY", pore, 0.15))
    height = n.math("SUBTRACT", height, n.math("MULTIPLY", pits, 0.25))
    height = n.math("SUBTRACT", height, n.math("MULTIPLY", grooves, 0.7))
    n.out(**{"Base Color": skin, "Roughness": rough, "Normal": n.bump(height, distance=0.007)})


def shade_chitin(mat, n):
    """Hard, glossy red-brown shell for the head and legs, nearly black in the joints."""
    grain = n.noise(34, detail=5)
    streak = n.noise(90, detail=2)
    fine = n.noise(300, detail=1)
    crease = lib.crevices(n, 0.035)
    color = n.mix(grain, (0.04, 0.024, 0.016), (0.125, 0.07, 0.04))
    color = n.mix(n.math("MULTIPLY", lib.smoothstep(n, streak, 0.55, 0.75), 0.4), color, (0.17, 0.11, 0.065))
    color = n.mix(n.math("MULTIPLY", crease, 0.8), color, (0.012, 0.009, 0.007))
    rough = n.lerp(grain, 0.28, 0.44)
    rough = n.lerp(crease, rough, 0.6)
    height = n.math("ADD", n.math("MULTIPLY", grain, 0.6), n.math("MULTIPLY", fine, 0.25))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.002)})


def shade_horn(mat, n):
    """Horn: pale and waxy on the mouthparts, stained dark to the hooks' points; bristles are brown."""
    x, y, z = n.xyz()
    grain = n.noise(120, detail=3)
    color = n.mix(grain, (0.3, 0.17, 0.095), (0.46, 0.3, 0.17))
    # The mouthparts are all that's this far forward and this low: the rest is bristles.
    mouth = n.math("MULTIPLY", n.math("LESS_THAN", y, -0.45), n.math("LESS_THAN", z, 0.3))
    color = n.mix(mouth, n.mix(grain, (0.1, 0.06, 0.035), (0.2, 0.125, 0.07)), color)
    # The hooks' ends, low at the very front.
    tips = n.math("MULTIPLY", n.math("LESS_THAN", y, -0.5), n.math("SUBTRACT", 1.0, lib.smoothstep(n, z, 0.17, 0.27)))
    color = n.mix(n.math("MULTIPLY", tips, 0.9), color, (0.035, 0.014, 0.01))
    n.out(**{"Base Color": color, "Roughness": n.lerp(grain, 0.25, 0.38)})
