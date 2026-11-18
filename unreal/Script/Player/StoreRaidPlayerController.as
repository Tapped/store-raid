// The player at this screen: reads the Device every frame and turns it into looking and moving for
// the character it possesses, which the movement component predicts and sends to the server. Seated
// in the truck, it moves nobody and asks to stand when the player moves. Out of the building (dead,
// lost or waiting), it has no character and watches someone still playing, E / Q stepping through
// them. It also keeps the round's overlay up to date on this screen.
class AStoreRaidPlayerController : APlayerController
{
	/** The overlay on this screen; none on a bot, which draws nothing. */
	UStoreRaidOverlay Hud;
	bool bDrawsNothing = false;

	/** Who we watch while out of the building, and which of those playing that is. */
	AStoreRaidCharacter Watched;
	int Watching = 0;

	/** Whether we sat last frame, and whether we've asked to stand since. */
	bool bWasSeated = false;
	bool bAskedToStand = false;
	/** Seconds left getting up, during which we stay put; how far down into the seat the eye is, 0 to 1. */
	float Rising = 0;
	float Seatedness = 0;

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
		bDrawsNothing = Switches.Contains("nullrhi");

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
		Controls.bGrabPressed = Controls.bGrabPressed || Virtual.bGrabPressed;
		Controls.bDropPressed = Controls.bDropPressed || Virtual.bDropPressed;
		Controls.bReadyPressed = Controls.bReadyPressed || Virtual.bReadyPressed;
		Virtual.bGrabPressed = false;
		Virtual.bDropPressed = false;
		Virtual.bReadyPressed = false;
		UpdateOverlay();

		AStoreRaidPlayerState Me = Cast<AStoreRaidPlayerState>(PlayerState);
		if (Controls.bReadyPressed)
			ServerReady();

		// Out of the building: watch someone who's in it. E / Q (RB / LB) step through them.
		if (Me != nullptr && !Me.IsPlaying())
		{
			if (Controls.bGrabPressed)
				Watching++;
			if (Controls.bDropPressed)
				Watching--;
			Watch();
			return;
		}
		Watch();
		Controls.Move += Virtual.Move;
		if (bHasGoal && Character != nullptr)
			Controls.Move += TowardGoal(Character);
		if (Controls.Move.Size() > 1)
			Controls.Move = Controls.Move.GetSafeNormal();
		Controls.Look += Virtual.Look;
		Virtual.Look = FVector2D::ZeroVector;
		Controls.bRun = Controls.bRun || Virtual.bRun;
		Controls.bJump = Controls.bJump || Virtual.bJump;

		// Grab (E, RB), drop (Q, LB) and the flashlight (F, Y): messages to the server, as in the web game.
		if (Controls.bGrabPressed)
			ServerGrab();
		if (Controls.bGrabReleased)
			ServerRelease();
		if (Controls.bDropPressed)
			ServerDrop();
		if (Controls.bLightPressed)
			ServerLight();

		// Look: yaw all round, pitch short of straight up and down.
		FRotator Rotation = ControlRotation;
		Rotation.Yaw = Rotation.Yaw + Controls.Look.X;
		Rotation.Pitch = Math::Clamp(FRotator::NormalizeAxis(Rotation.Pitch) + Controls.Look.Y, -89.0, 89.0);
		Rotation.Roll = 0;
		SetControlRotation(Rotation);

