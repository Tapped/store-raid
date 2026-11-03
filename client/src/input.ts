/** One frame of what a device wants. Sticks are -1..1; drag is mouse pixels since the last read. */
export interface Controls {
  moveX: number; // right
  moveY: number; // forward
  lookX: number; // right
  lookY: number; // up
  dragX: number;
  dragY: number;
}

/** Something the player plays with: the keyboard and mouse, or a controller. */
export interface Device {
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

/** Mouse drag on the canvas looks around. */
export function attachMouse(canvas: HTMLCanvasElement) {
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons === 0) return;
    dragX += e.movementX;
    dragY += e.movementY;
  });
}

/** Consumes the presses of all the given keys, so none is saved up for later. */
function anyPressed(...codes: string[]): boolean {
  return codes.map((code) => pressed.delete(code)).some(Boolean);
}

/** Either set of keys moves and turns, so it doesn't matter where the player's hands are. */
function keys(...codes: string[]): boolean {
  return codes.some((code) => held.has(code));
}

function axis(negative: number | boolean, positive: number | boolean): number {
  return Number(positive) - Number(negative);
}

const keyboard: Device = {
  read() {
    const controls: Controls = {
      moveX: axis(keys("KeyA", "ArrowLeft"), keys("KeyD", "ArrowRight")),
      moveY: axis(keys("KeyS", "ArrowDown"), keys("KeyW", "ArrowUp")),
      lookX: axis(keys("KeyQ", "Comma"), keys("KeyE", "Period")),
      lookY: 0,
      dragX,
      dragY,
    };
    dragX = 0;
    dragY = 0;
    return controls;
  },
  joinPressed: () => anyPressed("Space", "Enter"),
  leavePressed: () => anyPressed("Escape"),
  grabPressed: () => anyPressed("KeyF"),
  reloadHeld: () => false,
};

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

function devices(): Device[] {
  // Browsers only reveal a controller after a button press on it.
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (pad && !controllers.has(pad.index)) controllers.set(pad.index, controller(pad.index));
  }
  return [keyboard, ...controllers.values()];
}

/** Asks every device, without stopping at the first yes: each call also updates its own state. */
function any(ask: (device: Device) => boolean): boolean {
  return devices().map(ask).some(Boolean);
}

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** The keyboard, the mouse and every controller at once: all of them control the one player. */
export const input: Device = {
  read() {
    const total: Controls = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, dragX: 0, dragY: 0 };
    for (const device of devices()) {
      const controls = device.read();
      for (const key of Object.keys(total) as (keyof Controls)[]) total[key] += controls[key];
    }
    total.moveX = clamp(total.moveX);
    total.moveY = clamp(total.moveY);
    total.lookX = clamp(total.lookX);
    total.lookY = clamp(total.lookY);
    return total;
  },
  joinPressed: () => any((device) => device.joinPressed()),
  leavePressed: () => any((device) => device.leavePressed()),
  grabPressed: () => any((device) => device.grabPressed()),
  reloadHeld: () => any((device) => device.reloadHeld()),
};
