import {
  Color3,
  type Mesh,
  MeshBuilder,
  PointLight,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { TRUCK } from "../../shared/truck";
import { loadContainer } from "./assets";
import { surfaceMaterial } from "./graphics";
import { LIGHT_PRIORITY, type World } from "./scene";
import { tunables } from "./tuning";

const MODEL = "models/level/truck.glb";

const LAMP = tunables("Look/Truck", {
  lamp: { value: 2.2, min: 0, max: 20, hint: "The lamp on the cargo space's ceiling" },
  reach: { value: 9, min: 1, max: 30, hint: "Meters until its light has faded out" },
});

/**
 * The crew's truck where the level parks it (`Level.truck`, shared/truck.ts): its model, or a plain
 * box truck of the same measures until that exists, and the lamp on its ceiling, which lights the
 * cargo space and a little of the ground behind it.
 */
export async function addTruck(world: World): Promise<void> {
  const { scene, level } = world;
  const truck = level.truck;
  if (!truck) return;
  const holder = new TransformNode("truck", scene);
  holder.position.set(truck.place.x, truck.place.y, truck.place.z);
  holder.rotation.y = (truck.place.turns * Math.PI) / 2;

  // Warm and close: a pool of light to come back to. Flashlights go first where there are too many.
  const lamp = new PointLight(
    "truck-lamp",
    new Vector3(TRUCK.lamp.x, TRUCK.lamp.y - 0.15, TRUCK.lamp.z),
    scene,
  );
  lamp.parent = holder;
  lamp.diffuse = new Color3(1, 0.78, 0.5);
  lamp.specular = lamp.diffuse;
  lamp.renderPriority = LIGHT_PRIORITY.other;
  const light = () => {
    lamp.intensity = LAMP.lamp;
    lamp.range = LAMP.reach;
  };
  light();
  scene.onBeforeRenderObservable.add(light);

  const standIn = addStandIn(world, holder);
  const container = await loadContainer(scene, MODEL);
  if (!container) return;
  for (const root of container.instantiateModelsToScene().rootNodes) root.parent = holder;
  for (const mesh of standIn) mesh.dispose();
  for (const mesh of holder.getChildMeshes()) {
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    world.shadows.addShadowCaster(mesh);
  }
}

/** A box truck in plain colours, at the model's measures: what the collision is, drawn. */
function addStandIn(world: World, holder: TransformNode): Mesh[] {
  const { scene } = world;
  const { inside, ramp, bench, cab } = TRUCK;
  const body = surfaceMaterial("truck-body", scene, new Color3(0.62, 0.62, 0.6), {
    roughness: 0.6,
  });
  const dark = surfaceMaterial("truck-dark", scene, new Color3(0.12, 0.12, 0.13), {
    roughness: 0.7,
  });
  const wood = surfaceMaterial("truck-wood", scene, new Color3(0.36, 0.27, 0.18), {
    roughness: 0.85,
  });
  const cabPaint = surfaceMaterial("truck-cab", scene, new Color3(0.2, 0.27, 0.36), {
    roughness: 0.5,
  });
  const meshes: Mesh[] = [];
  const box = (
    material: typeof body,
    [x0, y0, z0]: [number, number, number],
    [x1, y1, z1]: [number, number, number],
  ) => {
    const mesh = MeshBuilder.CreateBox(
      "truck-stand-in",
      { width: x1 - x0, height: y1 - y0, depth: z1 - z0 },
      scene,
    );
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.material = material;
    mesh.parent = holder;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    world.shadows.addShadowCaster(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const half = TRUCK.halfWidth;
  // The chassis, the floor, the walls, the bulkhead and the roof.
  box(dark, [-half + 0.1, 0.35, TRUCK.back + 0.2], [half - 0.1, inside.floor - 0.1, TRUCK.front]);
  box(wood, [-half, inside.floor - 0.1, TRUCK.back], [half, inside.floor, TRUCK.front]);
  box(body, [-half, inside.floor, TRUCK.back], [-inside.halfWidth, TRUCK.top, TRUCK.front]);
  box(body, [inside.halfWidth, inside.floor, TRUCK.back], [half, TRUCK.top, TRUCK.front]);
  box(
    body,
    [-inside.halfWidth, inside.floor, inside.front],
    [inside.halfWidth, TRUCK.top, TRUCK.front],
  );
  box(
    body,
    [-inside.halfWidth, inside.ceiling, TRUCK.back],
    [inside.halfWidth, TRUCK.top, inside.front],
  );
  // The roller door, rolled up into the top of the opening.
  box(
    dark,
    [-inside.halfWidth, inside.ceiling - 0.3, TRUCK.back],
    [inside.halfWidth, inside.ceiling, TRUCK.back + 0.25],
  );
  // The benches.
  for (const side of [-1, 1]) {
    const [a, b] = [side * inside.halfWidth, side * (inside.halfWidth - bench.depth)];
    box(
      wood,
      [Math.min(a, b), inside.floor + bench.height - 0.06, bench.back],
      [Math.max(a, b), inside.floor + bench.height, bench.front],
    );
  }
  // The cab, and the wheels.
  box(cabPaint, [-cab.halfWidth, 0.5, TRUCK.front + 0.1], [cab.halfWidth, cab.top, cab.front]);
  for (const z of [TRUCK.back + 1.3, cab.front - 1]) {
    for (const side of [-1, 1]) {
      const wheel = MeshBuilder.CreateCylinder(
        "truck-stand-in",
        { diameter: 1, height: 0.3, tessellation: 20 },
        scene,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (half - 0.16), 0.5, z);
      wheel.material = dark;
      wheel.parent = holder;
      wheel.isPickable = false;
      meshes.push(wheel);
    }
  }
  // The ramp, a slab from the floor's edge down to the ground.
  const run = TRUCK.back - ramp.foot;
  const slab = MeshBuilder.CreateBox(
    "truck-stand-in",
    { width: 2 * ramp.halfWidth, height: 0.06, depth: Math.hypot(run, inside.floor) },
    scene,
  );
  slab.position.set(0, inside.floor / 2 - 0.03, (TRUCK.back + ramp.foot) / 2);
  slab.rotation.x = -Math.atan2(inside.floor, run);
  slab.material = dark;
  slab.parent = holder;
  slab.receiveShadows = true;
  slab.isPickable = false;
  meshes.push(slab);
  return meshes;
}
