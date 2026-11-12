"""
Shared by the village buildings (log farmhouse, stabbur, boathouse, woodshed, outhouse): not a
model itself, as it has no build(), so index.ts doesn't list it.

West Norwegian rural building, hand-built and old:

- Part: faces gathered in one bmesh with a material per face, made into one object at the end, so
  thousands of logs, stones and grass blades don't each become an object.
- cuboid(), beam(): boxes into a Part, placed by a matrix or between two points, faces skippable.
- log(): a hewn log, a lumpy superellipse tube with a taper, a bow, chamfered or sloped ends.
- log_walls(): notched-log (lafting) walls round a rectangle: alternating courses whose ends stand
  out past every corner, openings cut out, partition walls' heads, log gables cut to the roof.
- stone(), fieldstones(), slab_stack(): irregular granite stones, a dry-stone foundation, a stack
  of slabs (chimney, pillar).
- turf_roof(): purlins, roof boards, birch bark curling out at the eaves, the turf log on its
  hooks, lumpy turf over the lot with a sag in the ridge, crossed vergeboards, dead grass blades.
- window(), plank_door(): white-trimmed multi-pane windows with broken panes, plank doors with
  strap hinges.
- Materials: timber() (tarred, sun-burnt or silvered wood, logs or boards, optionally painted and
  peeling), stone_mat() (granite or slate with lichen and moss), turf_mat(), bark_mat(), plain
  ones in plain().

Every builder works in meters, front facing -y, z up, as lib.py says.
"""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils import noise as mnoise

import lib
from cargo import Field, normal, smooth

UP = Vector((0, 0, 1))


# --- Mesh building ------------------------------------------------------------------------------


class Part:
    """Faces in one bmesh, each with its own material; finish() makes the object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def verts(self, cos):
        return [self.bm.verts.new(c) for c in cos]

    def face(self, verts, mat, facing=None):
        """A face through `verts` (BMVerts or points); `facing` turns it to face that way."""
        if verts and not isinstance(verts[0], bmesh.types.BMVert):
            verts = self.verts(verts)
        if facing is not None:
            a, b, c = (v.co for v in verts[:3])
            if (b - a).cross(c - a).dot(Vector(facing)) < 0:
                verts = verts[::-1]
        f = self.bm.faces.new(verts)
        f.material_index = self.slot(mat)
        return f

    def finish(self, bevel=0.0):
        """The object; `bevel` rounds its sharp edges that much."""
        if not self.bm.faces:
            self.bm.free()
            return None
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if bevel:
            lib._bevel(obj, bevel, 1)
        return obj


def made(fn, *args, **kw):
    """Runs fn and returns what it returns and every object it added to the scene."""
    before = set(bpy.context.scene.objects)
    result = fn(*args, **kw)
    return result, [o for o in bpy.context.scene.objects if o not in before]


def place(objs, m):
    """Moves objects by the matrix m."""
    for o in objs:
        o.matrix_world = m @ o.matrix_world


def turn(angle, at=(0, 0, 0)):
    """A turn of `angle` round z, then a move to `at`."""
    return Matrix.Translation(Vector(at)) @ Matrix.Rotation(angle, 4, "Z")


FACINGS = {"-y": 0.0, "x": math.pi / 2, "y": math.pi, "-x": -math.pi / 2}


_BOX = [(sx, sy, sz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
_BOX_FACES = {
    "+x": ((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)),
    "-x": ((-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)),
    "+y": ((-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)),
    "-y": ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)),
    "+z": ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)),
    "-z": ((-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1)),
}


def cuboid(part, mat, m, size, skip=(), mats=None, jitter=0.0, rng=None):
    """
    A box of `size` centred on matrix m's origin, along its axes. `skip` leaves faces out ("+x",
    "-z"...), `mats` gives some faces another material, `jitter` moves corners a little.
    """
    m = Matrix(m) if not isinstance(m, Matrix) else m
    if len(m) == 3:
        m = m.to_4x4()
    h = [s / 2 for s in size]
    vs = {}
    for c in _BOX:
        p = Vector((c[0] * h[0], c[1] * h[1], c[2] * h[2]))
        if jitter and rng:
            p += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jitter
        vs[c] = part.bm.verts.new(m @ p)
    for name, corners in _BOX_FACES.items():
        if name in skip:
            continue
        part.face([vs[c] for c in corners], (mats or {}).get(name, mat))


def prism(part, mat, corners, skip=()):
    """
    A six-sided solid through 8 corners, given as {(sx, sy, sz): point} with each s ±1, laid out
    as a box's would be: a board with a sloped top, a wedge.
    """
    vs = {c: part.bm.verts.new(Vector(p)) for c, p in corners.items()}
    for name, cs in _BOX_FACES.items():
        if name not in skip:
            part.face([vs[c] for c in cs], mat)


def sloped_board(part, mat, x0, x1, y0, y1, z0, top, skip=()):
    """A box from (x0, y0, z0) to (x1, y1, top(x, y)): its top follows `top`, such as a roof's slope."""
    corners = {}
    for sx, x in ((-1, x0), (1, x1)):
        for sy, y in ((-1, y0), (1, y1)):
            corners[(sx, sy, -1)] = (x, y, z0)
            corners[(sx, sy, 1)] = (x, y, top(x, y))
    prism(part, mat, corners, skip)


def gable_logs(part, mat, x, z_start, ridge_z, slope, pitch, rt, rv, rng, inner=None, gaps=()):
    """
    Logs along y filling a gable at x from z_start (the first log's centre) up under a roof whose
    underside is ridge_z at y 0 and falls `slope` per meter, their ends cut to it. `gaps`
    (y0, y1, z_lo, z_hi) leaves openings.
    """
    zc = z_start
    while (ridge_z - (zc + rv)) / slope > 0.3:
        reach = (ridge_z - (zc - rv)) / slope + 0.1

        def f0(zz, r=reach):
            return r - max(0.05, (ridge_z - zz) / slope)

        def f1(zz, r=reach):
            return r + max(0.05, (ridge_z - zz) / slope)

        cuts = sorted((a, b) for a, b, lo, hi in gaps if lo < zc < hi)
        pieces, u = [], -reach
        for a, b in cuts:
            pieces.append((u, a))
            u = b
        pieces.append((u, reach))
        for i, (a, b) in enumerate(pieces):
            first, last = i == 0, i == len(pieces) - 1
            c0 = (lambda zz, a=a: f0(zz) - (a + reach)) if first else None
            c1 = (lambda zz, a=a: f1(zz) - (a + reach)) if last else None
            log(part, mat, (x, a, zc), (x, b, zc), rt * rng.uniform(0.95, 1.05),
                rv * rng.uniform(0.95, 1.05), rng, chamfer=(0.0, 0.0), cut=(c0, c1), inner=inner)
        zc += pitch


def frame_between(p0, p1, up=UP):
    """A matrix whose x runs from p0 to p1, origin halfway, z as near `up` as it can be; and the length."""
    p0, p1 = Vector(p0), Vector(p1)
    a = p1 - p0
    length = a.length
    x = a / length
    up = Vector(up)
    z = up - x * x.dot(up)
    if z.length < 1e-6:
        z = Vector((0, 1, 0)) - x * x.y
    z.normalize()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = (p0 + p1) / 2
    return m, length


def beam(part, mat, p0, p1, width, thick, up=UP, skip=(), mats=None, extra=0.0):
    """A board or beam from p0 to p1 (plus `extra` at each end), `width` across, `thick` along up."""
    m, length = frame_between(p0, p1, up)
    cuboid(part, mat, m, (length + 2 * extra, width, thick), skip, mats)


def _superellipse(theta, a, b, e):
    c, s = math.cos(theta), math.sin(theta)
    return (a * math.copysign(abs(c) ** (2 / e), c), b * math.copysign(abs(s) ** (2 / e), s))


def log(part, mat, p0, p1, rt, rv, rng, sides=10, step=1.25, shape=3.1, taper=0.07, bow=0.025,
        sag=0.0, lumpy=0.014, chamfer=(0.018, 0.018), cut=(None, None), inner=None,
        flat=None):
    """
    A hewn log from p0 to p1 (level or nearly), `rt` half as thick across and `rv` half as high: a
    superellipse section (`shape` 2 is round, higher is squarer), tapering from root to top,
    bowed sideways, sagging `sag` in the middle and lumpy. `chamfer` rounds off each end;
    `cut` = (f0, f1): a function of height z giving where that end is, as distance along the log
    from p0, for ends cut to a slope. `inner` = (test(centre, normal), material) gives the faces it
    picks another material (the inside of a house). `flat` = depth flattens the bottom.
    """
    p0, p1 = Vector(p0), Vector(p1)
    axis = p1 - p0
    length = axis.length
    x = axis / length
    z = (UP - x * x.dot(UP)).normalized()
    y = z.cross(x)
    seed = Vector((rng.uniform(-90, 90), rng.uniform(-90, 90), rng.uniform(-90, 90)))
    root = rng.choice((-1, 1))
    bend = rng.choice((-1, 1)) * bow
    stations = []  # (u, scale, end index or None)
    c0, c1 = chamfer
    # Rings in between stay clear of sloped ends.
    zs = (p0.z - rv, p0.z, p0.z + rv)
    u_lo = max(cut[0](zz) for zz in zs) if cut[0] else (c0 if c0 > 0 else 0.0)
    u_hi = min(cut[1](zz) for zz in zs) if cut[1] else (length - c1 if c1 > 0 else length)
    count = max(1, math.ceil((u_hi - u_lo) / step))
    if cut[0] is None and c0 > 0:
        stations += [(0.0, 1 - c0 / min(rt, rv), 0), (c0, 1.0, None)]
    else:
        stations += [(0.0, 1.0, 0)]
    for i in range(1, count):
        stations.append((u_lo + (u_hi - u_lo) * i / count, 1.0, None))
    if cut[1] is None and c1 > 0:
        stations += [(length - c1, 1.0, None), (length, 1 - c1 / min(rt, rv), 1)]
    else:
        stations += [(length, 1.0, 1)]

    rings = []
    for u, scale, end in stations:
        t = u / length
        k = (1 + taper * (0.5 - t) * root) * scale
        off_y = bend * math.sin(math.pi * t)
        off_z = -sag * math.sin(math.pi * t)
        ring = []
        for j in range(sides):
            th = 2 * math.pi * j / sides
            a, b = _superellipse(th, rt * k, rv * k, shape)
            if flat is not None and b < -rv + flat:
                b = -rv + flat
            uu = u
            if end is not None and cut[end] is not None:
                uu = cut[end](p0.z + b + off_z)
            p = p0 + x * uu + y * (a + off_y) + z * (b + off_z)
            if lumpy:
                nrm = (y * math.cos(th) + z * math.sin(th))
                p += nrm * lumpy * mnoise.noise(p * 2.1 + seed)
            ring.append(p)
        rings.append(part.verts(ring))

    def put(verts):
        f = part.bm.faces.new(verts)
        m = mat
        if inner is not None:
            f.normal_update()
            if inner[0](f.calc_center_median(), f.normal):
                m = inner[1]
        f.material_index = part.slot(m)

    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            put((a[j], a[(j + 1) % sides], b[(j + 1) % sides], b[j]))
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        centre = part.bm.verts.new(sum((v.co for v in ring), Vector()) / sides)
        for j in range(sides):
            tri = (centre, ring[j], ring[(j + 1) % sides])
            put(tri[::-1] if flip else tri)


