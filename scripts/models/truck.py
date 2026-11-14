"""
The crew's truck: an old cab-over box truck, a removal firm's once, its name half gone from the
sides. The cargo box is open at the back, its roller door run up, with a ramp down to the ground.
Inside, a bench along each wall behind the cab seats five a side, facing each other, ten in all;
the back half of the floor is clear for loot. A caged lamp on the ceiling glows (glow-lamp).

The origin is on the ground at the middle of the cargo box. The cab is the front (-y here, +z in the
game); the ramp runs out behind. The game's collision is written from the constants below.
"""

import math

from mathutils import Vector

import lib
from cargo import Field, Stencil, normal, painted_wear, smooth

OUT = "models/level/truck.glb"
ORIGIN = "model"
TRIS = 30000
ATLAS = 4096
AO = 2048
AO_DISTANCE = 0.4

# The cargo box, outside: x across, y from the bulkhead behind the cab to the open back.
W = 2.5
FRONT, REAR = -3.1, 3.1
TOP = 3.3
# Inside it.
FLOOR = 0.95  # the floor's height above the ground
IN_X = 1.19  # the walls' inner faces, either side
IN_FRONT, IN_REAR = -3.03, 3.07
CEILING = FLOOR + 2.2
OPENING = 1.11  # half the width between the rear posts

# The benches: from the bulkhead back, five seats each.
SEATS = 5
SEAT_PITCH = 0.56
SEAT_DEPTH = 0.45
SEAT_HEIGHT = 0.45  # above the floor
BENCH = (-3.0, -0.1)  # along y

# The ramp, from the floor's edge to the ground.
RAMP_END = 5.9
RAMP_HALF = 1.05

# The cab.
CAB_X = 1.15
CAB_FRONT, CAB_REAR = -5.1, -3.2
CAB_TOP = 2.8

# Wheels.
R = 0.47
TYRE = 0.27
FRONT_AXLE, REAR_AXLE = -4.2, 1.5
RAIL_X = 0.43  # the chassis rails
RAIL_TOP = 0.85


def prism(name, points, x0, x1, mat, bevel=0.0, segments=2):
    """An outline of (y, z) points drawn on the side, stretched across from x0 to x1."""
    obj = lib.shape(name, points, at=((x0 + x1) / 2, 0, 0), depth=abs(x1 - x0), mat=mat,
                    facing="x")
    return lib._bevel(obj, bevel, segments)


def build():
    mats = {
        "panel": panel_material(),
        "cab": cab_material(),
        "steel": steel_material(),
        "alu": alu_material(),
        "wood": wood_material(),
        "seat": seat_material(),
        "tyre": tyre_material(),
        "rim": lib.material("rim", (0.2, 0.2, 0.19), roughness=0.6, metallic=0.15),
        "glass": lib.material("glass", (0.008, 0.011, 0.014), roughness=0.07),
        "rubber": lib.material("rubber", (0.012, 0.012, 0.012), roughness=0.85),
        "plastic": lib.material("plastic", (0.028, 0.028, 0.03), roughness=0.6),
        "belt": lib.material("belt", (0.02, 0.022, 0.024), roughness=0.75),
        "rivet": lib.material("rivet", (0.3, 0.3, 0.29), roughness=0.45, metallic=0.3),
        "red": lib.material("lens-red", (0.22, 0.008, 0.006), roughness=0.25),
        "amber": lib.material("lens-amber", (0.45, 0.16, 0.01), roughness=0.25),
        "lens": lib.material("lens-clear", (0.45, 0.45, 0.4), roughness=0.12, metallic=0.2),
        "plate": lib.material("plate", (0.38, 0.38, 0.34), roughness=0.5),
        "glow": lib.material("glow-lamp", (0.8, 0.6, 0.3), roughness=0.3,
                             emission=(1.0, 0.72, 0.38), strength=4.0),
    }
    cargo_box(mats)
    shutter(mats)
    benches(mats)
    lamp(mats)
    ramp(mats)
    chassis(mats)
    cab(mats)


# --- The cargo box ------------------------------------------------------------------------------


