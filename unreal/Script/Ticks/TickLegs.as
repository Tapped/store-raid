// A tick's legs, walked in code on the rig scripts/models/tick.py gives it, as client/src/tick.ts
// walks them: every frame each leg's foot is placed, and the leg bends to reach it.
//
// - A gait clock runs with the distance walked and turned, and each leg lifts at its own point in
//   the cycle: two groups of four half a cycle apart, the alternating tetrapod gait of spiders and
//   ticks, the back legs of a group a little ahead. A foot lifts before it swings, swings with no
//   jolt at either end, and sets down from above. Standing still, feet left out of place step back
//   one at a time.
// - Each leg's joints lie in one upright plane through its hip, so a leg is solved in 2D in that
//   plane (FABRIK, from its rest shape, so knees stay high) and the plane turns about the hip to
//   face the foot.
// - Standing still, it raises its front legs and waves them, questing: ticks smell with them.
// - Off the ground its legs curl under it and scrabble at the air.
//
// Everything here is in the rig's frame, the actor's: centimeters, +X its head, +Y its right, +Z up.
// Feet are in the world. The model is imported facing +Y (import.py), and turned a quarter back in the
// actor to face +X: RigToModel() takes the rig's frame to the model's component space.

/** Centimeters walked in one gait cycle, in which every foot steps once. */
const float STRIDE = 28;
/** The part of the cycle a foot spends in the air; it's planted for the rest. */
const float SWING = 0.4;
/** How loud its taps are at their loudest, and its hiss. */
const float TICK_TAPS = 0.15;
const float TICK_HISS = 0.29;
/** Taps sooner than TAP_GAP_MIN seconds after the last are silent, sooner than TAP_GAP_MAX softer, to TAP_SOFTEST. */
const float TAP_GAP_MIN = 0.07;
const float TAP_GAP_MAX = 0.3;
const float TAP_SOFTEST = 0.35;
/** Seconds of quiet between hisses while it keeps questing, at least and at most. */
const float HISS_GAP_MIN = 1.5;
const float HISS_GAP_MAX = 4;

/** How far ahead of the leg in front of it each leg of a group lifts, in cycles. */
const float WAVE = 0.05;
/** How far the feet are from the middle: turning on the spot moves them this many cm a radian. */
const float TURN_RADIUS = 60;
/** The shortest and longest a swing may take, seconds; settling steps take SETTLE_TIME. */
const float SWING_TIME_MIN = 0.2;
const float SWING_TIME_MAX = 0.45;
const float SETTLE_TIME = 0.3;
/** The fastest a foot may travel on average through a swing, cm/s. */
const float FOOT_SPEED = 100;
/** Below this pace, cm/s, feet land less far ahead the slower it goes. */
const float SLOW = 20;
/** How high a foot lifts in the middle of a step, cm. */
const float STEP_HEIGHT = 7;
/** At rest, a foot this far from where it belongs steps back into place, cm. */
const float SETTLE = 2;
/** Seconds standing still before it starts questing, and how fast it raises its legs. */
const float QUEST_AFTER = 1.2;
const float QUEST_RATE = 2;
const int IK_ITERATIONS = 10;
/** A foot further than this from where it belongs, cm, is put there at once. */
const float LOST = 150;

/** How a tick is held this frame, besides where it stands (client/src/tick.ts's TickPose). */
struct FTickPose
{
	/** Off the ground: falling, leaping, on its back or on someone. Its legs curl and scrabble. */
	bool bLoose = false;
	/** Reared up with its front legs raised, as when a light finds it, without waiting to. */
	bool bRear = false;
	/** Crouched: it doesn't start questing, as when it waits on a perch. */
	bool bStill = false;
}

