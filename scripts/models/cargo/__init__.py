"""
Shared by the cargo models (containers, crates, drums...): not a model itself.

- sweep(): a section swept through stations, every vertex placed by a callback: corrugated walls
  with dents.
- corrugation(): a trapezoid corrugation profile, cut to a span.
- Stencil: lines of stencilled lettering rendered once into an alpha image, which a procedural
  material projects onto the model in meters (on corrugated steel or planks alike).
- Shader helpers on lib.Nodes: smooth(), Field (noise with a per-model offset), painted_wear():
  the Saltline painted steel recipe (clustered chips to primer, rust and bare steel, rust runs,
  wash streaks, chalking, grime from the floor, salt).

The models themselves are in cargo/container.py, cargo/crate.py...: `from cargo import container`.
This is a package rather than a module beside the model scripts so index.ts doesn't list it.
"""

import math
import os
import random
import tempfile

import bmesh
import bpy
from mathutils import Vector

import lib

# --- Geometry -----------------------------------------------------------------------------------


def sweep(name, section, stations, to_world, mat=None, out=None, cap=False):
    """
    A surface through `section` (a list of (a, b) points) at each of `stations`, every vertex at
    to_world(a, b, station). Neighbouring points share vertices, so it shades by angle. `out`: the
    direction its faces should point (an open surface has no inside to tell by).
    """
    bm = bmesh.new()
    rows = [[bm.verts.new(to_world(a, b, s)) for a, b in section] for s in stations]
    for r0, r1 in zip(rows, rows[1:]):
        for i in range(len(section) - 1):
            bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
    if cap:
        for row in (rows[0], rows[-1]):
            bm.faces.new(row)
    if out is not None:
        bm.normal_update()
        for face in bm.faces:
            if face.normal.dot(Vector(out)) < 0:
                face.normal_flip()
    return lib.assign(lib._mesh_object(name, bm), mat)


def corrugation(start, end, pitch, depth, flat_out, flat_in, phase=0.0):
    """
    A trapezoid corrugation from `start` to `end`: (position, depth in) at every bend and both
    ends, 0 on the outer flats and `depth` on the inner ones. `phase` shifts the pattern.
    """
    slope = (pitch - flat_out - flat_in) / 2
    marks = [(0.0, 0.0), (flat_out, 0.0), (flat_out + slope, depth),
             (flat_out + slope + flat_in, depth), (pitch, 0.0)]

    def at(p):
        q = (p - phase) % pitch
        for (p0, d0), (p1, d1) in zip(marks, marks[1:]):
            if p0 <= q <= p1:
                return d0 + (d1 - d0) * (q - p0) / (p1 - p0)
        return 0.0

    points = {start, end}
    k = math.floor((start - phase) / pitch) - 1
    while phase + k * pitch <= end:
        for m, _ in marks[:-1]:
            p = phase + k * pitch + m
            if start < p < end:
                points.add(p)
        k += 1
    return [(p, at(p)) for p in sorted(points)]


def dents(rng, count, span_a, span_b, radius, depth):
    """`count` random dents, (a, b, radius, depth), over a surface spanning span_a × span_b."""
    return [
        (rng.uniform(*span_a), rng.uniform(*span_b), rng.uniform(*radius), rng.uniform(*depth))
        for _ in range(count)
    ]


def dent_at(dent_list, a, b):
    """How far the dents push a surface in at (a, b): a sum of soft bumps (1 - d²)²."""
    total = 0.0
    for da, db, r, d in dent_list:
        q = ((a - da) ** 2 + (b - db) ** 2) / (r * r)
        if q < 1:
            total += d * (1 - q) ** 2
    return total


# --- Stencils -----------------------------------------------------------------------------------

FONTS = ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/DejaVuSans-Bold.ttf")


