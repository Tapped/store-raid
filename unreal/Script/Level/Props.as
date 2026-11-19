// Every model a level can stand somewhere as scenery, and how big each is: mirrors shared/props.ts,
// so the generator can place them, and block what they block, without loading a model. The models
// are built by scripts/models/<name>.py into assets/models/props/<name>.glb at these sizes, and
// imported to /Game/Models/props/<name>/ (`Models::Mesh("props/" + Props::Name(Prop))`).
//
// `Size` is width, height and depth in meters, as seen from the front: width across, depth front
// to back. Where a model's origin is depends on its mount:
//
// - Floor: on the floor, in the middle of its footprint.
// - Wall: on the wall's face, at the bottom of the model, in the middle of its width. Its back is
//   flat against the wall and its front faces into the room.
// - Ceiling: on the ceiling, at the top of the model, in the middle of it.
//
// Solid props stop players, as a box of their footprint and height. Parts of a model that glow have
// a material whose name starts with `glow`.
//
// The TS keys props by their file names; here they're EProp, and Props::Name gives the file name.
// The props after StepLift are the port's own, with no TS.

enum EPropMount
{
	Floor,
	Wall,
	Ceiling,
};

struct FPropKind
{
	/** Width, height and depth: `size` in the TS. */
	float Width = 0.0;
	float Height = 0.0;
	float Depth = 0.0;
	EPropMount Mount = EPropMount::Floor;
	bool bSolid = false;
};

/** A prop's model: the keys of PROPS in the TS, in its order. */
enum EProp
{
	// Fittings: what a building has before anyone moves in.
	/** A fluorescent batten with one tube. Its tube glows. */
	CeilingTube,
	/** A bulkhead light in a cage. Its lens glows. */
	EmergencyLight,
	/** A green running-man sign, lit from inside. Its face glows. */
	ExitSign,
	/** A steel frame for a doorway 1.4 m wide and 2.2 m high in a wall 0.2 m thick, which it wraps. Origin on the floor in the middle of the opening. */
	DoorFrame,
	/** A length of rectangular ventilation duct on hangers, one cell long, with flanged joints. */
	Duct,
	/** A square air diffuser. */
	DuctVent,
	/** Three pipes of different sizes on brackets, one cell long: one lagged, one painted red. */
	PipeRun,
	/** A wire cable tray with bundled cables, one cell long. */
	CableTray,
	/** A grey steel electrical cabinet with warning labels. */
	ElectricalCabinet,
	/** A red extinguisher on its bracket, with a sign above. */
	FireExtinguisher,
	/** A dome or bullet security camera. */
	CctvCamera,
	/** A louvred grille. */
	WallVent,
	/** A high-bay lamp for halls: a metal dome on a short chain. Its lens glows. */
	HighBay,

	// Cargo: what a harbour warehouse stores.
	/** A 20 ft shipping container, doors shut: three paint colours and states of wear. They stand in rows and against walls. */
	ContainerA,
	ContainerB,
	ContainerC,
	/** A wooden shipping crate with stencilled marks and steel corner straps. */
	CrateLarge,
	/** A long crate, for pipes or machine parts. */
	CrateLong,
	/** Crates of several sizes stacked, one askew. */
	CrateStack,
	/** Four steel drums on a pallet, strapped, with hazard labels. */
	DrumGroup,
	/** A wooden cable reel standing on its rim, half wound with black cable. */
	CableReel,
	/** A white woven bulk bag, full, on a pallet. */
	BigBag,
	/** A panel of chain-link partition between two posts: bonded stores are caged in with these, end to end. */
	CagePanel,
	/** A forklift, parked, forks down. The front is the forks. */
	Forklift,
	/** Machinery on a skid under a tied-down tarpaulin. */
	WrappedMachine,
	/** Truck tyres in a stack. */
	TyreStack,
	/** A coil of thick mooring rope with a fender buoy on it. */
	RopeCoil,
	/** Gas cylinders chained in a steel cage. */
	GasCage,
	/** A platform scale with its read-out on a column. */
	WeighScale,
	/** A sign hanging on two wires, with a bay number on it. */
	BaySign,
	/** Clear PVC strips hanging in a doorway 1.4 m wide and 2.2 m high. Origin on the floor in the middle of the opening. */
	StripCurtain,