# --- Log walls ----------------------------------------------------------------------------------


def wall_frame(wall, hx, hy, u=0.0):
    """
    The matrix of a point on a wall, in a frame whose -y is out through the wall, x along it (to
    the right seen from outside) and z up, its origin on the wall's centre line at `u` (world x for
    ±y walls, world y for ±x walls).
    """
    at = {"-y": (u, -hy, 0), "y": (u, hy, 0), "x": (hx, u, 0), "-x": (-hx, u, 0)}[wall]
    return turn(FACINGS[wall], at)


def wall_u(wall, u):
    """A world u along a wall as the wall frame's x (the frame turns round on y and -x walls)."""
    return -u if wall in ("y", "-x") else u


def log_walls(part, mats, hx, hy, z0, courses, pitch, rt, rv, head, rng, openings=(),
              partitions=(), gable=None, plate=0.0, sides=10, step=1.5, heads=None):
    """
    Notched-log walls round the rectangle ±hx × ±hy (the logs' centre lines), the bottom of the
    first course on z0. Courses alternate: the long walls (±y, along x) at z0 + pitch * (k + 0.5),
    the gables (±x, along y) half a course higher, every log standing out `head` past the corner.

    - mats: {"-y", "y", "x" (both gables), "inner"}: the inner faces get "inner".
    - openings: (wall, u0, u1, z_lo, z_hi), u along the wall in world x or y: logs centred
      between z_lo and z_hi are cut away from u0 to u1.
    - partitions: x positions of walls across the house, whose log heads stand out of both long
      walls.
    - gable: (ridge_z, slope): logs go on up the gables, ends cut to the underside of the roof.
    - plate: the long walls' top logs stand out this much further, to carry the roof.
    Returns the z of the top of the long walls.
    """
    def inside(c, n):
        if abs(c.x) < hx - 0.03 and abs(c.y) < hy - 0.03:
            return True
        return False

    def inner_long(c, n):
        return abs(c.x) < hx - rt and n.y * math.copysign(1, c.y) < -0.35

    def inner_gable(c, n):
        return abs(c.y) < hy - rt and n.x * math.copysign(1, c.x) < -0.35

    def gaps(wall, zc):
        return sorted((a, b) for w, a, b, lo, hi in openings if w == wall and lo < zc < hi)

    def run(wall, mat, inner, start, end, along, fixed, zc, rv_k=1.0, cut=(None, None),
            flat=None):
        """One course of one wall, broken round openings."""
        pieces, u = [], start
        for a, b in gaps(wall, zc):
            if a > u:
                pieces.append((u, a, u == start, False))
            u = max(u, b)
        if u < end:
            pieces.append((u, end, u == start, True))
        for a, b, first, last in pieces:
            if b - a < 0.08:
                continue

            def pt(v):
                return (v, fixed, zc) if along == "x" else (fixed, v, zc)

            ch = (0.018 if first else 0.0, 0.018 if last else 0.0)
            c = (cut[0] if first else None, cut[1] if last else None)
            if c[0] is not None or c[1] is not None:
                c = (
                    (lambda zz, f=c[0], a=a, s=start: f(zz) - (a - s)) if c[0] else None,
                    (lambda zz, f=c[1], a=a, s=start: f(zz) - (a - s)) if c[1] else None,
                )
            log(part, mat, pt(a), pt(b), rt * rng.uniform(0.9, 1.08),
                rv * rv_k * rng.uniform(0.88, 1.08), rng, sides=sides, step=step,
                chamfer=ch, cut=c, inner=inner, flat=flat)

    heads = heads or {}
    for k in range(courses):
        zc = z0 + pitch * (k + 0.5)
        for s, wall in ((-1, "-y"), (1, "y")):
            extra = plate if k == courses - 1 else 0.0
            e0 = head + extra + rng.uniform(-0.04, 0.04)
            e1 = head + extra + rng.uniform(-0.04, 0.04)
            run(wall, mats[wall], (inner_long, mats["inner"]), -hx - e0, hx + e1, "x", s * hy, zc)
    # Gables, half a course up, starting on a flattened half log.
    gable_courses = [(z0 + pitch * 0.28, 0.6, rv * 0.55)] + [
        (z0 + pitch * (k + 1), 1.0, None) for k in range(courses - 1)
    ]
    top_long = z0 + pitch * (courses - 0.5) + rv * 0.85
    if gable:
        ridge_z, slope = gable
        k = courses
        while True:
            zc = z0 + pitch * k
            if (ridge_z - (zc + rv)) / slope < 0.35:
                break
            gable_courses.append((zc, 1.0, "cut"))
            k += 1
    for zc, rk, flat in gable_courses:
        for s, wall in ((-1, "-x"), (1, "x")):
            if flat == "cut":
                ridge_z, slope = gable
                reach = (ridge_z - (zc - rv)) / slope + 0.1
                f0 = (lambda zz, r=reach, rz=ridge_z, sl=slope: r - max(0.05, (rz - zz) / sl))
                f1 = (lambda zz, r=reach, rz=ridge_z, sl=slope: r + max(0.05, (rz - zz) / sl))
                run(wall, mats["x"], (inner_gable, mats["inner"]), -reach, reach, "y", s * hx, zc,
                    cut=(f0, f1))
            else:
                e0 = head + rng.uniform(-0.04, 0.04)
                e1 = head + rng.uniform(-0.04, 0.04)
                run(wall, mats["x"], (inner_gable, mats["inner"]), -hy - e0, hy + e1, "y",
                    s * hx, zc, rv_k=rk, flat=flat)
        for px in partitions:
            if zc > top_long:
                continue
            for s in (-1, 1):
                a, b = s * (hy - rt * 0.3), s * (hy + head + rng.uniform(-0.04, 0.03))
                lo, hi = min(a, b), max(a, b)
                log(part, mats["x"], (px, lo, zc), (px, hi, zc), rt, rv * rk, rng, sides=sides,
                    chamfer=(0.0, 0.018) if s > 0 else (0.018, 0.0),
                    flat=flat if isinstance(flat, float) else None)
    return top_long


# --- Stone --------------------------------------------------------------------------------------


def stone(part, mat, centre, size, rng, cuts=1, round_=0.45, rough=0.16, yaw=None, ground=None,
          flat_top=0.0):
    """
    A fieldstone `size` (x, y, z) across, turned `yaw` round z: the hull of a rounded block from
    village_stone.fieldstone(), some ice-rounded and some broken flat, so no two alike. `ground`
    cuts it off flat below that z; `flat_top` flattens the top. `cuts` sets the detail (0 small
    chinking stones, 2 big ones), `round_` how rounded, `rough` how lumpy.
    """
    import village_stone as vs
    yaw = rng.uniform(-0.25, 0.25) if yaw is None else yaw
    rot = (Matrix.Translation(Vector(centre)) @ Matrix.Rotation(yaw, 4, "Z")
           @ Matrix.Rotation(rng.uniform(-0.06, 0.06), 4, "X"))
    # Half the stones keep their rounding, half are broken and angular.
    r = min(1.0, round_ + rng.uniform(-0.1, 0.25)) if rng.random() < 0.5 else rng.uniform(0.05, 0.35)
    # A hull rounds off the box's corners: size it up so packed stones still meet.
    size = (size[0] * 1.12, size[1] * 1.08, size[2] * 1.1)
    verts, tris = vs.fieldstone(size, rng.randrange(1 << 30), points={0: 14, 1: 24}.get(cuts, 38),
                                round_=r, breaks=rng.randint(1, 3), bed=0.2, top=flat_top,
                                lump=rough * 0.4)
    slot = part.slot(mat)

    def make(bm, local, world):
        if ground is not None and world.z < ground:
            world = Vector((world.x, world.y, ground))
        return bm.verts.new(world)

    for f in vs.to_bmesh(part.bm, verts, tris, rot, make):
        f.material_index = slot


