"""
Gas pipe: 2 m of a fat gas main in chipped yellow paint, 0.54 m across with its axis 0.9 m up, on
two saddle stands, a bolted flange at each end and a weld round the middle. It runs along x and its
flange faces are its ends (x ±1), so lengths, the corner and the valve join end to end. Its origin
is on the floor under its middle.
"""

import gas_main as g

ORIGIN = "model"
TRIS = 3600
AO = 1024
AO_DISTANCE = 0.25

LENGTH = 2.0
STANDS = (-0.55, 0.55)


def build():
    paint, stand, bolt, _ = g.materials()
    half = LENGTH / 2
    g.pipe_end((-half, 0, g.AXIS), "x", -1, paint, bolt, 0.1)
    g.pipe_end((half, 0, g.AXIS), "x", 1, paint, bolt, 0.6)
    g.pipe(-half + g.END, 0, paint, 0.3)
    g.pipe(0, half - g.END, paint, 0.8)
    g.bead((0, 0, g.AXIS), "x", paint)
    for i, x in enumerate(STANDS):
        g.stand(x, stand, bolt, seed=0.2 + 0.5 * i)
