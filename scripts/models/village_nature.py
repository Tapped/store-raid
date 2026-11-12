"""
Shared builders for the village's nature models: trees, rocks and ground plants (spruce-a.py,
birch-a.py, boulder-a.py and the rest). A module, not a model: it has no build().

Foliage is alpha-tested cards. Each tree or plant renders its own card atlas at build time: twigs,
needles, leaves or blades are made as real geometry in a square per tile, rendered from above with
Cycles into an RGBA colour image (with their own ambient occlusion) and a tangent-space normal
image, then the colour is dilated into the empty pixels so filtering never bleeds black into the
edges. The cards use those images in a plain (not procedural) material whose alpha goes through a
Round node, which the glTF exporter writes as alphaMode MASK, cutoff 0.5; Blender materials are
double-sided by default. The game's loader keeps such parts out of the atlas merge with their own
material. Card normals are bent outwards from the crown, so a tree shades as one soft mass.

Bark is a procedural() material that reads mesh attributes the tubes write: "bark", a coordinate
that wraps round each branch (radius × cos, radius × sin, distance along), so lenticels and plates
run round branches whichever way they point; "bark_r", the branch radius; and "collar", 1 at a
branch's base.
"""

import hashlib
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

import lib

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.normpath(os.path.join(HERE, "..", "..", "node_modules", ".cache", "models",
                                      "village-cards"))
UP = Vector((0, 0, 1))


def srgb(hex_colour, k=1.0):
    """'#rrggbb' as linear RGB, times k."""
    h = hex_colour.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append((c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) * k)
    return tuple(out)


