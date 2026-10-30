import { type SchemaType, schema, t } from "@colyseus/schema";

/**
 * One input frame, consumed by `Room.defineInput()`. Flat primitives only:
 * no seq/dt/time — the engine's input counter is the sequence and one input = one fixed step.
 * Analog, in world space: -MOVE_SCALE..MOVE_SCALE on each axis (client turns stick + camera into this).
 */
export const MoveInput = schema({
  moveX: t.int8(),
  moveZ: t.int8(),
});
export type MoveInput = SchemaType<typeof MoveInput>;

export const Player = schema({
  name: t.string(),
  color: t.string(),
  x: t.number(),
  z: t.number(),
  vx: t.number(),
  vz: t.number(),
});
export type Player = SchemaType<typeof Player>;

export const Crate = schema({
  x: t.number(),
  y: t.number(),
  z: t.number(),
  qx: t.number(),
  qy: t.number(),
  qz: t.number(),
  qw: t.number(),
});
export type Crate = SchemaType<typeof Crate>;

export const GameState = schema({
  players: t.map(Player),
  crates: t.map(Crate),
});
export type GameState = SchemaType<typeof GameState>;
