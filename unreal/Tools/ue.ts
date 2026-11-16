/**
 * The Unreal dev pipeline, from the terminal: `pnpm run ue <command>`.
 *
 *   build                 build the editor target (engine and game module), the binary everything runs on
 *   dev [clients] [bots]  a headless server, plus off-screen clients and bots joined to it, supervised:
 *                         script reloads in place; a change script can't take in place (a new UPROPERTY
 *                         or UFUNCTION), or a C++ change once rebuilt, restarts them all, and they rejoin
 *   server                only the headless dedicated server
 *   client [name]         a client rendering off screen on the GPU, joined to the server
 *   bot [name]            a client with no rendering, joined to the server
 *   window [name]         a client in a window on the desktop, with sound, joined to the server
 *   exec <who> <command>  run a console command in a running process (`server`, `client`, `client2`, `bot`…)
 *   shot <who> [file]     save a screenshot of a running client (default node_modules/.cache/ue/<who>.png)
 *   ping <who>            whether a process is up, and its net mode and map
 *   test [filter]         script unit tests in a headless editor (default Angelscript.UnitTests)
 *   check <name> [who]    a check in Tools/checks/ against a running bot: `check playground`
 *   import [filter…]      models from ../assets into Content/ (Tools/import/): staged with PNG textures,
 *                         then Interchange in a headless editor, with Nanite; only names containing a
 *                         filter (`props/tv`, `village/`), else all. Content/ can be deleted and rebuilt
 *
 * Every process gets a dev port (see DevServer.h) for exec and shot: the server 8700, clients 8711 on,
 * bots 8731 on, the window 8721. The game listens on 7777. UE_MODE=game makes the server's room a game
 * (rounds in the truck) rather than the playground, and UE_RAID_TIME=<seconds> shortens its raids;
 * `exec server sr.mode game` switches a running one. UE_ROOT points at the engine (the Angelscript fork's checkout).
 * Logs go to unreal/Saved/Logs/<who>.log as well as this terminal, prefixed with who said it.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageModels } from "./import/stage";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = join(ROOT, "StoreRaid.uproject");
const ENGINE = process.env.UE_ROOT ?? "F:/Dev/Unreal/UnrealEngine-Angelscript";
const EDITOR = join(ENGINE, "Engine/Binaries/Win64/UnrealEditor-Cmd.exe");
const BUILD = join(ENGINE, "Engine/Build/BatchFiles/Build.bat");
const GAME_PORT = Number(process.env.UE_GAME_PORT ?? 7777);
const SERVER_DEV_PORT = 8700;
const CLIENT_DEV_PORT = 8711;
const BOT_DEV_PORT = 8731;
const WINDOW_DEV_PORT = 8721;
const MAP = process.env.UE_MAP ?? "/Engine/Maps/Entry";

/** What script logs when a change needs a full reload that a running game can't do. */
const NEEDS_RESTART = /Full Reload is required/;

interface Role {
  who: string;
  devPort: number;
  args: string[];
  /** Shown on the desktop: not hidden like the off-screen processes. */
  onScreen?: boolean;
}

function common(who: string, devPort: number): string[] {
  return [
    "-as-development-mode",
    // Script that doesn't compile at startup exits, instead of opening a window to wait for a fix,
    // which crashes a process without Slate (the server, bots). dev starts it again on the next save.
    "-as-exit-on-error",
    "-unattended",
    "-nosplash",
    "-stdout",
    "-FullStdOutLogOutput",
    "-UTF8Output",
    `-DevPort=${devPort}`,
    `-abslog=${join(ROOT, "Saved/Logs", `${who}.log`)}`,
  ];
}

function serverRole(): Role {
  return {
    who: "server",
    devPort: SERVER_DEV_PORT,
    args: [
      PROJECT,
      MAP,
      "-server",
      "-nullrhi",
      "-nosound",
      `-port=${GAME_PORT}`,
      // What the room is for, and how long a raid lasts (Script/StoreRaidGameMode.as).
      ...(process.env.UE_MODE ? [`-mode=${process.env.UE_MODE}`] : []),
      ...(process.env.UE_RAID_TIME ? [`-raidtime=${process.env.UE_RAID_TIME}`] : []),
      ...common("server", SERVER_DEV_PORT),
    ],
  };
}

function clientRole(index: number, name?: string): Role {
  const who = index === 0 ? "client" : `client${index + 1}`;
  const devPort = CLIENT_DEV_PORT + index;
  return {
    who,
    devPort,
    args: [
      PROJECT,
      `127.0.0.1:${GAME_PORT}?Name=${name ?? who}`,
      "-game",
      "-RenderOffScreen",
      "-windowed",
      "-ResX=1280",
      "-ResY=720",
      "-nosound",
      ...common(who, devPort),
    ],
  };
}

