// The ticks of the room, moved on the server: server/src/ticks.ts. See TickRules.as for what they
// do. Each is an ATick, replicated; clients only draw them. The game mode makes the nest once the
// level is built, puts the ticks on their perches as a raid starts (in the playground, at once),
// steps them every frame, and asks it first when a player grabs.

/** How high on a player a leap or a drop is aimed, above their feet. */
const float AIM_HEIGHT = 1.3;
/** Seconds a tick keeps going once it's out of a fitting's light, to get clear of its edge. */
const float FITTING_AFRAID = 0.4;
/** Seconds between looking for a new way to its prey, and before trying again when there was none. */
const float REPATH = 0.5;
const float REPATH_LOST = 2;
/** How fast someone throws a tick off, along the floor and up, in meters a second. */
const float THROW_ALONG = 3.5;
const float THROW_UP = 2;

/** A player the ticks can go after, as they see them, in game meters. */
struct FPrey
{
	AStoreRaidCharacter Character;
	APlayerState Player;
	FVector Feet;
	FVector Velocity;
	/** Radians from north, east positive. */
	float Yaw = 0;
};

/** A flashlight that's on: where its light starts, the way it points, and who holds it, if anyone. */
struct FBeam
{
	FVector From;
	FVector Direction;
	APlayerState Holder;
};

class ATickNest : AActor
{
	UStoreRaidTerrain Terrain;
	TArray<FPerch> Perches;
	TArray<ATick> Ticks;
	FLevel Level;
	FBoxXZ Dock;
	/** How many ticks a level starts with, when the server's -ticks=<n> says: -1 for as many as it has. */
	int Wanted = -1;

	void Build(FLevel InLevel, FBoxXZ InDock)
	{
		Level = InLevel;
		Dock = InDock;
		Terrain = Cast<UStoreRaidTerrain>(NewObject(this, UStoreRaidTerrain));
		TickRules::Give(Terrain, Level);
		Terrain.SetMover(TickRules::RADIUS, TickRules::HEIGHT, 0.35, 0.3);
		Perches = TickRules::Perches(Level, Terrain, Dock);
		TArray<FString> Tokens;
		TArray<FString> Switches;
		FCommandLine::Parse(FCommandLine::Get(), Tokens, Switches);
		for (const FString& Switch : Switches)
		{
			if (Switch.StartsWith("ticks="))
				Wanted = String::Conv_StringToInt(Switch.RightChop(6));
		}
		Log(f"StoreRaid: {Perches.Num()} places for ticks to wait");
	}

	AStoreRaidGameState Room()
	{
		return Cast<AStoreRaidGameState>(Gameplay::GetGameState());
	}

	/** No ticks: as the lobby and the results have none about. */
	void Clear()
	{
		for (ATick Tick : Ticks)
			Tick.DestroyActor();
		Ticks.Empty();
	}

	/** Every tick back where a raid starts them: on perches picked at random, waiting. */
	void Reset()
	{
		Clear();
		TArray<FPerch> Spots = Perches;
		for (int Index = Spots.Num() - 1; Index > 0; Index--)
			Spots.Swap(Index, Math::RandRange(0, Index));
		int Count = Wanted >= 0 ? Wanted : TickRules::Count(Level, Spots.Num());
		Count = Math::Min(Count, Spots.Num());
		for (int Index = 0; Index < Count; Index++)
		{
			const FPerch Home = Spots[Index];
			ATick Tick = Cast<ATick>(SpawnActor(ATick, World::ToWorld(Home.At.X, Home.At.Y, Home.At.Z)));
			Tick.Home = Home;
			Tick.Place(Home.At, Math::RandRange(0.0, PI * 2));
			Tick.State = Home.Box >= 0 ? ETickState::Perched : ETickState::Wandering;
			Tick.Timer = Math::RandRange(0.0, 3.0);
			Tick.Side = Math::RandBool() ? 1 : -1;
			Ticks.Add(Tick);
		}
	}