struct FTickLeg
{
	/** The six segment bones, hip to claw. */
	TArray<FName> Bones;
	/** Which half of the gait it steps in, and how many legs from the front (the front legs quest). */
	int Group = 0;
	int Index = 0;
	/** Where in the gait cycle it lifts, and where the cycle was for it last frame. */
	float Offset = 0;
	float Phase = 1;
	/** Rest pose: joint positions hip to claw tip, and each segment's rotation. */
	TArray<FVector> Joints;
	TArray<FQuat> Rotations;
	/** The rest shape in its own plane: X along the ground away from the hip, Y up. */
	TArray<FVector2D> Flat;
	TArray<float> Lengths;
	/** Where the claw tip belongs, in the actor's frame. */
	FVector Home;
	/** The claw tip in the world: planted, or moving through a step. */
	FVector Foot;
	bool bStepping = false;
	FVector StepFrom;
	float StepT = 0;
	float StepTime = 1;
}

/** A bone that only wiggles: its rest pose relative to its parent, turned a little about its own axes. */
struct FTickWiggler
{
	FName Bone;
	/** Its parent, or None when that's the head. */
	FName Parent;
	FTransform Rest;
	float Seed = 0;
	float Amount = 0;
}

struct FTickLegs
{
	bool bReady = false;
	TArray<FTickLeg> Legs;
	TArray<FTickWiggler> Wigglers;
	FTransform BodyRest;
	FTransform HeadRest;
	float Clock = 0;
	float Still = 0;
	float Quest = 0;
	bool bHasLast = false;
	FVector Last;
	float LastYaw = 0;
	/** cm/s, and radians a second (east positive), smoothed. */
	FVector Velocity;
	float TurnRate = 0;
	float Cycle = 0;
	/** Its claws tapping where its feet land, and its hiss (Sound/Tick in client/src/tick.ts). */
	FOneShots Taps;
	FOneShots Hiss;
	float LastTap = -100;
	float NextHiss = 0;
	/** Where feet landed this frame, to tap there. */
	TArray<FVector> Landed;

	/** Reads the rest pose off the model. False if it isn't the tick's rig. */
	bool Setup(UPoseableMeshComponent Model)
	{
		bReady = false;
		Legs.Empty();
		Wigglers.Empty();
		if (Model.GetBoneIndex(n"body") < 0 || Model.GetBoneIndex(n"leg_L0_tip") < 0)
		{
			Warning("StoreRaid: the tick model hasn't the bones its legs are walked by");
			return false;
		}
		BodyRest = RestOf(Model, n"body");
		HeadRest = RestOf(Model, n"head");
		for (int S = 0; S < 2; S++)
		{
			const FString Side = S == 0 ? "L" : "R";
			AddWiggler(Model, FName(f"hook_{Side}"), NAME_None, S == 0 ? 0 : 1.7, 0.12);
			for (int I = 0; I < 3; I++)
			{
				const FName Parent = I == 0 ? NAME_None : FName(f"palp_{Side}_{I - 1}");
				AddWiggler(Model, FName(f"palp_{Side}_{I}"), Parent, I * 2.3 + (S == 0 ? 0 : 5), 0.25);
			}
			for (int Index = 0; Index < 4; Index++)
			{
				FTickLeg Leg;
				for (int J = 0; J < 7; J++)
				{
					const FName Bone = FName(J < 6 ? f"leg_{Side}{Index}_{J}" : f"leg_{Side}{Index}_tip");
					const FTransform Rest = RestOf(Model, Bone);
					Leg.Joints.Add(Rest.Location);
					if (J < 6)
					{
						Leg.Bones.Add(Bone);
						Leg.Rotations.Add(Rest.Rotation);
					}
				}
				FVector Out = Leg.Joints[6] - Leg.Joints[0];
				Out.Z = 0;
				Out = Out.GetSafeNormal();
				for (int J = 0; J < 7; J++)
				{
					const FVector D = Leg.Joints[J] - Leg.Joints[0];
					Leg.Flat.Add(FVector2D(D.DotProduct(Out), D.Z));
					if (J > 0)
						Leg.Lengths.Add(Leg.Joints[J].Distance(Leg.Joints[J - 1]));
				}
				Leg.Index = Index;
				Leg.Group = (S + Index) % 2;
				Leg.Offset = Leg.Group * 0.5 + (3 - Index) * WAVE;
				Leg.Home = Leg.Joints[6];
				Leg.Foot = RigToWorld(Model).TransformPosition(Leg.Home);
				Legs.Add(Leg);
			}
		}
		bReady = true;
		return true;
	}

