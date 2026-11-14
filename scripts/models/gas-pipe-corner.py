"""
Gas pipe corner: where the gas main comes up out of the floor and turns to run along it. A riser
through a collar bolted to the floor at x -0.3, a welded bend, and a flange facing +x at x 0.6 with
its axis 0.9 m up, for a gas-pipe or the valve to join. Its origin is on the floor.
"""

import math

import gas_main as g
import lib

ORIGIN = "model"
TRIS = 2600
AO = 1024
AO_DISTANCE = 0.25

FACE = 0.6
BEND = 0.6  # the bend's radius, to the pipe's axis
RISER = FACE - g.END - BEND  # x of the riser's axis
SEGMENTS = 10


def build():
    paint, _, bolt, _ = g.materials()
    g.pipe_end((FACE, 0, g.AXIS), "x", 1, paint, bolt, 0.4)
    cx, cz = FACE - g.END, g.AXIS - BEND
    arc = [(cx - BEND * math.cos(a), 0, cz + BEND * math.sin(a))
           for a in (math.pi / 2 * i / SEGMENTS for i in range(SEGMENTS + 1))]
    # A little further at each end, so the bend's last rings stand square under the welds.
    path = [(RISER, 0, 0.0), *arc, (cx + 0.02, 0, g.AXIS)]
    g._tag(lib.tube("bend", path, [g.R] * len(path), mat=paint, sides=g.SIDES), 0.7)
    g.bead((RISER, 0, cz), "z", paint)

    # The collar the riser comes up through, bolted to the floor.
    f = g.FLANGE_R + 0.02
    collar = [(0, f), (0.026, f), (0.03, f - 0.004), (0.03, g.R + 0.04), (0.1, g.R + 0.012),
              (0.11, g.R - 0.01)]
    g._tag(lib.lathe("collar", collar, (RISER, 0, 0), mat=paint, sides=g.SIDES,
                     caps=(True, False)), 0.2)
    g.bolts((RISER, 0, 0.03), "z", 1, bolt, circle=g.BOLT_R + 0.014)
