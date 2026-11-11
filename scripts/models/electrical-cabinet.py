"""
Electrical cabinet: a grey steel distribution board on a black plinth against the wall, one door
with a swing handle, a hazard label and a circuit card, louvres low down, and two conduits rising
out of its top and bending back into the wall. Origin on the floor, in the middle of its footprint.
"""

import lib

TRIS = 1200
AO_DISTANCE = 0.08

W, H, D = 0.8, 1.9, 0.4
PLINTH = 0.08
TOP = 1.82  # the top of the body; the conduits rise above it
BACK = D / 2  # the wall
FRONT = -D / 2 + 0.054  # the body's front; the door and handle stand proud of it
DOOR = (0.74, 1.62)
DOOR_Z = PLINTH + 0.05
HANDLE = (0.28, 1.05)

BOLT = [(0.012, 0.075), (-0.012, 0.005), (0.004, 0.005), (-0.01, -0.07), (0.016, 0.0),
        (0.0, 0.0), (0.02, 0.075)]


def build():
    steel = cabinet_paint()
    black = lib.material("plinth", (0.018, 0.018, 0.018), roughness=0.6)
    lib.box("plinth", (W - 0.04, D - 0.04, PLINTH), (0, 0.02, PLINTH / 2), black, bevel=0.004,
            segments=1)
    body_d = BACK - FRONT
    lib.box("body", (W, body_d, TOP - PLINTH), (0, FRONT + body_d / 2, (TOP + PLINTH) / 2), steel,
            bevel=0.006, segments=2)
    lib.box("roof", (W, body_d + 0.006, 0.025), (0, FRONT + body_d / 2 - 0.003, TOP),
            steel, bevel=0.004, segments=1)
    dw, dh = DOOR
    lib.box("door", (dw, 0.018, dh), (0, FRONT - 0.009, DOOR_Z + dh / 2), steel, bevel=0.005,
            segments=2)
    door_front = FRONT - 0.018

    # Hinges down the left, a swing handle and lock on the right.
    chrome = lib.material("chrome", (0.4, 0.4, 0.4), roughness=0.3, metallic=1)
    for z in (DOOR_Z + 0.15, DOOR_Z + dh / 2, DOOR_Z + dh - 0.15):
        lib.cylinder("hinge", 0.008, 0.06, (-dw / 2 - 0.002, door_front + 0.006, z), mat=chrome,
                     sides=8)
    hx, hz = HANDLE
    dark = lib.material("handle", (0.025, 0.025, 0.027), roughness=0.4)
    lib.box("escutcheon", (0.045, 0.01, 0.16), (hx, door_front - 0.005, hz), dark, bevel=0.004,
            segments=1)
    lib.box("lever", (0.026, 0.03, 0.12), (hx, door_front - 0.022, hz - 0.015), dark,
            bevel=0.006, segments=1)
    lib.cylinder("lock", 0.009, 0.006, (hx, door_front - 0.012, hz + 0.06), axis="y", mat=chrome,
                 sides=8)

    # A hazard triangle, high on the door, and a circuit card in a holder beneath it.
    yellow = lib.material("hazard", (0.6, 0.38, 0.0), roughness=0.5)
    ink = lib.material("ink", (0.01, 0.01, 0.01), roughness=0.5)
    zt = DOOR_Z + dh - 0.32
    y = door_front - 0.0004

    def tri(size):
        return [(-size, -size * 0.866), (size, -size * 0.866), (0, size * 0.866)]

    lib.shape("hazard-rim", tri(0.075), (0, y, zt), depth=0.0006, mat=ink)
    lib.shape("hazard", tri(0.06), (0, y - 0.0003, zt - 0.002), depth=0.0006, mat=yellow)
    lib.shape("bolt", BOLT, (-0.005, y - 0.0006, zt - 0.01), depth=0.0006, mat=ink)
    lib.box("card", (0.24, 0.004, 0.16), (0, door_front - 0.002, zt - 0.22), card_material(),
            bevel=0.002, segments=1)

    # Conduits out of the top, through glands, bending back into the wall above.
    galv = lib.material("conduit", (0.42, 0.42, 0.41), roughness=0.45, metallic=0.8)
    for x in (-0.22, 0.12):
        lib.cylinder("gland", 0.026, 0.03, (x, 0.02, TOP + 0.02), mat=dark, sides=8)
        path = [(x, 0.02, TOP), (x, 0.02, 1.845), (x, 0.035, 1.868), (x, 0.07, 1.88),
                (x, BACK, 1.88)]
        lib.tube("conduit", path, [0.02] * len(path), mat=galv, sides=8)