def fieldstones(part, mat, core_mat, hx, hy, height, width, rng, ground=0.0, skip=()):
    """
    A dry-stone foundation round the rectangle ±hx × ±hy (its centre line), `height` high and
    `width` thick: big stones along each side, small ones wedged between, a dark core behind.
    `skip` = [(side, u0, u1)] leaves gaps.
    """
    for side, length, fixed in (("-y", hx * 2 + width, -hy), ("y", hx * 2 + width, hy),
                                ("-x", hy * 2 - width, -hx), ("x", hy * 2 - width, hx)):
        u = -length / 2
        while u < length / 2 - 0.1:
            w = rng.uniform(0.35, 0.75)
            w = min(w, length / 2 - u + 0.05)
            uc = u + w / 2
            if not any(s == side and a < uc < b for s, a, b in skip):
                hgt = height * rng.uniform(0.55, 1.15)
                out = math.copysign(rng.uniform(-0.03, 0.05), fixed)
                big = (w, width * rng.uniform(0.75, 1.05), hgt * 1.15)
                if side in ("-x", "x"):
                    big = (big[1], big[0], big[2])
                at = (uc, fixed + out, hgt / 2 + ground) if side in ("-y", "y") else (fixed + out, uc, hgt / 2 + ground)
                stone(part, mat, at, big, rng, cuts=1, ground=ground,
                      flat_top=0.2, round_=0.5, rough=0.24)
                if hgt < height * 0.72:
                    # A flatter stone laid on a low one to bring it up.
                    th = height - hgt + 0.06
                    top_size = (w * rng.uniform(0.7, 0.95), width * 0.8, th)
                    if side in ("-x", "x"):
                        top_size = (top_size[1], top_size[0], th)
                    at2 = list(at)
                    at2[2] = ground + hgt + th / 2 - 0.03
                    stone(part, mat, at2, top_size, rng, cuts=1, flat_top=0.3, round_=0.5, rough=0.18)
                # A small stone wedged in the joint, low or high.
                if rng.random() < 0.35:
                    sw = rng.uniform(0.1, 0.2)
                    zz = ground + rng.choice((rng.uniform(0.05, 0.15), hgt * rng.uniform(0.7, 0.9)))
                    out = fixed + math.copysign(width * 0.38, fixed)
                    at2 = (u + w, out, zz) if side in ("-y", "y") else (out, u + w, zz)
                    stone(part, mat, at2, (sw, sw * 0.9, sw * 0.7), rng, cuts=0, round_=0.6,
                          ground=ground)
            u += w * rng.uniform(0.88, 0.97)
    # The dark core so gaps between the stones read as deep.
    for side in ("-y", "y", "-x", "x"):
        if side in ("-y", "y"):
            size = (hx * 2 + width * 0.6, width * 0.5, height * 0.95)
            at = (0, hy if side == "y" else -hy, ground + height * 0.47)
        else:
            size = (width * 0.5, hy * 2, height * 0.95)
            at = (hx if side == "x" else -hx, 0, ground + height * 0.47)
        cuboid(part, core_mat, Matrix.Translation(at), size, skip=("-z",))


def slab_stack(part, mat, core_mat, x, y, z0, z1, w, d, rng, cap=True):
    """
    A stack of flat slabs from z0 to z1, about w × d: a slab chimney or a pillar. With `cap`, a
    bigger capstone on four small stones leaves a smoke gap at the top.
    """
    z = z0
    top = z1 - (0.22 if cap else 0.0)
    while z < top - 0.03:
        t = min(rng.uniform(0.07, 0.14), top - z)
        for k in range(2):
            # Two slabs per course, overlapping, offset this way or that.
            sw = w * rng.uniform(0.55, 0.75)
            sx = x + (k - 0.5) * (w - sw) * rng.uniform(0.9, 1.1)
            sy = y + rng.uniform(-0.03, 0.03)
            m = Matrix.Translation((sx, sy, z + t / 2)) @ Matrix.Rotation(
                rng.uniform(-0.05, 0.05), 4, "Z")
            cuboid(part, mat, m, (sw, d * rng.uniform(0.95, 1.08), t * 0.96), jitter=0.012, rng=rng)
        z += t
    cuboid(part, core_mat, Matrix.Translation((x, y, (z0 + top) / 2)), (w * 0.8, d * 0.8, top - z0))
    if cap:
        for sx in (-1, 1):
            for sy in (-1, 1):
                stone(part, mat, (x + sx * w * 0.36, y + sy * d * 0.36, top + 0.06),
                      (0.12, 0.12, 0.13), rng, cuts=0, round_=0.4)
        m = Matrix.Translation((x, y, top + 0.15)) @ Matrix.Rotation(rng.uniform(-0.1, 0.1), 4, "Z")
        cuboid(part, mat, m, (w * 1.3, d * 1.3, 0.07), jitter=0.015, rng=rng)


# --- Turf roof ----------------------------------------------------------------------------------


class Roof:
    """The heights of a gable roof's deck, ridge along x, sagging in the middle."""

    def __init__(self, x0, x1, eave, slope, ridge, sag):
        self.x0, self.x1, self.eave, self.slope, self.ridge, self.sag = x0, x1, eave, slope, ridge, sag

    def sagged(self, x, y):
        t = (x - self.x0) / (self.x1 - self.x0)
        return self.sag * math.sin(math.pi * min(max(t, 0), 1)) * (1 - 0.45 * min(abs(y) / self.eave, 1))

    def deck(self, x, y):
        """The top of the roof boards at (x, y)."""
        return self.ridge - abs(y) * self.slope - self.sagged(x, y)


