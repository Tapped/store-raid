"""
Shared by the village models (the abandoned West Norway farm hamlet): hand-split and hewn timber,
fieldstones, withies and wire, and their weathered materials. Not a model itself: it has no build.

Parts carry two mesh attributes, which the materials read so one baked material can grain every
log, rail and plank along its own length and vary it from its neighbours:

  wpos    (u, v, s): u and v across the part in meters from the pith of the log it was split
          from (so rings show on end grain and flame across split faces), s along it in meters
  wmeta   (seed, kind, 0): seed 0..1 per part; kind 0 a split or sawn face, 1 the round outside
          (bark, or a debarked pole), 2 end grain, 3 stone, 4 hay

Every part is built in place in the model's meters, so the materials' world position (lib's
coord()) is true height above the ground: moss and damp gather low, lichen on top.
"""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils import noise as mnoise

import lib

BARK, SPLIT, END, STONE, HAY = 1, 0, 2, 3, 4
CORE = 5  # a dry-stone wall's hidden core of rubble and earth, seen in the gaps


# ---------------------------------------------------------------------------------------------
# Mesh building


def _layers(bm):
    fv = bm.verts.layers.float_vector
    return fv.get("wpos") or fv.new("wpos"), fv.get("wmeta") or fv.new("wmeta")


def _obj(name, bm, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return lib.assign(obj, mat)


def _seed01(seed):
    return (seed * 0.6180339887 + 0.1234) % 1.0


def _n(p, off=0.0):
    """Perlin noise about -1..1 at p (a 3-tuple), shifted by off."""
    return mnoise.noise(Vector((p[0] + off, p[1] - off * 0.7, p[2] + off * 1.3)))


def _face(bm, verts, outward):
    f = bm.faces.new(verts)
    f.normal_update()
    if f.normal.dot(outward) < 0:
        f.normal_flip()
    return f


def _frame(t, up):
    up = Vector(up).normalized()
    if abs(t.dot(up)) > 0.95:
        up = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
    nrm = (up - t * up.dot(t)).normalized()
    return nrm, t.cross(nrm)  # v direction, u direction


def round_section(r, sides, rng, oval=0.08):
    """A round pole or log: (u, v, kind) points round it, all the outside."""
    ox = 1 + rng.uniform(-oval, oval)
    ph = rng.uniform(0, 6.28)
    return [(r * ox * math.cos(ph + 2 * math.pi * i / sides),
             r / ox * math.sin(ph + 2 * math.pi * i / sides), BARK) for i in range(sides)]


def split_section(r, a0, a1, rng, arc=4, pith=(0.0, 0.0), rough=0.12, heart=None):
    """
    A wedge split from a log of radius r, from angle a0 to a1 (radians, a1 > a0) round the pith:
    the round outside in `arc` steps and two rough split faces back to the pith, each with a kink.
    `heart` cuts the sharp heart off at that distance from the pith (a flat inner face).
    """
    pts = []
    px, py = pith

    def at(a, d):
        return (px + d * math.cos(a), py + d * math.sin(a))

    if heart:
        pts.append((*at(a0, heart), SPLIT))
    else:
        pts.append((px, py, SPLIT))
    am = a0 + rng.uniform(-0.06, 0.06)
    pts.append((*at(am, r * rng.uniform(0.45, 0.6)), SPLIT))
    for i in range(arc + 1):
        a = a0 + (a1 - a0) * i / arc
        k = BARK if i < arc else SPLIT
        pts.append((*at(a, r * (1 + rng.uniform(-rough, rough) * 0.3)), k))
    pts.append((*at(a1 + rng.uniform(-0.06, 0.06), r * rng.uniform(0.45, 0.6)), SPLIT))
    if heart:
        pts.append((*at(a1, heart), SPLIT))
    return pts


def rect_section(w, t, rng, chamfer=0.006, pith=(0.0, -0.12), wane=0.0, jitter=0.002):
    """
    A sawn or hewn plank w wide (u) and t thick (v), centred on (0, 0), with its pith at `pith`
    (so rings arc across its end). `wane` rounds two top corners where the log's outside was left.
    """
    hw, ht = w / 2, t / 2
    c = chamfer
    corners = [(-hw, -ht), (hw, -ht), (hw, ht), (-hw, ht)]
    # Two points per corner, round the outline: the chamfer between them, then the face.
    out = []
    for i, (x, y) in enumerate(corners):
        sx = 1 if x > 0 else -1
        sy = 1 if y > 0 else -1
        cc = wane if (wane and sy > 0) else c
        a = (x, y - sy * cc) if i % 2 == 0 else (x - sx * cc, y)
        b = (x - sx * cc, y) if i % 2 == 0 else (x, y - sy * cc)
        ka = BARK if (wane and sy > 0) else SPLIT
        out.append((a[0] + rng.uniform(-jitter, jitter), a[1] + rng.uniform(-jitter, jitter), ka))
        out.append((b[0] + rng.uniform(-jitter, jitter), b[1] + rng.uniform(-jitter, jitter), SPLIT))
    return [(x - pith[0], y - pith[1], k) for x, y, k in out], (-pith[0], -pith[1])


def timber(name, section, a, b, mat, seed, *, centre=None, up=(0, 0, 1), stations=6,
           bend=(0, 0, 0), wobble=0.006, rough=0.05, taper=1.0, twist=0.0, chamfer=0.008,
           ragged=(0.0, 0.0), caps=(True, True), sag=None):
    """
    A length of timber from a to b: `section` ((u, v, kind) points round it, in meters from the
    pith, see the *_section helpers) swept along the line, with `centre` (in section coordinates,
    default the section's middle) on it. u runs sideways and v towards `up`. It bows by `bend` at the middle, wanders by
    `wobble`, its outline is roughened by `rough` (a share of its size), `taper` scales the far
    end, `twist` turns it (radians) over its length, the ends are chamfered `chamfer` and broken
    off unevenly by `ragged` = (start, end) meters. Faces of different kinds don't share vertices,
    so a split face meets the bark in a hard edge.
    """
    rng = random.Random(int(seed * 100003) + 7)
    off = rng.uniform(0, 500)
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    T = (b - a).normalized()
    V, U = _frame(T, up)
    P = len(section)
    gx = sum(x for x, _, _ in section) / P
    gy = sum(y for _, y, _ in section) / P
    cu, cv = centre if centre is not None else (gx, gy)

    # Stations: chamfer rings at both ends, the rest spread along.
    ts = [0.0]
    if chamfer > 0:
        ts.append(min(chamfer / L, 0.2))
    inner = max(stations - 2, 1)
    for i in range(1, inner):
        ts.append(i / inner)
    if chamfer > 0:
        ts.append(1 - min(chamfer / L, 0.2))
    ts.append(1.0)
    ts = sorted(set(round(t, 6) for t in ts))

    def centre_at(t):
        p = a + (b - a) * t + Vector(bend) * (4 * t * (1 - t))
        w = mnoise.noise_vector(Vector((off + t * L * 0.9, off * 0.3, 0.5)))
        w = (w - T * w.dot(T)) * wobble * math.sin(math.pi * t) ** 0.5
        if sag:
            p = p + sag(t)
        return p + w

    bm = bmesh.new()
    wpos, wmeta = _layers(bm)
    sd = _seed01(seed)

    # Section points per station: (world position, (u, v), kind).
    rings = []
    for j, t in enumerate(ts):
        s = t * L
        c = centre_at(t)
        scale = (1 + (taper - 1) * t) * (1 + 0.04 * _n((s * 1.1, 0.3, 0.7), off))
        ang = twist * t
        ca, sa = math.cos(ang), math.sin(ang)
        shrink = 0.0
        if chamfer > 0 and (j == 0 or j == len(ts) - 1):
            shrink = chamfer
        end_shift = 0.0
        ring = []
        for i, (x, y, k) in enumerate(section):
            dx, dy = (x - gx), (y - gy)
            d = math.hypot(dx, dy)
            th = math.atan2(dy, dx)
            kk = 1 + rough * _n((math.cos(th) * 1.7, math.sin(th) * 1.7, s * 2.1), off)
            sc = scale * kk
            if shrink and d > 1e-6:
                sc *= max(0.3, 1 - shrink / (d * scale))
            ex, ey = gx - cu + dx * sc, gy - cv + dy * sc
            rx, ry = ex * ca - ey * sa, ex * sa + ey * ca
            p = c + U * rx + V * ry
            if j == 0 and ragged[0]:
                end_shift = rng.uniform(0, ragged[0])
                p = p + T * end_shift
            elif j == len(ts) - 1 and ragged[1]:
                end_shift = rng.uniform(0, ragged[1])
                p = p - T * end_shift
            ring.append((p, (cu + rx, cv + ry), s))
        mid = sum((e[0] for e in ring), Vector()) / P
        rings.append([(*e, mid) for e in ring])

    # Runs of segments of one kind: segment i goes from point i to point i + 1.
    kinds = [k for _, _, k in section]
    if len(set(kinds)) == 1:
        runs = [(list(range(P)) + [0], kinds[0])]
    else:
        start = next(i for i in range(P) if kinds[i] != kinds[i - 1])
        runs = []
        i = start
        while True:
            k = kinds[i]
            idx = [i]
            while True:
                i = (i + 1) % P
                idx.append(i)
                if kinds[i] != k or i == start:
                    break
            runs.append((idx, k))
            if i == start:
                break

    for idx, k in runs:
        cols = []
        for ring in rings:
            col = []
            for i in idx:
                p, (uu, vv), s, _ = ring[i]
                v = bm.verts.new(p)
                v[wpos] = (uu, vv, s)
                v[wmeta] = (sd, k, 0)
                col.append(v)
            cols.append(col)
        for j in range(len(rings) - 1):
            cen = (rings[j][0][3] + rings[j + 1][0][3]) / 2
            for m in range(len(idx) - 1):
                quad = (cols[j][m], cols[j][m + 1], cols[j + 1][m + 1], cols[j + 1][m])
                mid = sum((q.co for q in quad), Vector()) / 4
                out = mid - cen
                out = out - T * out.dot(T)
                _face(bm, quad, out)

    for end, ring, sign in ((0, rings[0], -1), (1, rings[-1], 1)):
        if not caps[end]:
            continue
        verts = []
        for p, (uu, vv), s, _ in ring:
            v = bm.verts.new(p)
            v[wpos] = (uu, vv, s)
            v[wmeta] = (sd, END, 0)
            verts.append(v)
        _face(bm, verts, T * sign)
    return _obj(name, bm, mat)


def rod(name, points, radius, mat, seed, sides=6, kind=BARK, rough=0.1, caps=True, radii=None,
        phase=0.0, squash=1.0):
    """
    A round rod through `points`: withies, twigs, wire, chains of hay. Like lib.tube, but tagged
    with wpos/wmeta so a wood or hay material grains it along its length.
    """
    rng = random.Random(int(seed * 100003) + 3)
    off = rng.uniform(0, 500)
    pts = [Vector(p) for p in points]
    radii = radii or [radius] * len(pts)
    bm = bmesh.new()
    wpos, wmeta = _layers(bm)
    sd = _seed01(seed)
    normal = None
    s = 0.0
    rings = []
    for i, p in enumerate(pts):
        if i:
            s += (p - pts[i - 1]).length
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if normal is None:
            normal = t.cross(Vector((0, 0, 1)))
            if normal.length < 1e-4:
                normal = t.cross(Vector((1, 0, 0)))
        normal = (normal - t * normal.dot(t)).normalized()
        bi = t.cross(normal)
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides + phase
            rr = radii[i] * (1 + rough * _n((math.cos(a), math.sin(a), s * 3), off))
            q = p + rr * (math.cos(a) * normal + squash * math.sin(a) * bi)
            v = bm.verts.new(q)
            v[wpos] = (rr * math.cos(a), rr * math.sin(a), s)
            v[wmeta] = (sd, kind, 0)
            ring.append(v)
        rings.append((ring, p, t))
    for (r0, p0, t0), (r1, p1, _) in zip(rings, rings[1:]):
        for k in range(sides):
            quad = (r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k])
            mid = sum((q.co for q in quad), Vector()) / 4
            out = mid - (p0 + p1) / 2
            _face(bm, quad, out)
    if caps:
        for ring, p, t, sign in ((*rings[0], -1), (*rings[-1], 1)):
            _face(bm, ring, t * sign)
    return _obj(name, bm, mat)


