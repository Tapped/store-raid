// Something that can be carried: a phone, flashlight, TV, box or sofa. A physics body simulated on
// the server (Chaos, as Havok was in server/src/physics.ts) and replicated with the engine's physics
// replication; drawn as a box of its size until its model is imported. Hands.as picks it up, carries
// it and lets it go, on the server.
//
// What collides with what, as the layers in physics.ts: items lie on the level and on each other.
// Players shove two-handed ones through their shover (a second capsule, see StoreRaidCharacter.as)
// and step over one-handed ones; their own capsule passes through every item, so items never stop
// them. Carried and just-dropped items pass through players, who'd knock them about or catch them.
class AStoreRaidItem : AActor
{
	default bReplicates = true;
	default bAlwaysRelevant = true;

	UPROPERTY(DefaultComponent, RootComponent)
	UStaticMeshComponent Mesh;

	/** A flashlight's beam, from its lens at +x (Unreal's +Y), while it's on. */
	UPROPERTY(DefaultComponent, Attach = Mesh)
	USpotLightComponent Beam;

	UPROPERTY(ReplicatedUsing = OnRep_Kind)
	EItemKind Kind = EItemKind::Phone;

	/** Whether a flashlight is switched on. */
	UPROPERTY(ReplicatedUsing = OnRep_On)
	bool bOn = false;

	/** Where it starts, in game meters: where it goes back to after falling out of the level. */
	FVector Spawn;

	// What Hands.as keeps about it on the server.
	/** Being carried: no gravity, steered by Hands::Carry. */
	bool bLifted = false;
	/** Seconds left of falling through players after being dropped. */
	float Falling = 0;
	/** Seconds it's been further than MAX_CARRY_LAG from where it's carried. */
	float Lagging = 0;

	bool bSetUp = false;

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		SetUp();
	}

	UFUNCTION()
	void OnRep_Kind()
	{
		bSetUp = false;
		SetUp();
	}

	UFUNCTION()
	void OnRep_On()
	{
		Beam.SetVisibility(bOn);
	}

	FItemKindInfo Info() const
	{
		return Items::Kind(Kind);
	}

	/** The box of its size, its mass, and how it collides when lying loose. */
	void SetUp()
	{
		if (bSetUp)
			return;
		bSetUp = true;
		const FItemKindInfo KindInfo = Info();
		Mesh.SetStaticMesh(Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cube.Cube")));
		// Game x (long side) is Unreal's Y, game z (depth) is Unreal's X; the cube is 1 m on a side.
		Mesh.SetWorldScale3D(FVector(KindInfo.Size.Z, KindInfo.Size.X, KindInfo.Size.Y));
		UMaterialInstanceDynamic Material = Mesh.CreateDynamicMaterialInstance(0, Cast<UMaterialInterface>(LoadObject(nullptr, "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial")));
		if (Material != nullptr)
			Material.SetVectorParameterValue(n"Color", KindInfo.Colour);

		Mesh.SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		Mesh.SetCollisionObjectType(ECollisionChannel::PhysicsBody);
		Mesh.SetCollisionResponseToAllChannels(ECollisionResponse::ECR_Ignore);
		Mesh.SetCollisionResponseToChannel(ECollisionChannel::WorldStatic, ECollisionResponse::ECR_Block);
		Mesh.SetCollisionResponseToChannel(ECollisionChannel::WorldDynamic, ECollisionResponse::ECR_Block);
		Mesh.SetCollisionResponseToChannel(ECollisionChannel::PhysicsBody, ECollisionResponse::ECR_Block);
		Mesh.SetCollisionResponseToChannel(ECollisionChannel::Visibility, ECollisionResponse::ECR_Block);
		Mesh.SetSimulatePhysics(true);
		Mesh.SetMassOverrideInKg(NAME_None, Math::Max(0.2, KindInfo.Size.X * KindInfo.Size.Y * KindInfo.Size.Z * Items::DENSITY), true);
		SetShovable(true);
		SetReplicateMovement(true);

		Beam.SetVisibility(false);
		if (Kind == EItemKind::Flashlight)
		{
			// The spot shines along its +X: turned to the flashlight's +Y, its front, at the lens.
			Beam.SetRelativeLocation(FVector(0, 0.5, 0));
			Beam.SetRelativeRotation(FRotator(0, 90, 0));
			Beam.SetMobility(EComponentMobility::Movable);
			Beam.SetIntensityUnits(ELightUnits::Lumens);
			Beam.SetIntensity(1500);
			Beam.SetAttenuationRadius(2500);
			Beam.SetOuterConeAngle(24);
			Beam.SetInnerConeAngle(12);
			Beam.SetLightColor(FLinearColor(1.0, 0.95, 0.85));
			Beam.SetCastShadows(true);
			Beam.SetVisibility(bOn);
		}
	}

	/** Whether players' shovers push it: two-handed things lying loose, never one-handed ones. */
	void SetShovable(bool bLoose)
	{
		const bool bShoved = bLoose && Info().Hands == 2;
		Mesh.SetCollisionResponseToChannel(ECollisionChannel::Pawn, bShoved ? ECollisionResponse::ECR_Block : ECollisionResponse::ECR_Ignore);
	}

	/** Where it is, in game meters: x east, y up, z north. */
	FVector GamePosition() const
	{
		const FVector At = ActorLocation;
		return FVector(At.Y / 100.0, At.Z / 100.0, At.X / 100.0);
	}
}
