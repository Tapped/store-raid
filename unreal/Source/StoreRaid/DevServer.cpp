#include "DevServer.h"
#include "StoreRaid.h"

#if !UE_BUILD_SHIPPING
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "HttpServerModule.h"
#include "HttpServerRequest.h"
#include "HttpServerResponse.h"
#include "IHttpRouter.h"
#include "ImageUtils.h"
#include "Misc/StringOutputDevice.h"
#include "UnrealClient.h"
#endif

void UDevServer::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
#if !UE_BUILD_SHIPPING
	int32 Port = 0;
	if (!FParse::Value(FCommandLine::Get(), TEXT("DevPort="), Port) || Port <= 0)
	{
		return;
	}
	Router = FHttpServerModule::Get().GetHttpRouter(Port, /*bFailOnBindFailure*/ true);
	if (!Router)
	{
		UE_LOG(LogStoreRaid, Error, TEXT("Dev server: port %d is taken"), Port);
		return;
	}
	Routes.Add(Router->BindRoute(FHttpPath(TEXT("/exec")), EHttpServerRequestVerbs::VERB_POST,
		FHttpRequestHandler::CreateUObject(this, &UDevServer::HandleExec)));
	Routes.Add(Router->BindRoute(FHttpPath(TEXT("/shot")), EHttpServerRequestVerbs::VERB_GET,
		FHttpRequestHandler::CreateUObject(this, &UDevServer::HandleShot)));
	Routes.Add(Router->BindRoute(FHttpPath(TEXT("/ping")), EHttpServerRequestVerbs::VERB_GET,
		FHttpRequestHandler::CreateUObject(this, &UDevServer::HandlePing)));
	FHttpServerModule::Get().StartAllListeners();

	// Screenshots come back as pixels instead of files while anyone waits for one.
	ScreenshotHandle = UGameViewportClient::OnScreenshotCaptured().AddLambda(
		[this](int32 Width, int32 Height, const TArray<FColor>& Colors)
		{
			if (PendingShots.IsEmpty())
			{
				return;
			}
			TArray<FColor> Opaque = Colors;
			for (FColor& Color : Opaque)
			{
				Color.A = 255;
			}
			TArray64<uint8> Png;
			FImageUtils::PNGCompressImageArray(Width, Height, TArrayView64<const FColor>(Opaque.GetData(), Opaque.Num()), Png);
			TArray<FHttpResultCallback> Waiting = MoveTemp(PendingShots);
			for (const FHttpResultCallback& OnComplete : Waiting)
			{
				TArray<uint8> Bytes(Png.GetData(), static_cast<int32>(Png.Num()));
				OnComplete(FHttpServerResponse::Create(MoveTemp(Bytes), TEXT("image/png")));
			}
		});
	UE_LOG(LogStoreRaid, Display, TEXT("Dev server listening on http://127.0.0.1:%d"), Port);
#endif
}

void UDevServer::Deinitialize()
{
#if !UE_BUILD_SHIPPING
	if (Router)
	{
		for (const FHttpRouteHandle& Route : Routes)
		{
			Router->UnbindRoute(Route);
		}
	}
	Routes.Empty();
	Router.Reset();
	UGameViewportClient::OnScreenshotCaptured().Remove(ScreenshotHandle);
#endif
	Super::Deinitialize();
}

#if !UE_BUILD_SHIPPING

UWorld* UDevServer::GameWorld() const
{
	if (!GEngine)
	{
		return nullptr;
	}
	for (const FWorldContext& Context : GEngine->GetWorldContexts())
	{
		if (Context.World() && (Context.WorldType == EWorldType::Game || Context.WorldType == EWorldType::PIE))
		{
			return Context.World();
		}
	}
	return nullptr;
}

bool UDevServer::HandleExec(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	const FUTF8ToTCHAR Converted(reinterpret_cast<const ANSICHAR*>(Request.Body.GetData()), Request.Body.Num());
	const FString Command = FString(Converted.Length(), Converted.Get()).TrimStartAndEnd();
	FStringOutputDevice Output;
	Output.SetAutoEmitLineTerminator(true);
	const bool bHandled = GEngine && GEngine->Exec(GameWorld(), *Command, Output);
	UE_LOG(LogStoreRaid, Display, TEXT("Dev server: %s%s"), *Command, bHandled ? TEXT("") : TEXT(" (not handled)"));
	TUniquePtr<FHttpServerResponse> Response = FHttpServerResponse::Create(static_cast<const FString&>(Output), TEXT("text/plain"));
	if (!bHandled)
	{
		Response->Code = EHttpServerResponseCodes::NotFound;
	}
	OnComplete(MoveTemp(Response));
	return true;
}

bool UDevServer::HandleShot(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	if (!GEngine || !GEngine->GameViewport)
	{
		OnComplete(FHttpServerResponse::Create(TEXT("no viewport: a server or -nullrhi has nothing to show"), TEXT("text/plain")));
		return true;
	}
	const FString* Width = Request.QueryParams.Find(TEXT("w"));
	const FString* Height = Request.QueryParams.Find(TEXT("h"));
	if (Width && Height)
	{
		GEngine->Exec(GameWorld(), *FString::Printf(TEXT("r.SetRes %sx%sw"), **Width, **Height));
	}
	PendingShots.Add(OnComplete);
	FScreenshotRequest::RequestScreenshot(/*bShowUI*/ true, /*bAddFilenameSuffix*/ false);
	return true;
}

bool UDevServer::HandlePing(const FHttpServerRequest& Request, const FHttpResultCallback& OnComplete)
{
	const UWorld* World = GameWorld();
	FString Mode = TEXT("none");
	if (World)
	{
		switch (World->GetNetMode())
		{
		case NM_Standalone: Mode = TEXT("standalone"); break;
		case NM_DedicatedServer: Mode = TEXT("server"); break;
		case NM_ListenServer: Mode = TEXT("listen"); break;
		case NM_Client: Mode = TEXT("client"); break;
		default: break;
		}
	}
	OnComplete(FHttpServerResponse::Create(FString::Printf(TEXT("ok %s %s"), *Mode, World ? *World->GetMapName() : TEXT("-")), TEXT("text/plain")));
	return true;
}

#else

bool UDevServer::HandleExec(const FHttpServerRequest&, const FHttpResultCallback&) { return false; }
bool UDevServer::HandleShot(const FHttpServerRequest&, const FHttpResultCallback&) { return false; }
bool UDevServer::HandlePing(const FHttpServerRequest&, const FHttpResultCallback&) { return false; }
UWorld* UDevServer::GameWorld() const { return nullptr; }

#endif