def stone(name, size, at, mat, seed, *, cuts=2, roundness=0.6, lump=0.12, turn=0.0,
          tilt=(0.0, 0.0), facets=2, flat=0.25, faces=(), points=None):
    """
    A fieldstone `size` = (x, y, z) across, centred on `at`: the hull of a rounded block
    (village_stone.fieldstone), angular where `facets` fracture planes broke it and where `faces`
    (more planes, as (direction, depth)) flatten it, rounder with `roundness`, a flattish bed by
    `flat`, turned `turn` round z and tilted `tilt` (x, y radians). `points` sets the detail:
    about 2 × points triangles; by default cuts=2 is 40 points, cuts=1 24, cuts=0 14.
    """
    import village_stone as vs
    pts = points or {0: 14, 1: 24}.get(cuts, 40)
    verts, tris = vs.fieldstone(size, int(seed * 100003) + 11, points=pts, round_=roundness,
                                breaks=facets, faces=faces, bed=flat, top=flat * 0.3,
                                lump=lump * 0.6)
    bm = bmesh.new()
    wpos, wmeta = _layers(bm)
    sd = _seed01(seed)
    rot = (Matrix.Translation(Vector(at)) @ Matrix.Rotation(turn, 4, "Z")
           @ Matrix.Rotation(tilt[0], 4, "X") @ Matrix.Rotation(tilt[1], 4, "Y"))

    def make(b, local, world):
        v = b.verts.new(world)
        v[wpos] = local
        v[wmeta] = (sd, STONE, 0)
        return v

    vs.to_bmesh(bm, verts, tris, rot, make)
    bm.normal_update()
    return _obj(name, bm, mat)


def blob(name, half, at, mat, seed, kind=STONE, segments=8, rings=6, lump=0.15, flat=0.3):
    """A lumpy ellipsoid tagged as `kind`: moss cushions, clods, hay lumps."""
    rng = random.Random(int(seed * 100003) + 13)
    off = rng.uniform(0, 500)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1)
    wpos, wmeta = _layers(bm)
    sd = _seed01(seed)
    for v in bm.verts:
        p = v.co.copy()
        p *= 1 + lump * _n(p * 1.5, off)
        if p.z < 0:
            p.z *= 1 - flat
        local = Vector((p.x * half[0], p.y * half[1], p.z * half[2]))
        v[wpos] = local
        v[wmeta] = (sd, kind, 0)
        v.co = local + Vector(at)
    return _obj(name, bm, mat)


def tag_all(obj, seed, kind):
    """Tag a lib-made object (box, lathe, tube...) with wpos (its own coordinates) and wmeta."""
    mesh = obj.data
    wp = mesh.attributes.get("wpos") or mesh.attributes.new("wpos", "FLOAT_VECTOR", "POINT")
    wm = mesh.attributes.get("wmeta") or mesh.attributes.new("wmeta", "FLOAT_VECTOR", "POINT")
    sd = _seed01(seed)
    for i, v in enumerate(mesh.vertices):
        wp.data[i].vector = v.co
        wm.data[i].vector = (sd, kind, 0)
    return obj


def transform(objs, m):
    """Move objects' mesh data by the 4×4 matrix m (keeps wpos, so patterns move with them)."""
    for o in objs:
        o.data.transform(m)


def made(fn, *args, **kw):
    """Runs fn and returns every object it added to the scene."""
    before = set(bpy.context.scene.objects)
    fn(*args, **kw)
    return [o for o in bpy.context.scene.objects if o not in before]


# ---------------------------------------------------------------------------------------------
# Cutting, for pieces that tile


def clip(obj, co, no):
    """Cut obj by the plane through co with normal no, keeping the side behind it, capped."""
    for m in list(obj.modifiers):
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    co, no = Vector(co), Vector(no).normalized()
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True)
    on = [v for v in res["geom_cut"] if isinstance(v, bmesh.types.BMVert) and v.is_valid]
    # Parts' faces of different kinds don't share vertices, so the cut isn't one closed loop:
    # cap it with a new face through the cut points, in order round their middle.
    uniq = []
    for v in on:
        if all((v.co - w.co).length > 1e-5 for w in uniq):
            uniq.append(v)
    if len(uniq) >= 3:
        mid = sum((v.co for v in uniq), Vector()) / len(uniq)
        a = (uniq[0].co - mid).normalized()
        b = no.cross(a)
        uniq.sort(key=lambda v: math.atan2((v.co - mid).dot(b), (v.co - mid).dot(a)))
        wpos = bm.verts.layers.float_vector.get("wpos")
        wmeta = bm.verts.layers.float_vector.get("wmeta")
        verts = []
        for v in uniq:
            nv = bm.verts.new(v.co)
            if wpos is not None:
                nv[wpos] = v[wpos]
                m = v[wmeta]
                nv[wmeta] = (m[0], END if m[1] != STONE else STONE, 0)
            verts.append(nv)
        f = _face(bm, verts, no)
        if on and on[0].link_faces:
            f.material_index = on[0].link_faces[0].material_index
    empty = len(bm.faces) == 0
    bm.to_mesh(obj.data)
    bm.free()
    if empty:
        bpy.data.objects.remove(obj)
        return None
    return obj