def turf_roof(mats, rng, x0, x1, eave, slope, ridge, sag=0.08, turf=0.2, deck=0.035,
              inside=None, purlins=(), grass=1.0, cross=0.35, verge_w=0.3, eave_gaps=(),
              hooks=0.75, turf_log=0.075, sides=(-1, 1), board_w=0.2):
    """
    A turf roof, ridge along x from x0 to x1 (the verges), eaves at ±eave, the boards' top at
    `ridge` on the ridge and falling `slope` per meter. Purlins (y, radius) carry the boards, which
    run down the slope; birch bark curls out under the turf log at the eaves, held by hooks; the
    turf lies `turf` deep and lumpy, thicker on the ridge; vergeboards cross over the ridge at both
    gables; dead grass hangs over the eaves and stands on the ridge and in tufts.

    mats: {"boards", "purlin", "turf", "bark", "inner", "grass": [plain mats]}. `inside`
    (hx, hy): board faces inside the walls get mats["inner"]. `eave_gaps`: (side, xa, xb) where the
    eave's turf log and fringe are left out. `sides`: (-1, 1), or one side for a lean-to.
    Returns the Roof.
    """
    roof = Roof(x0, x1, eave, slope, ridge, sag)
    part = Part("roof")
    grass_part = Part("grass")
    bm_mat, pu_mat, tf_mat, bk_mat = mats["boards"], mats["purlin"], mats["turf"], mats["bark"]
    inner = mats.get("inner", bm_mat)
    lean = len(sides) == 1

    # Purlins, sagging with the roof.
    for py, r in purlins:
        zc = roof.deck(x0, py) - deck - r * 0.8
        log(part, pu_mat, (x0 + 0.03, py, zc), (x1 - 0.03, py, zc), r, r, rng, sides=10,
            step=1.0, sag=roof.sagged((x0 + x1) / 2, py), chamfer=(0.015, 0.015))

    # Roof boards down the slope, the part over the house in the inner material.
    count = max(1, round((x1 - x0) / board_w))
    bw = (x1 - x0) / count
    for i in range(count):
        xc = x0 + bw * (i + 0.5) + rng.uniform(-0.005, 0.005)
        w = bw - rng.uniform(0.004, 0.012)
        for s in sides:
            ys = [0.0 if not lean else 0.0, eave]
            if inside and abs(xc) < inside[0]:
                ys = [0.0, inside[1], eave]
            for a, b in zip(ys, ys[1:]):
                mat = inner if (inside and abs(xc) < inside[0] and b <= inside[1] + 1e-6) else bm_mat
                pa = Vector((xc, s * a, roof.deck(xc, a) - deck / 2))
                pb = Vector((xc, s * b, roof.deck(xc, b) - deck / 2))
                beam(part, mat, pa, pb, w, deck, skip=("+z",))

    # Bark curling out at the eaves.
    step = 0.3
    for s in sides:
        xs = [x0 + (x1 - x0) * i / round((x1 - x0) / step) for i in range(round((x1 - x0) / step) + 1)]
        rows = []
        for x in xs:
            d0 = roof.deck(x, eave)
            o1 = rng.uniform(0.03, 0.06)
            o2 = o1 + rng.uniform(0.02, 0.05)
            rows.append((
                Vector((x, s * (eave - 0.14), roof.deck(x, eave - 0.14) + 0.004)),
                Vector((x, s * (eave + o1), d0 - 0.005)),
                Vector((x, s * (eave + o2), d0 - rng.uniform(0.03, 0.07))),
            ))
        for a, b in zip(rows, rows[1:]):
            for r in range(2):
                part.face([a[r], b[r], b[r + 1], a[r + 1]], bk_mat, facing=(0, s, 1))

    def gap(s, x):
        return any(gs == s and xa < x < xb for gs, xa, xb in eave_gaps)

    # The turf log on its hooks.
    for s in sides:
        yl = eave - turf_log - 0.02
        pieces, cur = [], x0 + 0.02
        for gs, xa, xb in sorted(g for g in eave_gaps if g[0] == s):
            pieces.append((cur, xa))
            cur = xb
        pieces.append((cur, x1 - 0.02))
        for a, b in pieces:
            if b - a < 0.2:
                continue
            zc = roof.deck(a, yl) + turf_log + 0.004
            mid = roof.sagged((a + b) / 2, yl) - roof.sagged(a, yl) * 0
            log(part, pu_mat, (a, s * yl, zc), (b, s * yl, zc), turf_log, turf_log, rng, sides=8,
                step=0.8, sag=mid * (b - a) / (x1 - x0), chamfer=(0.012, 0.012))
        n_hooks = max(2, round((x1 - x0) / hooks))
        for i in range(n_hooks):
            x = x0 + (x1 - x0) * (i + 0.5) / n_hooks + rng.uniform(-0.05, 0.05)
            if gap(s, x):
                continue
            d = roof.deck(x, eave - 0.01)
            m = Matrix.Translation((x, s * (eave - 0.012), d + 0.085)) @ Matrix.Rotation(
                s * -0.15 + rng.uniform(-0.05, 0.05), 4, "X")
            cuboid(part, bm_mat, m, (0.055, 0.03, 0.19))
            beam(part, bm_mat, (x, s * (eave - 0.03), d + 0.012),
                 (x, s * (eave - 0.32), roof.deck(x, eave - 0.32) + 0.012), 0.05, 0.022)

    # Turf: one lumpy grid over both slopes, with edges down to the boards.
    ye = eave - 2 * turf_log - 0.03
    seed = Vector((rng.uniform(-90, 90), rng.uniform(-90, 90), 0))
    xa, xb = x0 + 0.06, x1 - 0.06
    nx = max(2, math.ceil((xb - xa) / 0.3))
    y_lo = -ye if not lean else 0.0
    if lean:
        y_lo, y_hi = 0.0, ye
    else:
        y_lo, y_hi = -ye, ye
    ny = max(2, math.ceil((y_hi - y_lo) / 0.24))

    def lump(x, y):
        p = Vector((x, y, 0)) + seed
        h = (0.075 * mnoise.noise(p * 0.55) + 0.045 * mnoise.noise(p * 1.5)
             + 0.02 * mnoise.noise(p * 4.0) + 0.008 * mnoise.noise(p * 9.0))
        return h * turf / 0.2

    def top(x, y):
        t = turf
        if not lean:
            t += 0.06 * math.exp(-(y / 0.35) ** 2)
        edge = min(ye - abs(y), x - xa, xb - x)
        t *= 0.75 + 0.25 * min(1.0, max(edge, 0) / 0.25)
        return roof.deck(x, y) + t + lump(x, y) * min(1.0, 0.4 + max(edge, 0) / 0.3)

    grid = []
    for i in range(nx + 1):
        x = xa + (xb - xa) * i / nx
        col = []
        for j in range(ny + 1):
            y = y_lo + (y_hi - y_lo) * j / ny
            jx = rng.uniform(-0.03, 0.03) if 0 < i < nx else 0
            col.append(part.bm.verts.new((x + jx, y, top(x, y))))
        grid.append(col)
    for i in range(nx):
        for j in range(ny):
            part.face([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]], tf_mat)
    # Edges: at the eaves, and at the verges.
    for j_edge, s in ((0, -1), (ny, 1)):
        if lean and s < 0:
            continue
        for i in range(nx):
            a, b = grid[i][j_edge], grid[i + 1][j_edge]
            y = s * ye
            a2 = Vector((a.co.x, y + s * 0.02, roof.deck(a.co.x, ye)))
            b2 = Vector((b.co.x, y + s * 0.02, roof.deck(b.co.x, ye)))
            part.face([a, b, part.bm.verts.new(b2), part.bm.verts.new(a2)], tf_mat, facing=(0, s, 0))
    if lean:
        for i in range(nx):
            a, b = grid[i][0], grid[i + 1][0]
            a2 = Vector((a.co.x, a.co.y, roof.deck(a.co.x, 0.0)))
            b2 = Vector((b.co.x, b.co.y, roof.deck(b.co.x, 0.0)))
            part.face([a, b, part.bm.verts.new(b2), part.bm.verts.new(a2)], tf_mat, facing=(0, -1, 0))
    for i_edge, s in ((0, -1), (nx, 1)):
        for j in range(ny):
            a, b = grid[i_edge][j], grid[i_edge][j + 1]
            a2 = Vector((a.co.x, a.co.y, roof.deck(a.co.x, a.co.y)))
            b2 = Vector((b.co.x, b.co.y, roof.deck(b.co.x, b.co.y)))
            part.face([a, b, part.bm.verts.new(b2), part.bm.verts.new(a2)], tf_mat, facing=(s, 0, 0))

    # Vergeboards, crossing above the ridge.
    for xe, sx in ((x0, -1), (x1, 1)):
        for k, s in enumerate(sides):
            xv = xe + sx * (0.02 + 0.042 * k)
            centre = 0.1 + turf - 0.2
            far = -s * cross if not lean else -s * 0.05
            pa = Vector((xv, s * (eave + 0.05), ridge - (eave + 0.05) * slope + centre))
            pb = Vector((xv, far, ridge + (cross if not lean else 0.05) * slope + centre))
            beam(part, bm_mat, pa, pb, 0.04, verge_w, up=(0, 0, 1))

    # Dead grass.
    gm = mats["grass"]

    def blade(root, direction, length, width, droop, mat):
        """A thin blade bending over under its own weight: 3 triangles."""
        d = Vector(direction).normalized()
        side = d.cross(UP)
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        a = rng.uniform(-0.9, 0.9)
        side = (side * math.cos(a) + d.cross(side) * math.sin(a)).normalized()
        mid = root + d * length * 0.5 + Vector((0, 0, -droop * 0.18 * length))
        tip = root + d * length + Vector((0, 0, -droop * length))
        vs = grass_part.verts([root - side * width / 2, root + side * width / 2,
                               mid + side * width * 0.3, mid - side * width * 0.3, tip])
        for f in ((vs[0], vs[1], vs[2]), (vs[0], vs[2], vs[3]), (vs[3], vs[2], vs[4])):
            grass_part.face(list(f), mat)

    def clump(root, lean_dir, count, length, droop, spread=0.45):
        """A clump of blades from one root, fanning out round `lean_dir`, one colour mostly."""
        mat = rng.choice(gm)
        ld = Vector(lean_dir).normalized()
        for _ in range(count):
            d = ld + Vector((rng.uniform(-spread, spread), rng.uniform(-spread, spread),
                             rng.uniform(-spread * 0.5, spread * 0.5)))
            r = root + Vector((rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), 0))
            blade(r, d, length * rng.uniform(0.55, 1.1), rng.uniform(0.008, 0.016),
                  droop * rng.uniform(0.6, 1.3), mat if rng.random() < 0.8 else rng.choice(gm))

    if grass > 0:
        for s in sides:
            # Over the eaves: long dead grass hanging down over the turf log.
            for _ in range(int((xb - xa) * 6 * grass)):
                x = xa + (xb - xa) * rng.random()
                if gap(s, x):
                    continue
                y = s * (ye - rng.uniform(0.0, 0.1))
                root = Vector((x, y, top(x, y) - 0.02))
                clump(root, (rng.uniform(-0.2, 0.2), s * 1.0, rng.uniform(-0.1, 0.6)), rng.randint(5, 9),
                      rng.uniform(0.22, 0.45), rng.uniform(0.35, 0.8))
        if not lean:
            for _ in range(int((xb - xa) * 5 * grass)):
                x = xa + (xb - xa) * rng.random()
                y = rng.gauss(0, 0.15)
                root = Vector((x, y, top(x, y) - 0.015))
                clump(root, (rng.uniform(-0.2, 0.2), rng.uniform(-0.3, 0.3), 1), rng.randint(6, 10),
                      rng.uniform(0.2, 0.45), rng.uniform(0.05, 0.3))
        # Clumps over the slopes, more of them low where water keeps the turf alive.
        area = (xb - xa) * (y_hi - y_lo)
        for _ in range(int(area * 0.55 * grass)):
            x = rng.uniform(xa + 0.1, xb - 0.1)
            y = rng.uniform(y_lo + 0.1, y_hi - 0.1)
            base = Vector((x, y, top(x, y) - 0.02))
            clump(base, (0, 0, 1), rng.randint(5, 9), rng.uniform(0.15, 0.4), rng.uniform(0.05, 0.35), 0.6)
        # Along the verges, leaning out over the vergeboards.
        for xe, sx in ((xa, -1), (xb, 1)):
            for _ in range(int((y_hi - y_lo) * 4 * grass)):
                y = rng.uniform(y_lo, y_hi)
                root = Vector((xe, y, top(xe, y) - 0.02))
                clump(root, (sx * 0.8, 0, 0.6), rng.randint(5, 8), rng.uniform(0.15, 0.35), rng.uniform(0.2, 0.5))

    part.finish()
    grass_part.finish()
    return roof


