import {
  allSettings,
  changeSetting,
  describeChanges,
  format,
  isChanged,
  onSettingsAdded,
  resetSetting,
  type Setting,
  stepOf,
} from "./tuning";

/**
 * The tuning panel: every registered setting (tuning.ts) as a slider or a checkbox, grouped into
 * sections that fold away, over the right of the screen. Opened and closed from the console with
 * `__game.tune()`, in dev builds only.
 *
 * Typing and dragging in it don't play the game: keys pressed in it stop there, before the game's
 * window listeners hear them, and opening it lets the mouse go.
 */

const STYLE = `
#tuning {
  position: fixed; top: 12px; right: 12px; bottom: 12px; width: 360px;
  display: flex; flex-direction: column; z-index: 10;
  background: rgb(16 18 22 / 0.88); color: #ddd; border-radius: 8px;
  font: 12px system-ui, sans-serif; box-shadow: 0 4px 20px rgb(0 0 0 / 0.5);
}
#tuning header { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid #333; flex-wrap: wrap; }
#tuning header input { flex: 1 1 100%; }
#tuning .list { overflow-y: auto; padding: 4px 8px 8px; flex: 1; }
#tuning details { margin-top: 4px; }
#tuning summary { cursor: pointer; font-weight: 600; padding: 4px 0; color: #fff; }
#tuning summary .count { color: #e8b04a; font-weight: normal; margin-left: 6px; }
#tuning h4 { margin: 8px 0 2px; font-size: 11px; font-weight: 600; color: #9ab; text-transform: uppercase; letter-spacing: 0.04em; }
#tuning .row { display: grid; grid-template-columns: 112px 1fr 62px 18px; gap: 6px; align-items: center; padding: 1px 0; }
#tuning .row label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#tuning .row.changed label { color: #e8b04a; }
#tuning .row input[type=range] { width: 100%; margin: 0; accent-color: #6a9fd8; }
#tuning .row.changed input[type=range] { accent-color: #e8b04a; }
#tuning .row input[type=number] { width: 100%; box-sizing: border-box; }
#tuning input, #tuning button { background: #262a31; color: #ddd; border: 1px solid #3a3f48; border-radius: 4px; font: inherit; padding: 2px 4px; }
#tuning button { cursor: pointer; padding: 3px 8px; }
#tuning button:hover { background: #333944; }
#tuning .reset { padding: 0; width: 18px; height: 18px; line-height: 1; visibility: hidden; }
#tuning .row.changed .reset { visibility: visible; }
#tuning .note { color: #889; padding: 4px 8px 8px; }
/* The controls hint would show through the panel in a narrow window, and the game isn't played
   while it's open anyway. */
body:has(#tuning) #hint { visibility: hidden; }
`;

interface Row {
  setting: Setting;
  element: HTMLElement;
  update(): void;
}

let panel: TuningPanel | undefined;

/** Opens the panel, or closes it if it's open. */
export function toggleTuning(): void {
  if (panel) {
    panel.dispose();
    panel = undefined;
  } else panel = new TuningPanel();
}