	/** The players in the building, as ticks see them. */
	TArray<FPrey> Players()
	{
		TArray<FPrey> Found;
		for (AStoreRaidPlayerState Player : Room().Players())
		{
			if (!Player.IsPlaying())
				continue;
			AStoreRaidCharacter Character = Cast<AStoreRaidCharacter>(Player.GetPawn());
			if (Character == nullptr)
				continue;
			FPrey Prey;
			Prey.Character = Character;
			Prey.Player = Player;
			const FVector Feet = Character.ActorLocation - FVector(0, 0, Character.CapsuleComponent.ScaledCapsuleHalfHeight);
			Prey.Feet = FVector(Feet.Y, Feet.Z, Feet.X) / 100.0;
			Prey.Velocity = FVector(Character.Velocity.Y, Character.Velocity.Z, Character.Velocity.X) / 100.0;
			Prey.Yaw = Math::DegreesToRadians(Character.ActorRotation.Yaw);
			Found.Add(Prey);
		}
		return Found;
	}

	/** Every flashlight that's on: held ones point where their holder looks, dropped ones as they lie. */
	TArray<FBeam> Beams()
	{
		TArray<FBeam> Found;
		TArray<AStoreRaidItem> Items;
		GetAllActorsOfClass(Items);
		for (AStoreRaidItem Item : Items)
		{
			if (Item.Kind != EItemKind::Flashlight || !Item.bOn)
				continue;
			FBeam Beam;
			TArray<AStoreRaidCharacter> Holders = Hands::CarriersOf(Item);
			if (Holders.Num() > 0)
			{
				AStoreRaidCharacter Holder = Holders[0];
				const FVector Feet = Holder.ActorLocation - FVector(0, 0, Holder.CapsuleComponent.ScaledCapsuleHalfHeight);
				Beam.From = FVector(Feet.Y, Feet.Z + 145, Feet.X) / 100.0;
				const FVector Look = Holder.GetControlRotation().ForwardVector;
				Beam.Direction = FVector(Look.Y, Look.Z, Look.X);
				Beam.Holder = Holder.PlayerState;
			}
			else
			{
				const FVector Lens = Item.Beam.WorldLocation;
				const FVector Look = Item.Beam.ForwardVector;
				Beam.From = FVector(Lens.Y, Lens.Z, Lens.X) / 100.0;
				Beam.Direction = FVector(Look.Y, Look.Z, Look.X);
			}
			Found.Add(Beam);
		}
		return Found;
	}

	/**
	 * A player grabs at a tick: the one on them, or one on someone in front of them. It takes a free
	 * hand. True if they pulled one off, which is then all their grab does.
	 */
	bool Pull(AStoreRaidCharacter Character)
	{
		if (Character.Left != nullptr && Character.Right != nullptr)
			return false;
		const FVector Mine = Character.ActorLocation;
		const float Yaw = Math::DegreesToRadians(Character.ActorRotation.Yaw);
		for (ATick Tick : Ticks)
		{
			if (Tick.State != ETickState::Latched || Tick.Victim == nullptr)
				continue;
			APawn Victim = Tick.Victim.GetPawn();
			if (Victim == nullptr)
				continue;
			if (Tick.Victim != Character.PlayerState)
			{
				// Someone else's, within reach and in front.
				const FVector Toward = (Victim.ActorLocation - Mine) / 100.0;
				const float Distance = Toward.Size2D();
				if (Distance > TickRules::REACH || Math::Abs(Toward.Z) > 1.5)
					continue;
				const FVector Facing = FRotator(0, Character.ActorRotation.Yaw, 0).ForwardVector;
				if (Toward.X * Facing.X + Toward.Y * Facing.Y < Distance * 0.35)
					continue;
			}
			// Thrown the way its victim faces, or off to the side of whoever pulled it from someone.
			const float Away = Tick.Victim == Character.PlayerState ? Yaw : Yaw + PI / 2;
			ThrowOff(Tick, Away, true);
			return true;
		}
		return false;
	}

	/** Whether a player has a tick on them. */
	bool HasTick(APlayerState Player)
	{
		for (ATick Tick : Ticks)
		{
			if (Tick.Victim == Player)
				return true;
		}
		return false;
	}

