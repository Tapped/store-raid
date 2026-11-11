"""
Crate, long: a 2.4 m wooden crate for pipes or machine parts, on skids, its long sides split into
braced bays, a strapped lid, consignment marks. The builder is in cargo/crate.py.
"""

from cargo import crate

TRIS = 4000
AO = 1024
AO_DISTANCE = 0.12


def build():
    stencil = crate.consignment(21, "OSTRAND PUMPWORKS", "ROTTERDAM  NL", "1 / 2", "RP40-7719", 655)
    marks = [
        ("up", crate.INK, [("-y", -1.08, 0.4), ("y", -1.08, 0.4)]),
        ("consign", crate.INK, [("-y", -0.32, 0.2), ("y", -0.32, 0.2)]),
        ("mark", crate.INK, [("x", -0.3, 0.35), ("-x", -0.3, 0.35)]),
        ("fragile", crate.RED, [("-y", 0.5, 0.48)]),
        ("keep", crate.INK, [("y", 0.6, 0.55)]),
    ]
    mats = crate.materials(21, stencil, marks)
    crate.crate((2.4, 0.8, 0.8), mats, skids=2, seed=21)
