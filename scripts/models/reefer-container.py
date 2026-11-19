"""
Reefer container: a 20 ft refrigerated container in off-white, its blind end the refrigeration
unit (condenser grille, fan, access panels, the controller whose display glows, the power cable
on its hook), its sides finely ribbed. The doors are the front. Warehouse 7's reefer section
stands them in rows. The geometry and wear are in cargo/container.py.
"""

from cargo import container

TRIS = 9000
SMOOTH_ANGLE = 20
AO = 2048
AO_DISTANCE = 0.25


def build():
    container.container(
        seed=21, paint=(0.3, 0.31, 0.3), code=("NFRU", "530418", "2"), logo="NORDFRYS",
        wear=0.18, rust=0.12, chalk=0.15, size_type="22R1", ink=(0.03, 0.06, 0.12), reefer=True,
    )