	void AddWiggler(UPoseableMeshComponent Model, FName Bone, FName Parent, float Seed, float Amount)
	{
		FTickWiggler W;
		W.Bone = Bone;
		W.Parent = Parent;
		const FName Above = Parent == NAME_None ? n"head" : Parent;
		W.Rest = Model.GetBoneTransformByName(Bone, EBoneSpaces::ComponentSpace).GetRelativeTransform(Model.GetBoneTransformByName(Above, EBoneSpaces::ComponentSpace));
		W.Seed = Seed;
		W.Amount = Amount;
		Wigglers.Add(W);
	}

	/** Where a leg's claw tip belongs if the tick stood at At (world) facing Yaw (degrees). */
	FVector HomeAt(const FTickLeg& Leg, FVector At, float Yaw, float Ground)
	{
		FVector Home = FRotator(0, Yaw, 0).RotateVector(Leg.Home) + At;
		Home.Z = Ground;
		return Home;
	}

	/**
	 * Once a frame, after the actor is placed: its legs and body for this frame. A tick off the
	 * ground (on its back, on a face) is turned with the actor; its legs only scrabble then.
	 */
	void Update(UPoseableMeshComponent Model, float Dt, FTickPose Pose)
	{
		if (!bReady || Dt <= 0)
			return;
		Clock += Dt;
		const FTransform Actor = RigToWorld(Model);
		const FVector At = Actor.Location;
		const float Yaw = Actor.Rotator().Yaw;

		if (bHasLast)
		{
			const FVector V = (At - Last) / Dt;
			const float Turn = Math::DegreesToRadians(Math::FindDeltaAngleDegrees(LastYaw, Yaw)) / Dt;
			// Smoothed a little: positions arrive in uneven steps.
			const float K = Math::Min(1.0, Dt * 12);
			Velocity.X += (V.X - Velocity.X) * K;
			Velocity.Y += (V.Y - Velocity.Y) * K;
			TurnRate += (Turn - TurnRate) * K;
		}
		bHasLast = true;
		Last = At;
		LastYaw = Yaw;
		const float Speed = Velocity.Size2D();
		const bool bMoving = Speed > 3 || Math::Abs(TurnRate) > 0.15;
		Still = bMoving || Pose.bLoose || Pose.bStill ? 0 : Still + Dt;
		const bool bQuesting = Pose.bRear || Still > QUEST_AFTER;
		Quest = Math::Clamp(Quest + (bQuesting ? Dt : -Dt) * QUEST_RATE, 0.0, 1.0);
		if (!Taps.bLoaded)
		{
			Taps.Load(Sounds::List("tick-tap-1", "tick-tap-2", "tick-tap-3"));
			Hiss.Load(Sounds::List("tick-hiss"));
		}
		// A hiss as it rears up to quest, then now and then while it goes on, from its mouth.
		if (bQuesting && !Pose.bRear && Quest > 0.3 && Clock >= NextHiss)
		{
			const float Rate = Math::RandRange(0.85, 1.05);
			Hiss.PlayOn(Model, TICK_HISS, 0, Rate, FFalloff(), n"head");
			NextHiss = Clock + Hiss.Duration() / Rate + Math::RandRange(HISS_GAP_MIN, HISS_GAP_MAX);
		}

		if (!Pose.bLoose)
		{
			// A foot left far behind (it was put somewhere else, or came out of the air a way off) is
			// put where it belongs rather than walked there.
			for (int I = 0; I < Legs.Num(); I++)
			{
				FTickLeg& Leg = Legs[I];
				const FVector Home = HomeAt(Leg, At, Yaw, At.Z);
				if (Leg.Foot.Distance(Home) > LOST)
				{
					Leg.Foot = Home;
					Leg.bStepping = false;
				}
			}
			Landed.Reset();
			StepLegs(At, Yaw, Speed, bMoving, Dt);
			for (FVector Foot : Landed)
				Tap(Foot);
		}

		// The body rides a little lower while legs are in the air, rolls away from lifted legs, and
		// rears back when questing; at rest it breathes.
		float Lift = 0;
		float Roll = 0;
		for (const FTickLeg& Leg : Legs)
		{
			if (!Leg.bStepping)
				continue;
			const float Up = Math::Square(Math::Sin(PI * Leg.StepT));
			Lift += Up;
			Roll += Up * (Leg.Home.Y < 0 ? 1 : -1);
		}
		const float Bob = -0.6 * Lift + 0.4 * Math::Sin(Clock * 1.6) + 3 * Quest;
		const FQuat Turn = FRotator(Math::RadiansToDegrees(0.12 * Quest), 0, Math::RadiansToDegrees(0.015 * Roll)).Quaternion();
		const FVector Centre = BodyRest.Location;
		const FVector Raise(0, 0, Bob);
		SetBone(Model, n"body", FTransform(Turn * BodyRest.Rotation, Centre + Raise));

		// The head looks a little into turns and twitches; it stays fixed to the body otherwise.
		const FQuat Look = FRotator(
			Math::RadiansToDegrees(-0.06 * Noise(Clock * 0.9, 7) + 0.1 * Quest),
			Math::RadiansToDegrees(Math::Clamp(TurnRate * 0.25, -0.35, 0.35) + 0.05 * Noise(Clock * 0.7, 3)),
			0).Quaternion();
		const FTransform HeadNow(Turn * Look * HeadRest.Rotation, Centre + Raise + Turn.RotateVector(HeadRest.Location - Centre));
		SetBone(Model, n"head", HeadNow);
		FTransform Above = HeadNow;
		for (const FTickWiggler& W : Wigglers)
		{
			if (W.Parent == NAME_None)
				Above = HeadNow;
			const float A = W.Amount * (Noise(Clock * 1.3, W.Seed) + 0.6 * Quest * Math::Sin(Clock * 9 + W.Seed));
			const FTransform Now = FTransform(FRotator(Math::RadiansToDegrees(A), 0, Math::RadiansToDegrees(0.5 * A))) * W.Rest * Above;
			SetBone(Model, W.Bone, Now);
			Above = Now;
		}

		for (int I = 0; I < Legs.Num(); I++)
		{
			FTickLeg& Leg = Legs[I];
			FVector Foot = Leg.Foot;
			const float Side = Leg.Home.Y < 0 ? 1 : -1;
			if (Pose.bLoose)
			{
				// Curled in under the body, each leg scrabbling at the air out of time with the rest.
				const float Beat = Clock * 13 + Leg.Index * 1.9 + Side;
				const FVector Curled(Leg.Home.X * 0.8 + 5 * Math::Cos(Beat), Leg.Home.Y * 0.72 + 3 * Math::Sin(Beat * 0.7), 10 + 6 * Math::Sin(Beat));
				Foot = Actor.TransformPosition(Curled);
				// When it lands, each foot starts from where it was.
				Leg.Foot = Foot;
				Leg.bStepping = false;
			}
			else if (Leg.Index == 0 && Quest > 0)
			{
				// Held out forward and up, well above the hip, waving, each leg out of time with the other.
				const float Wave = Clock * 2.6 + Side * 1.3;
				const float Inward = Leg.Home.Y < 0 ? 1 : -1;
				const FVector Raised = Leg.Home + FVector(20, Inward * (12 - 6 * Math::Sin(Wave)), 46 + 7 * Math::Sin(Wave * 1.7));
				Foot = Math::Lerp(Leg.Foot, Actor.TransformPosition(Raised), Smoother(Quest));
			}
			SolveLeg(Model, Leg, Actor.InverseTransformPosition(Foot), Turn, Centre, Raise);
		}
	}

