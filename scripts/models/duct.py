"""
Duct: 4 m of rectangular galvanised ventilation duct on trapeze hangers, in two lengths joined by
bolted flanges, its panels cross-broken. Open at both ends, so lengths join end to end along x.
Hangs from its origin, on the ceiling at the middle of its top.
"""

import bmesh
from mathutils import Vector

import lib

ORIGIN = "model"
TRIS = 1500
AO_DISTANCE = 0.12

LENGTH = 4.0
HALF_W = 0.25  # half the duct's width, across y
TOP = -0.1
BOTTOM = -0.449
BREAK = 0.007  # how far the middle of each panel bulges, cross-broken to stiffen it
FLANGE = 0.03  # how far the flanges stand out of the duct
FLANGE_T = 0.035  # their thickness along the duct
# Each joint is two flanges back to back, bolted through; at the ends, half of one, which the next
# length's end completes.
FLANGES = (-LENGTH / 2, -FLANGE_T, 0.0, LENGTH / 2 - FLANGE_T)
BOLTS = ((-LENGTH / 2, FLANGE_T + 0.008), (-FLANGE_T - 0.008, 2 * FLANGE_T + 0.016),
         (LENGTH / 2 - FLANGE_T - 0.008, FLANGE_T + 0.008))  # where each starts, and its length
HANGERS = (-1.0, 1.0)
BAR = 0.041  # the strut channel's size
HALF_D = 0.3


def ring(bm, x0, x1, inner, outer, cz):
    """A rectangular ring along x from x0 to x1: half sizes (y, z) inside and out, centred on cz."""
    def loop(x, hy, hz):
        return [bm.verts.new((x, y, cz + z)) for y, z in ((-hy, -hz), (hy, -hz), (hy, hz), (-hy, hz))]

    a_out, b_out = loop(x0, *outer), loop(x1, *outer)
    a_in, b_in = loop(x0, *inner), loop(x1, *inner)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((a_out[i], a_out[j], b_out[j], b_out[i]))
        bm.faces.new((a_in[j], a_in[i], b_in[i], b_in[j]))
        bm.faces.new((a_out[j], a_out[i], a_in[i], a_in[j]))
        bm.faces.new((b_out[i], b_out[j], b_in[j], b_in[i]))


def mesh(name, bm, mat):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib.assign(lib._mesh_object(name, bm), mat)


