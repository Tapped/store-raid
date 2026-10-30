/** A part of the screen, 0..1, with its origin at the bottom left (Babylon's convention). */
export interface Pane {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Screen layout for 1–4 players: full, side by side, two over one, grid.
 * Seats are numbered left to right, top to bottom.
 */
export function panes(count: number): Pane[] {
  switch (count) {
    case 0:
      return [];
    case 1:
      return [{ x: 0, y: 0, width: 1, height: 1 }];
    case 2:
      return [
        { x: 0, y: 0, width: 0.5, height: 1 },
        { x: 0.5, y: 0, width: 0.5, height: 1 },
      ];
    case 3:
      return [
        { x: 0, y: 0.5, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
        { x: 0, y: 0, width: 1, height: 0.5 },
      ];
    default:
      return [
        { x: 0, y: 0.5, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
        { x: 0, y: 0, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      ];
  }
}
