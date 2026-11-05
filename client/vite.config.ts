import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));

/**
 * Assets are shared by every checkout: they live in `assets/` next to `main/`, and each checkout's
 * `public/assets` links there. A real `public/assets` folder is left alone.
 */
function linkSharedAssets() {
  const link = resolve(publicDir, "assets");
  if (lstatSync(link, { throwIfNoEntry: false })) return;
  // The common git dir is `main/.git` from main and from every worktree.
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: import.meta.dirname,
    encoding: "utf8",
  }).trim();
  const shared = resolve(dirname(dirname(gitDir)), "assets");
  if (!existsSync(shared)) return;
  mkdirSync(publicDir, { recursive: true });
  symlinkSync(shared, link, "junction");
}

linkSharedAssets();

// From the environment, e.g. to run two checkouts at once; defaults are for running on a laptop.
const port = Number(process.env.PORT ?? 5173);
const base = process.env.BASE ?? "/";
const serverPort = Number(process.env.SERVER_PORT ?? 2567);
const wsPrefix = `${base}ws`;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base,
  publicDir,
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
