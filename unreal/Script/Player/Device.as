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
	bool bDropPressed = false;
	bool bLightPressed = false;
	bool bReadyPressed = false;
}

/** Degrees a mouse count turns, and degrees a second a stick held over turns. */
const float MOUSE_DEGREES = 0.07;
const float STICK_DEGREES = 150.0;
/** How far a stick has to move before it counts. */
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
		Right += Device::DeadZone(Controller.GetInputAnalogKeyState(EKeys::Gamepad_LeftX));
		Forward += Device::DeadZone(Controller.GetInputAnalogKeyState(EKeys::Gamepad_LeftY));
		Controls.Move = FVector2D(Right, Forward);
		if (Controls.Move.Size() > 1)
			Controls.Move = Controls.Move.GetSafeNormal();

		// Looking: the mouse, and the right stick.
		Controls.Look.X = Controller.GetInputAnalogKeyState(EKeys::MouseX) * MOUSE_DEGREES
			+ Device::DeadZone(Controller.GetInputAnalogKeyState(EKeys::Gamepad_RightX)) * STICK_DEGREES * DeltaSeconds;
		Controls.Look.Y = Controller.GetInputAnalogKeyState(EKeys::MouseY) * MOUSE_DEGREES
			+ Device::DeadZone(Controller.GetInputAnalogKeyState(EKeys::Gamepad_RightY)) * STICK_DEGREES * DeltaSeconds;

		Controls.bRun = Controller.IsInputKeyDown(EKeys::LeftShift) || Controller.IsInputKeyDown(EKeys::Gamepad_LeftThumbstick);
		Controls.bJump = Controller.IsInputKeyDown(EKeys::SpaceBar) || Controller.IsInputKeyDown(EKeys::Gamepad_FaceButton_Bottom);
		Controls.bGrabPressed = Controller.WasInputKeyJustPressed(EKeys::E) || Controller.WasInputKeyJustPressed(EKeys::Gamepad_RightShoulder);
		Controls.bDropPressed = Controller.WasInputKeyJustPressed(EKeys::Q) || Controller.WasInputKeyJustPressed(EKeys::Gamepad_LeftShoulder);
		Controls.bLightPressed = Controller.WasInputKeyJustPressed(EKeys::F) || Controller.WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Top);
		Controls.bReadyPressed = Controller.WasInputKeyJustPressed(EKeys::R) || Controller.WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Left);
		return Controls;
	}

	float DeadZone(float Value)
	{
		if (Math::Abs(Value) < STICK_DEAD_ZONE)
			return 0;
		return Value;
	}
}
