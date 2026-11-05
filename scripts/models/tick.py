"""
Large tick: the dog-sized enemy of the first building, from assets/concept/large-tick-sheet.png.

A bloated, segmented abdomen under a dorsal shield, a small head with hooked mouthparts and palps,
and eight jointed legs ending in claws. One static mesh for now; animating it will need the legs
as separate parts.
"""

import math

import bmesh
import lib
from mathutils import Matrix, Vector

OUT = "models/characters/tick.glb"
TRIS = 12000
SMOOTH_ANGLE = 70
AO_DISTANCE = 0.15

# The body is an egg around CENTER: HALF is its half width, half length and half height.
CENTER = Vector((0, 0, 0.32))
HALF = Vector((0.27, 0.40, 0.2))
# Grooves across the abdomen, every GROOVE_STEP meters from y = 0 towards the back.
GROOVES = [0.0, 0.075, 0.15, 0.225, 0.3]
GROOVE_WIDTH = 0.018
# The dorsal shield over the front of the body: centre (x, y) and half size, in meters.
SHIELD = ((0.0, -0.2), (0.2, 0.22))


def build():
    body = lib.procedural("tick-body", 1024)
    chitin = lib.procedural("tick-chitin", 512)
    mouth = lib.material("tick-mouth", (0.26, 0.11, 0.08), roughness=0.35)
    shade_body(*body)
    shade_chitin(*chitin)
    body_mesh(body[0])
    head(chitin[0], mouth)
    for side in (-1, 1):
        for i, (y, angle, reach, lift) in enumerate(LEGS):
            leg(f"leg{side}{i}", side, y, angle, reach, lift, chitin[0])


def groove(y):
    """1 in an abdomen groove at body y (meters from CENTER), falling to 0 beside it."""
    d = min(abs(y - g) for g in GROOVES)
    return max(0.0, 1 - d / GROOVE_WIDTH) ** 2


def shield(x, y):
    """1 on the dorsal shield, with a soft edge."""
    (cx, cy), (hx, hy) = SHIELD
    r = math.hypot((x - cx) / hx, (y - cy) / hy)
    return min(1.0, max(0.0, (1.08 - r) / 0.08))


def body_mesh(mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=56, radius=1)
    # Poles along y, so the rings run across the body where the grooves are.
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    for v in bm.verts:
        x, y, z = v.co
        # Egg: wider and taller towards the back (+y), flatter underneath.
        sx = HALF.x * (1 + 0.12 * y)
        sz = HALF.z * (1 + 0.18 * y) * (0.8 if z < 0 else 1.0)
        p = Vector((x * sx, y * HALF.y, z * sz))
        # Grooves pinch the abdomen in; the shield stands a little proud of the top.
        pinch = 1 - 0.045 * groove(p.y) * (1 if p.y > -0.02 else 0)
        p.x *= pinch
        p.z *= pinch
        if p.z > 0:
            p.z += 0.014 * shield(p.x, p.y) * min(1.0, p.z / 0.08)
        v.co = p + CENTER
    lib.assign(lib._mesh_object("body", bm), mat)