def build():
    galv = lib.material("galvanised", (0.5, 0.5, 0.5), metallic=0.6)
    galv["bake"] = 1024
    n = lib.Nodes(galv)
    n.out(**lib.galvanised(n, tone=0.5, dirt=0.75, dust=1.0, white_rust=0.3, dents=1.2,
                           bump=0.005))
    inside = lib.material("inside", (0.02, 0.02, 0.02), roughness=0.7)
    dark = lib.material("bolt", (0.06, 0.055, 0.05), roughness=0.55, metallic=1)
    rod = lib.material("rod", (0.12, 0.1, 0.08), roughness=0.6, metallic=1)

    cz = (TOP + BOTTOM) / 2
    hz = (TOP - BOTTOM) / 2
    # The duct's skin: each panel between joints is four triangles bulging to its middle.
    bm = bmesh.new()
    ends = [-LENGTH / 2, 0.0, LENGTH / 2]
    corners = [(-HALF_W, -hz), (HALF_W, -hz), (HALF_W, hz), (-HALF_W, hz)]
    for x0, x1 in zip(ends, ends[1:]):
        for i in range(4):
            (y0, z0), (y1, z1) = corners[i], corners[(i + 1) % 4]
            quad = [Vector((x0, y0, cz + z0)), Vector((x0, y1, cz + z1)),
                    Vector((x1, y1, cz + z1)), Vector((x1, y0, cz + z0))]
            middle = sum(quad, Vector()) / 4
            out = Vector((0, (y0 + y1) / 2, (z0 + z1) / 2)).normalized()
            centre = bm.verts.new(middle + out * BREAK)
            verts = [bm.verts.new(v) for v in quad]
            for k in range(4):
                bm.faces.new((verts[k], verts[(k + 1) % 4], centre))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    skin = mesh("skin", bm, galv)
    # Made outward-facing by hand, since recalc can't tell on an open tube.
    for poly in skin.data.polygons:
        c = poly.center
        if poly.normal.dot(Vector((0, c.y, c.z - cz))) < 0:
            poly.flip()

    # Inside, dark, a sheet's thickness in, so the open ends don't show through.
    bm = bmesh.new()
    ring(bm, -LENGTH / 2, LENGTH / 2, (HALF_W - 0.002, hz - 0.002), (HALF_W - 0.0005, hz - 0.0005),
         cz)
    mesh("lining", bm, inside)

    # Flanged joints, with a bolt through each corner.
    for x in FLANGES:
        bm = bmesh.new()
        ring(bm, x, x + FLANGE_T, (HALF_W, hz), (HALF_W + FLANGE, hz + FLANGE), cz)
        mesh("flange", bm, galv)
    for x, length in BOLTS:
        for y in (-1, 1):
            for z in (-1, 1):
                at = (x + length / 2, y * (HALF_W + FLANGE * 0.5), cz + z * (hz + FLANGE * 0.5))
                lib.cylinder("bolt", 0.007, length, at, axis="x", mat=dark, sides=6)

    # Trapeze hangers: threaded rods from the ceiling to a strut channel under the duct.
    channel = [
        (-BAR / 2, 0), (BAR / 2, 0), (BAR / 2, -BAR), (0.01, -BAR), (0.01, -BAR + 0.006),
        (BAR / 2 - 0.003, -BAR + 0.006), (BAR / 2 - 0.003, -0.003), (-BAR / 2 + 0.003, -0.003),
        (-BAR / 2 + 0.003, -BAR + 0.006), (-0.01, -BAR + 0.006), (-0.01, -BAR), (-BAR / 2, -BAR),
    ]
    for x in HANGERS:
        lib.shape("strut", [(x + u, BOTTOM + v) for u, v in channel], depth=2 * HALF_D, mat=galv,
                  facing="-y")
        for y in (-1, 1):
            ry = y * (HALF_D - 0.03)
            lib.cylinder("rod", 0.005, 0.496, (x, ry, -0.252), mat=rod, sides=6)
            lib.cylinder("anchor", 0.014, 0.008, (x, ry, -0.004), mat=dark, sides=6)
            lib.cylinder("nut", 0.009, 0.008, (x, ry, BOTTOM + 0.004), mat=dark, sides=6)
            lib.cylinder("nut", 0.009, 0.008, (x, ry, BOTTOM - BAR - 0.0045), mat=dark, sides=6)

    # An access panel on the front, with four wing nuts, and an airflow arrow stencilled on both
    # sides.
    lib.box("hatch", (0.3, 0.006, 0.2), (1.0 - 0.4, -HALF_W - 0.003, cz), galv, bevel=0.002,
            segments=1)
    for dx in (-0.12, 0.12):
        for dz in (-0.07, 0.07):
            lib.cylinder("wing", 0.008, 0.01, (0.6 + dx, -HALF_W - 0.009, cz + dz), axis="y",
                         mat=dark, sides=6)
    stencil = lib.material("stencil", (0.45, 0.3, 0.01), roughness=0.75)
    arrow = [(-0.2, -0.03), (0.1, -0.03), (0.1, -0.075), (0.22, 0), (0.1, 0.075), (0.1, 0.03),
             (-0.2, 0.03)]
    lib.shape("arrow", arrow, (-1.0, -HALF_W - 0.0004, cz), depth=0.0006, mat=stencil)
    lib.shape("arrow", [(-u, v) for u, v in arrow], (-1.0, HALF_W + 0.0004, cz), depth=0.0006,
              mat=stencil, facing="y")
