"""
Steel drums, 200 litres: lathed with chimes and rolling hoops, a recessed lid with two bungs,
paint worn on the hoops and chimes, a hazard diamond and a product label; four on a pallet,
strapped round.
"""

import math

import bmesh
from mathutils import Vector

import lib
from cargo import Field, Stencil, normal, painted_wear, smooth
from cargo.crate import wood_material

R, HEIGHT = 0.292, 0.88  # a drum's chime radius and height
BODY = 0.284
HOOPS = (0.293, 0.587)
PALLET_H = 0.144

# A drum's outline from the bottom up, (z, radius): chime, body, two hoops, chime, lid in a recess.
PROFILE = [
    (0.0, 0.268), (0.0, 0.289), (0.006, R), (0.026, R), (0.032, BODY),
]
for hz in HOOPS:
    PROFILE += [(hz - 0.016, BODY), (hz - 0.006, 0.294), (hz + 0.006, 0.294), (hz + 0.016, BODY)]
PROFILE += [(HEIGHT - 0.032, BODY), (HEIGHT - 0.026, R), (HEIGHT - 0.006, R), (HEIGHT, 0.289),
            (HEIGHT, 0.274), (HEIGHT - 0.012, 0.268), (HEIGHT - 0.012, 0.0)]


def drum(at, mat, sides=20, dent=None):
    """A drum standing at `at`. `dent` = (angle, z, radius, depth) pushes its side in."""
    obj = lib.lathe("drum", PROFILE, at=at, mat=mat, sides=sides)
    if dent:
        ang, dz, dr, depth = dent
        c = Vector(at)
        for v in obj.data.vertices:
            p = v.co - c
            r = math.hypot(p.x, p.y)
            if r < BODY - 0.01:
                continue
            da = math.atan2(math.sin(math.atan2(p.y, p.x) - ang), math.cos(math.atan2(p.y, p.x) - ang))
            q = ((da * r) ** 2 + (p.z - dz) ** 2) / (dr * dr)
            if q < 1:
                push = depth * (1 - q) ** 2
                v.co.x -= p.x / r * push
                v.co.y -= p.y / r * push
    return obj


def band(name, path, z0, z1, centre, mat):
    """A strap round a closed `path` of (x, y) points, from z0 to z1, facing away from `centre`."""
    bm = bmesh.new()
    low = [bm.verts.new((x, y, z0)) for x, y in path]
    high = [bm.verts.new((x, y, z1)) for x, y in path]
    n = len(path)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((low[i], low[j], high[j], high[i]))
        bm.normal_update()
        mid = f.calc_center_median() - Vector((centre[0], centre[1], f.calc_center_median().z))
        if f.normal.dot(mid) < 0:
            f.normal_flip()
    return lib.assign(lib._mesh_object(name, bm), mat)


def pallet(mat, size=1.2):
    """A block pallet: seven top boards, three cross boards, nine blocks, three bottom boards."""
    t = 0.022
    for i in range(7):
        y = -size / 2 + 0.0725 + i * (size - 0.145) / 6
        lib.box("deck", (size, 0.145, t), (0, y, PALLET_H - t / 2), mat, bevel=0.003, segments=1)
    for x in (-size / 2 + 0.0725, 0, size / 2 - 0.0725):
        lib.box("stringer", (0.145, size, t), (x, 0, PALLET_H - 1.5 * t), mat, bevel=0.003, segments=1)
        for y in (-size / 2 + 0.0725, 0, size / 2 - 0.0725):
            lib.box("block", (0.145, 0.145, 0.078), (x, y, t + 0.039), mat, bevel=0.004, segments=1)
        lib.box("runner", (0.145, size, t), (x, 0, t / 2), mat, bevel=0.003, segments=1)


