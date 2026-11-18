// A level's lamps on this machine, as client/src/interiorLight.ts lit its fittings: an engine light
// for each one that isn't dead, shaped by its kind, on the playground's dimmer, and flickering ones
// stuttering on their own clock. The model of a flickering fitting is drawn on its own, its glow
// dimming with its light; every other fitting's model is an instance in ALevelProps. Built on
// clients, never the dedicated server, so each screen's flicker runs its own dice, as the web
// game's did.
//
// Light from a fitting goes mostly down: a tube's batten and a high-bay's dome are above them. The
// engine's point light shines as much up as down and, a few centimetres under the ceiling, burnt a
// bright spot onto it. So a tube or a bulb is two lights, as the web game's bake spreads its light
// (MakeLights): 0.3 of it evenly all round, hung a little below it, and 0.7 in a spot light
// facing down.

/**
 * How a fitting's brightness moves: a failing tube's stutter, a dying one's dim pulsing, a starter
 * that keeps trying, a nervous buzz. `Flicker` in client/src/interiorLight.ts, number for number.
 */
enum EFlicker
{
	Stutter,
	Dying,
	Starter,
	Buzz,
};

struct FFlicker
{
	EFlicker Pattern = EFlicker::Stutter;
	float Value = 1.0;
	/** Seconds left in the current phase, and until the next change within it. */
	float Phase = 0.0;
	float Tick = 0.0;
	int Mode = 0;
	float Count = 0.0;
	float Slow = 0.0;

	void Start(EFlicker InPattern)
	{
		Pattern = InPattern;
		Phase = Math::RandRange(0.0, 4.0);
		Slow = Math::RandRange(0.0, 10.0);
	}

	float Step(float Dt)
	{
		Phase -= Dt;
		Tick -= Dt;
		Slow += Dt;
		switch (Pattern)
		{
			case EFlicker::Stutter:
				// On for a while, then a fit of rapid stuttering, now and then going out for a moment.
				if (Phase <= 0)
				{
					Mode = Mode == 0 ? (Math::RandRange(0.0, 1.0) < 0.2 ? 2 : 1) : 0;
					Phase = Mode == 0 ? Math::RandRange(0.8, 7.0) : (Mode == 1 ? Math::RandRange(0.15, 1.4) : Math::RandRange(0.3, 2.0));
				}
				if (Mode == 0)
					Value = 1;
				else if (Mode == 2)
					Value = 0;
				else if (Tick <= 0)
				{
					Tick = Math::RandRange(1.0 / 40.0, 1.0 / 10.0);
					const float Roll = Math::RandRange(0.0, 1.0);
					Value = Roll < 0.45 ? 0.0 : (Roll < 0.6 ? 0.2 : 1.0);
				}
				break;
			case EFlicker::Dying:
				// Dim and wavering, with a sudden surge or a drop now and then.
				if (Phase <= 0)
				{
					Mode = Math::RandRange(0.0, 1.0) < 0.5 ? 1 : 2;
					Phase = Math::RandRange(0.05, 0.2);
					Count = Math::RandRange(2.0, 7.0);
				}
				if (Mode != 0 && Phase < 0.25 && Phase > 0)
					Value = Mode == 1 ? 1.0 : 0.04;
				else
					Value = 0.35 + 0.12 * Math::Sin(Slow * 2.3) + 0.06 * Math::Sin(Slow * 7.1);
				if (Phase <= 0.001 && Mode != 0)
				{
					Mode = 0;
					Phase = Count;
				}
				break;
			case EFlicker::Starter:
				// Dark, then a burst of blinks as the starter tries; sometimes it catches for a while.
				if (Phase <= 0)
				{
					if (Mode == 0)
					{
						Mode = 1;
						Count = Math::FloorToFloat(Math::RandRange(2.0, 7.0));
						Phase = 10;
						Tick = 0;
						Value = 0;
					}
					else
					{
						Mode = 0;
						Phase = Math::RandRange(0.8, 3.5);
						Value = 0;
					}
				}
				if (Mode == 1 && Tick <= 0)
				{
					if (Value > 0)
					{
						Value = 0;
						Tick = Math::RandRange(0.05, 0.3);
						Count -= 1;
						if (Count <= 0)
						{
							if (Math::RandRange(0.0, 1.0) < 0.35)
							{
								Mode = 2;
								Value = 1;
								Phase = Math::RandRange(1.5, 8.0);
							}
							else
							{
								Mode = 0;
								Phase = Math::RandRange(0.8, 3.5);
							}
						}
					}
					else
					{
						Value = Math::RandRange(0.6, 1.0);
						Tick = Math::RandRange(0.03, 0.12);
					}
				}
				break;
			case EFlicker::Buzz:
				// On, but never quite steady, with the odd dropout.
				if (Phase <= 0)
				{
					Phase = Math::RandRange(2.0, 10.0);
					Mode = 1;
					Count = Math::RandRange(0.04, 0.12);
				}
				if (Mode == 1)
				{
					Count -= Dt;
					Value = 0.15;
					if (Count <= 0)
						Mode = 0;
				}
				else if (Tick <= 0)
				{
					Tick = 1.0 / 20.0;
					Value = Math::RandRange(0.82, 1.0);
				}
				break;
		}
		return Value;
	}
};