	void StepLegs(FVector At, float Yaw, float Speed, bool bMoving, float Dt)
	{
		// Feet move as fast walking as turning: that sets how fast the cycle runs.
		const float Pace = Speed + Math::Abs(TurnRate) * TURN_RADIUS;
		const float CycleTime = STRIDE / Math::Max(Pace, 0.1);
		if (bMoving)
			Cycle = Math::Fmod(Cycle + Dt / CycleTime, 1.0);
		const float SwingTime = Math::Clamp(SWING * CycleTime, SWING_TIME_MIN, SWING_TIME_MAX);
		// A foot lands ahead of where it belongs by half the ground it covers while planted. Slower
		// than SLOW, that fades out with the speed rather than all at once when it stops.
		const float Stance = (1 - SWING) * STRIDE / Math::Max(Pace, SLOW);
		const float TurnDegrees = Math::RadiansToDegrees(TurnRate);
		bool bAnyStepping = false;

		for (int I = 0; I < Legs.Num(); I++)
		{
			FTickLeg& Leg = Legs[I];
			const bool bQuesting = Leg.Index == 0 && Quest > 0;
			const float Phase = Math::Fmod(Cycle + Leg.Offset, 1.0);
			const bool bLifts = Phase < SWING && (Leg.Phase >= SWING || Phase < Leg.Phase);
			Leg.Phase = Phase;
			if (!Leg.bStepping && bMoving && bLifts && !bQuesting)
			{
				// A long way to go takes longer, so no foot whips across: turning on the spot is where.
				const float Ahead = SwingTime + Stance / 2;
				const FVector Land = HomeAt(Leg, At + Velocity * Ahead, Yaw + TurnDegrees * Ahead, At.Z);
				Leg.bStepping = true;
				Leg.StepFrom = Leg.Foot;
				Leg.StepT = 0;
				Leg.StepTime = Math::Max(SwingTime, Leg.Foot.Distance(Land) / FOOT_SPEED);
			}
			if (!Leg.bStepping)
				continue;
			Leg.StepT = Math::Min(1.0, Leg.StepT + Dt / Leg.StepTime);
			const float Ahead = (1 - Leg.StepT) * Leg.StepTime + Stance / 2;
			const FVector To = HomeAt(Leg, At + Velocity * Ahead, Yaw + TurnDegrees * Ahead, At.Z);
			// Up first, then across, then down: the swing waits a little at each end, and eases in and out.
			const float Across = Smoother(Math::Clamp((Leg.StepT - 0.12) / 0.76, 0.0, 1.0));
			Leg.Foot = Math::Lerp(Leg.StepFrom, To, Across);
			Leg.Foot.Z = At.Z + STEP_HEIGHT * Math::Square(Math::Sin(PI * Leg.StepT));
			if (Leg.StepT >= 1)
			{
				Leg.bStepping = false;
				Landed.Add(Leg.Foot);
			}
			else
				bAnyStepping = true;
		}

		// Standing still, the foot furthest out of place steps back, one at a time.
		if (bMoving || bAnyStepping)
			return;
		int Worst = -1;
		float Most = SETTLE;
		for (int I = 0; I < Legs.Num(); I++)
		{
			if (Legs[I].Index == 0 && Quest > 0)
				continue;
			const float Lag = Legs[I].Foot.Distance(HomeAt(Legs[I], At, Yaw, At.Z));
			if (Lag > Most)
			{
				Most = Lag;
				Worst = I;
			}
		}
		if (Worst >= 0)
		{
			FTickLeg& Leg = Legs[Worst];
			Leg.bStepping = true;
			Leg.StepFrom = Leg.Foot;
			Leg.StepT = 0;
			Leg.StepTime = Math::Max(SETTLE_TIME, Most / FOOT_SPEED);
		}
	}

