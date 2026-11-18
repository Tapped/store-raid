// The round's overlay and results on this screen, as client/src/round.ts and results.ts had them:
// UMG widgets built in script, with no widget assets. The overlay is a few lines at the top in a game:
// where the round is, the loot against the quota, and what we can do about it. The results cover the
// picture while a game's results phase lasts: whether the quota was met, what the truck holds, and
// what became of the crew. Nothing in the playground, which has no rounds.

namespace Overlay
{
	/** What happened to us, while we watch. */
	FString Out(ERole Role)
	{
		switch (Role)
		{
			case ERole::Dead:
				return "You died";
			case ERole::Lost:
				return "Left behind at dawn";
			case ERole::Waiting:
				return "Waiting for the next round";
			default:
				break;
		}
		return "";
	}

	/** What became of each of the crew. */
	FString Fate(ERole Role)
	{
		switch (Role)
		{
			case ERole::Playing:
				return "Made it";
			case ERole::Dead:
				return "Dead";
			case ERole::Lost:
				return "Left behind";
			case ERole::Waiting:
				return "Sat it out";
		}
		return "";
	}

	/** A kind's name, for a count of them: "Phone", "3 Phones", "2 TVs", "2 Boxes". */
	FString Named(EItemKind Kind, int Count)
	{
		FString One = Items::KindName(Kind);
		One = One.Left(1).ToUpper() + One.RightChop(1);
		if (Kind == EItemKind::Tv)
			One = "TV";
		if (Count == 1)
			return One;
		const FString Many = One.EndsWith("x") ? One + "es" : One + "s";
		return f"{Count} {Many}";
	}

	/**
	 * The lines of the round overlay at the top of the screen, for a game: where the round is, the loot
	 * against the quota, and what we can do about it. None in the playground, nor while the results
	 * show. Watched is the name of whoever we watch, if we're out of the building.
	 */
	TArray<FString> RoundLines(AStoreRaidGameState Room, AStoreRaidPlayerState Self, bool bSelfInTruck, FString Watched)
	{
		TArray<FString> Lines;
		if (Room == nullptr || Self == nullptr || Room.Mode != EMode::Game)
			return Lines;
		int CrewCount = 0;
		int ReadyCount = 0;
		for (AStoreRaidPlayerState Member : Room.Players())
		{
			if (!Member.IsPlaying())
				continue;
			CrewCount++;
			if (Member.bReady)
				ReadyCount++;
		}
		const FString Loot = f"Loot {Modes::Money(Room.Loot)} of {Modes::Money(Room.Quota)}";

		if (Room.Phase == EPhase::Lobby)
		{
			if (Room.TimeLeft > 0)
				Lines.Add(f"The raid starts in {Math::CeilToInt(Room.TimeLeft)}");
			else
				Lines.Add(f"In the truck · quota {Modes::Money(Room.Quota)} · {ReadyCount} of {CrewCount} ready");
			if (Self.IsPlaying())
				Lines.Add(Self.bReady ? "Ready · R / X to wait" : "R / X when you're ready");
		}
		else if (Room.Phase == EPhase::Raid)
		{
			Lines.Add(f"Dawn in {Modes::Clock(Room.TimeLeft)} · {Loot}");
			if (Self.IsPlaying() && bSelfInTruck)
				Lines.Add(Self.bReady ? f"Leaving · {ReadyCount} of {CrewCount} want to go · R / X to stay" : "In the truck · R / X to leave");
		}
		else
		{
			// The results have a screen of their own.
			return Lines;
		}

		if (!Self.IsPlaying())
		{
			const FString What = Out(Self.Role);
			Lines.Add(Watched.IsEmpty() ? What : f"{What} · watching {Watched} · E / Q: next / previous");
		}
		return Lines;
	}

