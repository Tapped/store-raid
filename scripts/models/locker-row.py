"""
Locker row: three dented steel lockers in the dockers' room, louvred doors with number plates,
the middle one ajar, a padlock on the right, a hard hat on top and a hi-vis vest hung on a handle.
"""

import math
import random

import backroom as br
import lib
from mathutils import Matrix, Vector

TRIS = 3500
AO = 1024
AO_DISTANCE = 0.25

W, H, D = 1.2, 1.9, 0.5
BODY_D = 0.38
BODY_H = 1.78
PLINTH = 0.08
LOCKER = W / 3
BACK = D / 2
FRONT = BACK - BODY_D
DOOR_T = 0.02
AJAR = math.radians(11)


def _vents(n, p):
    """Louvre slots across the top and bottom of each door's face."""
    L = br.attr(n, "local").outputs["Vector"]
    H_ = br.attr(n, "half").outputs["Vector"]
    lx, _, lz = br.split(n, L)
    hx, _, hz = br.split(n, H_)
    door = n.math("GREATER_THAN", hz, 0.7)
    geo = n.add("ShaderNodeNewGeometry")
    # Only the doors' fronts, which face the room (-y).
    face = br.smooth(n, n.math("MULTIPLY", br.split(n, geo.outputs["Normal"])[1], -1.0), 0.8, 0.9)
    across = n.math("LESS_THAN", n.math("ABSOLUTE", lx), n.math("SUBTRACT", hx, 0.07))
    top = br.mul(n, n.math("GREATER_THAN", lz, n.math("SUBTRACT", hz, 0.16)),
                 n.math("LESS_THAN", lz, n.math("SUBTRACT", hz, 0.05)))
    low = br.mul(n, n.math("LESS_THAN", lz, n.math("SUBTRACT", 0.16, hz)),
                 n.math("GREATER_THAN", lz, n.math("SUBTRACT", 0.05, hz)))
    slots = n.stripes(lz, 0.014, 0.45)
    hole = br.mul(n, door, face, across, n.math("MAXIMUM", top, low), slots)
    return br.mul(n, hole, 0.9), br.inv(n, hole)


