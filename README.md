# Friday Fun

Online multiplayer browser game with controller support: Babylon.js client, Colyseus server, shared
deterministic movement. Everyone plays on their own screen. See `PLAN.md` for where the game is going
and `CLAUDE.md` for how it fits together.

```bash
pnpm install
pnpm run dev        # http://127.0.0.1:5173
```

Assets aren't in git. They live in an `assets/` folder next to the `main/` checkout, shared with
everything in `worktrees/`, and are served at `/assets/...`. A fresh clone needs them copied in by
hand; without them, models fall back to placeholders.

## Controls

Join with the device you want to play on.

|  | Controller | Keyboard |
|---|---|---|
| Join | A or Start | Space |
| Leave | Back | Esc |
| Move | left stick | W A S D |
| Look | right stick | the mouse (click to capture it) |
| Grab (hold on the dimmer to fade the lights) | RB | E |
| Drop | LB | Q |

Browsers only reveal a controller once a button has been pressed on it, and the tab must have focus.
They also need a secure page: HTTPS or localhost.

## Scripts

| Script | What it does |
|---|---|
| `pnpm run dev` | client + server with hot reload |
| `pnpm run check` | typecheck + lint + build |
| `pnpm run format` | auto-fix formatting and simple lint issues |
| `pnpm exec tsx scripts/bot.ts` | a headless extra player |
