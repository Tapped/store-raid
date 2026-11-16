// What can be carried, and how it's held: ITEM_KINDS and the carrying numbers in shared/constants.ts
// and server/src/rooms/GameRoom.ts. Game coordinates: meters, x east, y up, z north.

/** What can be carried: `ItemKind`, the keys of ITEM_KINDS in shared/constants.ts. */
enum EItemKind
{
	Phone,
	Flashlight,
	Tv,
	Box,
	Sofa,
};

/**
 * A kind of item: its size (x the long side, y up, z its depth), how many hands each carrier needs
 * for it, how many people it takes to lift it, and what it sells for once it's in the truck. A kind
 * with bFront has one, at +x, which is carried pointing the way its carrier looks; anything else is
 * carried either way round, whichever is nearer.
 */
struct FItemKindInfo
{
	FVector Size;
	int Hands = 1;
	int Carriers = 1;
	bool bFront = false;
	int Value = 0;
	/** The stand-in's colour until the item's model is imported. */
	FLinearColor Colour;
};

namespace Items
{
	FItemKindInfo Kind(EItemKind Kind)
	{
		FItemKindInfo Info;
		switch (Kind)
		{
			case EItemKind::Phone:
				Info.Size = FVector(0.25, 0.08, 0.18);
				Info.Value = 40;
				Info.Colour = FLinearColor(0.05, 0.05, 0.06);
				break;
			case EItemKind::Flashlight:
				Info.Size = FVector(0.26, 0.062, 0.062);
				Info.bFront = true;
				Info.Colour = FLinearColor(0.7, 0.55, 0.1);
				break;
			case EItemKind::Tv:
				Info.Size = FVector(1.2, 0.75, 0.15);
				Info.Hands = 2;
				Info.Value = 150;
				Info.Colour = FLinearColor(0.1, 0.1, 0.12);
				break;
			case EItemKind::Box:
				Info.Size = FVector(1, 1, 1);
				Info.Hands = 2;
				Info.Value = 100;
				Info.Colour = FLinearColor(0.55, 0.4, 0.22);
				break;
			case EItemKind::Sofa:
				Info.Size = FVector(2.4, 0.9, 0.9);
				Info.Hands = 2;
				Info.Carriers = 2;
				Info.Value = 400;
				Info.Colour = FLinearColor(0.3, 0.12, 0.1);
				break;
		}
		return Info;
	}

	FString KindName(EItemKind Kind)
	{
		switch (Kind)
		{
			case EItemKind::Phone:
				return "phone";
			case EItemKind::Flashlight:
				return "flashlight";
			case EItemKind::Tv:
				return "tv";
			case EItemKind::Box:
				return "box";
			case EItemKind::Sofa:
				return "sofa";
		}
		return "?";
	}

	/** kg per cubic meter: ITEM_DENSITY in server/src/physics.ts. */
	const float DENSITY = 25.0;
	/** How high above their feet a player holds things in both arms. */
	const float CARRY_HEIGHT = 1.0;
	/** How hard a carried thing is pulled to where it's held: its speed there, per meter of the gap. */
	const float CARRY_GAIN = 12.0;
	/** The fastest a carried thing is pulled, in meters a second. */
	const float CARRY_MAX_SPEED = 14.0;
	/** How far from the player's centre to an item's nearest point they can reach to grab it, or keep holding it while it's down. */
	const float REACH = 1.2;
	/** Only what's within this angle either side of where the player looks can be grabbed, in degrees. */
	const float GRAB_CONE = 70.0;
	/** How high a thing hanging from one hand is held. */
	const float HAND_HEIGHT = 0.8;
	/** How far out to the side of the player's centre a one-handed thing hangs (PLAYER_RADIUS + 0.15). */
	const float HAND_SIDE = 0.45;
	/** Carried items fall if they stay this far from where they should be for CARRY_LAG_TIME; a one-handed one goes back into the hand. */
	const float MAX_CARRY_LAG = 1.5;
	const float CARRY_LAG_TIME = 0.4;
	/** Carriers can stand this far beyond the ends of a shared item before it falls. */
	const float MAX_CARRY_SLACK = 2.0;
	/** Items can be grabbed from this far below a player's feet to this far above them. */
	const float GRAB_BELOW = 0.6;
	const float GRAB_ABOVE = 2.2;
	/** Seconds a dropped item falls through players before it can be bumped into again. */
	const float FALL_TIME = 1.0;
	/** Radians a second, at most, of spin given to a dropped item so it tumbles. */
	const float DROP_SPIN = 5.0;
	/** How far from a dimmer a player can reach it, and how high their hand is. */
	const float DIMMER_REACH = 1.6;
	const float DIMMER_HAND = 1.3;
	/** Seconds the dimmer takes from fully on to off. */
	const float DIM_TIME = 3.0;

	/** How far ahead of a player's centre a thing this deep is held in both arms (carryDistance()). */
	float CarryDistance(float Depth)
	{
		return 0.3 + Depth / 2 + 0.2;
	}
}