def lerp3(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------
# Geometry


class Geo:
    """A bmesh being built, with the layers the village's materials read."""

    def __init__(self, uv=False, bark=False, colour=False, normals=False):
        self.bm = bmesh.new()
        L = self.bm.verts.layers
        self.uv = self.bm.loops.layers.uv.new("UVMap") if uv else None
        self.bark = L.float_vector.new("bark") if bark else None
        self.bark_r = L.float.new("bark_r") if bark else None
        self.collar = L.float.new("collar") if bark else None
        self.col = L.float_color.new("col") if colour else None
        self.normals = [] if normals else None

    def vert(self, co, bark=(0, 0, 0), r=0.0, collar=0.0, col=None):
        v = self.bm.verts.new(co)
        if self.bark is not None:
            v[self.bark] = bark
            v[self.bark_r] = r
            v[self.collar] = collar
        if self.col is not None:
            c = col or (0.5, 0.5, 0.5)
            v[self.col] = (c[0], c[1], c[2], 1.0)
        return v

    def face(self, verts, uvs=None, normals=None, smooth_shade=True):
        f = self.bm.faces.new(verts)
        f.smooth = smooth_shade
        if uvs is not None:
            for loop, uv in zip(f.loops, uvs):
                loop[self.uv].uv = uv
        if self.normals is not None:
            self.normals.extend(normals or [None] * len(verts))
        return f

    def obj(self, name, mat=None):
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        if self.normals is not None and any(n is not None for n in self.normals):
            fallback = [p.normal for p in mesh.polygons for _ in p.vertices]
            mesh.normals_split_custom_set(
                [tuple(n if n is not None else fb) for n, fb in zip(self.normals, fallback)]
            )
        o = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(o)
        if mat is not None:
            o.data.materials.append(mat)
        return o


def frames(pts):
    """Tangent, normal and binormal along a polyline, carried so the rings don't twist."""
    out = []
    normal = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if normal is None:
            normal = t.cross(UP)
            if normal.length < 1e-4:
                normal = t.cross(Vector((1, 0, 0)))
        normal = (normal - t * normal.dot(t)).normalized()
        out.append((t, normal, t.cross(normal)))
    return out


def tube(geo, pts, radii, sides=6, shift=0.0, collar=0.0, tip=True, base_cap=False,
         wobble=None, col=None):
    """
    A branch through `pts`, `radii[i]` thick, writing the bark layers. `shift` moves the bark
    pattern along it, `collar` is how far from its base the collar fades. `wobble(i, a)`, if given,
    scales the radius at ring i and angle a (buttresses, a broken end). Returns the rings.
    """
    pts = [Vector(p) for p in pts]
    fr = frames(pts)
    dist = [0.0]
    for a, b in zip(pts, pts[1:]):
        dist.append(dist[-1] + (b - a).length)
    rings = []
    for i, (p, (t, nrm, bi)) in enumerate(zip(pts, fr)):
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            r = radii[i] * (wobble(i, a) if wobble else 1.0)
            off = r * (math.cos(a) * nrm + math.sin(a) * bi)
            c = max(0.0, 1 - dist[i] / collar) if collar else 0.0
            ring.append(geo.vert(
                p + off, (radii[i] * math.cos(a), radii[i] * math.sin(a), dist[i] + shift),
                radii[i], c, col,
            ))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            geo.face((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    if tip:
        t = fr[-1][0]
        v = geo.vert(pts[-1] + t * radii[-1] * 1.5, (0, 0, dist[-1] + shift + radii[-1]),
                     radii[-1], 0.0, col)
        last = rings[-1]
        for k in range(sides):
            geo.face((last[k], last[(k + 1) % sides], v))
    if base_cap:
        geo.face(list(reversed(rings[0])))
    return rings


def card(geo, o, U, V, w, h, rect, normal, segs=1, droop=0.0, curl=0.0):
    """
    A foliage card from corner `o`, `w` along unit U and `h` along unit V, textured with the atlas
    rectangle `rect` = (u0, v0, u1, v1), in `segs` strips along U. Its tip sags `droop` meters
    (world down) and its sides curl `curl` meters towards U × V. `normal(p)` gives each corner's
    shading normal.
    """
    N = U.cross(V).normalized()
    u0, v0, u1, v1 = rect
    rows = []
    for i in range(segs + 1):
        a = i / segs
        row = []
        for b in (0.0, 0.5, 1.0) if curl else (0.0, 1.0):
            p = o + U * (a * w) + V * (b * h)
            p = p - UP * (droop * a * a)
            if curl:
                p = p + N * (curl * (1 - (2 * b - 1) ** 2) * (0.3 + 0.7 * a))
            row.append((geo.vert(p), (u0 + a * (u1 - u0), v0 + b * (v1 - v0)), normal(p)))
        rows.append(row)
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(len(r0) - 1):
            quad = (r0[j], r1[j], r1[j + 1], r0[j + 1])
            geo.face([q[0] for q in quad], [q[1] for q in quad], [q[2] for q in quad])


def rotate(v, axis, angle):
    """v turned `angle` radians round unit `axis`."""
    axis = axis.normalized()
    return (v * math.cos(angle) + axis.cross(v) * math.sin(angle)
            + axis * axis.dot(v) * (1 - math.cos(angle)))


def perpendicular(t):
    """A unit vector at right angles to t, as level as it can be."""
    s = t.cross(UP)
    if s.length < 1e-4:
        s = t.cross(Vector((1, 0, 0)))
    return s.normalized()


# ---------------------------------------------------------------------------------------------
# Card atlases


class Twigs:
    """Geometry drawn into a card tile: stems, needles, leaves and blades, coloured per vertex."""

    def __init__(self):
        self.geo = Geo(colour=True)

    def stem(self, pts, r0, r1, col, sides=4):
        n = len(pts)
        radii = [r0 + (r1 - r0) * i / max(1, n - 1) for i in range(n)]
        if n >= 2:
            tube(self.geo, pts, radii, sides, tip=True, col=col)

    def quad(self, a, b, c, d, col):
        g = self.geo
        g.face([g.vert(p, col=col) for p in (a, b, c, d)])

    def tri(self, a, b, c, col):
        g = self.geo
        g.face([g.vert(p, col=col) for p in (a, b, c)])

    def needle(self, p, d, length, width, col):
        """A tapered flat needle from p along unit d, its flat side towards the camera (+z)."""
        side = d.cross(UP)
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side = side.normalized() * (width / 2)
        t = p + d * length
        self.quad(p - side, p + side, t + side * 0.35, t - side * 0.35, col)

    def ribbon(self, pts, widths, col_fn, twist=0.0):
        """A flat blade through pts, widths[i] across; col_fn(i) colours each pair."""
        g = self.geo
        prev = None
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            side = t.cross(UP)
            if side.length < 1e-4:
                side = Vector((1, 0, 0))
            side = rotate(side.normalized(), t, twist * i / len(pts)) * (widths[i] / 2)
            c = col_fn(i)
            pair = (g.vert(p - side, col=c), g.vert(p + side, col=c))
            if prev:
                g.face((prev[0], prev[1], pair[1], pair[0]))
            prev = pair

    def blob(self, centre, half, col, sides=6, tilt=Vector((0, 0, 1))):
        """A small flat disc, such as a bud, a bell or a spore case."""
        g = self.geo
        ring = [g.vert(centre + Vector((half[0] * math.cos(a), half[1] * math.sin(a),
                                        0.3 * half[1] * math.sin(a * 2))), col=col)
                for a in (2 * math.pi * k / sides for k in range(sides))]
        c = g.vert(centre + Vector((0, 0, half[1] * 0.6)), col=col)
        for k in range(sides):
            g.face((ring[k], ring[(k + 1) % sides], c))

    def leaf(self, base, d, length, width, col, curl=0.3, tip_point=0.7):
        """A birch-like leaf: ovate-triangular, pointed, folded a little along its midrib."""
        side = d.cross(UP)
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side = side.normalized()
        outline = []
        n = 7
        for i in range(n + 1):
            s = i / n
            # widest a third of the way up, straight sides to the point
            wdt = width * (math.sin(math.pi * min(1, s / tip_point) * 0.5) if s < 0.33
                           else (1 - (s - 0.33) / 0.67) ** 0.9) * 0.5
            wdt = max(wdt, 0.0005)
            outline.append((s, wdt))
        g = self.geo
        mid = []
        left = []
        right = []
        for s, wdt in outline:
            c = base + d * (s * length)
            fold = Vector((0, 0, curl * wdt))
            mid.append(g.vert(c, col=col))
            left.append(g.vert(c - side * wdt + fold, col=col))
            right.append(g.vert(c + side * wdt + fold, col=col))
        for i in range(n):
            g.face((mid[i], mid[i + 1], left[i + 1], left[i]))
            g.face((mid[i], right[i], right[i + 1], mid[i + 1]))


def _source_hash(*extra):
    h = hashlib.md5(open(os.path.abspath(__file__), "rb").read())
    for e in extra:
        h.update(repr(e).encode())
    return h.hexdigest()[:10]


def _load_pixels(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def _save_pixels(arr, path):
    h, w, _ = arr.shape
    img = bpy.data.images.new("village-card-out", w, h, alpha=True)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def _dilate(rgb, valid, iterations=24):
    """Spread the colour of valid pixels out over the rest, so filtering never pulls in black."""
    rgb = rgb.copy()
    m = valid.astype(np.float32)
    rgb *= m[..., None]
    for _ in range(iterations):
        s = np.zeros_like(rgb)
        c = np.zeros_like(m)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            s += np.roll(np.roll(rgb, dy, 0), dx, 1)
            c += np.roll(np.roll(m, dy, 0), dx, 1)
        new = (m == 0) & (c > 0)
        if not new.any():
            break
        rgb[new] = s[new] / c[new][:, None]
        m[new] = 1
    if (m == 0).any() and (m > 0).any():
        rgb[m == 0] = rgb[m > 0].mean(axis=0)
    return rgb


def atlas(key, tiles, span, tile_px=1024, cols=2, rows=2, seed=1, ao=0.02, normal_strength=0.75,
          thicken=0.0):
    """
    Renders card tiles into <CACHE>/<key>-base.png (sRGB colour, straight alpha) and
    <key>-normal.png, and returns their paths. `tiles` are functions f(twigs, rng, ox, oy, span)
    drawing into the square from (ox, oy) to (ox + span, oy + span) in meters, seen from above;
    tile i goes to column i % cols, row i // cols, counted from the bottom left as UVs are.
    `ao` is how far (meters) the twigs darken each other. `thicken` lowers the alpha each pixel
    needs, in 0..1, so thin twigs survive the alpha test.
    Re-rendered only when this module or the arguments change.
    """
    os.makedirs(CACHE, exist_ok=True)
    tag = _source_hash(key, span, tile_px, cols, rows, seed, ao, normal_strength, thicken,
                       [t.__name__ for t in tiles])
    base_path = os.path.join(CACHE, f"{key}-base.png")
    normal_path = os.path.join(CACHE, f"{key}-normal.png")
    stamp = os.path.join(CACHE, f"{key}.tag")
    if (os.path.exists(base_path) and os.path.exists(normal_path) and os.path.exists(stamp)
            and open(stamp).read() == tag):
        return base_path, normal_path

    scene = bpy.context.scene
    tw = Twigs()
    rng = random.Random(seed)
    for i, f in enumerate(tiles):
        f(tw, rng, (i % cols) * span, (i // cols) * span, span)

    # The colour: its vertex colour, darkened where twigs shade each other.
    albedo = bpy.data.materials.new("card-albedo")
    albedo.use_nodes = True
    n = lib.Nodes(albedo)
    out = n.tree.nodes["Material Output"]
    col = n.add("ShaderNodeVertexColor", layer_name="col").outputs["Color"]
    occ = n.add("ShaderNodeAmbientOcclusion", {"Distance": ao}, samples=16).outputs["AO"]
    dark = n.math("ADD", 0.55, n.math("MULTIPLY", occ, 0.45))
    shaded = n.add("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    n.set(shaded.inputs["Factor"], 1.0)
    n.set(shaded.inputs["A"], col)
    n.set(shaded.inputs["B"], n.vec(dark, dark, dark))
    emit = n.add("ShaderNodeEmission", {"Color": shaded.outputs["Result"], "Strength": 1.0})
    n.tree.links.new(emit.outputs["Emission"], out.inputs["Surface"])

    # The normal, turned to face the camera, as a colour.
    nmat = bpy.data.materials.new("card-normal")
    nmat.use_nodes = True
    m = lib.Nodes(nmat)
    mout = m.tree.nodes["Material Output"]
    geom = m.add("ShaderNodeNewGeometry")
    flip = m.math("SUBTRACT", 1.0, m.math("MULTIPLY", geom.outputs["Backfacing"], 2.0))
    facing = m.add("ShaderNodeVectorMath", operation="SCALE")
    m.set(facing.inputs[0], geom.outputs["Normal"])
    m.set(facing.inputs["Scale"], flip)
    enc = m.add("ShaderNodeVectorMath", operation="MULTIPLY_ADD")
    m.set(enc.inputs[0], facing.outputs["Vector"])
    enc.inputs[1].default_value = (0.5, 0.5, 0.5)
    enc.inputs[2].default_value = (0.5, 0.5, 0.5)
    memit = m.add("ShaderNodeEmission", {"Color": enc.outputs["Vector"], "Strength": 1.0})
    m.tree.links.new(memit.outputs["Emission"], mout.inputs["Surface"])

    twigs = tw.geo.obj("card-twigs", albedo)
    cam = bpy.data.objects.new("card-camera", bpy.data.cameras.new("card-camera"))
    scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(cols, rows) * span
    cam.data.clip_start = 0.01
    cam.data.clip_end = 100
    cam.location = (cols * span / 2, rows * span / 2, 10)
    cam.rotation_euler = (0, 0, 0)
    scene.camera = cam

    lib.cycles(scene)
    r = scene.render
    r.resolution_x = cols * tile_px
    r.resolution_y = rows * tile_px
    r.resolution_percentage = 100
    r.film_transparent = True
    r.filter_size = 1.0
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1

    raw_a = os.path.join(CACHE, f"{key}-raw-albedo.png")
    raw_n = os.path.join(CACHE, f"{key}-raw-normal.png")
    scene.view_settings.view_transform = "Standard"
    r.filepath = raw_a
    bpy.ops.render.render(write_still=True)
    scene.view_settings.view_transform = "Raw"
    bpy.context.view_layer.material_override = nmat
    r.filepath = raw_n
    bpy.ops.render.render(write_still=True)
    bpy.context.view_layer.material_override = None
    scene.view_settings.view_transform = "Standard"
    r.film_transparent = False

    bpy.data.objects.remove(twigs)
    bpy.data.objects.remove(cam)
    bpy.data.materials.remove(albedo)
    bpy.data.materials.remove(nmat)
    scene.camera = None

    a = _load_pixels(raw_a)
    alpha = a[..., 3]
    valid = alpha > 0.15
    rgb = _dilate(a[..., :3], valid)
    if thicken:
        alpha = np.clip(alpha / max(0.05, 1 - thicken), 0, 1)
    _save_pixels(np.dstack([rgb, alpha]), base_path)

    nm = _load_pixels(raw_n)
    vec = nm[..., :3] * 2 - 1
    vec = _dilate(vec, nm[..., 3] > 0.15)
    vec = vec * normal_strength + np.array([0, 0, 1.0]) * (1 - normal_strength)
    vec /= np.linalg.norm(vec, axis=2, keepdims=True) + 1e-6
    _save_pixels(np.dstack([vec * 0.5 + 0.5, np.ones_like(alpha)]), normal_path)
    open(stamp, "w").write(tag)
    return base_path, normal_path


def tile_rect(i, cols=2, rows=2, inset=0.0):
    """Tile i's rectangle in UVs, (u0, v0, u1, v1)."""
    c, r = i % cols, i // cols
    return ((c + inset) / cols, (r + inset) / rows, (c + 1 - inset) / cols, (r + 1 - inset) / rows)


def card_material(name, base_path, normal_path, roughness=0.85):
    """
    Foliage cards' material: the atlas's colour, alpha through Round (exported as MASK, cutoff
    0.5), its normal map; double-sided, as Blender's materials are by default.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = False
    n = lib.Nodes(mat)
    uv = n.add("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"]
    base_img = bpy.data.images.load(base_path, check_existing=False)
    base_img.colorspace_settings.name = "sRGB"
    base_img.alpha_mode = "STRAIGHT"
    normal_img = bpy.data.images.load(normal_path, check_existing=False)
    normal_img.colorspace_settings.name = "Non-Color"
    base = n.add("ShaderNodeTexImage", {"Vector": uv}, image=base_img)
    nrm = n.add("ShaderNodeTexImage", {"Vector": uv}, image=normal_img)
    nmap = n.add("ShaderNodeNormalMap", {"Color": nrm.outputs["Color"]}, uv_map="UVMap")
    n.out(**{
        "Base Color": base.outputs["Color"],
        "Alpha": n.math("ROUND", base.outputs["Alpha"]),
        "Roughness": roughness,
        "Normal": nmap.outputs["Normal"],
    })
    return mat


def _room(p, d, lo, hi, margin):
    """How far from p along d before leaving the box lo..hi (2D), less a margin."""
    best = 1e9
    for axis in (0, 1):
        if abs(d[axis]) > 1e-6:
            edge = (hi[axis] - margin) if d[axis] > 0 else (lo[axis] + margin)
            best = min(best, (edge - p[axis]) / d[axis])
    return max(0.0, best)


def _heading(a):
    return Vector((math.cos(a), math.sin(a), 0))


# ---------------------------------------------------------------------------------------------
# Spruce cards


SPRUCE_NEEDLE = (srgb("#1f2e22", 1.15), srgb("#2f4030", 1.15))
SPRUCE_YOUNG = srgb("#3d5236")
SPRUCE_TWIG = srgb("#5a4030")
SPRUCE_BARK = srgb("#4a3e35")


def _spruce_shoot(tw, rng, p, heading, length, level, box, z=0.0, needle_scale=1.0,
                  hang=0.0):
    """
    A spruce shoot from p, `heading` radians in the tile's plane, with side shoots below `level`
    and needles all round, brushed forwards. `hang` turns its side shoots towards -y (a curtain).
    """
    lo, hi = box
    margin = 0.012 * (hi[0] - lo[0])
    length = min(length, _room(p, _heading(heading), lo, hi, margin))
    if length < 0.02:
        return
    steps = max(3, int(length / 0.02))
    bend = rng.uniform(-0.6, 0.6) / max(length, 0.1)
    pts = [Vector((p.x, p.y, z))]
    hd = heading
    for i in range(steps):
        hd += bend * length / steps
        q = pts[-1] + _heading(hd) * (length / steps)
        q.z = z + 0.004 * math.sin(i * 0.7)
        pts.append(q)
    green = lerp3(*SPRUCE_NEEDLE, rng.random())
    tw.stem(pts, 0.0035 if level == 0 else 0.0022, 0.0012, SPRUCE_TWIG, sides=4)
    # Needles: every few millimeters, five round the shoot, shorter towards its tip.
    total = length
    step = 0.0042
    s = 0.0
    j = 0
    while s < total:
        f = s / total
        i = min(int(f * steps), steps - 1)
        a, b = pts[i], pts[i + 1]
        local = (s - i * total / steps) / (total / steps)
        c = a.lerp(b, local)
        fwd = (b - a).normalized()
        side = fwd.cross(UP).normalized()
        young = smooth((f - 0.65) / 0.35)
        col = lerp3(green, SPRUCE_YOUNG, young * 0.6)
        col = tuple(x * rng.uniform(0.75, 1.15) for x in col)
        ln = (0.017 - 0.005 * f) * needle_scale * rng.uniform(0.85, 1.15)
        for k in range(6):
            phi = 2 * math.pi * (k + 0.5 * (j % 2)) / 6 + rng.uniform(-0.3, 0.3)
            lift = math.sin(phi)
            if lift < -0.2:
                phi = math.pi - phi if rng.random() < 0.5 else phi * 0.4
            beta = math.radians(rng.uniform(42, 62))
            d = (fwd * math.cos(beta)
                 + (side * math.cos(phi) + UP * math.sin(phi)) * math.sin(beta)).normalized()
            tw.needle(c, d, ln, 0.002 * needle_scale, col)
        s += step
        j += 1
    if level >= 2:
        return
    # Side shoots, alternating, longer near the base.
    spacing = 0.055 if level == 0 else 0.035
    s = spacing * rng.uniform(0.6, 1.2)
    k = 0
    while s < length * 0.9:
        f = s / length
        i = min(int(f * steps), steps - 1)
        q = pts[i]
        hd = math.atan2(pts[i + 1].y - q.y, pts[i + 1].x - q.x)
        sign = 1 if k % 2 == 0 else -1
        ang = math.radians(rng.uniform(45, 62)) * sign
        if hang:
            # Curtain branchlets lean down the tile on both sides.
            ang = ang * (1 - hang * 0.5)
        child_len = length * (0.62 if level == 0 else 0.5) * (1 - f) ** 0.75 + 0.03
        _spruce_shoot(tw, rng, q, hd + ang, child_len * rng.uniform(0.8, 1.15), level + 1, box,
                      z + 0.006 * sign, needle_scale)
        s += spacing * rng.uniform(0.75, 1.3)
        k += 1


def spruce_spray(tw, rng, ox, oy, span):
    """A flat spruce spray seen from above: the stem from the left edge's middle to the right."""
    box = ((ox, oy), (ox + span, oy + span))
    _spruce_shoot(tw, rng, Vector((ox + 0.015 * span, oy + 0.5 * span, 0)),
                  rng.uniform(-0.06, 0.06), 0.95 * span, 0, box)


def spruce_curtain(tw, rng, ox, oy, span):
    """Branchlets hanging from a branch along the tile's top edge: the comb spruce's curtain."""
    box = ((ox, oy), (ox + span, oy + span))
    top = oy + 0.94 * span
    pts = [Vector((ox + 0.01 * span + i * 0.98 * span / 12, top + 0.01 * math.sin(i), 0.01))
           for i in range(13)]
    tw.stem(pts, 0.008, 0.006, SPRUCE_TWIG, sides=5)
    x = ox + 0.05 * span
    while x < ox + 0.95 * span:
        ln = span * rng.uniform(0.55, 0.9)
        hd = -math.pi / 2 + rng.uniform(-0.25, 0.25)
        _spruce_shoot(tw, rng, Vector((x, top, 0)), hd, ln, 0, box, z=rng.uniform(-0.01, 0.01),
                      hang=1.0)
        x += span * rng.uniform(0.11, 0.16)
    # A few short shoots standing up off the top of the branch.
    for _ in range(6):
        x = ox + rng.uniform(0.08, 0.92) * span
        _spruce_shoot(tw, rng, Vector((x, top, 0.012)), math.pi / 2 + rng.uniform(-0.6, 0.6),
                      0.05 * span, 1, box)


# ---------------------------------------------------------------------------------------------
# Birch cards


BIRCH_TWIG = srgb("#3a2722")
BIRCH_TWIG_OLD = srgb("#5a4a44")
BIRCH_LEAF = srgb("#8a7434")


def _birch_twig(tw, rng, p, heading, length, level, box, leaves, z=0.0):
    """A zigzagging birch twig with side twigs, buds at the nodes and, maybe, a leaf or two."""
    lo, hi = box
    margin = 0.015 * (hi[0] - lo[0])
    length = min(length, _room(p, _heading(heading), lo, hi, margin))
    if length < 0.015:
        return
    seg = rng.uniform(0.022, 0.034)
    steps = max(2, int(length / seg))
    pts = [Vector((p.x, p.y, z))]
    hd = heading
    zig = math.radians(rng.uniform(5, 10))
    for i in range(steps):
        hd += (zig if i % 2 else -zig) + rng.uniform(-0.04, 0.04)
        hd += -0.012 * math.cos(hd)  # a gentle droop towards -y
        pts.append(pts[-1] + _heading(hd) * (length / steps))
    r0 = (0.0042, 0.003, 0.0022, 0.0017)[level]
    col = lerp3(BIRCH_TWIG, BIRCH_TWIG_OLD, 0.5 if level == 0 else rng.uniform(0, 0.2))
    col = tuple(c * rng.uniform(0.8, 1.2) for c in col)
    tw.stem(pts, r0, max(0.0012, r0 * 0.5), col, sides=4)
    # Buds at the nodes, and side twigs from some of them.
    for i in range(1, len(pts) - 1):
        hd_i = math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x)
        sign = 1 if i % 2 else -1
        bud_d = _heading(hd_i + sign * 0.7)
        tw.blob(pts[i] + bud_d * 0.003, (0.0025, 0.0016), BIRCH_TWIG)
        f = i / len(pts)
        if level < 3 and rng.random() < (0.75 if level == 0 else 0.5):
            child = length * (0.55 if level == 0 else 0.42) * (1 - f) ** 0.6
            _birch_twig(tw, rng, pts[i], hd_i + sign * math.radians(rng.uniform(30, 52)),
                        child * rng.uniform(0.7, 1.2), level + 1, box, leaves,
                        z + 0.004 * sign)
    if leaves and level >= 1 and rng.random() < leaves:
        hd_e = math.atan2(pts[-1].y - pts[-2].y, pts[-1].x - pts[-2].x)
        for _ in range(rng.choice((1, 1, 2))):
            d = _heading(hd_e + rng.uniform(-1.2, 1.2) - 0.4)
            stalk = pts[-1] + d * 0.012
            tw.stem([pts[-1], stalk], 0.0008, 0.0006, BIRCH_TWIG, sides=3)
            tone = rng.random()
            lc = lerp3(BIRCH_LEAF, srgb("#5e4a2a") if tone < 0.5 else srgb("#9a8646"),
                       rng.uniform(0.2, 0.7))
            tw.leaf(stalk, d, rng.uniform(0.032, 0.045), rng.uniform(0.024, 0.032), lc,
                    curl=rng.uniform(0.2, 0.6))


def birch_spray(tw, rng, ox, oy, span):
    """A bare birch spray, growing from the left edge's middle towards the right."""
    box = ((ox, oy), (ox + span, oy + span))
    _birch_twig(tw, rng, Vector((ox + 0.015 * span, oy + 0.5 * span, 0)),
                rng.uniform(-0.1, 0.1), 0.96 * span, 0, box, 0.0)


def birch_spray_leaves(tw, rng, ox, oy, span):
    """A birch spray with a few yellow leaves still on."""
    box = ((ox, oy), (ox + span, oy + span))
    _birch_twig(tw, rng, Vector((ox + 0.015 * span, oy + 0.5 * span, 0)),
                rng.uniform(-0.1, 0.1), 0.96 * span, 0, box, 0.22)


def birch_spray_fine(tw, rng, ox, oy, span):
    """A dense birch spray, two twigs from the left edge: the outer crown's haze."""
    box = ((ox, oy), (ox + span, oy + span))
    for y, hd in ((0.42, 0.18), (0.58, -0.15)):
        _birch_twig(tw, rng, Vector((ox + 0.015 * span, oy + y * span, 0)), hd, 0.95 * span,
                    1, box, 0.05)


# ---------------------------------------------------------------------------------------------
# Ground plant cards (seen from the side: +y is up the tile)


# Late-autumn tussock grass: mostly dead, straw to grey-brown, some blades still dull green; each
# blade dark at the root (in the tussock's own shade) and palest at its tip.
GRASS = (srgb("#6e6243"), srgb("#7d6f4c"), srgb("#5c5238"), srgb("#6b6650"))
GRASS_GREEN = (srgb("#48502f"), srgb("#3c4529"), srgb("#535934"))
GRASS_BASE = srgb("#1d1f14")


def grass_tile(flop):
    def draw(tw, rng, ox, oy, span):
        base = Vector((ox + 0.5 * span, oy + 0.02 * span, 0))
        for _ in range(int(150 * span / 0.8)):
            x0 = base.x + rng.gauss(0, 0.07 * span)
            lean = rng.gauss(0, 0.35) + (x0 - base.x) / span * 1.5
            ln = span * rng.uniform(0.45, 0.96)
            fall = rng.random() < flop
            pts = []
            widths = []
            n = 9
            a = math.pi / 2 - lean
            p = Vector((x0, base.y, rng.uniform(-0.02, 0.02)))
            w0 = rng.uniform(0.0025, 0.0045) * span / 0.6
            curve = (rng.uniform(1.2, 2.6) if fall else rng.uniform(0.0, 0.6)) * (
                1 if lean > 0 else -1)
            for i in range(n + 1):
                f = i / n
                pts.append(p.copy())
                widths.append(w0 * (1 - f) ** 0.7 + 0.0006)
                a -= curve * f / n * 1.6
                p = p + Vector((math.cos(a), math.sin(a), 0)) * (ln / n)
                p.x = min(max(p.x, ox + 0.02 * span), ox + 0.98 * span)
                p.y = min(max(p.y, oy + 0.01 * span), oy + 0.98 * span)
            green = rng.random() < (0.45 if flop < 0.4 else 0.2)
            tone = rng.choice(GRASS_GREEN if green else GRASS)
            k = rng.uniform(0.65, 1.1)
            # Dead tips bleach paler than the rest of the blade.
            tip = lerp3(tone, srgb("#8a7d5c"), 0.0 if green else rng.uniform(0.2, 0.6))
            tw.ribbon(pts, widths,
                      lambda i, tone=tone, k=k, tip=tip: tuple(
                          c * k for c in (lerp3(GRASS_BASE, tone, smooth(i / (n * 0.65)))
                                          if i < n * 0.65 else
                                          lerp3(tone, tip, (i - n * 0.65) / (n * 0.35)))),
                      twist=rng.uniform(-1.5, 1.5))
        # A few seed heads on taller stems: airy panicles.
        for _ in range(int(7 * span / 0.8)):
            x0 = base.x + rng.gauss(0, 0.05 * span)
            top = Vector((x0 + rng.gauss(0, 0.06 * span), oy + span * rng.uniform(0.75, 0.95), 0))
            tw.stem([Vector((x0, base.y, 0)), (Vector((x0, base.y, 0)) + top) / 2
                     + Vector((rng.gauss(0, 0.02), 0, 0)), top], 0.0012, 0.0008, GRASS[2], 3)
            for _ in range(14):
                d = _heading(math.pi / 2 + rng.uniform(-1.0, 1.0))
                q = top - Vector((0, rng.uniform(0, 0.12 * span), 0))
                end = q + d * rng.uniform(0.015, 0.04) * span / 0.6
                tw.stem([q, end], 0.0006, 0.0005, GRASS[2], 3)
                tw.blob(end, (0.002, 0.0012), GRASS[0])
    draw.__name__ = f"grass_tile_{flop}"
    return draw


HEATHER_STEM = srgb("#3b2f2a")
HEATHER_LEAF = (srgb("#3d3c33"), srgb("#4a4538"), srgb("#5a4a4e"))
HEATHER_FLOWER = (srgb("#5e4c52"), srgb("#64504a"), srgb("#4f4240"))


def heather_tile(tw, rng, ox, oy, span):
    """Heather shoots seen from the side: woody stems, scale leaves, dead flower spikes."""
    def shoot(p, hd, ln, level):
        n = max(3, int(ln / 0.02))
        pts = [p]
        for i in range(n):
            hd += rng.uniform(-0.12, 0.12)
            q = pts[-1] + _heading(hd) * (ln / n)
            q.x = min(max(q.x, ox + 0.02 * span), ox + 0.98 * span)
            q.y = min(max(q.y, oy + 0.01 * span), oy + 0.98 * span)
            pts.append(q)
        tw.stem(pts, 0.003 if level == 0 else 0.0018, 0.001, HEATHER_STEM, 4)
        flowering = level > 0 and rng.random() < 0.6
        for i, q in enumerate(pts[1:], 1):
            f = i / n
            # Darker deep in the dome, where little light gets in.
            k = 0.45 + 0.55 * smooth((q.y - oy) / (0.7 * span))
            for _ in range(5):
                d = _heading(hd + rng.uniform(-1.4, 1.4))
                if flowering and f > 0.45:
                    c = rng.choice(HEATHER_FLOWER)
                    tw.blob(q + d * 0.004, (0.0032, 0.0024), tuple(x * k for x in c))
                else:
                    c = rng.choice(HEATHER_LEAF)
                    tw.needle(q, d, 0.006, 0.0022, tuple(x * k * rng.uniform(0.8, 1.1) for x in c))
            if level < 2 and rng.random() < 0.35:
                shoot(q, hd + rng.choice((-1, 1)) * rng.uniform(0.3, 0.7),
                      ln * (1 - f) * 0.7, level + 1)
    for _ in range(int(26 * span / 0.5)):
        x = ox + span * (0.5 + rng.gauss(0, 0.2))
        shoot(Vector((x, oy + 0.02 * span, rng.uniform(-0.02, 0.02))),
              math.pi / 2 + rng.gauss(0, 0.4), span * rng.uniform(0.5, 0.92), 0)


# Dead bracken: rust-brown going grey-brown and dark where it rots, not orange.
FERN = (srgb("#5a4129"), srgb("#684b2f"), srgb("#463323"), srgb("#544634"), srgb("#3d3326"))


def fern_tile(shrivel):
    def draw(tw, rng, ox, oy, span):
        """A dead fern frond seen from above, its rachis from the left edge to the right."""
        y0 = oy + 0.5 * span
        n = 26
        pts = [Vector((ox + 0.02 * span + i * 0.94 * span / n,
                       y0 + 0.03 * span * math.sin(i * 0.25), 0)) for i in range(n + 1)]
        tw.stem(pts, 0.004, 0.0015, srgb("#4a3420"), 4)
        for i in range(2, n):
            f = i / n
            q = pts[i]
            for sign in (1, -1):
                ln = span * 0.46 * math.sin(math.pi * min(1, f * 1.1)) ** 0.8 * (1 - 0.4 * f)
                if rng.random() < shrivel * 0.5:
                    ln *= rng.uniform(0.3, 0.7)  # broken off
                a = sign * math.radians(70 - 25 * f) + rng.uniform(-0.1, 0.1)
                d = _heading(a)
                tone = rng.choice(FERN)
                tone = tuple(c * rng.uniform(0.75, 1.15) for c in tone)
                m = max(2, int(ln / 0.016))
                prev = q
                for j in range(m):
                    g = j / m
                    c = q + d * (ln * g) + Vector((0, 0, -shrivel * 0.02 * g))
                    w = 0.02 * (1 - g * 0.5) * span / 0.9
                    # a pinnule each side, shrivelled ones narrower and curled
                    shade = 0.6 + 0.4 * g
                    for s2 in (1, -1):
                        pd = rotate(d, UP, s2 * math.radians(65))
                        tw.leaf(c, pd, w * (1 - shrivel * 0.4), w * 0.7 * (1 - shrivel * 0.5),
                                tuple(x * shade for x in tone), curl=0.3 + shrivel)
                    prev = c
                tw.stem([q, prev], 0.0013, 0.0008, tone, 3)
    draw.__name__ = f"fern_tile_{shrivel}"
    return draw


# ---------------------------------------------------------------------------------------------
# Bark materials


def _attr(n, name):
    return n.add("ShaderNodeAttribute", attribute_name=name, attribute_type="GEOMETRY")


def _scale(n, v, s):
    node = n.add("ShaderNodeVectorMath", operation="MULTIPLY")
    n.set(node.inputs[0], v)
    node.inputs[1].default_value = s
    return node.outputs["Vector"]


def spruce_bark(size=1024):
    """Norway spruce bark: thin reddish-grey scales in plates, dark between, lichen in patches."""
    mat, n = lib.procedural("spruce-bark", size)
    bark = _attr(n, "bark").outputs["Vector"]
    radius = _attr(n, "bark_r").outputs["Fac"]
    collar = _attr(n, "collar").outputs["Fac"]
    z = n.xyz()[2]
    warp = n.add("ShaderNodeTexNoise", {"Vector": bark, "Scale": 9.0, "Detail": 3.0}).outputs["Color"]
    mixed = n.add("ShaderNodeMix", data_type="VECTOR")
    n.set(mixed.inputs["Factor"], 0.04)
    n.set(mixed.inputs[4], bark)
    n.set(mixed.inputs[5], warp)
    sc = _scale(n, mixed.outputs[1], (34, 34, 20))
    vor = n.add("ShaderNodeTexVoronoi", {"Vector": sc, "Scale": 1.0, "Randomness": 0.9})
    edge = n.add("ShaderNodeTexVoronoi", {"Vector": sc, "Scale": 1.0, "Randomness": 0.9},
                 feature="DISTANCE_TO_EDGE").outputs["Distance"]
    cell = n.xyz(vor.outputs["Color"])[0]
    plate = lib.smoothstep(n, edge, 0.015, 0.09)
    fine = n.noise(160, detail=4, vector=bark)
    base = lib.shade(n, SPRUCE_BARK, n.math("ADD", 0.72, n.math("MULTIPLY", cell, 0.4)))
    flake = lib.smoothstep(n, cell, 0.84, 0.88)
    base = n.mix(n.math("MULTIPLY", flake, 0.6), base, srgb("#5a4536"))
    grey = lib.smoothstep(n, n.noise(2.5, detail=4, vector=bark), 0.45, 0.7)
    base = n.mix(n.math("MULTIPLY", grey, 0.6), base, srgb("#5e5a52"))
    color = n.mix(n.math("MULTIPLY", n.math("SUBTRACT", 1, plate), 0.85), base, srgb("#221c17"))
    # Lichen: grey-green crusts in patches, more low and on the trunk.
    lich = lib.smoothstep(n, n.noise(3.5, detail=5), 0.56, 0.66)
    lich = n.math("MULTIPLY", lich, lib.smoothstep(n, radius, 0.03, 0.08))
    lich = n.math("MULTIPLY", lich, lib.smoothstep(n, n.noise(90, detail=3), 0.35, 0.55))
    color = n.mix(n.math("MULTIPLY", lich, 0.8), color, srgb("#7d8270", 0.85))
    # Green algae low down.
    algae = n.math("MULTIPLY", lib.smoothstep(n, n.math("SUBTRACT", 2.2, z), 0, 1.8),
                   lib.smoothstep(n, n.noise(2.0, detail=3), 0.45, 0.6))
    color = n.mix(n.math("MULTIPLY", algae, 0.55), color, srgb("#3c4a2a"))
    # Twigs: smooth and brown.
    twig = lib.smoothstep(n, radius, 0.025, 0.012)
    color = n.mix(twig, color, lib.shade(n, srgb("#4a3a2c"), n.math("ADD", 0.8, fine)))
    color = n.mix(n.math("MULTIPLY", collar, 0.5), color, srgb("#2a211b"))
    color = lib.shade(n, color, n.math("SUBTRACT", 1, n.math("MULTIPLY", lib.crevices(n, 0.25), 0.7)))
    rough = n.lerp(plate, 0.95, 0.82)
    h = n.math("ADD", n.math("MULTIPLY", plate, 0.6), n.math("MULTIPLY", cell, 0.25))
    h = n.math("ADD", h, n.math("MULTIPLY", fine, 0.15))
    h = n.math("ADD", h, n.math("MULTIPLY", lich, 0.1))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(h, distance=0.006)})
    return mat


def birch_bark(size=1024, dead=False):
    """
    Downy birch bark: chalky white with dark lenticels in horizontal dashes, black at branch
    collars, black and fissured low on the trunk, red-brown on thin twigs, green-grey grime.
    `dead` greys it, peels it and lets the brown wood show.
    """
    mat, n = lib.procedural("birch-bark", size)
    bark = _attr(n, "bark").outputs["Vector"]
    radius = _attr(n, "bark_r").outputs["Fac"]
    collar = _attr(n, "collar").outputs["Fac"]
    z = n.xyz()[2]
    white = srgb("#cfcabb", 0.72) if not dead else srgb("#a8a398", 0.5)
    dark = srgb("#2a2622")
    broad = n.noise(4, detail=3, vector=bark)
    color = lib.shade(n, white, n.math("ADD", 0.82, n.math("MULTIPLY", broad, 0.35)))
    # Lenticels: dashes wrapping round the branch.
    len_v = _scale(n, bark, (7, 7, 85))
    lent = lib.smoothstep(n, n.noise(1.0, detail=2, vector=len_v), 0.6, 0.66)
    lent = n.math("MULTIPLY", lent, lib.smoothstep(n, n.noise(9, detail=2, vector=bark), 0.3, 0.5))
    color = n.mix(lent, color, srgb("#3a322c"))
    # Peeling: thin curls of pinkish under-bark, horizontal.
    peel_v = _scale(n, bark, (3, 3, 26))
    peel = lib.smoothstep(n, n.noise(1.0, detail=3, vector=peel_v), 0.7, 0.74)
    color = n.mix(n.math("MULTIPLY", peel, 0.7), color, srgb("#b08a74", 0.8))
    # Black patches: scars and knots in blots, more on big branches.
    blot = lib.smoothstep(n, n.noise(2.2, detail=6, roughness=0.65, vector=_scale(n, bark,
                                                                                (1.6, 1.6, 1.0))),
                          0.66, 0.7)
    color = n.mix(blot, color, dark)
    # The base of the trunk: black, rugged, fissured.
    rough_v = _scale(n, bark, (14, 14, 2.5))
    fiss = n.add("ShaderNodeTexVoronoi", {"Vector": rough_v, "Scale": 1.0, "Randomness": 1.0},
                 feature="DISTANCE_TO_EDGE").outputs["Distance"]
    ridge = lib.smoothstep(n, fiss, 0.02, 0.18)
    ragged = n.noise(1.0, detail=5, roughness=0.7, vector=_scale(n, bark, (9, 9, 1.5)))
    lowmask = lib.smoothstep(n, n.math("ADD", n.math("SUBTRACT", 1.1, z),
                                       n.math("MULTIPLY", ragged, 2.2)), 0.95, 1.15)
    lowmask = n.math("MULTIPLY", lowmask, lib.smoothstep(n, radius, 0.06, 0.1))
    low_col = n.mix(ridge, srgb("#151210"), lib.shade(n, srgb("#4a443e"), n.math("ADD", 0.7,
                                                                                broad)))
    color = n.mix(lowmask, color, low_col)
    # Collars: black under each branch.
    color = n.mix(lib.smoothstep(n, collar, 0.2, 0.6), color, dark)
    # Grime: green-grey on one side.
    gn = n.add("ShaderNodeNewGeometry").outputs["Normal"]
    side = n.xyz(gn)[1]
    grime = n.math("MULTIPLY", lib.smoothstep(n, side, 0.0, 0.9),
                   lib.smoothstep(n, n.noise(3, detail=4), 0.4, 0.65))
    color = n.mix(n.math("MULTIPLY", grime, 0.45), color, srgb("#5d6248", 0.8))
    # Thin branches are brown, whitening as they thicken.
    twig = lib.smoothstep(n, radius, 0.03, 0.012)
    color = n.mix(twig, color, lib.shade(n, srgb("#4a3028"), n.math("ADD", 0.75, broad)))
    if dead:
        rot = lib.smoothstep(n, n.noise(1.4, detail=5, vector=bark), 0.55, 0.6)
        rot = n.math("MULTIPLY", rot, n.math("SUBTRACT", 1, lowmask))
        color = n.mix(rot, color, lib.shade(n, srgb("#4a3424"), n.math("ADD", 0.6, broad)))
        color = n.mix(n.math("MULTIPLY", grime, 0.4), color, srgb("#4d5440"))
    else:
        rot = 0.0
    color = lib.shade(n, color, n.math("SUBTRACT", 1, n.math("MULTIPLY", lib.crevices(n, 0.25), 0.7)))
    rough = n.lerp(lowmask, 0.62, 0.92)
    rough = n.lerp(lent, rough, 0.85)
    h = n.math("MULTIPLY", n.math("SUBTRACT", 1, lent), 0.15)
    h = n.math("ADD", h, n.math("MULTIPLY", n.math("MULTIPLY", ridge, lowmask), 0.9))
    h = n.math("ADD", h, n.math("MULTIPLY", peel, 0.12))
    h = n.math("SUBTRACT", h, n.math("MULTIPLY", rot, 0.4))
    h = n.math("ADD", h, n.math("MULTIPLY", n.noise(120, detail=3, vector=bark), 0.08))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(h, distance=0.006)})
    return mat


# ---------------------------------------------------------------------------------------------
# Trees


def _trunk(geo, rng, height, r_base, top_r, rings, lean=0.04, flare=0.5, buttress=5,
           sides=10, shift=0.0, start=Vector((0, 0, 0)), axis=UP):
    """A trunk from `start` up `axis`, tapering, wandering a little, flared at the foot."""
    pts, radii = [], []
    ph = rng.uniform(0, 6.28)
    side = perpendicular(axis)
    side2 = axis.cross(side)
    for i in range(rings + 1):
        f = (i / rings) ** 1.15
        h = f * height
        wander = (side * math.sin(h * 0.6 + ph) + side2 * math.cos(h * 0.45 + ph * 1.3)) * (
            lean * f + 0.02 * math.sin(h * 1.7))
        pts.append(start + axis * h + wander + side * (lean * f * f * height * 0.05))
        r = r_base * (1 - f) ** 0.8 + top_r * f
        r *= 1 + flare * math.exp(-h / 0.35)
        radii.append(r)
    lobes = rng.uniform(0, 6.28)

    def wobble(i, a):
        h = (i / rings) ** 1.15 * height
        foot = math.exp(-h / 0.4)
        return 1 + foot * 0.35 * max(0, math.cos(buttress * a + lobes)) ** 2 - 0.12 * foot
    rings_out = tube(geo, pts, radii, sides, shift=shift, tip=True, wobble=wobble)
    return pts, radii, rings_out


def _along(pts, f):
    """The point and tangent at fraction f of a polyline's length."""
    d = [0.0]
    for a, b in zip(pts, pts[1:]):
        d.append(d[-1] + (b - a).length)
    target = f * d[-1]
    for i in range(len(pts) - 1):
        if d[i + 1] >= target:
            t = (target - d[i]) / max(1e-6, d[i + 1] - d[i])
            return pts[i].lerp(pts[i + 1], t), (pts[i + 1] - pts[i]).normalized()
    return pts[-1], (pts[-1] - pts[-2]).normalized()


def _radius_at(pts, radii, z):
    for i in range(len(pts) - 1):
        if pts[i + 1].z >= z:
            t = (z - pts[i].z) / max(1e-6, pts[i + 1].z - pts[i].z)
            return pts[i].lerp(pts[i + 1], t), radii[i] + (radii[i + 1] - radii[i]) * t
    return pts[-1], radii[-1]


def spruce(height, width, seed, bark_size=1024, tile_px=1024, density=1.0, key="spruce"):
    """
    A Norway spruce of the western valleys: a straight trunk, whorls of branches that reach out,
    sag and turn up at the tip, curtains of branchlets hanging from them, a narrow spire. The
    lowest couple of meters hold only dead twigs, so the trunk shows.
    """
    rng = random.Random(seed)
    R = width / 2
    base, normal_path = atlas(key, [spruce_spray, spruce_spray, spruce_curtain, spruce_curtain],
                              0.8, tile_px=tile_px, seed=seed, ao=0.025, thicken=0.15)
    leaves = card_material(f"{key}-needles", base, normal_path, roughness=0.8)
    bark = spruce_bark(bark_size)
    wood = Geo(bark=True)
    cards = Geo(uv=True, normals=True)

    r_base = 0.018 * height + 0.01
    tpts, tradii, _ = _trunk(wood, rng, height * 0.985, r_base, 0.008, 18, lean=0.03,
                             flare=0.55, sides=9)
    crown_lo = height * 0.15
    crown_hi = height * 0.985

    def reach(z):
        t = (crown_hi - z) / (crown_hi - crown_lo)
        t = min(1.0, max(0.0, t))
        # widest a little above the crown's foot
        return 0.92 * R * min(1.0, t * 1.08) ** 0.95 * (0.86 + 0.14 * min(1, (1 - t) * 6 + 0.3))

    def bent(p):
        c = Vector((0, 0, p.z))
        out = p - c
        out.z = 0
        lift = 0.5
        if out.length < 0.05:
            return UP.copy()
        return (out.normalized() + UP * lift).normalized()

    # Dead twigs on the bare trunk below the crown.
    for _ in range(int(14 * density)):
        z = rng.uniform(0.7, crown_lo)
        az = rng.uniform(0, 6.28)
        c, tr = _radius_at(tpts, tradii, z)
        ln = rng.uniform(0.15, 0.7)
        d = Vector((math.cos(az), math.sin(az), rng.uniform(-0.5, 0.05))).normalized()
        p0 = c + d * tr * 0.4
        pts = [p0, p0 + d * ln * 0.5 + Vector((0, 0, -0.03)), p0 + d * ln + Vector((0, 0, -0.1))]
        tube(wood, pts, [0.018, 0.01, 0.004], 3, shift=rng.uniform(0, 9), collar=0.05)

    z = crown_lo
    whorl = 0
    golden = 2.39996
    az0 = rng.uniform(0, 6.28)
    while z < crown_hi - 0.25:
        h = (z - crown_lo) / (crown_hi - crown_lo)
        count = 5 if h < 0.75 else 4
        c, tr = _radius_at(tpts, tradii, z)
        for b in range(count):
            az = az0 + whorl * golden + b * 2 * math.pi / count + rng.uniform(-0.3, 0.3)
            L = reach(z) * rng.uniform(0.82, 1.05)
            if L < 0.12:
                continue
            e0 = -0.3 + 0.95 * h ** 1.6 + rng.uniform(-0.08, 0.08)
            droop = (0.75 * (1 - h) + 0.15) * rng.uniform(0.8, 1.2)
            upturn = 0.45 * (1 - h) * rng.uniform(0.6, 1.2)
            n_pts = 5 if L > 1.0 else 4 if L > 0.5 else 3
            pts = [c + Vector((math.cos(az), math.sin(az), 0)) * tr * 0.3]
            # Each step's horizontal reach is L / segments; elevation follows the profile.
            hor = L / (n_pts - 1)
            for i in range(1, n_pts):
                s = i / (n_pts - 1)
                e = e0 - droop * s ** 1.4 + upturn * smooth((s - 0.6) / 0.4)
                az_i = az + 0.08 * math.sin(s * 3 + b)
                step = Vector((math.cos(az_i), math.sin(az_i), math.tan(e)))
                pts.append(pts[-1] + step * hor)
            rb = 0.01 + 0.035 * (L / R)
            radii = [rb * (1 - 0.85 * (i / (n_pts - 1)) ** 0.9) for i in range(n_pts)]
            sides = 4 if rb > 0.025 else 3
            tube(wood, pts, radii, sides, shift=rng.uniform(0, 9), collar=rb * 2.5)

            # Foliage along it: sprays on top, curtains hanging below.
            sc = 0.45 + 0.55 * min(1.0, L / R)
            step_f = max(0.22, 0.42 * sc / max(L, 0.3))
            f = 0.3 if L > 0.8 else 0.15
            positions = []
            while f < 1.0:
                positions.append(f)
                f += step_f * rng.uniform(0.85, 1.15)
            positions.append(1.0)
            for f in positions:
                p, T = _along(pts, min(f, 0.999))
                S = perpendicular(T)
                tip = f >= 1.0
                # Spray: lying along the branch, rocked about it.
                for k in range(2 if not tip and (density >= 0.8 or rng.random() < 0.6) else 1):
                    roll = rng.uniform(-0.45, 0.45) + (0.5 if k else 0) * rng.choice((-1, 1))
                    Ss = rotate(S, T, roll)
                    w = 0.62 * sc * rng.uniform(0.85, 1.15) * density ** 0.2
                    hh = w * rng.uniform(0.8, 1.0)
                    Tt = rotate(T, Ss, rng.uniform(-0.15, 0.25))
                    o = p - Tt * (w * (0.35 if not tip else 0.15)) - Ss * (hh / 2) + UP * 0.02
                    card(cards, o, Tt, Ss, w, hh, tile_rect(rng.randint(0, 1)), bent,
                         segs=2 if sc > 0.75 else 1, droop=0.06 * sc)
                # Curtain: hanging from the branch, below the top quarter of the tree.
                if h < 0.8 and not tip:
                    for k in range(2 if h < 0.55 else 1):
                        D = rotate(-UP, T, rng.uniform(-0.35, 0.35) + (0.3 if k else -0.3))
                        w = 0.55 * sc * rng.uniform(0.85, 1.2)
                        hh = (0.35 + 0.55 * (1 - h)) * sc * rng.uniform(0.8, 1.15)
                        top = p + UP * 0.03
                        o = top + D * hh - T * (w * 0.5)
                        card(cards, o, T, -D, w, hh, tile_rect(2 + rng.randint(0, 1)), bent,
                             segs=1)
        z += (0.5 - 0.15 * h) * rng.uniform(0.85, 1.15) / density ** 0.3
        whorl += 1

    # The spire: sprays standing up round the leader's tip.
    top_p = tpts[-1]
    for k in range(4):
        az = az0 + k * math.pi / 2 + rng.uniform(-0.3, 0.3)
        out = Vector((math.cos(az), math.sin(az), 0))
        U = (UP * 1.0 + out * 0.25).normalized()
        V = rotate(out.cross(UP).normalized(), U, rng.uniform(-0.3, 0.3))
        w = 0.55
        o = top_p - U * (w * 0.75) - V * (w * 0.35)
        card(cards, o, U, V, w, w * 0.7, tile_rect(rng.randint(0, 1)), lambda p: UP.copy())

    wood.obj("spruce-wood", bark)
    cards.obj("spruce-needles", leaves)


def birch(height, width, seed, bark_size=1024, tile_px=1024, forks=2, lean=0.08, density=1.0,
          key="birch", leaves=0.25, dead=False, twigs=1.0):
    """
    A downy birch: a trunk that forks into leaders, branches that rise, arch out and let their tips
    hang, fine red-brown twigs in sprays round the outside of the crown, a few yellow leaves left.
    `twigs` scales how many twig cards line the branches (a card every 13 to 20 cm at 1).
    """
    rng = random.Random(seed)
    R = width / 2 * 0.85
    bark = birch_bark(bark_size, dead=dead)
    wood = Geo(bark=True)
    cards = Geo(uv=True, normals=True)
    base, normal_path = atlas(key, [birch_spray, birch_spray_leaves, birch_spray_fine,
                                    birch_spray], 1.0, tile_px=tile_px, seed=seed, ao=0.02,
                              thicken=0.35)
    twig_mat = card_material(f"{key}-twigs", base, normal_path, roughness=0.75)

    lean_dir = Vector((math.cos(seed), math.sin(seed), 0))
    fork_h = height * rng.uniform(0.36, 0.46)
    r_base = 0.011 * height + 0.02
    axis = (UP + lean_dir * lean).normalized()
    tpts, tradii, _ = _trunk(wood, rng, fork_h + 0.4, r_base, r_base * 0.72, 10, lean=0.05,
                             flare=0.35, sides=10, axis=axis)
    crown_c = Vector((lean_dir.x * lean * height * 0.5, lean_dir.y * lean * height * 0.5,
                      (height + fork_h * 0.55) / 2))
    crown_r = Vector((R, R, (height - fork_h * 0.55) / 2))

    def bent(p):
        d = p - crown_c
        d = Vector((d.x / crown_r.x ** 2, d.y / crown_r.y ** 2, d.z / crown_r.z ** 2))
        if d.length < 1e-4:
            return UP.copy()
        return (d.normalized() + UP * 0.35).normalized()

    def inside(p):
        d = p - crown_c
        return (d.x / crown_r.x) ** 2 + (d.y / crown_r.y) ** 2 + (d.z / crown_r.z) ** 2

    # Leaders from the fork, leaning apart and bending back up.
    leaders = []
    top = tpts[-1]
    for k in range(forks):
        az = rng.uniform(0, 6.28) if k == 0 else leaders[0][1] + 2 * math.pi * k / forks
        tilt = rng.uniform(0.22, 0.4)
        ln = (height - top.z) * rng.uniform(0.92, 1.0) / math.cos(tilt * 0.5)
        pts = [tpts[-2].lerp(top, 0.5)]
        n = 8
        for i in range(1, n + 1):
            s = i / n
            t = tilt * (1 - 0.7 * s)
            d = Vector((math.cos(az) * math.sin(t), math.sin(az) * math.sin(t), math.cos(t)))
            pts.append(pts[-1] + d * (ln / n) + Vector((rng.gauss(0, 0.04), rng.gauss(0, 0.04),
                                                        0)))
        rl = tradii[-1] * rng.uniform(0.62, 0.78)
        radii = [rl * (1 - 0.92 * (i / n) ** 0.85) for i in range(n + 1)]
        tube(wood, pts, radii, 8, shift=rng.uniform(0, 9), collar=0.0)
        leaders.append((pts, az, radii))

    def branch(start, d, length, radius, level, shift):
        """Grows a branch, its side branches and its twig cards."""
        n = 5 if level == 1 else 3
        pts = [start]
        dd = d.copy()
        droop = (0.55 if level == 1 else 0.9) * rng.uniform(0.7, 1.3)
        for i in range(1, n + 1):
            s = i / n
            dd = (dd - UP * (droop * s / n * 1.6) + Vector((rng.gauss(0, 0.08),
                                                            rng.gauss(0, 0.08), 0))).normalized()
            pts.append(pts[-1] + dd * (length / n))
        radii = [radius * (1 - 0.8 * (i / n) ** 0.9) for i in range(n + 1)]
        sides = 6 if radius > 0.04 else 4 if radius > 0.015 else 3
        tube(wood, pts, radii, sides, shift=shift, collar=radius * 3)
        if level == 1:
            m = max(3, int(length / 0.2 * density))
            for j in range(m):
                f = 0.25 + 0.7 * (j + rng.random() * 0.5) / m
                p, T = _along(pts, f)
                side = rotate(perpendicular(T), T, rng.uniform(0, 6.28))
                cd = (T * math.cos(0.7) + side * math.sin(0.7)).normalized()
                cd = (cd + UP * 0.15).normalized()
                ln = length * (1 - f) * rng.uniform(0.35, 0.55) + 0.2
                if inside(p + cd * ln) > 1.15:
                    ln *= 0.6
                branch(p, cd, ln, max(0.006, radius * 0.4), 2, rng.uniform(0, 9))
        # Twig sprays: a fine haze of small cards all along the outer part of every branch,
        # drooping, and a tassel of them hanging from its tip, so the crown builds up as one
        # soft mass of thin hanging twigs rather than clumps on sticks.
        def tile():
            if rng.random() < leaves:
                return 1
            return 2 if rng.random() < 0.55 else rng.choice((0, 3))

        step = (0.13 if level == 2 else 0.2) / twigs
        s = length * (0.25 if level == 2 else 0.4) + rng.uniform(0, step)
        while s < length * 0.97:
            f = s / length
            p, T = _along(pts, f)
            U = (T + Vector((rng.gauss(0, 0.35), rng.gauss(0, 0.35), rng.gauss(0, 0.2)))
                 ).normalized()
            U = (U - UP * rng.uniform(0.3, 0.9)).normalized()
            V = rotate(perpendicular(U), U, rng.uniform(0, math.pi))
            w = rng.uniform(0.34, 0.55) * (1.1 - 0.25 * f)
            hh = w * rng.uniform(0.7, 1.0)
            o = p - U * (w * 0.06) - V * (hh / 2)
            card(cards, o, U, V, w, hh, tile_rect(tile()), bent, segs=1)
            s += step * rng.uniform(0.7, 1.3)
        p, T = _along(pts, 0.999)
        for _ in range(rng.randint(2, 3) if level == 2 else 2):
            U = (T * rng.uniform(0.2, 0.6) - UP + Vector((rng.gauss(0, 0.3), rng.gauss(0, 0.3),
                                                          0))).normalized()
            V = rotate(perpendicular(U), U, rng.uniform(0, math.pi))
            w = rng.uniform(0.32, 0.5)
            hh = w * rng.uniform(0.6, 0.85)
            o = p - U * (w * 0.05) - V * (hh / 2)
            card(cards, o, U, V, w, hh, tile_rect(tile()), bent, segs=2,
                 droop=rng.uniform(0.03, 0.1))

    # Main branches off the upper trunk and the leaders.
    sources = [(tpts, tradii, 0.55)] + [(lp, lr, 0.12) for lp, _, lr in leaders]
    golden = 2.39996
    k = 0
    for pts, radii, f0 in sources:
        total = len(pts)
        f = f0
        while f < 0.93:
            p, T = _along(pts, f)
            _, rr = _radius_at(pts, radii, p.z) if pts is tpts else (None, radii[0] * (1 - f))
            az = k * golden + rng.uniform(-0.3, 0.3)
            out = Vector((math.cos(az), math.sin(az), 0))
            # Point away from the crown's axis where we can.
            away = Vector((p.x - crown_c.x, p.y - crown_c.y, 0))
            if away.length > 0.1:
                out = (out + away.normalized() * 1.2).normalized()
            e = math.radians(rng.uniform(35, 60)) * (1 - 0.3 * f)
            d = (out * math.cos(e) + UP * math.sin(e)).normalized()
            zr = (p.z - crown_c.z) / crown_r.z
            room = R * math.sqrt(max(0.05, 1 - min(0.95, zr * zr)))
            ln = room * rng.uniform(0.5, 0.72) + 0.2
            rad = max(0.012, min(rr * 0.55, 0.012 + 0.03 * ln / R))
            branch(p + d * rr * 0.2, d, ln, rad, 1, rng.uniform(0, 9))
            f += rng.uniform(0.09, 0.16) / density ** 0.5 * (1.0 if pts is tpts else 1.3)
            k += 1
        _ = total

    wood.obj("birch-wood", bark)
    cards.obj("birch-twigs", twig_mat)


def fungus_material(size=256):
    """Tinder fungus: grey-brown hoof brackets in growth bands, a pale rim and a pale underside."""
    mat, n = lib.procedural("fungus", size)
    z = n.xyz()[2]
    bands = n.math("SINE", n.math("MULTIPLY", z, 140))
    color = n.mix(lib.smoothstep(n, bands, -0.2, 0.6), srgb("#3a332c"), srgb("#5e564c"))
    color = lib.shade(n, color, n.math("ADD", 0.75, n.math("MULTIPLY", n.noise(40, detail=4), 0.5)))
    down = n.math("MULTIPLY", lib.facing_up(n), -1)
    color = n.mix(lib.smoothstep(n, down, 0.4, 0.7), color, srgb("#8a7a60", 0.8))
    h = n.math("ADD", n.math("MULTIPLY", bands, 0.3), n.math("MULTIPLY", n.noise(60, detail=3), 0.3))
    n.out(**{"Base Color": color, "Roughness": 0.85, "Normal": n.bump(h, distance=0.003)})
    return mat


def bracket(p, out, size, mat):
    """A hoof-shaped bracket fungus on a trunk at p, growing towards unit `out`."""
    side = out.cross(UP).normalized()
    hx, hy, hz = size * 0.9, size, size * 0.7

    def deform(q):
        x = (q.x * 0.5 + 0.5) * hx  # all of it out from the trunk
        y = q.y * hy * (0.6 + 0.4 * (1 - abs(q.x)))
        z = q.z * hz if q.z > 0 else q.z * hz * 0.3
        ridge = 1 + 0.06 * math.sin(z * 90)
        return out * (x * ridge - size * 0.25) + side * (y * ridge) + UP * z
    return lib.ellipsoid("bracket", (1, 1, 1), at=p, mat=mat, segments=12, rings=8, poles="x",
                         deform=deform)


def dead_birch(height, width, seed, bark_size=1024, tile_px=512, key="birch-dead"):
    """
    A dead downy birch: the trunk snapped off in splinters, the bark greyed, peeling and rotting
    to brown, a few broken branches with the odd bare twig, hoof fungus up the trunk.
    """
    rng = random.Random(seed)
    R = width / 2
    bark = birch_bark(bark_size, dead=True)
    fungus = fungus_material()
    wood = Geo(bark=True)
    cards = Geo(uv=True, normals=True)
    base, normal_path = atlas(key, [birch_spray, birch_spray], 1.0, cols=2, rows=1,
                              tile_px=tile_px, seed=seed, thicken=0.35)
    twig_mat = card_material(f"{key}-twigs", base, normal_path, roughness=0.8)

    break_h = height * 0.9
    r_base = 0.011 * 11 + 0.03
    lean = Vector((math.cos(seed), math.sin(seed), 0))
    axis = (UP + lean * 0.05).normalized()
    # The trunk, open at the top.
    pts, radii = [], []
    rings_n = 14
    for i in range(rings_n + 1):
        f = i / rings_n
        h = f * break_h
        pts.append(axis * h + Vector((0.05 * math.sin(h * 0.8 + seed), 0.04 * math.cos(h * 0.6), 0)))
        radii.append((r_base * (1 - 0.3 * f)) * (1 + 0.35 * math.exp(-h / 0.35)))
    sides = 10
    rings = tube(wood, pts, radii, sides, tip=False)
    # The break: splinters standing up from the rim, a rotten hollow inside.
    top = rings[-1]
    centre = pts[-1]
    spikes = []
    peaks = [rng.randrange(sides) for _ in range(3)]
    for k, v in enumerate(top):
        rise = rng.uniform(0.0, 0.08)
        for pk, tall in zip(peaks, (height * 0.1, 0.35, 0.22)):
            d = abs(((k - pk + sides / 2) % sides) - sides / 2)
            if d == 0:
                rise = max(rise, tall)
            elif d == 1:
                rise = max(rise, tall * rng.uniform(0.25, 0.5))
        inward = (centre - v.co) * (0.05 + 0.25 * min(1.0, rise / 0.4))
        spikes.append(wood.vert(v.co + axis * rise + inward,
                                (0, 0, break_h + rise), radii[-1] * 0.6, 0.0))
    for k in range(sides):
        wood.face((top[k], top[(k + 1) % sides], spikes[(k + 1) % sides], spikes[k]))
    hollow = wood.vert(centre - axis * 0.15, (0, 0, break_h - 0.3), 0.0, 1.0)
    for k in range(sides):
        wood.face((spikes[k], spikes[(k + 1) % sides], hollow))

    # Broken branches, a few still carrying twigs.
    for j in range(rng.randint(5, 7)):
        f = rng.uniform(0.35, 0.88)
        p, _ = _along(pts, f)
        _, rr = _radius_at(pts, radii, p.z)
        az = j * 2.39996 + rng.uniform(-0.4, 0.4)
        out = Vector((math.cos(az), math.sin(az), 0))
        e = math.radians(rng.uniform(15, 50))
        d = (out * math.cos(e) + UP * math.sin(e)).normalized()
        ln = R * rng.uniform(0.5, 1.05) * (1.15 - f * 0.4)
        n = 4
        bp = [p + d * rr * 0.3]
        dd = d.copy()
        for i in range(1, n + 1):
            dd = (dd - UP * 0.12 + Vector((rng.gauss(0, 0.1), rng.gauss(0, 0.1), 0))).normalized()
            bp.append(bp[-1] + dd * (ln / n))
        rad = max(0.015, rr * 0.35)
        tube(wood, bp, [rad * (1 - 0.6 * i / n) for i in range(n + 1)], 5,
             shift=rng.uniform(0, 9), collar=rad * 3, tip=True)
        if rng.random() < 0.6:
            for _ in range(rng.randint(1, 3)):
                q, T = _along(bp, rng.uniform(0.5, 1.0))
                U = (T + Vector((rng.gauss(0, 0.3), rng.gauss(0, 0.3), rng.gauss(0, 0.2)))
                     ).normalized()
                V = rotate(perpendicular(U), U, rng.uniform(0, 3.14))
                w = rng.uniform(0.4, 0.7)
                card(cards, q - V * (w * 0.4), U, V, w, w * 0.8,
                     tile_rect(rng.randint(0, 1), cols=2, rows=1),
                     lambda p: (UP * 0.6 + Vector((p.x, p.y, 0)).normalized()).normalized(),
                     droop=0.05)
    # Hoof fungus, mostly on one side, in a loose column.
    face = rng.uniform(0, 6.28)
    for j in range(5):
        h = rng.uniform(0.9, break_h * 0.8)
        c, rr = _radius_at(pts, radii, h)
        az = face + rng.gauss(0, 0.6)
        out = Vector((math.cos(az), math.sin(az), 0))
        bracket(c + out * rr * 0.85, out, rng.uniform(0.12, 0.2), fungus)

    wood.obj("birch-dead-wood", bark)
    cards.obj("birch-dead-twigs", twig_mat)


# ---------------------------------------------------------------------------------------------
# Rocks


def _fib(i, n, jitter, rng):
    """The i-th of n directions spread over a sphere, jittered."""
    y = 1 - 2 * (i + 0.5) / n
    r = math.sqrt(max(0, 1 - y * y))
    a = i * 2.39996
    d = Vector((r * math.cos(a), r * math.sin(a), y))
    d += Vector((rng.gauss(0, jitter), rng.gauss(0, jitter), rng.gauss(0, jitter)))
    return d.normalized()


def rock(name, size, seed, mat, tris=1500, planes=10, rounding=0.3, fractures=3, sink=0.12,
         at=(0, 0, 0), tilt=(0.0, 0.0), turn=0.0, res=6, warp=0.07, flat=1.0):
    """
    A glacial boulder `size` = (x, y, z) meters across: a polyhedron of `planes` faces with its
    edges rounded off by `rounding` (ice-worn), then cut by `fractures` planes left sharp (fresh
    breaks), warped by low noise, its foot flattened `sink` of its height into the ground and the
    mesh decimated to about `tris` triangles. `flat` < 1 squashes the planes towards horizontal
    (slabby, for ledges). `tilt` = (about x, about y) radians, `turn` about z, then moved to `at`.
    """
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=res, radius=1.0)
    soft = []
    for i in range(planes):
        nrm = _fib(i, planes, 0.25, rng)
        nrm = Vector((nrm.x, nrm.y, nrm.z / max(flat, 0.2))).normalized()
        soft.append((nrm, rng.uniform(0.78, 1.0)))
    hard = []
    for i in range(fractures):
        az = rng.uniform(0, 6.28)
        el = rng.uniform(-0.1, 0.9)
        nrm = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        hard.append((nrm, rng.uniform(0.62, 0.8), rng.uniform(0, 100)))
    # Joints: shallow grooves where the rock is cracking along planes, a few centimetres deep.
    joints = []
    for i in range(3):
        az = rng.uniform(0, 6.28)
        el = rng.uniform(-0.6, 0.6)
        joints.append((Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el),
                               math.sin(el))), rng.uniform(-0.5, 0.5)))
    k = max(0.02, rounding * 0.25)
    off = Vector((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    for v in bm.verts:
        d = v.co.normalized()
        ts = [h / max(d.dot(nn), 0.04) for nn, h in soft]
        m = min(ts)
        t = m - k * math.log(sum(math.exp(-(x - m) / k) for x in ts))
        t = 0.8 * t + 0.2 * min(t, 1.0)
        for nn, h, ph in hard:
            dn = d.dot(nn)
            if dn > 0.04:
                # a fracture face: flat, broken in steps where it spalled off in layers
                step = 0.02 * noise.noise(d * 2.5 + Vector((ph, 0, 0)))
                terr = noise.noise(d * 1.7 + Vector((0, ph, 0)))
                step += 0.035 * math.floor(terr * 2.5) / 2.5
                th = (h + step) / dn
                kk = 0.025  # sharp, but not knife-edged
                mm = min(t, th)
                t = mm - kk * math.log(math.exp(-(t - mm) / kk) + math.exp(-(th - mm) / kk))
        t *= 1 + warp * noise.noise(d * 1.4 + off) + warp * 0.35 * noise.noise(d * 3.7 + off)
        # weathered relief: knobs and runnels a few centimetres deep, grooves along the joints
        t *= 1 + 0.03 * noise.noise(d * 9 + off) - 0.02 * abs(noise.noise(d * 17 + off))
        t *= 1 + 0.012 * noise.noise(d * 31 + off)
        for jn, jo in joints:
            g = abs(d.dot(jn) - jo + 0.03 * noise.noise(d * 6 + off))
            t *= 1 - 0.035 * max(0.0, 1 - g / 0.035)
        v.co = d * t
    lo = Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
    hi = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
    cut = lo.z + (hi.z - lo.z) * sink
    for v in bm.verts:
        if v.co.z < cut:
            v.co.z = cut - (cut - v.co.z) * 0.08
    lo.z = min(v.co.z for v in bm.verts)
    span = hi - lo
    centre = (hi + lo) / 2
    sx, sy, sz = size
    for v in bm.verts:
        c = v.co - centre
        v.co = Vector((c.x / span.x * sx, c.y / span.y * sy, (v.co.z - lo.z) / span.z * sz))
    rot = (Matrix.Rotation(turn, 4, "Z") @ Matrix.Rotation(tilt[1], 4, "Y")
           @ Matrix.Rotation(tilt[0], 4, "X"))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(at)) @ rot, verts=bm.verts)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    if mat is not None:
        o.data.materials.append(mat)
    have = len(o.data.polygons)
    if tris and have > tris:
        dec = o.modifiers.new("decimate", "DECIMATE")
        dec.ratio = tris / have
        dec.use_collapse_triangulate = True
    return o


