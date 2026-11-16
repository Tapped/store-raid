#include "StoreRaidMovement.h"

#include "Components/CapsuleComponent.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"

namespace
{
	constexpr float CM = 100.f;

	/**
	 * A move as the client remembers it to send and replay. Only the run input goes with it: stamina
	 * isn't put back on replay, so a replay after a correction carries on from the server's stamina.
	 */
	class FSavedMove_StoreRaid : public FSavedMove_Character
	{
	public:
		using Super = FSavedMove_Character;

		bool bSavedWantsToRun = false;

		virtual void Clear() override
		{
			Super::Clear();
			bSavedWantsToRun = false;
		}

		virtual uint8 GetCompressedFlags() const override
		{
			uint8 Flags = Super::GetCompressedFlags();
			if (bSavedWantsToRun)
			{
				Flags |= FLAG_Custom_0;
			}
			return Flags;
		}

		virtual bool CanCombineWith(const FSavedMovePtr& NewMove, ACharacter* InCharacter, float MaxDelta) const override
		{
			if (bSavedWantsToRun != static_cast<const FSavedMove_StoreRaid*>(NewMove.Get())->bSavedWantsToRun)
			{
				return false;
			}
			return Super::CanCombineWith(NewMove, InCharacter, MaxDelta);
		}

		virtual void SetMoveFor(ACharacter* C, float InDeltaTime, FVector const& NewAccel, FNetworkPredictionData_Client_Character& ClientData) override
		{
			Super::SetMoveFor(C, InDeltaTime, NewAccel, ClientData);
			if (const UStoreRaidMovement* Movement = Cast<UStoreRaidMovement>(C->GetCharacterMovement()))
			{
				bSavedWantsToRun = Movement->bWantsToRun;
			}
		}

		virtual void PrepMoveFor(ACharacter* C) override
		{
			Super::PrepMoveFor(C);
			if (UStoreRaidMovement* Movement = Cast<UStoreRaidMovement>(C->GetCharacterMovement()))
			{
				Movement->bWantsToRun = bSavedWantsToRun;
			}
		}
	};

	class FNetworkPredictionData_Client_StoreRaid : public FNetworkPredictionData_Client_Character
	{
	public:
		explicit FNetworkPredictionData_Client_StoreRaid(const UCharacterMovementComponent& Movement)
			: FNetworkPredictionData_Client_Character(Movement)
		{
		}

		virtual FSavedMovePtr AllocateNewMove() override { return FSavedMovePtr(new FSavedMove_StoreRaid()); }
	};
}

void FStoreRaidMoveResponse::ServerFillResponseData(const UCharacterMovementComponent& CharacterMovement, const FClientAdjustment& PendingAdjustment)
{
	FCharacterMoveResponseDataContainer::ServerFillResponseData(CharacterMovement, PendingAdjustment);
	const UStoreRaidMovement& Movement = static_cast<const UStoreRaidMovement&>(CharacterMovement);
	Stamina = Movement.Stamina;
	bWinded = Movement.bWinded;
}

bool FStoreRaidMoveResponse::Serialize(UCharacterMovementComponent& CharacterMovement, FArchive& Ar, UPackageMap* PackageMap)
{
	if (!FCharacterMoveResponseDataContainer::Serialize(CharacterMovement, Ar, PackageMap))
	{
		return false;
	}
	if (IsCorrection())
	{
		uint8 Winded = bWinded ? 1 : 0;
		Ar << Stamina;
		Ar << Winded;
		bWinded = Winded != 0;
	}
	return !Ar.IsError();
}

UStoreRaidMovement::UStoreRaidMovement()
{
	// Velocity follows the input at once, on the ground and in the air, as stepMover's did.
	MaxAcceleration = 100000.f;
	BrakingDecelerationWalking = 100000.f;
	BrakingDecelerationFalling = 100000.f;
	GroundFriction = 1000.f;
	FallingLateralFriction = 1000.f;
	AirControl = 1.f;
	AirControlBoostMultiplier = 1.f;
	bMaintainHorizontalGroundVelocity = true;
	bOrientRotationToMovement = false;
	NavAgentProps.bCanCrouch = false;
	SetMoveResponseDataContainer(StoreRaidMoveResponse);
	SetMechanics(FStoreRaidMechanics());
}

void UStoreRaidMovement::SetMechanics(const FStoreRaidMechanics& InMechanics)
{
	Mechanics = InMechanics;
	MaxWalkSpeed = Mechanics.WalkSpeed * CM;
	JumpZVelocity = Mechanics.JumpSpeed * CM;
	// The world's gravity is the engine's 9.8 m/s/s.
	GravityScale = Mechanics.Gravity / 9.8f;
	MaxStepHeight = Mechanics.StepUp * CM;
}

