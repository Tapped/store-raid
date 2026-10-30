import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Set by the server (see ~/.config/game.env); defaults are for running on a laptop.
const port = Number(process.env.PORT ?? 5173);
const base = process.env.BASE ?? "/";
const serverPort = Number(process.env.SERVER_PORT ?? 2567);
const wsPrefix = `${base}ws`;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base,
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: {
      // The game server lives under `${base}ws` so it shares the page's origin.
      [wsPrefix]: {
        target: `http://127.0.0.1:${serverPort}`,
        ws: true,
        rewrite: (path) => path.slice(wsPrefix.length) || "/",
      },
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsDir: "_app",
    chunkSizeWarningLimit: 8000,
  },
});