	/**
	 * A claw tap where a foot lands (world space): four feet land within a few hundredths of a second
	 * of each other, which played a tap each sounds like a machine gun. So one sooner than
	 * TAP_GAP_MIN after the last tap is silent, and one sooner than TAP_GAP_MAX is softer, down to
	 * TAP_SOFTEST: a group lands as one accented tap and a few quiet ones.
	 */
	void Tap(FVector At)
	{
		const float Gap = Clock - LastTap;
		if (Gap < TAP_GAP_MIN)
			return;
		LastTap = Clock;
		const float T = Math::Min(1.0, (Gap - TAP_GAP_MIN) / (TAP_GAP_MAX - TAP_GAP_MIN));
		Taps.PlayAt(At, TICK_TAPS * Math::Lerp(TAP_SOFTEST, 1.0, T), 0.15);
	}

	/** A hiss from its mouth, now: as it leaps or drops, or as a light finds it. */
	void HissNow(UPoseableMeshComponent Model)
	{
		if (!Hiss.bLoaded)
			Hiss.Load(Sounds::List("tick-hiss"));
		const float Rate = Math::RandRange(0.9, 1.15);
		Hiss.PlayOn(Model, TICK_HISS, 0, Rate, FFalloff(), n"head");
		NextHiss = Clock + Hiss.Duration() / Rate + HISS_GAP_MAX;
	}

