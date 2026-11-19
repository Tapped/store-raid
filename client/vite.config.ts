import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

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

/**
 * `assets/raw/` holds what models are built from, which the game never loads: a build copies the
 * public folder whole, so it is taken out of the build again afterwards.
 */
function leaveOutRaw(): Plugin {
  let outDir = "";
  return {
    name: "leave-out-raw",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      rmSync(resolve(outDir, "assets/raw"), { recursive: true, force: true });
    },
  };
}

/**
 * In dev, `models.json` lists every .glb under assets/models with its size and when it was written,
 * for the model viewer (models.html): what there is to show, and when one has been built again.
 */
function listModels(): Plugin {
  const root = resolve(publicDir, "assets/models");
  return {
    name: "list-models",
    configureServer(server) {
      server.middlewares.use(`${base}models.json`, (_request, response) => {
        const files = existsSync(root)
          ? readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) =>
              f.endsWith(".glb"),
            )
          : [];
        const models = files.sort().map((file) => {
          const stat = statSync(resolve(root, file));
          return {
            path: relative(root, resolve(root, file))
              .replaceAll("\\", "/")
              .replace(/\.glb$/, ""),
            size: stat.size,
            modified: Math.round(stat.mtimeMs),
          };
        });
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify(models));
      });
    },
  };
}

export default defineConfig({
  plugins: [listModels(), leaveOutRaw()],
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