	/**
	 * One step of every tick. `Urgency` runs from 0 as a raid starts to 1 at dawn: they get faster,
	 * and past half way those still perched start coming down by themselves.
	 */
	void Step(float Dt, float Urgency)
	{
		if (Ticks.Num() == 0)
			return;
		AStoreRaidGameState State = Room();
		const FStoreRaidMechanics& M = State.Mechanics;
		Terrain.SetMover(TickRules::RADIUS, TickRules::HEIGHT, M.StepUp, M.StepDown);
		Terrain.SetLit(State.Light > 0);
		TArray<FPrey> Prey = Players();
		TArray<FBeam> Lights = Beams();
		// With a playground's lights up, they only wander.
		const bool bBright = State.Mode == EMode::Playground && State.Light > TickRules::BRIGHT;
		const float Haste = 1 + (TickRules::DAWN - 1) * Urgency;

		for (ATick Tick : Ticks)
		{
			FVector Light;
			const bool bLit = LightOn(Tick, Lights, Light);
			// On the floor in a fitting's light, carried or thrown there: it gets out of it, as from a beam.
			const bool bWalking = Tick.State == ETickState::Wandering || Tick.State == ETickState::Hunting || Tick.State == ETickState::Fleeing;
			const int Pool = bWalking ? Terrain.PoolOver(Tick.Position.X, Tick.Position.Y, Tick.Position.Z) : -1;
			if (bLit)
			{
				Tick.Afraid = TickRules::AFRAID;
				Tick.From = Light;
				Tick.bHasFrom = true;
			}
			else if (Pool >= 0)
			{
				Tick.Afraid = Math::Max(Tick.Afraid, FITTING_AFRAID);
				const FLightSpawn Fitting = WorkingLight(Pool);
				Tick.From = FVector(Fitting.X, Fitting.Y, Fitting.Z);
				Tick.bHasFrom = true;
			}
			else
				Tick.Afraid = Math::Max(0.0, Tick.Afraid - Dt);
			Tick.Rest = Math::Max(0.0, Tick.Rest - Dt);

			switch (Tick.State)
			{
				case ETickState::Perched:
				case ETickState::Wary:
					Perch(Tick, Prey, bBright, Urgency, Dt);
					break;
				case ETickState::Airborne:
					Fly(Tick, Prey, Dt);
					break;
				case ETickState::Latched:
					Feed(Tick, bLit, Dt);
					break;
				case ETickState::Stunned:
					Tick.Timer -= Dt;
					if (Tick.Timer <= 0)
					{
						Tick.State = ETickState::Hunting;
						Tick.Rest = Math::Max(Tick.Rest, 1.0);
					}
					break;
				case ETickState::Wandering:
				{
					FPrey Found;
					if (Tick.Afraid > 0)
						Tick.State = ETickState::Fleeing;
					else if (!bBright && Nearest(Tick, Prey, Found))
						Tick.State = ETickState::Hunting;
					else
						Wander(Tick, Dt);
					break;
				}
				case ETickState::Hunting:
					if (Tick.Afraid > 0)
						Tick.State = ETickState::Fleeing;
					else if (bBright)
						Tick.State = ETickState::Wandering;
					else
						Hunt(Tick, Prey, Haste, Dt);
					break;
				case ETickState::Fleeing:
					if (Tick.Afraid <= 0)
					{
						Tick.State = ETickState::Hunting;
						Tick.Rest = Math::Max(Tick.Rest, 1.0);
						Tick.bHasPath = false;
						Tick.Repath = 0;
					}
					else
						Flee(Tick, Haste, Dt);
					break;
			}
		}
	}

	/** The pool-th working fitting, as the terrain numbered them in TickRules::Give. */
	FLightSpawn WorkingLight(int Pool)
	{
		int Seen = 0;
		for (const FLightSpawn& Light : Level.Lights)
		{
			if (Light.State != ELightState::On || Light.Kind == ELightKind::Exit)
				continue;
			if (Seen++ == Pool)
				return Light;
		}
		return FLightSpawn();
	}

