/**
 * Settings to tune by ear and eye while playing: sound, mechanics, feel, rendering. Each module
 * registers its own here, and the tuning panel (tuningPanel.ts, `__game.tune()` in the console)
 * shows whatever has been registered, so it never reaches into a module's internals.
 *
 * The values in the code are the defaults and stay the source of truth. In dev, what the panel
 * changes is kept in this browser's localStorage and put back on the next load, until it's reset;
 * `__game.tune.changes()` lists what differs from the code, to bake in.
 *
 * Most modules call `tunables()`, which turns their constants into a live object to read from:
 *
 *   const STEPS = tunables("Sound/Footsteps", {
 *     own: { value: 0.21, min: 0, max: 1, hint: "Our own footsteps' volume" },
 *   });
 *   ...volume * STEPS.own
 *
 * Settings that live in someone else's object, such as a Babylon pipeline, go through `onChange`;
 * and ones with nowhere to keep a value, such as the room's mechanics, through `addSetting()`.
 */

export interface NumberSpec {
  value: number;
  min: number;
  max: number;
  /** The slider's step; by default about a hundredth of the range. */
  step?: number;
  /** A line about what it does, shown when hovering over it. */
  hint?: string;
}

export interface BooleanSpec {
  value: boolean;
  hint?: string;
}

export type Spec = NumberSpec | BooleanSpec;

export type Values<T extends Record<string, Spec>> = {
  -readonly [K in keyof T]: T[K] extends BooleanSpec ? boolean : number;
};

/** One setting, as the panel sees it. */
export interface Setting {
  /** Where it goes in the panel: a section, and a group in it after a slash, as "Sound/Footsteps". */
  group: string;
  key: string;
  hint?: string;
  /** The code's value. */
  initial: number | boolean;
  /** For numbers. */
  min?: number;
  max?: number;
  step?: number;
  get(): number | boolean;
  set(value: number | boolean): void;
}

const settings = new Map<string, Setting>();
const listeners = new Set<() => void>();

const STORAGE_KEY = "tuning";
/** Only dev builds keep tuned values: a production page always plays the code's. */
const KEEPS = import.meta.env.DEV;

function stored(): Record<string, number | boolean> {
  if (!KEEPS) return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function idOf(setting: Pick<Setting, "group" | "key">) {
  return `${setting.group}/${setting.key}`;
}

/** Every setting registered so far, in the order they were. */
export function allSettings(): Setting[] {
  return [...settings.values()];
}

/** Call `listener` whenever settings are added, so the panel can show them. */
export function onSettingsAdded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Register a setting, and put back the value it was last tuned to in this browser. Registering the
 * same group and key again replaces the old one, as a module hot-reloading or a level rebuilding does.
 */
export function addSetting(setting: Setting): void {
  const id = idOf(setting);
  settings.set(id, setting);
  const value = keptValue(setting);
  if (value !== undefined && value !== setting.get()) setting.set(value);
  for (const listener of listeners) listener();
}

/** The value a setting was last tuned to in this browser, if it was. */
function keptValue(setting: Setting): number | boolean | undefined {
  const value = stored()[idOf(setting)];
  return typeof value === typeof setting.initial ? clamp(setting, value) : undefined;
}

/**
 * A module's tunable constants, as a live object whose values the panel changes. `onChange` is
 * told whenever one does, with all of them, for values that must be pushed somewhere to work. It
 * isn't told about values kept from last time, which are in the object from the start: it may
 * well use things the module hasn't made yet.
 */
export function tunables<T extends Record<string, Spec>>(
  group: string,
  specs: T,
  onChange?: (values: Values<T>, key: keyof T) => void,
): Values<T> {
  const values: Record<string, number | boolean> = {};
  for (const [key, spec] of Object.entries(specs)) {
    const setting: Setting = {
      group,
      key,
      hint: spec.hint,
      initial: spec.value,
      ...("min" in spec ? { min: spec.min, max: spec.max, step: spec.step } : {}),
      get: () => values[key],
      set: (value) => {
        values[key] = value;
        onChange?.(values as Values<T>, key);
      },
    };
    values[key] = keptValue(setting) ?? spec.value;
    addSetting(setting);
  }
  return values as Values<T>;
}

/** Change a setting, as the panel does, and keep the new value in this browser. */
export function changeSetting(setting: Setting, value: number | boolean): void {
  const clamped = clamp(setting, value);
  setting.set(clamped);
  if (!KEEPS) return;
  // What was asked for, not what `get` says: the room's mechanics only change once the server says.
  const all = stored();
  const id = idOf(setting);
  if (clamped === setting.initial) delete all[id];
  else all[id] = clamped;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Back to the code's value. */
export function resetSetting(setting: Setting): void {
  changeSetting(setting, setting.initial);
}

/** Whether a setting is off its code value, ignoring float noise below its step. */
export function isChanged(setting: Setting): boolean {
  const value = setting.get();
  if (typeof value === "boolean" || typeof setting.initial === "boolean") {
    return value !== setting.initial;
  }
  return Math.abs(value - setting.initial) > stepOf(setting) / 1000;
}

/** Every setting off its code value, one per line, to hand to whoever bakes them into the code. */
export function describeChanges(): string {
  const lines = allSettings()
    .filter(isChanged)
    .map((s) => `${s.group} › ${s.key}: ${format(s, s.initial)} → ${format(s, s.get())}`);
  return lines.length ? lines.join("\n") : "Nothing tuned: every setting is at its code value.";
}

/** A number setting's step, given or about a hundredth of its range at a round number. */
export function stepOf(setting: Setting): number {
  if (setting.step) return setting.step;
  const range = (setting.max ?? 1) - (setting.min ?? 0);
  return 10 ** Math.floor(Math.log10(range / 100));
}

/** A value as the panel and the change list show it: no more decimals than its step has. */
export function format(setting: Setting, value: number | boolean): string {
  if (typeof value === "boolean") return String(value);
  const decimals = Math.max(0, -Math.floor(Math.log10(stepOf(setting)) + 1e-9));
  return String(Number(value.toFixed(Math.min(6, decimals + 1))));
}

function clamp(setting: Setting, value: number | boolean): number | boolean {
  if (typeof value === "boolean") return value;
  return Math.min(setting.max ?? Infinity, Math.max(setting.min ?? -Infinity, value));
}