function windowRole(name?: string): Role {
  return {
    who: "window",
    devPort: WINDOW_DEV_PORT,
    onScreen: true,
    args: [
      PROJECT,
      `127.0.0.1:${GAME_PORT}?Name=${name ?? "window"}`,
      "-game",
      "-windowed",
      "-ResX=1280",
      "-ResY=720",
      ...common("window", WINDOW_DEV_PORT),
    ],
  };
}

function botRole(index: number, name?: string): Role {
  const who = index === 0 ? "bot" : `bot${index + 1}`;
  const devPort = BOT_DEV_PORT + index;
  return {
    who,
    devPort,
    args: [
      PROJECT,
      `127.0.0.1:${GAME_PORT}?Name=${name ?? who}`,
      "-game",
      "-nullrhi",
      "-nosound",
      "-bot",
      ...common(who, devPort),
    ],
  };
}

function devPortOf(who: string): number {
  if (who === "window") return WINDOW_DEV_PORT;
  const match = /^(server|client|bot)(\d*)$/.exec(who);
  if (!match) throw new Error(`who is server, client, client2…, bot, bot2…, window: not ${who}`);
  const index = match[2] ? Number(match[2]) - 1 : 0;
  return match[1] === "server"
    ? SERVER_DEV_PORT
    : match[1] === "client"
      ? CLIENT_DEV_PORT + index
      : BOT_DEV_PORT + index;
}

const COLOURS = [36, 33, 35, 32, 34, 31];

/** Runs a role, prints its output prefixed, and calls onLine for every line. */
function start(role: Role, colour: number, onLine: (line: string) => void): ChildProcess {
  mkdirSync(join(ROOT, "Saved/Logs"), { recursive: true });
  const child = spawn(EDITOR, role.args, { cwd: ROOT, windowsHide: !role.onScreen });
  const prefix = `\x1b[${colour}m${role.who.padEnd(8)}\x1b[0m`;
  let rest = "";
  const take = (chunk: Buffer) => {
    rest += chunk.toString("utf8");
    const lines = rest.split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim() || isNoise(line)) continue;
      console.log(`${prefix} ${line}`);
      onLine(line);
    }
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  return child;
}

/** Lines that only say the engine is doing its job. UE_VERBOSE=1 shows everything. */
function isNoise(line: string): boolean {
  if (process.env.UE_VERBOSE) return false;
  return /LogConfig:|LogPluginManager: (Mounting|Found)|LogInit: Display: Loading text-based GConfig|LogStreaming:|LogTexture:|LogShaderCompilers:|LogDerivedDataCache:|LogAssetRegistry:|LogMemory:|LogCsvProfiler:|LogTargetPlatformManager:/.test(
    line,
  );
}

function build(): boolean {
  console.log("Building StoreRaidEditor and ShaderCompileWorker (Win64 Development)...");
  const result = spawnSync(
    "cmd.exe",
    [
      "/c",
      BUILD,
      `-Target=StoreRaidEditor Win64 Development -Project=${PROJECT}`,
      "-Target=ShaderCompileWorker Win64 Development -Quiet",
      "-WaitMutex",
      "-NoHotReloadFromIDE",
      // UBA's executor leaves every cl.exe hanging on exit for 120 s on this machine: the plain one.
      "-NoUBA",
      // It also waits for free memory before each compile, and with the browser and the rest open it
      // runs them one at a time. The page file grows as needed, so don't wait, but leave some headroom.
      "-UBADisableWaitOnMem",
      `-MaxParallelActions=${process.env.UE_BUILD_JOBS ?? 6}`,
    ],
    { stdio: "inherit", cwd: ROOT },
  );
  return result.status === 0;
}