	/** The beam that reaches a tick, if any, and where it comes from. Its own victim's doesn't count. */
	bool LightOn(ATick Tick, TArray<FBeam> Lights, FVector& OutFrom)
	{
		const FVector Middle = Tick.Position + FVector(0, TickRules::MIDDLE, 0);
		const bool bPerched = Tick.State == ETickState::Perched || Tick.State == ETickState::Wary;
		const int Under = bPerched ? Tick.Home.Box : -1;
		for (const FBeam& Beam : Lights)
		{
			if (Tick.Victim != nullptr && Beam.Holder == Tick.Victim)
				continue;
			if (TickRules::InBeam(Beam.From, Beam.Direction, Middle) && Terrain.ClearLine(Beam.From, Middle, Under))
			{
				OutFrom = Beam.From;
				return true;
			}
		}
		return false;
	}

	/** The nearest player a tick on the floor can sense: in the dark, out of the truck, tick-free. */
	bool Nearest(ATick Tick, TArray<FPrey> Prey, FPrey& OutFound)
	{
		bool bFound = false;
		float Least = TickRules::SENSE;
		for (const FPrey& One : Prey)
		{
			if (Math::Abs(One.Feet.Y - Tick.Position.Y) > TickRules::SENSE_HEIGHT)
				continue;
			const float Distance = Flat(One.Feet - Tick.Position);
			if (Distance >= Least || HasTick(One.Player))
				continue;
			if (Modes::Inside(Dock, One.Feet.X, One.Feet.Z))
				continue;
			if (Terrain.PoolOver(One.Feet.X, One.Feet.Y, One.Feet.Z) >= 0)
				continue;
			OutFound = One;
			Least = Distance;
			bFound = true;
		}
		return bFound;
	}

	/** How far across the floor an offset in game meters reaches. */
	float Flat(FVector Offset)
	{
		return Math::Sqrt(Offset.X * Offset.X + Offset.Z * Offset.Z);
	}

	/** Waiting on its perch: it drops on whoever comes under it, unless a light has found it. */
	void Perch(ATick Tick, TArray<FPrey> Prey, bool bBright, float Urgency, float Dt)
	{
		Tick.State = Tick.Afraid > 0 ? ETickState::Wary : ETickState::Perched;
		if (Tick.Afraid > 0 || bBright)
			return;
		for (const FPrey& One : Prey)
		{
			const float Above = Tick.Position.Y - One.Feet.Y;
			if (Above < 1 || Above > 4.5 || HasTick(One.Player))
				continue;
			if (Flat(One.Feet - Tick.Position) > TickRules::DROP_RANGE)
				continue;
			// Onto where they'll be when it gets there.
			const float Time = FallTime(Above - AIM_HEIGHT);
			Launch(Tick, One.Feet + One.Velocity * FVector(Time, 0, Time) + FVector(0, AIM_HEIGHT, 0), Time, Tick.Home.Box);
			return;
		}
		// As dawn nears, they stop waiting and come down to look.
		if (Urgency > 0.5 && Tick.Home.Box >= 0 && Math::RandRange(0.0, 1.0) < Dt / 40)
		{
			const FLevelBox& Box = Level.Boxes[Tick.Home.Box];
			for (int Index = 0; Index < 8; Index++)
			{
				const float Angle = Index / 8.0 * PI * 2 + Tick.Yaw;
				const float Reach = Math::Min(Math::Max(Box.MaxX - Box.MinX, Box.MaxZ - Box.MinZ) / 2 + 0.8, 1.6);
				const float X = Tick.Position.X + Math::Sin(Angle) * Reach;
				const float Z = Tick.Position.Z + Math::Cos(Angle) * Reach;
				const float Y = Terrain.Standing(X, Box.Y, Z, false);
				if (!TickRules::Stands(Y))
					continue;
				Launch(Tick, FVector(X, Y, Z), FallTime(Tick.Position.Y - Y), Tick.Home.Box);
				return;
			}
		}
	}

	/** Seconds to fall `Height` meters, after a small hop up. */
	float FallTime(float Height)
	{
		const float Hop = 1.5;
		return (Hop + Math::Sqrt(Hop * Hop + 2 * TickRules::GRAVITY * Math::Max(0.0, Height))) / TickRules::GRAVITY;
	}