def cargo_box(m):
    length = REAR - FRONT
    mid = FLOOR + (CEILING - FLOOR) / 2
    # The floor, on the chassis.
    lib.box("floor", (W - 0.08, length - 0.04, 0.1), (0, 0, FLOOR - 0.05), m["wood"])
    for s in (-1, 1):
        # Each wall: a skin outside, plywood inside, rails along the bottom and top.
        lib.box("side", (0.02, length - 0.1, TOP - 0.94), (s * (W / 2 - 0.012), 0, (TOP + 0.9) / 2 - 0.02),
                m["panel"])
        lib.box("lining", (0.02, IN_REAR - IN_FRONT, CEILING - FLOOR),
                (s * (IN_X + 0.01), (IN_FRONT + IN_REAR) / 2, mid), m["wood"])
        lib.box("bottom-rail", (0.05, length, 0.16), (s * (W / 2 - 0.015), 0, 0.93), m["alu"],
                bevel=0.006, segments=1)
        lib.box("top-rail", (0.05, length, 0.12), (s * (W / 2 - 0.015), 0, TOP - 0.06), m["alu"],
                bevel=0.006, segments=1)
        lib.box("front-post", (0.08, 0.08, TOP - 0.85), (s * (W / 2 - 0.03), FRONT + 0.03, (TOP + 0.85) / 2),
                m["alu"], bevel=0.008, segments=1)
        lib.box("rear-post", (0.14, 0.11, TOP - 0.83), (s * (W / 2 - 0.07), REAR - 0.05, (TOP + 0.83) / 2),
                m["alu"], bevel=0.008, segments=1)
        # Rivets along the rails and up the posts.
        for i in range(25):
            y = FRONT + 0.15 + i * (length - 0.3) / 24
            for z in (0.93, TOP - 0.06):
                lib.cylinder("rivet", 0.011, 0.008, (s * (W / 2 + 0.011), y, z), axis="x",
                             mat=m["rivet"], sides=6)
        for i in range(9):
            z = 1.15 + i * 0.235
            lib.cylinder("rivet", 0.011, 0.008, (s * (W / 2 + 0.011), FRONT + 0.03, z), axis="x",
                         mat=m["rivet"], sides=6)
            lib.cylinder("rivet", 0.011, 0.008, (s * (W / 2 - 0.07), REAR + 0.006, z), axis="y",
                         mat=m["rivet"], sides=6)
        # Lashing rails inside: one above the benches the whole way, one low where the loot goes.
        lib.box("lashing", (0.012, IN_REAR - IN_FRONT - 0.1, 0.06), (s * (IN_X - 0.006), 0.02, FLOOR + 1.35),
                m["alu"])
        lib.box("lashing", (0.012, IN_REAR - 0.1, 0.06), (s * (IN_X - 0.006), IN_REAR / 2 + 0.05, FLOOR + 0.5),
                m["alu"])
        # A grab handle on each rear post.
        x = s * (W / 2 - 0.07)
        lib.tube("grab", [(x, REAR + 0.005, 1.35), (x, REAR + 0.06, 1.4), (x, REAR + 0.06, 1.7),
                          (x, REAR + 0.005, 1.75)], [0.012] * 4, mat=m["steel"], sides=6)
    # The bulkhead behind the cab.
    lib.box("bulkhead", (W - 0.04, 0.02, TOP - 0.94), (0, FRONT + 0.012, (TOP + 0.9) / 2 - 0.02), m["panel"])
    lib.box("lining", (2 * IN_X, 0.02, CEILING - FLOOR), (0, IN_FRONT - 0.01, mid), m["wood"])
    lib.box("front-rail", (W - 0.1, 0.05, 0.12), (0, FRONT + 0.015, TOP - 0.06), m["alu"], bevel=0.006,
            segments=1)
    lib.box("front-rail", (W - 0.1, 0.05, 0.16), (0, FRONT + 0.015, 0.93), m["alu"], bevel=0.006,
            segments=1)
    # The roof, and the ceiling under it.
    lib.box("roof", (W - 0.04, length - 0.04, 0.02), (0, 0, TOP - 0.05), m["panel"])
    lib.box("ceiling", (2 * IN_X, IN_REAR - IN_FRONT, 0.02), (0, (IN_FRONT + IN_REAR) / 2, CEILING + 0.01),
            m["wood"])
    # The back: a header the door rolls up behind, and a steel sill.
    lib.box("header", (W - 0.26, 0.12, TOP - 2.96), (0, REAR - 0.055, (TOP + 2.96) / 2), m["alu"],
            bevel=0.008, segments=1)
    lib.box("sill", (W - 0.02, 0.11, 0.13), (0, REAR - 0.05, FLOOR - 0.066), m["steel"], bevel=0.006,
            segments=1)
    for x in (-0.95, 0.95):
        lib.box("marker", (0.1, 0.02, 0.035), (x, REAR + 0.012, TOP - 0.1), m["red"])
        lib.box("marker", (0.1, 0.02, 0.035), (x, FRONT - 0.045, TOP - 0.06), m["amber"])


def shutter(m):
    """The roller door, run up: its last slats hang in the top of the opening, in their tracks."""
    y = REAR - 0.14
    for i in range(5):
        lib.box("slat", (2 * OPENING - 0.04, 0.018, 0.064), (0, y, 3.13 - i * 0.066), m["alu"],
                bevel=0.006, segments=1)
    lib.box("bottom-bar", (2 * OPENING - 0.04, 0.035, 0.05), (0, y, 2.81), m["alu"], bevel=0.005,
            segments=1)
    lib.box("seal", (2 * OPENING - 0.04, 0.02, 0.02), (0, y, 2.777), m["rubber"])
    lib.box("latch", (0.16, 0.02, 0.04), (0, y + 0.025, 2.81), m["steel"])
    lib.box("strap", (0.035, 0.004, 0.3), (0.5, y + 0.02, 2.64), m["belt"])
    for s in (-1, 1):
        lib.box("track", (0.035, 0.05, 2.96 - FLOOR), (s * (OPENING - 0.017), y, (2.96 + FLOOR) / 2),
                m["alu"])