		// Seated, nobody moves: moving or jumping asks to get up, which takes a moment.
		const bool bSeated = Me != nullptr && Me.Seat >= 0;
		const bool bWantsToMove = Controls.Move.Size() > 0.2 || Controls.bJump;
		if (bSeated && bWantsToMove && !bAskedToStand && Rising <= 0)
		{
			bAskedToStand = true;
			ServerStand();
		}
		if (!bSeated)
			bAskedToStand = false;
		bool bStill = bSeated;
		if (Character != nullptr)
			bStill = Sit(Character, Me, bSeated, bAskedToStand, DeltaSeconds);
		if (bStill)
		{
			// Getting up: standing on the server already, but no input yet.
			if (Character != nullptr && !bSeated)
				Character.Drive(FControls(), Rotation.Yaw);
			return;
		}
		if (Character != nullptr)
			Character.Drive(Controls, Rotation.Yaw);
	}

	/**
	 * Seated, the character doesn't move, the eye sinks over the seat in SIT_DOWN_TIME, and on sitting
	 * down it looks the way the seat faces, across the truck. Getting up, whether we asked or the
	 * server stood us up as a raid starts, takes STAND_UP_TIME, the eye rising, before it walks, as
	 * sit() in client/src/localPlayer.ts. The server sets the movement mode the same way, which keeps
	 * the prediction with it. Whether we must stay put.
	 */
	bool Sit(AStoreRaidCharacter Character, AStoreRaidPlayerState Me, bool bSeated, bool bAsked, float DeltaSeconds)
	{
		if (bSeated && Character.Movement.MovementMode != EMovementMode::MOVE_None)
			Character.Movement.SetMovementMode(EMovementMode::MOVE_None);
		if (!bSeated && Character.Movement.MovementMode == EMovementMode::MOVE_None)
			Character.Movement.SetMovementMode(EMovementMode::MOVE_Walking);
		AStoreRaidGameState Room = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
		if (bSeated && !bWasSeated)
		{
			Rising = 0;
			if (Room != nullptr && Room.Parked.Seats.IsValidIndex(Me.Seat))
				SetControlRotation(FRotator(0, Room.Parked.Seats[Me.Seat].Yaw, 0));
		}
		// Getting up: we asked, or we were stood up.
		if ((bSeated && bAsked) || (!bSeated && bWasSeated))
		{
			if (Rising <= 0)
				Rising = STAND_UP_TIME;
		}
		bWasSeated = bSeated;
		Rising = Math::Max(0.0, Rising - DeltaSeconds);

		if (bSeated && !bAsked && Rising <= 0)
			Seatedness = Math::Min(1.0, Seatedness + DeltaSeconds / SIT_DOWN_TIME);
		else if (Rising > 0)
			Seatedness = Math::Min(Seatedness, Rising / STAND_UP_TIME);
		else
			Seatedness = 0;
		const float Sunk = Seatedness * Seatedness * (3 - 2 * Seatedness);
		Character.Camera.SetRelativeLocation(FVector(-SEATED_EYE_BACK * Sunk, 0, Math::Lerp(STANDING_EYE, SEATED_EYE, Sunk)));
		return bSeated || Rising > 0;
	}

	/**
	 * Out of the building, looks through the eyes of one of those still playing, whose character is
	 * then hidden on this screen; in it, back to our own.
	 */
	void Watch()
	{
		TArray<AStoreRaidCharacter> Characters;
		GetAllActorsOfClass(Characters);
		AStoreRaidCharacter Was = Watched;
		Watched = nullptr;
		const AStoreRaidPlayerState Me = Cast<AStoreRaidPlayerState>(PlayerState);
		if (Me != nullptr && !Me.IsPlaying() && ControlledPawn == nullptr)
		{
			// In the order they joined, so stepping through is steady.
			TArray<AStoreRaidCharacter> Playing;
			AStoreRaidGameState Room = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
			for (AStoreRaidPlayerState Player : Room.Players())
			{
				for (AStoreRaidCharacter Character : Characters)
				{
					if (Character.PlayerState == Player)
						Playing.Add(Character);
				}
			}
			if (Playing.Num() > 0)
			{
				Watching = ((Watching % Playing.Num()) + Playing.Num()) % Playing.Num();
				Watched = Playing[Watching];
			}
		}
		for (AStoreRaidCharacter Character : Characters)
		{
			const AStoreRaidPlayerState Player = Cast<AStoreRaidPlayerState>(Character.PlayerState);
			Character.ShowSeated(Player != nullptr && Player.Seat >= 0);
			const bool bWatched = Character == Watched;
			Character.HideBody(bWatched);
			// A watched character's camera looks where they do, as the server last said.
			Character.Camera.bUsePawnControlRotation = !bWatched;
			if (bWatched)
				Character.Camera.SetWorldRotation(Character.GetBaseAimRotation());
		}
		if (Watched != nullptr && GetViewTarget() != Watched)
			SetViewTargetWithBlend(Watched, 0);
		if (Watched == nullptr && Was != nullptr && ControlledPawn != nullptr)
			SetViewTargetWithBlend(ControlledPawn, 0);
	}

	/** The overlay on this screen, made the first time it's needed. */
	void UpdateOverlay()
	{
		if (bDrawsNothing)
			return;
		if (Hud == nullptr)
		{
			Hud = Cast<UStoreRaidOverlay>(WidgetBlueprint::CreateWidget(UStoreRaidOverlay, this));
			if (Hud == nullptr)
				return;
			Hud.Build();
			Hud.AddToViewport();
		}
		Hud.Update(OverlayLines(), Cast<AStoreRaidGameState>(Gameplay::GetGameState()));
	}

	/** What the overlay at the top says on this screen now. */
	TArray<FString> OverlayLines()
	{
		AStoreRaidGameState Room = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
		AStoreRaidPlayerState Me = Cast<AStoreRaidPlayerState>(PlayerState);
		AStoreRaidCharacter Character = OwnCharacter();
		const bool bInTruck = Room != nullptr && Character != nullptr && Room.InTruck(GameFeet(Character));
		const FString WatchedName = Watched != nullptr && Watched.PlayerState != nullptr ? Watched.PlayerState.PlayerName : "";
		return Overlay::RoundLines(Room, Me, bInTruck, WatchedName);
	}

	UFUNCTION(Server)
	void ServerReady()
	{
		if (Mode() != nullptr)
			Mode().Ready(Cast<AStoreRaidPlayerState>(PlayerState));
	}

	/**
	 * The server put our character somewhere: look the way it faces, rested, as the server has it.
	 * Corrections would bring the stamina too, but not to one sitting, who sends no moves.
	 */
	UFUNCTION(Client)
	void ClientBrought(float Yaw)
	{
		SetControlRotation(FRotator(0, Yaw, 0));
		AStoreRaidCharacter Character = OwnCharacter();
		if (Character != nullptr)
			Character.Movement.Rest();
	}

	UFUNCTION(Server)
	void ServerStand()
	{
		if (OwnCharacter() != nullptr && Mode() != nullptr)
			Mode().Stand(OwnCharacter());
	}

	AStoreRaidCharacter OwnCharacter() const
	{
		return Cast<AStoreRaidCharacter>(ControlledPawn);
	}

	AStoreRaidGameMode Mode() const
	{
		return Cast<AStoreRaidGameMode>(Gameplay::GetGameMode());
	}

	UFUNCTION(Server)
	void ServerGrab()
	{
		if (OwnCharacter() != nullptr && Mode() != nullptr)
			Mode().Grab(OwnCharacter());
	}

	UFUNCTION(Server)
	void ServerRelease()
	{
		if (OwnCharacter() != nullptr && Mode() != nullptr)
			Mode().Release(OwnCharacter());
	}

	UFUNCTION(Server)
	void ServerDrop()
	{
		if (OwnCharacter() != nullptr)
			Hands::DropLast(OwnCharacter());
	}

	/** Puts every item back where it started (for the checks; a raid starting will do the same). */
	UFUNCTION(Server)
	void ServerReset()
	{
		Hands::PutAllBack();
	}

	UFUNCTION(Server)
	void ServerLight()
	{
		if (OwnCharacter() != nullptr)
			Hands::Light(OwnCharacter());
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
/**
 * Where the eye is while seated, as SITTING in client/src/players.ts: 1.22 m over the feet (32 cm over
 * the capsule's middle) and 30 cm behind them, over the seat.
 */
const float SEATED_EYE = 32.0;
const float SEATED_EYE_BACK = 30.0;
/** Where the eye is standing: 1.65 m over the feet, 75 cm over the capsule's middle. */
const float STANDING_EYE = 75.0;
/** Seconds getting up from a seat takes, during which the player can't move, and sitting down, as SITTING. */
const float STAND_UP_TIME = 1.4;
const float SIT_DOWN_TIME = 1.2;

/** Where a character's feet are, in game meters. */
FVector GameFeet(AStoreRaidCharacter Character)
{
	const FVector Feet = Character.ActorLocation - FVector(0, 0, 90);
	return FVector(Feet.Y / 100, Feet.Z / 100, Feet.X / 100);
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

// sr.grab, sr.release, sr.drop and sr.light: the grab button down and up, drop, and the flashlight.
const FConsoleCommand GrabCommand("sr.grab", n"OnGrabCommand");
void OnGrabCommand(TArray<FString> Arguments)
{
	if (LocalController() != nullptr)
		LocalController().Virtual.bGrabPressed = true;
}

const FConsoleCommand ReleaseCommand("sr.release", n"OnReleaseCommand");
void OnReleaseCommand(TArray<FString> Arguments)
{
	if (LocalController() != nullptr)
		LocalController().ServerRelease();
}

const FConsoleCommand DropCommand("sr.drop", n"OnDropCommand");
void OnDropCommand(TArray<FString> Arguments)
{
	if (LocalController() != nullptr)
		LocalController().Virtual.bDropPressed = true;
}

// sr.ready: the ready button (R, X): ready to start in the lobby, wanting to leave in the truck.
const FConsoleCommand ReadyCommand("sr.ready", n"OnReadyCommand");
void OnReadyCommand(TArray<FString> Arguments)
{
	if (LocalController() != nullptr)
		LocalController().Virtual.bReadyPressed = true;
}

// sr.stand: get up from a seat in the truck, as moving does.
const FConsoleCommand StandCommand("sr.stand", n"OnStandCommand");
void OnStandCommand(TArray<FString> Arguments)
{
	if (LocalController() != nullptr)
		LocalController().ServerStand();
}

// sr.overlay: logs what this screen's overlay says, a line each, the results while they show, and
// whom we watch.
const FConsoleCommand OverlayCommand("sr.overlay", n"OnOverlayCommand");
void OnOverlayCommand(TArray<FString> Arguments)
{
	AStoreRaidPlayerController Controller = LocalController();
	if (Controller == nullptr)
		return;
	for (const FString& Line : Controller.OverlayLines())
		Log(f"StoreRaid overlay: {Line}");
	for (const FString& Line : Overlay::ResultLines(Cast<AStoreRaidGameState>(Gameplay::GetGameState())))
		Log(f"StoreRaid results: {Line}");
	if (Controller.Watched != nullptr && Controller.Watched.PlayerState != nullptr)
		Log(f"StoreRaid watching: {Controller.Watched.PlayerState.PlayerName}");
}

const FConsoleCommand LightCommand("sr.light", n"OnLightCommand");
void OnLightCommand(TArray<FString> Arguments)
{
	if (LocalController() != nullptr)
		LocalController().ServerLight();
}

// sr.reset: every item back where it started, switched off, out of everyone's hands.
const FConsoleCommand ResetCommand("sr.reset", n"OnResetCommand");
void OnResetCommand(TArray<FString> Arguments)
{
	if (LocalController() != nullptr)
		LocalController().ServerReset();
}

// sr.face <degrees> [pitch]: look this way, 0 north, 90 east, and up (positive) or down.
const FConsoleCommand FaceCommand("sr.face", n"OnFaceCommand");
void OnFaceCommand(TArray<FString> Arguments)
{
	AStoreRaidPlayerController Controller = LocalController();
	if (Controller == nullptr || Arguments.Num() < 1)
		return;
	const float Pitch = Arguments.Num() >= 2 ? String::Conv_StringToDouble(Arguments[1]) : 0.0;
	Controller.SetControlRotation(FRotator(Pitch, String::Conv_StringToDouble(Arguments[0]), 0));
}

// sr.items: logs every item in this world: its kind, where it is (game meters), who holds it, and
// whether it's on. On a client, as far as it knows.
const FConsoleCommand ItemsCommand("sr.items", n"OnItemsCommand");
void OnItemsCommand(TArray<FString> Arguments)
{
	TArray<AStoreRaidItem> All;
	GetAllActorsOfClass(All);
	TArray<AStoreRaidCharacter> Characters;
	GetAllActorsOfClass(Characters);
	for (AStoreRaidItem Item : All)
	{
		const FVector At = Item.GamePosition();
		FString Holders = "";
		for (AStoreRaidCharacter Character : Characters)
		{
			if ((Character.Left == Item || Character.Right == Item) && Character.PlayerState != nullptr)
				Holders += (Holders.IsEmpty() ? "" : ",") + Character.PlayerState.PlayerName;
		}
		if (Holders.IsEmpty())
			Holders = "-";
		Log(f"StoreRaid item: {Item.Name} kind {Items::KindName(Item.Kind)} x {At.X :.2} y {At.Y :.2} z {At.Z :.2} held {Holders} on {Item.bOn}");
	}
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
	AStoreRaidPlayerState Me = Cast<AStoreRaidPlayerState>(Controller.PlayerState);
	const FString Role = Me != nullptr ? Modes::RoleName(Me.Role) : "?";
	const bool bReady = Me != nullptr && Me.bReady;
	const int Seat = Me != nullptr ? Me.Seat : -1;
	if (Character == nullptr)
	{
		Log(f"StoreRaid where: none role {Role} ready {bReady} seat {Seat}");
		return;
	}
	const FVector Feet = Character.ActorLocation - FVector(0, 0, 90);
	UStoreRaidMovement Movement = Character.Movement;
	const float Yaw = FRotator::NormalizeAxis(Controller.ControlRotation.Yaw);
	Log(f"StoreRaid where: x {Feet.Y / 100 :.3} y {Feet.Z / 100 :.3} z {Feet.X / 100 :.3} speed {Movement.Velocity.Size2D() / 100 :.2} stamina {Movement.Stamina :.3} winded {Movement.bWinded} running {Movement.bRunning} climbing {Movement.IsClimbing()} falling {Movement.IsFalling()} goal {Controller.bHasGoal} left {HandName(Character.Left)} right {HandName(Character.Right)} role {Role} ready {bReady} seat {Seat} rising {Controller.Rising :.2} yaw {Yaw :.1}");
}

// sr.players: logs every player in this world: who they are this round, and where their feet are
// (game meters) and how fast they move, if they're in the building. On the server, that's what the
// server says; on a client, what it predicts or was last told.
const FConsoleCommand PlayersCommand("sr.players", n"OnPlayersCommand");
void OnPlayersCommand(TArray<FString> Arguments)
{
	AStoreRaidGameState Room = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
	if (Room == nullptr)
		return;
	TArray<AStoreRaidCharacter> Characters;
	GetAllActorsOfClass(Characters);
	for (AStoreRaidPlayerState Player : Room.Players())
	{
		FString Line = f"StoreRaid player: {Player.PlayerName} role {Modes::RoleName(Player.Role)} ready {Player.bReady} seat {Player.Seat}";
		for (AStoreRaidCharacter Character : Characters)
		{
			if (Character.PlayerState != Player)
				continue;
			const FVector Feet = GameFeet(Character);
			Line += f" x {Feet.X :.2} y {Feet.Y :.2} z {Feet.Z :.2} speed {Character.Movement.Velocity.Size2D() / 100 :.2} moving {Character.Movement.MovementMode}";
		}
		Log(Line);
	}
}

FString HandName(const AStoreRaidItem Item)
{
	return Item == nullptr ? "-" : Items::KindName(Item.Kind);
}

// sr.room: logs what the room says: how bright the lamps are, what it's for, where a game's round is
// and its clock, the loot in the truck against the quota, whether the last raid cleared it, and where
// the truck's hatch is (0 up, 1 down).
const FConsoleCommand RoomCommand("sr.room", n"OnRoomCommand");
void OnRoomCommand(TArray<FString> Arguments)
{
	AStoreRaidGameState State = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
	if (State == nullptr)
		return;
	const FString Mode = Modes::ModeName(State.Mode);
	const FString Phase = Modes::PhaseName(State.Phase);
	Log(f"StoreRaid room: light {State.Light :.3} mode {Mode} phase {Phase} time {State.TimeLeft :.2} loot {State.Loot} quota {State.Quota} cleared {State.bCleared} hatch {State.Hatch :.3}");
}