	/** What the truck holds, as (kind, count) by what they sell for together, dearest first. */
	void Haul(AStoreRaidGameState Room, TArray<EItemKind>& OutKinds, TArray<int>& OutCounts)
	{
		OutKinds.Empty();
		OutCounts.Empty();
		TArray<AStoreRaidItem> All;
		GetAllActorsOfClass(All);
		for (AStoreRaidItem Item : All)
		{
			if (Item.Info().Value <= 0 || !Room.InTruck(Item.GamePosition()))
				continue;
			const int At = OutKinds.FindIndex(Item.Kind);
			if (At >= 0)
				OutCounts[At] = OutCounts[At] + 1;
			else
			{
				OutKinds.Add(Item.Kind);
				OutCounts.Add(1);
			}
		}
		// Dearest first: a few of them, so a plain sort by swapping will do.
		for (int I = 0; I < OutKinds.Num(); I++)
		{
			for (int J = I + 1; J < OutKinds.Num(); J++)
			{
				const int A = Items::Kind(OutKinds[I]).Value * OutCounts[I];
				const int B = Items::Kind(OutKinds[J]).Value * OutCounts[J];
				if (B > A)
				{
					OutKinds.Swap(I, J);
					OutCounts.Swap(I, J);
				}
			}
		}
	}

	/** The results as lines of text, for sr.overlay to print: what the screen shows. */
	TArray<FString> ResultLines(AStoreRaidGameState Room)
	{
		TArray<FString> Lines;
		if (Room == nullptr || Room.Mode != EMode::Game || Room.Phase != EPhase::Results)
			return Lines;
		Lines.Add(Room.bCleared ? "CLEARED" : "FAILED");
		Lines.Add(Summary(Room));
		TArray<EItemKind> Kinds;
		TArray<int> Counts;
		Haul(Room, Kinds, Counts);
		for (int Index = 0; Index < Kinds.Num(); Index++)
			Lines.Add(f"{Named(Kinds[Index], Counts[Index])}: {Modes::Money(Items::Kind(Kinds[Index]).Value * Counts[Index])}");
		for (AStoreRaidPlayerState Member : Room.Players())
			Lines.Add(f"{Member.PlayerName}: {Fate(Member.Role)}");
		Lines.Add(f"Next round in {Math::CeilToInt(Room.TimeLeft)}");
		return Lines;
	}

	FString Summary(AStoreRaidGameState Room)
	{
		const int Short = Room.Quota - Room.Loot;
		if (Room.bCleared)
			return f"The truck left with {Modes::Money(Room.Loot)}, {Modes::Money(-Short)} over the quota.";
		return f"The truck left with {Modes::Money(Room.Loot)}, {Modes::Money(Short)} short of the quota.";
	}
}

/** The colours of the results: gold for cleared, red for failed, and the sheet's greys. */
namespace OverlayStyle
{
	const FLinearColor CLEARED = FLinearColor(0.69, 0.37, 0.05);
	const FLinearColor FAILED = FLinearColor(0.47, 0.07, 0.05);
	const FLinearColor TEXT = FLinearColor(0.82, 0.79, 0.74);
	const FLinearColor DIM = FLinearColor(0.49, 0.45, 0.40);
	const FLinearColor MUTED = FLinearColor(0.23, 0.22, 0.19);
	const FLinearColor SHEET = FLinearColor(0.005, 0.006, 0.008, 0.92);
	const FLinearColor TRACK = FLinearColor(0.023, 0.026, 0.033);
}

/** The overlay and the results screen, over this screen's picture. The player controller updates it every frame. */
class UStoreRaidOverlay : UUserWidget
{
	UCanvasPanel Canvas;
	UTextBlock Lines;
	/** What to do now, below the middle: how to get a tick off. Empty hides it. */
	UBorder Prompt;
	UTextBlock PromptText;
	/** The results: a dimmed screen with a sheet in the middle, rebuilt only when what it says changes. */
	UBorder Results;
	FString ResultsShown;