def slate_roof(mats, rng, x0, x1, eave, slope, ridge, deck=0.03, inside=None, purlins=(),
               cross=0.35, verge_w=0.26, missing=0.025, board_w=0.2, rows_pitch=0.22):
    """
    A slate roof, ridge along x from x0 to x1 (the verges), eaves at ±eave, the boards' top at
    `ridge` on the ridge, falling `slope` per meter: purlins, boards, then rows of rough slates
    laid in courses `rows_pitch` apart, each a different width, a few slipped or gone; ridge
    boards over the top and crossed vergeboards at both gables.
    mats: {"boards", "purlin", "slate", "inner"}. Returns the Roof.
    """
    roof = Roof(x0, x1, eave, slope, ridge, 0.0)
    part = Part("roof")
    bm_mat, sl = mats["boards"], mats["slate"]
    inner = mats.get("inner", bm_mat)
    cos = 1 / math.sqrt(1 + slope * slope)
    for py, r in purlins:
        zc = roof.deck(x0, py) - deck - r * 0.8
        log(part, mats["purlin"], (x0 + 0.03, py, zc), (x1 - 0.03, py, zc), r, r, rng, sides=10,
            chamfer=(0.015, 0.015))
    count = max(1, round((x1 - x0) / board_w))
    bw = (x1 - x0) / count
    for i in range(count):
        xc = x0 + bw * (i + 0.5)
        for s in (-1, 1):
            ys = [0.0, eave]
            if inside and abs(xc) < inside[0]:
                ys = [0.0, inside[1], eave]
            for a, b in zip(ys, ys[1:]):
                mat = inner if (inside and abs(xc) < inside[0] and b <= inside[1] + 1e-6) else bm_mat
                beam(part, mat, (xc, s * a, roof.deck(xc, a) - deck / 2),
                     (xc, s * b, roof.deck(xc, b) - deck / 2), bw - 0.008, deck, skip=("+z",))
    # Slates, from the eaves up; each course lies on the one below, so it tilts a little more.
    t = 0.014
    length = rows_pitch * 2.05
    for s in (-1, 1):
        k = 0
        while True:
            yb = eave + 0.04 - k * rows_pitch * cos  # bottom edge, horizontally
            if yb < 0.05:
                break
            yt = max(yb - length * cos, -0.02)
            x = x0 - 0.02 - rng.uniform(0, 0.2) * (k % 2)
            while x < x1 + 0.02:
                w = rng.uniform(0.24, 0.4)
                xe = min(x + w, x1 + 0.03)
                if rng.random() > missing and xe - x > 0.08:
                    slip = rng.uniform(0.12, 0.3) if rng.random() < 0.02 else 0.0
                    cx = (x + xe) / 2
                    lift = 2.2 * t
                    pb = Vector((cx, s * (yb + slip * cos), roof.deck(cx, yb + slip * cos) + lift))
                    pt = Vector((cx + rng.uniform(-0.015, 0.015), s * (yt + slip * cos), roof.deck(cx, yt) + t * 0.6))
                    nrm = Vector((0, s * slope, 1)).normalized()
                    beam(part, sl, pb, pt, (xe - x) - 0.008, t, up=nrm, skip=("-z",))
                x = xe
            k += 1
    # Ridge boards.
    for s in (-1, 1):
        top = ridge + 3.5 * t
        pa = Vector((x0 - 0.02, s * 0.09, top - 0.09 * slope + 0.02))
        pb = Vector((x1 + 0.02, s * 0.09, top - 0.09 * slope + 0.02))
        m, ln = frame_between(pa, pb, up=Vector((0, s * slope, 1)))
        cuboid(part, bm_mat, m, (ln, 0.2, 0.035))
    # Crossed vergeboards.
    for xe, sx in ((x0, -1), (x1, 1)):
        for k, s in enumerate((-1, 1)):
            xv = xe + sx * (0.02 + 0.042 * k)
            centre = -0.03
            pa = Vector((xv, s * (eave + 0.06), ridge - (eave + 0.06) * slope + centre))
            pb = Vector((xv, -s * cross, ridge + cross * slope + centre))
            beam(part, bm_mat, pa, pb, 0.04, verge_w)
    part.finish()
    return roof


def drystone_wall(part, mat, p0, p1, height, thick, rng, courses=3, core=None, faces=(-1, 1)):
    """A dry-stone wall from p0 to p1 on the ground, `height` high: courses of rough stones,
    biggest at the bottom, staggered, and a dark core. `faces`: which faces get stones, -1 the
    right seen walking from p0 to p1, 1 the left; a single face gets deeper stones."""
    p0, p1 = Vector((p0[0], p0[1], 0.0)), Vector((p1[0], p1[1], 0.0))
    d = p1 - p0
    length = d.length
    x = d / length
    yaw = math.atan2(x.y, x.x)
    side = Vector((-x.y, x.x, 0))
    z = 0.0
    for c in range(courses):
        ch = height / courses * (1.25 - 0.25 * c)
        if c == courses - 1:
            ch = height - z
        u = -rng.uniform(0, 0.25) if c % 2 else 0.0
        while u < length:
            w = rng.uniform(0.25, 0.75) * (1.2 - 0.15 * c)
            w = min(w, length - u + 0.06)
            if w < 0.12:
                break
            for face in faces:
                off = thick / 4 if len(faces) == 2 else thick / 8
                at = p0 + x * (u + w / 2) + side * face * (off + rng.uniform(-0.02, 0.02))
                at.z = z + ch / 2
                hh = ch * rng.uniform(0.8, 1.3)
                at.z = z + hh / 2 - rng.uniform(0, 0.04)
                stone(part, mat, at, (w, thick * (0.55 if len(faces) == 2 else 0.8), hh * 1.12), rng, cuts=1, yaw=yaw + rng.uniform(-0.15, 0.15),
                      ground=0.0, flat_top=0.2, round_=0.4, rough=0.24)
            u += w * rng.uniform(0.9, 1.0)
        z += ch * 0.97
    if core is not None:
        m = turn(yaw, (p0 + p1) / 2) @ Matrix.Translation((0, 0, height * 0.45))
        cuboid(part, core, m, (length, thick * 0.6, height * 0.9), skip=("-z",))


def holed_board(part, mat, m, w, h, thick, hole, edge_mat=None):
    """
    A board w × h × thick in frame m (x across, z up, -y its face, centred on m's origin), with a
    hole cut through it: `hole` = (x, z) points going round it, in meters from the centre.
    """
    t = thick / 2
    outer = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    # The hole's lowest point is joined to the bottom edge by a slit, making one face per side.
    lo = min(range(len(hole)), key=lambda i: hole[i][1])
    ring = hole[lo:] + hole[:lo]
    if _area(ring) > 0:
        ring = [ring[0]] + ring[1:][::-1]
    # Round the outside anticlockwise from the slit, up its left side, round the hole clockwise,
    # down its right side.
    xb, eps = ring[0][0], 1e-4
    face_pts = [(xb, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2),
                (xb - eps, -h / 2), (xb - eps, ring[0][1])] + ring[1:] + [ring[0]]
    for y, facing in ((-t, -1), (t, 1)):
        pts = [m @ Vector((x, y, z)) for x, z in face_pts]
        part.face(pts, mat, facing=m.to_3x3() @ Vector((0, facing, 0)))
    em = edge_mat or mat
    for loop_pts in (outer, hole):
        n = len(loop_pts)
        for i in range(n):
            (x0, z0), (x1, z1) = loop_pts[i], loop_pts[(i + 1) % n]
            q = [m @ Vector((x0, -t, z0)), m @ Vector((x1, -t, z1)), m @ Vector((x1, t, z1)), m @ Vector((x0, t, z0))]
            part.face(q, em)


def _area(pts):
    return sum(x0 * z1 - x1 * z0 for (x0, z0), (x1, z1) in zip(pts, pts[1:] + pts[:1])) / 2


def heart(width, at=(0.0, 0.0), points=20):
    """A heart outline, `width` across, centred on `at`, as (x, z) points."""
    pts = []
    for i in range(points):
        a = 2 * math.pi * i / points
        x = 16 * math.sin(a) ** 3
        z = 13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)
        pts.append((at[0] + x * width / 34, at[1] + z * width / 34))
    return pts


def split_piece(part, wood, bark, centre, length, radius, rng, kind=None, turn_=0.0, axis="y"):
    """
    A piece of split firewood along `axis`: a half, a quarter or a third of a round, bark on the
    round side, split faces and end grain wood, turned `turn_` round its axis.
    """
    kind = kind or rng.choice(("half", "half", "quarter", "quarter", "third"))
    span = {"half": math.pi, "quarter": math.pi / 2, "third": 2 * math.pi / 3}[kind]
    steps = {"half": 4, "quarter": 2, "third": 3}[kind]
    pts = [(0.0, 0.0)] if kind != "half" else []
    for i in range(steps + 1):
        a = -span / 2 + span * i / steps + turn_
        r = radius * rng.uniform(0.93, 1.05)
        pts.append((r * math.cos(a), r * math.sin(a)))
    # Centre the section on its middle, so pieces stack by their size.
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[1] for p in pts) / len(pts)
    pts = [(x - cx, z - cz) for x, z in pts]
    c = Vector(centre)
    tilt = Vector((rng.uniform(-0.01, 0.01), 0, rng.uniform(-0.01, 0.01)))

    def at(p, y):
        if axis == "y":
            return c + Vector((p[0], y, p[1])) + tilt * (y / length)
        return c + Vector((y, p[0], p[1])) + tilt * (y / length)

    l0 = -length / 2 + rng.uniform(-0.02, 0.02)
    l1 = length / 2 + rng.uniform(-0.02, 0.02)
    front = part.verts([at(p, l0) for p in pts])
    back = part.verts([at(p, l1) for p in pts])
    n = len(pts)
    out_dir = Vector((0, -1, 0)) if axis == "y" else Vector((-1, 0, 0))
    part.face(front, wood, facing=out_dir)
    part.face(back, wood, facing=-out_dir)
    first_arc = 1 if kind != "half" else 0
    for i in range(n):
        j = (i + 1) % n
        on_bark = first_arc <= i <= n - 2
        q =[front[i], front[j], back[j], back[i]]
        mid = (Vector(pts[i]) + Vector(pts[j])) / 2
        o = Vector((mid[0], 0, mid[1])) if axis == "y" else Vector((0, mid[0], mid[1]))
        part.face(q, bark if on_bark else wood, facing=o)


# --- Openings -----------------------------------------------------------------------------------