	// Back of house.
	/** Heavy pallet racking, one bay, loaded with boxes and wrapped pallets: two loads. */
	PalletRackA,
	PalletRackB,
	/** A pallet of boxes in stretch wrap: two stacks. */
	PalletStackA,
	PalletStackB,
	/** An office desk with a monitor, keyboard and clutter. The height is the desk's with the monitor on it. */
	Desk,
	OfficeChair,
	FilingCabinet,
	/** Three steel lockers in a row, one door ajar. */
	LockerRow,
	/** A snack machine. Its window and panel glow. */
	VendingMachine,
	WaterCooler,
	/** A canteen table with two cups on it. */
	StaffTable,
	/** A boiler with pipes, a gauge and a small pilot window that glows. */
	Boiler,
	/** A row of switchgear cabinets with breakers and indicator lamps that glow. */
	Switchgear,
	HandTruck,
	TrashBin,
	/** Tall steel shelving for along a wall, with parts bins, boxes and tins: two ways of stocking it. */
	WallShelfA,
	WallShelfB,
	/** A workbench with a vice, tools on a back board and clutter. */
	Workbench,
	/** A red tool cabinet on castors, a drawer open. */
	ToolCabinet,

	// Imported from a Unity pack (scripts/unity-import), not built by a script: these sizes are
	// measured from the models, whose origins are near enough on the floor in the middle.
	/** A steel oil drum. */
	Barrel,
	/** A blue plastic drum. */
	PlasticBarrel,
	/** A jerrycan. */
	PlasticCanister,
	/** A big wooden crate with slats. */
	WoodCrate,
	/** A wooden box, longer than it's wide. */
	WoodBox,
	/** A cardboard box, taped shut. */
	Cardboard,
	/** A tall gas cylinder, standing. */
	GasCylinder,
	/** An intermediate bulk container: a plastic tank in a steel cage on a pallet. */
	IbcTank,
	TrafficCone,
	/** An empty wooden pallet, low enough to step onto. */
	Pallet,
	/** A sack of cement, low enough to step over. */
	CementBag,
	/** A wheeled step ladder with a platform. */
	StepLift,
	/** A plastic road barrier, water-filled, red and white: its length runs front to back. */
	PlasticFence,

	// Warehouse 7: the reefer section and quarantine.
	/** A 20 ft refrigerated container, its blind end the refrigeration unit, whose display glows. The doors are the front. */
	ReeferContainer,
	/**
	 * Container HB-0417, breached: doors swung wide, split crates inside, a hole torn low in its
	 * left side (seen from the doors). The open doors are the front; it's deeper than a shut one.
	 */
	ContainerBreached,
	/** Polythene sheeting taped over a doorway 1.4 m wide and 2.2 m high, slit to get through, a notice on its front. Origin on the floor in the middle of the opening. */
	QuarantineSheet,
	/** A site floodlight on a tripod, two heads facing the front, switched off. Origin under the mast. */
	WorkLight,

};

namespace Props
{
	FPropKind Make(float Width, float Height, float Depth, EPropMount Mount, bool bSolid)
	{
		FPropKind Kind;
		Kind.Width = Width;
		Kind.Height = Height;
		Kind.Depth = Depth;
		Kind.Mount = Mount;
		Kind.bSolid = bSolid;
		return Kind;
	}

