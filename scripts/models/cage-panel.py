"""
Cage panel: 2 m of chain-link partition between two safety-yellow posts with a top rail, 2.4 m
high, for caging bonded stores in; panels butt end to end. The mesh is an alpha-tested texture
(glTF alphaMode MASK). The builder is in cargo/cage.py.
"""

from cargo import cage

TRIS = 1200
AO = 512
AO_DISTANCE = 0.1


def build():
    cage.panel()