# Each drum: paint, hazard ("flam", "corr" or None), label lines.
DRUMS = [
    ((0.008, 0.035, 0.12), "flam", ["ISOPROPANOL", "UN 1219", "200 L   BATCH 4471"]),
    ((0.14, 0.01, 0.007), "flam", ["SOLVENT NAPHTHA", "UN 1268", "200 L   BATCH 0938"]),
    ((0.012, 0.012, 0.013), "corr", ["SODIUM HYDROXIDE SOL.", "UN 1824", "200 L   BATCH 2205"]),
    ((0.03, 0.07, 0.022), None, ["HYDRAULIC OIL HV46", "NON HAZARDOUS", "205 L   BATCH 7716"]),
]
SPOTS = [(1, 1), (-1, 1), (-1, -1), (1, -1)]  # where each drum stands, in quarter-steps


def group(seed=41):
    """Four drums on a pallet, strapped twice round, one drum dented."""
    stencil = Stencil(f"drums-{seed}", {
        **{f"label-{i}": [(lines[0], 0.02, False), (lines[1], 0.016, False), (lines[2], 0.012, False)]
           for i, (_, _, lines) in enumerate(DRUMS)},
        "flam": [("FLAMMABLE", 0.011, False), ("LIQUID", 0.011, False)],
        "corr": [("CORROSIVE", 0.011, False)],
        "three": [("3", 0.03, False)],
        "eight": [("8", 0.03, False)],
    })
    step = R + 0.002
    centres = [(sx * step, sy * step) for sx, sy in SPOTS]
    mat = drum_material(seed, stencil, centres)
    for i, (cx, cy) in enumerate(centres):
        out = math.atan2(cy, cx)
        dent = (out + 0.5, 0.45, 0.15, 0.05) if i == 1 else None
        drum((cx, cy, PALLET_H), mat, dent=dent)
        # Two bungs on the lid, towards the outside.
        bung = lib.material("bung", (0.05, 0.05, 0.05), roughness=0.45, metallic=0.8) if i == 0 else bung
        for r, a, br in ((0.19, out + 0.4, 0.034), (0.2, out - 0.6, 0.018)):
            lib.cylinder("bung", br, 0.014, (cx + r * math.cos(a), cy + r * math.sin(a),
                                             PALLET_H + HEIGHT - 0.012 + 0.007), mat=bung, sides=8)
    pallet(wood_material("pallet", seed, 1024, 0.165, 0.0))
    # Straps round all four, a hand's width above and below the hoops.
    strap = lib.material("strap", (0.02, 0.06, 0.025), roughness=0.45)
    path = []
    for k, (sx, sy) in enumerate(SPOTS):
        cx, cy = sx * step, sy * step
        for j in range(6):
            a = math.pi / 2 * (k + j / 5)
            path.append((cx + (R + 0.004) * math.cos(a), cy + (R + 0.004) * math.sin(a)))
    for z in (PALLET_H + 0.2, PALLET_H + 0.68):
        band("strap", path, z, z + 0.016, (0, 0), strap)
        lib.box("seal", (0.03, 0.006, 0.022), (0.1, step + R + 0.007, z + 0.008), bung)