void UStoreRaidMovement::Rest()
{
	Stamina = 1.f;
	bWinded = false;
	bRunning = false;
}

bool UStoreRaidMovement::IsClimbing() const
{
	return MovementMode == MOVE_Custom && CustomMovementMode == static_cast<uint8>(EStoreRaidMove::Climb);
}

FVector UStoreRaidMovement::Feet() const
{
	const UCapsuleComponent* Capsule = CharacterOwner ? CharacterOwner->GetCapsuleComponent() : nullptr;
	const float HalfHeight = Capsule ? Capsule->GetScaledCapsuleHalfHeight() : 0.f;
	return UpdatedComponent->GetComponentLocation() - FVector(0.f, 0.f, HalfHeight);
}

void UStoreRaidMovement::GetPace(FVector Direction, float& OutSpeed, float& OutEffort) const
{
	OutSpeed = 1.f;
	OutEffort = 1.f;
	const FVector Flat = Direction.GetSafeNormal2D();
	if (Flat.IsNearlyZero() || !IsMovingOnGround() || !CurrentFloor.IsWalkableFloor())
	{
		return;
	}
	const FVector Normal = CurrentFloor.HitResult.ImpactNormal;
	if (Normal.Z > 0.999f || Normal.Z <= KINDA_SMALL_NUMBER)
	{
		return;
	}
	// Meters up per meter across going this way: below 0 going down.
	const float Grade = -(Normal.X * Flat.X + Normal.Y * Flat.Y) / Normal.Z;
	OutEffort = 1.f + Mechanics.Uphill * FMath::Max(0.f, Grade);
	OutSpeed = 1.f / FMath::Sqrt(1.f + Grade * Grade) / OutEffort;
}

float UStoreRaidMovement::GetMaxSpeed() const
{
	if (IsClimbing())
	{
		return Mechanics.ClimbSpeed * CM;
	}
	float Speed = (bRunning ? Mechanics.RunSpeed : Mechanics.WalkSpeed) * CM;
	if (IsMovingOnGround())
	{
		float Pace, Effort;
		GetPace(Acceleration, Pace, Effort);
		Speed *= Pace;
	}
	return Speed;
}

void UStoreRaidMovement::UpdateFromCompressedFlags(uint8 Flags)
{
	Super::UpdateFromCompressedFlags(Flags);
	bWantsToRun = (Flags & FSavedMove_Character::FLAG_Custom_0) != 0;
}

FNetworkPredictionData_Client* UStoreRaidMovement::GetPredictionData_Client() const
{
	if (!ClientPredictionData)
	{
		UStoreRaidMovement* Self = const_cast<UStoreRaidMovement*>(this);
		Self->ClientPredictionData = new FNetworkPredictionData_Client_StoreRaid(*this);
	}
	return ClientPredictionData;
}

const FStoreRaidLadder* UStoreRaidMovement::LadderAt(const FVector& At) const
{
	const float StepDown = Mechanics.StepDown * CM;
	for (const FStoreRaidLadder& Ladder : Ladders)
	{
		if (At.X >= Ladder.Min.X && At.X <= Ladder.Max.X && At.Y >= Ladder.Min.Y && At.Y <= Ladder.Max.Y
			&& At.Z >= Ladder.Min.Z - StepDown && At.Z <= Ladder.Max.Z)
		{
			return &Ladder;
		}
	}
	return nullptr;
}

float UStoreRaidMovement::GroundUnder(const FVector& At) const
{
	const FVector Start = At + FVector(0.f, 0.f, Mechanics.StepUp * CM);
	const FVector End = At - FVector(0.f, 0.f, 100000.f);
	FCollisionQueryParams Params(SCENE_QUERY_STAT(StoreRaidGround), false, CharacterOwner);
	FHitResult Hit;
	if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, UpdatedComponent->GetCollisionObjectType(), Params))
	{
		return Hit.ImpactPoint.Z;
	}
	return -TNumericLimits<float>::Max();
}

