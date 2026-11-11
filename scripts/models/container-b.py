"""
Container B: a 20 ft shipping container in deep blue, doors shut, kept up better than most: some
chips and rust at the frame and the castings, salt and grime low down. The doors are the front.
The geometry and wear are in cargo/container.py.
"""

from cargo import container

TRIS = 5000
SMOOTH_ANGLE = 20  # the corrugation's bends stay crisp
AO = 2048
AO_DISTANCE = 0.25


def build():
    container.container(
        seed=2, paint=(0.01, 0.03, 0.095), code=("BRMU", "205718", "3"), logo="BRINEMOOR",
        wear=0.35, rust=0.4, chalk=0.25, n_dents=3,
    )
