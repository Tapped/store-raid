// Models imported from ../assets by `pnpm run ue import` (Tools/import/): each in
// /Game/Models/<folder>/<name>/, its mesh named <name>, with Nanite. They face north (Unreal's +X)
// with their right to the east (+Y), as the game's models face +z, so a model placed with a yaw in
// the game's degrees (0 north, 90 east) faces that way. Their origin is where the model has it.

namespace Models
{
	/** The static mesh of a model by its path under assets/models, as `level/truck`; null if it isn't imported. */
	UStaticMesh Mesh(FString Name)
	{
		return Cast<UStaticMesh>(LoadObject(nullptr, MeshPath(Name)));
	}

	/** The skeletal mesh of a skinned model (`characters/ch35`); null if it isn't imported. */
	USkeletalMesh Skinned(FString Name)
	{
		return Cast<USkeletalMesh>(LoadObject(nullptr, MeshPath(Name)));
	}

	FString MeshPath(FString Name)
	{
		FString Folder;
		FString Base;
		if (!Name.Split("/", Folder, Base, ESearchCase::CaseSensitive, ESearchDir::FromEnd))
			Base = Name;
		return f"/Game/Models/{Name}/{Base}.{Base}";
	}
}

/** A model put down by sr.model on this machine only, to look at. */
class AModelOnShow : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	USceneComponent Root;

	UPROPERTY(DefaultComponent, Attach = Root)
	UStaticMeshComponent Static;
	default Static.SetCollisionEnabled(ECollisionEnabled::NoCollision);

	UPROPERTY(DefaultComponent, Attach = Root)
	USkeletalMeshComponent Skinned;
	default Skinned.SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

// sr.model <name> <x> <y> <z> [yaw]: puts a model (its path under assets/models, as `level/truck`) at
// this point in game meters, facing this way in degrees (0 north, 90 east), on this machine only,
// with no collision. sr.model clear takes them all away again.
const FConsoleCommand ModelCommand("sr.model", n"OnModelCommand");
void OnModelCommand(TArray<FString> Arguments)
{
	if (Arguments.Num() == 1 && Arguments[0] == "clear")
	{
		TArray<AModelOnShow> Shown;
		GetAllActorsOfClass(Shown);
		for (AModelOnShow Model : Shown)
			Model.DestroyActor();
		Log(f"StoreRaid model: cleared {Shown.Num()}");
		return;
	}
	if (Arguments.Num() < 4)
	{
		Log("StoreRaid model: sr.model <name> <x> <y> <z> [yaw], or sr.model clear");
		return;
	}
	const FString Name = Arguments[0];
	const FVector At = World::ToWorld(String::Conv_StringToDouble(Arguments[1]), String::Conv_StringToDouble(Arguments[2]), String::Conv_StringToDouble(Arguments[3]));
	const float Yaw = Arguments.Num() >= 5 ? String::Conv_StringToDouble(Arguments[4]) : 0.0;
	UStaticMesh Static = Models::Mesh(Name);
	USkeletalMesh Skinned = Static == nullptr ? Models::Skinned(Name) : nullptr;
	if (Static == nullptr && Skinned == nullptr)
	{
		Log(f"StoreRaid model: {Name} isn't imported ({Models::MeshPath(Name)}): pnpm run ue import {Name}");
		return;
	}
	AModelOnShow Model = Cast<AModelOnShow>(SpawnActor(AModelOnShow, At, FRotator(0, Yaw, 0)));
	if (Static != nullptr)
		Model.Static.SetStaticMesh(Static);
	else
		Model.Skinned.SetSkeletalMeshAsset(Skinned);
	Log(f"StoreRaid model: {Name} at {At}");
}
