"""
Crate, large: a 1.2 m wooden shipping crate on skids, boards with gaps, battens and braces, a
nailed lid with steel straps, steel corner caps, stencilled THIS WAY UP, FRAGILE and consignment
marks. The builder is in cargo/crate.py.
"""

from cargo import crate

TRIS = 3500
AO = 1024
AO_DISTANCE = 0.12


def build():
    stencil = crate.consignment(11, "NORDVIK MARINE AS", "BERGEN  NO", "3 / 7", "KX88-1043", 412)
    marks = [
        ("up", crate.INK, [("-y", -0.52, 0.8), ("x", 0.28, 0.8), ("y", -0.52, 0.8)]),
        ("fragile", crate.RED, [("-y", 0.06, 0.88), ("-x", -0.3, 0.88)]),
        ("consign", crate.INK, [("-y", -0.4, 0.28), ("y", -0.4, 0.28)]),
        ("mark", crate.INK, [("x", -0.45, 0.42), ("-x", -0.25, 0.42)]),
        ("keep", crate.INK, [("x", -0.45, 0.85)]),
    ]
    mats = crate.materials(11, stencil, marks)
    crate.crate((1.2, 1.2, 1.2), mats, seed=11)
