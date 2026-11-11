"""
Container A: a 20 ft shipping container in oxide red, doors shut, well used: chips through to
primer and rust round the frame, rust running from under the top rail, a few dents. The doors are
the front. The geometry and wear are in cargo/container.py.
"""

from cargo import container

TRIS = 5000
SMOOTH_ANGLE = 20  # the corrugation's bends stay crisp
AO = 2048
AO_DISTANCE = 0.25


def build():
    container.container(
        seed=1, paint=(0.115, 0.017, 0.013), code=("HLVU", "471203", "6"), logo="HALVARD",
        wear=0.5, rust=0.5, chalk=0.3,
    )