class Stencil:
    """
    Blocks of lettering, rendered once into an image `ppm` pixels per meter, at the size they're
    painted. `blocks` = {name: [(text, cap height, boxed)...]}: lines from the top down; a boxed
    line has a frame round its last character, like a container's check digit. mask() paints a
    block onto a surface in a procedural material.
    """

    def __init__(self, name, blocks, ppm=900):
        scene = bpy.data.scenes.new(f"{name}-stencil")
        lib.cycles(scene)
        scene.cycles.samples = 8
        scene.render.film_transparent = True
        scene.view_settings.view_transform = "Standard"
        ink = bpy.data.materials.new(f"{name}-ink")
        ink.use_nodes = True
        tree = ink.node_tree
        tree.nodes.clear()
        out = tree.nodes.new("ShaderNodeOutputMaterial")
        em = tree.nodes.new("ShaderNodeEmission")
        tree.links.new(em.outputs[0], out.inputs["Surface"])
        font = next((bpy.data.fonts.load(f) for f in FONTS if os.path.exists(f)), None)

        objs = []

        def add(obj):
            scene.collection.objects.link(obj)
            objs.append(obj)
            return obj

        def text(body, cap, x, y):
            curve = bpy.data.curves.new("t", "FONT")
            curve.body = body
            curve.size = cap / 0.716  # Arial's capitals are 0.716 em
            curve.resolution_u = 4
            if font:
                curve.font = font
            curve.materials.append(ink)
            obj = add(bpy.data.objects.new("t", curve))
            obj.location = (x, y, 0)
            return obj

        def bounds(obj):
            scene.view_layers[0].update()
            pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
            return (min(p.x for p in pts), min(p.y for p in pts), max(p.x for p in pts),
                    max(p.y for p in pts))

        def frame(x0, y0, x1, y1, t):
            bm = bmesh.new()
            for a, b, c, d in ((x0, y0, x1, y0 + t), (x0, y1 - t, x1, y1), (x0, y0, x0 + t, y1),
                               (x1 - t, y0, x1, y1)):
                bm.faces.new([bm.verts.new(v) for v in ((a, b, 0), (c, b, 0), (c, d, 0), (a, d, 0))])
            mesh = bpy.data.meshes.new("frame")
            bm.to_mesh(mesh)
            bm.free()
            mesh.materials.append(ink)
            add(bpy.data.objects.new("frame", mesh))

        self.blocks = {}
        cursor = 0.05
        width = 0.0
        for bname, lines in blocks.items():
            top = cursor
            y = cursor
            x_max = 0.0
            for body, cap, boxed in reversed(lines):  # bottom line first
                if boxed:
                    a = text(body[:-1], cap, 0.05, y)
                    x1 = bounds(a)[2]
                    b = text(body[-1], cap, x1 + cap * 0.4, y)
                    bx0, _, bx1, _ = bounds(b)
                    pad, t = cap * 0.2, cap * 0.09
                    frame(bx0 - pad, y - pad, bx1 + pad, y + cap + pad, t)
                    x_max = max(x_max, bx1 + pad)
                elif body == "@up":
                    # The "this way up" mark: two arrows over a bar, `cap` high.
                    polys = []
                    for k in range(2):
                        cx = 0.05 + cap * (0.22 + 0.5 * k)
                        sw, hw = cap * 0.07, cap * 0.2
                        polys.append([(cx - sw, y + cap * 0.18), (cx + sw, y + cap * 0.18),
                                      (cx + sw, y + cap * 0.62), (cx + hw, y + cap * 0.62),
                                      (cx, y + cap), (cx - hw, y + cap * 0.62),
                                      (cx - sw, y + cap * 0.62)])
                    polys.append([(0.05, y), (0.05 + cap * 0.94, y), (0.05 + cap * 0.94, y + cap * 0.09),
                                  (0.05, y + cap * 0.09)])
                    bm = bmesh.new()
                    for poly in polys:
                        bm.faces.new([bm.verts.new((u, v, 0)) for u, v in poly])
                    mesh = bpy.data.meshes.new("mark")
                    bm.to_mesh(mesh)
                    bm.free()
                    mesh.materials.append(ink)
                    add(bpy.data.objects.new("mark", mesh))
                    x_max = max(x_max, 0.05 + cap * 0.94)
                else:
                    x_max = max(x_max, bounds(text(body, cap, 0.05, y))[2])
                y += cap * 1.5
            self.blocks[bname] = (0.03, top - 0.03, x_max - 0.03 + 0.02, y - top + 0.03)
            width = max(width, x_max)
            cursor = y + 0.08
        self.size = (width + 0.05, cursor)

        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = max(self.size)
        cam.location = (self.size[0] / 2, self.size[1] / 2, 5)
        add(cam)
        scene.camera = cam
        scene.render.resolution_x = int(self.size[0] * ppm)
        scene.render.resolution_y = int(self.size[1] * ppm)
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        path = os.path.join(tempfile.gettempdir(), f"{name}-stencil.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True, scene=scene.name)
        for o in objs:
            bpy.data.objects.remove(o)
        bpy.data.scenes.remove(scene)
        self.image = bpy.data.images.load(path)

    def mask(self, n, block, h, v, h0, v0, where=1.0):
        """
        How much of `block` is painted at (h, v), meters across and up a surface, the block's
        bottom left at (h0, v0). `where` limits it to the faces it's on.
        """
        bx, by, bw, bh = self.blocks[block]
        sw, sh = self.size
        du = n.math("SUBTRACT", h, h0)
        dv = n.math("SUBTRACT", v, v0)
        u = n.math("DIVIDE", n.math("ADD", du, bx), sw)
        w = n.math("DIVIDE", n.math("ADD", dv, by), sh)
        tex = n.add("ShaderNodeTexImage", {"Vector": n.vec(u, w, 0)}, image=self.image,
                    extension="CLIP", interpolation="Linear")
        inside = n.math("MULTIPLY", n.inside(du, 0, bw), n.inside(dv, 0, bh))
        return n.math("MULTIPLY", n.math("MULTIPLY", tex.outputs["Alpha"], inside), where)

    def width(self, block):
        return self.blocks[block][2]

    def height(self, block):
        return self.blocks[block][3]


# --- Shader helpers -----------------------------------------------------------------------------


def smooth(n, value, lo, hi):
    """0 at lo, 1 at hi, smoothstep between (lo > hi turns it round). lo and hi are numbers."""
    if lo > hi:
        return n.math("SUBTRACT", 1.0, smooth(n, value, hi, lo))
    node = n.add(
        "ShaderNodeMapRange",
        {"Value": value, "From Min": lo, "From Max": hi, "To Min": 0.0, "To Max": 1.0},
        interpolation_type="SMOOTHSTEP",
    )
    return node.outputs["Result"]


def normal(n):
    """The surface normal's x, y, z (the model's axes)."""
    return n.xyz(n.add("ShaderNodeNewGeometry").outputs["Normal"])


class Field:
    """Positions in the model's meters (x, y, z) and noise over them, shifted by a seed."""

    def __init__(self, n, seed):
        self.n = n
        rng = random.Random(seed)
        off = (rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50))
        coord = n.coord()
        self.p = n.add("ShaderNodeVectorMath", {0: coord, 1: off}, operation="ADD").outputs[0]
        self.x, self.y, self.z = n.xyz(coord)

    def at(self, dx=0.0, dy=0.0, dz=0.0):
        """The noise position moved, to sample a pattern somewhere else (rust runs)."""
        return self.n.add("ShaderNodeVectorMath", {0: self.p, 1: (dx, dy, dz)},
                          operation="ADD").outputs[0]

    def noise(self, scale, detail=4.0, rough=0.5, stretch=(1, 1, 1), at=None):
        """Noise 0..1 with features 1/scale meters across, `stretch` times finer along each axis."""
        p = at or self.p
        if tuple(stretch) != (1, 1, 1):
            p = self.n.add("ShaderNodeVectorMath", {0: p, 1: tuple(stretch)},
                           operation="MULTIPLY").outputs[0]
        return self.n.noise(scale, detail=detail, roughness=rough, vector=p)