def cabinet_paint():
    """
    Light grey powder coat on steel: louvres stamped low in the door, scuffed and rusting at the
    foot, salt-chalked, the top thick with dust, a grubby patch round the handle.
    """
    mat, n = lib.procedural("cabinet", 1024)
    x, y, z = n.xyz()
    front = n.math("LESS_THAN", y, FRONT - 0.017)
    louvres = n.math("MULTIPLY", n.math("MULTIPLY", front, n.region(
        (-0.22, None, DOOR_Z + 0.06), (0.22, None, DOOR_Z + 0.26))), n.stripes(z, 0.022, 0.45))
    hx, hz = HANDLE
    near = n.math("SUBTRACT", 1, n.math("DIVIDE", n.math("ADD", n.math("ABSOLUTE", n.math(
        "SUBTRACT", x, hx)), n.math("ABSOLUTE", n.math("SUBTRACT", z, hz))), 0.2))
    grubby = n.math("MULTIPLY", lib.smoothstep(n, near, 0.0, 0.6), n.noise(30, detail=3))
    paint = n.mix(louvres, (0.2, 0.21, 0.2), (0.015, 0.015, 0.015))
    paint = n.mix(n.math("MULTIPLY", grubby, 0.7), paint, (0.07, 0.065, 0.055))
    # Mop water and salt: rust blooming up from the plinth, scuffs from trolleys and boots.
    creep = n.math("ADD", PLINTH + 0.02, n.math("MULTIPLY", n.noise(7, detail=4), 0.16))
    rot = lib.smoothstep(n, n.math("SUBTRACT", creep, z), 0.0, 0.03)
    scuffs = n.math("MULTIPLY", lib.smoothstep(n, n.math("SUBTRACT", 0.5, z), 0.0, 0.2),
                    lib.smoothstep(n, n.noise(12, detail=6, roughness=0.65), 0.6, 0.65))
    paint = n.mix(scuffs, paint, (0.3, 0.29, 0.27))
    paint = n.mix(rot, paint, n.mix(n.noise(50, detail=3), (0.07, 0.025, 0.01), (0.16, 0.06, 0.02)))
    height = n.math("MULTIPLY", louvres, -0.8)
    height = n.math("ADD", height, n.math("MULTIPLY", rot, n.noise(80, detail=4)))
    height = n.math("SUBTRACT", height, n.math("MULTIPLY", scuffs, 0.3))
    n.out(**lib.weathered(n, paint, rough=0.5, chips=0.7, rust=0.8, dirt=1.0, dust=1.0,
                          edge_wear=0.7, floor=0.0, height=height, bump=0.003, seed=2))
    return mat


def card_material():
    """A circuit card behind scratched plastic: rows of typed lines, yellowed, one crossed out."""
    mat, n = lib.procedural("card", 256)
    x, _, z = n.xyz()
    lines = n.math("MULTIPLY", n.stripes(z, 0.012, 0.35),
                   n.math("GREATER_THAN", n.noise(70, detail=0, vector=n.vec(x, z)), 0.4))
    lines = n.math("MULTIPLY", lines, n.math("LESS_THAN", n.math("ABSOLUTE", x), 0.1))
    paper = n.mix(n.noise(20, detail=3), (0.42, 0.38, 0.27), (0.5, 0.46, 0.34))
    color = n.mix(n.math("MULTIPLY", lines, 0.8), paper, (0.03, 0.03, 0.05))
    n.out(**{"Base Color": color, "Roughness": n.lerp(n.noise(200, detail=2), 0.15, 0.4)})
    return mat
