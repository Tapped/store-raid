"""
Drum group: four 200 litre steel drums on a block pallet, strapped twice round: blue, red, black
and green, hazard diamonds and product labels, paint worn at the hoops and chimes, one dented.
The builder is in cargo/drum.py.
"""

from cargo import drum

TRIS = 4500
SMOOTH_ANGLE = 40  # 20-sided drums shade round
AO = 1024
AO_DISTANCE = 0.15


def build():
    drum.group()
