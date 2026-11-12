"""
Rowboat: a clinker-built færing, pointed at both ends, four lapped strakes a side on ribs, with
thwarts and wooden tholes, tarred long ago and gone grey, half rotten, lying rolled on its keel.
"""

import math
import random

import bmesh
from mathutils import Matrix, Vector

import village_props as vp

OUT = "models/village/rowboat.glb"
ORIGIN = "bottom"
TRIS = 8000
AO = 2048
AO_DISTANCE = 0.25
SMOOTH_ANGLE = 40

LH = 2.08  # half length along the keel, stems rake out beyond
BMAX = 0.74  # half beam
DEPTH = 0.33  # keel to sheer amidships
STRAKES = 4
TH = 0.016  # plank thickness
LAP = 0.045  # how far each strake laps over the one below, in girth (0..1)
ROLL = math.radians(14)


def breadth(t):
    return BMAX * max(0.0, 1 - abs(t) ** 2.3) ** 0.6


def keel_z(t):
    return 0.07 + 0.07 * t * t


def sheer_z(t):
    return 0.07 + DEPTH + 0.2 * abs(t) ** 2.8


def hull(t, g, side):
    """The hull's outer surface at t (-1..1 along it) and g (0 keel .. 1 sheer) on side ±1."""
    b = breadth(t)
    x = side * b * math.sin(min(g, 1.0) * math.pi / 2) ** 0.75
    z = keel_z(t) + (sheer_z(t) - keel_z(t)) * g ** 1.25
    y = t * (LH + 0.3 * g ** 1.6 * abs(t) ** 3)
    return Vector((x, y, z))


def normal(t, g, side):
    e = 1e-3
    dt = hull(min(t + e, 1), g, side) - hull(max(t - e, -1), g, side)
    dg = hull(t, min(g + e, 1.0), side) - hull(t, max(g - e, 0.0), side)
    n = dt.cross(dg)
    if n.length < 1e-9:
        return Vector((side, 0, 0))
    n.normalize()
    if n.x * side < 0:
        n = -n
    return n


def strake(name, k, side, t0, t1, mat, rng, steps=40, ragged=(0.0, 0.0)):
    """Strake k on one side from t0 to t1: a plank lapped outside the strake below."""
    g0 = max(0.0, k / STRAKES - (LAP if k else 0.0))
    g1 = (k + 1) / STRAKES
    across = [0.0, 0.5, 1.0]
    bm = bmesh.new()
    wpos, wmeta = vp._layers(bm)
    sd = vp._seed01(rng.random())
    n_st = max(3, int(steps * (t1 - t0) / 2) + 2)
    rows = []
    s_len = 0.0
    prev = None
    for i in range(n_st):
        f = i / (n_st - 1)
        row_out, row_in = [], []
        for a in across:
            t = t0 + (t1 - t0) * f
            if i == 0 and ragged[0]:
                t += rng.uniform(0, ragged[0])
            if i == n_st - 1 and ragged[1]:
                t -= rng.uniform(0, ragged[1])
            t = max(-0.999, min(0.999, t))
            g = g0 + (g1 - g0) * a
            p = hull(t, g, side)
            nrm = normal(t, g, side)
            # Clinker: the lower edge sits a plank's thickness out, the upper edge on the surface.
            out = p + nrm * (TH * (1 - a) + TH * 0.35 * k / STRAKES)
            inn = out - nrm * TH
            wid = (g1 - g0) * 0.75
            for q, v_off, lst in ((out, 0.0, row_out), (inn, -TH, row_in)):
                vert = bm.verts.new(q)
                vert[wpos] = ((a - 0.5) * wid, v_off - 0.14, (t + 1) * LH)
                vert[wmeta] = (sd, vp.SPLIT, 0)
                lst.append(vert)
        rows.append((row_out, row_in))
    centre = lambda t: Vector((0, t * LH, (keel_z(t) + sheer_z(t)) / 2))  # noqa: E731
    for i in range(n_st - 1):
        (o0, i0), (o1, i1) = rows[i], rows[i + 1]
        t = t0 + (t1 - t0) * (i + 0.5) / (n_st - 1)
        for j in range(len(across) - 1):
            mid = (o0[j].co + o1[j + 1].co) / 2
            vp._face(bm, (o0[j], o0[j + 1], o1[j + 1], o1[j]), normal(t, g0 + (g1 - g0) * 0.5, side))
            vp._face(bm, (i0[j], i0[j + 1], i1[j + 1], i1[j]), -normal(t, g0 + (g1 - g0) * 0.5, side))
        # The plank's edges: the land below and the top edge.
        down = hull(t, g0, side) - hull(t, g1, side)
        vp._face(bm, (o0[0], i0[0], i1[0], o1[0]), down)
        vp._face(bm, (o0[-1], i0[-1], i1[-1], o1[-1]), -down)
    for end, sign in ((0, -1), (n_st - 1, 1)):
        o, i_ = rows[end]
        verts = []
        for v in o + i_[::-1]:
            nv = bm.verts.new(v.co)
            nv[wpos] = v[wpos]
            nv[wmeta] = (sd, vp.END, 0)
            verts.append(nv)
        vp._face(bm, verts, Vector((0, sign, 0)))
    return vp._obj(name, bm, mat)