def benches(m):
    y0, y1 = BENCH
    length = y1 - y0
    top = FLOOR + SEAT_HEIGHT
    for s in (-1, 1):
        cx = s * (IN_X - SEAT_DEPTH / 2)
        edge = s * (IN_X - SEAT_DEPTH + 0.015)
        lib.box("bench", (SEAT_DEPTH, length, 0.035), (cx, (y0 + y1) / 2, top - 0.088), m["wood"])
        lib.box("bench-rail", (0.03, length, 0.04), (edge, (y0 + y1) / 2, top - 0.125), m["steel"])
        lib.box("bench-rail", (0.03, length, 0.03), (s * (IN_X - 0.015), (y0 + y1) / 2, top - 0.12), m["steel"])
        for k in range(4):
            y = y0 + 0.04 + k * (length - 0.08) / 3
            lib.box("leg", (0.03, 0.03, SEAT_HEIGHT - 0.14), (edge, y, FLOOR + (SEAT_HEIGHT - 0.14) / 2),
                    m["steel"])
            lib.box("stay", (SEAT_DEPTH - 0.03, 0.025, 0.025), (cx, y, top - 0.125), m["steel"])
            # A brace from the foot of each leg up to the wall.
            lib.tube("brace", [(edge, y, FLOOR + 0.04), (s * (IN_X - 0.01), y, top - 0.14)], [0.011] * 2,
                     mat=m["steel"], sides=4)
        for i in range(SEATS):
            y = y1 - 0.38 - i * SEAT_PITCH
            lib.box("seat", (SEAT_DEPTH - 0.04, SEAT_PITCH - 0.04, 0.07), (cx - s * 0.005, y, top - 0.035),
                    m["seat"], bevel=0.02, segments=2)
            lib.box("back", (0.05, SEAT_PITCH - 0.06, 0.38), (s * (IN_X - 0.026), y, top + 0.33), m["seat"],
                    bevel=0.018, segments=2)
            # A lap belt lying across the seat, its buckle in the middle.
            lib.box("lap-belt", (SEAT_DEPTH - 0.06, 0.045, 0.006), (cx, y + 0.04, top + 0.002), m["belt"])
            lib.box("buckle", (0.06, 0.055, 0.016), (cx - s * 0.03, y + 0.04, top + 0.009), m["rivet"])
            lib.box("belt-anchor", (0.02, 0.045, 0.12), (s * (IN_X - 0.012), y + 0.04, top + 0.06), m["belt"])


def lamp(m):
    """A bulkhead lamp in a wire cage, on the ceiling over the benches."""
    x, y = 0.0, -1.6
    lib.cylinder("lamp-base", 0.075, 0.03, (x, y, CEILING - 0.015), mat=m["steel"], sides=10)
    lib.ellipsoid("lamp-glass", (0.05, 0.05, 0.065), (x, y, CEILING - 0.085), m["glow"], segments=10,
                  rings=6)
    for k in range(4):
        a = k * math.pi / 4
        c, sn = math.cos(a), math.sin(a)
        arc = [(-0.07, CEILING - 0.03), (-0.068, CEILING - 0.11), (-0.04, CEILING - 0.16),
               (0.04, CEILING - 0.16), (0.068, CEILING - 0.11), (0.07, CEILING - 0.03)]
        lib.tube("lamp-cage", [(x + u * c, y + u * sn, z) for u, z in arc], [0.007] * 6, mat=m["rivet"],
                 sides=3)
    # Its cable, clipped along the ceiling to the bulkhead.
    lib.tube("lamp-cable", [(x, y - 0.07, CEILING - 0.008), (x, IN_FRONT + 0.2, CEILING - 0.008),
                            (x + 0.3, IN_FRONT + 0.01, CEILING - 0.008)], [0.007] * 3, mat=m["rubber"],
             sides=4)


def ramp(m):
    """A loading ramp hooked on the sill, down to the ground behind."""
    y0 = REAR + 0.01
    slope = (FLOOR - 0.03) / (RAMP_END - y0)

    def at(y, lift=0.0):
        return (y, FLOOR - (y - y0) * slope + lift)

    deck = [at(y0), at(RAMP_END), (RAMP_END, 0.0), (RAMP_END - 0.25, 0.0), at(y0, -0.07)]
    prism("ramp", deck, -RAMP_HALF, RAMP_HALF, m["alu"])
    for s in (-1, 1):
        kerb = [at(y0, 0.05), at(RAMP_END - 0.15, 0.05), at(RAMP_END - 0.1), at(y0)]
        prism("ramp-kerb", kerb, s * RAMP_HALF, s * (RAMP_HALF - 0.04), m["alu"])
        # Beams under each edge, and a trestle half way down.
        beam = [at(y0 + 0.05, -0.07), at(RAMP_END - 0.5, -0.07), at(RAMP_END - 0.5, -0.15),
                at(y0 + 0.05, -0.19)]
        prism("ramp-beam", beam, s * (RAMP_HALF - 0.1), s * (RAMP_HALF - 0.16), m["alu"])
        ym = (y0 + RAMP_END) / 2 - 0.2
        zm = at(ym, -0.15)[1]
        lib.box("trestle", (0.05, 0.05, zm), (s * (RAMP_HALF - 0.13), ym, zm / 2), m["steel"])
        lib.box("trestle-foot", (0.16, 0.16, 0.012), (s * (RAMP_HALF - 0.13), ym, 0.006), m["steel"])
        lib.box("ramp-hook", (0.12, 0.07, 0.03), (s * (RAMP_HALF - 0.2), REAR - 0.02, FLOOR + 0.012), m["steel"])
    lib.box("trestle-bar", (2 * RAMP_HALF - 0.26, 0.04, 0.04), (0, ym, zm * 0.55), m["steel"])


# --- Chassis and wheels -------------------------------------------------------------------------