def tube(name, points, radii, mat, sides=8):
    """A tube through `points`, `radii[i]` thick at each, closed at both ends."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    rings = []
    normal = None
    for i, p in enumerate(pts):
        ahead = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        t = ahead.normalized()
        if normal is None:
            normal = t.cross(Vector((0, 0, 1)))
            if normal.length < 1e-4:
                normal = t.cross(Vector((1, 0, 0)))
        # Carry the ring's orientation along the tube, so it doesn't twist.
        normal = (normal - t * normal.dot(t)).normalized()
        binormal = t.cross(normal)
        ring = []
        for s in range(sides):
            a = 2 * math.pi * s / sides
            ring.append(bm.verts.new(p + radii[i] * (math.cos(a) * normal + math.sin(a) * binormal)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for s in range(sides):
            bm.faces.new((a[s], a[(s + 1) % sides], b[(s + 1) % sides], b[s]))
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        tip = bm.verts.new(sum((v.co for v in ring), Vector()) / sides)
        for s in range(sides):
            face = (ring[s], ring[(s + 1) % sides], tip)
            bm.faces.new(face[::-1] if flip else face)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib.assign(lib._mesh_object(name, bm), mat)


def jointed(name, joints, radii, mat, sides=8):
    """
    A jointed limb through `joints`, each segment `radii[i]` thick, pinched at the joints so they
    read as separate pieces of shell.
    """
    points, widths = [], []
    for i, (a, b) in enumerate(zip(joints, joints[1:])):
        a, b = Vector(a), Vector(b)
        r = radii[i]
        if i == 0:
            points.append(a)
            widths.append(r * 0.9)
        for t, k in ((0.18, 1.0), (0.55, 1.08), (0.85, 0.95)):
            points.append(a.lerp(b, t))
            widths.append(r * k)
        points.append(b)
        nxt = radii[i + 1] if i + 1 < len(radii) else r * 0.4
        widths.append(min(r, nxt) * 0.75)
    return tube(name, points, widths, mat, sides)


# Legs, front to back: where they leave the body (y), which way they point (degrees from +x,
# negative is forward), how far they reach and how high the knee rises.
LEGS = [
    (-0.2, -42, 0.48, 0.19),
    (-0.12, -14, 0.43, 0.15),
    (-0.04, 14, 0.43, 0.14),
    (0.04, 40, 0.46, 0.14),
]


def leg(name, side, y, angle, reach, lift, mat):
    a = math.radians(angle)
    out = Vector((side * math.cos(a), math.sin(a), 0))
    hip = Vector((side * 0.17, y, 0.2))
    coxa = hip + out * 0.07 + Vector((0, 0, -0.01))
    knee = hip + out * (reach * 0.36) + Vector((0, 0, lift))
    patella = knee + out * 0.06 + Vector((0, 0, -0.01))
    ankle = hip + out * (reach * 0.88) + Vector((0, 0, -0.13))
    foot = hip + out * reach + Vector((0, 0, -0.185))
    claw = foot + out * 0.035 + Vector((0, 0, -0.015))
    joints = [hip, coxa, knee, patella, ankle, foot, claw]
    jointed(name, joints, [0.05, 0.042, 0.036, 0.03, 0.021, 0.012], mat, sides=10)


def head(chitin, mouth):
    # The capitulum: a small shell in front of the shield.
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=1)
    bmesh.ops.scale(bm, vec=(0.085, 0.08, 0.055), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, -0.43, 0.27), verts=bm.verts)
    lib.assign(lib._mesh_object("head", bm), chitin)

    for side in (-1, 1):
        # Hooked mouthparts, curling down and in, with barbs on the inside.
        hook = [
            (side * 0.03, -0.47, 0.27),
            (side * 0.04, -0.54, 0.26),
            (side * 0.035, -0.6, 0.225),
            (side * 0.02, -0.625, 0.18),
            (side * 0.008, -0.61, 0.15),
        ]
        tube(f"hook{side}", hook, [0.022, 0.019, 0.014, 0.008, 0.002], mouth)
        for i, (y, z) in enumerate(((-0.53, 0.25), (-0.575, 0.235), (-0.605, 0.205))):
            base = Vector((side * 0.025, y, z))
            tip = base + Vector((-side * 0.022, 0.006, -0.012))
            tube(f"barb{side}{i}", [base, tip], [0.006, 0.0006], mouth, sides=5)
        # Palps beside them, short and jointed.
        palp = [
            (side * 0.06, -0.47, 0.26),
            (side * 0.085, -0.53, 0.24),
            (side * 0.08, -0.57, 0.2),
            (side * 0.065, -0.585, 0.165),
        ]
        jointed(f"palp{side}", palp, [0.016, 0.014, 0.011], chitin, sides=6)


def abdomen_groove(n, y):
    """The geometry's grooves, in the shader: 1 in a groove, 0 away from them."""
    rel = n.math("SUBTRACT", y, CENTER.y)
    step = GROOVES[1] - GROOVES[0]
    phase = n.math("FRACT", n.math("ADD", n.math("DIVIDE", rel, step), 0.5))
    d = n.math("MULTIPLY", n.math("ABSOLUTE", n.math("SUBTRACT", phase, 0.5)), step)
    g = n.math("SUBTRACT", 1.0, n.math("DIVIDE", d, GROOVE_WIDTH * 0.7), clamp=True)
    on = n.inside(rel, GROOVES[0] - step / 2, GROOVES[-1] + step / 2)
    return n.math("MULTIPLY", n.math("POWER", g, 2.0), on)