	/** Into the air, to be at `To` after `Time` seconds; `Off` is the racking it leaves, if it drops. */
	void Launch(ATick Tick, FVector To, float Time, int Off = -1)
	{
		Tick.Off = Off;
		Tick.Velocity = FVector(
			(To.X - Tick.Position.X) / Time,
			(To.Y - Tick.Position.Y + 0.5 * TickRules::GRAVITY * Time * Time) / Time,
			(To.Z - Tick.Position.Z) / Time);
		Tick.bLandStunned = false;
		Tick.bHasPath = false;
		Tick.Repath = 0;
		Tick.Yaw = Math::Atan2(Tick.Velocity.X, Tick.Velocity.Z);
		Tick.State = ETickState::Airborne;
	}

	/** Off whoever it's on, thrown the way `Yaw` points. */
	void ThrowOff(ATick Tick, float Yaw, bool bStunned)
	{
		Tick.Victim = nullptr;
		Tick.Velocity = FVector(Math::Sin(Yaw) * THROW_ALONG, THROW_UP, Math::Cos(Yaw) * THROW_ALONG);
		Tick.bLandStunned = bStunned;
		Tick.Shone = 0;
		Tick.Off = -1;
		Tick.State = ETickState::Airborne;
	}

	/**
	 * In the air: it latches onto a player it passes, stops at whatever is in the way, racking as
	 * much as walls, so it never lands inside something, and lands on the floor.
	 */
	void Fly(ATick Tick, TArray<FPrey> Prey, float Dt)
	{
		FVector At = Tick.Position;
		const float Before = At.Y;
		Tick.Velocity.Y -= TickRules::GRAVITY * Dt;
		At.Y += Tick.Velocity.Y * Dt;
		const FVector Moved = Terrain.Slide(At.X + Tick.Velocity.X * Dt, At.Z + Tick.Velocity.Z * Dt, At.Y, At.Y + TickRules::HEIGHT, Tick.Off);
		// Which ways something stopped it: 1 along x, 2 along z.
		const int Blocked = Math::RoundToInt(Moved.Z);
		if (Blocked == 1 || Blocked == 3)
			Tick.Velocity.X = 0;
		if (Blocked >= 2)
			Tick.Velocity.Z = 0;
		At.X = Moved.X;
		At.Z = Moved.Y;
		Tick.Position = At;

		if (!Tick.bLandStunned && Tick.Afraid <= 0)
		{
			for (const FPrey& One : Prey)
			{
				if (At.Y < One.Feet.Y + 0.4 || At.Y > One.Feet.Y + 2)
					continue;
				if (Flat(One.Feet - At) > TickRules::LATCH || HasTick(One.Player))
					continue;
				Tick.Victim = One.Player;
				Tick.State = ETickState::Latched;
				Tick.Shone = 0;
				Log(f"StoreRaid: a tick latched onto {One.Player.PlayerName}");
				return;
			}
		}
		const float Ground = Terrain.GroundUnder(At.X, At.Z, Math::Max(Before, At.Y) + 0.3);
		if (Tick.Velocity.Y <= 0 && At.Y <= Ground)
		{
			Tick.Position.Y = Ground;
			Tick.Velocity = FVector::ZeroVector;
			Tick.Off = -1;
			StepOut(Tick);
			if (Tick.bLandStunned)
			{
				Tick.State = ETickState::Stunned;
				Tick.Timer = TickRules::STUN;
			}
			else
				Tick.State = Tick.Afraid > 0 ? ETickState::Fleeing : ETickState::Hunting;
			Tick.Rest = Math::Max(Tick.Rest, 0.8);
		}
		else if (At.Y < Level.KillY)
		{
			// Fell out of the level: back where it started.
			Tick.Position = Tick.Home.At;
			Tick.State = Tick.Home.Box >= 0 ? ETickState::Perched : ETickState::Wandering;
		}
	}

