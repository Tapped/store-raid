#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "StoreRaidCharacterBase.generated.h"

class UStoreRaidMovement;

/**
 * What the player character needs from C++: its movement is UStoreRaidMovement. Everything else
 * about it (camera, input, hands, health) is script, in Script/Player/.
 */
UCLASS(Abstract)
class STORERAID_API AStoreRaidCharacterBase : public ACharacter
{
	GENERATED_BODY()

public:
	AStoreRaidCharacterBase(const FObjectInitializer& ObjectInitializer);

	UFUNCTION(BlueprintPure, Category = "StoreRaid")
	UStoreRaidMovement* GetMovement() const;
};
