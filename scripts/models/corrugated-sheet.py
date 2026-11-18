"""
Corrugated sheet: one sheet of the cladding's corrugations as geometry, ten of them 76.2 mm apart,
0.762 m wide and 1 m tall, for the port's building (unreal/Script/Level/Building.as), which stretches
it to the height of a wall and lays it over the `corrugated` surface. The surface's texture has the
same corrugations as bumps, cresting where this does, with a side lap every ten: sheets laid at
multiples of 0.762 m line up with it. The profile is corrugated() in client/src/building.ts: 18 mm
deep, 3 mm proud of the wall in the valleys. Its origin is at its left edge, on the wall at the
foot; its corrugations stand out to the front (-y), where it's seen from. It has only that side.

corrugated-strip.py is one corrugation of the same, for what's left at a wall's ends.
"""

import math

import bpy

import lib

OUT = "models/level/corrugated-sheet.glb"
ORIGIN = "model"
TRIS = 400
AO = 0
SMOOTH_ANGLE = 80

PITCH = 0.0762
DEPTH = 0.018
# Segments across one corrugation.
SEGMENTS = 8


def sheet(name, corrugations):
    """A sheet `corrugations` wide, cresting at both edges."""
    count = corrugations * SEGMENTS
    verts = []
    for i in range(count + 1):
        a = i * PITCH / SEGMENTS
        d = DEPTH * (0.5 + 0.5 * math.cos(2 * math.pi * i / SEGMENTS)) + 0.003
        verts.append((a, -d, 0.0))
        verts.append((a, -d, 1.0))
    faces = [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) for i in range(count)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = lib._link(bpy.data.objects.new(name, mesh))
    return lib.assign(obj, lib.material("corrugated", (0.3, 0.33, 0.33), roughness=0.5, metallic=0.6))


def build():
    sheet("sheet", 10)