def rock_material(size=1024, moss=1.0, lichen=1.0, name="granite", scale=1.0, turf=0.0):
    """
    Grey gneiss and granite: speckled grain, faint banding, dark wet streaks down the flanks; thick
    moss on the tops and in the hollows (by the normal and the occlusion), lichen on the flanks in
    grey-green and yellow rosettes. `turf` > 0 turns the ground below that height (meters) into
    dead grass and moss, for rock breaking through turf.
    """
    mat, n = lib.procedural(name, size)
    s = scale
    co = n.coord()
    z = n.xyz()[2]
    up = lib.facing_up(n)
    macro = n.noise(0.7 / s, detail=3)
    mottle = lib.smoothstep(n, n.noise(2.2 / s, detail=5, roughness=0.6), 0.35, 0.7)
    color = lib.shade(n, srgb("#6f6d68", 0.42), n.math("ADD", 0.55, n.math("ADD", n.math("MULTIPLY", macro, 0.45), n.math("MULTIPLY", mottle, 0.35))))
    color = n.mix(n.math("MULTIPLY", lib.smoothstep(n, macro, 0.55, 0.75), 0.5), color, srgb("#5e5548", 0.6))
    # Gneiss banding, tilted.
    tilt = n.add("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    n.set(tilt.inputs[0], co)
    tilt.inputs[1].default_value = (0.25, 0.15, 1.0)
    band = n.noise(1.0, detail=4, vector=n.vec(n.math("MULTIPLY", tilt.outputs["Value"], 9 / s),
                                                n.math("MULTIPLY", n.xyz()[0], 0.6 / s), 0))
    color = lib.shade(n, color, n.math("ADD", 0.86, n.math("MULTIPLY", band, 0.28)))
    # Grain: dark mica and pale feldspar specks.
    grain = n.noise(260, detail=2)
    color = n.mix(lib.smoothstep(n, grain, 0.62, 0.68), color, srgb("#2b2927"))
    color = n.mix(lib.smoothstep(n, grain, 0.36, 0.3), color, srgb("#a19c92", 0.85))
    # Wet streaks running down the flanks.
    streak = lib.smoothstep(n, n.noise(1.0, detail=3, vector=lib._stretched(n, 7 / s, 7 / s,
                                                                         0.9 / s)), 0.5, 0.75)
    flank = lib.smoothstep(n, up, 0.7, 0.2)
    wet = n.math("MULTIPLY", streak, flank)
    color = lib.shade(n, color, n.math("SUBTRACT", 1, n.math("MULTIPLY", wet, 0.4)))
    hollow = lib.crevices(n, 0.35 * s)
    color = lib.shade(n, color, n.math("SUBTRACT", 1, n.math("MULTIPLY", hollow, 0.5)))
    # Lichen on the flanks: grey-green crusts, yellow rosettes, black dots.
    blot = n.noise(7 / s, detail=6, roughness=0.62)
    colony = lib.smoothstep(n, n.noise(1.3 / s, detail=3), 0.5, 0.62)
    lich = n.math("MULTIPLY", lib.smoothstep(n, blot, 0.56, 0.6),
                  lib.smoothstep(n, up, -0.4, 0.1))
    lich = n.math("MULTIPLY", n.math("MULTIPLY", lich, colony), lichen)
    rosette = n.add("ShaderNodeTexVoronoi", {"Vector": co, "Scale": 9 / s, "Randomness": 1.0}).outputs["Distance"]
    yellow = n.math("MULTIPLY", lib.smoothstep(n, n.math("ADD", rosette, n.math("MULTIPLY", n.noise(30 / s, detail=4), 0.25)), 0.32, 0.26),
                    n.math("MULTIPLY", lib.smoothstep(n, n.noise(1.7 / s, detail=2), 0.55, 0.65), lichen))
    yellow = n.math("MULTIPLY", yellow, lib.smoothstep(n, up, -0.3, 0.2))
    color = n.mix(n.math("MULTIPLY", lich, 0.85), color, lib.shade(n, srgb("#8d9182", 0.6),
                                         n.math("ADD", 0.8, n.math("MULTIPLY", grain, 0.4))))
    color = n.mix(n.math("MULTIPLY", yellow, 0.45), color, srgb("#958a5e", 0.5))
    dots = lib.smoothstep(n, n.noise(40 / s, detail=3), 0.7, 0.74)
    color = n.mix(n.math("MULTIPLY", dots, 0.7), color, srgb("#22221e"))
    # Moss: on top and in hollows, its edge broken up.
    edge = n.noise(3 / s, detail=6, roughness=0.6)
    speck = n.noise(70 / s, detail=4, roughness=0.6)
    m = n.math("ADD", up, n.math("MULTIPLY", n.math("SUBTRACT", edge, 0.5), 1.1))
    m = n.math("ADD", m, n.math("MULTIPLY", hollow, 1.3))
    m = n.math("ADD", m, n.math("MULTIPLY", n.math("SUBTRACT", n.noise(0.8 / s, detail=3), 0.5), 0.6))
    # The edge frays into islands and specks rather than stopping on a line.
    m = n.math("ADD", m, n.math("MULTIPLY", n.math("SUBTRACT", speck, 0.5), 0.5))
    mask = n.math("MULTIPLY", lib.smoothstep(n, m, 0.66, 0.74), moss)
    clump = n.noise(45 / s, detail=5, roughness=0.6)
    moss_col = n.mix(clump, srgb("#1c2111"), srgb("#3d4528", 0.85))
    moss_col = n.mix(lib.smoothstep(n, n.noise(2.2 / s, detail=3), 0.55, 0.75), moss_col,
                     srgb("#4f4d2e"))
    moss_col = lib.shade(n, moss_col, n.math("ADD", 0.7, n.math("MULTIPLY", speck, 0.6)))
    # thin moss creeping out before the thick
    thin = n.math("MULTIPLY", lib.smoothstep(n, m, 0.4, 0.66), moss)
    color = n.mix(n.math("MULTIPLY", thin, 0.45), color, srgb("#2f3322"))
    color = n.mix(mask, color, moss_col)
    rough = n.lerp(wet, 0.82, 0.5)
    rough = n.lerp(lich, rough, 0.9)
    rough = n.lerp(mask, rough, 0.95)
    pits = lib.smoothstep(n, n.noise(28 / s, detail=4, roughness=0.65), 0.58, 0.7)
    pv = n.add("ShaderNodeTexVoronoi", {"Vector": co, "Scale": 60 / s, "Randomness": 1.0}).outputs["Distance"]
    pocks = n.math("MULTIPLY", lib.smoothstep(n, pv, 0.25, 0.06),
                   lib.smoothstep(n, n.noise(6 / s, detail=3), 0.45, 0.62))
    crack = lib.smoothstep(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(2.5 / s, detail=4), 0.5)), 0.006, 0.0)
    crack = n.math("MULTIPLY", crack, lib.smoothstep(n, n.noise(1.5 / s, detail=2), 0.4, 0.6))
    h = n.math("ADD", n.math("MULTIPLY", grain, 0.25), n.math("MULTIPLY", n.noise(9 / s, detail=6, roughness=0.65),
                                                              0.6))
    h = n.math("ADD", h, n.math("MULTIPLY", n.noise(2.5 / s, detail=5, roughness=0.6), 0.8))
    h = n.math("SUBTRACT", h, n.math("MULTIPLY", pits, 0.3))
    h = n.math("SUBTRACT", h, n.math("MULTIPLY", pocks, 0.35))
    h = n.math("SUBTRACT", h, n.math("MULTIPLY", crack, 0.8))
    color = lib.shade(n, color, n.math("SUBTRACT", 1, n.math("MULTIPLY", pits, 0.3)))
    color = lib.shade(n, color, n.math("SUBTRACT", 1, n.math("MULTIPLY", pocks, 0.5)))
    color = n.mix(n.math("MULTIPLY", crack, 0.45), color, srgb("#1c1c1a"))
    # The foot: earth splashed up, and a dark wet line where the rock meets the ground.
    foot = lib.smoothstep(n, n.math("ADD", z, n.math("MULTIPLY", n.math("SUBTRACT", edge, 0.5), 0.15)), 0.3, 0.0)
    color = n.mix(n.math("MULTIPLY", foot, 0.7), color, srgb("#2a241c"))
    wetline = lib.smoothstep(n, z, 0.1, 0.0)
    color = lib.shade(n, color, n.math("SUBTRACT", 1, n.math("MULTIPLY", wetline, 0.6)))
    rough = n.lerp(wetline, rough, 0.55)
    h = n.math("ADD", h, n.math("MULTIPLY", lich, 0.15))
    h = n.math("ADD", h, n.math("MULTIPLY", mask, n.math("ADD", 0.9, n.math("ADD", n.math("MULTIPLY", clump, 0.9),
                                                                              n.math("MULTIPLY", speck, 0.6)))))
    if turf:
        # Turf: dead grass over moss low down, where the ground runs up to the rock.
        low = lib.smoothstep(n, n.math("ADD", n.math("SUBTRACT", turf, z),
                                       n.math("MULTIPLY", n.math("SUBTRACT", edge, 0.5), 0.6)),
                             0.0, 0.12)
        low = n.math("MULTIPLY", low, lib.smoothstep(n, up, 0.1, 0.5))
        blades = n.noise(1.0, detail=3, vector=lib._stretched(n, 90, 90, 6))
        grass = n.mix(blades, srgb("#2e2a1d"), srgb("#5e5640"))
        grass = n.mix(lib.smoothstep(n, n.noise(4, detail=3), 0.5, 0.7), grass, srgb("#353a25"))
        color = n.mix(low, color, grass)
        rough = n.lerp(low, rough, 0.95)
        h = n.math("ADD", h, n.math("MULTIPLY", low, n.math("MULTIPLY", blades, 1.2)))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(h, distance=0.014)})
    return mat


