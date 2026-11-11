"""
Container C: a 20 ft shipping container in faded sea green, doors shut, at the end of its life:
chalky paint, wide patches rusted through, rust running from every seam, dented sides, an
owner's name painted out. The doors are the front. The geometry and wear are in
cargo/container.py.
"""

from cargo import container

TRIS = 5000
SMOOTH_ANGLE = 20  # the corrugation's bends stay crisp
AO = 2048
AO_DISTANCE = 0.25


def build():
    container.container(
        seed=3, paint=(0.045, 0.075, 0.06), code=("TXGU", "883410", "9"), wear=0.9, rust=0.9,
        chalk=0.75, n_dents=7, ink=(0.5, 0.5, 0.46), painted_out=True,
    )