def wrap_x(half, objs=None):
    """
    Make the model tile along x every 2 × half meters: whatever sticks out past ±half is cut off
    there and its cut-off part moved to the other end, so the pieces meet exactly at the seam.
    """
    objs = objs or [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in objs:
        for m in list(o.modifiers):
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        xs = [v.co.x for v in o.data.vertices]
        if not xs:
            continue
        hi, lo = max(xs) > half, min(xs) < -half
        for side, over in ((1, hi), (-1, lo)):
            if not over:
                continue
            copy = o.copy()
            copy.data = o.data.copy()
            bpy.context.scene.collection.objects.link(copy)
            copy.data.transform(Matrix.Translation((-side * 2 * half, 0, 0)))
            clip(copy, (-side * half, 0, 0), (-side, 0, 0))
        if hi:
            o = clip(o, (half, 0, 0), (1, 0, 0))
        if lo and o is not None:
            clip(o, (-half, 0, 0), (-1, 0, 0))


def report(model):
    """Print the size of everything built so far."""
    bpy.context.view_layer.update()
    pts = []
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector(min(p[i] for p in pts) for i in range(3))
    hi = Vector(max(p[i] for p in pts) for i in range(3))
    print("MODEL", model, "built", [round(v, 3) for v in lo], "to", [round(v, 3) for v in hi],
          "size", [round(h - l, 3) for h, l in zip(hi, lo)])


# ---------------------------------------------------------------------------------------------
# Shader helpers on lib.Nodes


def attr(n, name):
    return n.add("ShaderNodeAttribute", attribute_name=name, attribute_type="GEOMETRY")


def split(n, vector):
    node = n.add("ShaderNodeSeparateXYZ", {"Vector": vector})
    return node.outputs["X"], node.outputs["Y"], node.outputs["Z"]


def vm(n, op, a, b=None, out="Vector"):
    node = n.add("ShaderNodeVectorMath", operation=op)
    n.set(node.inputs[0], a)
    if b is not None:
        n.set(node.inputs[1], b)
    return node.outputs[out]


def sm(n, v, lo, hi):
    """0 at lo, 1 at hi, smoothstep between (lo > hi turns it round)."""
    if isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and lo > hi:
        return n.math("SUBTRACT", 1.0, sm(n, v, hi, lo))
    node = n.add("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
    n.set(node.inputs["Value"], v)
    n.set(node.inputs["From Min"], lo)
    n.set(node.inputs["From Max"], hi)
    return node.outputs["Result"]


def mul(n, *vs):
    out = vs[0]
    for v in vs[1:]:
        out = n.math("MULTIPLY", out, v)
    return out


def add(n, *vs):
    out = vs[0]
    for v in vs[1:]:
        out = n.math("ADD", out, v)
    return out


def inv(n, v):
    return n.math("SUBTRACT", 1.0, v)


def clamp01(n, v):
    return n.math("ADD", v, 0.0, clamp=True)


def is_kind(n, kind_socket, k):
    node = n.add("ShaderNodeMath", operation="COMPARE")
    n.set(node.inputs[0], kind_socket)
    node.inputs[1].default_value = float(k)
    node.inputs[2].default_value = 0.3
    return node.outputs[0]


def scaled(n, vec, sx, sy, sz, offset=None):
    """vec × (sx, sy, sz), plus offset (a vector socket) if given."""
    v = vm(n, "MULTIPLY", vec, (sx, sy, sz))
    return vm(n, "ADD", v, offset) if offset is not None else v


def cavity(n, distance=0.03):
    """About 1 in creases and inside corners, where dirt gathers."""
    ao = n.add("ShaderNodeAmbientOcclusion", {"Distance": distance}, only_local=True, samples=8)
    return inv(n, sm(n, ao.outputs["AO"], 0.3, 0.95))


def edge_mask(n, radius=0.006):
    bev = n.add("ShaderNodeBevel", {"Radius": radius}, samples=8)
    geo = n.add("ShaderNodeNewGeometry")
    d = vm(n, "DOT_PRODUCT", bev.outputs["Normal"], geo.outputs["Normal"], out="Value")
    return sm(n, inv(n, d), 0.015, 0.12)


def up_facing(n):
    geo = n.add("ShaderNodeNewGeometry")
    return split(n, geo.outputs["Normal"])[2]


def voronoi(n, vec, scale, out="Distance", feature="F1", rand=1.0):
    node = n.add("ShaderNodeTexVoronoi", {"Vector": vec, "Scale": scale, "Randomness": rand},
                 feature=feature)
    return node.outputs[out]


def warped_m(n, co, amount=0.04, scale=6.0):
    """co pushed about by noise, so cell patterns lose their regular look."""
    wn = n.add("ShaderNodeTexNoise", {"Vector": co, "Scale": scale, "Detail": 3.0})
    return vm(n, "ADD", co, vm(n, "MULTIPLY", vm(n, "SUBTRACT", wn.outputs["Color"], (0.5, 0.5, 0.5)),
                                (amount, amount, amount)))


def _attrs(n):
    P = attr(n, "wpos").outputs["Vector"]
    M = attr(n, "wmeta").outputs["Vector"]
    seed, kind, _ = split(n, M)
    off = vm(n, "MULTIPLY", n.vec(seed, seed, seed), (37.1, 13.7, 71.3))
    return P, seed, kind, off


# Palette, linear.
MOSS_DARK = (0.022, 0.032, 0.009)
MOSS = (0.05, 0.068, 0.018)
LICHEN_GREY = (0.17, 0.185, 0.115)
LICHEN_YELLOW = (0.26, 0.2, 0.04)
LICHEN_WHITE = (0.24, 0.24, 0.21)
EARTH = (0.026, 0.02, 0.014)


def _moss_lichen(n, color, rough, height, co, z, moss, lichen, ground=0.35, kind=None):
    """Moss on top and low down, lichen in round crusts; returns colour, roughness, height."""
    up = up_facing(n)
    if moss > 0:
        patch = n.noise(3.5, detail=5, roughness=0.6, vector=co)
        fine = n.noise(60, detail=3, vector=co)
        top = mul(n, sm(n, up, 0.15, 0.75), sm(n, patch, 0.62 - 0.2 * moss, 0.7 - 0.2 * moss))
        low = mul(n, sm(n, z, ground, 0.0), sm(n, patch, 0.55 - 0.15 * moss, 0.66 - 0.15 * moss),
                  sm(n, up, -0.6, 0.2))
        m = clamp01(n, add(n, top, low))
        m = mul(n, m, sm(n, fine, 0.25, 0.45))
        if kind is not None:
            m = mul(n, m, inv(n, mul(n, is_kind(n, kind, END), 0.6)))
        mc = n.mix(n.noise(14, detail=3, vector=co), MOSS_DARK, MOSS)
        color = n.mix(m, color, mc)
        rough = n.lerp(m, rough, 0.95)
        height = add(n, height, mul(n, m, add(n, 0.5, mul(n, fine, 0.9))))
    if lichen > 0:
        wn = n.add("ShaderNodeTexNoise", {"Vector": co, "Scale": 9.0, "Detail": 4.0})
        warped = vm(n, "ADD", co, vm(n, "MULTIPLY", vm(n, "SUBTRACT", wn.outputs["Color"],
                                                       (0.5, 0.5, 0.5)), (0.12, 0.12, 0.12)))
        cell = n.add("ShaderNodeTexVoronoi", {"Vector": warped, "Scale": 6.0, "Randomness": 1.0})
        dist = cell.outputs["Distance"]
        pick = split(n, cell.outputs["Color"])
        rad = add(n, 0.12, mul(n, pick[0], 0.3))
        edge_noise = mul(n, n.noise(70, detail=4, vector=co), 0.25)
        crust = sm(n, add(n, dist, edge_noise), add(n, rad, 0.08), rad)
        # Crusts are patchy inside too: lobes and gaps.
        crust = mul(n, crust, sm(n, n.noise(45, detail=3, vector=co), 0.3, 0.5))
        crust = mul(n, crust, n.math("LESS_THAN", pick[1], 0.15 + 0.45 * lichen),
                    sm(n, up, -0.5, 0.3))
        lc = n.mix(sm(n, pick[2], 0.84, 0.88), LICHEN_GREY, LICHEN_YELLOW)
        lc = n.mix(sm(n, pick[0], 0.95, 0.97), lc, LICHEN_WHITE)
        lc = lib.shade(n, lc, add(n, 0.6, mul(n, n.noise(30, 3, vector=co), 0.6)))
        # A darker rim round each crust, and the crust thinner towards it.
        rim = mul(n, sm(n, add(n, dist, edge_noise), add(n, rad, 0.1), add(n, rad, 0.06)),
                  inv(n, crust), n.math("LESS_THAN", pick[1], 0.15 + 0.45 * lichen))
        color = n.mix(mul(n, rim, 0.4), color, lib.shade(n, color, 0.6))
        color = n.mix(mul(n, crust, 0.75), color, lc)
        rough = n.lerp(crust, rough, 0.9)
        height = add(n, height, mul(n, crust, 0.25))
    return color, rough, height


def wood(name, size=2048, *, tone="silver", bark=None, moss=0.4, lichen=0.5, paint=None,
         cover=0.6, rings=110, ground=0.35, checks=1.0, rot=0.4, end_dark=0.55):
    """
    Old timber, as one baked material for every part tagged with wpos/wmeta:

    - `tone`: "silver" (sun-greyed pine), "brown" (sheltered, greyish brown), "tar" (tarred, worn
      through to grey on top and on edges), "dark" (creosote: black-brown);
    - grain from the part's own rings: ridged where the soft earlywood has weathered away, flames
      across split faces, rings and radial checks on the end grain, long checks along it;
    - `bark` for the round outside: None (debarked, smoother), "birch" (white with dark lenticels)
      or "pine" (scaly grey-brown);
    - `paint` (a linear colour) peeled to `cover` of the surface;
    - moss on top and low down (`moss`, up to `ground` meters), lichen crusts (`lichen`), black
      mildew and rot low down (`rot`).
    """
    mat, n = lib.procedural(name, size)
    P, seed, kind, off = _attrs(n)
    u, v, s = split(n, P)
    co = n.coord()
    _, _, z = n.xyz(co)
    q = vm(n, "ADD", P, off)

    r = n.math("SQRT", add(n, mul(n, u, u), mul(n, v, v)))
    warp = n.noise(1.0, detail=2, vector=scaled(n, q, 7, 7, 0.6))
    rr = add(n, r, mul(n, n.math("SUBTRACT", warp, 0.5), 0.02))
    ring = n.math("FRACT", mul(n, rr, rings))
    late = mul(n, sm(n, ring, 0.62, 0.78), sm(n, ring, 1.0, 0.9))
    fib = n.noise(1.0, detail=4, roughness=0.6, vector=scaled(n, q, 120, 120, 3))
    streak = n.noise(1.0, detail=3, vector=scaled(n, q, 25, 25, 0.8))

    # Checks: long thin cracks along the grain, gathered in some parts of each piece.
    cn = n.noise(1.0, detail=2, vector=scaled(n, q, 22, 22, 0.7))
    crack = sm(n, n.math("ABSOLUTE", n.math("SUBTRACT", cn, 0.5)), 0.016, 0.0)
    crack = mul(n, crack, sm(n, n.noise(1.0, detail=2, vector=scaled(n, q, 3, 3, 0.4)), 0.42, 0.55),
                checks)

    bark_m = is_kind(n, kind, BARK)
    end_m = is_kind(n, kind, END)
    sd = n.math("FRACT", mul(n, seed, 3.7))

    if tone == "birch":
        light, dark = (0.22, 0.19, 0.15), (0.12, 0.1, 0.078)
    elif tone == "tar":
        light, dark = (0.05, 0.036, 0.024), (0.018, 0.013, 0.009)
    elif tone == "dark":
        light, dark = (0.035, 0.026, 0.018), (0.012, 0.009, 0.007)
    elif tone == "brown":
        light, dark = (0.11, 0.085, 0.06), (0.05, 0.038, 0.027)
    else:
        light, dark = (0.15, 0.142, 0.125), (0.068, 0.064, 0.056)
    base = n.mix(add(n, mul(n, fib, 0.7), mul(n, streak, 0.5), -0.25), dark, light)
    if tone == "silver":
        # Some pieces stayed browner, some went darker grey.
        base = n.mix(mul(n, sm(n, sd, 0.6, 0.9), 0.55), base, (0.085, 0.066, 0.046))
        base = n.mix(mul(n, sm(n, sd, 0.3, 0.05), 0.5), base, (0.055, 0.053, 0.05))
    if tone in ("tar", "dark"):
        # Tar worn back to grey wood on top and on the edges.
        worn = mul(n, clamp01(n, add(n, mul(n, sm(n, up_facing(n), 0.5, 0.95), 0.7),
                                     mul(n, edge_mask(n, 0.008), 0.8))),
                   sm(n, n.noise(8, detail=4, vector=q), 0.45, 0.6))
        grey = n.mix(fib, (0.06, 0.056, 0.05), (0.12, 0.112, 0.1))
        base = n.mix(worn, base, grey)
    blotch = n.noise(1.0, detail=3, vector=scaled(n, q, 3, 3, 0.9))
    color = lib.shade(n, base, mul(n, inv(n, mul(n, late, 0.4)), add(n, 0.7, mul(n, blotch, 0.6))))
    color = n.mix(mul(n, end_m, 0.6), color, lib.shade(n, color, end_dark))

    if bark == "birch":
        lent = n.noise(1.0, detail=2, vector=scaled(n, q, 14, 14, 160))
        lent = mul(n, sm(n, lent, 0.62, 0.68), sm(n, n.noise(1, 2, vector=scaled(n, q, 30, 30, 3)), 0.4, 0.6))
        patch = sm(n, n.noise(1.0, detail=4, vector=scaled(n, q, 9, 9, 3)), 0.66, 0.72)
        bc = n.mix(n.noise(1.0, 3, vector=scaled(n, q, 8, 8, 1)), (0.26, 0.25, 0.225), (0.36, 0.35, 0.32))
        bc = n.mix(mul(n, sm(n, sd, 0.5, 0.9), 0.4), bc, (0.21, 0.17, 0.12))  # some peeled, tan
        bc = n.mix(lent, bc, (0.03, 0.026, 0.022))
        bc = n.mix(patch, bc, (0.02, 0.018, 0.016))
        greying = sm(n, n.noise(2.0, 3, vector=co), 0.4, 0.75)
        bc = n.mix(mul(n, greying, 0.6), bc, (0.12, 0.115, 0.1))
        color = n.mix(bark_m, color, bc)
        bark_h = add(n, mul(n, lent, -0.6), mul(n, patch, 0.4))
    elif bark == "pine":
        plates = voronoi(n, scaled(n, q, 1, 1, 0.35), 40.0)
        pc = n.mix(sm(n, plates, 0.05, 0.25), (0.06, 0.045, 0.034), (0.022, 0.017, 0.013))
        color = n.mix(bark_m, color, pc)
        bark_h = mul(n, sm(n, plates, 0.0, 0.3), 1.0)
    else:
        bark_h = 0.0

    if paint is not None:
        peel = add(n, mul(n, n.noise(2.2, detail=5, roughness=0.65, vector=q), 0.75),
                   mul(n, n.noise(14, detail=3, vector=q), 0.25))
        # Paint lasts underneath and in the shelter of crevices, flakes off on top.
        peel = add(n, peel, mul(n, sm(n, up_facing(n), 0.2, 0.9), -0.12))
        keep = sm(n, peel, 1 - cover - 0.02, 1 - cover + 0.02)
        keep = mul(n, keep, inv(n, end_m), sm(n, crack, 0.5, 0.0))
        grey = sum(paint) / 3
        faded = [c * 0.6 + grey * 0.4 + 0.012 for c in paint]
        chalky = n.mix(n.noise(3, 3, vector=co), lib.shade(n, faded, 0.8), lib.shade(n, faded, 1.1))
        chalky = n.mix(mul(n, sm(n, n.noise(1.2, 3, vector=co), 0.45, 0.75), 0.5), chalky,
                       [c * 0.5 + grey * 0.5 + 0.03 for c in paint])
        chalky = n.mix(mul(n, sm(n, n.noise(7, 4, vector=q), 0.5, 0.7), 0.5), chalky, color)
        color = n.mix(keep, color, chalky)
        paint_h = mul(n, keep, 0.5)
    else:
        keep = 0.0
        paint_h = 0.0

    color = n.mix(mul(n, crack, 0.9), color, (0.012, 0.01, 0.008))

    # Black mildew and rot low down and in streaks.
    if rot > 0:
        mild = mul(n, sm(n, z, 0.6, 0.0), sm(n, n.noise(4, 5, vector=co), 0.45, 0.65), rot)
        wash = sm(n, n.noise(1.0, 3, vector=scaled(n, co, 30, 30, 1.5)), 0.6, 0.75)
        mild = clamp01(n, add(n, mild, mul(n, wash, 0.35, rot)))
        color = n.mix(mul(n, mild, 0.7), color, (0.018, 0.017, 0.015))
    dirt = cavity(n, 0.05)
    color = n.mix(mul(n, dirt, 0.6), color, EARTH)

    rough = add(n, 0.84, mul(n, fib, 0.12))
    rough = n.lerp(keep, rough, 0.7) if paint is not None else rough
    height = add(n, mul(n, late, 0.8 if tone == "silver" else 0.4), mul(n, fib, 0.5),
                 mul(n, crack, -1.0), mul(n, bark_m, bark_h), paint_h)
    color, rough, height = _moss_lichen(n, color, rough, height, co, z, moss, lichen, ground, kind)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.004)})
    return mat