def outcrop(size, seed, tris=4000, tex=2048):
    """
    Bedrock breaking through turf: a slabby main mass with fracture faces, ledges stepping down
    from it, and a turf mound round the foot that the ground runs up onto.
    """
    rng = random.Random(seed)
    sx, sy, sz = size
    mat = rock_material(tex, name="bedrock", turf=0.42, scale=1.4)
    rock("outcrop-main", (sx * 0.8, sy * 0.74, sz), seed, mat, tris=int(tris * 0.4), planes=12,
         rounding=0.3, fractures=3, sink=0.05, flat=0.4, at=(sx * 0.04, sy * 0.03, 0),
         tilt=(0.06, -0.08), warp=0.09)
    # Ledges stepping down from the main mass: the same bedrock, so bedded the same way (turned
    # little from it) and sunk well into it, not slabs leaning on it.
    ledges = [
        ((sx * 0.5, sy * 0.48, sz * 0.5), (sx * 0.16, -sy * 0.09, 0), (0.06, -0.08)),
        ((sx * 0.46, sy * 0.44, sz * 0.66), (-sx * 0.15, sy * 0.07, 0), (0.06, -0.08)),
        ((sx * 0.42, sy * 0.36, sz * 0.32), (-sx * 0.04, -sy * 0.17, 0), (0.06, -0.08)),
    ]
    for i, (sz3, at, tilt) in enumerate(ledges):
        rock(f"outcrop-ledge{i}", sz3, seed + 7 * (i + 1), mat, tris=int(tris * 0.13), planes=9,
             rounding=0.22, fractures=2, sink=0.1, flat=0.4, at=at, tilt=tilt,
             turn=rng.uniform(-0.3, 0.3))
    # The turf mound: low and wide, under everything, its edge running out into the ground with
    # no lip.
    o = rock("outcrop-turf", (sx, sy, sz * 0.2), seed + 99, mat, tris=int(tris * 0.18), planes=14,
             rounding=1.2, fractures=0, sink=0.0, warp=0.2, res=5)
    for v in o.data.vertices:
        r = min(1.0, math.hypot(v.co.x / (sx / 2), v.co.y / (sy / 2)))
        v.co.z *= smooth((1.0 - r) / 0.45) * 0.85