	/** Bend a leg so its claw tip reaches Target (component space), with the body turned and raised. */
	void SolveLeg(UPoseableMeshComponent Model, const FTickLeg& Leg, FVector Target, FQuat Turn, FVector Centre, FVector Raise)
	{
		const FVector Hip = Centre + Raise + Turn.RotateVector(Leg.Joints[0] - Centre);
		FVector Out = Target - Hip;
		Out.Z = 0;
		const float Reach = Out.Size();
		if (Reach < 0.01)
			return;
		Out /= Reach;

		// FABRIK in the leg's plane, from the rest shape, with the coxa (first segment) fixed.
		TArray<FVector2D> P = Leg.Flat;
		const FVector2D Goal(Reach, Target.Z - Hip.Z);
		const FVector2D Root = P[1];
		const int N = P.Num() - 1;
		for (int It = 0; It < IK_ITERATIONS; It++)
		{
			P[N] = Goal;
			for (int I = N - 1; I >= 1; I--)
				P[I] = Toward(P[I + 1], P[I], Leg.Lengths[I]);
			P[1] = Root;
			for (int I = 2; I <= N; I++)
				P[I] = Toward(P[I - 1], P[I], Leg.Lengths[I - 1]);
		}
		TArray<FVector> Joints;
		for (int I = 0; I <= N; I++)
			Joints.Add(Hip + Out * P[I].X + FVector(0, 0, P[I].Y));

		for (int I = 0; I < Leg.Bones.Num(); I++)
		{
			const FVector From = (Leg.Joints[I + 1] - Leg.Joints[I]).GetSafeNormal();
			const FVector To = (Joints[I + 1] - Joints[I]).GetSafeNormal();
			const FQuat Rotation = FQuat::FindBetweenNormals(From, To) * Leg.Rotations[I];
			SetBone(Model, Leg.Bones[I], FTransform(Rotation, Joints[I]));
		}
	}
}

/** The rig's frame (head +X) to the model's component space (head +Y): a quarter turn. */
FTransform RigToModel()
{
	return FTransform(FRotator(0, 90, 0));
}

/** The rig's frame in the world now. */
FTransform RigToWorld(UPoseableMeshComponent Model)
{
	return RigToModel() * Model.WorldTransform;
}

/** A bone's pose in the rig's frame, as it is now (at setup, its rest pose). */
FTransform RestOf(UPoseableMeshComponent Model, FName Bone)
{
	return Model.GetBoneTransformByName(Bone, EBoneSpaces::ComponentSpace) * RigToModel().Inverse();
}

/** Poses a bone, given in the rig's frame. */
void SetBone(UPoseableMeshComponent Model, FName Bone, FTransform Pose)
{
	Model.SetBoneTransformByName(Bone, Pose * RigToModel(), EBoneSpaces::ComponentSpace);
}

/** The point Length from From in the direction of To. */
FVector2D Toward(FVector2D From, FVector2D To, float Length)
{
	const FVector2D D = To - From;
	float Size = D.Size();
	if (Size < 1e-6)
		Size = 1;
	return From + D * (Length / Size);
}

/** Eases in and out with no jolt: speed and acceleration are zero at both ends. */
float Smoother(float T)
{
	return T * T * T * (T * (6 * T - 15) + 10);
}

/** Smooth noise in about -1 to 1: a few sines out of step. */
float Noise(float T, float Seed)
{
	return (Math::Sin(T * 1.7 + Seed) + Math::Sin(T * 2.9 + Seed * 2.1) * 0.6 + Math::Sin(T * 4.3 + Seed * 3.7) * 0.3) / 1.9;
}