/** One lamp as this machine lights it. */
struct FFitting
{
	TArray<ULocalLightComponent> Lights;
	/** How bright each is at full, before the dimmer and its flicker. */
	TArray<float> Lumens;
	bool bFlickers = false;
	FFlicker Flicker;
	/** Its model's glowing materials, to dim with it, when it flickers. */
	TArray<UMaterialInstanceDynamic> Glows;
	TArray<FLinearColor> GlowColours;
};

/** How far below a fitting the even part of its light hangs, in meters: NEAR in lightBake.ts. */
const float NEAR = 0.35;
/**
 * A lamp's lumens shared between its two lights, so that straight down they give what the one point
 * light did, split 0.3 : 0.7. The engine counts a spot light's lumens as a point light's, whatever
 * its cone, so the shares are those.
 */
const float EVEN_SHARE = 0.3;
const float DOWN_SHARE = 0.7;

class ALevelFittings : AActor
{
	UPROPERTY(DefaultComponent, RootComponent)
	USceneComponent Root;

	TArray<FFitting> Fittings;
	/** The playground's dimmer, 0 to 1. */
	float Dimmer = 1.0;

	/**
	 * Lights the level's lamps. Returns the props it draws itself, the models of flickering fittings,
	 * by their index in `Props`, for ALevelProps to leave out.
	 */
	TArray<int> Build(TArray<FLamp> Lamps, TArray<FPropSpawn> Props)
	{
		TArray<int> Taken;
		for (const FLamp& Lamp : Lamps)
		{
			FFitting Fitting;
			MakeLights(Lamp, Fitting);
			if (Lamp.State == ELightState::Flicker)
			{
				Fitting.bFlickers = true;
				// As interiorLight.ts picks them: PATTERNS[(i * 7 + 3) % PATTERNS.length].
				Fitting.Flicker.Start(EFlicker((Lamp.Fitting * 7 + 3) % 4));
				const int Prop = PropOf(Lamp, Props);
				if (Prop >= 0 && !Taken.Contains(Prop))
				{
					Taken.Add(Prop);
					DrawOwn(Props[Prop], Fitting);
				}
			}
			Fittings.Add(Fitting);
		}
		Show(0);
		return Taken;
	}

