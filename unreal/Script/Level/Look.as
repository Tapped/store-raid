// The picture's look, as gradePicture() in client/src/graphics.ts sets the web game's: one unbound
// post-process volume on each machine that draws. Exposure is fixed, not the engine's eye adaptation,
// which brightens a dark warehouse until it's as light as day: the night should stay dark, lit in
// pools by its fittings and flashlights.
class ALook : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	UPostProcessComponent Volume;

	default Volume.bUnbound = true;

	/** Exposure compensation, in stops on manual exposure at EV100 0: lower is darker. */
	float Exposure = -3.0;

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		Apply();
	}

	void Apply()
	{
		FPostProcessSettings& Settings = Volume.Settings;
		Settings.bOverride_AutoExposureMethod = true;
		Settings.AutoExposureMethod = EAutoExposureMethod::AEM_Manual;
		Settings.bOverride_AutoExposureApplyPhysicalCameraExposure = true;
		Settings.AutoExposureApplyPhysicalCameraExposure = false;
		Settings.bOverride_AutoExposureBias = true;
		Settings.AutoExposureBias = Exposure;
	}
}

// sr.exposure [stops]: sets this machine's exposure compensation, or logs it.
const FConsoleCommand ExposureCommand("sr.exposure", n"OnExposureCommand");
void OnExposureCommand(TArray<FString> Arguments)
{
	TArray<ALook> Looks;
	GetAllActorsOfClass(Looks);
	for (ALook Each : Looks)
	{
		if (Arguments.Num() >= 1)
			Each.Exposure = String::Conv_StringToDouble(Arguments[0]);
		Each.Apply();
		Log(f"StoreRaid exposure: {Each.Exposure}");
	}
}
