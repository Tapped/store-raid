#include "StoreRaidTerrain.h"

namespace
{
	/** Fewer things than this are just looked through, one by one; else a grid of CELL meters, each
	 * thing filed REACH around itself (shared/spatial.ts). */
	constexpr int32 FEW = 64;
	constexpr float GRID_CELL = 4.f;
	constexpr float GRID_REACH = 1.f;

	/** The search's cell, how many cells it looks at before giving up, and how near the goal it ends. */
	constexpr float CELL = 0.25f;
	constexpr int32 MAX_CELLS = 6000;
	constexpr float NEAR_GOAL = 0.5f;

	constexpr float NONE = -1.0e9f;

	int64 Key(int32 Col, int32 Row)
	{
		return (static_cast<int64>(Col) + 32768) * 65536 + (Row + 32768);
	}

	template <typename T>
	float DistanceToBox(const T& Box, float X, float Z)
	{
		return FMath::Sqrt(FMath::Square(FMath::Max3(Box.MinX - X, 0.f, X - Box.MaxX)) + FMath::Square(FMath::Max3(Box.MinZ - Z, 0.f, Z - Box.MaxZ)));
	}
}

void UStoreRaidTerrain::Build(const TArray<FStoreRaidFloor>& InFloors, const TArray<FStoreRaidBox>& InBoxes, const TArray<FStoreRaidPool>& InPools)
{
	Floors = InFloors;
	Boxes = InBoxes;
	Pools = InPools;
	FloorGrid.Reset();
	BoxGrid.Reset();
	File(FloorGrid, Floors);
	File(BoxGrid, Boxes);
	AllFloors.Reset();
	AllBoxes.Reset();
	for (int32 Index = 0; Index < Floors.Num(); Index++)
	{
		AllFloors.Add(Index);
	}
	for (int32 Index = 0; Index < Boxes.Num(); Index++)
	{
		AllBoxes.Add(Index);
	}
	Cells.Reset();
}

void UStoreRaidTerrain::SetMover(float InRadius, float InHeight, float InStepUp, float InStepDown)
{
	if (InRadius != Radius || InHeight != Height || InStepUp != StepUp || InStepDown != StepDown)
	{
		Cells.Reset();
	}
	Radius = InRadius;
	Height = InHeight;
	StepUp = InStepUp;
	StepDown = InStepDown;
}

template <typename T>
void UStoreRaidTerrain::File(TMap<int64, TArray<int32>>& Grid, const TArray<T>& All)
{
	for (int32 Index = 0; Index < All.Num(); Index++)
	{
		const T& Box = All[Index];
		const int32 Col0 = FMath::FloorToInt((Box.MinX - GRID_REACH) / GRID_CELL);
		const int32 Col1 = FMath::FloorToInt((Box.MaxX + GRID_REACH) / GRID_CELL);
		const int32 Row0 = FMath::FloorToInt((Box.MinZ - GRID_REACH) / GRID_CELL);
		const int32 Row1 = FMath::FloorToInt((Box.MaxZ + GRID_REACH) / GRID_CELL);
		for (int32 Col = Col0; Col <= Col1; Col++)
		{
			for (int32 Row = Row0; Row <= Row1; Row++)
			{
				Grid.FindOrAdd(Key(Col, Row)).Add(Index);
			}
		}
	}
}

const TArray<int32>& UStoreRaidTerrain::Near(const TMap<int64, TArray<int32>>& Grid, int32 Count, float X, float Z) const
{
	static const TArray<int32> Nothing;
	if (Count < FEW)
	{
		return &Grid == &FloorGrid ? AllFloors : AllBoxes;
	}
	const TArray<int32>* Found = Grid.Find(Key(FMath::FloorToInt(X / GRID_CELL), FMath::FloorToInt(Z / GRID_CELL)));
	return Found ? *Found : Nothing;
}

