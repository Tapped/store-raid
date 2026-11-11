"""
Crate stack: a big crate with two smaller ones on it and a small one on top of those, each turned
a little, the top one's lid knocked askew. Each has its own boards and consignment marks. The
builder is in cargo/crate.py.
"""

from mathutils import Matrix

from cargo import crate

TRIS = 9000
AO = 2048
AO_DISTANCE = 0.12

# (outer size, where its base goes, turn, seed, consignee, place, case, po, gross)
CRATES = [
    ((1.58, 1.18, 0.95), (0, 0, 0), 0.0, 31, "HALVARD LOGISTICS", "GDANSK  PL", "4 / 9",
     "HL22-3307", 690),
    ((0.84, 0.78, 0.6), (-0.36, 0.0, 0.95), 0.035, 32, "KESTREL OFFSHORE", "ABERDEEN  UK",
     "2 / 3", "KO09-5521", 210),
    ((0.6, 0.6, 0.48), (0.46, -0.24, 0.95), -0.05, 33, "NORDVIK MARINE AS", "BERGEN  NO", "6 / 7",
     "KX88-1043", 95),
    ((0.52, 0.5, 0.45), (-0.4, 0.06, 1.55), -0.08, 34, "BRINEMOOR LINE", "LE HAVRE  FR", "1 / 1",
     "BL31-0042", 60),
]


def build():
    shared = None
    for i, (size, at, turn, seed, who, place, case, po, gross) in enumerate(CRATES):
        w, d, h = size
        x, y, z = at
        stencil = crate.consignment(seed, who, place, case, po, gross)
        # Stencils go on in the model's frame: where this crate's faces end up.
        marks = [
            ("up", crate.INK, [("-y", x - w / 2 + 0.06, z + h - 0.36)]),
            ("mark", crate.INK, [("x", -y - 0.25, z + h * 0.42), ("-x", y - 0.25, z + h * 0.42)]),
            ("fragile", crate.RED, [("y", -x - w / 2 + 0.1, z + h - 0.3)]),
        ]
        if w > 1:
            marks.append(("consign", crate.INK, [("-y", x - w / 2 + 0.12, z + 0.2)]))
        mats = crate.materials(seed, stencil, marks, plank_size=2048 if i == 0 else 1024,
                               z0=z + crate.SKID_H, suffix=f"-{i}", shared=shared)
        shared = mats
        lid = (0.035, -0.025, 0.09) if i == 3 else None
        objs = crate.crate(size, mats, seed=seed, lid_off=lid, skids=3 if w > 1 else 2)
        crate.move(objs, Matrix.Translation(at) @ Matrix.Rotation(turn, 4, "Z"))