void UStoreRaidMovement::UpdateCharacterStateBeforeMovement(float DeltaSeconds)
{
	// What they push, as stepMover's input: up to 1 long, flat.
	FVector Input = GetCurrentAcceleration() / FMath::Max(GetMaxAcceleration(), 1.f);
	Input.Z = 0.f;

	// On a ladder when pushing into it, or anywhere off the ground in front of it.
	const FVector At = Feet();
	const FStoreRaidLadder* Ladder = bCanClimb ? LadderAt(At) : nullptr;
	bool bClimb = false;
	if (Ladder)
	{
		const float Into = FVector::DotProduct(Input, Ladder->Toward);
		bClimb = Into > 0.2f || At.Z > GroundUnder(At) + Mechanics.StepDown * CM;
	}
	if (bClimb && !IsClimbing())
	{
		SetMovementMode(MOVE_Custom, static_cast<uint8>(EStoreRaidMove::Climb));
	}
	else if (!bClimb && IsClimbing())
	{
		SetMovementMode(MOVE_Falling);
	}

	// Running takes stamina, more going up, and only happens moving, off ladders, with some left.
	float Pace = 1.f, Effort = 1.f;
	GetPace(Input, Pace, Effort);
	bRunning = bWantsToRun && !IsClimbing() && Input.SizeSquared() > 0.f && !bWinded;
	if (bRunning)
	{
		Stamina = FMath::Max(0.f, Stamina - DeltaSeconds * Effort / Mechanics.RunTime);
		if (Stamina <= 0.f)
		{
			bWinded = true;
		}
	}
	else
	{
		Stamina = FMath::Min(1.f, Stamina + DeltaSeconds / Mechanics.RestTime);
		if (Stamina >= Mechanics.RunAgain)
		{
			bWinded = false;
		}
	}

	Super::UpdateCharacterStateBeforeMovement(DeltaSeconds);
}

void UStoreRaidMovement::PhysCustom(float DeltaTime, int32 Iterations)
{
	if (IsClimbing())
	{
		PhysClimb(DeltaTime, Iterations);
		return;
	}
	Super::PhysCustom(DeltaTime, Iterations);
}

void UStoreRaidMovement::PhysClimb(float DeltaTime, int32 Iterations)
{
	if (DeltaTime < MIN_TICK_TIME)
	{
		return;
	}
	const FVector At = Feet();
	const FStoreRaidLadder* Ladder = LadderAt(At);
	if (!Ladder)
	{
		SetMovementMode(MOVE_Falling);
		StartNewPhysics(DeltaTime, Iterations);
		return;
	}

	FVector Input = GetCurrentAcceleration() / FMath::Max(GetMaxAcceleration(), 1.f);
	Input.Z = 0.f;
	const FVector Toward = Ladder->Toward;
	const float Into = FVector::DotProduct(Input, Toward);
	// Backing away climbs down instead of stepping off.
	FVector Across = Input;
	if (Into < 0.f)
	{
		Across -= Into * Toward;
	}

	// Up or down at the climbing speed, between the ground and the top.
	const float Top = Ladder->Max.Z;
	const float Ground = GroundUnder(At);
	const float NewZ = FMath::Max(Ground, FMath::Min(Top, At.Z + Into * Mechanics.ClimbSpeed * CM * DeltaTime));

	// Across at walking pace; below the top, a climber stays against the ladder.
	FVector Target = At + Across * Mechanics.WalkSpeed * CM * DeltaTime;
	if (At.Z < Top - Mechanics.StepUp * CM)
	{
		float Wall = 0.f;
		for (int32 Axis = 0; Axis < 2; ++Axis)
		{
			Wall += Toward[Axis] * (Toward[Axis] > 0.f ? Ladder->Max[Axis] : Ladder->Min[Axis]);
		}
		const float Along = FVector::DotProduct(FVector(Target.X, Target.Y, 0.f), Toward);
		if (Along > Wall - Ladder->Gap)
		{
			Target -= (Along - (Wall - Ladder->Gap)) * Toward;
		}
	}
	Target.Z = NewZ;

	const FVector Delta = Target - At;
	Velocity = Delta / DeltaTime;
	FHitResult Hit;
	SafeMoveUpdatedComponent(Delta, UpdatedComponent->GetComponentQuat(), true, Hit);
	if (Hit.IsValidBlockingHit())
	{
		SlideAlongSurface(Delta, 1.f - Hit.Time, Hit.Normal, Hit, true);
	}
}

void UStoreRaidMovement::ClientHandleMoveResponse(const FCharacterMoveResponseDataContainer& Response)
{
	if (Response.IsCorrection())
	{
		const FStoreRaidMoveResponse& Ours = static_cast<const FStoreRaidMoveResponse&>(Response);
		Stamina = Ours.Stamina;
		bWinded = Ours.bWinded;
	}
	Super::ClientHandleMoveResponse(Response);
}
