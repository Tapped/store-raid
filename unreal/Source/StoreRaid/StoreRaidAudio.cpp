#include "StoreRaidAudio.h"

#include "Sound/SoundAttenuation.h"

USoundAttenuation* UStoreRaidAudio::MakeFalloff(UObject* Outer, float Near, float Far, float Rolloff, float WallGain, float WallCutoff, float Glide)
{
	USoundAttenuation* Attenuation = NewObject<USoundAttenuation>(Outer ? Outer : GetTransientPackage());
	FSoundAttenuationSettings& Settings = Attenuation->Attenuation;
	Settings.bAttenuate = true;
	Settings.bSpatialize = true;
	Settings.AttenuationShape = EAttenuationShape::Sphere;
	Settings.AttenuationShapeExtents = FVector(Near * 100.f, 0.f, 0.f);
	const float Span = FMath::Max(Far - Near, 0.01f);
	Settings.FalloffDistance = Span * 100.f;
	Settings.DistanceAlgorithm = EAttenuationDistanceModel::Custom;
	// Keys closer together near the start, where the curve bends most.
	FRichCurve* Curve = Settings.CustomAttenuationCurve.GetRichCurve();
	Curve->Reset();
	constexpr int32 Keys = 32;
	for (int32 I = 0; I <= Keys; I++)
	{
		const float T = FMath::Square(float(I) / Keys);
		const float Beyond = T * Span;
		const FKeyHandle Key = Curve->AddKey(T, Near / (Near + Rolloff * Beyond));
		Curve->SetKeyInterpMode(Key, RCIM_Linear);
	}
	Settings.bEnableOcclusion = true;
	Settings.OcclusionTraceChannel = ECC_Visibility;
	Settings.OcclusionVolumeAttenuation = WallGain;
	Settings.OcclusionLowPassFilterFrequency = WallCutoff;
	Settings.OcclusionInterpolationTime = Glide;
	return Attenuation;
}
