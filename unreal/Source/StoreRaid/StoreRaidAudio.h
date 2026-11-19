#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "StoreRaidAudio.generated.h"

class USoundAttenuation;

/**
 * Sound settings script can't make itself: a falloff on the web game's curve needs a curve's keys,
 * which script can't set. Script keeps the numbers (Script/Sound/Sounds.as).
 */
UCLASS()
class STORERAID_API UStoreRaidAudio : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * How a placed sound fades and is muffled, as client/src/audio.ts and occlusion.ts had it: full
	 * volume within Near meters, then Web Audio's inverse model, Near / (Near + Rolloff * (d - Near)),
	 * to Far, and no quieter past it (the curve holds its last value). Something on the Visibility
	 * channel between the listener and the sound, a wall, floor or shelf, turns it down to WallGain
	 * and cuts everything above WallCutoff Hz, gliding there over Glide seconds. Unlike the web game
	 * that's the same for one wall as for several.
	 */
	UFUNCTION(BlueprintCallable, Category = "StoreRaid|Audio")
	static USoundAttenuation* MakeFalloff(UObject* Outer, float Near, float Far, float Rolloff, float WallGain, float WallCutoff, float Glide);
};