def window(m, mats, w, h, zb, depth, rng, cols=2, rows=3, broken=(), boarded=False, trim=0.1,
           sash=True):
    """
    A window in a wall, in the wall frame m (see wall_frame(); -y out, wall centre line at y 0,
    `depth` the wall's thickness): a lining through the wall, white trim round the outside with a
    head and a sill, a sash of cols × rows panes, glass or broken (pane indices in `broken`, or
    "all"), or boards nailed over. mats: {"trim", "glass", "dark", "boards", "iron"}.
    """
    part = Part("window")
    T = depth / 2
    tm, gl = mats["trim"], mats["glass"]
    # Lining.
    for sx in (-1, 1):
        cuboid(part, tm, m @ Matrix.Translation((sx * (w / 2 + 0.022), 0, zb + h / 2)), (0.045, depth, h + 0.09))
    for z in (zb - 0.022, zb + h + 0.022):
        cuboid(part, tm, m @ Matrix.Translation((0, 0, z)), (w, depth, 0.045))
    objs = []
    # Trim: casing, head with a drip cap, sill.
    fy = -T - 0.014
    for sx in (-1, 1):
        objs.append(lib.box("casing", (trim, 0.028, h + 0.12), (sx * (w / 2 + trim / 2), fy, zb + h / 2 + 0.02), tm, bevel=0.005, segments=1))
    objs.append(lib.box("head", (w + 2 * trim + 0.06, 0.032, 0.13), (0, fy - 0.002, zb + h + 0.13), tm, bevel=0.005, segments=1))
    objs.append(lib.box("cap", (w + 2 * trim + 0.12, 0.07, 0.03), (0, fy - 0.02, zb + h + 0.21), tm, bevel=0.006, segments=1))
    sill = lib.box("sill", (w + 2 * trim + 0.08, 0.1, 0.04), (0, fy - 0.03, zb - 0.03), tm, bevel=0.006, segments=1)
    sill.matrix_world = Matrix.Translation((0, fy - 0.03, zb - 0.03)) @ Matrix.Rotation(-0.12, 4, "X") @ Matrix.Translation((0, -(fy - 0.03), -(zb - 0.03)))
    objs.append(sill)
    sy = -T + 0.07
    if sash:
        st = 0.045
        for sx in (-1, 1):
            cuboid(part, tm, m @ Matrix.Translation((sx * (w / 2 - st / 2), sy, zb + h / 2)), (st, 0.04, h))
        for z in (zb + st / 2, zb + h - st / 2):
            cuboid(part, tm, m @ Matrix.Translation((0, sy, z)), (w - 2 * st, 0.04, st))
        iw, ih = w - 2 * st, h - 2 * st
        for c in range(1, cols):
            cuboid(part, tm, m @ Matrix.Translation((-iw / 2 + iw * c / cols, sy, zb + h / 2)), (0.022, 0.03, ih))
        for r in range(1, rows):
            cuboid(part, tm, m @ Matrix.Translation((0, sy, zb + st + ih * r / rows)), (iw, 0.03, 0.022))
        pw, ph = iw / cols, ih / rows
        gy = sy + 0.004
        for r in range(rows):
            for c in range(cols):
                x0 = -iw / 2 + pw * c
                z0 = zb + st + ph * r
                if broken == "all" or (r * cols + c) in broken:
                    # A shard or two left in the corners.
                    for _ in range(rng.randint(0, 2)):
                        cx = rng.choice((x0 + 0.01, x0 + pw - 0.01))
                        cz = rng.choice((z0 + 0.01, z0 + ph - 0.01))
                        dx = (pw * rng.uniform(0.3, 0.8)) * (1 if cx < x0 + pw / 2 else -1)
                        dz = (ph * rng.uniform(0.3, 0.8)) * (1 if cz < z0 + ph / 2 else -1)
                        tri = [m @ Vector((cx, gy, cz)), m @ Vector((cx + dx, gy, cz)), m @ Vector((cx, gy, cz + dz))]
                        part.face(tri, gl, facing=m.to_3x3() @ Vector((0, -1, 0)))
                    continue
                q = [m @ Vector(p) for p in ((x0, gy, z0), (x0 + pw, gy, z0), (x0 + pw, gy, z0 + ph), (x0, gy, z0 + ph))]
                part.face(q, gl, facing=m.to_3x3() @ Vector((0, -1, 0)))
    if boarded:
        for k in range(3):
            z = zb + h * (0.2 + 0.3 * k) + rng.uniform(-0.04, 0.04)
            b = lib.box("board", (w + 0.25, 0.022, 0.13), (0, fy - 0.04, 0), mats["boards"], bevel=0.003, segments=1)
            b.matrix_world = Matrix.Translation((0, 0, z)) @ Matrix.Rotation(rng.uniform(-0.12, 0.12), 4, "Y")
            objs.append(b)
    # Darkness behind.
    cuboid(part, mats["dark"], m @ Matrix.Translation((0, T + 0.3, zb + h / 2)), (w + 0.2, 0.02, h + 0.2))
    place(objs, m)
    part.finish()


def plank_door(m, mats, w, h, zb, y, rng, boards=5, ajar=0.0, brace="z", hinge_side=-1,
               lining=None, missing=()):
    """
    A door of vertical planks in the frame m (-y out), its face at local y, bottom at zb: ledges
    and a Z brace on the face (`brace` "z", "ledges" or None), strap hinges, a ring handle, open
    `ajar` radians round its hinge side. `lining` = depth puts a frame round the opening.
    mats: {"door", "iron", "lining"}.
    """
    part = Part("door")
    dm, im = mats["door"], mats["iron"]
    hx = hinge_side * w / 2
    leaf = Matrix.Translation((hx, y, 0)) @ Matrix.Rotation(-hinge_side * ajar, 4, "Z") @ Matrix.Translation((-hx, -y, 0))
    lm = m @ leaf
    bw = w / boards
    for i in range(boards):
        if i in missing:
            continue
        x = -w / 2 + bw * (i + 0.5)
        hh = h - rng.uniform(0, 0.02)
        cuboid(part, dm, lm @ Matrix.Translation((x + rng.uniform(-0.003, 0.003), y + 0.016, zb + hh / 2)), (bw - 0.006, 0.032, hh), jitter=0.002, rng=rng)
    if brace:
        lz = (zb + 0.25, zb + h - 0.25)
        for z in lz:
            cuboid(part, dm, lm @ Matrix.Translation((0, y - 0.016, z)), (w - 0.06, 0.032, 0.12))
        if brace == "z":
            a = Vector((hinge_side * -(w / 2 - 0.1), y - 0.016, lz[0] + 0.05))
            b = Vector((hinge_side * (w / 2 - 0.1), y - 0.016, lz[1] - 0.05))
            mm, length = frame_between(a, b, up=(0, -1, 0))
            cuboid(part, dm, lm @ mm, (length, 0.11, 0.03))
    yo = y - (0.034 if brace else 0.002)
    for z in (zb + 0.25, zb + h - 0.25):
        cuboid(part, im, lm @ Matrix.Translation((hx - hinge_side * 0.28, yo - 0.004, z)), (0.56, 0.006, 0.045))
        cuboid(part, im, lm @ Matrix.Translation((hx, yo + 0.01, z)), (0.04, 0.03, 0.08))
    # Ring handle.
    hxp = -hinge_side * (w / 2 - 0.12)
    cuboid(part, im, lm @ Matrix.Translation((hxp, yo - 0.004, zb + h * 0.5)), (0.06, 0.008, 0.09))
    tor = lib.tube("ring", [(hxp + 0.045 * math.cos(a), yo - 0.02, zb + h * 0.5 - 0.06 + 0.045 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(11)]], [0.007] * 11, im, sides=5)
    place([tor], lm)
    if lining:
        lmat = mats.get("lining", dm)
        for sx in (-1, 1):
            cuboid(part, lmat, m @ Matrix.Translation((sx * (w / 2 + 0.03), 0, zb + h / 2)), (0.06, lining, h + 0.06))
        cuboid(part, lmat, m @ Matrix.Translation((0, 0, zb + h + 0.03)), (w + 0.12, lining, 0.06))
    part.finish()


# --- Materials ----------------------------------------------------------------------------------

SILVER = (0.105, 0.099, 0.087)
SILVER_PALE = (0.15, 0.143, 0.127)
TAR = (0.02, 0.014, 0.0095)
TAR_BROWN = (0.058, 0.036, 0.021)
FALU = (0.078, 0.027, 0.019)
OCHRE = (0.19, 0.125, 0.055)
TRIM = (0.3, 0.29, 0.26)
LICHEN_GREEN = (0.16, 0.17, 0.1)
LICHEN_YELLOW = (0.2, 0.17, 0.065)
MOSS = (0.035, 0.05, 0.014)
MOSS_DARK = (0.016, 0.024, 0.008)


def plain(name, color, roughness=0.85, metallic=0.0):
    return lib.material(name, color, roughness=roughness, metallic=metallic)


def _scaled(n, vec, s):
    return n.add("ShaderNodeVectorMath", {0: vec, 1: tuple(s)}, operation="MULTIPLY").outputs[0]