def wheel(m, x, y, out, dish):
    """
    A wheel centred on (x, y), its outer side towards `out` (±1). `dish`: "front" bulges out at the
    hub, "rear" is the outer of a pair, dished deep, None the inner one, of which only the tyre shows.
    """
    h = TYRE / 2
    tyre = [(-h + 0.03, 0.3), (-h, 0.36), (-h, 0.425), (-h + 0.035, R), (h - 0.035, R), (h, 0.425),
            (h, 0.36), (h - 0.03, 0.3)]
    lib.lathe("tyre", tyre, (x, y, R), axis="x", mat=m["tyre"], sides=20)
    o = out
    rim = [(-o * (h - 0.03), 0.0), (-o * (h - 0.03), 0.31), (o * (h - 0.02), 0.31)]
    if dish == "front":
        rim += [(o * (h - 0.05), 0.285), (o * (h - 0.1), 0.2), (o * (h - 0.03), 0.14),
                (o * (h + 0.03), 0.11), (o * (h + 0.03), 0.0)]
    elif dish == "rear":
        rim += [(o * (h - 0.04), 0.285), (o * (h - 0.19), 0.21), (o * (h - 0.19), 0.14),
                (o * (h - 0.06), 0.11), (o * (h - 0.06), 0.0)]
    else:
        rim += [(o * (h - 0.02), 0.0)]
    lib.lathe("rim", rim, (x, y, R), axis="x", mat=m["rim"], sides=16)
    if dish:
        # Wheel nuts round the hub.
        ring, depth = (0.165, h - 0.08) if dish == "front" else (0.175, h - 0.185)
        for k in range(8):
            a = k * math.pi / 4
            lib.cylinder("nut", 0.016, 0.03, (x + o * depth, y + ring * math.cos(a), R + ring * math.sin(a)),
                         axis="x", mat=m["rivet"], sides=6)


def chassis(m):
    steel = m["steel"]
    y0, y1 = CAB_FRONT + 0.15, REAR - 0.1
    for s in (-1, 1):
        lib.box("chassis-rail", (0.09, y1 - y0, 0.22), (s * RAIL_X, (y0 + y1) / 2, RAIL_TOP - 0.11), steel)
        # Wheels: one each side at the front, pairs at the back.
        lib.box("spring", (0.08, 1.3, 0.07), (s * RAIL_X * 1.25, REAR_AXLE, R + 0.1), steel)
        lib.box("spring", (0.08, 1.2, 0.06), (s * RAIL_X * 1.25, FRONT_AXLE, R + 0.1), steel)
        wheel(m, s * (CAB_X - TYRE / 2 - 0.01), FRONT_AXLE, s, "front")
        wheel(m, s * (W / 2 - TYRE / 2), REAR_AXLE, s, "rear")
        wheel(m, s * (W / 2 - TYRE * 1.5 - 0.03), REAR_AXLE, s, None)
        # Mud flaps behind the rear wheels, and a guard over them.
        lib.box("mud-flap", (0.6, 0.015, 0.52), (s * 0.94, REAR_AXLE + 0.66, 0.6), m["rubber"])
        lib.box("mudguard", (0.62, 1.32, 0.02), (s * 0.94, REAR_AXLE, RAIL_TOP - 0.05 + 0.14), m["plastic"])
        # Side guards between the axles.
        for z in (0.42, 0.64):
            lib.box("side-guard", (0.03, 3.1, 0.1), (s * (W / 2 - 0.04), -1.25, z), m["alu"], bevel=0.008,
                    segments=1)
        for y in (-2.6, -1.25, 0.1):
            lib.box("guard-hanger", (0.05, 0.05, 0.5), (s * (W / 2 - 0.08), y, 0.62), steel)
        # Tail lights.
        lib.box("light-box", (0.42, 0.06, 0.14), (s * 0.92, REAR - 0.03, 0.66), m["plastic"], bevel=0.008,
                segments=1)
        lib.box("tail-light", (0.2, 0.012, 0.11), (s * 0.99, REAR + 0.004, 0.66), m["red"])
        lib.box("indicator", (0.1, 0.012, 0.11), (s * 0.83, REAR + 0.004, 0.66), m["amber"])
        lib.box("reverse-light", (0.07, 0.012, 0.11), (s * 0.745, REAR + 0.004, 0.66), m["lens"])
    for y in (-4.8, -3.4, -2.2, -0.9, 0.5, 2.3, y1 - 0.05):
        lib.box("cross-member", (2 * RAIL_X, 0.08, 0.14), (0, y, RAIL_TOP - 0.12), steel)
    # Axles.
    lib.cylinder("rear-axle", 0.075, W - 2 * TYRE, (0, REAR_AXLE, R), axis="x", mat=steel, sides=8)
    lib.ellipsoid("differential", (0.24, 0.26, 0.22), (0.05, REAR_AXLE, R), steel, segments=10, rings=6)
    lib.cylinder("prop-shaft", 0.045, 4.0, (0.05, REAR_AXLE - 2.2, R + 0.08), axis="y", mat=steel, sides=6)
    lib.box("front-axle", (2 * CAB_X - 2 * TYRE, 0.09, 0.09), (0, FRONT_AXLE, R - 0.05), steel)
    lib.box("gearbox", (0.5, 1.2, 0.42), (0.03, -3.9, 0.62), steel, bevel=0.03, segments=1)
    # A fuel tank on the left, a battery box and air tanks on the right, the exhaust beneath.
    lib.cylinder("fuel-tank", 0.26, 1.1, (-0.86, -2.35, 0.56), axis="y", mat=m["alu"], sides=14, bevel=0.02)
    for y in (-2.7, -2.0):
        lib.box("tank-strap", (0.56, 0.04, 0.56), (-0.86, y, 0.56), steel)
    lib.cylinder("fuel-cap", 0.04, 0.05, (-1.0, -2.75, 0.77), mat=m["plastic"], sides=8)
    lib.box("battery-box", (0.5, 0.75, 0.42), (0.9, -2.5, 0.58), steel, bevel=0.012, segments=1)
    lib.box("battery-lid", (0.52, 0.77, 0.03), (0.9, -2.5, 0.8), m["plastic"])
    for z in (0.5, 0.68):
        lib.cylinder("air-tank", 0.085, 0.7, (0.78, -1.45, z), axis="y", mat=steel, sides=8)
    lib.tube("exhaust", [(-0.2, -3.6, 0.5), (-0.3, -1.6, 0.45), (-0.45, 0.0, 0.42), (-0.75, 0.55, 0.4),
                         (-1.1, 0.62, 0.38)], [0.045] * 5, mat=steel, sides=6)
    lib.cylinder("silencer", 0.11, 0.7, (-0.3, -1.1, 0.45), axis="y", mat=steel, sides=8)
    # The rear underrun bar, with the number plate.
    lib.box("underrun", (W - 0.1, 0.1, 0.1), (0, REAR - 0.08, 0.5), steel, bevel=0.01, segments=1)
    for s in (-1, 1):
        lib.box("underrun-arm", (0.07, 0.08, 0.3), (s * RAIL_X, REAR - 0.1, 0.62), steel)
    lib.box("number-plate", (0.5, 0.008, 0.11), (0, REAR + 0.004, 0.66), m["plate"])


