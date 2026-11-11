"""
Chain-link partition: a panel of galvanised mesh in a tube frame between two painted posts with a
top rail. The mesh is one quad with an alpha-tested texture (exported as glTF alphaMode MASK, so
it writes depth): a repeating diamond tile made here with numpy, with a normal map that rounds
the wires.
"""

import math
import os
import tempfile

import bmesh
import bpy
import numpy as np

import lib
from cargo import Field, normal, painted_wear, smooth
from cargo.crate import disc, strap_material

CELL = 0.055  # the mesh's diamond, meters across
WIRE = 0.075  # half the wire's width, in tiles: thicker than real, so it survives distance
CUTOFF = 0.3  # alpha below this is a hole; far mips average to ~0.4, so the mesh fades to a veil


def mesh_images(name, size=256):
    """The chain-link tile: colour with alpha, and a tangent-space normal map."""
    v, u = np.mgrid[0:size, 0:size]
    u = (u + 0.5) / size
    v = (v + 0.5) / size
    best = np.full((size, size), 9.0)
    nx = np.zeros((size, size))
    ny = np.zeros((size, size))
    for du, dv in ((1, 1), (1, -1)):
        # Lines u + v = k (or u - v = k): signed distance, in tiles, to the nearest.
        t = (u * du + v * dv)
        d = (t - np.round(t)) / math.sqrt(2)
        closer = np.abs(d) < np.abs(best)
        best = np.where(closer, d, best)
        # The normal leans across the wire, away from its middle.
        lean = np.clip(d / WIRE, -1, 1)
        nx = np.where(closer, lean * du / math.sqrt(2), nx)
        ny = np.where(closer, lean * dv / math.sqrt(2), ny)
    wire = np.abs(best) < WIRE
    edge = np.clip((WIRE - np.abs(best)) / (1.5 / size), 0, 1)  # a pixel of soft edge
    nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0, 1))
    # Galvanised: grey, darker towards the sides of each wire, a little white rust.
    shade = 0.75 + 0.25 * np.sqrt(np.clip(1 - (best / WIRE) ** 2, 0, 1))
    rng = np.random.default_rng(5)
    speck = rng.random((size, size)) > 0.985
    color = np.stack([0.42 * shade, 0.42 * shade, 0.4 * shade], axis=-1)
    color[speck & wire] = (0.55, 0.55, 0.52)
    rgba = np.concatenate([color, edge[..., None]], axis=-1)
    nrm = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, np.ones_like(nz)], axis=-1)
    nrm[~wire] = (0.5, 0.5, 1.0, 1.0)
    images = []
    for kind, data, is_data in (("base", rgba, False), ("normal", nrm, True)):
        img = bpy.data.images.new(f"{name}-{kind}", size, size, alpha=kind == "base", is_data=is_data)
        img.pixels.foreach_set(data.astype(np.float32).ravel())
        img.filepath_raw = os.path.join(tempfile.gettempdir(), f"{name}-{kind}.png")
        img.file_format = "PNG"
        img.save()
        images.append(img)
    return images


def mesh_material(name):
    """Chain link: the tile repeated by UVs, alpha-tested at CUTOFF, round wires."""
    base, nrm = mesh_images(name)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.surface_render_method = "DITHERED"
    mat.use_backface_culling = False
    n = lib.Nodes(mat)
    uv = n.add("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"]
    tex = n.add("ShaderNodeTexImage", {"Vector": uv}, image=base, interpolation="Linear")
    ntex = n.add("ShaderNodeTexImage", {"Vector": uv}, image=nrm, interpolation="Linear")
    nmap = n.add("ShaderNodeNormalMap", {"Color": ntex.outputs["Color"]}, uv_map="UVMap")
    # Alpha -> [x < cutoff] -> [1 - x]: the exporter reads it as MASK with that cutoff.
    hole = n.math("LESS_THAN", tex.outputs["Alpha"], CUTOFF)
    n.out(**{"Base Color": tex.outputs["Color"], "Alpha": n.math("SUBTRACT", 1.0, hole),
             "Roughness": 0.5, "Metallic": 0.35, "Normal": nmap.outputs["Normal"]})
    return mat


def mesh_quad(name, x0, x1, z0, z1, mat):
    """The mesh: one quad in the plane y = 0, its UVs counting diamonds."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    verts = [bm.verts.new(p) for p in ((x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1))]
    face = bm.faces.new(verts)
    for loop in face.loops:
        loop[uvl].uv = (loop.vert.co.x / CELL, loop.vert.co.z / CELL)
    return lib.assign(lib._mesh_object(name, bm), mat)


def post_material(seed, height):
    """Safety-yellow posts, black and yellow stripes at forklift height, knocked about low down."""
    mat, n = lib.procedural("post", 512)
    f = Field(n, seed)
    color, rough, bump = painted_wear(n, f, (0.36, 0.2, 0.006), wear=0.6, rust=0.45, chalk=0.25,
                                      top=height, floor_dirt=0.9, salt=0.3)
    # Hazard stripes round the bottom 40 cm, at 45 degrees.
    diag = n.math("ADD", n.math("ADD", f.x, f.y), f.z)
    stripe = n.math("MULTIPLY", n.stripes(diag, 0.1, 0.5), n.inside(f.z, 0.06, 0.42))
    worn = smooth(n, f.noise(14, 5), 0.7, 0.62)
    color = n.mix(n.math("MULTIPLY", stripe, worn), color, (0.014, 0.013, 0.012))
    n.out(**{"Base Color": color, "Roughness": rough, "Normal": n.bump(bump, distance=0.0015)})
    return mat


def panel(width=2.0, height=2.4, seed=51):
    """A 2 m panel of chain link between two posts, centred on the origin, in the plane y = 0."""
    post = post_material(seed, height)
    galv = strap_material("frame", seed, 512)
    mesh = mesh_material("chain-link")
    bolt = lib.material("bolt", (0.12, 0.12, 0.115), roughness=0.4, metallic=0.8)
    p = 0.06
    xp = width / 2 - p / 2
    for s in (-1, 1):
        lib.box("post", (p, p, height - 0.006), (s * xp, 0, (height - 0.006) / 2), post, bevel=0.003,
                segments=1)
        lib.box("cap", (p + 0.004, p + 0.004, 0.006), (s * xp, 0, height - 0.003), galv)
        lib.box("foot", (0.14, p, 0.008), (s * (xp - 0.04), 0, 0.004), post)
        for k in (-1, 1):
            disc("bolt", 0.009, (s * (xp - 0.04) + k * 0.05, 0, 0.0085), "z", bolt)
        for z in (0.35, 1.2, 2.05):
            lib.box("clamp", (0.05, 0.03, 0.04), (s * (xp - p / 2 - 0.02), 0, z), galv)
    # The top rail between the posts, and the mesh's frame of 25 mm tube.
    inner = width / 2 - p
    lib.box("rail", (2 * inner, 0.04, 0.04), (0, 0, height - 0.04), galv, bevel=0.002, segments=1)
    t = 0.025
    fx = inner - 0.035
    z0, z1 = 0.08, height - 0.09
    for z in (z0, (z0 + z1) / 2, z1):
        lib.box("frame", (2 * fx, t, t), (0, 0, z), galv, bevel=0.002, segments=1)
    for s in (-1, 1):
        lib.box("frame", (t, t, z1 - z0 + t), (s * fx, 0, (z0 + z1) / 2), galv, bevel=0.002,
                segments=1)
    mesh_quad("mesh", -fx, fx, z0, z1, mesh)
