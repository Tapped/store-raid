// sr.eye <x> <y> <z> <bearing> [pitch]: looks from a point in game meters on this machine, bearing in
// degrees from north (90 is east) and pitch up, with the player's own field of view, while the player
// stays where they are. `sr.eye off` looks through the player's eyes again. For screenshots of a
// level from anywhere, without walking a bot there.
const FConsoleCommand EyeCommand("sr.eye", n"OnEyeCommand");
void OnEyeCommand(TArray<FString> Arguments)
{
	APlayerController Controller = Gameplay::GetPlayerController(0);
	if (Controller == nullptr || Arguments.Num() < 1)
		return;
	TArray<ACameraActor> Eyes;
	GetAllActorsOfClass(Eyes);
	if (Arguments[0] == "off")
	{
		for (ACameraActor Eye : Eyes)
			Eye.DestroyActor();
		if (Controller.GetControlledPawn() != nullptr)
			Controller.SetViewTargetWithBlend(Controller.GetControlledPawn(), 0);
		return;
	}
	if (Arguments.Num() < 4)
		return;
	const FVector At = World::ToWorld(String::Conv_StringToDouble(Arguments[0]), String::Conv_StringToDouble(Arguments[1]), String::Conv_StringToDouble(Arguments[2]));
	const float Pitch = Arguments.Num() >= 5 ? String::Conv_StringToDouble(Arguments[4]) : 0.0;
	const FRotator Facing(Pitch, String::Conv_StringToDouble(Arguments[3]), 0);
	ACameraActor Eye = Eyes.Num() > 0 ? Eyes[0] : Cast<ACameraActor>(SpawnActor(ACameraActor, At, Facing));
	FHitResult Hit;
	Eye.SetActorLocationAndRotation(At, Facing, false, Hit, true);
	// As the player's own camera (StoreRaidCharacter.as).
	Eye.CameraComponent.FieldOfView = 94.93;
	Controller.SetViewTargetWithBlend(Eye, 0);
}

// sr.torch [candela]: a light carried with the sr.eye camera on this machine, to look at things in
// the dark (ticks waiting on racking); `sr.torch off` puts it out. It follows the eye wherever it goes.
const FConsoleCommand TorchCommand("sr.torch", n"OnTorchCommand");
void OnTorchCommand(TArray<FString> Arguments)
{
	TArray<ACameraActor> Eyes;
	GetAllActorsOfClass(Eyes);
	TArray<ASpotLight> Lights;
	GetAllActorsOfClass(Lights);
	for (ASpotLight Light : Lights)
	{
		if (Light.Tags.Contains(n"Torch"))
			Light.DestroyActor();
	}
	if (Eyes.Num() == 0 || (Arguments.Num() > 0 && Arguments[0] == "off"))
		return;
	ASpotLight Torch = Cast<ASpotLight>(SpawnActor(ASpotLight, Eyes[0].ActorLocation, Eyes[0].ActorRotation));
	Torch.Tags.Add(n"Torch");
	Torch.SpotLightComponent.SetMobility(EComponentMobility::Movable);
	Torch.SpotLightComponent.SetIntensityUnits(ELightUnits::Candelas);
	Torch.SpotLightComponent.SetIntensity(Arguments.Num() > 0 ? String::Conv_StringToDouble(Arguments[0]) : 400.0);
	Torch.SpotLightComponent.SetOuterConeAngle(40);
	Torch.SpotLightComponent.SetAttenuationRadius(3000);
	Torch.AttachToActor(Eyes[0], NAME_None, EAttachmentRule::KeepWorld);
}
