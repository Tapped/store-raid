/**
 * Backs up the shared `assets/` folder to Google Drive, and restores it from there, with rclone.
 *
 *   pnpm run assets:backup                 make Drive match assets/
 *   pnpm run assets:restore                show what a restore would change
 *   pnpm run assets:restore -- --yes       make assets/ match Drive
 *
 * Nothing is lost either way: a backup moves what it would overwrite or delete on Drive into
 * `store-raid-old/<time>/` there, and a restore moves local files into `assets-old/<time>/` next
 * to `assets/`. Other arguments go to rclone, e.g. `--dry-run`.
 *
 * Needs rclone (`winget install Rclone.Rclone`) and a remote made with
 * `rclone config create gdrive drive scope=drive.file`. ASSETS_REMOTE overrides `gdrive:store-raid`,
 * RCLONE the rclone executable.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { sharedAssets } from "./sharedAssets";

const [command, ...rest] = process.argv.slice(2);
const remote = process.env.ASSETS_REMOTE ?? "gdrive:store-raid";
const local = sharedAssets();
const time = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
const yes = rest.includes("--yes");
const passed = rest.filter((a) => a !== "--yes");

let args: string[];
if (command === "backup") {
  args = ["sync", local, remote, "--backup-dir", `${remote}-old/${time}`];
} else if (command === "restore") {
  args = ["sync", remote, local, "--backup-dir", `${dirname(local)}/assets-old/${time}`];
  if (!yes) args.push("--dry-run");
} else {
  console.error("Usage: tsx scripts/assets.ts backup|restore [--yes] [rclone arguments]");
  process.exit(1);
}

const rclone = process.env.RCLONE ?? "rclone";
const run = spawnSync(
  rclone,
  [...args, "--create-empty-src-dirs", "--stats-one-line", "-v", ...passed],
  {
    stdio: "inherit",
  },
);
if (run.error) {
  console.error(
    `Couldn't run ${rclone}: ${run.error.message}. Install it with winget install Rclone.Rclone.`,
  );
  process.exit(1);
}
if (command === "restore" && !yes && run.status === 0) {
  console.log("\nThat was a preview. Run pnpm run assets:restore -- --yes to make those changes.");
}
process.exit(run.status ?? 1);
