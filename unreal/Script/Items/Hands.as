// Grabbing, carrying and letting go, on the server: the item half of server/src/rooms/GameRoom.ts.
// Each player has a left and a right hand (AStoreRaidCharacter.Left/Right), each holding one item,
// or both holding the same two-handed one. Grab takes the nearest item in front of the player that
// fits, with the right hand if it's free, else the left; drop lets go of the last thing grabbed.
// Carried items are pulled by velocity to where they're held, so they can't pass through walls.

namespace Hands
{
	/** Everyone holding an item, in the order they joined. */
	TArray<AStoreRaidCharacter> CarriersOf(AStoreRaidItem Item)
	{
		TArray<AStoreRaidCharacter> Carriers;
		TArray<AStoreRaidCharacter> Characters;
		GetAllActorsOfClass(Characters);
		for (AStoreRaidCharacter Character : Characters)
		{
			if (Character.Left == Item || Character.Right == Item)
				Carriers.Add(Character);
		}
		return Carriers;
	}

	/**
	 * The point of an item nearest to the player's waist, however it's turned or tipped over (Unreal
	 * units), and how far that is from the player's centre on the ground (meters).
	 */
	FVector NearestPoint(AStoreRaidCharacter Character, AStoreRaidItem Item, float& OutGap)
	{
		// Into the item's own frame, where the cube is 100 across, clamp to it, and back out again.
		const FTransform Frame = Item.ActorTransform;
		const FVector Local = Frame.InverseTransformPosition(Character.ActorLocation);
		const FVector Clamped(Math::Clamp(Local.X, -50.0, 50.0), Math::Clamp(Local.Y, -50.0, 50.0), Math::Clamp(Local.Z, -50.0, 50.0));
		const FVector Point = Frame.TransformPosition(Clamped);
		OutGap = (Point - Character.ActorLocation).Size2D() / 100.0;
		return Point;
	}

	/** Feet of a character, in Unreal units. */
	FVector FeetOf(AStoreRaidCharacter Character)
	{
		return Character.ActorLocation - FVector(0, 0, Character.CapsuleComponent.ScaledCapsuleHalfHeight);
	}

	/**
	 * Takes hold of the nearest item in reach and in front of the player that a free hand can take.
	 * True if they took something.
	 */
	bool Grab(AStoreRaidCharacter Character)
	{
		const bool bRightFree = Character.Right == nullptr;
		const bool bBothFree = bRightFree && Character.Left == nullptr;
		if (!bRightFree && Character.Left != nullptr)
			return false;

		const FVector Feet = FeetOf(Character);
		const FVector Facing = FRotator(0, Character.ActorRotation.Yaw, 0).ForwardVector;
		AStoreRaidItem Nearest;
		float NearestGap = Items::REACH;
		TArray<AStoreRaidItem> All;
		GetAllActorsOfClass(All);
		for (AStoreRaidItem Item : All)
		{
			const FItemKindInfo Kind = Item.Info();
			if (Kind.Hands == 2 && !bBothFree)
				continue;
			if (CarriersOf(Item).Num() >= Kind.Carriers)
				continue;
			float Gap = 0;
			const FVector Point = NearestPoint(Character, Item, Gap);
			const float Height = (Point.Z - Feet.Z) / 100.0;
			if (Height < -Items::GRAB_BELOW || Height > Items::GRAB_ABOVE)
				continue;
			// Ahead of where the player looks, unless they're already touching it.
			const FVector Toward = Point - Character.ActorLocation;
			const float Ahead = (Toward.X * Facing.X + Toward.Y * Facing.Y) / 100.0;
			if (Gap > 0.3 && Ahead < Gap * Math::Cos(Math::DegreesToRadians(Items::GRAB_CONE)))
				continue;
			if (Gap < NearestGap)
			{
				Nearest = Item;
				NearestGap = Gap;
			}
		}
		if (Nearest == nullptr)
			return false;
		if (Nearest.Info().Hands == 2)
		{
			Character.Left = Nearest;
			Character.Right = Nearest;
		}
		else if (bRightFree)
			Character.Right = Nearest;
		else
			Character.Left = Nearest;
		Character.OnHandsChanged();
		return true;
	}

	/** Lets go of the last thing grabbed: the left hand's if it holds anything, else the right's. */
	void DropLast(AStoreRaidCharacter Character)
	{
		AStoreRaidItem Item = Character.Left != nullptr ? Character.Left : Character.Right;
		if (Item != nullptr)
			Drop(Character, Item);
	}

	/** Lets go of an item. Off the ground, that drops it for everyone: one person can't hold up a sofa. */
	void Drop(AStoreRaidCharacter Character, AStoreRaidItem Item)
	{
		if (Character.Left == Item)
			Character.Left = nullptr;
		if (Character.Right == Item)
			Character.Right = nullptr;
		Character.OnHandsChanged();
		if (Item.bLifted)
		{
			LetGo(Item);
			DropItem(Item);
		}
	}