	/** Out of whatever a tick has landed in, to the nearest side: inside a box it could neither walk nor find a way. */
	void StepOut(ATick Tick)
	{
		const FStoreRaidMechanics& M = Room().Mechanics;
		FVector At(Tick.Position.X, Tick.Position.Z, 0);
		for (int Pass = 0; Pass < 2; Pass++)
			At = Terrain.Slide(At.X, At.Y, Tick.Position.Y + M.StepUp, Tick.Position.Y + TickRules::HEIGHT, -1);
		const float Ground = Terrain.GroundUnder(At.X, At.Y, Tick.Position.Y + M.StepUp);
		if (Math::Abs(Ground - Tick.Position.Y) > M.StepDown + 0.3)
			return;
		Tick.Position = FVector(At.X, Ground, At.Y);
	}

	/** On a player: it rides in front of their face and drains them, until pulled or shone off. */
	void Feed(ATick Tick, bool bShone, float Dt)
	{
		AStoreRaidPlayerState Victim = Cast<AStoreRaidPlayerState>(Tick.Victim);
		AStoreRaidCharacter Character = Victim != nullptr ? Cast<AStoreRaidCharacter>(Victim.GetPawn()) : nullptr;
		if (Character == nullptr || !Victim.IsPlaying())
		{
			Fall(Tick);
			return;
		}
		const FVector Feet = Character.ActorLocation - FVector(0, 0, Character.CapsuleComponent.ScaledCapsuleHalfHeight);
		const float Yaw = Math::DegreesToRadians(Character.ActorRotation.Yaw);
		Tick.Position = FVector(Feet.Y / 100 + Math::Sin(Yaw) * TickRules::LATCH_AHEAD, Feet.Z / 100 + TickRules::LATCH_HEIGHT, Feet.X / 100 + Math::Cos(Yaw) * TickRules::LATCH_AHEAD);
		Tick.Yaw = Yaw + PI;
		// Someone else's light on it for a moment, and it lets go, away from the light.
		Tick.Shone = bShone ? Tick.Shone + Dt : 0;
		if (Tick.Shone > TickRules::LET_GO && Tick.bHasFrom)
		{
			ThrowOff(Tick, Math::Atan2(Tick.Position.X - Tick.From.X, Tick.Position.Z - Tick.From.Z), false);
			return;
		}
		AStoreRaidGameMode Mode = Cast<AStoreRaidGameMode>(Gameplay::GetGameMode());
		if (Mode.Hurt(Victim, TickRules::BITE * Dt, "was drained by a tick"))
			Fall(Tick);
	}

	/** Lets go and drops to the floor. */
	void Fall(ATick Tick)
	{
		Tick.Victim = nullptr;
		Tick.Velocity = FVector::ZeroVector;
		Tick.bLandStunned = false;
		Tick.Rest = TickRules::LEAP_REST;
		Tick.Off = -1;
		Tick.State = ETickState::Airborne;
	}

	/** Nobody to hunt: a few steps to somewhere near, a pause, and on. */
	void Wander(ATick Tick, float Dt)
	{
		if (!Tick.bHasGoal)
		{
			Tick.Timer -= Dt;
			if (Tick.Timer > 0)
				return;
			const float Angle = Math::RandRange(0.0, PI * 2);
			const float Far = Math::RandRange(1.0, 3.0);
			const FVector Goal(Tick.Position.X + Math::Sin(Angle) * Far, Tick.Position.Y, Tick.Position.Z + Math::Cos(Angle) * Far);
			const FVector At = Tick.Position + FVector(0, TickRules::MIDDLE, 0);
			if (TickRules::Stands(Terrain.Standing(Goal.X, Tick.Position.Y, Goal.Z, true)) && Terrain.ClearLine(At, FVector(Goal.X, At.Y, Goal.Z), -1))
			{
				Tick.Goal = Goal;
				Tick.bHasGoal = true;
			}
			else
				Tick.Timer = 0.5;
			return;
		}
		const float DX = Tick.Goal.X - Tick.Position.X;
		const float DZ = Tick.Goal.Z - Tick.Position.Z;
		if (Math::Sqrt(DX * DX + DZ * DZ) < 0.15 || Walk(Tick, DX, DZ, TickRules::WANDER, Dt) < TickRules::WANDER * Dt * 0.3)
		{
			Tick.bHasGoal = false;
			Tick.Timer = Math::RandRange(1.5, 4.5);
		}
	}

