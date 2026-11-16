// The game mode every level starts with, on the server: who plays as what, where they come in,
// putting back whoever falls out of the level, the dimmer, the truck's hatch and seats, and a game's
// rounds, as server/src/rooms/GameRoom.ts had them.
//
// The room's mode comes from the server's command line, `-mode=game`, else the playground; `sr.mode`
// on the server changes it, starting over. Only those playing have a character: the dead, lost and
// waiting have none, and watch through someone else's eyes (the player controller).
class AStoreRaidGameMode : AGameModeBase
{
	default DefaultPawnClass = AStoreRaidCharacter;
	default PlayerControllerClass = AStoreRaidPlayerController;
	default GameStateClass = AStoreRaidGameState;
	default PlayerStateClass = AStoreRaidPlayerState;

	/** Those holding the dimmer, and the way it fades: each push fades the other way from the last. */
	TArray<AStoreRaidCharacter> Dimming;
	float DimDirection = 1;

	/** Where the truck's hatch is going: 0 up, 1 down. The game state's Hatch follows it. */
	float HatchGoal = 1;

	/** Seconds from the start of a raid to dawn: RAID_TIME, or `-raidtime=` for checks. */
	float RaidTime = Modes::RAID_TIME;

	/** How many have joined, to spread players over the truck's places. */
	int JoinCount = 0;

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		TArray<FString> Tokens;
		TArray<FString> Switches;
		FCommandLine::Parse(FCommandLine::Get(), Tokens, Switches);
		EMode Mode = EMode::Playground;
		for (const FString& Switch : Switches)
		{
			if (Switch == "mode=game")
				Mode = EMode::Game;
			if (Switch.StartsWith("raidtime="))
				RaidTime = String::Conv_StringToDouble(Switch.RightChop(9));
		}
		Log("StoreRaid: game mode up");
		SetMode(Mode);
	}

	AStoreRaidGameState State() const
	{
		return Cast<AStoreRaidGameState>(Gameplay::GetGameState());
	}

	/** Starts the room over in a mode: a game from its lobby, shut in the truck; the playground's truck stands open. */
	void SetMode(EMode Mode)
	{
		AStoreRaidGameState Room = State();
		if (Room == nullptr)
			return;
		Room.Mode = Mode;
		Room.Phase = EPhase::Lobby;
		Room.TimeLeft = 0;
		Room.bCleared = false;
		// The playground's lights are on the dimmer; a game's are dim.
		Room.Light = Mode == EMode::Game ? Modes::GAME_LIGHT : 1.0;
		Room.OnRep_Light();
		Dimming.Empty();
		ResetRound();
		SetHatch(Mode == EMode::Game ? 0 : 1);
		Log(f"StoreRaid: the room is a {Modes::ModeName(Mode)}");
	}

	bool IsGame() const
	{
		return State() != nullptr && State().Mode == EMode::Game;
	}

	/**
	 * A newcomer: in a game, those joining in the lobby sit down on a free seat in the truck if there
	 * is one, else stand in it; once a raid has begun, they wait for the next round with no character.
	 * In the playground, at the first free spawn point.
	 */
	UFUNCTION(BlueprintOverride)
	void HandleStartingNewPlayer(APlayerController NewPlayer)
	{
		AStoreRaidPlayerState Player = Cast<AStoreRaidPlayerState>(NewPlayer.PlayerState);
		const int Index = JoinCount;
		JoinCount++;
		Log(f"StoreRaid: {NewPlayer.PlayerState.PlayerName} joined");
		if (!IsGame())
		{
			RestartPlayer(NewPlayer);
			return;
		}
		if (State().Phase != EPhase::Lobby)
		{
			Player.SetRole(ERole::Waiting);
			return;
		}
		Player.SetRole(ERole::Playing);
		const int Seat = FreeSeat();
		Player.SetSeat(Seat);
		Bring(NewPlayer, Seat >= 0 ? SeatSpot(Seat) : State().Parked.Spawn(Index), Seat >= 0 ? State().Parked.Seats[Seat].Yaw : State().Parked.Place.Yaw());
	}

	/** Each player at the first free spawn point, in spawnPoint()'s order. */
	UFUNCTION(BlueprintOverride)
	AActor ChoosePlayerStart(AController Player)
	{
		TArray<APlayerStart> Starts;
		GetAllActorsOfClass(Starts);
		const FVector2D Spawn = FreeSpawnPoint();
		APlayerStart Nearest;
		float NearestDistance = 0;
		for (APlayerStart Start : Starts)
		{
			const float Distance = World::GameXZ(Start.ActorLocation).Distance(Spawn);
			if (Nearest == nullptr || Distance < NearestDistance)
			{
				Nearest = Start;
				NearestDistance = Distance;
			}
		}
		return Nearest;
	}

	UFUNCTION(BlueprintOverride)
	void OnLogout(AController ExitingController)
	{
		AStoreRaidCharacter Character = Cast<AStoreRaidCharacter>(ExitingController.ControlledPawn);
		if (Character != nullptr)
		{
			Hands::DropAll(Character);
			Dimming.Remove(Character);
		}
	}

	/**
	 * Puts a player's character at a point (their feet, in game meters) facing this way, making one
	 * if they have none: a fresh one, at rest.
	 */
	void Bring(AController Controller, FVector Feet, float Yaw)
	{
		const FVector At = World::ToWorld(Feet.X, Feet.Y, Feet.Z) + FVector(0, 0, 92);
		const FRotator Facing(0, Yaw, 0);
		AStoreRaidCharacter Character = Cast<AStoreRaidCharacter>(Controller.ControlledPawn);
		if (Character == nullptr)
		{
			RestartPlayerAtTransform(Controller, FTransform(Facing, At));
			Character = Cast<AStoreRaidCharacter>(Controller.ControlledPawn);
		}
		else
		{
			Character.Movement.StopMovementImmediately();
			FHitResult Hit;
			Character.SetActorLocation(At, false, Hit, true);
			Character.SetActorRotation(Facing);
			Character.Movement.Rest();
		}
		AStoreRaidPlayerController Player = Cast<AStoreRaidPlayerController>(Controller);
		if (Player != nullptr)
			Player.ClientBrought(Yaw);
		if (Character != nullptr)
			Seat(Character);
	}

	/** Seated, a character stays put, facing across, until they get up; standing, they walk. */
	void Seat(AStoreRaidCharacter Character)
	{
		const AStoreRaidPlayerState Player = Cast<AStoreRaidPlayerState>(Character.PlayerState);
		const bool bSeated = Player != nullptr && Player.Seat >= 0;
		Character.ShowSeated(bSeated);
		Character.Movement.SetMovementMode(bSeated ? EMovementMode::MOVE_None : EMovementMode::MOVE_Walking);
	}

	/**
	 * Takes a player out of the building, or puts them back in: they drop what they hold, get up, and
	 * aren't ready any more. Out of it, their character goes; the controller then watches someone else.
	 */
	void SetRole(AStoreRaidPlayerState Player, ERole Role)
	{
		AController Controller = Cast<AController>(Player.Owner);
		AStoreRaidCharacter Character = Controller != nullptr ? Cast<AStoreRaidCharacter>(Controller.ControlledPawn) : nullptr;
		if (Character != nullptr)
		{
			Hands::DropAll(Character);
			Dimming.Remove(Character);
		}
		Player.SetRole(Role);
		Player.SetReady(false);
		Player.SetSeat(-1);
		if (Role != ERole::Playing && Character != nullptr)
		{
			Controller.UnPossess();
			Character.DestroyActor();
		}
	}

	/**
	 * Every player back in the building, in the truck, and every item where it started. In a game,
	 * those already sitting keep their seats, the rest take the free ones, then stand between. In the
	 * playground nobody moves, only the items go back.
	 */
	void ResetRound()
	{
		AStoreRaidGameState Room = State();
		Hands::PutAllBack();
		Room.TimeLeft = 0;
		if (Room.Mode != EMode::Game)
		{
			for (AStoreRaidPlayerState Player : Room.Players())
			{
				Player.SetRole(ERole::Playing);
				Player.SetReady(false);
				Player.SetSeat(-1);
				AController Controller = Cast<AController>(Player.Owner);
				if (Controller == nullptr)
					continue;
				if (Controller.ControlledPawn == nullptr)
					RestartPlayer(Controller);
				else
					Seat(Cast<AStoreRaidCharacter>(Controller.ControlledPawn));
			}
			return;
		}
		TArray<int> Taken;
		for (AStoreRaidPlayerState Player : Room.Players())
		{
			if (Player.IsPlaying() && Player.Seat >= 0)
				Taken.Add(Player.Seat);
		}
		int Index = 0;
		for (AStoreRaidPlayerState Player : Room.Players())
		{
			int SeatIndex = Player.IsPlaying() ? Player.Seat : -1;
			if (SeatIndex < 0)
			{
				for (int Free = 0; Free < Room.Parked.Seats.Num(); Free++)
				{
					if (!Taken.Contains(Free))
					{
						SeatIndex = Free;
						Taken.Add(Free);
						break;
					}
				}
			}
			SetRole(Player, ERole::Playing);
			Player.SetSeat(SeatIndex);
			AController Controller = Cast<AController>(Player.Owner);
			if (Controller == nullptr)
				continue;
			if (SeatIndex >= 0)
				Bring(Controller, SeatSpot(SeatIndex), Room.Parked.Seats[SeatIndex].Yaw);
			else
			{
				Bring(Controller, Room.Parked.Spawn(Index), Room.Parked.Place.Yaw());
				Index++;
			}
		}
	}

	/** Where a player sitting on a seat has their feet, in front of it. */
	FVector SeatSpot(int SeatIndex)
	{
		return State().Parked.Seats[SeatIndex].Feet;
	}

	/** The first of the truck's seats nobody sits on, or -1. */
	int FreeSeat()
	{
		TArray<int> Taken;
		for (AStoreRaidPlayerState Player : State().Players())
			Taken.Add(Player.Seat);
		for (int Index = 0; Index < State().Parked.Seats.Num(); Index++)
		{
			if (!Taken.Contains(Index))
				return Index;
		}
		return -1;
	}

	AStoreRaidPlayerState PlayerOf(AStoreRaidCharacter Character)
	{
		return Cast<AStoreRaidPlayerState>(Character.PlayerState);
	}

	/** Whether a character stands in the truck's cargo space. */
	bool InTruck(AStoreRaidCharacter Character)
	{
		const FVector2D At = World::GameXZ(Character.ActorLocation);
		return Modes::Inside(State().Parked.Dock, At.X, At.Y);
	}

	/**
	 * The grab button: a control box of the hatch, the dimmer, the nearest item in front of them, or
	 * else a free seat in the truck in front of them. Nothing while seated.
	 */
	void Grab(AStoreRaidCharacter Character)
	{
		const AStoreRaidPlayerState Player = PlayerOf(Character);
		if (Player == nullptr || !Player.IsPlaying() || Player.Seat >= 0)
			return;
		if (AtHatchPanel(Character))
		{
			PressHatch();
			return;
		}
		if (!IsGame() && AtDimmer(Character))
		{
			DimDirection = -DimDirection;
			Dimming.AddUnique(Character);
			return;
		}
		if (Hands::Grab(Character))
			return;
		SitDown(Character);
	}

	/** The grab button is up again: stop turning the dimmer. */
	void Release(AStoreRaidCharacter Character)
	{
		Dimming.Remove(Character);
	}

	/** Get up from a seat in the truck. */
	void Stand(AStoreRaidCharacter Character)
	{
		AStoreRaidPlayerState Player = PlayerOf(Character);
		if (Player == nullptr || Player.Seat < 0)
			return;
		Player.SetSeat(-1);
		Seat(Character);
	}

	/**
	 * In a game's lobby, ready to start, or not any more; in the raid, wanting to leave, which only
	 * counts in the truck. The truck leaves once everyone alive in the building wants to.
	 */
	void Ready(AStoreRaidPlayerState Player)
	{
		if (Player == nullptr || !Player.IsPlaying() || !IsGame())
			return;
		if (State().Phase == EPhase::Lobby)
			Player.SetReady(!Player.bReady);
		else if (State().Phase == EPhase::Raid)
		{
			AController Controller = Cast<AController>(Player.Owner);
			AStoreRaidCharacter Character = Controller != nullptr ? Cast<AStoreRaidCharacter>(Controller.ControlledPawn) : nullptr;
			if (Character != nullptr && InTruck(Character))
				Player.SetReady(!Player.bReady);
		}
	}

	/**
	 * Sit down on the nearest free seat in the truck that the player reaches for, unless their arms
	 * are full: they're put where a seated player is, facing across, and stay until they get up.
	 */
	void SitDown(AStoreRaidCharacter Character)
	{
		AStoreRaidGameState Room = State();
		if (!InTruck(Character))
			return;
		if (Character.Left != nullptr && Character.Left == Character.Right)
			return;
		TArray<int> Taken;
		for (AStoreRaidPlayerState Other : Room.Players())
			Taken.Add(Other.Seat);
		int Nearest = -1;
		float NearestDistance = 0;
		const FVector2D At = World::GameXZ(Character.ActorLocation);
		for (int Index = 0; Index < Room.Parked.Seats.Num(); Index++)
		{
			const FVector Middle = Room.Parked.Seats[Index].At;
			if (Taken.Contains(Index) || !Reaches(Character, Middle))
				continue;
			const float Distance = At.Distance(FVector2D(Middle.X, Middle.Z));
			if (Nearest < 0 || Distance < NearestDistance)
			{
				Nearest = Index;
				NearestDistance = Distance;
			}
		}
		if (Nearest < 0)
			return;
		PlayerOf(Character).SetSeat(Nearest);
		Bring(Character.Controller, SeatSpot(Nearest), Room.Parked.Seats[Nearest].Yaw);
	}

	/** Whether the player reaches one of the hatch's control boxes: in a raid, or the playground. */
	bool AtHatchPanel(AStoreRaidCharacter Character)
	{
		if (IsGame() && State().Phase != EPhase::Raid)
			return false;
		for (const FVector& Panel : State().Parked.Panels)
		{
			if (Reaches(Character, Panel))
				return true;
		}
		return false;
	}

	/** A button on a control box: the hatch goes the other way, unless someone stands in its way. */
	void PressHatch()
	{
		TArray<AStoreRaidCharacter> Characters;
		GetAllActorsOfClass(Characters);
		for (AStoreRaidCharacter Character : Characters)
		{
			const FVector2D At = World::GameXZ(Character.ActorLocation);
			if (Modes::Inside(State().Parked.HatchFootprint, At.X, At.Y))
			{
				Log(f"StoreRaid: the hatch stays: {Character.PlayerState.PlayerName} stands where it comes down");
				return;
			}
		}
		HatchGoal = HatchGoal == 1 ? 0 : 1;
		const FString Way = HatchGoal == 1 ? "down" : "up";
		Log(f"StoreRaid: the hatch goes {Way}");
	}

	/** Put the hatch somewhere at once: 0 up, 1 down. */
	void SetHatch(float At)
	{
		HatchGoal = At;
		State().Hatch = At;
		State().OnRep_Hatch();
	}

	/** Move the hatch towards where it's going. */
	void MoveHatch(float DeltaSeconds)
	{
		const float From = State().Hatch;
		if (From == HatchGoal)
			return;
		const float Step = DeltaSeconds / Truck::HATCH_TIME;
		State().Hatch = HatchGoal > From ? Math::Min(1.0, From + Step) : Math::Max(0.0, From - Step);
		State().OnRep_Hatch();
	}

	/** Whether the player is close to something on a wall (game meters), at the height of their hand, and looking at it. */
	bool Reaches(AStoreRaidCharacter Character, FVector Target)
	{
		const FVector Feet = Hands::FeetOf(Character);
		const FVector Toward = World::ToWorld(Target.X, Target.Y, Target.Z) - Feet;
		const float Distance = Toward.Size2D() / 100.0;
		if (Distance > Items::DIMMER_REACH || Math::Abs(Toward.Z / 100.0 - Items::DIMMER_HAND) > 1)
			return false;
		const FVector Facing = FRotator(0, Character.ActorRotation.Yaw, 0).ForwardVector;
		const float Ahead = (Toward.X * Facing.X + Toward.Y * Facing.Y) / 100.0;
		return Ahead >= Distance * Math::Cos(Math::DegreesToRadians(Items::GRAB_CONE));
	}

	bool AtDimmer(AStoreRaidCharacter Character)
	{
		return Reaches(Character, Playground::DIMMER);
	}

	/** Fades the lamps while someone holds the dimmer, turning round at fully on and off. */
	void Dim(float DeltaSeconds)
	{
		for (int Index = Dimming.Num() - 1; Index >= 0; Index--)
		{
			if (!IsValid(Dimming[Index]) || !AtDimmer(Dimming[Index]))
				Dimming.RemoveAt(Index);
		}
		if (Dimming.Num() == 0)
			return;
		AStoreRaidGameState Room = State();
		const float Light = Room.Light + DimDirection * DeltaSeconds / Items::DIM_TIME;
		if (Light >= 1 || Light <= 0)
			DimDirection = -DimDirection;
		Room.Light = Math::Clamp(Light, 0.0, 1.0);
		Room.OnRep_Light();
	}

	UFUNCTION(BlueprintOverride)
	void Tick(float DeltaSeconds)
	{
		AStoreRaidGameState Room = State();
		if (Room == nullptr)
			return;
		Dim(DeltaSeconds);
		MoveHatch(DeltaSeconds);
		Hands::CarryAll(DeltaSeconds, Playground::KILL_Y);

		// Falling below the level: dead in a raid, else back where they came in.
		TArray<AStoreRaidCharacter> Characters;
		GetAllActorsOfClass(Characters);
		for (AStoreRaidCharacter Character : Characters)
		{
			const float FeetY = (Character.ActorLocation.Z - Character.CapsuleComponent.ScaledCapsuleHalfHeight) / 100.0;
			if (FeetY < Playground::KILL_Y)
				Fell(Character);
		}

		// The loot: whatever is in the truck, even still in someone's hands.
		int Loot = 0;
		TArray<AStoreRaidItem> All;
		GetAllActorsOfClass(All);
		for (AStoreRaidItem Item : All)
		{
			if (Room.InTruck(Item.GamePosition()))
				Loot += Item.Info().Value;
		}
		Room.Loot = Loot;

		if (Room.Mode == EMode::Game)
			RunRound(DeltaSeconds);
	}

	/**
	 * A game's round: the lobby starts the raid once everyone is ready, the raid ends once everyone
	 * alive in the building is in the truck and wants to leave, or at dawn, and the results show for a
	 * while before the next round's lobby.
	 */
	void RunRound(float DeltaSeconds)
	{
		AStoreRaidGameState Room = State();
		TArray<AStoreRaidPlayerState> Crew;
		for (AStoreRaidPlayerState Player : Room.Players())
		{
			if (Player.IsPlaying())
				Crew.Add(Player);
		}
		bool bAllReady = true;
		for (AStoreRaidPlayerState Player : Crew)
			bAllReady = bAllReady && Player.bReady;

		if (Room.Phase == EPhase::Lobby)
		{
			if (Crew.Num() == 0 || !bAllReady)
				Room.TimeLeft = 0;
			else if (Room.TimeLeft == 0)
				Room.TimeLeft = Modes::START_TIME;
			else if (RunsOut(DeltaSeconds))
			{
				ResetRound();
				// Go: everyone gets up, and the hatch comes down.
				for (AStoreRaidPlayerState Player : Room.Players())
				{
					Player.SetSeat(-1);
					AController Controller = Cast<AController>(Player.Owner);
					AStoreRaidCharacter Character = Controller != nullptr ? Cast<AStoreRaidCharacter>(Controller.ControlledPawn) : nullptr;
					if (Character != nullptr)
						Seat(Character);
				}
				HatchGoal = 1;
				Room.Phase = EPhase::Raid;
				Room.TimeLeft = RaidTime;
				Log("StoreRaid: the raid begins");
			}
		}
		else if (Room.Phase == EPhase::Raid)
		{
			bool bLeaving = true;
			for (AStoreRaidPlayerState Player : Crew)
			{
				AStoreRaidCharacter Character = CharacterOf(Player);
				const bool bIn = Character != nullptr && InTruck(Character);
				if (!bIn && Player.bReady)
					Player.SetReady(false);
				bLeaving = bLeaving && Player.bReady;
			}
			RunsOut(DeltaSeconds);
			if (Room.TimeLeft == 0)
			{
				// Dawn: the truck goes, and anyone not in it is left behind.
				for (AStoreRaidPlayerState Player : Crew)
				{
					AStoreRaidCharacter Character = CharacterOf(Player);
					if (Character == nullptr || !InTruck(Character))
						SetRole(Player, ERole::Lost);
				}
			}
			// Everyone alive wants to go, which is also true once nobody is.
			if (bLeaving || Room.TimeLeft == 0)
			{
				Room.bCleared = Room.Loot >= Room.Quota;
				Room.Phase = EPhase::Results;
				Room.TimeLeft = Modes::RESULTS_TIME;
				const FString How = Room.bCleared ? "cleared" : "failed";
				Log(f"StoreRaid: the raid ends: {Room.Loot} of {Room.Quota}, {How}");
			}
		}
		else if (RunsOut(DeltaSeconds))
		{
			ResetRound();
			SetHatch(0);
			Room.Phase = EPhase::Lobby;
			Room.bCleared = false;
		}
	}

	/** Counts the clock down; true as it runs out. */
	bool RunsOut(float DeltaSeconds)
	{
		State().TimeLeft = Math::Max(0.0, State().TimeLeft - DeltaSeconds);
		return State().TimeLeft == 0;
	}

	AStoreRaidCharacter CharacterOf(AStoreRaidPlayerState Player)
	{
		AController Controller = Cast<AController>(Player.Owner);
		return Controller != nullptr ? Cast<AStoreRaidCharacter>(Controller.ControlledPawn) : nullptr;
	}

	/** Fell to their death. In a raid, that's them out until the next round; anywhere else, back to the start, empty-handed. */
	void Fell(AStoreRaidCharacter Character)
	{
		AStoreRaidPlayerState Player = PlayerOf(Character);
		if (IsGame() && State().Phase == EPhase::Raid && Player != nullptr)
		{
			Log(f"StoreRaid: {Player.PlayerName} fell to their death");
			SetRole(Player, ERole::Dead);
			return;
		}
		Respawn(Character);
		Log(f"StoreRaid: {Character.PlayerState.PlayerName} fell and respawned");
	}

	/** Back where they came in: in a game, in the truck; in the playground, at a free spawn point. */
	void Respawn(AStoreRaidCharacter Character)
	{
		AStoreRaidPlayerState Player = PlayerOf(Character);
		if (Player != nullptr && Player.Seat >= 0)
			Player.SetSeat(-1);
		Hands::DropAll(Character);
		if (IsGame())
		{
			JoinCount++;
			Bring(Character.Controller, State().Parked.Spawn(JoinCount), State().Parked.Place.Yaw());
			return;
		}
		const FVector2D Spawn = FreeSpawnPoint(Character);
		Bring(Character.Controller, FVector(Spawn.X, 0, Spawn.Y), 0);
	}

	/** The first spawn point with nobody on it but Ignoring: a player stands a meter from the next. */
	FVector2D FreeSpawnPoint(AStoreRaidCharacter Ignoring = nullptr)
	{
		TArray<AStoreRaidCharacter> Characters;
		GetAllActorsOfClass(Characters);
		for (int Index = 0; Index < 8; Index++)
		{
			const FVector2D Spawn = Playground::SpawnPoint(Index);
			bool bTaken = false;
			for (AStoreRaidCharacter Character : Characters)
			{
				if (Character != Ignoring && World::GameXZ(Character.ActorLocation).Distance(Spawn) < 0.7)
					bTaken = true;
			}
			if (!bTaken)
				return Spawn;
		}
		return Playground::SpawnPoint(0);
	}
}