def log_material(size=1024, axis="y", moss=1.0):
    """
    Dead spruce wood: plated bark where it holds (the "collar" attribute is 0), silver-grey
    weathered wood with splits along the grain where it has sloughed off (1), dark end grain at
    the broken ends, moss on top and lichen on the flanks.
    """
    mat, n = lib.procedural("deadwood", size)
    bark = _attr(n, "bark").outputs["Vector"]
    slough = _attr(n, "collar").outputs["Fac"]
    up = lib.facing_up(n)
    geo_n = n.add("ShaderNodeNewGeometry").outputs["Normal"]
    ax = {"x": 0, "y": 1, "z": 2}[axis]
    along = n.math("ABSOLUTE", n.xyz(geo_n)[ax])
    # Spruce bark: small thin scales, a centimetre or two, taller than wide, lifting at their
    # edges; not cobbles. The cells are pushed about by noise so they don't read as a net.
    wq = n.add("ShaderNodeTexNoise", {"Vector": _scale(n, bark, (40, 40, 20)), "Scale": 1.0,
                                      "Detail": 3}).outputs["Color"]
    sc = _scale(n, bark, (120, 120, 50))
    sc = n.add("ShaderNodeVectorMath", {"Vector": sc}, operation="ADD")
    n.set(sc.inputs[1], wq)
    sc = sc.outputs["Vector"]
    vor = n.add("ShaderNodeTexVoronoi", {"Vector": sc, "Scale": 1.0, "Randomness": 1.0})
    edge = n.add("ShaderNodeTexVoronoi", {"Vector": sc, "Scale": 1.0, "Randomness": 1.0},
                 feature="DISTANCE_TO_EDGE").outputs["Distance"]
    cell = n.xyz(vor.outputs["Color"])[0]
    cell2 = n.xyz(vor.outputs["Color"])[1]
    plate = lib.smoothstep(n, edge, 0.0, 0.12)
    bark_col = lib.shade(n, srgb("#3a312a"), n.math("ADD", 0.65, n.math("MULTIPLY", cell, 0.55)))
    bark_col = n.mix(n.math("MULTIPLY", lib.smoothstep(n, cell2, 0.75, 0.9), 0.6), bark_col,
                     srgb("#4f4a42"))  # greyed, weathered scales
    bark_col = n.mix(n.math("MULTIPLY", n.math("SUBTRACT", 1, plate), 0.3), bark_col, srgb("#1e1813"))
    bark_col = lib.shade(n, bark_col, n.math("ADD", 0.75, n.math("MULTIPLY", n.noise(6, detail=4), 0.5)))
    # Bare wood: silvered, split along the grain.
    grain_v = _scale(n, bark, (60, 60, 1.5))
    grain = n.noise(1.0, detail=5, vector=grain_v)
    split = lib.smoothstep(n, n.noise(1.0, detail=3, vector=_scale(n, bark, (26, 26, 0.8))),
                           0.62, 0.66)
    wood = lib.shade(n, srgb("#7a7264", 0.42), n.math("ADD", 0.7, n.math("MULTIPLY", grain, 0.6)))
    wood = n.mix(split, wood, srgb("#1c1712"))
    edge_s = lib.smoothstep(n, slough, 0.35, 0.6)
    color = n.mix(edge_s, bark_col, wood)
    # End grain: rings, dark and rotten.
    x, y, z = n.xyz()
    others = [c for i, c in enumerate((x, y, z)) if i != ax]
    rad = n.math("SQRT", n.math("ADD", n.math("MULTIPLY", others[0], others[0]),
                                n.math("MULTIPLY", others[1], others[1])))
    # Fine growth rings of uneven width (not a target), radial checks, the heart rotted dark.
    rw = n.math("ADD", rad, n.math("MULTIPLY", n.noise(6, detail=3), 0.012))
    rw = n.math("ADD", rw, n.math("MULTIPLY", n.noise(0.9, detail=2), 0.03))
    rings = n.math("SINE", n.math("MULTIPLY", rw, 900))
    rings = n.math("MULTIPLY", rings, lib.smoothstep(n, n.noise(3, detail=3), 0.3, 0.7))
    end = n.math("MULTIPLY", lib.smoothstep(n, along, 0.8, 0.93), lib.smoothstep(n, _attr(n, "collar").outputs["Fac"], 0.9, 1.0))
    ang = n.math("ARCTAN2", others[1], others[0])
    radial = lib.smoothstep(n, n.math("ABSOLUTE", n.math("SUBTRACT", n.noise(
        1.0, detail=2, vector=n.vec(n.math("MULTIPLY", ang, 3.0), n.math("MULTIPLY", rad, 2.0), 0.0)), 0.5)), 0.02, 0.0)
    end_col = n.mix(n.math("MULTIPLY", lib.smoothstep(n, rings, -0.2, 0.8), 0.18), srgb("#3a2e22"), srgb("#4a3c2c"))
    end_col = lib.shade(n, end_col, n.math("ADD", 0.7, n.math("MULTIPLY", n.noise(4, detail=4), 0.5)))
    end_col = n.mix(n.math("MULTIPLY", lib.smoothstep(n, rad, 0.12, 0.02), 0.7), end_col, srgb("#1d1610"))
    end_col = n.mix(n.math("MULTIPLY", radial, 0.8), end_col, srgb("#0e0b08"))
    color = n.mix(end, color, end_col)
    # Lichen, then moss on top.
    lich = n.math("MULTIPLY", lib.smoothstep(n, n.noise(9, detail=6, roughness=0.6), 0.6, 0.64),
                  lib.smoothstep(n, up, -0.5, 0.2))
    color = n.mix(n.math("MULTIPLY", lich, 0.8), color, srgb("#8e957a", 0.6))
    hollow = lib.crevices(n, 0.12)
    m = n.math("ADD", up, n.math("MULTIPLY", n.math("SUBTRACT", n.noise(4, detail=6,
                                                                       roughness=0.6), 0.5), 1.0))
    m = n.math("ADD", m, n.math("MULTIPLY", hollow, 0.6))
    mask = n.math("MULTIPLY", lib.smoothstep(n, m, 0.55, 0.7), moss)
    clump = n.noise(60, detail=5, roughness=0.6)
    moss_col = n.mix(clump, srgb("#1c2111"), srgb("#3d4528", 0.85))
    thin = n.math("MULTIPLY", lib.smoothstep(n, m, 0.38, 0.55), moss)
    color = n.mix(n.math("MULTIPLY", thin, 0.45), color, srgb("#2f3322"))
    color = n.mix(mask, color, moss_col)
    color = lib.shade(n, color, n.math("SUBTRACT", 1, n.math("MULTIPLY", hollow, 0.6)))
    rough = n.lerp(mask, 0.85, 0.95)
    h = n.lerp(edge_s, n.math("ADD", n.math("MULTIPLY", plate, 0.45),
                              n.math("MULTIPLY", cell, 0.3)),
               n.math("SUBTRACT", n.math("MULTIPLY", grain, 0.3), n.math("MULTIPLY", split, 0.6)))
    h = n.math("ADD", h, n.math("MULTIPLY", mask, n.math("ADD", 0.5, n.math("MULTIPLY", clump,
                                                                            0.8))))
    h = n.math("ADD", h, n.math("MULTIPLY", end, n.math("SUBTRACT", n.math("MULTIPLY", rings, 0.08),
                                                         n.math("MULTIPLY", radial, 0.8))))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(h, distance=0.008)})
    return mat


