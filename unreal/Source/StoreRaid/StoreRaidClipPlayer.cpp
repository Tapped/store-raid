#include "StoreRaidClipPlayer.h"

#include "Animation/AnimNodeBase.h"
#include "Animation/AnimSequenceBase.h"
#include "Animation/AnimationPoseData.h"
#include "AnimationRuntime.h"

/** At most this many clips blend at once; past it the oldest is let go. */
static constexpr int32 MaxLayers = 4;

void UStoreRaidClipPlayer::Play(UAnimSequenceBase* Clip, bool bLoop, float Rate, float StartAt, float FadeTime)
{
	if (Clip == nullptr)
		return;
	FStoreRaidClipLayer Layer;
	Layer.Clip = Clip;
	Layer.Time = FMath::Clamp(StartAt, 0.f, Clip->GetPlayLength());
	Layer.Rate = Rate;
	Layer.bLoop = bLoop;
	Layer.FadeTime = FadeTime;
	Layer.Alpha = (FadeTime <= 0.f || Layers.Num() == 0) ? 1.f : 0.f;
	if (Layer.Alpha >= 1.f)
		Layers.Reset();
	Layers.Add(Layer);
	while (Layers.Num() > MaxLayers)
		Layers.RemoveAt(0);
	Layers[0].Alpha = 1.f;
}

void UStoreRaidClipPlayer::SetRate(float Rate)
{
	if (Layers.Num() > 0)
		Layers.Last().Rate = Rate;
}

UAnimSequenceBase* UStoreRaidClipPlayer::GetClip() const
{
	return Layers.Num() > 0 ? Layers.Last().Clip.Get() : nullptr;
}

float UStoreRaidClipPlayer::GetTime() const
{
	return Layers.Num() > 0 ? Layers.Last().Time : 0.f;
}

void UStoreRaidClipPlayer::NativeUpdateAnimation(float DeltaSeconds)
{
	Super::NativeUpdateAnimation(DeltaSeconds);
	int32 Settled = 0;
	for (int32 Index = 0; Index < Layers.Num(); Index++)
	{
		FStoreRaidClipLayer& Layer = Layers[Index];
		if (Layer.Clip == nullptr)
			continue;
		const float Length = Layer.Clip->GetPlayLength();
		Layer.Time += DeltaSeconds * Layer.Rate;
		if (Layer.bLoop && Length > 0.f)
		{
			Layer.Time = FMath::Fmod(Layer.Time, Length);
			if (Layer.Time < 0.f)
				Layer.Time += Length;
		}
		else
			Layer.Time = FMath::Clamp(Layer.Time, 0.f, Length);
		if (Layer.Alpha < 1.f)
			Layer.Alpha = Layer.FadeTime > 0.f ? FMath::Min(1.f, Layer.Alpha + DeltaSeconds / Layer.FadeTime) : 1.f;
		if (Layer.Alpha >= 1.f)
			Settled = Index;
	}
	// Whatever is under a clip that shows fully can't be seen any more.
	if (Settled > 0)
		Layers.RemoveAt(0, Settled);
}

FAnimInstanceProxy* UStoreRaidClipPlayer::CreateAnimInstanceProxy()
{
	return new FStoreRaidClipPlayerProxy(this);
}

void UStoreRaidClipPlayer::DestroyAnimInstanceProxy(FAnimInstanceProxy* InProxy)
{
	delete static_cast<FStoreRaidClipPlayerProxy*>(InProxy);
}

void FStoreRaidClipPlayerProxy::PreUpdate(UAnimInstance* InAnimInstance, float DeltaSeconds)
{
	FAnimInstanceProxy::PreUpdate(InAnimInstance, DeltaSeconds);
	if (const UStoreRaidClipPlayer* Player = Cast<UStoreRaidClipPlayer>(InAnimInstance))
		Layers = Player->Layers;
}

/** A clip's pose at a layer's time, into Pose. */
static void Sample(const FStoreRaidClipLayer& Layer, FPoseContext& Pose)
{
	FAnimationPoseData Data(Pose);
	Layer.Clip->GetAnimationPose(Data, FAnimExtractContext(static_cast<double>(Layer.Time), false, {}, Layer.bLoop));
}

bool FStoreRaidClipPlayerProxy::Evaluate(FPoseContext& Output)
{
	bool bAny = false;
	for (const FStoreRaidClipLayer& Layer : Layers)
	{
		if (Layer.Clip == nullptr || Layer.Alpha <= 0.f)
			continue;
		if (!bAny || Layer.Alpha >= 1.f)
		{
			Sample(Layer, Output);
			bAny = true;
			continue;
		}
		FPoseContext Next(this);
		Sample(Layer, Next);
		FPoseContext Mixed(this);
		FAnimationPoseData MixedData(Mixed);
		FAnimationRuntime::BlendTwoPosesTogether(FAnimationPoseData(Output), FAnimationPoseData(Next), 1.f - Layer.Alpha, MixedData);
		Output.Pose.CopyBonesFrom(Mixed.Pose);
		Output.Curve.CopyFrom(Mixed.Curve);
		Output.CustomAttributes.CopyFrom(Mixed.CustomAttributes);
	}
	if (!bAny)
		Output.ResetToRefPose();
	return true;
}