float UStoreRaidTerrain::FloorHeight(const FStoreRaidFloor& Floor, float X, float Z)
{
	if (Floor.RiseX == 0 && Floor.RiseZ == 0)
	{
		return Floor.Y;
	}
	const auto Along = [](float Value, float Min, float Max) { return FMath::Clamp((Value - Min) / (Max - Min), 0.f, 1.f); };
	float T = 0.f;
	if (Floor.RiseZ > 0) T = Along(Z, Floor.MinZ, Floor.MaxZ);
	else if (Floor.RiseZ < 0) T = 1.f - Along(Z, Floor.MinZ, Floor.MaxZ);
	else if (Floor.RiseX > 0) T = Along(X, Floor.MinX, Floor.MaxX);
	else T = 1.f - Along(X, Floor.MinX, Floor.MaxX);
	return Floor.Y + T * Floor.RiseHeight;
}

const FStoreRaidFloor* UStoreRaidTerrain::FloorUnder(float X, float Z, float Below) const
{
	const FStoreRaidFloor* Found = nullptr;
	float Ground = -TNumericLimits<float>::Max();
	for (const int32 Index : Near(FloorGrid, Floors.Num(), X, Z))
	{
		const FStoreRaidFloor& Floor = Floors[Index];
		if (X < Floor.MinX || X > Floor.MaxX || Z < Floor.MinZ || Z > Floor.MaxZ)
		{
			continue;
		}
		const float Top = FloorHeight(Floor, X, Z);
		if (Top <= Below && Top > Ground)
		{
			Ground = Top;
			Found = &Floor;
		}
	}
	return Found;
}

float UStoreRaidTerrain::GroundUnder(float X, float Z, float Below) const
{
	const FStoreRaidFloor* Floor = FloorUnder(X, Z, Below);
	return Floor ? FloorHeight(*Floor, X, Z) : NONE;
}

float UStoreRaidTerrain::Headroom(float X, float Y, float Z) const
{
	float Ceiling = 1.0e9f;
	for (const int32 Index : Near(FloorGrid, Floors.Num(), X, Z))
	{
		const FStoreRaidFloor& Floor = Floors[Index];
		if (X < Floor.MinX || X > Floor.MaxX || Z < Floor.MinZ || Z > Floor.MaxZ)
		{
			continue;
		}
		const float Top = FloorHeight(Floor, X, Z);
		const float Under = Top - Floor.Thickness;
		// A floor whose top is above the point is over it, however thick it is.
		if (Top > Y && Under < Ceiling)
		{
			Ceiling = Under;
		}
	}
	return Ceiling - Y;
}

int32 UStoreRaidTerrain::PoolOver(float X, float Y, float Z) const
{
	if (!bLit)
	{
		return -1;
	}
	for (int32 Index = 0; Index < Pools.Num(); Index++)
	{
		const FStoreRaidPool& Pool = Pools[Index];
		const float Above = Pool.At.Y - Y;
		if (Above < 0.f || Above > 3.4f)
		{
			continue;
		}
		if (FMath::Square(Pool.At.X - X) + FMath::Square(Pool.At.Z - Z) < Pool.Reach * Pool.Reach)
		{
			return Index;
		}
	}
	return -1;
}

bool UStoreRaidTerrain::DarkWay(FVector A, FVector B) const
{
	const int32 Steps = FMath::Max(1, FMath::CeilToInt(FMath::Sqrt(FMath::Square(B.X - A.X) + FMath::Square(B.Z - A.Z)) / 0.5f));
	for (int32 Step = 0; Step <= Steps; Step++)
	{
		const float T = static_cast<float>(Step) / Steps;
		if (PoolOver(A.X + (B.X - A.X) * T, A.Y, A.Z + (B.Z - A.Z) * T) >= 0)
		{
			return false;
		}
	}
	return true;
}

bool UStoreRaidTerrain::ClearLine(FVector A, FVector B, int32 Ignore) const
{
	const float Length = FVector::Distance(A, B);
	const int32 Steps = FMath::CeilToInt(Length / 0.25f);
	for (int32 Step = 1; Step < Steps; Step++)
	{
		const FVector P = A + (B - A) * (static_cast<float>(Step) / Steps);
		for (const int32 Index : Near(BoxGrid, Boxes.Num(), P.X, P.Z))
		{
			const FStoreRaidBox& Box = Boxes[Index];
			if (Index == Ignore || Box.bSeeThrough)
			{
				continue;
			}
			if (P.X > Box.MinX && P.X < Box.MaxX && P.Z > Box.MinZ && P.Z < Box.MaxZ && P.Y > Box.Y && P.Y < Box.Y + Box.Height)
			{
				return false;
			}
		}
	}
	return true;
}