def timber(name, size, along="x", seed=0, dark=0.5, dark_axis=None, kind="log", z0=0.0,
           pitch=0.25, floor=0.0, moss=0.5, lichen=0.5, paint=None, peel=0.5, cracks=0.6,
           board=0.2, ends=None):
    """
    Old wood, in a procedural material: grain along `along` ("x", "y" or "z"), tarred and
    sun-burnt brown-black where `dark` is 1, silvered grey where it's 0 (`dark_axis` = (axis, a, b)
    ramps it along x, y or z from `dark` at a to 1 - `dark` at b); each log (`kind` "log", courses
    `pitch` apart from z0) or board (`board` wide) a tone of its own; raised grain, checks, end
    grain with rings on the ends, lichen, moss on top and in the seams, splash dirt low near
    `floor`. `paint` (linear RGB) paints it, peeling (`peel`) back to grey wood. `ends` = (dark,
    light) colours the end grain (split firewood is paler than old log ends).
    """
    mat, n = lib.procedural(name, size)
    f = Field(n, seed)
    nx, ny, nz = normal(n)
    ai = {"x": 0, "y": 1, "z": 2}[along]
    co = (f.x, f.y, f.z)
    n_along = (nx, ny, nz)[ai]
    across = [c for i, c in enumerate(co) if i != ai]

    def st(k):
        s = [k, k, k]
        s[ai] = 1
        return s

    # Which log or board: a tone of its own.
    if kind == "log":
        if ai == 2:
            piece = n.math("FLOOR", n.math("DIVIDE", n.math("ADD", f.x, f.y), 0.3))
        else:
            piece = n.math("FLOOR", n.math("DIVIDE", n.math("SUBTRACT", f.z, z0), pitch))
            piece = n.math("ADD", piece, n.math("MULTIPLY", n.math("FLOOR", n.math("DIVIDE", across[0], 0.6)), 17))
    else:
        piece = n.math("FLOOR", n.math("DIVIDE", across[0], board))
        piece = n.math("ADD", piece, n.math("MULTIPLY", n.math("FLOOR", n.math("DIVIDE", across[1], board)), 23))
    tone = n.noise(1.0, detail=0, vector=n.vec(n.math("MULTIPLY", piece, 7.31), seed * 3.7, 2.2))
    tone2 = n.noise(1.0, detail=0, vector=n.vec(n.math("MULTIPLY", piece, 3.13), seed * 1.9, 8.1))
    tone = smooth(n, tone, 0.3, 0.7)
    tone2 = smooth(n, tone2, 0.3, 0.7)

    # How tarred and sun-burnt, or silvered.
    dk = dark
    if dark_axis:
        ax, a, b = dark_axis
        t = smooth(n, co["xyz".index(ax)], a, b)
        dk = n.lerp(t, dark, 1 - dark)
    patch = f.noise(0.8, 3)
    dkv = n.math("ADD", dk, n.math("ADD", n.math("MULTIPLY", n.math("SUBTRACT", tone, 0.5), 0.35),
                                   n.math("MULTIPLY", n.math("SUBTRACT", patch, 0.5), 0.45)))
    tar_mix = smooth(n, dkv, 0.3, 0.72)
    silver = n.mix(tone2, SILVER, SILVER_PALE)
    tarred = n.mix(tone, TAR, TAR_BROWN)
    color = n.mix(tar_mix, silver, tarred)

    # Grain: weathering eats the soft wood between the rings, leaving raised ridges and dark
    # grooves along the wood; streaks of grey and brown follow it.
    g = f.noise(2.2, 5, 0.62, stretch=st(30))
    grooves = smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", g, 0.5)), 0.07, 0.0)
    g2 = f.noise(6.0, 4, 0.65, stretch=st(16))
    ridges = smooth(n, g2, 0.35, 0.65)
    grain = n.math("ADD", n.math("MULTIPLY", g, 0.5), n.math("MULTIPLY", ridges, 0.5))
    streak = smooth(n, f.noise(1.2, 4, stretch=st(12)), 0.35, 0.7)
    color = n.mix(n.math("MULTIPLY", streak, 0.5), color, n.mix(tar_mix, SILVER_PALE, TAR_BROWN))
    color = n.mix(n.math("MULTIPLY", ridges, 0.35), color, (0.02, 0.017, 0.014))
    color = n.mix(n.math("MULTIPLY", grooves, 0.85), color, (0.012, 0.01, 0.008))
    brown = n.math("MULTIPLY", smooth(n, f.noise(1.5, 4, stretch=st(6)), 0.58, 0.72), n.math("SUBTRACT", 1, tar_mix))
    color = n.mix(n.math("MULTIPLY", brown, 0.6), color, (0.085, 0.055, 0.032))
    # Checks: long cracks along the grain, a few wide ones and many hairlines.
    cf = f.noise(0.6, 2, stretch=st(20))
    crack = smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", cf, 0.5)), 0.03, 0.008)
    crack = n.math("MULTIPLY", crack, smooth(n, f.noise(0.9, 2, stretch=st(3)), 0.45, 0.55))
    hair = smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", f.noise(1.6, 2, stretch=st(30)), 0.5)), 0.012, 0.002)
    hair = n.math("MULTIPLY", hair, smooth(n, f.noise(2.5, 2, stretch=st(4)), 0.5, 0.58))
    crack = n.math("MULTIPLY", n.math("MAXIMUM", crack, n.math("MULTIPLY", hair, 0.7)), cracks)
    color = n.mix(crack, color, (0.006, 0.005, 0.004))
    height = n.math("SUBTRACT", n.math("MULTIPLY", grain, 0.6), n.math("MULTIPLY", grooves, 0.6))
    height = n.math("SUBTRACT", height, n.math("MULTIPLY", crack, 1.2))
    # Axe marks: shallow scallops across the hewn faces.
    if kind == "log":
        adze = f.noise(4.0, 2, stretch=[0.5 if i != ai else 2.5 for i in range(3)])
        height = n.math("ADD", height, n.math("MULTIPLY", adze, 0.5))

    # End grain, on faces looking along the wood: rings round an off-centre heart, radial checks.
    endness = smooth(n, n.math("ABSOLUTE", n_along), 0.6, 0.85)
    flat_vec = n.vec(*(c if i != ai else 0.0 for i, c in enumerate(co)))
    vor = n.add("ShaderNodeTexVoronoi", {"Vector": flat_vec, "Scale": 3.2, "Randomness": 0.6})
    dist = vor.outputs["Distance"]
    rings = n.math("FRACT", n.math("MULTIPLY", n.math("ADD", dist, n.math("MULTIPLY", f.noise(12, 3), 0.01)), 70))
    rings = smooth(n, n.math("ABSOLUTE", n.math("SUBTRACT", rings, 0.5)), 0.25, 0.4)
    e0, e1 = ends or ((0.045, 0.03, 0.019), (0.075, 0.052, 0.032))
    end_col = n.mix(rings, e0, e1)
    end_col = n.mix(n.math("MULTIPLY", f.noise(3, 3), 0.6), end_col, [c * 0.6 for c in e0])
    end_col = n.mix(tar_mix, end_col, (0.025, 0.017, 0.011))
    radial = smooth(n, f.noise(5, 3, stretch=st(1)), 0.7, 0.74)
    end_col = n.mix(radial, end_col, (0.01, 0.008, 0.006))
    color = n.mix(endness, color, end_col)
    height = n.lerp(endness, height, n.math("SUBTRACT", n.math("MULTIPLY", rings, 0.3), n.math("MULTIPLY", radial, 0.5)))

    rough = n.lerp(tar_mix, 0.86, 0.66)

    if paint is not None:
        # Paint, chalky and mottled, brushed along the grain, peeling back to grey wood.
        pm = n.mix(f.noise(1.6, 3), [c * 0.8 for c in paint], [c * 1.12 for c in paint])
        chalk = smooth(n, f.noise(0.9, 3), 0.45, 0.8)
        pm = n.mix(0.35, pm, [sum(paint) / 3 * 1.1 + 0.01] * 3)
        pm = n.mix(n.math("MULTIPLY", chalk, 0.55), pm, [0.55 * c + 0.4 * sum(paint) / 3 + 0.03 for c in paint])
        brush = f.noise(4, 3, stretch=st(25))
        pm = n.mix(n.math("MULTIPLY", brush, 0.25), pm, [c * 0.7 for c in paint])
        pm = n.mix(n.math("MULTIPLY", grooves, 0.4), pm, [c * 0.45 for c in paint])
        low = smooth(n, f.z, floor + 1.2, floor)
        flake = n.math("ADD", f.noise(4.0, 6, 0.62, stretch=st(9)), n.math("MULTIPLY", f.noise(1.2, 3), 0.3))
        flake = n.math("ADD", flake, n.math("MULTIPLY", lib.edges(n, 0.01), 0.25))
        flake = n.math("ADD", flake, n.math("MULTIPLY", low, 0.35))
        # Whole patches gone where the weather beats on it.
        flake = n.math("ADD", flake, n.math("MULTIPLY", smooth(n, f.noise(0.7, 3), 0.55, 0.8), 0.3))
        gate = 1.05 - 0.45 * peel
        bare = smooth(n, flake, gate, gate + 0.02)
        rim = n.math("SUBTRACT", smooth(n, flake, gate - 0.03, gate), bare)
        painted = n.math("SUBTRACT", 1, bare)
        pm = n.mix(n.math("MULTIPLY", rim, 0.5), pm, [min(1.0, c * 1.25 + 0.03) for c in paint])
        color = n.mix(n.math("MULTIPLY", painted, n.math("SUBTRACT", 1, endness)), color, pm)
        rough = n.lerp(painted, rough, 0.78)
        height = n.math("ADD", height, n.math("MULTIPLY", painted, 0.35))

    # Lichen on the grey wood.
    spots = smooth(n, f.noise(7, 4, 0.6), 0.66, 0.7)
    spots = n.math("MULTIPLY", spots, smooth(n, f.noise(1.3, 2), 0.45, 0.62))
    spots = n.math("MULTIPLY", spots, n.math("MULTIPLY", n.math("SUBTRACT", 1, n.math("MULTIPLY", tar_mix, 0.7)), lichen))
    lcol = n.mix(smooth(n, f.noise(3, 2), 0.4, 0.6), LICHEN_GREEN, LICHEN_YELLOW)
    color = n.mix(spots, color, lcol)
    height = n.math("ADD", height, n.math("MULTIPLY", spots, 0.3))
    rough = n.lerp(spots, rough, 0.92)

    # Moss: on top, in the seams, low down.
    seam = lib.crevices(n, 0.05)
    up = smooth(n, nz, 0.35, 0.85)
    mm = n.math("MAXIMUM", n.math("MULTIPLY", up, smooth(n, f.noise(3, 5), 0.42, 0.62)),
                n.math("MULTIPLY", smooth(n, seam, 0.25, 0.6), 0.9))
    mm = n.math("MAXIMUM", mm, n.math("MULTIPLY", smooth(n, f.z, floor + 0.6, floor), smooth(n, f.noise(2.5, 4), 0.45, 0.65)))
    mm = n.math("MULTIPLY", mm, n.math("MULTIPLY", smooth(n, f.noise(0.7, 3), 0.3, 0.6), moss))
    mcol = n.mix(f.noise(9, 3), MOSS_DARK, MOSS)
    color = n.mix(smooth(n, mm, 0.2, 0.6), color, mcol)
    height = n.math("ADD", height, n.math("MULTIPLY", smooth(n, mm, 0.2, 0.6), n.math("MULTIPLY", f.noise(40, 3), 0.6)))
    rough = n.lerp(smooth(n, mm, 0.2, 0.6), rough, 0.95)

    # Grime: dark in the seams, rain splash near the ground, streaks under ledges.
    color = n.mix(n.math("MULTIPLY", seam, 0.7), color, (0.012, 0.01, 0.008))
    splash = n.math("MULTIPLY", smooth(n, f.z, floor + 0.45, floor), smooth(n, f.noise(6, 4), 0.3, 0.7))
    color = n.mix(n.math("MULTIPLY", splash, 0.6), color, (0.025, 0.02, 0.015))
    wash = smooth(n, f.noise(1.0, 3, stretch=(40, 40, 1.2)), 0.55, 0.75)
    wash = n.math("MULTIPLY", wash, smooth(n, n.math("ABSOLUTE", nz), 0.5, 0.1))
    color = n.mix(n.math("MULTIPLY", wash, 0.35), color, (0.02, 0.017, 0.014))
    rough = n.lerp(n.math("MULTIPLY", grooves, 0.6), rough, 0.95)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.007)})
    return mat


