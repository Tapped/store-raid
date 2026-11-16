// The player at this screen: reads the Device every frame and turns it into looking and moving for
// the character it possesses, which the movement component predicts and sends to the server.
class AStoreRaidPlayerController : APlayerController
{
	/** What the sr.* console commands ask for, added to the devices: for bots and the dev tools. */
	FControls Virtual;

	/** Where sr.goal walks to, in game meters (x east, z north), while bHasGoal. */
	bool bHasGoal = false;
	FVector2D Goal;

	/** Started with -bot: walks a square round where it came in, as scripts/bot.ts did. */
	bool bWander = false;
	int WanderCorner = 0;
	/** How long it's been going to this corner: one it can't get to is given up after a while. */
	float WanderTime = 0;
	FVector2D WanderOrigin;

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		TArray<FString> Tokens;
		TArray<FString> Switches;
		FCommandLine::Parse(FCommandLine::Get(), Tokens, Switches);
		bWander = Switches.Contains("bot");

		// The player's name, from ?Name= on the address it joined (the engine's own login names
		// players after the machine): what lasting state is kept by, as in the web game.
		if (IsLocalController() && !HasAuthority())
		{
			for (const FString& Token : Tokens)
			{
				const int At = Token.Find("?Name=");
				if (At < 0)
					continue;
				FString Name = Token.RightChop(At + 6);
				const int End = Name.Find("?");
				if (End >= 0)
					Name = Name.Left(End);
				if (!Name.IsEmpty())
					ServerSetName(Name);
			}
		}
	}

	/** Names this player, held to 20 characters as the engine's login does. */
	UFUNCTION(Server)
	void ServerSetName(FString Name)
	{
		const FString Trimmed = Name.Left(20);
		if (Trimmed.IsEmpty() || PlayerState == nullptr)
			return;
		Log(f"StoreRaid: {PlayerState.PlayerName} is {Trimmed}");
		Gameplay::GetGameMode().ChangeName(this, Trimmed, true);
	}

	UFUNCTION(BlueprintOverride)
	void Tick(float DeltaSeconds)
	{
		if (!IsLocalController())
			return;

		AStoreRaidCharacter Character = Cast<AStoreRaidCharacter>(ControlledPawn);
		// Once it stands where it came in, which a client only knows once the server's said so.
		WanderTime += DeltaSeconds;
		if (bWander && Character != nullptr && (!bHasGoal || WanderTime > 5) && Character.Movement.IsMovingOnGround())
			NextWanderCorner(Character);

		FControls Controls = Device::ReadControls(this, DeltaSeconds);
		Controls.Move += Virtual.Move;
		if (bHasGoal && Character != nullptr)
			Controls.Move += TowardGoal(Character);
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

		if (Character != nullptr)
			Character.Drive(Controls, Rotation.Yaw);
	}

	/** Asks the server to put this player back where they came in, as falling out of the level does. */
	UFUNCTION(Server)
	void ServerRespawn()
	{
		AStoreRaidGameMode Mode = Cast<AStoreRaidGameMode>(Gameplay::GetGameMode());
		AStoreRaidCharacter Character = Cast<AStoreRaidCharacter>(ControlledPawn);
		if (Mode != nullptr && Character != nullptr)
			Mode.Respawn(Character);
	}

	/**
	 * The move, relative to where they look, that walks towards the goal: full speed until the last
	 * meter, then slowing, and none once within GOAL_REACHED, when the goal is done.
	 */
	FVector2D TowardGoal(AStoreRaidCharacter Character)
	{
		const FVector2D At = World::GameXZ(Character.ActorLocation);
		const FVector2D Delta = Goal - At;
		const float Distance = Delta.Size();
		if (Distance <= GOAL_REACHED)
		{
			bHasGoal = false;
			return FVector2D::ZeroVector;
		}
		// World direction to Unreal's axes (X north, Y east), then onto where they look.
		const FVector Direction = FVector(Delta.Y, Delta.X, 0) / Math::Max(Distance, 1.0);
		const FRotator Facing(0, ControlRotation.Yaw, 0);
		return FVector2D(Direction.DotProduct(Facing.RightVector), Direction.DotProduct(Facing.ForwardVector));
	}

	void NextWanderCorner(AStoreRaidCharacter Character)
	{
		if (WanderCorner == 0 && WanderOrigin.IsZero())
			WanderOrigin = World::GameXZ(Character.ActorLocation);
		// North, east, south, west: 3 m across and 1.5 m deep, clear of the railings in front of the
		// playground's spawn points.
		FVector2D Corner(0, 1.5);
		if (WanderCorner == 1)
			Corner = FVector2D(3, 1.5);
		else if (WanderCorner == 2)
			Corner = FVector2D(3, 0);
		else if (WanderCorner == 3)
			Corner = FVector2D(0, 0);
		Goal = WanderOrigin + Corner;
		bHasGoal = true;
		WanderTime = 0;
		WanderCorner = (WanderCorner + 1) % 4;
	}
}

/** How close sr.goal has to get to count as there, in meters. */
const float GOAL_REACHED = 0.15;

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

// sr.goal <x> <z>: walk to this point in game meters (x east, z north) until within GOAL_REACHED,
// on top of any sr.move. sr.goal with no point stops. sr.where says whether it's still going.
const FConsoleCommand GoalCommand("sr.goal", n"OnGoalCommand");
void OnGoalCommand(TArray<FString> Arguments)
{
	AStoreRaidPlayerController Controller = LocalController();
	if (Controller == nullptr)
		return;
	Controller.bWander = false;
	Controller.bHasGoal = Arguments.Num() >= 2;
	if (Controller.bHasGoal)
		Controller.Goal = FVector2D(String::Conv_StringToDouble(Arguments[0]), String::Conv_StringToDouble(Arguments[1]));
}

// sr.respawn: back where this player came in, by the server (for the checks).
const FConsoleCommand RespawnCommand("sr.respawn", n"OnRespawnCommand");
void OnRespawnCommand(TArray<FString> Arguments)
{
	AStoreRaidPlayerController Controller = LocalController();
	if (Controller == nullptr)
		return;
	Controller.bWander = false;
	Controller.bHasGoal = false;
	Controller.ServerRespawn();
}

// sr.where: logs where the local player is (in game meters: x east, y up, z north) and how they move,
// as `key value` pairs for the dev tools to read.
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
	Log(f"StoreRaid where: x {Feet.Y / 100 :.3} y {Feet.Z / 100 :.3} z {Feet.X / 100 :.3} speed {Movement.Velocity.Size2D() / 100 :.2} stamina {Movement.Stamina :.3} winded {Movement.bWinded} running {Movement.bRunning} climbing {Movement.IsClimbing()} falling {Movement.IsFalling()} goal {Controller.bHasGoal}");
}

// sr.players: logs every player in this world, where their feet are (game meters) and how they move.
// On the server, that's what the server says; on a client, what it predicts or was last told.
const FConsoleCommand PlayersCommand("sr.players", n"OnPlayersCommand");
void OnPlayersCommand(TArray<FString> Arguments)
{
	TArray<AStoreRaidCharacter> Characters;
	GetAllActorsOfClass(Characters);
	for (AStoreRaidCharacter Character : Characters)
	{
		const FVector Feet = Character.ActorLocation - FVector(0, 0, 90);
		const FString Name = Character.PlayerState != nullptr ? Character.PlayerState.PlayerName : "?";
		Log(f"StoreRaid player: {Name} x {Feet.Y / 100 :.2} y {Feet.Z / 100 :.2} z {Feet.X / 100 :.2} speed {Character.Movement.Velocity.Size2D() / 100 :.2}");
	}
}