def stone_material(name, size=2048, *, moss=0.6, lichen=0.7, ground=0.25, tint=None):
    """
    Granite and gneiss fieldstones, one baked material for every part tagged STONE: a tone and
    grain of its own for each stone (seeded), mica and feldspar speckle, banding on some, crusts
    of lichen, moss on top and low down, earth round the foot.
    """
    mat, n = lib.procedural(name, size)
    P, seed, kind, off = _attrs(n)
    co = n.coord()
    _, _, z = n.xyz(co)
    q = vm(n, "ADD", P, off)
    sd = n.math("FRACT", mul(n, seed, 5.3))
    sd2 = n.math("FRACT", mul(n, seed, 11.7))
    sd3 = n.math("FRACT", mul(n, seed, 23.1))
    up = up_facing(n)
    geo_n = n.add("ShaderNodeNewGeometry").outputs["Normal"]
    _, ny, _ = split(n, geo_n)

    # Each stone its own rock: dark amphibolite, grey gneiss, pale granite, a few iron-brown.
    grey = n.mix(sd, (0.028, 0.029, 0.03), (0.075, 0.075, 0.074))
    grey = n.mix(mul(n, sm(n, sd, 0.82, 0.95), 0.8), grey, (0.12, 0.116, 0.108))
    grey = n.mix(mul(n, sm(n, sd2, 0.72, 0.9), 0.7), grey, (0.085, 0.07, 0.056))
    if tint is not None:
        grey = n.add("ShaderNodeMix", {"Factor": 1.0, "A": grey, "B": tint}, data_type="RGBA",
                     blend_type="MULTIPLY").outputs["Result"]
    mott = n.noise(6, detail=5, vector=q)
    broad = n.noise(1.8, detail=3, vector=q)
    color = lib.shade(n, grey, mul(n, add(n, 0.72, mul(n, mott, 0.55)), add(n, 0.62, mul(n, broad, 0.75))))
    # A paler weathered rind on faces turned to the sky, dark rain streaks down the sides.
    color = n.mix(mul(n, sm(n, up, 0.3, 0.9), 0.3), color, lib.shade(n, color, 1.3))
    streaks = sm(n, n.noise(1.0, 3, vector=scaled(n, q, 25, 25, 1.2)), 0.55, 0.72)
    color = n.mix(mul(n, streaks, sm(n, up, 0.5, -0.2), 0.55), color, (0.014, 0.014, 0.013))
    # Gneiss banding on a third of the stones, quartz veins on a few.
    band = n.noise(1.0, detail=3, vector=scaled(n, q, 2, 2, 22))
    band_on = n.math("LESS_THAN", sd2, 0.33)
    color = n.mix(mul(n, sm(n, band, 0.55, 0.65), band_on, 0.55), color, (0.03, 0.029, 0.028))
    vein = sm(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(1.0, 2, vector=scaled(n, q, 3, 9, 3)), 0.5)),
              0.004, 0.001)
    color = n.mix(mul(n, vein, n.math("LESS_THAN", sd3, 0.12), 0.35), color, (0.11, 0.108, 0.104))
    # Iron staining in rusty blooms on some stones.
    iron = mul(n, sm(n, n.noise(4, 4, vector=q), 0.55, 0.75), n.math("GREATER_THAN", sd3, 0.7))
    color = n.mix(mul(n, iron, 0.6), color, (0.075, 0.045, 0.025))
    # Speckle: dark mica and pale feldspar grains.
    sp = n.add("ShaderNodeTexVoronoi", {"Vector": q, "Scale": 260.0, "Randomness": 1.0})
    spc = split(n, sp.outputs["Color"])
    grain = sm(n, sp.outputs["Distance"], 0.35, 0.15)
    color = n.mix(mul(n, grain, n.math("LESS_THAN", spc[0], 0.3), 0.8), color, (0.015, 0.015, 0.015))
    color = n.mix(mul(n, grain, n.math("GREATER_THAN", spc[0], 0.85), 0.5), color, (0.2, 0.19, 0.18))

    # Relief: grain, pitting, knobbly weathering, and hairline cracks.
    pits_v = n.add("ShaderNodeTexVoronoi", {"Vector": q, "Scale": 55.0, "Randomness": 1.0})
    pit = mul(n, sm(n, pits_v.outputs["Distance"], 0.22, 0.05),
              sm(n, n.noise(9, 3, vector=q), 0.45, 0.6))
    fine = n.noise(120, detail=3, vector=q)
    knobs = n.noise(22, detail=4, vector=q)
    crack = sm(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(3.5, 3, vector=q), 0.5)), 0.012, 0.0)
    crack = mul(n, crack, sm(n, n.noise(2, 2, vector=q), 0.45, 0.6))
    color = n.mix(mul(n, pit, 0.5), color, lib.shade(n, color, 0.45))
    color = n.mix(mul(n, crack, 0.85), color, (0.008, 0.008, 0.008))
    rough = add(n, 0.74, mul(n, fine, 0.14))
    lumps = n.noise(3, detail=4, roughness=0.6, vector=q)
    height = add(n, mul(n, fine, 0.15), mul(n, mott, 0.7), mul(n, knobs, 0.5), mul(n, grain, 0.06),
                 mul(n, lumps, 1.2), mul(n, pit, -0.3), mul(n, crack, -0.6))

    dirt = cavity(n, 0.08)
    color = n.mix(mul(n, dirt, 0.8), color, (0.01, 0.009, 0.008))
    rough = n.lerp(dirt, rough, 0.92)

    # Lichen crusts, mostly on the flanks: pale grey-green, white, a little dull yellow.
    if lichen > 0:
        wn = n.add("ShaderNodeTexNoise", {"Vector": co, "Scale": 9.0, "Detail": 4.0})
        warped = vm(n, "ADD", co, vm(n, "MULTIPLY", vm(n, "SUBTRACT", wn.outputs["Color"],
                                                       (0.5, 0.5, 0.5)), (0.1, 0.1, 0.1)))
        cell = n.add("ShaderNodeTexVoronoi", {"Vector": warped, "Scale": 7.0, "Randomness": 1.0})
        dist = cell.outputs["Distance"]
        pick = split(n, cell.outputs["Color"])
        rad = add(n, 0.08, mul(n, pick[0], 0.3))
        edge_noise = mul(n, n.noise(80, detail=4, vector=co), 0.22)
        crust = sm(n, add(n, dist, edge_noise), add(n, rad, 0.05), rad)
        crust = mul(n, crust, sm(n, n.noise(50, detail=3, vector=co), 0.32, 0.52))
        crust = mul(n, crust, n.math("LESS_THAN", pick[1], 0.2 + 0.5 * lichen), sm(n, up, -0.6, 0.1))
        lc = n.mix(sm(n, pick[2], 0.55, 0.6), (0.13, 0.14, 0.115), (0.19, 0.19, 0.175))
        lc = n.mix(sm(n, pick[2], 0.9, 0.93), lc, (0.15, 0.125, 0.07))
        lc = lib.shade(n, lc, add(n, 0.65, mul(n, n.noise(35, 3, vector=co), 0.55)))
        color = n.mix(mul(n, crust, 0.85), color, lc)
        rough = n.lerp(crust, rough, 0.9)
        height = add(n, height, mul(n, crust, 0.12))
        # Black dot lichen and soot-dark crust on the weather side.
        dots = mul(n, sm(n, n.noise(45, 3, vector=co), 0.7, 0.74), sm(n, ny, -0.2, 0.6), lichen)
        color = n.mix(mul(n, dots, 0.8), color, (0.012, 0.012, 0.011))

    # Moss: thick cushions on top and over the weather side (+y), creeping down the hollows and
    # cracks, its edge breaking up into patches; a thin green film round it.
    if moss > 0:
        edge = n.noise(4, detail=6, roughness=0.65, vector=co)
        patch = n.noise(1.2, detail=3, vector=co)
        m = add(n, mul(n, up, 0.9), mul(n, sm(n, ny, 0.1, 0.9), 0.35),
                mul(n, dirt, 0.5), mul(n, crack, 0.3),
                mul(n, n.math("SUBTRACT", edge, 0.5), 1.1), mul(n, n.math("SUBTRACT", patch, 0.5), 0.6))
        lo_t = 0.95 - 0.45 * moss
        thick = sm(n, m, lo_t, lo_t + 0.1)
        film = sm(n, m, lo_t - 0.35, lo_t)
        clump_v = n.add("ShaderNodeTexVoronoi", {"Vector": warped_m(n, co), "Scale": 18.0,
                                                 "Randomness": 1.0})
        clump = mul(n, sm(n, clump_v.outputs["Distance"], 0.9, 0.1),
                    add(n, 0.4, mul(n, n.noise(9, 4, vector=co), 0.9)))
        fuzz = n.noise(160, detail=3, vector=co)
        cushion = mul(n, thick, add(n, 0.45, mul(n, clump, 0.6)), add(n, 0.75, mul(n, fuzz, 0.5)))
        # Broken edge: the thick moss frays into the film in specks.
        cushion = mul(n, cushion, sm(n, add(n, thick, mul(n, fuzz, 0.6)), 0.55, 0.85))
        mc = n.mix(n.noise(14, detail=3, vector=co), (0.018, 0.022, 0.01), (0.058, 0.066, 0.028))
        mc = n.mix(mul(n, sm(n, n.noise(3, 3, vector=co), 0.55, 0.75), 0.7), mc, (0.06, 0.055, 0.03))
        mc = lib.shade(n, mc, add(n, 0.6, mul(n, clump, 0.4), mul(n, fuzz, 0.3)))
        color = n.mix(mul(n, film, 0.5), color, lib.shade(n, n.mix(0.5, color, (0.03, 0.04, 0.022)), 0.85))
        mm = sm(n, cushion, 0.05, 0.25)
        color = n.mix(mm, color, mc)
        rough = n.lerp(mm, rough, 0.97)
        height = add(n, height, mul(n, cushion, 2.2))

    # Earth at the foot, a dark wet line where it meets the ground, dead grass caught round it,
    # and fallen leaves on the ledges.
    low = mul(n, sm(n, add(n, z, mul(n, n.math("SUBTRACT", n.noise(5, 4, vector=co), 0.5), 0.12)),
                    ground * 0.6, 0.0), 0.9)
    color = n.mix(low, color, n.mix(n.noise(30, 3, vector=co), EARTH, (0.04, 0.032, 0.022)))
    wet = sm(n, z, 0.07, 0.0)
    color = n.mix(mul(n, wet, 0.7), color, lib.shade(n, color, 0.4))
    rough = n.lerp(low, rough, 0.95)
    rough = n.lerp(wet, rough, 0.6)
    blades = n.noise(1.0, detail=3, vector=scaled(n, co, 110, 110, 5))
    grass = mul(n, sm(n, add(n, z, mul(n, n.noise(7, 3, vector=co), 0.1)), 0.16, 0.02),
                sm(n, blades, 0.45, 0.62), sm(n, up, 0.7, -0.2))
    gc = n.mix(sm(n, z, 0.0, 0.14), (0.03, 0.026, 0.016), (0.1, 0.085, 0.05))
    color = n.mix(grass, color, gc)
    height = add(n, height, mul(n, grass, 0.6))
    leaf_v = n.add("ShaderNodeTexVoronoi", {"Vector": scaled(n, co, 1, 1, 0.3), "Scale": 22.0,
                                            "Randomness": 1.0})
    lpick = split(n, leaf_v.outputs["Color"])
    leaf = mul(n, sm(n, leaf_v.outputs["Distance"], 0.42, 0.3),
               n.math("LESS_THAN", lpick[0], add(n, 0.12, mul(n, sm(n, z, 0.3, 0.0), 0.4))),
               sm(n, up, 0.35, 0.8))
    lcol = n.mix(lpick[1], (0.05, 0.03, 0.015), (0.11, 0.07, 0.03))
    lcol = n.mix(sm(n, lpick[2], 0.6, 0.9), lcol, (0.03, 0.024, 0.017))
    color = n.mix(leaf, color, lcol)
    height = add(n, height, mul(n, leaf, 0.2))
    # The core, seen deep in the gaps: small dark stones packed in earth.
    core = is_kind(n, kind, CORE)
    rco = warped_m(n, co, 0.05, 4.0)
    rub = n.add("ShaderNodeTexVoronoi", {"Vector": rco, "Scale": 9.0, "Randomness": 1.0})
    rub_e = n.add("ShaderNodeTexVoronoi", {"Vector": rco, "Scale": 9.0, "Randomness": 1.0},
                  feature="DISTANCE_TO_EDGE")
    rpick = split(n, rub.outputs["Color"])
    pebble = mul(n, sm(n, add(n, rub_e.outputs["Distance"], mul(n, n.noise(25, 3, vector=co), 0.08)),
                       0.02, 0.14), add(n, 0.6, mul(n, rpick[1], 0.4)))
    rc = n.mix(pebble, (0.004, 0.0037, 0.0033),
               lib.shade(n, n.mix(rpick[0], (0.008, 0.008, 0.008), (0.022, 0.021, 0.019)),
                         add(n, 0.6, mul(n, n.noise(20, 4, vector=co), 0.8))))
    color = n.mix(core, color, rc)
    rough = n.lerp(core, rough, 0.9)
    height = n.lerp(core, height, mul(n, pebble, 1.5))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.01)})
    return mat


