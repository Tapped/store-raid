#pragma once

#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "Animation/AnimInstanceProxy.h"
#include "StoreRaidClipPlayer.generated.h"

class UAnimSequenceBase;

/** One clip playing: where in it (seconds), how fast (negative plays it backward), and how far it has faded in. */
USTRUCT()
struct FStoreRaidClipLayer
{
	GENERATED_BODY()

	UPROPERTY() TObjectPtr<UAnimSequenceBase> Clip = nullptr;
	float Time = 0.f;
	float Rate = 1.f;
	bool bLoop = false;
	/** 0 to 1 over FadeTime seconds: how much of this clip shows over everything older. */
	float Alpha = 1.f;
	float FadeTime = 0.f;
};

/** Evaluates the layers on the animation worker: each newer one faded in over the blend of those before it. */
struct FStoreRaidClipPlayerProxy : public FAnimInstanceProxy
{
	FStoreRaidClipPlayerProxy() {}
	FStoreRaidClipPlayerProxy(UAnimInstance* Instance) : FAnimInstanceProxy(Instance) {}

	TArray<FStoreRaidClipLayer> Layers;

	virtual void PreUpdate(UAnimInstance* InAnimInstance, float DeltaSeconds) override;
	virtual bool Evaluate(FPoseContext& Output) override;
};

/**
 * Plays a skinned model's clips with a crossfade between them, for any character: script picks what
 * to play (Play), and the pose fades from whatever showed before, even from the middle of another
 * fade. No animation blueprint: give a skeletal mesh component this class
 * (`SetAnimationMode(AnimationBlueprint)`, `SetAnimInstanceClass(UStoreRaidClipPlayer)`) and call it
 * through `GetAnimInstance()`.
 */
UCLASS(Transient, NotBlueprintable)
class STORERAID_API UStoreRaidClipPlayer : public UAnimInstance
{
	GENERATED_BODY()

public:
	/**
	 * Plays Clip from StartAt seconds at Rate (negative runs backward; a clip that doesn't loop holds
	 * its end), faded in over FadeTime seconds; 0 cuts to it.
	 */
	UFUNCTION(BlueprintCallable, Category = "Clips")
	void Play(UAnimSequenceBase* Clip, bool bLoop, float Rate = 1.f, float StartAt = 0.f, float FadeTime = 0.2f);

	/** How fast the newest clip plays from now on. */
	UFUNCTION(BlueprintCallable, Category = "Clips")
	void SetRate(float Rate);

	/** The newest clip, and where in it, in seconds. */
	UFUNCTION(BlueprintPure, Category = "Clips")
	UAnimSequenceBase* GetClip() const;
	UFUNCTION(BlueprintPure, Category = "Clips")
	float GetTime() const;
	/** How many clips show at once: more than one while fading from one to the next. */
	UFUNCTION(BlueprintPure, Category = "Clips")
	int32 GetBlending() const { return Layers.Num(); }

	/** Oldest first. Faded-out layers go once a newer one has fully faded in. */
	UPROPERTY(Transient)
	TArray<FStoreRaidClipLayer> Layers;

protected:
	virtual FAnimInstanceProxy* CreateAnimInstanceProxy() override;
	virtual void DestroyAnimInstanceProxy(FAnimInstanceProxy* InProxy) override;
	virtual void NativeUpdateAnimation(float DeltaSeconds) override;
};