	/** How big a prop is and how it's mounted: `PROPS[model]`. */
	FPropKind Kind(EProp Prop)
	{
		switch (Prop)
		{
			case EProp::CeilingTube: return Make(1.25, 0.09, 0.14, EPropMount::Ceiling, false);
			case EProp::EmergencyLight: return Make(0.35, 0.14, 0.1, EPropMount::Wall, false);
			case EProp::ExitSign: return Make(0.4, 0.2, 0.06, EPropMount::Wall, false);
			case EProp::DoorFrame: return Make(1.6, 2.3, 0.26, EPropMount::Floor, false);
			case EProp::Duct: return Make(4.0, 0.5, 0.6, EPropMount::Ceiling, false);
			case EProp::DuctVent: return Make(0.6, 0.1, 0.6, EPropMount::Ceiling, false);
			case EProp::PipeRun: return Make(4.0, 0.25, 0.35, EPropMount::Ceiling, false);
			case EProp::CableTray: return Make(4.0, 0.1, 0.3, EPropMount::Ceiling, false);
			case EProp::ElectricalCabinet: return Make(0.8, 1.9, 0.4, EPropMount::Floor, true);
			case EProp::FireExtinguisher: return Make(0.3, 0.75, 0.22, EPropMount::Wall, false);
			case EProp::CctvCamera: return Make(0.15, 0.2, 0.3, EPropMount::Ceiling, false);
			case EProp::WallVent: return Make(0.6, 0.4, 0.05, EPropMount::Wall, false);
			case EProp::HighBay: return Make(0.45, 0.4, 0.45, EPropMount::Ceiling, false);
			case EProp::ContainerA: return Make(2.44, 2.59, 6.06, EPropMount::Floor, true);
			case EProp::ContainerB: return Make(2.44, 2.59, 6.06, EPropMount::Floor, true);
			case EProp::ContainerC: return Make(2.44, 2.59, 6.06, EPropMount::Floor, true);
			case EProp::CrateLarge: return Make(1.2, 1.2, 1.2, EPropMount::Floor, true);
			case EProp::CrateLong: return Make(2.4, 0.8, 0.8, EPropMount::Floor, true);
			case EProp::CrateStack: return Make(1.6, 2.0, 1.2, EPropMount::Floor, true);
			case EProp::DrumGroup: return Make(1.2, 1.05, 1.2, EPropMount::Floor, true);
			case EProp::CableReel: return Make(0.8, 1.4, 1.4, EPropMount::Floor, true);
			case EProp::BigBag: return Make(0.95, 1.2, 0.95, EPropMount::Floor, true);
			case EProp::CagePanel: return Make(2.0, 2.4, 0.06, EPropMount::Floor, true);
			case EProp::Forklift: return Make(1.2, 2.15, 3.2, EPropMount::Floor, true);
			case EProp::WrappedMachine: return Make(1.8, 1.5, 1.2, EPropMount::Floor, true);
			case EProp::TyreStack: return Make(0.9, 1.2, 0.9, EPropMount::Floor, true);
			case EProp::RopeCoil: return Make(1.0, 0.5, 1.0, EPropMount::Floor, true);
			case EProp::GasCage: return Make(1.2, 1.9, 0.8, EPropMount::Floor, true);
			case EProp::WeighScale: return Make(1.2, 1.2, 1.5, EPropMount::Floor, true);
			case EProp::BaySign: return Make(1.2, 0.5, 0.05, EPropMount::Ceiling, false);
			case EProp::StripCurtain: return Make(1.4, 2.2, 0.05, EPropMount::Floor, false);
			case EProp::PalletRackA: return Make(2.7, 2.6, 1.1, EPropMount::Floor, true);
			case EProp::PalletRackB: return Make(2.7, 2.6, 1.1, EPropMount::Floor, true);
			case EProp::PalletStackA: return Make(1.2, 1.4, 1.0, EPropMount::Floor, true);
			case EProp::PalletStackB: return Make(1.2, 1.0, 1.0, EPropMount::Floor, true);
			case EProp::Desk: return Make(1.6, 1.2, 0.8, EPropMount::Floor, true);
			case EProp::OfficeChair: return Make(0.6, 1.0, 0.6, EPropMount::Floor, false);
			case EProp::FilingCabinet: return Make(0.47, 1.32, 0.62, EPropMount::Floor, true);
			case EProp::LockerRow: return Make(1.2, 1.9, 0.5, EPropMount::Floor, true);
			case EProp::VendingMachine: return Make(0.95, 1.85, 0.85, EPropMount::Floor, true);
			case EProp::WaterCooler: return Make(0.35, 1.1, 0.35, EPropMount::Floor, true);
			case EProp::StaffTable: return Make(1.4, 0.75, 0.8, EPropMount::Floor, true);
			case EProp::Boiler: return Make(1.2, 2.0, 1.2, EPropMount::Floor, true);
			case EProp::Switchgear: return Make(1.6, 2.0, 0.5, EPropMount::Floor, true);
			case EProp::HandTruck: return Make(0.5, 1.2, 0.5, EPropMount::Floor, false);
			case EProp::TrashBin: return Make(0.45, 0.7, 0.45, EPropMount::Floor, true);
			case EProp::WallShelfA: return Make(1.33, 2.2, 0.5, EPropMount::Floor, true);
			case EProp::WallShelfB: return Make(1.33, 2.2, 0.5, EPropMount::Floor, true);
			case EProp::Workbench: return Make(1.8, 1.5, 0.75, EPropMount::Floor, true);
			case EProp::ToolCabinet: return Make(0.7, 1.0, 0.46, EPropMount::Floor, true);
			case EProp::Barrel: return Make(0.73, 1.19, 0.73, EPropMount::Floor, true);
			case EProp::PlasticBarrel: return Make(0.83, 1.33, 0.78, EPropMount::Floor, true);
			case EProp::PlasticCanister: return Make(0.4, 0.6, 0.26, EPropMount::Floor, false);
			case EProp::WoodCrate: return Make(1.82, 1.69, 1.72, EPropMount::Floor, true);
			case EProp::WoodBox: return Make(0.95, 1.06, 1.46, EPropMount::Floor, true);
			case EProp::Cardboard: return Make(1.22, 0.64, 0.81, EPropMount::Floor, true);
			case EProp::GasCylinder: return Make(0.28, 1.85, 0.28, EPropMount::Floor, true);
			case EProp::IbcTank: return Make(2.45, 2.32, 2.37, EPropMount::Floor, true);
			case EProp::TrafficCone: return Make(0.51, 0.85, 0.51, EPropMount::Floor, false);
			case EProp::Pallet: return Make(2.21, 0.21, 1.71, EPropMount::Floor, false);
			case EProp::CementBag: return Make(0.83, 0.23, 0.57, EPropMount::Floor, false);
			case EProp::StepLift: return Make(0.69, 1.79, 0.91, EPropMount::Floor, true);
			case EProp::PlasticFence: return Make(0.64, 1.17, 2.24, EPropMount::Floor, true);
			case EProp::ReeferContainer: return Make(2.44, 2.59, 6.06, EPropMount::Floor, true);
			case EProp::ContainerBreached: return Make(2.44, 2.59, 7.15, EPropMount::Floor, true);
			case EProp::QuarantineSheet: return Make(1.48, 2.2, 0.1, EPropMount::Floor, false);
			case EProp::WorkLight: return Make(0.85, 2.0, 0.85, EPropMount::Floor, false);
		}
		return FPropKind();
	}

