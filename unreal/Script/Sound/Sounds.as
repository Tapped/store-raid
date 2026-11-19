// Sound, on Unreal's audio engine: client/src/audio.ts and occlusion.ts, with the engine doing what
// they did by hand. Sounds are the waves `pnpm run ue sounds` imports from assets/audio/sfx into
// /Game/Audio/, by name. A placed sound is spatialised, fades with distance on the web game's curve
// (FFalloff) and is muffled by walls between it and the listener (UStoreRaidAudio::MakeFalloff, in
// C++ because the curve needs keys); one heard straight, our own footsteps or an ambience's bed,
// neither fades nor pans. The listener is the camera we look through. Nothing plays on the
// dedicated server, which has no ears.

/**
 * How a placed sound fades with distance: full volume within Near meters, then by Rolloff as the
 * distance grows (Web Audio's inverse model), and no quieter past Far. FALLOFF in audio.ts.
 */
struct FFalloff
{
	float Near = 1.0;
	float Far = 30.0;
	float Rolloff = 2.48;
};

namespace Sounds
{
	/**
	 * Walls between a sound and the listener: how loud it is through one, the Hz above which one
	 * cuts, and the seconds a change glides over (Sound/Occlusion in occlusion.ts). Unreal's
	 * occlusion is one trace, so several walls muffle as much as one.
	 */
	const float WALL_GAIN = 0.28;
	const float WALL_CUTOFF = 700;
	const float WALL_GLIDE = 0.08;

	FFalloff MakeFalloff(float Near, float Far, float Rolloff)
	{
		FFalloff Falloff;
		Falloff.Near = Near;
		Falloff.Far = Far;
		Falloff.Rolloff = Rolloff;
		return Falloff;
	}

	/** A sound by its file's name in assets/audio/sfx (`footstep-concrete-1`); null if it isn't imported. */
	USoundWave Wave(FString Name)
	{
		return Cast<USoundWave>(LoadObject(nullptr, f"/Game/Audio/{Name}.{Name}"));
	}

	/** A list of sound names, for FOneShots.Load. */
	TArray<FString> List(FString A, FString B = "", FString C = "")
	{
		TArray<FString> Names;
		Names.Add(A);
		if (!B.IsEmpty())
			Names.Add(B);
		if (!C.IsEmpty())
			Names.Add(C);
		return Names;
	}

	/** Whether this machine hears anything: not the dedicated server. */
	bool Heard()
	{
		return !System::IsDedicatedServer();
	}

	/** The attenuation for a falloff, made once a world and kept by USoundBank. */
	USoundAttenuation Attenuation(FFalloff Falloff)
	{
		USoundBank Bank = USoundBank::Get();
		return Bank != nullptr ? Bank.Falloff(Falloff) : nullptr;
	}

	/** Plays a sound from a point in Unreal's space, fading by Falloff and muffled by walls. */
	UAudioComponent PlayAt(USoundBase Sound, FVector Location, float Volume, float Pitch = 1, FFalloff Falloff = FFalloff(), float StartTime = 0)
	{
		if (Sound == nullptr || !Heard())
			return nullptr;
		return Gameplay::SpawnSoundAtLocation(Sound, Location, FRotator::ZeroRotator, Volume, Pitch, StartTime, Attenuation(Falloff));
	}

	/** Plays a sound from a component, or a bone or socket of it, following it as it moves. */
	UAudioComponent PlayOn(USoundBase Sound, USceneComponent On, float Volume, float Pitch = 1, FFalloff Falloff = FFalloff(), float StartTime = 0, FName Socket = NAME_None)
	{
		if (Sound == nullptr || On == nullptr || !Heard())
			return nullptr;
		return Gameplay::SpawnSoundAttached(Sound, On, Socket, FVector::ZeroVector, FRotator::ZeroRotator, EAttachLocation::KeepRelativeOffset, true, Volume, Pitch, StartTime, Attenuation(Falloff));
	}

	/** Plays a sound heard straight, from nowhere in particular: it neither fades nor pans. */
	UAudioComponent PlayStraight(USoundBase Sound, float Volume, float Pitch = 1, float StartTime = 0)
	{
		if (Sound == nullptr || !Heard())
			return nullptr;
		return Gameplay::SpawnSound2D(Sound, Volume, Pitch, StartTime);
	}
}

/**
 * Short sounds played now and then, such as footsteps: each play picks one of the variants at
 * random, at a slightly different pitch and volume, so repeats don't sound the same. Every play is a
 * sound of its own, so they overlap freely. OneShots in audio.ts. In Unreal a sound's pitch is its
 * speed, as a Web Audio source's playback rate was.
 */
struct FOneShots
{
	TArray<USoundWave> Variants;
	bool bLoaded = false;

	/** The sounds of these names, those of them that are imported. */
	void Load(TArray<FString> Names)
	{
		bLoaded = true;
		Variants.Reset();
		for (FString Name : Names)
		{
			USoundWave Wave = Sounds::Wave(Name);
			if (Wave != nullptr)
				Variants.Add(Wave);
		}
	}

	/** The longest variant, in seconds at normal speed. */
	float Duration() const
	{
		float Longest = 0;
		for (USoundWave Wave : Variants)
			Longest = Math::Max(Longest, Wave.Duration);
		return Longest;
	}

	/** A variant at random, null if none are imported. */
	USoundWave Pick() const
	{
		if (Variants.Num() == 0)
			return nullptr;
		return Variants[Math::RandRange(0, Variants.Num() - 1)];
	}

