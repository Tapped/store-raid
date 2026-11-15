// Axis-aligned boxes on the ground plane, the shape of everything a level is collided against:
// mirrors `Box` in shared/collision.ts. Game coordinates: meters, x east, z north (y up is carried
// by whatever has a box, like FLevelBox). Conversion to Unreal's centimeters and Z-up happens when
// a level is spawned, not here.
//
// shared/collision.ts also has circles for movers and resolveCircleBox/resolveCircleCircle; movement
// is the engine's character movement in the port (PORT.md), so they aren't ported. The tiles don't
// need them.

/**
 * An axis-aligned box on the ground plane (x/z). Named FBoxXZ rather than FBox, which is Unreal's
 * own 3D box and is bound to script.
 */
struct FBoxXZ
{
	float MinX = 0.0;
	float MaxX = 0.0;
	float MinZ = 0.0;
	float MaxZ = 0.0;

	float CentreX() const
	{
		return (MinX + MaxX) / 2.0;
	}

	float CentreZ() const
	{
		return (MinZ + MaxZ) / 2.0;
	}
};

namespace Level
{
	FBoxXZ MakeBoxXZ(float MinX, float MaxX, float MinZ, float MaxZ)
	{
		FBoxXZ Box;
		Box.MinX = MinX;
		Box.MaxX = MaxX;
		Box.MinZ = MinZ;
		Box.MaxZ = MaxZ;
		return Box;
	}
}