/** Server, clients and bots, restarted together when script can't reload in place or C++ changed. */
function dev(clients: number, bots: number): void {
  const roles = [
    serverRole(),
    ...range(clients).map((i) => clientRole(i)),
    ...range(bots).map((i) => botRole(i)),
  ];
  let children: ChildProcess[] = [];
  let restarting = false;
  /** Whether one of them stopped by itself: script that didn't compile, or a crash. */
  let down = false;

  const launch = () => {
    down = false;
    // The server first; the others retry their connection until it listens.
    children = roles.map((role, i) => {
      const child = start(role, COLOURS[i % COLOURS.length], (line) => {
        if (NEEDS_RESTART.test(line)) restart("a script change needs a full reload");
      });
      child.once("exit", (code) => {
        if (restarting || down) return;
        down = true;
        console.log(
          `[31m${role.who} stopped (exit code ${code}): fix it and save to start them again.[0m`,
        );
      });
      return child;
    });
  };
  const stopAll = async () => {
    for (const child of children) child.kill();
    await Promise.all(
      children.map(
        (child) =>
          new Promise((done) => (child.exitCode !== null ? done(0) : child.once("exit", done))),
      ),
    );
    children = [];
  };
  const restart = async (why: string, rebuild = false) => {
    if (restarting) return;
    restarting = true;
    console.log(`\x1b[1mRestarting: ${why}\x1b[0m`);
    await stopAll();
    if (!rebuild || build()) launch();
    else console.log("\x1b[31mBuild failed: fix it and save again.\x1b[0m");
    restarting = false;
  };

  // C++ changes: rebuild and restart, a moment after the last save.
  let pending: NodeJS.Timeout | undefined;
  watch(join(ROOT, "Source"), { recursive: true }, (_event, file) => {
    if (!file || !/\.(h|cpp|cs)$/.test(file)) return;
    clearTimeout(pending);
    pending = setTimeout(() => restart(`${file} changed`, true), 500);
  });

  // Script changes reload in place, unless a process is down: then they start everything again.
  watch(join(ROOT, "Script"), { recursive: true }, (_event, file) => {
    if (!down || !file?.endsWith(".as")) return;
    clearTimeout(pending);
    pending = setTimeout(() => restart(`${file} changed`), 500);
  });

  process.on("SIGINT", async () => {
    await stopAll();
    process.exit(0);
  });
  // Killing the shell above it doesn't kill it on Windows (nor pnpm, nor tsx's own process between
  // them), and it would go on starting the game again on script saves: when any process it was
  // started under is gone, it stops everything and exits.
  // (process.kill(pid, 0) won't do: it still finds a process that has exited while anything holds a
  // handle to it, as whatever ran the shell does.)
  const ancestors = ancestry();
  console.log(`Started under ${ancestors.join(" < ")}: it stops when one of them does.`);
  setInterval(async () => {
    const running = spawnSync("tasklist.exe", ["/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
    }).stdout;
    if (!running) return;
    const pids = new Set(running.split(/\r?\n/).map((line) => Number(line.split('","')[1])));
    if (ancestors.some((pid) => !pids.has(pid))) {
      console.log("A process the launcher was started under is gone: stopping.");
      restarting = true;
      await stopAll();
      process.exit(0);
    }
  }, 5000);
  launch();
}

/** The processes this one was started under, its parent first, as Windows has them. */
function ancestry(): number[] {
  const listed = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
    ],
    { encoding: "utf8", windowsHide: true },
  ).stdout;
  const parents = new Map<number, number>();
  for (const line of listed?.split(/\r?\n/) ?? []) {
    const [pid, parent] = line.trim().split(" ").map(Number);
    if (pid) parents.set(pid, parent);
  }
  const chain: number[] = [];
  for (let pid = process.ppid; pid && parents.has(pid) && !chain.includes(pid); ) {
    chain.push(pid);
    pid = parents.get(pid) ?? 0;
  }
  return chain.length ? chain : [process.ppid];
}

function single(role: Role): void {
  const child = start(role, COLOURS[0], () => {});
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill());
}

/**
 * Runs automation tests in a headless editor (the script unit tests only run in an editor context,
 * not under -game or -server), prints each result, and exits non-zero if any failed.
 */