def rust(name, size=1024, *, scale=1.0, metallic=0.25):
    """Forged iron gone to rust: dark scale, orange bloom in patches, pitted and flaking."""
    mat, n = lib.procedural(name, size)
    co = n.coord()
    s = scale
    big = n.noise(6 / s, detail=4, vector=co)
    fine = n.noise(70 / s, detail=5, roughness=0.65, vector=co)
    color = n.mix(big, (0.03, 0.017, 0.011), (0.09, 0.036, 0.015))
    bloom = mul(n, sm(n, n.noise(18 / s, detail=5, vector=co), 0.58, 0.7), sm(n, fine, 0.4, 0.6))
    color = n.mix(bloom, color, (0.17, 0.065, 0.02))
    scale_m = sm(n, n.noise(9 / s, detail=4, vector=co), 0.35, 0.25)
    color = n.mix(mul(n, scale_m, 0.8), color, (0.022, 0.019, 0.017))
    dirt = cavity(n, 0.03)
    color = n.mix(mul(n, dirt, 0.6), color, (0.015, 0.011, 0.008))
    rough = n.lerp(scale_m, add(n, 0.82, mul(n, fine, 0.12)), 0.6)
    height = add(n, mul(n, fine, 0.7), mul(n, bloom, 0.4), mul(n, big, 0.3))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.0015)})
    mat.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = metallic
    return mat


