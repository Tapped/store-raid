// What the level data needs from shared/constants.ts: for now only the kinds of item, for
// FItemSpawn. ITEM_KINDS (sizes, hands, carriers, value) and the movement numbers come over with
// hands and items (PORT.md step 2) and with the movement component (step 1).

/** What can be carried: `ItemKind`, the keys of ITEM_KINDS in shared/constants.ts. */
enum EItemKind
{
	Phone,
	Flashlight,
	Tv,
	Box,
	Sofa,
};