class TuningPanel {
  private readonly root = document.createElement("div");
  private readonly list = document.createElement("div");
  private readonly filter = document.createElement("input");
  private readonly note = document.createElement("div");
  private rows: Row[] = [];
  /** Which sections are open, by name, so rebuilding keeps them as they were. */
  private readonly open = new Set<string>();
  private readonly timer: number;
  private readonly stopListening: () => void;
  /** Clicking back into the game takes the focus out of the panel, or keys would still stop here. */
  private readonly unfocus = (e: PointerEvent) => {
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      this.root.contains(focused) &&
      !this.root.contains(e.target as Node)
    ) {
      focused.blur();
    }
  };

  constructor() {
    if (!document.getElementById("tuning-style")) {
      const style = document.createElement("style");
      style.id = "tuning-style";
      style.textContent = STYLE;
      document.head.append(style);
    }
    this.root.id = "tuning";
    // The game listens on the window: what's typed here goes no further.
    for (const type of ["keydown", "keypress"] as const) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }

    const header = document.createElement("header");
    this.filter.placeholder = "Filter…";
    this.filter.addEventListener("input", () => this.build());
    header.append(
      this.filter,
      button("Copy changes", "Copy what differs from the code, to bake in", () => this.copy()),
      button("Reset all", "Put every setting back to the code's value", () => {
        for (const setting of allSettings()) resetSetting(setting);
      }),
      button("Close", "Or __game.tune() again", toggleTuning),
    );
    this.list.className = "list";
    this.note.className = "note";
    this.root.append(header, this.list, this.note);
    document.body.append(this.root);
    document.exitPointerLock();
    document.addEventListener("pointerdown", this.unfocus, true);

    this.build();
    this.stopListening = onSettingsAdded(() => this.build());
    // Values also change from elsewhere: the server's mechanics, or the console.
    this.timer = window.setInterval(() => this.refresh(), 200);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.stopListening();
    document.removeEventListener("pointerdown", this.unfocus, true);
    this.root.remove();
  }

  private build(): void {
    const words = this.filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = allSettings().filter((s) => {
      const text = `${s.group} ${s.key} ${s.hint ?? ""}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    const sections = new Map<string, Map<string, Setting[]>>();
    for (const setting of shown) {
      const [section, group = ""] = setting.group.split("/");
      const groups = sections.get(section) ?? new Map<string, Setting[]>();
      sections.set(section, groups);
      groups.set(group, [...(groups.get(group) ?? []), setting]);
    }

    this.rows = [];
    this.list.replaceChildren();
    for (const [section, groups] of sections) {
      const details = document.createElement("details");
      details.open = this.open.has(section) || words.length > 0;
      details.addEventListener("toggle", () => {
        if (words.length) return;
        if (details.open) this.open.add(section);
        else this.open.delete(section);
      });
      const summary = document.createElement("summary");
      summary.textContent = section;
      const count = document.createElement("span");
      count.className = "count";
      summary.append(count);
      details.append(summary);
      const sectionRows: Row[] = [];
      for (const [group, settings] of groups) {
        if (group) {
          const heading = document.createElement("h4");
          heading.textContent = group;
          details.append(heading);
        }
        for (const setting of settings) {
          const row = makeRow(setting);
          details.append(row.element);
          sectionRows.push(row);
        }
      }
      // The section's count of changed settings, kept up with its rows.
      const countRow: Row = {
        setting: sectionRows[0].setting,
        element: count,
        update: () => {
          const changed = sectionRows.filter((r) => isChanged(r.setting)).length;
          count.textContent = changed ? `${changed} changed` : "";
        },
      };
      this.rows.push(...sectionRows, countRow);
      this.list.append(details);
    }
    this.refresh();
  }

  private refresh(): void {
    for (const row of this.rows) row.update();
    const changed = allSettings().filter(isChanged).length;
    this.note.textContent = `${changed} of ${allSettings().length} settings changed. Changes are kept in this browser until reset.`;
  }

  private copy(): void {
    const text = describeChanges();
    console.log(text);
    navigator.clipboard.writeText(text).then(
      () => this.flash("Copied, and printed to the console."),
      () => this.flash("Printed to the console: the clipboard wasn't allowed."),
    );
  }

  private flash(message: string): void {
    this.note.textContent = message;
  }
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = label;
  element.title = title;
  element.addEventListener("click", onClick);
  return element;
}

/** A setting's row: its name, a slider or checkbox, the value to type into, and a reset. */
function makeRow(setting: Setting): Row {
  const element = document.createElement("div");
  element.className = "row";
  const label = document.createElement("label");
  label.textContent = setting.key;
  label.title = [setting.hint, `Default ${format(setting, setting.initial)}`]
    .filter(Boolean)
    .join("\n");
  const reset = button("↺", "Back to the code's value", () => resetSetting(setting));
  reset.className = "reset";

  if (typeof setting.initial === "boolean") {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => changeSetting(setting, box.checked));
    element.append(label, box, document.createElement("span"), reset);
    return {
      setting,
      element,
      update() {
        box.checked = setting.get() as boolean;
        element.classList.toggle("changed", isChanged(setting));
      },
    };
  }

  const step = String(stepOf(setting));
  const slider = document.createElement("input");
  slider.type = "range";
  const number = document.createElement("input");
  number.type = "number";
  for (const input of [slider, number]) {
    input.min = String(setting.min);
    input.max = String(setting.max);
    input.step = step;
  }
  // Typed values may be off the step's grid.
  number.step = "any";
  slider.addEventListener("input", () => changeSetting(setting, Number(slider.value)));
  number.addEventListener("change", () => {
    if (number.value !== "") changeSetting(setting, Number(number.value));
  });
  element.append(label, slider, number, reset);
  return {
    setting,
    element,
    update() {
      const value = setting.get() as number;
      if (document.activeElement !== slider) slider.value = String(value);
      if (document.activeElement !== number) number.value = format(setting, value);
      element.classList.toggle("changed", isChanged(setting));
    },
  };
}
