// The player's character: a first-person camera at eye height for its owner, and a stand-in body
// for everyone else, until the character model is imported. It moves by UStoreRaidMovement (C++),
// which predicts walking, running and stamina, jumping, stairs and ladders, and the server corrects.
class AStoreRaidCharacter : AStoreRaidCharacterBase
{
	/** EYE_HEIGHT 1.65 m over the feet, which are 0.9 m under the capsule's middle. */
	UPROPERTY(DefaultComponent, Attach = CollisionCylinder)
	UCameraComponent Camera;
	default Camera.RelativeLocation = FVector(0, 0, 75);
	default Camera.bUsePawnControlRotation = true;
	default Camera.FieldOfView = 80;

	/** What others see of this player for now: a cylinder as tall and wide as they are. */
	UPROPERTY(DefaultComponent, Attach = CollisionCylinder)
	UStaticMeshComponent Body;
	default Body.bOwnerNoSee = true;
	default Body.RelativeScale3D = FVector(0.6, 0.6, 1.8);

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		// The engine's cylinder is 1 m tall about its middle, like the capsule.
		Body.SetStaticMesh(Cast<UStaticMesh>(LoadObject(nullptr, "/Engine/BasicShapes/Cylinder.Cylinder")));
		Body.SetCollisionEnabled(ECollisionEnabled::NoCollision);
		AStoreRaidGameState State = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
		if (State != nullptr)
			State.Prepare(this);
	}

	/** Called by the local controller every frame with what the player asks for and where they look. */
	void Drive(FControls Controls, float Yaw)
	{
		const FRotator Facing(0, Yaw, 0);
		const FVector Direction = Facing.ForwardVector * Controls.Move.Y + Facing.RightVector * Controls.Move.X;
		AddMovementInput(Direction, 1.0);
		Movement.bWantsToRun = Controls.bRun;
		if (Controls.bJump)
			Jump();
		else
			StopJumping();
	}
}