def tinned(name, size=1024, *, dents=1.0):
    """Tinned steel milk churn gone dull: grey, dark oxidation, rust where the tin wore through."""
    mat, n = lib.procedural(name, size)
    co = n.coord()
    _, _, z = n.xyz(co)
    big = n.noise(4, detail=4, vector=co)
    color = n.mix(big, (0.12, 0.12, 0.115), (0.22, 0.22, 0.21))
    ox = sm(n, n.noise(7, detail=5, vector=co), 0.5, 0.65)
    color = n.mix(mul(n, ox, 0.7), color, (0.06, 0.058, 0.052))
    worn = clamp01(n, add(n, mul(n, edge_mask(n, 0.006), 0.7), mul(n, sm(n, z, 0.25, 0.0), 0.6)))
    lo = n.math("SUBTRACT", 0.62, mul(n, worn, 0.3))
    rusty = sm(n, n.noise(25, detail=5, vector=co), lo, add(n, lo, 0.08))
    rc = n.mix(n.noise(80, 3, vector=co), (0.06, 0.025, 0.01), (0.15, 0.058, 0.02))
    color = n.mix(rusty, color, rc)
    streak = mul(n, sm(n, n.noise(1, 3, vector=scaled(n, co, 40, 40, 1.5)), 0.6, 0.72), 0.6)
    color = n.mix(streak, color, (0.08, 0.04, 0.02))
    dirt = cavity(n, 0.04)
    color = n.mix(mul(n, dirt, 0.6), color, EARTH)
    rough = add(n, 0.45, mul(n, ox, 0.2), mul(n, rusty, 0.35))
    height = add(n, mul(n, n.noise(5, 3, vector=co), dents * 0.8), mul(n, rusty, 0.3))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.003)})
    mat.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.55
    return mat


