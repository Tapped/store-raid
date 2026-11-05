"""
First-person hand, gripping: hand.py's glove with the fingers closed, to hold a phone or a box edge.
"""

import hand
from hand import AO_DISTANCE, ORIGIN, SMOOTH_ANGLE, TRIS  # noqa: F401  build settings

OUT = "models/characters/hand-grip.glb"


def build():
    hand.build(curl=(48, 62, 40), thumb_curl=(25, 30))
