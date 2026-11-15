#include "StoreRaidCharacterBase.h"

#include "Components/CapsuleComponent.h"
#include "StoreRaidMovement.h"

AStoreRaidCharacterBase::AStoreRaidCharacterBase(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer.SetDefaultSubobjectClass<UStoreRaidMovement>(ACharacter::CharacterMovementComponentName))
{
	// PLAYER_RADIUS 0.3 m and PLAYER_HEIGHT 1.8 m.
	GetCapsuleComponent()->InitCapsuleSize(30.f, 90.f);
	bUseControllerRotationYaw = true;
	bUseControllerRotationPitch = false;
	bUseControllerRotationRoll = false;
}

UStoreRaidMovement* AStoreRaidCharacterBase::GetMovement() const
{
	return Cast<UStoreRaidMovement>(GetCharacterMovement());
}