def _slough(geo, rings, pts, seed, depth=0.015, amount=0.0):
    """Strips bark in patches: marks the "collar" layer 1 there and sinks the surface `depth`."""
    off = Vector((seed * 3.1, seed * 1.7, seed * 0.9))
    for ring, c in zip(rings, pts):
        for v in ring:
            m = noise.noise(v.co * 2.2 + off) + 0.5 * noise.noise(v.co * 6 + off) + amount
            k = smooth((m + 0.05) / 0.25)
            v[geo.collar] = k
            d = v.co - Vector(c)
            if d.length > 1e-5:
                v.co -= d.normalized() * depth * k


def _broken_end(geo, ring, centre, axis, seed, height=0.25, hollow=0.08):
    """Closes a ring with splinters standing out along `axis` and a rotten hollow inside."""
    rng = random.Random(seed)
    n = len(ring)
    peaks = [rng.randrange(n) for _ in range(2)]
    spikes = []
    for k, v in enumerate(ring):
        rise = rng.uniform(0.0, 0.25) * height
        for pk, tall in zip(peaks, (height, height * 0.6)):
            d = abs(((k - pk + n / 2) % n) - n / 2)
            if d == 0:
                rise = max(rise, tall)
            elif d == 1:
                rise = max(rise, tall * rng.uniform(0.3, 0.55))
        inward = (Vector(centre) - v.co) * (0.1 + 0.3 * min(1.0, rise / max(height, 1e-3)))
        s = geo.vert(v.co + axis * rise + inward, (0, 0, 0), 0.0, 1.0)
        spikes.append(s)
    for k in range(n):
        geo.face((ring[k], ring[(k + 1) % n], spikes[(k + 1) % n], spikes[k]))
    h = geo.vert(Vector(centre) - axis * hollow, (0, 0, 0), 0.0, 1.0)
    for k in range(n):
        geo.face((spikes[k], spikes[(k + 1) % n], h))