	/** After its prey: round what's in the way, and a leap once it's near. */
	void Hunt(ATick Tick, TArray<FPrey> Prey, float Haste, float Dt)
	{
		FPrey Target;
		if (!Nearest(Tick, Prey, Target))
		{
			Tick.State = ETickState::Wandering;
			Tick.bHasGoal = false;
			Tick.bHasPath = false;
			Tick.Timer = 1;
			return;
		}
		const float DX = Target.Feet.X - Tick.Position.X;
		const float DZ = Target.Feet.Z - Tick.Position.Z;
		const float Distance = Math::Sqrt(DX * DX + DZ * DZ);
		const FVector Middle = Tick.Position + FVector(0, TickRules::MIDDLE, 0);
		const FVector Chest = Target.Feet + FVector(0, AIM_HEIGHT, 0);
		const bool bSeen = Terrain.ClearLine(Middle, Chest, -1);
		if (Distance < TickRules::LEAP_RANGE && Tick.Rest <= 0 && bSeen && Math::Abs(Target.Feet.Y - Tick.Position.Y) < 1.5)
		{
			const float Time = TickRules::LEAP_TIME;
			Launch(Tick, Chest + Target.Velocity * FVector(Time, 0, Time), Time);
			Tick.Rest = TickRules::LEAP_REST;
			return;
		}
		// Resting between leaps, it keeps its distance, facing them.
		if (Distance < 1.2 && bSeen)
		{
			Turn(Tick, DX, DZ, Dt);
			return;
		}
		// Not every step when there's no way: a search that fails is the dearest kind.
		Tick.Repath -= Dt;
		if (Tick.Repath <= 0)
		{
			// Straight at them when nothing's between and no fitting lights the way, else the way round.
			const bool bStraight = bSeen && Distance < 6 && Terrain.ClearLine(Middle, FVector(Target.Feet.X, Middle.Y, Target.Feet.Z), -1) && Terrain.DarkWay(Tick.Position, Target.Feet);
			if (bStraight)
			{
				Tick.Path.Empty();
				Tick.Path.Add(Target.Feet);
				Tick.bHasPath = true;
			}
			else
			{
				Tick.bHasPath = Terrain.FindPath(Tick.Position, Target.Feet);
				if (Tick.bHasPath)
					Tick.Path = Terrain.Path();
			}
			Tick.Repath = Tick.bHasPath ? REPATH : REPATH_LOST;
		}
		while (Tick.bHasPath && Tick.Path.Num() > 1 && Flat(Tick.Path[0] - Tick.Position) < 0.35)
			Tick.Path.RemoveAt(0);
		// No way to them it can find: it looks about where it is, rather than walk into what's between.
		if (!Tick.bHasPath)
		{
			Wander(Tick, Dt);
			return;
		}
		Walk(Tick, Tick.Path[0].X - Tick.Position.X, Tick.Path[0].Z - Tick.Position.Z, TickRules::HUNT * Haste, Dt);
	}

	/** Away from the light, and sideways along whatever stops it. */
	void Flee(ATick Tick, float Haste, float Dt)
	{
		const FVector Light = Tick.bHasFrom ? Tick.From : Tick.Position + FVector(0, 0, 1);
		float DX = Tick.Position.X - Light.X;
		float DZ = Tick.Position.Z - Light.Z;
		float Length = Math::Sqrt(DX * DX + DZ * DZ);
		if (Length == 0)
			Length = 1;
		DX /= Length;
		DZ /= Length;
		const float Speed = TickRules::FLEE * Haste;
		if (Walk(Tick, DX, DZ, Speed, Dt) >= Speed * Dt * 0.3)
			return;
		if (Walk(Tick, -DZ * Tick.Side, DX * Tick.Side, Speed, Dt) < Speed * Dt * 0.3)
			Tick.Side = -Tick.Side;
	}

	void Turn(ATick Tick, float DX, float DZ, float Dt)
	{
		const float Want = Math::Atan2(DX, DZ);
		const float Off = Math::Atan2(Math::Sin(Want - Tick.Yaw), Math::Cos(Want - Tick.Yaw));
		Tick.Yaw += Math::Clamp(Off, -TickRules::TURN * Dt, TickRules::TURN * Dt);
	}