	/** Builds the widgets: call once, before it's added to the viewport. */
	void Build()
	{
		Canvas = Cast<UCanvasPanel>(ConstructWidget(UCanvasPanel));
		SetRootWidget(Canvas);

		Lines = Text("", 20, OverlayStyle::TEXT);
		Lines.SetJustification(ETextJustify::Center);
		UCanvasPanelSlot LinesAt = Canvas.AddChildToCanvas(Lines);
		LinesAt.SetAnchors(Anchors(0.5, 0, 0.5, 0));
		LinesAt.SetAlignment(FVector2D(0.5, 0));
		LinesAt.SetPosition(FVector2D(0, 24));
		LinesAt.SetAutoSize(true);

		PromptText = Text("", 16, OverlayStyle::TEXT);
		Prompt = Cast<UBorder>(ConstructWidget(UBorder));
		Prompt.SetBrushColor(FLinearColor(0.05, 0, 0, 0.6));
		Prompt.SetPadding(FMargin(12, 6, 12, 6));
		Prompt.SetContent(PromptText);
		UCanvasPanelSlot PromptAt = Canvas.AddChildToCanvas(Prompt);
		PromptAt.SetAnchors(Anchors(0.5, 0.62, 0.5, 0.62));
		PromptAt.SetAlignment(FVector2D(0.5, 0));
		PromptAt.SetAutoSize(true);
		Prompt.SetVisibility(ESlateVisibility::Collapsed);

		Results = Cast<UBorder>(ConstructWidget(UBorder));
		Results.SetBrushColor(FLinearColor(0, 0, 0, 0.55));
		Results.SetHorizontalAlignment(EHorizontalAlignment::HAlign_Center);
		Results.SetVerticalAlignment(EVerticalAlignment::VAlign_Center);
		UCanvasPanelSlot ResultsAt = Canvas.AddChildToCanvas(Results);
		ResultsAt.SetAnchors(Anchors(0, 0, 1, 1));
		ResultsAt.SetOffsets(FMargin(0, 0, 0, 0));
		Results.SetVisibility(ESlateVisibility::Collapsed);
	}

	FAnchors Anchors(float MinX, float MinY, float MaxX, float MaxY)
	{
		FAnchors Result;
		Result.Minimum = FVector2D(MinX, MinY);
		Result.Maximum = FVector2D(MaxX, MaxY);
		return Result;
	}

	UTextBlock Text(FString Words, int Size, FLinearColor Colour)
	{
		UTextBlock Block = Cast<UTextBlock>(ConstructWidget(UTextBlock));
		Block.SetText(FText::FromString(Words));
		FSlateFontInfo Font = Block.Font;
		Font.Size = Size;
		Block.SetFont(Font);
		Block.SetColorAndOpacity(FSlateColor(Colour));
		Block.SetShadowOffset(FVector2D(1, 1));
		Block.SetShadowColorAndOpacity(FLinearColor(0, 0, 0, 0.8));
		return Block;
	}

	/** Shows what to do now, or nothing for an empty prompt. */
	void SetPrompt(FString Words)
	{
		Prompt.SetVisibility(Words.IsEmpty() ? ESlateVisibility::Collapsed : ESlateVisibility::HitTestInvisible);
		PromptText.SetText(FText::FromString(Words));
	}

	/** Shows where the round is: call every frame. */
	void Update(TArray<FString> RoundLines, AStoreRaidGameState Room)
	{
		FString Joined = "";
		for (const FString& Line : RoundLines)
			Joined += (Joined.IsEmpty() ? "" : "\n") + Line;
		Lines.SetText(FText::FromString(Joined));

		const TArray<FString> Shown = Overlay::ResultLines(Room);
		if (Shown.Num() == 0)
		{
			Results.SetVisibility(ESlateVisibility::Collapsed);
			ResultsShown = "";
			return;
		}
		FString Key = "";
		for (const FString& Line : Shown)
			Key += Line + "\n";
		if (Key == ResultsShown)
			return;
		ResultsShown = Key;
		Results.SetVisibility(ESlateVisibility::HitTestInvisible);
		Results.SetContent(Sheet(Room));
	}

