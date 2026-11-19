// Footsteps: client/src/footsteps.ts. Each character's gait turns faster the faster they go, a foot
// landing every half turn; ours are heard straight, as from our own feet, everyone else's from theirs.

namespace Footsteps
{
	/** The concrete steps, five takes. */
	TArray<FString> Takes()
	{
		TArray<FString> Names;
		for (int I = 1; I <= 5; I++)
			Names.Add(f"footstep-concrete-{I}");
		return Names;
	}
	/** How loud steps are at walking speed: someone else's from a meter away, and our own. */
	const float THEIRS = 0.15;
	const float OWN = 0.15;
	/** Steps per second at walking speed; standing, the gait idles at 0.3 of that. */
	const float STEP_RATE = 2.2;
	/** Slower than this (m/s) is standing, with no steps. */
	const float MOVING = 0.5;
	/** Walking and running speed, m/s (PLAYER_SPEED and RUN_SPEED, the movement's WalkSpeed and RunSpeed). */
	const float WALK_SPEED = 5.0;
	const float RUN_SPEED = 7.5;
}

/**
 * How someone's feet go: a phase that turns faster the faster they go, with a foot landing every
 * half turn (every π). Gait in footsteps.ts.
 */
struct FGait
{
	/** Radians; a foot lands at every multiple of π. */
	float Phase = 0;
	/** How fast they go, from 0 standing to 1 walking and RUN_SPEED / WALK_SPEED running. */
	float Pace = 0;

	/** Once a frame, with how fast they go across the ground in m/s. Returns whether a foot landed. */
	bool Update(float Dt, float Speed, bool bGrounded)
	{
		Pace = Math::Min(Footsteps::RUN_SPEED / Footsteps::WALK_SPEED, Speed / Footsteps::WALK_SPEED);
		const int Before = Math::FloorToInt(Phase / PI);
		Phase += Dt * Footsteps::STEP_RATE * PI * (0.3 + Pace);
		// Kept small, so a float doesn't lose the fraction after a long game.
		const int After = Math::FloorToInt(Phase / PI);
		if (After >= 2)
			Phase -= 2 * PI;
		return bGrounded && Speed > Footsteps::MOVING && After != Before;
	}

	/** How loud the step that just landed is, from walking: louder running, softer slow. */
	float Volume() const
	{
		return 0.4 + 0.6 * Pace;
	}
}