# --- The cab -------------------------------------------------------------------------------------


def screen(z):
    """The windscreen's line: y at height z."""
    return CAB_FRONT + 0.13 * (z - 1.72) / 0.9


def cab(m):
    body, plastic, glass = m["cab"], m["plastic"], m["glass"]
    arch = 0.6
    ys = math.sqrt(arch * arch - (RAIL_TOP - R) ** 2)
    outline = [(CAB_REAR, RAIL_TOP), (FRONT_AXLE + ys, RAIL_TOP)]
    for k in range(1, 8):
        a = math.atan2(RAIL_TOP - R, ys) + k * (math.pi - 2 * math.atan2(RAIL_TOP - R, ys)) / 8
        outline.append((FRONT_AXLE + arch * math.cos(a), R + arch * math.sin(a)))
    outline += [
        (FRONT_AXLE - ys, RAIL_TOP), (FRONT_AXLE - ys - 0.02, 0.66), (CAB_FRONT + 0.05, 0.66),
        (CAB_FRONT, 0.74), (CAB_FRONT, 1.72), (screen(2.62), 2.62), (CAB_FRONT + 0.28, CAB_TOP - 0.02),
        (CAB_REAR - 0.12, CAB_TOP), (CAB_REAR, CAB_TOP - 0.1),
    ]
    prism("cab", outline, -CAB_X, CAB_X, body, bevel=0.045, segments=3)

    # What shows through the arches: the engine's bulk between the wheels.
    lib.box("engine", (2 * CAB_X - 2 * TYRE - 0.12, 1.5, 0.75), (0, FRONT_AXLE + 0.05, 0.8), m["rubber"])

    # Glass: the windscreen, the door windows, a small one behind.
    lean = Vector((0.9, -0.13)).normalized()  # out of the screen, in (y, z) turned: (-z, y)
    out = (-lean.x * 0.012, lean.y * 0.012)
    z0, z1 = 1.82, 2.56
    pane = [(screen(z0) + out[0], z0 - out[1]), (screen(z1) + out[0], z1 - out[1]),
            (screen(z1) + 0.03, z1), (screen(z0) + 0.03, z0)]
    prism("windscreen", pane, -CAB_X + 0.13, CAB_X - 0.13, glass)
    prism("screen-seal", [(screen(z0 - 0.03) + out[0] * 0.5, z0 - 0.03), (screen(z1 + 0.03) + out[0] * 0.5, z1 + 0.03),
                          (screen(z1 + 0.03) + 0.03, z1 + 0.03), (screen(z0 - 0.03) + 0.03, z0 - 0.03)],
          -CAB_X + 0.1, CAB_X - 0.1, m["rubber"])
    for s in (-1, 1):
        x = s * (CAB_X + 0.002)
        side_glass = [(screen(1.8) + 0.2, 1.8), (screen(2.5) + 0.2, 2.5), (-3.95, 2.5), (-3.95, 1.8)]
        prism("door-glass", side_glass, x - s * 0.01, x + s * 0.004, glass)
        # The door: its shut lines, a handle, a step below.
        for name, size, at in (
            ("shut-line", (0.006, 0.012, 1.55), (x, -3.88, 1.72)),
            ("shut-line", (0.006, 0.012, 0.75), (x, CAB_FRONT + 0.2, 1.35)),
            ("shut-line", (0.006, 1.05, 0.012), (x, -4.4, 2.6)),
        ):
            lib.box(name, size, at, m["rubber"])
        lib.box("door-handle", (0.03, 0.14, 0.04), (x + s * 0.01, -4.02, 1.62), plastic, bevel=0.008,
                segments=1)
        lib.box("step", (0.06, 0.4, 0.035), (s * (CAB_X - 0.01), CAB_FRONT + 0.3, 0.6), m["steel"])
        # The wheel arch's flare, and a mud flap behind the wheel.
        pts = []
        for k in range(9):
            a = math.atan2(RAIL_TOP - R, ys) * 0.4 + k * (math.pi - 0.8 * math.atan2(RAIL_TOP - R, ys)) / 8
            pts.append((s * (CAB_X + 0.005), FRONT_AXLE + (arch + 0.01) * math.cos(a),
                        R + (arch + 0.01) * math.sin(a)))
        lib.tube("arch-flare", pts, [0.035] * 9, mat=plastic, sides=6)
        lib.box("mud-flap", (0.34, 0.015, 0.42), (s * (CAB_X - 0.17), CAB_REAR - 0.1, 0.62), m["rubber"])
        # Mirrors on two arms.
        mx = s * (CAB_X + 0.27)
        for z in (2.42, 1.9):
            lib.tube("mirror-arm", [(s * (CAB_X - 0.02), CAB_FRONT + 0.22, z), (mx, CAB_FRONT + 0.12, z)],
                     [0.013] * 2, mat=plastic, sides=5)
        lib.box("mirror", (0.2, 0.05, 0.42), (mx, CAB_FRONT + 0.11, 2.2), plastic, bevel=0.015, segments=1)
        lib.box("mirror-glass", (0.17, 0.004, 0.38), (mx, CAB_FRONT + 0.137, 2.2), m["lens"])
        lib.box("mirror", (0.2, 0.05, 0.16), (mx, CAB_FRONT + 0.11, 1.86), plastic, bevel=0.015, segments=1)
        # Lights in the front panel.
        yf = CAB_FRONT - 0.004
        lib.box("headlight", (0.3, 0.02, 0.17), (s * 0.82, yf, 0.98), m["lens"], bevel=0.004, segments=1)
        lib.box("front-indicator", (0.12, 0.02, 0.17), (s * 1.05, yf, 0.98), m["amber"])
        lib.box("roof-marker", (0.09, 0.03, 0.03), (s * 0.8, CAB_FRONT + 0.34, CAB_TOP + 0.005), m["amber"])
        # Wipers, parked.
        lib.box("wiper", (0.62, 0.012, 0.014), (s * 0.5 - 0.08, screen(1.86) - 0.018, 1.86), m["rubber"])
    # The grille, with bars across it, and a panel line below the windscreen.
    lib.box("grille", (1.3, 0.02, 0.36), (0, CAB_FRONT - 0.002, 1.3), plastic)
    for i in range(4):
        lib.box("grille-bar", (1.26, 0.012, 0.03), (0, CAB_FRONT - 0.014, 1.17 + i * 0.085), body)
    lib.box("panel-line", (2 * CAB_X - 0.12, 0.006, 0.012), (0, CAB_FRONT - 0.001, 1.6), m["rubber"])
    # The bumper, with the number plate and a tow eye.
    lib.box("bumper", (2 * CAB_X + 0.02, 0.16, 0.26), (0, CAB_FRONT - 0.05, 0.58), m["steel"], bevel=0.03,
            segments=2)
    lib.box("number-plate", (0.5, 0.008, 0.11), (0, CAB_FRONT - 0.133, 0.6), m["plate"])
    for s in (-1, 1):
        lib.box("fog-light", (0.16, 0.012, 0.08), (s * 0.85, CAB_FRONT - 0.131, 0.58), m["lens"])
    # A sun visor over the windscreen.
    visor = [(screen(2.62) - 0.02, 2.6), (screen(2.62) - 0.2, 2.52), (screen(2.62) - 0.2, 2.545),
             (screen(2.62) - 0.02, 2.64)]
    prism("visor", visor, -CAB_X + 0.06, CAB_X - 0.06, plastic)
    # Behind the cab: the air intake stack.
    lib.box("intake", (0.14, 0.09, 1.5), (-CAB_X + 0.2, CAB_REAR + 0.05, 2.0), plastic, bevel=0.02, segments=1)