	/**
	 * The engine's lights for a lamp. A tube or a bulb sends light as the web game's bake has it,
	 * `0.3 + 0.7 * cos` of the angle down from straight below and 0.3 upwards: that is an even 0.3 all
	 * round, a point light, and 0.7 falling off with the cosine downwards, a spot light facing down whose
	 * cone fades from straight down to 80°. Together they're as bright straight down as the one point
	 * light the exposure was matched by (Look.as), and send the ceiling a third as much as it did. (A
	 * rect light spreads its light by the cosine itself, but cost 40% of the frame rate with one a
	 * fitting.)
	 */
	void MakeLights(FLamp Lamp, FFitting& Fitting)
	{
		const FVector At = World::ToWorld(Lamp.At.X, Lamp.At.Y, Lamp.At.Z);
		if (!Lamp.bFitting || Lamp.Kind == ELightKind::Emergency || Lamp.Kind == ELightKind::Exit)
		{
			// Emergency lights and exit signs on walls, small and nowhere near a ceiling, and the
			// playground's lamps: all round.
			UPointLightComponent Point = UPointLightComponent::Create(this);
			Point.SetWorldLocation(At);
			AddLight(Fitting, Point, Lamp, Lamp.Lumens);
			return;
		}
		const bool bTube = Lamp.Kind == ELightKind::Tube;
		// Its even part, hung below it: the bake's light falls off as 1 / (d² + 0.35²), which near
		// it is a point that much further away, so the ceiling right over it isn't burnt white.
		// Along the tube for a tube: its length runs along its x, which a bearing of 90° turns to
		// game x, a tube's way when it isn't turned.
		UPointLightComponent Round = UPointLightComponent::Create(this);
		Round.SetWorldLocationAndRotation(At - FVector(0, 0, NEAR * 100), FRotator(0, 90 + Math::RadiansToDegrees(Lamp.Turn), 0));
		Round.SetSourceLength(bTube ? 115 : 0);
		Round.SetSourceRadius(bTube ? 3 : 10);
		AddLight(Fitting, Round, Lamp, Lamp.Lumens * EVEN_SHARE);
		// The shadows that show, under racking and containers, are the downward part's: the even
		// part casting them too cost a high-bay hall a tenth of its frame rate.
		Round.SetCastShadows(false);
		// Its part going down. A source's length runs along the light's x, here straight down, so
		// this one has only a radius.
		USpotLightComponent Down = USpotLightComponent::Create(this);
		Down.SetWorldLocationAndRotation(At, FRotator(-90, 0, 0));
		Down.SetInnerConeAngle(0);
		Down.SetOuterConeAngle(80);
		Down.SetSourceRadius(bTube ? 4 : 15);
		AddLight(Fitting, Down, Lamp, Lamp.Lumens * DOWN_SHARE);
	}

	void AddLight(FFitting& Fitting, ULocalLightComponent Light, FLamp Lamp, float Lumens)
	{
		Light.SetMobility(EComponentMobility::Movable);
		Light.SetIntensityUnits(ELightUnits::Lumens);
		Light.SetIntensity(Lumens);
		Light.SetAttenuationRadius(Lamp.Radius * 100.0);
		Light.SetLightColor(Lamp.Colour);
		Light.SetCastShadows(Lamp.bShadows);
		Fitting.Lights.Add(Light);
		Fitting.Lumens.Add(Lumens);
	}

	/** The prop that is a lamp's fitting: of its kind, right by it. -1 if there is none. */
	int PropOf(FLamp Lamp, TArray<FPropSpawn> Props)
	{
		EProp Model;
		switch (Lamp.Kind)
		{
			case ELightKind::Tube: Model = EProp::CeilingTube; break;
			case ELightKind::Bulb: Model = EProp::HighBay; break;
			case ELightKind::Emergency: Model = EProp::EmergencyLight; break;
			default: Model = EProp::ExitSign; break;
		}
		int Best = -1;
		float Nearest = 0.3;
		for (int Index = 0; Index < Props.Num(); Index++)
		{
			if (Props[Index].Model != Model)
				continue;
			const float Away = Math::Sqrt(Math::Square(Props[Index].X - Lamp.At.X) + Math::Square(Props[Index].Z - Lamp.At.Z));
			if (Away < Nearest)
			{
				Nearest = Away;
				Best = Index;
			}
		}
		return Best;
	}

