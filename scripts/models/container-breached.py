"""
Container HB-0417, breached: the container the outbreak came out of, in Warehouse 7's quarantine.
A 20 ft container in faded blue with both doors swung wide (a quarter turn, so it stays within its
width and stands 1.1 m deeper), showing the dark inside and the split crates of "agricultural
research samples"; a forklift's tines tore a hole low in its +x side. Its number is painted along
both sides. The open doors are the front. The geometry and wear are in cargo/container.py.
"""

from cargo import container

TRIS = 9000
SMOOTH_ANGLE = 20
AO = 2048
AO_DISTANCE = 0.25


def build():
    container.container(
        seed=417, paint=(0.02, 0.05, 0.11), code=("HBXU", "041700", "4"), logo="HB-0417",
        wear=0.6, rust=0.55, chalk=0.45, open_doors=True, breach=(2.15, 0.62),
    )
