# Friday Fun

Splitscreen multiplayer browser game with controller support: Babylon.js client, Colyseus server,
shared deterministic movement. See `CLAUDE.md` for how it fits together.

```bash
npm ci
npm run dev        # http://127.0.0.1:5173
```

Shared assets (`/assets/...`) only exist on the server, so models fall back to placeholders on a
laptop. On a shipjam server your dev servers run as services: see `CLAUDE.md`.

## Controls

Up to four people share a screen. Join with the device you want to play on.

|  | Controller | WASD half | Arrows half |
|---|---|---|---|
| Join | A or Start | Space | Enter |
| Leave | Back | Esc | Backspace |
| Move | left stick | W A S D | arrow keys |
| Look | right stick | Q / E, or drag the mouse | , / . |

Browsers only reveal a controller once a button has been pressed on it, and the tab must have focus.
They also need a secure page: HTTPS or localhost.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | client + server with hot reload |
| `npm run check` | typecheck + lint + build |
| `npm run format` | auto-fix formatting and simple lint issues |
| `npx tsx scripts/bot.ts` | a headless extra player |