	/**
	 * A flickering fitting's model on its own, its glowing materials swapped for M_Glow in the
	 * colour and strength the model gives them, to dim as it flickers.
	 */
	void DrawOwn(FPropSpawn Prop, FFitting& Fitting)
	{
		UStaticMesh Mesh = Models::Mesh("props/" + Props::Name(Prop.Model));
		UMaterialInterface Glow = Cast<UMaterialInterface>(LoadObject(nullptr, "/Game/Surfaces/M_Glow.M_Glow"));
		if (Mesh == nullptr)
			return;
		UStaticMeshComponent Drawn = UStaticMeshComponent::Create(this);
		Drawn.SetStaticMesh(Mesh);
		Drawn.SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Drawn.SetWorldLocationAndRotation(World::ToWorld(Prop.X, Prop.Y, Prop.Z), FRotator(0, Math::RadiansToDegrees(Prop.Turn), 0));
		if (Glow == nullptr)
		{
			Log("StoreRaid: no M_Glow, so flickering fittings' glow stays lit: run pnpm run ue surfaces");
			return;
		}
		for (int Slot = 0; Slot < Mesh.StaticMaterials.Num(); Slot++)
		{
			const FString Name = Mesh.StaticMaterials[Slot].MaterialSlotName.ToString();
			FLinearColor Colour;
			if (!GlowOf(Name, Colour))
				continue;
			UMaterialInstanceDynamic Made = Drawn.CreateDynamicMaterialInstance(Slot, Glow);
			Fitting.Glows.Add(Made);
			Fitting.GlowColours.Add(Colour);
		}
	}

	/**
	 * The glow a fitting's material has in its model, emissive factor times strength from
	 * scripts/models: only what goes out with the light, not an emergency light's LED.
	 */
	bool GlowOf(FString Name, FLinearColor& Colour)
	{
		if (Name == "glow-tube")
			Colour = FLinearColor(1.0, 0.95, 0.86) * 3.0;
		else if (Name == "glow-lens")
			Colour = FLinearColor(1.0, 0.86, 0.66) * 3.0;
		else if (Name == "glow-sign")
			Colour = FLinearColor(0.0, 0.9, 0.2);
		else if (Name == "glow-sign-figure")
			Colour = FLinearColor(0.85, 1.0, 0.9) * 1.6;
		else
			return false;
		return true;
	}

	/** On the playground's dimmer. */
	void SetDimmer(float Light)
	{
		Dimmer = Light;
		Show(0);
	}

	UFUNCTION(BlueprintOverride)
	void Tick(float DeltaSeconds)
	{
		Show(Math::Min(0.1, DeltaSeconds));
	}

	/** Every lamp as bright as the dimmer and its flicker make it now. */
	void Show(float Dt)
	{
		for (FFitting& Fitting : Fittings)
		{
			if (!Fitting.bFlickers && Dt > 0)
				continue;
			const float Now = Fitting.bFlickers ? Fitting.Flicker.Step(Dt) : 1.0;
			for (int Index = 0; Index < Fitting.Lights.Num(); Index++)
				Fitting.Lights[Index].SetIntensity(Fitting.Lumens[Index] * Dimmer * Now);
			for (int Index = 0; Index < Fitting.Glows.Num(); Index++)
				Fitting.Glows[Index].SetVectorParameterValue(n"Glow", Fitting.GlowColours[Index] * Now);
		}
	}
}

// sr.lamps: lights this machine's lamps again, to see a change to Fittings.as without a restart.
const FConsoleCommand LampsCommand("sr.lamps", n"OnLampsCommand");
void OnLampsCommand(TArray<FString> Arguments)
{
	AStoreRaidGameState State = Cast<AStoreRaidGameState>(Gameplay::GetGameState());
	if (State != nullptr)
		State.Relight();
}
