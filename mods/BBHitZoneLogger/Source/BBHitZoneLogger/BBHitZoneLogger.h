// Copyright BlackBerry Squad. Reference ModLoader / UE5 plugin source.
// Build with Squad Mod SDK — see ../README.md
#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

class FBBHitZoneLoggerModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;
};
