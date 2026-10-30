/** One frame of what a device wants. Sticks are -1..1; drag is mouse pixels since the last read. */
export interface Controls {
  moveX: number; // right
  moveY: number; // forward
  lookX: number; // right
  lookY: number; // up
  dragX: number;
  dragY: number;
}

/** Something one person plays with: a controller, or one half of the keyboard. */
export interface Device {
  readonly id: string;
  readonly label: string;
  /** False while a controller is unplugged; its player keeps their seat. */
  connected(): boolean;
  read(): Controls;
  /** True once per press. */
  joinPressed(): boolean;
  leavePressed(): boolean;
  /** True once per press: pick up or let go, depending on whether the player is carrying. */
  grabPressed(): boolean;
  /** True once the reload combo has been held long enough. Keyboards have F5 instead. */
  reloadHeld(): boolean;
}

const held = new Set<string>();
const pressed = new Set<string>();
let dragX = 0;
let dragY = 0;

const GAME_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

addEventListener("keydown", (e) => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  held.add(e.code);
});
addEventListener("keyup", (e) => held.delete(e.code));
addEventListener("blur", () => held.clear());

/** Mouse drag on the canvas looks around for the WASD player. */
export function attachMouse(canvas: HTMLCanvasElement) {
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons === 0) return;
    dragX += e.movementX;
    dragY += e.movementY;
  });
}

function takePressed(code: string): boolean {
  return pressed.delete(code);
}

function axis(negative: string, positive: string): number {
  return (held.has(positive) ? 1 : 0) - (held.has(negative) ? 1 : 0);
}

function keyboard(
  id: string,
  label: string,
  keys: {
    left: string;
    right: string;
    back: string;
    forward: string;
    lookLeft: string;
    lookRight: string;
    join: string;
    leave: string;
    grab: string;
  },
  mouse: boolean,
): Device {
  return {
    id,
    label,
    connected: () => true,
    read() {
      const controls: Controls = {
        moveX: axis(keys.left, keys.right),
        moveY: axis(keys.back, keys.forward),
        lookX: axis(keys.lookLeft, keys.lookRight),
        lookY: 0,
        dragX: mouse ? dragX : 0,
        dragY: mouse ? dragY : 0,
      };
      if (mouse) {
        dragX = 0;
        dragY = 0;
      }
      return controls;
    },
    joinPressed: () => takePressed(keys.join),
    leavePressed: () => takePressed(keys.leave),
    grabPressed: () => takePressed(keys.grab),
    reloadHeld: () => false,
  };
}

const keyboards = [
  keyboard(
    "wasd",
    "WASD",
    {
      left: "KeyA",
      right: "KeyD",
      back: "KeyS",
      forward: "KeyW",
      lookLeft: "KeyQ",
      lookRight: "KeyE",
      join: "Space",
      leave: "Escape",
      grab: "KeyF",
    },
    true,
  ),
  keyboard(
    "arrows",
    "Arrows",
    {
      left: "ArrowLeft",
      right: "ArrowRight",
      back: "ArrowDown",
      forward: "ArrowUp",
      lookLeft: "Comma",
      lookRight: "Period",
      join: "Enter",
      leave: "Backspace",
      grab: "ShiftRight",
    },
    false,
  ),
];

const DEADZONE = 0.15;

// Standard gamepad mapping: https://w3c.github.io/gamepad/#remapping
const BUTTON_SOUTH = 0; // A / Cross
const BUTTON_WEST = 2; // X / Square
const BUTTON_BACK = 8; // Back / Share
const BUTTON_START = 9;
const BUTTON_LEFT_STICK = 10;
const BUTTON_RIGHT_STICK = 11;

const RELOAD_HOLD_MS = 1000;

/** A stick's two axes with a radial deadzone, rescaled so it still reaches 0 and 1 smoothly. */
function stick(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y);
  if (length < DEADZONE) return [0, 0];
  const scale = Math.min(1, (length - DEADZONE) / (1 - DEADZONE)) / length;
  return [x * scale, y * scale];
}

function controller(index: number): Device {
  const pad = () => navigator.getGamepads()[index] ?? null;
  const was = new Set<number>();
  const edge = (button: number) => {
    const down = pad()?.buttons[button]?.pressed ?? false;
    const first = down && !was.has(button);
    if (down) was.add(button);
    else was.delete(button);
    return first;
  };
  // Sticks still held from before a reload must be let go first, or it would reload forever.
  let reloadArmed = false;
  let reloadHeldSince: number | undefined;
  return {
    id: `pad${index}`,
    label: `Controller ${index + 1}`,
    connected: () => pad()?.connected ?? false,
    read() {
      const axes = pad()?.axes ?? [];
      const [moveX, moveY] = stick(axes[0] ?? 0, axes[1] ?? 0);
      const [lookX, lookY] = stick(axes[2] ?? 0, axes[3] ?? 0);
      // Gamepad y axes point down; ours point forward/up.
      return { moveX, moveY: -moveY, lookX, lookY: -lookY, dragX: 0, dragY: 0 };
    },
    joinPressed() {
      // Evaluate both: each call also updates that button's edge state.
      const south = edge(BUTTON_SOUTH);
      const start = edge(BUTTON_START);
      return south || start;
    },
    leavePressed: () => edge(BUTTON_BACK),
    grabPressed: () => edge(BUTTON_WEST),
    reloadHeld() {
      const buttons = pad()?.buttons;
      if (!buttons?.[BUTTON_LEFT_STICK]?.pressed || !buttons[BUTTON_RIGHT_STICK]?.pressed) {
        reloadArmed = true;
        reloadHeldSince = undefined;
        return false;
      }
      if (!reloadArmed) return false;
      reloadHeldSince ??= performance.now();
      return performance.now() - reloadHeldSince >= RELOAD_HOLD_MS;
    },
  };
}

const controllers = new Map<number, Device>();

/** Both halves of the keyboard and every controller the browser can see. */
export function listDevices(): Device[] {
  // Browsers only reveal a controller after a button press on it, which is also how you join.
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (pad && !controllers.has(pad.index)) controllers.set(pad.index, controller(pad.index));
  }
  return [...keyboards, ...controllers.values()];
}
