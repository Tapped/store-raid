"""
Flashlight item: a black aluminium torch with a knurled grip, a finned head flaring out to the
lens, and a rubber switch on top. Lathed along x, the lens at +x and the switch on top (+z).

The lens has its own plain material, "lens", for the game to light up when the flashlight is on.
"""

import math

import lib

ITEM = "flashlight"
TRIS = 3500
AO_DISTANCE = 0.015

# Along x, in meters from the middle: the tail end, where the grip ends, the head and the lens.
TAIL = -0.125  # the lanyard loop sticks out 5 mm past it
LOOP = 0.005
LENS = 0.13
BODY = 0.019  # the grip's radius
HEAD = 0.031  # the bezel's radius
GLASS = 0.025
GRIP = (-0.102, 0.0)
SWITCH = -0.03


def build():
    w, d, h = lib.item_size("flashlight")
    assert abs(LENS - TAIL + LOOP - w) < 1e-6 and abs(2 * HEAD - h) < 1e-6

    # The shell, as (x, radius) from the tail to the lip round the lens and back in behind it.
    profile = [
        (TAIL, 0.0),
        (TAIL, 0.012),
        (TAIL + 0.001, 0.017),
        (TAIL + 0.004, 0.0195),
        (-0.109, 0.0195),
        (-0.108, 0.0172),
        (-0.105, 0.0172),
        (-0.104, BODY),
        (0.025, BODY),
        (0.034, 0.0205),
        (0.07, 0.0285),
        (0.076, 0.029),
    ]
    # Cooling fins round the head.
    x = 0.078
    for _ in range(5):
        profile += [(x, 0.0275), (x + 0.003, 0.0275), (x + 0.0035, 0.0295), (x + 0.006, 0.0295)]
        x += 0.0065
    profile += [
        (x + 0.002, 0.03),
        (0.118, 0.03),
        (0.119, HEAD),
        (LENS - 0.001, HEAD),
        (LENS, HEAD - 0.0015),
        (LENS, GLASS + 0.0008),
        (LENS - 0.005, GLASS),
    ]
    lib.lathe("shell", profile, axis="x", mat=shell_material(), sides=32)

    lib.cylinder("lens", GLASS, 0.002, (LENS - 0.0035, 0, 0), axis="x", mat=lens_material(),
                 sides=32)

    # The switch: a rubber dome in a raised boot on top of the grip.
    rubber = lib.material("rubber", (0.012, 0.012, 0.013), roughness=0.85)
    lib.cylinder("boot", 0.0095, 0.012, (SWITCH, 0, BODY), mat=rubber, sides=20, bevel=0.002)
    lib.ellipsoid("switch", (0.0068, 0.0068, 0.004), (SWITCH, 0, BODY + 0.006), mat=rubber,
                  segments=16, rings=8)

    # A lanyard loop at the tail.
    steel = lib.material("steel", (0.5, 0.5, 0.52), roughness=0.3, metallic=1)
    loop = [
        (TAIL - (LOOP - 0.0014) * math.sin(a), 0.0, 0.0105 * math.cos(a))
        for a in (math.pi * (i / 10 - 0.5) * 1.6 for i in range(11))
    ]
    lib.tube("loop", [(x, 0, z) for x, _, z in loop], [0.0014] * len(loop), mat=steel, sides=6)


def lens_material():
    """
    The reflector seen through the glass: bright faceted rings round a yellow LED in the middle.
    Named "lens", for the game to find and light.
    """
    mat, n = lib.procedural("lens", 256)
    _, y, z = n.xyz()
    radius = n.math("SQRT", n.math("ADD", n.math("MULTIPLY", y, y), n.math("MULTIPLY", z, z)))
    rings = n.stripes(radius, 0.0035, 0.5)
    led = n.math("LESS_THAN", radius, 0.0035)
    color = n.mix(rings, (0.32, 0.33, 0.34), (0.5, 0.51, 0.52))
    color = n.mix(n.math("LESS_THAN", radius, 0.006), color, (0.04, 0.04, 0.04))
    color = n.mix(led, color, (0.6, 0.5, 0.18))
    n.out(**{"Base Color": color, "Roughness": n.lerp(rings, 0.35, 0.2)})
    return mat


def shell_material():
    """Black anodised aluminium, worn bright on edges, knurled in diamonds on the grip."""
    mat, n = lib.procedural("shell", 1024)
    x, y, z = n.xyz()
    # Around the axis in meters of surface, so the diamonds come out square.
    around = n.math("MULTIPLY", n.math("ARCTAN2", z, y), BODY)
    pitch = 0.0028
    a = n.stripes(n.math("ADD", x, around), pitch, 0.5)
    b = n.stripes(n.math("SUBTRACT", x, around), pitch, 0.5)
    grip = n.region((GRIP[0], None, None), (GRIP[1], None, None))
    knurl = n.math("MULTIPLY", grip, n.math("MULTIPLY", a, b))

    wear = n.math("GREATER_THAN", n.noise(140, detail=3), 0.7)
    scuffs = n.math("MULTIPLY", wear, n.noise(1500, detail=1))
    color = n.mix(scuffs, (0.016, 0.016, 0.018), (0.06, 0.06, 0.064))
    color = n.mix(n.math("MULTIPLY", knurl, 0.6), color, (0.05, 0.05, 0.055))
    n.out(**{
        "Base Color": color,
        "Roughness": n.lerp(knurl, n.lerp(scuffs, 0.38, 0.25), 0.5),
        "Metallic": 0.6,
        "Normal": n.bump(n.math("SUBTRACT", 1, knurl), distance=0.0008),
    })
    return mat
