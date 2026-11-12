"""
Fieldstones for the village models, shared by the helper modules that lay stone (village_props,
village_logs, village_boards). Not a model itself: it has no build().

fieldstone() makes one stone as plain data, (vertices, faces), so each module can put it into its
own kind of mesh. A stone is the convex hull of points on a rounded block, ice-worn, with a few
fracture planes left flat and sharp-edged where it broke, a flattish bed underneath, lumps on the
round parts and a little unevenness everywhere so no face is a perfect plane. Its size, roundness
and breaks are all varied by the caller, so walls get angular and rounded stones of every size.
"""

import math
import random

import bmesh
from mathutils import Vector
from mathutils import noise as mnoise


def _fib(i, n):
    y = 1 - 2 * (i + 0.5) / n
    r = math.sqrt(max(0.0, 1 - y * y))
    a = i * 2.399963
    return Vector((r * math.cos(a), r * math.sin(a), y))


def fieldstone(size, seed, *, points=32, round_=0.55, breaks=2, faces=(), bed=0.25, top=0.0,
               lump=0.07, rough=0.012):
    """
    One fieldstone `size` = (x, y, z) meters across, centred on (0, 0, 0), as (vertices, faces):
    a list of Vectors and a list of index tuples, outward-facing.

    - `points`: how many points the hull is drawn over; it has about 2 × points - 4 triangles.
    - `round_` 0..1: 1 an egg, 0 a blocky slab with only its corners worn.
    - `breaks`: fresh fracture planes in random directions, flat and sharp-edged.
    - `faces`: more fracture planes as (direction, depth), depth 0..1 from the middle to the side:
      e.g. ((0, -1, 0), 0.8) gives a flat face to the front, as a wall's face stones have.
    - `bed` flattens the underside, `top` the top, by that share of the height.
    - `lump` swells the round parts, `rough` (share of the size) dents every vertex a little.
    """
    rng = random.Random(seed)
    off = Vector((rng.uniform(-90, 90), rng.uniform(-90, 90), rng.uniform(-90, 90)))
    e = 2.0 + (1.0 - round_) * 4.0
    planes = []
    for _ in range(breaks):
        az = rng.uniform(0, 2 * math.pi)
        el = rng.uniform(-0.5, 0.7)
        planes.append((Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el),
                               math.sin(el))), rng.uniform(0.55, 0.82)))
    for d, depth in faces:
        planes.append((Vector(d).normalized(), depth))
    if bed:
        planes.append((Vector((0, 0, -1)), 1 - bed))
    if top:
        planes.append((Vector((0, 0, 1)), 1 - top))

    bm = bmesh.new()
    # Points over a rounded block: more near the edges, where the stone turns.
    n = max(8, points)
    for i in range(n):
        d = _fib(i, n)
        d += Vector((rng.gauss(0, 0.12), rng.gauss(0, 0.12), rng.gauss(0, 0.12)))
        d.normalize()
        r = (abs(d.x) ** e + abs(d.y) ** e + abs(d.z) ** e) ** (-1 / e)
        r *= 1 + lump * mnoise.noise(d * 1.6 + off) + lump * 0.5 * mnoise.noise(d * 3.3 + off)
        p = d * r
        for nrm, depth in planes:
            over = p.dot(nrm) - depth
            if over > 0:
                p -= nrm * over
        bm.verts.new(p)
    # Corners where fracture planes meet, so breaks end in crisp edges, not chamfers.
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:], use_existing_faces=False)
    dead = list({g for g in res["geom_interior"] + res["geom_unused"]
                 if isinstance(g, bmesh.types.BMVert) and not g.link_faces})
    if dead:
        bmesh.ops.delete(bm, geom=dead, context="VERTS")
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()

    half = Vector(size) / 2
    s = min(half)
    verts = []
    index = {}
    for i, v in enumerate(bm.verts):
        p = v.co
        q = Vector((p.x * half.x, p.y * half.y, p.z * half.z))
        # Dents: none of the faces quite flat, no two stones quite alike.
        q += v.normal * (rough * 2 * s * mnoise.noise(p * 4.0 + off * 1.7))
        index[v] = i
        verts.append(q)
    tris = [tuple(index[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return verts, tris


def to_bmesh(bm, verts, faces, matrix, make_vert=None):
    """
    Add a stone from fieldstone() to bm, moved by `matrix` (4×4). `make_vert(bm, local, world)`
    can make each vertex itself, to set layers; else plain vertices. Returns the new faces.
    """
    if make_vert is None:
        vs = [bm.verts.new(matrix @ p) for p in verts]
    else:
        vs = [make_vert(bm, p, matrix @ p) for p in verts]
    out = []
    for f in faces:
        try:
            out.append(bm.faces.new([vs[i] for i in f]))
        except ValueError:
            pass  # a degenerate face the hull left
    return out
