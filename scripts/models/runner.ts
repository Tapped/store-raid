/**
 * Runs jobs in Blender for index.ts (what a job is: pipeline.py). By default through a Blender that
 * stays running in the background (build.py --serve): the first build starts it, and later builds
 * hand it their job as a file in node_modules/.cache/models/server/, skipping the ten seconds or so
 * Blender takes to start. It exits by itself after IDLE_MINUTES without a job, or with
 * `pnpm run model --stop`. Its output goes to server.log in that folder.
 */

import { execFile, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

export const IDLE_MINUTES = 15;

export interface JobResult<T> {
  models: Record<string, T>;
  /** What Blender printed with a MODEL prefix: progress, and any Python error. */
  log: string[];
}

const here = import.meta.dirname;
let count = 0;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class Blender {
  readonly folder: string;
  private started?: number;

  constructor(
    private readonly exe: string,
    work: string,
    private readonly useServer: boolean,
  ) {
    this.folder = `${work}/server`;
    mkdirSync(this.folder, { recursive: true });
  }

  /** The running server's process id, if one is running. */
  serverPid(): number | undefined {
    try {
      const { pid } = JSON.parse(readFileSync(`${this.folder}/server.json`, "utf8"));
      if (alive(pid)) return pid;
    } catch {}
    if (this.started && alive(this.started)) return this.started;
    return undefined;
  }

  /** Stops the running server. Returns whether there was one. */
  stop(): boolean {
    const pid = this.serverPid();
    if (pid) process.kill(pid);
    rmSync(`${this.folder}/server.json`, { force: true });
    return pid !== undefined;
  }

  async run<T>(job: object): Promise<JobResult<T>> {
    const id = `${process.pid}-${count++}`;
    const result = `${this.folder}/${id}.result.json`;
    const body = JSON.stringify({ ...job, result });
    try {
      if (this.useServer) await this.viaServer(id, body, result);
      else await this.direct(id, body);
      return JSON.parse(readFileSync(result, "utf8"));
    } finally {
      rmSync(result, { force: true });
    }
  }

  private direct(id: string, body: string): Promise<void> {
    const file = `${this.folder}/${id}.direct.json`;
    writeFileSync(file, body);
    const argv = ["-b", "--factory-startup", "--python", `${here}/build.py`, "--", file];
    return new Promise((done, fail) => {
      execFile(this.exe, argv, { maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
        rmSync(file, { force: true });
        if (err) {
          const tail = `${stdout}${stderr}`.split("\n").slice(-40).join("\n");
          fail(new Error(`Blender failed:\n${tail}`));
        } else done();
      });
    });
  }

  private startServer() {
    console.log(
      `Starting Blender in the background; it stays running ${IDLE_MINUTES} minutes after the` +
        " last build, to make the next one quicker (pnpm run model --stop ends it)",
    );
    const log = openSync(`${this.folder}/server.log`, "w");
    const argv = ["-b", "--factory-startup", "--python", `${here}/build.py`, "--"];
    const child = spawn(this.exe, [...argv, "--serve", this.folder, String(IDLE_MINUTES * 60)], {
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    child.unref();
    this.started = child.pid;
  }

  private async viaServer(id: string, body: string, result: string) {
    if (!this.serverPid()) this.startServer();
    const job = `${this.folder}/${id}.job.json`;
    // Written aside and renamed, so a server never reads half a job.
    writeFileSync(`${job}.tmp`, body);
    renameSync(`${job}.tmp`, job);
    for (let restarts = 0; ; ) {
      await new Promise((r) => setTimeout(r, 100));
      if (existsSync(result)) return;
      if (this.serverPid()) continue;
      if (existsSync(job) && restarts++ < 2) {
        // Nobody took it: the server went idle and exited as it came in. Start another.
        this.startServer();
        continue;
      }
      rmSync(job, { force: true });
      throw new Error(
        `Blender stopped during the job: see ${this.folder}/server.log. Running it without the` +
          " server (--no-server) shows its output directly.",
      );
    }
  }
}