def build():
    rng = random.Random(1952)
    wood = vp.wood("hull", 2048, tone="tar", moss=0.55, lichen=0.45, rings=90, rot=0.7)

    # Strakes, with the rot: pieces gone where the planks have rotted through.
    gaps = {
        (1, 3): [(-0.15, 0.32)],
        (1, 2): [(0.02, 0.2)],
        (-1, 3): [(0.48, 0.7)],
        (1, 1): [(0.1, 0.16)],
    }
    for side in (-1, 1):
        for k in range(STRAKES):
            spans = [(-1.0, 1.0)]
            for a, b in gaps.get((side, k), []):
                new = []
                for s0, s1 in spans:
                    if b <= s0 or a >= s1:
                        new.append((s0, s1))
                        continue
                    if a > s0:
                        new.append((s0, a))
                    if b < s1:
                        new.append((b, s1))
                spans = new
            for s0, s1 in spans:
                rag = (0.06 if s0 > -1 else 0.0, 0.06 if s1 < 1 else 0.0)
                strake("strake", k, side, s0, s1, wood, rng, ragged=rag)

    # Keel, along the bottom with the rocker, and the two stems rising from its ends.
    def keel_sag(t):
        tt = 2 * t - 1
        return Vector((0, 0, keel_z(tt) - keel_z(-1) * (1 - t) - keel_z(1) * t))

    keel_sec, _ = vp.rect_section(0.055, 0.07, rng, chamfer=0.008)
    vp.timber("keel", keel_sec, (0, -LH * 0.97, keel_z(-1) - 0.02), (0, LH * 0.97, keel_z(1) - 0.02),
              wood, rng.random(), stations=12, sag=keel_sag, wobble=0.004, rough=0.04, chamfer=0.0)
    for sign in (-1, 1):
        t = sign * 0.995
        pts = [hull(t, g, 1) * Vector((0, 1, 1)) + Vector((0, sign * 0.012, 0))
               for g in (0.0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0)]
        top = pts[-1] + Vector((0, sign * 0.06, 0.04))
        tip = top + Vector((0, sign * 0.02, 0.03))
        vp.rod("stem", pts + [top, tip], 0.03, wood, rng.random(), sides=6, rough=0.06,
               radii=[0.032, 0.031, 0.03, 0.028, 0.026, 0.025, 0.024, 0.021, 0.016])

    # Ribs inside, bent to the planking; one broken.
    for i, t in enumerate((-0.62, -0.38, -0.14, 0.1, 0.34, 0.58)):
        t += rng.uniform(-0.03, 0.03)
        pts = []
        for side, gs in ((-1, (0.98, 0.75, 0.5, 0.28, 0.1)), (1, (0.1, 0.28, 0.5, 0.75, 0.98))):
            for g in gs:
                p = hull(t, g, side) - normal(t, g, side) * (TH + 0.02)
                pts.append(p)
        if i == 4:
            pts = pts[3:]
        vp.rod("rib", pts, 0.02, wood, rng.random(), sides=4, rough=0.15)

    # Gunwales along the sheer.
    for side in (-1, 1):
        pts = [hull(t, 1.0, side) + normal(t, 1.0, side) * 0.004 + Vector((0, 0, 0.012))
               for t in [-0.97 + 1.94 * i / 14 for i in range(15)]]
        if side == 1:
            # Broken off over the rotten gap.
            a = [p for p in pts if p.y < -0.15 * LH]
            b = [p for p in pts if p.y > 0.35 * LH]
            for part in (a, b):
                vp.rod("gunwale", part, 0.022, wood, rng.random(), sides=5, rough=0.1)
        else:
            vp.rod("gunwale", pts, 0.022, wood, rng.random(), sides=5, rough=0.1)

    # Thwarts across, a little below the sheer; the aft one has split and dropped at one end.
    for j, t in enumerate((-0.42, 0.04, 0.5)):
        g = 0.82
        pl, pr = hull(t, g, -1), hull(t, g, 1)
        z = pl.z + 0.01
        sec, _ = vp.rect_section(0.2, 0.026, rng, chamfer=0.006)
        a = Vector((pl.x + 0.035, pl.y, z))
        b = Vector((pr.x - 0.035, pr.y, z))
        if j == 2:
            b = Vector((pr.x * 0.2, pr.y, keel_z(t) + 0.12))
        vp.timber("thwart", sec, a, b, wood, rng.random(), up=(0, 0, 1), stations=4, rough=0.03,
                  chamfer=0.006, ragged=(0, 0.04 if j == 2 else 0), twist=rng.uniform(-0.08, 0.08))

    # Wooden tholes (keiper) on the gunwales, one pair each side, one gone.
    for side in (-1, 1):
        for t in (-0.12, 0.62):
            if side == 1 and t > 0.5:
                continue
            p = hull(t, 1.0, side) + Vector((0, 0, 0.04))
            sec, _ = vp.rect_section(0.05, 0.06, rng, chamfer=0.008)
            vp.timber("thole", sec, p - Vector((0, 0.09, 0.0)), p + Vector((0, 0.09, 0.02)), wood,
                      rng.random(), stations=3, rough=0.08, chamfer=0.01)

    # Rolled onto its side, sunk a little into the turf.
    objs = [o for o in vp.bpy.context.scene.objects if o.type == "MESH"]
    vp.transform(objs, Matrix.Rotation(ROLL, 4, "Y") @ Matrix.Rotation(math.radians(1.5), 4, "X"))
    zmin = min(v.co.z for o in objs for v in o.data.vertices)
    vp.transform(objs, Matrix.Translation((0, 0, -zmin - 0.03)))
    vp.clip_ground()
    vp.report("rowboat")