def shade_body(mat, n):
    """Leathery grey-brown skin: blotchy, wrinkled, darker in the grooves and underneath."""
    x, y, z = n.xyz()
    g = abdomen_groove(n, y)
    (cx, cy), (hx, hy) = SHIELD
    r = n.math(
        "SQRT",
        n.math(
            "ADD",
            n.math("POWER", n.math("DIVIDE", n.math("SUBTRACT", x, cx), hx), 2.0),
            n.math("POWER", n.math("DIVIDE", n.math("SUBTRACT", y, cy), hy), 2.0),
        ),
    )
    top = n.math("GREATER_THAN", z, CENTER.z)
    plate = n.math("MULTIPLY", n.math("LESS_THAN", r, 1.0), top)
    rim = n.math("MULTIPLY", n.inside(r, 0.98, 1.02), top)
    # Plate lines along the back of the abdomen, either side of the middle.
    lines = n.math("LESS_THAN", n.math("ABSOLUTE", n.math("SUBTRACT", n.math("ABSOLUTE", x), 0.11)), 0.006)
    lines = n.math("MULTIPLY", lines, n.math("MULTIPLY", top, n.math("GREATER_THAN", y, GROOVES[0] - 0.02)))
    rim = n.math("MAXIMUM", rim, lines)
    below = n.math("SUBTRACT", 1.0, n.math("DIVIDE", n.math("SUBTRACT", z, 0.14), 0.18), clamp=True)

    blotch = n.noise(6, detail=4)
    wrinkle = n.noise(28, detail=6, roughness=0.65)
    pore = n.noise(260, detail=1)
    speck = n.math("GREATER_THAN", n.noise(90, detail=0), 0.68)

    skin = n.mix(blotch, (0.1, 0.075, 0.055), (0.17, 0.135, 0.1))
    skin = n.mix(plate, skin, (0.15, 0.125, 0.1))
    skin = n.mix(n.math("MULTIPLY", wrinkle, 0.5), skin, (0.05, 0.038, 0.028))
    skin = n.mix(n.math("MULTIPLY", speck, 0.25), skin, (0.06, 0.05, 0.04))
    skin = n.mix(n.math("MAXIMUM", g, rim), skin, (0.05, 0.04, 0.032))
    skin = n.mix(n.math("MULTIPLY", below, 0.6), skin, (0.07, 0.06, 0.05))

    rough = n.lerp(plate, n.lerp(wrinkle, 0.38, 0.6), 0.34)
    rough = n.lerp(n.math("MAXIMUM", g, rim), rough, 0.6)
    height = n.math("ADD", n.math("MULTIPLY", wrinkle, 0.8), n.math("MULTIPLY", pore, 0.2))
    height = n.math("SUBTRACT", height, n.math("MULTIPLY", n.math("MAXIMUM", g, rim), 0.6))
    n.out(**{"Base Color": skin, "Roughness": rough, "Normal": n.bump(height, distance=0.006)})


def shade_chitin(mat, n):
    """Hard, glossy shell for the head and legs, a little darker than the body."""
    grain = n.noise(40, detail=5)
    fine = n.noise(300, detail=1)
    color = n.mix(grain, (0.07, 0.055, 0.042), (0.13, 0.105, 0.08))
    rough = n.lerp(grain, 0.28, 0.42)
    height = n.math("ADD", n.math("MULTIPLY", grain, 0.6), n.math("MULTIPLY", fine, 0.2))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0015)})