	/** Everyone holding it lets go. */
	void DropItem(AStoreRaidItem Item)
	{
		for (AStoreRaidCharacter Carrier : CarriersOf(Item))
			Drop(Carrier, Item);
	}

	/** Lets go of everything in both hands, as a player leaving or falling does. */
	void DropAll(AStoreRaidCharacter Character)
	{
		if (Character.Left != nullptr)
			Drop(Character, Character.Left);
		if (Character.Right != nullptr)
			Drop(Character, Character.Right);
	}

	/** Picked up: gravity stops applying and Carry steers it, through players. It still hits shelves on the way. */
	void Lift(AStoreRaidItem Item)
	{
		Item.bLifted = true;
		Item.Falling = 0;
		Item.Lagging = 0;
		Item.Mesh.SetEnableGravity(false);
		Item.SetShovable(false);
		Item.Mesh.WakeAllRigidBodies();
	}

	/**
	 * Let go: it falls again, with a bit of spin so it tumbles. It still passes through players, who
	 * are standing right against it and would catch it, until FALL_TIME has gone by.
	 */
	void LetGo(AStoreRaidItem Item)
	{
		Item.bLifted = false;
		Item.Lagging = 0;
		Item.Falling = Items::FALL_TIME;
		Item.Mesh.SetEnableGravity(true);
		const float Spin = Items::DROP_SPIN;
		Item.Mesh.SetPhysicsAngularVelocityInRadians(FVector(Math::RandRange(-Spin, Spin), Math::RandRange(-Spin, Spin), Math::RandRange(-Spin, Spin)), false, NAME_None);
	}

	/** Puts an item somewhere at once, upright and still. */
	void Place(AStoreRaidItem Item, FVector Location)
	{
		FHitResult Hit;
		Item.SetActorLocationAndRotation(Location, FRotator::ZeroRotator, false, Hit, true);
		Item.Mesh.SetPhysicsLinearVelocity(FVector::ZeroVector, false, NAME_None);
		Item.Mesh.SetPhysicsAngularVelocityInRadians(FVector::ZeroVector, false, NAME_None);
	}

	/** Every item back where it started, switched off, out of everyone's hands. */
	void PutAllBack()
	{
		TArray<AStoreRaidItem> All;
		GetAllActorsOfClass(All);
		for (AStoreRaidItem Item : All)
		{
			DropItem(Item);
			Place(Item, World::ToWorld(Item.Spawn.X, Item.Spawn.Y, Item.Spawn.Z));
			Item.Falling = 0;
			Item.SetShovable(true);
			Item.bOn = false;
			Item.OnRep_On();
		}
	}

	/** Switches the flashlights in a player's hands on, or off if any is on. */
	void Light(AStoreRaidCharacter Character)
	{
		TArray<AStoreRaidItem> Held;
		if (Character.Right != nullptr && Character.Right.Kind == EItemKind::Flashlight)
			Held.Add(Character.Right);
		if (Character.Left != nullptr && Character.Left.Kind == EItemKind::Flashlight && Character.Left != Character.Right)
			Held.Add(Character.Left);
		bool bAnyOn = false;
		for (AStoreRaidItem Item : Held)
			bAnyOn = bAnyOn || Item.bOn;
		for (AStoreRaidItem Item : Held)
		{
			Item.bOn = !bAnyOn;
			Item.OnRep_On();
		}
	}

	/** Steers everything being carried, and lets go of whatever can't be held any more. Every tick, on the server. */
	void CarryAll(float DeltaSeconds, float KillY)
	{
		TArray<AStoreRaidItem> All;
		GetAllActorsOfClass(All);
		for (AStoreRaidItem Item : All)
		{
			// Fallen out of the level: back where it started.
			if (Item.ActorLocation.Z / 100.0 < KillY)
			{
				DropItem(Item);
				Place(Item, World::ToWorld(Item.Spawn.X, Item.Spawn.Y, Item.Spawn.Z));
				Item.Falling = 0;
				Item.SetShovable(true);
				continue;
			}
			if (Item.Falling > 0)
			{
				Item.Falling -= DeltaSeconds;
				if (Item.Falling <= 0)
					Item.SetShovable(true);
			}

			const FItemKindInfo Kind = Item.Info();
			TArray<AStoreRaidCharacter> Carriers = CarriersOf(Item);
			if (Carriers.Num() < Kind.Carriers)
			{
				// Not enough people to lift it: they can only stand there holding on, while in reach.
				for (AStoreRaidCharacter Carrier : Carriers)
				{
					float Gap = 0;
					NearestPoint(Carrier, Item, Gap);
					if (Gap > Items::REACH)
					{
						DropItem(Item);
						break;
					}
				}
				continue;
			}
			if (Carriers.Num() == 0)
				continue;
			if (!Item.bLifted)
				Lift(Item);

			FVector Target;
			FQuat Turn;
			if (!CarryTarget(Item, Carriers, Target, Turn))
			{
				DropItem(Item);
				continue;
			}
			const float Lag = Steer(Item, Target, Turn, Kind.bFront);
			Item.Lagging = Lag > Items::MAX_CARRY_LAG ? Item.Lagging + DeltaSeconds : 0;
			if (Item.Lagging <= Items::CARRY_LAG_TIME)
				continue;
			if (Kind.Hands == 1)
			{
				// Something small caught on a door frame as its carrier ran past: back into their hand,
				// inside the carrier, whom carried things pass through, so never inside a wall.
				Place(Item, FeetOf(Carriers[0]) + FVector(0, 0, Items::HAND_HEIGHT * 100.0));
				Item.Lagging = 0;
			}
			else
				DropItem(Item);
		}
	}

