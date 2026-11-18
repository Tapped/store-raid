// Input goes through here, never raw keys: the keyboard and mouse and every controller drive the
// one player at once, as client/src/input.ts's Device did. Polled every frame from the player
// controller, so it needs no input assets. Bots and the dev tools steer it with the sr.* console
// commands (see StoreRaidPlayerController.as), which add to what the devices say.

/** What the player asks for this frame. */
struct FControls
{
	/** Where to go, relative to where they look: x right, y forward, a length of at most 1. */
	FVector2D Move;
	/** How far to turn this frame, in degrees: x right, y up. */
	FVector2D Look;
	bool bRun = false;
	bool bJump = false;
	bool bGrabPressed = false;
	bool bGrabReleased = false;
	bool bDropPressed = false;
	bool bLightPressed = false;
	bool bReadyPressed = false;
}

/**
 * Degrees a mouse count turns, as the web game's 0.005 radians a pixel (`dragSpeed`), and degrees a
 * second a stick held over turns. Config/DefaultInput.ini leaves the mouse and sticks as they come:
 * no scaling, smoothing, scaling by the field of view or dead zones of the engine's. So this is the
 * only number between a count and a turn, and Stick() the only shaping of a stick.
 */
const float MOUSE_DEGREES = 0.2865;
const float STICK_DEGREES = 150.0;
/** How far a stick has to move from the middle, any way, before it counts: `DEADZONE` in input.ts. */
const float STICK_DEAD_ZONE = 0.15;

namespace Device
{
	FControls ReadControls(APlayerController Controller, float DeltaSeconds)
	{
		FControls Controls;
		if (Controller == nullptr)
			return Controls;

		// The keyboard.
		float Right = 0;
		float Forward = 0;
		if (Controller.IsInputKeyDown(EKeys::D) || Controller.IsInputKeyDown(EKeys::Right))
			Right += 1;
		if (Controller.IsInputKeyDown(EKeys::A) || Controller.IsInputKeyDown(EKeys::Left))
			Right -= 1;
		if (Controller.IsInputKeyDown(EKeys::W) || Controller.IsInputKeyDown(EKeys::Up))
			Forward += 1;
		if (Controller.IsInputKeyDown(EKeys::S) || Controller.IsInputKeyDown(EKeys::Down))
			Forward -= 1;

		// Controllers, analog: a half-pushed stick walks.
		const FVector2D Left = Device::Stick(Controller, EKeys::Gamepad_LeftX, EKeys::Gamepad_LeftY);
		Right += Left.X;
		Forward += Left.Y;
		Controls.Move = FVector2D(Right, Forward);
		if (Controls.Move.Size() > 1)
			Controls.Move = Controls.Move.GetSafeNormal();

		// Looking: the mouse, and the right stick.
		const FVector2D Look = Device::Stick(Controller, EKeys::Gamepad_RightX, EKeys::Gamepad_RightY);
		Controls.Look.X = Controller.GetInputAnalogKeyState(EKeys::MouseX) * MOUSE_DEGREES + Look.X * STICK_DEGREES * DeltaSeconds;
		Controls.Look.Y = Controller.GetInputAnalogKeyState(EKeys::MouseY) * MOUSE_DEGREES + Look.Y * STICK_DEGREES * DeltaSeconds;

		Controls.bRun = Controller.IsInputKeyDown(EKeys::LeftShift) || Controller.IsInputKeyDown(EKeys::Gamepad_LeftThumbstick);
		Controls.bJump = Controller.IsInputKeyDown(EKeys::SpaceBar) || Controller.IsInputKeyDown(EKeys::Gamepad_FaceButton_Bottom);
		Controls.bGrabPressed = Controller.WasInputKeyJustPressed(EKeys::E) || Controller.WasInputKeyJustPressed(EKeys::Gamepad_RightShoulder);
		Controls.bGrabReleased = Controller.WasInputKeyJustReleased(EKeys::E) || Controller.WasInputKeyJustReleased(EKeys::Gamepad_RightShoulder);
		Controls.bDropPressed = Controller.WasInputKeyJustPressed(EKeys::Q) || Controller.WasInputKeyJustPressed(EKeys::Gamepad_LeftShoulder);
		Controls.bLightPressed = Controller.WasInputKeyJustPressed(EKeys::F) || Controller.WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Top);
		Controls.bReadyPressed = Controller.WasInputKeyJustPressed(EKeys::R) || Controller.WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Left);
		return Controls;
	}

	/**
	 * `stick()` in input.ts: a stick's two axes with a round dead zone, scaled so it still goes
	 * smoothly from 0 to 1 past it. One dead zone for the stick, not one an axis, so a stick pushed a
	 * little off straight doesn't snap to straight.
	 */
	FVector2D Stick(APlayerController Controller, FKey X, FKey Y)
	{
		const FVector2D Raw(Controller.GetInputAnalogKeyState(X), Controller.GetInputAnalogKeyState(Y));
		const float Length = Raw.Size();
		if (Length < STICK_DEAD_ZONE)
			return FVector2D(0, 0);
		return Raw * (Math::Min(1.0, (Length - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE)) / Length);
	}
}