def build():
    rng = random.Random(71)
    steel = br.paint("locker", (0.05, 0.075, 0.1), wear=1.4, gloss=0.38, detail=_vents)
    dark = lib.material("plinth", (0.015, 0.015, 0.016), roughness=0.7)
    chrome = lib.material("chrome", (0.5, 0.5, 0.5), roughness=0.3, metallic=1.0)
    brass = lib.material("brass", (0.45, 0.3, 0.1), roughness=0.35, metallic=1.0)
    ink = lib.material("ink", (0.01, 0.01, 0.01), roughness=0.6)
    hat = br.plastic("hard-hat", (0.5, 0.3, 0.008), gloss=0.35)
    vest = hi_vis()

    for i in range(3):
        xc = -W / 2 + LOCKER * (i + 0.5)
        yc = (FRONT + BACK) / 2
        t = 0.012
        # The carcass: sides, back, top and bottom, open at the front.
        for sx in (-1, 1):
            br.part("side", (t, BODY_D, BODY_H - PLINTH), (xc + sx * (LOCKER / 2 - t / 2), yc,
                                                           PLINTH + (BODY_H - PLINTH) / 2), steel,
                    rng.random())
        br.part("back", (LOCKER - 2 * t, t, BODY_H - PLINTH), (xc, BACK - t / 2, (BODY_H + PLINTH) / 2),
                steel, rng.random())
        br.part("top", (LOCKER, BODY_D, t), (xc, yc, BODY_H - t / 2), steel, rng.random(), bevel=0.003)
        br.part("floor", (LOCKER - 2 * t, BODY_D, t), (xc, yc, PLINTH + t / 2), steel, rng.random())
        br.part("shelf", (LOCKER - 2 * t, BODY_D - 0.02, t), (xc, yc + 0.01, BODY_H - 0.3), steel,
                rng.random())
        lib.box("plinth", (LOCKER - 0.02, BODY_D - 0.04, PLINTH), (xc, yc + 0.02, PLINTH / 2), dark)

        # The door, hinged on its left edge, the middle one ajar.
        dw, dh = LOCKER - 0.016, BODY_H - PLINTH - 0.016
        hinge = (xc - LOCKER / 2 + 0.008, FRONT, PLINTH + 0.008)
        turn = -AJAR if i == 1 else 0.0
        objs = []
        door = lib.box("door", (dw, DOOR_T, dh), (dw / 2, -DOOR_T / 2, dh / 2), steel, bevel=0.003)
        if i == 2:
            # Kicked in low down and punched higher up.
            dent(door, [(dw * 0.4, dh * 0.22, 0.12, 0.012), (dw * 0.6, dh * 0.62, 0.07, 0.006)], -DOOR_T)
        br.tag(door, (dw / 2, DOOR_T / 2, dh / 2), rng.random(), (dw / 2, -DOOR_T / 2, dh / 2))
        objs.append(door)
        face = -DOOR_T
        hz = dh * 0.52
        objs.append(lib.box("handle", (0.025, 0.03, 0.12), (dw - 0.05, face - 0.015, hz), chrome,
                            bevel=0.006))
        objs.append(lib.box("plate", (0.07, 0.003, 0.04), (dw / 2, face - 0.0015, dh - 0.22), brass,
                            bevel=0.001))
        number = br.lettering("number", str(14 + i), 0.028, (0, 0, 0), ink, depth=0.0006)
        local = Vector((dw / 2, face - 0.0032, dh - 0.22))
        number.matrix_world = (Matrix.Translation(Vector(hinge) + Matrix.Rotation(turn, 3, "Z") @ local)
                               @ Matrix.Rotation(turn, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X"))
        objs.append(lib.box("card", (0.09, 0.002, 0.055), (dw / 2, face - 0.001, hz + 0.18),
                            bpy_paper()))
        for hzz in (0.25, dh - 0.25):
            objs.append(lib.cylinder("hinge", 0.008, 0.07, (-0.002, face + 0.004, hzz), mat=chrome,
                                     sides=6))
        if i == 2:
            # A padlock through the hasp.
            objs.append(lib.box("hasp", (0.012, 0.025, 0.05), (dw - 0.05, face - 0.0125, hz - 0.1),
                                chrome))
            objs.append(lib.box("padlock", (0.045, 0.02, 0.04), (dw - 0.05, face - 0.035, hz - 0.145),
                                brass, bevel=0.005))
            objs.append(lib.tube("shackle", [(dw - 0.065, face - 0.035, hz - 0.125),
                                             (dw - 0.065, face - 0.035, hz - 0.095),
                                             (dw - 0.05, face - 0.035, hz - 0.085),
                                             (dw - 0.035, face - 0.035, hz - 0.095),
                                             (dw - 0.035, face - 0.035, hz - 0.125)],
                                 [0.004] * 5, mat=chrome, sides=6))
        if i == 0:
            # A hi-vis vest hung by its neck on the handle.
            objs.append(vest_mesh((dw - 0.06, face - 0.034, hz - 0.02), vest))
        for o in objs:
            o.location = hinge
            o.rotation_euler = (0, 0, turn)

    # A hard hat left on top of the middle locker.
    shell = lib.lathe("hard-hat", [(0.0, 0.14), (0.008, 0.14), (0.014, 0.1), (0.06, 0.098),
                                   (0.095, 0.075), (0.115, 0.04), (0.12, 0.0)], (0, 0, 0), mat=hat,
                      sides=16)
    br.tag(shell, (0.14, 0.14, 0.06), 0.3, (0, 0, 0.06))
    lib.box("hat-ridge", (0.025, 0.2, 0.012), (0, 0, 0.113), hat, bevel=0.005)
    for o in (shell, bpy_last()):
        o.scale = (1.0, 1.18, 1.0)
        o.location = (0.05, 0.02, BODY_H)
        o.rotation_euler = (0, 0, 0.5)
    br.bounds_report("locker-row")


def dent(obj, dents, face_y):
    """Subdivide a door's box and push its front face in round each (x, z, radius, depth)."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=7, use_grid_fill=True)
    for v in bm.verts:
        if abs(v.co.y - face_y) > 1e-4:
            continue
        for x, z, r, depth in dents:
            d = math.hypot(v.co.x - x, (v.co.z - z) * 0.8)
            if d < r:
                v.co.y += depth * (0.5 + 0.5 * math.cos(math.pi * d / r))
    bm.to_mesh(obj.data)
    bm.free()


def vest_mesh(at, mat):
    """A hi-vis vest hanging by its neck: a draped grid with a V neck and armholes."""
    cols, rows = 8, 10
    w, top, bottom = 0.36, 0.1, -0.4
    verts, faces = [], []
    for r in range(rows + 1):
        v = top + (bottom - top) * r / rows
        for c in range(cols + 1):
            u = -w / 2 + w * c / cols
            hang = (v - top) / (bottom - top)
            out = -0.012 - 0.03 * hang * hang + 0.006 * math.sin(u * 40 + hang * 3) * hang
            verts.append((at[0] + u * (1 + 0.08 * hang), at[1] + out, at[2] + v))

    def keep(u, v):
        if abs(u) < 0.06 - (top - v) * 0.4 and v > -0.02:
            return False  # the neck
        if abs(u) > 0.11 and v > -0.12:
            return False  # the armholes and shoulders' slope
        return True

    for r in range(rows):
        for c in range(cols):
            a = r * (cols + 1) + c
            u = -w / 2 + w * (c + 0.5) / cols
            v = top + (bottom - top) * (r + 0.5) / rows
            if keep(u, v):
                faces.append((a, a + cols + 1, a + cols + 2, a + 1))  # facing the room (-y)
    obj = br.mesh_object("vest", verts, faces, mat, 0.4)
    # Its own coordinates, for the reflective bands.
    local = obj.data.attributes["local"]
    for i, vert in enumerate(obj.data.vertices):
        local.data[i].vector = (vert.co.x - at[0], 0, vert.co.z - at[2] + 0.16)
    return obj


def bpy_paper():
    import bpy

    return bpy.data.materials.get("paper") or br.paper()


def bpy_last():
    import bpy

    return bpy.data.objects["hat-ridge"]


def hi_vis(name="hi-vis", size=512):
    """Fluorescent yellow mesh fabric with two grey reflective bands, grubby from the docks."""
    mat, n = lib.procedural(name, size)
    L = br.attr(n, "local").outputs["Vector"]
    _, _, lz = br.split(n, L)
    p = br.seeded(n)
    band = n.math("MAXIMUM", br.inside_band(n, lz, -0.12, 0.03), br.inside_band(n, lz, 0.0, 0.03))
    c = n.mix(n.noise(6, 3, vector=p), (0.55, 0.5, 0.0), (0.45, 0.42, 0.0))
    c = n.mix(band, c, (0.35, 0.35, 0.36))
    grime = br.smooth(n, n.noise(3, 4, vector=p), 0.45, 0.75)
    c = n.mix(br.mul(n, grime, 0.6), c, (0.12, 0.1, 0.04))
    weave = n.math("MULTIPLY", n.stripes(br.split(n, L)[0], 0.003, 0.5), n.stripes(lz, 0.003, 0.5))
    rough = n.lerp(band, 0.75, 0.35)
    n.out(**{"Base Color": c, "Roughness": rough,
             "Normal": br.bump(n, weave, 0.0005, br.bump(n, n.noise(5, 3, vector=p), 0.004))})
    return mat