# --- Materials ----------------------------------------------------------------------------------


def panel_material():
    """
    The box's skin: off-white painted aluminium sheets, grimy, streaked from the roof rail, with
    the removal firm's name on both sides, faded nearly to nothing.
    """
    mat, n = lib.procedural("panel", 2048)
    f = Field(n, 11)
    nx, _, _ = normal(n)
    side = smooth(n, n.math("ABSOLUTE", nx), 0.5, 0.8)

    stencil = Stencil("truck", {
        "name": [("NORDVIK", 0.52, False)],
        "trade": [("FLYTTEBYRÅ  ·  TRANSPORT", 0.15, False)],
    })
    on_px = n.math("MULTIPLY", smooth(n, nx, 0.5, 0.8), n.math("GREATER_THAN", f.x, W / 2 - 0.06))
    on_nx = n.math("MULTIPLY", smooth(n, nx, -0.5, -0.8), n.math("LESS_THAN", f.x, -W / 2 + 0.06))
    neg_y = n.math("MULTIPLY", f.y, -1)
    mask = 0.0
    for block, v0 in (("name", 1.85), ("trade", 1.5)):
        bw = stencil.width(block)
        for h, where in ((f.y, on_px), (neg_y, on_nx)):
            mask = n.math("MAXIMUM", mask, stencil.mask(n, block, h, f.z, -bw / 2, v0, where))
    # Sun-bleached and scrubbed at: mostly a ghost, darker where the paint was thickest.
    ghost = n.lerp(smooth(n, f.noise(1.6, 4), 0.35, 0.7), 0.3, 0.8)
    ghost = n.math("MULTIPLY", ghost, n.lerp(smooth(n, f.noise(14, 5), 0.45, 0.6), 0.6, 1.0))
    paint = n.mix(n.math("MULTIPLY", mask, ghost), (0.36, 0.35, 0.32), (0.035, 0.075, 0.115))

    # Sheets 1.24 m wide, lapped: a seam down each.
    seam = n.math("MULTIPLY", n.stripes(n.math("ADD", f.y, 3.1 + 0.006), 1.24, 0.012 / 1.24), side)
    out = lib.weathered(n, paint, rough=0.5, chips=0.25, rust=0.35, dirt=0.75, dust=0.5,
                        edge_wear=0.3, dents=1.6, floor=0.9, height=n.math("MULTIPLY", seam, -1.0),
                        bump=0.005, scale=1.6, seed=3.0)
    color = n.mix(n.math("MULTIPLY", seam, 0.6), out["Base Color"], (0.05, 0.045, 0.04))
    # Road dirt thrown up along the bottom.
    spray = n.math("MULTIPLY", smooth(n, f.z, 1.9, 0.95), smooth(n, f.noise(2.2, 4), 0.3, 0.7))
    out["Base Color"] = n.mix(n.math("MULTIPLY", spray, 0.5), color, (0.06, 0.05, 0.04))
    out["Roughness"] = n.lerp(spray, out["Roughness"], 0.9)
    n.out(**out)
    return mat


