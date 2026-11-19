// The level's ambience: client/src/ambience.ts. A dark machinery room tone with wind through a
// vent, on a loop, heard quietly everywhere and loudly from a vent over where players come in, so
// they can find the way out by ear; walls between the listener and the vent muffle it.
//
// That's two copies of the one loop: a bed heard straight, and the vent, placed at the level's
// Vent. The vent starts half the loop in, so the two never line up, which would comb-filter the
// tones into a hollow, phasey sound wherever the two are about as loud.

namespace Ambience
{
	/** The room tone heard everywhere, and the vent over the entrance (Sound/Ambience). */
	const float BED = 0.12;
	const float VENT = 0.5;

	/** Full volume within 4 meters of the vent, then half as loud each time the distance doubles, to 60. */
	FFalloff VentReach()
	{
		return Sounds::MakeFalloff(4, 60, 1);
	}

	void Start(FLevel Level)
	{
		Sounds::Loop("vent-hum", BED);
		Sounds::Loop("vent-hum", VENT, 0.5, true, World::ToWorld(Level.Vent.X, Level.Vent.Y, Level.Vent.Z), VentReach());
	}
}