def stone_mat(name, size, seed=0, kind="granite", lichen=0.6, moss=0.5, floor=0.0):
    """Granite fieldstone or slate: mottled, speckled, crusted with lichen, mossy on top and low."""
    mat, n = lib.procedural(name, size)
    f = Field(n, seed)
    _, _, nz = normal(n)
    if kind == "slate":
        layers = f.noise(1.5, 4, stretch=(1, 1, 30))
        color = n.mix(layers, (0.04, 0.047, 0.053), (0.075, 0.082, 0.088))
        color = n.mix(smooth(n, f.noise(2, 3), 0.55, 0.75), color, (0.07, 0.06, 0.045))
        height = n.math("ADD", n.math("MULTIPLY", layers, 0.6), n.math("MULTIPLY", f.noise(20, 4), 0.3))
    else:
        mottle = f.noise(2.5, 4)
        color = n.mix(mottle, (0.032, 0.031, 0.029), (0.075, 0.073, 0.068))
        # Each stone a tone of its own: grey, brownish, near black, pale.
        cell = n.add("ShaderNodeTexVoronoi", {"Vector": f.p, "Scale": 2.2, "Randomness": 1.0})
        cc = cell.outputs["Color"]
        cr, cg, cb = n.xyz(cc)
        color = n.mix(n.math("MULTIPLY", smooth(n, cr, 0.6, 0.9), 0.7), color, (0.075, 0.055, 0.038))
        color = n.mix(n.math("MULTIPLY", smooth(n, cg, 0.65, 0.95), 0.7), color, (0.018, 0.018, 0.017))
        color = n.mix(n.math("MULTIPLY", smooth(n, cb, 0.75, 1.0), 0.5), color, (0.11, 0.107, 0.1))
        dark = smooth(n, f.noise(55, 2), 0.66, 0.7)
        light = smooth(n, f.noise(48, 2), 0.3, 0.27)
        color = n.mix(n.math("MULTIPLY", dark, 0.8), color, (0.02, 0.02, 0.02))
        color = n.mix(n.math("MULTIPLY", light, 0.5), color, (0.22, 0.21, 0.2))
        rust = smooth(n, f.noise(1.8, 3), 0.62, 0.75)
        color = n.mix(n.math("MULTIPLY", rust, 0.35), color, (0.12, 0.07, 0.035))
        height = n.math("ADD", n.math("MULTIPLY", f.noise(9, 5), 0.6), n.math("MULTIPLY", f.noise(60, 2), 0.2))
        # Split faces: sharp ridges, pits and fine crystal grain, darker in the hollows.
        ridges = n.math("ABSOLUTE", n.math("SUBTRACT", f.noise(3.5, 5, 0.6), 0.5))
        height = n.math("ADD", height, n.math("MULTIPLY", smooth(n, ridges, 0.0, 0.15), 0.8))
        pits = smooth(n, f.noise(28, 3), 0.68, 0.74)
        height = n.math("SUBTRACT", height, n.math("MULTIPLY", pits, 0.5))
        height = n.math("ADD", height, n.math("MULTIPLY", f.noise(140, 2), 0.25))
        color = n.mix(n.math("MULTIPLY", smooth(n, ridges, 0.08, 0.0), 0.5), color, (0.02, 0.019, 0.018))
        color = n.mix(n.math("MULTIPLY", pits, 0.6), color, (0.015, 0.014, 0.013))
    seam = lib.crevices(n, 0.06)
    # Lichen: crusty rosettes, pale green-grey, yellow, a few white.
    blot = f.noise(4.5, 4, 0.6)
    lm = n.math("MULTIPLY", smooth(n, blot, 0.55, 0.59), smooth(n, f.noise(1.1, 2), 0.32, 0.55))
    lm = n.math("MULTIPLY", lm, n.math("ADD", 0.4, n.math("MULTIPLY", smooth(n, nz, -0.2, 0.6), 0.8)))
    lm = n.math("MULTIPLY", lm, lichen)
    ring = n.math("SUBTRACT", smooth(n, blot, 0.58, 0.61), smooth(n, blot, 0.62, 0.66))
    pick = f.noise(2.2, 2)
    lcol = n.mix(smooth(n, pick, 0.45, 0.55), LICHEN_GREEN, LICHEN_YELLOW)
    lcol = n.mix(smooth(n, pick, 0.68, 0.72), lcol, (0.3, 0.3, 0.27))
    color = n.mix(n.math("MINIMUM", lm, 1.0), color, lcol)
    color = n.mix(n.math("MULTIPLY", n.math("MULTIPLY", ring, lichen), 0.4), color, (0.04, 0.04, 0.03))
    height = n.math("ADD", height, n.math("MULTIPLY", lm, 0.4))
    # Moss on top and in the joints.
    mm = n.math("MAXIMUM", n.math("MULTIPLY", smooth(n, nz, 0.5, 0.9), smooth(n, f.noise(3.5, 4), 0.48, 0.62)),
                n.math("MULTIPLY", smooth(n, seam, 0.3, 0.7), 0.8))
    mm = n.math("MULTIPLY", mm, moss)
    color = n.mix(mm, color, n.mix(f.noise(12, 3), MOSS_DARK, MOSS))
    height = n.math("ADD", height, n.math("MULTIPLY", mm, n.math("MULTIPLY", f.noise(50, 3), 0.5)))
    color = n.mix(n.math("MULTIPLY", seam, 0.8), color, (0.01, 0.01, 0.009))
    dirt = n.math("MULTIPLY", smooth(n, f.z, floor + 0.3, floor), smooth(n, f.noise(4, 4), 0.3, 0.7))
    color = n.mix(n.math("MULTIPLY", dirt, 0.7), color, (0.028, 0.022, 0.016))
    rough = n.lerp(n.math("MAXIMUM", mm, lm), 0.78, 0.93)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.01)})
    return mat


def turf_mat(name, size, seed=0, fall="y"):
    """Turf: dead autumn grass combed down the slope (`fall`), moss, bare soil; soil and roots on the cut edges."""
    mat, n = lib.procedural(name, size)
    f = Field(n, seed)
    _, _, nz = normal(n)
    s = (1, 30, 30) if fall == "x" else (30, 1, 30)
    straw = f.noise(3, 4, stretch=s)
    fine = f.noise(14, 3, stretch=s)
    patch = f.noise(1.1, 4)
    color = n.mix(smooth(n, straw, 0.35, 0.65), (0.05, 0.039, 0.016), (0.13, 0.098, 0.038))
    color = n.mix(n.math("MULTIPLY", smooth(n, f.noise(0.6, 3), 0.4, 0.7), 0.7), color, (0.045, 0.035, 0.02))
    color = n.mix(n.math("MULTIPLY", smooth(n, fine, 0.6, 0.4), 0.7), color, (0.025, 0.019, 0.009))
    green = smooth(n, patch, 0.5, 0.66)
    color = n.mix(n.math("MULTIPLY", green, 0.8), color, n.mix(f.noise(10, 3), MOSS_DARK, MOSS))
    olive = smooth(n, f.noise(2.5, 3), 0.62, 0.72)
    color = n.mix(n.math("MULTIPLY", olive, 0.6), color, (0.07, 0.07, 0.025))
    bare = smooth(n, f.noise(1.8, 5), 0.7, 0.76)
    color = n.mix(bare, color, (0.028, 0.019, 0.011))
    # Cut edges: soil with pale roots.
    side = smooth(n, nz, 0.45, 0.15)
    roots = smooth(n, f.noise(9, 3, stretch=(1, 1, 0.3)), 0.62, 0.68)
    soil = n.mix(roots, (0.022, 0.015, 0.01), (0.07, 0.055, 0.035))
    color = n.mix(side, color, soil)
    height = n.math("ADD", n.math("MULTIPLY", straw, 0.6), n.math("MULTIPLY", fine, 0.6))
    height = n.math("ADD", height, n.math("MULTIPLY", f.noise(5, 4), 0.5))
    rough = n.lerp(green, 0.9, 0.95)
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(height, distance=0.012)})
    return mat


def bark_mat(name, size=512, seed=0):
    """Old birch bark: grey-white gone dirty, dark lenticel dashes, brown where it has split."""
    mat, n = lib.procedural(name, size)
    f = Field(n, seed)
    color = n.mix(f.noise(3, 4), (0.12, 0.115, 0.1), (0.22, 0.21, 0.19))
    dash = smooth(n, f.noise(6, 3, stretch=(1, 14, 14)), 0.64, 0.68)
    color = n.mix(dash, color, (0.02, 0.016, 0.012))
    split = smooth(n, f.noise(2, 4), 0.6, 0.7)
    color = n.mix(split, color, (0.06, 0.03, 0.015))
    color = n.mix(n.math("MULTIPLY", lib.crevices(n, 0.04), 0.8), color, (0.01, 0.008, 0.006))
    n.out(**{"Base Color": color, "Roughness": 0.8, "Normal": n.bump(n.math("ADD", dash, f.noise(30, 3)), distance=0.002)})
    return mat


def grass_mats():
    """Plain materials for grass blades: straw, dark straw, olive."""
    return [
        plain("grass-straw", (0.1, 0.075, 0.03), 0.9),
        plain("grass-dark", (0.07, 0.054, 0.022), 0.9),
        plain("grass-olive", (0.075, 0.072, 0.03), 0.9),
    ]


def iron_mat():
    return plain("iron", (0.045, 0.028, 0.018), 0.75, 0.35)
