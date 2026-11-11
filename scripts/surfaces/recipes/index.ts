import type { SurfaceName } from "../../../client/src/surfaceTable";
import type { Recipe } from "../recipe";
import { cardboard } from "./cardboard";
import { carpetTile } from "./carpet-tile";
import { ceilingTile } from "./ceiling-tile";
import { concreteBlock } from "./concrete-block";
import { concreteFloor } from "./concrete-floor";
import { concreteWall } from "./concrete-wall";
import { corrugated } from "./corrugated";
import { diamondPlate } from "./diamond-plate";
import { floorPaint } from "./floor-paint";
import { galvanised } from "./galvanised";
import { hazard } from "./hazard";
import { metalDeck } from "./metal-deck";
import { paintedPlaster } from "./painted-plaster";
import { paintedSteel } from "./painted-steel";
import { rubber } from "./rubber";
import { rust } from "./rust";
import { tarpaulin } from "./tarpaulin";
import { vinylTile } from "./vinyl-tile";
import { wallTile } from "./wall-tile";
import { woodPlank } from "./wood-plank";

/** Every surface's recipe, by the name in client/src/surfaceTable.ts. */
export const RECIPES: Record<SurfaceName, Recipe> = {
  "concrete-floor": concreteFloor,
  "floor-paint": floorPaint,
  "concrete-block": concreteBlock,
  "concrete-wall": concreteWall,
  corrugated,
  "metal-deck": metalDeck,
  "painted-steel": paintedSteel,
  galvanised,
  rust,
  "diamond-plate": diamondPlate,
  "wood-plank": woodPlank,
  cardboard,
  rubber,
  hazard,
  tarpaulin,
  "painted-plaster": paintedPlaster,
  "ceiling-tile": ceilingTile,
  "carpet-tile": carpetTile,
  "wall-tile": wallTile,
  "vinyl-tile": vinylTile,
};
