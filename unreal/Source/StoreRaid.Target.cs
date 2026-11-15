using UnrealBuildTool;

public class StoreRaidTarget : TargetRules
{
	public StoreRaidTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("StoreRaid");
	}
}