def stump(size, seed, tex=1024):
    """A spruce stump, snapped rather than sawn: root flares running out into the ground."""
    rng = random.Random(seed)
    mat = log_material(tex, axis="z")
    geo = Geo(bark=True)
    w, _, hgt = size
    r = w * 0.27
    rings_n = 7
    pts = [Vector((0, 0, hgt * 0.78 * i / rings_n)) for i in range(rings_n + 1)]
    radii = [r * (1 + 0.45 * math.exp(-p.z / 0.12)) for p in pts]
    lobes = rng.uniform(0, 6.28)

    def wobble(i, a):
        foot = math.exp(-pts[i].z / 0.15)
        return 1 + foot * 0.5 * max(0, math.cos(5 * a + lobes)) ** 3
    rings = tube(geo, pts, radii, 14, tip=False, wobble=wobble)
    _slough(geo, rings, pts, seed, depth=0.01, amount=-0.35)
    _broken_end(geo, rings[-1], pts[-1], UP, seed, height=hgt * 0.16, hollow=0.06)
    # Roots snaking out over the ground.
    for k in range(5):
        a = lobes / 5 + k * 2 * math.pi / 5 + rng.uniform(-0.2, 0.2)
        out = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-out.y, out.x, 0))
        p0 = out * r * 0.55 + UP * 0.2
        ln = w * 0.5 - r * 0.55
        rp = [p0 + out * (ln * t) + side * (0.04 * math.sin(t * 5 + k)) + UP * (0.2 * (1 - t) ** 2
              - 0.07 * t) for t in (0, 0.3, 0.65, 1.0)]
        tube(geo, rp, [0.11, 0.075, 0.045, 0.018], 7, shift=rng.uniform(0, 9), tip=True)
    o = geo.obj("stump", mat)
    for v in o.data.vertices:
        if v.co.z < 0:
            v.co.z = 0
    return o


