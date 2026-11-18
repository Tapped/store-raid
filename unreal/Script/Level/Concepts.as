// Models on show in the playground, as CONCEPTS in client/src/playground.ts: new models stood about the
// hall to look at in the game's light, drawn on every screen, with no collision and no part in the
// game. Each is a model's path under assets/models, imported by `pnpm run ue import`; one that isn't
// imported is left out.

namespace Concepts
{
	/** A model on show: where it stands in game meters, on the floor at Y, facing Yaw (0 north, 90 east). */
	struct FConcept
	{
		FString Model;
		float X = 0;
		float Y = 0;
		float Z = 0;
		float Yaw = 0;
	}

	FConcept Make(FString Model, float X, float Y, float Z, float Yaw)
	{
		FConcept Concept;
		Concept.Model = Model;
		Concept.X = X;
		Concept.Y = Y;
		Concept.Z = Z;
		Concept.Yaw = Yaw;
		return Concept;
	}

	TArray<FConcept> Playground()
	{
		TArray<FConcept> Result;
		// The zombie (`pnpm run zombie`), standing in the hall in front of where players come in, facing them.
		Result.Add(Make("characters/zombie", -2, 0, -5, 180));
		return Result;
	}
}

/** The models on show in a level, drawn on this machine only. */
class ALevelConcepts : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	USceneComponent Root;

	void Build(TArray<Concepts::FConcept> Shown)
	{
		for (const Concepts::FConcept& Concept : Shown)
		{
			UStaticMesh Mesh = Models::Mesh(Concept.Model);
			if (Mesh == nullptr)
			{
				Log(f"StoreRaid concepts: {Concept.Model} isn't imported: pnpm run ue import {Concept.Model}");
				continue;
			}
			UStaticMeshComponent Drawn = UStaticMeshComponent::Create(this);
			Drawn.SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Drawn.SetStaticMesh(Mesh);
			Drawn.SetWorldLocationAndRotation(World::ToWorld(Concept.X, Concept.Y, Concept.Z), FRotator(0, Concept.Yaw, 0));
		}
	}
}