	/** The results' sheet: the verdict, the haul against the quota, what's in the truck, and the crew. */
	UWidget Sheet(AStoreRaidGameState Room)
	{
		const FLinearColor Mark = Room.bCleared ? OverlayStyle::CLEARED : OverlayStyle::FAILED;
		USizeBox Size = Cast<USizeBox>(ConstructWidget(USizeBox));
		Size.SetWidthOverride(460);
		UBorder Paper = Cast<UBorder>(ConstructWidget(UBorder));
		Paper.SetBrushColor(OverlayStyle::SHEET);
		Paper.SetPadding(FMargin(30, 24, 30, 22));
		Size.SetContent(Paper);
		UVerticalBox Column = Cast<UVerticalBox>(ConstructWidget(UVerticalBox));
		Paper.SetContent(Column);

		Add(Column, Text(Room.bCleared ? "CLEARED" : "FAILED", 34, Mark), 0);
		Add(Column, Text(Overlay::Summary(Room), 14, OverlayStyle::TEXT), 6);

		// The loot against the quota: the bar runs to whichever is greater.
		const float Full = Math::Max(Math::Max(Room.Quota, Room.Loot), 1);
		UProgressBar Bar = Cast<UProgressBar>(ConstructWidget(UProgressBar));
		Bar.SetPercent(Room.Loot / Full);
		Bar.SetFillColorAndOpacity(Mark);
		// The track the loot fills, dark as in results.ts: the engine's own is light grey.
		FProgressBarStyle BarStyle = Bar.WidgetStyle;
		BarStyle.BackgroundImage.TintColor = FSlateColor(OverlayStyle::TRACK);
		Bar.SetWidgetStyle(BarStyle);
		Add(Column, Bar, 14);
		Add(Column, Row("LOOT", f"QUOTA {Modes::Money(Room.Quota)}", OverlayStyle::DIM, 11), 4);

		Add(Column, Text("IN THE TRUCK", 11, OverlayStyle::DIM), 18);
		TArray<EItemKind> Kinds;
		TArray<int> Counts;
		Overlay::Haul(Room, Kinds, Counts);
		if (Kinds.Num() == 0)
			Add(Column, Text("Nothing.", 14, OverlayStyle::DIM), 4);
		for (int Index = 0; Index < Kinds.Num(); Index++)
			Add(Column, Row(Overlay::Named(Kinds[Index], Counts[Index]), Modes::Money(Items::Kind(Kinds[Index]).Value * Counts[Index]), OverlayStyle::TEXT, 14), 3);

		Add(Column, Text("THE CREW", 11, OverlayStyle::DIM), 18);
		for (AStoreRaidPlayerState Member : Room.Players())
		{
			const bool bOut = Member.Role == ERole::Dead || Member.Role == ERole::Lost;
			UHorizontalBox Line = Row(Member.PlayerName, Overlay::Fate(Member.Role), bOut ? OverlayStyle::DIM : OverlayStyle::TEXT, 14);
			Add(Column, Line, 3);
		}
		UTextBlock Next = Text(f"Next round in {Math::CeilToInt(Room.TimeLeft)}", 13, OverlayStyle::DIM);
		Next.SetJustification(ETextJustify::Right);
		Add(Column, Next, 18);
		return Size;
	}

	/** A line with words on the left and on the right. */
	UHorizontalBox Row(FString Left, FString Right, FLinearColor Colour, int Size)
	{
		UHorizontalBox Line = Cast<UHorizontalBox>(ConstructWidget(UHorizontalBox));
		UHorizontalBoxSlot LeftAt = Line.AddChildToHorizontalBox(Text(Left, Size, Colour));
		FSlateChildSize Fill;
		Fill.SizeRule = ESlateSizeRule::Fill;
		LeftAt.SetSize(Fill);
		Line.AddChildToHorizontalBox(Text(Right, Size, Colour));
		return Line;
	}

	void Add(UVerticalBox Column, UWidget Child, float Above)
	{
		UVerticalBoxSlot Placed = Column.AddChildToVerticalBox(Child);
		Placed.SetPadding(FMargin(0, Above, 0, 0));
	}
}