def cab_material():
    """The cab: petrol blue gone flat, rusting through at the arches and along the bottom."""
    mat, n = lib.procedural("cab", 2048)
    f = Field(n, 23)
    dy = n.math("SUBTRACT", f.y, FRONT_AXLE)
    dz = n.math("SUBTRACT", f.z, R)
    from_wheel = n.math("SQRT", n.math("ADD", n.math("MULTIPLY", dy, dy), n.math("MULTIPLY", dz, dz)))
    edge = n.math("MAXIMUM", smooth(n, from_wheel, 0.95, 0.6), smooth(n, f.z, 1.15, 0.7))
    color, rough, height = painted_wear(n, f, (0.014, 0.05, 0.065), wear=0.45, rust=0.55, chalk=0.22,
                                        top=CAB_TOP - 0.1, edge=edge, floor_dirt=0.7, salt=0.2)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0016)})
    return mat


def steel_material():
    """Chassis black: thick paint over rust, road dirt everywhere."""
    mat, n = lib.procedural("steel", 1024)
    f = Field(n, 37)
    color, rough, height = painted_wear(n, f, (0.018, 0.018, 0.02), wear=0.65, rust=0.7, chalk=0.2,
                                        top=1.0, floor_dirt=0.9, salt=0.3)
    # Inside the box the frames are only scuffed, not rusted by the road.
    dust = n.math("MULTIPLY", smooth(n, f.z, 0.9, 0.2), smooth(n, f.noise(4, 4), 0.3, 0.7))
    color = n.mix(n.math("MULTIPLY", dust, 0.5), color, (0.07, 0.06, 0.045))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0016)})
    return mat


def alu_material():
    """Bare aluminium: rails, posts, the roller door and the ramp, whose deck is ribbed for grip."""
    mat, n = lib.procedural("alu", 1024)
    x, y, z = n.xyz()
    _, _, nz = normal(n)
    on_ramp = n.math("MULTIPLY", n.math("GREATER_THAN", y, REAR + 0.02), smooth(n, nz, 0.5, 0.8))
    ribs = n.math("MULTIPLY", n.stripes(y, 0.05, 0.45), on_ramp)
    # Worn bright down the middle where boots and trolley wheels go.
    tread = n.math("MULTIPLY", on_ramp, smooth(n, n.math("ABSOLUTE", x), 0.9, 0.3))
    out = lib.galvanised(n, tone=0.5, dirt=0.6, dust=0.35, white_rust=0.5, dents=0.7,
                         height=n.math("MULTIPLY", ribs, 1.5), bump=0.004)
    grime = n.math("MULTIPLY", on_ramp, n.math("SUBTRACT", 1, n.math("MULTIPLY", tread, 0.8)))
    grime = n.math("MULTIPLY", grime, n.math("SUBTRACT", 1, ribs))
    out["Base Color"] = n.mix(n.math("MULTIPLY", grime, 0.6), out["Base Color"], (0.035, 0.03, 0.025))
    n.out(**out)
    n.bsdf.inputs["Metallic"].default_value = 0.35
    return mat