float UStoreRaidTerrain::Standing(float X, float Y, float Z, bool bDark) const
{
	const float Ground = GroundUnder(X, Z, Y + StepUp);
	if (Ground <= NONE || Y - Ground > StepDown + 0.3f)
	{
		return NONE;
	}
	for (const int32 Index : Near(BoxGrid, Boxes.Num(), X, Z))
	{
		const FStoreRaidBox& Box = Boxes[Index];
		if (Box.Y + Box.Height <= Ground + StepUp || Box.Y >= Ground + Height)
		{
			continue;
		}
		if (DistanceToBox(Box, X, Z) < Radius)
		{
			return NONE;
		}
	}
	if (bDark && PoolOver(X, Ground, Z) >= 0)
	{
		return NONE;
	}
	return Ground;
}

FVector UStoreRaidTerrain::Slide(float X, float Z, float Low, float High, int32 Ignore) const
{
	bool bBlockedX = false;
	bool bBlockedZ = false;
	for (const int32 Index : Near(BoxGrid, Boxes.Num(), X, Z))
	{
		const FStoreRaidBox& Box = Boxes[Index];
		if (Index == Ignore || Box.Y + Box.Height <= Low || Box.Y >= High)
		{
			continue;
		}
		// resolveCircleBox() in shared/collision.ts.
		const float ClosestX = FMath::Clamp(X, Box.MinX, Box.MaxX);
		const float ClosestZ = FMath::Clamp(Z, Box.MinZ, Box.MaxZ);
		float DX = X - ClosestX;
		float DZ = Z - ClosestZ;
		const float DistSq = DX * DX + DZ * DZ;
		if (DistSq >= Radius * Radius)
		{
			continue;
		}
		if (DistSq > 1e-9f)
		{
			const float Dist = FMath::Sqrt(DistSq);
			const float Push = Radius - Dist;
			DX = DX / Dist * Push;
			DZ = DZ / Dist * Push;
		}
		else
		{
			const float Left = X - Box.MinX;
			const float Right = Box.MaxX - X;
			const float Down = Z - Box.MinZ;
			const float Up = Box.MaxZ - Z;
			const float Least = FMath::Min(FMath::Min(Left, Right), FMath::Min(Down, Up));
			DX = Least == Left ? -(Left + Radius) : (Least == Right ? Right + Radius : 0.f);
			DZ = Least == Down ? -(Down + Radius) : (Least == Up ? Up + Radius : 0.f);
		}
		X += DX;
		Z += DZ;
		bBlockedX |= DX != 0.f;
		bBlockedZ |= DZ != 0.f;
	}
	return FVector(X, Z, (bBlockedX ? 1 : 0) + (bBlockedZ ? 2 : 0));
}

float UStoreRaidTerrain::Pace(float X, float Y, float Z, float DirX, float DirZ, float Uphill) const
{
	const float Length = FMath::Sqrt(DirX * DirX + DirZ * DirZ);
	const FStoreRaidFloor* Floor = FloorUnder(X, Z, Y + StepUp);
	if (Length == 0.f || !Floor || (Floor->RiseX == 0 && Floor->RiseZ == 0) || Y - FloorHeight(*Floor, X, Z) > StepDown)
	{
		return 1.f;
	}
	const float Across = Floor->RiseX != 0 ? Floor->MaxX - Floor->MinX : Floor->MaxZ - Floor->MinZ;
	const float Grade = Floor->RiseHeight / Across * (DirX * Floor->RiseX + DirZ * Floor->RiseZ) / Length;
	const float Effort = 1.f + Uphill * FMath::Max(0.f, Grade);
	return 1.f / FMath::Sqrt(1.f + Grade * Grade) / Effort;
}