	/** The prop's file name, as the TS keys it: "pallet-rack-a". */
	FString Name(EProp Prop)
	{
		switch (Prop)
		{
			case EProp::CeilingTube: return "ceiling-tube";
			case EProp::EmergencyLight: return "emergency-light";
			case EProp::ExitSign: return "exit-sign";
			case EProp::DoorFrame: return "door-frame";
			case EProp::Duct: return "duct";
			case EProp::DuctVent: return "duct-vent";
			case EProp::PipeRun: return "pipe-run";
			case EProp::CableTray: return "cable-tray";
			case EProp::ElectricalCabinet: return "electrical-cabinet";
			case EProp::FireExtinguisher: return "fire-extinguisher";
			case EProp::CctvCamera: return "cctv-camera";
			case EProp::WallVent: return "wall-vent";
			case EProp::HighBay: return "high-bay";
			case EProp::ContainerA: return "container-a";
			case EProp::ContainerB: return "container-b";
			case EProp::ContainerC: return "container-c";
			case EProp::CrateLarge: return "crate-large";
			case EProp::CrateLong: return "crate-long";
			case EProp::CrateStack: return "crate-stack";
			case EProp::DrumGroup: return "drum-group";
			case EProp::CableReel: return "cable-reel";
			case EProp::BigBag: return "big-bag";
			case EProp::CagePanel: return "cage-panel";
			case EProp::Forklift: return "forklift";
			case EProp::WrappedMachine: return "wrapped-machine";
			case EProp::TyreStack: return "tyre-stack";
			case EProp::RopeCoil: return "rope-coil";
			case EProp::GasCage: return "gas-cage";
			case EProp::WeighScale: return "weigh-scale";
			case EProp::BaySign: return "bay-sign";
			case EProp::StripCurtain: return "strip-curtain";
			case EProp::PalletRackA: return "pallet-rack-a";
			case EProp::PalletRackB: return "pallet-rack-b";
			case EProp::PalletStackA: return "pallet-stack-a";
			case EProp::PalletStackB: return "pallet-stack-b";
			case EProp::Desk: return "desk";
			case EProp::OfficeChair: return "office-chair";
			case EProp::FilingCabinet: return "filing-cabinet";
			case EProp::LockerRow: return "locker-row";
			case EProp::VendingMachine: return "vending-machine";
			case EProp::WaterCooler: return "water-cooler";
			case EProp::StaffTable: return "staff-table";
			case EProp::Boiler: return "boiler";
			case EProp::Switchgear: return "switchgear";
			case EProp::HandTruck: return "hand-truck";
			case EProp::TrashBin: return "trash-bin";
			case EProp::WallShelfA: return "wall-shelf-a";
			case EProp::WallShelfB: return "wall-shelf-b";
			case EProp::Workbench: return "workbench";
			case EProp::ToolCabinet: return "tool-cabinet";
			case EProp::Barrel: return "barrel";
			case EProp::PlasticBarrel: return "plastic-barrel";
			case EProp::PlasticCanister: return "plastic-canister";
			case EProp::WoodCrate: return "wood-crate";
			case EProp::WoodBox: return "wood-box";
			case EProp::Cardboard: return "cardboard";
			case EProp::GasCylinder: return "gas-cylinder";
			case EProp::IbcTank: return "ibc-tank";
			case EProp::TrafficCone: return "traffic-cone";
			case EProp::Pallet: return "pallet";
			case EProp::CementBag: return "cement-bag";
			case EProp::StepLift: return "step-lift";
			case EProp::PlasticFence: return "plastic-fence";
			case EProp::ReeferContainer: return "reefer-container";
			case EProp::ContainerBreached: return "container-breached";
			case EProp::QuarantineSheet: return "quarantine-sheet";
			case EProp::WorkLight: return "work-light";
		}
		return "";
	}
}
