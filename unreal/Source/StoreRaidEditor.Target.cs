using UnrealBuildTool;

public class StoreRaidEditorTarget : TargetRules
{
	public StoreRaidEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("StoreRaid");
	}
}