	/**
	 * A step across the floor towards (DX, DZ), at the pace of the ground as players go, stopped by
	 * what's in the way and never off an edge. Returns how far it got.
	 */
	float Walk(ATick Tick, float DX, float DZ, float Speed, float Dt)
	{
		const float Length = Math::Sqrt(DX * DX + DZ * DZ);
		if (Length == 0)
			return 0;
		const FStoreRaidMechanics& M = Room().Mechanics;
		const FVector At = Tick.Position;
		const float Pace = Terrain.Pace(At.X, At.Y, At.Z, DX, DZ, M.Uphill);
		const float Step = Math::Min(Length, Speed * Pace * Dt);
		const FVector Moved = Terrain.Slide(At.X + DX / Length * Step, At.Z + DZ / Length * Step, At.Y + M.StepUp, At.Y + TickRules::HEIGHT, -1);
		Turn(Tick, DX, DZ, Dt);
		const float Ground = Terrain.GroundUnder(Moved.X, Moved.Y, At.Y + M.StepUp);
		if (At.Y - Ground > M.StepDown + 0.3)
			return 0;
		const float Got = Math::Sqrt(Math::Square(Moved.X - At.X) + Math::Square(Moved.Y - At.Z));
		Tick.Position = FVector(Moved.X, Ground, Moved.Y);
		return Got;
	}
}

// sr.sic [meters]: on the server, puts the first tick on the floor that far (default 4) in front of
// the first player in the building, hunting, for checks and for a look at one up close.
const FConsoleCommand SicCommand("sr.sic", n"OnSicCommand");
void OnSicCommand(TArray<FString> Arguments)
{
	AStoreRaidGameMode Mode = Cast<AStoreRaidGameMode>(Gameplay::GetGameMode());
	if (Mode == nullptr || Mode.Ticks() == nullptr)
		return;
	ATickNest Nest = Mode.Ticks();
	TArray<FPrey> Prey = Nest.Players();
	if (Prey.Num() == 0 || Nest.Ticks.Num() == 0)
	{
		Log("StoreRaid sic: no player or no tick");
		return;
	}
	const float Far = Arguments.Num() > 0 ? String::Conv_StringToDouble(Arguments[0]) : 4.0;
	ATick Tick = Nest.Ticks[0];
	const FVector At = Prey[0].Feet + FVector(Math::Sin(Prey[0].Yaw) * Far, 0, Math::Cos(Prey[0].Yaw) * Far);
	const float Ground = Nest.Terrain.GroundUnder(At.X, At.Z, At.Y + 0.5);
	Tick.Victim = nullptr;
	Tick.Place(FVector(At.X, TickRules::Stands(Ground) ? Ground : At.Y, At.Z), Prey[0].Yaw + PI);
	Tick.State = ETickState::Hunting;
	Tick.Afraid = 0;
	Tick.Rest = 0;
	Tick.bHasPath = false;
	Tick.Repath = 0;
	Log(f"StoreRaid sic: tick at {Tick.Position.X :.2} {Tick.Position.Y :.2} {Tick.Position.Z :.2}");
}

// sr.health <amount> [name]: on the server, sets a player's health, the first in the building's
// unless named, to see how close to death looks, or to give a check time.
const FConsoleCommand HealthCommand("sr.health", n"OnHealthCommand");
void OnHealthCommand(TArray<FString> Arguments)
{
	AStoreRaidGameState Room = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
	if (Room == nullptr || Arguments.Num() < 1)
		return;
	for (AStoreRaidPlayerState Player : Room.Players())
	{
		if (!Player.IsPlaying() || (Arguments.Num() > 1 && Player.PlayerName != Arguments[1]))
			continue;
		Player.SetHealth(Math::Clamp(String::Conv_StringToDouble(Arguments[0]), 0.0, Health::MAX));
		Log(f"StoreRaid health: {Player.PlayerName} {Player.Health :.1}");
		return;
	}
}
