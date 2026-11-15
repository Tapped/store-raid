using UnrealBuildTool;

public class StoreRaid : ModuleRules
{
	public StoreRaid(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new[] {
			"Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput", "NetCore",
		});
		// The dev command server (console commands and screenshots over HTTP), which only starts
		// with -DevPort and never in shipping builds.
		PrivateDependencyModuleNames.AddRange(new[] { "HTTPServer" });
	}
}