def hay(name, size=1024):
    """Sixty-year-old hay: grey-brown strands, matted and mouldy, tagged HAY along their length."""
    mat, n = lib.procedural(name, size)
    P, seed, kind, off = _attrs(n)
    co = n.coord()
    q = vm(n, "ADD", P, off)
    fib = n.noise(1.0, detail=3, vector=scaled(n, q, 260, 260, 6))
    fib2 = n.noise(1.0, detail=2, vector=scaled(n, co, 90, 90, 90))
    color = n.mix(add(n, mul(n, fib, 0.7), mul(n, fib2, 0.5), -0.2), (0.035, 0.03, 0.022),
                  (0.1, 0.088, 0.06))
    mould = sm(n, n.noise(8, 4, vector=co), 0.55, 0.7)
    color = n.mix(mul(n, mould, 0.7), color, (0.02, 0.019, 0.016))
    dirt = cavity(n, 0.04)
    color = n.mix(mul(n, dirt, 0.7), color, (0.015, 0.013, 0.01))
    height = add(n, mul(n, sm(n, fib, 0.4, 0.6), 0.8), mul(n, fib2, 0.6))
    n.out(**{"Base Color": color, "Roughness": 0.92, "Normal": n.bump(height, distance=0.003)})
    return mat


# ---------------------------------------------------------------------------------------------
# Dry-stone walls


def cull(obj, test):
    """Delete the faces of obj for which test(centre, normal) is true: faces nobody can see."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    dead = [f for f in bm.faces if test(f.calc_center_median(), f.normal)]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def wall_face(z, depth, top_depth, height):
    """How far the wall's face is from its middle at height z: it leans in (battered) to the top."""
    k = min(max(z / height, 0.0), 1.0)
    return depth / 2 - (depth / 2 - top_depth / 2) * k


def dry_wall(stone_mat, core_mat, rng, x0, x1, *, height=1.0, depth=0.9, top_depth=0.56,
             height_at=None, spill=None, periodic=True, scale=1.0):
    """
    A dry-stone field wall from x0 to x1 along x: two faces of rounded fieldstones of every size,
    packed course on course where each stone settles on the ones below it, leaning in to the top,
    capped by mossy through-stones, small stones chinked into the gaps, and a dark core of rubble
    and earth behind. `periodic` packs it as a loop, so with wrap_x it tiles. `height_at(x)` lowers
    the wall where it has tumbled; the stones that would have stood there are handed to
    `spill(size)` -> (x, y, z, turn, tilt) to lie on the ground, or left out. `scale` sizes the
    stones (a short piece wants smaller ones).
    Returns the stones and the core.
    """
    height_at = height_at or (lambda x: height)
    stones = []
    face = lambda z: wall_face(z, depth, top_depth, height)  # noqa: E731
    span = x1 - x0
    cell = 0.05
    N = int(round(span / cell))

    def cells(a, L):
        i0 = int(round((a - x0) / cell))
        i1 = max(i0 + 1, int(round((a + L - x0) / cell)))
        out = []
        for i in range(i0, i1):
            if periodic:
                out.append(i % N)
            elif 0 <= i < N:
                out.append(i)
        return out

    def place(name, size, at, cuts=2, turn=0.0, tilt=(0.0, 0.0), roundness=None, side=0,
              outward=None, points=None, facets=None):
        if roundness is None:
            # Glacial fieldstones: some ice-rounded, some broken and angular.
            roundness = rng.uniform(0.4, 0.72) if rng.random() < 0.55 else rng.uniform(0.05, 0.35)
        faces = ()
        if side and outward is not None:
            # Laid with a flat face outwards, as a waller picks them.
            faces = (((rng.uniform(-0.15, 0.15), side, rng.uniform(-0.15, 0.1)), outward),)
        o = stone(name, size, at, stone_mat, rng.random(), cuts=cuts, roundness=roundness,
                  lump=rng.uniform(0.07, 0.15), turn=turn, tilt=tilt,
                  facets=rng.randint(1, 3) if facets is None else facets,
                  flat=rng.uniform(0.1, 0.3), faces=faces, points=points)
        if side:
            # Faces turned in to the core, deep inside the wall, and on the ground are never seen.
            def hidden(c, nrm):
                inward = nrm.y * side < -0.5 and abs(c.y) < face(c.z) - 0.1
                return inward or (nrm.z < -0.7 and c.z < 0.04)
            cull(o, hidden)
        stones.append(o)
        return o

    def fallen(size):
        if spill is None:
            return
        size = tuple(min(v, 0.5) for v in size)
        res = spill(size)
        if res:
            x, y, z, turn, tilt = res
            place("fallen", size, (x, y, z), cuts=2 if max(size) > 0.3 else 1, turn=turn, tilt=tilt)

    cap_h = 0.3
    face_top = height - cap_h
    skies = {}
    # The courses sag and rise along the wall where the ground has settled (periodic, so it tiles).
    ph = [rng.uniform(0, 6.28) for _ in range(3)]

    def sag(x):
        t = (x - x0) / span * 2 * math.pi
        return (0.035 * math.sin(t + ph[0]) + 0.02 * math.sin(2 * t + ph[1])
                + 0.01 * math.sin(3 * t + ph[2]))

    joints = []  # (side, x, z) where stones meet: chinking goes there
    for side in (-1, 1):
        sky = [sag(x0 + (i + 0.5) * cell) - 0.05 for i in range(N)]
        for row in range(8):
            x = x0 + rng.uniform(0, span) if periodic else x0 - rng.uniform(0.0, 0.2)
            end = x + span if periodic else x1
            while x < end - 0.05:
                cs0 = cells(x, 0.3)
                lvl = (sum(sky[i] for i in cs0) / len(cs0)) if cs0 else 0.0
                # Big stones low down, smaller towards the top.
                grade = (1.3 - 0.75 * min(max(lvl / face_top, 0.0), 1.0)) * scale
                r = rng.random()
                if r < 0.3:
                    L = rng.uniform(0.55, 0.9) * grade
                    h = L * rng.uniform(0.45, 0.75)
                elif r < 0.4 and lvl < 0.25:
                    # A stone set on end.
                    L = rng.uniform(0.22, 0.34) * scale
                    h = L * rng.uniform(1.2, 1.7)
                else:
                    L = rng.uniform(0.2, 0.5) * grade
                    h = L * rng.uniform(0.5, 0.9)
                L = max(0.16, L)
                if end - (x + L) < 0.16:
                    L = end - x
                cs = cells(x, L)
                cx = x + L / 2
                x0s = x
                x += L
                if not cs:
                    continue
                bottom = max(sky[i] for i in cs) - 0.035
                limit = min(face_top + sag(cx), height_at(cx) - 0.12)
                room = limit - bottom
                if room < 0.08:
                    if bottom < height and height_at(cx) < height - 0.1 and row < 3:
                        fallen((L, rng.uniform(0.3, 0.45), h))
                    continue
                h = max(0.1, min(h, room + 0.06))
                d = min(rng.uniform(0.3, 0.5), face(bottom) * 1.1)
                zc = bottom + h / 2
                y = side * (face(zc) - d / 2 + rng.uniform(-0.04, 0.02))
                big = L > 0.42 or h > 0.36
                place("stone", (L + 0.09, d, h + 0.06), (cx, y, zc),
                      cuts=2 if big else 1, points=40 if big else (22 if L > 0.28 else 16),
                      turn=rng.uniform(-0.12, 0.12),
                      tilt=(rng.uniform(-0.1, 0.1), rng.uniform(-0.16, 0.16)), side=side,
                      outward=rng.uniform(0.7, 0.92))
                joints.append((side, x0s, bottom + h * rng.uniform(0.75, 1.0)))
                if rng.random() < 0.5:
                    joints.append((side, x0s, bottom + h * rng.uniform(0.0, 0.25)))
                for i in cs:
                    sky[i] = bottom + h
        skies[side] = sky
    # Through-stones across the top, on whichever face stands higher beneath.
    x = x0 + rng.uniform(0, span) if periodic else x0 - rng.uniform(0.0, 0.2)
    end = x + span if periodic else x1
    while x < end - 0.05:
        L = rng.uniform(0.38, 0.65)
        if end - (x + L) < 0.2:
            L = end - x
        cs = cells(x, L)
        cx = x + L / 2
        x += L
        if not cs:
            continue
        bottom = max(max(skies[-1][i], skies[1][i]) for i in cs) - 0.04
        h = rng.uniform(0.2, 0.27)
        if bottom + h > height_at(cx) + 0.05:
            fallen((L, 0.45, h))
            continue
        zc = bottom + h / 2
        d = 2 * face(zc) + rng.uniform(-0.04, 0.04)
        if rng.random() < 0.3 and d > 0.4:
            # Two stones side by side across the top instead of one through-stone.
            for s in (-1, 1):
                place("cap", (L * rng.uniform(0.85, 1.05), d * 0.56, h * rng.uniform(0.8, 1.05)),
                      (cx + rng.uniform(-0.04, 0.04), s * d * 0.24, zc), cuts=2, points=28,
                      turn=rng.uniform(-0.25, 0.25),
                      tilt=(rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15)))
            continue
        place("cap", (L + 0.05, d, h + 0.03), (cx, rng.uniform(-0.04, 0.04), zc), cuts=2,
              points=36, turn=rng.uniform(-0.2, 0.2),
              tilt=(rng.uniform(-0.12, 0.12), rng.uniform(-0.15, 0.15)),
              roundness=rng.uniform(0.25, 0.8))
    # Chinking: small stones wedged into the joints where face stones meet, and a few slivers
    # driven into the bed joints.
    for side, cx, zc in joints:
        if rng.random() > 0.75 or zc < 0.04 or zc > height_at(cx) - 0.15:
            continue
        sz = rng.uniform(0.08, 0.16)
        if rng.random() < 0.15:
            size = (sz * rng.uniform(1.6, 2.4), sz, sz * rng.uniform(0.3, 0.45))
        else:
            size = (sz * rng.uniform(0.8, 1.4), sz, sz * rng.uniform(0.6, 1.0))
        cx = cx + rng.uniform(-0.03, 0.03)
        if periodic and not (x0 < cx < x1):
            cx = x0 + (cx - x0) % span
        place("chink", size, (cx, side * (face(zc) - sz * 0.78), zc), cuts=0,
              points=15, turn=rng.uniform(-0.5, 0.5), roundness=rng.uniform(0.45, 0.8),
              tilt=(0, rng.uniform(-0.4, 0.4)), side=side, facets=rng.randint(0, 1))

    # The core: a dark mass of earth and rubble, its top following the wall down where it's fallen.
    bm = bmesh.new()
    xs = [x0 + (x1 - x0) * i / 8 for i in range(9)]
    xs = [x for x in xs if height_at(x) > 0.3]
    rows = []
    for x in xs:
        top = max(0.05, min(height_at(x), height) - 0.3)
        fb, ft = face(0) - 0.2, face(top) - 0.2
        rows.append([bm.verts.new(p) for p in
                     ((x, -fb, 0.0), (x, -ft, top), (x, ft, top), (x, fb, 0.0))])
    for r0, r1 in zip(rows, rows[1:]):
        for i in range(3):
            _face(bm, (r0[i], r0[i + 1], r1[i + 1], r1[i]),
                  Vector((0, [-1, 0, 1][i], 1 if i == 1 else 0.3)))
    core = _obj("core", bm, core_mat)
    tag_all(core, rng.random(), CORE)
    return stones, core


