// The player at this screen: reads the Device every frame and turns it into looking and moving for
// the character it possesses, which the movement component predicts and sends to the server.
class AStoreRaidPlayerController : APlayerController
{
	/** What the sr.* console commands ask for, added to the devices: for bots and the dev tools. */
	FControls Virtual;

	UFUNCTION(BlueprintOverride)
	void Tick(float DeltaSeconds)
	{
		if (!IsLocalController())
			return;

		FControls Controls = Device::ReadControls(this, DeltaSeconds);
		Controls.Move += Virtual.Move;
		if (Controls.Move.Size() > 1)
			Controls.Move = Controls.Move.GetSafeNormal();
		Controls.Look += Virtual.Look;
		Virtual.Look = FVector2D::ZeroVector;
		Controls.bRun = Controls.bRun || Virtual.bRun;
		Controls.bJump = Controls.bJump || Virtual.bJump;

		// Look: yaw all round, pitch short of straight up and down.
		FRotator Rotation = ControlRotation;
		Rotation.Yaw = Rotation.Yaw + Controls.Look.X;
		Rotation.Pitch = Math::Clamp(FRotator::NormalizeAxis(Rotation.Pitch) + Controls.Look.Y, -89.0, 89.0);
		Rotation.Roll = 0;
		SetControlRotation(Rotation);

		AStoreRaidCharacter Character = Cast<AStoreRaidCharacter>(ControlledPawn);
		if (Character != nullptr)
			Character.Drive(Controls, Rotation.Yaw);
	}
}

AStoreRaidPlayerController LocalController()
{
	return Cast<AStoreRaidPlayerController>(Gameplay::GetPlayerController(0));
}

// sr.move <right> <forward>: hold a move, each -1..1, until the next sr.move (sr.move 0 0 stops).
const FConsoleCommand MoveCommand("sr.move", n"OnMoveCommand");
void OnMoveCommand(TArray<FString> Arguments)
{
	AStoreRaidPlayerController Controller = LocalController();
	if (Controller == nullptr || Arguments.Num() < 2)
		return;
	Controller.Virtual.Move = FVector2D(String::Conv_StringToDouble(Arguments[0]), String::Conv_StringToDouble(Arguments[1]));
}

// sr.look <right> <up>: turn by these many degrees, once.
const FConsoleCommand LookCommand("sr.look", n"OnLookCommand");
void OnLookCommand(TArray<FString> Arguments)
{
	AStoreRaidPlayerController Controller = LocalController();
	if (Controller == nullptr || Arguments.Num() < 2)
		return;
	Controller.Virtual.Look += FVector2D(String::Conv_StringToDouble(Arguments[0]), String::Conv_StringToDouble(Arguments[1]));
}

// sr.run [0|1] and sr.jump [0|1]: hold run or jump, or let go.
const FConsoleCommand RunCommand("sr.run", n"OnRunCommand");
void OnRunCommand(TArray<FString> Arguments)
{
	AStoreRaidPlayerController Controller = LocalController();
	if (Controller != nullptr)
		Controller.Virtual.bRun = Arguments.Num() == 0 || Arguments[0] != "0";
}

const FConsoleCommand JumpCommand("sr.jump", n"OnJumpCommand");
void OnJumpCommand(TArray<FString> Arguments)
{
	AStoreRaidPlayerController Controller = LocalController();
	if (Controller != nullptr)
		Controller.Virtual.bJump = Arguments.Num() == 0 || Arguments[0] != "0";
}

// sr.where: logs where the local player is (in game meters: x east, y up, z north) and how they move.
const FConsoleCommand WhereCommand("sr.where", n"OnWhereCommand");
void OnWhereCommand(TArray<FString> Arguments)
{
	AStoreRaidPlayerController Controller = LocalController();
	if (Controller == nullptr)
		return;
	AStoreRaidCharacter Character = Cast<AStoreRaidCharacter>(Controller.ControlledPawn);
	if (Character == nullptr)
	{
		Log("StoreRaid where: no character");
		return;
	}
	const FVector Feet = Character.ActorLocation - FVector(0, 0, 90);
	UStoreRaidMovement Movement = Character.Movement;
	Log(f"StoreRaid where: x {Feet.Y / 100 :.2} y {Feet.Z / 100 :.2} z {Feet.X / 100 :.2} speed {Movement.Velocity.Size2D() / 100 :.2} stamina {Movement.Stamina :.2} winded {Movement.bWinded} climbing {Movement.IsClimbing()}");
}
