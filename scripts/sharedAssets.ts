import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

/**
 * The `assets/` folder every checkout shares, next to `main/`. The common git dir is `main/.git`
 * from main and from every worktree (see client/vite.config.ts, which links it into public/).
 */
export function sharedAssets(): string {
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: import.meta.dirname,
    encoding: "utf8",
  }).trim();
  return resolve(dirname(dirname(gitDir)), "assets");
}