def fallen_log(size, seed, tex=1024):
    """A fallen spruce lying along y, sunk a little, bark sloughing in patches, branch stubs."""
    rng = random.Random(seed)
    mat = log_material(tex, axis="y")
    geo = Geo(bark=True)
    w, length, hgt = size
    r0, r1 = 0.3, 0.22
    n = 36
    pts, radii = [], []
    for i in range(n + 1):
        t = i / n
        y = -length / 2 + length * t
        pts.append(Vector((0.05 * math.sin(t * 3.1 + seed), y, r0 * 0.92 - 0.02 * t
                           + 0.03 * math.sin(t * 2.3))))
        radii.append((r0 + (r1 - r0) * t) * (1 + 0.25 * math.exp(-t / 0.04)))
    rings = tube(geo, pts, radii, 14, tip=False)
    _slough(geo, rings, pts, seed, depth=0.018, amount=0.15)
    ax = Vector((0, 1, 0))
    _broken_end(geo, rings[-1], pts[-1], ax, seed, height=0.22, hollow=0.1)
    _broken_end(geo, list(reversed(rings[0])), pts[0], -ax, seed + 1, height=0.08, hollow=0.12)
    # Branch stubs, mostly up and to the sides.
    for k in range(5):
        t = rng.uniform(0.2, 0.9)
        i = int(t * n)
        a = rng.uniform(-1.6, 1.6) + (math.pi / 2)
        d = Vector((math.cos(a), rng.uniform(0.1, 0.4), math.sin(a))).normalized()
        p0 = pts[i] + d * radii[i] * 0.6
        # Snapped off short and blunt, not tapering to spikes.
        ln = rng.uniform(0.07, 0.2)
        rr = rng.uniform(0.025, 0.045)
        tube(geo, [p0, p0 + d * ln * 0.6, p0 + d * ln, p0 + d * (ln + 0.004)],
             [rr * 1.15, rr * 0.9, rr * 0.82, rr * 0.45], 6, shift=rng.uniform(0, 9), tip=True)
    o = geo.obj("log", mat)
    for v in o.data.vertices:
        if v.co.z < 0.03:
            v.co.z = 0.03 - (0.03 - v.co.z) * 0.1
    return o


def _plant_normal(p):
    out = Vector((p.x, p.y, 0))
    if out.length > 1e-4:
        out = out.normalized()
    return (out * 0.55 + UP).normalized()


def grass_tuft(size, seed, tile_px=512, key="grass-tuft"):
    """A tussock of long dead grass: crossed cards of blades, some flopped over."""
    rng = random.Random(seed)
    w, _, h = size
    base, normal_path = atlas(key, [grass_tile(0.25), grass_tile(0.6)], 0.8, tile_px=tile_px,
                              cols=2, rows=1, seed=seed, ao=0.03, thicken=0.3,
                              normal_strength=0.5)
    mat = card_material(f"{key}-blades", base, normal_path, roughness=0.9)
    geo = Geo(uv=True, normals=True)
    count = 9
    for k in range(count):
        a = k * math.pi / count + rng.uniform(-0.15, 0.15)
        U = Vector((math.cos(a), math.sin(a), 0))
        lean = rng.uniform(-0.25, 0.25)
        V = (UP + U.cross(UP) * lean).normalized()
        cw = w * rng.uniform(0.75, 1.0)
        ch = h * rng.uniform(0.85, 1.05) / V.z
        o = -U * (cw / 2) + Vector((rng.gauss(0, 0.03), rng.gauss(0, 0.03), -0.02))
        card(geo, o, U, V, cw, ch, tile_rect(rng.randint(0, 1), cols=2, rows=1), _plant_normal,
             curl=rng.uniform(-0.08, 0.08))
    geo.obj("grass", mat)


def heather(size, seed, tile_px=512, key="heather"):
    """A low dome of heather: woody shoots with dead flower spikes on crossed cards."""
    rng = random.Random(seed)
    w, _, h = size
    base, normal_path = atlas(key, [heather_tile, heather_tile], 0.45, tile_px=tile_px, cols=2,
                              rows=1, seed=seed, ao=0.02, thicken=0.3, normal_strength=0.5)
    mat = card_material(f"{key}-shoots", base, normal_path, roughness=0.85)
    geo = Geo(uv=True, normals=True)
    for k in range(14):
        a = k * math.pi / 7 + rng.uniform(-0.2, 0.2)
        r = rng.uniform(0.05, w * 0.22)
        ang = a + math.pi / 2
        c = Vector((math.cos(ang) * r, math.sin(ang) * r, 0))
        U = Vector((math.cos(a), math.sin(a), 0))
        cw = rng.uniform(0.62, 0.72)
        ch = h * (1 - (r / (w * 0.5)) ** 2 * 0.5) * rng.uniform(0.85, 1.05)
        V = (UP + c.normalized() * 0.3 if c.length > 0.01 else UP).normalized()
        o = c - U * (cw / 2) - UP * 0.02
        card(geo, o, U, V, cw, ch / V.z, tile_rect(rng.randint(0, 1), cols=2, rows=1),
             _plant_normal)
    geo.obj("heather", mat)


def fern(size, seed, tile_px=512, key="fern"):
    """A dead fern: fronds rising from a crown and arching over, browned and curling."""
    rng = random.Random(seed)
    w, _, h = size
    base, normal_path = atlas(key, [fern_tile(0.2), fern_tile(0.7)], 0.9, tile_px=tile_px,
                              cols=2, rows=1, seed=seed, ao=0.02, thicken=0.25,
                              normal_strength=0.6)
    mat = card_material(f"{key}-fronds", base, normal_path, roughness=0.85)
    geo = Geo(uv=True, normals=True)
    count = 8
    for k in range(count):
        a = k * 2 * math.pi / count + rng.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), math.sin(a), 0))
        e = math.radians(rng.uniform(62, 80))
        U = (out * math.cos(e) + UP * math.sin(e)).normalized()
        V = out.cross(UP).normalized()
        ln = h * rng.uniform(1.2, 1.4)
        fw = 0.42 * rng.uniform(0.85, 1.1)
        o = -V * (fw / 2) + out * 0.03
        card(geo, o, U, V, ln, fw, tile_rect(rng.randint(0, 1), cols=2, rows=1), _plant_normal,
             segs=4, droop=ln * rng.uniform(0.25, 0.4), curl=fw * 0.15)
    geo.obj("fern", mat)