def wood_material():
    """
    The box's inside: a floor of hardwood boards run lengthwise, worn pale down the middle, and
    walls and ceiling of plywood sheets, scraped and scuffed at the height loads rub.
    """
    mat, n = lib.procedural("wood", 2048)
    f = Field(n, 51)
    nx, ny, nz = normal(n)
    flat = smooth(n, n.math("ABSOLUTE", nz), 0.5, 0.8)
    floor = n.math("MULTIPLY", flat, n.math("LESS_THAN", f.z, FLOOR + 1.0))

    # Boards: 0.145 m wide, each its own tone, grain along y, a dark gap between.
    across = n.math("DIVIDE", f.x, 0.145)
    board = n.math("FLOOR", across)
    tone = n.noise(1.0, detail=0, vector=n.vec(n.math("MULTIPLY", board, 7.31), 3.7, 2.2))
    grain = n.math("MULTIPLY", f.noise(2.5, 4, stretch=(28, 1, 28)), f.noise(14, 3, stretch=(40, 1, 40)))
    boards = n.mix(tone, (0.05, 0.03, 0.016), (0.11, 0.068, 0.036))
    boards = n.mix(n.math("MULTIPLY", smooth(n, grain, 0.18, 0.32), 0.5), boards, (0.03, 0.018, 0.01))
    path = n.math("MULTIPLY", smooth(n, n.math("ABSOLUTE", f.x), 0.75, 0.2),
                  smooth(n, f.noise(3, 4), 0.3, 0.65))
    boards = n.mix(n.math("MULTIPLY", path, 0.55), boards, (0.17, 0.125, 0.08))
    gap = n.math("LESS_THAN", n.math("FRACT", across), 0.04)
    boards = n.mix(gap, boards, (0.008, 0.006, 0.005))
    grit = n.math("MULTIPLY", smooth(n, n.math("ABSOLUTE", f.x), 0.6, 1.15), smooth(n, f.noise(5, 4), 0.35, 0.6))
    boards = n.mix(n.math("MULTIPLY", grit, 0.6), boards, (0.03, 0.026, 0.02))
    board_h = n.math("SUBTRACT", n.math("MULTIPLY", grain, 0.8), n.math("MULTIPLY", gap, 2.0))

    # Plywood: sheets 1.22 m wide, the face grain upright, its figure in broad flames.
    along = n.math("DIVIDE", n.math("ADD", n.math("ADD", f.x, f.y), 40.0), 1.22)
    sheet = n.math("FLOOR", along)
    stone = n.noise(1.0, detail=0, vector=n.vec(n.math("MULTIPLY", sheet, 5.17), 1.3, 9.2))
    figure = f.noise(1.6, 3, stretch=(9, 9, 1))
    fine = f.noise(12, 3, stretch=(40, 40, 1.5))
    ply = n.mix(stone, (0.15, 0.085, 0.035), (0.21, 0.125, 0.055))
    ply = n.mix(n.math("MULTIPLY", smooth(n, figure, 0.42, 0.6), 0.45), ply, (0.1, 0.052, 0.02))
    ply = n.mix(n.math("MULTIPLY", smooth(n, fine, 0.45, 0.6), 0.25), ply, (0.085, 0.045, 0.018))
    joint = n.math("LESS_THAN", n.math("FRACT", along), 0.006)
    ply = n.mix(joint, ply, (0.012, 0.009, 0.006))
    # Scrapes where furniture has been dragged along the walls, and dirt low down.
    band = n.math("MULTIPLY", smooth(n, f.z, FLOOR + 0.25, FLOOR + 0.6), smooth(n, f.z, FLOOR + 1.5, FLOOR + 1.0))
    scrape = n.math("MULTIPLY", band, smooth(n, f.noise(1.0, 3, stretch=(1.5, 1.5, 60)), 0.6, 0.72))
    ply = n.mix(n.math("MULTIPLY", scrape, 0.7), ply, (0.3, 0.22, 0.13))
    stain = smooth(n, f.noise(1.3, 5), 0.58, 0.7)
    ply = n.mix(n.math("MULTIPLY", stain, 0.5), ply, (0.06, 0.04, 0.022))
    low = n.math("MULTIPLY", smooth(n, f.z, FLOOR + 0.5, FLOOR), smooth(n, f.noise(3, 5), 0.25, 0.7))
    ply = n.mix(n.math("MULTIPLY", low, 0.7), ply, (0.03, 0.024, 0.018))
    ply_h = n.math("SUBTRACT", n.math("MULTIPLY", fine, 0.5),
                   n.math("ADD", n.math("MULTIPLY", joint, 2.0), n.math("MULTIPLY", scrape, 0.6)))

    color = n.mix(floor, ply, boards)
    rough = n.lerp(floor, n.lerp(scrape, 0.68, 0.85), n.lerp(path, 0.8, 0.6))
    height = n.lerp(floor, ply_h, board_h)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0015)})
    return mat


def seat_material():
    """Seat pads: grey-green vinyl, cracked and worn pale where people sit."""
    mat, n = lib.procedural("seat", 1024)
    f = Field(n, 63)
    _, _, nz = normal(n)
    color = n.mix(f.noise(3, 3), (0.045, 0.065, 0.05), (0.075, 0.1, 0.075))
    worn = n.math("MULTIPLY", smooth(n, f.noise(4.5, 4), 0.45, 0.7), n.lerp(smooth(n, nz, 0.3, 0.9), 0.5, 1.0))
    color = n.mix(n.math("MULTIPLY", worn, 0.6), color, (0.15, 0.17, 0.13))
    vor = n.add("ShaderNodeTexVoronoi", {"Vector": f.p, "Scale": 55.0}, feature="DISTANCE_TO_EDGE")
    cracks = n.math("MULTIPLY", smooth(n, vor.outputs["Distance"], 0.03, 0.0), worn)
    color = n.mix(n.math("MULTIPLY", cracks, 0.8), color, (0.012, 0.009, 0.007))
    tear = smooth(n, f.noise(2.2, 5), 0.73, 0.76)
    color = n.mix(tear, color, (0.3, 0.24, 0.13))  # foam showing
    rough = n.lerp(tear, n.lerp(worn, 0.45, 0.62), 0.95)
    height = n.math("SUBTRACT", n.math("MULTIPLY", f.noise(160, 2), 0.25),
                    n.math("ADD", cracks, n.math("MULTIPLY", tear, 1.5)))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0012)})
    return mat


def tyre_material():
    """Tyres: straight-ribbed tread, dust in the grooves and over the sidewalls."""
    mat, n = lib.procedural("tyre", 512)
    f = Field(n, 77)
    nx, _, _ = normal(n)
    tread = smooth(n, n.math("ABSOLUTE", nx), 0.6, 0.3)
    groove = n.math("MULTIPLY", n.stripes(n.math("ADD", f.x, 0.012), 0.054, 0.28), tread)
    dusty = smooth(n, f.noise(6, 4), 0.3, 0.75)
    color = n.mix(n.math("MULTIPLY", dusty, 0.5), (0.011, 0.011, 0.011), (0.06, 0.052, 0.042))
    color = n.mix(groove, color, (0.035, 0.03, 0.024))
    # Raised lettering on the sidewall, as a ring of dashes.
    height = n.math("SUBTRACT", n.math("MULTIPLY", f.noise(120, 2), 0.2), n.math("MULTIPLY", groove, 3.0))
    n.out(**{"Base Color": color, "Roughness": n.lerp(dusty, 0.7, 0.9),
             "Normal": n.bump(height, distance=0.003)})
    return mat