// sr.mode <playground|game>, on the server: starts the room over in that mode.
const FConsoleCommand ModeCommand("sr.mode", n"OnModeCommand");
void OnModeCommand(TArray<FString> Arguments)
{
	AStoreRaidGameMode Mode = Cast<AStoreRaidGameMode>(Gameplay::GetGameMode());
	if (Mode == nullptr || Arguments.Num() < 1)
	{
		Log("StoreRaid mode: sr.mode playground|game, on the server");
		return;
	}
	Mode.SetMode(Arguments[0] == "game" ? EMode::Game : EMode::Playground);
}

// sr.clock <seconds>, on the server: sets what's left on the round's clock (to get to dawn quickly).
// sr.raidtime <seconds> sets how long the next raids last.
const FConsoleCommand ClockCommand("sr.clock", n"OnClockCommand");
void OnClockCommand(TArray<FString> Arguments)
{
	AStoreRaidGameState Room = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
	if (Cast<AStoreRaidGameMode>(Gameplay::GetGameMode()) == nullptr || Room == nullptr || Arguments.Num() < 1)
		return;
	Room.TimeLeft = String::Conv_StringToDouble(Arguments[0]);
}

const FConsoleCommand RaidTimeCommand("sr.raidtime", n"OnRaidTimeCommand");
void OnRaidTimeCommand(TArray<FString> Arguments)
{
	AStoreRaidGameMode Mode = Cast<AStoreRaidGameMode>(Gameplay::GetGameMode());
	if (Mode == nullptr || Arguments.Num() < 1)
		return;
	Mode.RaidTime = String::Conv_StringToDouble(Arguments[0]);
}
