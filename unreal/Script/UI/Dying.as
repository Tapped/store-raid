// How close to death the player whose eyes we look through is, shown as their view going, not as a
// bar: M_Dying (made by `pnpm run ue surfaces`) closes the picture in from the edges, red-black,
// drains it of colour and darkens it, throbbing with a heartbeat that quickens as health runs out.
// A tick on them brings it on at once, whatever their health, and the overlay says how to get it
// off. One on each machine that draws, an unbound post-process, as ALook is. It stands in for the
// web game's health bar and red screen edges (client/src/health.ts).

class ADying : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	UPostProcessComponent Volume;
	default Volume.bUnbound = true;
	default Volume.Priority = 10;

	UMaterialInstanceDynamic Material;
	/** How far gone the picture is, 0 to 1, eased after the health it shows. */
	float Shown = 0;
	/** Beats so far: its fraction is where in a heartbeat we are. */
	float Beats = 0;

	UFUNCTION(BlueprintOverride)
	void BeginPlay()
	{
		UMaterialInterface Base = Cast<UMaterialInterface>(LoadObject(nullptr, "/Game/Surfaces/M_Dying.M_Dying"));
		if (Base == nullptr)
		{
			Log("StoreRaid: no M_Dying, so nothing shows how close to death a player is: run pnpm run ue surfaces");
			return;
		}
		Material = Material::CreateDynamicMaterialInstance(Base);
		FWeightedBlendable Blend;
		Blend.Weight = 1;
		Blend.Object = Material;
		Volume.Settings.WeightedBlendables.Array.Add(Blend);
	}

	UFUNCTION(BlueprintOverride)
	void Tick(float DeltaSeconds)
	{
		float Health = Health::MAX;
		bool bLatched = false;
		bool bHandFree = true;
		Watched(Health, bLatched, bHandFree);

		const float Gone = 1 - Math::Clamp(Health / Health::MAX, 0.0, 1.0);
		float Amount = Math::Pow(Gone, 1.4) * DYING_FULL;
		if (bLatched)
			Amount = Math::Max(Amount, DYING_LATCHED);
		// Eased, so a tick landing closes in over a moment and a player put back opens up again.
		Shown = Math::FInterpTo(Shown, Amount, DeltaSeconds, 4);

		// The heart beats faster the worse it is: a double thump, lub-dub, then quiet.
		const float Rate = (HEART_REST + (HEART_DYING - HEART_REST) * Math::Max(Gone, bLatched ? 0.5 : 0.0)) / 60;
		Beats += DeltaSeconds * Rate;
		const float Into = (Beats - Math::FloorToFloat(Beats)) / Rate;
		const float Pulse = Math::Exp(-Math::Square(Into / 0.05)) + 0.55 * Math::Exp(-Math::Square((Into - 0.22) / 0.06));

		if (Material != nullptr)
		{
			Material.SetScalarParameterValue(n"Amount", Shown);
			Material.SetScalarParameterValue(n"Pulse", Shown > 0.01 ? Pulse : 0.0);
		}
		APlayerController Local = Gameplay::GetPlayerController(0);
		AStoreRaidPlayerController Controller = Cast<AStoreRaidPlayerController>(Local);
		if (Controller != nullptr && Controller.Hud != nullptr)
		{
			FString Prompt = "";
			if (bLatched && Local.GetViewTarget() == Local.GetControlledPawn())
				Prompt = bHandFree ? "A tick is on you · pull it off: E · RB" : "A tick is on you · free a hand: Q · LB, then pull it off: E · RB";
			Controller.Hud.SetPrompt(Prompt);
		}
	}

	/** The health of whoever we look through, whether a tick is on them, and whether they have a hand free. */
	void Watched(float& OutHealth, bool& OutLatched, bool& OutHandFree)
	{
		APlayerController Local = Gameplay::GetPlayerController(0);
		if (Local == nullptr)
			return;
		AStoreRaidCharacter Eyes = Cast<AStoreRaidCharacter>(Local.GetViewTarget());
		if (Eyes == nullptr)
			return;
		AStoreRaidPlayerState Player = Cast<AStoreRaidPlayerState>(Eyes.PlayerState);
		if (Player == nullptr || !Player.IsPlaying())
			return;
		OutHealth = Player.Health;
		OutHandFree = Eyes.Left == nullptr || Eyes.Right == nullptr;
		TArray<ATick> Ticks;
		GetAllActorsOfClass(Ticks);
		for (ATick Tick : Ticks)
		{
			if (Tick.State == ETickState::Latched && Tick.Victim == Player)
				OutLatched = true;
		}
	}
}

/** How far gone the picture is with no health left, and at least with a tick on. */
const float DYING_FULL = 1.0;
const float DYING_LATCHED = 0.3;
/** Heartbeats a minute, well and at death's door. */
const float HEART_REST = 70;
const float HEART_DYING = 150;
