// What everyone else sees of a player: the character model (models/characters/ch35), its clips
// played straight on its skeletal mesh as client/src/players.ts plays them: walking (at the pace the
// player goes), carrying, standing (the walk's feet-together frame, as there's no idle clip), and
// sitting on a seat in the truck, one of the seated idles chosen by name, with sit-to-stand played
// forward to get up and backward to sit down. The seated clips sit behind the feet, so standing up
// ends where the player stands. On a seat the body faces across the truck; otherwise where its
// player looks, turning the short way round.

/** Slower than this, m/s, counts as standing still. */
const float MOVING_SPEED = 0.5;
/** How quickly the measured speed follows the real one, and the body turns to its facing, per second. */
const float SPEED_SMOOTHING = 10;
const float TURN_SMOOTHING = 12;
/** Playback rate of the walk clips per m/s, so the feet keep up with the ground: twice as fast at 6 m/s. */
const float RATE_PER_SPEED = 1.0 / 3;
/** At walking speed (PLAYER_SPEED, 5 m/s). */
const float WALK_RATE = 5.0 / 3;
/** The walk clip's moment, in seconds, where the feet are closest together: the standing pose. */
const float STAND_TIME = 2.0 / 60;
/** Seconds sitting down and getting up take, as SIT_DOWN_TIME and STAND_UP_TIME in StoreRaidPlayerController.as. */
const float BODY_SIT_DOWN = 1.2;
const float BODY_STAND_UP = 1.4;

enum EBodyPose
{
	None,
	Stand,
	Walk,
	CarryStand,
	CarryWalk,
	Sit,
	SitDown,
	StandUp,
};

struct FBody
{
	/** The clips, or null where one isn't imported. */
	UAnimSequence Walk;
	UAnimSequence CarryWalk;
	UAnimSequence CarryStop;
	UAnimSequence SitToStand;
	/** The seated idle this player sits in, chosen by their name. */
	UAnimSequence Idle;
	FString IdleFor;

	EBodyPose Pose = EBodyPose::None;
	float Speed = 0;
	/** The way the body faces now, in degrees, and the yaw of the seat they sit on or last sat on. */
	float Facing = 0;
	bool bFacingYet = false;
	float SeatYaw = 0;
	/** Whether they sat last frame, whether there has been a frame yet, and seconds left of sitting down or getting up. */
	bool bSeated = false;
	bool bSeatedYet = false;
	float Shifting = 0;

	void Load()
	{
		Walk = Models::Clip("characters/ch35", "walk");
		CarryWalk = Models::Clip("characters/ch35", "carry-walk");
		CarryStop = Models::Clip("characters/ch35", "carry-stop");
		SitToStand = Models::Clip("characters/ch35", "sit-to-stand");
	}

	/** The seated idle for a name: the same on every screen, as the web game hashes it. */
	void ChooseIdle(FString Name)
	{
		if (Name == IdleFor && Idle != nullptr)
			return;
		IdleFor = Name;
		int64 Hash = 0;
		for (int I = 0; I < Name.Len(); I++)
		{
			Hash = (Hash * 31 + Name[I]) & 0xFFFFFFFF;
		}
		if (Hash >= 0x80000000)
			Hash -= 0x100000000;
		const int64 Index = (Hash < 0 ? -Hash : Hash) % 2;
		Idle = Models::Clip("characters/ch35", Index == 0 ? "sit-idle" : "sit-idle-2");
	}

	/**
	 * Once a frame on every machine that draws it: `Velocity` in cm/s, `Yaw` where the player looks
	 * (degrees), `SeatYawNow` the seat's way when seated (else ignored), and whether both arms are full.
	 */
	void Update(USkeletalMeshComponent Mesh, FVector Velocity, float Yaw, bool bSeatedNow, float SeatYawNow, bool bCarrying, float Dt)
	{
		if (Mesh.SkeletalMeshAsset == nullptr || Dt <= 0)
			return;
		Speed += (Velocity.Size2D() / 100 - Speed) * (1 - Math::Exp(-SPEED_SMOOTHING * Dt));
		const bool bMoving = Speed > MOVING_SPEED;

		// Sitting down as they take a seat, but already seated when we first see them; getting up as they leave it.
		if (bSeatedNow)
			SeatYaw = SeatYawNow;
		if (bSeatedYet && bSeatedNow != bSeated)
			Shifting = bSeatedNow ? BODY_SIT_DOWN : BODY_STAND_UP;
		bSeated = bSeatedNow;
		bSeatedYet = true;
		Shifting = Math::Max(0.0, Shifting - Dt);
		const bool bOnSeat = bSeated || Shifting > 0;

		// Facing where they look, the short way round; on a seat, across the truck.
		const float Want = bOnSeat ? SeatYaw : Yaw;
		if (!bFacingYet)
			Facing = Want;
		bFacingYet = true;
		Facing += Math::FindDeltaAngleDegrees(Facing, Want) * (1 - Math::Exp(-TURN_SMOOTHING * Dt));
		// The model is imported facing +Y (import.py): a quarter back to face the way it should.
		Mesh.SetWorldRotation(FRotator(0, Facing - 90, 0));

		if (bSeated)
			SetPose(Mesh, Shifting > 0 ? EBodyPose::SitDown : EBodyPose::Sit);
		else if (Shifting > 0)
			SetPose(Mesh, EBodyPose::StandUp);
		else if (bCarrying)
			SetPose(Mesh, bMoving ? EBodyPose::CarryWalk : EBodyPose::CarryStand);
		else
			SetPose(Mesh, bMoving ? EBodyPose::Walk : EBodyPose::Stand);

		// The walk clips keep pace with however fast they go, never slower than half a walk.
		if (bMoving && (Pose == EBodyPose::Walk || Pose == EBodyPose::CarryWalk))
			Mesh.SetPlayRate(Math::Max(WALK_RATE / 2, Speed * RATE_PER_SPEED));
	}

	void SetPose(USkeletalMeshComponent Mesh, EBodyPose NewPose)
	{
		if (NewPose == Pose)
			return;
		Pose = NewPose;
		if (Pose == EBodyPose::Sit && Idle != nullptr)
			Play(Mesh, Idle, true, 1, 0);
		else if (Pose == EBodyPose::SitDown && SitToStand != nullptr)
		{
			const float Length = SitToStand.GetPlayLength();
			Play(Mesh, SitToStand, false, -Length / BODY_SIT_DOWN, Length);
		}
		else if (Pose == EBodyPose::StandUp && SitToStand != nullptr)
			Play(Mesh, SitToStand, false, SitToStand.GetPlayLength() / BODY_STAND_UP, 0);
		else if (Pose == EBodyPose::Walk && Walk != nullptr)
			Play(Mesh, Walk, true, WALK_RATE, 0);
		else if (Pose == EBodyPose::CarryWalk && CarryWalk != nullptr)
			Play(Mesh, CarryWalk, true, WALK_RATE, 0);
		else if (Pose == EBodyPose::CarryStand && CarryStop != nullptr)
			Play(Mesh, CarryStop, false, 1, 0);
		else if (Walk != nullptr)
			// Held on the walk's feet-together moment.
			Play(Mesh, Walk, false, 0, STAND_TIME);
	}

	void Play(USkeletalMeshComponent Mesh, UAnimSequence Clip, bool bLoop, float Rate, float From)
	{
		Mesh.PlayAnimation(Clip, bLoop);
		Mesh.SetPlayRate(Rate);
		Mesh.SetPosition(From, false);
	}
}