def drum_material(seed, stencil, centres):
    """Each drum's paint, worn at its hoops and chimes, with its hazard diamond and label."""
    mat, n = lib.procedural("drums", 2048)
    f = Field(n, seed)
    _, _, up = normal(n)
    # Which drum: by quarter.
    px, py = n.math("GREATER_THAN", f.x, 0), n.math("GREATER_THAN", f.y, 0)
    which = [n.math("MULTIPLY", px, py), n.math("MULTIPLY", n.math("SUBTRACT", 1, px), py),
             n.math("MULTIPLY", n.math("SUBTRACT", 1, px), n.math("SUBTRACT", 1, py)),
             n.math("MULTIPLY", px, n.math("SUBTRACT", 1, py))]
    z = n.math("SUBTRACT", f.z, PALLET_H)
    rims = [abs_near(n, z, h, 0.02) for h in (0.016, HOOPS[0], HOOPS[1], HEIGHT - 0.016)]
    edge = rims[0]
    for r in rims[1:]:
        edge = n.math("MAXIMUM", edge, r)
    color = (0, 0, 0)
    rough = 0.5
    height = 0.0
    for i, (paint, hazard, _) in enumerate(DRUMS):
        c, r, h = painted_wear(n, f, paint, wear=0.45, rust=0.4, chalk=0.12, top=PALLET_H + HEIGHT,
                               edge=edge, floor_dirt=0.5, salt=0.25)
        color = n.mix(which[i], color, c)
        rough = n.lerp(which[i], rough, r)
        height = n.lerp(which[i], height, h)

    for i, ((cx, cy), (_, hazard, _)) in enumerate(zip(centres, DRUMS)):
        out = math.atan2(cy, cx)
        # Arc length round this drum from the side facing out, and height up it.
        dx, dy = n.math("SUBTRACT", f.x, cx), n.math("SUBTRACT", f.y, cy)
        ux = n.math("ADD", n.math("MULTIPLY", dx, math.cos(out)), n.math("MULTIPLY", dy, math.sin(out)))
        uy = n.math("SUBTRACT", n.math("MULTIPLY", dy, math.cos(out)), n.math("MULTIPLY", dx, math.sin(out)))
        s = n.math("MULTIPLY", n.math("ARCTAN2", uy, ux), BODY)
        side = n.math("MULTIPLY", which[i], smooth(n, n.math("ABSOLUTE", up), 0.4, 0.2))
        # The product label, a printed paper sheet to the right of the diamond.
        lx, lz, lw, lh = 0.24, 0.44, 0.24, 0.16
        paper = n.math("MULTIPLY", side, n.math("MULTIPLY", n.inside(s, lx - lw / 2, lx + lw / 2),
                                                n.inside(z, lz - lh / 2, lz + lh / 2)))
        torn = smooth(n, f.noise(30, 4), 0.72, 0.68)
        paper = n.math("MULTIPLY", paper, torn)
        color = n.mix(paper, color, n.mix(f.noise(6, 4), (0.5, 0.48, 0.42), (0.36, 0.33, 0.27)))
        rough = n.lerp(paper, rough, 0.8)
        text = stencil.mask(n, f"label-{i}", s, f.z, lx - lw / 2 + 0.015, PALLET_H + lz - 0.04, paper)
        color = n.mix(text, color, (0.015, 0.015, 0.015))
        if hazard:
            # The diamond: 25 cm across its points, a thin border line inside.
            a = 0.125
            dz = n.math("SUBTRACT", z, 0.44)
            dist = n.math("ADD", n.math("ABSOLUTE", s), n.math("ABSOLUTE", dz))
            dia = n.math("MULTIPLY", side, n.math("LESS_THAN", dist, a))
            line = n.math("MULTIPLY", dia, n.inside(dist, a - 0.014, a - 0.009))
            if hazard == "flam":
                bg = (0.36, 0.012, 0.008)
                fg = (0.012, 0.012, 0.012)
                body = n.mix(dia, color, bg)
                body = n.mix(line, body, fg)
                words = stencil.mask(n, "flam", s, f.z, -0.035, PALLET_H + 0.41, dia)
                num = stencil.mask(n, "three", s, f.z, -0.012, PALLET_H + 0.335, dia)
            else:
                lower = n.math("MULTIPLY", dia, n.math("LESS_THAN", dz, 0))
                body = n.mix(dia, color, (0.55, 0.55, 0.53))
                body = n.mix(lower, body, (0.012, 0.012, 0.012))
                body = n.mix(n.math("MULTIPLY", line, n.math("SUBTRACT", 1, lower)), body, (0.012, 0.012, 0.012))
                fg = (0.55, 0.55, 0.53)
                words = stencil.mask(n, "corr", s, f.z, -0.035, PALLET_H + 0.405, lower)
                num = stencil.mask(n, "eight", s, f.z, -0.012, PALLET_H + 0.335, lower)
            body = n.mix(n.math("MAXIMUM", words, num), body, fg)
            # Scuffed: the label rubbed off in patches where the drum was rolled.
            scuff = n.math("MULTIPLY", dia, smooth(n, f.noise(12, 5), 0.66, 0.6))
            color = n.mix(scuff, color, body)
            rough = n.lerp(dia, rough, 0.55)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0015)})
    return mat


def abs_near(n, value, at, width):
    """1 at `at`, falling to 0 `width` away."""
    return smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", value, at)), width, 0.0)