def clip_ground(z=0.0):
    """Cut away everything below z, so the model stands on its base and doesn't float."""
    for o in [o for o in list(bpy.context.scene.objects) if o.type == "MESH"]:
        if o.data.vertices and min((o.matrix_world @ v.co).z for v in o.data.vertices) < z:
            o.data.transform(o.matrix_world)
            o.matrix_world = Matrix.Identity(4)
            clip(o, (0, 0, z), (0, 0, -1))


def ring(name, centre, radius, width, thick, mat, seed, *, axis="x", segments=36, a0=0.0,
         a1=2 * math.pi, rough=0.0, kind=SPLIT):
    """
    A band round `axis` through `centre`: `radius` to its inside, `thick` outwards, `width` along
    the axis, from angle a0 to a1 (an arc has flat ends): wheel felloes, iron tyres, hoops.
    """
    rng = random.Random(int(seed * 100003) + 5)
    off = rng.uniform(0, 500)
    c = Vector(centre)
    closed = abs(a1 - a0 - 2 * math.pi) < 1e-6
    n = segments if closed else max(2, int(segments * (a1 - a0) / (2 * math.pi)) + 1)
    if axis == "x":
        ax, e1, e2 = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    elif axis == "y":
        ax, e1, e2 = Vector((0, 1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1))
    else:
        ax, e1, e2 = Vector((0, 0, 1)), Vector((1, 0, 0)), Vector((0, 1, 0))
    bm = bmesh.new()
    wpos, wmeta = _layers(bm)
    sd = _seed01(seed)
    rows = []
    count = n if closed else n
    for i in range(count):
        a = a0 + (a1 - a0) * i / (n if closed else n - 1)
        rad = math.cos(a) * e1 + math.sin(a) * e2
        k = 1 + rough * _n((math.cos(a) * 2, math.sin(a) * 2, 0.3), off)
        row = []
        for dr, dw in ((0, -0.5), (1, -0.5), (1, 0.5), (0, 0.5)):
            p = c + rad * (radius + dr * thick * k) + ax * (dw * width)
            v = bm.verts.new(p)
            v[wpos] = ((dr - 0.5) * thick, dw * width - 0.1, a * radius)
            v[wmeta] = (sd, kind, 0)
            row.append(v)
        rows.append((row, rad))
    pairs = list(zip(rows, rows[1:])) + ([(rows[-1], rows[0])] if closed else [])
    for (r0, d0), (r1, d1) in pairs:
        dm = (d0 + d1).normalized()
        sec_mid = c + dm * (radius + thick / 2)
        for j in range(4):
            q = (r0[j], r0[(j + 1) % 4], r1[(j + 1) % 4], r1[j])
            mid = sum((v.co for v in q), Vector()) / 4
            _face(bm, q, mid - sec_mid)
    if not closed:
        for (row, rad), sign in ((rows[0], -1), (rows[-1], 1)):
            tangent = ax.cross(rad) * sign
            verts = []
            for v in row:
                nv = bm.verts.new(v.co)
                nv[wpos] = v[wpos]
                nv[wmeta] = (sd, END, 0)
                verts.append(nv)
            _face(bm, verts, tangent)
    return _obj(name, bm, mat)


def wheel(prefix, centre, radius, wood_mat, iron_mat, rng, *, spokes=12, axis="x", width=0.07,
          dish=0.0, broken=(), tyre=True, hub_len=0.26):
    """
    A cart wheel round `axis` (x) at `centre`: a turned hub with iron bands, `spokes` tapered
    spokes (indices in `broken` snapped off), felloes in six arcs, an iron tyre shrunk on.
    Returns its objects.
    """
    import lib
    made_objs = []
    c = Vector(centre)
    felloe_t = 0.06
    rim_in = radius - (0.012 if tyre else 0) - felloe_t
    n_fel = 6
    for i in range(n_fel):
        a0 = 2 * math.pi * i / n_fel + 0.004
        a1 = 2 * math.pi * (i + 1) / n_fel - 0.004
        made_objs.append(ring(f"{prefix}-felloe", c, rim_in, width, felloe_t, wood_mat, rng.random(),
                              segments=36, a0=a0, a1=a1, rough=0.04, axis=axis))
    if tyre:
        made_objs.append(ring(f"{prefix}-tyre", c, radius - 0.012, width + 0.006, 0.012, iron_mat,
                              rng.random(), segments=40, axis=axis))
    hub = lib.lathe(f"{prefix}-hub", [(-hub_len / 2, 0.045), (-hub_len / 2 + 0.02, 0.07),
                                      (-0.04, 0.095), (0.04, 0.095), (hub_len / 2 - 0.02, 0.075),
                                      (hub_len / 2, 0.05)], c, axis="x", mat=wood_mat, sides=12)
    tag_all(hub, rng.random(), BARK)
    made_objs.append(hub)
    for xo, r in ((-hub_len / 2 + 0.025, 0.074), (hub_len / 2 - 0.025, 0.079)):
        band = lib.lathe(f"{prefix}-band", [(xo - 0.012, r), (xo + 0.012, r)], c, axis="x",
                         mat=iron_mat, sides=12)
        made_objs.append(band)
    cap = lib.lathe(f"{prefix}-cap", [(hub_len / 2, 0.035), (hub_len / 2 + 0.03, 0.03),
                                      (hub_len / 2 + 0.035, 0.0)], c, axis="x", mat=iron_mat, sides=8)
    made_objs.append(cap)
    for i in range(spokes):
        a = 2 * math.pi * (i + 0.5) / spokes + rng.uniform(-0.01, 0.01)
        d = Vector((0, math.cos(a), math.sin(a)))
        inner = c + d * 0.085 + Vector((dish * -0.5, 0, 0))
        outer = c + d * (rim_in + 0.02) + Vector((dish * 0.5, 0, 0))
        if i in broken:
            outer = inner.lerp(outer, rng.uniform(0.3, 0.6))
        sec = round_section(0.022, 6, rng, oval=0.3)
        made_objs.append(timber(f"{prefix}-spoke", sec, inner, outer, wood_mat, rng.random(),
                                up=(1, 0, 0), stations=3, taper=0.75, rough=0.05, chamfer=0.006,
                                ragged=(0, 0.03 if i in broken else 0)))
    return made_objs
