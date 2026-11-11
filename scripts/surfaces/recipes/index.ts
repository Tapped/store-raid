import type { SurfaceName } from "../../../client/src/surfaceTable";
import type { Recipe } from "../recipe";
import { concreteFloor } from "./concrete-floor";

/** Every surface's recipe, by the name in client/src/surfaceTable.ts. */
export const RECIPES: Partial<Record<SurfaceName, Recipe>> = {
  "concrete-floor": concreteFloor,
};