function test(filter: string): void {
  const role: Role = {
    who: "test",
    devPort: 8790,
    args: [
      PROJECT,
      `-ExecCmds=Automation RunTests ${filter}; Quit`,
      "-nullrhi",
      "-nosound",
      "-NoP4",
      ...common("test", 8790),
    ],
  };
  let failed = 0;
  let passed = 0;
  const child = spawn(EDITOR, role.args, { cwd: ROOT, windowsHide: true });
  let rest = "";
  const take = (chunk: Buffer) => {
    rest += chunk.toString("utf8");
    const lines = rest.split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (/Test Completed\. Result=\{Success\}/.test(line)) passed++;
      if (/Test Completed\. Result=\{(Fail|Error)/.test(line)) failed++;
      if (
        /Test Completed|Angelscript: Error|LogAutomationCommandLine: Error|Expected|Assert|Error: .*\.as/.test(
          line,
        )
      )
        console.log(line);
    }
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  child.on("exit", () => {
    console.log(`${passed} passed, ${failed} failed`);
    process.exit(failed > 0 || passed === 0 ? 1 : 0);
  });
}

/**
 * Stages the models (see Tools/import/stage.ts), then imports them in a headless editor with
 * Tools/import/import.py, printing its `import:` lines. Fails if any model didn't import.
 */
async function importModels(filters: string[]): Promise<void> {
  const names = await stageModels(filters);
  if (!names.length) {
    console.error(`No model in ../assets/models matches ${filters.join(" ")}`);
    process.exit(1);
  }
  // Each model's folder goes before the editor starts, so nothing of the last import is left over.
  // A running game keeps the packages it loaded open, and they can't be replaced.
  try {
    for (const name of names)
      rmSync(join(ROOT, "Content/Models", name), { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
    console.error(
      "The game has models open: stop `pnpm run ue dev` (and any other process) first.",
    );
    process.exit(1);
  }
  const list = join(ROOT, "Saved/Import/list.txt");
  writeFileSync(list, `${names.join("\n")}\n`);
  const script = join(ROOT, "Tools/import/import.py");
  const child = spawn(
    EDITOR,
    [
      PROJECT,
      `-ExecutePythonScript=${script}`,
      "-nullrhi",
      "-nosound",
      "-NoP4",
      ...common("import", 8791),
    ],
    { cwd: ROOT, windowsHide: true, env: { ...process.env, STORE_RAID_IMPORT: list } },
  );
  let rest = "";
  let failed = true;
  const take = (chunk: Buffer) => {
    rest += chunk.toString("utf8");
    const lines = rest.split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (/import: |Error:|LogPython: Error|Traceback|^\s+File "/.test(line) && !isNoise(line))
        console.log(line);
      if (/import: done: \d+ imported, 0 failed/.test(line)) failed = false;
    }
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  child.on("exit", (code) => {
    if (code !== 0) console.error(`The editor exited with ${code}: see Saved/Logs/import.log`);
    process.exit(failed || code !== 0 ? 1 : 0);
  });
}

async function exec(who: string, command: string): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${devPortOf(who)}/exec`, {
    method: "POST",
    body: command,
  });
  const text = await response.text();
  if (text.trim()) console.log(text.trimEnd());
  if (!response.ok) {
    console.error(`${who}: "${command}" was not handled`);
    process.exitCode = 1;
  }
}

async function shot(who: string, file?: string): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${devPortOf(who)}/shot`);
  if (response.headers.get("content-type") !== "image/png") {
    console.error(await response.text());
    process.exitCode = 1;
    return;
  }
  const path = resolve(file ?? join(ROOT, "..", "node_modules/.cache/ue", `${who}.png`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  console.log(path);
}

async function ping(who: string): Promise<void> {
  try {
    console.log(await (await fetch(`http://127.0.0.1:${devPortOf(who)}/ping`)).text());
  } catch {
    console.log("down");
    process.exitCode = 1;
  }
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

const [command = "dev", ...rest] = process.argv.slice(2);
if (command !== "build" && command !== "check" && !existsSync(EDITOR)) {
  console.error(
    `No editor at ${EDITOR}: run \`pnpm run ue build\` (and set UE_ROOT if the engine is elsewhere).`,
  );
  process.exit(1);
}
switch (command) {
  case "build":
    process.exit(build() ? 0 : 1);
    break;
  case "dev":
    dev(Number(rest[0] ?? 1), Number(rest[1] ?? 0));
    break;
  case "server":
    single(serverRole());
    break;
  case "client":
    single(clientRole(0, rest[0]));
    break;
  case "bot":
    single(botRole(0, rest[0]));
    break;
  case "window":
    single(windowRole(rest[0]));
    break;
  case "test":
    test(rest[0] ?? "Angelscript.UnitTests");
    break;
  case "exec":
    await exec(rest[0], rest.slice(1).join(" "));
    break;
  case "shot":
    await shot(rest[0], rest[1]);
    break;
  case "ping":
    await ping(rest[0]);
    break;
  case "import":
    await importModels(rest);
    break;
  case "check": {
    const file = join(ROOT, "Tools/checks", `${rest[0]}.ts`);
    if (!rest[0] || !existsSync(file)) {
      console.error(`No check ${rest[0] ?? ""} in Tools/checks/`);
      process.exit(1);
    }
    const result = spawnSync(process.execPath, ["--import", "tsx", file, ...rest.slice(1)], {
      stdio: "inherit",
    });
    process.exit(result.status ?? 1);
    break;
  }
  default:
    console.error(`Unknown command ${command}: see the top of unreal/Tools/ue.ts`);
    process.exit(1);
}
