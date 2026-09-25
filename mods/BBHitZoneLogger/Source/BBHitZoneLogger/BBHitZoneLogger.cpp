// Copyright BlackBerry Squad. Reference ModLoader / UE5 plugin source.
#include "BBHitZoneLogger.h"
#include "BoneZones.h"
#include "Misc/CoreDelegates.h"

#define LOCTEXT_NAMESPACE "FBBHitZoneLoggerModule"

/**
 * On live Squad servers, hook the soldier damage path (TakeDamage / wound)
 * and call LogHit(...). Exact bind depends on ModLoader / Squad SDK version —
 * replace RegisterHooks() body with the project’s damage delegate.
 *
 * Contract log line (must stay stable for squad_log_collector.py):
 *   BBHitZone: AttackerEOS=… AttackerSteam=… VictimEOS=… Zone=Head|Torso|Limb Damage=… Bone=… Weapon=… Server=TR1
 */
namespace BBHitZone
{
	inline void LogHit(
		const FString& AttackerEOS,
		const FString& AttackerSteam,
		const FString& VictimEOS,
		const FString& BoneName,
		float Damage,
		const FString& Weapon,
		const FString& ServerKey = TEXT("TR1"))
	{
		const FString Zone = BBMapBoneToZone(BoneName);
		const FString Steam = AttackerSteam.IsEmpty() ? TEXT("none") : AttackerSteam;
		const FString Victim = VictimEOS.IsEmpty() ? TEXT("none") : VictimEOS;
		UE_LOG(
			LogTemp,
			Log,
			TEXT("BBHitZone: AttackerEOS=%s AttackerSteam=%s VictimEOS=%s Zone=%s Damage=%.3f Bone=%s Weapon=%s Server=%s"),
			*AttackerEOS,
			*Steam,
			*Victim,
			*Zone,
			Damage,
			*BoneName,
			*Weapon,
			*ServerKey);
	}

	inline void RegisterHooks()
	{
		// TODO(ModSDK): bind to ASQSoldier damage / HitResult.BoneName callback.
		// Pseudo:
		// OnPlayerDamaged.AddLambda([](const FHitResult& Hit, AController* Instigator, float Dmg, ...) {
		//   LogHit(InstigatorEOS, InstigatorSteam, VictimEOS, Hit.BoneName.ToString(), Dmg, WeaponClass);
		// });
		UE_LOG(LogTemp, Warning, TEXT("BBHitZoneLogger: RegisterHooks() — bind damage delegate in ModSDK build"));
	}
}

void FBBHitZoneLoggerModule::StartupModule()
{
	BBHitZone::RegisterHooks();
}

void FBBHitZoneLoggerModule::ShutdownModule() {}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FBBHitZoneLoggerModule, BBHitZoneLogger)
