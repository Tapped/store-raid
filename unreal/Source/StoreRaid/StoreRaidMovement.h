#pragma once

#include "CoreMinimal.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/CharacterMovementReplication.h"
#include "StoreRaidMovement.generated.h"

/**
 * The numbers players move by, in meters and seconds as in shared/mechanics.ts: the room's (the
 * game state's), set on every character's movement on the server and on clients alike, so prediction
 * and the server agree. The defaults are shared/constants.ts's.
 */
USTRUCT(BlueprintType)
struct FStoreRaidMechanics
{
	GENERATED_BODY()

	/** Meters per second at full input. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WalkSpeed = 5.f;
	/** Meters per second at full input while running. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float RunSpeed = 7.5f;
	/** Seconds of running from full stamina to none. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float RunTime = 5.f;
	/** Seconds of not running from no stamina to full. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float RestTime = 6.f;
	/** The stamina a winded player needs back before they can run again. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float RunAgain = 0.4f;
	/** How much harder going up stairs is, per meter of rise per meter across. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Uphill = 0.8f;
	/** How high a player steps up without noticing. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float StepUp = 0.35f;
	/** How far down a player follows the floor before falling. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float StepDown = 0.3f;
	/** Meters per second up or down a ladder. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float ClimbSpeed = 2.5f;
	/** Meters per second per second. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Gravity = 20.f;
	/** Meters per second up as a jump leaves the ground. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float JumpSpeed = 6.f;
};

/**
 * A ladder, in world space (cm): the box a player can climb it from, the way into it (towards the
 * wall it stands against, horizontal and unit length), and the height of its top, where its hatch is.
 * Script builds these from the level, the same on server and clients.
 */
USTRUCT(BlueprintType)
struct FStoreRaidLadder
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FVector Min = FVector::ZeroVector;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FVector Max = FVector::ZeroVector;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FVector Toward = FVector::ForwardVector;
	/** How far out from the wall a climber is held while below the top. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Gap = 40.f;
};

/** The server's answer to a move, with stamina, so a correction puts it right too. */
struct FStoreRaidMoveResponse : public FCharacterMoveResponseDataContainer
{
	float Stamina = 1.f;
	bool bWinded = false;

	virtual void ServerFillResponseData(const UCharacterMovementComponent& CharacterMovement, const FClientAdjustment& PendingAdjustment) override;
	virtual bool Serialize(UCharacterMovementComponent& CharacterMovement, FArchive& Ar, UPackageMap* PackageMap) override;
};

UENUM(BlueprintType)
enum class EStoreRaidMove : uint8
{
	None,
	Climb,
};

/**
 * Players' movement: the engine's walking, falling, prediction and correction, with what
 * shared/movement.ts adds to it, all predicted:
 *
 * - Velocity follows the input at once, on the ground and in the air, as stepMover's did.
 * - Running (FLAG_Custom_0) takes stamina, more going up stairs; running out leaves a player winded
 *   until it's back to RunAgain. Stamina and winded go back to the client in corrections.
 * - Stairs slow walkers down: speed along the slope, and climbing dearer (Mechanics.Uphill), from the
 *   floor's slope and the way they push, as paceAt() worked it out.
 * - Ladders: in one's box with a hand free (bCanClimb, which script sets from the hands), pushing into
 *   it or off the ground climbs, backing away climbs down, and nobody falls off it backwards.
 */
UCLASS(ClassGroup = StoreRaid, meta = (BlueprintSpawnableComponent))
class STORERAID_API UStoreRaidMovement : public UCharacterMovementComponent
{
	GENERATED_BODY()

public:
	UStoreRaidMovement();

	/** Sets the numbers this player moves by. Call on the server and on clients with the same ones. */
	UFUNCTION(BlueprintCallable, Category = "StoreRaid|Movement")
	void SetMechanics(const FStoreRaidMechanics& InMechanics);

	UFUNCTION(BlueprintPure, Category = "StoreRaid|Movement")
	const FStoreRaidMechanics& GetMechanics() const { return Mechanics; }

	/** The level's ladders. Every machine sets the same ones, from the same level. */
	UFUNCTION(BlueprintCallable, Category = "StoreRaid|Movement")
	void SetLadders(const TArray<FStoreRaidLadder>& InLadders) { Ladders = InLadders; }

	/** Whether the run input is held. Set by the owning client; predicted and sent with each move. */
	UPROPERTY(BlueprintReadWrite, Category = "StoreRaid|Movement")
	bool bWantsToRun = false;

	/** Whether a hand is free to climb with: without one a ladder is only a wall. Script sets it from the hands. */
	UPROPERTY(BlueprintReadWrite, Category = "StoreRaid|Movement")
	bool bCanClimb = true;

	/** 1 rested, 0 spent. */
	UPROPERTY(BlueprintReadOnly, Category = "StoreRaid|Movement")
	float Stamina = 1.f;

	/** Ran out of stamina, and can't run until it's back to RunAgain. */
	UPROPERTY(BlueprintReadOnly, Category = "StoreRaid|Movement")
	bool bWinded = false;

	/** Whether they ran in the last move: moving, on the ground, with stamina. */
	UPROPERTY(BlueprintReadOnly, Category = "StoreRaid|Movement")
	bool bRunning = false;

	UFUNCTION(BlueprintPure, Category = "StoreRaid|Movement")
	bool IsClimbing() const;

	/** The share of flat speed kept and the effort, going this way from where they stand: see paceAt(). */
	UFUNCTION(BlueprintPure, Category = "StoreRaid|Movement")
	void GetPace(FVector Direction, float& OutSpeed, float& OutEffort) const;

	virtual float GetMaxSpeed() const override;
	virtual void UpdateFromCompressedFlags(uint8 Flags) override;
	virtual class FNetworkPredictionData_Client* GetPredictionData_Client() const override;
	virtual void UpdateCharacterStateBeforeMovement(float DeltaSeconds) override;
	virtual void PhysCustom(float DeltaTime, int32 Iterations) override;
	virtual void ClientHandleMoveResponse(const FCharacterMoveResponseDataContainer& MoveResponse) override;

private:
	const FStoreRaidLadder* LadderAt(const FVector& Feet) const;
	/** Height of the floor under the feet (cm), within the step up above them; -inf if none in reach. */
	float GroundUnder(const FVector& Feet) const;
	FVector Feet() const;
	void PhysClimb(float DeltaTime, int32 Iterations);

	UPROPERTY()
	FStoreRaidMechanics Mechanics;

	TArray<FStoreRaidLadder> Ladders;

	FStoreRaidMoveResponse StoreRaidMoveResponse;
};