def painted_wear(n, f, paint, wear=0.5, rust=0.5, chalk=0.3, top=2.5, recess=None, edge=None,
                 runs=None, floor_dirt=0.8, salt=0.4):
    """
    Painted steel after years at sea and on the quay, as Saltline layers it: chalking, wash
    streaks and dirt, then clustered damage down through primer to rust and bare steel, rust runs
    below chips and under `top`, grime rising from the floor, salt.

    `recess`: 0 on outer faces to 1 deep in corrugation valleys (dirt and rust gather there).
    `edge`: 0..1 near edges and corners, where chips crowd. `runs`: extra rust run sources (a
    mask that weeps downwards). Returns (colour, roughness, height).
    """
    _, _, up = normal(n)

    # The paint: mottled, faded and chalky where the weather reaches, most on top.
    mottle = f.noise(1.3, detail=3)
    color = n.mix(mottle, [c * 0.82 for c in paint], [c * 1.15 for c in paint])
    sun = n.math("ADD", n.math("MULTIPLY", smooth(n, up, 0.3, 0.9), 0.6),
                 n.math("MULTIPLY", smooth(n, f.z, 0.8, top), 0.4))
    chalky = n.math("MULTIPLY", n.math("MULTIPLY", sun, chalk), n.lerp(f.noise(2.2, 4), 0.4, 1.5))
    grey = [0.45 * c + 0.55 * sum(paint) / 3 + 0.05 for c in paint]
    color = n.mix(n.math("MINIMUM", chalky, 1.0), color, grey)
    rough = n.lerp(chalky, 0.5, 0.78)
    height = n.math("MULTIPLY", f.noise(240, 2), 0.12)  # orange peel

    # Wash streaks: dirt carried down the walls by rain, fine vertical fbm.
    fine = smooth(n, f.noise(1.0, 3, stretch=(70, 70, 1.0)), 0.6, 0.75)
    mid = smooth(n, f.noise(1.0, 3, stretch=(22, 22, 1.0)), 0.58, 0.74)
    broad = smooth(n, f.noise(1.0, 3, stretch=(9, 9, 2.0)), 0.52, 0.7)
    wash = n.math("MAXIMUM", n.math("MULTIPLY", fine, 0.25),
                  n.math("MAXIMUM", n.math("MULTIPLY", mid, 0.35), n.math("MULTIPLY", broad, 0.45)))
    wash = n.math("MULTIPLY", wash, smooth(n, n.math("ABSOLUTE", up), 0.6, 0.2))
    # Streaks gather in patches, and most below whatever they run off.
    wash = n.math("MULTIPLY", wash, smooth(n, f.noise(0.7, 2), 0.4, 0.65))
    wash = n.math("MULTIPLY", wash, n.math("ADD", 0.4, n.math("MULTIPLY", smooth(n, f.z, 0.6, top), 0.6)))
    color = n.mix(wash, color, [c * 0.45 + 0.012 for c in paint])
    rough = n.lerp(n.math("MULTIPLY", wash, 0.5), rough, 0.8)

    # Damage: where fbm clusters, flakes in two sizes; deeper flakes reach rust and steel.
    def chips(at=None):
        cl = f.noise(1.7, 3, at=at)
        cluster = smooth(n, cl, 0.6 - 0.2 * wear, 0.76 - 0.15 * wear)
        if edge is not None:
            cluster = n.math("MAXIMUM", cluster, n.math("MULTIPLY", edge, smooth(n, cl, 0.35, 0.6)))
        flake = n.math("MAXIMUM", f.noise(8, 5, 0.62, at=at), f.noise(26, 4, 0.6, at=at))
        return n.math("MULTIPLY", cluster, smooth(n, flake, 0.5, 0.78))

    c = chips()
    primer = smooth(n, c, 0.15, 0.2)
    rusty = smooth(n, c, 0.45 - 0.25 * rust, 0.5 - 0.25 * rust)
    bare = smooth(n, c, 0.94, 0.96)
    halo = smooth(n, c, 0.06, 0.15)
    color = n.mix(n.math("MULTIPLY", halo, 0.5), color, (0.13, 0.05, 0.022))
    color = n.mix(primer, color, (0.075, 0.066, 0.056))
    # Rust in flaking layers (fbm in terraces), dark at the heart, an orange bloom at its edge.
    layers = n.math("DIVIDE", n.math("FLOOR", n.math("MULTIPLY", f.noise(22, 5, 0.6), 4)), 4)
    rust_col = n.mix(layers, (0.045, 0.02, 0.009), (0.13, 0.05, 0.016))
    deep = smooth(n, c, 0.6, 0.8)
    rust_col = n.mix(n.math("MULTIPLY", deep, 0.6), rust_col, (0.03, 0.016, 0.008))
    bloom = n.math("SUBTRACT", smooth(n, c, 0.3 - 0.25 * rust, 0.45 - 0.25 * rust), rusty)
    color = n.mix(n.math("MULTIPLY", n.math("MAXIMUM", bloom, 0), 0.7), color, (0.19, 0.075, 0.022))
    color = n.mix(rusty, color, rust_col)
    color = n.mix(bare, color, (0.22, 0.21, 0.2))
    rough = n.lerp(primer, rough, 0.75)
    rough = n.lerp(rusty, rough, 0.92)
    rough = n.lerp(bare, rough, 0.38)
    height = n.math("SUBTRACT", height, n.math("ADD", n.math("MULTIPLY", primer, 0.5),
                                               n.math("MULTIPLY", rusty, 0.3)))
    height = n.math("ADD", height, n.math("MULTIPLY", rusty, n.math("ADD", n.math("MULTIPLY", layers, 0.5),
                                                                     n.math("MULTIPLY", f.noise(90, 4), 0.4))))

    # Touch-up paint: rectangles brushed over damage in a slightly different shade.
    h = n.math("ADD", f.x, f.y)
    cell = n.vec(n.math("FLOOR", n.math("DIVIDE", h, 0.85)), n.math("FLOOR", n.math("DIVIDE", f.z, 0.62)),
                 0.0)
    pick = n.noise(1.0, detail=0, vector=n.add("ShaderNodeVectorMath", {0: cell, 1: f.p}, operation="ADD").outputs[0])
    touch = n.math("MULTIPLY", smooth(n, pick, 0.68, 0.7), smooth(n, n.math("ABSOLUTE", up), 0.6, 0.3))
    color = n.mix(touch, color, [c * 1.12 + 0.004 for c in paint])
    rough = n.lerp(touch, rough, 0.4)

    # Rust runs: the chips resampled a few steps up, gated by vertical streaks; and from the top.
    run = 0.0
    for i in range(1, 5):
        src = smooth(n, chips(f.at(dz=i * 0.034)), 0.4 - 0.25 * rust, 0.5 - 0.25 * rust)
        run = n.math("MAXIMUM", run, n.math("MULTIPLY", src, 1 - i / 5))
    gate = f.noise(1.0, 3, stretch=(120, 120, 1.0))
    run_len = n.math("ADD", 0.15, n.math("MULTIPLY", f.noise(1.0, 2, stretch=(3, 3, 0.01)),
                                          0.9 + 0.8 * rust))
    below = n.math("DIVIDE", n.math("SUBTRACT", top, f.z), run_len)
    from_top = n.math("MULTIPLY", smooth(n, below, 1.0, 0.0), n.math("LESS_THAN", f.z, top))
    from_top = n.math("MULTIPLY", from_top, rust)
    if runs is not None:
        from_top = n.math("MAXIMUM", from_top, runs)
    run = n.math("MAXIMUM", run, from_top)
    if recess is not None:
        gate = n.math("ADD", gate, n.math("MULTIPLY", recess, 0.15))
    run = n.math("MULTIPLY", run, smooth(n, gate, 0.45, 0.68))
    run = n.math("MULTIPLY", run, smooth(n, n.math("ABSOLUTE", up), 0.7, 0.3))
    run = n.math("MULTIPLY", run, n.math("SUBTRACT", 1, rusty))
    color = n.mix(n.math("MULTIPLY", run, 0.9), color, (0.17, 0.066, 0.02))
    rough = n.lerp(n.math("MULTIPLY", run, 0.6), rough, 0.85)

    # Grime rising from the floor, in the valleys, and dust on top.
    low = n.math("MULTIPLY", smooth(n, f.z, 1.1, 0.0), floor_dirt)
    low = n.math("MULTIPLY", low, smooth(n, f.noise(3, 5), 0.25, 0.7))
    if recess is not None:
        low = n.math("MAXIMUM", low, n.math("MULTIPLY", recess, 0.35))
    color = n.mix(n.math("MINIMUM", low, 0.85), color, (0.035, 0.03, 0.024))
    rough = n.lerp(low, rough, 0.88)
    dust = n.math("MULTIPLY", smooth(n, up, 0.8, 0.95), n.math("MULTIPLY", f.noise(5, 4), 0.7))
    color = n.mix(dust, color, (0.075, 0.068, 0.058))
    rough = n.lerp(dust, rough, 0.9)

    # Salt: pale crust in specks, low down and on ledges.
    salty = n.math("MAXIMUM", smooth(n, f.z, 0.4, 0.0), smooth(n, up, 0.85, 0.95))
    speck = smooth(n, f.noise(70, 3), 0.72, 0.8)
    crust = n.math("MULTIPLY", n.math("MULTIPLY", salty, speck), salt)
    color = n.mix(crust, color, (0.42, 0.41, 0.37))
    rough = n.lerp(crust, rough, 0.95)
    return color, rough, height


def stencilled(n, f, color, rough, mask, ink, wear):
    """Stencil paint over the wear: itself worn, faded and broken up."""
    worn = smooth(n, f.noise(14, 5), 0.68 - 0.1 * wear, 0.6 - 0.1 * wear)
    m = n.math("MULTIPLY", mask, n.lerp(worn, 0.35, 0.95))
    return n.mix(m, color, ink), n.lerp(m, rough, 0.6)
