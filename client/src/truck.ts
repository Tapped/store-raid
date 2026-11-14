import {
  Color3,
  type Mesh,
  MeshBuilder,
  PointLight,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { HATCH_DOWN, HATCH_TIME, TRUCK } from "../../shared/truck";
import { loadContainer } from "./assets";
import { OneShots } from "./audio";
import { surfaceMaterial } from "./graphics";
import { LIGHT_PRIORITY, type World } from "./scene";
import { tunables } from "./tuning";

const MODEL = "models/level/truck.glb";
const HATCH_MODEL = "models/level/truck-hatch.glb";
const MOTOR = "audio/sfx/hatch-motor.wav";
const LATCH = "audio/sfx/hatch-latch.wav";

const LAMP = tunables("Look/Truck", {
  lamp: { value: 2.2, min: 0, max: 20, hint: "The lamp on the cargo space's ceiling" },
  reach: { value: 9, min: 1, max: 30, hint: "Meters until its light has faded out" },
});

const SOUND = tunables("Sound/Truck", {
  motor: { value: 0.7, min: 0, max: 2, hint: "The hatch's motor as it starts to move" },
  motorRate: { value: 0.45, min: 0.2, max: 2, hint: "Slower is deeper, and lasts longer" },
  latch: { value: 0.9, min: 0, max: 2, hint: "The hatch coming to rest, up or down" },
});

/** The truck on screen: what the page keeps of it. */
export interface TruckView {
  /** Each frame: where the room says the hatch is, 0 up to 1 down, if we're in one. */
  update(hatch: number | undefined, dt: number): void;
}

/**
 * The crew's truck where the level parks it (`Level.truck`, shared/truck.ts): its model, or a plain
 * box truck of the same measures until that exists, and the lamp on its ceiling, which lights the
 * cargo space and a little of the ground behind it. Its hatch is a model of its own on a hinge,
 * turned to where the room says it is: up it shuts the back, down it's the ramp.
 */
export function addTruck(world: World): TruckView | undefined {
  const { scene, level } = world;
  const truck = level.truck;
  if (!truck) return undefined;
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

  // The hatch turns about its hinge, along the floor's edge.
  const hinge = new TransformNode("truck-hatch", scene);
  hinge.parent = holder;
  hinge.position.set(0, TRUCK.hatch.hingeY, TRUCK.hatch.hingeZ);

  /** Shows the model at `path` under `parent` in place of its stand-in, once it has loaded. */
  const show = async (path: string, parent: TransformNode, standIn: Mesh[]) => {
    const container = await loadContainer(scene, path);
    if (!container) return;
    for (const root of container.instantiateModelsToScene().rootNodes) root.parent = parent;
    for (const mesh of standIn) mesh.dispose();
    for (const mesh of parent.getChildMeshes(false)) {
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      world.shadows.addShadowCaster(mesh);
    }
  };
  void show(MODEL, holder, addStandIn(world, holder));
  void show(HATCH_MODEL, hinge, [addHatchStandIn(world, hinge)]);

  const motor = OneShots.load(scene, [MOTOR]);
  const latch = OneShots.load(scene, [LATCH]);
  /** Where the hatch is drawn, 0 up to 1 down; undefined until a room has said. */
  let shown: number | undefined;
  let moving = false;
  const turn = (at: number) => {
    // Eased at both ends, as a ram starts and stops.
    const eased = at * at * (3 - 2 * at);
    hinge.rotation.x = Math.PI / 2 + (-HATCH_DOWN - Math.PI / 2) * eased;
  };
  turn(1);
  return {
    update(hatch, dt) {
      if (hatch === undefined) return;
      if (shown === undefined) shown = hatch;
      const was = shown;
      // A little faster than the room moves it, to catch up with it between its updates.
      const step = (dt / HATCH_TIME) * 1.5;
      shown = hatch > shown ? Math.min(hatch, shown + step) : Math.max(hatch, shown - step);
      turn(shown);
      const now = shown !== was;
      if (now && !moving) {
        void motor.then((sound) =>
          sound?.play({ volume: SOUND.motor, at: hinge }, { rate: SOUND.motorRate, pitch: 0.04 }),
        );
      }
      if (!now && moving && (shown === 0 || shown === 1)) {
        void latch.then((sound) => sound?.play({ volume: SOUND.latch, at: hinge }, { rate: 0.7 }));
      }
      moving = now;
    },
  };
}

/** The hatch as a plain slab on its hinge, lying out behind it as the model does. */
function addHatchStandIn(world: World, hinge: TransformNode): Mesh {
  const { length, halfWidth } = TRUCK.hatch;
  const slab = MeshBuilder.CreateBox(
    "truck-stand-in",
    { width: 2 * halfWidth + 0.16, height: 0.07, depth: length },
    world.scene,
  );
  slab.position.set(0, -0.005, -length / 2);
  slab.material = surfaceMaterial("truck-hatch", world.scene, new Color3(0.5, 0.5, 0.5), {
    roughness: 0.6,
  });
  slab.parent = hinge;
  slab.receiveShadows = true;
  slab.isPickable = false;
  world.shadows.addShadowCaster(slab);
  return slab;
}

/** A box truck in plain colours, at the model's measures: what the collision is, drawn. */
function addStandIn(world: World, holder: TransformNode): Mesh[] {
  const { scene } = world;
  const { inside, bench, cab } = TRUCK;
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
  return meshes;
}