bool UStoreRaidTerrain::StandCell(int32 Col, int32 Row, float Y, float& OutY)
{
	const FIntVector K(Col, Row, FMath::RoundToInt(Y * 100.f));
	if (const float* Known = Cells.Find(K))
	{
		OutY = *Known;
		return !FMath::IsNaN(*Known);
	}
	const float At = Standing(Col * CELL, Y, Row * CELL, true);
	const bool bStands = At > NONE;
	Cells.Add(K, bStands ? At : NAN);
	OutY = At;
	return bStands;
}

bool UStoreRaidTerrain::FindPath(FVector From, FVector To)
{
	TArray<FVector>& OutPath = Way;
	OutPath.Reset();
	struct FCell
	{
		int32 Col;
		int32 Row;
		float Y;
		float Cost;
		float Score;
		int32 Parent;
	};
	const auto ColOf = [](float V) { return FMath::RoundToInt(V / CELL); };
	const int32 GoalCol = ColOf(To.X);
	const int32 GoalRow = ColOf(To.Z);
	const int32 Within = FMath::RoundToInt(NEAR_GOAL / CELL);
	const auto Guess = [&](int32 C, int32 R) { return FMath::Sqrt(static_cast<float>(FMath::Square(C - GoalCol) + FMath::Square(R - GoalRow))) * CELL; };
	const auto KeyOf = [](int32 C, int32 R, float Y) { return FIntVector(C, R, FMath::RoundToInt(Y / 1.5f)); };

	// Every cell reached, and a heap of indices into it with the least score on top.
	TArray<FCell> All;
	All.Reserve(MAX_CELLS * 2);
	TArray<int32> Open;
	const auto Less = [&All](int32 A, int32 B) { return All[A].Score < All[B].Score; };
	TMap<FIntVector, float> Best;
	All.Add({ ColOf(From.X), ColOf(From.Z), static_cast<float>(From.Y), 0.f, 0.f, -1 });
	Open.HeapPush(0, Less);
	Best.Add(KeyOf(All[0].Col, All[0].Row, From.Y), 0.f);

	static const int32 NEIGHBOURS[8][2] = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 }, { 1, 1 }, { 1, -1 }, { -1, 1 }, { -1, -1 } };
	int32 Looked = 0;
	while (Open.Num() > 0 && Looked++ < MAX_CELLS)
	{
		int32 Index;
		Open.HeapPop(Index, Less, EAllowShrinking::No);
		const FCell Cell = All[Index];
		if (FMath::Abs(Cell.Col - GoalCol) <= Within && FMath::Abs(Cell.Row - GoalRow) <= Within && FMath::Abs(Cell.Y - To.Y) < 1.2f)
		{
			OutPath.Add(FVector(To.X, Cell.Y, To.Z));
			for (int32 At = Index; At >= 0 && All[At].Parent >= 0; At = All[At].Parent)
			{
				OutPath.Insert(FVector(All[At].Col * CELL, All[At].Y, All[At].Row * CELL), 0);
			}
			return true;
		}
		for (const auto& Step : NEIGHBOURS)
		{
			const int32 C = Cell.Col + Step[0];
			const int32 R = Cell.Row + Step[1];
			float Y = 0.f;
			if (!StandCell(C, R, Cell.Y, Y))
			{
				continue;
			}
			if (Step[0] != 0 && Step[1] != 0)
			{
				// Cornerwise needs both cells beside it, or the way cuts a pit's corner or a railing's end.
				float Side = 0.f;
				if (!StandCell(C, Cell.Row, Cell.Y, Side) || !StandCell(Cell.Col, R, Cell.Y, Side))
				{
					continue;
				}
			}
			const float Cost = Cell.Cost + (Step[0] != 0 && Step[1] != 0 ? UE_SQRT_2 : 1.f) * CELL;
			const FIntVector K = KeyOf(C, R, Y);
			const float* Known = Best.Find(K);
			if (Known && *Known <= Cost)
			{
				continue;
			}
			Best.Add(K, Cost);
			All.Add({ C, R, Y, Cost, Cost + Guess(C, R), Index });
			Open.HeapPush(All.Num() - 1, Less);
		}
	}
	return false;
}
