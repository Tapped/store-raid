"""
Stone wall, end: where the dry-stone field wall has tumbled down, from full height at its left
end (to meet a stone-wall segment) to a low ragged stump and a spill of stones on the ground.
"""

import random

import lib
import village_props as vp

OUT = "models/village/stone-wall-end.glb"
ORIGIN = "bottom"
TRIS = 2500
AO = 1024
AO_DISTANCE = 0.2
SMOOTH_ANGLE = 48

WIDTH = 1.2


def build():
    rng = random.Random(1931)
    stones = vp.stone_material("stones", 1024, moss=0.8, lichen=0.7)
    x0, x1 = -WIDTH / 2, WIDTH / 2

    def height_at(x):
        if x < -0.3:
            return 1.0
        if x < 0.15:
            return 1.0 - 0.75 * (x + 0.3) / 0.45
        return max(0.0, 0.25 - (x - 0.15) * 1.2)

    def spill(size):
        # Thrown down off the top: on the ground beyond the stump and against its faces.
        if rng.random() < 0.3:
            return None
        x = rng.uniform(-0.1, x1 - size[0] * 0.45)
        y = rng.uniform(-0.3, 0.3)
        return (x, y, size[2] * 0.4, rng.uniform(-1.5, 1.5),
                (rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35)))

    vp.dry_wall(stones, stones, rng, x0, x1, height_at=height_at, spill=spill, periodic=False,
                scale=0.75)
    # A heap of thrown-down stones round the stump, thinning out away from it.
    for i in range(16):
        t = rng.random() ** 0.7
        x = -0.1 + t * 0.62
        sz = rng.uniform(0.14, 0.36) * (1.15 - 0.5 * t)
        size = (sz * rng.uniform(1.0, 1.5), sz * rng.uniform(0.8, 1.2), sz * rng.uniform(0.55, 0.85))
        heap = max(0.0, 0.32 - 0.45 * t) * rng.uniform(0.3, 1.0)
        y = rng.uniform(-0.36, 0.36) * (0.6 + 0.4 * t)
        vp.stone("rubble", size, (x, y, heap + size[2] * 0.4), stones, rng.random(),
                 cuts=2 if sz > 0.27 else 1, roundness=rng.uniform(0.4, 0.75),
                 lump=rng.uniform(0.08, 0.15), turn=rng.uniform(-1.5, 1.5),
                 tilt=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4)), facets=rng.randint(0, 2))
    # The left end meets a wall segment: cut there like the segment's own seams.
    for o in [o for o in list(lib.bpy.context.scene.objects) if o.type == "MESH"]:
        xs = [v.co.x for v in o.data.vertices]
        if xs and min(xs) < x0:
            vp.clip(o, (x0, 0, 0), (-1, 0, 0))
    vp.clip_ground()
    vp.report("stone-wall-end")