	/**
	 * Where an item is held (Unreal units) and how it's turned: between two carriers, in front of one
	 * carrying it in both arms, or hanging at their side from one hand, a flashlight aimed where they
	 * look. False if the carriers are too far apart.
	 */
	bool CarryTarget(AStoreRaidItem Item, TArray<AStoreRaidCharacter> Carriers, FVector& OutTarget, FQuat& OutTurn)
	{
		const FItemKindInfo Kind = Item.Info();
		// The item's long side (game x) is its local +Y: a turn that points it along a direction.
		const FQuat LongSideToForward = FRotator(0, -90, 0).Quaternion();
		AStoreRaidCharacter First = Carriers[0];
		const FVector FirstFeet = FeetOf(First);
		if (Carriers.Num() >= 2)
		{
			const FVector SecondFeet = FeetOf(Carriers[1]);
			const FVector Between = SecondFeet - FirstFeet;
			if (Between.Size2D() / 100.0 > Kind.Size.X + Items::MAX_CARRY_SLACK)
				return false;
			OutTarget = (FirstFeet + SecondFeet) / 2 + FVector(0, 0, Items::CARRY_HEIGHT * 100.0);
			OutTurn = FRotator(0, Between.Rotation().Yaw, 0).Quaternion() * LongSideToForward;
			return true;
		}

		// Where the player looks, so what they carry stays in view.
		const FRotator Aim = First.GetBaseAimRotation();
		const FRotator Facing(0, Aim.Yaw, 0);
		if (Kind.Hands == 2)
		{
			// Crosswise in both arms, its long side along the player's right, like a TV.
			OutTarget = FirstFeet + Facing.ForwardVector * Items::CarryDistance(Kind.Size.Z) * 100.0 + FVector(0, 0, Items::CARRY_HEIGHT * 100.0);
			OutTurn = Facing.Quaternion();
			return true;
		}
		// Hanging from one hand, its long side pointing the way the player walks; a flashlight
		// pointing where they look, up or down too.
		const float Side = (First.Right == Item ? 1.0 : -1.0) * (Items::HAND_SIDE + Kind.Size.Z / 2);
		OutTarget = FirstFeet + Facing.RightVector * Side * 100.0 + Facing.ForwardVector * 15.0 + FVector(0, 0, Items::HAND_HEIGHT * 100.0);
		const FRotator Pointing = Kind.bFront ? FRotator(Aim.Pitch, Aim.Yaw, 0) : Facing;
		OutTurn = Pointing.Quaternion() * LongSideToForward;
		return true;
	}

	/**
	 * Pulls a lifted item towards a place and a turn by setting its velocities, so it can't pass
	 * through walls. Returns how far it still is from there, in meters, to notice it getting stuck.
	 * Either end of it will do unless it has a front.
	 */
	float Steer(AStoreRaidItem Item, FVector Target, FQuat Turn, bool bFront)
	{
		const FVector Gap = (Target - Item.ActorLocation) / 100.0;
		const float Distance = Gap.Size();
		const float Scale = Math::Min(Items::CARRY_GAIN, Items::CARRY_MAX_SPEED / Math::Max(Distance, 0.000001));
		Item.Mesh.SetPhysicsLinearVelocity(Gap * Scale * 100.0, false, NAME_None);

		const FQuat Current = Item.ActorQuat;
		FQuat Wanted = Turn;
		if (!bFront)
		{
			// The other way round, if that's nearer.
			const FQuat Reversed = FQuat(FVector::UpVector, PI) * Turn;
			if (Math::Abs(Dot(Reversed, Current)) > Math::Abs(Dot(Turn, Current)))
				Wanted = Reversed;
		}
		FQuat Left = Wanted * Current.Inverse();
		if (Left.W < 0)
			Left = FQuat(-Left.X, -Left.Y, -Left.Z, -Left.W);
		FVector Axis;
		float64 Angle = 0;
		Left.ToAxisAndAngle(Axis, Angle);
		Item.Mesh.SetPhysicsAngularVelocityInRadians(Axis * Angle * Items::CARRY_GAIN, false, NAME_None);
		return Distance;
	}

	float Dot(FQuat A, FQuat B)
	{
		return A.X * B.X + A.Y * B.Y + A.Z * B.Z + A.W * B.W;
	}
}
