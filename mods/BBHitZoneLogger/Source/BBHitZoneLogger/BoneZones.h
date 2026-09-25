#pragma once
#include "CoreMinimal.h"

/** Map skeletal bone name → Head | Torso | Limb */
inline FString BBMapBoneToZone(const FString& BoneName)
{
	const FString B = BoneName.ToLower();
	if (B.Contains(TEXT("head")) || B.Contains(TEXT("neck")) || B.Contains(TEXT("helmet")))
	{
		return TEXT("Head");
	}
	if (B.Contains(TEXT("spine")) || B.Contains(TEXT("pelvis")) || B.Contains(TEXT("clavicle")) ||
		B.Contains(TEXT("chest")) || B.Contains(TEXT("hip")) || B.Contains(TEXT("abdomen")) ||
		B.Contains(TEXT("thorax")) || B.Contains(TEXT("ribcage")))
	{
		return TEXT("Torso");
	}
	return TEXT("Limb");
}
