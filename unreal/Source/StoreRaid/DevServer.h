#pragma once

#include "CoreMinimal.h"
#include "Subsystems/EngineSubsystem.h"
#include "HttpResultCallback.h"
#include "HttpRouteHandle.h"
#include "DevServer.generated.h"

/**
 * The dev command server: lets the terminal drive a running game or server over HTTP, as the
 * Chrome tools drove the web game. Started only with -DevPort=<port>, and never in shipping builds.
 *
 *   POST /exec     body: a console command; runs it in the game world, replies with what it printed
 *   GET  /shot     replies with a PNG of the next frame (?w=&h= to set the resolution first)
 *   GET  /ping     replies "ok" with the net mode, once the engine is up
 */
UCLASS()
class UDevServer : public UEngineSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

private:
	bool HandleExec(const struct FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandleShot(const struct FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);
	bool HandlePing(const struct FHttpServerRequest& Request, const FHttpResultCallback& OnComplete);

	UWorld* GameWorld() const;

	TArray<FHttpRouteHandle> Routes;
	TSharedPtr<class IHttpRouter> Router;
	TArray<FHttpResultCallback> PendingShots;
	FDelegateHandle ScreenshotHandle;
};