	/** About Volume: three quarters of it to all of it. */
	float Vary(float Volume) const
	{
		return Volume * (0.75 + 0.25 * Math::RandRange(0.0, 1.0));
	}

	/** Rate, varied by up to Pitch either way (0.1 is 10%). */
	float Tune(float Pitch, float Rate) const
	{
		return Rate * (1 + Pitch * Math::RandRange(-1.0, 1.0));
	}

	/** Play one from a point in Unreal's space. */
	void PlayAt(FVector Location, float Volume, float Pitch = 0.1, float Rate = 1, FFalloff Falloff = FFalloff())
	{
		Sounds::PlayAt(Pick(), Location, Vary(Volume), Tune(Pitch, Rate), Falloff);
	}

	/** Play one from a component, or a bone or socket of it, following it. */
	void PlayOn(USceneComponent On, float Volume, float Pitch = 0.1, float Rate = 1, FFalloff Falloff = FFalloff(), FName Socket = NAME_None)
	{
		Sounds::PlayOn(Pick(), On, Vary(Volume), Tune(Pitch, Rate), Falloff, 0, Socket);
	}

	/** Play one heard straight. */
	void PlayStraight(float Volume, float Pitch = 0.1, float Rate = 1)
	{
		Sounds::PlayStraight(Pick(), Vary(Volume), Tune(Pitch, Rate));
	}
}

namespace Sounds
{
	/**
	 * Start a looping sound `Phase` of the way through it (0 to 1), so copies of one loop don't line
	 * up: placed at Location (Unreal's space) fading by Falloff, or heard straight if bPlaced is false.
	 * Loop.play in audio.ts. The wave has to be marked looping (Tools/import/sounds.ts's LOOPS).
	 */
	UAudioComponent Loop(FString Name, float Volume, float Phase = 0, bool bPlaced = false, FVector Location = FVector::ZeroVector, FFalloff Falloff = FFalloff())
	{
		USoundWave Sound = Wave(Name);
		if (Sound == nullptr || !Heard())
			return nullptr;
		const float Start = Math::Fmod(Math::Fmod(Phase, 1.0) + 1.0, 1.0) * Sound.Duration;
		if (bPlaced)
			return PlayAt(Sound, Location, Volume, 1, Falloff, Start);
		return PlayStraight(Sound, Volume, 1, Start);
	}
}

/** What sound keeps for a world: the attenuation of each falloff in use, made once. */
class USoundBank : UScriptWorldSubsystem
{
	UPROPERTY()
	TMap<FString, USoundAttenuation> Falloffs;

	USoundAttenuation Falloff(FFalloff Falloff)
	{
		const FString Key = f"{Falloff.Near} {Falloff.Far} {Falloff.Rolloff}";
		USoundAttenuation Found;
		if (Falloffs.Find(Key, Found))
			return Found;
		USoundAttenuation Made = UStoreRaidAudio::MakeFalloff(this, Falloff.Near, Falloff.Far, Falloff.Rolloff, Sounds::WALL_GAIN, Sounds::WALL_CUTOFF, Sounds::WALL_GLIDE);
		Falloffs.Add(Key, Made);
		return Made;
	}
}

// sr.record start: records what this machine hears; sr.record stop <name> writes it to
// Saved/Audio/<name>.wav. Off-screen clients render sound with no device (-DeterministicAudio in
// Tools/ue.ts), so this is how a check hears them.
const FConsoleCommand RecordCommand("sr.record", n"OnRecordCommand");
void OnRecordCommand(TArray<FString> Arguments)
{
	if (Arguments.Num() >= 1 && Arguments[0] == "start")
	{
		AudioMixer::StartRecordingOutput(600);
		Log("StoreRaid record: started");
		return;
	}
	if (Arguments.Num() >= 2 && Arguments[0] == "stop")
	{
		const FString Folder = Paths::ConvertRelativePathToFull(Paths::ProjectSavedDir() + "Audio/");
		AudioMixer::StopRecordingOutput(EAudioRecordingExportType::WavFile, Arguments[1], Folder);
		Log(f"StoreRaid record: {Folder}{Arguments[1]}.wav");
		return;
	}
	Log("StoreRaid record: sr.record start, or sr.record stop <name>");
}

// sr.sound <name> [x y z]: plays a sound (its name in assets/audio/sfx) on this machine, from that
// point in game meters with the usual falloff and walls, else heard straight.
const FConsoleCommand SoundCommand("sr.sound", n"OnSoundCommand");
void OnSoundCommand(TArray<FString> Arguments)
{
	if (Arguments.Num() != 1 && Arguments.Num() != 4)
	{
		Log("StoreRaid sound: sr.sound <name> [x y z]");
		return;
	}
	USoundWave Wave = Sounds::Wave(Arguments[0]);
	if (Wave == nullptr)
	{
		Log(f"StoreRaid sound: no sound {Arguments[0]} (pnpm run ue sounds)");
		return;
	}
	UAudioComponent Playing;
	if (Arguments.Num() == 1)
		Playing = Sounds::PlayStraight(Wave, 1);
	else
		Playing = Sounds::PlayAt(Wave, World::ToWorld(String::Conv_StringToDouble(Arguments[1]), String::Conv_StringToDouble(Arguments[2]), String::Conv_StringToDouble(Arguments[3])), 1);
	FString How = Playing == nullptr ? "not playing" : f"playing {Playing.IsPlaying()} at {Playing.WorldLocation} falloff {Playing.AttenuationSettings != nullptr}";
	Log(f"StoreRaid sound: {Arguments[0]} {Wave.Duration :.2} s, {How}");
}
