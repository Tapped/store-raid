// A level's props, drawn: what client/src/dressing.ts did. Each model is one instanced static mesh
// (Nanite, from `pnpm run ue import`), every prop of it an instance; a model that isn't imported is
// drawn as a box of its size, as the web game's placeholders were. They're only drawn: what they
// block is in the level's boxes. Built on clients, never the dedicated server.

class ALevelProps : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	USceneComponent Root;
	default Root.Mobility = EComponentMobility::Static;

	/** The instanced mesh of each model, by EProp, made as the first of it is placed. */
	TMap<int, UInstancedStaticMeshComponent> Meshes;
	/** The boxes standing in for models that aren't imported. */
	UInstancedStaticMeshComponent Stand;

	/** Draws the props but those at `Skip`, by their index: ones ALevelFittings draws itself. */
	void Build(TArray<FPropSpawn> Props, TArray<int> Skip)
	{
		TArray<FString> Missing;
		for (int Index = 0; Index < Props.Num(); Index++)
		{
			if (Skip.Contains(Index))
				continue;
			const FPropSpawn& Prop = Props[Index];
			UInstancedStaticMeshComponent Mesh = MeshFor(Prop.Model, Missing);
			if (Mesh != nullptr)
				Mesh.AddInstance(FTransform(FRotator(0, Math::RadiansToDegrees(Prop.Turn), 0), World::ToWorld(Prop.X, Prop.Y, Prop.Z)), true);
			else
				StandIn(Prop);
		}
		FString Names;
		for (FString Name : Missing)
			Names += (Names.IsEmpty() ? "" : ", ") + Name;
		if (!Names.IsEmpty())
			Log(f"StoreRaid: props drawn as boxes until they're imported: {Names}");
	}

	/** The instanced mesh for a model, or null if it isn't imported. */
	UInstancedStaticMeshComponent MeshFor(EProp Model, TArray<FString>& Missing)
	{
		UInstancedStaticMeshComponent Found;
		if (Meshes.Find(int(Model), Found))
			return Found;
		const FString Name = Props::Name(Model);
		UStaticMesh Mesh = Models::Mesh("props/" + Name);
		if (Mesh == nullptr)
		{
			if (!Missing.Contains(Name))
				Missing.Add(Name);
			return nullptr;
		}
		UInstancedStaticMeshComponent Made = UInstancedStaticMeshComponent::Create(this, FName(Name));
		Made.SetStaticMesh(Mesh);
		Made.SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Made.SetMobility(EComponentMobility::Static);
		Meshes.Add(int(Model), Made);
		return Made;
	}

	/**
	 * A box of the prop's size where its model would stand: on the floor from its origin up, under the
	 * ceiling from its origin down, on a wall from its origin up and out into the room.
	 */
	void StandIn(FPropSpawn Prop)
	{
		if (Stand == nullptr)
		{
			Stand = UInstancedStaticMeshComponent::Create(this, n"StandIn");
			Stand.SetStaticMesh(Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cube.Cube")));
			Stand.SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Stand.SetMobility(EComponentMobility::Static);
		}
		const FPropKind Kind = Props::Kind(Prop.Model);
		float X = Prop.X;
		float Y = Prop.Y + Kind.Height / 2;
		float Z = Prop.Z;
		if (Kind.Mount == EPropMount::Ceiling)
			Y = Prop.Y - Kind.Height / 2;
		if (Kind.Mount == EPropMount::Wall)
		{
			X += Math::Sin(Prop.Turn) * Kind.Depth / 2;
			Z += Math::Cos(Prop.Turn) * Kind.Depth / 2;
		}
		// The cube is a meter on a side: its x (north, forward) is the prop's depth, y its width.
		Stand.AddInstance(FTransform(FRotator(0, Math::RadiansToDegrees(Prop.Turn), 0), World::ToWorld(X, Y, Z), FVector(Kind.Depth, Kind.Width, Kind.Height)), true);
	}
}
