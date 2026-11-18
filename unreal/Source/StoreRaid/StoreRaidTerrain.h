#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "StoreRaidTerrain.generated.h"

/**
 * A floor as the terrain knows it, in game meters (x right, y up, z forward): its top at Y, or for
 * stairs a ramp rising RiseHeight from Y to the side (RiseX, RiseZ) points to, one of them ±1.
 * Script fills these from its FFloor.
 */
USTRUCT(BlueprintType)
struct FStoreRaidFloor
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MinX = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MaxX = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MinZ = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MaxZ = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Y = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Thickness = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float RiseHeight = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 RiseX = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 RiseZ = 0;
};

/**
 * A box that stops movers from Y up to Y + Height, in game meters. bSeeThrough for railings,
 * chain-link and pit edges: they stop a tick, but not a look or a beam.
 */
USTRUCT(BlueprintType)
struct FStoreRaidBox
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MinX = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MaxX = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MinZ = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MaxZ = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Y = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Height = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool bSeeThrough = false;
};

/** A working light fitting's pool of light on the floor below it, which ticks keep out of. */
USTRUCT(BlueprintType)
struct FStoreRaidPool
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FVector At = FVector::ZeroVector;
	/** How far across the floor its light keeps ticks off, in meters. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Reach = 0.f;
};

/**
 * The questions about a level that ticks are moved by, on the server: shared/ticks.ts's and the
 * parts of shared/movement.ts and shared/collision.ts they use, number for number, over the level's
 * own floors and boxes rather than the engine's collision. In C++ because a search for a way across
 * the floor looks at thousands of cells, several times a second. Everything is in game meters.
 *
 * Script makes one when the level is built (Script/Ticks/TickNest.as) and gives it the level; it
 * doesn't change after, but for whether its fittings are lit.
 */
UCLASS(BlueprintType)
class STORERAID_API UStoreRaidTerrain : public UObject
{
	GENERATED_BODY()

public:
	/** The level: its floors, the boxes that stop movers, and the pools of light of its fittings. */
	UFUNCTION(BlueprintCallable, Category = "StoreRaid|Terrain")
	void Build(const TArray<FStoreRaidFloor>& InFloors, const TArray<FStoreRaidBox>& InBoxes, const TArray<FStoreRaidPool>& InPools);

	/** Whether the fittings give light: they don't with the room's lights off. */
	UFUNCTION(BlueprintCallable, Category = "StoreRaid|Terrain")
	void SetLit(bool bInLit)
	{
		if (bInLit != bLit)
		{
			Cells.Reset();
		}
		bLit = bInLit;
	}

	/** A tick's radius and height, and the steps it takes: Mechanics.StepUp and StepDown. */
	UFUNCTION(BlueprintCallable, Category = "StoreRaid|Terrain")
	void SetMover(float InRadius, float InHeight, float InStepUp, float InStepDown);

	/** The top of the highest floor under a point that isn't above `Below`; a very low number over a hole. */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	float GroundUnder(float X, float Z, float Below) const;

	/** Meters from a point up to the underside of the lowest floor over it; a very large number under open sky. */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	float Headroom(float X, float Y, float Z) const;

	/** The working fitting whose light a point on a floor is in, by its index in the pools, or -1. */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	int32 PoolOver(float X, float Y, float Z) const;

	/** Whether a walk straight across the floor from A to B stays out of fittings' light. */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	bool DarkWay(FVector A, FVector B) const;

	/**
	 * Whether nothing solid lies on the straight line between two points. `Ignore` is the index of a
	 * box to look through (the one a perched tick sits on), or -1.
	 */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	bool ClearLine(FVector A, FVector B, int32 Ignore = -1) const;

	/**
	 * Where a tick's feet would be if it stood at (X, Z) having come from height Y, or below
	 * NO_GROUND if it can't stand there: no floor within a step, something in the way, or with
	 * bDark, in a fitting's light.
	 */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	float Standing(float X, float Y, float Z, bool bDark) const;

	/** What GroundUnder() and Standing() give where there's nothing to stand on, or less. */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	static float NoGround() { return -1.0e9f; }

	/**
	 * Pushes a circle of the tick's radius at (X, Z) out of every box between `Low` and `High` in
	 * height, but `Ignore`. Gives where it ends up as (X, Z) in X and Y, and in Z which ways
	 * something stopped it: 1 along x, 2 along z, 3 both.
	 */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	FVector Slide(float X, float Z, float Low, float High, int32 Ignore) const;

	/** The share of flat speed kept going (DirX, DirZ) from a point on stairs, as paceAt() gives it. */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	float Pace(float X, float Y, float Z, float DirX, float DirZ, float Uphill) const;

	/**
	 * A way across the floor for a tick from one point to another, round racking and walls, up or
	 * down stairs and out of fittings' light, as points to walk to in turn, the goal last: false if
	 * there's none short enough to find. findPath() in shared/ticks.ts. The way is then Path().
	 */
	UFUNCTION(BlueprintCallable, Category = "StoreRaid|Terrain")
	bool FindPath(FVector From, FVector To);

	/** The way the last FindPath() found. */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	TArray<FVector> Path() const { return Way; }

	UFUNCTION(BlueprintPure, Category = "StoreRaid|Terrain")
	int32 NumBoxes() const { return Boxes.Num(); }

private:
	/** The floor under a point whose top isn't above `Below`, highest first; null if none. */
	const FStoreRaidFloor* FloorUnder(float X, float Z, float Below) const;
	static float FloorHeight(const FStoreRaidFloor& Floor, float X, float Z);
	/** Indices of the boxes or floors that may be near a point: near() in shared/spatial.ts. */
	const TArray<int32>& Near(const TMap<int64, TArray<int32>>& Grid, int32 Count, float X, float Z) const;
	template <typename T>
	static void File(TMap<int64, TArray<int32>>& Grid, const TArray<T>& All);
	/** Standing() in the dark at a cell of the search's grid, remembered. */
	bool StandCell(int32 Col, int32 Row, float Y, float& OutY);

	TArray<FStoreRaidFloor> Floors;
	TArray<FStoreRaidBox> Boxes;
	TArray<FStoreRaidPool> Pools;
	TMap<int64, TArray<int32>> FloorGrid;
	TMap<int64, TArray<int32>> BoxGrid;
	TArray<int32> AllFloors;
	TArray<int32> AllBoxes;
	bool bLit = true;
	float Radius = 0.3f;
	float Height = 0.45f;
	float StepUp = 0.35f;
	float StepDown = 0.3f;
	/** Cells the search has stood in: their height, or NaN where a tick can't stand. */
	TMap<FIntVector, float> Cells;
	TArray<FVector> Way;
};
